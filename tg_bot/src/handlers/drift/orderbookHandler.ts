/**
 * Drift Orderbook Handler
 * Handles orderbook display
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildOrderbookMarketKeyboard, buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';

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
  // TODO: Get markets from driftService
  const markets: any[] = [];

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
  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*📖 Orderbook*\n\n` +
    `Orderbook display coming soon!\n\n` +
    `Features:\n` +
    `• Real-time bid/ask levels\n` +
    `• Depth visualization\n` +
    `• Spread calculation\n` +
    `• Cumulative size display`,
    {
      reply_markup: {
        inline_keyboard: buildDriftMainKeyboard(),
      },
    }
  );
}
