# Lingo — Entity Relationship Diagrams

Built from `supabase/migrations/001` to `029`. Each diagram shows primary keys (PK), foreign keys (FK) and the main columns only. Full column descriptions are in [technical-documentation.md](technical-documentation.md#41-tables).

To use a diagram in Lark, type `/Mermaid` on a blank line and paste the code inside one block. Leave out the ` ```mermaid ` lines.

| Diagram | Covers |
| --- | --- |
| 1. Overview | Every table and how the areas connect |
| 2. People and access | Users, applications, members, roles, permissions |
| 3. Articles | Articles, translations, versions, comments, audit, emails, publishing |
| 4. Quality review | Quality runs, scores, findings, terminology, boilerplate |
| 5. Strings and catalog | Product UI strings, catalog items, translation memory |

Notation: `||--o{` one to many, `|o--o{` optional one to many, `|o--o|` optional one to one. Dotted lines are links by value with no foreign key.

---

## 1. Overview

```mermaid
erDiagram
  hub_users ||--o{ application_members : "joins"
  applications ||--o{ application_members : "has"
  access_roles |o--o{ application_members : "gives role"
  applications |o--o{ access_roles : "owns"
  applications ||--o{ content : "contains"
  applications ||--o{ translation_keys : "contains"
  applications ||--o{ catalog_items : "contains"
  content ||--o{ content_translations : "translated into"
  languages ||--o{ content_translations : "language"
  content ||--o{ quality_runs : "reviewed by"
  content ||--o{ content_publications : "published as"
  content ||--o{ notification_outbox : "queues"
  content ||..o{ content_audit_events : "audited by"
  translation_keys ||--o{ translations : "translated into"
  languages ||--o{ translations : "language"
```

---

## 2. People and access

```mermaid
erDiagram
  hub_users {
    uuid id PK
    text username
    text email
    text display_name
    text employee_id
    text ldap_role "job title, display only"
    boolean is_superadmin
    text password_hash
  }
  org_role_map {
    uuid id PK
    text ldap_role
    text band
  }
  applications {
    uuid id PK
    text name
    text model_type "STRING, CONTENT or CATALOG"
    text status
    uuid owner_user_id FK
    boolean notify_review_email
  }
  application_members {
    uuid id PK
    uuid application_id FK
    uuid user_id FK
    uuid access_role_id FK
  }
  access_roles {
    uuid id PK
    uuid application_id FK "null for default roles"
    text name
    uuid copied_from FK
  }
  access_role_permissions {
    uuid role_id FK
    text permission
  }
  languages {
    text code PK
    text name
    text status
  }
  email_templates {
    text kind PK
    text sender_name
    text subject
    text body
    uuid updated_by FK
  }

  hub_users |o--o{ applications : "owns"
  hub_users ||--o{ application_members : "joins"
  applications ||--o{ application_members : "has"
  access_roles |o--o{ application_members : "gives role"
  applications |o--o{ access_roles : "owns"
  access_roles |o--o{ access_roles : "copied from"
  access_roles ||--o{ access_role_permissions : "holds"
  hub_users }o..o| org_role_map : "job title"
  hub_users |o--o{ email_templates : "last edited"
```

---

## 3. Articles

```mermaid
erDiagram
  applications {
    uuid id PK
    text name
  }
  content_types {
    uuid id PK
    uuid application_id FK
    text code
    text name
  }
  content {
    uuid id PK
    uuid application_id FK
    text content_type FK "code within the application"
    text title
    text source_language
    jsonb source_content
    text status
    text market
    text_array target_languages
    timestamptz scheduled_publish_at
    jsonb language_publish_at
    timestamptz published_at
  }
  content_translations {
    uuid id PK
    uuid content_id FK
    text language_code FK
    text title
    text body
    text status
    uuid approved_by_user_id FK
    timestamptz approved_at
  }
  content_translation_versions {
    uuid id PK
    uuid content_translation_id FK
    int version_number
    jsonb translated_content
    text source_type
    uuid author_user_id FK
  }
  article_comments {
    uuid id PK
    uuid content_id FK
    text language_code
    text body
    uuid author_user_id FK
  }
  content_audit_events {
    uuid id PK
    uuid content_id "no FK, kept after delete"
    uuid application_id
    text event
    text from_status
    text to_status
    jsonb detail
    text actor_name
  }
  notification_outbox {
    uuid id PK
    text kind
    uuid content_id FK
    text status
    int attempts
  }
  publish_vendors {
    uuid id PK
    uuid application_id FK
    text name
    text type_code
    jsonb config
    text status
  }
  content_publish_targets {
    uuid content_id FK
    text language_code
    uuid vendor_id FK
  }
  content_publications {
    uuid id PK
    uuid content_id FK
    uuid vendor_id FK
    text language_code
    text status
    text external_url
  }
  languages {
    text code PK
    text name
  }
  hub_users {
    uuid id PK
    text display_name
  }

  applications ||--o{ content_types : "defines"
  applications ||--o{ content : "contains"
  content_types ||--o{ content : "type of"
  content ||--o{ content_translations : "translated into"
  languages ||--o{ content_translations : "language"
  content_translations ||--o{ content_translation_versions : "history"
  content ||--o{ article_comments : "discussed in"
  content ||..o{ content_audit_events : "audited by"
  content ||--o{ notification_outbox : "queues email"
  applications ||--o{ publish_vendors : "configures"
  content ||--o{ content_publish_targets : "sent to"
  publish_vendors ||--o{ content_publish_targets : "receives"
  content ||--o{ content_publications : "published as"
  publish_vendors ||--o{ content_publications : "delivered to"
  hub_users |o--o{ content_translations : "approves"
  hub_users |o--o{ content_translation_versions : "authors"
  hub_users |o--o{ article_comments : "writes"
```

---

## 4. Quality review

```mermaid
erDiagram
  applications {
    uuid id PK
    text name
  }
  content {
    uuid id PK
    text title
  }
  content_translations {
    uuid id PK
    uuid content_id FK
    text language_code
  }
  content_translation_versions {
    uuid id PK
    uuid content_translation_id FK
    int version_number
  }
  quality_categories {
    uuid id PK
    text code "message, tone, structure, ..."
    text category_type "ai or rule"
    boolean enabled
    jsonb configuration "default weight"
  }
  application_quality_settings {
    uuid application_id FK
    uuid category_id FK
    boolean enabled
    int weight
  }
  terminology {
    uuid id PK
    uuid application_id FK
    text term
    text source_language
    text target_language
    text preferred_translation
    text_array forbidden_translations
    boolean is_active
  }
  boilerplate_phrases {
    uuid id PK
    uuid application_id FK
    text name
    text language
    text phrase
    boolean is_active
  }
  quality_runs {
    uuid id PK
    uuid content_id FK
    uuid content_translation_id FK
    uuid content_translation_version_id FK "unique when set"
    text provider
    text model
    text status
    numeric overall_score
  }
  quality_scores {
    uuid id PK
    uuid quality_run_id FK
    uuid category_id FK
    int score
    text severity
  }
  quality_findings {
    uuid id PK
    uuid quality_run_id FK
    uuid quality_score_id FK
    text severity
    text title
    text suggested_text
  }
  quality_actions {
    uuid id PK
    uuid quality_run_id FK
    uuid finding_id FK
    text action_type
    text status "pending, applied or ignored"
  }

  applications ||--o{ application_quality_settings : "tunes"
  quality_categories ||--o{ application_quality_settings : "setting for"
  applications ||--o{ terminology : "keeps"
  applications ||--o{ boilerplate_phrases : "keeps"
  content ||--o{ quality_runs : "reviewed by"
  content_translations |o--o{ quality_runs : "language reviewed"
  content_translation_versions |o--o| quality_runs : "version reviewed"
  quality_runs ||--o{ quality_scores : "scores"
  quality_categories |o--o{ quality_scores : "category"
  quality_runs ||--o{ quality_findings : "finds"
  quality_scores |o--o{ quality_findings : "explains"
  quality_findings ||--o{ quality_actions : "suggests"
  quality_runs ||--o{ quality_actions : "includes"
```

---

## 5. Strings and catalog

```mermaid
erDiagram
  applications {
    uuid id PK
    text name
    text model_type
  }
  namespaces {
    uuid id PK
    uuid application_id FK
    text name
  }
  translation_keys {
    uuid id PK
    uuid application_id FK
    uuid namespace_id FK
    text key
    text source_language
    text source_text
  }
  translations {
    uuid id PK
    uuid translation_key_id FK
    text language_code FK
    text current_text
    text status
    uuid approved_by_user_id FK
  }
  translation_versions {
    uuid id PK
    uuid translation_id FK
    int version_number
    text translated_content
    uuid author_user_id FK
  }
  catalog_fields {
    uuid id PK
    uuid application_id FK
    text code
    text label
    text field_type
    boolean translatable
  }
  catalog_items {
    uuid id PK
    uuid application_id FK
    text item_code
    text name
    text source_language
    text_array target_languages
    text status
  }
  catalog_values {
    uuid id PK
    uuid item_id FK
    uuid field_id FK
    text language_code
    text text_value
    text file_path "file in storage"
    text status
  }
  translation_memory {
    uuid id PK
    uuid application_id FK
    text source_language
    text target_language
    text source_text
    text translated_text
  }
  catalog_events {
    uuid id PK
    uuid item_id "no FK, kept after delete"
    uuid application_id
    text event
  }
  languages {
    text code PK
    text name
  }

  applications ||--o{ namespaces : "groups"
  namespaces ||--o{ translation_keys : "contains"
  applications ||--o{ translation_keys : "contains"
  translation_keys ||--o{ translations : "translated into"
  languages ||--o{ translations : "language"
  translations ||--o{ translation_versions : "history"
  applications ||--o{ catalog_fields : "defines"
  applications ||--o{ catalog_items : "contains"
  catalog_items ||--o{ catalog_values : "has"
  catalog_fields ||--o{ catalog_values : "field of"
  applications ||--o{ translation_memory : "remembers"
  catalog_items ||..o{ catalog_events : "audited by"
```
