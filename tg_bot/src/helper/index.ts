import { bot } from "../bot";
export const safeReply = async (chatId: number, text: string) => {
  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    console.error("Failed to send message:", err);
  }
};
