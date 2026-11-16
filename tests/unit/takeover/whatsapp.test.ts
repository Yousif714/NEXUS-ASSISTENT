import { describe, expect, test } from 'vitest';
import { whatsappUrl } from '@/domain/takeover/whatsapp';

describe('whatsappUrl', () => {
  const enc = encodeURIComponent('Hallo Erika, Link: https://x.example.de/zahlung/t?a=1&b=2\nDanke!');
  const text = 'Hallo Erika, Link: https://x.example.de/zahlung/t?a=1&b=2\nDanke!';
  test.each([
    ['0151 2345678', '491512345678'],
    ['01512/345678', '491512345678'],
    ['+49 151 2345678', '491512345678'],
    ['0049 151 2345678', '491512345678'],
    ['+49 (0) 151 2345678', '491512345678'],
    ['491512345678', '491512345678'],
    ['+43 660 1234567', '436601234567'],
  ])('%s → %s', (phone, digits) => expect(whatsappUrl(phone, text)).toBe(`https://wa.me/${digits}?text=${enc}`));
  test.each([[''], ['   '], ['abc'], ['0'], ['123'], ['+49'], ['0151 23']])('ungültig %j → null', (p) => expect(whatsappUrl(p, text)).toBeNull());
});
