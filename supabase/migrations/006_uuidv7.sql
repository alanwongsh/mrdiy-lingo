-- Time-ordered UUID v7 defaults for databases that already ran 001/005.
-- Existing rows keep their v4 ids. Only new inserts use v7.
-- Run after 005.

create or replace function uuidv7()
returns uuid
language plpgsql
volatile
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(
    int8send((extract(epoch from clock_timestamp()) * 1000)::bigint)
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

alter table languages alter column id set default uuidv7();
alter table applications alter column id set default uuidv7();
alter table namespaces alter column id set default uuidv7();
alter table translation_keys alter column id set default uuidv7();
alter table translations alter column id set default uuidv7();
alter table translation_versions alter column id set default uuidv7();
alter table content alter column id set default uuidv7();
alter table content_translations alter column id set default uuidv7();
alter table content_translation_versions alter column id set default uuidv7();
alter table article_comments alter column id set default uuidv7();
