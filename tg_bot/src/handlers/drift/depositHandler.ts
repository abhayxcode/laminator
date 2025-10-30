/**
 * Drift Deposit Handler
 * Handles deposit flow with account initialization check
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction, SessionFlow } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDepositTokenKeyboard, buildDriftMainKeyboard, buildConfirmationKeyboard } from '../../keyboards/driftKeyboards';
import { sessionManager } from '../../state/userSessionManager';
import { driftService } from '../../services/driftService';
import { createDriftTransactionService } from '../../services/driftTransactionService';
import { privySigningService } from '../../services/privySigningService';
import { databaseService } from '../../services/databaseService';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { SpotMarkets, BN } from '@drift-labs/sdk';

/**
 * Handle deposit action
 */
export async function handleDeposit(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Start deposit flow - show token selection
    await startDepositFlow(bot, chatId, messageId, userId);
    return;
  }

  switch (subAction) {
    case SubAction.SELECT_TOKEN:
      await handleTokenSelection(bot, chatId, messageId, userId, parseInt(params[1]));
      break;

    case SubAction.CONFIRM:
      await executeDeposit(bot, chatId, userId, parseInt(params[1]), parseFloat(params[2]));
      break;

    case SubAction.CANCEL:
      sessionManager.clearFlow(userId);
      await safeEditMessage(bot, chatId, messageId, '❌ Deposit cancelled.', {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      });
      break;

    default:
      console.warn(`[DepositHandler] Unknown sub-action: ${subAction}`);
      await startDepositFlow(bot, chatId, messageId, userId);
  }
}

/**
 * Start deposit flow
 */
async function startDepositFlow(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  sessionManager.startFlow(userId, chatId, SessionFlow.DEPOSIT);

  const keyboard = buildDepositTokenKeyboard();

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*💰 Deposit to Drift*\n\n` +
    `Select a token to deposit:`,
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    }
  );
}

/**
 * Handle token selection - request amount input
 */
async function handleTokenSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  tokenIndex: number
): Promise<void> {
  const tokenNames = ['USDC', 'SOL', 'USDT'];
  const tokenName = tokenNames[tokenIndex] || 'Unknown';

  sessionManager.updateData(userId, { depositToken: tokenIndex });

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*💰 Deposit ${tokenName} to Drift*\n\n` +
    `Please reply with the amount you want to deposit.\n\n` +
    `Example: \`100\` for 100 ${tokenName}\n\n` +
    `Your message will be captured automatically.`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ Cancel', callback_data: 'drift:deposit:cancel' }
        ]],
      },
    }
  );

  // Set up message listener for amount input
  const messageHandler = async (msg: TelegramBot.Message) => {
    if (msg.chat.id !== chatId) return;
    if (!sessionManager.isInFlow(userId, SessionFlow.DEPOSIT)) return;

    const amount = parseFloat(msg.text || '0');
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a number greater than 0.');
      return;
    }

    // Remove listener
    bot.removeListener('message', messageHandler);

    // Save amount to session
    sessionManager.updateData(userId, { depositAmount: amount.toString() });

    // Show confirmation
    await showDepositConfirmation(bot, chatId, userId, tokenIndex, amount);
  };

  bot.on('message', messageHandler);
}

/**
 * Show deposit confirmation
 */
async function showDepositConfirmation(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  tokenIndex: number,
  amount: number
): Promise<void> {
  const tokenNames = ['USDC', 'SOL', 'USDT'];
  const tokenName = tokenNames[tokenIndex];

  const message =
    `*💰 Confirm Deposit*\n\n` +
    `Token: **${tokenName}**\n` +
    `Amount: **${amount} ${tokenName}**\n` +
    `Destination: **Drift Protocol**\n\n` +
    `⚠️ **Important:**\n` +
    `• Transaction will be signed with your Privy wallet\n` +
    `• Funds will be deposited to your Drift account\n` +
    `• You can withdraw anytime\n\n` +
    `Tap **Confirm** to proceed.`;

  const keyboard = [
    [
      { text: '✅ Confirm', callback_data: `drift:deposit:confirm:${tokenIndex}:${amount}` },
      { text: '❌ Cancel', callback_data: 'drift:deposit:cancel' },
    ],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Execute deposit transaction
 */
async function executeDeposit(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  tokenIndex: number,
  amount: number
): Promise<void> {
  try {
    await bot.sendMessage(chatId, '⏳ Building transaction...');

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

    // Get spot market info for the token
    const spotMarkets = SpotMarkets['mainnet-beta'];
    const marketIndex = tokenIndex; // Simplified - USDC=0, SOL=1, etc.
    const spotMarket = spotMarkets[marketIndex];

    if (!spotMarket) {
      throw new Error('Spot market not found');
    }

    // Convert amount to BN with proper precision
    const decimals = spotMarket.precisionExp.toNumber();
    const amountBN = new BN(amount * Math.pow(10, decimals));

    // Get token mint and account
    const tokenMint = new PublicKey(spotMarket.mint);
    const tokenAccount = getAssociatedTokenAddressSync(tokenMint, userPublicKey);

    // Check if user has Drift account initialized
    const hasAccount = await driftService.hasUserAccount(userPublicKey);

    // Get Drift client
    const driftClient = await (driftService as any).getDriftClientForMarketData();
    if (!driftClient) {
      throw new Error('Drift client not available');
    }

    const txService = createDriftTransactionService(driftClient);

    // Build appropriate transaction
    let tx;
    if (!hasAccount) {
      await bot.sendMessage(chatId, '🔧 Initializing Drift account...');
      tx = await txService.buildInitAndDepositTransaction(
        userPublicKey,
        amountBN,
        marketIndex,
        tokenMint
      );
    } else {
      tx = await txService.buildDepositOnlyTransaction(
        userPublicKey,
        amountBN,
        marketIndex,
        tokenMint
      );
    }

    await bot.sendMessage(chatId, '🔐 Signing with Privy...');

    // Sign and send with Privy
    const signature = await privySigningService.signAndSendTransaction(
      chatId,
      tx,
      (driftService as any).connection
    );

    // Clear session
    sessionManager.clearFlow(userId);

    // Send success message
    const tokenNames = ['USDC', 'SOL', 'USDT'];
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    await bot.sendMessage(
      chatId,
      `✅ **Deposit Successful!**\n\n` +
      `Deposited: **${amount} ${tokenNames[tokenIndex]}**\n\n` +
      `[View on Explorer](${explorerUrl})`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Deposit error:', error);
    sessionManager.clearFlow(userId);
    await bot.sendMessage(
      chatId,
      `❌ **Deposit Failed**\n\n` +
      `Error: ${(error as Error).message}\n\n` +
      `Please try again or contact support.`
    );
  }
}
