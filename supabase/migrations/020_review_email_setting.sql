-- Per-application switch for the review emails added in 019. On by default.
-- Safe to run more than once.

alter table applications
  add column if not exists notify_review_email boolean not null default true;

-- Same as 019, except an application with review emails switched off queues nothing.
create or replace function enqueue_article_review_notice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'REVIEW'
     and (tg_op = 'INSERT' or old.status is distinct from 'REVIEW') then
    if not exists (
      select 1 from applications
      where id = new.application_id and notify_review_email
    ) then
      return new;
    end if;
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
