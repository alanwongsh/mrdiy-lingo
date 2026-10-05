-- Users, application owners, and invited members.
-- Identity (email / employee ID / Joget username) is copied in from the embed
-- token. Lingo does not authenticate passwords. Run after 007.

create table if not exists hub_users (
  id uuid primary key default uuidv7(),
  username text,
  employee_id text,
  email text,
  display_name text not null,
  is_superadmin boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_users_has_identity check (
    username is not null or employee_id is not null or email is not null
  )
);

create unique index if not exists hub_users_username_lower
  on hub_users (lower(username))
  where username is not null;

create unique index if not exists hub_users_employee_id_lower
  on hub_users (lower(employee_id))
  where employee_id is not null;

create unique index if not exists hub_users_email_lower
  on hub_users (lower(email))
  where email is not null;

alter table applications
  add column if not exists owner_user_id uuid references hub_users(id) on delete set null;

create index if not exists idx_applications_owner_user_id
  on applications(owner_user_id);

create table if not exists application_members (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  user_id uuid not null references hub_users(id) on delete cascade,
  can_edit boolean not null default true,
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, user_id)
);

create index if not exists idx_application_members_user_id
  on application_members(user_id);

alter table content_translations
  add column if not exists approved_by_user_id uuid references hub_users(id) on delete set null;

alter table translations
  add column if not exists approved_by_user_id uuid references hub_users(id) on delete set null;

alter table content_translation_versions
  add column if not exists author_user_id uuid references hub_users(id) on delete set null;

alter table translation_versions
  add column if not exists author_user_id uuid references hub_users(id) on delete set null;

alter table article_comments
  add column if not exists author_user_id uuid references hub_users(id) on delete set null;

drop trigger if exists trg_hub_users_updated_at on hub_users;
create trigger trg_hub_users_updated_at
  before update on hub_users
  for each row execute function set_updated_at();

drop trigger if exists trg_application_members_updated_at on application_members;
create trigger trg_application_members_updated_at
  before update on application_members
  for each row execute function set_updated_at();

alter table hub_users enable row level security;
alter table application_members enable row level security;

drop policy if exists hub_users_all on hub_users;
create policy hub_users_all on hub_users
  for all using (true) with check (true);

drop policy if exists application_members_all on application_members;
create policy application_members_all on application_members
  for all using (true) with check (true);
