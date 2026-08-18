import type { CreateTaskRequest, HealthCheck, Task, TaskType, UpdateTaskRequest } from '@mini-cloud/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { KeyValueEditor, pairsToRecord, recordToPairs, type KeyValuePair } from '@/components/common/key-value-editor';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { durationToHhmmss, hhmmssToDuration, localDateTimeToTimestamp, timestampToLocalDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type HealthCheckChoice = 'none' | 'ping' | 'passive';

interface FormState {
  readonly name: string;
  readonly description: string;
  readonly type: TaskType;
  readonly cmd: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ReadonlyArray<KeyValuePair>;
  readonly stdout: string;
  readonly stderr: string;
  // job
  readonly interval: string;
  readonly firstLaunchAt: string;
  // service
  readonly healthCheck: HealthCheckChoice;
  readonly healthCheckUrl: string;
  readonly healthCheckPeriodSeconds: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

function initialState(task?: Task): FormState {
  const base: FormState = {
    name: task?.name ?? '',
    description: task?.description ?? '',
    type: task?.type ?? 'job',
    cmd: task?.cmd ?? '',
    cwd: task?.cwd ?? '',
    args: task?.arguments ?? [],
    env: recordToPairs(task?.env),
    stdout: task?.stdout ?? '',
    stderr: task?.stderr ?? '',
    interval: '',
    firstLaunchAt: '',
    healthCheck: 'none',
    healthCheckUrl: '',
    healthCheckPeriodSeconds: '30',
  };

  if (task?.type === 'job') {
    return {
      ...base,
      interval: task.duration === undefined ? '' : durationToHhmmss(task.duration),
      firstLaunchAt: task.firstLaunchAt === undefined ? '' : timestampToLocalDateTime(task.firstLaunchAt),
    };
  }

  if (task?.type === 'service' && task.healthCheck !== undefined) {
    return {
      ...base,
      healthCheck: task.healthCheck.type,
      healthCheckUrl: task.healthCheck.type === 'ping' ? task.healthCheck.url : '',
      healthCheckPeriodSeconds: task.healthCheck.periodInMs === undefined ? '30' : String(Math.round(task.healthCheck.periodInMs / 1_000)),
    };
  }

  return base;
}

/** Minimum the agent will honour; below this the checks cost more than they measure. */
const MIN_HEALTH_CHECK_SECONDS = 5;

function validate(state: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (state.name.trim().length === 0) {
    errors.name = 'A name is required.';
  }
  if (state.cmd.trim().length === 0) {
    errors.cmd = 'A command is required.';
  }
  if (state.cwd.trim().length === 0) {
    errors.cwd = 'A working directory is required — the agent spawns the process there.';
  }
  if (state.args.some((argument) => argument.trim().length === 0)) {
    errors.args = 'Remove the blank arguments, or fill them in.';
  }

  if (state.type === 'job') {
    const hasInterval = state.interval.trim().length > 0;
    const hasFirstLaunch = state.firstLaunchAt.trim().length > 0;

    if (hasInterval && hhmmssToDuration(state.interval) === undefined) {
      errors.interval = 'Use hh:mm:ss, for example 00:15:00.';
    }
    if (hasInterval && hhmmssToDuration(state.interval) === 0) {
      errors.interval = 'An interval of zero would relaunch the job continuously.';
    }
    if (hasFirstLaunch && localDateTimeToTimestamp(state.firstLaunchAt) === undefined) {
      errors.firstLaunchAt = 'That is not a valid date and time.';
    }
    // The scheduler needs both to place occurrences; one alone silently never fires,
    // which is a confusing way for a job to do nothing.
    if (hasInterval !== hasFirstLaunch) {
      const message = 'A repeating job needs both an interval and a first launch. Leave both empty for a manual-only job.';
      if (!hasInterval) {
        errors.interval = message;
      } else {
        errors.firstLaunchAt = message;
      }
    }
  }

  if (state.type === 'service' && state.healthCheck !== 'none') {
    const seconds = Number(state.healthCheckPeriodSeconds);
    if (!Number.isInteger(seconds) || seconds < MIN_HEALTH_CHECK_SECONDS) {
      errors.healthCheckPeriodSeconds = `Must be a whole number of seconds, at least ${MIN_HEALTH_CHECK_SECONDS}.`;
    }
    if (state.healthCheck === 'ping') {
      const url = state.healthCheckUrl.trim();
      if (url.length === 0) {
        errors.healthCheckUrl = 'A URL is required for a ping health check.';
      } else if (!/^https?:\/\//i.test(url)) {
        errors.healthCheckUrl = 'Include the scheme, for example http://127.0.0.1:8080/healthz.';
      }
    }
  }

  return errors;
}

function buildHealthCheck(state: FormState): HealthCheck | undefined {
  if (state.healthCheck === 'none') {
    return undefined;
  }
  const periodInMs = Number(state.healthCheckPeriodSeconds) * 1_000;
  if (state.healthCheck === 'ping') {
    return { type: 'ping', url: state.healthCheckUrl.trim(), periodInMs };
  }
  return { type: 'passive', periodInMs };
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function buildRequest(state: FormState, taskId?: string): CreateTaskRequest | UpdateTaskRequest {
  const env = pairsToRecord(state.env);
  const shared = {
    name: state.name.trim(),
    description: blankToUndefined(state.description),
    cmd: state.cmd.trim(),
    cwd: state.cwd.trim(),
    arguments: state.args.length > 0 ? state.args.map((argument) => argument.trim()) : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    stdout: blankToUndefined(state.stdout),
    stderr: blankToUndefined(state.stderr),
  };

  if (state.type === 'job') {
    const job = {
      ...shared,
      type: 'job' as const,
      duration: hhmmssToDuration(state.interval),
      firstLaunchAt: localDateTimeToTimestamp(state.firstLaunchAt),
    };
    return taskId === undefined ? job : { ...job, taskId };
  }

  const service = { ...shared, type: 'service' as const, healthCheck: buildHealthCheck(state) };
  return taskId === undefined ? service : { ...service, taskId };
}

function Field(props: {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: React.ReactNode;
  readonly optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.htmlFor} className="flex items-center gap-1.5">
        {props.label}
        {props.optional === true ? <span className="text-xs font-normal text-muted-foreground">optional</span> : null}
      </Label>
      {props.children}
      {props.error !== undefined ? (
        <p className="text-xs text-destructive">{props.error}</p>
      ) : props.hint !== undefined ? (
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      ) : null}
    </div>
  );
}

export interface TaskFormProps {
  readonly mode: 'create' | 'edit';
  readonly task?: Task;
  readonly isSubmitting: boolean;
  readonly submitError?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (request: CreateTaskRequest | UpdateTaskRequest) => void;
}

export function TaskForm(props: TaskFormProps) {
  // Keyed on the loaded task so an edit form populates once the fetch lands, without
  // a `componentDidUpdate` that would also clobber whatever the user had typed.
  const [state, setState] = useState<FormState>(() => initialState(props.task));
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validate(state), [state]);
  const hasErrors = Object.keys(errors).length > 0;
  const visible = (field: keyof FormState): string | undefined => (showErrors ? errors[field] : undefined);
  const patch = (change: Partial<FormState>): void => setState((previous) => ({ ...previous, ...change }));

  const submit = (): void => {
    setShowErrors(true);
    if (hasErrors) {
      return;
    }
    props.onSubmit(buildRequest(state, props.task?.taskId));
  };

  return (
    <form
      className="max-w-5xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
          <CardDescription>
            {props.mode === 'create'
              ? 'Tasks are versioned and immutable — this creates version 1.'
              : 'Saving writes a new version. Instances already running keep the definition they were launched from.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {props.submitError === undefined ? null : (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{props.submitError}</div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={visible('name')}>
              <Input id="name" value={state.name} onChange={(event) => patch({ name: event.target.value })} placeholder="nightly-backup" />
            </Field>

            <Field label="Type" htmlFor="type" hint={state.type === 'job' ? 'Runs to completion. Can repeat on a schedule.' : 'Long-running. Kept alive and health-checked.'}>
              <Select
                value={state.type}
                // The type discriminates the whole record and the service has no
                // migration from one to the other, so it is fixed after creation.
                disabled={props.mode === 'edit'}
                onValueChange={(value) => patch({ type: value === 'service' ? 'service' : 'job' })}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job">Job</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="description" optional error={visible('description')}>
            <Textarea
              id="description"
              value={state.description}
              onChange={(event) => patch({ description: event.target.value })}
              className="min-h-16"
              placeholder="What this task does."
            />
          </Field>

          <Field label="Working directory" htmlFor="cwd" error={visible('cwd')} hint="Supports ${NAME} replacement variables.">
            <Input id="cwd" value={state.cwd} onChange={(event) => patch({ cwd: event.target.value })} className="font-mono" placeholder="${HOME}/projects/backup" />
          </Field>

          <Field label="Command" htmlFor="cmd" error={visible('cmd')} hint="The executable or shell command. Supports ${NAME} replacement variables.">
            <Input id="cmd" value={state.cmd} onChange={(event) => patch({ cmd: event.target.value })} className="font-mono" placeholder="/usr/bin/python3" />
          </Field>

          <Field label="Arguments" htmlFor="args" optional error={visible('args')} hint="One per field. Passed to the process in order.">
            <div className="space-y-2">
              {state.args.map((argument, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={argument}
                    aria-label={`Argument ${index + 1}`}
                    className="font-mono"
                    onChange={(event) => patch({ args: state.args.map((current, position) => (position === index ? event.target.value : current)) })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => patch({ args: state.args.filter((_current, position) => position !== index) })}
                    aria-label={`Remove argument ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => patch({ args: [...state.args, ''] })}>
                <Plus className="size-4" />
                Add argument
              </Button>
            </div>
          </Field>

          <Field label="Environment variables" htmlFor="env" optional>
            <KeyValueEditor pairs={state.env} onChange={(env) => patch({ env })} addLabel="Add variable" emptyMessage="The process inherits the agent's environment." />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Stdout path" htmlFor="stdout" optional hint="Appended to. Omit to discard.">
              <Input id="stdout" value={state.stdout} onChange={(event) => patch({ stdout: event.target.value })} className="font-mono" placeholder="${LOGS}/backup.out" />
            </Field>
            <Field label="Stderr path" htmlFor="stderr" optional hint="Appended to. Omit to discard.">
              <Input id="stderr" value={state.stderr} onChange={(event) => patch({ stderr: event.target.value })} className="font-mono" placeholder="${LOGS}/backup.err" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {state.type === 'job' ? (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Leave both empty for a job you launch by hand. Set both to have the scheduler repeat it.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field label="Interval" htmlFor="interval" optional error={visible('interval')} hint="hh:mm:ss between launches.">
              <Input id="interval" value={state.interval} onChange={(event) => patch({ interval: event.target.value })} className="font-mono tabular" placeholder="00:15:00" />
            </Field>
            <Field label="First launch" htmlFor="firstLaunchAt" optional error={visible('firstLaunchAt')} hint="In your local timezone. Occurrences are counted from here.">
              <Input
                id="firstLaunchAt"
                type="datetime-local"
                step={1}
                value={state.firstLaunchAt}
                onChange={(event) => patch({ firstLaunchAt: event.target.value })}
                className="tabular"
              />
            </Field>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Health check</CardTitle>
            <CardDescription>How the agent decides the service is still alive. A failing check marks the instance unhealthy; it can recover.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="Type"
              htmlFor="healthCheck"
              hint={
                state.healthCheck === 'ping'
                  ? 'The agent polls a URL the service exposes.'
                  : state.healthCheck === 'passive'
                    ? 'The service pushes a heartbeat using @mini-cloud/reporter.'
                    : 'The agent only notices the process exiting.'
              }
            >
              <Select value={state.healthCheck} onValueChange={(value) => patch({ healthCheck: value === 'ping' ? 'ping' : value === 'passive' ? 'passive' : 'none' })}>
                <SelectTrigger id="healthCheck" className="sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="ping">Ping</SelectItem>
                  <SelectItem value="passive">Passive</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {state.healthCheck === 'ping' ? (
              <Field label="URL" htmlFor="healthCheckUrl" error={visible('healthCheckUrl')} hint="Polled from the agent's machine, so localhost means the agent's localhost.">
                <Input
                  id="healthCheckUrl"
                  value={state.healthCheckUrl}
                  onChange={(event) => patch({ healthCheckUrl: event.target.value })}
                  className="font-mono"
                  placeholder="http://127.0.0.1:8080/healthz"
                />
              </Field>
            ) : null}

            {state.healthCheck === 'none' ? null : (
              <Field label="Period (seconds)" htmlFor="healthCheckPeriodSeconds" error={visible('healthCheckPeriodSeconds')}>
                <Input
                  id="healthCheckPeriodSeconds"
                  type="number"
                  min={MIN_HEALTH_CHECK_SECONDS}
                  value={state.healthCheckPeriodSeconds}
                  onChange={(event) => patch({ healthCheckPeriodSeconds: event.target.value })}
                  className={cn('tabular sm:w-40')}
                />
              </Field>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel} disabled={props.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.isSubmitting || (showErrors && hasErrors)}>
          {props.isSubmitting ? <Spinner /> : null}
          {props.mode === 'create' ? 'Create task' : 'Save new version'}
        </Button>
      </div>
    </form>
  );
}
