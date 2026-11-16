/** Internationale Ziffern (ohne +) aus einer Telefonnummer; deutsche Nummern `0…` → `49…`. Ungültig → null. */
function internationalDigits(phone: string): string | null {
  const raw = phone.trim().replace(/\(0\)/g, '');
  if (/[^\d\s+()/.-]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  const intl = raw.startsWith('+') ? digits : digits.startsWith('00') ? digits.slice(2) : digits.startsWith('0') ? `49${digits.slice(1)}` : digits;
  return /^[1-9]\d{8,14}$/.test(intl) ? intl : null;
}

/** wa.me-Link, der den Text vorausgefüllt in WhatsApp öffnet; ohne gültige Nummer null. */
export function whatsappUrl(phone: string, text: string): string | null {
  const digits = internationalDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
