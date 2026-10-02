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
| **Press** | Articles with title/description/HTML body, slug, schedule/publish dates, per-article `source_language` + `target_languages`, TipTap editor, language chips, auto-translate, approve, history, bulk delete |
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
# Optional behind corporate SSL:
# SUPABASE_INSECURE_SSL=true
```

Apply SQL in order (Supabase SQL Editor or `/setup`):

1. `supabase/migrations/001_translation_hub.sql` — core schema
2. `supabase/migrations/002_version_approval.sql` — only if upgrading older DBs with version approval columns
3. `supabase/migrations/003_content_publishing.sql` — `slug`, `scheduled_publish_at`, `published_at`
4. `supabase/migrations/004_content_target_languages.sql` — `content.target_languages text[]`

```bash
npm run dev
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
- **Per-language status** on `content_translations.status` (`MISSING` | `SYSTEM_GENERATED` | `MANUALLY_MODIFIED` | `APPROVED`). There is no separate version-level approval.
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
| `saveManualContentTranslation` / `setContentTranslationStatus` | Manual edit / approve |
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

**Preview actions:** `NEW` | `UPDATED` | `UNCHANGED` | `ERROR` — match existing by title; compare source fields + language.

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
