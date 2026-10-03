-- Rewrite existing UUID v4 primary keys to UUID v7 using each row's created_at.
-- Foreign keys that point at those ids are updated in the same transaction.
-- Rows that are already version 7 are left alone, so this is safe to re-run.
-- Bookmarks and iframe links that contain the old ids will not resolve.

create or replace function uuidv7(ts timestamptz)
returns uuid
language plpgsql
volatile
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(
    int8send((extract(epoch from ts) * 1000)::bigint)
    from 3
  );
  uuid_bytes := overlay(
    uuid_send(gen_random_uuid())
    placing unix_ts_ms
    from 1 for 6
  );
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  return encode(uuid_bytes, 'hex')::uuid;
end
$$;

do $$
declare
  tables text[] := array[
    'languages',
    'applications',
    'namespaces',
    'translation_keys',
    'translations',
    'translation_versions',
    'content',
    'content_translations',
    'content_translation_versions',
    'article_comments'
  ];
  t text;
  n bigint;
  pending bigint := 0;
  rec record;
  fk record;
  candidate uuid;
  tries int;
  collides boolean;
begin
  foreach t in array tables loop
    execute format(
      'select count(*) from %I where substring(id::text, 15, 1) <> ''7''',
      t
    ) into n;
    pending := pending + n;
  end loop;

  if pending = 0 then
    raise notice 'primary keys are already uuid v7';
    return;
  end if;

  create temp table id_map (
    tbl text not null,
    old_id uuid not null,
    new_id uuid not null,
    primary key (tbl, old_id),
    unique (tbl, new_id)
  ) on commit drop;

  foreach t in array tables loop
    for rec in execute format(
      'select id, created_at from %I where substring(id::text, 15, 1) <> ''7''',
      t
    ) loop
      tries := 0;
      loop
        tries := tries + 1;
        if tries > 8 then
          raise exception 'could not mint a unique uuid v7 for %.%', t, rec.id;
        end if;
        candidate := uuidv7(rec.created_at);
        execute format('select exists (select 1 from %I where id = $1)', t)
          into collides
          using candidate;
        exit when not collides and not exists (
          select 1 from id_map where tbl = t and new_id = candidate
        );
      end loop;
      insert into id_map (tbl, old_id, new_id) values (t, rec.id, candidate);
    end loop;
  end loop;

  create temp table fk_backup (
    conname name,
    child regclass,
    parent_tbl text,
    col name,
    def text
  ) on commit drop;

  insert into fk_backup (conname, child, parent_tbl, col, def)
  select
    c.conname,
    c.conrelid::regclass,
    parent.relname,
    src.attname,
    pg_get_constraintdef(c.oid)
  from pg_constraint c
  join pg_class parent on parent.oid = c.confrelid
  join pg_attribute src
    on src.attrelid = c.conrelid and src.attnum = c.conkey[1]
  join pg_attribute dst
    on dst.attrelid = c.confrelid and dst.attnum = c.confkey[1]
  where c.contype = 'f'
    and dst.attname = 'id'
    and parent.relname = any (tables)
    and cardinality(c.conkey) = 1;

  for fk in select * from fk_backup loop
    execute format('alter table %s drop constraint %I', fk.child, fk.conname);
  end loop;

  foreach t in array tables loop
    execute format('alter table %I drop constraint %I', t, t || '_pkey');
  end loop;

  for fk in select * from fk_backup loop
    execute format(
      'update %s as child set %I = m.new_id from id_map m where m.tbl = %L and child.%I = m.old_id',
      fk.child,
      fk.col,
      fk.parent_tbl,
      fk.col
    );
  end loop;

  foreach t in array tables loop
    execute format(
      'update %I as row set id = m.new_id from id_map m where m.tbl = %L and row.id = m.old_id',
      t,
      t
    );
    execute format('alter table %I add primary key (id)', t);
    execute format(
      'select count(*) from %I where substring(id::text, 15, 1) <> ''7''',
      t
    ) into n;
    if n > 0 then
      raise exception '% still has % non-v7 primary keys', t, n;
    end if;
  end loop;

  for fk in select * from fk_backup loop
    execute format(
      'alter table %s add constraint %I %s',
      fk.child,
      fk.conname,
      fk.def
    );
  end loop;

  raise notice 'rewrote % primary keys to uuid v7', (select count(*) from id_map);
end
$$;

reindex table languages;
reindex table applications;
reindex table namespaces;
reindex table translation_keys;
reindex table translations;
reindex table translation_versions;
reindex table content;
reindex table content_translations;
reindex table content_translation_versions;
reindex table article_comments;
