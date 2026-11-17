import { describe, expect, test } from 'vitest';
import { applyEvent, refresh } from '@/data/engine';
import { matchOptions, unallocatedBankPayments } from '@/data/selectors';
import { buildMatchContext } from '@/domain/detectors/payments';
import { invoiceAllocatableCents } from '@/domain/ledger/receivables';
import { matchBankPayment } from '@/domain/matching/payments';
import { IBAN_KAYA, NOW_0930, base, ibanLinks, inv, member, stateWith, tx } from '../helpers';

// Event-Ticket (keine Mitgliedschaft), in Lexware schon bezahlt, Zahlung in der App noch nicht zugeordnet.
const ticket = inv('i-t1', 35000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya', number: 'RE0002', status: 'paid', openCents: 0, issuedOn: '2026-07-20', dueDate: '2026-07-27', text: 'Event Ticket' });
const kaya = { ...base, id: 'k-kaya', contactId: 'm-kaya' };
const apply = (s: ReturnType<typeof stateWith>, e: Parameters<typeof applyEvent>[1]) => applyEvent(s, e, { at: NOW_0930, isDemo: true, newId: () => 'n1' }).state;

describe('NEXUS: Event-Tickets, in Lexware bezahlt', () => {
  test('Kontext führt bezahlte Ticket-Rechnung ohne Zuordnung, aber keine bezahlte Mitgliedsrechnung', () => {
    const paidMember = { ...member('i-m1'), contactId: 'm-kaya', status: 'paid' as const, openCents: 0 };
    const c = buildMatchContext(stateWith({ invoices: [ticket, paidMember], contracts: [kaya] }), NOW_0930);
    expect(c.invoices.filter((i) => i.paidInLexware).map((i) => i.id)).toEqual(['i-t1']);
  });
  test('schon zugeordnete bezahlte Ticket-Rechnung ist kein Ziel mehr', () => {
    const s = stateWith({ invoices: [ticket], allocations: [{ paymentId: 'p9', invoiceId: 'i-t1', amountCents: 35000, method: 'confirmed' }] });
    expect(buildMatchContext(s, NOW_0930).invoices).toEqual([]);
  });
  test('Rechnungsnummer im Zweck → automatisch auf die Ticket-Rechnung, nicht auf den Vertrag', () => {
    const s = stateWith({ invoices: [ticket], contracts: [kaya], ibanLinks, payments: [tx({ iban: IBAN_KAYA, amountCents: 35000, reference: 'Rechnungsnummer: RE0002' })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930))).toMatchObject({ confidence: 'high', target: { kind: 'invoice', id: 'i-t1' } });
    expect(refresh(s, NOW_0930).allocations).toEqual([{ paymentId: 'p1', invoiceId: 'i-t1', amountCents: 35000, method: 'auto' }]);
  });
  test('bestätigte IBAN, Betrag = Ticket → Ticket-Rechnung statt Vertrag', () => {
    const s = stateWith({ invoices: [ticket], contracts: [kaya], ibanLinks, payments: [tx({ iban: IBAN_KAYA, amountCents: 35000, reference: '10006' })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930))).toMatchObject({ confidence: 'high', target: { kind: 'invoice', id: 'i-t1' } });
  });
  test('„Event“ im Zweck: nie auf den Mitgliedsvertrag, auch ohne passende Rechnung', () => {
    const s = stateWith({ contracts: [kaya], ibanLinks, payments: [tx({ iban: IBAN_KAYA, amountCents: 30000, reference: 'FRANKFURT EVENT TICKET' })] });
    const m = matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930));
    expect(m.candidates.filter((c) => c.kind === 'contract')).toEqual([]);
    expect(m).toMatchObject({ confidence: 'low', target: null, reason: 'Event-Zahlung: bitte die Ticket-Rechnung wählen, nicht den Mitgliedsbeitrag.' });
    expect(refresh(s, NOW_0930).allocations).toEqual([]);
  });
  test('bezahlte Ticket-Rechnung ist in der Auswahl und lässt sich bestätigen', () => {
    const s = stateWith({ invoices: [ticket], contracts: [kaya], payments: [tx({ amountCents: 35000 })] });
    expect(invoiceAllocatableCents(s, ticket)).toBe(35000);
    expect(matchOptions(s).map((o) => o.value)).toContain('invoice:i-t1');
    const r = apply(s, { type: 'confirmPaymentMatch', paymentId: 'p1', invoiceId: 'i-t1' });
    expect(r.allocations).toEqual([{ paymentId: 'p1', invoiceId: 'i-t1', amountCents: 35000, method: 'confirmed' }]);
    expect(unallocatedBankPayments(r)).toEqual([]);
  });
  test('bezahlte Mitgliedsrechnung bleibt ohne zuordenbaren Rest', () => {
    const paidMember = { ...member('i-m1'), contactId: 'm-kaya', status: 'paid' as const, openCents: 0 };
    const s = stateWith({ invoices: [paidMember], contracts: [kaya] });
    expect(invoiceAllocatableCents(s, paidMember)).toBe(0);
    expect(matchOptions(s).map((o) => o.value)).not.toContain('invoice:i-m1');
  });
});
