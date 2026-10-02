-- Per-article intended translation languages (excludes source)
alter table content
  add column if not exists target_languages text[] not null default '{}';

create index if not exists idx_content_target_languages
  on content using gin (target_languages);

-- Backfill from existing translation rows (exclude source language)
update content c
set target_languages = coalesce((
  select array_agg(distinct ct.language_code order by ct.language_code)
  from content_translations ct
  where ct.content_id = c.id
    and ct.language_code is distinct from c.source_language
), '{}'::text[])
where coalesce(array_length(c.target_languages, 1), 0) = 0;
