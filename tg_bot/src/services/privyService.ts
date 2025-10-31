import { PrivyClient } from '@privy-io/node';
import { isEmbeddedWalletLinkedAccount } from '@privy-io/node';

export interface PrivyWallet {
  id: string;
  address: string;
  chainType: 'solana'; // Solana-only - no Ethereum/EVM support
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
  private authorizationKey: string;
  private authorizationPrivateKey: string;

  constructor() {
    // Validate all required environment variables
    if (!process.env.PRIVY_APP_ID) {
      throw new Error('PRIVY_APP_ID environment variable is required');
    }
    if (!process.env.PRIVY_APP_SECRET) {
      throw new Error('PRIVY_APP_SECRET environment variable is required');
    }
    // Support both old and new env var names for backward compatibility
    const keyQuorumId = process.env.PRIVY_KEY_QUORUM_ID || process.env.PRIVY_AUTHORIZATION_KEY;
    const privateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    
    if (!keyQuorumId) {
      throw new Error('PRIVY_KEY_QUORUM_ID or PRIVY_AUTHORIZATION_KEY environment variable is required');
    }
    if (!privateKey) {
      throw new Error('PRIVY_AUTHORIZATION_PRIVATE_KEY environment variable is required (base64 PKCS8 private key)');
    }

    // Key quorum ID is the signer ID, private key is used to sign requests
    this.authorizationKey = keyQuorumId;
    this.authorizationPrivateKey = privateKey;

    // Initialize Privy client
    // For @privy-io/node v0.3.0, authorization context is passed per-request
    this.privyClient = new PrivyClient({
      appId: process.env.PRIVY_APP_ID,
      appSecret: process.env.PRIVY_APP_SECRET,
    });
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
   * Create a server-owned Solana wallet for Telegram bot users
   * Fully controlled by the server (no user session required)
   *
   * Server wallets MUST specify the authorization key as the owner to enable server-side signing
   * The authorization key (key quorum) is used to sign transactions without user session
   *
   * Reference: https://docs.privy.io/wallets/wallets/create/create-a-wallet
   */
  async createWallet(userId: string): Promise<PrivyWallet> {
    try {
      if (!this.authorizationKey || !this.authorizationPrivateKey) {
        throw new Error('Authorization not configured - required for server-owned wallets');
      }

      // Create server-owned Solana wallet with authorization key as owner
      // This enables signing transactions using the authorization private key
      // The owner_id is the key quorum ID from the Privy dashboard
      const wallet = await this.privyClient.wallets().create({
        chain_type: 'solana',
        owner_id: this.authorizationKey,
      });

      return {
        id: wallet.id,
        address: wallet.address,
        chainType: 'solana',
        createdAt: new Date(wallet.created_at),
        isActive: true,
      };
    } catch (error) {
      console.error('Failed to create dual-owned wallet:', error);
      throw error;
    }
  }

  /**
   * Get user's wallet by Telegram user ID
   * For server-owned wallets, retrieves wallet ID from database since they're not in linked_accounts
   */
  async getUserWallet(telegramUserId: number): Promise<PrivyWallet | null> {
    try {
      // Import database service to get wallet ID
      const { databaseService } = await import('./databaseService');

      // Get user and wallet from database (server-owned wallets are stored here)
      const dbUser = await databaseService.getUserByTelegramId(telegramUserId);
      if (!dbUser || !dbUser.wallets || dbUser.wallets.length === 0) {
        console.log(`No wallet found in database for user ${telegramUserId}`);
        return null;
      }

      const dbWallet = dbUser.wallets[0]; // Get first wallet
      const privyWalletId = dbWallet.privyWalletId;

      if (!privyWalletId) {
        console.log(`No Privy wallet ID found for user ${telegramUserId}`);
        return null;
      }

      // Get wallet details from Privy
      const wallet = await this.privyClient.wallets().get(privyWalletId);

      console.log(`✅ Retrieved server-owned wallet ${wallet.id} for user ${telegramUserId}`);

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
   * Get wallet balance (SOL) from Solana chain
   */
  async getWalletBalance(telegramUserId: number): Promise<number> {
    try {
      const wallet = await this.getUserWallet(telegramUserId);
      if (!wallet) return 0;

      // Import Solana connection from driftService
      const { driftService } = await import('./driftService');
      const { PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      
      const connection = (driftService as any).connection;
      const publicKey = new PublicKey(wallet.address);
      const lamports = await connection.getBalance(publicKey, 'confirmed');
      return lamports / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return 0;
    }
  }

  /**
   * Check if wallet has minimum balance (e.g., > 0.001 SOL)
   */
  async hasMinimumBalance(telegramUserId: number, minBalance: number = 0.001): Promise<boolean> {
    try {
      const balance = await this.getWalletBalance(telegramUserId);
      return balance >= minBalance;
    } catch (error) {
      console.error('Failed to check minimum balance:', error);
      return false;
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
   * Sign a transaction using server-owned Privy wallet
   * Uses the official Privy Node.js SDK for transaction signing
   * Documentation: https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction
   *
   * For @privy-io/node v0.3.0: authorization_context must be passed per-request
   * For server-owned wallets: wallets created without owner can be signed by the app
   *
   * @param telegramUserId - Telegram user ID
   * @param serializedTransaction - Base64 encoded serialized transaction
   * @returns Base64 encoded signed transaction
   */
  async signTransaction(
    telegramUserId: number,
    serializedTransaction: string
  ): Promise<string> {
    try {
      if (!this.authorizationKey || !this.authorizationPrivateKey) {
        throw new Error(
          'Authorization not configured.\n\n' +
          'Server-owned wallets require:\n' +
          '  • PRIVY_KEY_QUORUM_ID - The key quorum ID from Privy Dashboard\n' +
          '  • PRIVY_AUTHORIZATION_PRIVATE_KEY - Base64 PKCS8 private key'
        );
      }

      console.log(`🔍 Looking up wallet for user ${telegramUserId}...`);

      // Get wallet from database (server wallets are stored in database, not in Privy user linked_accounts)
      const wallet = await this.getUserWallet(telegramUserId);
      if (!wallet) {
        throw new Error(`User wallet not found in database for Telegram user ${telegramUserId}. Please create a wallet first using /create.`);
      }

      console.log(`📝 Found wallet ${wallet.id} at address ${wallet.address}`);
      console.log(`🔐 Signing transaction with authorization key: ${this.authorizationKey}`);

      // Use official Privy Node.js SDK for Solana transaction signing
      const solanaApi = this.privyClient.wallets().solana();

      // For server-owned wallets, pass authorization_context with private key
      // The authorization_private_keys array should contain base64 encoded PKCS8 private keys
      console.log(`📡 Calling Privy signTransaction API...`);
      const result = await solanaApi.signTransaction(
        wallet.id,
        {
          transaction: serializedTransaction,
          authorization_context: {
            authorization_private_keys: [this.authorizationPrivateKey]
          }
        }
      );

      console.log(`✅ Transaction signed successfully by Privy`);

      // Return the signed transaction (base64 encoded)
      return result.signed_transaction;
    } catch (error: any) {
      console.error('Failed to sign transaction with Privy:', error);

      // Provide helpful error messages
      if (error?.status === 401) {
        const errorMsg = error?.error?.error || error?.message || 'Unknown auth error';
        throw new Error(
          `Privy authentication failed (401): ${errorMsg}\n\n` +
          `This usually means:\n` +
          `  • The wallet was not created with the correct owner_id\n` +
          `  • The authorization key/private key is incorrect\n` +
          `  • The authorization private key format is invalid\n\n` +
          `Please verify:\n` +
          `  1. PRIVY_KEY_QUORUM_ID matches the key quorum in Privy Dashboard\n` +
          `  2. PRIVY_AUTHORIZATION_PRIVATE_KEY is a valid base64 PKCS8 private key\n` +
          `  3. The wallet was created with owner_id set to the authorization key`
        );
      }

      throw error;
    }
  }

  /**
   * Get wallet private key for transaction signing (DEPRECATED)
   * Use signTransaction() instead - it uses Privy's API directly
   * This method is kept for backward compatibility but may not work for user-controlled wallets
   */
  async getWalletPrivateKey(telegramUserId: number): Promise<string | null> {
    try {
      if (!this.authorizationKey) {
        // For user-controlled wallets, private key extraction is not supported
        // Users must sign transactions through frontend
        throw new Error('Authorization key not configured. For user-controlled wallets, private key extraction is not supported. Use Privy\'s frontend SDK for transaction signing.');
      }

      // This method is deprecated - use signTransaction() instead
      throw new Error('Direct private key extraction is not supported. Use signTransaction() method instead.');
    } catch (error) {
      console.error('Failed to get wallet private key:', error);
      throw error;
    }
  }

  /**
   * Validate if authorization key is configured
   * Always true for server-controlled wallets (required in constructor)
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
