import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader(props: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', props.className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{props.title}</h1>
        {props.description === undefined ? null : <div className="text-sm text-muted-foreground">{props.description}</div>}
      </div>
      {props.actions === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>}
    </div>
  );
}
