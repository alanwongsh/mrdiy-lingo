import type { LlmDriver } from "@/lib/ai/driver";
import { GeminiDriver } from "@/lib/ai/gemini";
import { OpenRouterDriver } from "@/lib/ai/openrouter";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = `google/${DEFAULT_GEMINI_MODEL}`;

type DriverSettings = { keyName: string; apiKey: string; model: string };

const drivers: Record<
  string,
  { settings: () => DriverSettings; build: (settings: DriverSettings) => LlmDriver }
> = {
  gemini: {
    settings: () => ({
      keyName: "GEMINI_API_KEY",
      apiKey: process.env.GEMINI_API_KEY?.trim() || "",
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    }),
    build: ({ model, apiKey }) => new GeminiDriver(model, apiKey),
  },
  openrouter: {
    settings: () => ({
      keyName: "OPENROUTER_API_KEY",
      apiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
      model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
    }),
    build: ({ model, apiKey }) => new OpenRouterDriver(model, apiKey),
  },
};

/** Picks the model API by id. Register a new driver here to make it available everywhere. */
export class LlmDriverFactory {
  static has(id: string) {
    return Object.hasOwn(drivers, id.trim().toLowerCase());
  }

  /** Key and model for a driver, without building it. Null for an unknown id. */
  static settings(id: string): DriverSettings | null {
    const entry = drivers[id.trim().toLowerCase()];
    return entry ? entry.settings() : null;
  }

  static create(id: string): LlmDriver {
    const entry = drivers[id.trim().toLowerCase()];
    if (!entry) throw new Error(`Unknown model provider "${id}".`);
    const settings = entry.settings();
    if (!settings.apiKey) throw new Error(`${settings.keyName} is not configured.`);
    return entry.build(settings);
  }
}
