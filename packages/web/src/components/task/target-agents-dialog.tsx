import { useState } from 'react';
import { AgentPicker } from './agent-picker';
import type { TargetAgent } from './task-helpers';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface TargetAgentsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly agents: ReadonlyArray<TargetAgent>;
  readonly isSaving: boolean;
  readonly onSave: (agentIds: ReadonlyArray<string>) => void;
}

/** Mounted only while open, so the checkboxes reseed from the saved targets. */
function TargetAgentsDialogBody(props: Omit<TargetAgentsDialogProps, 'open'>) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>(() => props.agents.filter((agent) => agent.targeted).map((agent) => agent.agentId));

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Target agents</DialogTitle>
        <DialogDescription>
          Where the scheduler launches this task. Offline agents can be targeted — the fleet is expected to come and go, and targeting is stored on the task rather than resolved
          now.
        </DialogDescription>
      </DialogHeader>

      <AgentPicker agents={props.agents} selected={selected} onChange={setSelected} />

      <DialogFooter>
        <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.isSaving}>
          Cancel
        </Button>
        <Button onClick={() => props.onSave(selected)} disabled={props.isSaving}>
          {props.isSaving ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function TargetAgentsDialog({ open, ...rest }: TargetAgentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open ? <TargetAgentsDialogBody {...rest} /> : null}
    </Dialog>
  );
}
