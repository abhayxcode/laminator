/**
 * Privy Signing Service
 * Handles transaction signing using Privy embedded wallets
 */

import { Transaction, Connection, Keypair, TransactionInstruction } from '@solana/web3.js';
import { privyService } from './privyService';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  onRetry?: (attempt: number) => void | Promise<void>;
}

export class PrivySigningService {
  /**
   * Sign transaction using Privy embedded wallet
   * Uses Privy's transaction signing API which requires authorization key for bot-controlled wallets
   */
  async signTransaction(
    telegramUserId: number,
    transaction: Transaction,
    connection: Connection
  ): Promise<Transaction> {
    try {
      console.log(`🔐 Signing transaction for user ${telegramUserId}...`);

      // Validate transaction object
      if (!transaction.instructions || !Array.isArray(transaction.instructions)) {
        throw new Error(`Invalid transaction object - instructions is ${typeof transaction.instructions}. Expected Transaction object with instructions array.`);
      }

      // Ensure transaction has recent blockhash and fee payer
      if (!transaction.recentBlockhash) {
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
      }

      // Get user's wallet address to set as fee payer
      const wallet = await privyService.getUserWallet(telegramUserId);
      if (!wallet) {
        throw new Error('User wallet not found');
      }

      const { PublicKey } = await import('@solana/web3.js');
      if (!transaction.feePayer) {
        transaction.feePayer = new PublicKey(wallet.address);
      }

      // Remove any non-fee-payer signers from the transaction before sending to Privy
      // Only the fee payer (user wallet) should be a signer
      if (transaction.signatures && transaction.signatures.length > 0) {
        const feePayerPubkey = transaction.feePayer;
        transaction.signatures = transaction.signatures.filter(
          sig => sig.publicKey.equals(feePayerPubkey!)
        );
        // Ensure fee payer is in signatures array if it wasn't already
        const hasFeePayer = transaction.signatures.some(
          sig => sig.publicKey.equals(feePayerPubkey!)
        );
        if (!hasFeePayer && feePayerPubkey) {
          transaction.signatures.push({
            publicKey: feePayerPubkey,
            signature: null
          });
        }
      }

      // Serialize the transaction for Privy
      // Privy expects the full transaction in wire format
      const serializedTx = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      const base64Tx = serializedTx.toString('base64');

      // Sign using Privy's API (requires authorization key for bot-controlled wallets)
      const signedTxBase64 = await privyService.signTransaction(telegramUserId, base64Tx);

      // Deserialize the signed transaction
      const signedTxBuffer = Buffer.from(signedTxBase64, 'base64');
      const signedTransaction = Transaction.from(signedTxBuffer);

      // Rebuild transaction to remove any unsigned signers (authorization key)
      // Extract only signed signatures and rebuild transaction with only fee payer as signer
      const feePayerPubkey = signedTransaction.feePayer;
      if (!feePayerPubkey) {
        throw new Error('Fee payer not found in signed transaction');
      }

      // Find the fee payer signature
      const feePayerSig = signedTransaction.signatures?.find(s => s.publicKey.equals(feePayerPubkey));
      if (!feePayerSig || !feePayerSig.signature) {
        throw new Error(`Fee payer ${feePayerPubkey.toBase58()} signature is missing after Privy signing`);
      }

      // Fix instruction keys: ensure ONLY fee payer is a signer
      // Remove isSigner flag from all other accounts in instructions
      const fixedInstructions = signedTransaction.instructions.map(ix => {
        const fixedKeys = ix.keys.map(key => ({
          pubkey: key.pubkey,
          isSigner: key.pubkey.equals(feePayerPubkey), // Only fee payer can be a signer
          isWritable: key.isWritable,
        }));
        return new TransactionInstruction({
          keys: fixedKeys,
          programId: ix.programId,
          data: ix.data,
        });
      });

      // Rebuild transaction with only the fee payer as signer
      // This removes the authorization key and any other non-fee-payer signers completely
      const cleanedTransaction = new Transaction();
      cleanedTransaction.feePayer = feePayerPubkey;
      cleanedTransaction.recentBlockhash = signedTransaction.recentBlockhash;
      cleanedTransaction.instructions = fixedInstructions;

      // Add only the fee payer signature
      cleanedTransaction.addSignature(feePayerPubkey, feePayerSig.signature);
      return cleanedTransaction;
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
      const signedTx = await this.signTransaction(telegramUserId, transaction, connection);

      // Send transaction with proper signature verification
      const signature = await connection.sendRawTransaction(
        signedTx.serialize({
          requireAllSignatures: false,
          verifySignatures: true
        }),
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

  /**
   * Sign and send transaction with automatic retry
   */
  async signAndSendTransactionWithRetry(
    telegramUserId: number,
    transaction: Transaction,
    connection: Connection,
    options: RetryOptions = {}
  ): Promise<string> {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      onRetry
    } = options;

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Sign transaction
        const signedTx = await this.signTransaction(telegramUserId, transaction, connection);

        // Send transaction with proper signature verification
        const signature = await connection.sendRawTransaction(
          signedTx.serialize({
            requireAllSignatures: false,
            verifySignatures: true
          }),
          {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          }
        );

        console.log(`📡 Transaction sent: ${signature}`);

        // Confirm transaction
        await connection.confirmTransaction(signature, 'confirmed');

        console.log(`✅ Transaction confirmed: ${signature}`);
        return signature;

      } catch (error: any) {
        lastError = error;

        // Log error details for SendTransactionError (only on final attempt)
        if (attempt === maxRetries && (error?.constructor?.name === 'SendTransactionError' || error?.transactionLogs)) {
          console.error(`❌ Transaction failed: ${error?.message || error?.transactionMessage}`);
          if (error?.transactionLogs && Array.isArray(error.transactionLogs)) {
            // Only log critical errors from logs
            const criticalErrors = error.transactionLogs.filter((log: string) => 
              log.includes('Error') || log.includes('failed') || log.includes('AnchorError')
            );
            if (criticalErrors.length > 0) {
              console.error(`   Errors:`, criticalErrors);
            }
          }
        }

        // Check if retryable
        const isRetryable = this.isRetryableError(error);
        const shouldRetry = attempt < maxRetries && isRetryable;

        if (!shouldRetry) {
          throw error;
        }

        // Calculate backoff
        const delay = baseDelay * Math.pow(2, attempt);

        console.log(`⚠️ Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);

        // Call retry callback
        if (onRetry) {
          await onRetry(attempt + 1);
        }

        // Wait before retry
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryableError(error: any): boolean {
    const msg = error?.message?.toLowerCase() || '';
    
    return (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('rpc') ||
      msg.includes('429')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const privySigningService = new PrivySigningService();
