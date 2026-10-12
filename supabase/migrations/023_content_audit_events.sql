-- Article audit trail: one row per status change, translation approval, edit, or delete,
-- with the person behind it. The app writes these rows; "System" means a scheduled run.
-- No foreign key to content, so the history stays after an article is deleted.
-- Rows are append-only. Run after 022. Safe to run more than once.

create table if not exists content_audit_events (
  id uuid primary key default uuidv7(),
  content_id uuid not null,
  application_id uuid not null,
  content_title text not null default '',
  event text not null check (event in (
    'CREATED',
    'STATUS_CHANGED',
    'EDITED',
    'TRANSLATION_SAVED',
    'TRANSLATION_APPROVED',
    'TRANSLATION_UNAPPROVED',
    'DELETED'
  )),
  language_code text,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  actor_username text,
  actor_name text not null,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_audit_events_content
  on content_audit_events (content_id, created_at desc);

create index if not exists idx_content_audit_events_app
  on content_audit_events (application_id, created_at desc);

create or replace function prevent_content_audit_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'content_audit_events is append-only';
end;
$$;

drop trigger if exists trg_content_audit_events_append_only on content_audit_events;
create trigger trg_content_audit_events_append_only
  before update or delete on content_audit_events
  for each row execute function prevent_content_audit_change();

alter table content_audit_events enable row level security;

drop policy if exists content_audit_events_all on content_audit_events;
create policy content_audit_events_all on content_audit_events
  for all using (true) with check (true);
