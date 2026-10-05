import type { SourceContentFields } from "@/lib/types";

export type TranslateTextInput = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type TranslateArticleInput = {
  fields: SourceContentFields;
  sourceLanguage: string;
  targetLanguage: string;
};

export interface TranslationProvider {
  readonly name: string;
  translateText(input: TranslateTextInput): Promise<string>;
  translateArticle(input: TranslateArticleInput): Promise<SourceContentFields>;
}

/**
 * Translate only text between HTML tags; leave markup/attributes intact.
 */
export async function translateHtmlPreservingMarkup(
  html: string,
  translatePlain: (text: string) => Promise<string>
): Promise<string> {
  if (!html.trim()) return "";
  // If it doesn't look like HTML, translate as plain text.
  if (!/<[a-z!/?]/i.test(html)) {
    return translatePlain(html);
  }

  const parts = html.split(/(<[^>]+>)/g);
  const out: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("<")) {
      out.push(part);
      continue;
    }

    const leading = part.match(/^\s*/)?.[0] ?? "";
    const trailing = part.match(/\s*$/)?.[0] ?? "";
    const core = part.slice(leading.length, part.length - trailing.length);
    if (!core) {
      out.push(part);
      continue;
    }

    // Skip translating pure entities / punctuation-only crumbs.
    if (!/[A-Za-z0-9\u00C0-\u024F]/.test(core)) {
      out.push(part);
      continue;
    }

    try {
      const translated = await translatePlain(core);
      out.push(`${leading}${translated || core}${trailing}`);
    } catch {
      out.push(part);
    }
  }

  const result = out.join("");
  // Guard: never return empty if source had visible text.
  if (!result.replace(/<[^>]+>/g, "").trim() && html.replace(/<[^>]+>/g, "").trim()) {
    return translatePlain(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return result;
}

/** Deterministic demo provider — works offline without an API key. */
export class MockTranslationProvider implements TranslationProvider {
  readonly name = "mock";

  async translateText(input: TranslateTextInput): Promise<string> {
    if (!input.text.trim()) return "";
    return `[${input.targetLanguage}] ${input.text}`;
  }

  async translateArticle(
    input: TranslateArticleInput
  ): Promise<SourceContentFields> {
    const translate = async (text: string) =>
      this.translateText({
        text,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });

    return {
      title: await translate(input.fields.title),
      summary: await translate(input.fields.summary),
      body: await translateHtmlPreservingMarkup(input.fields.body, translate),
      seo_title: await translate(input.fields.seo_title),
      seo_description: await translate(input.fields.seo_description),
    };
  }
}

/**
 * MyMemory free translation API (no key required for light use).
 * Falls back to mock-style prefixing if the request fails.
 */
export class MyMemoryTranslationProvider implements TranslationProvider {
  readonly name = "mymemory";

  async translateText(input: TranslateTextInput): Promise<string> {
    if (!input.text.trim()) return "";
    const source = normalizeLang(input.sourceLanguage);
    const target = normalizeLang(input.targetLanguage);
    if (source === target) return input.text;

    try {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", input.text.slice(0, 450));
      url.searchParams.set("langpair", `${source}|${target}`);
      const res = await fetch(url.toString(), { next: { revalidate: 0 } });
      if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
      const data = (await res.json()) as {
        responseData?: { translatedText?: string };
      };
      const translated = data.responseData?.translatedText?.trim();
      if (!translated) throw new Error("Empty translation");
      if (input.text.length > 450) {
        return `${translated} […]`;
      }
      return translated;
    } catch {
      return `[${input.targetLanguage}] ${input.text}`;
    }
  }

  async translateArticle(
    input: TranslateArticleInput
  ): Promise<SourceContentFields> {
    const translate = async (text: string) =>
      this.translateText({
        text,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });

    return {
      title: await translate(input.fields.title),
      summary: await translate(input.fields.summary),
      body: await translateHtmlPreservingMarkup(input.fields.body, translate),
      seo_title: await translate(input.fields.seo_title),
      seo_description: await translate(input.fields.seo_description),
    };
  }
}

function normalizeLang(code: string): string {
  const key = code.trim().toLowerCase();
  const map: Record<string, string> = {
    "zh-hans": "zh-CN",
    "zh-hant": "zh-TW",
    en: "en",
    ms: "ms",
    th: "th",
    id: "id",
  };
  return map[key] ?? key.split("-")[0] ?? key;
}

export class TranslationService {
  constructor(private readonly provider: TranslationProvider) {}

  get providerName() {
    return this.provider.name;
  }

  translateText(input: TranslateTextInput) {
    return this.provider.translateText(input);
  }

  translateArticle(input: TranslateArticleInput) {
    return this.provider.translateArticle(input);
  }
}

export function getTranslationService(): TranslationService {
  const providerName = process.env.TRANSLATION_PROVIDER ?? "mymemory";
  const provider =
    providerName === "mock"
      ? new MockTranslationProvider()
      : new MyMemoryTranslationProvider();
  return new TranslationService(provider);
}
