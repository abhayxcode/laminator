# Privy Authentication Error Fix

## Problem

When trying to sign transactions (deposit, open position, etc.), you're getting this error:

```
AuthenticationError: 401 {"error":"No valid user session keys available"}
```

## Root Cause

The error occurs because of a mismatch in how wallets are created vs. how they're retrieved:

1. **Wallet Creation**: Wallets are created as **server-owned** with `owner_id: keyQuorumId`
2. **Wallet Retrieval**: The old code tried to find wallets in Privy's `user.linked_accounts`
3. **The Problem**: Server-owned wallets are NOT in `linked_accounts`, so the lookup failed

## What Was Fixed

### 1. **Fixed Wallet Retrieval** (`src/services/privyService.ts`)

**Before** (❌ WRONG):
```typescript
// Tried to find wallet in user.linked_accounts (doesn't work for server-owned wallets)
const user = await this.getUserByTelegramId(telegramUserId);
const wallet = user.linked_accounts.find(isEmbeddedWalletLinkedAccount);
```

**After** (✅ CORRECT):
```typescript
// Get wallet ID from database (where we store server-owned wallets)
const dbUser = await databaseService.getUserByTelegramId(telegramUserId);
const privyWalletId = dbUser.wallets[0].privyWalletId;
const wallet = await this.privyClient.wallets().get(privyWalletId);
```

### 2. **Improved Error Messages**

Added detailed logging and helpful error messages:
- Shows exactly which wallet is being used
- Shows which authorization key is being used
- Provides specific troubleshooting steps for 401 errors

## How to Fix Your Setup

### Option 1: Quick Fix (Recommended if you have test data)

1. **Delete existing wallets** from:
   - Your PostgreSQL database (truncate `wallets` table)
   - Privy Dashboard (delete all wallets for your app)

2. **Verify your `.env` configuration**:
   ```bash
   # Must match EXACTLY with Privy Dashboard
   PRIVY_KEY_QUORUM_ID=kq_your_exact_key_quorum_id
   PRIVY_AUTHORIZATION_PRIVATE_KEY=your_base64_private_key
   ```

3. **Restart the bot**:
   ```bash
   npm run dev
   ```

4. **Test wallet creation**:
   - Send `/create` in Telegram
   - Wallet should be created successfully
   - Try a deposit or trade operation

### Option 2: Verify Existing Setup

If you want to keep existing wallets, verify they were created correctly:

1. **Check Privy Dashboard**:
   - Go to Wallets section
   - Find your wallet
   - Verify `owner_id` matches your `PRIVY_KEY_QUORUM_ID`

2. **Check Database**:
   ```sql
   SELECT * FROM wallets WHERE privy_wallet_id IS NOT NULL;
   ```

3. **If owner_id is wrong**: You need to recreate the wallet (no way to change owner after creation)

## Testing the Fix

1. **Create a new wallet**:
   ```
   /create
   ```
   You should see: "🎉 Wallet Created Successfully!"

2. **Check wallet details**:
   ```
   /wallet
   ```
   Should show wallet address and status

3. **Try a transaction** (once you have SOL):
   ```
   /dexdrift
   ```
   Select "Deposit" and follow prompts

4. **Check logs** for:
   ```
   🔍 Looking up wallet for user...
   📝 Found wallet wlt_abc123 at address [address]
   🔐 Signing transaction with authorization key: kq_xyz789
   📡 Calling Privy signTransaction API...
   ✅ Transaction signed successfully by Privy
   ```

## Common Issues & Solutions

### Issue 1: "User wallet not found in database"
**Cause**: No wallet created yet or database is empty
**Solution**: Run `/create` to create a wallet

### Issue 2: "Privy authentication failed (401)"
**Cause**:
- Wrong `PRIVY_KEY_QUORUM_ID` in `.env`
- Wrong `PRIVY_AUTHORIZATION_PRIVATE_KEY` in `.env`
- Wallet created with wrong `owner_id`

**Solution**:
1. Double-check `.env` values match Privy Dashboard exactly
2. Delete and recreate wallets
3. Restart bot

### Issue 3: Wallet exists but still getting 401
**Cause**: Old wallet created before fix
**Solution**: Delete wallet and recreate with `/create`

## Verification Checklist

- [ ] `.env` has correct `PRIVY_KEY_QUORUM_ID`
- [ ] `.env` has correct `PRIVY_AUTHORIZATION_PRIVATE_KEY`
- [ ] Key quorum registered in Privy Dashboard
- [ ] Key quorum threshold set to 1
- [ ] Database is connected (check startup logs)
- [ ] Wallet created successfully with `/create`
- [ ] Wallet shows in `/wallet` command
- [ ] Logs show wallet lookup succeeds
- [ ] Transaction signing works without 401 error

## Still Having Issues?

1. **Enable debug logging**: Check console output when running transactions
2. **Verify Privy Dashboard**: Check that key quorum exists and is active
3. **Check database**: Ensure wallet has `privyWalletId` populated
4. **Test with fresh wallet**: Delete everything and start clean

## Architecture Notes

**Server-Owned Wallets** (what we use):
- Created with `owner_id` set to key quorum ID
- Fully controlled by the server (no user interaction needed)
- Sign transactions using authorization private key
- NOT in user's `linked_accounts` (stored in database instead)

**User-Owned Wallets** (not used):
- Created without `owner_id`
- Require user session to sign
- Show up in user's `linked_accounts`
- User must approve each transaction

We use **server-owned** wallets because:
- ✅ Seamless UX (no user approval needed for each tx)
- ✅ Works in Telegram bot environment
- ✅ Full automation possible
- ✅ Faster transaction execution

## Files Changed

1. `src/services/privyService.ts`:
   - Fixed `getUserWallet()` to use database instead of linked_accounts
   - Improved `signTransaction()` error handling and logging

2. `PRIVY_KEY_QUORUM_SETUP.md`:
   - Updated troubleshooting section with detailed solutions

## Next Steps

After fixing the Privy authentication:
1. ✅ Wallet creation works
2. ✅ Wallet retrieval works
3. ✅ Transaction signing works
4. 🔜 Implement actual Drift transactions (deposit, open position, close position)
5. 🔜 Add transaction confirmation and error handling
6. 🔜 Implement balance updates after transactions
