-- Each article language can have its own publish time, and an article that is live in some
-- languages but still waiting in others is PUBLISHING rather than PUBLISHED.
-- Safe to run more than once.

-- Language code (lower case) -> ISO time. A language without an entry uses content.scheduled_publish_at.
alter table content
  add column if not exists language_publish_at jsonb not null default '{}'::jsonb;

create index if not exists idx_content_language_publish_at
  on content using gin (language_publish_at);

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.content'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%PUBLISHED%'
  loop
    execute format('alter table content drop constraint %I', constraint_name);
  end loop;
end $$;

alter table content
  add constraint content_status_check
  check (status in ('DRAFT', 'TRANSLATING', 'REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED'));

-- Same as 014, except a PUBLISHING article also returns to REVIEW when a non-approver edits it.
-- Accept/ignore stay pending until this function commits the article and the actions together.
create or replace function commit_content_translation_quality(
  p_content_id uuid,
  p_language_code text,
  p_title text,
  p_summary text,
  p_body text,
  p_seo_title text,
  p_seo_description text,
  p_status text,
  p_source_type text,
  p_approved_by_username text,
  p_approved_by_name text,
  p_approved_by_user_id uuid,
  p_approved_at timestamptz,
  p_author text,
  p_author_username text,
  p_author_user_id uuid,
  p_approver boolean,
  p_quality_run_id uuid,
  p_accepted_action_ids uuid[],
  p_ignored_action_ids uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_article_status text;
  v_translation_id uuid;
  v_existing content_translations%rowtype;
  v_changed boolean;
  v_version integer;
  v_accepted uuid[];
  v_ignored uuid[];
  v_updated integer;
begin
  if p_language_code is null or btrim(p_language_code) = '' then
    raise exception 'Language is required';
  end if;
  if p_status not in ('MISSING', 'SYSTEM_GENERATED', 'MANUALLY_MODIFIED', 'APPROVED') then
    raise exception 'Invalid translation status';
  end if;
  if p_source_type not in ('SYSTEM', 'MANUAL', 'IMPORT') then
    raise exception 'Invalid source type';
  end if;

  v_accepted := coalesce(p_accepted_action_ids, '{}'::uuid[]);
  v_ignored := coalesce(p_ignored_action_ids, '{}'::uuid[]);

  if v_accepted && v_ignored then
    raise exception 'An action cannot be both accepted and ignored';
  end if;
  if cardinality(v_accepted) > 0 or cardinality(v_ignored) > 0 then
    if p_quality_run_id is null then
      raise exception 'A quality run is required to update review actions';
    end if;
  end if;

  select status into v_article_status
  from content
  where id = p_content_id
  for update;
  if not found then
    raise exception 'Article not found';
  end if;

  if cardinality(v_accepted) > 0 then
    perform 1
    from quality_actions
    where id = any(v_accepted)
    for update;

    if (
      select count(*)
      from quality_actions qa
      join quality_runs qr on qr.id = qa.quality_run_id
      where qa.id = any(v_accepted)
        and qa.status = 'pending'
        and qr.content_id = p_content_id
    ) <> cardinality(v_accepted) then
      raise exception 'Accepted actions must still be pending for this article';
    end if;
  end if;

  if cardinality(v_ignored) > 0 then
    perform 1
    from quality_actions
    where id = any(v_ignored)
    for update;

    if (
      select count(*)
      from quality_actions qa
      join quality_runs qr on qr.id = qa.quality_run_id
      where qa.id = any(v_ignored)
        and qa.status = 'pending'
        and qr.content_id = p_content_id
    ) <> cardinality(v_ignored) then
      raise exception 'Ignored actions must still be pending for this article';
    end if;
  end if;

  select * into v_existing
  from content_translations
  where content_id = p_content_id
    and language_code = p_language_code
  for update;

  if found then
    v_translation_id := v_existing.id;
    v_changed :=
      v_existing.title is distinct from p_title
      or v_existing.summary is distinct from p_summary
      or v_existing.body is distinct from p_body
      or v_existing.seo_title is distinct from p_seo_title
      or v_existing.seo_description is distinct from p_seo_description
      or v_existing.status is distinct from p_status;

    if v_changed then
      update content_translations
      set
        title = p_title,
        summary = p_summary,
        body = p_body,
        seo_title = p_seo_title,
        seo_description = p_seo_description,
        status = p_status,
        approved_by_username = p_approved_by_username,
        approved_by_name = p_approved_by_name,
        approved_by_user_id = p_approved_by_user_id,
        approved_at = p_approved_at
      where id = v_translation_id;
    end if;
  else
    v_changed := true;
    insert into content_translations (
      content_id,
      language_code,
      title,
      summary,
      body,
      seo_title,
      seo_description,
      status,
      approved_by_username,
      approved_by_name,
      approved_by_user_id,
      approved_at
    ) values (
      p_content_id,
      p_language_code,
      p_title,
      p_summary,
      p_body,
      p_seo_title,
      p_seo_description,
      p_status,
      p_approved_by_username,
      p_approved_by_name,
      p_approved_by_user_id,
      p_approved_at
    )
    returning id into v_translation_id;
  end if;

  if v_changed then
    select coalesce(max(version_number), 0) + 1
    into v_version
    from content_translation_versions
    where content_translation_id = v_translation_id;

    insert into content_translation_versions (
      content_translation_id,
      version_number,
      translated_content,
      source_type,
      author,
      modifier,
      author_username,
      author_user_id
    ) values (
      v_translation_id,
      v_version,
      jsonb_build_object(
        'title', p_title,
        'summary', p_summary,
        'body', p_body,
        'seo_title', p_seo_title,
        'seo_description', p_seo_description
      ),
      p_source_type,
      p_author,
      p_author,
      p_author_username,
      p_author_user_id
    );
  end if;

  if cardinality(v_accepted) > 0 then
    update quality_actions
    set status = 'applied', applied_at = now()
    where id = any(v_accepted)
      and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated <> cardinality(v_accepted) then
      raise exception 'Could not apply every accepted action';
    end if;
  end if;

  if cardinality(v_ignored) > 0 then
    update quality_actions
    set status = 'ignored'
    where id = any(v_ignored)
      and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated <> cardinality(v_ignored) then
      raise exception 'Could not ignore every selected action';
    end if;
  end if;

  if not p_approver and v_changed and v_article_status in ('APPROVED', 'PUBLISHING', 'PUBLISHED') then
    update content
    set status = 'REVIEW'
    where id = p_content_id;
  end if;

  return v_translation_id;
end;
$$;
