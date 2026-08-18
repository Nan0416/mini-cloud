import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KeyValueItem {
  readonly label: string;
  readonly value: ReactNode;
  /** Let this entry take the full width of the grid, for long command lines. */
  readonly wide?: boolean;
}

/**
 * The summary block every detail page opens with.
 *
 * The legacy console called this a KeyValuePairsContainer and used it identically on
 * tasks, instances, issues and monitors; keeping one component means a field added to
 * a summary looks like every other field without anyone deciding how.
 */
export function KeyValueGrid(props: { readonly items: ReadonlyArray<KeyValueItem>; readonly columns?: 2 | 3 | 4; readonly className?: string }) {
  const columns = props.columns ?? 4;
  const columnClass = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];

  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', columnClass, props.className)}>
      {props.items.map((item) => (
        <div key={item.label} className={cn('min-w-0 space-y-1', item.wide === true && 'sm:col-span-2 lg:col-span-full')}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
