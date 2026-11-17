-- Abo-Speichern: Unique (connection_id, external_id) gegen ON CONFLICT (id).
-- Ein zweites Einfügen derselben Stripe-ID unter neuer Zeilen-ID (oder zweimal in einem
-- Stapel) warf 23505. PostgREST macht daraus HTTP 409, der Abruf bricht ab, die Liste bleibt leer.
-- Vor dem Insert wird je Schlüssel die letzte Zeile behalten. Eine alte Zeile mit anderer id
-- wird gelöscht, danach gilt wieder ON CONFLICT (id). Andere Tabellen unverändert.
-- Idempotent. Kein DROP der Tabelle, keine Datenlöschung außer diesem Konfliktfall.

create or replace function apply_changes(p_expected_revision int, p_changes jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'connections',
    'contacts',
    'contracts',
    'payments',
    'invoices',
    'messages',
    'commitments',
    'events',
    'calls',
    'content',
    'vehicles',
    'jobs',
    'actions',
    'insights',
    'assistant_messages',
    'allocations',
    'iban_links',
    'contract_exceptions',
    'audit',
    'settings',
    'subscriptions',
    'dismissed_proposals',
    'portal_members',
    'ignored_portal_members',
    'order_confirmations',
    'invoice_readings',
    'stripe_takeovers'
  ];
  v_external constant text[] := array['payments', 'invoices', 'messages', 'events', 'subscriptions', 'portal_members', 'order_confirmations'];
  v_revision int;
  v_table text;
  v_change jsonb;
  v_upsert jsonb;
  v_delete jsonb;
begin
  select (value #>> '{}')::int into v_revision from meta where key = 'revision' for update;
  if v_revision is null then
    raise exception 'revision missing';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'conflict';
  end if;
  if jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid changes';
  end if;

  for v_table in select jsonb_object_keys(p_changes) loop
    if not (v_table = any (v_allowed)) then
      raise exception 'unknown table: %', v_table;
    end if;
  end loop;

  for v_table, v_change in select key, value from jsonb_each(p_changes) loop
    v_delete := coalesce(v_change -> 'delete', '[]'::jsonb);
    v_upsert := coalesce(v_change -> 'upsert', '[]'::jsonb);

    if jsonb_array_length(v_delete) > 0 then
      execute format('delete from %I where id in (select jsonb_array_elements_text($1))', v_table) using v_delete;
    end if;

    if jsonb_array_length(v_upsert) > 0 then
      if v_table = 'subscriptions' then
        -- Erst die alte Zeile mit gleichem Schlüssel und anderer id weg. Im selben
        -- Statement sähe das Insert die Löschung nicht und liefe wieder in 23505.
        execute $sub$
          delete from subscriptions s
          using (
            select distinct on (connection_id, external_id) id, connection_id, external_id
            from (
              select r ->> 'id' as id,
                     (r ->> 'ord')::int as ord,
                     nullif(r ->> 'connection_id', '') as connection_id,
                     nullif(r ->> 'external_id', '') as external_id
              from jsonb_array_elements($1) r
            ) incoming
            where id is not null and connection_id is not null and external_id is not null
            order by connection_id, external_id, ord desc
          ) d
          where s.connection_id = d.connection_id
            and s.external_id = d.external_id
            and s.id <> d.id
        $sub$ using v_upsert;
        execute $sub$
          insert into subscriptions (id, ord, data, connection_id, external_id, updated_at)
          select id, ord, data, connection_id, external_id, now()
          from (
            select distinct on (id) id, ord, data, connection_id, external_id
            from (
              select distinct on (connection_id, external_id)
                r ->> 'id' as id,
                (r ->> 'ord')::int as ord,
                r -> 'data' as data,
                nullif(r ->> 'connection_id', '') as connection_id,
                nullif(r ->> 'external_id', '') as external_id
              from jsonb_array_elements($1) r
              where r ->> 'id' is not null
                and nullif(r ->> 'connection_id', '') is not null
                and nullif(r ->> 'external_id', '') is not null
              order by connection_id, external_id, (r ->> 'ord')::int desc
            ) by_key
            order by id, ord desc
          ) deduped
          on conflict (id) do update set
            ord = excluded.ord,
            data = excluded.data,
            connection_id = excluded.connection_id,
            external_id = excluded.external_id,
            updated_at = now()
        $sub$ using v_upsert;
      elsif v_table = any (v_external) then
        execute format(
          'insert into %I (id, ord, data, connection_id, external_id, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', r ->> ''connection_id'', r ->> ''external_id'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, '
          'connection_id = excluded.connection_id, external_id = excluded.external_id, updated_at = now()',
          v_table) using v_upsert;
      elsif v_table = 'insights' then
        execute format(
          'insert into %I (id, ord, data, dedupe_key, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', r ->> ''dedupe_key'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, '
          'dedupe_key = excluded.dedupe_key, updated_at = now()',
          v_table) using v_upsert;
      else
        execute format(
          'insert into %I (id, ord, data, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, updated_at = now()',
          v_table) using v_upsert;
      end if;
    end if;
  end loop;

  update meta set value = to_jsonb(v_revision + 1), updated_at = now() where key = 'revision';
  return v_revision + 1;
end;
$$;

revoke execute on function apply_changes(int, jsonb) from public, anon, authenticated;
grant execute on function apply_changes(int, jsonb) to service_role;
