-- Map permissions to each role by hand instead of three fixed switches.
-- access_role_permissions holds which permissions (keys from
-- lib/auth/permissions.ts) each role has. Run after 025.
-- Each role keeps what it could do before:
--   edit    -> content.edit, content.import, settings.content_types, settings.terminology
--   approve -> adds content.approve, settings.notifications, settings.fields, settings.quality
--   manage  -> adds settings.general, people.manage
-- In 025, manage included approve and approve included edit.

create table if not exists access_role_permissions (
  role_id uuid not null references access_roles(id) on delete cascade,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'access_roles'
      and column_name = 'can_edit'
  ) then
    insert into access_role_permissions (role_id, permission)
    select roles.id, grants.permission
    from access_roles as roles
    cross join lateral (
      select permission
      from unnest(array[
        'content.edit', 'content.import', 'settings.content_types', 'settings.terminology'
      ]) as permission
      where roles.can_edit or roles.can_approve or roles.can_manage
      union all
      select permission
      from unnest(array[
        'content.approve', 'settings.notifications', 'settings.fields', 'settings.quality'
      ]) as permission
      where roles.can_approve or roles.can_manage
      union all
      select permission
      from unnest(array['settings.general', 'people.manage']) as permission
      where roles.can_manage
    ) as grants
    on conflict do nothing;

    alter table access_roles drop column can_edit;
    alter table access_roles drop column can_approve;
    alter table access_roles drop column can_manage;
  end if;
end $$;

update access_roles
set description = 'Approves content and manages people and settings on the application.'
where lower(name) = 'manager'
  and description = 'Approves content and manages people on the application.';

alter table access_role_permissions enable row level security;

drop policy if exists access_role_permissions_all on access_role_permissions;
create policy access_role_permissions_all on access_role_permissions
  for all using (true) with check (true);
