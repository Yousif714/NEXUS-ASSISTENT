-- Sicherung vor dem Löschen der myDigitalCar-/nextOZ-Daten (Inhaber 18.11.2026: „Lösch die Daten ruhig“).
-- Idempotent: jede Sicherungstabelle wird nur beim ersten Lauf angelegt und befüllt.
-- Eigenes Schema „backup“, nicht über die API erreichbar.
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;

create table if not exists backup.portal_jobs_20261118 as
  select * from public.jobs
  where data->>'portalSource' in ('mydigitalcar', 'nextoz');

create table if not exists backup.portal_vehicles_20261118 as
  select v.* from public.vehicles v
  where jsonb_array_length(coalesce(v.data->'externalRefs', '[]'::jsonb)) > 0
    and not exists (
      select 1 from jsonb_array_elements(v.data->'externalRefs') r
      where r->>'connectionId' not in ('mydigitalcar', 'nextoz')
    );

create table if not exists backup.portal_contacts_20261118 as
  select c.* from public.contacts c
  where jsonb_array_length(coalesce(c.data->'externalRefs', '[]'::jsonb)) > 0
    and not exists (
      select 1 from jsonb_array_elements(c.data->'externalRefs') r
      where r->>'connectionId' not in ('mydigitalcar', 'nextoz')
    );

create table if not exists backup.portal_insights_20261118 as
  select i.* from public.insights i
  where i.data->>'type' in ('portal_no_invoice', 'portal_ab_no_invoice')
     or (i.id like 'job-inv:%' and substring(i.id from 9) in (
           select id from public.jobs where data->>'portalSource' in ('mydigitalcar', 'nextoz')));
