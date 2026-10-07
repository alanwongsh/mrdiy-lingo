import { qualityConfig } from "@/lib/translation-quality/config";
import { GeminiTranslationQualityProvider } from "@/lib/translation-quality/providers/GeminiTranslationQualityProvider";
import type { TranslationQualityProvider } from "@/lib/translation-quality/providers/provider";

const builders: Record<string, () => TranslationQualityProvider> = {
  gemini: () => new GeminiTranslationQualityProvider(),
};

const reserved = new Set(["openai", "claude"]);

export class TranslationQualityProviderFactory {
  static create(providerId?: string): TranslationQualityProvider {
    const id = (providerId ?? qualityConfig().provider).trim().toLowerCase();
    const build = builders[id];
    if (build) return build();
    if (reserved.has(id)) {
      throw new Error(
        `The ${id} provider is not implemented. Register an adapter in TranslationQualityProviderFactory.`
      );
    }
    throw new Error(`Unknown translation quality provider "${id}".`);
  }
}
