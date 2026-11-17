import type { IntakeKind, MessageAttachment } from '@/domain/types';
import { extractPlates, extractVins } from '@/domain/matching/messages';

/** Ergebnis der Regeln. `ambiguous`: Auftrag und Nachweis liegen gleichauf, dann darf die KI den Stich geben. */
export interface IntakeHit {
  kind: IntakeKind;
  confidence: 'high' | 'medium';
  ambiguous: boolean;
  signals: string[];
  vins: string[];
  plates: string[];
  holderName: string | null;
}

const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const ORDER: [RegExp, string][] = [
  [/\bbitte\b(?:\s+\S+){0,3}\s+(zulassung|abmeldung|ummeldung|umschreibung|neuzulassung)\b/, 'Bitte um Auftrag'],
  [/\b(moechte|will)\b[\s\S]{0,40}\b(umschreiben|abmelden|zulassen|anmelden|ummeld\w*)/, 'Auftragswunsch'],
  [/\b(abmeldung|abmelden|stilllegen)\b/, 'Abmeldung'],
  [/\b(ummeldung|ummelden|umschreiben|wiederzulassung)\b/, 'Ummeldung'],
  [/\b(neuzulassung|neu zulassen)\b/, 'Neuzulassung'],
  [/\bevb\b|elektronische versicherungsbestaetigung/, 'eVB'],
  [/\bzb\s*(i|1|ii|2)\b|zulassungsbescheinigung teil/, 'ZB'],
  [/\b(fahrzeugschein|fahrzeugbrief)\b/, 'Fahrzeugpapier'],
];

const PROOF: [RegExp, string][] = [
  [/zulassungsnachweis/, 'Zulassungsnachweis'],
  [/bestaetigung der zulassungsstelle/, 'Bestätigung der Zulassungsstelle'],
  [/wurde zugelassen|zulassung erfolgt|ist zugelassen|zulassung bestaetigt/, 'Zulassung erfolgt'],
  [/zulassungsbescheid|\bbescheid\b/, 'Bescheid'],
  [/mydigitalcar|\bmdc\b|nextoz|next oz/, 'Portal'],
  [/zulassungsbescheinigung(?!\s+teil)/, 'Zulassungsbescheinigung'],
  [/\bnachweis\b/, 'Nachweis'],
];

const WEAK = new Set(['Nachweis', 'Bescheid']);

function holderOf(raw: string): string | null {
  const patterns = [
    /Halter(?:name)?\s*[:\-]\s*([A-ZÄÖÜ][\p{L}'\-]+(?:\s+[A-ZÄÖÜ][\p{L}'\-]+){0,3})/u,
    /auf den Namen\s+([A-ZÄÖÜ][\p{L}'\-]+(?:\s+[A-ZÄÖÜ][\p{L}'\-]+){0,3})/iu,
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** Text plus Beschriftung und Dateiname der Anhänge. */
export function intakeText(body: string, subject?: string, attachments: Pick<MessageAttachment, 'filename' | 'caption'>[] = []): string {
  return [subject, body, ...attachments.flatMap((a) => [a.filename, a.caption])].filter((p) => p && p.trim()).join('\n');
}

/**
 * Erkennt einen Zulassungsauftrag oder einen Nachweis im Text.
 * Eine Frage nach dem Stand („Ist die Zulassung fertig?“) ist keins von beidem.
 */
export function classifyIntake(text: string, attachments: Pick<MessageAttachment, 'filename' | 'caption' | 'kind'>[] = []): IntakeHit | null {
  const raw = intakeText(text, undefined, attachments);
  const t = fold(raw);
  const vins = extractVins(raw);
  const plates = extractPlates(raw);
  const holderName = holderOf(raw);
  const orderSignals: string[] = [];
  const proofSignals: string[] = [];
  for (const [re, label] of ORDER) if (re.test(t)) orderSignals.push(label);
  for (const [re, label] of PROOF) if (re.test(t)) proofSignals.push(label);
  const signals = [...new Set([...orderSignals, ...proofSignals])];
  if (signals.length === 0) return null;
  const hasId = vins.length > 0 || plates.length > 0;
  const weakOnly = signals.every((s) => WEAK.has(s));
  if (weakOnly && !hasId && attachments.length === 0) return null;

  const orderScore = orderSignals.length;
  const proofScore = proofSignals.length;
  const ambiguous = orderScore > 0 && proofScore > 0 && Math.abs(orderScore - proofScore) <= 1;
  const kind: IntakeKind = proofScore > orderScore || (proofScore === orderScore && proofSignals.some((s) => s !== 'Bescheid')) ? 'proof' : 'order';
  const confidence = !ambiguous && (hasId || Math.max(orderScore, proofScore) >= 2 || signals.some((s) => !WEAK.has(s))) ? 'high' : 'medium';
  return { kind, confidence: ambiguous ? 'medium' : confidence, ambiguous, signals, vins, plates, holderName };
}

/** Leistung für einen Entwurf. */
export function serviceOf(kind: IntakeKind, text: string): string {
  const t = fold(text);
  if (kind === 'proof') return 'Nachweis';
  if (/\b(abmeldung|abmelden)\b/.test(t)) return 'Abmeldung';
  if (/\b(ummeldung|ummelden|umschreiben)\b/.test(t)) return 'Ummeldung';
  if (/\bneuzulassung\b/.test(t)) return 'Neuzulassung';
  return 'Zulassung';
}
