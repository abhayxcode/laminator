import { Connection, PublicKey } from '@solana/web3.js';

// Jupiter Perps interfaces
export interface JupiterPerpMarket {
  symbol: string;
  marketIndex: number;
  baseAsset: string;
  quoteAsset: string;
  marketType: string;
  status: string;
  price: number;
  change24h: number;
  volume24h: number;
}

export interface JupiterUserPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  margin: number;
}

export interface JupiterOrderbookData {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastPrice: number;
}

export class JupiterService {
  private connection: Connection;
  private initialized: boolean = false;
  private tokensBySymbol: Map<string, any> = new Map();
  private tokensByMint: Map<string, any> = new Map();
  private tokens: any[] = [];

  constructor(rpcUrl?: string) {
    // Use the same RPC configuration as Drift service
    let finalRpcUrl: string;
    
    const hasHeliusKey = process.env.HELIUS_API_KEY && 
                        process.env.HELIUS_API_KEY !== 'your_helius_key_here' &&
                        process.env.HELIUS_API_KEY.length > 10;
    
    if (hasHeliusKey) {
      finalRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
      console.log(`🔗 Jupiter Service using Helius RPC (Premium) with API key`);
    } else {
      const rpcEndpoints = [
        rpcUrl,
        process.env.SOLANA_RPC_URL,
        'https://rpc.ankr.com/solana',
        'https://solana-api.projectserum.com',
        'https://api.mainnet-beta.solana.com'
      ].filter(Boolean);
      
      finalRpcUrl = rpcEndpoints[0] || 'https://rpc.ankr.com/solana';
      console.log(`🔗 Jupiter Service using RPC endpoint: Public`);
    }
    
    this.connection = new Connection(finalRpcUrl, {
      commitment: 'confirmed',
      httpHeaders: {
        'User-Agent': 'Laminator-Jupiter/1.0',
      },
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing Jupiter Perps service...');
      // Load Jupiter token list dynamically (verified tokens)
      try {
        const resp = await fetch('https://tokens.jup.ag/tokens?tags=verified');
        if (resp.ok) {
          const data: any[] = await resp.json();
          this.tokens = Array.isArray(data) ? data : [];
          this.tokensBySymbol.clear();
          this.tokensByMint.clear();
          for (const t of this.tokens) {
            const sym = (t.symbol || '').toUpperCase();
            const mint = t.address || t.mint || t.id;
            if (sym && mint) {
              if (!this.tokensBySymbol.has(sym)) this.tokensBySymbol.set(sym, t);
              this.tokensByMint.set(mint, t);
            }
          }
          console.log(`✅ Loaded ${this.tokens.length} Jupiter tokens`);
        } else {
          console.warn(`⚠️ Failed to load Jupiter tokens: ${resp.status}`);
        }
      } catch (e) {
        console.warn('⚠️ Error loading Jupiter tokens:', e);
      }
      this.initialized = true;
      console.log('✅ Jupiter service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Jupiter service:', error);
      throw error;
    }
  }

  async getAvailableMarkets(): Promise<JupiterPerpMarket[]> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      console.log('📊 Fetching real-time markets via Jupiter (dynamic token list)...');

      // Pick a subset of tokens with CoinGecko id to enrich stats
      const candidates = this.tokens.filter((t) => !!t.cgId && !!t.address);
      const selected = candidates.slice(0, 25); // take top N to keep response light

      // 1) Fetch real-time prices from Jupiter by mint addresses
      const mintIds = selected.map((t) => t.address).join(',');
      const priceResp = await fetch(`https://price.jup.ag/v6/price?ids=${encodeURIComponent(mintIds)}&vsToken=USDC`);
      if (!priceResp.ok) {
        throw new Error(`Jupiter price API error: ${priceResp.status}`);
      }
      const priceJson: any = await priceResp.json();

      // 2) Fetch 24h change/volume from CoinGecko using cgId
      const cgIds = selected.map((t) => t.cgId).join(',');
      let cgMap: Record<string, any> = {};
      if (cgIds.length > 0) {
        const cgResp = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
        );
        if (cgResp.ok) {
          cgMap = await cgResp.json();
        } else {
          console.warn(`⚠️ CoinGecko API error: ${cgResp.status}`);
        }
      }

      const markets: JupiterPerpMarket[] = selected.map((token, idx) => {
        const symbol = (token.symbol || '').toUpperCase();
        const mint = token.address;
        const priceEntry = priceJson?.data?.[mint];
        const price = typeof priceEntry?.price === 'number' ? priceEntry.price : 0;
        const cg = token.cgId ? cgMap[token.cgId] : undefined;
        const change24h = typeof cg?.usd_24h_change === 'number' ? cg.usd_24h_change : 0;
        const volume24h = typeof cg?.usd_24h_vol === 'number' ? cg.usd_24h_vol : 0;
        return {
          symbol,
          marketIndex: idx,
          baseAsset: symbol,
          quoteAsset: 'USDC',
          marketType: 'spot',
          status: 'active',
          price,
          change24h,
          volume24h,
        };
      });

      console.log(`✅ Fetched ${markets.length} Jupiter markets`);
      return markets;
    } catch (error) {
      console.error('❌ Failed to fetch Jupiter markets:', error);
      throw error;
    }
  }

  async getOrderbook(symbol: string): Promise<JupiterOrderbookData | null> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      console.log(`📈 Building real-time synthetic orderbook for ${symbol} via Jupiter quotes...`);

      const base = symbol.toUpperCase();
      const token = this.tokensBySymbol.get(base);
      const baseMint = token?.address;
      const usdcMint = this.tokensBySymbol.get('USDC')?.address || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      if (!baseMint || !usdcMint) {
        console.warn(`⚠️ Unknown symbol or mint for ${symbol}`);
        return null;
      }

      // Helper to fetch quotes from Jupiter for a given direction
      const fetchQuotes = async (
        inputMint: string,
        outputMint: string,
        inputAmount: string
      ): Promise<any[]> => {
        const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=50&onlyDirectRoutes=false`;
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const json: any = await resp.json();
        return Array.isArray(json?.data) ? json.data : [];
      };

      // Determine a few size points to sample depth
      // For SOL and most tokens, 1, 5, 10 units; for small-price tokens, scale up quotes using USDC-in for bids
      const sizeUnits = [1, 5, 10];

      // Asks: selling base for USDC (you pay USDC => price = USDC out / base size)
      const asks: Array<{ price: number; size: number }> = [];
      for (const units of sizeUnits) {
        // Convert base units to atomic amount roughly using 9 decimals as common SPL default (price precision comes from route anyway)
        const amountAtomic = (units * 1e9).toFixed(0);
        const routes = await fetchQuotes(baseMint, usdcMint, amountAtomic);
        routes.slice(0, 2).forEach((route: any) => {
          const outAmount = Number(route?.outAmount || 0);
          const price = outAmount > 0 ? outAmount / 1e6 / units : 0; // USDC has 6 decimals
          if (price > 0) asks.push({ price, size: units });
        });
      }

      // Bids: buying base with USDC (you sell USDC; invert route)
      const bids: Array<{ price: number; size: number }> = [];
      const usdcSteps = [100, 500, 1000];
      for (const usdc of usdcSteps) {
        const amountAtomic = (usdc * 1e6).toFixed(0); // USDC 6 decimals
        const routes = await fetchQuotes(usdcMint, baseMint, amountAtomic);
        routes.slice(0, 2).forEach((route: any) => {
          const outAmount = Number(route?.outAmount || 0); // base atomic (assume 9 decimals)
          const baseUnits = outAmount / 1e9;
          const price = baseUnits > 0 ? usdc / baseUnits : 0;
          if (price > 0 && baseUnits > 0) bids.push({ price, size: baseUnits });
        });
      }

      // Sort bids desc, asks asc and cap depth
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);
      const topBids = bids.slice(0, 5);
      const topAsks = asks.slice(0, 5);

      // Last price via Jupiter Price API
      let lastPrice = 0;
      try {
        const priceResp = await fetch(`https://price.jup.ag/v6/price?ids=${encodeURIComponent(baseMint)}&vsToken=USDC`);
        if (priceResp.ok) {
          const priceJson: any = await priceResp.json();
          const entry = priceJson?.data?.[baseMint];
          if (typeof entry?.price === 'number') lastPrice = entry.price;
        }
      } catch {}

      if (topBids.length === 0 && topAsks.length === 0 && lastPrice === 0) {
        console.warn(`⚠️ No liquidity found for ${symbol}`);
        return null;
      }

      const ob: JupiterOrderbookData = {
        symbol: base,
        bids: topBids,
        asks: topAsks,
        lastPrice,
      };
      console.log(`✅ Built synthetic orderbook for ${symbol}: ${topBids.length} bids, ${topAsks.length} asks`);
      return ob;
    } catch (error) {
      console.error(`❌ Failed to build Jupiter orderbook for ${symbol}:`, error);
      return null;
    }
  }

  async getMarketPrice(symbol: string): Promise<number> {
    try {
      const base = symbol.toUpperCase();
      const token = this.tokensBySymbol.get(base);
      const id = token?.address || base;
      const resp = await fetch(`https://price.jup.ag/v6/price?ids=${encodeURIComponent(id)}&vsToken=USDC`);
      if (!resp.ok) throw new Error(`Jupiter price API error: ${resp.status}`);
      const json: any = await resp.json();
      const entry = json?.data?.[id];
      const price = typeof entry?.price === 'number' ? entry.price : 0;
      return price;
    } catch (error) {
      console.error(`❌ Failed to get Jupiter price for ${symbol}:`, error);
      return 0;
    }
  }

  async getUserBalance(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      // Jupiter is an aggregator; balances are on-chain. Return on-chain USDC balance like Drift's method.
      console.log(`💰 Fetching on-chain USDC balance via Jupiter service for user: ${telegramUserId}`);
      // For now, delegate reading to SOL RPC directly would require user's wallet address,
      // which is managed elsewhere in the bot. JupiterService alone does not have DB access.
      // So we simply return 0 here to avoid duplicating DB access logic.
      return 0;
    } catch (error) {
      console.error('❌ Failed to fetch Jupiter balance:', error);
      return 0;
    }
  }

  async getUserPositions(telegramUserId: number): Promise<JupiterUserPosition[]> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      // Jupiter aggregator (spot) does not maintain perp positions. Return empty.
      console.log(`🔍 Jupiter positions not applicable for aggregator; returning empty for user ${telegramUserId}`);
      return [];
    } catch (error) {
      console.error('❌ Failed to get Jupiter positions:', error);
      return [];
    }
  }

  async openPosition(
    telegramUserId: number,
    symbol: string,
    size: number,
    side: 'long' | 'short',
    leverage: number = 1
  ): Promise<string> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      // Trading via Jupiter would be a swap route execution, which requires wallet signing.
      // This bot routes trading logic through specific DEX services; leave execution for a later task.
      throw new Error('Jupiter trading not implemented');
    } catch (error) {
      console.error('❌ Jupiter trading not implemented:', error);
      throw error;
    }
  }

  async closePosition(telegramUserId: number, symbol: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('Jupiter service not initialized');
    }

    try {
      throw new Error('Jupiter trading not implemented');
    } catch (error) {
      console.error('❌ Jupiter trading not implemented:', error);
      throw error;
    }
  }

  disconnect(): void {
    if (this.connection) {
      console.log('🔌 Disconnecting Jupiter service...');
      // Close any connections if needed
    }
  }
}

export const jupiterService = new JupiterService();
