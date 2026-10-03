export type EntityStatus = "ACTIVE" | "INACTIVE";

export type ApplicationModelType = "STRING" | "CONTENT";

export type TranslationStatus =
  | "MISSING"
  | "SYSTEM_GENERATED"
  | "MANUALLY_MODIFIED"
  | "APPROVED";

export type ContentType = "ARTICLE" | "NEWS" | "ANNOUNCEMENT";

export type ContentLifecycleStatus =
  | "DRAFT"
  | "TRANSLATING"
  | "REVIEW"
  | "APPROVED"
  | "PUBLISHED";

export type SourceType = "SYSTEM" | "MANUAL" | "IMPORT";

export type Language = {
  id: string;
  code: string;
  name: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type Application = {
  id: string;
  name: string;
  description: string;
  status: EntityStatus;
  model_type: ApplicationModelType;
  created_at: string;
  updated_at: string;
};

export type Namespace = {
  id: string;
  application_id: string;
  name: string;
  description: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type TranslationKey = {
  id: string;
  application_id: string;
  namespace_id: string;
  key: string;
  source_language: string;
  source_text: string;
  created_at: string;
  updated_at: string;
};

export type Translation = {
  id: string;
  translation_key_id: string;
  language_code: string;
  current_text: string;
  status: TranslationStatus;
  approved_by_username: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TranslationVersion = {
  id: string;
  translation_id: string;
  version_number: number;
  translated_content: string;
  source_type: SourceType;
  author: string | null;
  author_username: string | null;
  modifier: string | null;
  created_by: string | null;
  modified_by: string | null;
  created_at: string;
};

export type SourceContentFields = {
  title: string;
  summary: string;
  body: string;
  seo_title: string;
  seo_description: string;
};

export type Content = {
  id: string;
  application_id: string;
  content_type: ContentType;
  title: string;
  slug: string | null;
  source_language: string;
  source_content: SourceContentFields;
  status: ContentLifecycleStatus;
  target_languages: string[];
  scheduled_publish_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentTranslation = {
  id: string;
  content_id: string;
  language_code: string;
  title: string;
  summary: string;
  body: string;
  seo_title: string;
  seo_description: string;
  status: TranslationStatus;
  approved_by_username: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArticleComment = {
  id: string;
  content_id: string;
  language_code: string | null;
  body: string;
  author_username: string;
  author_name: string;
  created_at: string;
};

export type ContentTranslationVersion = {
  id: string;
  content_translation_id: string;
  version_number: number;
  translated_content: SourceContentFields;
  source_type: SourceType;
  author: string | null;
  author_username: string | null;
  modifier: string | null;
  created_by: string | null;
  modified_by: string | null;
  created_at: string;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const PAGE_SIZE = 50;

export function emptySourceContent(): SourceContentFields {
  return {
    title: "",
    summary: "",
    body: "",
    seo_title: "",
    seo_description: "",
  };
}

export function sourceTypeAuthor(sourceType: SourceType): string {
  switch (sourceType) {
    case "SYSTEM":
      return "System";
    case "MANUAL":
      return "Manual";
    case "IMPORT":
      return "Import";
  }
}
