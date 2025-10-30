/**
 * Drift Transaction Service
 * Handles building transactions for Drift Protocol operations
 */

import {
  DriftClient,
  BN,
  OrderType,
  MarketType,
  PositionDirection,
  getMarketOrderParams,
  getLimitOrderParams,
  QUOTE_PRECISION,
  PerpMarkets,
} from '@drift-labs/sdk';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

export class DriftTransactionService {
  constructor(private driftClient: DriftClient) {}

  /**
   * Build initialize user stats instruction
   */
  async buildInitUserStatsInstruction(userPubkey: PublicKey): Promise<TransactionInstruction> {
    try {
      const ix = await this.driftClient.getInitializeUserStatsIx();
      return ix;
    } catch (error) {
      console.error('Error building init user stats instruction:', error);
      throw error;
    }
  }

  /**
   * Build initialize user instructions
   */
  async buildInitUserInstructions(
    userPubkey: PublicKey,
    subAccountId: number = 0
  ): Promise<TransactionInstruction[]> {
    try {
      // Use the public method to initialize user - returns [instructions, userAccountPublicKey]
      const [ixs, _userAccountPublicKey] = await this.driftClient.getInitializeUserAccountIxs(subAccountId);
      return ixs;
    } catch (error) {
      console.error('Error building init user instructions:', error);
      throw error;
    }
  }

  /**
   * Build deposit instruction
   */
  async buildDepositInstruction(
    userPubkey: PublicKey,
    amount: BN,
    marketIndex: number,
    tokenAccount: PublicKey,
    userInitialized: boolean = true
  ): Promise<TransactionInstruction> {
    try {
      const ix = await this.driftClient.getDepositInstruction(
        amount,
        marketIndex,
        tokenAccount,
        0, // subAccountId
        false, // reduceOnly
        userInitialized
      );
      return ix;
    } catch (error) {
      console.error('Error building deposit instruction:', error);
      throw error;
    }
  }

  /**
   * Build complete init + deposit transaction
   */
  async buildInitAndDepositTransaction(
    userPubkey: PublicKey,
    amount: BN,
    marketIndex: number,
    mintAddress: PublicKey
  ): Promise<Transaction> {
    try {
      const instructions: TransactionInstruction[] = [];

      // Get token account
      const tokenAccount = getAssociatedTokenAddressSync(mintAddress, userPubkey);

      // Add init user stats instruction
      try {
        const initStatsIx = await this.buildInitUserStatsInstruction(userPubkey);
        instructions.push(initStatsIx);
      } catch (error) {
        console.log('User stats already initialized or init not needed');
      }

      // Add init user instructions (may return multiple)
      const initUserIxs = await this.buildInitUserInstructions(userPubkey, 0);
      instructions.push(...initUserIxs);

      // Add deposit instruction (userInitialized = false since we just initialized)
      const depositIx = await this.buildDepositInstruction(
        userPubkey,
        amount,
        marketIndex,
        tokenAccount,
        false
      );
      instructions.push(depositIx);

      // Build transaction
      const tx = await this.driftClient.buildTransaction(instructions);
      return tx as Transaction;
    } catch (error) {
      console.error('Error building init and deposit transaction:', error);
      throw error;
    }
  }

  /**
   * Build deposit-only transaction (user already initialized)
   */
  async buildDepositOnlyTransaction(
    userPubkey: PublicKey,
    amount: BN,
    marketIndex: number,
    mintAddress: PublicKey
  ): Promise<Transaction> {
    try {
      const tokenAccount = getAssociatedTokenAddressSync(mintAddress, userPubkey);

      const depositIx = await this.buildDepositInstruction(
        userPubkey,
        amount,
        marketIndex,
        tokenAccount,
        true // userInitialized
      );

      const tx = await this.driftClient.buildTransaction([depositIx]);
      return tx as Transaction;
    } catch (error) {
      console.error('Error building deposit only transaction:', error);
      throw error;
    }
  }

  /**
   * Build close position transaction (partial or full)
   */
  async buildClosePositionTransaction(
    userPubkey: PublicKey,
    marketIndex: number,
    percentage: number = 100
  ): Promise<Transaction> {
    try {
      if (percentage === 100) {
        // Full close - place a reduce-only order that closes the entire position
        const userAccount = this.driftClient.getUserAccount();
        if (!userAccount) {
          throw new Error('User account not found');
        }

        const position = userAccount.perpPositions.find(p => p.marketIndex === marketIndex);
        if (!position) {
          throw new Error('Position not found');
        }

        // Determine direction (opposite of position)
        const isLong = position.baseAssetAmount.gt(new BN(0));
        const direction = isLong ? PositionDirection.SHORT : PositionDirection.LONG;

        // Create reduce-only market order to close full position
        const orderParams = getMarketOrderParams({
          marketType: MarketType.PERP,
          marketIndex,
          direction,
          baseAssetAmount: position.baseAssetAmount.abs(),
          reduceOnly: true,
        });

        const placeOrderIx = await this.driftClient.getPlaceOrdersIx([orderParams]);
        return await this.driftClient.buildTransaction([placeOrderIx]) as Transaction;
      } else {
        // Partial close using reduce-only market order
        const userAccount = this.driftClient.getUserAccount();
        if (!userAccount) {
          throw new Error('User account not found');
        }

        const position = userAccount.perpPositions.find(p => p.marketIndex === marketIndex);
        if (!position) {
          throw new Error('Position not found');
        }

        // Calculate partial close amount
        const closeAmount = position.baseAssetAmount
          .mul(new BN(percentage))
          .div(new BN(100));

        // Determine direction (opposite of position)
        const isLong = position.baseAssetAmount.gt(new BN(0));
        const direction = isLong ? PositionDirection.SHORT : PositionDirection.LONG;

        // Create reduce-only market order
        const orderParams = getMarketOrderParams({
          marketType: MarketType.PERP,
          marketIndex,
          direction,
          baseAssetAmount: closeAmount.abs(),
          reduceOnly: true,
        });

        const placeOrderIx = await this.driftClient.getPlaceOrdersIx([orderParams]);
        return await this.driftClient.buildTransaction([placeOrderIx]) as Transaction;
      }
    } catch (error) {
      console.error('Error building close position transaction:', error);
      throw error;
    }
  }

  /**
   * Build open position transaction
   */
  async buildOpenPositionTransaction(
    userPubkey: PublicKey,
    marketIndex: number,
    direction: 'long' | 'short',
    amount: BN,
    orderType: 'market' | 'limit',
    limitPrice?: BN
  ): Promise<Transaction> {
    try {
      const positionDirection = direction === 'long'
        ? PositionDirection.LONG
        : PositionDirection.SHORT;

      let orderParams;

      if (orderType === 'market') {
        orderParams = getMarketOrderParams({
          marketType: MarketType.PERP,
          marketIndex,
          direction: positionDirection,
          baseAssetAmount: amount,
        });
      } else {
        if (!limitPrice) {
          throw new Error('Limit price required for limit orders');
        }

        orderParams = getLimitOrderParams({
          marketType: MarketType.PERP,
          marketIndex,
          direction: positionDirection,
          baseAssetAmount: amount,
          price: limitPrice,
        });
      }

      const placeOrderIx = await this.driftClient.getPlaceOrdersIx([orderParams]);
      return await this.driftClient.buildTransaction([placeOrderIx]) as Transaction;
    } catch (error) {
      console.error('Error building open position transaction:', error);
      throw error;
    }
  }
}

/**
 * Create a new DriftTransactionService instance
 */
export function createDriftTransactionService(driftClient: DriftClient): DriftTransactionService {
  return new DriftTransactionService(driftClient);
}
