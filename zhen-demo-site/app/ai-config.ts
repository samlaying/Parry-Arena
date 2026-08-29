export const AI_BASE_URL =
  process.env.AI_BASE_URL ?? "https://api.deepseek.com/v1/chat/completions";
export const AI_MODEL = process.env.AI_MODEL ?? "deepseek-chat";
export const AI_API_KEY = process.env.AI_API_KEY ?? process.env.STEP_API_KEY ?? "";
