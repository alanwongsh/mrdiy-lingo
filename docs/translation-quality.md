# Translation quality: analyze and apply

Agent notes for the article quality rail. This is the path that scores an existing translation and writes a suggested wording change into the editor. It is not the path that generates the translation.

Generating a translation lives in `lib/translation/service.ts` and `lib/translation/gemini.ts`. `TRANSLATION_PROVIDER` selects that provider. Quality review always uses `QUALITY_PROVIDER`, `GEMINI_API_KEY`, and `GEMINI_MODEL` from `lib/translation-quality/config.ts`.

Quality review does not change article status and does not block publish.

## Files

| Piece | File |
| --- | --- |
| Rail UI | `components/translation-quality-panel.tsx` |
| Editor accept | `components/article-editor.tsx` `acceptQualityAction` |
| Article view accept | `components/article-view.tsx` |
| New-article accept | `app/applications/[id]/articles/new/page.tsx` |
| Server action wrappers | `lib/actions/quality.ts` |
| Auth, bounds, save | `lib/translation-quality/handlers.ts` |
| Score, persist, preview | `lib/translation-quality/TranslationQualityService.ts` |
| Gemini call | `lib/translation-quality/providers/GeminiTranslationQualityProvider.ts` |
| Prompt and response schema | `lib/translation-quality/prompts/translation-quality-v1.ts` |
| Findings and actions | `lib/translation-quality/normalizers/GeminiResultNormalizer.ts` |
| Terminology and boilerplate | `lib/translation-quality/rules/` |
| Apply one suggestion to a draft | `lib/translation-quality/apply-action.ts` |
| Runs, findings, actions | `lib/translation-quality/repository.ts` |
| Types | `lib/translation-quality/types.ts` |

The panel calls the wrappers in `lib/actions/quality.ts`. Those wrappers catch errors and return `{ result, error }` or `{ bundle, error }`. The handlers underneath throw. Do not call Gemini from a client component.

## Analyze

1. The rail calls `analyze()` in `translation-quality-panel.tsx`.
2. A new article that is not saved yet (`sessionOnly`) calls `previewTranslationQuality`. An existing article calls `analyzeTranslationQuality`.
3. `handlers.ts` checks edit access, rejects the same source and target language, and limits title to 2,000 characters, description to 8,000, and body to 100,000. Empty title, description, and body together is rejected.
4. `TranslationQualityService.score` loads enabled categories. Categories with `categoryType: "ai"` go to Gemini. `rule` categories run in `RuleEngine` (`TerminologyRule`, `BoilerplateRule`) and do not call Gemini.
5. `normalizeGeminiResult` and `normalizeRuleResults` turn the replies into scores, findings, and actions. A finding whose quote cannot be found in the draft is dropped. An action is stored only when `actionForFinding` can apply it.
6. The overall score is the weighted sum in `lib/translation-quality/scoring/ScoreCalculator.ts`. Weights live on `quality_categories.configuration.weight`.

Two persistence shapes:

- **Saved text.** The draft title, summary, and body match the latest `content_translation_versions` row. `claimQualityRun` attaches one run to that version. Analyze again replaces that run. `persisted` is true.
- **Draft text.** The editor differs from the saved version, or there is no version yet. `insertDraftQualityRun` stores the run with `content_translation_version_id` null and copies the analyzed text into `request_metadata`. `preview()` for a brand-new article does not write a run; it returns `persisted: false` and a temporary id. The rail keeps that result in memory until the text changes.

`recheckTranslationRules` reruns terminology and boilerplate on the saved version only. It does not call Gemini.

## What an action is

A finding describes a problem. An action is the edit the Accept button can perform.

| `actionType` | Meaning |
| --- | --- |
| `replace`, `rewrite` | Swap `originalText` for `proposedText` |
| `delete` | Remove `originalText` |
| `insert` | Insert `proposedText` at `startOffset`, or append when there is no offset |

`targetField` is `title`, `summary`, or `content`. `content` is the HTML body (`SourceContentFields.body`).

`actionForFinding` drops the action when:

- there is no type, and the finding does not have both an original quote and a suggestion
- replace, rewrite, or delete cannot find `originalText` in that field
- replace or rewrite has no suggestion, or the suggestion equals the original
- insert has no suggestion

The panel can still offer Accept for a finding with no stored action. `fallbackAction` builds a pending `replace` from `translatedText` and `suggestedText` when those differ. Its id is the finding id.

Severity labels on the rail are display only: `info` is Note, `warning` is Check, `error` and `critical` are Blocker.

## Apply

Accept does not write the translation.

1. The rail calls `onAccept(action)` on the editor, the article view, or the new-article page.
2. That handler calls `applyQualityAction(draft, action)` in `apply-action.ts`. This returns a new `SourceContentFields`. It throws `This suggestion no longer matches the translation.` when the quote is gone or the text does not change.
3. The screen replaces the draft and appends `action.id` to `acceptedActionIds`. Accept all sorts longer quotes first so a short quote inside a longer one is not applied after the longer one has already changed the text.
4. A quiet accept that no longer matches is still recorded as accepted and does not surface the error. A normal accept shows the error.

`applyToText` tries, in order:

1. Exact `indexOf(originalText)`.
2. Case-insensitive match.
3. `replaceAcrossTags`, which matches visible words and leaves the surrounding tags in place. Use this path when a quote crosses `<em>`, `<a>`, or `<strong>`.
4. For delete, exact removal only.
5. For insert, `startOffset` when it is inside the string, otherwise append.
6. `startOffset` and `endOffset` when that slice still equals `originalText`.

Do not apply by slicing HTML with the model’s offsets alone. Offsets are a fallback. The quote match is what keeps tags intact.

## Save

Save is the first time an accepted suggestion is stored.

`saveReviewedContentTranslation` in `handlers.ts`:

- With no accepted and no ignored ids, it calls `saveManualContentTranslation` and then `attachDraftQualityRun` when a run id is present.
- With accepted or ignored ids, it calls the Postgres function `commit_content_translation_quality`. That writes the translation version and marks those `quality_actions` rows `applied` or `ignored` together.
- An id cannot be in both lists.
- An editor save is `MANUALLY_MODIFIED`. An HOD save is `APPROVED`.
- `attachDraftQualityRun` links a draft run to the new version only when the saved text equals the analyzed text after the accepted actions are replayed with `applyQualityAction`. A mismatch leaves the run unattached.

Ignore on a saved article calls `ignoreTranslationFinding` immediately and sets the action to `ignored`. Ignore on a new unsaved article stays in the page session. The next analysis starts a new set of findings.

## Environment

| Variable | Role |
| --- | --- |
| `GEMINI_API_KEY` | Required for AI categories. Missing key throws `GEMINI_API_KEY is not configured.` |
| `GEMINI_MODEL` | Defaults to `gemini-3.5-flash-lite` |
| `QUALITY_PROVIDER` | Defaults to `gemini`. An unknown id throws from `TranslationQualityProviderFactory` |

Gemini prompt and reply lines go through `writeServiceLog` (`lib/service-log.ts`). On Vercel that directory is `/tmp/lingo-logs` and disappears with the instance. The function log still prints `[service-log]`.

A thrown server action is hidden in production as “An error occurred in the Server Components render.” Quality wrappers already return `{ error }` so the rail can show the message. Translation generation in `lib/actions/press.ts` still rethrows, which is why a failed translate looks like that digest on Vercel.
