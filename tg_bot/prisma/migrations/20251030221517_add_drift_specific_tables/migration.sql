-- CreateTable
CREATE TABLE "drift_markets" (
    "id" TEXT NOT NULL,
    "market_index" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "base_asset" TEXT NOT NULL,
    "quote_asset" TEXT NOT NULL DEFAULT 'USD',
    "market_type" TEXT NOT NULL DEFAULT 'PERPETUAL',
    "category" TEXT,
    "min_order_size" DECIMAL(36,18),
    "max_order_size" DECIMAL(36,18),
    "tick_size" DECIMAL(36,18),
    "step_size" DECIMAL(36,18),
    "max_leverage" DECIMAL(8,2),
    "oracle_source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "drift_markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "drift_order_id" TEXT,
    "drift_user_account" TEXT,
    "market_index" INTEGER NOT NULL,
    "order_type" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "base_asset_amount" DECIMAL(36,18) NOT NULL,
    "price" DECIMAL(36,18),
    "trigger_price" DECIMAL(36,18),
    "leverage" DECIMAL(8,2) NOT NULL DEFAULT 1.0,
    "reduce_only" BOOLEAN NOT NULL DEFAULT false,
    "post_only" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filled_amount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "avg_fill_price" DECIMAL(36,18),
    "total_fees" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "filled_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "drift_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_positions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "drift_user_account" TEXT,
    "market_index" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "base_asset_amount" DECIMAL(36,18) NOT NULL,
    "quote_asset_amount" DECIMAL(36,18) NOT NULL,
    "entry_price" DECIMAL(36,18) NOT NULL,
    "last_price" DECIMAL(36,18),
    "mark_price" DECIMAL(36,18),
    "leverage" DECIMAL(8,2) NOT NULL DEFAULT 1.0,
    "margin_amount" DECIMAL(36,18) NOT NULL,
    "unrealized_pnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "realized_pnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "liquidation_price" DECIMAL(36,18),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "drift_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "tx_hash" TEXT,
    "tx_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "order_id" TEXT,
    "position_id" TEXT,
    "market_index" INTEGER,
    "amount" DECIMAL(36,18),
    "token_symbol" TEXT,
    "block_number" BIGINT,
    "block_timestamp" TIMESTAMP(3),
    "gas_fee" DECIMAL(36,18),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "error_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "drift_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drift_markets_market_index_key" ON "drift_markets"("market_index");

-- CreateIndex
CREATE UNIQUE INDEX "drift_markets_symbol_key" ON "drift_markets"("symbol");

-- CreateIndex
CREATE INDEX "drift_markets_symbol_idx" ON "drift_markets"("symbol");

-- CreateIndex
CREATE INDEX "drift_markets_market_index_idx" ON "drift_markets"("market_index");

-- CreateIndex
CREATE INDEX "drift_markets_status_idx" ON "drift_markets"("status");

-- CreateIndex
CREATE INDEX "drift_orders_user_id_status_idx" ON "drift_orders"("user_id", "status");

-- CreateIndex
CREATE INDEX "drift_orders_wallet_id_idx" ON "drift_orders"("wallet_id");

-- CreateIndex
CREATE INDEX "drift_orders_market_id_idx" ON "drift_orders"("market_id");

-- CreateIndex
CREATE INDEX "drift_orders_drift_order_id_idx" ON "drift_orders"("drift_order_id");

-- CreateIndex
CREATE INDEX "drift_orders_created_at_idx" ON "drift_orders"("created_at");

-- CreateIndex
CREATE INDEX "drift_positions_user_id_status_idx" ON "drift_positions"("user_id", "status");

-- CreateIndex
CREATE INDEX "drift_positions_wallet_id_idx" ON "drift_positions"("wallet_id");

-- CreateIndex
CREATE INDEX "drift_positions_market_id_idx" ON "drift_positions"("market_id");

-- CreateIndex
CREATE INDEX "drift_positions_status_idx" ON "drift_positions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "drift_positions_user_id_market_index_status_key" ON "drift_positions"("user_id", "market_index", "status");

-- CreateIndex
CREATE UNIQUE INDEX "drift_transactions_tx_hash_key" ON "drift_transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "drift_transactions_user_id_created_at_idx" ON "drift_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "drift_transactions_wallet_id_idx" ON "drift_transactions"("wallet_id");

-- CreateIndex
CREATE INDEX "drift_transactions_tx_hash_idx" ON "drift_transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "drift_transactions_status_idx" ON "drift_transactions"("status");

-- CreateIndex
CREATE INDEX "drift_transactions_tx_type_idx" ON "drift_transactions"("tx_type");

-- AddForeignKey
ALTER TABLE "drift_orders" ADD CONSTRAINT "drift_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_orders" ADD CONSTRAINT "drift_orders_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_orders" ADD CONSTRAINT "drift_orders_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "drift_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_positions" ADD CONSTRAINT "drift_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_positions" ADD CONSTRAINT "drift_positions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_positions" ADD CONSTRAINT "drift_positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "drift_markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_transactions" ADD CONSTRAINT "drift_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_transactions" ADD CONSTRAINT "drift_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
