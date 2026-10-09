import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { writeServiceLog } from "@/lib/service-log";
import { qualityConfig } from "@/lib/translation-quality/config";
import { listActiveBoilerplate, listActiveTerminology } from "@/lib/translation-quality/repository";
import { htmlToText } from "@/lib/translation-quality/text";
import type { BoilerplatePhrase, TerminologyEntry } from "@/lib/translation-quality/types";
import { glossaryPrompt } from "@/lib/translation/glossary";
import { markSegments, unmarkSegment, type MarkedSegment } from "@/lib/translation/segments";
import { keepWordGaps, textNodes, type TextNode } from "@/lib/translation/spacing";
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

type Glossary = { terminology: TerminologyEntry[]; boilerplate: BoilerplatePhrase[] };

/** Paragraphs per request: few enough that one bad reply costs little to redo. */
function segmentBatches(segments: MarkedSegment[]) {
  const batches: MarkedSegment[][] = [];
  let current: MarkedSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    if (current.length > 0 && (current.length >= 6 || size + segment.marked.length > 5000)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segment.marked.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** The visible text from the first to the last run in a batch, tags removed. */
function sourceRun(parts: string[], batch: TextNode[]) {
  const first = batch[0]?.index ?? 0;
  const last = batch[batch.length - 1]?.index ?? first;
  return htmlToText(parts.slice(first, last + 1).join(""));
}

function glossaryFor(
  glossary: Glossary,
  input: { sourceLanguage: string; targetLanguage: string },
  sourceText: string
) {
  return glossaryPrompt({ ...glossary, ...input, sourceText });
}

function articlePrompt(input: TranslateArticleInput, glossary: Glossary, sourceText: string) {
  const fields = input.fields;
  return [
    `Translate this article from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    "Return JSON with the keys title, summary, body, seo_title, and seo_description.",
    "Translate only the visible words. If a field is empty, return an empty string for that key.",
    "In body, keep every HTML tag, attribute, and URL unchanged. Do not add or remove tags.",
    "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
    ...glossaryFor(glossary, input, sourceText),
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

function promptFor(input: TranslateTextInput, glossary: Glossary) {
  return [
    "Translate this text. Return only the translation.",
    `From ${input.sourceLanguage} to ${input.targetLanguage}.`,
    "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
    ...glossaryFor(glossary, input, input.text),
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
  private glossary: Promise<Glossary> | null = null;

  /** Loaded once per request. Translation still runs if the glossary tables cannot be read. */
  private loadGlossary(): Promise<Glossary> {
    this.glossary ??= Promise.all([listActiveTerminology(), listActiveBoilerplate()])
      .then(([terminology, boilerplate]) => ({ terminology, boilerplate }))
      .catch(() => ({ terminology: [], boilerplate: [] }));
    return this.glossary;
  }

  async translateText(input: TranslateTextInput): Promise<string> {
    if (!input.text.trim()) return "";
    if (input.sourceLanguage.trim().toLowerCase() === input.targetLanguage.trim().toLowerCase()) {
      return input.text;
    }
    return this.request(promptFor(input, await this.loadGlossary()), false);
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
    const glossary = await this.loadGlossary();
    // The glossary covers the whole article, so a body split into parts uses the same terms.
    const sourceText = [source.title, source.summary, source.body, source.seo_title, source.seo_description].join("\n");
    const output = await this.request(
      articlePrompt({ ...input, fields: promptFields }, glossary, sourceText),
      true
    );
    const fields = articleFields(output, promptFields);
    if (htmlBody) fields.body = await this.translateBodyParts(source.body, input);
    return fields;
  }

  /**
   * Translate the body one paragraph at a time with its inline tags kept, so word order can
   * follow the target language. A paragraph whose tags do not come back intact is translated
   * run by run instead, which keeps the formatting but not the reordering.
   */
  private async translateBodyParts(html: string, input: TranslateArticleInput): Promise<string> {
    const parts = html.split(/(<[^>]+>)/g);
    const segments = markSegments(parts);
    if (segments.length === 0) return html;

    const results: Array<string | null> = [];
    for (const batch of segmentBatches(segments)) {
      results.push(...(await this.translateSegments(batch, input)));
    }

    const next = [...parts];
    for (const [index, segment] of segments.entries()) {
      const translated = results[index];
      if (translated !== null && translated !== undefined) {
        next[segment.start] = `${segment.leading}${translated}${segment.trailing}`;
        for (let at = segment.start + 1; at < segment.end; at += 1) next[at] = "";
        continue;
      }
      const nodes = textNodes(parts, (core) => /[\p{L}\p{N}]/u.test(core)).filter(
        (node) => node.index >= segment.start && node.index < segment.end
      );
      const values: string[] = [];
      for (let at = 0; at < nodes.length; at += 8) {
        const batch = nodes.slice(at, at + 8);
        values.push(
          ...(await this.translateCores(
            batch.map((node) => node.core),
            input,
            sourceRun(parts, batch)
          ))
        );
      }
      const spaced = keepWordGaps(
        parts,
        nodes,
        nodes.map((node, at) => (values[at]?.trim() ? values[at] : node.core))
      );
      nodes.forEach((node, at) => {
        next[node.index] = `${node.leading}${spaced[at]}${node.trailing}`;
      });
    }
    return next.join("");
  }

  /** One request per batch of paragraphs. Null marks a paragraph whose markers did not survive. */
  private async translateSegments(
    segments: MarkedSegment[],
    input: TranslateArticleInput
  ): Promise<Array<string | null>> {
    if (segments.length === 0) return [];
    const glossary = await this.loadGlossary();
    let output = "";
    try {
      output = await this.request(
        [
          `Translate each part from ${input.sourceLanguage} to ${input.targetLanguage}.`,
          `Return JSON {"parts":[...]} with exactly ${segments.length} strings, in the same order.`,
          "Each part is one paragraph, heading, or list item of an article.",
          "Write natural, fluent text with the word order a native speaker would use. Do not keep the source word order when the target language orders words differently, for example a noun before the brand that describes it.",
          "Markers such as <t1>…</t1> stand for bold, italic, and links. <t2/> stands for a line break.",
          "Keep every marker exactly once. A marker pair must wrap the translation of the same words it wraps in the source, and it moves with those words.",
          "Do not add HTML tags or new markers.",
          "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
          ...glossaryFor(glossary, input, segments.map((segment) => segment.plain).join("\n")),
          "",
          "Parts:",
          ...segments.map((segment, index) => `${index}: ${segment.marked}`),
        ].join("\n"),
        true,
        PARTS_SCHEMA
      );
    } catch (error) {
      if (segments.length === 1) return [null];
      throw error;
    }
    const translated = parsePartList(output);
    if (!translated || translated.length !== segments.length) {
      if (segments.length === 1) return [null];
      const mid = Math.ceil(segments.length / 2);
      return [
        ...(await this.translateSegments(segments.slice(0, mid), input)),
        ...(await this.translateSegments(segments.slice(mid), input)),
      ];
    }
    const results: Array<string | null> = [];
    for (const [index, segment] of segments.entries()) {
      const restored = unmarkSegment(segment, translated[index]);
      // In a batch, give a paragraph with broken markers one retry on its own.
      results.push(
        restored ?? (segments.length > 1 ? (await this.translateSegments([segment], input))[0] : null)
      );
    }
    return results;
  }

  private async translateCores(
    cores: string[],
    input: TranslateArticleInput,
    context: string
  ): Promise<string[]> {
    if (cores.length === 0) return [];
    if (cores.length === 1) {
      const text = await this.translateText({
        text: cores[0],
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });
      return [text.trim() ? text : cores[0]];
    }

    const glossary = await this.loadGlossary();
    const output = await this.request(
      [
        `Translate each part from ${input.sourceLanguage} to ${input.targetLanguage}.`,
        `Return JSON {"parts":[...]} with exactly ${cores.length} strings, in the same order.`,
        "Do not add HTML tags.",
        "Keep brand marks such as MR.DIY, numbers, and web addresses unchanged.",
        "The parts are consecutive pieces of one passage, split where bold, italic, or a link starts or ends.",
        "A part can start or end in the middle of a sentence. Translate each part so the parts read correctly when joined in order.",
        "Do not merge parts or leave a part empty.",
        ...glossaryFor(glossary, input, context),
        "",
        "The whole passage, for context:",
        context,
        "",
        "Parts:",
        ...cores.map((core, index) => `${index}: ${core}`),
      ].join("\n"),
      true,
      PARTS_SCHEMA
    );
    const translated = parsePartList(output);
    if (!translated || translated.length !== cores.length) {
      const mid = Math.ceil(cores.length / 2);
      return [
        ...(await this.translateCores(cores.slice(0, mid), input, context)),
        ...(await this.translateCores(cores.slice(mid), input, context)),
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

