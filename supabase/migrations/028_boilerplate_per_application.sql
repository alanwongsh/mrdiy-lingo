-- Each application keeps its own boilerplate: standard passages, such as the
-- company introduction, that a translation must keep word for word.
-- The shared phrases are copied into every CONTENT application, then removed.
-- Adds the settings.boilerplate permission to every role that can edit terminology.
-- Run after 027. Safe to run more than once.

alter table boilerplate_phrases
  add column if not exists application_id uuid references applications(id) on delete cascade;

-- The old index made a name unique across all applications.
drop index if exists boilerplate_name_language;

insert into boilerplate_phrases (application_id, name, language, phrase, expected_usage, is_active)
select apps.id, shared.name, shared.language, shared.phrase, shared.expected_usage, shared.is_active
from applications as apps
cross join boilerplate_phrases as shared
where apps.model_type = 'CONTENT'
  and shared.application_id is null
  and not exists (
    select 1
    from boilerplate_phrases as existing
    where existing.application_id = apps.id
      and lower(existing.name) = lower(shared.name)
      and lower(existing.language) = lower(shared.language)
  );

delete from boilerplate_phrases where application_id is null;

alter table boilerplate_phrases alter column application_id set not null;

create unique index if not exists boilerplate_app_name_language
  on boilerplate_phrases (application_id, lower(name), lower(language));

create index if not exists idx_boilerplate_app_active
  on boilerplate_phrases (application_id)
  where is_active;

insert into access_role_permissions (role_id, permission)
select role_id, 'settings.boilerplate'
from access_role_permissions
where permission = 'settings.terminology'
on conflict do nothing;
