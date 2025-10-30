# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Laminator is a Telegram bot for trading perpetual futures across multiple decentralized exchanges (DEXs) on Solana. The bot integrates with Drift Protocol, Jupiter Perps, and Flash Trade, providing users with market data, position management, and wallet integration through Privy.

**Tech Stack**: TypeScript, Node.js, Telegram Bot API, Prisma ORM, PostgreSQL, Solana Web3.js, Drift SDK, Jupiter Perps SDK, Flash SDK

## Development Commands

### Setup & Installation
```bash
cd tg_bot
npm install
```

### Environment Configuration
Create a `.env` file in `tg_bot/` with the following required variables:
- `BOT_TOKEN` - Telegram bot token from @BotFather (required)
- `DATABASE_URL` - PostgreSQL connection string (optional, bot runs without DB)
- `PRIVY_APP_ID` - Privy app ID for wallet management
- `PRIVY_APP_SECRET` - Privy app secret
- `RPC_URL` - Solana RPC endpoint (required for on-chain data)
- `HELIUS_API_KEY` - Helius API key for Drift Protocol data (optional)
- `PRIVATE_KEY` - Server wallet private key (required for API server)
- `API_PORT` - API server port (default: 3000)

### Running the Bot
```bash
npm run dev      # Development mode with hot reload
npm run build    # Compile TypeScript to JavaScript
npm start        # Production mode (requires build first)
```

### Database Operations
```bash
cd tg_bot
npx prisma generate              # Generate Prisma client
npx prisma migrate dev           # Run migrations in dev
npx prisma migrate deploy        # Run migrations in production
npx prisma studio               # Open Prisma Studio GUI
```

## Architecture

### Service Layer Pattern
The codebase uses a service-oriented architecture with centralized coordination:

**DEXManager (`src/services/dexManager.ts`)** - Central orchestrator that:
- Routes requests to appropriate DEX services (Drift, Jupiter, Flash)
- Provides unified interfaces for markets, positions, orderbooks, balances
- Handles fallback logic when services are unavailable
- Normalizes data structures across different DEXs

**Key Services**:
- `driftService` - Drift Protocol integration (primary DEX)
- `jupiterService` - Jupiter spot trading (secondary)
- `jupiterPerpsService` - Jupiter perpetual futures
- `flashService` - Flash Trade integration
- `perpetualService` - Direct Drift SDK wrapper for API server
- `privyService` - Privy wallet creation and management
- `databaseService` - Prisma-based data persistence
- `volumeService` - DEX volume tracking and aggregation
- `userService` - In-memory user session management (legacy)

### Service Initialization Pattern
Services initialize asynchronously on startup with graceful degradation:
- Database is optional - bot continues without it
- Individual DEX services can fail independently
- Jupiter Perps uses lazy initialization on first use
- Check `dexManagerInitialized`, `databaseInitialized`, `jupiterPerpsInitialized`, `perpetualInitialized` flags before use

### Command Handler Structure
Bot commands in `src/index.ts` follow this pattern:
1. Validate user/wallet status from database
2. Check service initialization flags
3. Call DEXManager for multi-DEX operations
4. Use service-specific methods for DEX-specific features
5. Handle errors gracefully with fallback to database data
6. Use `safeReply()` helper for all Telegram responses

### Database Schema (Prisma)
Located in `tg_bot/prisma/schema.prisma`:
- **User** - Telegram user with Privy integration
- **Wallet** - Multi-chain wallet support (primarily Solana/Privy)
- **WalletBalance** - Token balances with locked/available amounts
- **Market** - DEX markets with configuration
- **Order** - Trading orders with lifecycle tracking
- **Position** - Open perpetual positions
- **Transaction** - On-chain transaction records
- **Alert** - Price alerts and notifications
- **UserSetting** - User preferences
- **AuditLog** - System audit trail

All models use UUIDs, include created/updated timestamps, and have comprehensive indexes.

### API Server (Express)
Runs alongside the Telegram bot when `PRIVATE_KEY` and `RPC_URL` are configured:
- **Endpoints**: `/health`, `/markets`, `/users`, `/deposit`, `/order`, `/close`, `/positions`, `/balance`
- Uses `perpetualService` for direct Drift SDK operations
- Server wallet vs. user wallet distinction in routes
- Validates service readiness before processing requests

## Integration Points

### Privy Wallet Integration
- **Flow**: User → `/create` → PrivyService.createUser() → PrivyService.createWallet() → DatabaseService.createWallet()
- **Status Check**: `/wallet` shows wallet details, balance, trading readiness
- Wallets are MPC-based, gasless, cross-device accessible
- Private keys never stored in database (only wallet addresses)

### DEX Integration Strategy
When adding new DEX support:
1. Create service in `src/services/` implementing standard interfaces
2. Add to DEXManager initialization in `initialize()`
3. Add DEX info to `getAvailableDEXs()` method
4. Implement `getMarketsForDEX()`, `getOrderbookForDEX()`, `getUserPositionsForDEX()` methods
5. Add bot command handler (e.g., `/dex<name>`)
6. Update fallback chains in existing commands

### On-Chain Data Flow
- **Wallet Balances**: RPC calls via `driftService.getOnchainSolBalance()` and `getUserBalance()`
- **Drift Collateral**: SDK calls via `getDriftCollateralUSDC()`
- **Jupiter Perps**: Anchor program account reads via `jupiterPerpsService`
- **Market Prices**: Mixed sources (CoinGecko API, Drift oracles, Jupiter oracles)

### Error Handling Pattern
```typescript
try {
  // Try primary source (e.g., on-chain data)
} catch (error) {
  console.error('Primary source failed:', error);
  // Fallback to secondary source (e.g., database)
  try {
    // Secondary source
  } catch (fallbackError) {
    // User-friendly error message
    await safeReply(chatId, "❌ Service unavailable");
  }
}
```

## Common Development Tasks

### Adding a New Bot Command
1. Add regex handler in `src/index.ts`: `bot.onText(/^\/commandname$/, async (msg) => { ... })`
2. Validate user/wallet from database if needed
3. Check service initialization flags
4. Use `safeReply(chatId, message)` for responses
5. Add to help text in `/start` command
6. Use Markdown formatting for messages

### Testing Trading Operations
Current implementation status:
- **Market Data**: ✅ Fully functional (Drift, Jupiter, Flash)
- **Wallet Creation**: ✅ Privy integration complete
- **Balance Checking**: ✅ On-chain + database
- **Position Opening/Closing**: ⚠️ Transaction building in progress (Privy signing ready)
- **Jupiter Perps**: ⚠️ Read-only (markets, positions, prices)

### Working with Prisma
- After schema changes: `npx prisma migrate dev --name description`
- Always `npx prisma generate` after pulling schema changes
- Database service includes helper methods: `getOrCreateUser()`, `createWallet()`, `updateBalance()`
- Use transactions for multi-step database operations

### Message Formatting
Use Telegram Markdown for bot responses:
- Bold: `**text**`
- Code: `` `code` ``
- Commands: `` `/command` ``
- Emojis for visual hierarchy: ✅ ❌ ⚠️ 💰 📊 🔥 ⏳

## Important Patterns

### Lazy Initialization
```typescript
async function ensureJupiterPerpsInit(): Promise<boolean> {
  if (jupiterPerpsInitialized) return true;
  try {
    await jupiterPerpsService.initialize();
    jupiterPerpsInitialized = true;
    return true;
  } catch (e) {
    console.warn('Jupiter Perps lazy-init failed:', e?.message);
    return false;
  }
}
```

### Multi-DEX Fallback
```typescript
// Try Drift first
try {
  orderbook = await dexManager.getOrderbookForDEX('drift', symbol);
  if (orderbook) { /* success */ }
} catch (driftError) {
  console.log('Drift failed, trying Jupiter...');
}
// If Drift fails, try Jupiter
if (!orderbook) {
  try {
    orderbook = await dexManager.getOrderbookForDEX('jupiter', symbol);
  } catch (jupiterError) { /* handle */ }
}
```

### Safe Database Access
```typescript
if (!databaseInitialized) {
  await safeReply(chatId, "⏳ Database initializing...");
  return;
}
const user = await databaseService.getUserByTelegramId(chatId);
if (!user) {
  await safeReply(chatId, "❌ User not found. Use /start first.");
  return;
}
```

## Known Limitations

- Jupiter Perps: Read-only integration (no transaction building yet)
- Flash Trade: Market data only (trading not implemented)
- Transaction Building: Privy signing ready, instruction building in progress
- Volume Tracking: Best-effort aggregation (may have gaps)
- Orderbook Data: Simplified view (full depth on DEX web interfaces)
- Database: Optional (bot continues without it, but limited features)
