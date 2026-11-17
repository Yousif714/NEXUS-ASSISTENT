import 'server-only';

/** Anhang, den wir nicht herunterladen, außer er ist ein kurzer Text. */
export const SMALL_ATTACHMENT_BYTES = 32 * 1024;

export interface MailPart {
  type?: string;
  disposition?: string;
  filename?: string;
  size?: number;
  part?: string;
  children?: MailPart[];
}

export function flattenParts(node: MailPart | undefined, acc: MailPart[] = []): MailPart[] {
  if (!node) return acc;
  if (node.children?.length) for (const c of node.children) flattenParts(c, acc);
  else acc.push(node);
  return acc;
}

function sizeText(size: number | undefined): string {
  if (typeof size !== 'number' || size < 0) return 'Größe unbekannt';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentPlan {
  /** Kurzzeilen für den Nachrichtentext. Kein Dateiinhalt. */
  notes: string[];
  /** Kurze Textdateien, die noch gelesen werden dürfen. */
  smallText: MailPart[];
}

/** Anhänge nur als Name, Art und Größe. Kleine Textdateien dürfen zusätzlich gelesen werden. */
export function planAttachments(root: MailPart | undefined): AttachmentPlan {
  const notes: string[] = [];
  const smallText: MailPart[] = [];
  for (const p of flattenParts(root)) {
    const disp = (p.disposition ?? '').toLowerCase();
    const filename = p.filename?.replace(/[\r\n]+/g, ' ').trim();
    const type = p.type ?? '';
    const named = !!filename;
    const attached = disp === 'attachment' || (named && disp !== 'inline' && !type.startsWith('text/') && !type.startsWith('multipart/'));
    if (!attached && disp !== 'attachment') continue;
    if ((type === 'text/plain' || type === 'text/html') && disp !== 'attachment') continue;
    const name = (filename || type || 'Anhang').slice(0, 120);
    notes.push(`Anhang: ${name} (${type || 'unbekannt'}, ${sizeText(p.size)})`);
    const small = type.startsWith('text/') && typeof p.size === 'number' && p.size > 0 && p.size <= SMALL_ATTACHMENT_BYTES && !!p.part;
    if (small) smallText.push(p);
  }
  return { notes: notes.slice(0, 8), smallText: smallText.slice(0, 3) };
}
