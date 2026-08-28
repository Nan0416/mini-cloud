import { Cloud, X } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_SECTIONS } from './nav-items';
import { Button } from '@/components/ui/button';
import { useConnection } from '@/hooks/use-connection';
import { cn } from '@/lib/utils';

function isActive(pathname: string, to: string, matchPrefix?: string): boolean {
  if (matchPrefix !== undefined) {
    return pathname === matchPrefix || pathname.startsWith(`${matchPrefix}/`);
  }
  return pathname === to;
}

export function SidebarContent(props: { readonly onNavigate?: () => void }) {
  const { connection } = useConnection();
  const { pathname } = useLocation();

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <nav className="space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
            {section.items.map((item) => {
              const active = isActive(pathname, item.to, item.matchPrefix);
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={props.onNavigate}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-1 px-3 pt-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Service</p>
        <p className="break-all font-mono">{connection?.apiUrl ?? '—'}</p>
      </div>
    </div>
  );
}

export function Sidebar(props: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <>
      {/* Permanent rail from `lg` up. */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
        <SidebarContent />
      </aside>

      {/* Below `lg` the same nav becomes an overlay drawer. */}
      {props.open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/60 animate-fade-in" onClick={props.onClose} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="flex items-center gap-2 font-semibold">
                <Cloud className="size-4 text-primary" />
                mini-cloud
              </span>
              <Button variant="ghost" size="icon-sm" onClick={props.onClose} aria-label="Close navigation">
                <X className="size-4" />
              </Button>
            </div>
            <SidebarContent onNavigate={props.onClose} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
