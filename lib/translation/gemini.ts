import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { writeServiceLog } from "@/lib/service-log";
import { qualityConfig } from "@/lib/translation-quality/config";
import type { SourceContentFields } from "@/lib/types";
import type {
  TranslateArticleInput,
  TranslateTextInput,
  TranslationProvider,
} from "@/lib/translation/service";

function isGemini3(model: string) {
  return /^gemini-3(?:[.-]|$)/i.test(model);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

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

function failureMessage(error: unknown, secret: string) {
  const raw = error instanceof Error && error.message ? error.message : "Translation failed.";
  const redacted = secret ? raw.split(secret).join("[redacted]") : raw;
  return redacted.slice(0, 240);
}

function plainReply(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html|text)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function tagNames(html: string) {
  return [...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((match) => match[1].toLowerCase()).join(",");
}

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "body", "seo_title", "seo_description"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    body: { type: "string" },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
  },
};

function articlePrompt(input: TranslateArticleInput) {
  const fields = input.fields;
  return [
    `Translate this article from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    "Return JSON with the keys title, summary, body, seo_title, and seo_description.",
    "Translate only the visible words. If a field is empty, return an empty string for that key.",
    "In body, keep every HTML tag, attribute, and URL unchanged. Do not add or remove tags.",
    "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
    "",
    `title:\n${fields.title}`,
    "",
    `summary:\n${fields.summary}`,
    "",
    `body:\n${fields.body}`,
    "",
    `seo_title:\n${fields.seo_title}`,
    "",
    `seo_description:\n${fields.seo_description}`,
  ].join("\n");
}

function articleFields(value: unknown, source: SourceContentFields): SourceContentFields {
  const text = typeof value === "string" ? plainReply(value) : "";
  let parsed: unknown = value;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = value;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini did not return the translated fields separately.");
  }
  const row = parsed as Record<string, unknown>;
  const field = (key: keyof SourceContentFields) => {
    if (!source[key].trim()) return "";
    const translated = row[key];
    if (typeof translated !== "string" || !translated.trim()) {
      throw new Error(`Gemini did not return a translation for ${key}.`);
    }
    return translated;
  };
  return {
    title: field("title"),
    summary: field("summary"),
    body: field("body"),
    seo_title: field("seo_title"),
    seo_description: field("seo_description"),
  };
}

function promptFor(input: TranslateTextInput) {
  return [
    "Translate this text. Return only the translation.",
    `From ${input.sourceLanguage} to ${input.targetLanguage}.`,
    "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
    "",
    input.text,
  ].join("\n");
}

async function generate(
  model: string,
  apiKey: string,
  prompt: string,
  withThinking: boolean,
  json: boolean
) {
  const ai = new GoogleGenAI({ apiKey });
  const gemini3 = isGemini3(model);
  return ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: json ? 16384 : 8192,
      ...(json
        ? { responseMimeType: "application/json", responseJsonSchema: ARTICLE_SCHEMA }
        : {}),
      ...(gemini3
        ? withThinking
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
          : {}
        : {
            temperature: 0.2,
            ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          }),
    },
  });
}

export class GeminiTranslationProvider implements TranslationProvider {
  readonly name = "gemini";

  async translateText(input: TranslateTextInput): Promise<string> {
    if (!input.text.trim()) return "";
    if (input.sourceLanguage.trim().toLowerCase() === input.targetLanguage.trim().toLowerCase()) {
      return input.text;
    }
    return this.request(promptFor(input), false);
  }

  async translateArticle(input: TranslateArticleInput): Promise<SourceContentFields> {
    const source = input.fields;
    if (
      input.sourceLanguage.trim().toLowerCase() === input.targetLanguage.trim().toLowerCase()
    ) {
      return source;
    }
    if (
      ![source.title, source.summary, source.body, source.seo_title, source.seo_description].some(
        (field) => field.trim()
      )
    ) {
      return source;
    }
    const output = await this.request(articlePrompt(input), true);
    const fields = articleFields(output, source);
    if (
      source.body.trim() &&
      /<[a-z!/?]/i.test(source.body) &&
      tagNames(source.body) !== tagNames(fields.body)
    ) {
      throw new Error("Gemini changed the HTML tags, so the translation was not saved.");
    }
    return fields;
  }

  private async request(prompt: string, json: boolean): Promise<string> {
    const config = qualityConfig();
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    const call = async (attempt: number, withThinking: boolean) => {
      const started = Date.now();
      try {
        const response = await generate(
          config.geminiModel,
          config.geminiApiKey,
          prompt,
          withThinking,
          json
        );
        const output = plainReply(response.text ?? "");
        if (!output) throw new Error("Gemini returned an empty translation.");
        const usage = tokenUsage(response.usageMetadata);
        await writeServiceLog({
          source: "gemini",
          ok: true,
          message: json ? "Article translation" : "Translation",
          durationMs: Date.now() - started,
          input: prompt,
          output,
          metadata: {
            model: config.geminiModel,
            attempt,
            purpose: "translation",
            ...(usage ? { usage } : {}),
          },
        });
        return output;
      } catch (error) {
        const message = failureMessage(error, config.geminiApiKey);
        await writeServiceLog({
          source: "gemini",
          ok: false,
          message: "Translation failed",
          durationMs: Date.now() - started,
          input: prompt,
          error: message,
          metadata: {
            model: config.geminiModel,
            attempt,
            purpose: "translation",
          },
        });
        throw new Error(message);
      }
    };

    try {
      return await call(1, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/thinking|invalid argument/i.test(message)) throw error;
      return call(2, false);
    }
  }
}

