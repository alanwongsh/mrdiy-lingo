import * as XLSX from "xlsx";
import type { SourceContentFields } from "@/lib/types";

const SOURCE_COLUMNS = [
  "title",
  "source_language",
  "content_type",
  "status",
  "summary",
  "body",
  "seo_title",
  "seo_description",
] as const;

const TRANSLATION_FIELDS = [
  "title",
  "summary",
  "body",
  "seo_title",
  "seo_description",
] as const satisfies readonly (keyof SourceContentFields)[];

export type ArticleExportRow = {
  title: string;
  source_language: string;
  content_type: string;
  status: string;
  source_content: SourceContentFields;
  target_languages: string[];
  translations: Array<
    {
      language_code: string;
    } & SourceContentFields
  >;
};

function languageColumns(articles: ArticleExportRow[]): string[] {
  const codes = new Set<string>();
  for (const article of articles) {
    for (const code of article.target_languages) {
      if (code && code !== article.source_language) codes.add(code);
    }
    for (const translation of article.translations) {
      if (translation.language_code !== article.source_language) {
        codes.add(translation.language_code);
      }
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

export function buildArticleWorkbook(articles: ArticleExportRow[]): {
  base64: string;
  columns: string[];
} {
  const langs = languageColumns(articles);
  const columns = [
    ...SOURCE_COLUMNS,
    ...langs.flatMap((code) =>
      TRANSLATION_FIELDS.map((field) => `${code}_${field}`)
    ),
  ];

  const rows = articles.map((article) => {
    const source = article.source_content;
    const record: Record<string, string> = {
      title: article.title,
      source_language: article.source_language,
      content_type: article.content_type,
      status: article.status,
      summary: source.summary ?? "",
      body: source.body ?? "",
      seo_title: source.seo_title ?? "",
      seo_description: source.seo_description ?? "",
    };
    const byLang = new Map(
      article.translations.map((translation) => [
        translation.language_code,
        translation,
      ])
    );
    for (const code of langs) {
      const translation = byLang.get(code);
      for (const field of TRANSLATION_FIELDS) {
        record[`${code}_${field}`] = translation?.[field] ?? "";
      }
    }
    return record;
  });

  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Articles");
  const base64 = XLSX.write(book, { type: "base64", bookType: "xlsx" }) as string;
  return { base64, columns };
}
