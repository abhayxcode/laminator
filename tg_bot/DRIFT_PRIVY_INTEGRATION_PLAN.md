# Implementation Plan: Embedded Privy Wallet + Server-Side Transaction Signing

## Overview
Implement full transaction execution flow using Privy's server-side signing API with automatic retry logic. Users confirm in Telegram, bot handles signing and submission automatically.

---

## Phase 1: Critical Bug Fixes

### 1.1 Fix Database Field Mismatch
**Files to modify:**
- `src/handlers/drift/depositHandler.ts:200`
- `src/handlers/drift/openPositionHandler.ts:282`
- `src/handlers/drift/closePositionHandler.ts:245`

**Change:** Replace `w.blockchain === 'SOLANA'` with `w.chainType === 'SOLANA'`

**Reason:** Database schema uses `chainType` field, not `blockchain`. This is causing "Solana wallet not found" errors.

---

## Phase 2: Privy Server-Side Signing Integration

### 2.1 Update `src/services/privyService.ts`

**Add new methods:**

#### `signTransactionServerSide(privyWalletId: string, transaction: Transaction)`
- Sign transaction via Privy API
- Serialize Solana transaction to base64
- Send to Privy `/wallets/{wallet_id}/sign_transaction` endpoint
- Parse and return signed transaction

#### `submitTransaction(privyWalletId: string, signedTx: Transaction)`
- Submit signed transaction to Solana
- Return transaction signature
- Handle submission errors

#### `signAndSubmitTransaction(privyWalletId: string, transaction: Transaction)`
- Combined method for sign + submit
- One-step operation for handlers

#### `waitForConfirmation(signature: string, commitment?: Commitment)`
- Poll Solana for transaction confirmation
- Timeout after 60 seconds
- Return confirmation status

**Implementation approach:**
```typescript
// Privy API integration pattern
const response = await privyClient.post(
  `/v1/wallets/${privyWalletId}/sign_transaction`,
  {
    transaction: transaction.serialize().toString('base64'),
    network: 'solana',
    commitment: 'confirmed'
  },
  {
    headers: {
      'Authorization': `Bearer ${process.env.PRIVY_APP_SECRET}`,
      'privy-app-id': process.env.PRIVY_APP_ID
    }
  }
);
```

**Remove/deprecate:**
- `getWalletPrivateKey()` method (no longer needed)
- `sendTransaction()` mock implementation

---

### 2.2 Refactor `src/services/privySigningService.ts`

**Update existing methods:**

#### `signTransaction(telegramUserId: string, transaction: Transaction)`
- Remove private key retrieval logic
- Call `privyService.signTransactionServerSide()` instead
- Use Privy wallet ID from database

#### `signAndSendTransaction(telegramUserId: string, transaction: Transaction)`
- Call `privyService.signAndSubmitTransaction()` instead
- Wrap with retry logic
- Return transaction signature

**Add retry logic wrapper:**

```typescript
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorType = classifyError(error);

      // Don't retry user errors or invalid transactions
      if (attempt === maxRetries || !isRetryable(errorType)) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

**Retry logic rules:**
- Exponential backoff: `delay = baseDelay * 2^attempt`
- Retry on: RPC errors, timeout errors, network errors
- Don't retry on: Insufficient balance, invalid transaction, user errors
- Log each attempt with attempt number and error details
- Max 3 retries before giving up

---

## Phase 3: Transaction Execution Updates

### 3.1 Update `src/handlers/drift/depositHandler.ts`

**In `executeDeposit()` function (lines 184-287):**

**Changes:**
1. Fix line 200: Change `w.blockchain` to `w.chainType`
2. Add loading message before transaction:
   ```typescript
   await bot.sendMessage(chatId, '⏳ Building and signing transaction...');
   ```
3. Wrap signing call with retry logic:
   ```typescript
   const signature = await executeWithRetry(() =>
     privySigningService.signAndSendTransaction(telegramUserId, transaction)
   );
   ```
4. Update success message with Solscan link:
   ```typescript
   await bot.sendMessage(chatId,
     `✅ Deposit successful!\n\n` +
     `Amount: ${amount} ${tokenSymbol}\n` +
     `Transaction: https://solscan.io/tx/${signature}\n\n` +
     `Your collateral will be available shortly.`
   );
   ```
5. Add detailed error handling:
   ```typescript
   catch (error) {
     const errorType = classifyError(error);
     const userMessage = getUserFriendlyMessage(errorType);
     await bot.sendMessage(chatId, `❌ ${userMessage}`);
     console.error('Deposit failed:', error);
   } finally {
     sessionManager.clearUserFlow(chatId);
   }
   ```

---

### 3.2 Update `src/handlers/drift/openPositionHandler.ts`

**In `executeOpenPosition()` function (lines 262-352):**

**Changes:**
1. Fix line 282: Change `w.blockchain` to `w.chainType`
2. Add position validation before transaction:
   ```typescript
   const collateral = await driftService.getDriftCollateralUSDC(walletAddress);
   if (collateral < sizeUSD * 0.1) {
     throw new Error('Insufficient collateral for position');
   }
   ```
3. Add loading message:
   ```typescript
   await bot.sendMessage(chatId, '⏳ Opening position...');
   ```
4. Wrap signing call with retry logic
5. Update success message with details:
   ```typescript
   await bot.sendMessage(chatId,
     `✅ Position opened!\n\n` +
     `Market: ${marketSymbol}\n` +
     `Direction: ${direction === 'long' ? '📈 Long' : '📉 Short'}\n` +
     `Size: $${sizeUSD}\n` +
     `Type: ${orderType}\n` +
     `Transaction: https://solscan.io/tx/${signature}\n\n` +
     `Use /positions to view your open positions.`
   );
   ```
6. Clear session on completion

---

### 3.3 Update `src/handlers/drift/closePositionHandler.ts`

**In `executeClosePosition()` function (lines 219-309):**

**Changes:**
1. Fix line 245: Change `w.blockchain` to `w.chainType`
2. Add loading message:
   ```typescript
   await bot.sendMessage(chatId, '⏳ Closing position...');
   ```
3. Wrap signing call with retry logic
4. Calculate realized PnL:
   ```typescript
   const pnlPercentage = (closePercentage / 100);
   const realizedPnL = position.unrealizedPnl * pnlPercentage;
   const pnlEmoji = realizedPnL >= 0 ? '📈' : '📉';
   ```
5. Update success message with PnL:
   ```typescript
   await bot.sendMessage(chatId,
     `✅ Position closed!\n\n` +
     `Market: ${position.market}\n` +
     `Closed: ${closePercentage}%\n` +
     `Realized PnL: ${pnlEmoji} $${realizedPnL.toFixed(2)}\n` +
     `Transaction: https://solscan.io/tx/${signature}`
   );
   ```
6. Clear session on completion

---

## Phase 4: Error Handling & Resilience

### 4.1 Create `src/utils/transactionErrors.ts`

**New utility file for error classification:**

```typescript
export enum TransactionErrorType {
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  NETWORK_ERROR = 'network_error',
  RPC_ERROR = 'rpc_error',
  PRIVY_ERROR = 'privy_error',
  INVALID_TRANSACTION = 'invalid_transaction',
  TIMEOUT = 'timeout',
  SLIPPAGE_EXCEEDED = 'slippage_exceeded',
  UNKNOWN = 'unknown'
}

export function classifyError(error: any): TransactionErrorType {
  const errorMessage = error?.message?.toLowerCase() || '';

  if (errorMessage.includes('insufficient')) {
    return TransactionErrorType.INSUFFICIENT_BALANCE;
  }
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return TransactionErrorType.TIMEOUT;
  }
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return TransactionErrorType.NETWORK_ERROR;
  }
  if (errorMessage.includes('rpc') || errorMessage.includes('429')) {
    return TransactionErrorType.RPC_ERROR;
  }
  if (errorMessage.includes('privy') || errorMessage.includes('authorization')) {
    return TransactionErrorType.PRIVY_ERROR;
  }
  if (errorMessage.includes('invalid') || errorMessage.includes('simulation failed')) {
    return TransactionErrorType.INVALID_TRANSACTION;
  }
  if (errorMessage.includes('slippage')) {
    return TransactionErrorType.SLIPPAGE_EXCEEDED;
  }

  return TransactionErrorType.UNKNOWN;
}

export function getRetryableErrors(): TransactionErrorType[] {
  return [
    TransactionErrorType.NETWORK_ERROR,
    TransactionErrorType.RPC_ERROR,
    TransactionErrorType.TIMEOUT
  ];
}

export function isRetryable(errorType: TransactionErrorType): boolean {
  return getRetryableErrors().includes(errorType);
}

export function getUserFriendlyMessage(errorType: TransactionErrorType): string {
  switch (errorType) {
    case TransactionErrorType.INSUFFICIENT_BALANCE:
      return 'Insufficient balance. Please deposit more funds and try again.';
    case TransactionErrorType.NETWORK_ERROR:
      return 'Network error. Transaction failed after retries. Please try again.';
    case TransactionErrorType.RPC_ERROR:
      return 'RPC error. Solana network may be congested. Please try again.';
    case TransactionErrorType.PRIVY_ERROR:
      return 'Wallet service error. Please contact support if this persists.';
    case TransactionErrorType.INVALID_TRANSACTION:
      return 'Invalid transaction. Please check your inputs and try again.';
    case TransactionErrorType.TIMEOUT:
      return 'Transaction timeout. Please check Solscan for status.';
    case TransactionErrorType.SLIPPAGE_EXCEEDED:
      return 'Price moved too much. Please try again with larger slippage tolerance.';
    default:
      return 'Transaction failed. Please try again or contact support.';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

### 4.2 Update Error Handling in All Handlers

**Pattern to implement in all transaction handlers:**

```typescript
try {
  // Transaction building and execution
  const signature = await executeWithRetry(() =>
    privySigningService.signAndSendTransaction(telegramUserId, transaction)
  );

  // Success handling
  await bot.sendMessage(chatId, successMessage);

} catch (error) {
  // Classify error
  const errorType = classifyError(error);

  // Get user-friendly message
  const userMessage = getUserFriendlyMessage(errorType);

  // Send to user
  await bot.sendMessage(chatId, `❌ ${userMessage}`);

  // Log detailed error for debugging
  console.error(`Transaction failed [${errorType}]:`, {
    telegramUserId,
    error: error?.message,
    stack: error?.stack
  });

} finally {
  // Always clear session
  sessionManager.clearUserFlow(chatId);
}
```

**Benefits:**
- Consistent error handling across all operations
- User-friendly error messages
- Detailed logging for debugging
- Automatic retry on transient failures
- Clean session management

---

## Phase 5: Transaction Tracking (Optional Enhancement)

### 5.1 Update Database Schema

**Add to `prisma/schema.prisma` Transaction model:**

```prisma
model Transaction {
  // ... existing fields ...

  // New fields for retry tracking
  retry_count     Int       @default(0)
  error_message   String?
  error_type      String?

  // ... rest of model ...
}
```

**Run migration:**
```bash
npx prisma migrate dev --name add_transaction_retry_tracking
```

---

### 5.2 Save Transaction Records

**Update transaction handlers to save records:**

```typescript
// Before submission
const txRecord = await databaseService.createTransaction({
  userId: user.id,
  walletId: wallet.id,
  type: 'DEPOSIT', // or 'OPEN_POSITION', 'CLOSE_POSITION'
  status: 'PENDING',
  amount: amount.toString(),
  metadata: { tokenSymbol, marketSymbol, etc }
});

try {
  // Execute with retry
  const signature = await executeWithRetry(async (attemptNumber) => {
    // Update retry count
    if (attemptNumber > 0) {
      await databaseService.updateTransaction(txRecord.id, {
        retry_count: attemptNumber
      });
    }

    return await privySigningService.signAndSendTransaction(
      telegramUserId,
      transaction
    );
  });

  // Update on success
  await databaseService.updateTransaction(txRecord.id, {
    status: 'CONFIRMED',
    transaction_hash: signature,
    confirmed_at: new Date()
  });

} catch (error) {
  // Update on failure
  const errorType = classifyError(error);
  await databaseService.updateTransaction(txRecord.id, {
    status: 'FAILED',
    error_message: error?.message,
    error_type: errorType
  });

  throw error;
}
```

**Benefits:**
- Full audit trail of all transactions
- Retry count tracking for monitoring
- Error analytics for debugging
- User transaction history

---

## Key Implementation Details

### Privy API Integration Pattern

**Expected Privy API structure** (adapt based on actual documentation):

```typescript
// In privyService.ts
async signTransactionServerSide(
  privyWalletId: string,
  transaction: Transaction
): Promise<Transaction> {
  try {
    // Serialize transaction
    const serializedTx = transaction.serialize().toString('base64');

    // Call Privy API
    const response = await this.privyClient.post(
      `/v1/wallets/${privyWalletId}/sign_transaction`,
      {
        transaction: serializedTx,
        network: 'solana',
        commitment: 'confirmed'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PRIVY_APP_SECRET}`,
          'privy-app-id': process.env.PRIVY_APP_ID
        }
      }
    );

    // Deserialize signed transaction
    const signedTxBuffer = Buffer.from(response.data.signedTransaction, 'base64');
    const signedTx = Transaction.from(signedTxBuffer);

    return signedTx;

  } catch (error) {
    console.error('Privy signing failed:', error);
    throw new Error(`Failed to sign transaction via Privy: ${error?.message}`);
  }
}
```

---

### Retry Logic Pattern

**Complete retry implementation:**

```typescript
// In privySigningService.ts or utils/retry.ts
interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  onRetry?: (attempt: number, error: any) => void;
}

async function executeWithRetry<T>(
  fn: (attemptNumber: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    onRetry
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Execute function with attempt number
      return await fn(attempt);

    } catch (error) {
      lastError = error;

      // Classify error
      const errorType = classifyError(error);

      // Check if we should retry
      const shouldRetry = attempt < maxRetries && isRetryable(errorType);

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);

      // Log retry attempt
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
        errorType,
        errorMessage: error?.message
      });

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript requires it
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Files Summary

### Files to Modify:
1. ✏️ `src/handlers/drift/depositHandler.ts` - Fix bug + add retry + error handling
2. ✏️ `src/handlers/drift/openPositionHandler.ts` - Fix bug + add retry + error handling
3. ✏️ `src/handlers/drift/closePositionHandler.ts` - Fix bug + add retry + error handling
4. ✏️ `src/services/privyService.ts` - Add server-side signing methods
5. ✏️ `src/services/privySigningService.ts` - Refactor to use Privy API + retry logic

### Files to Create:
6. ➕ `src/utils/transactionErrors.ts` - Error classification and handling utilities
7. ➕ `src/utils/retry.ts` (optional) - Reusable retry logic utilities

### Files to Update (Optional):
8. 📝 `prisma/schema.prisma` - Add transaction retry tracking fields
9. 📝 `.env` - Verify Privy credentials (PRIVY_APP_ID, PRIVY_APP_SECRET)

---

## Environment Variables Required

Ensure these are set in `.env`:

```bash
# Privy Configuration
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# Solana Configuration
RPC_URL=your_solana_rpc_endpoint

# Telegram Bot
BOT_TOKEN=your_telegram_bot_token

# Database (optional)
DATABASE_URL=postgresql://...

# Server Wallet (for API)
PRIVATE_KEY=your_server_wallet_private_key
API_PORT=3000
```

---

## Success Criteria

✅ **Deposit Flow**
- Users can deposit USDC/SOL/USDT successfully
- Transactions signed via Privy server-side API
- Users receive Solscan transaction link

✅ **Open Position Flow**
- Users can open long/short positions
- Position size validated before execution
- Success message shows position details

✅ **Close Position Flow**
- Users can close positions (partial or full)
- Realized PnL calculated and displayed
- Transaction confirmed on-chain

✅ **Error Handling**
- Transactions retry automatically on transient failures (3 attempts)
- User-friendly error messages for all failure types
- Sessions cleared properly on success and failure

✅ **Reliability**
- Exponential backoff prevents RPC rate limiting
- No private key exposure (server-side signing only)
- Comprehensive error logging for debugging

---

## Estimated Timeline

- **Phase 1** (Bug Fixes): 5 minutes
- **Phase 2** (Privy Integration): 30-45 minutes
- **Phase 3** (Handler Updates): 20-30 minutes
- **Phase 4** (Error Handling): 15-20 minutes
- **Phase 5** (Transaction Tracking): 10 minutes (optional)

**Total Development Time: ~80-110 minutes**

---

## Next Steps After Implementation

1. **Deploy to staging environment** for initial testing
2. **Test with small amounts** (0.01 USDC deposits)
3. **Monitor Privy API logs** for any signing issues
4. **Verify transactions on Solscan** for correctness
5. **Collect user feedback** on error messages and UX
6. **Monitor retry rates** to optimize retry logic
7. **Add transaction history command** (`/transactions`) for user visibility

---

## Notes

- All transaction signing happens server-side via Privy API
- No private keys are stored or exposed in the bot
- Users only need to confirm actions in Telegram
- Automatic retry logic handles network issues transparently
- Full audit trail maintained in database for compliance
