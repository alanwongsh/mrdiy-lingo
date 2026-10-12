-- Each application keeps its own on/off and share for each quality check.
-- quality_categories stays the shared list of checks; its enabled and weight are the
-- defaults for an application that has not saved its own setting.
-- Run after 021. Safe to run more than once.

create table if not exists application_quality_settings (
  application_id uuid not null references applications(id) on delete cascade,
  category_id uuid not null references quality_categories(id) on delete cascade,
  enabled boolean not null,
  weight integer not null check (weight between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (application_id, category_id)
);

drop trigger if exists trg_application_quality_settings_updated_at on application_quality_settings;
create trigger trg_application_quality_settings_updated_at
  before update on application_quality_settings
  for each row execute function set_updated_at();

alter table application_quality_settings enable row level security;

drop policy if exists application_quality_settings_all on application_quality_settings;
create policy application_quality_settings_all on application_quality_settings
  for all using (true) with check (true);

-- Keep what every application sees today: copy the current shared settings to each one.
insert into application_quality_settings (application_id, category_id, enabled, weight)
select
  a.id,
  c.id,
  c.enabled,
  greatest(1, least(100, coalesce(round((c.configuration->>'weight')::numeric)::integer, 1)))
from applications a
cross join quality_categories c
on conflict (application_id, category_id) do nothing;
