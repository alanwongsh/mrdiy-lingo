-- pg_cron jobs that call Lingo's cron routes through pg_net.
-- Not a migration: db:migrate does not run this. Run it once per environment in the
-- Supabase SQL editor after 019_notification_outbox.sql, with your own values below.
-- Re-running is safe: cron.schedule replaces a job with the same name.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Store the app URL and CRON_SECRET in Vault (once). Use the same CRON_SECRET as the app env.
--    To change one later: select vault.update_secret(id, '<new value>') using the id from vault.secrets.
-- select vault.create_secret('https://<your-lingo-host>', 'lingo_app_url');
-- select vault.create_secret('<CRON_SECRET>', 'lingo_cron_secret');

-- 2. Review emails: every minute, and only calls the app when something is queued.
select cron.schedule(
  'lingo-notifications',
  '* * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lingo_app_url')
      || '/api/cron/notifications',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lingo_cron_secret')
    ),
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from public.notification_outbox where status in ('PENDING', 'SENDING')
  );
  $job$
);

-- 3. Optional: scheduled publishing, replacing the Vercel cron in vercel.json.
--    00:00 UTC is 08:00 Malaysia time.
-- select cron.schedule(
--   'lingo-publish',
--   '0 0 * * *',
--   $job$
--   select net.http_get(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'lingo_app_url')
--       || '/api/cron/publish',
--     headers := jsonb_build_object(
--       'Authorization',
--       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lingo_cron_secret')
--     ),
--     timeout_milliseconds := 55000
--   );
--   $job$
-- );

-- Check on it:
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 20;
-- select id, status_code, content from net._http_response order by created desc limit 20;
-- select status, attempts, last_error, sent_to from notification_outbox order by created_at desc limit 20;
