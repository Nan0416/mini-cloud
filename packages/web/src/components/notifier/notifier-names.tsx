import type { Monitor } from '@mini-cloud/shared';
import { Link } from 'react-router-dom';
import { useNotifiers } from '@/hooks/use-notifiers';
import { urls } from '@/lib/urls';

/** Where a monitor's changes go, in words: muted, nowhere, or its notifiers by name. */
export function MonitorNotifiers({ monitor }: { readonly monitor: Monitor }) {
  const notifiers = useNotifiers();

  if (!monitor.notify) {
    return <span className="text-muted-foreground">Muted</span>;
  }
  if (monitor.notifierIds.length === 0) {
    return <span className="text-muted-foreground">No notifiers; changes are only recorded</span>;
  }
  const names = new Map((notifiers.data?.notifiers ?? []).map((notifier) => [notifier.notifierId, notifier.name]));
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {monitor.notifierIds.map((notifierId) => {
        const name = names.get(notifierId);
        return name === undefined ? (
          <span key={notifierId} className="font-mono text-xs text-muted-foreground">
            {notifiers.isPending ? notifierId : `${notifierId} (no longer exists)`}
          </span>
        ) : (
          <Link key={notifierId} to={urls.notifiers()} className="text-primary hover:underline">
            {name}
          </Link>
        );
      })}
    </span>
  );
}
