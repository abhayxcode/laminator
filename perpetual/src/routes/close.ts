import { Router } from "express";
import driftClient from "../driftClient";
import { PositionDirection } from "@drift-labs/sdk";

const router = Router();

interface CloseRequestBody {
  marketIndex: number;
}

router.post("/", async (req, res) => {
  const { marketIndex } = req.body as CloseRequestBody;

  if (marketIndex === undefined) {
    return res.status(400).json({ error: "Missing marketIndex" });
  }

  try {
    const user = driftClient.getUser();
    const position = user.getPerpPosition(marketIndex);

    if (!position || position.baseAssetAmount.isZero()) {
      return res.status(200).json({ message: "No open position to close" });
    }

    const direction = position.baseAssetAmount.isNeg()
      ? PositionDirection.LONG
      : PositionDirection.SHORT;

    const txSig = await driftClient.closePosition(marketIndex);

    console.log(`Position closed. Transaction signature: ${txSig}`);
    res.json({ success: true, txSig });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to close position" });
  }
});

export default router;
