import type { ComponentType, SVGProps } from 'react';

import { IconAssistant, IconCar, IconChat, IconGear, IconHome, IconLink, IconLog, IconNexusN } from './Icons';

export type NavItem = { key: string; href: string; label: string; /** Kurzname für die Tab-Leiste. */ short?: string; Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }> };

/** Die vier Haupt-Tabs (mobil unten, am Desktop oben in der Seitenleiste). */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'heute', href: '/', label: 'Heute', Icon: IconHome },
  { key: 'nexus', href: '/nexus', label: 'NEXUS', Icon: IconNexusN },
  { key: 'zulassung', href: '/zulassung', label: 'Zulassungsdienst', short: 'Zulassung', Icon: IconCar },
];

/** Weitere Bereiche: am Desktop in der Seitenleiste, mobil über „Mehr“ auf Heute. */
export const SECONDARY_NAV: NavItem[] = [
  { key: 'chat', href: '/chat', label: 'Chat mit dem Assistenten', Icon: IconAssistant },
  { key: 'assistent', href: '/assistent', label: 'Assistent (WhatsApp)', Icon: IconChat },
  { key: 'verbindungen', href: '/verbindungen', label: 'Verbindungen', Icon: IconLink },
  { key: 'protokoll', href: '/protokoll', label: 'Protokoll', Icon: IconLog },
  { key: 'einstellungen', href: '/einstellungen', label: 'Einstellungen', Icon: IconGear },
];

/** Aktiver Bereich für einen Pfad: Heute umfasst Startseite und Hinweise, Nachrichten die Unterhaltungen. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/hinweise');
  return pathname === href || pathname.startsWith(`${href}/`);
}
