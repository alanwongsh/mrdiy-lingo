import type { AppRole, OrgRoleBand } from "@/lib/auth/roles";

export type { AppRole, OrgRoleBand };

export type OrgRoleMapping = {
  id: string;
  ldap_role: string;
  band: OrgRoleBand;
};

export type EntityStatus = "ACTIVE" | "INACTIVE";

export type ApplicationModelType = "STRING" | "CONTENT";

export type TranslationStatus =
  | "MISSING"
  | "SYSTEM_GENERATED"
  | "MANUALLY_MODIFIED"
  | "APPROVED";

/** Stable code defined per application in content_types. */
export type ContentType = string;

export type ContentTypeRecord = {
  id: string;
  application_id: string;
  code: string;
  name: string;
  description: string;
  status: EntityStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ContentLifecycleStatus =
  | "DRAFT"
  | "TRANSLATING"
  | "REVIEW"
  | "APPROVED"
  /** Live in some ticked languages and still waiting in others. */
  | "PUBLISHING"
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
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type HubUser = {
  id: string;
  username: string | null;
  employee_id: string | null;
  email: string | null;
  display_name: string;
  is_superadmin: boolean;
  /** Role stored on the account, such as Executive or HOD. Grouped by org_role_map. */
  ldap_role: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppAccess = {
  is_owner: boolean;
  /** Resolved permission group. Null for the owner and for a superadmin. */
  role: AppRole | null;
  can_edit: boolean;
  can_approve: boolean;
  can_manage: boolean;
};

export type VisibleApplication = Application & {
  access: AppAccess;
};

export type ApplicationMemberView = {
  membershipId: string;
  userId: string;
  displayName: string;
  detail: string;
  ldapRole: string | null;
  role: AppRole | null;
  canEdit: boolean;
  canApprove: boolean;
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
  approved_by_user_id: string | null;
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
  author_user_id: string | null;
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
  market: string | null;
  submitted_by_name: string | null;
  submitted_by_username: string | null;
  status: ContentLifecycleStatus;
  target_languages: string[];
  /** Default publish time for languages without their own. */
  scheduled_publish_at: string | null;
  /** Language key -> ISO publish time. Overrides scheduled_publish_at for that language. */
  language_publish_at: Record<string, string>;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishVendor = {
  id: string;
  application_id: string;
  name: string;
  type_code: string;
  /** Non-secret credentials. Secret values are omitted. */
  config: Record<string, string>;
  /** Secret credential keys that already have a stored value. */
  saved_secrets: string[];
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type PublishVendorChoice = {
  id: string;
  name: string;
  status: EntityStatus;
};

/** One article language sent to one provider. */
export type PublishLanguageTarget = {
  language_code: string;
  vendor_id: string;
};

export type PublicationStatus = "PENDING" | "PUBLISHED" | "FAILED";

export type ContentPublication = {
  id: string;
  content_id: string;
  vendor_id: string;
  vendor_name: string;
  language_code: string;
  status: PublicationStatus;
  external_url: string | null;
  error_message: string | null;
  published_at: string | null;
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
  approved_by_user_id: string | null;
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
  author_user_id: string | null;
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
  author_user_id: string | null;
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
