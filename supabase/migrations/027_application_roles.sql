-- Each application keeps its own roles, so every department can shape its own
-- workflow. Roles with no application_id are the defaults: they are copied into
-- every new application, and the superadmin maintains them on the Roles screen.
-- Run after 026.

alter table access_roles
  add column if not exists application_id uuid references applications(id) on delete cascade,
  add column if not exists copied_from uuid references access_roles(id) on delete set null;

create index if not exists access_roles_application_id on access_roles (application_id);

-- Names are unique within an application, and within the defaults.
drop index if exists access_roles_name_lower;
create unique index if not exists access_roles_app_name_lower
  on access_roles (coalesce(application_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- New permission: maintain this application's roles. Managers had it implicitly.
insert into access_role_permissions (role_id, permission)
select role_id, 'roles.manage'
from access_role_permissions
where permission = 'people.manage'
on conflict do nothing;

-- Give every application its own copy of each default role.
insert into access_roles (name, description, application_id, copied_from)
select defaults.name, defaults.description, apps.id, defaults.id
from applications as apps
cross join access_roles as defaults
where defaults.application_id is null
  and not exists (
    select 1
    from access_roles as existing
    where existing.application_id = apps.id
      and lower(existing.name) = lower(defaults.name)
  );

insert into access_role_permissions (role_id, permission)
select copies.id, grants.permission
from access_roles as copies
join access_role_permissions as grants on grants.role_id = copies.copied_from
where copies.application_id is not null
on conflict do nothing;

-- Move each member onto their application's copy of the role they hold.
update application_members as members
set access_role_id = copies.id
from access_roles as copies
where copies.application_id = members.application_id
  and copies.copied_from = members.access_role_id;
