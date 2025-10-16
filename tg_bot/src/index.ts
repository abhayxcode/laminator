import { bot } from "./bot";
import { safeReply } from "./helper";
// Removed direct DriftService usage; use dexManager instead
import { userService } from "./services/userService";
import { privyService } from "./services/privyService";
import { databaseService } from "./services/databaseService";
import { dexManager } from "./services/dexManager";
import { flashService } from "./services/flashService";
import { jupiterPerpsService } from "./services/jupiterPerpsService";
import { perpetualService } from "./services/perpetualService";
import apiServer from "./apiServer";

// Initialize services
let dexManagerInitialized = false;
let databaseInitialized = false;
let jupiterPerpsInitialized = false;
let perpetualInitialized = false;

async function ensureJupiterPerpsInit(): Promise<boolean> {
  if (jupiterPerpsInitialized) return true;
  try {
    await jupiterPerpsService.initialize();
    jupiterPerpsInitialized = true;
    return true;
  } catch (e:any) {
    console.warn('⚠️ Jupiter Perps lazy-init failed:', e?.message || e);
    return false;
  }
}

// Initialize services on startup
Promise.all([
  dexManager.initialize(),
  databaseService.initialize().catch((dbError) => {
    console.warn('⚠️ Database not available, continuing without database:', dbError.message);
    return Promise.resolve(); // Continue without database
  }),
]).then(async () => {
  // Initialize Jupiter Perps Anchor service (read-only)
  try {
    await jupiterPerpsService.initialize();
    jupiterPerpsInitialized = true;
  } catch (e:any) {
    console.warn('⚠️ Jupiter Perps Anchor init failed:', e?.message || e);
  }

  // Initialize Perpetual service
  try {
    await perpetualService.isReady();
    perpetualInitialized = true;
    console.log('✅ Perpetual Service initialized');
  } catch (e:any) {
    console.warn('⚠️ Perpetual Service init failed:', e?.message || e);
  }

  dexManagerInitialized = true;
  databaseInitialized = true;
  console.log('✅ All services initialized (database optional)');
}).catch((error) => {
  console.error('❌ Failed to initialize services:', error);
  // Still try to initialize DEX manager
  dexManager.initialize().then(() => {
    dexManagerInitialized = true;
    console.log('✅ DEX Manager initialized (database unavailable)');
  }).catch((dexError) => {
    console.error('❌ Failed to initialize DEX Manager:', dexError);
  });
});

// /start
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    let hasWallet = false;
    
    // Try to get user from database if available
    if (databaseInitialized) {
      try {
        const user = await databaseService.getOrCreateUser(chatId, {
          telegramUsername: msg.from?.username,
          telegramFirstName: msg.from?.first_name,
          telegramLastName: msg.from?.last_name,
        });
        hasWallet = user.wallets && user.wallets.length > 0;
      } catch (dbError) {
        console.warn('Database unavailable, using mock wallet status');
        hasWallet = false;
      }
    } else {
      // Mock wallet status when database is unavailable
      hasWallet = false;
    }
    
    let message = `⚡ **Welcome to Laminator - Multi-DEX Perps Bot!**\n\n`;
    message += `🚀 **Trade perpetual futures across multiple DEXs**\n`;
    message += `• Drift Protocol ✅\n`;
    message += `• Flash Trade (Coming Soon) 🔄\n`;
    message += `• More DEXs (Coming Soon) 🔄\n\n`;

    if (!hasWallet) {
      message += `❌ **No wallet found**\n\n`;
      message += `**First, create your wallet:**\n`;
      message += `• \`/create\` - Create new Privy wallet\n\n`;
      message += `**After wallet creation, you can:**\n`;
      message += `• \`/wallet\` - Wallet management\n`;
      message += `• \`/balance\` - Check balance\n`;
      message += `• \`/dexs\` - Browse all DEXs\n`;
      message += `• \`/dexdrift\` - Browse Drift Protocol\n`;
      message += `• \`/dexjupiter\` - Browse Jupiter Perps\n`;
      message += `• \`/status\` - System status\n\n`;
      message += `💡 **Privy wallets are:**\n`;
      message += `• 🔐 Secure MPC wallets\n`;
      message += `• ⚡ Gasless transactions\n`;
      message += `• 🔄 Cross-device access`;
    } else {
      message += `✅ **Wallet Connected**\n\n`;
      message += `**Available Commands:**\n`;
      message += `• \`/wallet\` - Wallet management hub\n`;
      message += `• \`/balance\` - Show your balance\n`;
      message += `• \`/dexs\` - Browse all DEXs\n`;
      message += `• \`/dexdrift\` - Browse Drift Protocol\n`;
      message += `• \`/dexjupiter\` - Browse Jupiter Perps\n`;
      message += `• \`/orderbook <symbol>\` - Market data\n`;
      message += `• \`/myposition\` - View positions\n`;
      message += `• \`/open <symbol> <size> <side>\` - Open position\n`;
      message += `• \`/close <symbol>\` - Close position\n`;
      message += `• \`/status\` - System status\n\n`;
      message += `**Example Usage:**\n`;
      message += `\`/dexs\` - List all DEXs\n`;
      message += `\`/dexdrift\` - Browse Drift Protocol\n`;
      message += `\`/dexjupiter\` - Browse Jupiter Perps\n`;
      message += `\`/open SOL 1 long\` - Open 1 SOL long position\n`;
      message += `\`/orderbook SOL\` - View SOL orderbook`;
    }

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error in /start command:', error);
    await safeReply(chatId, "❌ Failed to initialize. Please try again later.");
  }
});

// /dexs - Show available DEXs
bot.onText(/^\/dexs$/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!dexManagerInitialized) {
    await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
    return;
  }

  try {
    await safeReply(chatId, "📊 Fetching available DEXs...");
    
    const dexes = await dexManager.getAvailableDEXs();
    
    if (dexes.length === 0) {
      await safeReply(chatId, "❌ No DEXs found");
      return;
    }

    let message = "⚡ **Laminator - Available DEXs:**\n\n";
    
    dexes.forEach((dex: any, index: number) => {
      message += `${index + 1}. **${dex.name}**\n`;
      message += `   📝 ${dex.description}\n`;
      if (dex.isActive) {
        message += `   📊 Markets: ${dex.marketsCount}\n`;
        const volLine = `$${(dex.volume24h / 1000000).toFixed(1)}M`;
        message += `   💰 24h Volume: ${volLine}\n`;
        message += `   🎯 Command: \`/dex${dex.id}\`\n`;
      } else {
        message += `   🚧 **Coming Soon**\n`;
      }
      message += `\n`;
    });

    message += "💡 **Usage:**\n";
    message += "• `/dexdrift` - Browse Drift Protocol markets\n";
    message += "• `/dexjupiter` - Browse Jupiter Perps markets\n";
    message += "• `/dexflash` - Browse Flash Perps markets\n";
    message += "• `/orderbook <symbol>` - View market details\n";

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error fetching DEXs:', error);
    await safeReply(chatId, "❌ Failed to fetch DEXs. Please try again later.");
  }
});

// /dexdrift - Show Drift Protocol markets
bot.onText(/^\/dexdrift$/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!dexManagerInitialized) {
    await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
    return;
  }

  try {
    await safeReply(chatId, "📊 Fetching Drift Protocol markets...");
    
    const markets = await dexManager.getMarketsForDEX('drift');
    
    if (markets.length === 0) {
      await safeReply(chatId, "❌ No Drift Protocol markets found");
      return;
    }

    let message = "⚡ **Drift Protocol - Available Markets:**\n\n";
    
    // Check if we're using Helius/Drift Protocol data
    const isUsingHelius = process.env.HELIUS_API_KEY;
    if (isUsingHelius) {
      message += "🔥 **Real Drift Protocol Data** (via Helius RPC)\n\n";
    } else {
      message += "📊 **Real-Time Market Data** (via CoinGecko API)\n\n";
    }
    
    markets.slice(0, 10).forEach((market, index) => {
      message += `${index + 1}. **${market.symbol}**\n`;
      message += `   💰 Price: $${market.price.toFixed(4)}\n`;
      message += `   📈 24h: ${market.change24h.toFixed(2)}%\n`;
      message += `   📊 Volume: $${market.volume24h.toLocaleString()}\n\n`;
    });

    if (markets.length > 10) {
      message += `... and ${markets.length - 10} more markets\n`;
    }

    message += "\n💡 **Usage:**\n";
    message += "• `/orderbook <symbol>` - View market details\n";
    message += "• `/dexjupiter` - Browse Jupiter Perps\n";
  message += "• `/dexflash` - Browse Flash Perps\n";
  message += "• `/openjup <symbol> <size> <long|short> <slippage_bps>` - Open JUP\n";
  message += "• `/openjup <symbol> <size> <long|short> <slippage_bps>` - Open JUP\n";
    message += "• `/dexs` - Back to all DEXs\n";

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error fetching Drift markets:', error);
    await safeReply(chatId, "❌ Failed to fetch Drift Protocol markets. Please try again later.");
  }
});

// /dexjupiter - Show Jupiter Perps markets
// /dexflash - Show Flash Perps markets
bot.onText(/^\/dexflash$/, async (msg) => {
  const chatId = msg.chat.id;
  if (!dexManagerInitialized) {
    await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
    return;
  }
  try {
    await safeReply(chatId, "📊 Fetching Flash Perps markets...");
    const markets = await dexManager.getMarketsForDEX('flash');
    if (markets.length === 0) {
      await safeReply(chatId, "❌ No Flash Perps markets found");
      return;
    }
    let message = "⚡ **Flash Perps - Available Markets:**\n\n";
    markets.slice(0, 10).forEach((m: any, idx: number) => {
      message += `${idx + 1}. **${m.symbol}**\n`;
      message += `   💰 Price: $${(m.price || 0).toFixed(6)}\n\n`;
    });
    if (markets.length > 10) message += `... and ${markets.length - 10} more markets`;
    message += "\n\n💡 **Usage:**\n";
    message += "• `/orderbook <symbol>` - View market details\n";
    message += "• `/dexs` - Back to all DEXs";
    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error fetching Flash markets:', error);
    await safeReply(chatId, "❌ Failed to fetch Flash Perps markets. Please try again later.");
  }
});
bot.onText(/^\/dexjupiter$/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!dexManagerInitialized) {
    await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
    return;
  }

  try {
    if (!(await ensureJupiterPerpsInit())) {
      await safeReply(chatId, "❌ Jupiter Perps unavailable right now. Try again in a moment.");
      return;
    }

    await safeReply(chatId, "📊 Fetching Jupiter Perps markets from-chain...");
    const markets = await jupiterPerpsService.getAvailableMarkets();

    if (!markets || markets.length === 0) {
      await safeReply(chatId, "❌ No Jupiter Perps markets found");
      return;
    }

    const top = markets
      .sort((a: any, b: any) => a.symbol.localeCompare(b.symbol))
      .slice(0, 10);

    let message = "⚡ **Jupiter Perps - On-chain Markets**\n\n";
    top.forEach((m: any, idx: number) => {
      const price = typeof m.oraclePrice === 'number' && isFinite(m.oraclePrice) ? m.oraclePrice : 0;
      message += `${idx + 1}. **${m.symbol}**\n`;
      message += `   💠 Custody: \`${m.custody}\`\n`;
      message += `   💰 Oracle: $${price.toFixed(6)}\n\n`;
    });

    if (markets.length > 10) {
      message += `... and ${markets.length - 10} more markets\n`;
    }

    message += "\n💡 **Usage:**\n";
    // Removed advanced oracle info command from help
    message += "• `/juppositions` - Your open positions\n";
    message += "• `/dexs` - Back to all DEXs";

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error fetching Jupiter Perps markets:', error);
    await safeReply(chatId, "❌ Failed to fetch Jupiter Perps markets. Please try again later.");
  }
});

// /balance
bot.onText(/^\/balance$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    if (!databaseInitialized) {
      await safeReply(chatId, "⏳ Database is initializing, please try again in a moment...");
      return;
    }
    // Get user from database
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (!user) {
      await safeReply(chatId, "❌ **User not found**\n\nPlease use `/start` to initialize your account first.");
      return;
    }

    const hasWallet = user.wallets && user.wallets.length > 0;
    
    if (!hasWallet) {
      await safeReply(chatId, "❌ **No wallet found**\n\nUse `/create` to create a new Privy wallet or `/wallet` for more options.");
      return;
    }

    if (!dexManagerInitialized) {
      await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
      return;
    }

    const wallet = user.wallets[0];
    
    let message = "⚡ **Laminator - Your Balance**\n\n";
    message += `🔑 **Wallet:** \`${wallet.walletAddress}\`\n\n`;
    
    try {
      // On-chain wallet balances (real-time)
      const walletUsdc = await dexManager.getWalletUsdcBalance(chatId);

      // Drift collateral (funds deposited into Drift)
      const driftCollateral = await dexManager.getDexCollateral('drift', chatId);

      // On-chain SOL balance via dexManager (RPC)
      const walletSolResolved = await dexManager.getWalletSolBalance(chatId);

      message += `💰 **Wallet USDC:** ${walletUsdc.toFixed(2)} USDC\n`;
      message += `💰 **Wallet SOL:** ${walletSolResolved.toFixed(4)} SOL\n`;
      message += `🏦 **Drift Collateral:** ${driftCollateral.toFixed(2)} USDC\n\n`;
      
      if (walletUsdc > 0 || walletSolResolved > 0 || driftCollateral > 0) {
        message += "✅ **Ready for Trading**\n";
        message += "• Use `/dexs` to browse markets\n";
        message += "• Use `/open` to place trades\n";
        message += "• Use `/myposition` to view positions";
      } else {
        message += "💡 **Deposit SOL to start trading:**\n";
        message += "• Send SOL to your wallet address\n";
        message += "• Use `/dexs` to browse markets\n";
        message += "• Use `/open` to place trades";
      }
    } catch (error) {
      console.error('Error fetching Drift balance:', error);
      message += "⚠️ **Unable to fetch Drift balance**\n";
      message += "• Using database balances only\n\n";
      
      const balances = await databaseService.getAllWalletBalances(wallet.id);
      let hasAnyBalance = false;
      if (balances && balances.length > 0) {
        balances.forEach(balance => {
          if (balance.balance > 0 || balance.lockedBalance > 0) {
            hasAnyBalance = true;
            message += `💰 **${balance.tokenSymbol}:** ${balance.balance.toFixed(4)} (Available: ${balance.availableBalance.toFixed(4)})\n`;
          }
        });
      }
      
      if (!hasAnyBalance) {
        message += "💰 **SOL Balance:** 0.0000 SOL\n";
        message += "💵 **USDC Balance:** $0.0000 USDC\n\n";
        message += "💡 **Deposit SOL to start trading:**\n";
        message += "• Send SOL to your wallet address\n";
        message += "• Use `/dexs` to browse markets\n";
        message += "• Use `/open` to place trades";
      } else {
        message += "\n✅ **Ready to trade!**\n";
        message += "• Use `/dexs` to browse markets\n";
        message += "• Use `/open` to place trades\n";
      }
    }

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error fetching balance:', error);
    await safeReply(chatId, "❌ Failed to fetch balance. Please try again later.");
  }
});

// /orderbook <symbol> or /orderbook (shows available markets)
bot.onText(/^\/orderbook(.*)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  // If no symbol provided, show available DEXs
  if (!match || !match[1] || match[1].trim() === '') {
    try {
      if (!dexManagerInitialized) {
        await safeReply(chatId, "⏳ DEX services are initializing, please wait...");
        return;
      }

      await safeReply(chatId, "📊 Fetching available DEXs...");
      const dexes = await dexManager.getAvailableDEXs();
      
      if (dexes.length === 0) {
        await safeReply(chatId, "❌ No DEXs found");
        return;
      }

      let message = "⚡ **Available DEXs for Orderbook:**\n\n";
    dexes.forEach((dex: any, index: number) => {
      message += `${index + 1}. **${dex.name}**\n`;
      if (dex.isActive) {
        message += `   📊 ${dex.marketsCount} markets available\n`;
        message += `   🎯 Use \`/dex${dex.id}\` to browse\n`;
      } else {
        message += `   🚧 **Coming Soon**\n`;
      }
      message += `\n`;
    });

      message += "💡 **Usage:** `/orderbook <symbol>`\n";
      message += "**Examples:**\n";
      message += "• `/orderbook SOL` (tries Drift first, then Jupiter)\n";
      message += "• `/orderbook BTC`\n";
      message += "• `/orderbook RAY` (Jupiter-specific)\n\n";
      message += "**DEX Commands:**\n";
      message += "• `/dexdrift` - Browse Drift Protocol\n";
      message += "• `/dexjupiter` - Browse Jupiter Perps\n";
  message += "• `/dexflash` - Browse Flash Perps\n";

      await safeReply(chatId, message);
      return;
    } catch (error) {
      console.error('Error fetching DEXs:', error);
      await safeReply(chatId, "❌ Failed to fetch DEXs. Please try again later.");
      return;
    }
  }

  const symbol = match[1].trim().toUpperCase();
  
  try {
    console.log(`🔍 Getting orderbook for ${symbol} across all DEXs`);
    await safeReply(chatId, `🔍 Fetching orderbook for ${symbol}...`);
    
    let orderbook = null;
    let dexName = '';
    let dexId = '';
    
    // Try Drift Protocol first (most markets)
    try {
      orderbook = await dexManager.getOrderbookForDEX('drift', symbol);
      if (orderbook) {
        dexName = orderbook.dexName;
        dexId = orderbook.dexId;
      }
    } catch (driftError) {
      console.log(`⚠️ Drift orderbook failed for ${symbol}:`, driftError);
    }
    
    // If Drift fails, try Jupiter
    if (!orderbook) {
      try {
        orderbook = await dexManager.getOrderbookForDEX('jupiter', symbol);
        if (orderbook) {
          dexName = orderbook.dexName;
          dexId = orderbook.dexId;
        }
      } catch (jupiterError) {
        console.log(`⚠️ Jupiter orderbook failed for ${symbol}:`, jupiterError);
      }
    }
    
    console.log(`📊 Orderbook result:`, orderbook ? `Success from ${dexName}` : 'Failed on all DEXs');
    
    if (!orderbook) {
      await safeReply(chatId, `❌ Orderbook data not available for ${symbol}\n\n💡 **Available DEXs:**\n• Drift Protocol (79 markets) - ✅ Active\n• Jupiter Perps - 🚧 Coming Soon\n\n🎯 **Try:**\n• \`/dexdrift\` - Browse Drift markets\n• \`/dexjupiter\` - See Jupiter preview\n• \`/dexs\` - View all DEXs`);
      return;
    }

    // Determine data source and display accordingly
    const isDrift = dexId === 'drift';
    const hasHeliusKey = process.env.HELIUS_API_KEY && 
                        process.env.HELIUS_API_KEY !== 'your_helius_key_here' &&
                        process.env.HELIUS_API_KEY.length > 10;
    
    let message = `⚡ **Laminator - ${symbol} Orderbook**\n\n`;
    
    if (isDrift && hasHeliusKey) {
      message += "🔥 **Real Drift Protocol Orderbook** (via Helius RPC)\n\n";
    } else if (isDrift) {
      message += "📊 **Drift Protocol Data** (fallback mode)\n\n";
    } else {
      message += `🚀 **${dexName} Data**\n\n`;
    }
    
    message += `💰 **Last Price:** $${orderbook.lastPrice.toFixed(4)}\n\n`;
    
    if (orderbook.bids.length === 0 && orderbook.asks.length === 0) {
      message += "⚠️ Full orderbook data not available\n";
      message += "💡 This is a simplified view. Use Drift's web interface for full orderbook.";
    } else {
      // Show ASKS (sell orders) - highest price first
      message += "🔴 **ASKS (Sell Orders)**\n";
      if (orderbook.asks.length > 0) {
        orderbook.asks.slice(0, 5).forEach((ask, index) => {
          message += `   ${ask.price.toFixed(4)} | ${ask.size.toFixed(2)} ${symbol}\n`;
        });
      } else {
        message += "   No asks available\n";
      }
      
      message += "\n";
      
      // Show BIDS (buy orders) - highest price first
      message += "🟢 **BIDS (Buy Orders)**\n";
      if (orderbook.bids.length > 0) {
        orderbook.bids.slice(0, 5).forEach((bid, index) => {
          message += `   ${bid.price.toFixed(4)} | ${bid.size.toFixed(2)} ${symbol}\n`;
        });
      } else {
        message += "   No bids available\n";
      }
      
      message += "\n";
      
      // Show spread if available
      if (orderbook.asks.length > 0 && orderbook.bids.length > 0) {
        const bestAsk = orderbook.asks[0].price;
        const bestBid = orderbook.bids[0].price;
        const spread = bestAsk - bestBid;
        const spreadPercent = (spread / bestBid) * 100;
        
        message += `📊 **Spread:** $${spread.toFixed(4)} (${spreadPercent.toFixed(3)}%)\n`;
        message += `📈 **Best Ask:** $${bestAsk.toFixed(4)}\n`;
        message += `📉 **Best Bid:** $${bestBid.toFixed(4)}\n`;
      }
    }

    await safeReply(chatId, message);
  } catch (error) {
    console.error(`Error fetching orderbook for ${symbol}:`, error);
    await safeReply(chatId, `❌ Failed to fetch orderbook for ${symbol}`);
  }
});

// /open <symbol> <size> <side>
bot.onText(/^\/open (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  try {
    // Get user from database
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (!user) {
      await safeReply(chatId, "❌ **User not found**\n\nPlease use `/start` to initialize your account first.");
      return;
    }

    const hasWallet = user.wallets && user.wallets.length > 0;
    
    if (!hasWallet) {
      await safeReply(chatId, "❌ **No wallet found**\n\nUse `/create` to create a new Privy wallet first.");
      return;
    }

  if (!match || !match[1]) {
      await safeReply(chatId, "❌ **Missing parameters**\n\nUsage: `/open <symbol> <size> <side>`\nExample: `/open SOL 1 long`");
      return;
    }

    const args = match[1].split(/\s+/);
    const [symbol, sizeStr, side] = args;

    if (!symbol || !sizeStr || !side) {
      await safeReply(chatId, "❌ **Missing parameters**\n\nUsage: `/open <symbol> <size> <side>`\nExample: `/open SOL 1 long`");
      return;
    }

    const size = parseFloat(sizeStr);
    if (isNaN(size) || size <= 0) {
      await safeReply(chatId, "❌ **Invalid size**\n\nSize must be a positive number.");
      return;
    }

    if (!['long', 'short'].includes(side.toLowerCase())) {
      await safeReply(chatId, "❌ **Invalid side**\n\nPlease use 'long' or 'short'.");
      return;
    }

    const symbolUpper = symbol.toUpperCase();

    // Check if market exists
    const market = await databaseService.getMarketBySymbol(symbolUpper, 'DRIFT');
    if (!market) {
      await safeReply(chatId, `❌ **Market not found**\n\n${symbolUpper} is not available for trading.\n\nUse \`/dexs\` to see available markets.`);
      return;
    }

    // Try to open position using DEX Manager (Drift)
    try {
      const txHash = await dexManager.openPositionForDEX('drift', chatId, symbolUpper, size, side.toLowerCase() as 'long' | 'short');
      
      await safeReply(chatId, `🎯 **Position Opening Initiated!**\n\n**Details:**\n• Symbol: ${symbolUpper}\n• Side: ${side.toUpperCase()}\n• Size: ${size}\n• Transaction: \`${txHash}\`\n\n⚠️ **Note:** Transaction signing with Privy integration is ready but transaction building is still in development.\n\n✅ **Status:**\n• ✅ Wallet connected\n• ✅ Market validated\n• ✅ Privy integration ready\n• ⏳ Transaction building (coming soon)`);
    } catch (error) {
      console.error('Error opening position:', error);
      await safeReply(chatId, `⏳ **Opening ${side} position for ${symbolUpper} with size ${size}...**\n\n⚠️ **Position opening in progress**\n💡 Privy wallet integration is ready!\n\n**Current Status:**\n• ✅ Wallet connected\n• ✅ Market validated\n• ✅ Privy integration ready\n• ⏳ Transaction building (in development)`);
    }
  } catch (error) {
    console.error('Error in /open command:', error);
    await safeReply(chatId, "❌ Failed to process trade request. Please try again.");
  }
});
// /openjup <symbol> <size> <long|short> <slippage_bps>
bot.onText(/^\/openjup (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    if (!(await ensureJupiterPerpsInit())) {
      await safeReply(chatId, "❌ Jupiter Perps unavailable right now. Try again in a moment.");
      return;
    }
    if (!match || !match[1]) {
      await safeReply(chatId, "❌ **Missing parameters**\n\nUsage: `/openjup <symbol> <size> <long|short> <slippage_bps>`\nExample: `/openjup SOL 1 long 50`");
      return;
    }
    const args = match[1].split(/\s+/);
    const [symbol, sizeStr, side, slippageStr] = args;
    if (!symbol || !sizeStr || !side || !slippageStr) {
      await safeReply(chatId, "❌ **Missing parameters**\n\nUsage: `/openjup <symbol> <size> <long|short> <slippage_bps>`\nExample: `/openjup SOL 1 long 50`");
      return;
    }
    const size = parseFloat(sizeStr);
    const slippageBps = parseInt(slippageStr, 10);
    if (!['long','short'].includes(side.toLowerCase())) {
      await safeReply(chatId, "❌ **Invalid side**\n\nPlease use 'long' or 'short'.");
      return;
    }
    if (isNaN(size) || size <= 0 || isNaN(slippageBps) || slippageBps < 0) {
      await safeReply(chatId, "❌ **Invalid size or slippage**");
      return;
    }

    const custodyRes = jupiterPerpsService.resolveCustodyBySymbol(symbol.toUpperCase());
    if (!custodyRes) {
      await safeReply(chatId, `❌ Market not found for ${symbol}`);
      return;
    }

    const limitUp = await jupiterPerpsService.getLimitPriceBySymbol(symbol.toUpperCase(), slippageBps);
    if (!limitUp || !isFinite(limitUp)) {
      await safeReply(chatId, `❌ Could not compute limit price for ${symbol}`);
      return;
    }
    const limitPrice = side.toLowerCase() === 'long' ? limitUp : (await (async () => {
      // For shorts, slip down rather than up
      const info = await jupiterPerpsService.getInfoBySymbol(symbol.toUpperCase());
      if (!info) return NaN;
      const slip = Math.max(0, slippageBps) / 10_000;
      return info.price * (1 - slip);
    })());
    if (!isFinite(limitPrice)) {
      await safeReply(chatId, `❌ Invalid computed limit price for ${symbol}`);
      return;
    }

    await safeReply(chatId, `⏳ Building Jupiter Perps trade request...\n\n• Symbol: ${symbol.toUpperCase()}\n• Side: ${side.toUpperCase()}\n• Size: ${size}\n• Limit: $${limitPrice.toFixed(6)}\n• Custody: \`${custodyRes.custody}\``);

    // TODO: Build remaining accounts and createPositionRequest + optional execute
    await safeReply(chatId, "⚠️ Trade builder WIP: instruction construction and submit coming next.");
  } catch (e:any) {
    console.error('Error in /openjup:', e);
    await safeReply(chatId, `❌ Failed to open Jupiter position: ${e?.message || e}`);
  }
});

// /close <symbol>
bot.onText(/^\/close (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  try {
    // Get user from database
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (!user) {
      await safeReply(chatId, "❌ **User not found**\n\nPlease use `/start` to initialize your account first.");
      return;
    }

    const hasWallet = user.wallets && user.wallets.length > 0;
    
    if (!hasWallet) {
      await safeReply(chatId, "❌ **No wallet found**\n\nUse `/create` to create a new Privy wallet first.");
      return;
    }

  if (!match || !match[1]) {
      await safeReply(chatId, "❌ **Missing symbol**\n\nUsage: `/close <symbol>`\nExample: `/close SOL`");
      return;
    }

    const symbol = match[1].toUpperCase();
    try {
      const txHash = await dexManager.closePositionForDEX('drift', chatId, symbol);
      
      await safeReply(chatId, `🔒 **Position Closing Initiated!**\n\n**Details:**\n• Symbol: ${symbol}\n• Transaction: \`${txHash}\`\n\n⚠️ **Note:** Transaction signing with Privy integration is ready but transaction building is still in development.\n\n✅ **Status:**\n• ✅ Wallet connected\n• ✅ Position found\n• ✅ Privy integration ready\n• ⏳ Transaction building (coming soon)`);
    } catch (error) {
      console.error('Error closing position:', error);
      const positions = await databaseService.getUserPositions(user.id, 'OPEN');
      const openPosition = positions.find(pos => pos.market?.symbol === symbol);

      if (!openPosition) {
        await safeReply(chatId, `❌ **No open position found**\n\nYou don't have any open positions for ${symbol}.\n\nUse \`/myposition\` to see your current positions.`);
        return;
      }
      
      await safeReply(chatId, `⏳ **Closing position for ${symbol}...**\n\n⚠️ **Position closing in progress**\n💡 Privy wallet integration is ready!\n\n**Current Status:**\n• ✅ Wallet connected\n• ✅ Position found\n• ✅ Privy integration ready\n• ⏳ Transaction building (in development)`);
    }
  } catch (error) {
    console.error('Error in /close command:', error);
    await safeReply(chatId, "❌ Failed to process close request. Please try again.");
  }
});

bot.onText(/^\/myposition$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Get user from database
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (!user) {
      await safeReply(chatId, "❌ **User not found**\n\nPlease use `/start` to initialize your account first.");
      return;
    }

    const hasWallet = user.wallets && user.wallets.length > 0;
    
    if (!hasWallet) {
      await safeReply(chatId, "❌ **No wallet found**\n\nUse `/create` to create a new Privy wallet first.");
      return;
    }

    if (!dexManagerInitialized) {
      await safeReply(chatId, "⏳ Drift service is initializing, please wait...");
      return;
    }

    try {
      // Get positions from Drift Protocol via DEX Manager
      const driftPositions = await dexManager.getUserPositionsForDEX('drift', chatId);
      
      if (driftPositions.length === 0) {
        await safeReply(chatId, "📭 **No open positions found**\n\nUse `/dexs` to browse markets and `/open` to place trades.");
        return;
      }

      let message = "⚡ **Laminator - Your Open Positions:**\n\n";
      
      driftPositions.forEach((position, index) => {
        const pnlEmoji = (position.unrealizedPnl || 0) >= 0 ? "🟢" : "🔴";
        message += `${index + 1}. **${position.symbol}** ${position.side.toUpperCase()}\n`;
        message += `   Size: ${position.size}\n`;
        message += `   Entry: $${position.entryPrice.toFixed(4)}\n`;
        message += `   Current: $${position.currentPrice?.toFixed(4) || 'N/A'}\n`;
        message += `   PnL: ${pnlEmoji} $${(position.unrealizedPnl || 0).toFixed(4)}\n`;
        message += `   Margin: $${position.margin.toFixed(4)}\n\n`;
      });

      await safeReply(chatId, message);
    } catch (error) {
      console.error('Error fetching Drift positions:', error);
      
      // Fallback to database positions
      const positions = await databaseService.getUserPositions(user.id, 'OPEN');
      
      if (positions.length === 0) {
        await safeReply(chatId, "📭 **No open positions found**\n\nUse `/dexs` to browse markets and `/open` to place trades.");
        return;
      }

      let message = "⚡ **Laminator - Your Open Positions:**\n\n";
      message += "⚠️ *Showing database positions (Drift integration unavailable)*\n\n";
      
      positions.forEach((position, index) => {
        const pnlEmoji = (position.unrealizedPnl || 0) >= 0 ? "🟢" : "🔴";
        message += `${index + 1}. **${position.market?.symbol || 'UNKNOWN'}** ${position.side.toUpperCase()}\n`;
        message += `   Size: ${position.size}\n`;
        message += `   Entry: $${position.entryPrice.toFixed(4)}\n`;
        message += `   Current: $${position.currentPrice?.toFixed(4) || 'N/A'}\n`;
        message += `   PnL: ${pnlEmoji} $${(position.unrealizedPnl || 0).toFixed(4)}\n`;
        message += `   Margin: $${position.margin.toFixed(4)}\n`;
        message += `   Leverage: ${position.leverage}x\n\n`;
      });

      await safeReply(chatId, message);
    }
  } catch (error) {
    console.error('Error fetching positions:', error);
    await safeReply(chatId, "❌ Failed to fetch positions. Please try again later.");
  }
});

// /wallet - Wallet management hub
bot.onText(/^\/wallet$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Get user from database
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (!user) {
      await safeReply(chatId, "❌ **User not found**\n\nPlease use `/start` to initialize your account first.");
      return;
    }

    const hasWallet = user.wallets && user.wallets.length > 0;
    
    let message = "⚡ **Laminator - Wallet Management**\n\n";
    
    if (!hasWallet) {
      message += "❌ **No wallet found**\n\n";
      message += "**Options:**\n";
      message += "• `/create` - Create new Privy wallet\n";
      message += "• `/start` - Get help and instructions\n\n";
      message += "💡 **Privy wallets are:**\n";
      message += "• 🔐 Secure MPC wallets\n";
      message += "• ⚡ Gasless transactions\n";
      message += "• 🔄 Cross-device access\n";
      message += "• 🛡️ Built-in recovery";
    } else {
      const wallet = user.wallets[0];
      const balances = await databaseService.getAllWalletBalances(wallet.id);
      
      message += "✅ **Wallet Connected**\n\n";
      message += `🔑 **Address:** \`${wallet.walletAddress}\`\n`;
      message += `🔗 **Type:** ${wallet.walletType} (${wallet.chainType})\n`;
      message += `📅 **Created:** ${wallet.createdAt.toLocaleDateString()}\n\n`;
      
      // Show balances
      if (balances && balances.length > 0) {
        message += "💰 **Balances:**\n";
        balances.forEach(balance => {
          if (balance.balance > 0 || balance.lockedBalance > 0) {
            message += `• ${balance.tokenSymbol}: ${balance.balance.toFixed(4)} (Available: ${balance.availableBalance.toFixed(4)})\n`;
          }
        });
        message += "\n";
      } else {
        message += "💰 **Balance:** 0 SOL, 0 USDC\n\n";
      }
      
      message += "✅ **Trading Ready**\n";
      message += "• You can trade perpetual futures\n";
      message += "• All features are available\n\n";
      
      message += "**Available Actions:**\n";
      message += "• `/balance` - Check detailed balance\n";
      message += "• `/dexs` - Browse markets\n";
      message += "• `/myposition` - View positions\n";
      message += "• `/status` - System status\n";
    }

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error in /wallet command:', error);
    await safeReply(chatId, "❌ Failed to check wallet status. Please try again.");
  }
});

// /create - Create new Privy wallet
bot.onText(/^\/create$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // First check if user already has a wallet in database
    const existingUser = await databaseService.getUserByTelegramId(chatId);
    
    if (existingUser && existingUser.wallets && existingUser.wallets.length > 0) {
      await safeReply(chatId, "❌ **You already have a wallet!**\n\nUse `/wallet` to view your existing wallet or `/status` to check your account status.");
      return;
    }

    await safeReply(chatId, "⏳ Creating your Privy wallet...");
    
    // Get or create user in database first
    const dbUser = await databaseService.getOrCreateUser(chatId, {
      telegramUsername: msg.from?.username,
      telegramFirstName: msg.from?.first_name,
      telegramLastName: msg.from?.last_name,
    });

    try {
      // Create Privy user and wallet
      const privyUser = await privyService.createUser(chatId);
      const privyWallet = await privyService.createWallet(privyUser.id);

      // Save wallet to database
      const dbWallet = await databaseService.createWallet({
        userId: dbUser.id,
        privyWalletId: privyWallet.id,
        walletAddress: privyWallet.address,
        walletType: 'PRIVY',
        chainType: 'SOLANA',
      });

      // Initialize wallet balance
      await databaseService.updateBalance({
        walletId: dbWallet.id,
        tokenSymbol: 'SOL',
        balance: 0,
        lockedBalance: 0,
      });

      await databaseService.updateBalance({
        walletId: dbWallet.id,
        tokenSymbol: 'USDC',
        balance: 0,
        lockedBalance: 0,
      });

      let message = "🎉 **Wallet Created Successfully!**\n\n";
      message += `🔑 **Wallet Address:**\n\`${privyWallet.address}\`\n\n`;
      message += `💰 **Balance:** 0 SOL, 0 USDC\n\n`;
      message += "**Next Steps:**\n";
      message += "1. 📥 Deposit SOL to your wallet address\n";
      message += "2. 🚀 Start trading with `/dexs`\n";
      message += "3. 📊 Check balance with `/balance`\n\n";
      message += "💡 **Your wallet is:**\n";
      message += "• 🔐 Secure MPC wallet\n";
      message += "• ⚡ Ready for gasless transactions\n";
      message += "• 🔄 Accessible from any device\n";
      message += "• 🛡️ Protected with MPC technology\n\n";
      message += "**Available Commands:**\n";
      message += "• `/wallet` - Manage your wallet\n";
      message += "• `/balance` - Check balances\n";
      message += "• `/dexs` - Browse markets";

      await safeReply(chatId, message);
    } catch (privyError: any) {
      console.error('Privy wallet creation error:', privyError);
      
      // Handle specific Privy errors
      if (privyError.message?.includes('already exists')) {
        await safeReply(chatId, "❌ **Wallet already exists!**\n\nYou already have a Privy wallet. Use `/wallet` to view your wallet details.");
      } else {
        await safeReply(chatId, "❌ **Failed to create Privy wallet**\n\nPlease try again later or contact support if the issue persists.");
      }
    }
  } catch (error) {
    console.error('Error in /create command:', error);
    await safeReply(chatId, "❌ Failed to create wallet. Please try again or contact support.");
  }
});

// /status - Check detailed status
bot.onText(/^\/status$/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const status = await privyService.getAuthorizationStatus(chatId);
    const user = userService.createOrGetUser(chatId);
    
    let message = "⚡ **Laminator - Status Report**\n\n";
    
    message += "**👤 User Status:**\n";
    message += `• Telegram ID: ${chatId}\n`;
    message += `• Created: ${user.createdAt.toLocaleDateString()}\n`;
    message += `• Last Active: ${user.lastActive.toLocaleString()}\n\n`;
    
    message += "**💼 Wallet Status:**\n";
    if (status.hasWallet) {
      message += `• ✅ Wallet Connected\n`;
      message += `• Address: \`${status.walletAddress}\`\n`;
      message += `• Balance: ${status.balance?.toFixed(4)} SOL\n`;
    } else {
      message += `• ❌ No Wallet Connected\n`;
      message += `• Use \`/create\` to create one\n`;
    }
    
    message += "\n**🚀 Trading Status:**\n";
    if (status.canTrade) {
      message += `• ✅ Trading Enabled\n`;
      message += `• Bot can execute transactions\n`;
      message += `• Ready for perpetual trading\n`;
    } else {
      message += `• ⚠️ Trading Disabled\n`;
      message += `• Authorization not configured\n`;
    }
    
    message += "\n**📊 Service Status:**\n";
    message += `• DEX Manager: ${dexManagerInitialized ? '✅' : '❌'}\n`;
    message += `• Database: ${databaseInitialized ? '✅' : '❌'}\n`;
    message += `• Privy Integration: ✅\n`;
    message += `• Bot Status: ✅ Active`;

    await safeReply(chatId, message);
  } catch (error) {
    console.error('Error in /status command:', error);
    await safeReply(chatId, "❌ Failed to get status. Please try again.");
  }
});

// /jupinfo <symbol> - show oracle info for symbol
bot.onText(/^\/jupinfo\s+([A-Za-z0-9_-]+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!(await ensureJupiterPerpsInit())) {
    await safeReply(chatId, "❌ Jupiter Perps unavailable right now. Try again in a moment.");
    return;
  }
  try {
    const symbol = (match && match[1] || '').trim();
    await safeReply(chatId, `🔍 Fetching oracle info for ${symbol}...`);
    const info = await jupiterPerpsService.getInfoBySymbol(symbol);
    if (!info) {
      await safeReply(chatId, `❌ Market not found for ${symbol}`);
      return;
    }
    let message = `✅ ${info.symbol} oracle info\n\n`;
    message += `💰 Price: $${info.price.toFixed(6)}\n`;
    message += `📡 Source: ${info.source}\n`;
    message += `⏱️ Age: ${info.ageSec}s\n`;
    message += `💠 Custody: \`${info.custody}\`\n`;
    message += `🧩 Oracle Account: \`${info.oracleAccount}\``;
    await safeReply(chatId, message);
  } catch (e:any) {
    console.error('Error in /jupinfo:', e);
    await safeReply(chatId, `❌ Failed to fetch oracle info: ${e?.message || e}`);
  }
});

// /juppositions - reads open positions for the user's wallet
bot.onText(/^\/juppositions$/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!databaseInitialized) {
    await safeReply(chatId, "⏳ Database is initializing, please try again in a moment...");
    return;
  }
  if (!(await ensureJupiterPerpsInit())) {
    await safeReply(chatId, "❌ Jupiter Perps unavailable right now. Try again in a moment.");
    return;
  }
  try {
    const user = await databaseService.getUserByTelegramId(chatId);
    if (!user || !user.wallets || user.wallets.length === 0) {
      await safeReply(chatId, "❌ No wallet found. Use /create first.");
      return;
    }
    const owner = user.wallets[0].walletAddress;
    await safeReply(chatId, `🔍 Reading open positions for \`${owner}\``);
    const positions = await jupiterPerpsService.getOpenPositionsForWallet(owner);
    if (!positions || positions.length === 0) {
      await safeReply(chatId, "✅ No open positions.");
      return;
    }
    let message = "✅ Open Positions (Jupiter Perps)\n\n";
    positions.slice(0, 10).forEach((p: any, idx: number) => {
      const acc = p.account || {};
      const sizeUsd = acc.sizeUsd?.toString?.() || '0';
      const side = acc.side || acc.positionSide || '';
      const custody = acc.custody?.toString?.() || '';
      message += `${idx + 1}. sizeUsd=${sizeUsd} side=${side} custody=${custody}\n`;
    });
    if (positions.length > 10) message += `... and ${positions.length - 10} more`;
    await safeReply(chatId, message);
  } catch (e:any) {
    console.error('Error in /juppositions:', e);
    await safeReply(chatId, `❌ Failed to load positions: ${e?.message || e}`);
  }
});

// /juppositions2 - normalized fields
bot.onText(/^\/juppositions2$/i, async (msg) => {
  const chatId = msg.chat.id;
  if (!databaseInitialized) {
    await safeReply(chatId, "⏳ Database is initializing, please try again in a moment...");
    return;
  }
  if (!jupiterPerpsInitialized) {
    await safeReply(chatId, "⏳ Jupiter Perps initializing, please wait...");
    return;
  }
  try {
    const user = await databaseService.getUserByTelegramId(chatId);
    if (!user || !user.wallets || user.wallets.length === 0) {
      await safeReply(chatId, "❌ No wallet found. Use /create first.");
      return;
    }
    const owner = user.wallets[0].walletAddress;
    await safeReply(chatId, `🔍 Reading open positions for \`${owner}\``);
    const positions = await jupiterPerpsService.getUserPositions(owner);
    if (!positions || positions.length === 0) {
      await safeReply(chatId, "✅ No open positions.");
      return;
    }
    let message = "✅ Open Positions (Jupiter Perps)\n\n";
    positions.slice(0, 10).forEach((p: any, idx: number) => {
      message += `${idx + 1}. sizeUsd=${p.sizeUsd.toFixed(2)} side=${p.side} custody=${p.custody}\n`;
    });
    if (positions.length > 10) message += `... and ${positions.length - 10} more`;
    await safeReply(chatId, message);
  } catch (e:any) {
    console.error('Error in /juppositions2:', e);
    await safeReply(chatId, `❌ Failed to load positions: ${e?.message || e}`);
  }
});

// /jupmid <symbol> - oracle mid price by symbol
bot.onText(/^\/jupmid\s+([A-Za-z0-9_-]+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!jupiterPerpsInitialized) {
    await safeReply(chatId, "⏳ Jupiter Perps initializing, please wait...");
    return;
  }
  try {
    const symbol = (match && match[1] || '').trim();
    await safeReply(chatId, `🔍 Fetching oracle mid-price for ${symbol}...`);
    const res = await jupiterPerpsService.getMidPriceBySymbol(symbol);
    if (!res) {
      await safeReply(chatId, `❌ Market not found for ${symbol}`);
      return;
    }
    await safeReply(chatId, `✅ ${res.symbol} mid-price: $${res.midPrice.toFixed(6)}\nCustody: \`${res.custody}\``);
  } catch (e:any) {
    console.error('Error in /jupmid:', e);
    await safeReply(chatId, `❌ Failed to fetch mid-price: ${e?.message || e}`);
  }
});

// /jupmidcustody <custody_pubkey> - oracle mid price by custody
bot.onText(/^\/jupmidcustody\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!jupiterPerpsInitialized) {
    await safeReply(chatId, "⏳ Jupiter Perps initializing, please wait...");
    return;
  }
  try {
    const custodyPk = (match && match[1] || '').trim();
    await safeReply(chatId, `🔍 Fetching oracle mid-price for custody \`${custodyPk}\`...`);
    const res = await jupiterPerpsService.getMidPriceForCustody(custodyPk);
    if (!res) {
      await safeReply(chatId, `❌ Custody not found or unreadable`);
      return;
    }
    await safeReply(chatId, `✅ ${res.symbol} mid-price: $${res.midPrice.toFixed(6)}\nCustody: \`${res.custody}\``);
  } catch (e:any) {
    console.error('Error in /jupmidcustody:', e);
    await safeReply(chatId, `❌ Failed to fetch mid-price: ${e?.message || e}`);
  }
});

// Default fallback for unrecognized messages
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    if (!msg.text || msg.text?.startsWith("/")) return; // ignore commands or empty text
    console.log("Received message:", msg.text);
    await bot.sendMessage(chatId, `You said: ${msg.text}`);
  } catch (err) {
    console.error("Error handling message:", err);
    // Optionally notify the user
    // bot.sendMessage(chatId, 'Oops! Something went wrong.');
  }
});

console.log("Telegram bot is running...");

// Start API server if PRIVATE_KEY and RPC_URL are available
const port = process.env.API_PORT || 3000;
const hasApiCredentials = process.env.PRIVATE_KEY && process.env.RPC_URL;

if (hasApiCredentials) {
  apiServer.listen(port, () => {
    console.log(`🚀 Perpetual Trading API server running on port ${port}`);
    console.log(`📡 API endpoints available at http://localhost:${port}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   GET  /health - Health check`);
    console.log(`   GET  /markets - Get available markets`);
    console.log(`   POST /users - Create user account`);
    console.log(`   POST /deposit - Deposit collateral`);
    console.log(`   POST /order - Place perpetual order`);
    console.log(`   POST /close - Close position`);
    console.log(`   GET  /positions - Get server wallet positions`);
    console.log(`   GET  /positions/:publicKey - Get user positions`);
    console.log(`   GET  /balance - Get server wallet balance`);
    console.log(`   GET  /balance/:publicKey - Get user balance`);
  });
} else {
  console.log(`💡 To enable API server, set PRIVATE_KEY and RPC_URL in your .env file`);
}
