import { describe, expect, test } from 'vitest';
import { applyEvent } from '@/data/engine';
import { createEmptyState } from '@/data/empty-state';
import { emptyBatch } from '@/domain/import/batch';
import { mergeBatch } from '@/domain/import/merge';
import { applyIntakes } from '@/domain/intake/apply';
import type { ImportedMessage } from '@/domain/import/batch';
import type { Job, Message, Vehicle } from '@/domain/types';
import { NOW_0930, stateWith } from '../helpers';

const vin = 'WVWZZZ1KZAW123456';

function seq() {
  let n = 0;
  return () => `id-${++n}`;
}

function inbound(p: Partial<ImportedMessage> & Pick<ImportedMessage, 'body'>): ImportedMessage {
  return {
    channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'wamid.1', threadId: '+491701112233',
    direction: 'in', from: '+491701112233', to: '+491511111111', sentAt: '2026-11-16T10:00:00.000Z', needsReply: true, ...p,
  };
}

const portalJob: Job = {
  id: 'job-1', vehicleId: 'veh-1', contactId: 'c-1', service: 'Zulassung', location: 'bottrop', priceCents: 0,
  status: 'open', doneAt: null, invoiceIds: [], portalSource: 'mydigitalcar',
  externalRefs: [{ connectionId: 'mydigitalcar', externalId: '9001' }],
  portalData: { Ex_Vorgangsnummer: '9001', FIN: vin, Kennzeichen_Neu: 'BOT-AB 123', Halter_Np_Vorname: 'Erika', Halter_Np_Nachname: 'Beispiel' },
};

const vehicle: Vehicle = { id: 'veh-1', contactId: 'c-1', vin, plate: 'BOT-AB 123', model: 'Golf' };

describe('applyIntakes', () => {
  test('ordnet per FIN an den Portal-Vorgang und merkt den Absender', () => {
    const base = stateWith({
      contacts: [{ id: 'c-1', company: 'zulassung', kind: 'private', name: 'Erika Beispiel', phones: [], emails: [] }],
      vehicles: [vehicle], jobs: [portalJob], messages: [],
    });
    const message = inbound({ body: `Bitte Zulassung. FIN ${vin}. Halter: Erika Beispiel`, profileName: 'Erika Beispiel' });
    const merged = mergeBatch(base, { ...emptyBatch(), messages: [message] }, seq());
    const saved = merged.state.messages[0];
    expect(saved.jobId).toBe('job-1');
    expect(saved.contactId).toBe('c-1');
    expect(saved.intake).toMatchObject({ kind: 'order', classifiedBy: 'rules', vins: [vin] });
    expect(saved.intakeHint).toBeUndefined();
    const job = merged.state.jobs.find((j) => j.id === 'job-1')!;
    expect(job.draft).toBeUndefined();
    expect(job.receipts?.[0]).toMatchObject({ messageId: saved.id, kind: 'order', channel: 'whatsapp', senderName: 'Erika Beispiel', phone: '+491701112233' });
    expect(job.activities?.[0]?.text).toMatch(/Auftrag per WhatsApp von Erika Beispiel zugeordnet/);
    const again = mergeBatch(merged.state, { ...emptyBatch(), messages: [message] }, seq());
    expect(again.state.jobs).toHaveLength(1);
    expect(again.state.jobs[0].activities).toHaveLength(1);
    expect(again.state.contacts).toHaveLength(1);
  });

  test('Kennzeichen, Halter und Telefon treffen den Vorgang', () => {
    const base = stateWith({
      contacts: [{ id: 'c-1', company: 'zulassung', kind: 'private', name: 'Erika Beispiel', phones: ['+491701112233'], emails: [] }],
      vehicles: [vehicle], jobs: [portalJob],
    });
    const plate = mergeBatch(base, { ...emptyBatch(), messages: [inbound({ externalId: 'a', body: 'Bitte Zulassung für BOT-AB 123' })] }, seq());
    expect(plate.state.messages[0].jobId).toBe('job-1');
    const holder = mergeBatch(base, { ...emptyBatch(), messages: [inbound({ externalId: 'b', from: '+491709998877', threadId: '+491709998877', body: 'Bitte Zulassung. Halter: Erika Beispiel' })] }, seq());
    expect(holder.state.messages[0].jobId).toBe('job-1');
    const phone = mergeBatch(base, { ...emptyBatch(), messages: [inbound({ externalId: 'c', body: 'Bitte die Zulassung, eVB folgt.' })] }, seq());
    expect(phone.state.messages[0].jobId).toBe('job-1');
    expect(phone.state.messages[0].contactId).toBe('c-1');
  });

  test('ohne Vorgang entsteht ein Entwurf und ein Kontakt mit Nummer', () => {
    const merged = mergeBatch(createEmptyState(), { ...emptyBatch(), messages: [inbound({ body: `Bitte Abmeldung. FIN ${vin}, Kennzeichen E-CD 44` })] }, seq());
    expect(merged.state.contacts).toEqual([expect.objectContaining({ name: '+491701112233', phones: ['+491701112233'], company: 'zulassung', kind: 'private' })]);
    const job = merged.state.jobs[0];
    expect(job).toMatchObject({ draft: true, origin: 'whatsapp', service: 'Abmeldung', status: 'open', priceCents: 0, contactId: merged.state.contacts[0].id });
    expect(job.activities?.[0]?.text).toMatch(/Entwurf aus WhatsApp/);
    expect(merged.state.messages[0].jobId).toBe(job.id);
    expect(merged.state.vehicles[0]).toMatchObject({ vin, plate: 'E-CD 44' });
  });

  test('Profilname wird zum Kontakt, Nachweis per E-Mail hängt am Vorgang', () => {
    const base = stateWith({ vehicles: [vehicle], jobs: [{ ...portalJob, contactId: null }], contacts: [] });
    const mail: ImportedMessage = {
      channel: 'email', connectionId: 'info_mail', externalId: 'm1', threadId: 'm1', direction: 'in',
      from: 'Lea Beispiel <lea@example.de>', to: 'info@example.de', subject: 'Zulassungsbescheinigung',
      body: `Anbei die Zulassungsbescheinigung. FIN ${vin}.`, sentAt: '2026-11-16T11:00:00.000Z', needsReply: true,
    };
    const merged = mergeBatch(base, { ...emptyBatch(), messages: [mail] }, seq());
    const job = merged.state.jobs[0];
    expect(job.receipts?.[0]).toMatchObject({ kind: 'proof', channel: 'email', email: 'lea@example.de', senderName: 'Lea Beispiel' });
    expect(merged.state.contacts[0]).toMatchObject({ name: 'Lea Beispiel', emails: ['lea@example.de'] });
    expect(job.activities?.[0]?.text).toMatch(/Nachweis per E-Mail/);
  });

  test('unklarer Text nimmt den KI-Stich', () => {
    const message = inbound({ body: 'Anbei ZB I und die Zulassungsbescheinigung.', intakeHint: 'proof' });
    const merged = mergeBatch(createEmptyState(), { ...emptyBatch(), messages: [message] }, seq());
    expect(merged.state.messages[0].intake).toMatchObject({ kind: 'proof', classifiedBy: 'ai', confidence: 'medium' });
    expect(merged.state.jobs[0].receipts?.[0].kind).toBe('proof');
  });

  test('schon vorhandene Nachricht wird nicht noch einmal erkannt', () => {
    const once = mergeBatch(createEmptyState(), { ...emptyBatch(), messages: [inbound({ body: `Bitte Zulassung FIN ${vin}` })] }, seq());
    const extra = applyIntakes(once.state, seq(), new Set(once.state.messages.map((m) => m.id)));
    expect(extra.jobs).toHaveLength(1);
    expect(extra).toBe(once.state);
  });

  test('Zuordnung im Chat und Status schreiben einen Verlauf', () => {
    const base = stateWith({
      contacts: [{ id: 'c-1', company: 'zulassung', kind: 'private', name: 'Erika Beispiel', phones: ['+491701112233'], emails: [] }],
      vehicles: [vehicle], jobs: [portalJob],
      messages: [{
        id: 'm-1', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'w', threadId: '+491701112233',
        direction: 'in', from: '+491701112233', to: '+491511111111', body: 'Hallo', sentAt: '2026-11-16T10:00:00.000Z',
        contactId: null, jobId: null, needsReply: true, profileName: 'Erika',
      } satisfies Message],
    });
    const assigned = applyEvent(base, { type: 'assignThread', threadId: '+491701112233', contactId: 'c-1', jobId: 'job-1' }, { at: NOW_0930, isDemo: true, newId: seq() }).state;
    expect(assigned.messages[0]).toMatchObject({ contactId: 'c-1', jobId: 'job-1' });
    expect(assigned.jobs[0].activities?.[0]?.text).toMatch(/Zuordnung geändert: Erika Beispiel/);
    const done = applyEvent(assigned, { type: 'setJobStatus', jobId: 'job-1', status: 'done' }, { at: NOW_0930, isDemo: true, newId: seq() }).state;
    expect(done.jobs[0].activities?.map((a) => a.text).join('\n')).toMatch(/Status geändert: Offen → Erledigt/);
    expect(done.messages).toHaveLength(1);
  });
});
