import { DriftService } from './driftService';
import { JupiterService } from './jupiterService';
import { jupiterPerpsService } from './jupiterPerpsService';
import { flashService } from './flashService';
import { volumeService } from './volumeService';

export interface DEXInfo {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  marketsCount: number;
  volume24h: number;
}

export interface UnifiedMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  change24h: number;
  volume24h: number;
  dexName: string;
  dexId: string;
  marketType: string;
  status: string;
}

export interface UnifiedPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  margin: number;
  dexName: string;
  dexId: string;
}

export interface UnifiedOrderbook {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastPrice: number;
  dexName: string;
  dexId: string;
}

export class DEXManager {
  private driftService: DriftService;
  private jupiterService: JupiterService;
  private initialized: boolean = false;
  private marketsCache: Map<string, UnifiedMarket[]> = new Map();
  private marketsCacheTime: Map<string, number> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.driftService = new DriftService();
    this.jupiterService = new JupiterService();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing DEX Manager...');
      await Promise.all([
        this.driftService.initialize(),
        this.jupiterService.initialize(),
        (async () => { try { await flashService.initialize(); } catch (e:any) { console.warn('⚠️ Flash init failed:', e?.message || e); } })(),
        (async () => { try { await volumeService.getDexVolumes(); } catch {} })(),
      ]);
      this.initialized = true;
      console.log('✅ DEX Manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize DEX Manager:', error);
      throw error;
    }
  }

  // Real-time on-chain wallet balances (via Solana RPC)
  async getWalletUsdcBalance(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    return await this.driftService.getUserBalance(telegramUserId);
  }

  async getWalletSolBalance(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    return await this.driftService.getOnchainSolBalance(telegramUserId);
  }

  async getDexCollateral(dexId: string, telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      switch (dexId.toLowerCase()) {
        case 'drift':
          return await this.driftService.getDriftCollateralUSDC(telegramUserId);
        case 'jupiter':
          return 0;
        case 'flash':
          return 0;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
    } catch (error) {
      console.error(`❌ Failed to get collateral for ${dexId}:`, error);
      return 0;
    }
  }

  async getAvailableDEXs(): Promise<DEXInfo[]> {
    const vols = await volumeService.getDexVolumes().catch(() => ({ drift: { total24hUsd: 0 }, flash: { total24hUsd: 0 }, jupiter: { total24hUsd: 0 } } as any));
    return [
      {
        id: 'drift',
        name: 'Drift Protocol',
        description: 'Leading Solana perpetuals exchange with 50x leverage',
        isActive: true,
        marketsCount: 79,
        volume24h: vols.drift?.total24hUsd || 0,
      },
      {
        id: 'jupiter',
        name: 'Jupiter Perps',
        description: 'On-chain perps via Anchor (oracle pricing)',
        isActive: true,
        marketsCount: 5,
        volume24h: vols.jupiter?.total24hUsd || 0,
      },
      {
        id: 'flash',
        name: 'Flash Perps',
        description: 'Flash Trade perpetuals (oracle-based, swap-aware)',
        isActive: true,
        marketsCount: 10,
        volume24h: vols.flash?.total24hUsd || 0,
      },
    ];
  }

  async getMarketsForDEX(dexId: string): Promise<UnifiedMarket[]> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }

    const dexIdLower = dexId.toLowerCase();

    // Check cache first
    const now = Date.now();
    const cachedMarkets = this.marketsCache.get(dexIdLower);
    const cacheTime = this.marketsCacheTime.get(dexIdLower) || 0;

    if (cachedMarkets && (now - cacheTime) < this.CACHE_DURATION) {
      console.log(`📦 Using cached markets for ${dexId} (${cachedMarkets.length} markets, age: ${Math.floor((now - cacheTime) / 1000)}s)`);
      return cachedMarkets;
    }

    try {
      let markets: any[] = [];
      switch (dexIdLower) {
        case 'drift':
          console.log('📊 Fetching Drift Protocol markets...');
          const driftMarkets = await this.driftService.getAvailableMarkets();
          markets = driftMarkets.map(market => ({
            ...market,
            dexName: 'Drift Protocol',
            dexId: 'drift',
          }));
          break;
        case 'jupiter':
          console.log('📊 Fetching Jupiter Perps markets (on-chain)...');
          const perpsMarkets = await jupiterPerpsService.getAvailableMarkets();
          markets = perpsMarkets.map((m: any, idx: number) => ({
            symbol: m.symbol,
            baseAsset: m.symbol,
            quoteAsset: 'USDC',
            price: m.oraclePrice || 0,
            change24h: 0,
            volume24h: 0,
            dexName: 'Jupiter Perps',
            dexId: 'jupiter',
            marketType: 'perp',
            status: 'active',
          }));
          break;
        case 'flash':
          console.log('📊 Fetching Flash Perps markets (SDK)...');
          const flashMkts = await flashService.getMarkets();
          markets = flashMkts.map(m => ({
            symbol: m.symbol,
            baseAsset: m.symbol,
            quoteAsset: 'USDC',
            price: m.price,
            change24h: 0,
            volume24h: 0,
            dexName: 'Flash Perps',
            dexId: 'flash',
            marketType: 'perp',
            status: 'active',
          }));
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }

      // Cache the results
      this.marketsCache.set(dexIdLower, markets);
      this.marketsCacheTime.set(dexIdLower, now);

      console.log(`✅ Fetched and cached ${markets.length} markets for ${dexId}`);
      return markets;
    } catch (error) {
      console.error(`❌ Failed to get markets for ${dexId}:`, error);

      // If we have stale cache, return it
      if (cachedMarkets) {
        console.warn(`⚠️ Returning stale cached markets for ${dexId} due to error`);
        return cachedMarkets;
      }

      throw error;
    }
  }

  async getOrderbookForDEX(dexId: string, symbol: string): Promise<UnifiedOrderbook | null> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      let orderbook: any = null;
      switch (dexId.toLowerCase()) {
        case 'drift':
          console.log(`📈 Fetching Drift orderbook for ${symbol}...`);
          orderbook = await this.driftService.getOrderbook(symbol);
          if (orderbook) {
            orderbook.dexName = 'Drift Protocol';
            orderbook.dexId = 'drift';
          }
          break;
        case 'jupiter':
          console.log(`📈 Fetching Jupiter Perps mid-price for ${symbol} (oracle)...`);
          const mid = await jupiterPerpsService.getMidPriceBySymbol(symbol);
          if (mid) {
            orderbook = {
              symbol: mid.symbol,
              bids: [],
              asks: [],
              lastPrice: mid.midPrice,
              dexName: 'Jupiter Perps',
              dexId: 'jupiter',
            };
          }
          break;
        case 'flash':
          console.log(`📈 Fetching Flash synthetic orderbook for ${symbol}...`);
          const sob = await flashService.getSyntheticOrderbook(symbol);
          if (sob) {
            orderbook = { ...sob, dexName: 'Flash Perps', dexId: 'flash' };
          }
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
      return orderbook;
    } catch (error) {
      console.error(`❌ Failed to get orderbook for ${dexId}:`, error);
      return null;
    }
  }

  async getUserBalanceForDEX(dexId: string, telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      let balance = 0;
      switch (dexId.toLowerCase()) {
        case 'drift':
          balance = await this.driftService.getUserBalance(telegramUserId);
          break;
        case 'jupiter':
          balance = await this.jupiterService.getUserBalance(telegramUserId);
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
      return balance;
    } catch (error) {
      console.error(`❌ Failed to get balance for ${dexId}:`, error);
      throw error;
    }
  }

  async getUserPositionsForDEX(dexId: string, telegramUserId: number): Promise<UnifiedPosition[]> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      let positions: any[] = [];
      switch (dexId.toLowerCase()) {
        case 'drift':
          const driftPositions = await this.driftService.getUserPositions(telegramUserId);
          positions = driftPositions.map(pos => ({
            ...pos,
            dexName: 'Drift Protocol',
            dexId: 'drift',
          }));
          break;
        case 'jupiter':
          const jupiterPositions = await this.jupiterService.getUserPositions(telegramUserId);
          positions = jupiterPositions.map(pos => ({
            ...pos,
            dexName: 'Jupiter Perps',
            dexId: 'jupiter',
          }));
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
      return positions;
    } catch (error) {
      console.error(`❌ Failed to get positions for ${dexId}:`, error);
      throw error;
    }
  }

  async openPositionForDEX(
    dexId: string,
    telegramUserId: number,
    symbol: string,
    size: number,
    side: 'long' | 'short',
    leverage: number = 1
  ): Promise<string> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      let signature = '';
      switch (dexId.toLowerCase()) {
        case 'drift':
          signature = await this.driftService.openPosition(telegramUserId, symbol, size, side, leverage);
          break;
        case 'jupiter':
          signature = await this.jupiterService.openPosition(telegramUserId, symbol, size, side, leverage);
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
      return signature;
    } catch (error) {
      console.error(`❌ Failed to open position for ${dexId}:`, error);
      throw error;
    }
  }

  async closePositionForDEX(dexId: string, telegramUserId: number, symbol: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('DEX Manager not initialized');
    }
    try {
      let signature = '';
      switch (dexId.toLowerCase()) {
        case 'drift':
          signature = await this.driftService.closePosition(telegramUserId, symbol);
          break;
        case 'jupiter':
          signature = await this.jupiterService.closePosition(telegramUserId, symbol);
          break;
        default:
          throw new Error(`Unknown DEX: ${dexId}`);
      }
      return signature;
    } catch (error) {
      console.error(`❌ Failed to close position for ${dexId}:`, error);
      throw error;
    }
  }

  disconnect(): void {
    console.log('🔌 Disconnecting DEX Manager...');
    this.driftService.disconnect();
    this.jupiterService.disconnect();
  }
}

export const dexManager = new DEXManager();
