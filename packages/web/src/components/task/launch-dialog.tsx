import { Rocket } from 'lucide-react';
import { useState } from 'react';
import { AgentPicker } from './agent-picker';
import type { TargetAgent } from './task-helpers';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface LaunchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly agents: ReadonlyArray<TargetAgent>;
  readonly isLaunching: boolean;
  readonly onLaunch: (agentIds: ReadonlyArray<string>) => void;
}

/**
 * Mounted only while the dialog is open, which is what makes the selection reset to
 * the task's configured targets each time it opens — with no effect watching `open`
 * and no stale selection carried over from the last launch.
 */
function LaunchDialogBody(props: Omit<LaunchDialogProps, 'open'>) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>(() => props.agents.filter((agent) => agent.targeted).map((agent) => agent.agentId));

  const offlineSelected = props.agents.some((agent) => agent.status === 'offline' && selected.includes(agent.agentId));

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Launch task</DialogTitle>
        <DialogDescription>One instance is created per selected agent. The task's configured targets are pre-selected.</DialogDescription>
      </DialogHeader>

      <AgentPicker agents={props.agents} selected={selected} onChange={setSelected} disableOffline />

      {offlineSelected ? <p className="text-sm text-warning">An offline agent is selected. Its launch will be recorded as initiation failed.</p> : null}

      <DialogFooter>
        <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.isLaunching}>
          Cancel
        </Button>
        <Button onClick={() => props.onLaunch(selected)} disabled={selected.length === 0 || props.isLaunching}>
          {props.isLaunching ? <Spinner /> : <Rocket className="size-4" />}
          Launch on {selected.length} {selected.length === 1 ? 'agent' : 'agents'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function LaunchDialog({ open, ...rest }: LaunchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open ? <LaunchDialogBody {...rest} /> : null}
    </Dialog>
  );
}
