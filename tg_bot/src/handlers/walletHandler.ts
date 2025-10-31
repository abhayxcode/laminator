/**
 * Generic Wallet Handler
 * Handles Privy wallet creation and status (not DEX-specific)
 * Reusable across all DEX integrations (Drift, Flash, Jupiter, etc.)
 */

import TelegramBot from 'node-telegram-bot-api';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { privyService } from '../services/privyService';
import { databaseService } from '../services/databaseService';
import { driftService } from '../services/driftService';
import { walletBalanceMonitorService } from '../services/walletBalanceMonitorService';
import { buildDriftMainKeyboard } from '../keyboards/driftKeyboards';
import { safeEditMessage } from './callbackQueryRouter';

const MIN_BALANCE_THRESHOLD = 0.001; // Minimum SOL for rent

/**
 * Handle wallet creation flow
 */
export async function handleWalletCreation(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  try {
    // Check if user already has wallet
    const user = await databaseService.getUserByTelegramId(chatId);
    
    if (user?.wallets?.length > 0) {
      const wallet = user.wallets.find((w: any) => w.walletType === 'PRIVY' && w.chainType === 'SOLANA');
      if (wallet) {
        await showWalletStatus(bot, chatId, messageId, userId, wallet);
        return;
      }
    }

    // Start wallet creation
    await bot.sendMessage(chatId, '🔐 Creating your Privy wallet...');

    // Get or create user
    const dbUser = await databaseService.getOrCreateUser(chatId, {
      telegramUsername: (await bot.getChat(chatId)).type === 'private' ? undefined : undefined,
    });

    // Check if user has Privy user ID
    let privyUserId = dbUser.privyUserId;
    
    if (!privyUserId) {
      // Create Privy user
      const privyUser = await privyService.createUser(chatId);
      privyUserId = privyUser.id;
      
      // Update user record
      const prisma = databaseService.getPrisma();
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { privyUserId },
      });
    }

    // Create Privy wallet
    const privyWallet = await privyService.createWallet(privyUserId);
    
    // Store wallet in database
    const wallet = await databaseService.createWallet({
      userId: dbUser.id,
      privyWalletId: privyWallet.id,
      walletAddress: privyWallet.address,
      walletType: 'PRIVY',
      chainType: 'SOLANA',
    });

    // Initialize wallet balance in database
    await databaseService.updateBalance({
      walletId: wallet.id,
      tokenSymbol: 'SOL',
      balance: 0,
      lockedBalance: 0,
    });

    // Start monitoring this wallet
    await walletBalanceMonitorService.addWallet(wallet.walletAddress, chatId);

    // Show wallet created message with funding instructions
    await showWalletCreated(bot, chatId, messageId, userId, wallet);
  } catch (error) {
    console.error('Error in wallet creation:', error);
    await bot.sendMessage(chatId, `❌ Failed to create wallet: ${(error as Error).message}`);
  }
}

/**
 * Show wallet created message with funding instructions
 */
async function showWalletCreated(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  wallet: any
): Promise<void> {
  const message =
    `🎉 **Wallet Created Successfully!**\n\n` +
    `🔑 **Your Wallet Address:**\n` +
    `\`${wallet.walletAddress}\`\n\n` +
    `💰 **Current Balance:** 0 SOL\n\n` +
    `**📥 Next Steps:**\n` +
    `1. Send SOL to your wallet address above\n` +
    `2. We'll notify you when funds are received\n` +
    `3. Then you can start trading!\n\n` +
    `💡 **Minimum Balance:** ${MIN_BALANCE_THRESHOLD} SOL (for rent)\n\n` +
    `**Your wallet is:**\n` +
    `• 🔐 Secure Privy wallet\n` +
    `• ⚡ Ready for gasless transactions\n` +
    `• 🔄 Accessible from any device\n\n` +
    `⏳ Waiting for funding...`;

  const keyboard = [
    [
      { text: '🔄 Check Balance', callback_data: `drift:wallet:check` },
      { text: '📋 Copy Address', callback_data: `drift:wallet:copy` }
    ],
    [
      { text: '🔙 Back', callback_data: 'drift:refresh' }
    ]
  ];

  await safeEditMessage(bot, chatId, messageId, message, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'Markdown',
  });
}

/**
 * Show wallet status
 */
export async function showWalletStatus(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  wallet: any
): Promise<void> {
  try {
    // Get current balance
    const balance = await getWalletBalance(wallet.walletAddress);
    const hasBalance = balance >= MIN_BALANCE_THRESHOLD;

    const dbBalance = await databaseService.getWalletBalance(wallet.id, 'SOL');
    const dbBalanceValue = dbBalance ? parseFloat(dbBalance.balance.toString()) : 0;

    const message =
      `💼 **Your Wallet**\n\n` +
      `🔑 **Address:**\n` +
      `\`${wallet.walletAddress}\`\n\n` +
      `💰 **SOL Balance:** ${balance.toFixed(9)} SOL\n` +
      `📊 **Database Balance:** ${dbBalanceValue.toFixed(9)} SOL\n\n`;

    let statusMessage = '';
    let keyboard;

    if (!hasBalance) {
      statusMessage =
        `⚠️ **Wallet Not Funded**\n\n` +
        `Send SOL to your wallet address to start trading.\n\n` +
        `**Minimum:** ${MIN_BALANCE_THRESHOLD} SOL`;

      keyboard = [
        [
          { text: '🔄 Check Balance', callback_data: `drift:wallet:check` },
          { text: '📋 Copy Address', callback_data: `drift:wallet:copy` }
        ],
        [
          { text: '🔙 Back', callback_data: 'drift:refresh' }
        ]
      ];
    } else {
      statusMessage =
        `✅ **Wallet Funded**\n\n` +
        `You can now deposit to Drift and start trading!`;

      keyboard = [
        [
          { text: '💰 Deposit', callback_data: 'drift:deposit' },
          { text: '📊 Markets', callback_data: 'drift:markets' }
        ],
        [
          { text: '🔄 Check Balance', callback_data: `drift:wallet:check` }
        ],
        [
          { text: '🔙 Back', callback_data: 'drift:refresh' }
        ]
      ];
    }

    await safeEditMessage(bot, chatId, messageId, message + statusMessage, {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error showing wallet status:', error);
    await bot.sendMessage(chatId, `❌ Failed to check wallet status: ${(error as Error).message}`);
  }
}

/**
 * Check wallet balance
 */
export async function checkWalletBalance(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  try {
    const user = await databaseService.getUserByTelegramId(chatId);
    if (!user?.wallets?.length) {
      await bot.sendMessage(chatId, '❌ No wallet found. Please create a wallet first.');
      return;
    }

    const wallet = user.wallets.find((w: any) => w.walletType === 'PRIVY' && w.chainType === 'SOLANA');
    if (!wallet) {
      await bot.sendMessage(chatId, '❌ Privy wallet not found.');
      return;
    }

    await bot.sendMessage(chatId, '🔄 Checking balance...');

    // Get on-chain balance
    const balance = await getWalletBalance(wallet.walletAddress);

    // Update database balance
    await databaseService.updateBalance({
      walletId: wallet.id,
      tokenSymbol: 'SOL',
      balance: balance,
    });

    // Check if balance changed from 0 to > 0
    const dbBalance = await databaseService.getWalletBalance(wallet.id, 'SOL');
    const previousBalance = dbBalance ? parseFloat(dbBalance.balance.toString()) : 0;
    
    if (previousBalance === 0 && balance >= MIN_BALANCE_THRESHOLD) {
      // Balance was just funded
      await bot.sendMessage(
        chatId,
        `✅ **Funds Received!**\n\n` +
        `Your wallet balance: **${balance.toFixed(9)} SOL**\n\n` +
        `You can now deposit to Drift and start trading!`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await bot.sendMessage(
        chatId,
        `💰 **Wallet Balance:** ${balance.toFixed(9)} SOL`,
        { parse_mode: 'Markdown' }
      );
    }

    // Show updated wallet status
    await showWalletStatus(bot, chatId, messageId, userId, wallet);
  } catch (error) {
    console.error('Error checking wallet balance:', error);
    await bot.sendMessage(chatId, `❌ Failed to check balance: ${(error as Error).message}`);
  }
}

/**
 * Get wallet balance from Solana chain
 */
async function getWalletBalance(walletAddress: string): Promise<number> {
  try {
    const publicKey = new PublicKey(walletAddress);
    const connection = (driftService as any).connection;
    const lamports = await connection.getBalance(publicKey, 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return 0;
  }
}

/**
 * Check if user has wallet and it's funded
 */
export async function hasFundedWallet(telegramUserId: number): Promise<{
  hasWallet: boolean;
  isFunded: boolean;
  wallet?: any;
  balance?: number;
}> {
  try {
    const user = await databaseService.getUserByTelegramId(telegramUserId);
    if (!user?.wallets?.length) {
      return { hasWallet: false, isFunded: false };
    }

    const wallet = user.wallets.find((w: any) => w.walletType === 'PRIVY' && w.chainType === 'SOLANA');
    if (!wallet) {
      return { hasWallet: false, isFunded: false };
    }

    const balance = await getWalletBalance(wallet.walletAddress);
    const isFunded = balance >= MIN_BALANCE_THRESHOLD;

    return {
      hasWallet: true,
      isFunded,
      wallet,
      balance,
    };
  } catch (error) {
    console.error('Error checking funded wallet:', error);
    return { hasWallet: false, isFunded: false };
  }
}

