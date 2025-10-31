/**
 * Telegram Bot Types
 * Type definitions for Telegram bot interactions, callback data, and UI components
 */

import { InlineKeyboardButton } from 'node-telegram-bot-api';

/**
 * Callback data prefixes for routing
 */
export enum CallbackPrefix {
  DRIFT = 'drift',
  FLASH = 'flash',
  COMMON = 'common',
}

/**
 * Drift callback actions
 */
export enum DriftAction {
  DEPOSIT = 'deposit',
  MARKETS = 'markets',
  OPEN = 'open',
  CLOSE = 'close',
  ORDERBOOK = 'orderbook',
  POSITIONS = 'positions',
  BALANCE = 'balance',
  SETTINGS = 'settings',
  REFRESH = 'refresh',
  WALLET = 'wallet',
}

/**
 * Flash callback actions (mirror Drift for consistency)
 */
export enum FlashAction {
  DEPOSIT = 'deposit',
  MARKETS = 'markets',
  OPEN = 'open',
  CLOSE = 'close',
  ORDERBOOK = 'orderbook',
  POSITIONS = 'positions',
  BALANCE = 'balance',
  SETTINGS = 'settings',
  REFRESH = 'refresh',
}

/**
 * Sub-actions for multi-step flows
 */
export enum SubAction {
  SELECT_TOKEN = 'select_token',
  SELECT_MARKET = 'select_market',
  SELECT_POSITION = 'select_position',
  ENTER_AMOUNT = 'enter_amount',
  ENTER_PRICE = 'enter_price',
  DIRECTION = 'direction',
  ORDER_TYPE = 'order_type',
  CONFIRM = 'confirm',
  CANCEL = 'cancel',
  CATEGORY = 'category',
  DETAILS = 'details',
  PERCENTAGE = 'percentage',
}

/**
 * Order direction
 */
export enum OrderDirection {
  LONG = 'long',
  SHORT = 'short',
}

/**
 * Order type
 */
export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

/**
 * Market category for filtering
 */
export enum MarketCategory {
  ALL = 'all',
  MAJORS = 'majors',
  ALTS = 'alts',
  MEMES = 'memes',
}

/**
 * Callback data builder utility
 */
export class CallbackDataBuilder {
  private parts: string[] = [];

  constructor(prefix: CallbackPrefix, action: string) {
    this.parts.push(prefix, action);
  }

  add(value: string | number | boolean): this {
    this.parts.push(String(value));
    return this;
  }

  build(): string {
    return this.parts.join(':');
  }

  static parse(callbackData: string): CallbackParsedData {
    const parts = callbackData.split(':');
    return {
      prefix: parts[0] as CallbackPrefix,
      action: parts[1],
      params: parts.slice(2),
    };
  }
}

/**
 * Parsed callback data structure
 */
export interface CallbackParsedData {
  prefix: CallbackPrefix;
  action: string;
  params: string[];
}

/**
 * Inline keyboard row (array of buttons)
 */
export type KeyboardRow = InlineKeyboardButton[];

/**
 * Full inline keyboard (array of rows)
 */
export type InlineKeyboard = KeyboardRow[];

/**
 * Keyboard button builder utility
 */
export class KeyboardButtonBuilder {
  static button(text: string, callbackData: string): InlineKeyboardButton {
    return { text, callback_data: callbackData };
  }

  static urlButton(text: string, url: string): InlineKeyboardButton {
    return { text, url };
  }

  static row(...buttons: InlineKeyboardButton[]): KeyboardRow {
    return buttons;
  }

  static keyboard(...rows: KeyboardRow[]): InlineKeyboard {
    return rows;
  }
}

/**
 * User session flow types
 */
export enum SessionFlow {
  DEPOSIT = 'deposit',
  OPEN_POSITION = 'open_position',
  CLOSE_POSITION = 'close_position',
  WITHDRAW = 'withdraw',
}

/**
 * Session data structure for multi-step flows
 */
export interface SessionData {
  // Common fields
  dex?: 'drift' | 'flash';
  marketIndex?: number;
  marketSymbol?: string;

  // Deposit flow
  depositToken?: number; // spot market index
  depositAmount?: string;

  // Position flow
  direction?: OrderDirection;
  amount?: string;
  orderType?: OrderType;
  limitPrice?: string;

  // Open position flow
  openMarketIndex?: number;
  openDirection?: string;
  openSize?: string;
  openOrderType?: string;

  // Close position flow
  closeMarketIndex?: number;
  closePercentage?: number;

  // Timestamps
  lastActivity?: Date;
  expiresAt?: Date;
}

/**
 * Message edit options for updating inline keyboards
 */
export interface MessageEditOptions {
  chatId: number;
  messageId: number;
  text: string;
  keyboard?: InlineKeyboard;
  parseMode?: 'Markdown' | 'HTML';
}
