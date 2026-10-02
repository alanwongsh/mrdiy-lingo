-- Article CMS publishing metadata
alter table content
  add column if not exists slug text;

alter table content
  add column if not exists scheduled_publish_at timestamptz;

alter table content
  add column if not exists published_at timestamptz;

create unique index if not exists idx_content_app_slug
  on content(application_id, slug)
  where slug is not null and slug <> '';

create index if not exists idx_content_scheduled_publish
  on content(scheduled_publish_at)
  where scheduled_publish_at is not null;

create index if not exists idx_content_published_at
  on content(published_at)
  where published_at is not null;

-- Backfill slugs from titles for existing rows (best-effort, unique per app)
with ranked as (
  select
    id,
    application_id,
    lower(regexp_replace(regexp_replace(trim(title), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) as base_slug,
    row_number() over (
      partition by application_id,
        lower(regexp_replace(regexp_replace(trim(title), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
      order by created_at
    ) as rn
  from content
  where slug is null or slug = ''
)
update content c
set slug = case
  when r.rn = 1 then nullif(r.base_slug, '')
  else nullif(r.base_slug, '') || '-' || r.rn::text
end
from ranked r
where c.id = r.id;
