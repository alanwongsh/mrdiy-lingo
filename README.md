# Mr DIY Lingo

Centralized multilingual content hub for MR.DIY internal apps (Next.js App Router + Supabase).

**Audience:** humans and coding agents working in this repo.

## Stack

- Next.js **16** (App Router) — APIs/conventions may differ from older Next.js. Prefer `node_modules/next/dist/docs/` over training data. See `AGENTS.md`.
- React 19, Tailwind 4, TypeScript
- Supabase (`@supabase/ssr` + `@supabase/supabase-js`)
- TipTap 3 for article HTML body
- PapaParse / SheetJS for CSV/XLSX import

No authentication in V1.

## Features (current)

| Area | Capabilities |
| --- | --- |
| **Applications** | `STRING` (product keys) or `CONTENT` (press articles) |
| **Languages** | CRUD + activate/deactivate |
| **Product** | Namespaces, keys, per-language translations, versions, auto-translate, approve |
| **Press** | Articles with title/description/HTML body, schedule/publish dates, per-article `source_language` + `target_languages`, TipTap editor, language chips, auto-translate, approve, history, article comments, copy title/description/body, Excel export of selected rows, bulk delete |
| **Import** | Excel/CSV validate → preview (New/Updated/Unchanged) → confirm; optional auto-translate targets |
| **Dashboard** | Coverage / lifecycle stats |
| **Setup** | In-app migration checklist (`/setup`) |

### Brand

- Red `#E30613` (`--diy-red` / `--hub-accent`)
- Yellow `#FFC20E` (`--diy-yellow`)

## Setup

```bash
npm install
```

`.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
TRANSLATION_PROVIDER=mymemory   # or mock
JOGET_EMBED_SECRET=...          # shared with Joget; signs the iframe user
# Optional: origins allowed to iframe this app (space-separated). Default *
# JOGET_FRAME_ANCESTORS=https://joget.example.com
# Local stand-in for Joget. Never enable in production.
# EMBED_ALLOW_DEV=true
# Optional behind corporate SSL:
# SUPABASE_INSECURE_SSL=true
```

Apply SQL in order (Supabase SQL Editor or `/setup`):

1. `supabase/migrations/001_translation_hub.sql` — core schema
2. `supabase/migrations/002_version_approval.sql` — only if upgrading older DBs with version approval columns
3. `supabase/migrations/003_content_publishing.sql` — `slug`, `scheduled_publish_at`, `published_at`
4. `supabase/migrations/004_content_target_languages.sql` — `content.target_languages text[]`
5. `supabase/migrations/005_article_comments.sql` — article comments, approver name, version username
6. `supabase/migrations/006_uuidv7.sql` — time-ordered UUID v7 defaults for new rows
7. `supabase/migrations/007_rewrite_uuidv7.sql` — rewrite existing v4 primary keys (and foreign keys) to v7. Old URLs stop working.

```bash
npm run dev
```

## Joget iframe

Joget's session cookie does not reach Lingo. Joget mints a short-lived HMAC token with the same `JOGET_EMBED_SECRET`, and the iframe opens:

`https://<lingo-host>/embed?token=<token>&next=/applications/<id>`

Lingo checks the signature, stores an httpOnly cookie, and redirects to `next`. Comments, history, and Approve use that name. Both refuse to run when nobody is signed in.

The signed string is compact JSON with no extra spaces, UTF-8, then base64url. The signature is HMAC-SHA256 of that base64url text. The token is `payload.signature`, both base64url and unpadded. `exp` is a unix timestamp at most 12 hours ahead (use 5 minutes from Joget).

```json
{"u":"ahmad","n":"Ahmad Lee","e":"ahmad@example.com","exp":1710000000}
```

Paste this into a Joget Bean Shell userview menu. Joget replaces `#appVariable.lingoEmbedSecret#` before the script runs. Set that app variable to the same secret, and set `JOGET_FRAME_ANCESTORS` to the Joget origin. The iframe host must be HTTPS so the cookie is accepted inside a cross-site frame.

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.joget.workflow.util.WorkflowUtil;
import org.joget.directory.model.User;

String secret = "#appVariable.lingoEmbedSecret#";
User user = WorkflowUtil.getCurrentUser();
String username = user.getUsername();
String first = user.getFirstName() == null ? "" : user.getFirstName();
String last = user.getLastName() == null ? "" : user.getLastName();
String name = (first + " " + last).trim();
if (name.isEmpty()) name = username;
String email = user.getEmail() == null ? "" : user.getEmail();
long exp = System.currentTimeMillis() / 1000L + 300L;
String json = "{\"u\":\"" + username.replace("\\", "\\\\").replace("\"", "\\\"")
  + "\",\"n\":\"" + name.replace("\\", "\\\\").replace("\"", "\\\"")
  + "\",\"e\":\"" + email.replace("\\", "\\\\").replace("\"", "\\\"")
  + "\",\"exp\":" + exp + "}";
String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
String sig = Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
String token = java.net.URLEncoder.encode(payload + "." + sig, "UTF-8");
String next = java.net.URLEncoder.encode("/", "UTF-8");
return "<iframe src=\"https://lingo.example.com/embed?token=" + token + "&next=" + next + "\" style=\"width:100%;height:calc(100vh - 120px);border:0\"></iframe>";
```

Without Joget, set `EMBED_ALLOW_DEV=true` and use the sidebar form, or mint a 5-minute token:

```bash
node scripts/mint-embed-token.mjs ahmad "Ahmad Lee"
```

## Sample imports

- `samples/product-translations.csv`
- `samples/press-articles.csv` — includes HTML `body`; required column `source_language`

## Architecture

```
Applications
├── STRING  → namespaces → translation_keys → translations → translation_versions
└── CONTENT → content    → content_translations → content_translation_versions

TranslationService → MyMemory | mock
```

### Domain notes (Press)

- **Source language** (`content.source_language`): language of the authoring pane. Editable on create, edit, and CSV import. Auto-translate uses `source → target`.
- **Target languages** (`content.target_languages`): intended locales for that article (excludes source). Listing/editor chips and import wizard write this array.
- **Source content** lives in `content.source_content` JSON (`title`, `summary`, `body`, `seo_*`). Body is HTML.
- **Per-language status** on `content_translations.status` (`MISSING` | `SYSTEM_GENERATED` | `MANUALLY_MODIFIED` | `APPROVED`). There is no separate version-level approval. Approving stores `approved_by_name` / `approved_by_username` from the signed-in Joget user. A later edit clears that stamp.
- **Comments** stay on the article (`article_comments.content_id`) but each row is for one `language_code`. The editor opens them from a floating button in a right-hand panel, defaulting to the language in the Editing pane. Each row stores `author_username` and `author_name`.
- **Copy** is the icon beside each Title, Description, and Body label, on both the source pane and the editing pane. Title and description copy as plain text. Body copies the HTML currently in the editor.
- **Export** on the article list writes the selected rows to `.xlsx` using the import columns (`title`, `source_language`, `content_type`, `status`, `summary`, `body`, `seo_*`, then `{lang}_title` / `{lang}_body` / …). Language codes keep their stored case (`zh-Hans`).
- **Lifecycle** on `content.status` (`DRAFT` → `TRANSLATING` → `REVIEW` → `APPROVED` → `PUBLISHED`). Setting `PUBLISHED` stamps `published_at`.
- **Due UX**: list sorted by nearest `scheduled_publish_at`; filters for overdue / due soon (24h) / scheduled / none / published.

### Auto-translate cost

For each target language, `translateArticle` calls the provider once per field:

- title, summary, seo_title, seo_description → **4** requests
- body → **1 request per HTML text node** (markup preserved via `translateHtmlPreservingMarkup`)

Rich sample articles ≈ **20–25 MyMemory calls per language**. Provider set by `TRANSLATION_PROVIDER` (`mymemory` default, `mock` prefixes `[lang] …`). MyMemory truncates each chunk at 450 chars.

## Repository map

```
app/                          # App Router pages
  page.tsx                    # Dashboard
  setup/                      # Migration status + SQL display
  languages/
  applications/
    [id]/
      articles/               # CONTENT apps
      translations/           # STRING apps
      namespaces/
      import/
  import/                     # Global import entry

components/                   # Client/shared UI
  article-editor.tsx          # Press dual-pane editor
  article-list-table.tsx      # Listing + bulk delete checkboxes
  article-list-filters.tsx    # Search + FilterSelect/MultiSelect
  filter-select.tsx           # Compact filter dropdowns
  html-editor.tsx             # TipTap (forwardRef getHTML)
  language-multi-select.tsx   # Translate-to chips + batch translate
  import-wizard.tsx
  ui.tsx                      # Button, Card, Badge, Pagination, Field, …

lib/
  types.ts                    # Shared domain types + helpers
  actions/                    # "use server" mutations/queries
    press.ts                  # Articles CRUD, translate, bulk delete
    product.ts                # Keys/translations
    import.ts                 # Preview/confirm imports
    applications.ts
    languages.ts
  translation/service.ts      # Providers + HTML-preserving translate
  import/parse.ts             # CSV/XLSX parsers
  target-languages.ts         # normalizeTargetLanguages()
  publish-due.ts              # Due windows / labels
  slug.ts                     # slugify / normalizeSlug
  db/client.ts                # getDb()
  supabase/                   # browser/server/proxy clients

supabase/migrations/          # Apply 001→004 in order
samples/                      # Example import files
```

## Key server actions

### Press — `lib/actions/press.ts`

| Function | Role |
| --- | --- |
| `listArticles` | Paginated list; filters: search, status, type, **sourceLanguages[]**, due |
| `getArticle` / `createArticle` / `updateArticle` / `setArticleStatus` | CRUD + lifecycle |
| `deleteArticle` / `deleteArticles` | Single / bulk delete (cascades via FK) |
| `upsertContentTranslation` | Save translation + append version when changed |
| `autoTranslateArticle` / `autoTranslateArticleLanguages` | Translate; optional live `sourceFields` + `sourceLanguage`; never overwrite stored body with empty editor state |
| `saveManualContentTranslation` / `setContentTranslationStatus` | Manual edit / approve (approve requires a signed-in user) |
| `listArticleComments` / `addArticleComment` | Article thread; author comes from the session |
| `listContentTranslationVersions` / `deleteContentTranslationVersion` | History |
| `getPressStats` | Dashboard counts |

### Product — `lib/actions/product.ts`

Namespaces + keys + `autoTranslateKey(Languages)` + versions + stats (parallel to press).

### Import — `lib/actions/import.ts`

| Function | Role |
| --- | --- |
| `previewStringImport` / `confirmStringImport` | Product CSV/XLSX |
| `previewArticleImport` / `confirmArticleImport` | Press; merges `target_languages`; optional `translateLanguages` |

**Press CSV columns (required):** `title`, `source_language`  
**Optional:** `content_type`, `status`, `summary`, `body`, `seo_title`, `seo_description`, plus `{lang}_{field}` e.g. `ms_title`, `en_body`.

**Preview actions:** `NEW` | `ERROR` for articles. Each row is inserted as a new article (`content.id` is the only identifier; the file is not matched on title or slug). Product keys still match on `key` and can be `UPDATED` or `UNCHANGED`.

### Translation — `lib/translation/service.ts`

- `translateHtmlPreservingMarkup(html, translatePlain)` — split on tags; translate text nodes only
- `getTranslationService()` — env-selected provider

## Important UI components

| Component | Notes |
| --- | --- |
| `ArticleEditor` | Source + target panes; editable source language; TipTap bodies; batch translate passes live TipTap HTML via ref |
| `HtmlEditor` | Controlled TipTap; `getHTML()` via ref; suppresses spurious empty `onUpdate` during mount/`setContent` (historically wiped translated body in UI even when DB had content) |
| `ArticleListTable` | Checkboxes + `deleteArticles` |
| `ArticleListFilters` | Inline `FilterMultiSelect` (source locales) + `FilterSelect` (status/type/due) |
| `ImportWizard` | Styled Choose-file button; language multi-select for auto-translate targets |

## Agent / contributor pitfalls

1. **Next.js 16 ≠ classic Next** — read local docs before inventing APIs. Files with `"use server"` may only export async functions / server-safe values; keep sync helpers (e.g. `slugify`) outside those modules (`lib/slug.ts`, `lib/target-languages.ts`).
2. **Translated body missing in UI ≠ missing in DB** — check `content_translations.body` first. TipTap sync bugs often cleared React draft while MyMemory had already saved HTML.
3. **Empty editor state must not clobber DB** — `autoTranslateArticle` uses `preferField(live, stored)` so blank TipTap state cannot wipe `source_content.body`.
4. **HTML body translate = many HTTP calls** — do not assume one request per article; rate limits and slowness are expected on MyMemory.
5. **Source vs target** — for Malay→English, set `source_language=ms` and include `en` in targets / import translate list. Wrong source language produces bad translations.
6. **Migrations** — new Press fields need 003 + 004; `/setup` probes columns and tells which file to run.
7. **Prefer existing patterns** — `components/ui.tsx` primitives, `FilterSelect` for list filters, `LanguageMultiSelect` for translate-to UX, server actions in `lib/actions/*`.

## Scripts

```bash
npm run dev      # local app
npm run build
npm run start
npm run lint
```
