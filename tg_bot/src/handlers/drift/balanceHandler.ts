/**
 * Drift Balance Handler
 * Handles balance display and collateral information
 */

import TelegramBot from 'node-telegram-bot-api';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';
import { DriftBalanceInfo, formatUSD } from '../../types/drift.types';
import { driftService } from '../../services/driftService';

/**
 * Handle balance action
 */
export async function handleBalance(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  try {
    // Get collateral info from driftService
    const collateral = await driftService.getUserCollateral(chatId);

    // Get spot positions (token breakdown)
    const spotPositions = await driftService.getSpotPositions(chatId);

    // Convert to DriftBalanceInfo format
    const balance: DriftBalanceInfo = {
      totalCollateral: collateral.total,
      freeCollateral: collateral.free,
      usedCollateral: collateral.used,
      accountValue: collateral.total,
      leverage: collateral.used > 0 ? collateral.total / (collateral.total - collateral.used) : 1,
      health: collateral.total > 0 ? (collateral.free / collateral.total) * 100 : 100,
      maintenanceMargin: collateral.used * 0.1, // Simplified estimate
      canBeLiquidated: collateral.free < collateral.used * 0.1,
      tokens: spotPositions.map((pos: any) => ({
        marketIndex: pos.marketIndex,
        symbol: pos.symbol,
        amount: pos.balance,
        valueUsd: pos.value,
        isDeposit: true,
      })),
    };

    const healthEmoji = balance.health >= 75 ? '🟢' : balance.health >= 50 ? '🟡' : '🔴';

    let message = `*💵 Drift Balance*\n\n`;

    if (balance.totalCollateral === 0) {
      message += `No collateral deposited yet.\n\n`;
      message += `Use *Deposit* to add funds to your Drift account!`;
    } else {
      message += `💰 Total Collateral: ${formatUSD(balance.totalCollateral)}\n`;
      message += `✅ Free Collateral: ${formatUSD(balance.freeCollateral)}\n`;
      message += `🔒 Used Collateral: ${formatUSD(balance.usedCollateral)}\n`;
      message += `📊 Account Value: ${formatUSD(balance.accountValue)}\n\n`;
      message += `📈 Leverage: ${balance.leverage.toFixed(2)}x\n`;
      message += `${healthEmoji} Health: ${balance.health.toFixed(0)}%\n`;
      message += `⚠️ Maintenance Margin: ${formatUSD(balance.maintenanceMargin)}\n`;

      if (balance.tokens.length > 0) {
        message += `\n*Token Balances:*\n`;
        balance.tokens.forEach(token => {
          message += `\n${token.symbol}: ${token.amount.toFixed(4)} (${formatUSD(token.valueUsd)})`;
        });
      }
    }

    await safeEditMessage(bot, chatId, messageId, message, {
      reply_markup: {
        inline_keyboard: buildDriftMainKeyboard(),
      },
    });
  } catch (error) {
    console.error('[BalanceHandler] Error showing balance:', error);
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      '❌ Failed to load balance. Please try again.',
      {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );
  }
}
