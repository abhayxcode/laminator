import { Connection, Keypair } from "@solana/web3.js";
import { DriftClient, Wallet } from "@drift-labs/sdk";
import * as dotenv from "dotenv";

dotenv.config();

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error("PRIVATE_KEY not found in .env file");
}

// The private key can be in two formats: a base58 encoded string or a JSON array of numbers.
let keypair: Keypair;
try {
  // Try parsing as a JSON array
  const secretKey = Uint8Array.from(JSON.parse(privateKey));
  keypair = Keypair.fromSecretKey(secretKey);
} catch (e) {
  // Otherwise, assume it's a base58 encoded string
  const bs58 = require("bs58");
  keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
}

const wallet = new Wallet(keypair);
console.log("wallet", wallet);

const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) {
  throw new Error("RPC_URL not found in .env file");
}

const connection = new Connection(rpcUrl);

const driftClient = new DriftClient({
  connection,
  wallet,
  env: "devnet",
});

console.log("Subscribing to DriftClient...");
driftClient.subscribe().then(() => {
  console.log("DriftClient subscribed");
});

export default driftClient;
