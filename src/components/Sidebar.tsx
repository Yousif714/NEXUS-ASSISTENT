'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CollapsibleSection } from './CollapsibleSection';
import { PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from './nav';

function Item({ item, pathname }: { item: NavItem; pathname: string }) {
  const { key, href, label, Icon } = item;
  return (
    <Link href={href} className="sidebar-item" data-testid={`nav-${key}`} aria-current={isActive(href, pathname) ? 'page' : undefined}>
      <Icon size={22} />
      <span>{label}</span>
    </Link>
  );
}

/** Seitenleiste ab 768px: die vier Bereiche oben, Einstellungen & Quellen unten (einklappbar). */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar" data-testid="sidebar" aria-label="Navigation">
      <div className="sidebar-title">Nexus</div>
      <div className="sidebar-primary">
        {PRIMARY_NAV.map((item) => <Item key={item.key} item={item} pathname={pathname} />)}
      </div>
      <div className="sidebar-more">
        <CollapsibleSection id="nav-mehr" title="Einstellungen & Quellen" count={SECONDARY_NAV.length}
          defaultOpen={SECONDARY_NAV.some((item) => isActive(item.href, pathname))} testId="nav-group-mehr" variant="nav">
          {SECONDARY_NAV.map((item) => <Item key={item.key} item={item} pathname={pathname} />)}
        </CollapsibleSection>
      </div>
    </nav>
  );
}
