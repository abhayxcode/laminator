import { AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import { Connection, ComputeBudgetProgram, Keypair } from '@solana/web3.js';
import { PerpetualsClient, PoolConfig, Side } from 'flash-sdk';
import { PriceData, PythHttpClient, getPythProgramKeyForCluster } from '@pythnetwork/client';

export interface FlashMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
}

export interface FlashOrderbook {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastPrice: number;
}

export class FlashService {
  private provider!: AnchorProvider;
  private client!: PerpetualsClient;
  private poolConfig!: ReturnType<typeof PoolConfig.fromIdsByName>;
  private pythClient!: PythHttpClient;
  private initialized = false;

  async initialize(): Promise<void> {
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const pythnetUrl = process.env.PYTHNET_URL || 'https://pythnet.rpcpool.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    // Use an in-memory wallet to avoid requiring ANCHOR_WALLET for read-only ops
    const wallet = new Wallet(Keypair.generate());
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'processed', preflightCommitment: 'processed', skipPreflight: true,
    });
    this.poolConfig = PoolConfig.fromIdsByName('Crypto.1', 'mainnet-beta');
    this.client = new PerpetualsClient(
      this.provider,
      this.poolConfig.programId,
      this.poolConfig.perpComposibilityProgramId,
      this.poolConfig.fbNftRewardProgramId,
      this.poolConfig.rewardDistributionProgram.programId,
      { prioritizationFee: 0 }
    );
    this.pythClient = new PythHttpClient(new Connection(pythnetUrl), getPythProgramKeyForCluster('mainnet-beta'));
    this.initialized = true;
  }

  private ensureInit() {
    if (!this.initialized) throw new Error('Flash service not initialized');
  }

  async getMarkets(): Promise<FlashMarket[]> {
    this.ensureInit();
    // Use Pyth to fetch prices
    const data = await this.pythClient.getData();
    const out: FlashMarket[] = [];
    for (const t of this.poolConfig.tokens as Array<{ symbol: string; pythTicker: string }>) {
      const price: PriceData | undefined = data.productPrice.get(t.pythTicker);
      const px = price ? Number(price.price) : 0;
      out.push({ symbol: t.symbol, baseAsset: t.symbol, quoteAsset: 'USDC', price: px });
    }
    return out;
  }

  async getSyntheticOrderbook(symbol: string): Promise<FlashOrderbook | null> {
    this.ensureInit();
    const data = await this.pythClient.getData();
    const token = (this.poolConfig.tokens as Array<{ symbol: string; pythTicker: string }>).find((t: { symbol: string; pythTicker: string }) => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (!token) return null;
    const price: PriceData | undefined = data.productPrice.get(token.pythTicker);
    const mid = price ? Number(price.price) : 0;
    if (!mid || !isFinite(mid)) return null;
    // Sample sizes to synthesize depth (no CLOB)
    const sizes = [0.1, 0.5, 1, 2, 5];
    const bids = sizes.map(s => ({ price: mid * (1 - 0.002), size: s }));
    const asks = sizes.map(s => ({ price: mid * (1 + 0.002), size: s }));
    return { symbol: token.symbol, bids, asks, lastPrice: mid };
  }
}

export const flashService = new FlashService();


