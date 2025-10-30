/**
 * Callback Query Router
 * Routes callback queries from inline keyboards to appropriate handlers
 */

import TelegramBot from 'node-telegram-bot-api';
import { CallbackDataBuilder, CallbackPrefix } from '../types/telegram.types';

/**
 * Handle callback query from inline keyboard
 */
export async function handleCallbackQuery(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
): Promise<void> {
  if (!query.data) {
    console.warn('[CallbackRouter] Received callback query without data');
    return;
  }

  try {
    // Parse callback data
    const parsed = CallbackDataBuilder.parse(query.data);
    console.log(`[CallbackRouter] Routing: ${parsed.prefix}:${parsed.action}`, parsed.params);

    // Answer callback query immediately to remove loading state
    await bot.answerCallbackQuery(query.id);

    // Route to appropriate handler
    switch (parsed.prefix) {
      case CallbackPrefix.DRIFT:
        await handleDriftCallback(bot, query, parsed.action, parsed.params);
        break;

      case CallbackPrefix.FLASH:
        await handleFlashCallback(bot, query, parsed.action, parsed.params);
        break;

      case CallbackPrefix.COMMON:
        await handleCommonCallback(bot, query, parsed.action, parsed.params);
        break;

      default:
        console.warn(`[CallbackRouter] Unknown prefix: ${parsed.prefix}`);
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Unknown action',
          show_alert: true,
        });
    }
  } catch (error) {
    console.error('[CallbackRouter] Error handling callback:', error);

    // Try to notify user
    try {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ An error occurred. Please try again.',
        show_alert: true,
      });
    } catch (e) {
      console.error('[CallbackRouter] Failed to send error notification:', e);
    }
  }
}

/**
 * Handle Drift protocol callbacks
 */
async function handleDriftCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  params: string[]
): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  if (!chatId || !messageId) {
    console.error('[CallbackRouter] Missing chatId or messageId');
    return;
  }

  // Lazy load handlers to avoid circular dependencies
  const { handleDriftAction } = await import('./drift/index');

  await handleDriftAction(bot, chatId, messageId, query.from.id.toString(), action, params);
}

/**
 * Handle Flash protocol callbacks
 */
async function handleFlashCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  params: string[]
): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  if (!chatId || !messageId) {
    console.error('[CallbackRouter] Missing chatId or messageId');
    return;
  }

  // Placeholder for Flash handlers (to be implemented)
  await bot.editMessageText(
    '⚠️ Flash integration coming soon!',
    {
      chat_id: chatId,
      message_id: messageId,
    }
  );
}

/**
 * Handle common callbacks (shared between DEXs)
 */
async function handleCommonCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  action: string,
  params: string[]
): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  if (!chatId || !messageId) {
    console.error('[CallbackRouter] Missing chatId or messageId');
    return;
  }

  // Handle common actions (help, settings, etc.)
  console.log(`[CallbackRouter] Common action: ${action}`, params);

  await bot.editMessageText(
    '⚠️ Common action handler not implemented yet',
    {
      chat_id: chatId,
      message_id: messageId,
    }
  );
}

/**
 * Helper to safely edit message text
 */
export async function safeEditMessage(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  text: string,
  options?: TelegramBot.EditMessageTextOptions
): Promise<void> {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (error: any) {
    // Ignore "message is not modified" errors
    if (error.response?.body?.description?.includes('message is not modified')) {
      console.log('[CallbackRouter] Message not modified (same content)');
      return;
    }

    console.error('[CallbackRouter] Error editing message:', error);
    throw error;
  }
}

/**
 * Helper to safely delete message
 */
export async function safeDeleteMessage(
  bot: TelegramBot,
  chatId: number,
  messageId: number
): Promise<void> {
  try {
    await bot.deleteMessage(chatId, messageId as any);
  } catch (error) {
    console.error('[CallbackRouter] Error deleting message:', error);
  }
}
