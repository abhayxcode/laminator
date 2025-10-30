/**
 * Drift Protocol Keyboard Builders
 * Creates inline keyboards for Drift Protocol interactions
 */

import {
  CallbackDataBuilder,
  CallbackPrefix,
  DriftAction,
  SubAction,
  KeyboardButtonBuilder,
  InlineKeyboard,
  OrderDirection,
  OrderType,
  MarketCategory,
} from '../types/telegram.types';
import { DriftMarketInfo, DriftPositionInfo, formatMarketSymbol, getMarketEmoji } from '../types/drift.types';

/**
 * Main Drift menu keyboard (shown after /dexdrift command)
 */
export function buildDriftMainKeyboard(): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;
  const cb = (action: DriftAction) =>
    new CallbackDataBuilder(CallbackPrefix.DRIFT, action).build();

  return keyboard(
    row(
      button('💰 Deposit', cb(DriftAction.DEPOSIT)),
      button('📊 Markets', cb(DriftAction.MARKETS)),
      button('🔼 Open', cb(DriftAction.OPEN))
    ),
    row(
      button('🔽 Close', cb(DriftAction.CLOSE)),
      button('📖 Book', cb(DriftAction.ORDERBOOK)),
      button('📈 Positions', cb(DriftAction.POSITIONS))
    ),
    row(
      button('💵 Balance', cb(DriftAction.BALANCE)),
      button('⚙️ Settings', cb(DriftAction.SETTINGS)),
      button('🔄 Refresh', cb(DriftAction.REFRESH))
    )
  );
}

/**
 * Token selection keyboard for deposits
 */
export function buildDepositTokenKeyboard(): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  const tokens = [
    { symbol: 'USDC', index: 0, emoji: '💵' },
    { symbol: 'SOL', index: 1, emoji: '◎' },
    { symbol: 'USDT', index: 2, emoji: '💰' },
  ];

  const tokenRows = tokens.map((token) =>
    row(
      button(
        `${token.emoji} ${token.symbol}`,
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.DEPOSIT)
          .add(SubAction.SELECT_TOKEN)
          .add(token.index)
          .build()
      )
    )
  );

  return keyboard(
    ...tokenRows,
    row(
      button('❌ Cancel', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.DEPOSIT).add(SubAction.CANCEL).build())
    )
  );
}

/**
 * Market category filter keyboard
 */
export function buildMarketCategoryKeyboard(): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button(
        '🔥 Majors',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(MarketCategory.MAJORS)
          .build()
      ),
      button(
        '⭐ Alts',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(MarketCategory.ALTS)
          .build()
      )
    ),
    row(
      button(
        '🐶 Memes',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(MarketCategory.MEMES)
          .build()
      ),
      button(
        '📋 All',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(MarketCategory.ALL)
          .build()
      )
    ),
    row(
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.REFRESH).build())
    )
  );
}

/**
 * Market list keyboard (paginated)
 */
export function buildMarketListKeyboard(
  markets: DriftMarketInfo[],
  category: MarketCategory,
  page: number = 0,
  pageSize: number = 8
): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  const start = page * pageSize;
  const end = start + pageSize;
  const pageMarkets = markets.slice(start, end);

  // Create market buttons (2 per row)
  const marketRows: InlineKeyboard = [];
  for (let i = 0; i < pageMarkets.length; i += 2) {
    const buttons = [];

    const market1 = pageMarkets[i];
    buttons.push(
      button(
        `${getMarketEmoji(market1.category)} ${formatMarketSymbol(market1.symbol)}`,
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.DETAILS)
          .add(market1.marketIndex)
          .build()
      )
    );

    if (i + 1 < pageMarkets.length) {
      const market2 = pageMarkets[i + 1];
      buttons.push(
        button(
          `${getMarketEmoji(market2.category)} ${formatMarketSymbol(market2.symbol)}`,
          new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
            .add(SubAction.DETAILS)
            .add(market2.marketIndex)
            .build()
        )
      );
    }

    marketRows.push(buttons);
  }

  // Pagination buttons
  const paginationButtons = [];
  if (page > 0) {
    paginationButtons.push(
      button(
        '⬅️ Prev',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(category)
          .add(page - 1)
          .build()
      )
    );
  }
  if (end < markets.length) {
    paginationButtons.push(
      button(
        'Next ➡️',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS)
          .add(SubAction.CATEGORY)
          .add(category)
          .add(page + 1)
          .build()
      )
    );
  }

  return keyboard(
    ...marketRows,
    ...(paginationButtons.length > 0 ? [paginationButtons] : []),
    row(
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS).build())
    )
  );
}

/**
 * Market details action keyboard
 */
export function buildMarketDetailsKeyboard(marketIndex: number): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button(
        '🔼 Long',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.OPEN)
          .add(SubAction.SELECT_MARKET)
          .add(marketIndex)
          .add(OrderDirection.LONG)
          .build()
      ),
      button(
        '🔽 Short',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.OPEN)
          .add(SubAction.SELECT_MARKET)
          .add(marketIndex)
          .add(OrderDirection.SHORT)
          .build()
      )
    ),
    row(
      button(
        '📖 Orderbook',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.ORDERBOOK)
          .add(SubAction.SELECT_MARKET)
          .add(marketIndex)
          .build()
      )
    ),
    row(
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS).build())
    )
  );
}

/**
 * Position list keyboard
 */
export function buildPositionListKeyboard(positions: DriftPositionInfo[]): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  if (positions.length === 0) {
    return keyboard(
      row(
        button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.REFRESH).build())
      )
    );
  }

  const positionRows = positions.map((position) =>
    row(
      button(
        `${position.direction === 'long' ? '🔼' : '🔽'} ${formatMarketSymbol(position.symbol)} | ${position.unrealizedPnl >= 0 ? '🟢' : '🔴'} ${position.unrealizedPnlPercent.toFixed(2)}%`,
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.POSITIONS)
          .add(SubAction.DETAILS)
          .add(position.marketIndex)
          .build()
      )
    )
  );

  return keyboard(
    ...positionRows,
    row(
      button('🔄 Refresh', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.POSITIONS).build()),
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.REFRESH).build())
    )
  );
}

/**
 * Position details action keyboard
 */
export function buildPositionDetailsKeyboard(marketIndex: number): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button(
        '🔽 Close 25%',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.CLOSE)
          .add(SubAction.SELECT_POSITION)
          .add(marketIndex)
          .add(SubAction.PERCENTAGE)
          .add(25)
          .build()
      ),
      button(
        '🔽 Close 50%',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.CLOSE)
          .add(SubAction.SELECT_POSITION)
          .add(marketIndex)
          .add(SubAction.PERCENTAGE)
          .add(50)
          .build()
      )
    ),
    row(
      button(
        '🔽 Close 75%',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.CLOSE)
          .add(SubAction.SELECT_POSITION)
          .add(marketIndex)
          .add(SubAction.PERCENTAGE)
          .add(75)
          .build()
      ),
      button(
        '🔽 Close 100%',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.CLOSE)
          .add(SubAction.SELECT_POSITION)
          .add(marketIndex)
          .add(SubAction.PERCENTAGE)
          .add(100)
          .build()
      )
    ),
    row(
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.POSITIONS).build())
    )
  );
}

/**
 * Order type selection keyboard (for opening positions)
 */
export function buildOrderTypeKeyboard(marketIndex: number, direction: OrderDirection, amount: string): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button(
        '⚡ Market Order',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.OPEN)
          .add(SubAction.ORDER_TYPE)
          .add(marketIndex)
          .add(direction)
          .add(amount)
          .add(OrderType.MARKET)
          .build()
      )
    ),
    row(
      button(
        '📊 Limit Order',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.OPEN)
          .add(SubAction.ORDER_TYPE)
          .add(marketIndex)
          .add(direction)
          .add(amount)
          .add(OrderType.LIMIT)
          .build()
      )
    ),
    row(
      button('❌ Cancel', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.REFRESH).build())
    )
  );
}

/**
 * Confirmation keyboard (generic)
 */
export function buildConfirmationKeyboard(
  action: DriftAction,
  confirmData: string,
  cancelAction?: DriftAction
): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button(
        '✅ Confirm',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, action)
          .add(SubAction.CONFIRM)
          .add(confirmData)
          .build()
      ),
      button(
        '❌ Cancel',
        new CallbackDataBuilder(CallbackPrefix.DRIFT, cancelAction || DriftAction.REFRESH).build()
      )
    )
  );
}

/**
 * Back button only keyboard
 */
export function buildBackKeyboard(action?: DriftAction): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  return keyboard(
    row(
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, action || DriftAction.REFRESH).build())
    )
  );
}

/**
 * Orderbook market selection keyboard (top markets)
 */
export function buildOrderbookMarketKeyboard(markets: DriftMarketInfo[]): InlineKeyboard {
  const { button, row, keyboard } = KeyboardButtonBuilder;

  // Show top 6 markets by volume
  const topMarkets = markets
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 6);

  const marketRows: InlineKeyboard = [];
  for (let i = 0; i < topMarkets.length; i += 2) {
    const buttons = [];

    const market1 = topMarkets[i];
    buttons.push(
      button(
        `${getMarketEmoji(market1.category)} ${formatMarketSymbol(market1.symbol)}`,
        new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.ORDERBOOK)
          .add(SubAction.SELECT_MARKET)
          .add(market1.marketIndex)
          .build()
      )
    );

    if (i + 1 < topMarkets.length) {
      const market2 = topMarkets[i + 1];
      buttons.push(
        button(
          `${getMarketEmoji(market2.category)} ${formatMarketSymbol(market2.symbol)}`,
          new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.ORDERBOOK)
            .add(SubAction.SELECT_MARKET)
            .add(market2.marketIndex)
            .build()
        )
      );
    }

    marketRows.push(buttons);
  }

  return keyboard(
    ...marketRows,
    row(
      button('📊 All Markets', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.MARKETS).build()),
      button('🔙 Back', new CallbackDataBuilder(CallbackPrefix.DRIFT, DriftAction.REFRESH).build())
    )
  );
}
