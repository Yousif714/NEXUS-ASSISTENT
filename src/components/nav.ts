import type { ComponentType, SVGProps } from 'react';

import { IconAssistant, IconCar, IconChat, IconGear, IconLink, IconLog, IconNexus, IconToday } from './Icons';

export type NavItem = { key: string; href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }> };

/** Die drei Haupt-Tabs (mobil unten, am Desktop oben in der Seitenleiste). */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'heute', href: '/', label: 'Heute', Icon: IconToday },
  { key: 'nexus', href: '/nexus', label: 'NEXUS', Icon: IconNexus },
  { key: 'zulassung', href: '/zulassung', label: 'Zulassungsdienst', Icon: IconCar },
];

/** Weitere Bereiche: am Desktop in der Seitenleiste, mobil über „Mehr“ auf Heute. */
export const SECONDARY_NAV: NavItem[] = [
  { key: 'whatsapp', href: '/nachrichten', label: 'WhatsApp', Icon: IconChat },
  { key: 'chat', href: '/chat', label: 'Chat', Icon: IconChat },
  { key: 'assistent', href: '/assistent', label: 'Assistent (WhatsApp)', Icon: IconAssistant },
  { key: 'verbindungen', href: '/verbindungen', label: 'Verbindungen', Icon: IconLink },
  { key: 'protokoll', href: '/protokoll', label: 'Protokoll', Icon: IconLog },
  { key: 'einstellungen', href: '/einstellungen', label: 'Einstellungen', Icon: IconGear },
];

export type NavGroup = { id: string; label: string; items: NavItem[]; defaultOpen: boolean };

const byKey = (key: string) => SECONDARY_NAV.find((item) => item.key === key)!;

/** Gruppen für die Seitenleiste und das Menü „Mehr“. Heute und Arbeit starten offen. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'heute', label: 'Heute', defaultOpen: true, items: [PRIMARY_NAV[0]] },
  { id: 'arbeit', label: 'Arbeit', defaultOpen: true, items: [PRIMARY_NAV[1], PRIMARY_NAV[2], byKey('whatsapp')] },
  { id: 'assistent', label: 'Assistent', defaultOpen: false, items: [byKey('chat'), byKey('assistent')] },
  { id: 'system', label: 'System', defaultOpen: false, items: [byKey('verbindungen'), byKey('protokoll'), byKey('einstellungen')] },
];

/** Aktiver Bereich für einen Pfad. Heute umfasst die Startseite und die Hinweise, WhatsApp die Unterhaltungen. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/hinweise');
  if (href === '/nachrichten') return pathname === '/nachrichten' || pathname.startsWith('/nachrichten/');
  return pathname === href || pathname.startsWith(`${href}/`);
}
