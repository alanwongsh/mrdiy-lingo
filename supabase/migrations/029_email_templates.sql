-- Superadmin-editable system emails, one row per email kind: sender name,
-- subject and HTML body, each of which may use {{variables}}. A missing row or
-- an empty field falls back to the built-in default.
-- Run after 028. Safe to run more than once.

create table if not exists email_templates (
  kind text primary key,
  sender_name text,
  subject text,
  body text,
  updated_by uuid references hub_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrades a table made by an earlier draft of this file.
alter table email_templates add column if not exists sender_name text;
alter table email_templates add column if not exists body text;
alter table email_templates
  drop column if exists preheader,
  drop column if exists heading,
  drop column if exists intro,
  drop column if exists button_label,
  drop column if exists footer_notice,
  drop column if exists footer_reason;

drop trigger if exists trg_email_templates_updated_at on email_templates;
create trigger trg_email_templates_updated_at
  before update on email_templates
  for each row execute function set_updated_at();

alter table email_templates enable row level security;
drop policy if exists email_templates_all on email_templates;
create policy email_templates_all on email_templates for all using (true) with check (true);
