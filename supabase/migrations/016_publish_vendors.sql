-- Per-application publish vendors, the vendors chosen on an article, and each delivery.

create table if not exists publish_vendors (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  name text not null,
  type_code text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Earlier drafts stored one webhook URL and one secret. Each integration type
-- now keeps its own credentials in config.
alter table publish_vendors add column if not exists type_code text;
alter table publish_vendors add column if not exists config jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publish_vendors'
      and column_name = 'endpoint_url'
  ) then
    execute $migrate$
      update publish_vendors
      set
        type_code = coalesce(type_code, 'webhook_site'),
        config = coalesce(
          config,
          jsonb_build_object(
            'url', coalesce(endpoint_url, ''),
            'apiKey', coalesce(secret, '')
          )
        )
      where type_code is null or config is null
    $migrate$;
    alter table publish_vendors drop column if exists endpoint_url;
    alter table publish_vendors drop column if exists secret;
    alter table publish_vendors drop column if exists provider;
  end if;
end $$;

update publish_vendors set type_code = 'webhook_site' where type_code is null;
update publish_vendors set config = '{}'::jsonb where config is null;
alter table publish_vendors alter column type_code set not null;
alter table publish_vendors alter column config set default '{}'::jsonb;
alter table publish_vendors alter column config set not null;

create unique index if not exists idx_publish_vendors_app_name
  on publish_vendors (application_id, lower(name));

create index if not exists idx_publish_vendors_app_status
  on publish_vendors (application_id, status);

create table if not exists content_publish_targets (
  content_id uuid not null references content(id) on delete cascade,
  language_code text not null,
  vendor_id uuid not null references publish_vendors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (content_id, language_code, vendor_id)
);

create index if not exists idx_content_publish_targets_vendor
  on content_publish_targets (vendor_id);

create table if not exists content_publications (
  id uuid primary key default uuidv7(),
  content_id uuid not null references content(id) on delete cascade,
  vendor_id uuid not null references publish_vendors(id) on delete cascade,
  language_code text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PUBLISHED', 'FAILED')),
  external_url text,
  error_message text,
  published_at timestamptz,
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, vendor_id, language_code)
);

create index if not exists idx_content_publications_content
  on content_publications (content_id, status);

drop trigger if exists trg_publish_vendors_updated_at on publish_vendors;
create trigger trg_publish_vendors_updated_at
  before update on publish_vendors
  for each row execute function set_updated_at();

drop trigger if exists trg_content_publications_updated_at on content_publications;
create trigger trg_content_publications_updated_at
  before update on content_publications
  for each row execute function set_updated_at();

alter table publish_vendors enable row level security;
alter table content_publish_targets enable row level security;
alter table content_publications enable row level security;

drop policy if exists publish_vendors_all on publish_vendors;
create policy publish_vendors_all on publish_vendors
  for all using (true) with check (true);

drop policy if exists content_publish_targets_all on content_publish_targets;
create policy content_publish_targets_all on content_publish_targets
  for all using (true) with check (true);

drop policy if exists content_publications_all on content_publications;
create policy content_publications_all on content_publications
  for all using (true) with check (true);
