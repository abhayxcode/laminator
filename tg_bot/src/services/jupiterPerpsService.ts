import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getPythProgramKeyForCluster, PriceData, PythHttpClient } from '@pythnetwork/client';
import { IDL as DovesIDL, type Doves } from '../idl/doves-idl';

// Constants
const DOVES_PROGRAM_ID = new PublicKey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');

// Known Jupiter Perps custody -> DOVES oracle (priceFeed) mapping copied from the parsing package
// These are DOVES priceFeed public keys (not raw Pyth accounts)
const DOVES_ORACLES: Array<{ symbol: string; priceFeed: PublicKey; custody: PublicKey }>= [
  { symbol: 'SOL', priceFeed: new PublicKey('39cWjvHrpHNz2SbXv6ME4NPhqBDBd4KsjUYv5JkHEAJU'), custody: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz') },
  { symbol: 'ETH', priceFeed: new PublicKey('5URYohbPy32nxK1t3jAHVNfdWY2xTubHiFvLrE3VhXEp'), custody: new PublicKey('AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn') },
  { symbol: 'BTC', priceFeed: new PublicKey('4HBbPx9QJdjJ7GUe6bsiJjGybvfpDhQMMPXP1UEa7VT5'), custody: new PublicKey('5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm') },
  { symbol: 'USDC', priceFeed: new PublicKey('A28T5pKtscnhDo6C1Sz786Tup88aTjt8uyKewjVvPrGk'), custody: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa') },
  { symbol: 'USDT', priceFeed: new PublicKey('AGW7q2a3WxCzh5TB2Q6yNde1Nf41g3HLaaXdybz7cbBU'), custody: new PublicKey('4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk') },
];

interface MarketInfo {
  symbol: string;
  custody: string;
  oraclePrice?: number;
}

function bnToNumberWithExpo(value: BN, expo: number): number {
  // expo is i8; price is u64 integer scaled by 10^expo (expo usually negative)
  const scale = Math.pow(10, Math.abs(expo));
  return expo >= 0 ? value.toNumber() * scale : value.toNumber() / scale;
}

async function readPythPrice(connection: Connection, pythFeedPk: PublicKey): Promise<number | null> {
  try {
    const pythClient = new PythHttpClient(connection, getPythProgramKeyForCluster('mainnet-beta'));
    const data = await pythClient.getData();
    const product = data.products.find((p) => p.priceAccountKey === pythFeedPk.toBase58());
    if (!product) return null;
    const price: PriceData | undefined = data.productPrice.get(product.symbol);
    if (!price || price.price === undefined || !isFinite(price.price)) return null;
    return Number(price.price);
  } catch (e) {
    return null;
  }
}

class JupiterPerpsServiceImpl {
  private connection: Connection;
  private dovesProgram: Program<Doves> | null = null;
  private initialized = false;

  constructor() {
    const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpc, 'confirmed');
  }

  async initialize(): Promise<void> {
    // Placeholder wallet for AnchorProvider initialization only (read-only operations)
    const provider = new AnchorProvider(this.connection, new Wallet(Keypair.generate()), AnchorProvider.defaultOptions());
    this.dovesProgram = new Program<Doves>(DovesIDL as any, DOVES_PROGRAM_ID, provider);
    this.initialized = true;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized && this.dovesProgram) return;
    try {
      // Placeholder wallet for AnchorProvider initialization only (read-only operations)
      const provider = new AnchorProvider(this.connection, new Wallet(Keypair.generate()), AnchorProvider.defaultOptions());
      this.dovesProgram = new Program<Doves>(DovesIDL as any, DOVES_PROGRAM_ID, provider);
      this.initialized = true;
    } catch (e) {
      // leave uninitialized; callers can attempt a one-off construction
      console.warn('DOVES program init failed:', (e as any)?.message || e);
    }
  }

  async getCustodyData(custodyPk: string) {
    this.ensureInit();
    // Treat the provided key as a DOVES agPriceFeed directly when possible
    const maybeAgPk = new PublicKey(custodyPk);
    const ag = await this.dovesProgram!.account.agPriceFeed.fetch(maybeAgPk).catch(() => null) as any;
    if (!ag) {
      throw new Error('Provided key is not a DOVES agPriceFeed. Full custody decoding requires Jupiter Perps IDL.');
    }
    const agPrice = bnToNumberWithExpo(new BN(ag.price.toString()), ag.expo);
    let oraclePrice = agPrice;
    if (!isFinite(oraclePrice) || oraclePrice === 0) {
      const pythPk = new PublicKey(ag.pythFeed);
      const pythPrice = await readPythPrice(this.connection, pythPk);
      if (pythPrice !== null && isFinite(pythPrice)) oraclePrice = pythPrice;
    }
    return { oracle: { oracleAccount: maybeAgPk.toBase58() }, oraclePrice, mint: ag.mint, decimals: undefined };
  }

  async getAvailableMarkets(): Promise<MarketInfo[]> {
    await this.ensureInit();
    let program = this.dovesProgram;
    if (!program) {
      // Placeholder wallet for AnchorProvider initialization only (read-only operations)
      const provider = new AnchorProvider(this.connection, new Wallet(Keypair.generate()), AnchorProvider.defaultOptions());
      program = new Program<Doves>(DovesIDL as any, DOVES_PROGRAM_ID, provider);
    }
    const priceFeedPubkeys = DOVES_ORACLES.map((o) => o.priceFeed);
    const feeds = await program.account.priceFeed.fetchMultiple(priceFeedPubkeys);
    const out: MarketInfo[] = [];
    for (let i = 0; i < DOVES_ORACLES.length; i++) {
      const cfg = DOVES_ORACLES[i];
      const feed = feeds[i] as any;
      if (!feed) continue;
      const price = bnToNumberWithExpo(new BN(feed.price.toString()), feed.expo);
      out.push({ symbol: cfg.symbol, custody: cfg.custody.toBase58(), oraclePrice: price });
    }
    return out;
  }

  async getOpenPositionsForWallet(_owner: string) {
    await this.ensureInit();
    // TODO: implement when position accounts are finalized; return empty to avoid mock
    return [] as any[];
  }

  async getUserPositions(_owner: string) {
    await this.ensureInit();
    return [] as any[];
  }

  async getMidPriceBySymbol(symbol: string): Promise<{ symbol: string; custody: string; midPrice: number } | null> {
    const markets = await this.getAvailableMarkets();
    const m = markets.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
    if (!m || !m.oraclePrice || !isFinite(m.oraclePrice)) return null;
    return { symbol: m.symbol, custody: m.custody, midPrice: m.oraclePrice };
  }

  async getMidPriceForCustody(custodyPk: string): Promise<{ symbol: string; custody: string; midPrice: number } | null> {
    // Treat provided key as DOVES agPriceFeed and return price
    try {
      const ag = await this.dovesProgram!.account.agPriceFeed.fetch(new PublicKey(custodyPk)) as any;
      const agPrice = bnToNumberWithExpo(new BN(ag.price.toString()), ag.expo);
      let price = agPrice;
      if (!isFinite(price) || price === 0) {
        const pythPk = new PublicKey(ag.pythFeed);
        const p = await readPythPrice(this.connection, pythPk);
        if (p !== null && isFinite(p)) price = p;
      }
      const mintStr: string = ag.mint?.toString?.() || String(ag.mint);
      const short = mintStr.slice(0, 4);
      return { symbol: short, custody: custodyPk, midPrice: price };
    } catch (e) {
      return null;
    }
  }

  async getInfoBySymbol(symbol: string): Promise<{
    symbol: string;
    custody: string;
    price: number;
    source: 'DOVES' | 'PYTH';
    ageSec: number;
    oracleAccount: string;
  } | null> {
    await this.ensureInit();
    let program = this.dovesProgram;
    if (!program) {
      // Placeholder wallet for AnchorProvider initialization only (read-only operations)
      const provider = new AnchorProvider(this.connection, new Wallet(Keypair.generate()), AnchorProvider.defaultOptions());
      program = new Program<Doves>(DovesIDL as any, DOVES_PROGRAM_ID, provider);
    }
    const entry = DOVES_ORACLES.find((o) => o.symbol.toUpperCase() === symbol.toUpperCase());
    if (!entry) return null;
    const feed = await (program as any).account.priceFeed.fetch(entry.priceFeed).catch(() => null) as any;
    if (!feed) return null;
    const price = bnToNumberWithExpo(new BN(feed.price.toString()), feed.expo);
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = (feed.timestamp?.toNumber?.() ?? Number(feed.timestamp)) || 0;
    const ageSec = Math.max(0, nowSec - ts);
    return {
      symbol: entry.symbol,
      custody: entry.custody.toBase58(),
      price,
      source: 'DOVES',
      ageSec,
      oracleAccount: entry.priceFeed.toBase58(),
    };
  }

  resolveCustodyBySymbol(symbol: string): { custody: string } | null {
    const entry = DOVES_ORACLES.find((o) => o.symbol.toUpperCase() === symbol.toUpperCase());
    if (!entry) return null;
    return { custody: entry.custody.toBase58() };
  }

  async getLimitPriceBySymbol(symbol: string, slippageBps: number): Promise<number | null> {
    const info = await this.getInfoBySymbol(symbol);
    if (!info) return null;
    const slip = Math.max(0, slippageBps) / 10_000;
    // For buys (long), use price * (1 + slip); for sells (short), caller can choose direction
    // Here we return mid with slip up; handler will adjust per side if needed
    return info.price * (1 + slip);
  }
}

export const jupiterPerpsService = new JupiterPerpsServiceImpl();


