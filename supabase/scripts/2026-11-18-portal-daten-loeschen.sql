-- Löscht die myDigitalCar-/nextOZ-Daten (Inhaber 18.11.2026: „Ja löschen“). Am 18.11.2026 ausgeführt (Protokoll 720/721).
-- Ausführen: supabase.com → Projekt → SQL Editor → New query → nur diesen Block einfügen → Run.
-- Ein einziger DO-Block, weil der SQL Editor Anweisungen einzeln ausführt (temporäre Tabellen wären sofort weg).
-- Sicherung liegt im Schema backup (*_20261118). Idempotent: ein zweiter Lauf findet nichts mehr.
do $$
declare j int; v int; c int; i int; n int;
begin
  delete from public.insights where id in (select id from backup.portal_insights_20261118);
  get diagnostics i = row_count;
  delete from public.jobs where id in (select id from backup.portal_jobs_20261118);
  get diagnostics j = row_count;
  delete from public.vehicles
   where id in (select id from backup.portal_vehicles_20261118)
     and id not in (select data->>'vehicleId' from public.jobs where data->>'vehicleId' is not null);
  get diagnostics v = row_count;
  delete from public.contacts
   where id in (select id from backup.portal_contacts_20261118)
     and id not in (
       select data->>'contactId' from public.invoices where data->>'contactId' is not null union
       select data->>'contactId' from public.contracts where data->>'contactId' is not null union
       select data->>'contactId' from public.messages where data->>'contactId' is not null union
       select data->>'contactId' from public.payments where data->>'contactId' is not null union
       select data->>'contactId' from public.order_confirmations where data->>'contactId' is not null union
       select data->>'contactId' from public.commitments where data->>'contactId' is not null union
       select data->>'contactId' from public.iban_links where data->>'contactId' is not null union
       select data->>'contactId' from public.actions where data->>'contactId' is not null union
       select data->>'contactId' from public.stripe_takeovers where data->>'contactId' is not null union
       select data->>'contactId' from public.jobs where data->>'contactId' is not null union
       select data->>'contactId' from public.vehicles where data->>'contactId' is not null);
  get diagnostics c = row_count;
  if j + v + c + i > 0 then
    select coalesce(max(ord), 0) + 1 into n from public.audit;
    insert into public.audit (id, ord, data) values (lpad(n::text, 8, '0'), n, jsonb_build_object(
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'actor', 'owner', 'isDemo', false,
      'text', 'Korrektur (SQL): myDigitalCar/nextOZ-Daten geloescht - ' || j || ' Auftraege, ' || v || ' Fahrzeuge, ' || c || ' Kunden, ' || i || ' Hinweise. Sicherung im Schema backup (*_20261118).'));
    update public.meta set value = to_jsonb((value::text)::int + 1) where key = 'revision';
  end if;
end $$;
select (select count(*) from public.jobs) auftraege, (select count(*) from public.vehicles) fahrzeuge,
       (select count(*) from public.contacts) kunden, (select count(*) from public.insights) hinweise;
