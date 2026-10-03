-- Article comments (one thread per article) and the person behind edits/approvals.
-- Run after 004.

create table if not exists article_comments (
  id uuid primary key default uuidv7(),
  content_id uuid not null references content(id) on delete cascade,
  language_code text,
  body text not null,
  author_username text not null,
  author_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_article_comments_content_created
  on article_comments(content_id, created_at);

alter table content_translations
  add column if not exists approved_by_username text,
  add column if not exists approved_by_name text,
  add column if not exists approved_at timestamptz;

alter table translations
  add column if not exists approved_by_username text,
  add column if not exists approved_by_name text,
  add column if not exists approved_at timestamptz;

alter table content_translation_versions
  add column if not exists author_username text;

alter table translation_versions
  add column if not exists author_username text;

alter table article_comments enable row level security;

drop policy if exists article_comments_all on article_comments;
create policy article_comments_all on article_comments
  for all using (true) with check (true);
