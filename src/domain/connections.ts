import type { Company, Connection, ConnectionId, MemberContract } from './types';

export const CONNECTION_CATALOG: readonly { id: ConnectionId; company: Company | null; label: string }[] = [
  { id: 'lexware_nexus', company: 'nexus', label: 'Lexware NEXUS' },
  { id: 'lexware_zulassung', company: 'zulassung', label: 'Lexware Zulassungsdienst' },
  { id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS' },
  { id: 'bank_qonto', company: 'nexus', label: 'Qonto (NEXUS)' },
  { id: 'bank_sparkasse', company: 'zulassung', label: 'Sparkasse (Zulassung)' },
  { id: 'gmail', company: null, label: 'Gmail' },
  { id: 'icloud', company: null, label: 'iCloud-Mail' },
  { id: 'info_mail', company: 'zulassung', label: 'info@-Postfach' },
  { id: 'calendar', company: null, label: 'Kalender' },
  { id: 'whatsapp_kunden', company: 'zulassung', label: 'WhatsApp Kunden' },
  { id: 'whatsapp_assistent', company: null, label: 'WhatsApp Assistent' },
  { id: 'portal_nexus', company: 'nexus', label: 'NEXUS-Portal' },
  { id: 'claude_invoices', company: 'nexus', label: 'Claude (Rechnungen lesen)' },
  { id: 'mydigitalcar', company: 'zulassung', label: 'myDigitalCar' },
  { id: 'nextoz', company: 'zulassung', label: 'nextOZ' },
];

/** Lexware-Verbindung je Firma. */
export const LEXWARE_OF: Record<Company, 'lexware_nexus' | 'lexware_zulassung'> = { nexus: 'lexware_nexus', zulassung: 'lexware_zulassung' };

/** Kurzanleitung für die echte Anbindung in Phase 2. */
export const HOW_TO: Record<ConnectionId, string> = {
  lexware_nexus: 'Schlüssel als Vercel-Variable LEXWARE_NEXUS_API_KEY hinterlegen (nur lesen: Kontakte, Rechnungen, Zahlungen).',
  lexware_zulassung: 'Schlüssel als Vercel-Variable LEXWARE_ZULASSUNG_API_KEY hinterlegen (nur lesen: Kontakte, Rechnungen, Zahlungen).',
  stripe_nexus: 'Schlüssel als Vercel-Variable STRIPE_RESTRICTED_KEY hinterlegen (nur lesen: Kunden, Abos, Rechnungen, Zahlungen).',
  bank_qonto: 'Qonto → Einstellungen → Integrationen → API-Schlüssel: Login und Secret Key als Vercel-Variablen QONTO_LOGIN und QONTO_SECRET_KEY hinterlegen (nur lesen).',
  bank_sparkasse: 'Kommt als Upload (CAMT- oder CSV-Export).',
  gmail: 'Eigenes Gmail: Im Google-Konto die Bestätigung in zwei Schritten einschalten, danach ein App-Passwort anlegen (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter, Name z. B. „NEXUS“). In Gmail unter Einstellungen → Weiterleitung und POP/IMAP „IMAP aktivieren“. Gmail-Adresse und das 16-stellige Passwort als IMAP_GMAIL_USER und IMAP_GMAIL_PASSWORD hinterlegen. Server imap.gmail.com, Port 993, TLS, nur lesen.',
  icloud: 'Optional. Apple-ID → Anmeldung und Sicherheit → App-spezifische Passwörter, ein Passwort für „NEXUS“ erzeugen. Apple-ID und dieses Passwort als IMAP_ICLOUD_USER und IMAP_ICLOUD_PASSWORD hinterlegen. Server imap.mail.me.com, Port 993, TLS, nur lesen.',
  info_mail: 'Das info@-Postfach ist ein normales Gmail-Konto (@gmail.com). Bestätigung in zwei Schritten einschalten und ein App-Passwort anlegen (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter). In Gmail IMAP aktivieren. Die @gmail.com-Adresse und das App-Passwort als IMAP_INFO_MAIL_USER und IMAP_INFO_MAIL_PASSWORD hinterlegen. Server standardmäßig imap.gmail.com, Port 993, TLS, nur lesen. Abweichenden Server nur über IMAP_INFO_MAIL_HOST und IMAP_INFO_MAIL_PORT.',
  calendar: 'Google- oder iCloud-Kalender freigeben.',
  whatsapp_kunden: 'Offizielle WhatsApp Cloud API (Meta) für die Kundennummer des Zulassungsdienstes, Coexistence: Die WhatsApp-Business-App am Handy bleibt an, dieselben Chats kommen zusätzlich hier an. Es wird nur gelesen, nichts gesendet. 1) developers.facebook.com → App erstellen, Typ „Business“. 2) Produkt „WhatsApp“ hinzufügen. Das Unternehmen ist bereits verifiziert (blaues Häkchen). 3) Bestehende Business-Nummer verbinden: WhatsApp → API-Einrichtung → Embedded Signup mit Coexistence (Feature whatsapp_business_app_onboarding). In der Business-App am Handy zustimmen; die App bleibt nutzbar. 4) Business Manager → Nutzer → Systemnutzer anlegen, der App und dem WhatsApp-Konto zuweisen, dauerhaftes Token erzeugen mit den Berechtigungen whatsapp_business_messaging und whatsapp_business_management. 5) In Vercel setzen: WHATSAPP_PHONE_NUMBER_ID (Telefonnummern-ID aus der API-Einrichtung, nicht die Rufnummer), WHATSAPP_ACCESS_TOKEN (Systemnutzer-Token), WHATSAPP_APP_SECRET (App → Einstellungen → Grundlagen), WHATSAPP_VERIFY_TOKEN (selbst gewähltes Geheimnis), optional WHATSAPP_WABA_ID (WhatsApp-Business-Account-ID). 6) Webhook: Callback-URL https://nexus-nexus-0349.vercel.app/api/webhooks/whatsapp, Verify-Token = WHATSAPP_VERIFY_TOKEN. Felder abonnieren: messages, smb_message_echoes, history. Ohne diese Variablen bleibt die Quelle unverbunden.',
  whatsapp_assistent: 'Zweite Nummer einrichten und Meta-Vorlagen für Briefings freigeben lassen.',
  portal_nexus: 'Mitgliederliste auf portal.nexusnetzwerk.de/mitglieder kopieren (oder als CSV speichern) und unter NEXUS → Portal-Mitglieder → „Mitgliederliste einfügen“ übernehmen.',
  claude_invoices: 'Schlüssel als Vercel-Variable ANTHROPIC_API_KEY hinterlegen. Claude liest dann offene NEXUS-Rechnungen auf Ratenvereinbarungen (Monatslimit 100 €).',
  mydigitalcar: 'Vorgänge auf web.mydigitalcar.de als CSV exportieren (Semikolon, UTF-8, eine Kopfzeile) und unter Zulassungsdienst bei myDigitalCar hochladen. Dieselbe Datei kann das MCP-Werkzeug import_portal_csv mit source mydigitalcar übernehmen. Große Exporte dürfen in Portionen kommen, jede Portion mit derselben Kopfzeile.',
  nextoz: 'nextOZ ist eine eigene Quelle neben myDigitalCar. Die Anträge-Liste von dashboard.nextoz.de als CSV speichern (Semikolon, UTF-8, Kopfzeile Nr;Auftragsnummer;Kennzeichen;FIN;Antragsart;Datum;Status;Fehler;Amtsgebuehr) und unter Zulassungsdienst bei nextOZ hochladen. Dieselbe Datei kann das MCP-Werkzeug import_portal_csv mit source nextoz übernehmen. Schlüssel ist die Auftragsnummer ohne #, Nr ist nur die Listenposition.',
};

/** True, wenn alle genannten Quellen noch nicht verbunden sind (Status 'missing'). */
export function notConnected(sources: ConnectionId[], connections: Connection[]): boolean {
  return sources.length > 0 && sources.every((id) => connections.find((c) => c.id === id)?.status === 'missing');
}

/** Quellen, aus denen sich der Stand eines Vertrags speist: Banküberweisung → Bank, Stripe → Stripe NEXUS. */
export function contractSources(c: MemberContract): ConnectionId[] {
  return c.billing === 'legacy' ? ['bank_qonto'] : ['stripe_nexus'];
}
