import { Router } from "express";
import driftClient from "../driftClient";
import { PublicKey } from "@solana/web3.js";
import { getUserAccountPublicKey } from "@drift-labs/sdk";

const router = Router();

interface CreateUserRequestBody {
  publicKey: string;
}

router.post("/", async (req, res) => {
  const { publicKey } = req.body as CreateUserRequestBody;

  if (!publicKey) {
    return res.status(400).json({ error: "Missing publicKey" });
  }

  try {
    const authority = new PublicKey(publicKey);

    // Derive expected Drift user account PDA for this authority
    const programId = driftClient["program"].programId;
    const userAccountPubkey = await getUserAccountPublicKey(
      programId,
      authority
    );

    // Check if it already exists on-chain
    const connection = driftClient["program"].provider.connection;
    const existing = await connection.getAccountInfo(userAccountPubkey);

    if (existing) {
      console.log("User already exists", userAccountPubkey.toBase58());
      return res.json({
        success: true,
        message: "User already exists",
        userAccountPublicKey: userAccountPubkey.toBase58(),
      });
    }

    // Ensure server wallet matches provided authority, otherwise we cannot sign
    const serverAuthority = driftClient["wallet"].publicKey;
    if (!serverAuthority.equals(authority)) {
      console.log(
        "Cannot create Drift user for external authority",
        authority.toBase58()
      );
      return res.status(500).json({
        error:
          "Server cannot initialize user for a different authority. Use the server wallet public key or initialize client-side.",
      });
    }

    console.log("Creating new Drift user", authority.toBase58());
    const [txSig, createdUserPk] = await driftClient.initializeUserAccount();

    return res.json({
      success: true,
      message: "User created",
      txSig,
      userAccountPublicKey: createdUserPk.toBase58(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create Drift user" });
  }
});

export default router;
