/**
 * Privy Signing Service
 * Handles transaction signing using Privy embedded wallets
 */

import { Transaction, Connection, Keypair } from '@solana/web3.js';
import { privyService } from './privyService';

export class PrivySigningService {
  /**
   * Sign transaction using Privy embedded wallet
   * Note: Privy signing is handled via user's private key obtained through Privy API
   */
  async signTransaction(
    telegramUserId: number,
    transaction: Transaction
  ): Promise<Transaction> {
    try {
      console.log(`🔐 Signing transaction for user ${telegramUserId} with Privy wallet...`);

      // Get user's private key from Privy
      const privateKey = await privyService.getWalletPrivateKey(telegramUserId);

      if (!privateKey) {
        throw new Error('Private key not available from Privy');
      }

      // Create keypair from private key
      const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));

      // Sign the transaction
      transaction.sign(keypair);

      console.log('✅ Transaction signed successfully with Privy wallet');
      return transaction;
    } catch (error) {
      console.error('❌ Failed to sign transaction with Privy:', error);
      throw error;
    }
  }

  /**
   * Sign and send transaction in one operation
   */
  async signAndSendTransaction(
    telegramUserId: number,
    transaction: Transaction,
    connection: Connection
  ): Promise<string> {
    try {
      console.log(`🚀 Signing and sending transaction for user ${telegramUserId}...`);

      // Sign transaction
      const signedTx = await this.signTransaction(telegramUserId, transaction);

      // Send transaction
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        }
      );

      console.log(`📡 Transaction sent: ${signature}`);

      // Confirm transaction
      await connection.confirmTransaction(signature, 'confirmed');

      console.log(`✅ Transaction confirmed: ${signature}`);
      return signature;
    } catch (error) {
      console.error('❌ Failed to sign and send transaction:', error);
      throw error;
    }
  }
}

export const privySigningService = new PrivySigningService();
