import { classifyIntake, intakeText } from '@/domain/intake/classify';
import type { ImportedMessage } from '@/domain/import/batch';
import type { IntakeKind } from '@/domain/types';

/** Hängt bei unklarer Regel den KI-Stich an die Nachricht. Die Regeln bleiben der Normalfall. */
export async function applyIntakeHints(messages: ImportedMessage[], classify: (text: string) => Promise<IntakeKind | 'none'>): Promise<ImportedMessage[]> {
  const out: ImportedMessage[] = [];
  for (const message of messages) {
    if (message.direction !== 'in') {
      out.push(message);
      continue;
    }
    const text = intakeText(message.body, message.subject, message.attachments);
    const hit = classifyIntake(text, message.attachments);
    if (!hit?.ambiguous) {
      out.push(message);
      continue;
    }
    const kind = await classify(text);
    out.push(kind === 'order' || kind === 'proof' ? { ...message, intakeHint: kind } : message);
  }
  return out;
}
