-- Business units: per-application groups of markets. A member sees and works on articles
-- only in the markets of their business units. Owners and superadmins see every market.
-- 1. Every article gets a market. Articles without one become MY, and market is required.
-- 2. business_units: name plus a market list, or all_markets for every market.
-- 3. application_member_business_units: which units a member is in. The UI allows one
--    per member for now; the table allows several, and access is the union of them.
-- 4. Every article application gets an "All countries" unit holding its current members,
--    so nobody loses access when this runs.
-- Run after 031. Safe to run more than once.

-- 1. Market is required.
update content set market = 'MY' where market is null or btrim(market) = '';
alter table content alter column market set not null;

-- 2. Business units.
create table if not exists business_units (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  name text not null,
  description text not null default '',
  -- True covers every market, including ones added later. markets is ignored then.
  all_markets boolean not null default false,
  markets text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_business_units_app_name
  on business_units (application_id, lower(name));

drop trigger if exists trg_business_units_updated_at on business_units;
create trigger trg_business_units_updated_at
  before update on business_units
  for each row execute function set_updated_at();

alter table business_units enable row level security;
drop policy if exists business_units_all on business_units;
create policy business_units_all on business_units
  for all using (true) with check (true);

-- 3. Members in units.
create table if not exists application_member_business_units (
  member_id uuid not null references application_members(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, business_unit_id)
);

create index if not exists idx_member_business_units_unit
  on application_member_business_units (business_unit_id);

alter table application_member_business_units enable row level security;
drop policy if exists application_member_business_units_all on application_member_business_units;
create policy application_member_business_units_all on application_member_business_units
  for all using (true) with check (true);

-- 4. Keep current access: one "All countries" unit per article application, with every
--    member who is not in a unit yet.
insert into business_units (application_id, name, description, all_markets)
select a.id, 'All countries', 'Every market. Created when business units were added.', true
from applications a
where a.model_type = 'CONTENT'
on conflict do nothing;

insert into application_member_business_units (member_id, business_unit_id)
select m.id, u.id
from application_members m
join applications a on a.id = m.application_id and a.model_type = 'CONTENT'
join business_units u on u.application_id = a.id and lower(u.name) = 'all countries'
where not exists (
  select 1 from application_member_business_units x where x.member_id = m.id
)
on conflict do nothing;
