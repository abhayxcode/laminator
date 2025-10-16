import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { 
  DriftClient, 
  Wallet,
  OrderType,
  PositionDirection,
  BN,
  BASE_PRECISION,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  QUOTE_SPOT_MARKET_INDEX,
  getUserAccountPublicKey,
  convertToNumber
} from "@drift-labs/sdk";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config();

export interface PerpetualOrderRequest {
  marketIndex: number;
  direction: "long" | "short";
  price?: number;
  baseAssetAmount: number;
  orderType: "market" | "limit";
}

export interface PerpetualMarket {
  marketIndex: number;
  symbol: string;
  name: string;
  baseAssetReserve: number;
  quoteAssetReserve: number;
  lastPrice: number;
  volume24h: number;
}

export interface PerpetualPosition {
  marketIndex: number;
  symbol: string;
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  margin: number;
  isLong: boolean;
}

export interface DepositRequest {
  publicKey: string;
  collateral: {
    mint: string;
    decimals: number;
  };
  amount: number;
}

export class PerpetualService {
  private driftClient: DriftClient | null = null;
  private connection: Connection | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    try {
      const privateKey = process.env.PRIVATE_KEY;
      const rpcUrl = process.env.RPC_URL;

      if (!privateKey || !rpcUrl) {
        console.warn("⚠️ PRIVATE_KEY or RPC_URL not found - PerpetualService will be limited");
        return;
      }

      // Parse private key
      let keypair: Keypair;
      try {
        const secretKey = Uint8Array.from(JSON.parse(privateKey));
        keypair = Keypair.fromSecretKey(secretKey);
      } catch (e) {
        const bs58 = require("bs58");
        keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      }

      const wallet = new Wallet(keypair);
      this.connection = new Connection(rpcUrl);

      this.driftClient = new DriftClient({
        connection: this.connection,
        wallet,
        env: "devnet",
      });

      await this.driftClient.subscribe();
      this.isInitialized = true;
      
      console.log("✅ PerpetualService initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize PerpetualService:", error);
      this.isInitialized = false;
    }
  }

  async isReady(): Promise<boolean> {
    return this.isInitialized && this.driftClient !== null;
  }

  async getMarkets(): Promise<PerpetualMarket[]> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    try {
      const perpetualMarkets = this.driftClient.getPerpMarketAccounts();
      
      return perpetualMarkets.map(market => {
        // Get current price from oracle
        const oraclePriceData = this.driftClient!.getOracleDataForPerpMarket(market.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        // Get 24h volume
        const volume24h = market.amm.volume24H ? convertToNumber(market.amm.volume24H, QUOTE_PRECISION) : 0;

        // Convert name from number array to string
        const nameString = String.fromCharCode(...market.name);

        return {
          marketIndex: market.marketIndex,
          symbol: nameString.replace(/\0/g, ''), // Remove null characters
          name: nameString.replace(/\0/g, ''), // Remove null characters
          baseAssetReserve: convertToNumber(market.amm.baseAssetReserve, new BN(9)),
          quoteAssetReserve: convertToNumber(market.amm.quoteAssetReserve, QUOTE_PRECISION),
          lastPrice: currentPrice,
          volume24h: volume24h
        };
      });
    } catch (error) {
      console.error("Error fetching markets:", error);
      throw new Error("Failed to fetch markets");
    }
  }

  async createUserAccount(publicKey: string): Promise<{ success: boolean; txSig?: string; userAccountPublicKey: string }> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    try {
      const authority = new PublicKey(publicKey);

      // Derive expected Drift user account PDA for this authority
      const programId = this.driftClient["program"].programId;
      const userAccountPubkey = await getUserAccountPublicKey(programId, authority);

      // Check if it already exists on-chain
      const existing = await this.connection!.getAccountInfo(userAccountPubkey);

      if (existing) {
        return {
          success: true,
          userAccountPublicKey: userAccountPubkey.toBase58(),
        };
      }

      // Ensure server wallet matches provided authority
      const serverAuthority = this.driftClient["wallet"].publicKey;
      if (!serverAuthority.equals(authority)) {
        throw new Error("Server cannot initialize user for a different authority");
      }

      const [txSig, createdUserPk] = await this.driftClient.initializeUserAccount();

      return {
        success: true,
        txSig,
        userAccountPublicKey: createdUserPk.toBase58(),
      };
    } catch (error) {
      console.error("Error creating user account:", error);
      throw new Error("Failed to create Drift user account");
    }
  }

  async depositCollateral(depositRequest: DepositRequest): Promise<{ success: boolean; txSig: string }> {
    if (!this.driftClient || !this.connection) {
      throw new Error("PerpetualService not initialized");
    }

    const { publicKey, collateral, amount } = depositRequest;

    try {
      const userAuthority = new PublicKey(publicKey);

      // Convert human amount to smallest units BN
      const amountInteger = Math.round(amount * 10 ** collateral.decimals);
      const amountBN = new BN(amountInteger);

      const collateralMint = new PublicKey(collateral.mint);

      // Find/Create ATA for collateral under the user's authority
      const userCollateralAta = getAssociatedTokenAddressSync(
        collateralMint,
        userAuthority,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Ensure ATA exists
      const payer = this.driftClient["wallet"].publicKey as PublicKey;
      const ataInfo = await this.connection.getAccountInfo(userCollateralAta);

      if (!ataInfo) {
        console.log("Creating ATA for user...");
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            payer, // fee payer
            userCollateralAta, // associated token address to create
            userAuthority, // owner of the ATA
            collateralMint
          )
        );

        await this.driftClient.txSender.send(tx, []);
        console.log("ATA created successfully");
      }

      // Check if user has a Drift account, create if not
      const programId = this.driftClient["program"].programId;
      const userAccountPubkey = await getUserAccountPublicKey(programId, userAuthority);
      const existingUserAccount = await this.connection.getAccountInfo(userAccountPubkey);

      if (!existingUserAccount) {
        console.log("User Drift account not found, creating...");
        if (!payer.equals(userAuthority)) {
          throw new Error("User must create their own Drift account first");
        }

        const [txSigUser, createdUserPk] = await this.driftClient.initializeUserAccount();
        console.log("Created Drift user account:", createdUserPk.toBase58(), txSigUser);
      }

      // Check if server wallet matches user authority
      if (!payer.equals(userAuthority)) {
        throw new Error("Deposit must be initiated by the wallet owner");
      }

      const txSig = await this.driftClient.deposit(
        amountBN,
        QUOTE_SPOT_MARKET_INDEX,
        userCollateralAta
      );

      console.log("Deposit tx signature:", txSig);
      return { success: true, txSig };
    } catch (error) {
      console.error("Deposit collateral error:", error);
      throw new Error("Failed to deposit collateral");
    }
  }

  async placeOrder(orderRequest: PerpetualOrderRequest): Promise<{ success: boolean; txSig: string }> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    const { marketIndex, direction, price, baseAssetAmount, orderType } = orderRequest;

    try {
      // Validate market & direction
      const positionDirection = direction === "long" ? PositionDirection.LONG : PositionDirection.SHORT;

      const market = this.driftClient.getPerpMarketAccount(marketIndex);
      if (!market) {
        throw new Error("Invalid market index");
      }

      // Convert amounts to BN
      const baseAssetAmountBN = new BN(
        Math.round(baseAssetAmount * Number(BASE_PRECISION.toString()))
      );

      let priceBN: BN | undefined;
      if (orderType === "limit" && price) {
        priceBN = new BN(
          Math.round(price * Number(PRICE_PRECISION.toString()))
        );
      }

      // Place the perp order
      const txSig = await this.driftClient.placePerpOrder({
        orderType: orderType === "market" ? OrderType.MARKET : OrderType.LIMIT,
        marketIndex,
        baseAssetAmount: baseAssetAmountBN,
        direction: positionDirection,
        price: priceBN,
      });

      console.log(`Order placed. Transaction signature: ${txSig}`);
      return { success: true, txSig };
    } catch (error) {
      console.error("Error placing order:", error);
      throw new Error("Failed to place order");
    }
  }

  async closePosition(marketIndex: number): Promise<{ success: boolean; txSig: string }> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    try {
      const user = this.driftClient.getUser();
      const position = user.getPerpPosition(marketIndex);

      if (!position || position.baseAssetAmount.isZero()) {
        throw new Error("No open position to close");
      }

      const txSig = await this.driftClient.closePosition(marketIndex);

      console.log(`Position closed. Transaction signature: ${txSig}`);
      return { success: true, txSig };
    } catch (error) {
      console.error("Error closing position:", error);
      throw new Error("Failed to close position");
    }
  }

  async getUserPositions(publicKey?: string): Promise<PerpetualPosition[]> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    try {
      const user = this.driftClient.getUser();
      const positions: PerpetualPosition[] = [];

      // Get all perp positions - iterate through all possible market indices
      const maxMarkets = 20; // Reasonable limit for market indices
      
      for (let i = 0; i < maxMarkets; i++) {
        const position = user.getPerpPosition(i);
        
        if (!position || position.baseAssetAmount.isZero()) {
          continue;
        }

        // Get market name from the market account
        const market = this.driftClient!.getPerpMarketAccount(position.marketIndex);
        const marketName = market ? String.fromCharCode(...market.name).replace(/\0/g, '') : `Market-${position.marketIndex}`;

        // Get current price
        const oraclePriceData = this.driftClient!.getOracleDataForPerpMarket(position.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        // Calculate position size and direction
        const baseAssetAmount = convertToNumber(position.baseAssetAmount, new BN(9));
        const isLong = baseAssetAmount > 0;
        const size = Math.abs(baseAssetAmount);
        
        // Calculate entry price
        const entryPrice = convertToNumber(position.lastCumulativeFundingRate, PRICE_PRECISION);
        
        // Calculate unrealized PnL
        const unrealizedPnl = convertToNumber(position.quoteAssetAmount, QUOTE_PRECISION);
        
        // Calculate margin
        const margin = convertToNumber(position.lastCumulativeFundingRate, QUOTE_PRECISION);

        positions.push({
          marketIndex: position.marketIndex,
          symbol: marketName,
          size,
          entryPrice,
          currentPrice,
          unrealizedPnl,
          margin,
          isLong
        });
      }

      return positions;
    } catch (error) {
      console.error("Error fetching user positions:", error);
      throw new Error("Failed to fetch user positions");
    }
  }

  async getUserBalance(publicKey?: string): Promise<number> {
    if (!this.driftClient) {
      throw new Error("PerpetualService not initialized");
    }

    try {
      const user = this.driftClient.getUser();
      
      // Get total collateral (converted to USDC equivalent)
      let totalUSDC = 0;
      
      try {
        const spotMarkets = this.driftClient.getSpotMarketAccounts();
        for (const spotMarket of spotMarkets) {
          const pos = this.driftClient.getSpotPosition ? this.driftClient.getSpotPosition(spotMarket.marketIndex) : null;
          if (pos && pos.scaledBalance && !pos.scaledBalance.isZero()) {
            const bal = convertToNumber(pos.scaledBalance, new BN(spotMarket.decimals));
            // Treat all as USDC-equivalent for a conservative estimate
            totalUSDC += bal;
          }
        }
      } catch (e) {
        console.warn("Error calculating spot balance:", e);
      }

      return totalUSDC;
    } catch (error) {
      console.error("Error fetching user balance:", error);
      throw new Error("Failed to fetch user balance");
    }
  }

  async disconnect() {
    if (this.driftClient) {
      try {
        await this.driftClient.unsubscribe();
        console.log("✅ PerpetualService disconnected");
      } catch (error) {
        console.error("Error disconnecting PerpetualService:", error);
      }
    }
  }
}

// Export singleton instance
export const perpetualService = new PerpetualService();