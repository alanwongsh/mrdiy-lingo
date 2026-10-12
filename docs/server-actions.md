# Server Actions reference

Most reads and writes in Lingo go through Next.js Server Actions in `lib/actions/` (`"use server"`). They are called from React components as plain async functions. Next.js sends them as `POST` requests to the current page, keyed by a per-build action ID in the `Next-Action` header, so they have no stable URL and are not in the OpenAPI spec. The few real HTTP routes are documented in [openapi.yaml](openapi.yaml).

Every exported function here can be called by any signed-in browser with any arguments, so each one must do its own permission check. That check is listed for every function below.

## Permission model

Defined in `lib/auth/access.ts`.

| Guard | Passes when |
|---|---|
| `requireUser()` | There is a signed-in actor (the `lingo_actor` cookie). Creates the `hub_users` row on first use. |
| `requireSuperadmin()` | The user is a Lingo superadmin. Superadmins are set from an env allow-list on every sign-in. |
| `requireAppCapability(appId, cap)` | The user has `cap` on the application. |
| `requireContentAccess(contentId, cap)` | Looks up the article's application, then `requireAppCapability`. The same pattern applies to `requireContentTranslationAccess`, `requireContentVersionAccess`, `requireTranslationKeyAccess`, `requireTranslationAccess`, `requireTranslationVersionAccess` and `requireNamespaceAccess`. |
| `allowAppCapability(appId, cap)` | Same check, but returns a boolean instead of throwing. |

Capabilities: `view` < `edit` < `approve` < `manage`.

- **Superadmin or app owner:** every capability, including `manage`.
- **Member** (`application_members` row): `view`. Their role band adds `edit` (EDITOR) or `edit` + `approve` (HOD). The band comes from `org_role_map` matched on the user's `ldap_role` when that table exists, otherwise from the membership row. `ADMIN` is treated as `HOD`.
- Members never get `manage`.
- `capabilityForReleaseStatus(status)` returns `approve` for APPROVED, PUBLISHING and PUBLISHED, and `edit` for everything else.

Guards throw `Error` with a user-facing message, such as "Sign in to continue." or "This is limited to a Lingo superadmin.". Unless noted, actions let errors throw. Some return `{ error }` instead, and those are marked.

---

## Applications: `lib/actions/applications.ts`

### `listApplications(opts?)`
Lists the applications the user can see, sorted by name.
- **Input:** `{ includeInactive?: boolean; editableOnly?: boolean }`
- **Permission:** `requireUser()`. Superadmins see every application; everyone else sees applications they own or are a member of.
- **Returns:** `VisibleApplication[]` (an `Application` plus `access: AppAccess`). Only ACTIVE applications unless `includeInactive` is set. `editableOnly` keeps rows where `can_edit` is true.

### `getApplication(id)`
Gets one application with the user's access.
- **Permission:** `requireUser()` + `resolveAppAccess`. Returns `null` when there is no access; it does not throw.
- **Returns:** `VisibleApplication | null`

### `createApplication(input)`
Creates an ACTIVE application owned by the current user.
- **Input:** `{ name: string; description: string; model_type: ApplicationModelType }`
- **Permission:** `requireUser()`. Any signed-in user can do this.
- **Side effects:** Inserts into `applications`. For `CONTENT` applications, creates the default content type.
- **Returns:** `Application`

### `updateApplication(id, input)`
- **Input:** `{ name; description; status: EntityStatus; model_type }`
- **Permission:** `requireAppCapability(id, "manage")`
- **Returns:** `Application`

### `setApplicationStatus(id, status)`
- **Permission:** `requireAppCapability(id, "manage")`
- **Returns:** `void`

### `setReviewEmailNotifications(id, enabled)`
Turns emails to approvers on or off for when an article enters review.
- **Permission:** `requireAppCapability(id, "approve")`
- **Validation:** Needs migration 020.
- **Returns:** `void`

### `listApplicationPeople(applicationId)`
Returns the owner, the members with their roles and capabilities, and the org role map.
- **Permission:** `requireAppCapability(applicationId, "manage")`
- **Returns:** `{ owner: ApplicationMemberView | null; members: ApplicationMemberView[]; orgRoles: OrgRoleMap | null }`

### `inviteApplicationMember(input)`
Adds a member or updates an existing one, by email or employee ID. It can also set the person's LDAP role, display name and password.
- **Input:** `{ applicationId; identity; ldapRole; displayName?; password? }`
- **Permission:** `requireAppCapability(applicationId, "manage")`. Setting a password or display name also requires that the account belongs only to this application, unless the caller is a superadmin.
- **Validation:** Password must be 8–200 characters and the identity must be an email. The role must exist in the org role map. The owner cannot be invited.
- **Returns:** `{ error?: string }` (does not throw)
- **Side effects:** May create a `hub_users` row. Sets `hub_users.ldap_role`, which applies across all applications. Upserts `application_members`.

### `setApplicationMemberPassword(input)`
- **Input:** `{ applicationId; membershipId; password }`
- **Permission:** `manage`, plus the same account-lock rule as `inviteApplicationMember`.
- **Returns:** `{ error?: string }`

### `updateApplicationMember(input)`
Changes a member's LDAP role. An empty role resets them to EDITOR.
- **Input:** `{ applicationId; membershipId; ldapRole }`
- **Permission:** `requireAppCapability(applicationId, "manage")`
- **Side effects:** Updates `hub_users.ldap_role` and the role and capabilities on **every** `application_members` row for that user, in all applications.
- **Returns:** `void`

### `removeApplicationMember(input)`
- **Input:** `{ applicationId; membershipId }`
- **Permission:** `manage`. The delete is scoped to the application.
- **Returns:** `void`

### `setApplicationOwner(input)`
Transfers ownership.
- **Input:** `{ applicationId; identity }`
- **Permission:** `requireSuperadmin()`
- **Side effects:** May create a `hub_users` row. Removes the new owner's membership row.
- **Returns:** `{ error?: string }`

---

## Languages: `lib/actions/languages.ts`

Languages are global, not per application.

| Function | Input | Permission | Returns |
|---|---|---|---|
| `listLanguages(opts?)` | `{ includeInactive?: boolean }` | `requireUser()` | `Language[]`, by name |
| `createLanguage(input)` | `{ code; name }` | `requireSuperadmin()` | `Language` (ACTIVE) |
| `updateLanguage(id, input)` | `{ code; name; status }` | `requireSuperadmin()` | `Language` |
| `setLanguageStatus(id, status)` | `EntityStatus` | `requireSuperadmin()` | `void` |

These only trim input; validation is left to database constraints.

---

## Org roles: `lib/actions/org-roles.ts`

The mapping from LDAP role to role band (EDITOR, HOD and so on). Changing it changes permissions for members in every application. Every function here requires `requireSuperadmin()` and needs migration 012.

| Function | Input | Notes |
|---|---|---|
| `listOrgRoleMappings()` | none | Returns `OrgRoleMapping[]` |
| `addOrgRoleMapping(input)` | `{ ldapRole; band }` | Role is 1–80 characters. Duplicates are rejected, ignoring case. |
| `setOrgRoleBand(input)` | `{ id; band }` | |
| `removeOrgRoleMapping(input)` | `{ id }` | |

---

## Articles (Content applications): `lib/actions/press.ts`

### Reading

#### `listArticles(input)`
- **Input:** `{ applicationId; page?; pageSize?; search?; status?; contentType?; sourceLanguages?; market?; due?: "published" | "none" | "overdue" | "due_soon" | "scheduled" }`
- **Permission:** `requireAppCapability(applicationId, "view")`
- **Validation:** `pageSize` is limited to 1–100 (default 50). `search` matches the title.
- **Order:** articles in REVIEW first (earliest publish date first), then unpublished articles with a publish date (soonest first), then everything else by latest update. Each group is a separate query and the page is assembled from them, so a page costs 3 count queries plus 1–3 data queries.
- **Returns:** `Paginated<Content & { translations: { id, language_code, status, title }[] }>`

#### `countArticlesNeedingReview(applicationIds)`
- **Permission:** `requireUser()` only.
- **Returns:** `Record<applicationId, number>`, the number of articles in REVIEW per application.

#### `getArticle(id)`
- **Permission:** `allowAppCapability(app, "view")`. Returns `null` when access is denied.
- **Returns:** `(Content & { translations: ContentTranslation[] }) | null`

#### `getPressStats(applicationId)`
- **Permission:** `view`
- **Returns:** `{ articles, published, inReview, draft, translating, approved, publishing }`

#### `exportArticlesFile(input)`
Builds an XLSX file of the selected articles. Only approved translations are included.
- **Input:** `{ applicationId; contentIds: string[] }` (1–200)
- **Permission:** `view`
- **Returns:** `{ filename; base64; notice }`

### Writing

#### `createArticle(input)`
Creates an article and its source-language translation.
- **Input:** `{ application_id; content_type?; title; slug?; source_language; source_content: SourceContentFields; status?; scheduled_publish_at?; target_languages?; market?; keepAsDraft? }`
- **Permission:** `edit`. A publishable status (APPROVED, PUBLISHING or PUBLISHED) also needs `can_approve`. When an approver saves without `keepAsDraft`, the article is created as APPROVED.
- **Validation:** The content type must already exist.
- **Returns:** `Content`

#### `saveNewArticle(input)`
The editor's main save. Creates or updates the article, then stores the translations.
- **Input:** `{ applicationId; contentId?; title; contentType; sourceLanguage; sourceFields; market?; targetLanguages?; scheduledPublishAt?; mode: "draft" | "review" | "approve"; translations?: { languageCode; fields; origin: "system" | "manual" }[] }`
- **Permission:** `approve` for `mode: "approve"`. Otherwise it relies on the checks in `createArticle`, `updateArticle` and `upsertContentTranslation`, which require `edit`.
- **Returns:** `{ id }`

#### `updateArticle(id, applicationId, input)`
Updates the article's metadata and source content.
- **Input:** `{ title; slug?; content_type; source_language; source_content; status; scheduled_publish_at?; language_publish_at?; target_languages?; market?; publish_targets?: { language_code; vendor_id }[]; keepApprovals? }`
- **Permission:** `requireContentAccess(id, "edit")`. Releasing the article needs `can_approve`.
- **Side effects:** If the source text changed and `keepApprovals` is not set, approvals are cleared and a released article goes back to REVIEW. When an approver releases the article, its translations are approved. Publish targets are replaced.
- **Returns:** `Content`

#### `setArticleStatus(id, applicationId, status)`
- **Permission:** `requireContentAccess(id, capabilityForReleaseStatus(status))`
- **Side effects:** Sets `content.status`. Sets `published_at` when the status is PUBLISHED and clears it otherwise.
- **Returns:** `void`

#### `deleteArticle(input)` / `deleteArticles(input)`
- **Input:** `{ contentId; applicationId }` / `{ contentIds: string[]; applicationId }`
- **Permission:** `requireAppCapability(applicationId, "edit")`. The delete is scoped to the application.
- **Returns:** `void` / `{ deleted: number }`

### Translations

#### `upsertContentTranslation(input)`
Creates or updates one language and records a new version. It's also used inside other actions.
- **Input:** `{ content_id; language_code; fields; source_type: "SYSTEM" | "MANUAL" | "IMPORT"; status? }`
- **Permission:** `requireContentAccess(content_id, status === "APPROVED" ? "approve" : "edit")`
- **Side effects:** Writes `content_translations` and `content_translation_versions`. Does nothing if the content is unchanged.
- **Returns:** `ContentTranslation`

#### `saveManualContentTranslation(input)`
- **Input:** `{ contentId; languageCode; fields; applicationId }`
- **Permission:** `edit`. Saves by an approver are approved automatically. When a non-approver edits a released article, it goes back to REVIEW.
- **Returns:** `ContentTranslation`

#### `setContentTranslationStatus(input)`
Sets one translation's status, then promotes or demotes the article to match.
- **Input:** `{ contentTranslationId; status; applicationId; contentId }`
- **Permission:** `requireContentTranslationAccess(contentTranslationId, approve | edit)`
- **Returns:** `void`

### Machine translation

| Function | Input | Permission | Returns |
|---|---|---|---|
| `autoTranslateArticle(input)` | `{ contentId; targetLanguage; applicationId; sourceFields?; sourceLanguage?; approveTranslation? }` | content `edit` (`approve` if approving) | `ContentTranslation` |
| `autoTranslateArticleLanguages(input)` | same, but `targetLanguages: string[]`; `approveTranslations?` defaults to the caller's `can_approve` | content `edit` | `ContentTranslation[]` |
| `previewTranslateArticle(input)` | `{ applicationId; sourceLanguage; targetLanguages; sourceFields }` | app `edit` | `{ language_code; fields }[]`; nothing is saved |

The auto-translate functions move the article to TRANSLATING and then REVIEW (unless approving), and restore the previous status if translation fails. Languages that are already approved are skipped.

### Versions

| Function | Permission | Returns |
|---|---|---|
| `listContentTranslationVersions(contentTranslationId)` | `view` | `ContentTranslationVersion[]`, newest first |
| `deleteContentTranslationVersion({ versionId, applicationId, contentId })` | `edit` | `void` |

---

## Comments: `lib/actions/comments.ts`

| Function | Input | Permission | Notes |
|---|---|---|---|
| `listArticleComments(contentId)` | | content `view` | Oldest first |
| `addArticleComment(input)` | `{ contentId; applicationId; body; languageCode? }` | content `view` | Body is 1–2000 characters. The application ID must match the article's. |

---

## Content types: `lib/actions/content-types.ts`

| Function | Input | Permission | Notes |
|---|---|---|---|
| `listContentTypes(applicationId, opts?)` | `{ includeInactive? }` | `view` | Ordered by `sort_order`, then name |
| `listContentTypeCounts(applicationId)` | | `view` | `Record<code, number>` |
| `createContentType(input)` | `{ application_id; name; code?; description? }` | `edit` | The code is taken from the name if not given. Duplicates are rejected. |
| `updateContentType(id, applicationId, input)` | `{ name; description; status }` | `edit` | Scoped to the application |
| `deleteContentType(id, applicationId)` | | `edit` | Fails if articles use the type: "Mark it inactive instead." |
| `ensureContentType(applicationId, raw)` | | `edit` | Returns `{ code, created }`. Creates the type if it is missing. |
| `ensureDefaultContentType(applicationId)` | | `edit` | Makes sure "General" exists |
| `requireContentTypeCode(applicationId, raw)` | | `edit` | Throws if the type doesn't exist (blank means General) |

---

## Publishing: `lib/actions/publish.ts`

"Vendor admin" means `view` plus `can_approve` or `can_manage`. Otherwise the action throws "Vendor settings are limited to HOD and above."

| Function | Input | Permission | Returns / notes |
|---|---|---|---|
| `listPublishIntegrationTypes()` | | none (static list) | `PublishIntegrationType[]` |
| `listPublishVendors(applicationId)` | | `view` | `PublishVendor[]`. Secrets are never returned. Non-secret config is only shown to approvers. |
| `getArticlePublish(contentId)` | | content `view` | `{ ready, notice, vendors, targets, publications }` |
| `savePublishVendor(input)` | `{ applicationId; id?; name; typeCode; config; clearSecrets?; status }` | vendor admin | Creates the vendor, or updates it when `id` is given. The type can't change. Config is checked by the integration. |
| `deletePublishVendor(id, applicationId)` | | vendor admin | Scoped to the application |
| `publishArticleNow(contentId, applicationId, targets)` | `PublishLanguageTarget[]` | content `edit` | The article must be approved. Calls the external vendors. Returns `PublishRunResult`. |

Scheduled publishing runs from the `/api/cron/publish` route (see `openapi.yaml`).

---

## Translation quality: `lib/actions/quality.ts`

These are thin wrappers around `lib/translation-quality/handlers.ts`. IDs must be UUIDs, and language codes must match `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. The first four actions return `{ result | bundle, error }` instead of throwing.

| Function | Permission | Notes |
|---|---|---|
| `loadTranslationQuality({ contentId, languageCode })` | content `view` | Returns `{ bundle, error }`: categories, runs, latest, versionId, canAnalyze |
| `analyzeTranslationQuality(input)` | content `edit` | AI and rule checks, stored as a run. Limits: title 2000, summary 8000, body 100000 characters. |
| `previewTranslationQuality(input)` | app `edit` | Same checks on unsaved text. Nothing is stored (`persisted: false`). |
| `recheckTranslationRules(input)` | content `edit` | Re-runs the terminology and boilerplate rules only. The version must already have a completed run. |
| `getTranslationQualityRun(runId)` | content `view` | |
| `getTranslationQualityFindings(runId)` | content `view` | `{ findings, actions }` |
| `previewQualityAction({ actionId, title?, summary?, content? })` | content `view` | Returns the field's text after applying the action. Nothing is saved. |
| `acknowledgeIgnoredQualityAction(actionId)` | content `edit` | The action must be pending. Nothing is saved until the article is saved. |
| `ignoreTranslationFinding({ applicationId, runId, findingId })` | content `edit` | Marks the finding and its action ignored |
| `saveReviewedContentTranslation(input)` | content `edit` | Saves the translation and commits accepted and ignored action IDs through the `commit_content_translation_quality` RPC |
| `listQualitySettings(applicationId)` | `view` | `{ categories }` |
| `setQualityCategoryEnabled({ applicationId, categoryId, enabled })` | `approve` | Turns a check on or off for this application only (`application_quality_settings`). |
| `saveQualityCategories({ applicationId, categories })` | `approve` | 1–40 categories. Weight is a whole number from 1 to 100. Applies to this application only. |
| `listTerminologyEntries(input)` | `view` | Paged. Filters: search, languages, status (`active` or `inactive`). |
| `createTerminologyEntry(input)` | `edit` | Term is 1–120 characters, preferred wording 1–200. `forbiddenTranslations` is comma-separated, up to 12. |
| `updateTerminologyEntry(input)` | `edit` | Same fields, plus `terminologyId` and `isActive` |
| `setTerminologyActive(input)` | `edit` | |
| `deleteTerminologyEntry(input)` / `deleteTerminologyEntries(input)` | `edit` | Up to 100 IDs. Scoped to the application. |

---

## Product (string translations): `lib/actions/product.ts`

### Namespaces

| Function | Input | Permission |
|---|---|---|
| `listNamespaces(applicationId, opts?)` | `{ includeInactive? }` | `view` |
| `createNamespace(input)` | `{ application_id; name; description }` | `edit` |
| `updateNamespace(id, applicationId, input)` | `{ name; description; status }` | namespace `edit` |

### Keys and translations

#### `listTranslationKeys(input)`
- **Input:** `{ applicationId; page?; pageSize?; search?; namespaceId?; languageCode?; status? }`
- **Permission:** `view`
- **Returns:** `Paginated<TranslationKeyListItem>`
- **Note:** The `languageCode` and `status` filters are applied after paging, so `total` ignores them.

#### `getTranslationKey(id)`
- **Permission:** `view`. Returns `null` when access is denied.

#### `createTranslationKey(input)`
- **Input:** `{ application_id; namespace_id; key; source_language; source_text }`
- **Permission:** `edit`
- **Side effects:** Also creates the source-language translation.

#### `updateTranslationKey(id, applicationId, input)`
- **Input:** `{ namespace_id; key; source_language; source_text }`
- **Permission:** key `edit`

#### `upsertStringTranslation(input)`
Creates or updates one key/language and records a version. It's also used inside other actions.
- **Input:** `{ translation_key_id; language_code; text; source_type; status? }`
- **Permission:** key `approve` if `status` is APPROVED, otherwise key `edit`.
- **Default status:** empty text is MISSING, `SYSTEM` is SYSTEM_GENERATED, anything else is MANUALLY_MODIFIED.

#### Other key and translation actions

| Function | Permission | Notes |
|---|---|---|
| `saveManualStringTranslation({ translationKeyId, languageCode, text, applicationId })` | key `edit` | |
| `setStringTranslationStatus({ translationId, status, applicationId, translationKeyId })` | `approve` for APPROVED, otherwise `edit` | |
| `listTranslationVersions(translationId)` | `view` | Newest first |
| `deleteTranslationVersion({ versionId, applicationId, translationKeyId })` | `edit` | |
| `autoTranslateKey({ translationKeyId, targetLanguage, applicationId })` | key `edit` | Machine translation, saved as SYSTEM_GENERATED |
| `autoTranslateKeyLanguages({ translationKeyId, targetLanguages, applicationId })` | key `edit` | One call per language, run in sequence |
| `getProductStats(applicationId)` | `view` | `{ translationKeys, translated, missing }` |

---

## Import: `lib/actions/import.ts`

Files are sent as `{ filename, base64 }`, not FormData. Each preview function writes nothing. Its confirm counterpart runs the preview again, then writes. Errors on individual rows are counted, not thrown.

| Function | Permission | Returns |
|---|---|---|
| `previewStringImport({ applicationId, filename, base64 })` | `edit` | `{ items, summary }`. Each row is NEW, UPDATED, UNCHANGED or ERROR, compared with the existing keys. |
| `confirmStringImport({ ...preview, defaultSourceLanguage?, translateLanguages? })` | `edit` | `{ imported, updated, unchanged, errors, translated }`. Creates any missing namespaces. Can machine-translate. |
| `previewArticleImport({ applicationId, filename, base64 })` | `edit` | `{ items, summary }`. Each row is NEW, or ERROR if it has no title. |
| `confirmArticleImport({ ...preview, translateLanguages? })` | `edit` | `{ imported, updated, unchanged, errors, translated, typesCreated }`. Creates any missing content types. Translations are saved as APPROVED if the caller can approve. |
