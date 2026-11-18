-- Löscht die myDigitalCar-/nextOZ-Daten (Inhaber 18.11.2026: „Ja löschen“).
-- Ausführen: supabase.com → Projekt → SQL Editor → New query → einfügen → Run.
-- Sicherung liegt im Schema backup (*_20261118). Idempotent: ein zweiter Lauf findet nichts mehr.
begin;
create temp table del_jobs on commit drop as select id from backup.portal_jobs_20261118;
create temp table del_veh on commit drop as
  select b.id from backup.portal_vehicles_20261118 b
  where b.id not in (select data->>'vehicleId' from public.jobs where id not in (select id from del_jobs) and data->>'vehicleId' is not null);
create temp table del_con on commit drop as
  select b.id from backup.portal_contacts_20261118 b
  where b.id not in (
    select data->>'contactId' from public.invoices where data->>'contactId' is not null union
    select data->>'contactId' from public.contracts where data->>'contactId' is not null union
    select data->>'contactId' from public.messages where data->>'contactId' is not null union
    select data->>'contactId' from public.payments where data->>'contactId' is not null union
    select data->>'contactId' from public.order_confirmations where data->>'contactId' is not null union
    select data->>'contactId' from public.commitments where data->>'contactId' is not null union
    select data->>'contactId' from public.iban_links where data->>'contactId' is not null union
    select data->>'contactId' from public.actions where data->>'contactId' is not null union
    select data->>'contactId' from public.stripe_takeovers where data->>'contactId' is not null union
    select data->>'contactId' from public.jobs where id not in (select id from del_jobs) and data->>'contactId' is not null union
    select data->>'contactId' from public.vehicles where id not in (select id from del_veh) and data->>'contactId' is not null
  );
create temp table cnt on commit drop as select
  (select count(*) from public.jobs where id in (select id from del_jobs)) j,
  (select count(*) from public.vehicles where id in (select id from del_veh)) v,
  (select count(*) from public.contacts where id in (select id from del_con)) c,
  (select count(*) from public.insights where id in (select id from backup.portal_insights_20261118)) i;
delete from public.insights where id in (select id from backup.portal_insights_20261118);
delete from public.jobs where id in (select id from del_jobs);
delete from public.vehicles where id in (select id from del_veh);
delete from public.contacts where id in (select id from del_con);
insert into public.audit (id, ord, data)
select lpad(o.n::text, 8, '0'), o.n, jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'actor', 'owner', 'isDemo', false, 'text',
  'Korrektur (SQL): myDigitalCar/nextOZ-Daten gelöscht – ' || cnt.j || ' Aufträge, ' || cnt.v || ' Fahrzeuge, ' || cnt.c || ' Kunden, ' || cnt.i || ' Hinweise. Sicherung im Schema backup (*_20261118).')
from cnt, (select coalesce(max(ord), 0) + 1 n from public.audit) o
where cnt.j + cnt.v + cnt.c + cnt.i > 0;
update public.meta set value = to_jsonb((value::text)::int + 1) where key = 'revision';
commit;
select (select count(*) from public.jobs) auftraege, (select count(*) from public.vehicles) fahrzeuge,
       (select count(*) from public.contacts) kunden, (select count(*) from public.insights) hinweise;
