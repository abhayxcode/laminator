/**
 * Drift Open Position Handler
 * Handles opening new positions
 */

import TelegramBot from 'node-telegram-bot-api';
import { SubAction, SessionFlow, OrderDirection, OrderType } from '../../types/telegram.types';
import { safeEditMessage } from '../callbackQueryRouter';
import { buildDriftMainKeyboard, buildMarketCategoryKeyboard, buildOrderTypeKeyboard } from '../../keyboards/driftKeyboards';
import { sessionManager } from '../../state/userSessionManager';
import { driftService } from '../../services/driftService';
import { createDriftTransactionService } from '../../services/driftTransactionService';
import { privySigningService } from '../../services/privySigningService';
import { databaseService } from '../../services/databaseService';
import { PublicKey } from '@solana/web3.js';
import { PerpMarkets, BASE_PRECISION, BN } from '@drift-labs/sdk';

/**
 * Handle open position action
 */
export async function handleOpenPosition(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  params: string[]
): Promise<void> {
  const subAction = params[0] as SubAction | undefined;

  if (!subAction) {
    // Start open position flow - show market selection
    await startOpenPositionFlow(bot, chatId, messageId, userId);
    return;
  }

  switch (subAction) {
    case SubAction.SELECT_MARKET:
      await handleMarketSelection(bot, chatId, messageId, userId, parseInt(params[1]), params[2] as OrderDirection);
      break;

    case SubAction.ORDER_TYPE:
      await handleOrderTypeSelection(bot, chatId, messageId, userId, parseInt(params[1]), params[2] as OrderDirection, params[3], params[4] as OrderType);
      break;

    case SubAction.CONFIRM:
      await executeOpenPosition(bot, chatId, userId, params[1]);
      break;

    case SubAction.CANCEL:
      sessionManager.clearFlow(userId);
      await safeEditMessage(bot, chatId, messageId, '❌ Position opening cancelled.', {
        reply_markup: {
          inline_keyboard: buildDriftMainKeyboard(),
        },
      });
      break;

    default:
      console.warn(`[OpenPositionHandler] Unknown sub-action: ${subAction}`);
      await startOpenPositionFlow(bot, chatId, messageId, userId);
  }
}

/**
 * Start open position flow
 */
async function startOpenPositionFlow(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string
): Promise<void> {
  sessionManager.startFlow(userId, chatId, SessionFlow.OPEN_POSITION);

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*🔼 Open Position*\n\n` +
    `Browse markets and select a direction to open a position.\n\n` +
    `Use **/dexdrift** → **Markets** to find markets.`,
    {
      reply_markup: {
        inline_keyboard: buildMarketCategoryKeyboard(),
      },
    }
  );
}

/**
 * Handle market and direction selection - request size input
 */
async function handleMarketSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  marketIndex: number,
  direction: OrderDirection
): Promise<void> {
  // Get market info
  const perpMarkets = PerpMarkets['mainnet-beta'];
  const market = perpMarkets.find(m => m.marketIndex === marketIndex);
  if (!market) {
    await safeEditMessage(bot, chatId, messageId, '❌ Market not found.', {
      reply_markup: { inline_keyboard: buildDriftMainKeyboard() },
    });
    return;
  }

  const dirEmoji = direction === OrderDirection.LONG ? '🔼' : '🔽';

  sessionManager.updateData(userId, {
    openMarketIndex: marketIndex,
    openDirection: direction,
  });

  await safeEditMessage(
    bot,
    chatId,
    messageId,
    `*${dirEmoji} ${direction.toUpperCase()} ${market.baseAssetSymbol}*\n\n` +
    `Please reply with the position size (in ${market.baseAssetSymbol}).\n\n` +
    `Example: \`1.5\` for 1.5 ${market.baseAssetSymbol}\n\n` +
    `Your message will be captured automatically.`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ Cancel', callback_data: 'drift:open:cancel' }
        ]],
      },
    }
  );

  // Set up message listener for size input
  const messageHandler = async (msg: TelegramBot.Message) => {
    if (msg.chat.id !== chatId) return;
    if (!sessionManager.isInFlow(userId, SessionFlow.OPEN_POSITION)) return;

    const size = parseFloat(msg.text || '0');
    if (isNaN(size) || size <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid size. Please enter a number greater than 0.');
      return;
    }

    // Remove listener
    bot.removeListener('message', messageHandler);

    // Save size to session
    sessionManager.updateData(userId, { openSize: size.toString() });

    // Show order type selection
    await showOrderTypeSelection(bot, chatId, userId, marketIndex, direction, size.toString());
  };

  bot.on('message', messageHandler);
}

/**
 * Show order type selection
 */
async function showOrderTypeSelection(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  marketIndex: number,
  direction: OrderDirection,
  amount: string
): Promise<void> {
  const perpMarkets = PerpMarkets['mainnet-beta'];
  const market = perpMarkets.find(m => m.marketIndex === marketIndex);
  if (!market) {
    await bot.sendMessage(chatId, '❌ Market not found.');
    return;
  }

  const dirEmoji = direction === OrderDirection.LONG ? '🔼' : '🔽';

  const message =
    `*${dirEmoji} ${direction.toUpperCase()} ${market.baseAssetSymbol}*\n\n` +
    `Size: **${amount} ${market.baseAssetSymbol}**\n\n` +
    `Select order type:`;

  const keyboard = buildOrderTypeKeyboard(marketIndex, direction, amount);

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Handle order type selection - show confirmation
 */
async function handleOrderTypeSelection(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  userId: string,
  marketIndex: number,
  direction: OrderDirection,
  amount: string,
  orderType: OrderType
): Promise<void> {
  // Get market info
  const perpMarkets = PerpMarkets['mainnet-beta'];
  const market = perpMarkets.find(m => m.marketIndex === marketIndex);
  if (!market) {
    await safeEditMessage(bot, chatId, messageId, '❌ Market not found.', {
      reply_markup: { inline_keyboard: buildDriftMainKeyboard() },
    });
    return;
  }

  // Get current price (simplified - would need oracle data for real price)
  const markets = await driftService.getAvailableMarkets();
  const marketInfo = markets.find((m: any) => m.marketIndex === marketIndex);
  const currentPrice = marketInfo?.price || 0;

  const dirEmoji = direction === OrderDirection.LONG ? '🔼' : '🔽';
  const size = parseFloat(amount);
  const notionalValue = size * currentPrice;

  // Estimate margin required (simplified - 10x leverage)
  const estimatedMargin = notionalValue / 10;

  sessionManager.updateData(userId, {
    openOrderType: orderType,
  });

  const confirmData = `${marketIndex}:${direction}:${amount}:${orderType}`;

  const message =
    `*${dirEmoji} Confirm ${direction.toUpperCase()} ${market.baseAssetSymbol}*\n\n` +
    `Size: **${amount} ${market.baseAssetSymbol}**\n` +
    `Order Type: **${orderType === OrderType.MARKET ? 'Market' : 'Limit'}**\n` +
    `Current Price: **$${currentPrice.toFixed(2)}**\n` +
    `Notional Value: **$${notionalValue.toFixed(2)}**\n` +
    `Est. Margin: **$${estimatedMargin.toFixed(2)}**\n\n` +
    `⚠️ **Important:**\n` +
    `• Transaction will be signed with your Privy wallet\n` +
    `• Position will be opened immediately\n` +
    `• You can close anytime\n\n` +
    `Tap **Confirm** to proceed.`;

  const keyboard = [
    [
      { text: '✅ Confirm', callback_data: `drift:open:confirm:${confirmData}` },
      { text: '❌ Cancel', callback_data: 'drift:open:cancel' },
    ],
  ];

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Execute open position transaction
 */
async function executeOpenPosition(
  bot: TelegramBot,
  chatId: number,
  userId: string,
  confirmData: string
): Promise<void> {
  try {
    await bot.sendMessage(chatId, '⏳ Building transaction...');

    // Parse confirm data
    const [marketIndexStr, direction, amountStr, orderType] = confirmData.split(':');
    const marketIndex = parseInt(marketIndexStr);
    const amount = parseFloat(amountStr);

    // Get user from database
    const dbUser = await databaseService.getUserByTelegramId(chatId);
    if (!dbUser || !dbUser.wallets || dbUser.wallets.length === 0) {
      throw new Error('User wallet not found');
    }

    const wallet = dbUser.wallets.find((w: any) => w.blockchain === 'SOLANA');
    if (!wallet) {
      throw new Error('Solana wallet not found');
    }

    const userPublicKey = new PublicKey(wallet.walletAddress);

    // Get market info
    const perpMarkets = PerpMarkets['mainnet-beta'];
    const market = perpMarkets.find(m => m.marketIndex === marketIndex);
    if (!market) {
      throw new Error('Market not found');
    }

    // Convert amount to BN with proper precision (BASE_PRECISION for perp base amounts)
    const amountBN = new BN(amount * BASE_PRECISION.toNumber());

    // Get Drift client
    const driftClient = await (driftService as any).getDriftClientForMarketData();
    if (!driftClient) {
      throw new Error('Drift client not available');
    }

    const txService = createDriftTransactionService(driftClient);

    await bot.sendMessage(chatId, '🔧 Building order...');

    // Build open position transaction
    const tx = await txService.buildOpenPositionTransaction(
      userPublicKey,
      marketIndex,
      direction as 'long' | 'short',
      amountBN,
      orderType as 'market' | 'limit'
    );

    await bot.sendMessage(chatId, '🔐 Signing with Privy...');

    // Sign and send with Privy
    const signature = await privySigningService.signAndSendTransaction(
      chatId,
      tx,
      (driftService as any).connection
    );

    // Clear session
    sessionManager.clearFlow(userId);

    // Send success message
    const dirEmoji = direction === OrderDirection.LONG ? '🔼' : '🔽';
    const explorerUrl = `https://solscan.io/tx/${signature}`;
    await bot.sendMessage(
      chatId,
      `✅ **Position Opened!**\n\n` +
      `${dirEmoji} **${direction.toUpperCase()} ${market.baseAssetSymbol}**\n` +
      `Size: **${amount} ${market.baseAssetSymbol}**\n\n` +
      `[View on Explorer](${explorerUrl})`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Open position error:', error);
    sessionManager.clearFlow(userId);
    await bot.sendMessage(
      chatId,
      `❌ **Position Opening Failed**\n\n` +
      `Error: ${(error as Error).message}\n\n` +
      `Please try again or contact support.`
    );
  }
}
