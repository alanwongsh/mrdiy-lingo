-- Each application keeps its own terminology list.
-- Existing shared words are removed, so every application starts with an empty list.
-- Run after 014. Safe to run more than once.

alter table terminology
  add column if not exists application_id uuid references applications(id) on delete cascade;

-- The old index made a word unique across all applications.
drop index if exists terminology_pair_term;
create unique index if not exists terminology_app_pair_term
  on terminology (application_id, lower(term), lower(source_language), lower(target_language));

drop index if exists idx_terminology_pair_active;
create index if not exists idx_terminology_app_pair_active
  on terminology (application_id, source_language, target_language)
  where is_active;

-- Shared words belong to no application. Every application starts with an empty list.
delete from terminology where application_id is null;

alter table terminology alter column application_id set not null;
