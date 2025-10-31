/**
 * Drift Deposit Handler
 * Handles deposit flow with Privy wallet creation and database tracking
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction, SessionFlow } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDepositTokenKeyboard, buildDriftMainKeyboard, buildWalletCreationKeyboard, buildWalletStatusKeyboard } from '../../keyboards/driftKeyboards';
import { sessionManager } from '../../state/userSessionManager';
import { driftService } from '../../services/driftService';
import { createDriftTransactionService } from '../../services/driftTransactionService';
import { privySigningService } from '../../services/privySigningService';
import { databaseService } from '../../services/databaseService';
import { driftDatabaseService } from '../../services/driftDatabaseService';
import { privyService } from '../../services/privyService';
import { hasFundedWallet } from '../walletHandler';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';
import { BN, MarketType } from '@drift-labs/sdk';

// Token configurations
// Note: marketIndex is fetched directly from Drift client's spot market accounts
const DEPOSIT_TOKENS = [
  { symbol: 'USDC', decimals: 6 },
  { symbol: 'SOL', decimals: 9 },
  { symbol: 'USDT', decimals: 6 }
];

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
  // Check if user has wallet
  const walletStatus = await hasFundedWallet(chatId);
  
  if (!walletStatus.hasWallet) {
    // No wallet - show creation option
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      `*❌ No Wallet Found*\n\n` +
      `You need to create a Privy wallet first before you can deposit.\n\n` +
      `Click "Create Wallet" below to get started:`,
      {
        reply_markup: {
          inline_keyboard: buildWalletCreationKeyboard(),
        },
      }
    );
    return;
  }

  if (!walletStatus.isFunded) {
    // Wallet exists but not funded - show funding message
    const balance = walletStatus.balance || 0;
    await safeEditMessage(
      bot,
      chatId,
      messageId,
      `*⚠️ Wallet Not Funded*\n\n` +
      `Your wallet balance: **${balance.toFixed(9)} SOL**\n\n` +
      `Please fund your wallet with at least **0.001 SOL** before depositing.\n\n` +
      `**Your Wallet Address:**\n` +
      `\`${walletStatus.wallet?.walletAddress}\`\n\n` +
      `Send SOL to this address, then click "Check Balance" to verify.`,
      {
        reply_markup: {
          inline_keyboard: buildWalletStatusKeyboard(false),
        },
      }
    );
    return;
  }

  // Wallet exists and funded - proceed with deposit
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
  const token = DEPOSIT_TOKENS[tokenIndex];
  
  sessionManager.updateData(userId, { 
    depositToken: tokenIndex
  });

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*💰 Deposit ${token.symbol} to Drift*\n\n` +
    `Please reply with the amount you want to deposit.\n\n` +
    `Example: \`100\` for 100 ${token.symbol}\n\n` +
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
  const token = DEPOSIT_TOKENS[tokenIndex];

  const message =
    `*💰 Confirm Deposit*\n\n` +
    `Token: **${token.symbol}**\n` +
    `Amount: **${amount} ${token.symbol}**\n` +
    `Destination: **Drift Protocol**\n\n` +
    `⚠️ **First-time users:**\n` +
    `• We'll create your Privy wallet automatically\n` +
    `• Drift account will be initialized (if needed)\n` +
    `• You'll have full control via Telegram\n\n` +
    `Ready to proceed?`;

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
    const token = DEPOSIT_TOKENS[tokenIndex];
    
    // Step 1: Check wallet exists and is funded
    const walletStatus = await hasFundedWallet(chatId);
    
    if (!walletStatus.hasWallet) {
      await bot.sendMessage(
        chatId,
        `❌ **No Wallet Found**\n\nPlease create a wallet first.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildWalletCreationKeyboard() } }
      );
      return;
    }

    if (!walletStatus.isFunded) {
      const balance = walletStatus.balance || 0;
      await bot.sendMessage(
        chatId,
        `⚠️ **Wallet Not Funded**\n\n` +
        `Your balance: **${balance.toFixed(9)} SOL**\n\n` +
        `Please fund your wallet with at least **0.001 SOL** before depositing.\n\n` +
        `**Wallet Address:**\n\`${walletStatus.wallet?.walletAddress}\``,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildWalletStatusKeyboard(false) } }
      );
      return;
    }
    
    // Get user and wallet from database
    const user = await databaseService.getUserByTelegramId(chatId);
    if (!user || !walletStatus.wallet) {
      throw new Error('User or wallet not found');
    }
    
    const wallet = walletStatus.wallet;
    
    const userPublicKey = new PublicKey(wallet.walletAddress);
    
    // Step 2: Check if Drift account exists
    await bot.sendMessage(chatId, '🔍 Checking Drift account...');
    
    const hasAccount = await driftService.hasUserAccount(userPublicKey);
    
    // Step 3: Get Drift client and find spot market from actual accounts
    await bot.sendMessage(chatId, '⏳ Building transaction...');
    
    const driftClient = await (driftService as any).getDriftClientForMarketData();
    if (!driftClient) throw new Error('Drift client unavailable');
    
    // Get actual spot market accounts from Drift client
    // Use getMarketIndexAndType if available, otherwise find manually
    const spotMarketAccounts = driftClient.getSpotMarketAccounts();
    
    // Try using getMarketIndexAndType (handles name decoding)
    let marketInfo = driftClient.getMarketIndexAndType(token.symbol) ||
                     driftClient.getMarketIndexAndType(`${token.symbol}-SPOT`);
    
    let spotMarketAccount;
    if (marketInfo && marketInfo.marketType === MarketType.SPOT) {
      spotMarketAccount = driftClient.getSpotMarketAccount(marketInfo.marketIndex);
    }
    
    // Fallback: find by iterating through spot markets
    if (!spotMarketAccount) {
      // For SOL, find by native mint
      if (token.symbol === 'SOL') {
        spotMarketAccount = spotMarketAccounts.find((market: any) => 
          market.mint.equals(NATIVE_MINT)
        );
      }
      
      // If still not found, try matching by market name
      if (!spotMarketAccount) {
        const { decodeName } = await import('@drift-labs/sdk');
        spotMarketAccount = spotMarketAccounts.find((market: any) => {
          const marketName = decodeName(market.name).trim();
          return marketName === token.symbol || marketName === `${token.symbol}-SPOT`;
        });
      }
    }
    
    if (!spotMarketAccount) {
      const { decodeName } = await import('@drift-labs/sdk');
      const availableMarkets = spotMarketAccounts.map((m: any) => {
        const name = decodeName(m.name).trim() || `SPOT-${m.marketIndex}`;
        return `${name} (index: ${m.marketIndex})`;
      }).join(', ');
      throw new Error(`Spot market not found for ${token.symbol}. Available markets: ${availableMarkets}`);
    }
    
    const actualMarketIndex = spotMarketAccount.marketIndex;
    const marketTokenMint = spotMarketAccount.mint;
    const tokenAccount = getAssociatedTokenAddressSync(marketTokenMint, userPublicKey);
    
    const connection = (driftService as any).connection;
    const txService = createDriftTransactionService(driftClient, connection);
    
    const amountBN = new BN(amount * Math.pow(10, token.decimals));
    
    let transaction;
    
    if (!hasAccount) {
      await bot.sendMessage(chatId, '🆕 Initializing Drift account...');
      transaction = await txService.buildInitAndDepositTransaction(
        userPublicKey,
        amountBN,
        actualMarketIndex,
        marketTokenMint
      );
    } else {
      transaction = await txService.buildDepositOnlyTransaction(
        userPublicKey,
        amountBN,
        actualMarketIndex,
        marketTokenMint
      );
    }
    
    // Step 5: Create transaction record
    const txRecord = await driftDatabaseService.createTransaction({
      userId: user.id,
      walletId: wallet.id,
      txType: 'DEPOSIT',
      status: 'PENDING',
      amount: amount.toString(),
      tokenSymbol: token.symbol,
      marketIndex: actualMarketIndex,
      metadata: {
        hasAccount,
        requiresInit: !hasAccount
      }
    });
    
    // Step 6: Sign and submit with retry
    await bot.sendMessage(chatId, '🔐 Signing with Privy...');
    
    const signature = await privySigningService.signAndSendTransactionWithRetry(
      chatId,
      transaction,
      (driftService as any).connection,
      {
        onRetry: async (attempt) => {
          await driftDatabaseService.updateTransaction(txRecord.id, {
            retryCount: attempt
          });
        }
      }
    );
    
    // Step 7: Update transaction record
    await driftDatabaseService.updateTransaction(txRecord.id, {
      status: 'CONFIRMED',
      txHash: signature,
      confirmedAt: new Date()
    });
    
    // Step 8: Update wallet balance
    await databaseService.updateBalance({
      walletId: wallet.id,
      tokenSymbol: token.symbol,
      balance: amount
    });
    
    // Step 9: Clear session
    sessionManager.clearFlow(userId);
    
    // Step 10: Success message
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    await bot.sendMessage(
      chatId,
      `✅ **Deposit Successful!**\n\n` +
      `Amount: **${amount} ${token.symbol}**\n` +
      `Destination: **Drift Protocol**\n\n` +
      `[View Transaction](${explorerUrl})`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      }
    );

  } catch (error) {
    console.error('Deposit error:', error);
    
    sessionManager.clearFlow(userId);
    
    const userMessage = getUserFriendlyErrorMessage(error);
    await bot.sendMessage(chatId, `❌ **Deposit Failed**\n\n${userMessage}`);
  }
}

/**
 * Gets user and wallet (no auto-creation)
 * Used internally after wallet existence is verified
 */
async function getUserAndWallet(telegramUserId: number): Promise<{
  user: any;
  wallet: any;
} | null> {
  // Get user
  const user = await databaseService.getUserByTelegramId(telegramUserId);
  
  if (!user) {
    return null;
  }
  
  // Find Privy wallet
  const wallet = user.wallets?.find((w: any) => w.chainType === 'SOLANA' && w.walletType === 'PRIVY');
  
  if (!wallet) {
    return null;
  }
  
  return { user, wallet };
}

// Error handling utilities
function classifyError(error: any): string {
  const msg = error?.message?.toLowerCase() || '';
  
  if (msg.includes('insufficient')) return 'INSUFFICIENT_BALANCE';
  if (msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('network')) return 'NETWORK_ERROR';
  if (msg.includes('rpc')) return 'RPC_ERROR';
  if (msg.includes('privy')) return 'PRIVY_ERROR';
  
  return 'UNKNOWN';
}

function getUserFriendlyErrorMessage(error: any): string {
  const errorType = classifyError(error);
  
  switch (errorType) {
    case 'INSUFFICIENT_BALANCE':
      return 'Insufficient balance in your wallet. Please add funds first.';
    case 'TIMEOUT':
      return 'Transaction timeout. Check Solscan for status.';
    case 'NETWORK_ERROR':
      return 'Network error. Please try again.';
    case 'RPC_ERROR':
      return 'Solana network congested. Please try again.';
    case 'PRIVY_ERROR':
      return 'Wallet service error. Please contact support.';
    default:
      return `Error: ${(error as Error).message}`;
  }
}
