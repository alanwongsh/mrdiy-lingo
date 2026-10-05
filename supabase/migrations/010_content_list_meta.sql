-- Market and who submitted the article, for the article list.
alter table content
  add column if not exists market text;

alter table content
  add column if not exists submitted_by_name text;

alter table content
  add column if not exists submitted_by_username text;

create index if not exists idx_content_app_market
  on content(application_id, market)
  where market is not null;
