import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { writeServiceLog } from "@/lib/service-log";
import { qualityConfig } from "@/lib/translation-quality/config";
import { languageCompatible } from "@/lib/translation-quality/text";
import type { BoilerplatePhrase } from "@/lib/translation-quality/types";
import { cleanSourceHtml } from "@/lib/translation/cleanup";
import type { SourceContentFields } from "@/lib/types";

const DRAFT_SCHEMA = {
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

export type DraftRequest = {
  prompt: string;
  language: string;
  contentType: string;
  market: string;
  boilerplate: BoilerplatePhrase[];
};

function isGemini3(model: string) {
  return /^gemini-3(?:[.-]|$)/i.test(model);
}

/** Standard passages written in the draft's language, offered for word-for-word use. */
function boilerplateLines(phrases: BoilerplatePhrase[], language: string) {
  const active = phrases.filter((phrase) => phrase.isActive);
  const exact = active.filter((phrase) => phrase.language.trim().toLowerCase() === language.trim().toLowerCase());
  const usable = exact.length > 0 ? exact : active.filter((phrase) => languageCompatible(phrase.language, language));
  if (usable.length === 0) return [];
  return [
    "",
    "Standard passages. If the article needs one, copy it word for word; do not reword it.",
    ...usable.map((phrase) => `- ${phrase.name}: ${phrase.phrase}`),
  ];
}

function promptFor(input: DraftRequest) {
  return [
    `Write a first draft of a ${input.contentType} for MR.DIY.`,
    `Write it in ${input.language}, for readers in ${input.market}.`,
    "Keep brand marks such as MR.DIY unchanged.",
    "Do not invent prices, dates, store addresses, quotes, statistics, or promotions. Where the brief does not give a fact the article needs, write a placeholder in square brackets such as [date] for an editor to fill.",
    "body is HTML using only <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, and <a href>. No <html>, <head>, styles, or scripts.",
    "summary is one or two plain sentences. seo_title is plain text under 60 characters. seo_description is plain text under 160 characters.",
    ...boilerplateLines(input.boilerplate, input.language),
    "",
    "Brief from the editor:",
    input.prompt,
  ].join("\n");
}

const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "a", "br"]);

/** Keep only the tags the editor understands; drop scripts, styles, and attributes other than href. */
function tidyBody(html: string) {
  const withoutBlocks = html.replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, "");
  const tags = withoutBlocks.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
    const lower = name.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";
    if (tag.startsWith("</")) return `</${lower}>`;
    if (lower === "a") {
      const href = attrs.match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? "";
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href}">` : "<a>";
    }
    return `<${lower}>`;
  });
  return cleanSourceHtml(tags.trim());
}

function plain(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]+>/g, "").trim() : "";
}

export async function draftArticle(input: DraftRequest): Promise<SourceContentFields> {
  const config = qualityConfig();
  if (!config.geminiApiKey) {
    throw new Error("Drafting with AI needs GEMINI_API_KEY.");
  }
  const prompt = promptFor(input);
  const started = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseJsonSchema: DRAFT_SCHEMA,
        ...(isGemini3(config.geminiModel)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : { temperature: 0.7 }),
      },
    });
    const text = (response.text ?? "").trim();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const fields: SourceContentFields = {
      title: plain(parsed.title),
      summary: plain(parsed.summary),
      body: tidyBody(typeof parsed.body === "string" ? parsed.body : ""),
      seo_title: plain(parsed.seo_title),
      seo_description: plain(parsed.seo_description),
    };
    if (!fields.title || !fields.body) throw new Error("The model returned an empty draft.");
    await writeServiceLog({
      source: "gemini",
      ok: true,
      message: "Drafted article",
      durationMs: Date.now() - started,
      input: prompt,
      output: text,
      metadata: { model: config.geminiModel, purpose: "drafting" },
    });
    return fields;
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Drafting failed.";
    const message = raw.split(config.geminiApiKey).join("[redacted]").slice(0, 240);
    await writeServiceLog({
      source: "gemini",
      ok: false,
      message: "Drafting article failed",
      durationMs: Date.now() - started,
      input: prompt,
      error: message,
      metadata: { model: config.geminiModel, purpose: "drafting" },
    });
    throw new Error(message);
  }
}
