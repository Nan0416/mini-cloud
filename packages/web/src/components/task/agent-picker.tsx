import type { TargetAgent } from './task-helpers';
import { AgentStatusBadge } from '@/components/common/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface AgentPickerProps {
  readonly agents: ReadonlyArray<TargetAgent>;
  readonly selected: ReadonlyArray<string>;
  readonly onChange: (agentIds: ReadonlyArray<string>) => void;
  /** Prevent selecting agents that cannot receive a command right now. */
  readonly disableOffline?: boolean;
  readonly emptyMessage?: string;
}

export function AgentPicker(props: AgentPickerProps) {
  if (props.agents.length === 0) {
    return <p className="text-sm text-muted-foreground">{props.emptyMessage ?? 'No agents have registered with this service yet.'}</p>;
  }

  const toggle = (agentId: string, checked: boolean): void => {
    props.onChange(checked ? [...props.selected, agentId] : props.selected.filter((candidate) => candidate !== agentId));
  };

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {props.agents.map((agent) => {
        const disabled = props.disableOffline === true && agent.status === 'offline';
        const inputId = `agent-${agent.agentId}`;
        return (
          <li key={agent.agentId} className="flex items-center gap-3 px-3 py-2.5">
            <Checkbox id={inputId} checked={props.selected.includes(agent.agentId)} disabled={disabled} onCheckedChange={(checked) => toggle(agent.agentId, checked === true)} />
            <Label htmlFor={inputId} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{agent.name ?? 'Unknown agent'}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{agent.agentId}</span>
              </span>
              <AgentStatusBadge status={agent.status} />
            </Label>
          </li>
        );
      })}
    </ul>
  );
}
