import { LlmDriverFactory } from "@/lib/ai/factory";
import { qualityConfig } from "@/lib/translation-quality/config";
import { LlmTranslationQualityProvider } from "@/lib/translation-quality/providers/LlmTranslationQualityProvider";
import type { TranslationQualityProvider } from "@/lib/translation-quality/providers/provider";

export class TranslationQualityProviderFactory {
  /** Any driver registered in LlmDriverFactory, such as gemini or openrouter. */
  static create(providerId?: string): TranslationQualityProvider {
    const id = (providerId ?? qualityConfig().provider).trim().toLowerCase();
    if (!LlmDriverFactory.has(id)) {
      throw new Error(`Unknown translation quality provider "${id}".`);
    }
    return new LlmTranslationQualityProvider(LlmDriverFactory.create(id));
  }
}
