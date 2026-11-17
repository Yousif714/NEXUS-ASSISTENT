'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CollapsibleSection } from './CollapsibleSection';
import { NAV_GROUPS, isActive, type NavItem } from './nav';

function Item({ item, pathname }: { item: NavItem; pathname: string }) {
  const { key, href, label, Icon } = item;
  return (
    <Link href={href} className="sidebar-item" data-testid={`nav-${key}`} aria-current={isActive(href, pathname) ? 'page' : undefined}>
      <Icon size={22} />
      <span>{label}</span>
    </Link>
  );
}

/** Seitenleiste ab 768px. Gruppen lassen sich einklappen, der Zustand bleibt. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar" data-testid="sidebar" aria-label="Navigation">
      <div className="sidebar-title">Nexus</div>
      {NAV_GROUPS.map((group) => (
        <CollapsibleSection key={group.id} id={`nav-${group.id}`} title={group.label} count={group.items.length}
          defaultOpen={group.defaultOpen || group.items.some((item) => isActive(item.href, pathname))}
          testId={`nav-group-${group.id}`} variant="nav">
          {group.items.map((item) => <Item key={item.key} item={item} pathname={pathname} />)}
        </CollapsibleSection>
      ))}
    </nav>
  );
}
