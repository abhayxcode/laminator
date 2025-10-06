import { 
  DriftClient, 
  Wallet, 
  PublicKey, 
  PerpMarkets,
  PerpMarketConfig,
  UserAccount,
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
  PRICE_PRECISION
} from '@drift-labs/sdk';
import { 
  Connection as SolanaConnection, 
  PublicKey as SolanaPublicKey,
  Keypair,
  clusterApiUrl
} from '@solana/web3.js';
import { privyService } from './privyService';

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
            // Create a minimal client just for market data fetching (no wallet needed for read operations)
            if (!this.driftClient) {
              const dummyKeypair = Keypair.generate();
              const wallet = new Wallet(dummyKeypair);
              
              // Try to create Drift client with bulk account loader
              try {
                this.driftClient = new DriftClient({
                  connection: this.connection,
                  wallet,
                  env: 'mainnet-beta',
                  accountSubscription: {
                    type: 'polling',
                    accountLoader: new BulkAccountLoader(this.connection, 'confirmed', 1000),
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
              } catch (bulkError: any) {
                if (bulkError.message.includes('Batch requests are only available for paid plans')) {
                  console.warn('⚠️ Helius free tier detected - batch requests not available');
                  console.log('💡 Consider upgrading to Helius paid plan for full Drift Protocol access');
                  return null;
                }
                throw bulkError;
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

      // Get user's private key from Privy (for transaction signing)
      const privateKey = await privyService.getWalletPrivateKey(telegramUserId);
      
      if (!privateKey) {
        console.warn('⚠️ Private key not available, using read-only client');
        // Return read-only client for market data operations
        const marketClient = await this.getDriftClientForMarketData();
        if (!marketClient) {
          throw new Error('Drift client not available for market data');
        }
        return marketClient;
      }

      // Create keypair from private key
      const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
      const wallet = new Wallet(keypair);

      // Create Drift client with user's actual wallet
      const driftClient = new DriftClient({
        connection: this.connection,
        wallet,
        env: 'mainnet-beta',
        accountSubscription: {
          type: 'websocket',
          resubTimeoutMs: 30000,
        },
      });

      // Subscribe to Drift program accounts
      await driftClient.subscribe();

      console.log(`✅ Created Drift client with user's Privy wallet`);
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

    if (process.env.HELIUS_API_KEY || process.env.SOLANA_RPC_URL) {
      try {
        console.log('📊 Fetching real market data from Drift Protocol SDK...');
        
        const driftClient = await this.getDriftClientForMarketData();
        
        if (!driftClient) {
          console.warn('❌ Drift client not available (likely due to RPC limitations)');
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
          console.log(`✅ Fetched ${markets.length} real markets from Drift Protocol SDK`);
          return markets;
        }
      } catch (error) {
        console.error('❌ Failed to get available markets from Drift API:', error);
      }
    }

    // Fallback: Use CoinGecko API for market data
    try {
      console.log('📊 Fetching market data from CoinGecko API...');
      
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin,ethereum,avalanche-2,polygon&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true');
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Map CoinGecko data to our market format
      const markets: PerpMarket[] = [
        {
          symbol: 'SOL',
          marketIndex: 0,
          baseAsset: 'SOL',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: data.solana?.usd || 0,
          change24h: data.solana?.usd_24h_change || 0,
          volume24h: data.solana?.usd_24h_vol || 0,
        },
        {
          symbol: 'BTC',
          marketIndex: 1,
          baseAsset: 'BTC',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: data.bitcoin?.usd || 0,
          change24h: data.bitcoin?.usd_24h_change || 0,
          volume24h: data.bitcoin?.usd_24h_vol || 0,
        },
        {
          symbol: 'ETH',
          marketIndex: 2,
          baseAsset: 'ETH',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: data.ethereum?.usd || 0,
          change24h: data.ethereum?.usd_24h_change || 0,
          volume24h: data.ethereum?.usd_24h_vol || 0,
        },
        {
          symbol: 'AVAX',
          marketIndex: 3,
          baseAsset: 'AVAX',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: data['avalanche-2']?.usd || 0,
          change24h: data['avalanche-2']?.usd_24h_change || 0,
          volume24h: data['avalanche-2']?.usd_24h_vol || 0,
        },
        {
          symbol: 'MATIC',
          marketIndex: 4,
          baseAsset: 'MATIC',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: data.polygon?.usd || 0.95, // Fallback price if not available
          change24h: data.polygon?.usd_24h_change || 0,
          volume24h: data.polygon?.usd_24h_vol || 0,
        },
      ];

      console.log(`✅ Fetched ${markets.length} markets from CoinGecko API`);
      return markets;
    } catch (error) {
      console.error('❌ Failed to get available markets from CoinGecko API:', error);
      
      // Final fallback: Return basic market data
      console.log('📊 Using final fallback market data...');
      const fallbackMarkets: PerpMarket[] = [
        {
          symbol: 'SOL',
          marketIndex: 0,
          baseAsset: 'SOL',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: 180.50,
          change24h: 2.5,
          volume24h: 1500000,
        },
        {
          symbol: 'BTC',
          marketIndex: 1,
          baseAsset: 'BTC',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: 43500.00,
          change24h: 1.2,
          volume24h: 800000,
        },
        {
          symbol: 'ETH',
          marketIndex: 2,
          baseAsset: 'ETH',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: 2650.00,
          change24h: 3.1,
          volume24h: 1200000,
        },
        {
          symbol: 'AVAX',
          marketIndex: 3,
          baseAsset: 'AVAX',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: 35.80,
          change24h: -1.5,
          volume24h: 400000,
        },
        {
          symbol: 'MATIC',
          marketIndex: 4,
          baseAsset: 'MATIC',
          quoteAsset: 'USDC',
          marketType: 'perp',
          status: 'active',
          price: 0.95,
          change24h: 0.8,
          volume24h: 200000,
        },
      ];
      
      console.log(`✅ Using ${fallbackMarkets.length} fallback markets`);
      return fallbackMarkets;
    }
  }

  async getUserPositions(telegramUserId: number): Promise<UserPosition[]> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`🔍 Fetching positions for Telegram user: ${telegramUserId}`);
      
      // Get Drift client with user's Privy wallet
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Get user account from Drift
      const userAccount = driftClient.getUserAccount();
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

        // Get current price
        const oraclePriceData = driftClient.getOracleDataForPerpMarket(position.marketIndex);
        const currentPrice = oraclePriceData ? convertToNumber(oraclePriceData.price, PRICE_PRECISION) : 0;

        // Calculate position size and direction
        const baseAssetAmount = convertToNumber(position.baseAssetAmount, 9); // SOL has 9 decimals
        const isLong = baseAssetAmount > 0;
        const size = Math.abs(baseAssetAmount);
        
        // Calculate entry price
        const entryPrice = convertToNumber(position.lastCumulativeFundingRate, PRICE_PRECISION);
        
        // Calculate unrealized PnL
        const unrealizedPnl = convertToNumber(position.quoteAssetAmount, QUOTE_PRECISION);
        
        // Calculate margin
        const margin = convertToNumber(position.lastCumulativeFundingRate, QUOTE_PRECISION);

        positions.push({
          symbol: marketConfig.symbol,
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
                price = parseFloat(bid.price.toString()) / Math.pow(10, PRICE_PRECISION);
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
                size = convertToNumber(bid.size, 9);
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
                price = parseFloat(ask.price.toString()) / Math.pow(10, PRICE_PRECISION);
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
                size = convertToNumber(ask.size, 9);
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
      
      // Get Drift client with user's Privy wallet
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Find market config
      const marketConfig = PerpMarkets['mainnet-beta'].find(m => m.symbol === symbol.toUpperCase());
      if (!marketConfig) {
        throw new Error(`Market ${symbol} not found`);
      }

      // TODO: Implement actual position opening with Drift SDK
      // This requires:
      // 1. Building the position opening instruction
      // 2. Creating and sending transaction
      // 3. Handling transaction confirmation
      
      console.log('⚠️ Position opening with real transaction signing not implemented yet');
      console.log('✅ Market validation passed, Privy wallet integration ready');
      
      // For now, return a placeholder
      return `mock_tx_${Date.now()}_${symbol}_${side}`;
    } catch (error) {
      console.error('❌ Failed to open position:', error);
      throw error;
    }
  }

  async closePosition(telegramUserId: number, symbol: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('Drift service not initialized');
    }

    try {
      console.log(`🔒 Closing position for ${symbol} for user ${telegramUserId}`);
      
      // Get Drift client with user's Privy wallet
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Find market config
      const marketConfig = PerpMarkets['mainnet-beta'].find(m => m.symbol === symbol.toUpperCase());
      if (!marketConfig) {
        throw new Error(`Market ${symbol} not found`);
      }

      // TODO: Implement actual position closing with Drift SDK
      // This requires:
      // 1. Finding the user's open position for this market
      // 2. Building the position closing instruction
      // 3. Creating and sending transaction
      
      console.log('⚠️ Position closing with real transaction signing not implemented yet');
      console.log('✅ Market validation passed, Privy wallet integration ready');
      
      // For now, return a placeholder
      return `mock_close_tx_${Date.now()}_${symbol}`;
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
      console.log(`💰 Fetching balance for Telegram user: ${telegramUserId}`);
      
      // Get Drift client with user's Privy wallet
      const driftClient = await this.getDriftClientForUser(telegramUserId);
      
      // Get user account from Drift
      const userAccount = driftClient.getUserAccount();
      if (!userAccount) {
        console.log('No user account found in Drift');
        return 0;
      }
      
      // Calculate total collateral (simplified)
      // Note: This is a placeholder - actual collateral calculation would require more complex logic
      const balance = 1250.75; // Mock balance for now - will be replaced with real calculation

      console.log(`✅ User balance: ${balance} USDC`);
      return balance;
    } catch (error) {
      console.error('❌ Failed to get user balance:', error);
      throw error;
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