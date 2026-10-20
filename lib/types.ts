import type { AppRole, OrgRoleBand } from "@/lib/auth/roles";
import type { PermissionKey } from "@/lib/auth/permissions";

export type { AppRole, OrgRoleBand, PermissionKey };

export type OrgRoleMapping = {
  id: string;
  ldap_role: string;
  band: OrgRoleBand;
};

/** A role, such as Translator or Reviewer. Each application keeps its own. */
export type AccessRole = {
  id: string;
  name: string;
  description: string;
  /** The application this role belongs to. Null for a default role copied into new applications. */
  applicationId: string | null;
  permissions: PermissionKey[];
};

export type EntityStatus = "ACTIVE" | "INACTIVE";

export type ApplicationModelType = "STRING" | "CONTENT" | "CATALOG";

export type TranslationStatus =
  | "MISSING"
  | "SYSTEM_GENERATED"
  | "MANUALLY_MODIFIED"
  | "APPROVED";

/**
 * Status after a manual save. Saving never approves; an approver keeps an existing
 * approval, anyone else's edit needs approving again. Approve is a separate step.
 */
export function manualSaveStatus(
  approver: boolean,
  current: TranslationStatus | null | undefined
): TranslationStatus {
  return approver && current === "APPROVED" ? "APPROVED" : "MANUALLY_MODIFIED";
}

/** Stable code defined per application in content_types. */
export type ContentType = string;

export type ContentTypeRecord = {
  id: string;
  application_id: string;
  code: string;
  name: string;
  description: string;
  /** Tone code articles of this type use unless they choose their own. Missing before migration 034. */
  default_tone?: string | null;
  status: EntityStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** How a translation should read, such as Formal, Press, or Social. */
export type ToneProfile = {
  id: string;
  application_id: string;
  code: string;
  name: string;
  instructions: string;
  /** Language code -> extra guidance for that language. */
  language_notes: Record<string, string>;
  /** Machine translation may reword and restructure instead of following the source closely. */
  allow_adaptation: boolean;
  status: EntityStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ContentLifecycleStatus =
  | "DRAFT"
  /** Retired: nothing sets it now. Kept so old activity history still reads. */
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
  /** Email approvers when an article enters review. Missing before migration 020. */
  notify_review_email?: boolean;
  /** CATALOG only: what one record is called, such as SKU. Missing before migration 024. */
  item_label?: string | null;
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
  /** Job title on the account, such as Executive. Shown only; it grants nothing once roles are set up. */
  ldap_role: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppAccess = {
  is_owner: boolean;
  /** Name of the member's role, such as Reviewer. Null for the owner and for a superadmin. */
  role: string | null;
  /** Every permission this person holds here. The flags below are shorthands. */
  permissions: PermissionKey[];
  /** content.edit */
  can_edit: boolean;
  /** content.approve */
  can_approve: boolean;
  /** people.manage */
  can_manage: boolean;
  /**
   * Article markets from the member's business units. Null means every market (owner,
   * superadmin, or before migration 032). Empty means no articles. Articles only.
   */
  markets: string[] | null;
  /** Names of the member's business units, for display. Empty for owners and superadmins. */
  unit_names: string[];
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
  /** False until their first sign-in, from Joget or with a password. */
  signedIn: boolean;
  /** Whether they can also sign in with email and password, besides Joget. */
  hasPassword: boolean;
  accessRoleId: string | null;
  role: string | null;
  canEdit: boolean;
  canApprove: boolean;
  canManage: boolean;
  /** Business units they are in. Null where units do not apply: the owner, non-article apps, before migration 032. */
  businessUnitIds: string[] | null;
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
  /** Tone code chosen for this article. Null uses the article type's default. */
  tone?: string | null;
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
  /** Tone the machine translation was made with. */
  tone?: string | null;
  /** Machine translation was allowed to reword, so it will not match the source line by line. */
  adapted?: boolean;
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

export type ContentAuditEventKind =
  | "CREATED"
  | "STATUS_CHANGED"
  | "EDITED"
  | "TRANSLATION_SAVED"
  | "TRANSLATION_APPROVED"
  | "TRANSLATION_UNAPPROVED"
  | "DELETED";

export type ContentAuditEvent = {
  id: string;
  content_id: string;
  application_id: string;
  content_title: string;
  event: ContentAuditEventKind;
  language_code: string | null;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  actor_username: string | null;
  /** "System" for scheduled runs with no signed-in person. */
  actor_name: string;
  actor_user_id: string | null;
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

export type CatalogFieldType = "text" | "long_text" | "code" | "file" | "image";

export type CatalogField = {
  id: string;
  application_id: string;
  code: string;
  label: string;
  field_type: CatalogFieldType;
  /** Off for codes and shared files: the source value is used in every language. */
  translatable: boolean;
  required: boolean;
  sort_order: number;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type ItemStatus = "DRAFT" | "REVIEW" | "CHANGES_REQUESTED" | "APPROVED";

export type CatalogItem = {
  id: string;
  application_id: string;
  item_code: string;
  name: string;
  source_language: string;
  target_languages: string[];
  status: ItemStatus;
  created_by_name: string | null;
  created_by_username: string | null;
  submitted_by_name: string | null;
  submitted_by_username: string | null;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_by_username: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

/** MEMORY: copied from an approved translation of the same source text. */
export type CatalogValueSource = SourceType | "MEMORY";

export type CatalogValue = {
  id: string;
  item_id: string;
  field_id: string;
  language_code: string;
  text_value: string;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  /** Source row: hash of its text. Target row: hash of the source it was written from. */
  source_hash: string | null;
  status: TranslationStatus;
  source_type: CatalogValueSource;
  approved_by_username: string | null;
  approved_by_name: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogEventKind =
  | "CREATED"
  | "EDITED"
  | "TRANSLATED"
  | "SUBMITTED"
  | "LANGUAGE_APPROVED"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REOPENED"
  | "DELETED";

export type CatalogEvent = {
  id: string;
  item_id: string;
  application_id: string;
  item_code: string;
  event: CatalogEventKind;
  language_code: string | null;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  detail: Record<string, unknown>;
  actor_name: string;
  actor_username: string | null;
  actor_user_id: string | null;
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
