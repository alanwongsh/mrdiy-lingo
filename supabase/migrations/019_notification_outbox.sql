-- Email outbox. A trigger on content queues a notice whenever an article enters REVIEW,
-- whichever code path (server action, SQL function, import) moved it there.
-- /api/cron/notifications sends the queue; pg_cron calls it (see supabase/cron/notifications.sql).
-- Safe to run more than once.

create table if not exists notification_outbox (
  id uuid primary key default uuidv7(),
  kind text not null check (kind in ('ARTICLE_REVIEW')),
  content_id uuid not null references content(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts integer not null default 0,
  -- Recipients already emailed, so a retry only sends to the ones that failed.
  sent_to text[] not null default '{}',
  last_error text,
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_outbox_pending
  on notification_outbox (created_at)
  where status in ('PENDING', 'SENDING');

create index if not exists idx_notification_outbox_content
  on notification_outbox (content_id, kind, created_at desc);

drop trigger if exists trg_notification_outbox_updated_at on notification_outbox;
create trigger trg_notification_outbox_updated_at
  before update on notification_outbox
  for each row execute function set_updated_at();

alter table notification_outbox enable row level security;

drop policy if exists notification_outbox_all on notification_outbox;
create policy notification_outbox_all on notification_outbox
  for all using (true) with check (true);

-- Machine translation moves an article TRANSLATING -> REVIEW once per language, so a notice
-- that is still queued or was raised in the last 15 minutes covers the new one.
create or replace function enqueue_article_review_notice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'REVIEW'
     and (tg_op = 'INSERT' or old.status is distinct from 'REVIEW') then
    if not exists (
      select 1
      from notification_outbox
      where content_id = new.id
        and kind = 'ARTICLE_REVIEW'
        and (
          status in ('PENDING', 'SENDING')
          or created_at > now() - interval '15 minutes'
        )
    ) then
      insert into notification_outbox (kind, content_id)
      values ('ARTICLE_REVIEW', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_review_notice on content;
create trigger trg_content_review_notice
  after insert or update of status on content
  for each row execute function enqueue_article_review_notice();

-- Hands out a batch to one sender at a time. A SENDING row whose sender died is retried
-- after 10 minutes.
create or replace function claim_notification_outbox(p_limit integer default 20)
returns setof notification_outbox
language sql
set search_path = public
as $$
  update notification_outbox o
  set status = 'SENDING',
      locked_at = now(),
      attempts = o.attempts + 1
  where o.id in (
    select id
    from notification_outbox
    where status = 'PENDING'
       or (status = 'SENDING' and locked_at < now() - interval '10 minutes')
    order by created_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning o.*;
$$;
