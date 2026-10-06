-- Per-application content types. The code is stable; the name is the label.

create table if not exists content_types (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, code)
);

create index if not exists idx_content_types_app_status
  on content_types(application_id, status, sort_order);

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'content'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%content_type%'
  loop
    execute format('alter table content drop constraint %I', r.conname);
  end loop;
end $$;

alter table content alter column content_type set default 'GENERAL';

insert into content_types (application_id, code, name, description, status, sort_order)
select a.id, 'GENERAL', 'General', '', 'ACTIVE', 0
from applications a
where a.model_type = 'CONTENT'
on conflict (application_id, code) do nothing;

insert into content_types (application_id, code, name, description, status, sort_order)
select
  c.application_id,
  c.content_type,
  initcap(replace(lower(c.content_type), '_', ' ')),
  '',
  'ACTIVE',
  10
from content c
where btrim(c.content_type) <> ''
  and c.content_type <> 'GENERAL'
group by c.application_id, c.content_type
on conflict (application_id, code) do nothing;

alter table content drop constraint if exists content_content_type_fkey;

alter table content
  add constraint content_content_type_fkey
  foreign key (application_id, content_type)
  references content_types (application_id, code)
  on update cascade
  on delete restrict
  deferrable initially deferred;

drop trigger if exists trg_content_types_updated_at on content_types;
create trigger trg_content_types_updated_at
  before update on content_types
  for each row execute function set_updated_at();

alter table content_types enable row level security;

drop policy if exists content_types_all on content_types;
create policy content_types_all on content_types
  for all using (true) with check (true);
