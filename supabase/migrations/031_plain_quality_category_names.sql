-- Plainer names for two quality categories: Terminology -> Glossary, Boilerplate -> Standard text.
-- Only the display name changes. The codes stay, so scores, findings and settings keep working.
-- Run after 030. Safe to run more than once.

update quality_categories set name = 'Glossary' where code = 'terminology' and name = 'Terminology';
update quality_categories set name = 'Standard text' where code = 'boilerplate' and name = 'Boilerplate';
