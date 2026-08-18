import type { TaskEvent } from '@mini-cloud/shared';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/common/data-table';
import { EventLevelBadge, EventSourceLabel } from '@/components/common/status-badge';
import { Timestamp } from '@/components/common/timestamp';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { firstLine, formatPayload, formatTimestamp } from '@/lib/format';

function search(term: string, event: TaskEvent): boolean {
  return event.level === term || event.source === term || formatPayload(event.payload).toLowerCase().includes(term);
}

/**
 * The instance audit log: status transitions, agent notes and anything the task
 * reported through `@mini-cloud/reporter`.
 *
 * Payloads are JSONB and come back parsed, so a message can be a string or an
 * object. The cell shows the first line and the dialog shows the whole thing —
 * a stack trace in a table row destroys the row height for every other event.
 */
export function EventTable(props: { readonly events?: ReadonlyArray<TaskEvent>; readonly isLoading?: boolean; readonly error?: unknown; readonly onRetry?: () => void }) {
  const [selected, setSelected] = useState<TaskEvent | undefined>(undefined);

  const columns: ReadonlyArray<Column<TaskEvent>> = [
    {
      id: 'timestamp',
      header: 'Time',
      compare: (left, right) => left.timestamp - right.timestamp,
      cell: (event) => <Timestamp value={event.timestamp} />,
      headerClassName: 'w-40',
    },
    { id: 'level', header: 'Level', cell: (event) => <EventLevelBadge level={event.level} />, headerClassName: 'w-28' },
    { id: 'source', header: 'Source', cell: (event) => <EventSourceLabel source={event.source} />, headerClassName: 'w-24' },
    {
      id: 'payload',
      header: 'Message',
      className: 'max-w-0',
      cell: (event) => {
        const text = formatPayload(event.payload);
        const multiline = text.includes('\n');
        return (
          <button
            type="button"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              setSelected(event);
            }}
            className="block w-full truncate text-left font-mono text-[0.8125rem] hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={multiline ? 'Click to see the full payload' : text}
          >
            {firstLine(text)}
            {multiline ? <span className="ml-1 text-muted-foreground">…</span> : null}
          </button>
        );
      },
    },
  ];

  return (
    <>
      <DataTable<TaskEvent>
        columns={columns}
        items={props.events}
        rowKey={(event) => event.eventId}
        isLoading={props.isLoading}
        error={props.error}
        onRetry={props.onRetry}
        search={search}
        searchPlaceholder="Filter by level, source or message…"
        initialSort={{ columnId: 'timestamp', direction: 'desc' }}
        pageSize={25}
        emptyTitle="No events"
        emptyDescription="Events appear as the service dispatches the launch and the agent reports back."
      />

      <Dialog open={selected !== undefined} onOpenChange={(open) => (open ? undefined : setSelected(undefined))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Event payload</DialogTitle>
            {selected === undefined ? null : (
              <p className="text-sm text-muted-foreground">
                {selected.source} · {selected.level} · {formatTimestamp(selected.timestamp)}
              </p>
            )}
          </DialogHeader>
          <pre className="scrollbar-thin max-h-[60vh] overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
            {selected === undefined ? '' : formatPayload(selected.payload)}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
