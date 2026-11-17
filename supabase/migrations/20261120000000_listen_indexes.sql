-- Seitenaufruf liest die Tabellen mit order by ord, id. Die großen Listen (Aufträge, Fahrzeuge, Kontakte)
-- sortieren sonst bei jedem Laden. Status und Sendezeit für die Arbeitsliste und die Antwort-Erkennung.

create index if not exists jobs_ord_id_idx on public.jobs (ord, id);
create index if not exists vehicles_ord_id_idx on public.vehicles (ord, id);
create index if not exists contacts_ord_id_idx on public.contacts (ord, id);
create index if not exists insights_ord_id_idx on public.insights (ord, id);
create index if not exists messages_ord_id_idx on public.messages (ord, id);
create index if not exists invoices_ord_id_idx on public.invoices (ord, id);

create index if not exists jobs_status_idx on public.jobs ((data->>'status'));
create index if not exists insights_status_idx on public.insights ((data->>'status'));
create index if not exists messages_sent_idx on public.messages ((data->>'sentAt'));
create index if not exists messages_direction_idx on public.messages ((data->>'direction'));
