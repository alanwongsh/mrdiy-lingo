-- Index cleanup from the review in docs/erd.md section 6.5.
-- 1. Drops indexes that repeat a unique constraint on the same columns.
-- 2. Indexes foreign keys that had no index starting with them, so deleting
--    the parent row or joining from it no longer scans the child table.
-- Run after 029. Safe to run more than once.

-- 1. Each unique constraint from 001 already has its own index.
drop index if exists idx_translation_keys_app_key;
drop index if exists idx_translations_key_lang;
drop index if exists idx_translation_versions_tid_ver;
drop index if exists idx_content_translations_cid_lang;
drop index if exists idx_content_translation_versions_ctid_ver;

-- 2. Foreign keys that cascade or are joined on.
create index if not exists idx_translation_keys_namespace
  on translation_keys (namespace_id);

create index if not exists idx_quality_runs_content_translation
  on quality_runs (content_translation_id)
  where content_translation_id is not null;

create index if not exists idx_quality_scores_category
  on quality_scores (category_id)
  where category_id is not null;

create index if not exists idx_quality_findings_score
  on quality_findings (quality_score_id)
  where quality_score_id is not null;

create index if not exists idx_quality_actions_finding
  on quality_actions (finding_id);

create index if not exists idx_content_publications_vendor
  on content_publications (vendor_id);

create index if not exists idx_application_quality_settings_category
  on application_quality_settings (category_id);

create index if not exists idx_access_roles_copied_from
  on access_roles (copied_from)
  where copied_from is not null;

-- User foreign keys, set to null when a user is deleted.
create index if not exists idx_content_translations_approved_by
  on content_translations (approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists idx_translations_approved_by
  on translations (approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists idx_content_translation_versions_author
  on content_translation_versions (author_user_id)
  where author_user_id is not null;

create index if not exists idx_translation_versions_author
  on translation_versions (author_user_id)
  where author_user_id is not null;

create index if not exists idx_article_comments_author
  on article_comments (author_user_id)
  where author_user_id is not null;

create index if not exists idx_email_templates_updated_by
  on email_templates (updated_by)
  where updated_by is not null;
