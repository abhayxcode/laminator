// // file: place-perp-order.ts
// import * as anchor from "@coral-xyz/anchor";
// import { Connection, Keypair, PublicKey } from "@solana/web3.js";
// import BN from "bn.js";
// import {
//   initialize,
//   DriftClient,
//   Wallet,
//   loadKeypair, // some helper examples use loadKeypair, otherwise use Keypair.fromSecretKey
//   PositionDirection,
//   OrderType,
//   BASE_PRECISION,
//   PRICE_PRECISION,
//   QUOTE_PRECISION,
// } from "@drift-labs/sdk";
// import dotenv from "dotenv";
// dotenv.config();

// /**
//  * NOTE:
//  * - Install: npm i @drift-labs/sdk @coral-xyz/anchor bn.js dotenv
//  * - Use the SDK docs/examples for exact function names if your installed SDK version differs.
//  * - This example is for illustration; adapt to exact SDK version.
//  */

// async function makeDriftClientFromKeypair(
//   keypairPathOrArray: string | number[] | Uint8Array,
//   rpcUrl: string,
//   env: "devnet" | "mainnet-beta" = "devnet"
// ) {
//   // load keypair (simple helper)
//   let kp: Keypair;
//   if (typeof keypairPathOrArray === "string") {
//     kp = Keypair.fromSecretKey(
//       Buffer.from(
//         JSON.parse(require("fs").readFileSync(keypairPathOrArray, "utf8"))
//       )
//     );
//   } else if (Array.isArray(keypairPathOrArray)) {
//     kp = Keypair.fromSecretKey(Uint8Array.from(keypairPathOrArray));
//   } else {
//     kp = Keypair.fromSecretKey(keypairPathOrArray);
//   }

//   const connection = new Connection(rpcUrl, "confirmed");
//   const wallet = new anchor.Wallet(kp); // Anchor wallet object
//   const provider = new anchor.AnchorProvider(connection, wallet, {
//     commitment: "confirmed",
//     preflightCommitment: "confirmed",
//   });

//   // initialize SDK config (loads program ids for env)
//   const sdkConfig = initialize({ env }); // reads known program IDs for drift
//   // create DriftClient
//   const driftClient = new DriftClient({
//     connection,
//     wallet: provider.wallet, // anchor wallet or similar
//     programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
//   });

//   await driftClient.subscribe(); // subscribe to accounts & markets
//   return { driftClient, provider };
// }

// /**
//  * Converts a floating base amount (e.g., 0.5 SOL) into base lots / BN using BASE_PRECISION
//  */
// function baseAmountToBN(amount: number) {
//   // BASE_PRECISION is a BN constant (1e9 typical); convert properly:
//   // convert to integer base units then BN
//   const basePrecisionNum = Number(BASE_PRECISION.toString()); // careful: depends on SDK representation
//   const integer = Math.round(amount * basePrecisionNum);
//   return new BN(integer);
// }

// async function placeMarketPerpOrderExample() {
//   const KEYPAIR_PATH = process.env.PRIVATE_KEY_PATH || process.env.KEYPAIR_PATH; // path to keypair JSON or array
//   const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
//   const ENV: "devnet" | "mainnet-beta" = (process.env.ENV as any) || "devnet";

//   const { driftClient, provider } = await makeDriftClientFromKeypair(
//     KEYPAIR_PATH!,
//     RPC,
//     ENV
//   );

//   // Choose market index (SDK exposes markets list). For demo, pick marketIndex=0
//   const markets = driftClient.getPerpMarketAccounts(); // sdk helper to get loaded markets
//   if (!markets || markets.length === 0) {
//     throw new Error("No perp markets loaded in client");
//   }
//   const marketIndex = 0; // adapt to proper index for e.g., SOL-PERP

//   // Ensure user account exists (SDK provides hasUser / initialize helpers)
//   const hasUser = await driftClient.hasUserAccount();
//   if (!hasUser) {
//     console.log("Creating user account (devnet demo).");
//     await driftClient.initializeUserAccount(); // SDK helper — may require specific args in version
//   }

//   // Ensure collateral exists (devnet: airdrop + deposit helpers may be used)
//   // You should deposit protocol-accepted collateral (like USDC)
//   // Example (pseudocode): await driftClient.depositCollateral(usdcAmountBN);

//   // Build order params
//   const side: "long" | "short" = "long"; // or 'short'
//   const humanBaseSize = 0.5; // e.g., 0.5 SOL
//   const baseAssetAmount = baseAmountToBN(humanBaseSize);

//   // For market order:
//   const orderParams = {
//     marketIndex,
//     baseAssetAmount,
//     direction:
//       side === "long" ? PositionDirection.LONG : PositionDirection.SHORT,
//     orderType: OrderType.MARKET,
//     reduceOnly: false,
//     postOnly: false,
//   };

//   console.log("Placing market order...", orderParams);

//   try {
//     // placeAndTakePerpOrder will attempt to place and take (market-like) — SDK method names vary by version
//     const res = await driftClient.placeAndTakePerpOrder(orderParams);
//     // Many SDK versions return a signature or an object; print it
//     console.log("Place order response:", res);
//     // If SDK returns txSig:
//     const txSig = typeof res === "string" ? res : res?.txSig ?? res?.signature;
//     if (txSig) {
//       console.log("Transaction signature:", txSig);
//       console.log(
//         `Explorer link: https://explorer.solana.com/tx/${txSig}?cluster=${ENV}`
//       );
//     }

//     // wait a tiny bit and fetch user account snapshot
//     await new Promise((r) => setTimeout(r, 3000));
//     const { userAccount } = await driftClient.getUserAccountAndSlot(
//       provider.wallet.publicKey
//     );
//     console.log(
//       "User account positions:",
//       userAccount?.perpPositions ?? "none"
//     );
//   } catch (err) {
//     console.error("Error placing perp order:", err);
//     throw err;
//   } finally {
//     await driftClient.unsubscribe();
//   }
// }

// if (require.main === module) {
//   placeMarketPerpOrderExample().catch((e) => {
//     console.error("fatal", e);
//     process.exit(1);
//   });
// }
