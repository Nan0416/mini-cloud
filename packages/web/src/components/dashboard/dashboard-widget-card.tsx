import { DASHBOARD_LIMITS, periodOf, type DashboardWidget } from '@mini-cloud/shared';
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, TextCursorInput, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TimeSeriesChart } from '@/components/metrics/time-series-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGraphChart } from '@/hooks/use-graph-chart';
import { graphOf, titleOf } from '@/lib/dashboard-editor';
import type { DashboardWindow } from '@/lib/dashboard-window';
import { urls } from '@/lib/urls';

export interface DashboardWidgetCardProps {
  readonly dashboard: string;
  readonly widget: DashboardWidget;
  readonly window: DashboardWindow;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** A save is in flight, so another edit would only race it. */
  readonly busy: boolean;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRename: (title: string) => void;
  readonly onRemove: () => void;
}

export function DashboardWidgetCard(props: DashboardWidgetCardProps) {
  const { widget, window } = props;
  const graph = useMemo(() => graphOf(widget, window), [widget, window]);
  const { chartSeries, frame, stale } = useGraphChart(graph);
  const [renaming, setRenaming] = useState(false);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="truncate text-base" title={titleOf(widget)}>
          {titleOf(widget)}
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={`Actions for ${titleOf(widget)}`} disabled={props.busy}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={urls.metrics({ graph, dashboard: props.dashboard, widget: widget.id })}>
                <Pencil className="size-4" />
                Edit metrics
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <TextCursorInput className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.isFirst} onSelect={() => props.onMove(-1)}>
              <ArrowUp className="size-4" />
              Move earlier
            </DropdownMenuItem>
            <DropdownMenuItem disabled={props.isLast} onSelect={() => props.onMove(1)}>
              <ArrowDown className="size-4" />
              Move later
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={props.onRemove}>
              <Trash2 className="size-4" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <TimeSeriesChart series={chartSeries} from={frame?.from ?? 0} to={frame?.to ?? 0} periodMs={frame?.periodMs ?? periodOf(graph)} stale={stale} />
      </CardContent>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        {renaming ? (
          <RenameBody
            initial={widget.title ?? ''}
            placeholder={titleOf({ ...widget, title: undefined })}
            onCancel={() => setRenaming(false)}
            onSave={(title) => {
              setRenaming(false);
              props.onRename(title);
            }}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

interface RenameBodyProps {
  readonly initial: string;
  readonly placeholder: string;
  readonly onCancel: () => void;
  readonly onSave: (title: string) => void;
}

function RenameBody(props: RenameBodyProps) {
  const [title, setTitle] = useState(props.initial);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSave(title);
  };

  return (
    <DialogContent>
      <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Rename graph</DialogTitle>
          <DialogDescription>Leave it empty to title the graph from its series.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="widget-title">Title</Label>
          <Input
            id="widget-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={props.placeholder}
            maxLength={DASHBOARD_LIMITS.titleLength}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
