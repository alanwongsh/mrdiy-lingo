import { TerminologyRule } from "@/lib/translation-quality/rules/TerminologyRule";
import { applyQualityAction } from "@/lib/translation-quality/apply-action";
import { listActiveTerminology } from "@/lib/translation-quality/repository";
import type { QualityTargetField, TerminologyEntry } from "@/lib/translation-quality/types";
import type { SourceContentFields } from "@/lib/types";

/** Enough for any article; stops a fix that keeps re-matching from looping. */
const MAX_FIXES = 60;

type Slots = { title: keyof SourceContentFields; summary: keyof SourceContentFields; content: keyof SourceContentFields };

/**
 * Runs the glossary check over some fields and applies one fix at a time, checking again
 * after each, so offsets always match the current text.
 */
async function fixSlots(
  fields: SourceContentFields,
  source: SourceContentFields,
  slots: Slots,
  sourceLanguage: string,
  targetLanguage: string,
  terminology: TerminologyEntry[]
): Promise<{ fields: SourceContentFields; fixed: number }> {
  const rule = new TerminologyRule();
  let current = fields;
  let fixed = 0;
  const failed = new Set<string>();
  for (let pass = 0; pass < MAX_FIXES; pass += 1) {
    const result = await rule.evaluate({
      sourceLanguage,
      targetLanguage,
      sourceTitle: source[slots.title],
      sourceSummary: source[slots.summary],
      sourceContent: source[slots.content] ?? "",
      translatedTitle: current[slots.title],
      translatedSummary: current[slots.summary],
      translatedContent: current[slots.content] ?? "",
      terminology,
      enabledCategories: [],
    });
    const finding = result.findings.find(
      (item) =>
        item.translatedText &&
        item.suggestedText !== undefined &&
        !failed.has(`${item.targetField}:${item.translatedText}:${item.startOffset}`)
    );
    if (!finding) break;
    const target = finding.targetField as QualityTargetField;
    // The check reads these slots as title, summary and content; write back to the real field.
    const key = target === "title" ? slots.title : target === "summary" ? slots.summary : slots.content;
    try {
      const applied = applyQualityAction(
        { ...current, title: current[key] ?? "", summary: "", body: "" },
        {
          id: "",
          findingId: "",
          actionType: "replace",
          description: "",
          originalText: finding.translatedText,
          proposedText: finding.suggestedText,
          targetField: "title",
          startOffset: finding.startOffset,
          endOffset: finding.endOffset,
          status: "pending",
        }
      );
      current = { ...current, [key]: applied.title };
      fixed += 1;
    } catch {
      // Could not place it safely: leave it for a person, as an analysis finding.
      failed.add(`${finding.targetField}:${finding.translatedText}:${finding.startOffset}`);
    }
  }
  return { fields: current, fixed };
}

/**
 * Applies the glossary to a machine translation before anyone sees it: avoid words, brand
 * variants and doubled full stops are replaced with the "use" spelling. Nobody has written
 * this text yet, so there is nothing to ask about. Text people edit is still only flagged.
 */
export async function applyGlossaryToTranslation(input: {
  applicationId: string;
  sourceLanguage: string;
  targetLanguage: string;
  source: SourceContentFields;
  translated: SourceContentFields;
}): Promise<SourceContentFields> {
  let terminology: TerminologyEntry[];
  try {
    terminology = await listActiveTerminology(input.applicationId);
  } catch {
    // Glossary unavailable: keep the translation as the model returned it.
    return input.translated;
  }
  return fixGlossaryInTranslation({ ...input, terminology });
}

/** The same, with the glossary already loaded. */
export async function fixGlossaryInTranslation(input: {
  sourceLanguage: string;
  targetLanguage: string;
  source: SourceContentFields;
  translated: SourceContentFields;
  terminology: TerminologyEntry[];
}): Promise<SourceContentFields> {
  const { terminology } = input;
  if (terminology.length === 0) return input.translated;

  const main = await fixSlots(
    input.translated,
    input.source,
    { title: "title", summary: "summary", content: "body" },
    input.sourceLanguage,
    input.targetLanguage,
    terminology
  );
  // SEO title and description are checked the same way, in the title and summary slots.
  const seo = await fixSlots(
    { ...main.fields, body: "" },
    { ...input.source, body: "" },
    { title: "seo_title", summary: "seo_description", content: "body" },
    input.sourceLanguage,
    input.targetLanguage,
    terminology
  );
  return { ...main.fields, seo_title: seo.fields.seo_title, seo_description: seo.fields.seo_description };
}
