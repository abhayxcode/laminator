import { databaseService } from './databaseService';

// Access prisma through the public getter
const getPrisma = () => databaseService.getPrisma();

/**
 * Drift-specific database operations
 */
class DriftDatabaseService {
  // ============================================
  // MARKETS
  // ============================================

  async createOrUpdateMarket(data: {
    marketIndex: number;
    symbol: string;
    baseAsset: string;
    quoteAsset?: string;
    marketType?: string;
    category?: string;
    minOrderSize?: string;
    maxOrderSize?: string;
    tickSize?: string;
    stepSize?: string;
    maxLeverage?: string;
    oracleSource?: string;
    status?: string;
    metadata?: any;
  }) {
    const prisma = getPrisma();
    return await prisma.driftMarket.upsert({
      where: { marketIndex: data.marketIndex },
      update: {
        symbol: data.symbol,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset || 'USD',
        marketType: data.marketType || 'PERPETUAL',
        category: data.category,
        minOrderSize: data.minOrderSize,
        maxOrderSize: data.maxOrderSize,
        tickSize: data.tickSize,
        stepSize: data.stepSize,
        maxLeverage: data.maxLeverage,
        oracleSource: data.oracleSource,
        status: data.status || 'ACTIVE',
        metadata: data.metadata || {},
        updatedAt: new Date()
      },
      create: {
        marketIndex: data.marketIndex,
        symbol: data.symbol,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset || 'USD',
        marketType: data.marketType || 'PERPETUAL',
        category: data.category,
        minOrderSize: data.minOrderSize,
        maxOrderSize: data.maxOrderSize,
        tickSize: data.tickSize,
        stepSize: data.stepSize,
        maxLeverage: data.maxLeverage,
        oracleSource: data.oracleSource,
        status: data.status || 'ACTIVE',
        metadata: data.metadata || {}
      }
    });
  }

  async getMarketByIndex(marketIndex: number) {
    const prisma = getPrisma();
    return await prisma.driftMarket.findUnique({
      where: { marketIndex }
    });
  }

  async getAllActiveMarkets() {
    const prisma = getPrisma();
    return await prisma.driftMarket.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { symbol: 'asc' }
    });
  }

  // ============================================
  // ORDERS
  // ============================================

  async createOrder(data: {
    userId: string;
    walletId: string;
    marketId: string;
    marketIndex: number;
    orderType: string;
    side: string;
    direction: string;
    baseAssetAmount: string;
    price?: string;
    triggerPrice?: string;
    leverage?: string;
    reduceOnly?: boolean;
    postOnly?: boolean;
    driftOrderId?: string;
    driftUserAccount?: string;
    metadata?: any;
  }) {
    const prisma = getPrisma();
    return await prisma.driftOrder.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        marketId: data.marketId,
        marketIndex: data.marketIndex,
        orderType: data.orderType,
        side: data.side,
        direction: data.direction,
        baseAssetAmount: data.baseAssetAmount,
        price: data.price,
        triggerPrice: data.triggerPrice,
        leverage: data.leverage || '1.0',
        reduceOnly: data.reduceOnly || false,
        postOnly: data.postOnly || false,
        driftOrderId: data.driftOrderId,
        driftUserAccount: data.driftUserAccount,
        status: 'PENDING',
        metadata: data.metadata || {}
      }
    });
  }

  async updateOrderStatus(
    orderId: string,
    data: {
      status: string;
      filledAmount?: string;
      avgFillPrice?: string;
      totalFees?: string;
      filledAt?: Date;
    }
  ) {
    const prisma = getPrisma();
    return await prisma.driftOrder.update({
      where: { id: orderId },
      data
    });
  }

  async getUserOrders(userId: string, status?: string) {
    const prisma = getPrisma();
    return await prisma.driftOrder.findMany({
      where: {
        userId,
        ...(status && { status })
      },
      include: {
        market: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  }

  // ============================================
  // POSITIONS
  // ============================================

  async createPosition(data: {
    userId: string;
    walletId: string;
    marketId: string;
    marketIndex: number;
    side: string;
    baseAssetAmount: string;
    quoteAssetAmount: string;
    entryPrice: string;
    leverage?: string;
    marginAmount: string;
    driftUserAccount?: string;
    metadata?: any;
  }) {
    const prisma = getPrisma();
    
    // Check if an OPEN position already exists for this user/market
    const existingPosition = await prisma.driftPosition.findFirst({
      where: {
        userId: data.userId,
        marketIndex: data.marketIndex,
        status: 'OPEN'
      }
    });

    if (!existingPosition) {
      // No existing position, create new one
      return await prisma.driftPosition.create({
        data: {
          userId: data.userId,
          walletId: data.walletId,
          marketId: data.marketId,
          marketIndex: data.marketIndex,
          side: data.side,
          baseAssetAmount: data.baseAssetAmount,
          quoteAssetAmount: data.quoteAssetAmount,
          entryPrice: data.entryPrice,
          leverage: data.leverage || '1.0',
          marginAmount: data.marginAmount,
          driftUserAccount: data.driftUserAccount,
          status: 'OPEN',
          unrealizedPnl: '0',
          realizedPnl: '0',
          metadata: data.metadata || {}
        }
      });
    }

    // Position exists - need to merge/net them
    const existingAmount = parseFloat(existingPosition.baseAssetAmount.toString());
    const newAmount = parseFloat(data.baseAssetAmount);
    const existingSide = existingPosition.side.toUpperCase();
    const newSide = data.side.toUpperCase();

    let finalAmount: number;
    let finalSide: string;
    let finalEntryPrice: string;
    let finalMarginAmount: string;

    if (existingSide === newSide) {
      // Same side - add to position
      finalAmount = existingAmount + newAmount;
      finalSide = existingSide;
      // Weighted average entry price
      const existingValue = parseFloat(existingPosition.entryPrice.toString()) * existingAmount;
      const newValue = parseFloat(data.entryPrice) * newAmount;
      finalEntryPrice = ((existingValue + newValue) / finalAmount).toString();
      finalMarginAmount = (parseFloat(existingPosition.marginAmount.toString()) + parseFloat(data.marginAmount)).toString();
    } else {
      // Opposite side - net them
      finalAmount = Math.abs(existingAmount - newAmount);
      
      if (finalAmount === 0) {
        // Positions cancel out - close the position
        return await prisma.driftPosition.update({
          where: { id: existingPosition.id },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            baseAssetAmount: '0',
            quoteAssetAmount: '0'
          }
        });
      }

      // Net position determines the side
      finalSide = existingAmount > newAmount ? existingSide : newSide;
      // Use the larger side's entry price
      finalEntryPrice = existingAmount > newAmount 
        ? existingPosition.entryPrice.toString() 
        : data.entryPrice;
      // Use the larger side's margin
      finalMarginAmount = existingAmount > newAmount
        ? existingPosition.marginAmount.toString()
        : data.marginAmount;
    }

    // Update the existing position
    return await prisma.driftPosition.update({
      where: { id: existingPosition.id },
      data: {
        side: finalSide,
        baseAssetAmount: finalAmount.toString(),
        quoteAssetAmount: (finalAmount * parseFloat(finalEntryPrice)).toString(),
        entryPrice: finalEntryPrice,
        marginAmount: finalMarginAmount,
        updatedAt: new Date()
      }
    });
  }

  async updatePosition(
    positionId: string,
    data: {
      lastPrice?: string;
      markPrice?: string;
      unrealizedPnl?: string;
      realizedPnl?: string;
      liquidationPrice?: string;
      status?: string;
      closedAt?: Date;
      baseAssetAmount?: string;
    }
  ) {
    const prisma = getPrisma();
    return await prisma.driftPosition.update({
      where: { id: positionId },
      data
    });
  }

  async getUserPositions(userId: string, status: string = 'OPEN') {
    const prisma = getPrisma();
    return await prisma.driftPosition.findMany({
      where: {
        userId,
        status
      },
      include: {
        market: true
      },
      orderBy: { openedAt: 'desc' }
    });
  }

  async getPositionByMarket(userId: string, marketIndex: number) {
    const prisma = getPrisma();
    return await prisma.driftPosition.findFirst({
      where: {
        userId,
        marketIndex,
        status: 'OPEN'
      },
      include: {
        market: true
      }
    });
  }

  // ============================================
  // TRANSACTIONS
  // ============================================

  async createTransaction(data: {
    userId: string;
    walletId: string;
    txType: string;
    status?: string;
    orderId?: string;
    positionId?: string;
    marketIndex?: number;
    amount?: string;
    tokenSymbol?: string;
    metadata?: any;
  }) {
    const prisma = getPrisma();
    return await prisma.driftTransaction.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        txType: data.txType,
        status: data.status || 'PENDING',
        orderId: data.orderId,
        positionId: data.positionId,
        marketIndex: data.marketIndex,
        amount: data.amount,
        tokenSymbol: data.tokenSymbol,
        retryCount: 0,
        metadata: data.metadata || {}
      }
    });
  }

  async updateTransaction(
    txId: string,
    data: {
      txHash?: string;
      status?: string;
      blockNumber?: bigint;
      blockTimestamp?: Date;
      gasFee?: string;
      retryCount?: number;
      errorMessage?: string;
      errorType?: string;
      confirmedAt?: Date;
    }
  ) {
    const prisma = getPrisma();
    return await prisma.driftTransaction.update({
      where: { id: txId },
      data
    });
  }

  async getUserTransactions(userId: string, limit: number = 50) {
    const prisma = getPrisma();
    return await prisma.driftTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getTransactionByHash(txHash: string) {
    const prisma = getPrisma();
    return await prisma.driftTransaction.findUnique({
      where: { txHash }
    });
  }
}

export const driftDatabaseService = new DriftDatabaseService();

