import { DEFAULT_GEMINI_MODEL, LlmDriverFactory } from "@/lib/ai/factory";

export { DEFAULT_GEMINI_MODEL };

export function qualityConfig() {
  const provider = process.env.QUALITY_PROVIDER?.trim().toLowerCase() || "gemini";
  const active = LlmDriverFactory.settings(provider);
  return {
    provider,
    /** Model and key of the QUALITY_PROVIDER driver. */
    model: active?.model,
    apiKey: active?.apiKey ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
    geminiModel: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
  };
}
