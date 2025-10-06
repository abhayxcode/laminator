import { PrismaClient } from '@prisma/client';

export interface CreateUserData {
  telegramId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  privyUserId?: string;
}

export interface CreateWalletData {
  userId: string;
  privyWalletId?: string;
  walletAddress: string;
  walletType?: 'PRIVY' | 'PHANTOM' | 'SOLFLARE' | 'BACKPACK' | 'EXTERNAL';
  chainType?: 'SOLANA' | 'ETHEREUM' | 'POLYGON';
}

export interface UpdateBalanceData {
  walletId: string;
  tokenSymbol: string;
  balance?: number;
  lockedBalance?: number;
}

export interface CreateOrderData {
  userId: string;
  walletId: string;
  marketId: string;
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  side: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  size: number;
  price?: number;
  leverage?: number;
  expiresAt?: Date;
}

export interface CreatePositionData {
  userId: string;
  walletId: string;
  marketId: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  leverage?: number;
  margin: number;
}

export interface CreateTransactionData {
  userId: string;
  walletId: string;
  txType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'FEE' | 'REWARD' | 'TRANSFER';
  amount?: number;
  tokenSymbol?: string;
  fromAddress?: string;
  toAddress?: string;
  gasFee?: number;
  txHash?: string;
  metadata?: any;
}

export class DatabaseService {
  private prisma: PrismaClient;
  private initialized: boolean = false;

  constructor() {
    this.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.initialized = true;
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    this.initialized = false;
  }

  // ==============================================
  // USER OPERATIONS
  // ==============================================

  async createUser(data: CreateUserData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { telegramId: data.telegramId },
    });

    if (existingUser) {
      throw new Error('User already exists');
    }
    
    return await this.prisma.user.create({
      data: {
        telegramId: data.telegramId,
        telegramUsername: data.telegramUsername,
        telegramFirstName: data.telegramFirstName,
        telegramLastName: data.telegramLastName,
        privyUserId: data.privyUserId,
      },
    });
  }

  async getUserByTelegramId(telegramId: number): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.user.findUnique({
      where: { telegramId: telegramId },
      include: {
        wallets: true,
        userSettings: true,
      },
    });
  }

  async getOrCreateUser(telegramId: number, userData?: {
    telegramUsername?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
  }): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    // Try to find existing user
    let user = await this.prisma.user.findUnique({
      where: { telegramId: telegramId },
      include: {
        wallets: true,
        userSettings: true,
      },
    });

    if (!user) {
      // Create new user if doesn't exist
      user = await this.prisma.user.create({
        data: {
          telegramId: telegramId,
          telegramUsername: userData?.telegramUsername,
          telegramFirstName: userData?.telegramFirstName,
          telegramLastName: userData?.telegramLastName,
        },
        include: {
          wallets: true,
          userSettings: true,
        },
      });
    }

    return user;
  }

  async getUserById(userId: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: true,
        positions: {
          where: { status: 'OPEN' },
          include: { market: true },
        },
        userSettings: true,
      },
    });
  }

  async updateUserLastActive(telegramId: number): Promise<void> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    await this.prisma.user.update({
      where: { telegramId: telegramId },
      data: { lastActive: new Date() },
    });
  }

  // ==============================================
  // WALLET OPERATIONS
  // ==============================================

  async createWallet(data: CreateWalletData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    // Check if user already has a wallet
    const existingWallet = await this.prisma.wallet.findFirst({
      where: { userId: data.userId },
    });

    if (existingWallet) {
      throw new Error('User already has a wallet');
    }

    // Check if wallet address already exists
    const existingAddress = await this.prisma.wallet.findUnique({
      where: { walletAddress: data.walletAddress },
    });

    if (existingAddress) {
      throw new Error('Wallet address already exists');
    }
    
    return await this.prisma.wallet.create({
      data: {
        userId: data.userId,
        privyWalletId: data.privyWalletId,
        walletAddress: data.walletAddress,
        walletType: data.walletType || 'PRIVY',
        chainType: data.chainType || 'SOLANA',
      },
    });
  }

  async getWalletByAddress(walletAddress: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.wallet.findUnique({
      where: { walletAddress },
      include: {
        user: true,
        walletBalances: true,
      },
    });
  }

  async getUserWallets(userId: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.wallet.findMany({
      where: { userId },
      include: {
        walletBalances: true,
      },
    });
  }

  // ==============================================
  // BALANCE OPERATIONS
  // ==============================================

  async updateBalance(data: UpdateBalanceData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.walletBalance.upsert({
      where: {
        walletId_tokenSymbol: {
          walletId: data.walletId,
          tokenSymbol: data.tokenSymbol,
        },
      },
      update: {
        balance: data.balance,
        lockedBalance: data.lockedBalance,
      },
      create: {
        walletId: data.walletId,
        tokenSymbol: data.tokenSymbol,
        balance: data.balance || 0,
        lockedBalance: data.lockedBalance || 0,
        availableBalance: (data.balance || 0) - (data.lockedBalance || 0),
      },
    });
  }

  async getWalletBalance(walletId: string, tokenSymbol: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.walletBalance.findUnique({
      where: {
        walletId_tokenSymbol: {
          walletId,
          tokenSymbol,
        },
      },
    });
  }

  async getAllWalletBalances(walletId: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.walletBalance.findMany({
      where: { walletId },
    });
  }

  // ==============================================
  // MARKET OPERATIONS
  // ==============================================

  async createMarket(marketData: any): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.market.create({
      data: marketData,
    });
  }

  async getMarkets(): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.market.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { symbol: 'asc' },
    });
  }

  async getMarketBySymbol(symbol: string, dexName?: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.market.findFirst({
      where: {
        symbol,
        dexName: dexName || 'drift',
        status: 'ACTIVE',
      },
    });
  }

  // ==============================================
  // ORDER OPERATIONS
  // ==============================================

  async createOrder(data: CreateOrderData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.order.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        marketId: data.marketId,
        orderType: data.orderType,
        side: data.side,
        size: data.size,
        price: data.price,
        leverage: data.leverage || 1.0,
        expiresAt: data.expiresAt,
      },
    });
  }

  async getUserOrders(userId: string, status?: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.order.findMany({
      where: {
        userId,
        ...(status && { status: status as any }),
      },
      include: { market: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateOrderStatus(orderId: string, status: string, fillData?: any): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: status as any,
        ...fillData,
      },
    });
  }

  // ==============================================
  // POSITION OPERATIONS
  // ==============================================

  async createPosition(data: CreatePositionData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.position.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        marketId: data.marketId,
        side: data.side,
        size: data.size,
        entryPrice: data.entryPrice,
        leverage: data.leverage || 1.0,
        margin: data.margin,
      },
    });
  }

  async getUserPositions(userId: string, status?: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.position.findMany({
      where: {
        userId,
        ...(status && { status: status as any }),
      },
      include: { market: true },
      orderBy: { openedAt: 'desc' },
    });
  }

  async updatePosition(positionId: string, updateData: any): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.position.update({
      where: { id: positionId },
      data: updateData,
    });
  }

  // ==============================================
  // TRANSACTION OPERATIONS
  // ==============================================

  async createTransaction(data: CreateTransactionData): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.transaction.create({
      data: {
        userId: data.userId,
        walletId: data.walletId,
        txType: data.txType,
        amount: data.amount,
        tokenSymbol: data.tokenSymbol,
        fromAddress: data.fromAddress,
        toAddress: data.toAddress,
        gasFee: data.gasFee,
        txHash: data.txHash,
        metadata: data.metadata || {},
      },
    });
  }

  async getUserTransactions(userId: string, limit: number = 50): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ==============================================
  // ALERT OPERATIONS
  // ==============================================

  async createAlert(alertData: any): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.alert.create({
      data: alertData,
    });
  }

  async getUserAlerts(userId: string): Promise<any[]> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.alert.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { market: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==============================================
  // USER SETTINGS OPERATIONS
  // ==============================================

  async updateUserSetting(userId: string, key: string, value: any): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.userSetting.upsert({
      where: {
        userId_settingKey: {
          userId,
          settingKey: key,
        },
      },
      update: {
        settingValue: value,
      },
      create: {
        userId,
        settingKey: key,
        settingValue: value,
      },
    });
  }

  async getUserSetting(userId: string, key: string): Promise<any | null> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    return await this.prisma.userSetting.findUnique({
      where: {
        userId_settingKey: {
          userId,
          settingKey: key,
        },
      },
    });
  }

  // ==============================================
  // ANALYTICS & REPORTING
  // ==============================================

  async getUserPortfolio(userId: string): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: {
          include: {
            walletBalances: true,
          },
        },
        positions: {
          where: { status: 'OPEN' },
          include: { market: true },
        },
        orders: {
          where: { status: 'FILLED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    return user;
  }

  async getTradingStats(userId: string): Promise<any> {
    if (!this.initialized) throw new Error('Database not initialized');
    
    const [totalOrders, filledOrders, totalVolume, openPositions] = await Promise.all([
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId, status: 'FILLED' } }),
      this.prisma.order.aggregate({
        where: { userId, status: 'FILLED' },
        _sum: { totalFees: true },
      }),
      this.prisma.position.count({ where: { userId, status: 'OPEN' } }),
    ]);

    return {
      totalOrders,
      filledOrders,
      totalVolume: totalVolume._sum.totalFees || 0,
      openPositions,
    };
  }

  // ==============================================
  // HEALTH CHECK
  // ==============================================

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const databaseService = new DatabaseService();
