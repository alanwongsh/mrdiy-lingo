-- Translation quality runs, dynamic categories, terminology, and boilerplate.
-- Run after 013. Safe to re-run.

create table if not exists quality_categories (
  id uuid primary key default uuidv7(),
  code text not null unique,
  name text not null,
  description text not null default '',
  category_type text not null check (category_type in ('ai', 'rule')),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  provider text,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists terminology (
  id uuid primary key default uuidv7(),
  term text not null,
  definition text not null default '',
  description text not null default '',
  source_language text not null,
  target_language text not null,
  preferred_translation text not null default '',
  forbidden_translations text[] not null default '{}',
  category text not null default '',
  context text not null default '',
  example text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists terminology_pair_term
  on terminology (lower(term), lower(source_language), lower(target_language));

create index if not exists idx_terminology_pair_active
  on terminology (source_language, target_language)
  where is_active;

create table if not exists boilerplate_phrases (
  id uuid primary key default uuidv7(),
  name text not null,
  language text not null,
  phrase text not null,
  expected_usage text not null default 'when_source_present',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists boilerplate_name_language
  on boilerplate_phrases (lower(name), lower(language));

create table if not exists quality_runs (
  id uuid primary key default uuidv7(),
  content_id uuid not null references content(id) on delete cascade,
  content_translation_id uuid references content_translations(id) on delete set null,
  provider text not null,
  model text,
  source_language text not null,
  target_language text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  overall_score numeric(5,2),
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_quality_runs_content_created
  on quality_runs (content_id, target_language, created_at desc);

create table if not exists quality_scores (
  id uuid primary key default uuidv7(),
  quality_run_id uuid not null references quality_runs(id) on delete cascade,
  category_id uuid references quality_categories(id) on delete set null,
  category_code text not null,
  score numeric(5,2),
  severity text check (severity is null or severity in ('excellent', 'good', 'warning', 'critical')),
  summary text not null default '',
  error_message text,
  created_at timestamptz not null default now(),
  check (score is null or (score >= 0 and score <= 100))
);

create index if not exists idx_quality_scores_run
  on quality_scores (quality_run_id);

create table if not exists quality_findings (
  id uuid primary key default uuidv7(),
  quality_run_id uuid not null references quality_runs(id) on delete cascade,
  quality_score_id uuid references quality_scores(id) on delete set null,
  category_code text not null,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  title text not null,
  explanation text not null default '',
  source_text text,
  translated_text text,
  suggested_text text,
  target_field text check (target_field is null or target_field in ('title', 'summary', 'content')),
  start_offset integer,
  end_offset integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_quality_findings_run
  on quality_findings (quality_run_id);

create table if not exists quality_actions (
  id uuid primary key default uuidv7(),
  quality_run_id uuid not null references quality_runs(id) on delete cascade,
  finding_id uuid not null references quality_findings(id) on delete cascade,
  action_type text not null check (action_type in ('replace', 'insert', 'delete', 'rewrite')),
  target_field text not null check (target_field in ('title', 'summary', 'content')),
  description text not null default '',
  original_text text,
  proposed_text text,
  start_offset integer,
  end_offset integer,
  status text not null default 'pending' check (status in ('pending', 'applied', 'ignored')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_quality_actions_run_status
  on quality_actions (quality_run_id, status);

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

  if not p_approver and v_changed and v_article_status in ('APPROVED', 'PUBLISHED') then
    update content
    set status = 'REVIEW'
    where id = p_content_id;
  end if;

  return v_translation_id;
end;
$$;

drop trigger if exists trg_quality_categories_updated_at on quality_categories;
create trigger trg_quality_categories_updated_at
  before update on quality_categories
  for each row execute function set_updated_at();

drop trigger if exists trg_terminology_updated_at on terminology;
create trigger trg_terminology_updated_at
  before update on terminology
  for each row execute function set_updated_at();

drop trigger if exists trg_boilerplate_phrases_updated_at on boilerplate_phrases;
create trigger trg_boilerplate_phrases_updated_at
  before update on boilerplate_phrases
  for each row execute function set_updated_at();

alter table quality_categories enable row level security;
alter table terminology enable row level security;
alter table boilerplate_phrases enable row level security;
alter table quality_runs enable row level security;
alter table quality_scores enable row level security;
alter table quality_findings enable row level security;
alter table quality_actions enable row level security;

drop policy if exists quality_categories_all on quality_categories;
create policy quality_categories_all on quality_categories
  for all using (true) with check (true);

drop policy if exists terminology_all on terminology;
create policy terminology_all on terminology
  for all using (true) with check (true);

drop policy if exists boilerplate_phrases_all on boilerplate_phrases;
create policy boilerplate_phrases_all on boilerplate_phrases
  for all using (true) with check (true);

drop policy if exists quality_runs_all on quality_runs;
create policy quality_runs_all on quality_runs
  for all using (true) with check (true);

drop policy if exists quality_scores_all on quality_scores;
create policy quality_scores_all on quality_scores
  for all using (true) with check (true);

drop policy if exists quality_findings_all on quality_findings;
create policy quality_findings_all on quality_findings
  for all using (true) with check (true);

drop policy if exists quality_actions_all on quality_actions;
create policy quality_actions_all on quality_actions
  for all using (true) with check (true);

insert into quality_categories (code, name, description, category_type, enabled, sort_order, configuration)
values
  (
    'message',
    'Message',
    'Whether the translation preserves the meaning and key information of the source.',
    'ai',
    true,
    10,
    '{"weight":20}'::jsonb
  ),
  (
    'tone',
    'Tone',
    'Whether the translation preserves the source tone, such as professional, promotional, neutral, friendly, or formal.',
    'ai',
    true,
    20,
    '{"weight":15}'::jsonb
  ),
  (
    'structure',
    'Structure',
    'Whether paragraph structure, headings, ordering, emphasis, and logical flow are preserved.',
    'ai',
    true,
    30,
    '{"weight":15}'::jsonb
  ),
  (
    'cross_language',
    'Cross-language',
    'Missing information, added information, changed meaning, mistranslation, and excessive paraphrasing. Prioritize semantic accuracy.',
    'ai',
    true,
    40,
    '{"weight":25}'::jsonb
  ),
  (
    'terminology',
    'Terminology',
    'Preferred, forbidden, missing, and inconsistent business terms for the language pair.',
    'rule',
    true,
    50,
    '{"weight":15}'::jsonb
  ),
  (
    'boilerplate',
    'Boilerplate',
    'Required standard phrases are present and unmodified when the source uses them.',
    'rule',
    true,
    60,
    '{"weight":10}'::jsonb
  )
on conflict (code) do nothing;

insert into terminology (
  term,
  definition,
  description,
  source_language,
  target_language,
  preferred_translation,
  forbidden_translations,
  category,
  context,
  example
) values
  (
    'MR.DIY',
    'Company brand name. Must not be translated.',
    'Keep the brand mark exactly as MR.DIY.',
    'en',
    'ms',
    'MR.DIY',
    array['MR DIY', 'Mr DIY', 'MRDIY'],
    'brand',
    'Always keep the official brand mark.',
    'MR.DIY announced the opening of a new store.'
  ),
  (
    'MR.DIY Group',
    'Legal group name. Must not be translated.',
    'Keep MR.DIY Group unchanged.',
    'en',
    'ms',
    'MR.DIY Group',
    array['MR DIY Group', 'Mr DIY Group'],
    'brand',
    'Corporate name.',
    'MR.DIY Group operates stores across the region.'
  ),
  (
    'Store',
    'A retail outlet.',
    'Use Kedai in Bahasa Malaysia.',
    'en',
    'ms',
    'Kedai',
    array['Toko', 'Gerai', 'Shop'],
    'retail',
    'Retail outlet, not a warehouse.',
    'The new store opens on Monday.'
  ),
  (
    'Value retailer',
    'How MR.DIY describes its retail model.',
    'Use the approved Bahasa Malaysia phrase.',
    'en',
    'ms',
    'peruncit nilai',
    array['peruncit murah', 'kedai murah'],
    'positioning',
    'Boilerplate and corporate descriptions.',
    'MR.DIY is Malaysia''s leading value retailer.'
  ),
  (
    'Customer',
    'A person who shops with MR.DIY.',
    'Use pelanggan.',
    'en',
    'ms',
    'pelanggan',
    array['kustomer', 'customer'],
    'audience',
    'Shoppers.',
    'The new store gives customers easier access.'
  ),
  (
    'Member',
    'A person enrolled in the MR.DIY membership programme.',
    'Use ahli.',
    'en',
    'ms',
    'ahli',
    array['member', 'anggota'],
    'audience',
    'Membership programme.',
    'Members receive exclusive offers.'
  ),
  (
    'MR.DIY',
    'Company brand name. Must not be translated.',
    'Keep the brand mark exactly as MR.DIY.',
    'en',
    'id',
    'MR.DIY',
    array['MR DIY', 'Mr DIY', 'MRDIY'],
    'brand',
    'Always keep the official brand mark.',
    'MR.DIY membuka toko baru.'
  ),
  (
    'Store',
    'A retail outlet.',
    'Use Toko in Indonesian.',
    'en',
    'id',
    'Toko',
    array['Kedai', 'Gerai', 'Shop'],
    'retail',
    'Indonesian prefers Toko, unlike Bahasa Malaysia.',
    'The new store opens on Monday.'
  ),
  (
    'MR.DIY',
    'Company brand name. Must not be translated.',
    'Keep the brand mark exactly as MR.DIY.',
    'en',
    'th',
    'MR.DIY',
    array['MR DIY', 'Mr DIY', 'MRDIY'],
    'brand',
    'Always keep the official brand mark.',
    'MR.DIY announced a new store.'
  ),
  (
    'Store',
    'A retail outlet.',
    'Use the approved Thai word for a branch.',
    'en',
    'th',
    'สาขา',
    array['ร้านค้า', 'Shop'],
    'retail',
    'Branch wording in Thai press copy.',
    'The new store opens on Monday.'
  )
on conflict ((lower(term)), (lower(source_language)), (lower(target_language))) do nothing;

insert into boilerplate_phrases (name, language, phrase, expected_usage)
values
  (
    'company_intro',
    'en',
    'MR.DIY is Malaysia''s leading value retailer, offering a wide range of quality products at affordable prices.',
    'when_source_present'
  ),
  (
    'company_intro',
    'ms',
    'MR.DIY ialah peruncit nilai terkemuka di Malaysia, menawarkan pelbagai produk berkualiti pada harga mampu milik.',
    'when_source_present'
  )
on conflict ((lower(name)), (lower(language))) do nothing;

-- Sample press article with an imperfect Bahasa Malaysia translation.
do $$
declare
  app_id uuid;
  article_id uuid;
  source_body text := $html$<p>MR.DIY today announced the opening of its 1,000th store in Kuala Lumpur.</p><p>The new store gives customers easier access to everyday essentials and welcomes members to exclusive offers.</p><p>MR.DIY is Malaysia's leading value retailer, offering a wide range of quality products at affordable prices.</p>$html$;
  translated_body text := $html$<p>Wah, MR DIY hari ini umum pembukaan gerai ke-100 di Kuala Lumpur. Memang best gila!</p><p>Kedai baharu ini memudahkan pelanggan mendapatkan barangan harian dan mengalu-alukan ahli untuk tawaran eksklusif.</p><p>MR.DIY ialah peruncit nilai terkemuka di Malaysia, menawarkan pelbagai produk berkualiti pada harga mampu milik.</p>$html$;
begin
  select id into app_id
  from applications
  where name = 'Press' and model_type = 'CONTENT'
  limit 1;
  if app_id is null then
    return;
  end if;

  insert into content_types (application_id, code, name, description, status, sort_order)
  values (app_id, 'GENERAL', 'General', '', 'ACTIVE', 0)
  on conflict (application_id, code) do nothing;

  if exists (
    select 1 from content
    where application_id = app_id and slug = 'quality-demo-new-store'
  ) then
    return;
  end if;

  insert into content (
    application_id,
    content_type,
    title,
    slug,
    source_language,
    source_content,
    market,
    status,
    target_languages
  ) values (
    app_id,
    'GENERAL',
    'MR.DIY opens its 1,000th store in Kuala Lumpur',
    'quality-demo-new-store',
    'en',
    jsonb_build_object(
      'title', 'MR.DIY opens its 1,000th store in Kuala Lumpur',
      'summary', 'MR.DIY today announced the opening of a new store, giving customers easier access to everyday essentials.',
      'body', source_body,
      'seo_title', 'MR.DIY opens its 1,000th store in Kuala Lumpur',
      'seo_description', 'MR.DIY today announced the opening of a new store, giving customers easier access to everyday essentials.'
    ),
    'MY',
    'REVIEW',
    array['ms']
  )
  returning id into article_id;

  insert into content_translations (
    content_id,
    language_code,
    title,
    summary,
    body,
    seo_title,
    seo_description,
    status
  ) values (
    article_id,
    'ms',
    'MR DIY buka gerai ke-100 di Kuala Lumpur',
    'Wah, MR DIY umum gerai baharu. Memang best!',
    translated_body,
    'MR DIY buka gerai ke-100 di Kuala Lumpur',
    'Wah, MR DIY umum gerai baharu. Memang best!',
    'MANUALLY_MODIFIED'
  );
exception
  when others then
    raise notice 'Quality demo article was not seeded: %', sqlerrm;
end $$;
