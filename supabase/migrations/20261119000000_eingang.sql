-- Eingang: Auftrag und Nachweis aus WhatsApp und E-Mail.
-- Die Felder liegen im JSON (messages.data, jobs.data):
--   messages: profileName, attachments, intake
--   jobs: draft, origin, receipts, activities
-- Idempotent. Bestehende Zeilen bleiben unverändert. Kein DROP.

create index if not exists messages_channel_idx on messages ((data->>'channel'));
create index if not exists messages_thread_idx on messages ((data->>'threadId'));
create index if not exists jobs_origin_idx on jobs ((data->>'origin'));
create index if not exists jobs_portal_source_idx on jobs ((data->>'portalSource'));
create index if not exists jobs_draft_idx on jobs ((data->>'draft'));
