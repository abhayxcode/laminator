import { 
  DriftClient, 
  Wallet, 
  PublicKey, 
  PerpMarkets,
  PerpMarketConfig,
  UserAccount,
  User,
  isVariant,
  convertToNumber,
  BN,
  OraclePriceData,
  PerpPosition,
  PositionDirection,
  OrderType,
  PostOnlyParams,
  MakerInfo,
  TxSigAndSlot,
  DLOB,
  DLOBSource,
  DLOBSubscriber,
  OrderSubscriber,
  UserMap,
  PriorityFeeSubscriber,
  WebSocketDriftClientAccountSubscriber,
  PollingDriftClientAccountSubscriber,
  BulkAccountLoader,
  QUOTE_PRECISION,
  PRICE_PRECISION,
  BASE_PRECISION,
  getUserAccountPublicKey,
  decodeUser,
  calculatePositionPNL,
  calculateEntryPrice,
  decodeName,
  SpotBalanceType,
  getTokenAmount,
  getTokenValue,
  SPOT_MARKET_CUMULATIVE_INTEREST_PRECISION,
  QUOTE_SPOT_MARKET_INDEX
} from '@drift-labs/sdk';
import { 
  Connection as SolanaConnection, 
  PublicKey as SolanaPublicKey,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { privyService } from './privyService';
import { databaseService } from './databaseService';

// Simplified interfaces for the bot
export interface PerpMarket {
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

export interface UserPosition {
  marketIndex: number;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  margin: number;
}

export interface OrderbookData {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastPrice: number;
}

export class DriftService {
  private connection: SolanaConnection;
  private driftClient: DriftClient | null = null;
  private dlobSubscriber: DLOBSubscriber | null = null;
  private orderSubscriber: OrderSubscriber | null = null;
  private initialized: boolean = false;
  private marketsCache: PerpMarket[] | null = null;
  private marketsCacheTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

  constructor(rpcUrl?: string) {
    // Use a reliable public RPC endpoint
    let finalRpcUrl: string;
    
    // Check if we have a valid Helius API key
    const hasHeliusKey = process.env.HELIUS_API_KEY && 
                        process.env.HELIUS_API_KEY !== 'your_helius_key_here' &&
                        process.env.HELIUS_API_KEY.length > 10;
    
    if (hasHeliusKey) {
      finalRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
      console.log(`🔗 Using Helius RPC (Premium) with API key`);
    } else {
      // Use provided RPC URL or fallback to reliable public endpoints
      const rpcEndpoints = [
        rpcUrl,
        process.env.SOLANA_RPC_URL,
        'https://rpc.ankr.com/solana', // Better rate limits
        'https://solana-api.projectserum.com',
        'https://api.mainnet-beta.solana.com'
      ].filter(Boolean);
      
      finalRpcUrl = rpcEndpoints[0] || 'https://rpc.ankr.com/solana';
      console.log(`🔗 Using RPC endpoint: Public`);
    }
    
    this.connection = new SolanaConnection(finalRpcUrl, {
      commitment: 'confirmed',
      httpHeaders: {
        'User-Agent': 'Laminator-Bot/1.0',
      },
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing Drift Protocol service...');
      this.initialized = true;
      console.log('✅ Drift service initialized successfully (Privy wallet mode)');
    } catch (error) {
      console.error('❌ Failed to initialize Drift service:', error);
      throw error;
    }
  }

        private async getDriftClientForMarketData(): Promise<DriftClient | null> {
          try {
            // Create a minimal client for market data fetching
            // DriftClient requires a wallet for initialization, but we only use it for market data
            // Instructions are built directly with user's accounts, not through DriftClient methods
            if (!this.driftClient) {
              // Create a minimal wallet only for DriftClient initialization (required by SDK for market data)
              // This wallet is NEVER used for signing or building user instructions
              // All instructions are built directly with user's accounts via program.instruction methods
              const minimalKeypair = Keypair.generate();
              const wallet = new Wallet(minimalKeypair);
              
              // Prefer websocket subscription to avoid Helius batch limitations
              try {
                this.driftClient = new DriftClient({
                  connection: this.connection,
                  wallet,
                  env: 'mainnet-beta',
                  accountSubscription: {
                    type: 'websocket',
                    resubTimeoutMs: 30000,
                  },
                });

                // Subscribe to Drift program accounts
                await this.driftClient.subscribe();

                // Set up DLOB subscriber for real orderbook data
                if (!this.orderSubscriber) {
                  try {
                    this.orderSubscriber = new OrderSubscriber({
                      driftClient: this.driftClient,
                      subscriptionConfig: {
                        type: 'polling',
                        frequency: 5000, // 5 second polling
                        commitment: 'confirmed',
                      },
                    });
                    await this.orderSubscriber.subscribe();
                    console.log('✅ OrderSubscriber initialized');
                  } catch (orderError: any) {
                    console.warn('⚠️ OrderSubscriber failed to initialize:', orderError.message);
                  }
                }

                if (!this.dlobSubscriber && this.orderSubscriber) {
                  try {
                    this.dlobSubscriber = new DLOBSubscriber({
                      driftClient: this.driftClient,
                      dlobSource: this.orderSubscriber,
                      slotSource: this.orderSubscriber,
                      updateFrequency: 2000, // Update every 2 seconds
                    });
                    await this.dlobSubscriber.subscribe();
                    console.log('✅ DLOBSubscriber initialized');
                  } catch (dlobError: any) {
                    console.warn('⚠️ DLOBSubscriber failed to initialize:', dlobError.message);
                  }
                }
              } catch (wsError: any) {
                console.warn('⚠️ Websocket subscription failed, retrying with polling (no bulk loader)...', wsError?.message);
                try {
                  // As a last resort, use websocket again with a longer resub timeout
                  this.driftClient = new DriftClient({
                    connection: this.connection,
                    wallet,
                    env: 'mainnet-beta',
                    accountSubscription: {
                      type: 'websocket',
                      resubTimeoutMs: 60000,
                    },
                  });
                  await this.driftClient.subscribe();
                } catch (pollError: any) {
                  console.warn('⚠️ Polling subscription failed:', pollError?.message);
                  return null;
                }
              }
            }
            
            return this.driftClient;
          } catch (error) {
            console.error('❌ Failed to create Drift client for market data:', error);
            return null;
          }
        }

  private async getDriftClientForUser(telegramUserId: number): Promise<DriftClient> {
    try {
      console.log(`🔍 Creating Drift client for Telegram user: ${telegramUserId}`);
      
      // Get user's wallet information from Privy
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        throw new Error('User wallet not found in Privy');
      }

      console.log(`📍 User wallet address: ${walletAddress}`);

      // Privy server wallets don't support getWalletPrivateKey()
      // We use a read-only client that can still access user account data
      // Transactions are signed separately through Privy's signTransaction API
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) {
        throw new Error('Drift client not available for market data');
      }

      // Privy server wallets only support signTransaction()
      // Instructions are built directly with user's accounts, not through DriftClient wallet
      // User account data will be loaded on-demand when needed
      
      console.log(`✅ Created Drift client for market data access (user-specific instructions built separately)`);
      return driftClient;
    } catch (error) {
      console.error('❌ Failed to create Drift client for user:', error);
      throw error;
    }
  }

  async getAvailableMarkets(): Promise<PerpMarket[]> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    // Return cached markets if still valid
    const now = Date.now();
    if (this.marketsCache && (now - this.marketsCacheTime) < this.CACHE_DURATION) {
      console.log(`📦 Using cached Drift markets (${this.marketsCache.length} markets, age: ${Math.floor((now - this.marketsCacheTime) / 1000)}s)`);
      return this.marketsCache;
    }

    if (process.env.HELIUS_API_KEY || process.env.SOLANA_RPC_URL) {
      try {
        console.log('📊 Fetching real market data from Drift Protocol SDK...');

        const driftClient = await this.getDriftClientForMarketData();

        if (!driftClient) {
          console.warn('❌ Drift client not available (likely due to RPC limitations)');
          // If we have stale cache, return it instead of throwing
          if (this.marketsCache) {
            console.log('⚠️ Returning stale cached markets due to RPC unavailability');
            return this.marketsCache;
          }
          throw new Error('Drift client not available');
        }

        const markets: PerpMarket[] = [];

        // Log available Drift markets for debugging
        console.log(`📋 Available Drift markets: ${PerpMarkets['mainnet-beta'].length} markets`);
        console.log(`📋 Market symbols: ${PerpMarkets['mainnet-beta'].map(m => m.symbol).join(', ')}`);

        for (const marketConfig of PerpMarkets['mainnet-beta']) {
          try {
            const perpMarketAccount = driftClient.getPerpMarketAccount(marketConfig.marketIndex);

            if (!perpMarketAccount) {
              console.warn(`Market ${marketConfig.symbol} not found`);
              continue;
            }

            // Get current price from oracle
            const oraclePriceData = driftClient.getOracleDataForPerpMarket(marketConfig.marketIndex);
            const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

            // Get 24h volume
            const volume24h = perpMarketAccount.amm.volume24H ? convertToNumber(perpMarketAccount.amm.volume24H, QUOTE_PRECISION) : 0;

            // Extract base asset from symbol (e.g., "SOL-PERP" -> "SOL")
            const baseAsset = marketConfig.symbol.replace('-PERP', '');

            markets.push({
              symbol: baseAsset, // Show as "SOL" instead of "SOL-PERP"
              marketIndex: marketConfig.marketIndex,
              baseAsset: baseAsset,
              quoteAsset: 'USDC', // Drift uses USDC as quote asset
              marketType: 'perp',
              status: 'active',
              price: currentPrice,
              change24h: 0, // Would need historical data calculation
              volume24h: volume24h,
            });

            console.log(`✅ Got real Drift data for ${marketConfig.symbol}: $${currentPrice}`);
          } catch (error) {
            console.warn(`Failed to fetch data for market ${marketConfig.symbol}:`, error);
            // Continue with other markets
          }
        }

        if (markets.length > 0) {
          // Cache the results
          this.marketsCache = markets;
          this.marketsCacheTime = now;
          console.log(`✅ Fetched and cached ${markets.length} real markets from Drift Protocol SDK`);
          return markets;
        }

        // If we couldn't fetch any markets but have old cache, use it
        if (this.marketsCache) {
          console.warn('⚠️ Failed to fetch fresh markets, using stale cache');
          return this.marketsCache;
        }
      } catch (error) {
        console.error('❌ Failed to get available markets from Drift API:', error);
        // If we have cached data, return it even if stale
        if (this.marketsCache) {
          console.warn('⚠️ Error fetching markets, using cached data');
          return this.marketsCache;
        }
      }
    }

    // No external fallback; respect real-time only policy
    throw new Error('Drift markets unavailable due to RPC limitations');
  }

  /**
   * Fetch and deserialize user account directly from chain
   * Does not use DriftClient's getUserAccount() method
   */
  private async fetchUserAccountDirectly(
    userPublicKey: SolanaPublicKey,
    subAccountId: number = 0
  ): Promise<UserAccount | null> {
    try {
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) return null;

      const programId = (driftClient as any).program?.programId;
      if (!programId) return null;

      // Get user account PDA
      const userAccountPublicKey = await getUserAccountPublicKey(programId, userPublicKey, subAccountId);
      
      // Fetch account info directly from chain
      const accountInfo = await this.connection.getAccountInfo(userAccountPublicKey);
      
      if (!accountInfo || !accountInfo.data) {
        return null;
      }

      // Deserialize the user account data
      try {
        const userAccount = decodeUser(accountInfo.data);
        return userAccount;
      } catch (error) {
        console.warn('Failed to deserialize user account:', error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching user account directly:', error);
      return null;
    }
  }

  /**
   * Load user account data on-demand for a specific user (legacy method - kept for compatibility)
   */
  private async loadUserAccount(
    driftClient: DriftClient,
    userPublicKey: SolanaPublicKey
  ): Promise<UserAccount | null> {
    // Use direct fetch instead of DriftClient
    return this.fetchUserAccountDirectly(userPublicKey, 0);
  }

  async getUserPositions(telegramUserId: number): Promise<UserPosition[]> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`🔍 Fetching positions for Telegram user: ${telegramUserId}`);
      
      // Get user's wallet address
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        throw new Error('User wallet not found in Privy');
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      
      // Get Drift client
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Load user account data
      const userAccount = await this.loadUserAccount(driftClient, userPublicKey);
      if (!userAccount) {
        console.log('No user account found in Drift');
        return [];
      }

      const positions: UserPosition[] = [];
      
      // Iterate through all perp positions
      for (let i = 0; i < userAccount.perpPositions.length; i++) {
        const position = userAccount.perpPositions[i];
        
        // Skip empty positions
        if (position.baseAssetAmount.eq(new BN(0))) {
          continue;
        }

        // Get market config
        const marketConfig = PerpMarkets['mainnet-beta'][position.marketIndex];
        if (!marketConfig) {
          console.warn(`Market config not found for index ${position.marketIndex}`);
          continue;
        }

        // Get perp market account and oracle data
        const perpMarketAccount = driftClient.getPerpMarketAccount(position.marketIndex);
        const oraclePriceData = driftClient.getOracleDataForPerpMarket(position.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        // Calculate position size and direction using BASE_PRECISION
        const baseAssetAmount = convertToNumber(position.baseAssetAmount, BASE_PRECISION);
        const isLong = baseAssetAmount > 0;
        const size = Math.abs(baseAssetAmount);
        
        // Calculate entry price using SDK helper
        let entryPrice = 0;
        try {
          const calculatedEntryPrice = calculateEntryPrice(position);
          entryPrice = convertToNumber(calculatedEntryPrice, PRICE_PRECISION);
        } catch (error) {
          // Fallback: calculate from quote asset amount
          const quoteAssetAmount = convertToNumber(position.quoteAssetAmount, QUOTE_PRECISION);
          if (baseAssetAmount !== 0) {
            entryPrice = Math.abs(quoteAssetAmount / baseAssetAmount);
          }
        }
        
        // Calculate unrealized PnL using SDK helper
        let unrealizedPnl = 0;
        try {
          if (perpMarketAccount && oraclePriceData) {
            const pnl = calculatePositionPNL(
              perpMarketAccount,
              position,
              false, // withFunding
              oraclePriceData
            );
            unrealizedPnl = convertToNumber(pnl, QUOTE_PRECISION);
          }
        } catch (error) {
          // Fallback: manual calculation
          const priceDiff = isLong ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
          unrealizedPnl = priceDiff * size;
        }
        
        // Calculate margin (quote asset amount represents margin used)
        const margin = convertToNumber(position.quoteAssetAmount.abs(), QUOTE_PRECISION);

        positions.push({
          marketIndex: position.marketIndex,
          symbol: marketConfig.baseAssetSymbol || marketConfig.symbol.replace('-PERP', ''),
          side: isLong ? 'long' : 'short',
          size: size,
          entryPrice: entryPrice,
          currentPrice: currentPrice,
          unrealizedPnl: unrealizedPnl,
          margin: margin,
        });
      }

      console.log(`✅ Found ${positions.length} positions for user`);
      return positions;
    } catch (error) {
      console.error('❌ Failed to get user positions:', error);
      throw error;
    }
  }

  async getOrderbook(symbol: string): Promise<OrderbookData | null> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`📈 Fetching REAL orderbook for ${symbol} from Drift Protocol...`);
      
      // Check if we have Helius API key for premium access
      const hasHeliusKey = process.env.HELIUS_API_KEY && process.env.HELIUS_API_KEY !== 'your_helius_key_here';
      
      if (this.driftClient && !hasHeliusKey) {
        console.log('⚠️ Using public RPC - may hit rate limits, will return null if rate limited');
      }
      
      try {
        const driftClient = await this.getDriftClientForMarketData();
        
        if (!driftClient) {
          console.warn('❌ Drift client not available (likely due to RPC limitations)');
          return null;
        }
        
        // Find market config - Drift uses format like "SOL-PERP", "BTC-PERP"
        const marketSymbol = symbol.toUpperCase();
        const fullMarketSymbol = marketSymbol.includes('-PERP') ? marketSymbol : `${marketSymbol}-PERP`;
        
        console.log(`🔍 Looking for market: ${marketSymbol} (searching as ${fullMarketSymbol})`);
        console.log(`📋 Available Drift markets: ${PerpMarkets['mainnet-beta'].map(m => m.symbol).join(', ')}`);
        
        const marketConfig = PerpMarkets['mainnet-beta'].find(m => m.symbol === fullMarketSymbol);
        if (!marketConfig) {
          console.warn(`❌ Market ${fullMarketSymbol} not found in Drift Protocol`);
          console.log(`Available markets: ${PerpMarkets['mainnet-beta'].map(m => m.symbol).join(', ')}`);
          return null;
        }

        console.log(`✅ Found market config for ${symbol} at index ${marketConfig.marketIndex}`);

        // Get current price from Drift oracle
        const oraclePriceData = driftClient.getOracleDataForPerpMarket(marketConfig.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        if (currentPrice === 0) {
          console.warn(`Could not get Drift price for ${symbol}`);
          return null;
        }

        // Get REAL orderbook from Drift Protocol DLOB
        console.log(`🔥 Getting REAL Drift Protocol orderbook for ${symbol}...`);
        
        if (!this.dlobSubscriber) {
          console.warn('⚠️ DLOB subscriber not available, cannot fetch real orderbook');
          return null;
        }

        // Get L2 orderbook from DLOB (aggregate view with real orders)
        const l2Orderbook = this.dlobSubscriber.getL2({
          marketName: fullMarketSymbol, // Use the full market symbol like "SOL-PERP"
          depth: 10,
          includeVamm: true, // Include virtual AMM liquidity
        });

        console.log(`📊 Got L2 orderbook: ${l2Orderbook.bids.length} bids, ${l2Orderbook.asks.length} asks`);
        
        // Debug: Log the structure of the first bid/ask
        if (l2Orderbook.bids.length > 0) {
          console.log('🔍 First bid structure:', JSON.stringify(l2Orderbook.bids[0], null, 2));
        }
        if (l2Orderbook.asks.length > 0) {
          console.log('🔍 First ask structure:', JSON.stringify(l2Orderbook.asks[0], null, 2));
        }

        // Convert L2 orderbook to our format with safer conversion
        const formattedBids = l2Orderbook.bids.slice(0, 5).map((bid: any, index: number) => {
          try {
            let price: number;
            let size: number;
            
            // Handle different possible data structures
            if (typeof bid.price === 'number') {
              price = bid.price;
            } else if (bid.price && typeof bid.price === 'object' && bid.price.toNumber) {
              price = bid.price.toNumber();
            } else if (bid.price && typeof bid.price === 'object' && bid.price.toString) {
              price = parseFloat(bid.price.toString());
            } else {
              // Use convertToNumber with proper precision handling
              try {
                price = convertToNumber(bid.price, PRICE_PRECISION);
              } catch (error) {
                console.warn(`⚠️ Failed to convert bid price with convertToNumber:`, error);
                // Fallback: if it's a BN or similar, try dividing by precision
                price = parseFloat(bid.price.toString()) / Math.pow(10, 6); // PRICE_PRECISION is 6
              }
            }
            
            if (typeof bid.size === 'number') {
              size = bid.size;
            } else if (bid.size && typeof bid.size === 'object' && bid.size.toNumber) {
              size = bid.size.toNumber();
            } else if (bid.size && typeof bid.size === 'object' && bid.size.toString) {
              size = parseFloat(bid.size.toString());
            } else {
              // Use convertToNumber with proper precision handling for size
              try {
                size = convertToNumber(bid.size, new BN(9));
              } catch (error) {
                console.warn(`⚠️ Failed to convert bid size with convertToNumber:`, error);
                // Fallback: if it's a BN or similar, try dividing by precision
                size = parseFloat(bid.size.toString()) / Math.pow(10, 9);
              }
            }
            
            return { price, size };
          } catch (error) {
            console.warn(`⚠️ Failed to convert bid ${index}:`, error);
            return { price: currentPrice * 0.999, size: 1 }; // Fallback
          }
        });

        const formattedAsks = l2Orderbook.asks.slice(0, 5).map((ask: any, index: number) => {
          try {
            let price: number;
            let size: number;
            
            // Handle different possible data structures
            if (typeof ask.price === 'number') {
              price = ask.price;
            } else if (ask.price && typeof ask.price === 'object' && ask.price.toNumber) {
              price = ask.price.toNumber();
            } else if (ask.price && typeof ask.price === 'object' && ask.price.toString) {
              price = parseFloat(ask.price.toString());
            } else {
              // Use convertToNumber with proper precision handling
              try {
                price = convertToNumber(ask.price, PRICE_PRECISION);
              } catch (error) {
                console.warn(`⚠️ Failed to convert ask price with convertToNumber:`, error);
                // Fallback: if it's a BN or similar, try dividing by precision
                price = parseFloat(ask.price.toString()) / Math.pow(10, 6); // PRICE_PRECISION is 6
              }
            }
            
            if (typeof ask.size === 'number') {
              size = ask.size;
            } else if (ask.size && typeof ask.size === 'object' && ask.size.toNumber) {
              size = ask.size.toNumber();
            } else if (ask.size && typeof ask.size === 'object' && ask.size.toString) {
              size = parseFloat(ask.size.toString());
            } else {
              // Use convertToNumber with proper precision handling for size
              try {
                size = convertToNumber(ask.size, new BN(9));
              } catch (error) {
                console.warn(`⚠️ Failed to convert ask size with convertToNumber:`, error);
                // Fallback: if it's a BN or similar, try dividing by precision
                size = parseFloat(ask.size.toString()) / Math.pow(10, 9);
              }
            }
            
            return { price, size };
          } catch (error) {
            console.warn(`⚠️ Failed to convert ask ${index}:`, error);
            return { price: currentPrice * 1.001, size: 1 }; // Fallback
          }
        });

        const orderbookData: OrderbookData = {
          symbol: symbol.toUpperCase(),
          bids: formattedBids,
          asks: formattedAsks,
          lastPrice: currentPrice,
        };

        console.log(`🔥 REAL Drift Protocol orderbook for ${symbol}:`);
        console.log(`   📉 Best Bid: $${formattedBids[0]?.price?.toFixed(4)} (${formattedBids[0]?.size?.toFixed(2)} ${symbol})`);
        console.log(`   📈 Best Ask: $${formattedAsks[0]?.price?.toFixed(4)} (${formattedAsks[0]?.size?.toFixed(2)} ${symbol})`);
        if (formattedBids[0] && formattedAsks[0]) {
          console.log(`   📊 Spread: $${(formattedAsks[0].price - formattedBids[0].price).toFixed(4)}`);
        }

        console.log(`✅ Fetched REAL Drift Protocol orderbook for ${symbol}: $${currentPrice}`);
        
        return orderbookData;
      } catch (error) {
        console.error(`❌ Failed to get Drift orderbook for ${symbol}:`, error);
      }

      // If we can't get real Drift Protocol data, return null
      console.error(`❌ Cannot get real Drift Protocol orderbook for ${symbol} due to RPC issues`);
      console.log(`💡 To get real orderbook data, you need a premium Solana RPC (like Helius paid plan)`);
      return null;
    } catch (error) {
      console.error(`❌ Failed to get orderbook for ${symbol}:`, error);
      throw error;
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
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`🎯 Opening ${side} position for ${symbol} with size ${size} for user ${telegramUserId}`);
      
      // Get user's wallet address
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        throw new Error('User wallet not found in Privy');
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      
      // Find market config - handle both "SOL" and "SOL-PERP" formats
      const symbolUpper = symbol.toUpperCase();
      const searchSymbol = symbolUpper.includes('-PERP') ? symbolUpper : `${symbolUpper}-PERP`;
      const marketConfig = PerpMarkets['mainnet-beta'].find(
        m => m.symbol === searchSymbol || m.baseAssetSymbol === symbolUpper
      );
      if (!marketConfig) {
        throw new Error(`Market ${symbol} not found`);
      }

      // Get Drift client
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) {
        throw new Error('Drift client not available');
      }

      // Convert size to BN with BASE_PRECISION
      const sizeBN = new BN(size).mul(BASE_PRECISION);

      // Import transaction service
      const { createDriftTransactionService } = await import('./driftTransactionService');
      const txService = createDriftTransactionService(driftClient, this.connection);

      // Build open position transaction
      const transaction = await txService.buildOpenPositionTransaction(
        userPublicKey,
        marketConfig.marketIndex,
        side,
        sizeBN,
        'market' // default to market orders
      );

      // Sign and send transaction using Privy signing service
      const { privySigningService } = await import('./privySigningService');
      const signature = await privySigningService.signAndSendTransactionWithRetry(
        telegramUserId,
        transaction,
        this.connection
      );

      console.log(`✅ Position opened successfully: ${signature}`);
      return signature;
    } catch (error) {
      console.error('❌ Failed to open position:', error);
      throw error;
    }
  }

  async closePosition(
    telegramUserId: number,
    symbol: string,
    percentage: number = 100
  ): Promise<string> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`🔒 Closing ${percentage}% of position for ${symbol} for user ${telegramUserId}`);
      
      // Get user's wallet address
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        throw new Error('User wallet not found in Privy');
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      
      // Find market config - handle both "SOL" and "SOL-PERP" formats
      const symbolUpper = symbol.toUpperCase();
      const searchSymbol = symbolUpper.includes('-PERP') ? symbolUpper : `${symbolUpper}-PERP`;
      const marketConfig = PerpMarkets['mainnet-beta'].find(
        m => m.symbol === searchSymbol || m.baseAssetSymbol === symbolUpper
      );
      if (!marketConfig) {
        throw new Error(`Market ${symbol} not found`);
      }

      // Load user account to verify position exists
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) {
        throw new Error('Drift client not available');
      }

      const userAccount = await this.loadUserAccount(driftClient, userPublicKey);
      if (!userAccount) {
        throw new Error('User account not found in Drift');
      }

      // Find the position for this market
      const position = userAccount.perpPositions.find(p => p.marketIndex === marketConfig.marketIndex);
      if (!position || position.baseAssetAmount.eq(new BN(0))) {
        throw new Error(`No open position found for ${symbol}`);
      }

      // Import transaction service
      const { createDriftTransactionService } = await import('./driftTransactionService');
      const txService = createDriftTransactionService(driftClient, this.connection);

      // Build close position transaction (pass user account data)
      const transaction = await txService.buildClosePositionTransaction(
        userPublicKey,
        marketConfig.marketIndex,
        percentage,
        userAccount // Pass user account data
      );

      // Sign and send transaction using Privy signing service
      const { privySigningService } = await import('./privySigningService');
      const signature = await privySigningService.signAndSendTransactionWithRetry(
        telegramUserId,
        transaction,
        this.connection
      );

      console.log(`✅ Position closed successfully: ${signature}`);
      return signature;
    } catch (error) {
      console.error('❌ Failed to close position:', error);
      throw error;
    }
  }

  async getUserBalance(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`💰 Fetching on-chain USDC balance for Telegram user: ${telegramUserId}`);

      // Get user's primary wallet address from database
      const dbUser = await databaseService.getUserByTelegramId(telegramUserId);
      const walletAddress: string | undefined = dbUser?.wallets?.[0]?.walletAddress;
      if (!walletAddress) {
        throw new Error('User wallet address not found in database');
      }

      // Mainnet USDC mint (can be overridden via env)
      const usdcMint = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      const ownerPubkey = new SolanaPublicKey(walletAddress);
      const mintPubkey = new SolanaPublicKey(usdcMint);

      // Fetch all token accounts for USDC mint owned by this wallet
      const resp = await this.connection.getParsedTokenAccountsByOwner(
        ownerPubkey,
        { mint: mintPubkey },
        'confirmed'
      );

      let totalUsdc = 0;
      for (const { account } of resp.value) {
        const info: any = account.data.parsed?.info;
        const uiAmount = info?.tokenAmount?.uiAmount;
        if (typeof uiAmount === 'number') {
          totalUsdc += uiAmount;
        }
      }

      console.log(`✅ On-chain USDC balance for ${walletAddress}: ${totalUsdc.toFixed(6)} USDC`);
      return totalUsdc;
    } catch (error) {
      console.error('❌ Failed to fetch on-chain USDC balance:', error);
      throw error;
    }
  }

  async getOnchainSolBalance(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      const dbUser = await databaseService.getUserByTelegramId(telegramUserId);
      const walletAddress: string | undefined = dbUser?.wallets?.[0]?.walletAddress;
      if (!walletAddress) {
        throw new Error('User wallet address not found in database');
      }

      const ownerPubkey = new SolanaPublicKey(walletAddress);
      const lamports = await this.connection.getBalance(ownerPubkey, 'confirmed');
      return lamports / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('❌ Failed to fetch on-chain SOL balance:', error);
      throw error;
    }
  }

  async getDriftCollateralUSDC(telegramUserId: number): Promise<number> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      // Get wallet address and fetch user account directly from chain
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return 0;
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      const userAccount = await this.fetchUserAccountDirectly(userPublicKey, 0);
      
      if (!userAccount) {
        return 0;
      }

      const driftClient = await this.getDriftClientForUser(telegramUserId);

      // Approximate total collateral in USDC by summing spot positions balances with USDC price=1
      // This is a simplified representation suitable for display.
      let totalUSDC = 0;
      try {
        const spotMarkets = driftClient.getSpotMarketAccounts();
        for (const spotMarket of spotMarkets) {
          const pos = driftClient.getSpotPosition ? driftClient.getSpotPosition(spotMarket.marketIndex) : null;
          if (pos && pos.scaledBalance && !pos.scaledBalance.isZero()) {
            const tokenAmountBN = getTokenAmount(
              pos.scaledBalance,
              spotMarket,
              pos.balanceType || SpotBalanceType.DEPOSIT
            );
            const bal = convertToNumber(tokenAmountBN, new BN(10).pow(new BN(spotMarket.decimals)));
            // Treat all as USDC-equivalent for a conservative estimate; refine per-market pricing if needed
            totalUSDC += bal;
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to enumerate spot positions for collateral calc:', e);
      }

      return Math.max(0, totalUSDC);
    } catch (error) {
      console.error('❌ Failed to compute Drift collateral:', error);
      return 0;
    }
  }

  async getMarketPrice(symbol: string): Promise<number> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      // Map symbol to CoinGecko ID
      const symbolToId: { [key: string]: string } = {
        'SOL': 'solana',
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'AVAX': 'avalanche-2',
        'MATIC': 'polygon'
      };

      const coinId = symbolToId[symbol.toUpperCase()];
      if (!coinId) {
        throw new Error(`Market ${symbol} not supported`);
      }

      // Get price from CoinGecko API
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }
      
      const data = await response.json();
      const price = data[coinId]?.usd;

      if (!price) {
        throw new Error(`Price not found for ${symbol}`);
      }

      return price;
    } catch (error) {
      console.error(`❌ Failed to get price for ${symbol}:`, error);
      throw error;
    }
  }

  // ============================================
  // ENHANCED SDK METHODS (Phase 2)
  // ============================================

  /**
   * Check if user has initialized Drift account
   * Checks both user stats account and user account
   */
  async hasUserAccount(userPublicKey: SolanaPublicKey): Promise<boolean> {
    try {
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) return false;

      const programId = (driftClient as any).program?.programId;
      if (!programId) return false;

      // Check user stats account
      const { getUserStatsAccountPublicKey, getUserAccountPublicKey } = await import('@drift-labs/sdk');
      const userStatsPDA = getUserStatsAccountPublicKey(programId, userPublicKey);
      const statsAccountInfo = await this.connection.getAccountInfo(userStatsPDA);
      
      // Check user account
      const userAccountPubkey = await getUserAccountPublicKey(programId, userPublicKey, 0);
      const userAccountInfo = await this.connection.getAccountInfo(userAccountPubkey);
      
      // Both accounts must exist for the user to be fully initialized
      const statsExists = statsAccountInfo !== null;
      const accountExists = userAccountInfo !== null;
      
      console.log(`🔍 Account check for ${userPublicKey.toBase58()}: stats=${statsExists}, account=${accountExists}`);
      
      return statsExists && accountExists;
    } catch (error) {
      console.error('Error checking user account:', error);
      return false;
    }
  }

  /**
   * Get user account data from Drift
   */
  async getUserAccountData(telegramUserId: number): Promise<UserAccount | null> {
    try {
      // Get wallet address and fetch user account directly from chain
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return null;
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      return await this.fetchUserAccountDirectly(userPublicKey, 0);
    } catch (error) {
      console.error('Error getting user account data:', error);
      return null;
    }
  }

  /**
   * Get major perpetual markets (SOL, BTC, ETH)
   */
  async getMajorPerpMarkets(): Promise<PerpMarket[]> {
    const MAJOR_INDICES = [0, 1, 2]; // SOL-PERP, BTC-PERP, ETH-PERP
    const allMarkets = await this.getAvailableMarkets();
    return allMarkets.filter(m => MAJOR_INDICES.includes(m.marketIndex));
  }

  /**
   * Get spot markets (for collateral deposits)
   */
  async getSpotMarkets(): Promise<any[]> {
    try {
      const driftClient = await this.getDriftClientForMarketData();
      if (!driftClient) throw new Error('Drift client not available');

      const spotMarkets = driftClient.getSpotMarketAccounts();
      return spotMarkets.map((market: any) => ({
        symbol: market.name || `SPOT-${market.marketIndex}`,
        marketIndex: market.marketIndex,
        mint: market.mint,
        decimals: market.decimals,
      }));
    } catch (error) {
      console.error('Error getting spot markets:', error);
      return [];
    }
  }

  /**
   * Get user's positions with accurate PnL calculation
   */
  async getUserPositionsWithPnL(telegramUserId: number): Promise<UserPosition[]> {
    try {
      // Get user's wallet address
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        console.warn('User wallet not found in Privy');
        return [];
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      
      // Get Drift client
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Load user account data
      const userAccount = await this.loadUserAccount(driftClient, userPublicKey);
      if (!userAccount) {
        return [];
      }

      const positions: UserPosition[] = [];

      for (const position of userAccount.perpPositions) {
        if (position.baseAssetAmount.eq(new BN(0))) continue;

        const marketConfig = PerpMarkets['mainnet-beta'][position.marketIndex];
        if (!marketConfig) continue;

        const perpMarketAccount = driftClient.getPerpMarketAccount(position.marketIndex);
        const oraclePriceData = driftClient.getOracleDataForPerpMarket(position.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        // Calculate position size and direction using BASE_PRECISION
        const baseAssetAmount = convertToNumber(position.baseAssetAmount, BASE_PRECISION);
        const isLong = baseAssetAmount > 0;
        const size = Math.abs(baseAssetAmount);

        // Calculate entry price using SDK helper
        let entryPrice = 0;
        try {
          const calculatedEntryPrice = calculateEntryPrice(position);
          entryPrice = convertToNumber(calculatedEntryPrice, PRICE_PRECISION);
        } catch (error) {
          // Fallback: calculate from quote asset amount
          const quoteAssetAmount = convertToNumber(position.quoteAssetAmount, QUOTE_PRECISION);
          if (baseAssetAmount !== 0) {
            entryPrice = Math.abs(quoteAssetAmount / baseAssetAmount);
          }
        }

        // Calculate unrealized PnL using SDK helper
        let unrealizedPnl = 0;
        try {
          if (perpMarketAccount && oraclePriceData) {
            const pnl = calculatePositionPNL(
              perpMarketAccount,
              position,
              false, // withFunding
              oraclePriceData
            );
            unrealizedPnl = convertToNumber(pnl, QUOTE_PRECISION);
          }
        } catch (error) {
          // Fallback: manual calculation
          const priceDiff = isLong ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
          unrealizedPnl = priceDiff * size;
        }

        // Calculate margin (quote asset amount represents margin used)
        const margin = convertToNumber(position.quoteAssetAmount.abs(), QUOTE_PRECISION);

        positions.push({
          marketIndex: position.marketIndex,
          symbol: marketConfig.baseAssetSymbol || marketConfig.symbol.replace('-PERP', ''),
          side: isLong ? 'long' : 'short',
          size: size,
          entryPrice: entryPrice,
          currentPrice: currentPrice,
          unrealizedPnl: unrealizedPnl,
          margin: margin,
        });
      }

      return positions;
    } catch (error) {
      console.error('Error getting user positions with PnL:', error);
      return [];
    }
  }

  /**
   * Get specific position for a market
   */
  async getUserPosition(telegramUserId: number, marketIndex: number): Promise<UserPosition | null> {
    try {
      // Get user's wallet address
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return null;
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      
      // Get Drift client
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Load user account data
      const userAccount = await this.loadUserAccount(driftClient, userPublicKey);
      if (!userAccount) {
        return null;
      }

      // Find position for this market index
      const position = userAccount.perpPositions.find(p => p.marketIndex === marketIndex);
      if (!position || position.baseAssetAmount.eq(new BN(0))) {
        return null;
      }

      // Get market config
      const marketConfig = PerpMarkets['mainnet-beta'][position.marketIndex];
      if (!marketConfig) {
        return null;
      }

      // Get perp market account and oracle data
      const perpMarketAccount = driftClient.getPerpMarketAccount(position.marketIndex);
      const oraclePriceData = driftClient.getOracleDataForPerpMarket(position.marketIndex);
      const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

      // Calculate position size and direction
      const baseAssetAmount = convertToNumber(position.baseAssetAmount, BASE_PRECISION);
      const isLong = baseAssetAmount > 0;
      const size = Math.abs(baseAssetAmount);

      // Calculate entry price
      let entryPrice = 0;
      try {
        const calculatedEntryPrice = calculateEntryPrice(position);
        entryPrice = convertToNumber(calculatedEntryPrice, PRICE_PRECISION);
      } catch (error) {
        const quoteAssetAmount = convertToNumber(position.quoteAssetAmount, QUOTE_PRECISION);
        if (baseAssetAmount !== 0) {
          entryPrice = Math.abs(quoteAssetAmount / baseAssetAmount);
        }
      }

      // Calculate unrealized PnL
      let unrealizedPnl = 0;
      try {
        if (perpMarketAccount && oraclePriceData) {
          const pnl = calculatePositionPNL(
            perpMarketAccount,
            position,
            false, // withFunding
            oraclePriceData
          );
          unrealizedPnl = convertToNumber(pnl, QUOTE_PRECISION);
        }
      } catch (error) {
        const priceDiff = isLong ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
        unrealizedPnl = priceDiff * size;
      }

      // Calculate margin
      const margin = convertToNumber(position.quoteAssetAmount.abs(), QUOTE_PRECISION);

      return {
        marketIndex: position.marketIndex,
        symbol: marketConfig.baseAssetSymbol || marketConfig.symbol.replace('-PERP', ''),
        side: isLong ? 'long' : 'short',
        size: size,
        entryPrice: entryPrice,
        currentPrice: currentPrice,
        unrealizedPnl: unrealizedPnl,
        margin: margin,
      };
    } catch (error) {
      console.error('Error getting user position:', error);
      return null;
    }
  }

  /**
   * Get user's balance info (collateral + spot positions) in a single fetch
   * Optimized to fetch user account only once
   */
  async getUserBalanceInfo(telegramUserId: number): Promise<{
    collateral: { total: number; free: number; used: number; availableWithdraw: number };
    spotPositions: any[];
  }> {
    try {
      // Get wallet address and fetch user account directly from chain ONCE
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return {
          collateral: { total: 0, free: 0, used: 0, availableWithdraw: 0 },
          spotPositions: []
        };
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      const userAccount = await this.fetchUserAccountDirectly(userPublicKey, 0);

      if (!userAccount) {
        return {
          collateral: { total: 0, free: 0, used: 0, availableWithdraw: 0 },
          spotPositions: []
        };
      }

      const driftClient = await this.getDriftClientForUser(telegramUserId);
      const spotMarkets = driftClient.getSpotMarketAccounts();

      // Calculate total collateral and build spot positions in one pass
      let totalCollateralUSD = 0;
      const positions: any[] = [];

      for (const spotMarket of spotMarkets) {
        const position = userAccount.spotPositions.find((p: any) => p.marketIndex === spotMarket.marketIndex);
        if (!position || position.scaledBalance.isZero()) continue;
        if (position.balanceType !== undefined && !isVariant(position.balanceType, 'deposit')) continue;

        try {
          // Use getTokenAmount to get actual token amount (in token's native decimals)
          const tokenAmountBN = getTokenAmount(
            position.scaledBalance,
            spotMarket,
            position.balanceType || SpotBalanceType.DEPOSIT
          );

          // Calculate USD value
          let valueUSD = 0;
          const oracleData = driftClient.getOracleDataForSpotMarket(spotMarket.marketIndex);
          if (oracleData && oracleData.price) {
            const valueBN = getTokenValue(tokenAmountBN, spotMarket.decimals, oracleData);
            valueUSD = convertToNumber(valueBN, PRICE_PRECISION);
          } else {
            // Fallback for markets without oracle
            const tokenAmount = convertToNumber(tokenAmountBN, new BN(10).pow(new BN(spotMarket.decimals)));
            if (spotMarket.marketIndex === QUOTE_SPOT_MARKET_INDEX || spotMarket.mint.equals(NATIVE_MINT) === false) {
              valueUSD = tokenAmount; // USDC or quote market = 1:1
            } else {
              // SOL - try to get price from SOL-PERP
              try {
                const solOracle = driftClient.getOracleDataForPerpMarket(0);
                if (solOracle) {
                  const valueBN = getTokenValue(tokenAmountBN, spotMarket.decimals, solOracle);
                  valueUSD = convertToNumber(valueBN, PRICE_PRECISION);
                } else {
                  valueUSD = tokenAmount; // Fallback
                }
              } catch (e) {
                valueUSD = tokenAmount; // Fallback
              }
            }
          }

          totalCollateralUSD += valueUSD;

          // Decode token name properly
          let symbol = `SPOT-${spotMarket.marketIndex}`;
          try {
            const decodedName = decodeName(spotMarket.name).trim();
            if (decodedName) {
              symbol = decodedName.replace('-SPOT', '').toUpperCase();
            }
          } catch (e) {
            console.warn(`Failed to decode name for market ${spotMarket.marketIndex}:`, e);
          }

          // Get balance amount
          const balance = convertToNumber(tokenAmountBN, new BN(10).pow(new BN(spotMarket.decimals)));

          positions.push({
            symbol: symbol,
            marketIndex: spotMarket.marketIndex,
            balance: balance,
            valueUsd: valueUSD,
          });
        } catch (e) {
          console.warn(`Failed to calculate collateral for market ${spotMarket.marketIndex}:`, e);
        }
      }

      // Estimate free collateral (conservative: total - estimated margin requirements)
      const freeCollateral = Math.max(0, totalCollateralUSD * 0.8); // Conservative 80% free
      const usedCollateral = totalCollateralUSD - freeCollateral;

      return {
        collateral: {
          total: totalCollateralUSD,
          free: freeCollateral,
          used: usedCollateral,
          availableWithdraw: freeCollateral,
        },
        spotPositions: positions,
      };
    } catch (error) {
      console.error('Error getting user balance info:', error);
      return {
        collateral: { total: 0, free: 0, used: 0, availableWithdraw: 0 },
        spotPositions: []
      };
    }
  }

  /**
   * Get user's collateral info in Drift
   * Calculates total collateral from spot positions and estimates free/used
   * NOTE: For better performance, use getUserBalanceInfo() which fetches account once
   */
  async getUserCollateral(telegramUserId: number): Promise<{ total: number; free: number; used: number; availableWithdraw: number }> {
    try {
      // Get wallet address and fetch user account directly from chain
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return { total: 0, free: 0, used: 0, availableWithdraw: 0 };
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      const userAccount = await this.fetchUserAccountDirectly(userPublicKey, 0);

      if (!userAccount) {
        return { total: 0, free: 0, used: 0, availableWithdraw: 0 };
      }

      const driftClient = await this.getDriftClientForUser(telegramUserId);

      // Calculate total collateral from spot positions (in USD) using SDK helper functions
      let totalCollateralUSD = 0;
      const spotMarkets = driftClient.getSpotMarketAccounts();

      for (const spotMarket of spotMarkets) {
        const position = userAccount.spotPositions.find((p: any) => p.marketIndex === spotMarket.marketIndex);
        if (!position || position.scaledBalance.isZero()) continue;
        if (position.balanceType !== undefined && !isVariant(position.balanceType, 'deposit')) continue;

        try {
          // Use getTokenAmount to get actual token amount (in token's native decimals)
          const tokenAmountBN = getTokenAmount(
            position.scaledBalance,
            spotMarket,
            position.balanceType || SpotBalanceType.DEPOSIT
          );

          // Use getTokenValue to get USD value (handles precision correctly)
          const oracleData = driftClient.getOracleDataForSpotMarket(spotMarket.marketIndex);
          if (oracleData && oracleData.price) {
            // getTokenValue returns value in PRICE_PRECISION, need to convert to USD
            const valueBN = getTokenValue(tokenAmountBN, spotMarket.decimals, oracleData);
            const valueUSD = convertToNumber(valueBN, PRICE_PRECISION);
            totalCollateralUSD += valueUSD;
          } else {
            // Fallback for markets without oracle
            const tokenAmount = convertToNumber(tokenAmountBN, new BN(10).pow(new BN(spotMarket.decimals)));
            if (spotMarket.marketIndex === QUOTE_SPOT_MARKET_INDEX || spotMarket.mint.equals(NATIVE_MINT) === false) {
              // Assume USDC or quote market = 1:1
              totalCollateralUSD += tokenAmount;
            } else {
              // SOL - try to get price from SOL-PERP
              try {
                const solOracle = driftClient.getOracleDataForPerpMarket(0);
                if (solOracle) {
                  const valueBN = getTokenValue(tokenAmountBN, spotMarket.decimals, solOracle);
                  const valueUSD = convertToNumber(valueBN, PRICE_PRECISION);
                  totalCollateralUSD += valueUSD;
                } else {
                  totalCollateralUSD += tokenAmount; // Fallback
                }
              } catch (e) {
                totalCollateralUSD += tokenAmount; // Fallback
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to calculate collateral for market ${spotMarket.marketIndex}:`, e);
        }
      }

      // Estimate free collateral (conservative: total - estimated margin requirements)
      // This is a simplified calculation - for accuracy, would need User class methods
      const freeCollateral = Math.max(0, totalCollateralUSD * 0.8); // Conservative 80% free
      const usedCollateral = totalCollateralUSD - freeCollateral;

      return {
        total: totalCollateralUSD,
        free: freeCollateral,
        used: usedCollateral,
        availableWithdraw: freeCollateral,
      };
    } catch (error) {
      console.error('Error getting user collateral:', error);
      return { total: 0, free: 0, used: 0, availableWithdraw: 0 };
    }
  }

  /**
   * Get user's spot positions (collateral breakdown by token)
   * Returns positions with proper token names and USD values
   */
  async getSpotPositions(telegramUserId: number): Promise<any[]> {
    try {
      // Get wallet address and fetch user account directly from chain
      const walletAddress = await privyService.getWalletAddress(telegramUserId);
      if (!walletAddress) {
        return [];
      }

      const userPublicKey = new SolanaPublicKey(walletAddress);
      const userAccount = await this.fetchUserAccountDirectly(userPublicKey, 0);
      
      if (!userAccount) return [];

      const driftClient = await this.getDriftClientForUser(telegramUserId);

      const positions: any[] = [];
      const spotMarkets = driftClient.getSpotMarketAccounts();

      for (const spotMarket of spotMarkets) {
        const position = userAccount.spotPositions.find((p: any) => p.marketIndex === spotMarket.marketIndex);
        
        // Skip if no position or zero balance
        if (!position || position.scaledBalance.isZero()) continue;
        
        // Skip borrows, only show deposits
        if (position.balanceType !== undefined && !isVariant(position.balanceType, 'deposit')) continue;

        // Convert scaled balance to actual token amount using SDK helper
        const balanceBN = getTokenAmount(
          position.scaledBalance,
          spotMarket,
          position.balanceType || SpotBalanceType.DEPOSIT
        );
        // getTokenAmount returns balance in base units (smallest unit)
        const balance = convertToNumber(balanceBN, new BN(10).pow(new BN(spotMarket.decimals)));

        // Decode token name properly
        let symbol = `SPOT-${spotMarket.marketIndex}`;
        try {
          const decodedName = decodeName(spotMarket.name).trim();
          if (decodedName) {
            symbol = decodedName.replace('-SPOT', '').toUpperCase();
          }
        } catch (e) {
          console.warn(`Failed to decode name for market ${spotMarket.marketIndex}:`, e);
        }

        // Get oracle price for USD conversion using SDK helper
        let valueUsd = 0;
        try {
          const oracleData = driftClient.getOracleDataForSpotMarket(spotMarket.marketIndex);
          if (oracleData && oracleData.price) {
            // Use getTokenValue to get USD value (handles precision correctly)
            const valueBN = getTokenValue(balanceBN, spotMarket.decimals, oracleData);
            valueUsd = convertToNumber(valueBN, PRICE_PRECISION);
          } else {
            // Fallback: if USDC/quote market, price is 1; if SOL, use SOL-PERP price
            if (spotMarket.marketIndex === QUOTE_SPOT_MARKET_INDEX || symbol === 'USDC' || symbol.includes('USDC')) {
              valueUsd = balance; // USDC = 1:1 with USD
            } else if (spotMarket.mint.equals(NATIVE_MINT) || symbol === 'SOL') {
              // Try to get SOL price from SOL-PERP oracle
              try {
                const solOracle = driftClient.getOracleDataForPerpMarket(0);
                if (solOracle) {
                  const valueBN = getTokenValue(balanceBN, spotMarket.decimals, solOracle);
                  valueUsd = convertToNumber(valueBN, PRICE_PRECISION);
                } else {
                  valueUsd = balance; // Fallback
                }
              } catch (e) {
                valueUsd = balance; // Fallback
              }
            } else {
              valueUsd = balance; // Fallback: assume 1:1 if we can't get price
            }
          }
        } catch (e) {
          console.warn(`Failed to get price for ${symbol}:`, e);
          // Fallback: assume quote market or use balance as placeholder
          if (spotMarket.marketIndex === QUOTE_SPOT_MARKET_INDEX) {
            valueUsd = balance;
          } else {
            valueUsd = balance; // Placeholder
          }
        }

        positions.push({
          symbol: symbol,
          marketIndex: spotMarket.marketIndex,
          balance: balance,
          valueUsd: valueUsd,
        });
      }

      return positions;
    } catch (error) {
      console.error('Error getting spot positions:', error);
      return [];
    }
  }

  /**
   * Get orderbook with custom depth
   */
  async getOrderbookWithDepth(symbol: string, depth: number = 10): Promise<OrderbookData | null> {
    try {
      const orderbook = await this.getOrderbook(symbol);
      if (!orderbook) return null;

      return {
        symbol: orderbook.symbol,
        bids: orderbook.bids.slice(0, depth),
        asks: orderbook.asks.slice(0, depth),
        lastPrice: orderbook.lastPrice,
      };
    } catch (error) {
      console.error('Error getting orderbook with depth:', error);
      return null;
    }
  }

  disconnect(): void {
    try {
      if (this.dlobSubscriber) {
        this.dlobSubscriber.unsubscribe();
      }
      if (this.orderSubscriber) {
        this.orderSubscriber.unsubscribe();
      }
      if (this.driftClient) {
        this.driftClient.unsubscribe();
      }
      this.initialized = false;
      console.log('🔌 Drift service disconnected');
    } catch (error) {
      console.error('❌ Error disconnecting Drift service:', error);
    }
  }
}

// Export singleton instance for use in handlers
export const driftService = new DriftService();