export type ArticleField =
  | "title"
  | "summary"
  | "html"
  | "seoTitle"
  | "seoDescription"
  | "slug"
  | "languageCode";

export type IntegrationCredential = {
  key: string;
  label: string;
  input: "text" | "secret" | "url";
  required: boolean;
  help?: string;
};

/** Provider payload key for one Lingo article field. Defined by the integration class. */
export type FieldMapping = {
  from: ArticleField;
  to: string;
};

export type PublishTranslation = {
  languageCode: string;
  title: string;
  summary: string;
  html: string;
  seoTitle: string;
  seoDescription: string;
};

export type PublishArticle = {
  deliveryId: string;
  id: string;
  title: string;
  summary: string;
  html: string;
  seoTitle: string;
  seoDescription: string;
  slug: string | null;
  languageCode: string;
  market: string | null;
  contentType: string;
  translations: PublishTranslation[];
};

export type PublishIntegrationType = {
  code: string;
  name: string;
  description: string;
  credentials: IntegrationCredential[];
  mapping: FieldMapping[];
};

const ARTICLE_VALUES: Record<ArticleField, (article: PublishArticle) => string> = {
  title: (article) => article.title,
  summary: (article) => article.summary,
  html: (article) => article.html,
  seoTitle: (article) => article.seoTitle,
  seoDescription: (article) => article.seoDescription,
  slug: (article) => article.slug ?? "",
  languageCode: (article) => article.languageCode,
};

export abstract class PublishIntegration {
  abstract readonly code: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly credentials: IntegrationCredential[];
  abstract readonly mapping: FieldMapping[];

  abstract publish(input: {
    config: Record<string, string>;
    article: PublishArticle;
  }): Promise<{ externalUrl: string | null }>;

  describe(): PublishIntegrationType {
    return {
      code: this.code,
      name: this.name,
      description: this.description,
      credentials: this.credentials,
      mapping: this.mapping,
    };
  }

  /** Builds the provider body from this type's field map. */
  protected applyMapping(article: PublishArticle): Record<string, string> {
    const body: Record<string, string> = {};
    for (const field of this.mapping) {
      body[field.to] = ARTICLE_VALUES[field.from](article);
    }
    return body;
  }

  validateConfig(
    input: Record<string, string>,
    previous: Record<string, string> = {}
  ): Record<string, string> {
    const next: Record<string, string> = {};
    for (const field of this.credentials) {
      const typed = (input[field.key] ?? "").trim();
      const value = field.input === "secret" && !typed ? (previous[field.key] ?? "").trim() : typed;
      if (field.required && !value) throw new Error(`${field.label} is required.`);
      if (value.length > 2000) throw new Error(`${field.label} is too long.`);
      if (field.input === "url" && value) next[field.key] = requireHttpUrl(value, field.label);
      else next[field.key] = value;
    }
    return next;
  }
}

function requireHttpUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a full http or https URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://.`);
  }
  if (url.username || url.password) {
    throw new Error(`Put authentication in this type's credential fields, not in ${label}.`);
  }
  return url.toString();
}

export function readConfig(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const config: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") config[key] = item;
  }
  return config;
}
