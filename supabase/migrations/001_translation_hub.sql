-- Translation Hub V1 schema
-- Run in Supabase SQL Editor if not applied automatically.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Time-ordered UUID v7. New primary keys append in the B-tree instead of
-- scattering like gen_random_uuid() (v4).
create or replace function uuidv7()
returns uuid
language plpgsql
volatile
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(
    int8send((extract(epoch from clock_timestamp()) * 1000)::bigint)
    from 3
  );
  uuid_bytes := overlay(
    uuid_send(gen_random_uuid())
    placing unix_ts_ms
    from 1 for 6
  );
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  return encode(uuid_bytes, 'hex')::uuid;
end
$$;

-- Enums (as text + check for flexibility)
-- applications.model_type: STRING | CONTENT
-- status fields use text with checks

create table if not exists languages (
  id uuid primary key default uuidv7(),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists applications (
  id uuid primary key default uuidv7(),
  name text not null unique,
  description text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  model_type text not null check (model_type in ('STRING', 'CONTENT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists namespaces (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, name)
);

create table if not exists translation_keys (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  namespace_id uuid not null references namespaces(id) on delete cascade,
  key text not null,
  source_language text not null,
  source_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, key)
);

create table if not exists translations (
  id uuid primary key default uuidv7(),
  translation_key_id uuid not null references translation_keys(id) on delete cascade,
  language_code text not null references languages(code),
  current_text text not null default '',
  status text not null default 'MISSING'
    check (status in ('MISSING', 'SYSTEM_GENERATED', 'MANUALLY_MODIFIED', 'APPROVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (translation_key_id, language_code)
);

create table if not exists translation_versions (
  id uuid primary key default uuidv7(),
  translation_id uuid not null references translations(id) on delete cascade,
  version_number integer not null,
  translated_content text not null default '',
  source_type text not null check (source_type in ('SYSTEM', 'MANUAL', 'IMPORT')),
  author text,
  modifier text,
  created_by uuid,
  modified_by uuid,
  created_at timestamptz not null default now(),
  unique (translation_id, version_number)
);

create table if not exists content (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  content_type text not null default 'ARTICLE'
    check (content_type in ('ARTICLE', 'NEWS', 'ANNOUNCEMENT')),
  title text not null,
  source_language text not null,
  source_content jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'TRANSLATING', 'REVIEW', 'APPROVED', 'PUBLISHED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_translations (
  id uuid primary key default uuidv7(),
  content_id uuid not null references content(id) on delete cascade,
  language_code text not null references languages(code),
  title text not null default '',
  summary text not null default '',
  body text not null default '',
  seo_title text not null default '',
  seo_description text not null default '',
  status text not null default 'MISSING'
    check (status in ('MISSING', 'SYSTEM_GENERATED', 'MANUALLY_MODIFIED', 'APPROVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, language_code)
);

create table if not exists content_translation_versions (
  id uuid primary key default uuidv7(),
  content_translation_id uuid not null references content_translations(id) on delete cascade,
  version_number integer not null,
  translated_content jsonb not null default '{}'::jsonb,
  source_type text not null check (source_type in ('SYSTEM', 'MANUAL', 'IMPORT')),
  author text,
  modifier text,
  created_by uuid,
  modified_by uuid,
  created_at timestamptz not null default now(),
  unique (content_translation_id, version_number)
);

-- Indexes
create index if not exists idx_namespaces_application_id on namespaces(application_id);
create index if not exists idx_translation_keys_app_key on translation_keys(application_id, key);
create index if not exists idx_translation_keys_app_ns on translation_keys(application_id, namespace_id);
create index if not exists idx_translation_keys_key_trgm on translation_keys using gin (key gin_trgm_ops);
create index if not exists idx_translations_key_lang on translations(translation_key_id, language_code);
create index if not exists idx_translations_status on translations(status);
create index if not exists idx_translation_versions_tid_ver on translation_versions(translation_id, version_number);
create index if not exists idx_content_app_status on content(application_id, status);
create index if not exists idx_content_title on content(application_id, title);
create index if not exists idx_content_translations_cid_lang on content_translations(content_id, language_code);
create index if not exists idx_content_translation_versions_ctid_ver
  on content_translation_versions(content_translation_id, version_number);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'languages','applications','namespaces','translation_keys',
    'translations','content','content_translations'
  ]
  loop
    execute format(
      'drop trigger if exists trg_%s_updated_at on %I; create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at();',
      t, t, t, t
    );
  end loop;
end $$;

-- V1: open access (no auth). Tighten with RLS when auth is added.
alter table languages enable row level security;
alter table applications enable row level security;
alter table namespaces enable row level security;
alter table translation_keys enable row level security;
alter table translations enable row level security;
alter table translation_versions enable row level security;
alter table content enable row level security;
alter table content_translations enable row level security;
alter table content_translation_versions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'languages','applications','namespaces','translation_keys','translations',
    'translation_versions','content','content_translations','content_translation_versions'
  ]
  loop
    execute format('drop policy if exists %I_all on %I', t || '_all', t);
    execute format(
      'create policy %I on %I for all using (true) with check (true)',
      t || '_all', t
    );
  end loop;
end $$;

-- Seed languages
insert into languages (code, name, status) values
  ('en', 'English', 'ACTIVE'),
  ('ms', 'Bahasa Malaysia', 'ACTIVE'),
  ('th', 'Thai', 'ACTIVE'),
  ('id', 'Indonesian', 'ACTIVE'),
  ('zh-Hans', 'Chinese Simplified', 'ACTIVE'),
  ('zh-Hant', 'Chinese Traditional', 'ACTIVE')
on conflict (code) do nothing;

-- Seed applications
insert into applications (name, description, status, model_type) values
  ('Product', 'Product-related translations used by product applications.', 'ACTIVE', 'STRING'),
  ('Press', 'News and article content that requires multilingual publishing.', 'ACTIVE', 'CONTENT')
on conflict (name) do nothing;
