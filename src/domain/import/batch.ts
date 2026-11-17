import type { ConnectionId, Contact, ExternalRef, Invoice, IsoDate, Message, OrderConfirmation, Payment, Subscription } from '@/domain/types';

/** Erstimport holt nur Daten ab diesem Tag; danach inkrementell. */
export const IMPORT_SINCE: IsoDate = '2026-06-01';

/** Gespeicherter Cursor mit späterem oder ohne `since`: Die Verbindung startet einmal von vorn (IMPORT_SINCE wurde vorverlegt). */
export const cursorOutdated = (since: unknown): boolean => typeof since !== 'string' || since > IMPORT_SINCE;

export type ImportedContact = Omit<Contact, 'id' | 'externalRefs'> & { externalRefs: ExternalRef[] };
export type ImportedInvoice = Omit<Invoice, 'id' | 'contactId'>;
export type ImportedOrderConfirmation = Omit<OrderConfirmation, 'id' | 'contactId'>;
export type ImportedPayment = Omit<Payment, 'id'>;
export type ImportedSubscription = Omit<Subscription, 'id' | 'contractId' | 'confirmedPriceCents' | 'confirmedEndDate' | 'disputes'>;
export interface ImportedDispute { externalId: string; invoiceExternalId: string | null }
/** Nachricht ohne lokale Identität. Kontakt und Auftrag setzt der Merge. */
export type ImportedMessage = Omit<Message, 'id' | 'contactId' | 'jobId' | 'doneManually'>;
/** Termin für einen späteren Kalender-Abruf. Idempotent über Quelle und externe ID. */
export interface ImportedEvent { connectionId: ConnectionId; externalId: string; title: string; startAt: string; endAt: string; location?: string }

export interface ImportBatch {
  contacts: ImportedContact[];
  invoices: ImportedInvoice[];
  payments: ImportedPayment[];
  subscriptions: ImportedSubscription[];
  disputes: ImportedDispute[];
  orderConfirmations: ImportedOrderConfirmation[];
  messages: ImportedMessage[];
  events: ImportedEvent[];
  /** Kalender-Abruf: Fenster [fromAt, toAt) der Verbindung. Ihre Termine darin, die der Stapel nicht mehr nennt, entfallen. */
  eventWindow?: { connectionId: ConnectionId; fromAt: string; toAt: string };
}

export const emptyBatch = (): ImportBatch => ({
  contacts: [], invoices: [], payments: [], subscriptions: [], disputes: [], orderConfirmations: [], messages: [], events: [],
});
