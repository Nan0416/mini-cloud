import type { Monitor, Notifier } from '@mini-cloud/shared';
import { Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { Spinner } from '@/components/common/states';
import { Timestamp } from '@/components/common/timestamp';
import { NotifierDialogBody } from '@/components/notifier/notifier-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useMonitors } from '@/hooks/use-monitors';
import { useDeleteNotifier, useNotifiers, useTestNotifier } from '@/hooks/use-notifiers';
import { monitorsUsing } from '@/lib/notifier-editor';
import { urls } from '@/lib/urls';

/** Which dialog is open, and for which notifier. */
type Editing = { readonly kind: 'create' } | { readonly kind: 'edit'; readonly notifier: Notifier };

function MonitorLinks({ names }: { readonly names: ReadonlyArray<string> }) {
  if (names.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {names.map((name) => (
        <Link key={name} to={urls.monitor(name)} onClick={(event) => event.stopPropagation()} className="text-primary hover:underline">
          {name}
        </Link>
      ))}
    </span>
  );
}

export function NotifiersPage() {
  const notifiers = useNotifiers();
  const monitors = useMonitors();
  const test = useTestNotifier();
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<Notifier | undefined>(undefined);

  const allMonitors: ReadonlyArray<Monitor> = monitors.data?.monitors ?? [];

  const sendTest = (notifier: Notifier) =>
    test.mutate(notifier.notifierId, {
      onSuccess: () => toast.success(`Sent a test message to ${notifier.target.channel}.`, { description: 'Check the channel in Discord.' }),
      onError: (error) => toast.error(`The test message to ${notifier.name} was not delivered.`, { description: error.message }),
    });

  const columns: ReadonlyArray<Column<Notifier>> = [
    {
      id: 'name',
      header: 'Name',
      cell: (notifier) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{notifier.name}</div>
          {notifier.description === undefined ? null : <div className="truncate text-xs text-muted-foreground">{notifier.description}</div>}
        </div>
      ),
      compare: (left, right) => left.name.localeCompare(right.name),
    },
    {
      id: 'channel',
      header: 'Discord channel',
      cell: (notifier) => (
        <div className="min-w-0">
          <div className="truncate">{notifier.target.channel}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">webhook {notifier.target.webhookId}</div>
        </div>
      ),
    },
    { id: 'monitors', header: 'Used by', cell: (notifier) => <MonitorLinks names={monitorsUsing(notifier.notifierId, allMonitors)} /> },
    {
      id: 'updated',
      header: 'Updated',
      cell: (notifier) => <Timestamp value={notifier.updatedAt} variant="relative" />,
      compare: (left, right) => left.updatedAt - right.updatedAt,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'w-px',
      cell: (notifier) => {
        const testing = test.isPending && test.variables === notifier.notifierId;
        return (
          <span className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" size="sm" onClick={() => sendTest(notifier)} disabled={test.isPending}>
              {testing ? <Spinner /> : <Send className="size-4" />}
              Send test
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${notifier.name}`} onClick={() => setEditing({ kind: 'edit', notifier })}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${notifier.name}`} onClick={() => setDeleting(notifier)}>
              <Trash2 className="size-4" />
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Notifiers"
        description="Where messages are sent, such as a monitor changing state. A monitor chooses which of these it notifies."
        actions={
          <Button onClick={() => setEditing({ kind: 'create' })}>
            <Plus className="size-4" />
            Add notifier
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          items={notifiers.data?.notifiers}
          rowKey={(notifier) => notifier.notifierId}
          isLoading={notifiers.isPending}
          error={notifiers.error}
          onRetry={() => void notifiers.refetch()}
          onRowClick={(notifier) => setEditing({ kind: 'edit', notifier })}
          search={(term, notifier) => [notifier.name, notifier.target.channel].some((text) => text.toLowerCase().includes(term.toLowerCase()))}
          searchPlaceholder="Filter by name or channel"
          emptyTitle="No notifiers yet"
          emptyDescription="Add a Discord channel's webhook, then choose it on a monitor to be told when the monitor changes state."
        />
      </Card>

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        {editing === undefined ? null : (
          <NotifierDialogBody
            key={editing.kind === 'edit' ? editing.notifier.notifierId : 'create'}
            notifier={editing.kind === 'edit' ? editing.notifier : undefined}
            onClose={() => setEditing(undefined)}
          />
        )}
      </Dialog>

      <AlertDialog open={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
        {deleting === undefined ? null : <DeleteNotifierBody notifier={deleting} usedBy={monitorsUsing(deleting.notifierId, allMonitors)} onClose={() => setDeleting(undefined)} />}
      </AlertDialog>
    </>
  );
}

function DeleteNotifierBody(props: { readonly notifier: Notifier; readonly usedBy: ReadonlyArray<string>; readonly onClose: () => void }) {
  const remove = useDeleteNotifier();
  const { notifier, usedBy } = props;
  const inUse = usedBy.length > 0;

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {notifier.name}?</AlertDialogTitle>
        <AlertDialogDescription asChild>
          {inUse ? (
            <div className="space-y-2">
              <p>
                {usedBy.length === 1 ? 'A monitor still notifies' : `${usedBy.length} monitors still notify`} it, so it cannot be deleted. Remove it from{' '}
                {usedBy.length === 1 ? 'that monitor' : 'those monitors'} first:
              </p>
              <MonitorLinks names={usedBy} />
            </div>
          ) : (
            <p>Its webhook is forgotten. The webhook itself is left in Discord; delete it there too if nothing else posts with it.</p>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{inUse ? 'Close' : 'Cancel'}</AlertDialogCancel>
        {inUse ? null : (
          <AlertDialogAction
            onClick={() =>
              remove.mutate(notifier.notifierId, {
                onSuccess: () => {
                  toast.success(`Deleted ${notifier.name}.`);
                  props.onClose();
                },
                // The service is the judge: a monitor saved since the list loaded is refused there.
                onError: (error) => toast.error('Could not delete the notifier.', { description: error.message }),
              })
            }
          >
            Delete
          </AlertDialogAction>
        )}
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
