import { describe, expect, test } from 'vitest';
import { classifyJobMessage, jobActivity, unlinkedOrderMessages, DOC_LABEL } from '@/domain/matching/job-messages';
import type { Contact, Job, Message, Vehicle } from '@/domain/types';

const msg = (over: Partial<Message>): Message => ({
  id: 'm1', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'w1', threadId: '+491715551234',
  direction: 'in', from: '+491715551234', to: '+491511111111', body: '', sentAt: '2026-11-17T08:00:00.000Z',
  contactId: null, jobId: null, needsReply: true, ...over,
});

const vehicle: Vehicle = { id: 'v1', contactId: 'c1', vin: 'WVWZZZ1KZAW000001', plate: 'BOT-AB 123', model: 'Golf' };
const job: Job = {
  id: 'j1', vehicleId: 'v1', contactId: 'c1', service: 'Ummeldung', location: 'online', priceCents: 0, status: 'open',
  doneAt: null, invoiceIds: [], portalSource: 'mydigitalcar', portalData: { Ex_Vorgangsnummer: 'MDC-778899' },
};
const anna: Contact = { id: 'c1', company: 'zulassung', kind: 'private', name: 'Anna Beispiel', phones: ['0171 5551234'], emails: [] };
const state = (messages: Message[]) => ({ messages, vehicles: [vehicle], jobs: [job], contacts: [anna] });

describe('classifyJobMessage', () => {
  test('Auftrag an Schlüsselwörtern', () => {
    expect(classifyJobMessage('Kannst du den Golf morgen ummelden? FIN WVWZZZ1KZAW000001').kind).toBe('auftrag');
    expect(classifyJobMessage('Bitte Abmeldung für BOT-AB 123').kind).toBe('auftrag');
    expect(classifyJobMessage('Neuzulassung, Wunschkennzeichen BOT-XY 1').kind).toBe('auftrag');
  });
  test('Nachweis an Dokumenten und Medien', () => {
    const zb = classifyJobMessage('[Bild] Fahrzeugschein vorne');
    expect(zb.kind).toBe('nachweis');
    expect(zb.docs).toEqual(['zb1']);
    expect(classifyJobMessage('[Dokument · Vollmacht_Muster.pdf]').docs).toEqual(['vollmacht']);
    expect(classifyJobMessage('eVB-Nummer: A1B2C3D').docs).toEqual(['evb']);
    expect(classifyJobMessage('Zulassungsbescheinigung Teil II und Personalausweis').docs).toEqual(['zb2', 'ausweis']);
    expect(classifyJobMessage('[Bild]').kind).toBe('nachweis');
    expect(DOC_LABEL.evb).toBe('eVB');
  });
  test('Alltagstext ist nichts', () => {
    expect(classifyJobMessage('Danke dir, bis morgen!').kind).toBeNull();
    expect(classifyJobMessage('Ich schreibe dir einen Brief').docs).toEqual([]);
  });
});

describe('jobActivity', () => {
  test('findet Nachrichten über jobId, Kennzeichen, FIN und Vorgangsnummer, mit Absender', () => {
    const messages = [
      msg({ id: 'a', body: '[Bild] Fahrzeugschein BOT AB123', fromName: 'Max Muster', sentAt: '2026-11-17T09:00:00.000Z' }),
      msg({ id: 'b', body: 'Status zu MDC-778899?', from: '+491609999999', sentAt: '2026-11-17T10:00:00.000Z' }),
      msg({ id: 'c', body: 'Gruß', jobId: 'j1', direction: 'out', from: '+491511111111', to: '+491715551234', sentAt: '2026-11-17T07:00:00.000Z' }),
      msg({ id: 'd', body: 'Anderes Auto BOT-ZZ 9' }),
    ];
    const act = jobActivity(job, state(messages));
    expect(act.map((e) => e.messageId)).toEqual(['b', 'a', 'c']);
    expect(act[1]).toMatchObject({ kind: 'nachweis', docs: ['zb1'], senderName: 'Anna Beispiel', senderPhone: '+491715551234' });
    expect(act[0]).toMatchObject({ senderName: null, senderPhone: '+491609999999' });
    expect(act[2]).toMatchObject({ direction: 'out', senderName: 'Du' });
  });
  test('ohne Kontakt gilt der Profilname', () => {
    const act = jobActivity(job, { ...state([msg({ body: 'Fahrzeugschein für BOT-AB 123', fromName: 'Max Muster' })]), contacts: [] });
    expect(act[0].senderName).toBe('Max Muster');
  });
});

describe('unlinkedOrderMessages', () => {
  test('eingehende Aufträge und Nachweise ohne passenden Auftrag', () => {
    const messages = [
      msg({ id: 'x', body: 'Bitte ummelden: HER-Q 77', fromName: 'Max', from: '+491605550000' }),
      msg({ id: 'y', body: 'Fahrzeugschein für BOT-AB 123' }),
      msg({ id: 'z', body: 'Danke!' }),
      msg({ id: 'o', body: 'Bitte ummelden', direction: 'out' }),
    ];
    const list = unlinkedOrderMessages(state(messages));
    expect(list.map((e) => e.messageId)).toEqual(['x']);
    expect(list[0]).toMatchObject({ kind: 'auftrag', plates: ['HER-Q 77'], senderName: 'Max' });
  });
  test('Auftrag ohne Fahrzeug bleibt über die Vorgangsnummer verknüpft', () => {
    const bare: Job = {
      ...job, id: 'j2', vehicleId: null, contactId: null, portalSource: 'nextoz',
      portalData: { Auftragsnummer: '#9cc78db5' },
    };
    const messages = [
      msg({ id: 'n', body: 'Bitte Status zur Ummeldung #9cc78db5' }),
      msg({ id: 'x', body: 'Bitte ummelden: HER-Q 77', fromName: 'Max', from: '+491605550000' }),
    ];
    const base = { ...state(messages), jobs: [bare] };
    expect(jobActivity(bare, base).map((e) => e.messageId)).toEqual(['n']);
    expect(unlinkedOrderMessages(base).map((e) => e.messageId)).toEqual(['x']);
  });
});
