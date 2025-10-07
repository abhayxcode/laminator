import { Router } from "express";
import driftClient from "../driftClient";
import { BN, QUOTE_SPOT_MARKET_INDEX, initialize } from "@drift-labs/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

declare function getUserPublicKey(telegramUserId: string | number): string;

const router = Router();

interface DepositRequestBody {
  telegramUserId: string | number;
  amount: number;
}

const USDC_DECIMALS = 6;

router.post("/deposit-collateral", async (req, res) => {
  const { telegramUserId, amount } = req.body as DepositRequestBody;

  if (telegramUserId === undefined || amount === undefined) {
    return res.status(400).json({ error: "Missing telegramUserId or amount" });
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    // Resolve user's wallet public key from Telegram ID
    const userPubkeyBase58 = getUserPublicKey(telegramUserId);
    const userAuthority = new PublicKey(userPubkeyBase58);

    // Convert human amount to smallest units BN (USDC 6 decimals)
    const amountInteger = Math.round(amount * 10 ** USDC_DECIMALS);
    const amountBN = new BN(amountInteger);

    // Find/Create ATA for USDC under the user's authority.
    //    We use the SDK config to obtain the USDC mint for the current env.
    const sdkConfig = initialize({ env: (driftClient as any).env ?? "devnet" });
    const usdcMint = new PublicKey(sdkConfig.USDC_MINT_ADDRESS);

    const userUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
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
    const ataInfo = await connection.getAccountInfo(userUsdcAta);
    if (!ataInfo) {
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        payer, // payer
        userUsdcAta, // ata
        userAuthority, // owner
        usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const txSigCreate = await (driftClient as any).sendTransaction([
        createAtaIx,
      ]);
      console.log(
        "Created USDC ATA for user:",
        userUsdcAta.toBase58(),
        txSigCreate
      );
    }

    // Deposit collateral into Drift (quote market index is USDC)
    const txSig = await driftClient.deposit(
      amountBN,
      QUOTE_SPOT_MARKET_INDEX,
      userUsdcAta
    );

    console.log("Deposit tx signature:", txSig);
    return res.json({ success: true, txSig });
  } catch (error) {
    console.error("Deposit collateral error:", error);
    return res.status(500).json({ error: "Failed to deposit collateral" });
  }
});

export default router;
