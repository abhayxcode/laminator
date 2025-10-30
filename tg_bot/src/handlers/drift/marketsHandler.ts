/**
 * Drift Markets Handler
 * Handles market listing, filtering, and details
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction, MarketCategory } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import {
  buildMarketCategoryKeyboard,
  buildMarketListKeyboard,
  buildMarketDetailsKeyboard,
  buildDriftMainKeyboard,
} from '../../keyboards/driftKeyboards';
import { DriftMarketInfo, formatMarketSymbol, formatPrice, formatPercentage, formatUSD } from '../../types/drift.types';
import { driftService } from '../../services/driftService';

/**
 * Handle markets action
 */
export async function handleMarkets(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Show category selection
    await showCategorySelection(bot, chatId, messageId);
    return;
  }

  switch (subAction) {
    case SubAction.CATEGORY:
      await showMarketList(bot, chatId, messageId, params[1] as MarketCategory, parseInt(params[2]) || 0);
      break;

    case SubAction.DETAILS:
      await showMarketDetails(bot, chatId, messageId, parseInt(params[1]));
      break;

    default:
      console.warn(`[MarketsHandler] Unknown sub-action: ${subAction}`);
      await showCategorySelection(bot, chatId, messageId);
  }
}

/**
 * Show category selection
 */
async function showCategorySelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number
): Promise<void> {
  const keyboard = buildMarketCategoryKeyboard();

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*📊 Drift Markets*\n\n` +
    `Select a market category:`,
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    }
  );
}

/**
 * Show market list for category
 */
async function showMarketList(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  category: MarketCategory,
  page: number
): Promise<void> {
  try {
    // Get markets from driftService
    let rawMarkets;
    if (category === MarketCategory.MAJORS || category === MarketCategory.ALL) {
      rawMarkets = await driftService.getMajorPerpMarkets();
    } else {
      rawMarkets = await driftService.getAvailableMarkets();
    }

    // Convert to DriftMarketInfo format
    const markets: DriftMarketInfo[] = rawMarkets.map((m: any) => ({
      marketIndex: m.marketIndex,
      symbol: m.symbol,
      baseAssetSymbol: m.baseAsset,
      price: m.price,
      priceChange24h: m.change24h,
      volume24h: m.volume24h,
      openInterest: 0, // Not available in current format
      fundingRate: 0, // Not available in current format
      nextFundingTime: new Date(Date.now() + 3600000),
      category: 'major', // Simplified
      isActive: true,
    }));

    // Filter by category if not 'all'
    let filteredMarkets = markets;
    if (category !== MarketCategory.ALL) {
      // For simplicity, just show all markets for now
      // Can implement category filtering based on market symbols later
    }

    // Sort by volume (descending)
    filteredMarkets.sort((a, b) => b.volume24h - a.volume24h);

    const keyboard = buildMarketListKeyboard(filteredMarkets, category, page);

    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);

    let message = `*📊 ${categoryName} Markets*\n\n`;

    // Show top markets preview
    const previewMarkets = filteredMarkets.slice(0, 3);
    for (const market of previewMarkets) {
      const changeEmoji = market.priceChange24h >= 0 ? '📈' : '📉';
      message += `${changeEmoji} **${formatMarketSymbol(market.symbol)}**: ${formatPrice(market.price)}\n`;
      message += `   Vol: ${formatUSD(market.volume24h)}\n\n`;
    }

    message += `Select a market for details:`;

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
    console.error('[MarketsHandler] Error showing market list:', error);
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
 * Show market details
 */
async function showMarketDetails(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  marketIndex: number
): Promise<void> {
  try {
    // Get all markets and find the requested one
    const markets = await driftService.getAvailableMarkets();
    const rawMarket = markets.find((m: any) => m.marketIndex === marketIndex);

    if (!rawMarket) {
      throw new Error('Market not found');
    }

    // Convert to DriftMarketInfo format
    const market: DriftMarketInfo = {
      marketIndex: rawMarket.marketIndex,
      symbol: rawMarket.symbol,
      baseAssetSymbol: rawMarket.baseAsset,
      price: rawMarket.price,
      priceChange24h: rawMarket.change24h,
      volume24h: rawMarket.volume24h,
      openInterest: 0,
      fundingRate: 0,
      nextFundingTime: new Date(Date.now() + 3600000),
      category: 'major',
      isActive: true,
    };

    const keyboard = buildMarketDetailsKeyboard(marketIndex);

    const changeEmoji = market.priceChange24h >= 0 ? '📈' : '📉';
    const message =
      `*${formatMarketSymbol(market.symbol)}*\n\n` +
      `💰 Price: ${formatPrice(market.price)}\n` +
      `${changeEmoji} 24h Change: ${formatPercentage(market.priceChange24h)}\n` +
      `📊 24h Volume: ${formatUSD(market.volume24h)}\n` +
      `🔥 Status: Active\n\n` +
      `Use buttons below to trade or view orderbook.`;

    await safeEditMessage(bot, chatId, messageId, message, {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
  } catch (error) {
    console.error('[MarketsHandler] Error showing market details:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load market details. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}
