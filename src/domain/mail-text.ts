/** Anzeige einer Mail oder WhatsApp-Zeile: Name, Kurztext, automatische Absender. Rein, ohne React. */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

function addresses(value: string): string[] {
  return [...value.toLowerCase().matchAll(EMAIL)].map((m) => m[0]);
}

const AUTO_LOCAL = /^(no[-_.]?reply|noreply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounce|notifications?|newsletter|newsletters?)$/;

/** Absender, der keine Antwort braucht: No-Reply, Google-Konto, Meta, Newsletter. */
export function isAutomatedMail(m: { channel?: string; from: string; subject?: string; body?: string; automated?: boolean }): boolean {
  if (m.channel && m.channel !== 'email') return false;
  if (m.automated) return true;
  const from = m.from.toLowerCase();
  if (/mailer-daemon|no-?reply|donotreply|do-not-reply/.test(from)) return true;
  if (/facebookmail\.com|notify\.facebook\.com|instagram\.com|metamail\.com/.test(from) && /no-?reply|notification|mailer|facebook|instagram|meta/.test(from)) return true;
  for (const email of addresses(from)) {
    const [local, domain = ''] = email.split('@');
    if (AUTO_LOCAL.test(local) || local.includes('notification') || local.includes('newsletter')) return true;
    if (domain === 'accounts.google.com' || domain.endsWith('.accounts.google.com')) return true;
    if (domain === 'facebookmail.com' || domain.endsWith('.facebookmail.com')) return true;
    if (domain.startsWith('notifications.') || domain.includes('.notifications.')) return true;
  }
  const subject = (m.subject ?? '').toLowerCase();
  if (/\bnewsletter\b|\brundbrief\b/.test(subject)) return true;
  if ((m.body ?? '').slice(0, 800).toLowerCase().includes('list-unsubscribe')) return true;
  return false;
}

/** Anzeigename: gesetzter Name, sonst „Google“ aus `"Google" <…>`, sonst die Adresse. */
export function senderLabel(from: string, hints?: { fromName?: string; profileName?: string }): string {
  const hint = (hints?.fromName || hints?.profileName || '').replace(/\s+/g, ' ').trim();
  if (hint && !hint.includes('@') && !hint.includes('<')) return hint.slice(0, 80);
  const quoted = /"([^"]{1,80})"/.exec(from)?.[1]?.trim();
  if (quoted) return quoted;
  const bare = from.replace(/<[^>]*>/g, ' ').replace(/["']/g, ' ').replace(/\s+/g, ' ').trim();
  if (bare && !bare.includes('@')) return bare.slice(0, 80);
  return addresses(from)[0] || bare || 'Unbekannt';
}

/** Eine bis zwei Zeilen Klartext: ohne HTML, Bildmarken und lange Adressen. */
export function plainPreview(text: string, limit = 160): string {
  const flat = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[(?:image|bild|foto|cid):[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit).trimEnd()}…`;
}

/** Vorschau ohne den Betreff am Anfang, damit die Karte ihn nicht zweimal zeigt. */
export function previewBesideSubject(body: string, subject?: string): string {
  let text = plainPreview(body, 400);
  const sub = subject ? plainPreview(subject, 200) : '';
  if (sub && text.toLowerCase().startsWith(sub.toLowerCase())) text = text.slice(sub.length).trim();
  const shown = text || sub;
  return shown.length > 160 ? `${shown.slice(0, 157).trimEnd()}…` : shown;
}
