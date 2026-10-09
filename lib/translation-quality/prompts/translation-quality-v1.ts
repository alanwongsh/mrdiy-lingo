import type { TranslationQualityInput } from "@/lib/translation-quality/types";
import { htmlToText, languageCompatible } from "@/lib/translation-quality/text";

export const PROMPT_VERSION = "translation-quality-v1.1";

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
    .filter(
      (entry) =>
        entry.isActive &&
        languageCompatible(entry.sourceLanguage, input.sourceLanguage) &&
        languageCompatible(entry.targetLanguage, input.targetLanguage)
    )
    .map((entry) => {
      const preferred = entry.preferredTranslation || entry.term;
      const forbidden = entry.forbiddenTranslations.map((item) => item.trim()).filter(Boolean);
      const avoid = forbidden.length > 0 ? `; do not use ${forbidden.join(", ")} for this term` : "";
      return `- When the source says "${entry.term}", use "${preferred}"${avoid}.`;
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
Do not score terminology or boilerplate. Other checks cover those, and your scores must not move because of them.
The glossary below is already decided. Using its preferred word for that source word is correct. Do not lower message, tone, structure, or cross_language for it, and do not suggest a different word.
A preferred word applies only where the source uses that term. If the source says "booth", "gerai" is the right meaning and "Kedai" is a mistranslation. Score that as meaning, not as terminology.
Do not suggest the reverse of a preferred term when the source word is the glossary term.

Preferred terms:
${terms || "- (none)"}

Quote translatedText and sourceText as exact plain-text snippets from the articles. Do not include HTML tags.
Start and end translatedText on whole words. Never start a quote in the middle of a word or at an apostrophe such as "’s"; include the whole word "MR.DIY’s".
When you suggest a change, set suggestedText to the replacement plain text and targetField to title, summary, or content.
suggestedText replaces exactly the words in translatedText, so cover the same span and keep the spaces between words.
Use actionType replace when suggestedText should replace translatedText.
Leave findings empty when a category has no concrete issue.
Report only changes a professional reviewer would require. Do not report an alternative that is equally correct, a matter of taste, or a rewording of text that is already accurate and natural.
The articles were extracted from HTML. Line breaks, double spaces and quote styles are not visible to readers, so do not report them. Do report two words that run together without a space.
${historyBlock(input)}

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
${focusBlock(input)}
Return only the requested structured JSON.`;
}

function historyBlock(input: TranslationQualityInput): string {
  const decisions = input.reviewHistory ?? [];
  if (decisions.length === 0) return "";
  const lines = decisions.map((decision) =>
    decision.status === "applied" && decision.suggestedText
      ? `- Accepted: "${decision.translatedText}" was changed to "${decision.suggestedText}".`
      : `- Kept as written: "${decision.translatedText}".`
  );
  return `
A reviewer already decided these in earlier analyses of this article. Do not report them again, do not suggest reversing an accepted change, and do not suggest changing wording that was kept. Report only issues these decisions do not cover.
${lines.join("\n")}
`;
}

function focusBlock(input: TranslationQualityInput): string {
  const passages = input.passageFocus ?? [];
  if (passages.length === 0) return "";
  const lines = passages
    .map(
      (passage, index) =>
        `Passage ${index + 1}
Source: ${passage.source}
Translation: ${passage.translated}`
    )
    .join("\n\n");
  return `
These passages were left out of the review above. Return one cross_language finding for every passage.
Set translatedText to the Translation line exactly, and suggestedText to the full correction in ${input.targetLanguage}.
Use actionType replace. Leave findings empty for every other category.

${lines}
`;
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
