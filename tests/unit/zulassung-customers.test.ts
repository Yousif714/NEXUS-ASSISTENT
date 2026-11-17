import { describe, expect, test } from 'vitest';

import { peopleSummary } from '@/components/people-summary';
import { createDemoState } from '@/data/seed';
import { matchesCustomer, zulassungCustomers } from '@/data/selectors';
import { inv, stateWith } from './helpers';

describe('Zulassungskunden', () => {
  test('sortiert nach offenem Betrag, NEXUS-Rechnungen zählen nicht mit', () => {
    const s = stateWith({
      contacts: [
        { id: 'a', company: 'zulassung', kind: 'dealer', name: 'Alpha', phones: [], emails: [] },
        { id: 'b', company: 'zulassung', kind: 'private', name: 'Beta', phones: [], emails: [] },
        { id: 'm', company: 'nexus', kind: 'member', name: 'Mitglied', phones: [], emails: [] },
      ],
      invoices: [
        inv('1', 1000, { contactId: 'a', dueDate: '2026-12-01' }),
        inv('2', 5000, { contactId: 'b', dueDate: '2026-10-01', status: 'overdue' }),
        inv('3', 9000, { contactId: 'm', company: 'nexus', connectionId: 'lexware_nexus', dueDate: '2026-10-01' }),
      ],
      jobs: [
        { id: 'j1', vehicleId: 'v', contactId: 'b', service: 'Umschreibung', location: 'bottrop', priceCents: 5000, status: 'done', doneAt: null, invoiceIds: [] },
      ],
      vehicles: [{ id: 'v', contactId: 'b', vin: 'X', plate: 'BOT-B 1', model: 'Golf' }],
    });
    const rows = zulassungCustomers(s, '2026-11-12');
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ openCents: 5000, overdueCents: 5000, jobs: 1, plates: ['BOT-B 1'] });
    expect(rows[1]).toMatchObject({ openCents: 1000, overdueCents: 0, jobs: 0, plates: [] });
    expect(matchesCustomer(rows[0], ' bot-b ', 'Privat')).toBe(true);
    expect(matchesCustomer(rows[0], 'Alpha', 'Privat')).toBe(false);
    expect(matchesCustomer(rows[1], 'Händler', 'Händler')).toBe(true);
    expect(matchesCustomer(rows[1], '   ', 'Händler')).toBe(true);
  });

  test('Demo: Müller steht wegen offener Rechnungen vorn', () => {
    const rows = zulassungCustomers(createDemoState(), '2026-11-12');
    expect(rows[0].id).toBe('d-mueller');
    expect(rows[0].openCents).toBe(39000 + 25000 + 8900);
    expect(rows[0].overdueCents).toBe(39000 + 25000);
    expect(rows.every((r, i) => i === 0 || rows[i - 1].openCents >= r.openCents)).toBe(true);
  });
});

describe('Personen-Karte', () => {
  test('nennt die Zahl und die ersten überfälligen Namen', () => {
    expect(peopleSummary(0, [], 'Keine überfälligen Kunden')).toBe('Keine überfälligen Kunden');
    expect(peopleSummary(1, ['Autohaus Müller'], 'Keine überfälligen Kunden')).toBe('1 überfällig · Autohaus Müller');
    expect(peopleSummary(3, ['A', 'B', 'C'], 'x')).toBe('3 überfällig · A, B …');
  });
});
