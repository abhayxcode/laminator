import { PrivyClient } from '@privy-io/node';
import { isEmbeddedWalletLinkedAccount } from '@privy-io/node';

export interface PrivyWallet {
  id: string;
  address: string;
  chainType: 'ethereum' | 'solana';
  createdAt: Date;
  isActive: boolean;
}

export interface PrivyUser {
  id: string;
  telegramUserId: number;
  walletId?: string;
  walletAddress?: string;
  createdAt: Date;
  isActive: boolean;
}

export class PrivyService {
  private privyClient: PrivyClient;
  private authorizationKey: string = ''; // Will be set from environment

  constructor() {
    if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
      throw new Error('Privy credentials not found in environment variables');
    }

    this.privyClient = new PrivyClient({
      appId: process.env.PRIVY_APP_ID,
      appSecret: process.env.PRIVY_APP_SECRET,
    });

    // Set authorization key for bot transactions
    this.authorizationKey = process.env.PRIVY_AUTHORIZATION_KEY || '';
  }

  /**
   * Create a new Privy user with Telegram account linked
   */
  async createUser(telegramUserId: number): Promise<PrivyUser> {
    try {
      // Create Privy user with Telegram user ID
      const privyUser = await this.privyClient.users().create({
        linked_accounts: [
          { type: 'telegram', telegram_user_id: telegramUserId.toString() }
        ]
      });

      return {
        id: privyUser.id,
        telegramUserId,
        createdAt: new Date(),
        isActive: true,
      };
    } catch (error) {
      console.error('Failed to create Privy user:', error);
      throw error;
    }
  }

  /**
   * Get user by Telegram user ID
   */
  async getUserByTelegramId(telegramUserId: number): Promise<PrivyUser | null> {
    try {
      const user = await this.privyClient.users().getByTelegramUserID({
        telegram_user_id: telegramUserId.toString()
      });

      if (!user) return null;

      // Find the wallet in linked accounts
      const wallet = user.linked_accounts.find(isEmbeddedWalletLinkedAccount);

      return {
        id: user.id,
        telegramUserId,
        walletId: wallet?.id || undefined,
        walletAddress: wallet?.address || undefined,
        createdAt: new Date(user.created_at),
        isActive: true,
      };
    } catch (error) {
      console.error('Failed to get user by Telegram ID:', error);
      return null;
    }
  }

  /**
   * Create a Solana wallet for the user (bot-first approach)
   */
  async createWallet(userId: string): Promise<PrivyWallet> {
    try {
      // Create wallet with user owner and bot as additional signer
      const wallet = await this.privyClient.wallets().create({
        chain_type: 'solana',
        owner: { user_id: userId },
        // Note: You'll need to create an authorization key in Privy Dashboard
        // and add it as additional signer to allow bot transactions
        additional_signers: this.authorizationKey ? 
          [{ signer_id: this.authorizationKey, override_policy_ids: [] }] : 
          []
      });

      return {
        id: wallet.id,
        address: wallet.address,
        chainType: 'solana',
        createdAt: new Date(wallet.created_at),
        isActive: true,
      };
    } catch (error) {
      console.error('Failed to create wallet:', error);
      throw error;
    }
  }

  /**
   * Get user's wallet by Telegram user ID
   */
  async getUserWallet(telegramUserId: number): Promise<PrivyWallet | null> {
    try {
      const user = await this.getUserByTelegramId(telegramUserId);
      if (!user || !user.walletId) return null;

      // Get wallet details from Privy
      const wallet = await this.privyClient.wallets().get(user.walletId);

      return {
        id: wallet.id,
        address: wallet.address,
        chainType: 'solana',
        createdAt: new Date(wallet.created_at),
        isActive: true,
      };
    } catch (error) {
      console.error('Failed to get user wallet:', error);
      return null;
    }
  }

  /**
   * Get wallet balance (SOL)
   */
  async getWalletBalance(telegramUserId: number): Promise<number> {
    try {
      const wallet = await this.getUserWallet(telegramUserId);
      if (!wallet) return 0;

      // For now, return mock balance since Privy Solana balance method may not be available
      // In production, this would fetch real balance from Solana RPC
      return 0.5; // Mock balance for testing
    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return 0;
    }
  }

  /**
   * Send SOL transaction (placeholder for trading)
   */
  async sendTransaction(
    telegramUserId: number,
    transaction: any
  ): Promise<string> {
    try {
      const wallet = await this.getUserWallet(telegramUserId);
      if (!wallet) {
        throw new Error('User wallet not found');
      }

      // For now, return mock transaction signature
      // In production, this would use Privy's transaction methods
      return 'mock_signature_' + Date.now();
    } catch (error) {
      console.error('Failed to send transaction:', error);
      throw error;
    }
  }

  /**
   * Check if user has a wallet
   */
  async hasWallet(telegramUserId: number): Promise<boolean> {
    try {
      const wallet = await this.getUserWallet(telegramUserId);
      return wallet !== null;
    } catch (error) {
      console.error('Failed to check wallet existence:', error);
      return false;
    }
  }

  /**
   * Create complete user setup (user + wallet)
   */
  async createCompleteUserSetup(telegramUserId: number): Promise<{
    user: PrivyUser;
    wallet: PrivyWallet;
    isNewUser: boolean;
    isNewWallet: boolean;
  }> {
    try {
      let user = await this.getUserByTelegramId(telegramUserId);
      let isNewUser = false;
      let isNewWallet = false;

      if (!user) {
        // Create new user if doesn't exist
        user = await this.createUser(telegramUserId);
        isNewUser = true;
      }

      // Check if user already has wallet
      if (user.walletId) {
        const wallet = await this.getUserWallet(telegramUserId);
        if (wallet) {
          return { user, wallet, isNewUser, isNewWallet: false };
        }
      }

      // Create new wallet for user
      const wallet = await this.createWallet(user.id);
      isNewWallet = true;

      // Update user with wallet info
      user.walletId = wallet.id;
      user.walletAddress = wallet.address;

      return { user, wallet, isNewUser, isNewWallet };
    } catch (error) {
      console.error('Failed to create complete user setup:', error);
      throw error;
    }
  }

  /**
   * Get wallet address for user
   */
  async getWalletAddress(telegramUserId: number): Promise<string | undefined> {
    try {
      const wallet = await this.getUserWallet(telegramUserId);
      return wallet?.address || undefined;
    } catch (error) {
      console.error('Failed to get wallet address:', error);
      return undefined;
    }
  }

  /**
   * Get wallet private key for transaction signing
   * This requires authorization key to be configured
   */
  async getWalletPrivateKey(telegramUserId: number): Promise<string | null> {
    try {
      if (!this.authorizationKey) {
        throw new Error('Authorization key not configured');
      }

      const user = await this.getUserByTelegramId(telegramUserId);
      if (!user || !user.walletId) {
        throw new Error('User wallet not found');
      }

      // Get wallet private key from Privy
      // Note: This requires the authorization key to be properly configured
      const wallet = await this.privyClient.wallets().get(user.walletId);
      
      // For Solana wallets, we need to get the private key
      // This is a placeholder - actual implementation depends on Privy's API
      console.log(`🔑 Getting private key for wallet: ${wallet.address}`);
      
      // TODO: Implement actual private key retrieval from Privy
      // This might require using Privy's export functionality or authorization
      return null; // Placeholder - will be implemented when Privy API details are available
    } catch (error) {
      console.error('Failed to get wallet private key:', error);
      return null;
    }
  }

  /**
   * Validate if authorization key is configured
   */
  isAuthorizationConfigured(): boolean {
    return !!this.authorizationKey;
  }

  /**
   * Get authorization status for user
   */
  async getAuthorizationStatus(telegramUserId: number): Promise<{
    hasWallet: boolean;
    canTrade: boolean;
    walletAddress?: string;
    balance?: number;
  }> {
    try {
      const hasWallet = await this.hasWallet(telegramUserId);
      
      if (!hasWallet) {
        return { hasWallet: false, canTrade: false };
      }

      const walletAddress = await this.getWalletAddress(telegramUserId);
      const balance = await this.getWalletBalance(telegramUserId);
      const canTrade = this.isAuthorizationConfigured();

      return {
        hasWallet: true,
        canTrade,
        walletAddress,
        balance,
      };
    } catch (error) {
      console.error('Failed to get authorization status:', error);
      return { hasWallet: false, canTrade: false };
    }
  }
}

// Singleton instance
export const privyService = new PrivyService();
