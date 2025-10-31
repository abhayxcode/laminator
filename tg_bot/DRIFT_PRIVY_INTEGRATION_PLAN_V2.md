# Drift + Privy Integration Plan V2
**Updated**: 2025-10-30  
**Status**: Ready for Implementation

---

## Overview

This plan integrates Drift Protocol trading with Privy embedded wallets using a **modular database architecture**:
- **General tables** (`users`, `wallets`, `wallet_balances`) - Shared across all DEX integrations
- **Drift-specific tables** - Dedicated tables for Drift markets, orders, positions, and transactions
- **Privy services** - Reusable wallet creation and signing services following DRY principles

### Key Features
1. ✅ First deposit creates Privy wallet automatically
2. ✅ Wallet controlled by user via Telegram confirmation
3. ✅ Separate Drift tables for clean data isolation
4. ✅ Reusable Privy services for future integrations (Flash, Jupiter, etc.)
5. ✅ Full transaction history and analytics

---

## Phase 1: Database Schema Design

### 1.1 General Tables (Already Exist - Reuse)

These tables are **shared across all integrations** (Drift, Flash, Jupiter):

#### `users` ✅ (No changes needed)
```prisma
model User {
  id                  String      @id @default(uuid())
  telegramId          BigInt      @unique @map("telegram_id")
  telegramUsername    String?     @map("telegram_username")
  telegramFirstName   String?     @map("telegram_first_name")
  telegramLastName    String?     @map("telegram_last_name")
  privyUserId         String?     @unique @map("privy_user_id")
  status              UserStatus  @default(ACTIVE)
  createdAt           DateTime    @default(now()) @map("created_at")
  updatedAt           DateTime    @updatedAt @map("updated_at")
  lastActive          DateTime    @default(now()) @map("last_active")
  metadata            Json        @default("{}") @db.Json

  // Relations
  wallets             Wallet[]
  driftOrders         DriftOrder[]
  driftPositions      DriftPosition[]
  driftTransactions   DriftTransaction[]

  @@index([telegramId])
  @@index([privyUserId])
  @@map("users")
}
```

#### `wallets` ✅ (No changes needed)
```prisma
model Wallet {
  id              String       @id @default(uuid())
  userId          String       @map("user_id")
  privyWalletId   String?      @unique @map("privy_wallet_id")
  walletAddress   String       @unique @map("wallet_address")
  walletType      WalletType   @default(PRIVY) @map("wallet_type")
  chainType       ChainType    @default(SOLANA) @map("chain_type")
  status          WalletStatus @default(ACTIVE)
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")
  metadata        Json         @default("{}") @db.Json

  // Relations
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  walletBalances  WalletBalance[]
  driftOrders     DriftOrder[]
  driftPositions  DriftPosition[]
  driftTransactions DriftTransaction[]

  @@index([userId])
  @@index([walletAddress])
  @@index([privyWalletId])
  @@map("wallets")
}
```

#### `wallet_balances` ✅ (No changes needed)
```prisma
model WalletBalance {
  id               String          @id @default(uuid())
  walletId         String          @map("wallet_id")
  tokenSymbol      String          @map("token_symbol")
  tokenAddress     String?         @map("token_address")
  balance          Decimal         @db.Decimal(36, 18)
  lockedBalance    Decimal         @default(0) @map("locked_balance") @db.Decimal(36, 18)
  availableBalance Decimal         @default(0) @map("available_balance") @db.Decimal(36, 18)
  updatedAt        DateTime        @updatedAt @map("updated_at")

  // Relations
  wallet           Wallet          @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@unique([walletId, tokenSymbol])
  @@index([walletId, tokenSymbol])
  @@index([updatedAt])
  @@map("wallet_balances")
}
```

---

### 1.2 Drift-Specific Tables (NEW)

These tables are **specific to Drift Protocol** and isolated from other DEX data:

#### `drift_markets` (NEW)
```prisma
model DriftMarket {
  id               String       @id @default(uuid())
  marketIndex      Int          @unique @map("market_index")
  symbol           String       @unique
  baseAsset        String       @map("base_asset")
  quoteAsset       String       @default("USD") @map("quote_asset")
  marketType       String       @default("PERPETUAL") @map("market_type") // PERPETUAL, SPOT
  category         String?      // Major, Alt, Meme, etc.
  
  // Market Config
  minOrderSize     Decimal?     @map("min_order_size") @db.Decimal(36, 18)
  maxOrderSize     Decimal?     @map("max_order_size") @db.Decimal(36, 18)
  tickSize         Decimal?     @map("tick_size") @db.Decimal(36, 18)
  stepSize         Decimal?     @map("step_size") @db.Decimal(36, 18)
  maxLeverage      Decimal?     @map("max_leverage") @db.Decimal(8, 2)
  
  // Market State
  oracleSource     String?      @map("oracle_source") // Pyth, Switchboard, etc.
  status           String       @default("ACTIVE") // ACTIVE, INACTIVE, MAINTENANCE
  
  // Metadata
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  metadata         Json         @default("{}") @db.Json

  // Relations
  orders           DriftOrder[]
  positions        DriftPosition[]

  @@index([symbol])
  @@index([marketIndex])
  @@index([status])
  @@map("drift_markets")
}
```

#### `drift_orders` (NEW)
```prisma
model DriftOrder {
  id               String       @id @default(uuid())
  userId           String       @map("user_id")
  walletId         String       @map("wallet_id")
  marketId         String       @map("market_id")
  
  // Drift-specific IDs
  driftOrderId     String?      @map("drift_order_id") // Order ID from Drift protocol
  driftUserAccount String?      @map("drift_user_account") // User's Drift account pubkey
  
  // Order Details
  marketIndex      Int          @map("market_index")
  orderType        String       @map("order_type") // MARKET, LIMIT, STOP_MARKET, STOP_LIMIT
  side             String       // LONG, SHORT
  direction        String       // BUY, SELL (for Drift SDK)
  
  // Amounts
  baseAssetAmount  Decimal      @map("base_asset_amount") @db.Decimal(36, 18)
  price            Decimal?     @db.Decimal(36, 18)
  triggerPrice     Decimal?     @map("trigger_price") @db.Decimal(36, 18)
  
  // Leverage & Margin
  leverage         Decimal      @default(1.0) @db.Decimal(8, 2)
  reduceOnly       Boolean      @default(false) @map("reduce_only")
  postOnly         Boolean      @default(false) @map("post_only")
  
  // Execution Details
  status           String       @default("PENDING") // PENDING, OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, FAILED
  filledAmount     Decimal      @default(0) @map("filled_amount") @db.Decimal(36, 18)
  avgFillPrice     Decimal?     @map("avg_fill_price") @db.Decimal(36, 18)
  totalFees        Decimal      @default(0) @map("total_fees") @db.Decimal(36, 18)
  
  // Timestamps
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  filledAt         DateTime?    @map("filled_at")
  expiresAt        DateTime?    @map("expires_at")
  
  // Metadata
  metadata         Json         @default("{}") @db.Json

  // Relations
  user             User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  wallet           Wallet       @relation(fields: [walletId], references: [id], onDelete: Cascade)
  market           DriftMarket  @relation(fields: [marketId], references: [id])

  @@index([userId, status])
  @@index([walletId])
  @@index([marketId])
  @@index([driftOrderId])
  @@index([createdAt])
  @@map("drift_orders")
}
```

#### `drift_positions` (NEW)
```prisma
model DriftPosition {
  id               String       @id @default(uuid())
  userId           String       @map("user_id")
  walletId         String       @map("wallet_id")
  marketId         String       @map("market_id")
  
  // Drift-specific IDs
  driftUserAccount String?      @map("drift_user_account") // User's Drift account pubkey
  
  // Position Details
  marketIndex      Int          @map("market_index")
  side             String       // LONG, SHORT
  
  // Amounts
  baseAssetAmount  Decimal      @map("base_asset_amount") @db.Decimal(36, 18)
  quoteAssetAmount Decimal      @map("quote_asset_amount") @db.Decimal(36, 18)
  
  // Entry Details
  entryPrice       Decimal      @map("entry_price") @db.Decimal(36, 18)
  lastPrice        Decimal?     @map("last_price") @db.Decimal(36, 18)
  markPrice        Decimal?     @map("mark_price") @db.Decimal(36, 18)
  
  // Leverage & Margin
  leverage         Decimal      @default(1.0) @db.Decimal(8, 2)
  marginAmount     Decimal      @map("margin_amount") @db.Decimal(36, 18)
  
  // PnL Tracking
  unrealizedPnl    Decimal      @default(0) @map("unrealized_pnl") @db.Decimal(36, 18)
  realizedPnl      Decimal      @default(0) @map("realized_pnl") @db.Decimal(36, 18)
  
  // Risk Metrics
  liquidationPrice Decimal?     @map("liquidation_price") @db.Decimal(36, 18)
  
  // Status
  status           String       @default("OPEN") // OPEN, CLOSED, LIQUIDATED
  
  // Timestamps
  openedAt         DateTime     @default(now()) @map("opened_at")
  closedAt         DateTime?    @map("closed_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  
  // Metadata
  metadata         Json         @default("{}") @db.Json

  // Relations
  user             User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  wallet           Wallet       @relation(fields: [walletId], references: [id], onDelete: Cascade)
  market           DriftMarket  @relation(fields: [marketId], references: [id])

  @@unique([userId, marketIndex, status])
  @@index([userId, status])
  @@index([walletId])
  @@index([marketId])
  @@index([status])
  @@map("drift_positions")
}
```

#### `drift_transactions` (NEW)
```prisma
model DriftTransaction {
  id               String       @id @default(uuid())
  userId           String       @map("user_id")
  walletId         String       @map("wallet_id")
  
  // Transaction Details
  txHash           String?      @unique @map("tx_hash")
  txType           String       @map("tx_type") // DEPOSIT, WITHDRAW, OPEN_POSITION, CLOSE_POSITION, LIQUIDATION
  status           String       @default("PENDING") // PENDING, CONFIRMED, FAILED
  
  // Related Records
  orderId          String?      @map("order_id") // Link to drift_orders
  positionId       String?      @map("position_id") // Link to drift_positions
  marketIndex      Int?         @map("market_index")
  
  // Amounts
  amount           Decimal?     @db.Decimal(36, 18)
  tokenSymbol      String?      @map("token_symbol")
  
  // Blockchain Details
  blockNumber      BigInt?      @map("block_number")
  blockTimestamp   DateTime?    @map("block_timestamp")
  gasFee           Decimal?     @map("gas_fee") @db.Decimal(36, 18)
  
  // Retry Tracking
  retryCount       Int          @default(0) @map("retry_count")
  errorMessage     String?      @map("error_message")
  errorType        String?      @map("error_type")
  
  // Timestamps
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")
  confirmedAt      DateTime?    @map("confirmed_at")
  
  // Metadata
  metadata         Json         @default("{}") @db.Json

  // Relations
  user             User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  wallet           Wallet       @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([walletId])
  @@index([txHash])
  @@index([status])
  @@index([txType])
  @@map("drift_transactions")
}
```

---

### 1.3 Migration Commands

```bash
# Create migration
npx prisma migrate dev --name add_drift_specific_tables

# Generate Prisma client
npx prisma generate

# Deploy to production
npx prisma migrate deploy
```

---

## Phase 2: Privy Wallet Creation Flow

### 2.1 First Deposit Flow

**User Journey:**
```
User clicks: /drift → Deposit → USDC → 100
  ↓
Check if user has Privy wallet
  ↓ NO
Create Privy User + Wallet
  ↓
Store in database (users, wallets tables)
  ↓
Check if Drift account initialized
  ↓ NO
Build init + deposit transaction
  ↓ YES
Build deposit transaction
  ↓
Sign with Privy (privySigningService)
  ↓
Submit to Solana
  ↓
Record in drift_transactions table
  ↓
Update wallet_balances table
  ↓
Show success message with explorer link
```

### 2.2 Implementation in depositHandler.ts

**File**: `src/handlers/drift/depositHandler.ts`

```typescript
import TelegramBot from 'node-telegram-bot-api';
import { PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { driftService } from '../../services/driftService';
import { databaseService } from '../../services/databaseService';
import { privyService } from '../../services/privyService';
import { privySigningService } from '../../services/privySigningService';
import { createDriftTransactionService } from '../../services/driftTransactionService';
import { sessionManager, SessionFlow } from '../../state/userSessionManager';
import { SpotMarkets } from '@drift-labs/sdk';

// Token configurations
const DEPOSIT_TOKENS = [
  { symbol: 'USDC', marketIndex: 0, decimals: 6 },
  { symbol: 'SOL', marketIndex: 1, decimals: 9 },
  { symbol: 'USDT', marketIndex: 2, decimals: 6 }
];

export async function handleDeposit(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const action = params[0]; // 'start', 'token', 'confirm', 'cancel'

  try {
    if (!action || action === 'start') {
      await showTokenSelection(bot, chatId, messageId);
    } else if (action === 'token') {
      const tokenIndex = parseInt(params[1]);
      await handleTokenSelection(bot, chatId, messageId, userId, tokenIndex);
    } else if (action === 'confirm') {
      const tokenIndex = parseInt(params[1]);
      const amount = parseFloat(params[2]);
      await executeDeposit(bot, chatId, userId, tokenIndex, amount);
    } else if (action === 'cancel') {
      sessionManager.clearFlow(userId);
      await bot.editMessageText('❌ Deposit cancelled.', {
        chat_id: chatId,
        message_id: messageId
      });
    }
  } catch (error) {
    console.error('Error in deposit handler:', error);
    await bot.sendMessage(chatId, `❌ Deposit failed: ${error.message}`);
  }
}

async function showTokenSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number
): Promise<void> {
  // Start deposit flow
  sessionManager.startFlow(String(chatId), chatId, SessionFlow.DEPOSIT);

  const keyboard = DEPOSIT_TOKENS.map((token, idx) => [{
    text: `${token.symbol}`,
    callback_data: `drift:deposit:token:${idx}`
  }]);
  keyboard.push([{ text: '❌ Cancel', callback_data: 'drift:deposit:cancel' }]);

  await bot.editMessageText(
    '*💰 Deposit to Drift*\n\n' +
    'Select token to deposit:',
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    }
  );
}

async function handleTokenSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  tokenIndex: number
): Promise<void> {
  const token = DEPOSIT_TOKENS[tokenIndex];
  
  // Save to session
  sessionManager.updateData(userId, {
    depositToken: tokenIndex,
    tokenSymbol: token.symbol
  });

  // Request amount input
  await bot.editMessageText(
    `*💰 Deposit ${token.symbol}*\n\n` +
    `Reply with amount:\n\n` +
    `Example: \`100\` for 100 ${token.symbol}`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ Cancel', callback_data: 'drift:deposit:cancel' }
        ]]
      }
    }
  );

  // Set up message listener
  const messageHandler = async (msg: TelegramBot.Message) => {
    if (msg.chat.id !== chatId) return;
    if (!sessionManager.isInFlow(userId, SessionFlow.DEPOSIT)) return;

    const amount = parseFloat(msg.text || '0');
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid amount. Please enter a number > 0.');
      return;
    }

    // Remove listener
    bot.removeListener('message', messageHandler);

    // Show confirmation
    await showDepositConfirmation(bot, chatId, userId, tokenIndex, amount);
  };

  bot.on('message', messageHandler);
}

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
    `Amount: **${amount}**\n` +
    `Destination: **Drift Protocol**\n\n` +
    `⚠️ **First-time users:**\n` +
    `• We'll create your Privy wallet automatically\n` +
    `• Drift account will be initialized (if needed)\n` +
    `• You'll have full control via Telegram\n\n` +
    `Ready to proceed?`;

  const keyboard = [
    [
      { text: '✅ Confirm', callback_data: `drift:deposit:confirm:${tokenIndex}:${amount}` },
      { text: '❌ Cancel', callback_data: 'drift:deposit:cancel' }
    ]
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function executeDeposit(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  tokenIndex: number,
  amount: number
): Promise<void> {
  try {
    const token = DEPOSIT_TOKENS[tokenIndex];
    
    // Step 1: Ensure user has Privy wallet
    await bot.sendMessage(chatId, '🔐 Setting up wallet...');
    
    const { user, wallet } = await ensureUserAndWallet(chatId);
    
    const userPublicKey = new PublicKey(wallet.walletAddress);
    
    // Step 2: Check if Drift account exists
    await bot.sendMessage(chatId, '🔍 Checking Drift account...');
    
    const hasAccount = await driftService.hasUserAccount(userPublicKey);
    
    // Step 3: Get token mint and account
    const spotMarketConfig = SpotMarkets['mainnet-beta'][token.marketIndex];
    const tokenMint = new PublicKey(spotMarketConfig.mint);
    const tokenAccount = getAssociatedTokenAddressSync(tokenMint, userPublicKey);
    
    // Step 4: Build transaction
    await bot.sendMessage(chatId, '⏳ Building transaction...');
    
    const driftClient = await driftService.getDriftClientForMarketData();
    if (!driftClient) throw new Error('Drift client unavailable');
    
    const txService = createDriftTransactionService(driftClient);
    
    const amountBN = new BN(amount * Math.pow(10, token.decimals));
    
    let transaction: Transaction;
    
    if (!hasAccount) {
      await bot.sendMessage(chatId, '🆕 Initializing Drift account...');
      transaction = await txService.buildInitAndDepositTransaction(
        userPublicKey,
        amountBN,
        token.marketIndex,
        tokenMint
      );
    } else {
      transaction = await txService.buildDepositOnlyTransaction(
        userPublicKey,
        amountBN,
        token.marketIndex,
        tokenMint
      );
    }
    
    // Step 5: Create transaction record
    const txRecord = await databaseService.createDriftTransaction({
      userId: user.id,
      walletId: wallet.id,
      txType: 'DEPOSIT',
      status: 'PENDING',
      amount: amount.toString(),
      tokenSymbol: token.symbol,
      marketIndex: token.marketIndex,
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
      driftService.connection,
      {
        onRetry: async (attempt) => {
          await databaseService.updateDriftTransaction(txRecord.id, {
            retryCount: attempt
          });
        }
      }
    );
    
    // Step 7: Update transaction record
    await databaseService.updateDriftTransaction(txRecord.id, {
      status: 'CONFIRMED',
      txHash: signature,
      confirmedAt: new Date()
    });
    
    // Step 8: Update wallet balance
    await databaseService.updateBalance({
      walletId: wallet.id,
      tokenSymbol: token.symbol,
      balance: amount, // Will add to existing balance
      tokenAddress: tokenMint.toBase58()
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
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Deposit error:', error);
    
    // Update transaction record if exists
    const session = sessionManager.getSession(userId, chatId);
    if (session.data?.txRecordId) {
      await databaseService.updateDriftTransaction(session.data.txRecordId, {
        status: 'FAILED',
        errorMessage: error.message,
        errorType: classifyError(error)
      });
    }
    
    sessionManager.clearFlow(userId);
    
    const userMessage = getUserFriendlyErrorMessage(error);
    await bot.sendMessage(chatId, `❌ **Deposit Failed**\n\n${userMessage}`);
  }
}

/**
 * Ensures user exists and has a Privy wallet
 * Creates if needed
 */
async function ensureUserAndWallet(telegramUserId: number): Promise<{
  user: any;
  wallet: any;
}> {
  // Check if user exists
  let user = await databaseService.getUserByTelegramId(telegramUserId);
  
  if (!user) {
    // Create user
    user = await databaseService.createUser({
      telegramId: telegramUserId,
      status: 'ACTIVE'
    });
  }
  
  // Check if user has Privy user ID
  if (!user.privyUserId) {
    // Create Privy user
    const privyUser = await privyService.createUser(telegramUserId);
    
    // Update user record
    user = await databaseService.updateUser(user.id, {
      privyUserId: privyUser.id
    });
  }
  
  // Check if user has wallet
  let wallet = user.wallets?.find(w => w.chainType === 'SOLANA' && w.walletType === 'PRIVY');
  
  if (!wallet) {
    // Create Privy wallet
    const privyWallet = await privyService.createWallet(user.privyUserId);
    
    // Store in database
    wallet = await databaseService.createWallet({
      userId: user.id,
      privyWalletId: privyWallet.id,
      walletAddress: privyWallet.address,
      walletType: 'PRIVY',
      chainType: 'SOLANA',
      status: 'ACTIVE'
    });
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
      return `Error: ${error.message}`;
  }
}
```

---

## Phase 3: Database Service Updates

### 3.1 Create Drift Database Service

**File**: `src/services/driftDatabaseService.ts` (NEW)

```typescript
import { PrismaClient } from '@prisma/client';
import { databaseService } from './databaseService';

const prisma = databaseService.prisma; // Reuse existing Prisma client

/**
 * Drift-specific database operations
 */
class DriftDatabaseService {
  // ============================================
  // MARKETS
  // ============================================

  async createOrUpdateMarket(data: {
    marketIndex: number;
    symbol: string;
    baseAsset: string;
    quoteAsset?: string;
    marketType?: string;
    category?: string;
    minOrderSize?: string;
    maxOrderSize?: string;
    tickSize?: string;
    stepSize?: string;
    maxLeverage?: string;
    oracleSource?: string;
    status?: string;
    metadata?: any;
  }) {
    return await prisma.driftMarket.upsert({
      where: { marketIndex: data.marketIndex },
      update: {
        symbol: data.symbol,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset || 'USD',
        marketType: data.marketType || 'PERPETUAL',
        category: data.category,
        minOrderSize: data.minOrderSize,
        maxOrderSize: data.maxOrderSize,
        tickSize: data.tickSize,
        stepSize: data.stepSize,
        maxLeverage: data.maxLeverage,
        oracleSource: data.oracleSource,
        status: data.status || 'ACTIVE',
        metadata: data.metadata || {},
        updatedAt: new Date()
      },
      create: {
        marketIndex: data.marketIndex,
        symbol: data.symbol,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset || 'USD',
        marketType: data.marketType || 'PERPETUAL',
        category: data.category,
        minOrderSize: data.minOrderSize,
        maxOrderSize: data.maxOrderSize,
        tickSize: data.tickSize,
        stepSize: data.stepSize,
        maxLeverage: data.maxLeverage,
        oracleSource: data.oracleSource,
        status: data.status || 'ACTIVE',
        metadata: data.metadata || {}
      }
    });
  }

  async getMarketByIndex(marketIndex: number) {
    return await prisma.driftMarket.findUnique({
      where: { marketIndex }
    });
  }

  async getAllActiveMarkets() {
    return await prisma.driftMarket.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { symbol: 'asc' }
    });
  }

  // ============================================
  // ORDERS
  // ============================================

  async createOrder(data: {
    userId: string;
    walletId: string;
    marketId: string;
    marketIndex: number;
    orderType: string;
    side: string;
    direction: string;
    baseAssetAmount: string;
    price?: string;
    triggerPrice?: string;
    leverage?: string;
    reduceOnly?: boolean;
    postOnly?: boolean;
    driftOrderId?: string;
    driftUserAccount?: string;
    metadata?: any;
  }) {
    return await prisma.driftOrder.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        marketId: data.marketId,
        marketIndex: data.marketIndex,
        orderType: data.orderType,
        side: data.side,
        direction: data.direction,
        baseAssetAmount: data.baseAssetAmount,
        price: data.price,
        triggerPrice: data.triggerPrice,
        leverage: data.leverage || '1.0',
        reduceOnly: data.reduceOnly || false,
        postOnly: data.postOnly || false,
        driftOrderId: data.driftOrderId,
        driftUserAccount: data.driftUserAccount,
        status: 'PENDING',
        metadata: data.metadata || {}
      }
    });
  }

  async updateOrderStatus(
    orderId: string,
    data: {
      status: string;
      filledAmount?: string;
      avgFillPrice?: string;
      totalFees?: string;
      filledAt?: Date;
    }
  ) {
    return await prisma.driftOrder.update({
      where: { id: orderId },
      data
    });
  }

  async getUserOrders(userId: string, status?: string) {
    return await prisma.driftOrder.findMany({
      where: {
        userId,
        ...(status && { status })
      },
      include: {
        market: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  }

  // ============================================
  // POSITIONS
  // ============================================

  async createPosition(data: {
    userId: string;
    walletId: string;
    marketId: string;
    marketIndex: number;
    side: string;
    baseAssetAmount: string;
    quoteAssetAmount: string;
    entryPrice: string;
    leverage?: string;
    marginAmount: string;
    driftUserAccount?: string;
    metadata?: any;
  }) {
    return await prisma.driftPosition.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        marketId: data.marketId,
        marketIndex: data.marketIndex,
        side: data.side,
        baseAssetAmount: data.baseAssetAmount,
        quoteAssetAmount: data.quoteAssetAmount,
        entryPrice: data.entryPrice,
        leverage: data.leverage || '1.0',
        marginAmount: data.marginAmount,
        driftUserAccount: data.driftUserAccount,
        status: 'OPEN',
        unrealizedPnl: '0',
        realizedPnl: '0',
        metadata: data.metadata || {}
      }
    });
  }

  async updatePosition(
    positionId: string,
    data: {
      lastPrice?: string;
      markPrice?: string;
      unrealizedPnl?: string;
      realizedPnl?: string;
      liquidationPrice?: string;
      status?: string;
      closedAt?: Date;
    }
  ) {
    return await prisma.driftPosition.update({
      where: { id: positionId },
      data
    });
  }

  async getUserPositions(userId: string, status: string = 'OPEN') {
    return await prisma.driftPosition.findMany({
      where: {
        userId,
        status
      },
      include: {
        market: true
      },
      orderBy: { openedAt: 'desc' }
    });
  }

  async getPositionByMarket(userId: string, marketIndex: number) {
    return await prisma.driftPosition.findFirst({
      where: {
        userId,
        marketIndex,
        status: 'OPEN'
      },
      include: {
        market: true
      }
    });
  }

  // ============================================
  // TRANSACTIONS
  // ============================================

  async createTransaction(data: {
    userId: string;
    walletId: string;
    txType: string;
    status?: string;
    orderId?: string;
    positionId?: string;
    marketIndex?: number;
    amount?: string;
    tokenSymbol?: string;
    metadata?: any;
  }) {
    return await prisma.driftTransaction.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        txType: data.txType,
        status: data.status || 'PENDING',
        orderId: data.orderId,
        positionId: data.positionId,
        marketIndex: data.marketIndex,
        amount: data.amount,
        tokenSymbol: data.tokenSymbol,
        retryCount: 0,
        metadata: data.metadata || {}
      }
    });
  }

  async updateTransaction(
    txId: string,
    data: {
      txHash?: string;
      status?: string;
      blockNumber?: string;
      blockTimestamp?: Date;
      gasFee?: string;
      retryCount?: number;
      errorMessage?: string;
      errorType?: string;
      confirmedAt?: Date;
    }
  ) {
    return await prisma.driftTransaction.update({
      where: { id: txId },
      data
    });
  }

  async getUserTransactions(userId: string, limit: number = 50) {
    return await prisma.driftTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getTransactionByHash(txHash: string) {
    return await prisma.driftTransaction.findUnique({
      where: { txHash }
    });
  }
}

export const driftDatabaseService = new DriftDatabaseService();
```

---

## Phase 4: Privy Service Updates (DRY Principle)

### 4.1 Ensure Reusable Privy Service

**File**: `src/services/privyService.ts` (UPDATE - ensure these methods exist)

```typescript
// Ensure these methods are available and working

/**
 * Create Privy user linked to Telegram ID
 */
async createUser(telegramUserId: number): Promise<any> {
  // Implementation should return: { id: string, ... }
}

/**
 * Get Privy user by Telegram ID
 */
async getUserByTelegramId(telegramUserId: number): Promise<any | null> {
  // Implementation
}

/**
 * Create Solana wallet for Privy user
 */
async createWallet(privyUserId: string): Promise<any> {
  // Implementation should return: { id: string, address: string, chainType: 'solana', ... }
}

/**
 * Get user's wallets
 */
async getUserWallets(privyUserId: string): Promise<any[]> {
  // Implementation
}

/**
 * Get wallet address
 */
async getWalletAddress(telegramUserId: number): Promise<string> {
  // Implementation - returns Solana public key string
}

/**
 * One-step setup for new users
 */
async createCompleteUserSetup(telegramUserId: number): Promise<{
  privyUser: any;
  wallet: any;
}> {
  const privyUser = await this.createUser(telegramUserId);
  const wallet = await this.createWallet(privyUser.id);
  
  return { privyUser, wallet };
}
```

### 4.2 Ensure Privy Signing Service with Retry

**File**: `src/services/privySigningService.ts` (UPDATE)

```typescript
import { Transaction, Connection } from '@solana/web3.js';
import { privyService } from './privyService';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  onRetry?: (attempt: number) => void | Promise<void>;
}

export class PrivySigningService {
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
        const signedTx = await this.signTransaction(telegramUserId, transaction);

        // Send transaction
        const signature = await connection.sendRawTransaction(
          signedTx.serialize(),
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

      } catch (error) {
        lastError = error;

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

  /**
   * Sign transaction using Privy wallet
   */
  async signTransaction(
    telegramUserId: number,
    transaction: Transaction
  ): Promise<Transaction> {
    try {
      // Get private key from Privy
      const privateKey = await privyService.getWalletPrivateKey(telegramUserId);

      if (!privateKey) {
        throw new Error('Private key not available from Privy');
      }

      // Import Keypair and sign
      const { Keypair } = await import('@solana/web3.js');
      const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));

      // Sign the transaction
      transaction.sign(keypair);

      console.log('✅ Transaction signed with Privy wallet');
      return transaction;

    } catch (error) {
      console.error('❌ Failed to sign transaction:', error);
      throw error;
    }
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
```

---

## Phase 5: Complete Handler Implementations

### 5.1 Open Position Handler

**File**: `src/handlers/drift/openPositionHandler.ts` (UPDATE)

```typescript
// Add database tracking to executeOpenPosition

async function executeOpenPosition(...) {
  try {
    // ... existing wallet and market setup code ...

    // Create order record BEFORE execution
    const market = await driftDatabaseService.getMarketByIndex(marketIndex);
    if (!market) {
      throw new Error('Market not found in database');
    }

    const orderRecord = await driftDatabaseService.createOrder({
      userId: dbUser.id,
      walletId: wallet.id,
      marketId: market.id,
      marketIndex,
      orderType: 'MARKET',
      side: direction.toUpperCase(),
      direction: direction === 'long' ? 'LONG' : 'SHORT',
      baseAssetAmount: sizeBN.toString(),
      leverage: '1.0', // Default leverage
      metadata: {
        requestedSize: size,
        symbol: marketSymbol
      }
    });

    // Create transaction record
    const txRecord = await driftDatabaseService.createTransaction({
      userId: dbUser.id,
      walletId: wallet.id,
      txType: 'OPEN_POSITION',
      orderId: orderRecord.id,
      marketIndex,
      amount: size.toString(),
      metadata: {
        direction,
        orderType: 'MARKET'
      }
    });

    // ... build transaction ...

    // Sign and send with retry
    const signature = await privySigningService.signAndSendTransactionWithRetry(
      chatId,
      tx,
      driftService.connection,
      {
        onRetry: async (attempt) => {
          await driftDatabaseService.updateTransaction(txRecord.id, {
            retryCount: attempt
          });
        }
      }
    );

    // Update records on success
    await driftDatabaseService.updateTransaction(txRecord.id, {
      status: 'CONFIRMED',
      txHash: signature,
      confirmedAt: new Date()
    });

    await driftDatabaseService.updateOrderStatus(orderRecord.id, {
      status: 'FILLED',
      filledAmount: sizeBN.toString(),
      filledAt: new Date()
    });

    // Create position record
    const positionRecord = await driftDatabaseService.createPosition({
      userId: dbUser.id,
      walletId: wallet.id,
      marketId: market.id,
      marketIndex,
      side: direction.toUpperCase(),
      baseAssetAmount: sizeBN.toString(),
      quoteAssetAmount: (size * currentPrice).toString(),
      entryPrice: currentPrice.toString(),
      marginAmount: (size * currentPrice).toString(), // Simplified
      metadata: {
        orderId: orderRecord.id,
        txHash: signature
      }
    });

    // Success message
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    await bot.sendMessage(
      chatId,
      `✅ **Position Opened!**\n\n` +
      `Market: **${marketSymbol}**\n` +
      `Direction: **${direction.toUpperCase()}**\n` +
      `Size: **${size}**\n\n` +
      `[View Transaction](${explorerUrl})`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Open position error:', error);
    
    // Update records on failure
    if (orderRecord) {
      await driftDatabaseService.updateOrderStatus(orderRecord.id, {
        status: 'FAILED'
      });
    }
    
    if (txRecord) {
      await driftDatabaseService.updateTransaction(txRecord.id, {
        status: 'FAILED',
        errorMessage: error.message,
        errorType: classifyError(error)
      });
    }
    
    await bot.sendMessage(chatId, `❌ **Failed**: ${error.message}`);
  }
}
```

### 5.2 Close Position Handler

**File**: `src/handlers/drift/closePositionHandler.ts` (UPDATE)

```typescript
// Add database tracking to executeClosePosition

async function executeClosePosition(...) {
  try {
    // ... existing setup code ...

    // Get position record from database
    const positionRecord = await driftDatabaseService.getPositionByMarket(
      dbUser.id,
      marketIndex
    );

    if (!positionRecord) {
      throw new Error('Position not found in database');
    }

    // Create transaction record
    const txRecord = await driftDatabaseService.createTransaction({
      userId: dbUser.id,
      walletId: wallet.id,
      txType: 'CLOSE_POSITION',
      positionId: positionRecord.id,
      marketIndex,
      metadata: {
        closePercentage: percentage
      }
    });

    // ... build transaction ...

    // Sign and send with retry
    const signature = await privySigningService.signAndSendTransactionWithRetry(
      chatId,
      tx,
      driftService.connection,
      {
        onRetry: async (attempt) => {
          await driftDatabaseService.updateTransaction(txRecord.id, {
            retryCount: attempt
          });
        }
      }
    );

    // Calculate realized PnL
    const realizedPnl = (position.unrealizedPnl * percentage) / 100;

    // Update transaction record
    await driftDatabaseService.updateTransaction(txRecord.id, {
      status: 'CONFIRMED',
      txHash: signature,
      confirmedAt: new Date()
    });

    // Update position record
    if (percentage === 100) {
      // Full close
      await driftDatabaseService.updatePosition(positionRecord.id, {
        status: 'CLOSED',
        realizedPnl: realizedPnl.toString(),
        closedAt: new Date()
      });
    } else {
      // Partial close - update amounts
      const remainingAmount = parseFloat(positionRecord.baseAssetAmount) * (1 - percentage / 100);
      await driftDatabaseService.updatePosition(positionRecord.id, {
        baseAssetAmount: remainingAmount.toString(),
        realizedPnl: (parseFloat(positionRecord.realizedPnl) + realizedPnl).toString()
      });
    }

    // Success message
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    const pnlEmoji = realizedPnl >= 0 ? '📈' : '📉';
    
    await bot.sendMessage(
      chatId,
      `✅ **Position Closed!**\n\n` +
      `Market: **${marketSymbol}**\n` +
      `Closed: **${percentage}%**\n` +
      `Realized PnL: ${pnlEmoji} **$${realizedPnl.toFixed(2)}**\n\n` +
      `[View Transaction](${explorerUrl})`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Close position error:', error);
    
    if (txRecord) {
      await driftDatabaseService.updateTransaction(txRecord.id, {
        status: 'FAILED',
        errorMessage: error.message,
        errorType: classifyError(error)
      });
    }
    
    await bot.sendMessage(chatId, `❌ **Failed**: ${error.message}`);
  }
}
```

---

## Phase 6: Market Data Sync (Background Job)

### 6.1 Market Sync Script

**File**: `src/scripts/syncDriftMarkets.ts` (NEW)

```typescript
import { PerpMarkets } from '@drift-labs/sdk';
import { driftDatabaseService } from '../services/driftDatabaseService';

/**
 * Sync Drift markets to database
 * Run this periodically or on startup
 */
export async function syncDriftMarkets(): Promise<void> {
  console.log('🔄 Syncing Drift markets...');

  try {
    const markets = PerpMarkets['mainnet-beta'];

    for (const market of markets) {
      await driftDatabaseService.createOrUpdateMarket({
        marketIndex: market.marketIndex,
        symbol: market.baseAssetSymbol,
        baseAsset: market.baseAssetSymbol,
        quoteAsset: 'USD',
        marketType: 'PERPETUAL',
        category: market.category?.[0] || 'Other',
        metadata: {
          fullName: market.fullName,
          launchTs: market.launchTs
        }
      });

      console.log(`✅ Synced ${market.baseAssetSymbol}`);
    }

    console.log('✅ Market sync complete');

  } catch (error) {
    console.error('❌ Market sync failed:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  syncDriftMarkets()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
```

### 6.2 Add to Bot Initialization

**File**: `src/index.ts` (UPDATE)

```typescript
import { syncDriftMarkets } from './scripts/syncDriftMarkets';

// Add to bot startup
async function initializeBot() {
  // ... existing initialization ...

  // Sync Drift markets on startup
  try {
    await syncDriftMarkets();
    console.log('✅ Drift markets synced');
  } catch (error) {
    console.error('⚠️ Failed to sync markets (continuing anyway):', error);
  }

  // ... start bot ...
}
```

---

## Implementation Checklist

### Database
- [ ] Add Drift-specific tables to `prisma/schema.prisma`
- [ ] Run migration: `npx prisma migrate dev --name add_drift_specific_tables`
- [ ] Generate Prisma client: `npx prisma generate`

### Services
- [ ] Create `src/services/driftDatabaseService.ts`
- [ ] Update `src/services/privySigningService.ts` with retry logic
- [ ] Verify `src/services/privyService.ts` has all required methods

### Handlers
- [ ] Update `src/handlers/drift/depositHandler.ts` with wallet creation flow
- [ ] Update `src/handlers/drift/openPositionHandler.ts` with database tracking
- [ ] Update `src/handlers/drift/closePositionHandler.ts` with database tracking

### Scripts
- [ ] Create `src/scripts/syncDriftMarkets.ts`
- [ ] Add market sync to bot initialization in `src/index.ts`

### Testing
- [ ] Test first-time user deposit (creates Privy wallet)
- [ ] Test existing user deposit (uses existing wallet)
- [ ] Test open position (creates order + position + transaction records)
- [ ] Test close position (updates position + creates transaction)
- [ ] Test retry logic (simulate network failures)
- [ ] Verify all data persisted correctly in database

---

## Success Criteria

✅ **User Onboarding**
- First deposit automatically creates Privy wallet
- Wallet stored in `users`, `wallets` tables
- User can make subsequent deposits without re-creating wallet

✅ **Trading**
- Open position creates records in `drift_orders`, `drift_positions`, `drift_transactions`
- Close position updates position record and creates transaction record
- All transactions tracked with retry counts

✅ **Database Isolation**
- Drift data in separate tables (`drift_*`)
- General wallet data in shared tables (`users`, `wallets`, `wallet_balances`)
- Future integrations can reuse general tables

✅ **Reliability**
- Automatic retry on transient failures (3 attempts)
- All retries logged in transaction records
- User-friendly error messages

---

## Timeline Estimate

- **Phase 1** (Database Schema): 20 minutes
- **Phase 2** (Deposit Flow): 45 minutes
- **Phase 3** (Database Service): 30 minutes
- **Phase 4** (Privy Updates): 20 minutes
- **Phase 5** (Handler Updates): 40 minutes
- **Phase 6** (Market Sync): 15 minutes

**Total: ~170 minutes (~3 hours)**

---

## Next Steps After Implementation

1. Deploy to staging environment
2. Test with small amounts on devnet
3. Verify all database records created correctly
4. Monitor Privy API for any issues
5. Check transaction success rates
6. Optimize retry logic based on metrics
7. Add analytics queries for trading statistics

---

## Notes

- **DRY Principle**: Privy services are reusable for future integrations (Flash, Jupiter)
- **Database Isolation**: Drift tables separate from future DEX integrations
- **Wallet Control**: Users control wallet via Telegram confirmations
- **Full Audit Trail**: Every transaction tracked in database
- **Automatic Retry**: Network failures handled transparently


