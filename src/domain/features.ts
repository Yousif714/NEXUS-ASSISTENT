import type { AppState, Message } from './types';

/**
 * WhatsApp in der App (Inhaber 17.11.2026: „Entfern WhatsApp aus der App“).
 * Aus: kein Tab, keine Wartet-Zahlen, keine WhatsApp-Hinweise, Webhook speichert nichts.
 * Vorhandene Nachrichten bleiben in der Datenbank, werden aber nicht ausgeliefert.
 */
export const WHATSAPP_IN_APP = false;

export const showMessage = (m: Pick<Message, 'channel'>): boolean => WHATSAPP_IN_APP || m.channel !== 'whatsapp';

/** Zustand für die Anzeige: ohne WhatsApp-Nachrichten, solange WhatsApp aus ist. */
export function visibleState<S extends Pick<AppState, 'messages'>>(s: S): S {
  return WHATSAPP_IN_APP ? s : { ...s, messages: s.messages.filter(showMessage) };
}
