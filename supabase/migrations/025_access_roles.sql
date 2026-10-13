-- Roles with permissions picked by hand, such as Translator or Reviewer.
-- Each application member holds one role. The job title on the account
-- (hub_users.ldap_role) is kept for display and no longer grants permissions.
-- Run after 012. Maintain roles from the Roles screen.

create table if not exists access_roles (
  id uuid primary key default uuidv7(),
  name text not null,
  description text not null default '',
  can_edit boolean not null default true,
  can_approve boolean not null default false,
  can_manage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists access_roles_name_lower
  on access_roles (lower(name));

insert into access_roles (name, description, can_edit, can_approve, can_manage)
select seed.name, seed.description, seed.can_edit, seed.can_approve, seed.can_manage
from (
  values
    ('Content writer', 'Writes articles and saves drafts.', true, false, false),
    ('Translator', 'Edits translations and saves drafts.', true, false, false),
    ('Reviewer', 'Edits and approves content.', true, true, false),
    ('Manager', 'Approves content and manages people on the application.', true, true, true)
) as seed(name, description, can_edit, can_approve, can_manage)
where not exists (
  select 1 from access_roles existing where lower(existing.name) = lower(seed.name)
);

alter table application_members
  add column if not exists access_role_id uuid references access_roles(id) on delete restrict;

create index if not exists application_members_access_role_id
  on application_members (access_role_id);

-- Keep what each member can do today: approvers become Reviewer, everyone else
-- becomes Content writer. Approval came from the job title group when one is set.
update application_members as members
set access_role_id = (
  select roles.id
  from access_roles as roles
  where lower(roles.name) = case
    when exists (
      select 1
      from hub_users as users
      join org_role_map as map
        on lower(map.ldap_role) = lower(btrim(users.ldap_role))
      where users.id = members.user_id
        and map.band = 'HOD'
    ) then 'reviewer'
    else 'content writer'
  end
)
where members.access_role_id is null;

drop trigger if exists trg_access_roles_updated_at on access_roles;
create trigger trg_access_roles_updated_at
  before update on access_roles
  for each row execute function set_updated_at();

alter table access_roles enable row level security;

drop policy if exists access_roles_all on access_roles;
create policy access_roles_all on access_roles
  for all using (true) with check (true);
