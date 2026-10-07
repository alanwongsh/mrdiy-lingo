-- One quality analysis per saved translation version.
alter table quality_runs
  add column if not exists content_translation_version_id uuid
  references content_translation_versions(id) on delete cascade;

create unique index if not exists quality_runs_one_per_version
  on quality_runs (content_translation_version_id)
  where content_translation_version_id is not null;
