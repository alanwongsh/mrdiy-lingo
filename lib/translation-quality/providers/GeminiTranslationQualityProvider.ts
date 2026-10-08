import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { writeServiceLog } from "@/lib/service-log";
import { qualityConfig } from "@/lib/translation-quality/config";
import {
  buildTranslationQualityPrompt,
  geminiResponseSchema,
} from "@/lib/translation-quality/prompts/translation-quality-v1";
import type { TranslationQualityInput } from "@/lib/translation-quality/types";
import { clip, safeErrorMessage } from "@/lib/translation-quality/text";
import type {
  ProviderFinding,
  ProviderQualityResult,
  TranslationQualityProvider,
} from "@/lib/translation-quality/providers/provider";

const SEVERITIES = new Set(["info", "warning", "error", "critical"]);
const FIELDS = new Set(["title", "summary", "content"]);
const ACTIONS = new Set(["replace", "insert", "delete", "rewrite"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function plainQuote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/<[^>]+>/g, "").trim();
  return text || undefined;
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Gemini returned invalid JSON.");
  }
}

export function validateGeminiPayload(
  value: unknown,
  allowedCodes: string[]
): ProviderQualityResult["categories"] {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.categories)) {
    throw new Error("Gemini returned an unexpected quality payload.");
  }
  const allowed = new Set(allowedCodes);
  const categories: ProviderQualityResult["categories"] = [];
  for (const item of root.categories) {
    const row = asRecord(item);
    if (!row) continue;
    const categoryCode = clip(row.categoryCode, 80);
    if (!categoryCode || !allowed.has(categoryCode)) continue;
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    const findings: ProviderFinding[] = [];
    const rawFindings = Array.isArray(row.findings) ? row.findings : [];
    for (const finding of rawFindings) {
      const parsed = asRecord(finding);
      if (!parsed) continue;
      const severity = clip(parsed.severity, 20);
      const title = clip(parsed.title, 160);
      const explanation = clip(parsed.explanation, 800);
      const targetField = clip(parsed.targetField, 20);
      if (!severity || !SEVERITIES.has(severity) || !title || !explanation) continue;
      if (!targetField || !FIELDS.has(targetField)) continue;
      const actionType = clip(parsed.actionType, 20);
      findings.push({
        severity: severity as ProviderFinding["severity"],
        title,
        explanation,
        sourceText: plainQuote(parsed.sourceText),
        translatedText: plainQuote(parsed.translatedText),
        suggestedText: plainQuote(parsed.suggestedText),
        targetField: targetField as ProviderFinding["targetField"],
        actionType:
          actionType && ACTIONS.has(actionType)
            ? (actionType as ProviderFinding["actionType"])
            : undefined,
      });
    }
    categories.push({
      categoryCode,
      score: Math.max(0, Math.min(100, Math.round(score))),
      summary: clip(row.summary, 800) ?? "",
      findings,
    });
  }
  if (categories.length === 0) {
    throw new Error("Gemini did not return any enabled quality categories.");
  }
  return categories;
}

function isGemini3(model: string) {
  return /^gemini-3(?:[.-]|$)/i.test(model);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Gemini includes these on the response. It does not store the prompt or reply. */
function tokenUsage(usage: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
} | null | undefined) {
  if (!usage) return undefined;
  const tokens = {
    promptTokens: tokenCount(usage.promptTokenCount),
    outputTokens: tokenCount(usage.candidatesTokenCount),
    totalTokens: tokenCount(usage.totalTokenCount),
    thoughtsTokens: tokenCount(usage.thoughtsTokenCount),
    cachedTokens: tokenCount(usage.cachedContentTokenCount),
  };
  return Object.values(tokens).some((count) => count !== undefined) ? tokens : undefined;
}

function logGeminiCall(entry: {
  model: string;
  ok: boolean;
  durationMs: number;
  attempt: number;
  usage?: ReturnType<typeof tokenUsage>;
  input: string;
  output?: string;
  error?: string;
}) {
  return writeServiceLog({
    source: "gemini",
    ok: entry.ok,
    message: entry.ok ? "Quality analysis" : "Quality analysis failed",
    durationMs: entry.durationMs,
    input: entry.input,
    output: entry.output,
    error: entry.error,
    metadata: {
      model: entry.model,
      attempt: entry.attempt,
      ...(entry.usage ? { usage: entry.usage } : {}),
    },
  });
}

async function generate(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  schema: ReturnType<typeof geminiResponseSchema>,
  withThinkingOff: boolean
) {
  const gemini3 = isGemini3(model);
  return ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 65536,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      ...(gemini3
        ? withThinkingOff
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
          : {}
        : {
            temperature: 0.2,
            ...(withThinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          }),
    },
  });
}

export class GeminiTranslationQualityProvider implements TranslationQualityProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";

  async analyze(input: TranslationQualityInput): Promise<ProviderQualityResult> {
    const config = qualityConfig();
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    const codes = input.enabledCategories
      .filter((category) => category.categoryType === "ai")
      .map((category) => category.code);
    if (codes.length === 0) {
      throw new Error("No AI quality categories are enabled.");
    }

    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const prompt = buildTranslationQualityPrompt(input);
    const schema = geminiResponseSchema(codes);
    const call = async (attempt: number, withThinkingOff: boolean) => {
      const started = Date.now();
      try {
        const response = await generate(ai, config.geminiModel, prompt, schema, withThinkingOff);
        await logGeminiCall({
          model: config.geminiModel,
          ok: true,
          durationMs: Date.now() - started,
          attempt,
          usage: tokenUsage(response.usageMetadata),
          input: prompt,
          output: response.text ?? "",
        });
        return response;
      } catch (error) {
        const message = safeErrorMessage(error, config.geminiApiKey);
        await logGeminiCall({
          model: config.geminiModel,
          ok: false,
          durationMs: Date.now() - started,
          attempt,
          input: prompt,
          error: message,
        });
        throw new Error(message);
      }
    };

    let response;
    try {
      response = await call(1, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/thinking|invalid argument/i.test(message)) throw error;
      response = await call(2, false);
    }

    const text = response.text;
    if (!text?.trim()) {
      throw new Error("Gemini returned an empty quality analysis.");
    }
    const categories = validateGeminiPayload(parseModelJson(text), codes);
    const usage = tokenUsage(response.usageMetadata);
    return {
      providerId: this.id,
      model: config.geminiModel,
      categories,
      usage: usage
        ? {
            promptTokens: usage.promptTokens,
            outputTokens: usage.outputTokens,
          }
        : undefined,
    };
  }
}
