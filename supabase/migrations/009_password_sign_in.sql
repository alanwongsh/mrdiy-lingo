-- Password for people who sign in on the Lingo page instead of from Joget.
-- Run after 008. The hash below is for the superadmin email only.

alter table hub_users
  add column if not exists password_hash text;

update hub_users
set password_hash = 'scrypt$MfhczcaAQhCjQ79n9eQSLg$EK77EPhgtzAI3XsXc9Aa73PSzwDFmslmfUb7lPCCg-o'
where lower(email) = 'alan.wongsh@mrdiy.com'
  and password_hash is null;
