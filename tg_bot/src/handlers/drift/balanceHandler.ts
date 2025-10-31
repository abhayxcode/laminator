/**
 * Drift Balance Handler
 * Handles balance display and collateral information
 */

import TelegramBot from 'node-telegram-bot-api';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDriftMainKeyboard } from '../../keyboards/driftKeyboards';
import { DriftBalanceInfo, formatUSD } from '../../types/drift.types';
import { driftService } from '../../services/driftService';
import { dexManager } from '../../services/dexManager';
import { privyService } from '../../services/privyService';

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
    // Get wallet address
    const walletAddress = await privyService.getWalletAddress(chatId);

    // Get wallet balances (SOL, USDC) - fetch in parallel with Drift balance
    const [walletBalances, balanceInfo] = await Promise.all([
      Promise.all([
        dexManager.getWalletSolBalance(chatId).catch(() => 0),
        dexManager.getWalletUsdcBalance(chatId).catch(() => 0),
      ]),
      driftService.getUserBalanceInfo(chatId),
    ]);

    const walletSol = walletBalances[0];
    const walletUsdc = walletBalances[1];
    const collateral = balanceInfo.collateral;
    const spotPositions = balanceInfo.spotPositions;

    // Calculate metrics
    const totalCollateral = collateral.total;
    const freeCollateral = collateral.free;
    const usedCollateral = collateral.used;
    const accountValue = totalCollateral;

    // Calculate leverage: total collateral / (total collateral - used collateral)
    const leverage = usedCollateral > 0 && totalCollateral > usedCollateral 
      ? totalCollateral / (totalCollateral - usedCollateral) 
      : 1;

    // Calculate health: free collateral / total collateral * 100
    const health = totalCollateral > 0 ? (freeCollateral / totalCollateral) * 100 : 100;

    // Estimate maintenance margin (typically ~10% of used collateral)
    const maintenanceMargin = usedCollateral * 0.1;

    const healthEmoji = health >= 75 ? '🟢' : health >= 50 ? '🟡' : '🔴';

    let message = `*💵 Balance Overview*\n\n`;

    // Wallet address
    if (walletAddress) {
      message += `📍 Wallet: \`${walletAddress}\`\n\n`;
    }

    // Wallet Balances Section
    message += `*💼 Wallet Balances:*\n`;
    message += `💰 SOL: ${walletSol.toFixed(9)} SOL\n`;
    message += `💰 USDC: ${walletUsdc.toFixed(2)} USDC\n\n`;

    // Drift Balance Section
    message += `*🏦 Drift Protocol Balances:*\n\n`;

    if (totalCollateral === 0) {
      message += `No collateral deposited yet.\n\n`;
      message += `Use *Deposit* to add funds to your Drift account!`;
    } else {
      message += `💰 Total Collateral: ${formatUSD(totalCollateral)}\n`;
      message += `✅ Free Collateral: ${formatUSD(freeCollateral)}\n`;
      message += `🔒 Used Collateral: ${formatUSD(usedCollateral)}\n`;
      message += `📊 Account Value: ${formatUSD(accountValue)}\n\n`;
      
      message += `📈 Leverage: ${leverage.toFixed(2)}x\n`;
      message += `${healthEmoji} Health: ${health.toFixed(0)}%\n`;
      message += `⚠️ Maintenance Margin: ${formatUSD(maintenanceMargin)}\n`;

      // Token Balances Section
      if (spotPositions.length > 0) {
        message += `\n*📊 Token Balances:*\n`;
        spotPositions.forEach((pos: any) => {
          const tokenAmount = pos.balance || 0;
          const usdValue = pos.valueUsd || 0;
          
          // Format balance based on token type
          let formattedBalance: string;
          if (pos.symbol === 'SOL') {
            // For SOL, format with appropriate decimals (up to 9, remove trailing zeros)
            formattedBalance = tokenAmount.toFixed(9).replace(/\.?0+$/, '');
          } else if (pos.symbol === 'USDC' || pos.symbol.includes('USDC')) {
            formattedBalance = tokenAmount.toFixed(2);
          } else {
            formattedBalance = tokenAmount.toFixed(4).replace(/\.?0+$/, '');
          }
          
          message += `\n${pos.symbol}: ${formattedBalance} (${formatUSD(usdValue)})`;
        });
      } else {
        message += `\n*Token Balances:*\nNo token positions`;
      }
    }

    await safeEditMessage(bot, chatId, messageId, message, {
      parse_mode: 'Markdown',
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
