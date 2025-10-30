/**
 * Drift Close Position Handler
 * Handles closing existing positions
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction, SessionFlow } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDriftMainKeyboard, buildPositionListKeyboard } from '../../keyboards/driftKeyboards';
import { sessionManager } from '../../state/userSessionManager';
import { driftService } from '../../services/driftService';
import { createDriftTransactionService } from '../../services/driftTransactionService';
import { privySigningService } from '../../services/privySigningService';
import { databaseService } from '../../services/databaseService';
import { PublicKey } from '@solana/web3.js';
import { formatUSD } from '../../types/drift.types';

/**
 * Handle close position action
 */
export async function handleClosePosition(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Start close position flow - show positions list
    await startClosePositionFlow(bot, chatId, messageId, userId);
    return;
  }

  switch (subAction) {
    case SubAction.SELECT_POSITION:
      await handlePositionSelection(bot, chatId, messageId, userId, parseInt(params[1]), parseInt(params[3]));
      break;

    case SubAction.CONFIRM:
      await executeClosePosition(bot, chatId, userId, params[1]);
      break;

    case SubAction.CANCEL:
      sessionManager.clearFlow(userId);
      await safeEditMessage(bot, chatId, messageId, '❌ Position closing cancelled.', {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      });
      break;

    default:
      console.warn(`[ClosePositionHandler] Unknown sub-action: ${subAction}`);
      await startClosePositionFlow(bot, chatId, messageId, userId);
  }
}

/**
 * Start close position flow
 */
async function startClosePositionFlow(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  try {
    sessionManager.startFlow(userId, chatId, SessionFlow.CLOSE_POSITION);

    // Get user's positions
    const positions = await driftService.getUserPositionsWithPnL(chatId);

    if (positions.length === 0) {
      await safeEditMessage(
        bot,
        chatId,
        messageId,
        `*🔽 Close Position*\n\n` +
        `You don't have any open positions.\n\n` +
        `Use **Open** to open a new position first.`,
        {
          reply_markup: {
            inline_keyboard: buildDriftMainKeyboard(),
          },
        }
      );
      return;
    }

    // Convert to DriftPositionInfo format for keyboard
    const positionInfos = positions.map((p: any) => ({
      marketIndex: p.marketIndex,
      symbol: p.symbol,
      direction: p.side as 'long' | 'short',
      size: p.size,
      notionalValue: p.size * p.currentPrice,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      liquidationPrice: null,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: (p.unrealizedPnl / p.margin) * 100,
      leverage: (p.size * p.currentPrice) / p.margin,
      marginUsed: p.margin,
    }));

    const keyboard = buildPositionListKeyboard(positionInfos);

    await safeEditMessage(
      bot,
      chatId,
      messageId,
      `*🔽 Close Position*\n\n` +
      `Select a position to close:`,
      {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      }
    );
  } catch (error) {
    console.error('Error starting close position flow:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load positions. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}

/**
 * Handle position and percentage selection - show confirmation
 */
async function handlePositionSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  marketIndex: number,
  percentage: number
): Promise<void> {
  try {
    // Get position details
    const position = await driftService.getUserPosition(chatId, marketIndex);
    if (!position) {
      await safeEditMessage(bot, chatId, messageId, '❌ Position not found.', {
        reply_markup: { inline_keyboard: buildDriftMainKeyboard() },
      });
      return;
    }

    const dirEmoji = position.side === 'long' ? '🔼' : '🔽';
    const pnlEmoji = position.unrealizedPnl >= 0 ? '🟢' : '🔴';

    // Calculate partial amounts
    const closeSize = (position.size * percentage) / 100;
    const closePnl = (position.unrealizedPnl * percentage) / 100;
    const closeNotional = closeSize * position.currentPrice;
    const leverage = position.margin > 0 ? (position.size * position.currentPrice) / position.margin : 1;

    sessionManager.updateData(userId, {
      closeMarketIndex: marketIndex,
      closePercentage: percentage,
    });

    const confirmData = `${marketIndex}:${percentage}`;

    const message =
      `*${dirEmoji} Confirm Close ${position.symbol}*\n\n` +
      `Direction: **${position.side.toUpperCase()}**\n` +
      `Close Amount: **${percentage}%** (${closeSize.toFixed(4)} ${position.symbol})\n` +
      `Entry Price: **$${position.entryPrice.toFixed(2)}**\n` +
      `Current Price: **$${position.currentPrice.toFixed(2)}**\n` +
      `Close Value: **${formatUSD(closeNotional)}**\n\n` +
      `${pnlEmoji} Est. PnL: **${formatUSD(closePnl)}** (${((closePnl / (closeNotional / leverage)) * 100).toFixed(2)}%)\n\n` +
      `⚠️ **Important:**\n` +
      `• Transaction will be signed with your Privy wallet\n` +
      `• Position will be closed at market price\n` +
      `• PnL will be realized immediately\n\n` +
      `Tap **Confirm** to proceed.`;

    const keyboard = [
      [
        { text: '✅ Confirm', callback_data: `drift:close:confirm:${confirmData}` },
        { text: '❌ Cancel', callback_data: 'drift:close:cancel' },
      ],
    ];

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    console.error('Error handling position selection:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load position details. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}

/**
 * Execute close position transaction
 */
async function executeClosePosition(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  confirmData: string
): Promise<void> {
  try {
    await bot.sendMessage(chatId, '⏳ Building transaction...');

    // Parse confirm data
    const [marketIndexStr, percentageStr] = confirmData.split(':');
    const marketIndex = parseInt(marketIndexStr);
    const percentage = parseInt(percentageStr);

    // Get position info before closing
    const position = await driftService.getUserPosition(chatId, marketIndex);
    if (!position) {
      throw new Error('Position not found');
    }

    // Get user from database
    const dbUser = await databaseService.getUserByTelegramId(chatId);
    if (!dbUser || !dbUser.wallets || dbUser.wallets.length === 0) {
      throw new Error('User wallet not found');
    }

    const wallet = dbUser.wallets.find((w: any) => w.blockchain === 'SOLANA');
    if (!wallet) {
      throw new Error('Solana wallet not found');
    }

    const userPublicKey = new PublicKey(wallet.walletAddress);

    // Get Drift client
    const driftClient = await (driftService as any).getDriftClientForMarketData();
    if (!driftClient) {
      throw new Error('Drift client not available');
    }

    const txService = createDriftTransactionService(driftClient);

    await bot.sendMessage(chatId, '🔧 Building close order...');

    // Build close position transaction
    const tx = await txService.buildClosePositionTransaction(
      userPublicKey,
      marketIndex,
      percentage
    );

    await bot.sendMessage(chatId, '🔐 Signing with Privy...');

    // Sign and send with Privy
    const signature = await privySigningService.signAndSendTransaction(
      chatId,
      tx,
      (driftService as any).connection
    );

    // Clear session
    sessionManager.clearFlow(userId);

    // Calculate closed amounts for display
    const closeSize = (position.size * percentage) / 100;
    const closePnl = (position.unrealizedPnl * percentage) / 100;
    const dirEmoji = position.side === 'long' ? '🔼' : '🔽';
    const pnlEmoji = closePnl >= 0 ? '🟢' : '🔴';

    // Send success message
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    await bot.sendMessage(
      chatId,
      `✅ **Position Closed!**\n\n` +
      `${dirEmoji} **${position.side.toUpperCase()} ${position.symbol}**\n` +
      `Closed: **${percentage}%** (${closeSize.toFixed(4)} ${position.symbol})\n` +
      `${pnlEmoji} Realized PnL: **${formatUSD(closePnl)}**\n\n` +
      `[View on Explorer](${explorerUrl})`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Close position error:', error);
    sessionManager.clearFlow(userId);
    await bot.sendMessage(
      chatId,
      `❌ **Position Closing Failed**\n\n` +
      `Error: ${(error as Error).message}\n\n` +
      `Please try again or contact support.`
    );
  }
}
