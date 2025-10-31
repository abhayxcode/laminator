# Privy Key Quorum Setup Guide

## Step 1: Register Key Quorum in Privy Dashboard

1. **Go to Privy Dashboard**
   - Visit: https://dashboard.privy.io
   - Navigate to your app

2. **Navigate to Authorization Keys**
   - Go to: **Settings** → **Authorization Keys** (or use direct link: https://dashboard.privy.io/apps?authorization-keys)

3. **Create New Key Quorum**
   - Click **"New key"** button (top right)
   - Click **"Register key quorum instead"** option

4. **Enter Key Details**
   - **Public keys**: Paste your PUBLIC KEY (the entire content including BEGIN/END lines):
     ```
     -----BEGIN PUBLIC KEY-----
     MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENcFsc5/SxO1s3m5w44o1csOoNeoT
     DA3HQPbZ7TNesotCy52/FdIROOOY/ErM2Odjyl0C79vavAyl1/0W7PpFVA==
     -----END PUBLIC KEY-----
     ```
   - **Authorization threshold**: Set to `1` (allows single key to sign)
   - **Quorum name**: Give it a name like "Server Bot Key" or "Trading Bot Authorization"

5. **Save the Key Quorum ID**
   - After creating, Privy will show you a **Key Quorum ID**
   - **Copy this ID** - you'll need it for your `.env` file
   - It looks like: `kq_abc123xyz...` or similar format

## Step 2: Update Your Environment Variables

Add these to your `.env` file:

```bash
# Privy Configuration
PRIVY_APP_ID=your_privy_app_id_here
PRIVY_APP_SECRET=your_privy_app_secret_here

# Key Quorum ID (from Privy Dashboard after step 1)
PRIVY_KEY_QUORUM_ID=kq_your_key_quorum_id_here

# Private Key (base64 PKCS8 format - already generated)
PRIVY_AUTHORIZATION_PRIVATE_KEY=MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgPvzcp7su+1sW96RSMWNoKijul4q8E6MZnfKUkDQ2a82hRANCAAQ1wWxzn9LE7WzebnDjijVyw6g16hMMDcdA9tntM16yi0LLnb8V0hE445j8SszY52PKXQLv29q8DKXX/Rbs+kVU
```

## Step 3: Clean Up Key Files

After copying the values, delete the temporary key files:

```bash
rm private.pem public.pem private_key_base64.txt
```

⚠️ **Security Note**: 
- Never commit these keys to git
- Keep your private key secure
- The private key is already in base64 format - use it directly in `.env`

## Step 4: Test the Setup

1. Restart your bot
2. Try creating a wallet: `/create`
3. Try signing a transaction (deposit/open position)

If you see the "No valid user session keys available" error, double-check:
- ✅ Key quorum ID is correct
- ✅ Private key is correct (base64 format)
- ✅ Key quorum was created successfully in dashboard

## Troubleshooting

### Error: "Key quorum not found"
- Verify the `PRIVY_KEY_QUORUM_ID` matches exactly what's in Privy Dashboard
- Check that the key quorum was created in the correct app

### Error: "Invalid authorization signature"
- Verify the `PRIVY_AUTHORIZATION_PRIVATE_KEY` is the base64 version (not PEM)
- Make sure there are no extra spaces or newlines in the `.env` file

### Error: "No valid user session keys available"
- **This is the most common error** - it means Privy cannot find authorization for the wallet
- **Root Cause**: The wallet was either:
  1. Created without `owner_id` (user-owned instead of server-owned)
  2. Created with incorrect `owner_id` value
  3. The key quorum ID in `.env` doesn't match the wallet's owner
- **Solution**:
  1. Verify `PRIVY_KEY_QUORUM_ID` matches EXACTLY the ID from Privy Dashboard
  2. Delete existing wallets in database and Privy Dashboard
  3. Restart the bot to recreate wallets with correct `owner_id`
  4. Test with `/create` to create a new wallet
- **Check**: Ensure wallets are created with `owner_id: this.authorizationKey` in the code
- **Verify**: Key quorum has authorization threshold of 1

