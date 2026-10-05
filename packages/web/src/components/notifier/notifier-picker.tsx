import { Link } from 'react-router-dom';
import { ErrorState, LoadingRows } from '@/components/common/states';
import { Checkbox } from '@/components/ui/checkbox';
import { useNotifiers } from '@/hooks/use-notifiers';
import { urls } from '@/lib/urls';

export interface NotifierPickerProps {
  readonly selected: ReadonlyArray<string>;
  readonly onChange: (notifierIds: ReadonlyArray<string>) => void;
}

/**
 * A checklist of every notifier. One the monitor names that no longer exists stays
 * listed, marked, so it can be unticked; otherwise the form could never be saved.
 */
export function NotifierPicker({ selected, onChange }: NotifierPickerProps) {
  const notifiers = useNotifiers();

  if (notifiers.isPending) {
    return <LoadingRows rows={2} />;
  }
  if (notifiers.isError) {
    return <ErrorState error={notifiers.error} onRetry={() => void notifiers.refetch()} />;
  }

  const known = new Set(notifiers.data.notifiers.map((notifier) => notifier.notifierId));
  const missing = selected.filter((id) => !known.has(id));
  const toggle = (notifierId: string, checked: boolean) =>
    onChange(checked ? [...selected.filter((id) => id !== notifierId), notifierId] : selected.filter((id) => id !== notifierId));

  if (notifiers.data.notifiers.length === 0 && missing.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No notifiers yet.{' '}
        <Link to={urls.notifiers()} className="text-primary hover:underline">
          Add a Discord channel
        </Link>{' '}
        to be told when this monitor changes state.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {notifiers.data.notifiers.map((notifier) => (
        <li key={notifier.notifierId}>
          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
            <Checkbox checked={selected.includes(notifier.notifierId)} onCheckedChange={(checked) => toggle(notifier.notifierId, checked === true)} />
            <span className="min-w-0 flex-1 truncate font-medium">{notifier.name}</span>
            <span className="truncate text-muted-foreground">Discord {notifier.target.channel}</span>
          </label>
        </li>
      ))}
      {missing.map((notifierId) => (
        <li key={notifierId}>
          <label className="flex cursor-pointer items-center gap-3 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <Checkbox checked onCheckedChange={() => toggle(notifierId, false)} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{notifierId}</span>
            <span>No longer exists. Untick it to save.</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
