import express from "express";
import { perpetualService, PerpetualOrderRequest, DepositRequest } from "./services/perpetualService";

const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    service: "Perpetual Trading API"
  });
});

// Get available markets
app.get("/markets", async (req, res) => {
  try {
    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const markets = await perpetualService.getMarkets();
    res.json({ success: true, markets });
  } catch (error) {
    console.error("Error fetching markets:", error);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// Create user account
app.post("/users", async (req, res) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({ error: "Missing publicKey" });
    }

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const result = await perpetualService.createUserAccount(publicKey);
    res.json(result);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user account" });
  }
});

// Deposit collateral
app.post("/deposit", async (req, res) => {
  try {
    const depositRequest = req.body as DepositRequest;

    if (!depositRequest.publicKey || !depositRequest.amount || !depositRequest.collateral) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof depositRequest.amount !== "number" || !Number.isFinite(depositRequest.amount) || depositRequest.amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const result = await perpetualService.depositCollateral(depositRequest);
    res.json(result);
  } catch (error) {
    console.error("Error depositing collateral:", error);
    res.status(500).json({ error: "Failed to deposit collateral" });
  }
});

// Place perpetual order
app.post("/order", async (req, res) => {
  try {
    const orderRequest = req.body as PerpetualOrderRequest;

    if (
      orderRequest.marketIndex === undefined ||
      !orderRequest.direction ||
      !orderRequest.baseAssetAmount ||
      !orderRequest.orderType
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const result = await perpetualService.placeOrder(orderRequest);
    res.json(result);
  } catch (error) {
    console.error("Error placing order:", error);
    res.status(500).json({ error: "Failed to place order" });
  }
});

// Close position
app.post("/close", async (req, res) => {
  try {
    const { marketIndex } = req.body;

    if (marketIndex === undefined) {
      return res.status(400).json({ error: "Missing marketIndex" });
    }

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const result = await perpetualService.closePosition(marketIndex);
    res.json(result);
  } catch (error) {
    console.error("Error closing position:", error);
    res.status(500).json({ error: "Failed to close position" });
  }
});

// Get user positions
app.get("/positions/:publicKey", async (req, res) => {
  try {
    const { publicKey } = req.params;

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const positions = await perpetualService.getUserPositions(publicKey);
    res.json({ success: true, positions });
  } catch (error) {
    console.error("Error fetching positions:", error);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

// Get user positions (without publicKey - uses server wallet)
app.get("/positions", async (req, res) => {
  try {
    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const positions = await perpetualService.getUserPositions();
    res.json({ success: true, positions });
  } catch (error) {
    console.error("Error fetching positions:", error);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

// Get user balance
app.get("/balance/:publicKey", async (req, res) => {
  try {
    const { publicKey } = req.params;

    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const balance = await perpetualService.getUserBalance(publicKey);
    res.json({ success: true, balance });
  } catch (error) {
    console.error("Error fetching balance:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

// Get user balance (without publicKey - uses server wallet)
app.get("/balance", async (req, res) => {
  try {
    if (!(await perpetualService.isReady())) {
      return res.status(503).json({ error: "Perpetual service not ready" });
    }

    const balance = await perpetualService.getUserBalance();
    res.json({ success: true, balance });
  } catch (error) {
    console.error("Error fetching balance:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

export default app;
