-- Map LDAP job titles onto permission groups.
-- Titles in the HOD group can approve. Every other title can edit and draft.
-- Run after 011. Add or move titles from the Roles screen; do not hard-code them.

create table if not exists org_role_map (
  id uuid primary key default uuidv7(),
  ldap_role text not null,
  band text not null default 'EDITOR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_role_map_band_check check (band in ('EDITOR', 'HOD'))
);

create unique index if not exists org_role_map_ldap_role_lower
  on org_role_map (lower(ldap_role));

alter table hub_users
  add column if not exists ldap_role text;

insert into org_role_map (ldap_role, band)
select seed.ldap_role, seed.band
from (
  values
    ('Executive', 'EDITOR'),
    ('Senior Executive', 'EDITOR'),
    ('HOD', 'HOD')
) as seed(ldap_role, band)
where not exists (
  select 1
  from org_role_map existing
  where lower(existing.ldap_role) = lower(seed.ldap_role)
);

-- People who could already approve keep a title in the HOD group.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'application_members'
      and column_name = 'role'
  ) then
    update hub_users as users
    set ldap_role = 'HOD'
    where users.ldap_role is null
      and exists (
        select 1
        from application_members as members
        where members.user_id = users.id
          and (
            members.can_approve = true
            or members.role in ('HOD', 'ADMIN')
          )
      );
  else
    update hub_users as users
    set ldap_role = 'HOD'
    where users.ldap_role is null
      and exists (
        select 1
        from application_members as members
        where members.user_id = users.id
          and members.can_approve = true
      );
  end if;
end $$;

drop trigger if exists trg_org_role_map_updated_at on org_role_map;
create trigger trg_org_role_map_updated_at
  before update on org_role_map
  for each row execute function set_updated_at();

alter table org_role_map enable row level security;

drop policy if exists org_role_map_all on org_role_map;
create policy org_role_map_all on org_role_map
  for all using (true) with check (true);
