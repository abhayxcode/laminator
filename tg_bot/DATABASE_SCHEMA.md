# Laminator Database Schema Design

## 🏗️ Production-Ready PostgreSQL Schema

### **Core Design Principles:**
1. **Scalability** - Handle millions of users and transactions
2. **Performance** - Optimized indexes and queries
3. **Data Integrity** - Proper constraints and relationships
4. **Audit Trail** - Complete transaction history
5. **Security** - Encrypted sensitive data
6. **Analytics** - Easy reporting and insights

## 📊 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        LAMINATOR DATABASE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Users ──────┬─── Wallets ──────┬─── Transactions              │
│     │        │       │          │       │                      │
│     │        │       │          │       │                      │
│     │        │       │          │       │                      │
│     ▼        ▼       ▼          ▼       ▼                      │
│  UserProfiles│   WalletBalances │   Orders ──── OrderHistory   │
│  UserSettings│   WalletHistory  │   Positions ── PositionHistory│
│  UserSessions│   WalletAlerts   │   Trades ───── TradeHistory  │
│              │                  │   MarketData                 │
│              │                  │   Alerts                     │
│              │                  │   Analytics                  │
│              │                  │   AuditLogs                  │
└─────────────────────────────────────────────────────────────────┘
```

## 🗃️ Core Tables

### **1. Users Table**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  telegram_username VARCHAR(255),
  telegram_first_name VARCHAR(255),
  telegram_last_name VARCHAR(255),
  privy_user_id VARCHAR(255) UNIQUE,
  status user_status DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  CONSTRAINT users_telegram_id_positive CHECK (telegram_id > 0)
);

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned', 'pending_verification');
```

### **2. Wallets Table**
```sql
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  privy_wallet_id VARCHAR(255) UNIQUE,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  wallet_type wallet_type DEFAULT 'privy',
  chain_type chain_type DEFAULT 'solana',
  status wallet_status DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  CONSTRAINT wallets_address_format CHECK (wallet_address ~ '^[A-Za-z0-9]{32,44}$')
);

CREATE TYPE wallet_type AS ENUM ('privy', 'phantom', 'solflare', 'backpack', 'external');
CREATE TYPE chain_type AS ENUM ('solana', 'ethereum', 'polygon');
CREATE TYPE wallet_status AS ENUM ('active', 'inactive', 'suspended', 'pending');
```

### **3. Wallet Balances Table**
```sql
CREATE TABLE wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token_symbol VARCHAR(10) NOT NULL,
  token_address VARCHAR(255),
  balance DECIMAL(36, 18) NOT NULL DEFAULT 0,
  locked_balance DECIMAL(36, 18) NOT NULL DEFAULT 0,
  available_balance DECIMAL(36, 18) GENERATED ALWAYS AS (balance - locked_balance) STORED,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(wallet_id, token_symbol)
);

-- Index for fast balance lookups
CREATE INDEX idx_wallet_balances_wallet_token ON wallet_balances(wallet_id, token_symbol);
```

### **4. Markets Table**
```sql
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  base_asset VARCHAR(10) NOT NULL,
  quote_asset VARCHAR(10) NOT NULL,
  dex_name VARCHAR(50) NOT NULL,
  market_type market_type DEFAULT 'perpetual',
  status market_status DEFAULT 'active',
  min_order_size DECIMAL(36, 18),
  max_order_size DECIMAL(36, 18),
  tick_size DECIMAL(36, 18),
  step_size DECIMAL(36, 18),
  max_leverage DECIMAL(8, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(symbol, dex_name)
);

CREATE TYPE market_type AS ENUM ('perpetual', 'spot', 'futures');
CREATE TYPE market_status AS ENUM ('active', 'inactive', 'suspended', 'maintenance');
```

### **5. Orders Table**
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id),
  order_type order_type NOT NULL,
  side order_side NOT NULL,
  size DECIMAL(36, 18) NOT NULL,
  price DECIMAL(36, 18),
  leverage DECIMAL(8, 2) DEFAULT 1.0,
  status order_status DEFAULT 'pending',
  filled_size DECIMAL(36, 18) DEFAULT 0,
  avg_fill_price DECIMAL(36, 18),
  total_fees DECIMAL(36, 18) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT orders_size_positive CHECK (size > 0),
  CONSTRAINT orders_price_positive CHECK (price IS NULL OR price > 0),
  CONSTRAINT orders_leverage_positive CHECK (leverage > 0)
);

CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit');
CREATE TYPE order_side AS ENUM ('buy', 'sell', 'long', 'short');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'filled', 'partially_filled', 'cancelled', 'expired', 'failed');
```

### **6. Positions Table**
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id),
  side position_side NOT NULL,
  size DECIMAL(36, 18) NOT NULL,
  entry_price DECIMAL(36, 18) NOT NULL,
  current_price DECIMAL(36, 18),
  leverage DECIMAL(8, 2) DEFAULT 1.0,
  margin DECIMAL(36, 18) NOT NULL,
  unrealized_pnl DECIMAL(36, 18) DEFAULT 0,
  realized_pnl DECIMAL(36, 18) DEFAULT 0,
  status position_status DEFAULT 'open',
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, market_id, side) -- One position per market per side
);

CREATE TYPE position_side AS ENUM ('long', 'short');
CREATE TYPE position_status AS ENUM ('open', 'closed', 'liquidated');
```

### **7. Transactions Table**
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  tx_hash VARCHAR(255) UNIQUE,
  tx_type transaction_type NOT NULL,
  status transaction_status DEFAULT 'pending',
  amount DECIMAL(36, 18),
  token_symbol VARCHAR(10),
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  gas_fee DECIMAL(36, 18),
  block_number BIGINT,
  block_timestamp TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'trade', 'fee', 'reward', 'transfer');
CREATE TYPE transaction_status AS ENUM ('pending', 'confirmed', 'failed', 'cancelled');
```

### **8. Alerts Table**
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id UUID REFERENCES markets(id),
  alert_type alert_type NOT NULL,
  condition_type condition_type NOT NULL,
  target_price DECIMAL(36, 18),
  target_percentage DECIMAL(8, 4),
  message TEXT,
  status alert_status DEFAULT 'active',
  triggered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT alerts_price_positive CHECK (target_price IS NULL OR target_price > 0)
);

CREATE TYPE alert_type AS ENUM ('price_above', 'price_below', 'price_change', 'volume', 'position_pnl');
CREATE TYPE condition_type AS ENUM ('greater_than', 'less_than', 'equals', 'percentage_change');
CREATE TYPE alert_status AS ENUM ('active', 'triggered', 'cancelled', 'expired');
```

### **9. User Settings Table**
```sql
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, setting_key)
);

-- Common settings
-- risk_management: { max_leverage: 10, stop_loss_percentage: 5 }
-- notifications: { price_alerts: true, trade_notifications: true }
-- trading: { default_slippage: 0.5, auto_close: false }
```

### **10. Audit Logs Table**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for audit queries
CREATE INDEX idx_audit_logs_user_action ON audit_logs(user_id, action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

## 🚀 Performance Optimizations

### **Indexes for Fast Queries**
```sql
-- User lookups
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_privy_user_id ON users(privy_user_id);

-- Wallet operations
CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_address ON wallets(wallet_address);

-- Trading queries
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_market_status ON orders(market_id, status);
CREATE INDEX idx_positions_user_market ON positions(user_id, market_id);

-- Balance queries
CREATE INDEX idx_wallet_balances_wallet ON wallet_balances(wallet_id);
CREATE INDEX idx_wallet_balances_updated ON wallet_balances(updated_at DESC);

-- Transaction history
CREATE INDEX idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_wallet_type ON transactions(wallet_id, tx_type);
```

### **Partitioning for Large Tables**
```sql
-- Partition transactions by month
CREATE TABLE transactions_y2024m01 PARTITION OF transactions
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Partition audit logs by month
CREATE TABLE audit_logs_y2024m01 PARTITION OF audit_logs
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

## 🔒 Security Features

### **Row Level Security (RLS)**
```sql
-- Enable RLS on sensitive tables
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY wallet_balances_user_policy ON wallet_balances
FOR ALL TO authenticated_user
USING (wallet_id IN (
  SELECT id FROM wallets WHERE user_id = current_user_id()
));
```

### **Data Encryption**
```sql
-- Encrypt sensitive data
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Function to encrypt/decrypt sensitive fields
CREATE OR REPLACE FUNCTION encrypt_sensitive_data(data TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(encrypt(data::bytea, current_setting('app.encryption_key'), 'aes'), 'base64');
END;
$$ LANGUAGE plpgsql;
```

## 📊 Analytics & Reporting Views

### **User Portfolio View**
```sql
CREATE VIEW user_portfolio AS
SELECT 
  u.id as user_id,
  u.telegram_username,
  wb.token_symbol,
  SUM(wb.available_balance) as total_balance,
  COUNT(DISTINCT p.id) as open_positions,
  SUM(CASE WHEN p.status = 'open' THEN p.unrealized_pnl ELSE 0 END) as total_unrealized_pnl
FROM users u
JOIN wallets w ON u.id = w.user_id
JOIN wallet_balances wb ON w.id = wb.wallet_id
LEFT JOIN positions p ON u.id = p.user_id AND p.status = 'open'
WHERE u.status = 'active'
GROUP BY u.id, u.telegram_username, wb.token_symbol;
```

### **Trading Statistics View**
```sql
CREATE VIEW trading_stats AS
SELECT 
  DATE_TRUNC('day', o.created_at) as trading_date,
  COUNT(*) as total_orders,
  COUNT(CASE WHEN o.status = 'filled' THEN 1 END) as filled_orders,
  SUM(CASE WHEN o.status = 'filled' THEN o.size * o.avg_fill_price ELSE 0 END) as total_volume,
  AVG(CASE WHEN o.status = 'filled' THEN o.total_fees ELSE 0 END) as avg_fees
FROM orders o
GROUP BY DATE_TRUNC('day', o.created_at)
ORDER BY trading_date DESC;
```

## 🎯 Next Steps

1. **Initialize Prisma Schema** with these tables
2. **Set up migrations** for database versioning
3. **Implement data access layer** with Prisma Client
4. **Add database connection pooling** for performance
5. **Set up backup and recovery** procedures
6. **Implement real-time updates** with database triggers
7. **Add monitoring and alerting** for database health

This schema provides a solid foundation for a production-ready trading bot with proper scalability, security, and analytics capabilities.
