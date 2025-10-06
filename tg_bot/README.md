# Laminator - Multi-DEX Perps Telegram Bot ⚡

A Telegram bot for trading perpetual futures across multiple DEXs, starting with Drift Protocol and expanding to Flash Trade and more, built with TypeScript and Node.js.

## Features

- **Market Discovery**: View all available perpetual markets on Drift
- **Position Management**: Check your open positions and balances
- **Wallet Integration**: Connect your Solana wallet to the bot
- **Real-time Data**: Get market prices and orderbook information
- **User Authentication**: Secure wallet connection management

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Show welcome message and command list | `/start` |
| `/dexs` | List all available perpetual markets | `/dexs` |
| `/balance` | Show your wallet balance | `/balance` |
| `/orderbook <symbol>` | Get orderbook for a specific market | `/orderbook SOL` |
| `/myposition` | Show your current open positions | `/myposition` |
| `/open <symbol> <size> <side>` | Open a new position | `/open SOL 1 long` |
| `/close <symbol>` | Close an existing position | `/close SOL` |
| `/connect <wallet>` | Connect your Solana wallet | `/connect 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU` |
| `/disconnect` | Disconnect your wallet | `/disconnect` |

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Telegram      │    │   Bot Server     │    │  Drift Protocol │
│   Users         │◄──►│  (TypeScript)    │◄──►│  SDK/API        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  User Service    │
                       │  (Wallet Mgmt)   │
                       └──────────────────┘
```

### Key Components

1. **Command Layer** (`/src/index.ts`) - Handles Telegram commands
2. **Drift Service** (`/src/services/driftService.ts`) - Drift Protocol integration
3. **User Service** (`/src/services/userService.ts`) - User and wallet management
4. **Helper Functions** (`/src/helper/index.ts`) - Utility functions

## Setup

### Prerequisites

- Node.js (v18 or higher)
- Telegram Bot Token (from @BotFather)
- Solana wallet (for trading)

### Installation

1. **Clone and install dependencies:**
   ```bash
   cd tg_bot
   npm install
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Configure your bot token:**
   ```bash
   # Add your Telegram bot token to .env
   BOT_TOKEN=your_bot_token_here
   ```

4. **Start the bot:**
   ```bash
   npm run dev
   ```

## Development

### Project Structure

```
tg_bot/
├── src/
│   ├── services/
│   │   ├── driftService.ts    # Drift Protocol integration
│   │   └── userService.ts     # User management
│   ├── helper/
│   │   └── index.ts          # Utility functions
│   ├── bot.ts                # Telegram bot setup
│   └── index.ts              # Command handlers
├── package.json
├── tsconfig.json
└── README.md
```

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server

## Current Status

### ✅ Implemented
- Bot command structure and routing
- User authentication and wallet connection
- Market listing functionality
- Position viewing
- Balance checking
- Error handling and validation

### 🚧 In Progress
- Real Drift Protocol integration (currently using mock data)
- Transaction signing for position opening/closing
- Full orderbook data integration

### 🔮 Planned Features
- Leverage selection for positions
- Stop-loss and take-profit orders
- Portfolio analytics and PnL tracking
- Price alerts and notifications
- Multi-wallet support

## API Integration Notes

Currently, the bot uses mock data to demonstrate functionality. To integrate with real Drift Protocol:

1. **Drift SDK Integration**: Replace mock data with actual Drift SDK calls
2. **Wallet Integration**: Implement transaction signing for position management
3. **Real-time Data**: Connect to Drift's WebSocket API for live market data
4. **Error Handling**: Add comprehensive error handling for blockchain transactions

## Security Considerations

- **Wallet Security**: Users must provide their own wallet addresses
- **Private Keys**: Never store or handle private keys in the bot
- **Transaction Validation**: All transactions are signed by user's wallet
- **Rate Limiting**: Implement rate limiting to prevent spam

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions:
- Create an issue on GitHub
- Join our Telegram support group
- Check Drift Protocol documentation

---

**⚠️ Disclaimer**: This bot is for educational purposes. Trading involves risk. Always do your own research and never invest more than you can afford to lose.
