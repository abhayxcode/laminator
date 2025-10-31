/**
 * Wallet Balance Monitor Service
 * Monitors all Privy wallet addresses for balance changes
 * Uses Solana Connection.onAccountChange() subscriptions
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { databaseService } from './databaseService';
import { driftService } from './driftService';

interface WalletSubscription {
  address: string;
  chatId: number;
  subscriptionId: number;
  lastBalance: number;
}

const MIN_BALANCE_THRESHOLD = 0.001; // Minimum SOL for rent
const BALANCE_CHECK_INTERVAL = 5000; // Check balance every 5 seconds (fallback)

export class WalletBalanceMonitorService {
  private subscriptions: Map<string, WalletSubscription> = new Map();
  private connection: Connection;
  private isInitialized: boolean = false;

  constructor() {
    // Get connection from driftService
    this.connection = (driftService as any).connection;
  }

  /**
   * Initialize monitoring service
   * Fetches all Privy wallets from database and starts monitoring
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ Wallet balance monitor already initialized');
      return;
    }

    try {
      console.log('🔍 Initializing wallet balance monitor...');

      // Fetch all Privy wallets from database
      const prisma = databaseService.getPrisma();
      const wallets = await prisma.wallet.findMany({
        where: {
          walletType: 'PRIVY',
          chainType: 'SOLANA',
          status: 'ACTIVE',
        },
        include: {
          user: true,
        },
      });

      console.log(`📊 Found ${wallets.length} Privy wallets to monitor`);

      // Start monitoring each wallet
      for (const wallet of wallets) {
        const telegramId = Number(wallet.user.telegramId);
        if (!isNaN(telegramId)) {
          await this.addWallet(wallet.walletAddress, telegramId);
        }
      }

      this.isInitialized = true;
      console.log('✅ Wallet balance monitor initialized');
    } catch (error) {
      console.error('❌ Failed to initialize wallet balance monitor:', error);
      throw error;
    }
  }

  /**
   * Add wallet to monitoring
   */
  async addWallet(walletAddress: string, chatId: number): Promise<void> {
    try {
      // Check if already monitoring
      if (this.subscriptions.has(walletAddress)) {
        console.log(`⚠️ Already monitoring wallet: ${walletAddress}`);
        return;
      }

      console.log(`🔍 Adding wallet to monitoring: ${walletAddress}`);

      // Get initial balance
      const publicKey = new PublicKey(walletAddress);
      const lamports = await this.connection.getBalance(publicKey, 'confirmed');
      const initialBalance = lamports / LAMPORTS_PER_SOL;

      // Subscribe to account changes
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        async (accountInfo) => {
          try {
            const newBalance = accountInfo.lamports / LAMPORTS_PER_SOL;
            const subscription = this.subscriptions.get(walletAddress);
            
            if (subscription) {
              const oldBalance = subscription.lastBalance;
              subscription.lastBalance = newBalance;

              // Update database
              const wallet = await databaseService.getWalletByAddress(walletAddress);
              if (wallet) {
                await databaseService.updateBalance({
                  walletId: wallet.id,
                  tokenSymbol: 'SOL',
                  balance: newBalance,
                });
              }

              // Notify user if balance changed from 0 to > threshold
              if (oldBalance < MIN_BALANCE_THRESHOLD && newBalance >= MIN_BALANCE_THRESHOLD) {
                await this.notifyBalanceReceived(chatId, walletAddress, newBalance);
              } else if (Math.abs(newBalance - oldBalance) > 0.0001) {
                // Notify for any significant balance change
                console.log(`💰 Balance update for ${walletAddress}: ${oldBalance.toFixed(9)} -> ${newBalance.toFixed(9)} SOL`);
              }
            }
          } catch (error) {
            console.error(`Error handling account change for ${walletAddress}:`, error);
          }
        },
        'confirmed'
      );

      // Store subscription
      this.subscriptions.set(walletAddress, {
        address: walletAddress,
        chatId,
        subscriptionId,
        lastBalance: initialBalance,
      });

      console.log(`✅ Monitoring wallet: ${walletAddress} (subscription: ${subscriptionId})`);
    } catch (error) {
      console.error(`❌ Failed to add wallet to monitoring: ${walletAddress}`, error);
      throw error;
    }
  }

  /**
   * Remove wallet from monitoring
   */
  removeWallet(walletAddress: string): void {
    const subscription = this.subscriptions.get(walletAddress);
    if (subscription) {
      try {
        this.connection.removeAccountChangeListener(subscription.subscriptionId);
        this.subscriptions.delete(walletAddress);
        console.log(`✅ Removed wallet from monitoring: ${walletAddress}`);
      } catch (error) {
        console.error(`❌ Failed to remove wallet from monitoring: ${walletAddress}`, error);
      }
    }
  }

  /**
   * Notify user when balance is received
   */
  private async notifyBalanceReceived(
    chatId: number,
    walletAddress: string,
    balance: number
  ): Promise<void> {
    try {
      // Import bot and keyboard dynamically to avoid circular dependency
      const { bot } = await import('../bot');
      const { buildDriftMainKeyboard } = await import('../keyboards/driftKeyboards');
      
      const message =
        `✅ **Funds Received!**\n\n` +
        `💰 **Balance:** ${balance.toFixed(9)} SOL\n\n` +
        `Your wallet is now funded and ready for trading!\n\n` +
        `**Quick Actions:**\n` +
        `• 💰 Deposit to Drift Protocol\n` +
        `• 📊 Browse markets and start trading\n` +
        `• 📈 Manage your positions\n\n` +
        `**Slash Commands:**\n` +
        `• \`/dexdrift\` - Drift Protocol trading hub\n` +
        `• \`/balance\` - Check your balances\n` +
        `• \`/dexs\` - Browse all DEXs\n` +
        `• \`/wallet\` - Wallet management\n` +
        `• \`/start\` - See all commands`;

      const keyboard = buildDriftMainKeyboard();
      
      await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      console.log(`📬 Notified user ${chatId} about balance received`);
    } catch (error) {
      console.error(`❌ Failed to notify user ${chatId}:`, error);
    }
  }

  /**
   * Get all monitored wallets
   */
  getMonitoredWallets(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if wallet is being monitored
   */
  isMonitored(walletAddress: string): boolean {
    return this.subscriptions.has(walletAddress);
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    console.log('🧹 Cleaning up wallet balance monitor...');
    for (const [address, subscription] of this.subscriptions.entries()) {
      try {
        this.connection.removeAccountChangeListener(subscription.subscriptionId);
      } catch (error) {
        console.error(`Error removing subscription for ${address}:`, error);
      }
    }
    this.subscriptions.clear();
    this.isInitialized = false;
    console.log('✅ Wallet balance monitor cleaned up');
  }
}

// Export singleton instance
export const walletBalanceMonitorService = new WalletBalanceMonitorService();

