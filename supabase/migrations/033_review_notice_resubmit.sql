-- Same as 020, without the 15-minute window. It was there for machine translation moving an
-- article TRANSLATING -> REVIEW once per language; nothing sets TRANSLATING now, and the window
-- swallowed the email when an editor resubmitted a revoked article soon after the last one.
-- A notice still queued or sending covers the new one.
-- Safe to run more than once.

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
        and status in ('PENDING', 'SENDING')
    ) then
      insert into notification_outbox (kind, content_id)
      values ('ARTICLE_REVIEW', new.id);
    end if;
  end if;
  return new;
end;
$$;
