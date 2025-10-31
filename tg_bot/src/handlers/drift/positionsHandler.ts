/**
 * Drift Positions Handler
 * Handles position listing and details
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildPositionListKeyboard, buildPositionDetailsKeyboard, buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';
import { DriftPositionInfo, formatMarketSymbol, formatPrice, formatUSD, getPnLEmoji, getDirectionEmoji } from '../../types/drift.types';
import { driftService } from '../../services/driftService';
import { databaseService } from '../../services/databaseService';

/**
 * Handle positions action
 */
export async function handlePositions(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Show position list
    await showPositionList(bot, chatId, messageId, userId);
    return;
  }

  switch (subAction) {
    case SubAction.DETAILS:
      await showPositionDetails(bot, chatId, messageId, userId, parseInt(params[1]));
      break;

    default:
      console.warn(`[PositionsHandler] Unknown sub-action: ${subAction}`);
      await showPositionList(bot, chatId, messageId, userId);
  }
}

/**
 * Show user's position list
 */
async function showPositionList(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  try {
    // Get user's positions from driftService
    const rawPositions = await driftService.getUserPositionsWithPnL(chatId);

    // Convert to DriftPositionInfo format
    const positions: DriftPositionInfo[] = rawPositions.map((p: any) => ({
      marketIndex: p.marketIndex,
      symbol: p.symbol,
      direction: p.side as 'long' | 'short',
      size: p.size,
      notionalValue: p.size * p.currentPrice,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      liquidationPrice: null, // Not calculated yet
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: (p.unrealizedPnl / p.margin) * 100,
      leverage: (p.size * p.currentPrice) / p.margin,
      marginUsed: p.margin,
    }));

    const keyboard = buildPositionListKeyboard(positions);

    let message = `*📈 Your Positions*\n\n`;

    if (positions.length === 0) {
      message += `No open positions.\n\n`;
      message += `Use *Open Position* to start trading!`;
    } else {
      const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
      const totalNotional = positions.reduce((sum, p) => sum + p.notionalValue, 0);

      message += `Open Positions: ${positions.length}\n`;
      message += `Total Notional: ${formatUSD(totalNotional)}\n`;
      message += `Total PnL: ${getPnLEmoji(totalPnl)} ${formatUSD(totalPnl)}\n\n`;

      // Show position summaries
      for (const pos of positions) {
        const dirEmoji = getDirectionEmoji(pos.direction);
        const pnlEmoji = getPnLEmoji(pos.unrealizedPnl);
        message += `${dirEmoji} ${formatMarketSymbol(pos.symbol)}: ${pnlEmoji} ${formatUSD(pos.unrealizedPnl)}\n`;
      }

      message += `\nTap a position for details:`;
    }

    await safeEditMessage(bot, chatId, messageId, message, {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
  } catch (error) {
    console.error('[PositionsHandler] Error showing position list:', error);
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
 * Show position details
 */
async function showPositionDetails(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  marketIndex: number
): Promise<void> {
  try {
    // Get user's position for this market
    const rawPosition = await driftService.getUserPosition(chatId, marketIndex);

    if (!rawPosition) {
      throw new Error('Position not found');
    }

    // Convert to DriftPositionInfo format
    const position: DriftPositionInfo = {
      marketIndex,
      symbol: rawPosition.symbol,
      direction: rawPosition.side as 'long' | 'short',
      size: rawPosition.size,
      notionalValue: rawPosition.size * rawPosition.currentPrice,
      entryPrice: rawPosition.entryPrice,
      currentPrice: rawPosition.currentPrice,
      liquidationPrice: null,
      unrealizedPnl: rawPosition.unrealizedPnl,
      unrealizedPnlPercent: (rawPosition.unrealizedPnl / rawPosition.margin) * 100,
      leverage: (rawPosition.size * rawPosition.currentPrice) / rawPosition.margin,
      marginUsed: rawPosition.margin,
    };

    const keyboard = buildPositionDetailsKeyboard(marketIndex);

    const liquidationPriceStr = position.liquidationPrice !== null
      ? formatPrice(position.liquidationPrice)
      : 'N/A';

    const message =
      `*${getDirectionEmoji(position.direction)} ${formatMarketSymbol(position.symbol)} ${position.direction.toUpperCase()}*\n\n` +
      `📊 Size: ${position.size.toFixed(4)} ${position.symbol.split('-')[0]}\n` +
      `💰 Notional: ${formatUSD(position.notionalValue)}\n` +
      `📍 Entry Price: ${formatPrice(position.entryPrice)}\n` +
      `📍 Current Price: ${formatPrice(position.currentPrice)}\n` +
      `⚠️ Liquidation Price: ${liquidationPriceStr}\n\n` +
      `${getPnLEmoji(position.unrealizedPnl)} PnL: ${formatUSD(position.unrealizedPnl)} (${position.unrealizedPnlPercent >= 0 ? '+' : ''}${position.unrealizedPnlPercent.toFixed(2)}%)\n\n` +
      `📊 Leverage: ${position.leverage.toFixed(2)}x\n` +
      `💵 Margin Used: ${formatUSD(position.marginUsed)}`;

    await safeEditMessage(bot, chatId, messageId, message, {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
  } catch (error) {
    console.error('[PositionsHandler] Error showing position details:', error);
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
