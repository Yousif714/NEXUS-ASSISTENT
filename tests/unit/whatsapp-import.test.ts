import { describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { HOW_TO } from '@/domain/connections';
import { emptyBatch } from '@/domain/import/batch';
import { parseWhatsAppWebhook } from '@/domain/import/whatsapp';
import { mergeBatch } from '@/domain/import/merge';
import type { Contact } from '@/domain/types';

const PHONE = 'pn-1';
const WABA = 'waba-1';
const BIZ = '491511111111';
const CUSTOMER = '491715551234';
const TS = '1731800000';

const meta = { display_phone_number: BIZ, phone_number_id: PHONE };
const text = (id: string, from: string, body: string, extra: Record<string, unknown> = {}) => ({
  from, id, timestamp: TS, type: 'text', text: { body }, ...extra,
});

function payload(changes: unknown[], entryId = WABA) {
  return { object: 'whatsapp_business_account', entry: [{ id: entryId, changes }] };
}

const anna: Contact = {
  id: 'c-anna', company: 'zulassung', kind: 'private', name: 'Anna Beispiel', phones: ['0171 5551234'], emails: ['anna@example.de'],
};

describe('parseWhatsAppWebhook', () => {
  test('Text wird E.164, eingehend, und hängt am Kontakt', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: meta, messages: [text('wamid.1', CUSTOMER, 'Ist die Zulassung fertig?')] },
    }]), { phoneNumberId: PHONE });
    expect(parsed.relevant).toBe(true);
    expect(parsed.batch.messages).toHaveLength(1);
    expect(parsed.batch.messages[0]).toMatchObject({
      channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'wamid.1', direction: 'in',
      from: '+491715551234', to: '+491511111111', threadId: '+491715551234', body: 'Ist die Zulassung fertig?', needsReply: true,
    });
    const merged = mergeBatch({ ...createEmptyState(), contacts: [anna] }, parsed.batch, () => 'id-1');
    expect(merged.added.messages).toBe(1);
    expect(merged.state.messages[0].contactId).toBe('c-anna');
    const again = mergeBatch(merged.state, parsed.batch, () => 'id-2');
    expect(again.added.messages).toBe(0);
    expect(again.state.messages).toHaveLength(1);
    expect(again.state.messages[0].id).toBe('id-1');
  });

  test('dieselbe ID im Stapel bleibt eine Zeile', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: meta, messages: [text('wamid.1', CUSTOMER, 'Erste'), text('wamid.1', CUSTOMER, 'Zweite')] },
    }]));
    expect(parsed.batch.messages).toHaveLength(1);
    expect(parsed.batch.messages[0].body).toBe('Zweite');
  });

  test('Echo aus der Business-App ist ausgehend und gewinnt gegen dieselbe ID', () => {
    const parsed = parseWhatsAppWebhook(payload([
      { field: 'messages', value: { metadata: meta, messages: [text('wamid.echo', CUSTOMER, 'Kundentext')] } },
      {
        field: 'smb_message_echoes',
        value: {
          metadata: meta,
          message_echoes: [{ from: BIZ, to: CUSTOMER, id: 'wamid.echo', timestamp: TS, type: 'text', text: { body: 'Antwort vom Handy' } }],
        },
      },
    ]), { phoneNumberId: PHONE, wabaId: WABA });
    expect(parsed.batch.messages).toEqual([expect.objectContaining({
      externalId: 'wamid.echo', direction: 'out', from: '+491511111111', to: '+491715551234', body: 'Antwort vom Handy', needsReply: false,
    })]);
    const merged = mergeBatch({ ...createEmptyState(), contacts: [anna] }, { ...emptyBatch(), messages: parsed.batch.messages }, () => 'id-1');
    expect(merged.state.messages[0].contactId).toBe('c-anna');
  });

  test('Medien nur als Metadaten, ohne Abruf und ohne Medien-ID', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: {
        metadata: meta,
        messages: [{
          from: CUSTOMER, id: 'wamid.img', timestamp: TS, type: 'image',
          image: { caption: 'Kennzeichen', mime_type: 'image/jpeg', sha256: 'abc123sha', id: 'media-1' },
        }, {
          from: CUSTOMER, id: 'wamid.doc', timestamp: TS, type: 'document',
          document: { filename: 'schein.pdf', mime_type: 'application/pdf', id: 'media-2', url: 'https://example.invalid/schein.pdf' },
        }],
      },
    }]));
    expect(parsed.batch.messages.map((m) => m.body)).toEqual(['[Bild · image/jpeg] Kennzeichen', '[Dokument · schein.pdf]']);
    const blob = parsed.batch.messages.map((m) => m.body).join('\n');
    expect(blob).not.toContain('media-1');
    expect(parsed.batch.messages[0].attachments?.[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg', mediaId: 'media-1', caption: 'Kennzeichen' });
    expect(parsed.batch.messages[1].attachments?.[0]).toMatchObject({ kind: 'document', filename: 'schein.pdf', mediaId: 'media-2' });
    expect(JSON.stringify(parsed.batch.messages[1].attachments)).not.toContain('http');
    expect(blob).not.toContain('abc123sha');
    expect(blob).not.toContain('http');
  });

  test('Historie: Richtung, gelesen, Fortschritt; Kontakt-Sync legt niemanden an', () => {
    const history = parseWhatsAppWebhook(payload([{
      field: 'history',
      value: {
        metadata: meta,
        history: [{
          metadata: { phase: 0, chunk_order: 1, progress: 40 },
          threads: [{
            id: CUSTOMER,
            messages: [
              { from: CUSTOMER, id: 'wamid.h1', timestamp: '1731700000', type: 'text', text: { body: 'Alt ungelesen' }, history_context: { status: 'delivered' } },
              { from: BIZ, id: 'wamid.h2', timestamp: '1731700001', type: 'text', text: { body: 'Schon geantwortet' }, history_context: { status: 'read' } },
              { from: CUSTOMER, id: 'wamid.h3', timestamp: '1731700002', type: 'media_placeholder', history_context: { status: 'read' } },
            ],
          }],
        }],
      },
    }]));
    expect(history.historySeen).toBe(true);
    expect(history.complete).toBe(false);
    expect(history.batch.messages.map((m) => [m.externalId, m.direction, m.needsReply, m.body])).toEqual([
      ['wamid.h1', 'in', true, 'Alt ungelesen'],
      ['wamid.h2', 'out', false, 'Schon geantwortet'],
      ['wamid.h3', 'in', false, '[Medium] In der Historie nicht mehr verfügbar'],
    ]);
    expect(history.batch.messages[1]).toMatchObject({ to: '+491715551234', threadId: '+491715551234' });

    const sync = parseWhatsAppWebhook(payload([{
      field: 'smb_app_state_sync',
      value: {
        metadata: meta,
        state_sync: [{ type: 'contact', contact: { full_name: 'Anna Beispiel', phone_number: CUSTOMER }, action: 'add' }],
      },
    }]));
    expect(sync.relevant).toBe(true);
    expect(sync.batch.messages).toEqual([]);
    expect(sync.batch.contacts).toEqual([]);
  });

  test('Status erzeugt keine Nachricht, fremde Nummer und fremdes Konto werden verworfen', () => {
    const status = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: meta, statuses: [{ id: 'wamid.status', status: 'delivered', timestamp: TS, recipient_id: CUSTOMER }] },
    }]), { phoneNumberId: PHONE });
    expect(status.relevant).toBe(true);
    expect(status.batch.messages).toEqual([]);

    const otherPhone = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: { ...meta, phone_number_id: 'pn-fremd' }, messages: [text('wamid.x', CUSTOMER, 'Nein')] },
    }]), { phoneNumberId: PHONE });
    expect(otherPhone.relevant).toBe(false);
    expect(otherPhone.batch.messages).toEqual([]);

    const otherWaba = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: meta, messages: [text('wamid.x', CUSTOMER, 'Nein')] },
    }], 'waba-fremd'), { wabaId: WABA });
    expect(otherWaba.relevant).toBe(false);
  });

  test('Profilname aus dem Webhook hängt an der eingehenden Nachricht', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: {
        metadata: meta,
        contacts: [{ profile: { name: 'Lea Beispiel' }, wa_id: CUSTOMER }],
        messages: [text('wamid.n', CUSTOMER, 'Hallo')],
      },
    }]));
    expect(parsed.batch.messages[0]).toMatchObject({ profileName: 'Lea Beispiel', threadId: '+491715551234' });
  });

  test('Gruppenchat wird nicht übernommen', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: { metadata: meta, messages: [{ ...text('wamid.g', CUSTOMER, 'Gruppe'), group_id: '120363' }] },
    }]));
    expect(parsed.batch.messages).toEqual([]);
    expect(parsed.relevant).toBe(true);
  });
});

test('Anleitung nennt Coexistence, Webhook und die Felder', () => {
  expect(HOW_TO.whatsapp_kunden).toMatch(/Coexistence/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/whatsapp_business_app_onboarding/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/whatsapp_business_messaging/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/whatsapp_business_management/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/https:\/\/nexus-iota-gold-96\.vercel\.app\/api\/webhooks\/whatsapp/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/smb_message_echoes/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/WHATSAPP_VERIFY_TOKEN/);
  expect(HOW_TO.whatsapp_kunden).toMatch(/nichts gesendet/);
});

describe('Absendername aus dem WhatsApp-Profil', () => {
  test('profile.name landet als fromName an der eingehenden Nachricht und bleibt beim Merge', () => {
    const parsed = parseWhatsAppWebhook(payload([{
      field: 'messages',
      value: {
        metadata: meta,
        contacts: [{ profile: { name: 'Max Muster' }, wa_id: CUSTOMER }],
        messages: [text('wamid.p1', CUSTOMER, 'Hallo')],
      },
    }]));
    expect(parsed.batch.messages[0].fromName).toBe('Max Muster');
    const merged = mergeBatch(createEmptyState(), parsed.batch, () => 'id-p1');
    expect(merged.state.messages[0].fromName).toBe('Max Muster');
    const later = parseWhatsAppWebhook(payload([{
      field: 'messages', value: { metadata: meta, messages: [text('wamid.p1', CUSTOMER, 'Hallo')] },
    }]));
    expect(mergeBatch(merged.state, later.batch, () => 'x').state.messages[0].fromName).toBe('Max Muster');
  });
});
