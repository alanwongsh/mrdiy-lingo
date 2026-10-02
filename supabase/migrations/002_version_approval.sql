-- Approval lives on each language translation row (translations.status /
-- content_translations.status), not on version history.
-- Safe to run even if is_approved was never added.

drop index if exists idx_translation_versions_approved;
drop index if exists idx_content_translation_versions_approved;

alter table translation_versions
  drop column if exists is_approved;

alter table content_translation_versions
  drop column if exists is_approved;
