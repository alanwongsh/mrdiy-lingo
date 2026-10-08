import type { TranslationQualityInput } from "@/lib/translation-quality/types";
import { htmlToText } from "@/lib/translation-quality/text";

export const PROMPT_VERSION = "translation-quality-v1";

function articleText(value: string | undefined): string {
  return htmlToText(value ?? "") || "(empty)";
}

export function buildTranslationQualityPrompt(
  input: TranslationQualityInput
): string {
  const categories = input.enabledCategories
    .filter((category) => category.categoryType === "ai")
    .map((category) => `- ${category.code}: ${category.description}`)
    .join("\n");

  const terms = (input.terminology ?? [])
    .map((entry) => {
      const preferred = entry.preferredTranslation || entry.term;
      return `- ${entry.term} → ${preferred}`;
    })
    .join("\n");

  return `You are a professional translation quality evaluator.

Compare the source article with the translated article.

Source language: ${input.sourceLanguage}
Target language: ${input.targetLanguage}

Evaluate only these categories:
${categories || "- (none)"}

For each category:
- provide a score from 0 to 100
- explain the score
- identify concrete issues
- provide actionable suggestions when a specific text change would fix the issue

Do not invent errors.
Do not penalize valid stylistic differences.
For cross_language, prioritize semantic accuracy.
For tone, compare the translated tone against the source.
For structure, evaluate preservation of article organization.
Do not score terminology or boilerplate. Other checks cover those.
Treat the preferred terms below as intentional. Do not ask to translate a brand that must stay unchanged.

Preferred terms:
${terms || "- (none)"}

Quote translatedText and sourceText as exact plain-text snippets from the articles. Do not include HTML tags.
When you suggest a change, set suggestedText to the replacement plain text and targetField to title, summary, or content.
Use actionType replace when suggestedText should replace translatedText.
Leave findings empty when a category has no concrete issue.

When a passage is untranslated, mixed with the source language, or still contains a leftover language tag such as [zh-Hans]:
- Put those rewrites in cross_language.
- Add one finding for every distinct broken paragraph or sentence, from the start of the article through the final paragraph. Do not stop after the first example, do not skip the closing sentence, and do not collapse many broken passages into one finding.
- Quote the whole broken passage in translatedText. Do not shrink it to a few words inside the passage.
- Set suggestedText to the full corrected passage in the target language.
- Other categories should score the problem, but should not repeat the same passage.

Source title:
${articleText(input.sourceTitle)}

Source summary:
${articleText(input.sourceSummary)}

Source article:
${articleText(input.sourceContent)}

Translated title:
${articleText(input.translatedTitle)}

Translated summary:
${articleText(input.translatedSummary)}

Translated article:
${articleText(input.translatedContent)}

Return only the requested structured JSON.`;
}

export function geminiResponseSchema(categoryCodes: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["categories"],
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["categoryCode", "score", "summary", "findings"],
          properties: {
            categoryCode: { type: "string", enum: categoryCodes },
            score: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "string" },
            findings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["severity", "title", "explanation", "targetField"],
                properties: {
                  severity: {
                    type: "string",
                    enum: ["info", "warning", "error", "critical"],
                  },
                  title: { type: "string" },
                  explanation: { type: "string" },
                  sourceText: { type: "string" },
                  translatedText: { type: "string" },
                  suggestedText: { type: "string" },
                  targetField: {
                    type: "string",
                    enum: ["title", "summary", "content"],
                  },
                  actionType: {
                    type: "string",
                    enum: ["replace", "insert", "delete", "rewrite"],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
