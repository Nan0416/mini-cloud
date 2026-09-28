import { DASHBOARD_LIMITS, type MetricGraph } from '@mini-cloud/shared';
import { LayoutDashboard } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateDashboard, useDashboards, useEditDashboard } from '@/hooks/use-dashboards';
import { DASHBOARD_NAME_HINT, dashboardNameProblem, withWidgetAdded } from '@/lib/dashboard-editor';
import { urls } from '@/lib/urls';

export interface AddToDashboardDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly graph: MetricGraph;
}

type Target = 'existing' | 'new';

/** Mounted only while open, so each opening starts from a blank form. */
function AddToDashboardBody(props: Omit<AddToDashboardDialogProps, 'open'>) {
  const navigate = useNavigate();
  const dashboards = useDashboards();
  const create = useCreateDashboard();
  const edit = useEditDashboard();

  const names = dashboards.data?.dashboards.map((dashboard) => dashboard.name) ?? [];
  const [target, setTarget] = useState<Target | undefined>(undefined);
  // Existing when there is anything to choose, once the list has said so.
  const chosenTarget: Target = target ?? (names.length > 0 ? 'existing' : 'new');
  const [existing, setExisting] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState('');

  const trimmedTitle = title.trim();
  const widgetTitle = trimmedTitle.length === 0 ? undefined : trimmedTitle;
  const problem = chosenTarget === 'new' ? dashboardNameProblem(newName, names) : undefined;
  const destination = chosenTarget === 'new' ? newName : existing;
  const busy = create.isPending || edit.isPending;
  const ready = destination !== undefined && destination.length > 0 && problem === undefined && !busy;

  const done = (name: string) => {
    props.onOpenChange(false);
    toast.success(`Added to ${name}.`, { action: { label: 'Open', onClick: () => void navigate(urls.dashboard(name)) } });
  };
  const failed = (error: Error) => toast.error('Could not add the graph.', { description: error.message });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    if (chosenTarget === 'new') {
      // A new dashboard opens on the window this graph was built in, when it is one that moves with the clock.
      const defaults = props.graph.range.kind === 'relative' ? { defaultRange: props.graph.range, defaultPeriodMs: props.graph.periodMs } : {};
      create.mutate({ name: newName, ...withWidgetAdded({ widgets: [], ...defaults }, props.graph.queries, widgetTitle) }, { onSuccess: () => done(newName), onError: failed });
      return;
    }
    edit.mutate({ name: destination, edit: (content) => withWidgetAdded(content, props.graph.queries, widgetTitle) }, { onSuccess: () => done(destination), onError: failed });
  };

  return (
    <DialogContent>
      <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Add to dashboard</DialogTitle>
          <DialogDescription>
            The graph's {props.graph.queries.length === 1 ? 'series is' : `${props.graph.queries.length} series are`} added as one graph. The dashboard sets the time window.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Dashboard" className="flex gap-0.5 rounded-md border border-border p-0.5">
          {(['existing', 'new'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              className="h-7 flex-1"
              variant={chosenTarget === option ? 'secondary' : 'ghost'}
              aria-pressed={chosenTarget === option}
              disabled={option === 'existing' && names.length === 0}
              onClick={() => setTarget(option)}
            >
              {option === 'existing' ? 'Existing dashboard' : 'New dashboard'}
            </Button>
          ))}
        </div>

        {chosenTarget === 'existing' ? (
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-existing">Dashboard</Label>
            <Select value={existing} onValueChange={setExisting}>
              <SelectTrigger id="dashboard-existing">
                <SelectValue placeholder="Choose a dashboard" />
              </SelectTrigger>
              <SelectContent>
                {names.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-new">Name</Label>
            <Input
              id="dashboard-new"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="home-lab"
              maxLength={DASHBOARD_LIMITS.nameLength}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">{problem ?? DASHBOARD_NAME_HINT}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="dashboard-widget-title">Graph title (optional)</Label>
          <Input id="dashboard-widget-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={DASHBOARD_LIMITS.titleLength} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            {busy ? <Spinner /> : <LayoutDashboard className="size-4" />}
            Add
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function AddToDashboardDialog({ open, ...rest }: AddToDashboardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open ? <AddToDashboardBody {...rest} /> : null}
    </Dialog>
  );
}
