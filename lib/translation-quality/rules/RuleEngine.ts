import type {
  RuleEvaluationResult,
  TranslationQualityRule,
} from "@/lib/translation-quality/rules/types";
import type { TranslationQualityInput } from "@/lib/translation-quality/types";

export class RuleEngine {
  constructor(private readonly rules: TranslationQualityRule[]) {}

  async evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult[]> {
    const enabled = input.enabledCategories.filter(
      (category) => category.categoryType === "rule"
    );
    return Promise.all(
      enabled.map(async (category) => {
        const rule = this.rules.find((item) => item.code === category.code);
        if (!rule) {
          const message = `No rule is registered for ${category.name}.`;
          return {
            categoryCode: category.code,
            score: null,
            summary: message,
            error: message,
            findings: [],
          };
        }
        try {
          return await rule.evaluate(input);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Rule failed.";
          return {
            categoryCode: category.code,
            score: null,
            summary: message,
            error: message,
            findings: [],
          };
        }
      })
    );
  }
}
