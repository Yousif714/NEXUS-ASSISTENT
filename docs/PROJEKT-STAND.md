# Projektstand – Nexus-Assistent

> Einstiegspunkt für jede neue Session. Kurz halten. Bei Übergabe den Abschnitt „Stand & nächste Schritte“ aktualisieren (Befehl `/uebergabe`).

## Ziel
Persönlicher KI-Assistent (PWA, Deutsch, Apple-Stil) für den Inhaber von **NEXUS** (≈40–45 Mitglieder, Ratenzahlung seit August, Wechsel auf Stripe) und **Zulassungsdienst Bundesweit** (Bottrop/Essen, fast alles per WhatsApp). Nur 1 Nutzer.

Kernziele:
1. Wer schuldet wie viel? (inkl. Bestandsmitglieder seit August)
2. Nichts rutscht durch (Raten, offene Rechnungen, erledigt aber nicht abgerechnet)
3. Kein Kunde wartet unbemerkt, Zusagen werden erkannt
4. Morgenbriefing in 30 s
5. Assistent schreibt per WhatsApp wie ein Mitarbeiter
6. Nur noch „Senden“ tippen
7. Coach-Tipps
8. Nichts geht ohne Freigabe raus, alles im Protokoll

**Nicht im Umfang:** i-Kfz, GKS, Portalstatistik, Routen, Mitarbeiter-Logins. myDigitalCar- und nextOZ-Vorgänge: CSV-Import (nextOZ-Spalten noch offen).

## Dokumente (Quelle der Wahrheit)
| Datei | Inhalt |
|---|---|
| `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` | **Spec**: Architektur, Datenmodell, Rechenregeln (Abschnitt 4a), Abnahme (10) |
| `docs/superpowers/plans/2026-11-12-nexus-phase1-vorschau.md` | Bauplan Phase 1 (abgeschlossen) |
| `docs/superpowers/specs/2026-11-12-phase2-design.md` | **Spec Phase 2** (Pakete 2a–2f, Fundament-Architektur) |
| `docs/phase2-backlog.md` | Offene Punkte und verschobene Befunde für Phase 2 |
| `docs/setup-phase2a.md` | **Inhaber-Checkliste** Paket 2a: Supabase, Vercel, Variablen, erste Anmeldung |
| `docs/setup-phase2b.md` | **Inhaber-Checkliste** Paket 2b-1: Stripe-Key und Webhook, Lexware-Schlüssel, Vercel, Migration |
| `docs/superpowers/plans/2026-11-12-phase2b1-vertraege.md` | Bauplan Paket 2b-1 (Verträge aus Stripe und Lexware) |
| `docs/setup-phase2b2.md` | **Inhaber-Checkliste** Paket 2b-2: Migration, Qonto-Schlüssel, Vercel-Variablen |
| `docs/superpowers/plans/2026-11-13-phase2b2-qonto.md` | Bauplan Paket 2b-2 (Qonto, Forderungen, Zuordnungs-Härtung) |
| `docs/setup-phase2b3.md` | **Inhaber-Anleitung** Paket 2b-3: Preview-Testlauf Stripe-Umstellung (Claude führt aus, 2 Freigaben) |
| `docs/superpowers/specs/2026-11-13-phase2b3-stripe-umstellung-design.md` | Spec 2b-3 (Abschnitt 12 = Entscheidungen) |
| `docs/superpowers/plans/2026-11-13-phase2b3-stripe-umstellung.md` | Bauplan 2b-3 (Ledger: `plans/2026-11-13-phase2b3-ledger.md`) |
| `docs/setup-ab.md` | **Inhaber-Checkliste** Auftragsbestätigungen und Import ab 01.06. |
| `docs/superpowers/specs/2026-11-13-sparkasse-upload-design.md` | Spec Sparkasse-Upload (Zulassung: Kontoauszug → Zahlungen → Rechnungen) |
| `docs/superpowers/plans/2026-11-13-sparkasse-upload.md` | Bauplan Sparkasse-Upload |
| `docs/NEXUS-Assistent-Prompt.md` | Fachliche Anforderungen (Prompt-Form) |
| `docs/Codex-Vergleich-Prompt.md` | Zweitmeinungs-Prompt für Codex |
| `docs/vorschau/README.md` | Anleitung für den Inhaber, Vercel/iPhone |

## Architektur (Kurzfassung)
- Next.js 16 PWA (App Router, TS, Tailwind). **Phase 1:** reine Client-App, Demo-Daten in localStorage, Demo-Uhr 12.11.2026 09:30 (`?now=` überschreibt, `?reset=1` setzt zurück).
- `src/domain/` = reine Fachlogik, kein React, **kein Import aus `src/data`** (Ausnahme bekannt: `assistant.ts` → `src/ai`, siehe Backlog).
  - `ledger/` Raten, Verteilung, Status, Übernahme, Vorschau
  - `matching/` Zahlungen + Nachrichten
  - `detectors/` Hinweise + Lebenszyklus
  - `actions/` Freigabe-Zustandsmaschine
  - `scheduler.ts`, `briefing.ts`, `coach.ts`, `commitments.ts`, `billing.ts`, `assistant.ts` (WhatsApp-Logik)
- `src/ai/` `AIProvider` + regelbasierte `DemoAI` (Phase 2: Claude, Opus 5.5 Hauptmodell).
- `src/data/` `seed.ts` (deterministisch, 40 Verträge), `store.tsx` (Reducer + `refresh`), `selectors.ts`.
- `src/components/` Design-System (iOS-Tokens in `globals.css`), `src/app/` Seiten.

## Feste Regeln (Auszug aus Spec 4a)
- Beträge in Cent, Kalendertage Europe/Berlin. Geld nur aus Ledger-Funktionen.
- Zahlungen gehen auf die älteste offene Rate zuerst. Referenz: 1.200 € = 4 × 300 €, 450 € gezahlt → 150 Rückstand / 600 künftig / 750 offen.
- Ampel: grün = 0 Rückstand, gelb = bis 7 Tage, rot = über 7 Tage.
- Gutschriften nur aus Zahlungen (Bank/Stripe/manuell). Stripe-Auszahlung nie gutschreiben. Importschlüssel = Verbindung + externe ID.
- Zuordnung hoch = bestätigte IBAN + passender Betrag. Mittel = Vorschlag. Niedrig = manuell.
- Antwort zählt nur im selben Kanal und Thread. Veraltete Quelle (> 45 Min.) → „Datenstand zu alt“.
- Aktionen: Freigabe an Version gebunden. WhatsApp-Knopf max. 24 Std. Timeout → „Ausgang unklar“ statt Neusenden.

## Befehle
`npm test` (Vitest, ~406) · `npm run test:integration` (Supabase-Testprojekt) · `npx tsc --noEmit` · `npm run lint` · `npm run contrast` · `npm run e2e` (Playwright, vorher `fuser -k 3100/tcp`) · Screenshots: `SCREENSHOTS=1 npm run e2e -- tests/e2e/screenshots.spec.ts`

## Stand & nächste Schritte
- **17.11. Oberfläche und Eingang:** Abschnitte sind einklappbar (`CollapsibleSection`, Zustand in `nexus-sections`). WhatsApp ist eine Chat-Ansicht unter `/nachrichten` (nichts wird gesendet). Eingehende Aufträge und Nachweise aus WhatsApp und E-Mail werden per FIN, Kennzeichen, Halter oder Nummer einem Portal-Vorgang zugeordnet, sonst als Entwurf angelegt; Absender und Verlauf hängen am Vorgang. nextOZ bleibt eine eigene Quelle. Migration `20261119000000_eingang.sql` (nur Indizes). MCP: `get_message` mit Absender und Erkennung, `get_job`/`list_jobs` mit Verlauf.
- **Live** (`https://nexus-iota-gold-96.vercel.app`, Vercel `prj_IiBA31MUemrhPL1GupA2H2NbZkE5`, Supabase `bqnbboopqeilxflnqgiu`). PRs bis #24 gemergt, Migrationen bis `20261118000000_stripe_umstellung.sql` live.
- **17.11. myDigitalCar / nextOZ:** Zwei getrennte Verbindungen. myDigitalCar-CSV wird zu Kunde, Fahrzeug und Auftrag (alle Spalten am Auftrag, inkl. Sicherheitscodes). Zeilen ohne Halter (oft Abmeldung oder Gespeichert) werden trotzdem importiert: Fahrzeug nach FIN oder Kennzeichen, Auftrag ohne Kontakt. nextOZ steht daneben, die Spaltenzuordnung fehlt noch. Keine neue Migration. MCP `import_portal_csv`.
- **17.11. Portal ↔ Lexware abgeglichen:** 11 Portal-Mitglieder per SQL mit bestehendem Vertrag verknüpft (Lexware-Kontakte ohne bzw. mit anderer E-Mail), 4 Verträge aus Inhaber-PDFs angelegt (Yussef RE0082, Trillig RE0083, Rami Andraws RE0084, Dedaj RE0085). 43 Mitgliedsverträge. PR #20: Namenstreffer mit Firmenzusatz/Ansprechpartner + Knopf „Mit Vertrag verknüpfen“.
- **17.11. Event-Tickets:** Zahlungen per SQL den Ticket-Rechnungen zugeordnet (Protokoll in `audit`). In Lexware storniert per Rechnungskorrektur GS0001–GS0005 (RE0030/37/39/40/41). RE0087–RE0095 sind Doppel-Rechnungen aus Lieferscheinen (Inhaber: in Lexware lassen), in der App mit den Qonto-Zahlungen verknüpft. PR #24: bezahlte Ticket-Rechnungen bleiben Zuordnungsziel, „Event/Ticket“ im Zweck nie auf Mitgliedsbeitrag. Lexware-NEXUS-Schlüssel als Session-Netzwerk-Secret (`api.lexware.io`) vorhanden.
- **Offen – Stripe-Lesezugang liefert nichts:** `stripe_nexus` „verbunden“, aber 0 Abos/Zahlungen. Vermutlich `STRIPE_RESTRICTED_KEY` (Production) Test-/Sandbox-Schlüssel oder anderes Konto. Luka Viskic und Mark (Merdeah) sind auf Stripe und haben deshalb keinen Vertrag. Inhaber: Live-`rk_live_…` eintragen oder Werte liefern.
- **Nicht in Portal-Liste, aber Vertrag:** Calvin Rotfuß, Jakob Link. Gommlic ↔ CM-Marketing nur über E-Mail-Präfix abgeleitet.
- **Stripe-Umstellung (2b-3) live**, echte Abbuchung erst mit `STRIPE_WRITE_KEY` + Live-Webhook `checkout.session.completed`. Webhook-API-Version `2026-10-28.endive` vs. getestet `2025-09-30.clover` beim ersten echten Kunden prüfen.
- **MCP:** `/api/mcp` (Streamable HTTP) für den externen Assistenten. Bleibt zu (503), bis `MCP_API_KEY` in Vercel Production gesetzt und neu deployt ist. Anleitung im README.
- **Regeln:** Pauschale Freigabe des Inhabers (CLAUDE.md). Stripe-Schreibaktionen aus der Session nur nach `livemode:false`-Prüfung (Vorfall 14.11.). Daten-Korrekturen per SQL immer mit `audit`-Eintrag und `meta.revision`+1. Repo heißt `Yousif714/NEXUS-ASSISTENT`, MCP nur über alten Namen `yousif714/zulassungsdienst-yousif`.
- **Offen sonst:** Backlog „Offen aus 2b-3“, „Sparkasse-Upload“, „Rechnungen lesen“; Supabase Pro; zweite WhatsApp-Nummer (2e). Echte Daten nie ins Repo.
