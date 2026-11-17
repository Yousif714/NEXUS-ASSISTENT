'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { CollapsibleSection } from './CollapsibleSection';
import { IconMore } from './Icons';
import { NAV_GROUPS, isActive } from './nav';

/** „Mehr“ oben rechts auf Heute (nur mobil): Disclosure mit Links zu den weiteren Bereichen. */
export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="more">
      <button ref={trigger} type="button" className="nav-button" data-testid="more-button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}>
        <IconMore size={22} />
        <span>Mehr</span>
      </button>
      {open && <div className="more-backdrop" onClick={() => close(true)} aria-hidden="true" />}
      <nav id={panelId} className="more-menu" data-testid="more-menu" aria-label="Weitere Bereiche" hidden={!open}>
        {NAV_GROUPS.map((group) => (
          <CollapsibleSection key={group.id} id={`nav-${group.id}`} title={group.label} count={group.items.length}
            defaultOpen={group.defaultOpen || group.items.some((item) => isActive(item.href, pathname))}
            testId={`more-group-${group.id}`} variant="nav">
            {group.items.map(({ key, href, label, Icon }) => (
              <Link key={key} href={href} className="more-item" data-testid={`more-${key}`} onClick={() => close(false)}>
                <span>{label}</span>
                <Icon size={20} />
              </Link>
            ))}
          </CollapsibleSection>
        ))}
      </nav>
    </div>
  );
}
