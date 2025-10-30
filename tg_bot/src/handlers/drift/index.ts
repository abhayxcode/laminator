/**
 * Drift Protocol Handler Router
 * Routes Drift actions to specific handlers
 */

import TelegramBot from 'node-telegram-bot-api';
import { DriftAction, SubAction } from '../../types/telegram.types';
import { buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';
import { safeEditMessage } from '../callbackQueryRouter';
import { sessionManager } from '../../state/userSessionManager';

/**
 * Main entry point for /dexdrift command
 */
export async function handleDexDriftCommand(
  bot: TelegramBot,
  chatId: number,
  userId: string
): Promise<void> {
  try {
    // Get user session
    const session = sessionManager.getSession(userId, chatId);

    // Build main menu keyboard
    const keyboard = buildDriftMainKeyboard();

    // Send message with keyboard
    const message = await bot.sendMessage(
      chatId,
      `*🏦 Drift Protocol*\n\n` +
      `Welcome to Drift perpetual futures trading!\n\n` +
      `Choose an action from the menu below:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }
    );

    console.log(`[DriftHandler] Sent main menu to user ${userId}`);
  } catch (error) {
    console.error('[DriftHandler] Error handling /dexdrift command:', error);
    await bot.sendMessage(chatId, '❌ Failed to load Drift menu. Please try again.');
  }
}

/**
 * Route Drift actions to specific handlers
 */
export async function handleDriftAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  action: string,
  params: string[]
): Promise<void> {
  console.log(`[DriftHandler] Action: ${action}`, params);

  try {
    switch (action) {
      case DriftAction.DEPOSIT:
        await handleDepositAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.MARKETS:
        await handleMarketsAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.OPEN:
        await handleOpenAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.CLOSE:
        await handleCloseAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.ORDERBOOK:
        await handleOrderbookAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.POSITIONS:
        await handlePositionsAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.BALANCE:
        await handleBalanceAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.SETTINGS:
        await handleSettingsAction(bot, chatId, messageId, userId, params);
        break;

      case DriftAction.REFRESH:
        await handleRefreshAction(bot, chatId, messageId, userId);
        break;

      default:
        console.warn(`[DriftHandler] Unknown action: ${action}`);
        await safeEditMessage(
          bot,
          chatId,
          messageId,
          '❌ Unknown action. Please try again.'
        );
    }
  } catch (error) {
    console.error(`[DriftHandler] Error handling action ${action}:`, error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ An error occurred. Please try again.'
    );
  }
}

/**
 * Handle deposit action
 */
async function handleDepositAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load deposit handler
  const { handleDeposit } = await import('./depositHandler');
  await handleDeposit(bot, chatId, messageId, userId, params);
}

/**
 * Handle markets action
 */
async function handleMarketsAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load markets handler
  const { handleMarkets } = await import('./marketsHandler');
  await handleMarkets(bot, chatId, messageId, userId, params);
}

/**
 * Handle open position action
 */
async function handleOpenAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load open position handler
  const { handleOpenPosition } = await import('./openPositionHandler');
  await handleOpenPosition(bot, chatId, messageId, userId, params);
}

/**
 * Handle close position action
 */
async function handleCloseAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load close position handler
  const { handleClosePosition } = await import('./closePositionHandler');
  await handleClosePosition(bot, chatId, messageId, userId, params);
}

/**
 * Handle orderbook action
 */
async function handleOrderbookAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load orderbook handler
  const { handleOrderbook } = await import('./orderbookHandler');
  await handleOrderbook(bot, chatId, messageId, userId, params);
}

/**
 * Handle positions action
 */
async function handlePositionsAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load positions handler
  const { handlePositions } = await import('./positionsHandler');
  await handlePositions(bot, chatId, messageId, userId, params);
}

/**
 * Handle balance action
 */
async function handleBalanceAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Lazy load balance handler
  const { handleBalance } = await import('./balanceHandler');
  await handleBalance(bot, chatId, messageId, userId, params);
}

/**
 * Handle settings action
 */
async function handleSettingsAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  // Placeholder for settings handler
  await safeEditMessage(
    bot,
    chatId,
    messageId,
    '⚙️ *Settings*\n\n' +
    'Settings management coming soon!\n\n' +
    'Features:\n' +
    '• Slippage tolerance\n' +
    '• Sub-account selection\n' +
    '• Notification preferences\n' +
    '• Default order sizes',
    {
      reply_markup: {
        inline_keyboard: buildDriftMainKeyboard(),
      },
    }
  );
}

/**
 * Handle refresh action (return to main menu)
 */
async function handleRefreshAction(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  // Clear any active flow
  sessionManager.clearFlow(userId);

  // Return to main menu
  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*🏦 Drift Protocol*\n\n` +
    `Welcome to Drift perpetual futures trading!\n\n` +
    `Choose an action from the menu below:`,
    {
      reply_markup: {
        inline_keyboard: buildDriftMainKeyboard(),
      },
    }
  );
}
