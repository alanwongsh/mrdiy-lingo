-- Each article language can be sent to its own providers.
-- Safe to run after 016, including when 016 already created these columns.

alter table content_publish_targets add column if not exists language_code text;
alter table content_publications add column if not exists language_code text;

do $$
declare
  target_key text;
begin
  select pg_get_constraintdef(oid)
    into target_key
  from pg_constraint
  where conrelid = 'public.content_publish_targets'::regclass
    and contype = 'p';

  if target_key is null or target_key not ilike '%language_code%' then
    delete from content_publish_targets where language_code is null;
    if target_key is not null then
      alter table content_publish_targets drop constraint content_publish_targets_pkey;
    end if;
    alter table content_publish_targets alter column language_code set not null;
    alter table content_publish_targets
      add primary key (content_id, language_code, vendor_id);
  end if;
end $$;

delete from content_publications where language_code is null;
alter table content_publications alter column language_code set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.content_publications'::regclass
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) not ilike '%language_code%'
  loop
    execute format('alter table content_publications drop constraint %I', constraint_name);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.content_publications'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%language_code%'
  ) then
    alter table content_publications
      add constraint content_publications_content_vendor_language_key
      unique (content_id, vendor_id, language_code);
  end if;
end $$;
