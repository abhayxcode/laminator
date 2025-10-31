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
  getUserAccountPublicKey,
  decodeUser,
  UserAccount,
} from '@drift-labs/sdk';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';

export class DriftTransactionService {
  constructor(
    private driftClient: DriftClient,
    private connection?: Connection
  ) {}

  /**
   * Check if user account exists on-chain by fetching and deserializing
   * Returns the deserialized UserAccount if it exists, null otherwise
   */
  private async checkUserAccountExists(
    userPubkey: PublicKey,
    subAccountId: number = 0
  ): Promise<{ exists: boolean; userAccount?: UserAccount }> {
    if (!this.connection) {
      return { exists: false };
    }

    try {
      const programId = (this.driftClient as any).program?.programId;
      if (!programId) {
        return { exists: false };
      }

      // Get user account PDA
      const userAccountPDA = await getUserAccountPublicKey(programId, userPubkey, subAccountId);
      
      // Fetch account info from chain
      const accountInfo = await this.connection.getAccountInfo(userAccountPDA);
      
      if (!accountInfo || !accountInfo.data) {
        return { exists: false };
      }

      // Deserialize the user account data
      try {
        const userAccount = decodeUser(accountInfo.data);
        return { exists: true, userAccount };
      } catch (error) {
        console.warn('Failed to deserialize user account:', error);
        return { exists: false };
      }
    } catch (error) {
      console.warn('Error checking user account existence:', error);
      return { exists: false };
    }
  }

  /**
   * Build initialize user stats instruction directly with user's accounts
   */
  async buildInitUserStatsInstruction(userPubkey: PublicKey): Promise<TransactionInstruction> {
    try {
      const programId = (this.driftClient as any).program?.programId;
      if (!programId) {
        throw new Error('Drift program ID not found');
      }

      const { getUserStatsAccountPublicKey } = await import('@drift-labs/sdk');
      const userStatsPDA = getUserStatsAccountPublicKey(programId, userPubkey);
      const statePublicKey = await (this.driftClient as any).getStatePublicKey();

      const program = (this.driftClient as any).program;
      const { SYSVAR_RENT_PUBKEY } = await import('@solana/web3.js');
      
      return await program.instruction.initializeUserStats({
        accounts: {
          userStats: userStatsPDA,
          authority: userPubkey,
          payer: userPubkey,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
          state: statePublicKey,
        },
      });
    } catch (error) {
      console.error('Error building init user stats instruction:', error);
      throw error;
    }
  }

  /**
   * Build initialize user instructions directly with user's accounts
   */
  async buildInitUserInstructions(
    userPubkey: PublicKey,
    subAccountId: number = 0
  ): Promise<TransactionInstruction[]> {
    try {
      const programId = (this.driftClient as any).program?.programId;
      if (!programId) {
        throw new Error('Drift program ID not found');
      }

      const { getUserAccountPublicKey, getUserStatsAccountPublicKey } = await import('@drift-labs/sdk');
      const userAccountPDA = await getUserAccountPublicKey(programId, userPubkey, subAccountId);
      const userStatsPDA = getUserStatsAccountPublicKey(programId, userPubkey);
      const statePublicKey = await (this.driftClient as any).getStatePublicKey();

      const program = (this.driftClient as any).program;
      const { SYSVAR_RENT_PUBKEY } = await import('@solana/web3.js');

      // Build initialize user account instruction directly
      const initUserIx = await program.instruction.initializeUserAccount(subAccountId, {
        accounts: {
          user: userAccountPDA,
          authority: userPubkey,
          payer: userPubkey,
          userStats: userStatsPDA,
          state: statePublicKey,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
      });

      return [initUserIx];
    } catch (error) {
      console.error('Error building init user instructions:', error);
      throw error;
    }
  }

  /**
   * Build deposit instruction using Drift SDK's getRemainingAccounts to ensure proper account structure
   */
  async buildDepositInstruction(
    userPubkey: PublicKey,
    amount: BN,
    marketIndex: number,
    tokenAccount: PublicKey,
    userInitialized: boolean = true
  ): Promise<TransactionInstruction> {
    try {
      const programId = (this.driftClient as any).program?.programId;
      if (!programId) {
        throw new Error('Drift program ID not found');
      }

      // Get user account and stats PDAs
      const { getUserStatsAccountPublicKey } = await import('@drift-labs/sdk');
      const userAccountPublicKey = await getUserAccountPublicKey(programId, userPubkey, 0);
      const userStatsPDA = getUserStatsAccountPublicKey(programId, userPubkey);

      // Get spot market account - verify it exists in Drift client's cache
      const spotMarketAccount = this.driftClient.getSpotMarketAccount(marketIndex);
      if (!spotMarketAccount) {
        // List available spot markets for debugging
        const availableSpotMarkets = this.driftClient.getSpotMarketAccounts();
        const marketIndices = availableSpotMarkets.map((m: any) => m.marketIndex).join(', ');
        throw new Error(
          `Spot market account not found for market index ${marketIndex}. ` +
          `Available spot market indices: ${marketIndices}. ` +
          `Make sure the Drift client is subscribed and the spot market exists.`
        );
      }

      console.log(`✅ Using spot market index ${marketIndex} (mint: ${spotMarketAccount.mint.toBase58()})`);

      // Get state public key
      const statePublicKey = await (this.driftClient as any).getStatePublicKey();

      // Use Drift client's getRemainingAccounts to build proper account structure
      // This ensures spot market account is included in the correct format
      let remainingAccounts: any[] = [];
      
      // Check if user account exists on-chain by fetching and deserializing
      if (userInitialized) {
        const { exists, userAccount } = await this.checkUserAccountExists(userPubkey, 0);
        
        try {
          if (exists && userAccount) {
            // User account exists - use it for remaining accounts
            remainingAccounts = (this.driftClient as any).getRemainingAccounts({
              userAccounts: [userAccount],
              useMarketLastSlotCache: true,
              writableSpotMarketIndexes: [marketIndex],
            });
          } else {
            // User account doesn't exist on-chain - build without it
            console.log('📝 User account does not exist on-chain, building remaining accounts without user account or cache');
            remainingAccounts = (this.driftClient as any).getRemainingAccounts({
              userAccounts: [],
              useMarketLastSlotCache: false, // Don't use cache when user doesn't exist
              writableSpotMarketIndexes: [marketIndex],
            });
          }
        } catch (error: any) {
          // If getRemainingAccounts fails, build without cache
          console.warn('Failed to get remaining accounts with cache, building without:', error?.message);
          try {
            remainingAccounts = (this.driftClient as any).getRemainingAccounts({
              userAccounts: [],
              useMarketLastSlotCache: false, // Skip cache to avoid getUser() call
              writableSpotMarketIndexes: [marketIndex],
            });
          } catch (fallbackError) {
            console.error('Failed to build remaining accounts even without cache:', fallbackError);
            // Build minimal remaining accounts manually if SDK method fails
            remainingAccounts = [];
          }
        }
      } else {
        // User not initialized - build remaining accounts without user account data
        try {
          remainingAccounts = (this.driftClient as any).getRemainingAccounts({
            userAccounts: [],
            useMarketLastSlotCache: false, // Don't use cache for new users
            writableSpotMarketIndexes: [marketIndex],
          });
        } catch (error: any) {
          console.warn('Failed to get remaining accounts, building minimal:', error?.message);
          remainingAccounts = [];
        }
      }

      // Add token mint to remaining accounts (SDK does this in getDepositInstruction)
      (this.driftClient as any).addTokenMintToRemainingAccounts?.(spotMarketAccount, remainingAccounts);

      // Check for transfer hooks and add extra account metas if needed
      if ((this.driftClient as any).isTransferHook?.(spotMarketAccount)) {
        await (this.driftClient as any).addExtraAccountMetasToRemainingAccounts?.(
          spotMarketAccount.mint,
          remainingAccounts
        );
      }

      // Get token program for spot market
      const tokenProgram = (this.driftClient as any).getTokenProgramForSpotMarket(spotMarketAccount);

      // Build the deposit instruction using the program's instruction builder
      const program = (this.driftClient as any).program;
      
      return await program.instruction.deposit(
        marketIndex,
        amount,
        false, // reduceOnly
        {
          accounts: {
            state: statePublicKey,
            spotMarket: spotMarketAccount.pubkey,
            spotMarketVault: spotMarketAccount.vault,
            user: userAccountPublicKey,
            userStats: userStatsPDA,
            userTokenAccount: tokenAccount,
            authority: userPubkey, // User's pubkey as authority
            tokenProgram: tokenProgram,
          },
          remainingAccounts,
        }
      );
    } catch (error) {
      console.error('Error building deposit instruction:', error);
      throw error;
    }
  }

  /**
   * Build place order instruction using Drift SDK's getRemainingAccounts to ensure proper account structure
   */
  async buildPlaceOrderInstruction(
    userPubkey: PublicKey,
    orderParams: any
  ): Promise<TransactionInstruction> {
    try {
      const programId = (this.driftClient as any).program?.programId;
      if (!programId) {
        throw new Error('Drift program ID not found');
      }

      const { getUserStatsAccountPublicKey, getOrderParams, getHighLeverageModeConfigPublicKey, isUpdateHighLeverageMode } = await import('@drift-labs/sdk');
      const userAccountPDA = await getUserAccountPublicKey(programId, userPubkey, 0);
      const userStatsPDA = getUserStatsAccountPublicKey(programId, userPubkey);
      const statePublicKey = await (this.driftClient as any).getStatePublicKey();

      // Build remaining accounts for the order
      // Determine readable market indexes based on order type
      const readablePerpMarketIndex: number[] = [];
      const readableSpotMarketIndexes: number[] = [];
      
      if (orderParams.marketType === MarketType.PERP) {
        readablePerpMarketIndex.push(orderParams.marketIndex);
        
        // Verify perp market exists and get its quote spot market index
        // This is REQUIRED for margin calculations - the quote spot market must be included
        const perpMarket = this.driftClient.getPerpMarketAccount(orderParams.marketIndex);
        if (!perpMarket) {
          const availablePerpMarkets = this.driftClient.getPerpMarketAccounts();
          const marketIndices = availablePerpMarkets.map((m: any) => m.marketIndex).join(', ');
          throw new Error(
            `Perp market account not found for market index ${orderParams.marketIndex}. ` +
            `Available perp market indices: ${marketIndices}`
          );
        }
        
        // CRITICAL: Include the quote spot market for margin calculations
        // Every perp market has a quoteSpotMarketIndex that must be included
        const quoteSpotMarketIndex = (perpMarket as any).quoteSpotMarketIndex;
        if (quoteSpotMarketIndex !== undefined && quoteSpotMarketIndex !== null) {
          readableSpotMarketIndexes.push(quoteSpotMarketIndex);
          console.log(`✅ Including quote spot market ${quoteSpotMarketIndex} for perp market ${orderParams.marketIndex}`);
        } else {
          // Fallback: spot market 1 (USDC) is usually the quote market
          console.warn(`⚠️ quoteSpotMarketIndex not found in perp market, defaulting to spot market 1`);
          readableSpotMarketIndexes.push(1);
        }
        
        console.log(`✅ Using perp market index ${orderParams.marketIndex}`);
      } else {
        readableSpotMarketIndexes.push(orderParams.marketIndex);
        
        // Verify spot market exists
        const spotMarket = this.driftClient.getSpotMarketAccount(orderParams.marketIndex);
        if (!spotMarket) {
          const availableSpotMarkets = this.driftClient.getSpotMarketAccounts();
          const marketIndices = availableSpotMarkets.map((m: any) => m.marketIndex).join(', ');
          throw new Error(
            `Spot market account not found for market index ${orderParams.marketIndex}. ` +
            `Available spot market indices: ${marketIndices}`
          );
        }
        console.log(`✅ Using spot market index ${orderParams.marketIndex}`);
      }
      
      // Use Drift client's getRemainingAccounts to build proper account structure
      // This ensures all market accounts (perp/spot) and oracles are included correctly
      let remainingAccounts: any[] = [];
      
      // Check if user account exists on-chain by fetching and deserializing
      // This is used both for remaining accounts and to include spot markets with collateral
      const { exists, userAccount } = await this.checkUserAccountExists(userPubkey, 0);
      
      // If user account exists, include all spot markets that the user has collateral in
      // This is needed for margin calculations
      if (exists && userAccount) {
        const userSpotPositions = userAccount.spotPositions || [];
        for (const spotPosition of userSpotPositions) {
          if (spotPosition && spotPosition.scaledBalance && !spotPosition.scaledBalance.isZero()) {
            const spotMarketIndex = spotPosition.marketIndex;
            if (!readableSpotMarketIndexes.includes(spotMarketIndex)) {
              readableSpotMarketIndexes.push(spotMarketIndex);
              console.log(`✅ Including spot market ${spotMarketIndex} (user has collateral)`);
            }
          }
        }
      }
      
      try {
        if (exists && userAccount) {
          // User account exists - use it for remaining accounts
          remainingAccounts = (this.driftClient as any).getRemainingAccounts({
            userAccounts: [userAccount],
            readablePerpMarketIndex,
            readableSpotMarketIndexes,
            useMarketLastSlotCache: true,
          });
        } else {
          // User account doesn't exist on-chain - build without it (for new users)
          // Don't use cache since it requires user account in DriftClient
          console.log('📝 User account does not exist on-chain, building remaining accounts without user account or cache');
          remainingAccounts = (this.driftClient as any).getRemainingAccounts({
            userAccounts: [],
            readablePerpMarketIndex,
            readableSpotMarketIndexes,
            useMarketLastSlotCache: false, // Don't use cache when user doesn't exist
          });
        }
      } catch (error: any) {
        // If getRemainingAccounts fails (e.g., DriftClient doesn't have user), 
        // build without cache and user accounts
        console.warn('Failed to get remaining accounts with cache, building without:', error?.message);
        try {
          remainingAccounts = (this.driftClient as any).getRemainingAccounts({
            userAccounts: [],
            readablePerpMarketIndex,
            readableSpotMarketIndexes,
            useMarketLastSlotCache: false, // Skip cache to avoid getUser() call
          });
        } catch (fallbackError) {
          console.error('Failed to build remaining accounts even without cache:', fallbackError);
          // Build minimal remaining accounts manually if SDK method fails
          remainingAccounts = [];
        }
      }

      // Check if order requires high leverage mode config
      if (orderParams.bitFlags && isUpdateHighLeverageMode(orderParams.bitFlags)) {
        const highLeverageModeConfig = getHighLeverageModeConfigPublicKey(programId);
        remainingAccounts.push({
          pubkey: highLeverageModeConfig,
          isWritable: true,
          isSigner: false,
        });
      }

      const program = (this.driftClient as any).program;
      const formattedParams = getOrderParams(orderParams);
      
      return await program.instruction.placeOrders([formattedParams], {
        accounts: {
          state: statePublicKey,
          user: userAccountPDA,
          userStats: userStatsPDA,
          authority: userPubkey,
        },
        remainingAccounts,
      });
    } catch (error) {
      console.error('Error building place order instruction:', error);
      throw error;
    }
  }

  /**
   * Build legacy Transaction manually from instructions
   * Instructions are already fixed at creation time - just assemble the transaction
   */
  private async buildLegacyTransaction(
    instructions: TransactionInstruction[],
    feePayer: PublicKey
  ): Promise<Transaction> {
    const transaction = new Transaction();
    
    // Set fee payer
    transaction.feePayer = feePayer;
    
    // Add instructions (signers already fixed at instruction creation time)
    transaction.add(...instructions);

    // Get recent blockhash if connection is available
    if (this.connection) {
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
    } else {
      // Fallback: try to get blockhash from driftClient's connection
      const connection = (this.driftClient as any).connection;
      if (connection) {
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
      } else {
        throw new Error('No connection available to fetch blockhash');
      }
    }

    return transaction;
  }


  /**
   * Check if token account exists and add creation instruction if needed
   * For wrapped SOL deposits, also adds wrap instructions
   */
  private async ensureTokenAccountExists(
    userPubkey: PublicKey,
    mintAddress: PublicKey,
    instructions: TransactionInstruction[],
    amountToWrap?: BN
  ): Promise<PublicKey> {
    if (!this.connection) {
      throw new Error('Connection required to check token account existence');
    }

    const tokenAccount = getAssociatedTokenAddressSync(mintAddress, userPubkey);
    const isWrappedSOL = mintAddress.equals(NATIVE_MINT);

    // Check if token account exists
    const tokenAccountInfo = await this.connection.getAccountInfo(tokenAccount);
    
    if (!tokenAccountInfo) {
      // Token account doesn't exist - add creation instruction
      instructions.push(
        createAssociatedTokenAccountInstruction(
          userPubkey, // payer (fee payer)
          tokenAccount, // associated token address to create
          userPubkey, // owner of the ATA
          mintAddress // mint address
        )
      );

      // For wrapped SOL deposits, we need to wrap native SOL
      if (isWrappedSOL && amountToWrap) {
        // Transfer native SOL to the wrapped SOL token account
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: userPubkey,
            toPubkey: tokenAccount,
            lamports: amountToWrap.toNumber(),
          })
        );

        // Sync native to update the wrapped SOL balance
        instructions.push(
          createSyncNativeInstruction(tokenAccount, TOKEN_PROGRAM_ID)
        );
      }
    } else if (isWrappedSOL && amountToWrap) {
      // Token account exists - check existing balance
      try {
        const existingAccount = await getAccount(this.connection, tokenAccount);
        const existingBalance = new BN(existingAccount.amount.toString());
        const neededAmount = amountToWrap.sub(existingBalance);

        // Only wrap if we need more than what's already there
        if (neededAmount.gt(new BN(0))) {
          // Transfer native SOL to the wrapped SOL token account
          instructions.push(
            SystemProgram.transfer({
              fromPubkey: userPubkey,
              toPubkey: tokenAccount,
              lamports: neededAmount.toNumber(),
            })
          );

          // Sync native to update the wrapped SOL balance
          instructions.push(
            createSyncNativeInstruction(tokenAccount, TOKEN_PROGRAM_ID)
          );
        }
      } catch (error) {
        // If we can't read the account, wrap the full amount to be safe
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: userPubkey,
            toPubkey: tokenAccount,
            lamports: amountToWrap.toNumber(),
          })
        );

        instructions.push(
          createSyncNativeInstruction(tokenAccount, TOKEN_PROGRAM_ID)
        );
      }
    }

    return tokenAccount;
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

      // Check if this is wrapped SOL and needs wrapping
      const isWrappedSOL = mintAddress.equals(NATIVE_MINT);
      const wrapAmount = isWrappedSOL ? amount : undefined;

      // Ensure token account exists (create if needed)
      // For wrapped SOL, also wrap the native SOL
      const tokenAccount = await this.ensureTokenAccountExists(
        userPubkey,
        mintAddress,
        instructions,
        wrapAmount
      );

      // Check on-chain if user stats and user account already exist
      const { getUserStatsAccountPublicKey, getUserAccountPublicKey } = await import('@drift-labs/sdk');
      const programId = (this.driftClient as any).program?.programId;
      let userStatsExists = false;
      let userAccountExists = false;
      
      if (programId && this.connection) {
        try {
          // Check user stats account
          const userStatsPDA = getUserStatsAccountPublicKey(programId, userPubkey);
          const statsAccountInfo = await this.connection.getAccountInfo(userStatsPDA);
          userStatsExists = statsAccountInfo !== null;
          
          // Check user account
          const userAccountPDA = await getUserAccountPublicKey(programId, userPubkey, 0);
          const userAccountInfo = await this.connection.getAccountInfo(userAccountPDA);
          userAccountExists = userAccountInfo !== null;
          
          console.log(`🔍 Account check: stats=${userStatsExists}, user=${userAccountExists}`);
        } catch (e) {
          console.warn('Could not check user accounts:', e);
        }
      }

      // Only add initialization instructions if accounts don't exist
      if (!userStatsExists) {
        console.log('📝 Adding InitializeUserStats instruction');
        try {
          const initStatsIx = await this.buildInitUserStatsInstruction(userPubkey);
          instructions.push(initStatsIx);
        } catch (error) {
          console.error('Failed to build init user stats instruction:', error);
          throw error;
        }
      } else {
        console.log('✅ User stats account already exists, skipping init');
      }

      if (!userAccountExists) {
        console.log('📝 Adding InitializeUserAccount instructions');
        try {
          const initUserIxs = await this.buildInitUserInstructions(userPubkey, 0);
          instructions.push(...initUserIxs);
        } catch (error) {
          console.error('Failed to build init user account instructions:', error);
          throw error;
        }
      } else {
        console.log('✅ User account already exists, skipping init');
      }

      // Add deposit instruction (userInitialized = true if user account exists, false if we just initialized)
      const depositIx = await this.buildDepositInstruction(
        userPubkey,
        amount,
        marketIndex,
        tokenAccount,
        userAccountExists // userInitialized: true if account already existed
      );
      instructions.push(depositIx);

      // Build legacy transaction manually
      return await this.buildLegacyTransaction(instructions, userPubkey);
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
      const instructions: TransactionInstruction[] = [];

      // Check if this is wrapped SOL and needs wrapping
      const isWrappedSOL = mintAddress.equals(NATIVE_MINT);
      const wrapAmount = isWrappedSOL ? amount : undefined;

      // Ensure token account exists (create if needed)
      // For wrapped SOL, also wrap the native SOL
      const tokenAccount = await this.ensureTokenAccountExists(
        userPubkey,
        mintAddress,
        instructions,
        wrapAmount
      );

      const depositIx = await this.buildDepositInstruction(
        userPubkey,
        amount,
        marketIndex,
        tokenAccount,
        true // userInitialized
      );

      instructions.push(depositIx);

      // Build legacy transaction manually
      return await this.buildLegacyTransaction(instructions, userPubkey);
    } catch (error) {
      console.error('Error building deposit only transaction:', error);
      throw error;
    }
  }

  /**
   * Build close position transaction (partial or full)
   * Requires user account data to determine position size
   */
  async buildClosePositionTransaction(
    userPubkey: PublicKey,
    marketIndex: number,
    percentage: number = 100,
    userAccount?: any // UserAccount data from driftService.loadUserAccount
  ): Promise<Transaction> {
    try {
      if (!userAccount) {
        throw new Error('User account data required to build close position transaction');
      }

      const position = userAccount.perpPositions.find((p: any) => p.marketIndex === marketIndex);
      if (!position || position.baseAssetAmount.eq(new BN(0))) {
        throw new Error('Position not found');
      }

      // Get perp market account to check minimum order size
      const perpMarket = this.driftClient.getPerpMarketAccount(marketIndex);
      if (!perpMarket) {
        throw new Error(`Perp market ${marketIndex} not found`);
      }

      // Get minimum order size from market (order_step_size)
      // For reduce-only orders, we use order_step_size as the threshold (not min_order_size)
      const orderStepSize = perpMarket.amm.orderStepSize || new BN(10000000); // Default to 10000000 if not available
      
      console.log(`📊 Position baseAssetAmount: ${position.baseAssetAmount.toString()}`);
      console.log(`📊 Market orderStepSize: ${orderStepSize.toString()}`);
      console.log(`📊 Close percentage: ${percentage}%`);

      // Determine direction (opposite of position)
      const isLong = position.baseAssetAmount.gt(new BN(0));
      const direction = isLong ? PositionDirection.SHORT : PositionDirection.LONG;

      // Calculate close amount
      let closeAmount: BN;
      if (percentage === 100) {
        // Full close
        closeAmount = position.baseAssetAmount.abs();
      } else {
        // Partial close - use integer division but ensure we round up if needed
        const absBaseAssetAmount = position.baseAssetAmount.abs();
        // Multiply first, then divide to minimize precision loss
        closeAmount = absBaseAssetAmount
          .mul(new BN(percentage))
          .div(new BN(100));
      }

      console.log(`📊 Calculated closeAmount: ${closeAmount.toString()}`);

      // Validate that closeAmount is not zero
      if (closeAmount.isZero()) {
        throw new Error(
          `Close amount is zero. Position size: ${position.baseAssetAmount.toString()}, ` +
          `Percentage: ${percentage}%, Market min: ${orderStepSize.toString()}`
        );
      }

      // Ensure closeAmount meets minimum order size
      if (closeAmount.lt(orderStepSize)) {
        // If partial close results in amount below minimum, check if we can do full close
        if (percentage < 100) {
          // Try to use full position instead
          const fullCloseAmount = position.baseAssetAmount.abs();
          if (fullCloseAmount.gte(orderStepSize)) {
            console.log(`⚠️ Partial close (${percentage}%) would be below minimum. Using full close instead.`);
            closeAmount = fullCloseAmount;
          } else {
            throw new Error(
              `Position size (${fullCloseAmount.toString()}) is below minimum order size ` +
              `(${orderStepSize.toString()}). Cannot close position.`
            );
          }
        } else {
          throw new Error(
            `Position size (${closeAmount.toString()}) is below minimum order size ` +
            `(${orderStepSize.toString()}). Cannot close position.`
          );
        }
      }

      console.log(`✅ Final closeAmount: ${closeAmount.toString()}`);

      // Create reduce-only market order
      const orderParams = getMarketOrderParams({
        marketType: MarketType.PERP,
        marketIndex,
        direction,
        baseAssetAmount: closeAmount,
        reduceOnly: true,
      });

      const placeOrderIx = await this.buildPlaceOrderInstruction(userPubkey, orderParams);
      return await this.buildLegacyTransaction([placeOrderIx], userPubkey);
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

      const placeOrderIx = await this.buildPlaceOrderInstruction(userPubkey, orderParams);
      return await this.buildLegacyTransaction([placeOrderIx], userPubkey);
    } catch (error) {
      console.error('Error building open position transaction:', error);
      throw error;
    }
  }
}

/**
 * Create a new DriftTransactionService instance
 */
export function createDriftTransactionService(
  driftClient: DriftClient,
  connection?: Connection
): DriftTransactionService {
  return new DriftTransactionService(driftClient, connection);
}
