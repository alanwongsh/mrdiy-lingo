-- Application-scoped roles. HOD and Admin can approve.
-- Editors can edit and draft. Run after 010.
-- Existing approvers become HOD. Everyone else becomes Editor.

alter table application_members
  add column if not exists role text;

update application_members
set role = case when can_approve then 'HOD' else 'EDITOR' end
where role is null or btrim(role) = '';

alter table application_members
  alter column role set default 'EDITOR';

update application_members
set role = 'EDITOR'
where role is null;

alter table application_members
  alter column role set not null;

alter table application_members
  drop constraint if exists application_members_role_check;

alter table application_members
  add constraint application_members_role_check
  check (role in ('EDITOR', 'HOD', 'ADMIN'));

update application_members
set
  can_edit = true,
  can_approve = role in ('HOD', 'ADMIN');
