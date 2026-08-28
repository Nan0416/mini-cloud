import { Server } from 'lucide-react';
import { useState } from 'react';
import { ConnectionForm } from '@/components/setup/connection-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConnection } from '@/hooks/use-connection';
import type { Connection } from '@/lib/connection';

/** Strips the scheme, so the bar shows `192.168.1.9:3000` rather than a wrapped URL. */
function shortLabel(apiUrl: string): string {
  return apiUrl.replace(/^https?:\/\//, '');
}

/**
 * Which service the console is pointed at, and the way to change it.
 *
 * Worth a permanent place in the bar rather than a settings page: once the console
 * can point anywhere, "which machine am I looking at" is a question the answer to
 * every other panel depends on, and getting it wrong is silent.
 */
export function ConnectionControl() {
  const { connection, connect, disconnect } = useConnection();
  const [open, setOpen] = useState(false);

  if (connection === undefined) {
    return null;
  }

  const onConnect = (next: Connection, remember: boolean): void => {
    connect(next, remember);
    setOpen(false);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="max-w-[14rem] gap-1.5 font-mono text-xs text-muted-foreground">
            <Server className="size-3.5 shrink-0" />
            <span className="truncate">{shortLabel(connection.apiUrl)}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Connected to {connection.apiUrl} — click to change</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change service</DialogTitle>
            <DialogDescription>Point this console at a different mini-cloud. Cached data from the current one is discarded.</DialogDescription>
          </DialogHeader>

          {/* Rendered only while open, so the form seeds from the live connection on
              mount instead of being synced by an effect that would clobber typing. */}
          {open ? <ConnectionForm initial={connection} onConnect={onConnect} submitLabel="Switch" /> : null}

          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Forget this service and start over
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
