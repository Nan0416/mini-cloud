import type { AgentStatus, TaskEventLevel, TaskEventSource, TaskInstanceStatus, TaskType } from '@mini-cloud/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tone = NonNullable<BadgeProps['variant']>;

interface Presentation {
  readonly label: string;
  readonly tone: Tone;
  /** Whether the state is still moving. Drives the pulsing dot. */
  readonly inFlight?: boolean;
}

/**
 * Every instance status, spelled out.
 *
 * The vocabulary distinguishes *where* a launch broke down — `initiation_failed` is
 * the service never reaching the agent, `failed_to_launch` is the agent failing to
 * spawn — and that distinction is the whole point of having sixteen statuses, so the
 * labels keep it rather than collapsing them all into "failed".
 */
const INSTANCE_STATUS: Readonly<Record<TaskInstanceStatus, Presentation>> = {
  init: { label: 'Init', tone: 'muted', inFlight: true },
  initiated: { label: 'Initiated', tone: 'info', inFlight: true },
  initiation_failed: { label: 'Initiation failed', tone: 'destructive' },
  launching_timeout: { label: 'Launch timeout', tone: 'warning' },
  launched: { label: 'Launched', tone: 'info', inFlight: true },
  failed_to_launch: { label: 'Launch failed', tone: 'destructive' },
  start_timeout: { label: 'Start timeout', tone: 'warning' },
  running: { label: 'Running', tone: 'success', inFlight: true },
  health_check_failure: { label: 'Health check failing', tone: 'warning', inFlight: true },
  termination_initiated: { label: 'Termination sent', tone: 'info', inFlight: true },
  termination_failed: { label: 'Termination failed', tone: 'destructive' },
  terminating: { label: 'Terminating', tone: 'info', inFlight: true },
  agent_termination_failed: { label: 'Agent kill failed', tone: 'destructive' },
  terminated: { label: 'Terminated', tone: 'secondary' },
  exit_success: { label: 'Exited (0)', tone: 'success' },
  exit_failure: { label: 'Exited (non-zero)', tone: 'destructive' },
};

function Dot(props: { readonly tone: Tone; readonly pulse?: boolean }) {
  const colour: Record<Tone, string> = {
    default: 'bg-primary',
    secondary: 'bg-muted-foreground',
    outline: 'bg-muted-foreground',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-info',
    muted: 'bg-muted-foreground',
  };
  return (
    <span className="relative flex size-1.5">
      {props.pulse === true ? <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', colour[props.tone])} /> : null}
      <span className={cn('relative inline-flex size-1.5 rounded-full', colour[props.tone])} />
    </span>
  );
}

export function InstanceStatusBadge(props: { readonly status: TaskInstanceStatus; readonly className?: string }) {
  const presentation = INSTANCE_STATUS[props.status];
  // An unknown status means the service added one this build does not know about.
  // Showing the raw value beats showing nothing.
  if (presentation === undefined) {
    return <Badge variant="outline">{props.status}</Badge>;
  }
  return (
    <Badge variant={presentation.tone} className={props.className}>
      <Dot tone={presentation.tone} pulse={presentation.inFlight} />
      {presentation.label}
    </Badge>
  );
}

export function AgentStatusBadge(props: { readonly status: AgentStatus }) {
  const online = props.status === 'online';
  return (
    <Badge variant={online ? 'success' : 'secondary'}>
      <Dot tone={online ? 'success' : 'secondary'} pulse={online} />
      {online ? 'Online' : 'Offline'}
    </Badge>
  );
}

export function ScheduleBadge(props: { readonly active: boolean }) {
  return <Badge variant={props.active ? 'success' : 'secondary'}>{props.active ? 'Scheduled' : 'Paused'}</Badge>;
}

export function TaskTypeBadge(props: { readonly type: TaskType }) {
  return <Badge variant={props.type === 'service' ? 'info' : 'outline'}>{props.type === 'service' ? 'Service' : 'Job'}</Badge>;
}

const EVENT_LEVEL: Readonly<Record<TaskEventLevel, Tone>> = {
  success: 'success',
  warning: 'warning',
  error: 'destructive',
};

export function EventLevelBadge(props: { readonly level: TaskEventLevel }) {
  const tone = EVENT_LEVEL[props.level] ?? 'outline';
  const label = props.level.charAt(0).toUpperCase() + props.level.slice(1);
  return <Badge variant={tone}>{label}</Badge>;
}

const EVENT_SOURCE: Readonly<Record<TaskEventSource, string>> = {
  service: 'Service',
  agent: 'Agent',
  task: 'Task',
};

export function EventSourceLabel(props: { readonly source: TaskEventSource }) {
  return <span className="text-muted-foreground">{EVENT_SOURCE[props.source] ?? props.source}</span>;
}

export function VersionBadge(props: { readonly version: number; readonly latest?: boolean }) {
  return (
    <Badge variant={props.latest === true ? 'default' : 'outline'} className="font-mono">
      v{props.version}
      {props.latest === true ? ' · latest' : ''}
    </Badge>
  );
}
