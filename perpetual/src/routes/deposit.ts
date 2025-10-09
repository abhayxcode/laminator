import { Router } from "express";
import driftClient from "../driftClient";
import {
  BN,
  QUOTE_SPOT_MARKET_INDEX,
  getUserAccountPublicKey,
} from "@drift-labs/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";

// In-memory mapping of Telegram user IDs to Solana public keys
// In production, this should be stored in a database
const userWalletMap = new Map<string | number, string>();

// Helper function to map Telegram user ID to Solana public key
// function getUserPublicKey(telegramUserId: string | number): string {
//   const publicKey = userWalletMap.get(telegramUserId);
//   if (!publicKey) {
//     throw new Error(`No wallet found for Telegram user ID: ${telegramUserId}`);
//   }
//   return publicKey;
// }

// Helper function to register a user's wallet (for testing/development)
export function registerUserWallet(
  telegramUserId: string | number,
  publicKey: string
): void {
  userWalletMap.set(telegramUserId, publicKey);
  console.log(
    `Registered wallet for Telegram user ${telegramUserId}: ${publicKey}`
  );
}

const router = Router();

interface DepositRequestBody {
  publicKey: string;
  collateral: {
    mint: string;
    decimals: number;
  };
  amount: number; // in USDC units (e.g., 12.34)
}

router.post("/deposit-collateral", async (req, res) => {
  const { publicKey, collateral, amount } = req.body as DepositRequestBody;

  if (publicKey === undefined || amount === undefined) {
    return res.status(400).json({ error: "Missing publicKey or amount" });
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    const userPubkeyBase58 = publicKey;
    const userAuthority = new PublicKey(userPubkeyBase58);

    //Convert human amount to smallest units BN (USDC 6 decimals)
    const amountInteger = Math.round(amount * 10 ** collateral.decimals);
    const amountBN = new BN(amountInteger);

    const collateralMint = new PublicKey(collateral.mint);

    // 4) Find/Create ATA for collateral under the user's authority
    const userCollateralAta = getAssociatedTokenAddressSync(
      collateralMint,
      userAuthority,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Ensure ATA exists (idempotent instruction)
    const connection: Connection =
      (driftClient as any).connection ??
      (driftClient as any).program.provider.connection;
    const payer = (driftClient as any).wallet.publicKey as PublicKey;
    const ataInfo = await connection.getAccountInfo(userCollateralAta);

    if (!ataInfo) {
      // const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      //   payer, // payer
      //   userUsdcAta, // ata
      //   userAuthority, // owner
      //   usdcMint,
      //   TOKEN_PROGRAM_ID,
      //   ASSOCIATED_TOKEN_PROGRAM_ID
      // );
      // const txSigCreate = await (driftClient as any).sendTransaction([
      //   createAtaIx,
      // ]);
      // console.log(
      //   "Created USDC ATA for user:",
      //   userUsdcAta.toBase58(),
      //   txSigCreate
      // );
    }

    if (!ataInfo) {
      console.log("Creating ATA for user...");
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer, // fee payer
          userCollateralAta, // associated token address to create
          userAuthority, // owner of the ATA
          collateralMint
        )
      );

      const sig = await driftClient.txSender.send(tx, [
        /*signers if needed*/
      ]);
      console.log("ATA created:", sig);
    }

    // 6) Check if user has a Drift account, create if not
    const programId = driftClient["program"].programId;
    const userAccountPubkey = await getUserAccountPublicKey(
      programId,
      userAuthority
    );
    const existingUserAccount = await connection.getAccountInfo(
      userAccountPubkey
    );

    if (!existingUserAccount) {
      console.log("User Drift account not found, creating...");
      // Note: This will only work if the server wallet is the same as userAuthority
      // In production, users should create their own Drift accounts
      if (!payer.equals(userAuthority)) {
        return res.status(400).json({
          error:
            "User must create their own Drift account first. Use /users endpoint with their public key.",
        });
      }

      const [txSigUser, createdUserPk] =
        await driftClient.initializeUserAccount();
      console.log(
        "Created Drift user account:",
        createdUserPk.toBase58(),
        txSigUser
      );
    }

    // Deposit collateral into Drift using the user's ATA
    // Note: This requires the user's wallet to sign, so we need to handle this differently
    // For now, we'll assume the server wallet is the same as the user wallet
    if (!payer.equals(userAuthority)) {
      return res.status(400).json({
        error:
          "Deposit must be initiated by the wallet owner. Server cannot deposit for external wallets.",
      });
    }

    const txSig = await driftClient.deposit(
      amountBN,
      QUOTE_SPOT_MARKET_INDEX,
      userCollateralAta
    );

    console.log("Deposit tx signature:", txSig);
    return res.json({ success: true, txSig });
  } catch (error) {
    console.error("Deposit collateral error:", error);
    return res.status(500).json({ error: "Failed to deposit collateral" });
  }
});

// Endpoint to register a user's wallet (for testing/development)
interface RegisterWalletRequestBody {
  telegramUserId: string | number;
  publicKey: string;
}

router.post("/register-wallet", async (req, res) => {
  const { telegramUserId, publicKey } = req.body as RegisterWalletRequestBody;

  if (!telegramUserId || !publicKey) {
    return res
      .status(400)
      .json({ error: "Missing telegramUserId or publicKey" });
  }

  try {
    // Validate that the public key is a valid Solana public key
    new PublicKey(publicKey);

    registerUserWallet(telegramUserId, publicKey);

    return res.json({
      success: true,
      message: "Wallet registered successfully",
      telegramUserId,
      publicKey,
    });
  } catch (error) {
    console.error("Register wallet error:", error);
    return res.status(400).json({
      error: "Invalid public key format",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
