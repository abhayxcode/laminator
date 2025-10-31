/**
 * Drift Orderbook Handler
 * Handles orderbook display
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildOrderbookMarketKeyboard, buildOrderbookKeyboard, buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';
import { driftService } from '../../services/driftService';
import { DriftMarketInfo, formatMarketSymbol, formatPrice, formatUSD } from '../../types/drift.types';

/**
 * Handle orderbook action
 */
export async function handleOrderbook(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Show market selection
    await showMarketSelection(bot, chatId, messageId);
    return;
  }

  switch (subAction) {
    case SubAction.SELECT_MARKET:
      await showOrderbook(bot, chatId, messageId, parseInt(params[1]));
      break;

    default:
      console.warn(`[OrderbookHandler] Unknown sub-action: ${subAction}`);
      await showMarketSelection(bot, chatId, messageId);
  }
}

/**
 * Show market selection
 */
async function showMarketSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number
): Promise<void> {
  try {
    // Get markets from driftService
    const rawMarkets = await driftService.getAvailableMarkets();

    // Convert to DriftMarketInfo format
    const markets: DriftMarketInfo[] = rawMarkets.map((m: any) => ({
      marketIndex: m.marketIndex,
      symbol: m.symbol,
      baseAssetSymbol: m.baseAsset,
      price: m.price,
      priceChange24h: m.change24h,
      volume24h: m.volume24h,
      openInterest: 0,
      fundingRate: 0,
      nextFundingTime: new Date(Date.now() + 3600000),
      category: 'major', // Simplified
      isActive: true,
    }));

    const keyboard = buildOrderbookMarketKeyboard(markets);

    await safeEditMessage(
      bot,
      chatId,
      messageId,
      `*📖 Orderbook*\n\n` +
      `Select a market to view orderbook:\n\n` +
      `_Top markets shown. Use Markets menu for full list._`,
      {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }
    );
  } catch (error) {
    console.error('[OrderbookHandler] Error showing market selection:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load markets. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}

/**
 * Show orderbook for market
 */
async function showOrderbook(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  marketIndex: number
): Promise<void> {
  try {
    // Get market info to find symbol
    const markets = await driftService.getAvailableMarkets();
    const rawMarket = markets.find((m: any) => m.marketIndex === marketIndex);

    if (!rawMarket) {
      await safeEditMessage(
        bot,
        chatId,
        messageId,
        '❌ Market not found. Please try again.',
        {
          reply_markup: {
            inline_keyboard: buildDriftMainKeyboard(),
          },
        }
      );
      return;
    }

    const symbol = rawMarket.symbol;

    // Fetch orderbook data
    const orderbook = await driftService.getOrderbook(symbol);

    if (!orderbook || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      await safeEditMessage(
        bot,
        chatId,
        messageId,
        `*📖 ${formatMarketSymbol(symbol)} Orderbook*\n\n` +
        `⚠️ No orderbook data available.\n\n` +
        `This could be due to:\n` +
        `• No active orders in the market\n` +
        `• RPC connection issues\n` +
        `• Market not yet initialized\n\n` +
        `Try refreshing or selecting another market.`,
        {
          reply_markup: {
            inline_keyboard: buildOrderbookKeyboard(marketIndex),
          },
        }
      );
      return;
    }

    // Calculate spread
    const bestBid = orderbook.bids[0];
    const bestAsk = orderbook.asks[0];
    const spread = bestAsk.price - bestBid.price;
    const spreadPercent = (spread / bestBid.price) * 100;

    // Calculate cumulative sizes
    let cumulativeBidSize = 0;
    let cumulativeAskSize = 0;

    // Format orderbook display
    let message = `*📖 ${formatMarketSymbol(symbol)} Orderbook*\n\n`;

    // Current price and spread
    message += `💰 Price: **${formatPrice(orderbook.lastPrice)}**\n`;
    message += `📊 Spread: **${formatPrice(spread)}** (${spreadPercent.toFixed(3)}%)\n\n`;

    // Asks (sell orders) - show highest first
    message += `📈 *Asks (Sell Orders)*\n`;
    message += `\`Price        | Size       | Cum. Total\`\n`;
    
    const formattedAsks = orderbook.asks.slice().reverse(); // Reverse to show highest first
    formattedAsks.forEach((ask) => {
      cumulativeAskSize += ask.size;
      const priceStr = formatPrice(ask.price);
      const sizeStr = ask.size.toFixed(4);
      const totalStr = cumulativeAskSize.toFixed(4);
      message += `\`${priceStr.padEnd(12)} | ${sizeStr.padStart(10)} | ${totalStr.padStart(12)}\`\n`;
    });

    // Separator with best bid/ask
    message += `\n─ Best Ask: **${formatPrice(bestAsk.price)}** | Best Bid: **${formatPrice(bestBid.price)}** ─\n\n`;

    // Bids (buy orders) - show highest first
    message += `📉 *Bids (Buy Orders)*\n`;
    message += `\`Price        | Size       | Cum. Total\`\n`;
    
    orderbook.bids.forEach((bid) => {
      cumulativeBidSize += bid.size;
      const priceStr = formatPrice(bid.price);
      const sizeStr = bid.size.toFixed(4);
      const totalStr = cumulativeBidSize.toFixed(4);
      message += `\`${priceStr.padEnd(12)} | ${sizeStr.padStart(10)} | ${totalStr.padStart(12)}\`\n`;
    });

    // Market depth summary
    message += `\n─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\n\n`;
    message += `📊 *Market Depth*\n`;
    message += `Total Bid Size: **${cumulativeBidSize.toFixed(4)}** ${symbol}\n`;
    message += `Total Ask Size: **${cumulativeAskSize.toFixed(4)}** ${symbol}\n`;

    const keyboard = buildOrderbookKeyboard(marketIndex);

    await safeEditMessage(
      bot,
      chatId,
      messageId,
      message,
      {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }
    );
  } catch (error) {
    console.error('[OrderbookHandler] Error showing orderbook:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load orderbook. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}
