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

const PARTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: { type: "array", items: { type: "string" } },
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

function parsePartList(output: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plainReply(output));
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { parts?: unknown }).parts)
      ? (parsed as { parts: unknown[] }).parts
      : null;
  if (!list) return null;
  const strings = list.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      if (typeof row.text === "string") return row.text;
      if (typeof row.translation === "string") return row.translation;
    }
    return null;
  });
  return strings.every((item) => item !== null) ? strings : null;
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
  json: boolean,
  schema: Record<string, unknown> = ARTICLE_SCHEMA
) {
  const ai = new GoogleGenAI({ apiKey });
  const gemini3 = isGemini3(model);
  return ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: json ? 16384 : 8192,
      ...(json ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}),
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
    const htmlBody = /<[a-z!/?]/i.test(source.body);
    const promptFields = htmlBody ? { ...source, body: "" } : source;
    const output = await this.request(articlePrompt({ ...input, fields: promptFields }), true);
    const fields = articleFields(output, promptFields);
    if (htmlBody) fields.body = await this.translateBodyParts(source.body, input);
    return fields;
  }

  /** Translate the words between tags and put the original tags back. */
  private async translateBodyParts(html: string, input: TranslateArticleInput): Promise<string> {
    const parts = html.split(/(<[^>]+>)/g);
    const nodes: { index: number; leading: string; core: string; trailing: string }[] = [];
    parts.forEach((part, index) => {
      if (!part || part.startsWith("<")) return;
      const leading = part.match(/^\s*/)?.[0] ?? "";
      const trailing = part.match(/\s*$/)?.[0] ?? "";
      const core = part.slice(leading.length, part.length - trailing.length);
      if (!core || !/[\p{L}\p{N}]/u.test(core)) return;
      nodes.push({ index, leading, core, trailing });
    });
    if (nodes.length === 0) return html;

    const translated: string[] = [];
    for (let index = 0; index < nodes.length; index += 8) {
      translated.push(
        ...(await this.translateCores(
          nodes.slice(index, index + 8).map((node) => node.core),
          input
        ))
      );
    }
    const next = [...parts];
    nodes.forEach((node, index) => {
      const value = translated[index]?.trim() ? translated[index] : node.core;
      next[node.index] = `${node.leading}${value}${node.trailing}`;
    });
    return next.join("");
  }

  private async translateCores(cores: string[], input: TranslateArticleInput): Promise<string[]> {
    if (cores.length === 0) return [];
    if (cores.length === 1) {
      const text = await this.translateText({
        text: cores[0],
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });
      return [text.trim() ? text : cores[0]];
    }

    const output = await this.request(
      [
        `Translate each part from ${input.sourceLanguage} to ${input.targetLanguage}.`,
        `Return JSON {"parts":[...]} with exactly ${cores.length} strings, in the same order.`,
        "Do not add HTML tags.",
        "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
        "",
        ...cores.map((core, index) => `${index}: ${core}`),
      ].join("\n"),
      true,
      PARTS_SCHEMA
    );
    const translated = parsePartList(output);
    if (!translated || translated.length !== cores.length) {
      const mid = Math.ceil(cores.length / 2);
      return [
        ...(await this.translateCores(cores.slice(0, mid), input)),
        ...(await this.translateCores(cores.slice(mid), input)),
      ];
    }
    return translated.map((value, index) => (value.trim() ? value : cores[index]));
  }

  private async request(
    prompt: string,
    json: boolean,
    schema: Record<string, unknown> = ARTICLE_SCHEMA
  ): Promise<string> {
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
          json,
          schema
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

