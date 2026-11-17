import { describe, expect, test } from 'vitest';
import { classifyIntake, serviceOf } from '@/domain/intake/classify';

const vin = 'WVWZZZ1KZAW123456';

describe('classifyIntake', () => {
  test('Auftrag mit FIN, Kennzeichen, Halter und eVB', () => {
    const hit = classifyIntake(`Bitte Zulassung. FIN ${vin}, Kennzeichen BOT-AB 123, Halter: Erika Beispiel. eVB liegt bei.`);
    expect(hit).toMatchObject({
      kind: 'order', ambiguous: false, holderName: 'Erika Beispiel', vins: [vin], plates: ['BOT-AB 123'],
    });
    expect(hit!.signals).toEqual(expect.arrayContaining(['Bitte um Auftrag', 'eVB']));
    expect(serviceOf('order', 'Bitte Zulassung')).toBe('Zulassung');
  });

  test('Abmeldung und Ummeldung bestimmen die Leistung', () => {
    expect(classifyIntake('Bitte Abmeldung für BOT-CD 9')!.kind).toBe('order');
    expect(serviceOf('order', 'Bitte die Abmeldung')).toBe('Abmeldung');
    expect(classifyIntake('Ich möchte den Wagen umschreiben. Kennzeichen E-XY 12.')!.kind).toBe('order');
    expect(serviceOf('order', 'umschreiben')).toBe('Ummeldung');
  });

  test('ZB I und Foto sind ein Auftrag, die Bescheinigung ein Nachweis', () => {
    const order = classifyIntake('Anbei ZB I', [{ kind: 'image', filename: 'ZB-I.jpg', caption: 'ZB I' }]);
    expect(order).toMatchObject({ kind: 'order', signals: ['ZB'] });
    const proof = classifyIntake(`Anbei die Zulassungsbescheinigung. FIN ${vin}.`);
    expect(proof).toMatchObject({ kind: 'proof', vins: [vin] });
    expect(classifyIntake('Bestätigung der Zulassungsstelle für BOT-AB 1')!.kind).toBe('proof');
    expect(classifyIntake('Dokument aus myDigitalCar, Vorgang abgeschlossen, Kennzeichen MD CI 100')!.signals).toContain('Portal');
    expect(classifyIntake('nextOZ Nachweis BOT-ZZ 1')!.kind).toBe('proof');
  });

  test('eine Nachfrage ist kein Auftrag', () => {
    expect(classifyIntake('Ist die Zulassung fertig?')).toBeNull();
    expect(classifyIntake('Können Sie mir bitte noch die Rechnung für die Zulassung schicken?')).toBeNull();
    expect(classifyIntake('Danke, bis dann')).toBeNull();
    expect(classifyIntake('Nachweis')).toBeNull();
  });

  test('ZB und Bescheinigung zusammen sind unklar', () => {
    const hit = classifyIntake('Anbei ZB I und die Zulassungsbescheinigung.');
    expect(hit).toMatchObject({ ambiguous: true, confidence: 'medium' });
  });
});
