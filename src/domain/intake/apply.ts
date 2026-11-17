import { emailsIn } from '@/domain/import/mail';
import { classifyIntake, intakeText, serviceOf } from '@/domain/intake/classify';
import { plateInText, toE164, validPhone } from '@/domain/matching/messages';
import type { AppState, Contact, IntakeKind, Job, JobActivity, JobReceipt, Message, MessageIntake, Vehicle } from '@/domain/types';

const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const normName = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const normVin = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
const normPlate = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

const STATUS_TEXT: Record<Job['status'], string> = {
  open: 'Offen', waiting_customer: 'Wartet auf Kunde', done: 'Erledigt', invoiced: 'In Rechnung', paid: 'Bezahlt',
};

export function statusLabel(status: Job['status']): string {
  return STATUS_TEXT[status];
}

function namesMatch(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (x.length < 4 || y.length < 4) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const xt = x.split(' ').filter((t) => t.length >= 3);
  const yt = new Set(y.split(' ').filter((t) => t.length >= 3));
  const hit = xt.filter((t) => yt.has(t));
  return hit.length >= 2 || (xt.length === 1 && yt.has(xt[0]) && xt[0].length >= 5);
}

function holderOfJob(job: Job, contacts: Contact[]): string {
  const contact = job.contactId ? contacts.find((c) => c.id === job.contactId)?.name ?? '' : '';
  const data = job.portalData ?? {};
  const person = [data.Halter_Np_Vorname, data.Halter_Np_Nachname].filter(Boolean).join(' ');
  return [contact, data.Halter_Unternehmen, person].filter(Boolean).join(' ');
}

function platesOf(job: Job, vehicles: Vehicle[]): string[] {
  const vehicle = vehicles.find((v) => v.id === job.vehicleId);
  const data = job.portalData ?? {};
  return [vehicle?.plate, data.Kennzeichen_Neu, data.Kennzeichen_Alt].filter((p): p is string => !!p && p.trim() !== '').map(normPlate);
}

function vinOf(job: Job, vehicles: Vehicle[]): string {
  const vehicle = vehicles.find((v) => v.id === job.vehicleId);
  return normVin(vehicle?.vin || job.portalData?.FIN || '');
}

function channelLabel(channel: Message['channel']): string {
  return channel === 'whatsapp' ? 'WhatsApp' : 'E-Mail';
}

function kindLabel(kind: IntakeKind): string {
  return kind === 'order' ? 'Auftrag' : 'Nachweis';
}

function addressOf(m: Message): { phone?: string; email?: string } {
  const raw = m.direction === 'in' ? m.from : m.to;
  if (m.channel === 'whatsapp') {
    const phone = validPhone(raw);
    return phone ? { phone } : {};
  }
  const email = emailsIn(raw)[0];
  return email ? { email } : {};
}

function displayName(m: Message, holder: string | null): string {
  if (m.profileName?.trim()) return m.profileName.trim().slice(0, 200);
  if (holder) return holder;
  if (m.channel === 'email') {
    const raw = m.direction === 'in' ? m.from : m.to;
    const named = raw.replace(/<[^>]+>/g, '').replace(/["']/g, '').trim();
    if (named && !named.includes('@')) return named.slice(0, 200);
    const email = emailsIn(raw)[0];
    if (email) return email.split('@')[0] ?? email;
  }
  return addressOf(m).phone || addressOf(m).email || 'Unbekannt';
}

function withActivity(job: Job, activity: JobActivity): Job {
  const list = job.activities ?? [];
  if (activity.messageId && list.some((a) => a.messageId === activity.messageId && a.text === activity.text)) return job;
  return { ...job, activities: [...list, activity] };
}

function withReceipt(job: Job, receipt: JobReceipt): Job {
  const list = job.receipts ?? [];
  if (list.some((r) => r.messageId === receipt.messageId)) return job;
  return { ...job, receipts: [...list, receipt] };
}

function findContact(contacts: Contact[], phone?: string, email?: string): Contact | undefined {
  if (phone) {
    const hit = contacts.find((c) => c.phones.some((p) => toE164(p) === phone));
    if (hit) return hit;
  }
  if (email) {
    const want = email.toLowerCase();
    const hit = contacts.find((c) => c.emails.some((e) => e.toLowerCase() === want));
    if (hit) return hit;
  }
  return undefined;
}

interface Scored { job: Job; score: number }

function scoreJobs(state: AppState, hit: { vins: string[]; plates: string[]; holderName: string | null }, phone?: string): Scored[] {
  const out: Scored[] = [];
  for (const job of state.jobs) {
    let score = 0;
    const vin = vinOf(job, state.vehicles);
    if (hit.vins.some((v) => normVin(v) === vin && vin.length === 17)) score += 100;
    const plates = platesOf(job, state.vehicles);
    if (hit.plates.some((p) => plates.some((have) => plateInText(have, p.toUpperCase()) || normPlate(have) === normPlate(p)))) score += 80;
    if (hit.holderName && namesMatch(hit.holderName, holderOfJob(job, state.contacts))) score += 50;
    if (phone && job.contactId) {
      const contact = state.contacts.find((c) => c.id === job.contactId);
      if (contact?.phones.some((p) => toE164(p) === phone)) score += 30;
    }
    if (score > 0 && job.status !== 'paid') score += 5;
    if (score > 0) out.push({ job, score });
  }
  return out.sort((a, b) => b.score - a.score || a.job.status.localeCompare(b.job.status));
}

function pickJob(scored: Scored[], kind: IntakeKind, phone?: string, contactId?: string | null): { job: Job | null; skipDraft: boolean } {
  const strong = scored.filter((s) => s.score >= 50);
  const pool = kind === 'order' ? strong.filter((s) => s.job.status !== 'paid') : strong;
  const best = pool[0];
  if (best && pool[1] && best.score === pool[1].score && best.score < 100) return { job: null, skipDraft: true };
  if (best) return { job: best.job, skipDraft: false };
  if (!phone || !contactId) return { job: null, skipDraft: false };
  const open = scored.filter((s) => s.job.contactId === contactId && s.job.status !== 'paid' && s.score >= 30);
  if (open.length === 1) return { job: open[0].job, skipDraft: false };
  if (open.length > 1) return { job: null, skipDraft: true };
  return { job: null, skipDraft: false };
}

function receiptOf(m: Message, kind: IntakeKind, name: string, contactId: string | null): JobReceipt {
  const addr = addressOf(m);
  return {
    messageId: m.id, kind, channel: m.channel, at: m.sentAt, contactId, senderName: name,
    ...(addr.phone ? { phone: addr.phone } : {}),
    ...(addr.email ? { email: addr.email } : {}),
    attachments: m.attachments ?? [],
  };
}

/**
 * Ordnet neue eingehende Nachrichten einem Vorgang zu oder legt einen Entwurf an.
 * `ids` sind die in diesem Import neu entstandenen Nachrichten. Schon Geprüftes bleibt liegen.
 */
export function applyIntakes(state: AppState, newId: () => string, ids: ReadonlySet<string>): AppState {
  if (ids.size === 0) return state;
  if (!state.messages.some((m) => ids.has(m.id) && m.direction === 'in' && !m.intakeChecked)) return state;
  let contacts = state.contacts;
  let vehicles = state.vehicles;
  let jobs = state.jobs;
  const messages = state.messages.map((m) => ({ ...m }));

  const ordered = messages
    .filter((m) => ids.has(m.id) && m.direction === 'in' && !m.intakeChecked)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));

  const putMessage = (next: Message) => {
    const at = messages.findIndex((m) => m.id === next.id);
    if (at >= 0) messages[at] = next;
  };

  for (const message of ordered) {
    const text = intakeText(message.body, message.subject, message.attachments);
    const hit = classifyIntake(text, message.attachments);
    if (!hit) {
      putMessage({ ...message, intakeChecked: true });
      continue;
    }
    const kind = hit.ambiguous && message.intakeHint ? message.intakeHint : hit.kind;
    const classifiedBy = hit.ambiguous && message.intakeHint ? 'ai' as const : 'rules' as const;
    const intake: MessageIntake = {
      kind, confidence: hit.ambiguous ? 'medium' : hit.confidence, signals: hit.signals,
      vins: hit.vins, plates: hit.plates, holderName: hit.holderName, classifiedBy,
    };
    const addr = addressOf(message);
    let contact = message.contactId ? contacts.find((c) => c.id === message.contactId) : undefined;
    if (!contact) contact = findContact(contacts, addr.phone, addr.email);
    if (!contact && hit.holderName) {
      const named = contacts.filter((c) => namesMatch(hit.holderName!, c.name));
      if (named.length === 1) contact = named[0];
    }
    const senderName = displayName(message, hit.holderName);
    if (contact && addr.phone && !contact.phones.some((p) => toE164(p) === addr.phone)) {
      contact = { ...contact, phones: [...contact.phones, addr.phone] };
      contacts = contacts.map((c) => (c.id === contact!.id ? contact! : c));
    }
    if (contact && addr.email && !contact.emails.some((e) => e.toLowerCase() === addr.email)) {
      contact = { ...contact, emails: [...contact.emails, addr.email] };
      contacts = contacts.map((c) => (c.id === contact!.id ? contact! : c));
    }
    if (!contact && (addr.phone || addr.email)) {
      contact = {
        id: newId(), company: 'zulassung', kind: 'private', name: senderName,
        phones: addr.phone ? [addr.phone] : [], emails: addr.email ? [addr.email] : [],
      };
      contacts = [...contacts, contact];
    }
    const contactId = contact?.id ?? message.contactId;
    if (contactId) {
      for (const other of messages) {
        if (other.threadId === message.threadId && !other.contactId) other.contactId = contactId;
      }
    }

    const view = { ...state, contacts, vehicles, jobs };
    const scored = scoreJobs(view, hit, addr.phone);
    const picked = pickJob(scored, kind, addr.phone, contactId);
    let job = picked.job;
    const created = !job && !picked.skipDraft;
    if (!job && picked.skipDraft) {
      putMessage({ ...message, contactId, intake, intakeChecked: true });
      continue;
    }
    if (!job) {
      let vehicle = vehicles.find((v) => hit.vins.some((vin) => normVin(v.vin) === normVin(vin) && normVin(vin).length === 17))
        ?? vehicles.find((v) => hit.plates.some((p) => plateInText(v.plate, p.toUpperCase()) || normPlate(v.plate) === normPlate(p)));
      if (!vehicle) {
        vehicle = { id: newId(), contactId, vin: hit.vins[0] ?? '', plate: hit.plates[0] ?? '', model: 'Fahrzeug' };
        vehicles = [...vehicles, vehicle];
      } else if (!vehicle.contactId && contactId) {
        vehicle = { ...vehicle, contactId };
        vehicles = vehicles.map((v) => (v.id === vehicle!.id ? vehicle! : v));
      }
      job = {
        id: newId(), vehicleId: vehicle.id, contactId, service: serviceOf(kind, text), location: 'online',
        priceCents: 0, status: 'open', doneAt: null, invoiceIds: [], draft: true,
        origin: message.channel, notes: `Entwurf aus ${channelLabel(message.channel)}, noch kein Portal-Vorgang.`,
      };
      jobs = [...jobs, job];
    } else if (!job.contactId && contactId) {
      job = { ...job, contactId };
      jobs = jobs.map((j) => (j.id === job!.id ? job! : j));
    }

    const name = contact?.name ?? senderName;
    const receipt = receiptOf(message, kind, name, contactId);
    const textLine = created
      ? `${kindLabel(kind)} erkannt, kein passender Vorgang: Entwurf aus ${channelLabel(message.channel)} von ${name} angelegt.`
      : `${kindLabel(kind)} per ${channelLabel(message.channel)} von ${name} zugeordnet.`;
    job = withReceipt(withActivity(job, {
      id: newId(), at: message.sentAt, actor: 'system', text: textLine, messageId: message.id,
    }), receipt);
    jobs = jobs.map((j) => (j.id === job!.id ? job! : j));

    putMessage({ ...message, contactId, jobId: job.id, intake, intakeChecked: true });
  }

  for (const m of messages) {
    if ('intakeHint' in m) delete m.intakeHint;
  }
  return { ...state, contacts, vehicles, jobs, messages };
}

/** Zuordnung aus der Chat-Ansicht. Es wird nichts gesendet. */
export function assignThread(state: AppState, threadId: string, contactId: string | null, jobId: string | null, at: string, newId: () => string): AppState | null {
  if (!state.messages.some((m) => m.threadId === threadId)) return null;
  if (contactId && !state.contacts.some((c) => c.id === contactId)) return null;
  const job = jobId ? state.jobs.find((j) => j.id === jobId) : undefined;
  if (jobId && !job) return null;
  const messages = state.messages.map((m) => (m.threadId === threadId ? { ...m, contactId, jobId } : m));
  let jobs = state.jobs;
  if (job) {
    const latest = messages.filter((m) => m.threadId === threadId).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    const name = (contactId && state.contacts.find((c) => c.id === contactId)?.name) || latest?.profileName || latest?.from || 'Unbekannt';
    let next = withActivity(job, {
      id: newId(), at, actor: 'owner', text: `Zuordnung geändert: ${name} (${latest ? channelLabel(latest.channel) : 'Nachricht'}).`,
      ...(latest ? { messageId: latest.id } : {}),
    });
    if (!next.contactId && contactId) next = { ...next, contactId };
    for (const m of messages) {
      if (m.threadId !== threadId || !m.intake) continue;
      next = withReceipt(next, receiptOf(m, m.intake.kind, name, contactId));
    }
    jobs = jobs.map((j) => (j.id === next.id ? next : j));
  }
  return { ...state, messages, jobs };
}

export function activityForStatus(job: Job, from: Job['status'], to: Job['status'], at: string, id: string): Job {
  if (from === to) return job;
  return withActivity(job, { id, at, actor: 'owner', text: `Status geändert: ${statusLabel(from)} → ${statusLabel(to)}.` });
}

export function activityForNote(job: Job, note: string, at: string, id: string): Job {
  return withActivity(job, { id, at, actor: 'owner', text: `Notiz: ${note.replace(/\s+/g, ' ').trim().slice(0, 180)}` });
}
