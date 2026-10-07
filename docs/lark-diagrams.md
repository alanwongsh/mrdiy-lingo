# Lark diagrams

In the Lark doc, on a blank line type `/Mermaid`, then paste **one** block below. Paste the code only. Leave out the ` ```mermaid ` lines.

---

## 1. System architecture

```mermaid
flowchart LR
  subgraph clients [Clients]
    Browser[Browser]
    Joget[Joget iframe]
  end
  subgraph vercel [Vercel]
    Proxy[Session proxy]
    Next[Next.js app]
    Actions[Server actions]
  end
  subgraph data [Supabase]
    PG[(PostgreSQL)]
  end
  subgraph translate [Translation]
    MM[MyMemory]
    Mock[Mock provider]
    LLM[OpenAI planned]
  end
  subgraph quality [Quality review]
    Gemini[Google Gemini]
  end
  Browser --> Proxy
  Joget -->|HMAC token| Proxy
  Proxy --> Next
  Next --> Actions
  Actions --> PG
  Actions --> MM
  Actions --> Mock
  Actions --> Gemini
  LLM -.-> Actions
```

## 2. Two application models

```mermaid
flowchart TB
  App[Application]
  App --> String[STRING product copy]
  App --> Content[CONTENT press articles]
  String --> NS[Namespaces]
  NS --> Keys[Translation keys]
  Keys --> Tr[Translation per language]
  Tr --> TV[Version history]
  Content --> Types[Content types]
  Types --> Article[Articles]
  Article --> CT[Translation per language]
  CT --> CV[Version history]
  Article --> Comments[Comments per language]
```

## 3. Sign in

```mermaid
flowchart TD
  Start([Open Lingo]) --> FromJoget{From Joget?}
  FromJoget -->|Yes| Token[Open embed link with token]
  Token --> Verify{HMAC valid?}
  Verify -->|No| Fail[Ask to reload Joget]
  Verify -->|Yes| Cookie[Set session 12 hours]
  FromJoget -->|No| Form[Email and password]
  Form --> Hash{Password matches?}
  Hash -->|No| Form
  Hash -->|Yes| Cookie
  Cookie --> Upsert[Save user profile]
  Upsert --> App([Dashboard])
```

## 4. Create an application and invite

```mermaid
flowchart TD
  A([Dashboard]) --> B[New application]
  B --> C{Model}
  C -->|Strings| D[Namespaces and keys]
  C -->|Content| E[General type and articles]
  B --> F[Creator becomes owner]
  F --> G[Invite by email or employee ID]
  G --> H[Assign an account role]
  H --> I([Invitee sees the app after sign-in])
```

## 5. Press article workflow

```mermaid
flowchart TD
  Create[Create or import] --> Start{Creator can approve?}
  Start -->|No| Draft[DRAFT]
  Start -->|Yes| Approved[APPROVED]
  Draft --> Work[Edit source text and languages]
  Work --> Auto[Auto-translate]
  Auto --> AutoWho{Who ran it?}
  AutoWho -->|Editor| Review[REVIEW]
  AutoWho -->|HOD| LangOk[Language APPROVED]
  Review --> SaveLang[Save a language]
  SaveLang --> Actor{Who saved?}
  Actor -->|Editor| Manual[MANUALLY_MODIFIED and article REVIEW]
  Actor -->|HOD| LangOk
  Manual --> Review
  LangOk --> All{All targets approved?}
  All -->|No| Stay[Article status unchanged]
  All -->|Yes| Approved
  Approved --> Publish[PUBLISHED]
  Publish --> SaveLang
  Approved --> SourceEdit[Edit source text]
  Publish --> SourceEdit
  SourceEdit --> Cleared[Clear target approvals]
  Cleared --> Review
  Approved --> Settings[Type market schedule or language list]
  Publish --> Settings
  Settings --> Keep[Approval unchanged]
```

## 6. Translation status

```mermaid
flowchart TD
  Missing[MISSING] -->|Editor auto-translate| System[SYSTEM_GENERATED]
  Missing -->|Editor types or imports| Manual[MANUALLY_MODIFIED]
  Missing -->|HOD saves translates or imports| Approved[APPROVED]
  System -->|Editor saves| Manual
  System -->|HOD saves or approves| Approved
  Manual -->|HOD saves or approves| Approved
  Approved -->|Editor saves or source text changes| Manual
```

## 7. Product string workflow

```mermaid
flowchart LR
  NS[Create namespace] --> Key[Create key and source text]
  File[CSV or Excel import] --> Key
  Key --> Gen[Auto-translate languages]
  Gen --> Row[SYSTEM_GENERATED plus version]
  Row --> Edit[Manual edit]
  Edit --> Appr[Approve language]
```

## 8. Import

```mermaid
flowchart TD
  Pick[Choose application] --> File[Upload CSV or Excel]
  File --> Preview[Validate and preview]
  Preview --> Confirm[Confirm]
  Confirm --> Created[Create missing namespace or content type]
  Created --> Opt{Translate missing languages?}
  Opt -->|Yes| Run[Provider fills missing languages]
  Opt -->|No| Done([Stored as IMPORT])
  Run --> Done
```

## 9. Data model

```mermaid
flowchart TB
  subgraph people [People and languages]
    Users[hub_users]
    Map[org_role_map]
    Lang[languages]
  end
  Apps[applications]
  Members[application_members]
  Users -->|owns| Apps
  Users --> Members
  Users -->|account title| Map
  Apps --> Members

  subgraph strings [STRING]
    NS[namespaces]
    Keys[translation_keys]
    Tr[translations]
    TV[translation_versions]
  end
  Apps --> NS
  Apps --> Keys
  NS --> Keys
  Keys --> Tr
  Lang --> Tr
  Tr --> TV

  subgraph press [CONTENT]
    Types[content_types]
    Content[content]
    CT[content_translations]
    CV[content_translation_versions]
    Comments[article_comments]
  end
  Apps --> Types
  Types --> Content
  Apps --> Content
  Content --> CT
  Lang --> CT
  CT --> CV
  Content --> Comments

  subgraph quality [Quality]
    Cats[quality_categories]
    Terms[terminology]
    Boiler[boilerplate_phrases]
    Runs[quality_runs]
    Scores[quality_scores]
    Findings[quality_findings]
    Actions[quality_actions]
  end
  CV --> Runs
  Cats --> Scores
  Runs --> Scores
  Runs --> Findings
  Findings --> Actions
  Terms --> Runs
  Boiler --> Runs
```

## 10. Export articles

```mermaid
flowchart TD
  Select[Select articles on the list] --> Check{Any approved target language?}
  Check -->|No| Skip[Skip that article]
  Check -->|Yes| Row[Write one Excel row]
  Row --> Source[Fill source columns]
  Source --> Cells{Target language approved?}
  Cells -->|Yes| Fill[Fill that language]
  Cells -->|No| Blank[Leave that language blank]
  Fill --> File[Download xlsx]
  Blank --> File
  Skip --> Notice[Report skipped and blank languages]
  File --> Notice
```

## 11. Quality review

```mermaid
flowchart TD
  Open[Open a language] --> Analyze[Analyze]
  Analyze --> Model[Gemini scores message tone structure and cross-language]
  Analyze --> Rules[Rules score terminology and boilerplate]
  Model --> Run[Store one quality run]
  Rules --> Run
  Run --> Rail[Show score and findings]
  Rail --> Accept[Accept into the draft]
  Rail --> Ignore[Ignore the finding]
  Accept --> Save[Save translation and accepted actions]
  Ignore --> Stay[Hidden until the next analysis]
  Rail --> Again[Analyze again]
  Again --> Analyze
```
