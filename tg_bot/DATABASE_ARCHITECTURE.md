# 📊 Laminator Database Architecture - Complete Analysis

## 1. DATABASE OVERVIEW

**Database Type:** PostgreSQL  
**ORM:** Prisma  
**Schema Location:** `tg_bot/prisma/schema.prisma`  
**Service Layer:** `src/services/databaseService.ts`  
**Status:** Optional (bot continues without it)

---

## 2. DATABASE TABLES & SCHEMA

### 2.1 User Management Tables

#### `users` (User)

Core user records with Telegram and Privy integration

| Column              | Type       | Description                                         |
|---------------------|------------|-----------------------------------------------------|
| id                  | UUID       | Primary key                                         |
| telegram_id         | BigInt     | Unique Telegram user ID                             |
| telegram_username   | String?    | Telegram @username                                  |
| telegram_first_name | String?    | User first name                                     |
| telegram_last_name  | String?    | User last name                                      |
| privy_user_id       | String?    | Unique Privy authentication ID                      |
| status              | UserStatus | ACTIVE, SUSPENDED, BANNED, PENDING_VERIFICATION     |
| created_at          | DateTime   | Creation timestamp                                  |
| updated_at          | DateTime   | Last update timestamp                               |
| last_active         | DateTime   | Last activity timestamp                             |
| metadata            | Json       | Additional user data (default: {})                  |

**Indexes:** telegramId, privyUserId, status, lastActive  
**Relations:** → wallets, orders, positions, transactions, alerts, userSettings, auditLogs

---

#### `wallets` (Wallet)

Multi-chain wallet addresses with Privy MPC support

| Column          | Type         | Description                                    |
|-----------------|--------------|------------------------------------------------|
| id              | UUID         | Primary key                                    |
| user_id         | UUID         | Foreign key → users.id (CASCADE)               |
| privy_wallet_id | String?      | Unique Privy MPC wallet ID                     |
| wallet_address  | String       | Unique blockchain address                      |
| wallet_type     | WalletType   | PRIVY, PHANTOM, SOLFLARE, BACKPACK, EXTERNAL   |
| chain_type      | ChainType    | SOLANA, ETHEREUM, POLYGON                      |
| status          | WalletStatus | ACTIVE, INACTIVE, SUSPENDED, PENDING           |
| created_at      | DateTime     | Creation timestamp                             |
| updated_at      | DateTime     | Last update timestamp                          |
| metadata        | Json         | Additional wallet data (default: {})           |

**Indexes:** userId, walletAddress, privyWalletId  
**Relations:** ← user, → walletBalances, orders, positions, transactions

---

#### `wallet_balances` (WalletBalance)

Token balances with locked/available tracking

| Column            | Type           | Description                           |
|-------------------|----------------|---------------------------------------|
| id                | UUID           | Primary key                           |
| wallet_id         | UUID           | Foreign key → wallets.id (CASCADE)    |
| token_symbol      | String         | Token symbol (SOL, USDC, etc.)        |
| token_address     | String?        | SPL token mint address                |
| balance           | Decimal(36,18) | Total balance                         |
| locked_balance    | Decimal(36,18) | Balance locked in positions/orders    |
| available_balance | Decimal(36,18) | Available for trading                 |
| updated_at        | DateTime       | Last balance update                   |

**Indexes:** (walletId, tokenSymbol) - UNIQUE, updatedAt  
**Relations:** ← wallet

---

### 2.2 Trading Tables

#### `markets` (Market)

DEX markets with configuration

| Column         | Type            | Description                                    |
|----------------|-----------------|------------------------------------------------|
| id             | UUID            | Primary key                                    |
| symbol         | String          | Market symbol (SOL-PERP, BTC-PERP)             |
| base_asset     | String          | Base asset (SOL, BTC)                          |
| quote_asset    | String          | Quote asset (USD, USDC)                        |
| dex_name       | String          | DEX identifier (drift, jupiter, flash)         |
| market_type    | MarketType      | PERPETUAL, SPOT, FUTURES                       |
| status         | MarketStatus    | ACTIVE, INACTIVE, SUSPENDED, MAINTENANCE       |
| min_order_size | Decimal(36,18)? | Minimum order size                             |
| max_order_size | Decimal(36,18)? | Maximum order size                             |
| tick_size      | Decimal(36,18)? | Price increment                                |
| step_size      | Decimal(36,18)? | Size increment                                 |
| max_leverage   | Decimal(8,2)?   | Maximum leverage allowed                       |
| created_at     | DateTime        | Creation timestamp                             |
| updated_at     | DateTime        | Last update timestamp                          |

**Indexes:** (symbol, dexName) - UNIQUE  
**Relations:** → orders, positions, alerts

---

#### `orders` (Order)

Trading orders with lifecycle tracking

| Column         | Type            | Description                                                          |
|----------------|-----------------|----------------------------------------------------------------------|
| id             | UUID            | Primary key                                                          |
| user_id        | UUID            | Foreign key → users.id (CASCADE)                                     |
| wallet_id      | UUID            | Foreign key → wallets.id (CASCADE)                                   |
| market_id      | UUID            | Foreign key → markets.id                                             |
| order_type     | OrderType       | MARKET, LIMIT, STOP, STOP_LIMIT                                      |
| side           | OrderSide       | BUY, SELL, LONG, SHORT                                               |
| size           | Decimal(36,18)  | Order size in base asset                                             |
| price          | Decimal(36,18)? | Limit price (null for market orders)                                 |
| leverage       | Decimal(8,2)    | Leverage (default: 1.0)                                              |
| status         | OrderStatus     | PENDING, OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED, FAILED  |
| filled_size    | Decimal(36,18)  | Amount filled (default: 0)                                           |
| avg_fill_price | Decimal(36,18)? | Average fill price                                                   |
| total_fees     | Decimal(36,18)  | Total fees paid (default: 0)                                         |
| created_at     | DateTime        | Order creation time                                                  |
| updated_at     | DateTime        | Last update time                                                     |
| expires_at     | DateTime?       | Order expiration time                                                |

**Indexes:** (userId, status), (marketId, status), createdAt, expiresAt  
**Relations:** ← user, wallet, market

---

#### `positions` (Position)

Open perpetual positions with PnL tracking

| Column         | Type            | Description                        |
|----------------|-----------------|------------------------------------|
| id             | UUID            | Primary key                        |
| user_id        | UUID            | Foreign key → users.id (CASCADE)   |
| wallet_id      | UUID            | Foreign key → wallets.id (CASCADE) |
| market_id      | UUID            | Foreign key → markets.id           |
| side           | PositionSide    | LONG, SHORT                        |
| size           | Decimal(36,18)  | Position size in base asset        |
| entry_price    | Decimal(36,18)  | Average entry price                |
| current_price  | Decimal(36,18)? | Current market price               |
| leverage       | Decimal(8,2)    | Position leverage (default: 1.0)   |
| margin         | Decimal(36,18)  | Margin/collateral used             |
| unrealized_pnl | Decimal(36,18)  | Unrealized profit/loss (default: 0)|
| realized_pnl   | Decimal(36,18)  | Realized profit/loss (default: 0)  |
| status         | PositionStatus  | OPEN, CLOSED, LIQUIDATED           |
| opened_at      | DateTime        | Position open time                 |
| closed_at      | DateTime?       | Position close time                |
| updated_at     | DateTime        | Last update time                   |

**Indexes:** (userId, marketId, side) - UNIQUE, (userId, marketId), status, openedAt  
**Relations:** ← user, wallet, market

---

### 2.3 Transaction & Activity Tables

#### `transactions` (Transaction)

On-chain transaction records

| Column          | Type              | Description                                          |
|-----------------|-------------------|------------------------------------------------------|
| id              | UUID              | Primary key                                          |
| user_id         | UUID              | Foreign key → users.id (CASCADE)                     |
| wallet_id       | UUID              | Foreign key → wallets.id (CASCADE)                   |
| tx_hash         | String?           | Unique blockchain transaction hash                   |
| tx_type         | TransactionType   | DEPOSIT, WITHDRAWAL, TRADE, FEE, REWARD, TRANSFER    |
| status          | TransactionStatus | PENDING, CONFIRMED, FAILED, CANCELLED                |
| amount          | Decimal(36,18)?   | Transaction amount                                   |
| token_symbol    | String?           | Token symbol                                         |
| from_address    | String?           | Source address                                       |
| to_address      | String?           | Destination address                                  |
| gas_fee         | Decimal(36,18)?   | Transaction fee                                      |
| block_number    | BigInt?           | Blockchain block number                              |
| block_timestamp | DateTime?         | Block timestamp                                      |
| created_at      | DateTime          | Record creation time                                 |
| updated_at      | DateTime          | Last update time                                     |
| metadata        | Json              | Additional transaction data (default: {})            |

**Indexes:** (userId, createdAt), (walletId, txType), txHash, status  
**Relations:** ← user, wallet

---

#### `alerts` (Alert)

Price alerts and notifications

| Column            | Type            | Description                                                     |
|-------------------|-----------------|-----------------------------------------------------------------|
| id                | UUID            | Primary key                                                     |
| user_id           | UUID            | Foreign key → users.id (CASCADE)                                |
| market_id         | UUID?           | Foreign key → markets.id (optional)                             |
| alert_type        | AlertType       | PRICE_ABOVE, PRICE_BELOW, PRICE_CHANGE, VOLUME, POSITION_PNL   |
| condition_type    | ConditionType   | GREATER_THAN, LESS_THAN, EQUALS, PERCENTAGE_CHANGE              |
| target_price      | Decimal(36,18)? | Target price threshold                                          |
| target_percentage | Decimal(8,4)?   | Target percentage change                                        |
| message           | String?         | Custom alert message                                            |
| status            | AlertStatus     | ACTIVE, TRIGGERED, CANCELLED, EXPIRED                           |
| triggered_at      | DateTime?       | When alert was triggered                                        |
| created_at        | DateTime        | Alert creation time                                             |

**Indexes:** userId, marketId, status, alertType  
**Relations:** ← user, market (optional)

---

### 2.4 Settings & Audit Tables

#### `user_settings` (UserSetting)

User preferences and configuration

| Column        | Type     | Description                      |
|---------------|----------|----------------------------------|
| id            | UUID     | Primary key                      |
| user_id       | UUID     | Foreign key → users.id (CASCADE) |
| setting_key   | String   | Setting identifier               |
| setting_value | Json     | Setting value (any JSON)         |
| created_at    | DateTime | Setting creation time            |
| updated_at    | DateTime | Last update time                 |

**Indexes:** (userId, settingKey) - UNIQUE  
**Relations:** ← user

---

#### `audit_logs` (AuditLog)

System audit trail

| Column        | Type     | Description                       |
|---------------|----------|-----------------------------------|
| id            | UUID     | Primary key                       |
| user_id       | UUID?    | Foreign key → users.id (SET NULL) |
| action        | String   | Action performed                  |
| resource_type | String   | Type of resource affected         |
| resource_id   | String?  | ID of affected resource           |
| old_values    | Json?    | Previous state                    |
| new_values    | Json?    | New state                         |
| ip_address    | String?  | User IP address                   |
| user_agent    | String?  | User agent string                 |
| created_at    | DateTime | Log entry time                    |

**Indexes:** (userId, action), (resourceType, resourceId), createdAt  
**Relations:** ← user (optional)

---

## 3. DATABASE READ OPERATIONS

### 3.1 User Operations - READ

| Location                    | Method                | Purpose                                           |
|-----------------------------|-----------------------|---------------------------------------------------|
| index.ts:83-88              | getOrCreateUser()     | /start - Get or create user on bot startup        |
| index.ts:303                | getUserByTelegramId() | /balance - Check wallet existence                 |
| index.ts:553                | getUserByTelegramId() | /myposition - Verify user before showing positions|
| index.ts:682                | getUserByTelegramId() | /close - Get user wallet for closing positions    |
| index.ts:729                | getUserByTelegramId() | /myposition (fallback) - Load positions from DB   |
| index.ts:809                | getUserByTelegramId() | /wallet - Display wallet info                     |
| index.ts:876                | getUserByTelegramId() | /create - Check if user already exists            |
| index.ts:1043               | getUserByTelegramId() | /flashbalance - Get wallet for Flash balance      |
| index.ts:1083               | getUserByTelegramId() | /juppositions - Get wallet for Jupiter positions  |
| driftService.ts:683         | getUserByTelegramId() | Get user wallet for Drift operations              |
| driftService.ts:725         | getUserByTelegramId() | Get user wallet for balance checks                |
| openPositionHandler.ts:277  | getUserByTelegramId() | Get wallet for opening position                   |
| closePositionHandler.ts:240 | getUserByTelegramId() | Get wallet for closing position                   |
| depositHandler.ts:195       | getUserByTelegramId() | Get wallet for deposit operation                  |

---

### 3.2 Wallet Operations - READ

| Location                   | Method                     | Purpose                           |
|----------------------------|----------------------------|-----------------------------------|
| All user reads             | include: { wallets: true } | Load user's wallets in queries    |
| databaseService.ts:223-233 | getWalletByAddress()       | Find wallet by blockchain address |
| databaseService.ts:235-244 | getUserWallets()           | Get all wallets for a user        |

---

### 3.3 Balance Operations - READ

| Location                   | Method                 | Purpose                           |
|----------------------------|------------------------|-----------------------------------|
| databaseService.ts:274-285 | getWalletBalance()     | Get specific token balance        |
| databaseService.ts:287-293 | getAllWalletBalances() | Get all token balances for wallet |

---

### 3.4 Market Operations - READ

| Location                   | Method              | Purpose                       |
|----------------------------|---------------------|-------------------------------|
| databaseService.ts:307-314 | getMarkets()        | Get all active markets        |
| databaseService.ts:316-326 | getMarketBySymbol() | Find market by symbol and DEX |

---

### 3.5 Order Operations - READ

| Location                   | Method          | Purpose                                         |
|----------------------------|-----------------|-------------------------------------------------|
| databaseService.ts:350-361 | getUserOrders() | Get user's orders (optionally filtered by status)|

---

### 3.6 Position Operations - READ

| Location                   | Method             | Purpose                                    |
|----------------------------|--------------------|--------------------------------------------|
| index.ts:708               | getUserPositions() | /close - Load open positions from DB       |
| index.ts:774               | getUserPositions() | /myposition - Display user positions       |
| databaseService.ts:396-407 | getUserPositions() | Get user's positions (filtered by status)  |

---

### 3.7 Transaction Operations - READ

| Location                   | Method                | Purpose                                    |
|----------------------------|-----------------------|--------------------------------------------|
| databaseService.ts:441-449 | getUserTransactions() | Get user's transaction history (limit 50)  |

---

### 3.8 Alert Operations - READ

| Location                   | Method          | Purpose                   |
|----------------------------|-----------------|---------------------------|
| databaseService.ts:463-471 | getUserAlerts() | Get user's active alerts  |

---

### 3.9 Settings Operations - READ

| Location                   | Method           | Purpose                           |
|----------------------------|------------------|-----------------------------------|
| databaseService.ts:498-509 | getUserSetting() | Get specific user setting by key  |

---

### 3.10 Analytics Operations - READ

| Location                   | Method             | Purpose                                                |
|----------------------------|--------------------|---------------------------------------------------------|
| databaseService.ts:515-539 | getUserPortfolio() | Get complete user portfolio (wallets, positions, orders)|
| databaseService.ts:541-560 | getTradingStats()  | Get user trading statistics (orders, volume, fees)      |

---

## 4. DATABASE WRITE OPERATIONS

### 4.1 User Operations - WRITE

| Location                   | Method                 | Purpose                                   |
|----------------------------|------------------------|-------------------------------------------|
| index.ts:886               | getOrCreateUser()      | /create - Create user on wallet creation  |
| databaseService.ts:92-113  | createUser()           | Create new user record                    |
| databaseService.ts:127-160 | getOrCreateUser()      | Find or create user atomically            |
| databaseService.ts:178-185 | updateUserLastActive() | Update last activity timestamp            |

---

### 4.2 Wallet Operations - WRITE

| Location                   | Method         | Purpose                                        |
|----------------------------|----------------|------------------------------------------------|
| index.ts:898-905           | createWallet() | /create - Store new Privy wallet               |
| databaseService.ts:191-221 | createWallet() | Create wallet with validation (checks dupes)   |

---

### 4.3 Balance Operations - WRITE

| Location                   | Method          | Purpose                                |
|----------------------------|-----------------|----------------------------------------|
| index.ts:907-912           | updateBalance() | /create - Initialize SOL balance       |
| index.ts:914-919           | updateBalance() | /create - Initialize USDC balance      |
| databaseService.ts:250-272 | updateBalance() | Upsert wallet balance (insert/update)  |

---

### 4.4 Market Operations - WRITE

| Location                   | Method         | Purpose                   |
|----------------------------|----------------|---------------------------|
| databaseService.ts:299-305 | createMarket() | Add new market to database|

---

### 4.5 Order Operations - WRITE

| Location                   | Method              | Purpose                          |
|----------------------------|---------------------|----------------------------------|
| databaseService.ts:332-348 | createOrder()       | Create new order record          |
| databaseService.ts:363-373 | updateOrderStatus() | Update order status and fill data|

---

### 4.6 Position Operations - WRITE

| Location                   | Method           | Purpose                              |
|----------------------------|------------------|--------------------------------------|
| databaseService.ts:379-394 | createPosition() | Create new position record           |
| databaseService.ts:409-416 | updatePosition() | Update position data (PnL, price, etc.)|

---

### 4.7 Transaction Operations - WRITE

| Location                   | Method              | Purpose                       |
|----------------------------|---------------------|-------------------------------|
| databaseService.ts:422-439 | createTransaction() | Record blockchain transaction |

---

### 4.8 Alert Operations - WRITE

| Location                   | Method        | Purpose               |
|----------------------------|---------------|-----------------------|
| databaseService.ts:455-461 | createAlert() | Create new price alert|

---

### 4.9 Settings Operations - WRITE

| Location                   | Method              | Purpose                                |
|----------------------------|---------------------|----------------------------------------|
| databaseService.ts:477-496 | updateUserSetting() | Upsert user setting (insert or update) |

---

## 5. DATABASE ARCHITECTURE PATTERNS

### 5.1 Initialization Flow

```
index.ts (startup)
  ├─ databaseService.initialize()
  │   ├─ prisma.$connect()
  │   ├─ Set databaseInitialized = true
  │   └─ Continue on failure (optional DB)
  └─ Commands check databaseInitialized flag
```

### 5.2 Graceful Degradation

**Pattern:** Database failure doesn't stop bot  
**Implementation:** Try-catch blocks with fallback to on-chain data  
**Example:** `/balance` tries DB first, then RPC calls

```typescript
if (!databaseInitialized) {
  await safeReply(chatId, "⏳ Database initializing...");
  return;
}
try {
  const user = await databaseService.getUserByTelegramId(chatId);
  // Use DB data
} catch (error) {
  // Fallback to on-chain data
}
```

### 5.3 Data Flow Architecture

```
User Command (Telegram)
   ↓
index.ts (Command Handler)
   ↓
Check databaseInitialized flag
   ├─ TRUE → databaseService methods
   │   ↓
   │   Prisma Client
   │   ↓
   │   PostgreSQL Database
   │   ↓
   │   Return data to handler
   │
   └─ FALSE → Skip DB operations
       ↓
       Use on-chain data (RPC)
       ↓
       Return data to handler
   ↓
safeReply() to user
```

### 5.4 Transaction Patterns

**Atomic Operations** (using Prisma transactions):

```typescript
// Currently used: Individual queries
await prisma.user.create(...)
await prisma.wallet.create(...)

// Future improvement: Atomic transactions
await prisma.$transaction([
  prisma.user.create(...),
  prisma.wallet.create(...),
  prisma.walletBalance.create(...)
]);
```

### 5.5 Relationship Cascade Rules

| Parent → Child      | Delete Rule | Update Rule |
|---------------------|-------------|-------------|
| User → Wallet       | CASCADE     | CASCADE     |
| User → Order        | CASCADE     | CASCADE     |
| User → Position     | CASCADE     | CASCADE     |
| Wallet → Balance    | CASCADE     | CASCADE     |
| User → AuditLog     | SET NULL    | -           |

---

## 6. CURRENT USAGE STATISTICS

### Database Operations by Command

| Command              | Read Operations                 | Write Operations                      |
|----------------------|---------------------------------|---------------------------------------|
| /start               | 1 (getOrCreateUser)             | 0-1 (create if new)                   |
| /create              | 2 (check existing, getOrCreate) | 3 (user, wallet, 2x balances)         |
| /balance             | 1 (getUserByTelegramId)         | 0                                     |
| /wallet              | 1 (getUserByTelegramId)         | 0                                     |
| /myposition          | 1-2 (user + positions)          | 0                                     |
| /close               | 2 (user + positions)            | 0 (planned: order/position updates)   |
| Drift Open Position  | 1 (getUserByTelegramId)         | 0 (planned: order creation)           |
| Drift Close Position | 2 (user + positions)            | 0 (planned: position update)          |

---

## 7. KEY INSIGHTS & RECOMMENDATIONS

### ✅ Current Strengths

1. **Optional Database:** Bot continues without DB
2. **Comprehensive Schema:** Supports all trading operations
3. **Good Indexing:** Proper indexes on frequently queried fields
4. **Cascade Deletes:** Proper cleanup of related records
5. **Type Safety:** Prisma provides full TypeScript types

### ⚠️ Areas for Improvement

#### 1. Write Operations Underutilized
- Orders/positions created but not persisted to DB
- Transactions not logged to database
- PnL updates only calculated, not stored

#### 2. Missing Transaction Patterns
- No atomic multi-table updates
- No database transactions for complex operations

#### 3. No Background Jobs
- Balance updates not automated
- Position PnL not continuously updated
- Transaction status not tracked

#### 4. Audit Log Not Used
- Critical operations not logged
- No audit trail for debugging

### 🔧 Recommended Enhancements

#### 1. Implement Order/Position Persistence

```typescript
// After successful Drift transaction
await databaseService.createOrder(orderData);
await databaseService.createPosition(positionData);
await databaseService.createTransaction(txData);
```

#### 2. Add Background Jobs

```typescript
// Periodic balance sync
setInterval(async () => {
  await syncUserBalances();
}, 60000); // Every minute
```

#### 3. Enable Audit Logging

```typescript
// After critical operations
await databaseService.createAuditLog({
  userId,
  action: 'POSITION_OPENED',
  resourceType: 'position',
  resourceId: positionId,
  newValues: positionData
});
```

---

## 8. DATABASE DEPENDENCY GRAPH

```
┌─────────────────────────────────────────────┐
│           User (Core Entity)                │
│  - Telegram authentication                  │
│  - Privy integration                        │
└─────────────┬───────────────────────────────┘
              │
      ┌───────┴───────┬──────────┬────────────┬─────────────┐
      │               │          │            │             │
      ▼               ▼          ▼            ▼             ▼
┌──────────┐  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐
│  Wallet  │  │  Order   │  │Position│  │  Alert  │  │ Settings │
│          │  │          │  │        │  │         │  │          │
└────┬─────┘  └─────┬────┘  └───┬────┘  └────┬────┘  └──────────┘
     │              │           │            │
     ▼              │           │            │
┌──────────┐        │           │            │
│ Balance  │        │           │            │
└──────────┘        │           │            │
                    │           │            │
                    └────┬──────┴────────────┘
                         │
                         ▼
                    ┌─────────┐
                    │ Market  │
                    │ (DEXs)  │
                    └─────────┘
```

---

## 9. OPTIMIZATION OPPORTUNITIES

### 9.1 Query Optimization

**Current Issue:** Multiple sequential DB calls

```typescript
// Current (N+1 problem)
const user = await getUserByTelegramId(chatId);
const wallet = user.wallets[0];
const balances = await getAllWalletBalances(wallet.id);
```

**Optimized Solution:**

```typescript
// Use Prisma's nested includes
const user = await prisma.user.findUnique({
  where: { telegramId: chatId },
  include: {
    wallets: {
      include: {
        walletBalances: true
      }
    }
  }
});
```

### 9.2 Caching Strategy

**Recommended Implementation:**

```typescript
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 60 }); // 60 second TTL

async function getCachedUserBalance(userId: string) {
  const cacheKey = `balance:${userId}`;
  const cached = cache.get(cacheKey);
  
  if (cached) return cached;
  
  const balance = await databaseService.getUserBalance(userId);
  cache.set(cacheKey, balance);
  return balance;
}
```

### 9.3 Connection Pooling

**Current:** Single Prisma client instance  
**Optimization:** Configure connection pool size

```typescript
// In databaseService.ts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Add connection pool configuration
  log: ['query', 'error', 'warn'],
  errorFormat: 'pretty',
});
```

---

## 10. MONITORING & OBSERVABILITY

### 10.1 Metrics to Track

**Database Performance:**
- Query execution time
- Connection pool utilization
- Failed query count
- Cache hit/miss ratio

**Business Metrics:**
- Active users (last 24h)
- Total positions opened/closed
- Transaction success rate
- Average order size

### 10.2 Logging Strategy

**Recommended Implementation:**

```typescript
// Structured logging for DB operations
logger.info('database_query', {
  operation: 'getUserByTelegramId',
  telegramId: chatId,
  duration: queryTime,
  success: true
});

logger.error('database_error', {
  operation: 'createPosition',
  error: error.message,
  userId: userId,
  stack: error.stack
});
```

### 10.3 Health Check Endpoint

**Implementation:**

```typescript
// In apiServer.ts
app.get('/health', async (req, res) => {
  const dbHealthy = await databaseService.healthCheck();
  const status = dbHealthy ? 200 : 503;
  
  res.status(status).json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    database: dbHealthy,
    timestamp: new Date().toISOString()
  });
});
```

---

## 11. MIGRATION STRATEGY

### 11.1 Future Schema Changes

**Best Practices:**
1. Always create migrations with descriptive names
2. Test migrations on staging first
3. Backup production database before migrations
4. Use Prisma's migration tools

```bash
# Create new migration
npx prisma migrate dev --name add_retry_count_to_transactions

# Apply to production
npx prisma migrate deploy
```

### 11.2 Data Backfilling

**Example: Backfill existing positions to database**

```typescript
async function backfillPositions() {
  const users = await prisma.user.findMany({
    include: { wallets: true }
  });
  
  for (const user of users) {
    const driftPositions = await driftService.getUserPositions(user.telegramId);
    
    for (const position of driftPositions) {
      await prisma.position.upsert({
        where: { userId_marketId_side: { 
          userId: user.id, 
          marketId: position.marketId,
          side: position.side
        }},
        update: { ...position },
        create: { userId: user.id, ...position }
      });
    }
  }
}
```

---

## 12. SECURITY CONSIDERATIONS

### 12.1 Data Privacy

**Sensitive Fields:**
- `privy_wallet_id` - Never expose in logs
- `wallet_address` - Truncate in UI (show only first/last 4 chars)
- `private_keys` - NEVER store in database

### 12.2 SQL Injection Prevention

**Safe (Prisma handles parameterization):**

```typescript
await prisma.user.findUnique({
  where: { telegramId: userInput } // ✅ Safe
});
```

**Unsafe (avoid raw queries with user input):**

```typescript
await prisma.$queryRaw`
  SELECT * FROM users WHERE telegram_id = ${userInput}
` // ⚠️ Use queryRawUnsafe only with validated input
```

### 12.3 Access Control

**Recommendation:** Implement row-level security

```typescript
// Always filter by user context
async function getUserData(requestingUserId: string, targetUserId: string) {
  if (requestingUserId !== targetUserId) {
    throw new Error('Unauthorized access');
  }
  
  return await prisma.user.findUnique({
    where: { id: targetUserId }
  });
}
```

---

## 13. CONCLUSION

This comprehensive analysis shows that while your database schema is **production-ready and well-designed**, the write operations are currently **underutilized**. The bot primarily uses the database for user/wallet management and relies on on-chain data for trading operations.

### Key Takeaways

**✅ Strengths:**
- Robust schema covering all trading scenarios
- Optional database design (graceful degradation)
- Proper relationships and cascading rules
- Good indexing strategy

**🚀 Next Steps:**
1. Implement full order/position persistence
2. Add transaction tracking to database
3. Enable audit logging for compliance
4. Set up background jobs for balance sync
5. Add monitoring and alerting

**📈 Expected Benefits:**
- Complete audit trail for all trades
- Historical analytics and reporting
- Faster query performance (cached data)
- Better user experience (instant data access)
- Regulatory compliance ready


