# Wallet Creation: User + Authorization Key Ownership

## Overview

All user wallets **must be owned by both**:
1. **User ID** - The authenticated Privy user
2. **Authorization Key** - The server's key quorum (authorization key)

This ensures that **both the user and server must approve** all wallet operations, providing dual control and security.

## Key Requirements

- ❌ **Do NOT create wallets owned only by user ID**
- ❌ **Do NOT create wallets owned only by authorization key**
- ✅ **ONLY create wallets owned by BOTH user ID AND authorization key**

## Wallet Creation Pattern

When creating a wallet, use this pattern:

```typescript
const wallet = await privyClient.wallets().create({
  chain_type: 'solana',
  owner: {
    user_id: userId  // User owns the wallet
  },
  additional_signers: [
    {
      signer_id: keyQuorumId,  // Key quorum ID (authorization key) - server must also approve
      override_policy_ids: []
    }
  ]
});
```

**Note:** The `keyQuorumId` is the **Key Quorum ID** from `PRIVY_KEY_QUORUM_ID` in your `.env` file. It's used as `signer_id` in `additional_signers`, not as `owner_id`.

## Your Authorization Key

- **Public Key** (for Privy Dashboard):
```
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoT
DA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
-----END PUBLIC KEY-----
```

**Alternative format (base64 only - try this if you get errors):**
```
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoTDA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
```

- **Private Key** (in `.env`):
```
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpfHMqx7tIUSQoRXTLbRMl
```

## Register Key Quorum in Privy Dashboard

### Step-by-Step Instructions

1. **Navigate to Authorization Keys**
   - Go to: **Settings** → **Authorization Keys**
   - Or direct link: https://dashboard.privy.io/apps?authorization-keys

2. **Open Register Key Quorum Modal**
   - Click **"New key"** button (top right, purple)
   - Click **"Register key quorum instead"**

3. **Fill in the Form:**
   - **Quorum name**: Enter a name (e.g., `laminator-tg-bot-server-key`)
   - **Public keys**: 
     - **Try option 1:** Paste the full PEM format (with BEGIN/END lines) - see above
     - **If that fails, try option 2:** Paste ONLY the base64 string (without BEGIN/END lines):
       ```
       MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoTDA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
       ```
   - **Authorization threshold**: Set to `1` (required field - cannot be empty!)

4. **Save**
   - Click **"Save keys"** button
   - Copy the Key Quorum ID that appears (starts with `kq_` or `vyiv...`)

## Environment Variables

Your `.env` file should contain:

```bash
PRIVY_APP_ID=your_app_id_here
PRIVY_APP_SECRET=your_app_secret_here
PRIVY_KEY_QUORUM_ID=kq_your_id_from_dashboard_here
PRIVY_AUTHORIZATION_PRIVATE_KEY=MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpfHMqx7tIUSQoRXTLbRMl
```

## How It Works

1. **Wallet Ownership**: User ID is the primary owner (`owner: {user_id: userId}`)
2. **Additional Signer**: Key Quorum ID (from `PRIVY_KEY_QUORUM_ID`) is used as `signer_id` in `additional_signers`
3. **Transaction Approval**: Both user and server (key quorum) approval required
4. **Security**: No single party can control the wallet independently

**Key Point:** The Key Quorum ID is **still required** and **still used** - it's just used as an additional signer (`signer_id`) instead of as the wallet owner (`owner_id`).

## Removed Authentication Methods

The following are **NOT used** and should be removed from code:

- ❌ Wallets owned only by user ID (no server control)
- ❌ Wallets owned only by authorization key (no user control)  
- ❌ Client-side wallet creation without server approval
- ❌ Any wallet creation that doesn't require both user and server

## Verification

After wallet creation, verify:
- ✅ Wallet `owner` contains the user ID (`user_id` field)
- ✅ Wallet `additional_signers` array contains the **Key Quorum ID** (`signer_id` field)
- ✅ Both parties must sign transactions (user + key quorum)
- ✅ Server can sign on behalf of user when authorized using the key quorum

**Required Environment Variable:**
- ✅ `PRIVY_KEY_QUORUM_ID` - This is the Key Quorum ID used as `signer_id` in wallet creation

## Troubleshooting Key Quorum Registration Errors

If you see **"There was an error creating the key quorum"**:

1. **Check Public Key Format:**
   - ✅ Try pasting **ONLY the base64 content** (without BEGIN/END lines)
   - ✅ Remove any spaces or newlines from the public key
   - ✅ Ensure the public key is on a single line if using base64-only format
   - ❌ Don't mix formats - use either full PEM OR base64-only

2. **Check Required Fields:**
   - ✅ **Quorum name** must be filled in (e.g., `server-key`)
   - ✅ **Authorization threshold** must be set to `1` (cannot be empty!)
   - ✅ **Public keys** field must contain at least one valid public key

3. **Public Key Format Options:**
   
   **Option A - Full PEM format:**
   ```
   -----BEGIN PUBLIC KEY-----
   MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoT
   DA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
   -----END PUBLIC KEY-----
   ```
   
   **Option B - Base64 only (remove line breaks):**
   ```
   MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoTDA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
   ```

4. **If still failing:**
   - Verify your public key is valid (check `public.pem` file exists and is readable)
   - Ensure you're using the correct app in Privy Dashboard
   - Try creating a new key pair if the current one is invalid
   - Check browser console for detailed error messages

