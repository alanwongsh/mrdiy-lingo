-- Catalog: structured records translated field by field. Any team can use it: products (SKU)
-- for customs and retail, policy documents, campaigns. Each application defines its fields once
-- (product name, HS code, package text, user manual, ...) and names its records (item_label).
-- A record stores one value per field and language. Approved translations go into
-- translation_memory, so the same source text is translated once and reused across records.
-- Run after 023. Safe to run more than once.

-- 1. Third application model, and what a catalog calls one record.
alter table applications drop constraint if exists applications_model_type_check;
alter table applications
  add constraint applications_model_type_check
  check (model_type in ('STRING', 'CONTENT', 'CATALOG'));

alter table applications add column if not exists item_label text;

-- 2. Field definitions, one row per field per application.
create table if not exists catalog_fields (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  code text not null,
  label text not null,
  -- text: one line. long_text: paragraphs. code: same in every language (HS code).
  -- file / image: uploaded to storage, optionally one per language.
  field_type text not null default 'text'
    check (field_type in ('text', 'long_text', 'code', 'file', 'image')),
  translatable boolean not null default true,
  required boolean not null default false,
  sort_order integer not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, code)
);

create index if not exists idx_catalog_fields_app
  on catalog_fields (application_id, sort_order);

-- 3. One row per record, such as one SKU.
create table if not exists catalog_items (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  item_code text not null,
  name text not null default '',
  source_language text not null,
  target_languages text[] not null default '{}',
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'REVIEW', 'CHANGES_REQUESTED', 'APPROVED')),
  created_by_name text,
  created_by_username text,
  submitted_by_name text,
  submitted_by_username text,
  submitted_at timestamptz,
  approved_by_name text,
  approved_by_username text,
  approved_by_user_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, item_code)
);

create index if not exists idx_catalog_items_app_status
  on catalog_items (application_id, status, updated_at desc);

create index if not exists idx_catalog_items_app_updated
  on catalog_items (application_id, updated_at desc);

-- 4. One value per record, field, and language. The source language row is the original.
create table if not exists catalog_values (
  id uuid primary key default uuidv7(),
  item_id uuid not null references catalog_items(id) on delete cascade,
  field_id uuid not null references catalog_fields(id) on delete restrict,
  language_code text not null,
  text_value text not null default '',
  file_path text,
  file_name text,
  file_mime text,
  file_size integer,
  -- Source row: hash of its own text. Target row: hash of the source text it was written from.
  -- A target whose hash differs from the source row is out of date.
  source_hash text,
  status text not null default 'MISSING'
    check (status in ('MISSING', 'SYSTEM_GENERATED', 'MANUALLY_MODIFIED', 'APPROVED')),
  source_type text not null default 'MANUAL'
    check (source_type in ('SYSTEM', 'MANUAL', 'IMPORT', 'MEMORY')),
  approved_by_username text,
  approved_by_name text,
  approved_by_user_id uuid,
  approved_at timestamptz,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, field_id, language_code)
);

create index if not exists idx_catalog_values_field on catalog_values (field_id);

-- 5. Approved translations, keyed by a hash of the source text. Per application.
create table if not exists translation_memory (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  source_language text not null,
  target_language text not null,
  source_hash text not null,
  source_text text not null,
  translated_text text not null,
  approved_by_name text,
  approved_by_username text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, source_language, target_language, source_hash)
);

-- 6. Approval trail. No foreign key to catalog_items, so the history stays after a delete.
create table if not exists catalog_events (
  id uuid primary key default uuidv7(),
  item_id uuid not null,
  application_id uuid not null,
  item_code text not null default '',
  event text not null check (event in (
    'CREATED',
    'EDITED',
    'TRANSLATED',
    'SUBMITTED',
    'LANGUAGE_APPROVED',
    'APPROVED',
    'CHANGES_REQUESTED',
    'REOPENED',
    'DELETED'
  )),
  language_code text,
  from_status text,
  to_status text,
  comment text,
  detail jsonb not null default '{}'::jsonb,
  actor_name text not null,
  actor_username text,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_catalog_events_item on catalog_events (item_id, created_at desc);

create or replace function prevent_catalog_event_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'catalog_events is append-only';
end;
$$;

drop trigger if exists trg_catalog_events_append_only on catalog_events;
create trigger trg_catalog_events_append_only
  before update or delete on catalog_events
  for each row execute function prevent_catalog_event_change();

-- updated_at
drop trigger if exists trg_catalog_fields_updated_at on catalog_fields;
create trigger trg_catalog_fields_updated_at
  before update on catalog_fields for each row execute function set_updated_at();
drop trigger if exists trg_catalog_items_updated_at on catalog_items;
create trigger trg_catalog_items_updated_at
  before update on catalog_items for each row execute function set_updated_at();
drop trigger if exists trg_catalog_values_updated_at on catalog_values;
create trigger trg_catalog_values_updated_at
  before update on catalog_values for each row execute function set_updated_at();
drop trigger if exists trg_translation_memory_updated_at on translation_memory;
create trigger trg_translation_memory_updated_at
  before update on translation_memory for each row execute function set_updated_at();

-- Row-level security: same as the other tables. The server enforces access in code.
alter table catalog_fields enable row level security;
alter table catalog_items enable row level security;
alter table catalog_values enable row level security;
alter table translation_memory enable row level security;
alter table catalog_events enable row level security;

drop policy if exists catalog_fields_all on catalog_fields;
create policy catalog_fields_all on catalog_fields for all using (true) with check (true);
drop policy if exists catalog_items_all on catalog_items;
create policy catalog_items_all on catalog_items for all using (true) with check (true);
drop policy if exists catalog_values_all on catalog_values;
create policy catalog_values_all on catalog_values for all using (true) with check (true);
drop policy if exists translation_memory_all on translation_memory;
create policy translation_memory_all on translation_memory for all using (true) with check (true);
drop policy if exists catalog_events_all on catalog_events;
create policy catalog_events_all on catalog_events for all using (true) with check (true);

-- 7. Private bucket for catalog files and images, served through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('catalog-files', 'catalog-files', false, 4194304)
on conflict (id) do nothing;

drop policy if exists catalog_files_all on storage.objects;
create policy catalog_files_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'catalog-files')
  with check (bucket_id = 'catalog-files');
