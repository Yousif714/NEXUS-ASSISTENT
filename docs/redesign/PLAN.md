# Umbau Dashboard & Oberfläche – Plan

Stand 17.11.2026 · Entwürfe: `1-heute-iphone.png`, `2-zulassung-desktop.png`, `3-nachrichten-dunkel.png`

## Was heute stört (aus den Screenshots von `main`)
1. **Grelles, flaches Weiß**, harte Kanten, kaum Tiefe. Lange Arbeit strengt die Augen an.
2. **Alles ist mittig gesetzt** (Titel, Abschnittsnamen), ÜBERSCHRIFTEN IN GROSSBUCHSTABEN. Das Auge springt hin und her.
3. **Zulassung: MDC- und nextOZ-Upload stehen ganz oben** mit rohen Dateifeldern („Choose File“), die eigentliche Arbeit (Aufträge) steht ganz unten.
4. **Riesige Geldkarten** nehmen auf dem iPhone einen ganzen Bildschirm ein.
5. **Aufträge sind auf 4 Listen verteilt** (Wartet, Erledigt, Abgerechnet, Bezahlt) statt in einer Ansicht mit Umschalter.
6. **Die Tab-Leiste und der Assistenten-Knopf liegen über dem Inhalt** und verdecken Zeilen.
7. **Kein Dunkelmodus.**

## Zielbild
- **Apple-UI mit Liquid Glass:** ein ruhiger, farbig verlaufender Hintergrund. Darauf liegen halbtransparente Glasflächen (Unschärfe, feiner heller Rand, weicher Schatten). Die Tab-Leiste schwebt als Glaskapsel unten, die Seitenleiste am Desktop ist ebenfalls Glas.
- **Übersicht:** Titel linksbündig und groß (iOS-Stil). Abschnitte haben normale Groß-/Kleinschreibung, einen Pfeil zum Ein- und Ausklappen und die Anzahl daneben. Nur „Wichtig heute“ und „Aktiv“ starten offen.
- **Zahlen zuerst:** Jede Seite beginnt mit einer Zeile kompakter Zahlenkacheln. Die Geldbeträge sind kleine Kacheln statt riesiger Karten.
- **Arbeit oben, Werkzeuge unten:** **MDC und nextOZ wandern nach unten** (Desktop: rechte Spalte unten). Pro Portal gibt es eine kompakte Zeile mit Logo, Stand, Anzahl und dem Knopf „CSV hochladen“, ohne rohes Dateifeld. Filter nach Portal sitzen direkt an der Auftragstabelle.
- **Augenschonend:** Dunkelmodus automatisch nach Systemeinstellung, Kontraste geprüft (`npm run contrast`), keine reinen Weiß-auf-Grau-Flächen.

## Seiten im Einzelnen
**Heute** (Bild 1)
Begrüßung → 3 Kacheln (Heute wichtig · Kunde wartet · Überfällig) → 2 Geldkacheln (NEXUS · Zulassung) → Wichtig heute → Termine → Überfällig/Offen/Demnächst eingeklappt. Coach-Tipp und Morgenbriefing kommen als Zeile in „Wichtig heute“ statt als eigener Block. Statt der runden Blase gibt es den Glasknopf „Frag den Assistenten“ über der Tab-Leiste.

**Zulassungsdienst** (Bild 2)
Kopf mit Suche (Kunde, Kennzeichen, FIN) und „+ Auftrag“ → eine Zahlenzeile inkl. Geld → links die **Auftragstabelle** mit Umschalter Aktiv/Erledigt/Abgerechnet/Bezahlt und Spalten Kunde, Kennzeichen, Leistung, Status, Quelle (MDC/nextOZ), Preis → darunter eingeklappt Kunden und Zahlungen zuordnen. Rechts „Neu aus WhatsApp“ und **ganz unten „Portale & Import“**. Auf dem iPhone ist es eine Spalte in derselben Reihenfolge, Portale ganz am Ende.

**NEXUS**
Gleiches Muster: Zahlenzeile → Mitglieder-Tabelle mit Umschalter Überfällig/Offen/Alle → Calls und Content eingeklappt → Portal-Mitgliederliste, Stripe-Umstellung und Zuordnen unten.

**Nachrichten** (Bild 3)
Chatliste wie in WhatsApp: Glasliste, Ring am Avatar für „wartet“ (blau) bzw. „zu lange“ (rot), Unterlagen als grüne Marken, Suche und Filter oben.

**Navigation**
4 Tabs: Heute · Nachrichten · NEXUS · Zulassung. Assistent, Verbindungen, Protokoll und Einstellungen liegen am Desktop unten in der Seitenleiste unter „Einstellungen & Quellen“, mobil über das Profilbild oben rechts.

## Umsetzung (Reihenfolge, je ein PR, jeweils mit Screenshots vorher/nachher)
1. **Design-Grundlage:** Farb- und Glas-Variablen in `globals.css` (hell und dunkel), Hintergrundverlauf, Glas-Klassen. `ListGroup`, `PageHeader`, Abschnittsköpfe und Kacheln auf den neuen Stil umstellen. Danach sieht jede Seite automatisch besser aus.
2. **Navigation:** schwebende Glas-Tableiste, Seitenleiste mit „Einstellungen & Quellen“ unten, Assistent-Knopf neu. Inhalte bekommen unten genug Abstand, damit nichts verdeckt wird.
3. **Zulassung:** neue Reihenfolge, Auftragstabelle mit Umschalter, Portale unten als kompakte Zeilen.
4. **Heute:** Kacheln + kompakte Geldkacheln, Coach und Briefing integriert.
5. **NEXUS** nach demselben Muster.
6. **Dunkelmodus und Feinschliff:** Kontrastprüfung, reduzierte Bewegung, E2E und Screenshots auf iPhone und Desktop.

Nicht angefasst werden Rechenlogik, Daten und Verbindungen. Alles bleibt in `src/components` wiederverwendbar.
Aufwand grob: Schritte 1–2 ein Tag, 3–6 je ein halber Tag.
