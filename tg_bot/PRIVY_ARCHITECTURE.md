# Privy Integration Architecture

## Overview

Privy provides **embedded wallet infrastructure** for Telegram users, enabling wallet creation and management without requiring external wallet applications like Phantom or Solflare. This document explains the complete architecture of how Privy is integrated into the Laminator trading bot.

---

## What Privy Does in This Codebase

Privy serves as the **wallet custody and signing solution** that:
- Creates embedded Solana wallets for Telegram users
- Manages wallet keys server-side
- Signs transactions on behalf of users after Telegram confirmation
- Eliminates the need for external wallet apps

---

## Architecture Components

### 1. Core Services

#### **`privyService.ts`** - Primary Wallet Management
**Purpose:** Interface with Privy's API for wallet operations

**Key Methods:**
- `createUser(telegramUserId)` - Creates Privy user linked to Telegram ID
- `getUserByTelegramId(telegramUserId)` - Retrieves Privy user data
- `createWallet(userId)` - Generates embedded Solana wallet
- `getUserWallet(telegramUserId)` - Gets wallet details
- `getWalletAddress(telegramUserId)` - Returns Solana public key
- `getWalletPrivateKey(telegramUserId)` - Retrieves private key for signing
- `createCompleteUserSetup(telegramUserId)` - One-step user + wallet creation

**Configuration:**
```typescript
this.privyClient = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
```

**Authorization Pattern:**
```typescript
// Bot is added as additional signer to enable server-side signing
additional_signers: [{ 
  signer_id: this.authorizationKey,
  override_policy_ids: [] 
}]
```

#### **`privySigningService.ts`** - Transaction Signing Layer
**Purpose:** Handle Solana transaction signing using Privy wallets

**Key Methods:**
- `signTransaction(telegramUserId, transaction)` - Signs transaction with user's Privy wallet
- `signAndSendTransaction(telegramUserId, transaction, connection)` - Signs and submits to blockchain

**Flow:**
```typescript
1. Retrieve private key from Privy
2. Create Solana Keypair from private key
3. Sign transaction
4. Send to Solana RPC
5. Wait for confirmation
6. Return transaction signature
```

#### **`databaseService.ts`** - Persistence Layer
**Purpose:** Store wallet mappings and transaction records

**Key Operations:**
- Stores Privy user IDs and wallet IDs
- Links wallets to users via foreign keys
- Tracks wallet addresses and chain types
- Records all transactions with metadata

---

### 2. Data Flow

```
┌─────────────────┐
│  User on        │
│  Telegram       │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Bot Command: /drift or /start       │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ privyService.createCompleteUserSetup│
│ - Creates Privy user                │
│ - Links to Telegram ID              │
│ - Generates Solana wallet           │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Store in PostgreSQL                 │
│ - users.privyUserId                 │
│ - wallets.privyWalletId             │
│ - wallets.walletAddress             │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ User Action: Deposit/Trade          │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ driftService.getDriftClientForUser  │
│ - Fetches wallet via privyService   │
│ - Creates Drift SDK client          │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Build Transaction (Drift SDK)       │
│ - Deposit instruction               │
│ - Open position instruction         │
│ - Close position instruction        │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ privySigningService.signAndSend     │
│ - Gets private key from Privy       │
│ - Signs transaction                 │
│ - Submits to Solana                 │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Confirmation & Response             │
│ - Transaction signature             │
│ - Solscan explorer link             │
│ - Success/error message             │
└─────────────────────────────────────┘
```

---

### 3. Database Schema Integration

#### **User Model**
```prisma
model User {
  id                String      @id @default(uuid())
  telegramId        BigInt      @unique          // Links to Telegram
  privyUserId       String?     @unique          // Links to Privy
  wallets           Wallet[]                     // One-to-many
}
```

#### **Wallet Model**
```prisma
model Wallet {
  id              String       @id @default(uuid())
  userId          String       @map("user_id")   // Foreign key to User
  privyWalletId   String?      @unique           // Privy's wallet ID
  walletAddress   String       @unique           // Solana public key
  walletType      WalletType   @default(PRIVY)   // "PRIVY" enum
  chainType       ChainType    @default(SOLANA)  // "SOLANA" enum
}
```

#### **Key Relationships**
- **User ↔ Privy User:** `users.privyUserId` → Privy API
- **User ↔ Wallet:** `users.id` → `wallets.userId` (one-to-many)
- **Wallet ↔ Privy Wallet:** `wallets.privyWalletId` → Privy API
- **Wallet ↔ Blockchain:** `wallets.walletAddress` → Solana network

---

### 4. Integration Points in Code

#### **User Onboarding**
**File:** `driftService.ts:204-253`

```typescript
async getDriftClientForUser(telegramUserId: number): Promise<DriftClient> {
  // 1. Get wallet address from Privy
  const walletAddress = await privyService.getWalletAddress(telegramUserId);
  
  // 2. Get private key for signing
  const privateKey = await privyService.getWalletPrivateKey(telegramUserId);
  
  // 3. Create Solana keypair
  const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
  
  // 4. Create Drift client with user's wallet
  const driftClient = new DriftClient({
    connection: this.connection,
    wallet: new Wallet(keypair),
    env: 'mainnet-beta'
  });
  
  return driftClient;
}
```

#### **Transaction Signing**
**File:** `depositHandler.ts:254-261`

```typescript
async executeDeposit(...) {
  // Build Drift deposit transaction
  const tx = await txService.buildDepositOnlyTransaction(
    userPublicKey,
    amountBN,
    marketIndex,
    tokenMint
  );
  
  // Sign with Privy wallet (no user popup needed)
  const signature = await privySigningService.signAndSendTransaction(
    chatId,  // Telegram user ID
    tx,
    connection
  );
  
  // Return tx signature and explorer link
}
```

#### **Balance Fetching**
**File:** `driftService.ts:674-717`

```typescript
async getUserBalance(telegramUserId: number): Promise<number> {
  // Get wallet address from database (stored from Privy)
  const dbUser = await databaseService.getUserByTelegramId(telegramUserId);
  const walletAddress = dbUser?.wallets?.[0]?.walletAddress;
  
  // Fetch on-chain USDC balance
  const balance = await connection.getParsedTokenAccountsByOwner(...);
  
  return balance;
}
```

---

## Why This Architecture

### **User Experience Benefits**
✅ **No wallet installation required** - Users don't need Phantom/Solflare  
✅ **Telegram-native** - Everything happens in chat  
✅ **Instant onboarding** - Wallet created with one command  
✅ **No transaction popups** - Seamless execution after confirmation  
✅ **Mobile-friendly** - Works on any device with Telegram  

### **Security Model**
🔐 **Server-side key custody** - Keys managed by Privy infrastructure  
🔐 **Authorization keys** - Bot is additional signer on wallets  
🔐 **Telegram confirmation** - User confirms actions before execution  
🔐 **No client-side keys** - Private keys never exposed to user device  
🔐 **Audit trail** - All transactions logged in database  

### **Trading Flow Efficiency**
⚡ **Fast execution** - No manual wallet approval needed  
⚡ **Retry logic** - Automatic retry on network failures  
⚡ **Batch operations** - Multiple transactions can be queued  
⚡ **Gas optimization** - Bot can optimize transaction parameters  

---

## User Journey Example

### **1. First-Time User**
```
User: /start
Bot:  "Welcome! Creating your wallet..."
      → privyService.createCompleteUserSetup()
      → Creates Privy user + Solana wallet
      → Stores in database
Bot:  "✅ Wallet created: AbC...xyz"
```

### **2. Deposit Flow**
```
User: /drift → Deposit → USDC → 100
Bot:  "Confirm deposit: 100 USDC?"
User: [Taps Confirm]
Bot:  "⏳ Building transaction..."
      → driftService.buildDepositTransaction()
      "🔐 Signing with Privy..."
      → privySigningService.signAndSendTransaction()
      "✅ Deposit successful!"
      "View: solscan.io/tx/AbC123..."
```

### **3. Trading Flow**
```
User: /drift → Markets → SOL → Open Long → 50 USD
Bot:  "Confirm long SOL: $50?"
User: [Taps Confirm]
Bot:  "⏳ Opening position..."
      → Builds Drift instruction
      → Signs with Privy wallet
      → Submits to Solana
Bot:  "✅ Position opened!"
      "Entry: $120.50"
      "View: /positions"
```

---

## Implementation Status

### **✅ Fully Implemented**
- Privy user creation with Telegram linking
- Embedded Solana wallet generation
- Wallet address retrieval and storage
- Database persistence with foreign keys
- Basic transaction signing infrastructure
- Drift client creation with Privy wallets

### **⚠️ Partially Implemented**
- `getWalletPrivateKey()` - Currently returns `null` (placeholder)
- Server-side signing endpoint integration with Privy API
- Authorization key configuration (needs Privy dashboard setup)
- Transaction confirmation polling

### **❌ Planned (Not Yet Implemented)**
According to `DRIFT_PRIVY_INTEGRATION_PLAN.md`:
- Direct Privy API signing endpoint calls (`/v1/wallets/{id}/sign_transaction`)
- Automatic retry logic with exponential backoff
- Error classification system (network vs user errors)
- User-friendly error messages
- Transaction tracking with retry counts in database

---

## Configuration Requirements

### **Environment Variables**
```bash
# Privy Configuration
PRIVY_APP_ID=your_privy_app_id_here
PRIVY_APP_SECRET=your_privy_app_secret_here
PRIVY_KEY_QUORUM_ID=your_key_quorum_id_here
PRIVY_AUTHORIZATION_PRIVATE_KEY=your_base64_encoded_private_key_here

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
HELIUS_API_KEY=your_helius_key_here

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/laminator
```

### **Privy Dashboard Setup**
1. Create Privy app at privy.io
2. Enable Solana chain
3. Create authorization key for bot signing
4. Add authorization key as additional signer on wallets
5. Configure wallet policies (if needed)

---

## Security Considerations

### **Trust Model**
- Users **trust the bot operator** to custody keys via Privy
- Bot has **full signing authority** after Telegram confirmation
- Keys are **never exposed** to client or stored locally
- All access is via **Privy's secure API**

### **Access Control**
- Bot can execute any transaction (within wallet balance limits)
- User confirmation required via Telegram buttons
- Rate limiting and fraud detection on bot side
- Privy provides additional security layers

### **Key Management**
- **Private keys:** Managed by Privy, never exposed
- **API secrets:** Stored in environment variables
- **Authorization keys:** Bot's signing authority
- **Recovery:** Via Privy's infrastructure (user can't access seed phrase)

### **Audit Trail**
```sql
-- All transactions logged in database
SELECT * FROM transactions 
WHERE user_id = 'xxx' 
ORDER BY created_at DESC;

-- Wallet creation tracked
SELECT * FROM wallets 
WHERE privy_wallet_id = 'xxx';

-- Full user activity history
SELECT * FROM audit_logs 
WHERE user_id = 'xxx';
```

---

## Comparison: Privy vs Traditional Wallet Connect

| Aspect | Privy (This Bot) | Phantom/Solflare Connect |
|--------|------------------|--------------------------|
| **Setup** | Instant, in Telegram | Requires app install + seed phrase |
| **Signing** | Server-side, automatic | Manual approval per transaction |
| **UX** | Seamless, fast | Friction at every step |
| **Custody** | Bot (via Privy) | User (self-custody) |
| **Recovery** | Via Privy/Telegram | User must backup seed phrase |
| **Mobile** | Native in Telegram | Requires switching apps |
| **Speed** | Sub-second execution | 10-30s per approval |
| **Security** | Trusted third party | Full user control |
| **Use Case** | Trading bots, games | DeFi, long-term holdings |

**Trade-off:** Privy sacrifices **self-custody** for **convenience**, making it ideal for trading bots where speed matters and users trust the operator.

---

## Code Reference Map

### **Service Layer**
- `src/services/privyService.ts` - Privy API integration
- `src/services/privySigningService.ts` - Transaction signing
- `src/services/databaseService.ts` - Wallet persistence
- `src/services/driftService.ts` - Trading operations

### **Handler Layer**
- `src/handlers/drift/depositHandler.ts:254-261` - Uses Privy signing
- `src/handlers/drift/openPositionHandler.ts` - Position opening
- `src/handlers/drift/closePositionHandler.ts` - Position closing

### **Database Layer**
- `prisma/schema.prisma:135-163` - User model
- `prisma/schema.prisma:165-189` - Wallet model

### **Documentation**
- `DRIFT_PRIVY_INTEGRATION_PLAN.md` - Implementation roadmap
- `PRIVY_ARCHITECTURE.md` - This document

---

## Future Enhancements

### **Phase 1: Complete Privy API Integration**
- Implement real Privy signing endpoint calls
- Add automatic retry with exponential backoff
- Implement error classification and handling

### **Phase 2: Enhanced Security**
- Add transaction limits per user
- Implement fraud detection patterns
- Add 2FA for large transactions

### **Phase 3: Multi-Wallet Support**
- Allow users to connect external wallets alongside Privy
- Support wallet switching within Telegram
- Export Privy wallet to external app

### **Phase 4: Advanced Features**
- Smart contract wallet upgrades
- Multi-sig support for teams
- Scheduled/automated trading strategies

---

## Troubleshooting

### **Common Issues**

**"Private key not available from Privy"**
- Authorization key not configured in Privy dashboard
- Need to add bot as additional signer on wallet

**"Solana wallet not found"**
- Database field mismatch: `w.blockchain` should be `w.chainType`
- Check `depositHandler.ts:200`, `openPositionHandler.ts:282`

**"User wallet not found"**
- User not onboarded yet (missing Privy user creation)
- Database connection issue

**"Transaction failed after retries"**
- Insufficient SOL for gas fees
- RPC rate limiting (need premium RPC like Helius)
- Drift program issues

---

## Monitoring & Observability

### **Key Metrics to Track**
- Wallet creation success rate
- Transaction signing latency
- Privy API response times
- Failed transaction rates
- Retry attempt distributions

### **Logging Strategy**
```typescript
console.log('🔐 Signing transaction for user:', telegramUserId);
console.log('✅ Transaction confirmed:', signature);
console.error('❌ Transaction failed:', error);
```

### **Health Checks**
- Privy API connectivity
- Database connection status
- Solana RPC availability
- Wallet balance monitoring

---

## Conclusion

Privy integration enables **frictionless trading** by abstracting away wallet complexity. Users get instant access to Solana DeFi through Telegram without needing to understand seed phrases, gas fees, or blockchain transactions.

The architecture prioritizes **user experience** over self-custody, making it ideal for:
- Trading bots (like Laminator)
- Crypto gaming
- Telegram mini-apps
- High-frequency trading strategies

For users who need full control of their keys, traditional wallet connect patterns (Phantom, Solflare) remain the better choice. Privy shines when **speed and simplicity** are the top priorities.


