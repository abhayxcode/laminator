import { bot } from "./bot";
import { safeReply } from "./helper";

// /start
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const commandsList = `
Welcome to Solana Perps Bot 🚀

Available commands:
/start - Guide to All commands
/balance - Show your balance
/get_orderbook - Get orderbook for a perp
/open - Open a position
/close - Close a position
`;
  await safeReply(chatId, commandsList);
});

// /balance
bot.onText(/^\/balance$/, async (msg) => {
  const chatId = msg.chat.id;
  // TODO: Replace with actual backend call
  await safeReply(chatId, "💰 Your current balance is: [not implemented yet]");
});

// /get_orderbook <symbol>
bot.onText(/^\/get_orderbook (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!match || !match[1]) {
    return bot.sendMessage(msg.chat.id, "Usage: /get_orderbook <symbol>");
  }
  const symbol = match[1];
  // TODO: Replace with actual backend call
  await safeReply(chatId, `📊 Orderbook for ${symbol}: [not implemented yet]`);
});

// /open <symbol> <size> <side>
bot.onText(/^\/open (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!match || !match[1]) {
    return bot.sendMessage(msg.chat.id, "Usage: /get_orderbook <symbol>");
  }
  const args = match[1].split(/\s+/);
  const [symbol, size, side] = args;
  // TODO: Replace with actual backend call
  await safeReply(
    chatId,
    `Opening position: ${size ?? "?"} ${symbol ?? "?"} ${
      side ?? "(side?)"
    } [not implemented yet]`
  );
});

// /close <symbol>
bot.onText(/^\/close (.+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!match || !match[1]) {
    return bot.sendMessage(msg.chat.id, "Usage: /get_orderbook <symbol>");
  }
  const symbol = match[1];
  // TODO: Replace with actual backend call
  await safeReply(
    chatId,
    `Closing position for ${symbol} [not implemented yet]`
  );
});

// Default fallback for unrecognized messages
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    if (!msg.text || msg.text?.startsWith("/")) return; // ignore commands or empty text
    console.log("Received message:", msg.text);
    await bot.sendMessage(chatId, `You said: ${msg.text}`);
  } catch (err) {
    console.error("Error handling message:", err);
    // Optionally notify the user
    // bot.sendMessage(chatId, 'Oops! Something went wrong.');
  }
});

console.log("Telegram bot is running...");
