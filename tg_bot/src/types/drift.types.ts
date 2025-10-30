/**
 * Drift Protocol Types
 * Type definitions specific to Drift Protocol integration
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Drift market information for display
 */
export interface DriftMarketInfo {
  marketIndex: number;
  symbol: string;
  baseAssetSymbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  nextFundingTime: Date;
  category: 'major' | 'alt' | 'meme';
  isActive: boolean;
}

/**
 * Drift position information for display
 */
export interface DriftPositionInfo {
  marketIndex: number;
  symbol: string;
  direction: 'long' | 'short';
  size: number; // Base asset amount
  notionalValue: number; // USD value
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  marginUsed: number;
}

/**
 * Drift balance information
 */
export interface DriftBalanceInfo {
  totalCollateral: number; // USD
  freeCollateral: number; // USD
  usedCollateral: number; // USD
  accountValue: number; // USD
  leverage: number;
  health: number; // 0-100
  maintenanceMargin: number;
  canBeLiquidated: boolean;
  tokens: DriftTokenBalance[];
}

/**
 * Individual token balance
 */
export interface DriftTokenBalance {
  marketIndex: number;
  symbol: string;
  amount: number;
  valueUsd: number;
  isDeposit: boolean; // true = deposit, false = borrow
}

/**
 * Orderbook level
 */
export interface OrderbookLevel {
  price: number;
  size: number;
  total: number; // Cumulative size
}

/**
 * Orderbook data for display
 */
export interface DriftOrderbookInfo {
  marketIndex: number;
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread: number;
  spreadPercent: number;
  lastUpdate: Date;
}

/**
 * Deposit request
 */
export interface DepositRequest {
  userId: string;
  chatId: number;
  amount: number;
  marketIndex: number;
  tokenSymbol: string;
  userPublicKey: PublicKey;
}

/**
 * Position open request
 */
export interface OpenPositionRequest {
  userId: string;
  chatId: number;
  marketIndex: number;
  direction: 'long' | 'short';
  amount: number; // Base asset amount
  orderType: 'market' | 'limit';
  limitPrice?: number;
  userPublicKey: PublicKey;
}

/**
 * Position close request
 */
export interface ClosePositionRequest {
  userId: string;
  chatId: number;
  marketIndex: number;
  percentage: number; // 0-100
  userPublicKey: PublicKey;
}

/**
 * Transaction build result
 */
export interface TransactionBuildResult {
  transaction: string; // Base58 encoded transaction
  estimatedGas: number;
  blockhash: string;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  signature: string;
  success: boolean;
  error?: string;
}

/**
 * Market filter options
 */
export interface MarketFilterOptions {
  category?: 'major' | 'alt' | 'meme' | 'all';
  search?: string;
  minVolume?: number;
  sort?: 'volume' | 'price' | 'name';
  limit?: number;
}

/**
 * Constants for Drift math conversions
 */
export const DRIFT_PRECISION = {
  BASE: new BN(1e9), // BASE_PRECISION
  QUOTE: new BN(1e6), // QUOTE_PRECISION (USDC)
  PRICE: new BN(1e6), // PRICE_PRECISION
  FUNDING_RATE: new BN(1e9), // Funding rate precision
  PERCENTAGE: 100, // For percentage calculations
};

/**
 * Drift market categories for filtering
 */
export const DRIFT_MARKET_CATEGORIES = {
  MAJORS: ['SOL-PERP', 'BTC-PERP', 'ETH-PERP'],
  ALTS: ['AVAX-PERP', 'ARB-PERP', 'MATIC-PERP', 'OP-PERP', 'SUI-PERP'],
  MEMES: ['BONK-PERP', 'WIF-PERP', 'PEPE-PERP', 'DOGE-PERP', 'SHIB-PERP'],
};

/**
 * Helper to categorize markets
 */
export function categorizeMarket(symbol: string): 'major' | 'alt' | 'meme' {
  if (DRIFT_MARKET_CATEGORIES.MAJORS.includes(symbol)) return 'major';
  if (DRIFT_MARKET_CATEGORIES.MEMES.includes(symbol)) return 'meme';
  return 'alt';
}

/**
 * Helper to format market symbol (remove -PERP suffix)
 */
export function formatMarketSymbol(symbol: string): string {
  return symbol.replace('-PERP', '');
}

/**
 * Helper to get market emoji by category
 */
export function getMarketEmoji(category: 'major' | 'alt' | 'meme'): string {
  const emojis = {
    major: '🔥',
    alt: '⭐',
    meme: '🐶',
  };
  return emojis[category];
}

/**
 * Helper to format price with appropriate decimals
 */
export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toExponential(2);
}

/**
 * Helper to format percentage
 */
export function formatPercentage(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Helper to format USD amount
 */
export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Helper to get color emoji for PnL
 */
export function getPnLEmoji(pnl: number): string {
  return pnl >= 0 ? '🟢' : '🔴';
}

/**
 * Helper to get direction emoji
 */
export function getDirectionEmoji(direction: 'long' | 'short'): string {
  return direction === 'long' ? '🔼' : '🔽';
}

/**
 * Collateral information for user account
 */
export interface CollateralInfo {
  total: number;
  free: number;
  used: number;
  availableWithdraw: number;
}

/**
 * Spot market information
 */
export interface SpotMarketInfo {
  symbol: string;
  marketIndex: number;
  mint: PublicKey;
  decimals: number;
}

/**
 * Spot position information (token balances)
 */
export interface SpotPositionInfo {
  symbol: string;
  marketIndex: number;
  balance: number;
  value: number; // USD value
}
