export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function qualityConfig() {
  const provider = process.env.QUALITY_PROVIDER?.trim().toLowerCase() || "gemini";
  return {
    provider,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
    geminiModel: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
  };
}
