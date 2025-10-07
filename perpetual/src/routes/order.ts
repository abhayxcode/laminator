import { Router } from "express";
import driftClient from "../driftClient";
import {
  OrderType,
  PositionDirection,
  BN,
  BASE_PRECISION,
  PRICE_PRECISION,
} from "@drift-labs/sdk";

// type OrderRequestBody = {
//   marketIndex: number;
//   direction: 'long' | 'short' | string;
//   price?: number | null;
//   baseAssetAmount: number;
//   orderType: 'market' | 'limit' | string;
// };

const router = Router();

interface OrderRequestBody {
  marketIndex: number;
  direction: "long" | "short" | string;
  price: number;
  baseAssetAmount: number;
  orderType: "market" | "limit" | string;
}

router.post("/", async (req, res) => {
  const { marketIndex, direction, price, baseAssetAmount, orderType } =
    req.body as OrderRequestBody;

  if (
    marketIndex === undefined ||
    !direction ||
    !baseAssetAmount ||
    !orderType
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Validate market & direction
    const positionDirection =
      direction === "long" ? PositionDirection.LONG : PositionDirection.SHORT;

    const market = driftClient.getPerpMarketAccount(marketIndex);
    if (!market) {
      return res.status(400).json({ error: "Invalid market index" });
    }

    // Convert amounts to BN
    const baseAssetAmountBN = new BN(
      Math.round(baseAssetAmount * Number(BASE_PRECISION.toString()))
    );
    const priceBN = new BN(
      Math.round(price * Number(PRICE_PRECISION.toString()))
    );

    // Check user's account and collateral
    //   const userAccount = await driftClient.getUserAccount();
    // const marginRequirement = market.getInitialMarginRequirement(
    //   baseAssetAmountBN,
    //   positionDirection
    // );

    // if (userAccount?.totalCollateral.lt(marginRequirement)) {
    //   const requiredCollateral = marginRequirement.sub(
    //     userAccount.totalCollateral
    //   );

    //   console.log(
    //     `Insufficient collateral. Depositing ${requiredCollateral.toString()} tokens...`
    //   );

    //   // Replace `usdcMint` with the mint of your collateral token
    //   await driftClient.depositCollateral({
    //     amount: requiredCollateral,
    //     mint: usdcMint,
    //   });

    //   console.log("Collateral deposited successfully.");
    // }

    // ===================================

    // const userMarginAccount = driftClient.getUser();
    // const collateral = userMarginAccount?.getTotalCollateral();
    // const marketMarginRequirement = market.getInitialMarginRequirement(
    //   baseAssetAmountBN,
    //   positionDirection
    // );

    // if (collateral.lt(marketMarginRequirement)) {
    //   return res.status(400).json({
    //     error: "Insufficient collateral",
    //     required: marketMarginRequirement.toString(),
    //     available: collateral.toString(),
    //   });
    // }

    //  Place the perp order
    const txSig = await driftClient.placePerpOrder({
      orderType: orderType === "market" ? OrderType.MARKET : OrderType.LIMIT,
      marketIndex,
      baseAssetAmount: baseAssetAmountBN,
      direction: positionDirection,
      price: priceBN,
    });

    console.log(`Order placed. Transaction signature: ${txSig}`);
    res.json({ success: true, txSig });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to place order" });
  }
});

function floatToBN(value: number, precisionBN: BN): BN {
  if (value == null) {
    throw new Error("value is null/undefined in floatToBN");
  }

  // convert value to string without exponential notation
  const s = value.toString();
  const [intPart, decPart = ""] = s.split(".");
  const scaledStr = intPart + decPart;
  const scaledBigInt = BigInt(scaledStr);
  const precisionBigInt = BigInt(precisionBN.toString());
  const divisor = BigInt(10 ** decPart.length);

  const resultBigInt = (scaledBigInt * precisionBigInt) / divisor;
  return new BN(resultBigInt.toString());
}

// router.post("/create", async (req, res) => {
//   const { marketIndex, direction, price, baseAssetAmount, orderType } =
//     req.body as OrderRequestBody;

//   // --- 1) Basic validation ---
//   if (
//     marketIndex == null ||
//     direction == null ||
//     baseAssetAmount == null ||
//     orderType == null
//   ) {
//     return res.status(400).json({
//       error:
//         "Missing required fields: marketIndex, direction, baseAssetAmount, orderType",
//     });
//   }
//   if (typeof marketIndex !== "number" || typeof baseAssetAmount !== "number") {
//     return res
//       .status(400)
//       .json({ error: "marketIndex and baseAssetAmount must be numbers" });
//   }
//   if (!["long", "short"].includes(direction.toLowerCase())) {
//     return res
//       .status(400)
//       .json({ error: 'direction must be "long" or "short"' });
//   }
//   if (!["market", "limit"].includes(orderType.toLowerCase())) {
//     return res
//       .status(400)
//       .json({ error: 'orderType must be "market" or "limit"' });
//   }
//   if (
//     orderType.toLowerCase() === "limit" &&
//     (price == null || typeof price !== "number")
//   ) {
//     return res
//       .status(400)
//       .json({ error: "limit orders require numeric price" });
//   }
//   if (!(baseAssetAmount > 0)) {
//     return res.status(400).json({ error: "baseAssetAmount must be > 0" });
//   }

//   try {
//     // --- 2) Market lookup ---
//     const market = driftClient.getPerpMarketAccount(marketIndex);
//     if (!market) {
//       return res.status(400).json({ error: "Invalid market index" });
//     }

//     // --- 3) Map enums ---
//     const positionDirection =
//       direction.toLowerCase() === "long"
//         ? PositionDirection.LONG
//         : PositionDirection.SHORT;
//     const sdkOrderType =
//       orderType.toLowerCase() === "market" ? OrderType.MARKET : OrderType.LIMIT;

//     // --- 4) Convert amounts safely using SDK constants if available ---
//     // Prefer SDK helpers for conversions if the SDK has them (recommended).
//     // Fallback uses BASE_PRECISION / PRICE_PRECISION from SDK (must be BN).
//     let baseAssetAmountBN: BN;
//     try {
//       // If SDK exposes BASE_PRECISION constant (BN), use it
//       if (typeof BASE_PRECISION !== "undefined") {
//         const precisionBN = new BN(BASE_PRECISION.toString());
//         baseAssetAmountBN = floatToBN(baseAssetAmount, precisionBN);
//       } else {
//         // Fallback: try using a market step size (danger: depends on SDK)
//         const step = market.amm?.baseAssetAmountStepSize;
//         if (!step)
//           throw new Error(
//             "No BASE_PRECISION and no market baseAssetAmountStepSize available"
//           );
//         const stepBN = new BN(step.toString());
//         baseAssetAmountBN = floatToBN(baseAssetAmount, stepBN); // note: semantically different — prefer SDK helper
//       }
//     } catch (convErr) {
//       console.error("Error converting baseAssetAmount to BN:", convErr);
//       return res
//         .status(500)
//         .json({ error: "Failed to convert baseAssetAmount to internal units" });
//     }

//     // Price conversion only for limit orders
//     let priceBN: BN | undefined;
//     if (sdkOrderType === OrderType.LIMIT) {
//       if (typeof PRICE_PRECISION === "undefined") {
//         console.warn(
//           "PRICE_PRECISION not found — make sure to use SDK constants"
//         );
//       }
//       const precisionBN = new BN((PRICE_PRECISION ?? new BN(1)).toString());
//       priceBN = floatToBN(price!, precisionBN);
//     }

//     // --- 5) (Optional) pre-checks: user account, collateral, margin etc. ---
//     // e.g. if (!await driftClient.hasUserAccount()) await driftClient.initializeUserAccount();
//     // e.g. check margin / min order size via market.minOrderSize etc.

//     // --- 6) Place order (SDK method names vary by version) ---
//     // NOTE: check your SDK for exact parameter names. Many SDKs accept:
//     // { marketIndex, baseAssetAmount, direction, orderType, limitPrice? }
//     const placeParams: any = {
//       marketIndex,
//       baseAssetAmount, // some SDKs expect BN here; others want lots BN
//       direction: positionDirection,
//       orderType: sdkOrderType,
//     };

//     // Replace the human value with the BN converted amount expected by your SDK:
//     // the exact key may differ: `baseAssetAmount` or `baseAssetAmountLots` etc.
//     placeParams.baseAssetAmount = baseAssetAmountBN;
//     if (priceBN) placeParams.limitPrice = priceBN; // or `price` depending on SDK

//     // Example call — adapt to your version:
//     const txSig = await driftClient.placePerpOrder(placeParams);

//     console.log(`Order placed. Transaction signature: ${txSig}`);
//     return res.json({ success: true, txSig });
//   } catch (error: any) {
//     console.error("Place order error:", error);
//     const message = error?.message ?? "Unknown error";
//     return res.status(500).json({ error: "Failed to place order", message });
//   }
// });

export default router;
