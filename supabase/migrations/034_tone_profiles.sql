-- Writing tones: how a translation should read, such as Formal, Press, or Social.
-- Each application keeps its own tones. An article type can name a default tone, and an
-- article can choose its own. allow_adaptation lets machine translation reword and
-- restructure (transcreation) instead of keeping the source sentence by sentence.
-- Translations record the tone they were made with.
-- Managed with the settings.content_types permission. Run after 033. Safe to run more than once.

create table if not exists tone_profiles (
  id uuid primary key default uuidv7(),
  application_id uuid not null references applications(id) on delete cascade,
  code text not null,
  name text not null,
  instructions text not null default '',
  -- Language code -> extra guidance for that language, such as "use anda".
  language_notes jsonb not null default '{}'::jsonb,
  allow_adaptation boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, code)
);

create index if not exists idx_tone_profiles_app_status
  on tone_profiles(application_id, status, sort_order);

drop trigger if exists trg_tone_profiles_updated_at on tone_profiles;
create trigger trg_tone_profiles_updated_at
  before update on tone_profiles
  for each row execute function set_updated_at();

alter table tone_profiles enable row level security;

drop policy if exists tone_profiles_all on tone_profiles;
create policy tone_profiles_all on tone_profiles
  for all using (true) with check (true);

-- Tone codes, not keys: a tone that is removed or switched off simply stops applying.
alter table content_types add column if not exists default_tone text;
alter table content add column if not exists tone text;
alter table content_translations add column if not exists tone text;
alter table content_translations add column if not exists adapted boolean not null default false;

insert into tone_profiles (application_id, code, name, instructions, allow_adaptation, sort_order)
select a.id, seed.code, seed.name, seed.instructions, seed.allow_adaptation, seed.sort_order
from applications a
cross join (
  values
    (
      'FORMAL',
      'Formal',
      'Polite, professional register. Use the formal form of address. No slang, contractions, emoji, or exclamation marks.',
      false,
      0
    ),
    (
      'PRESS',
      'Press',
      'News style for a press release. Third person, factual, and neutral. Keep quotes, names, titles, figures, and dates exactly as written. No emoji or exclamation marks.',
      false,
      1
    ),
    (
      'SOCIAL',
      'Social media',
      'Friendly, short, and conversational, as a local brand would post. Short sentences are fine. Emoji and hashtags may be adapted to the target audience.',
      true,
      2
    )
) as seed(code, name, instructions, allow_adaptation, sort_order)
where a.model_type = 'CONTENT'
on conflict (application_id, code) do nothing;
