import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.BOT_TOKEN) {
  console.error("BOT_TOKEN not set in .env");
  process.exit(1);
}

// Long polling (simpler) or webhook (for production servers)
export const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Generic error logging
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

bot.on("webhook_error", (err) => {
  console.error("Webhook error:", err.message);
});
