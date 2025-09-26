import { bot } from "../bot";

// helper to catch errors
export const safeReply = async (chatId: number, text: string) => {
  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    console.error("Failed to send message:", err);
  }
};
