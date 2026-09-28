import type { Dashboard, DashboardContent } from '@mini-cloud/shared';
import { ChartLine, Pin, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DashboardWidgetCard } from '@/components/dashboard/dashboard-widget-card';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states';
import { TimeRangeControls } from '@/components/metrics/time-range-controls';
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
import { Card, CardHeader } from '@/components/ui/card';
import { useDashboard, useDeleteDashboard, useEditDashboard } from '@/hooks/use-dashboards';
import { titleOf, withDefaultWindow, withWidgetMoved, withWidgetRemoved, withWidgetTitle } from '@/lib/dashboard-editor';
import { defaultWindowOf, isSameWindow, readWindow, windowSearch, withWindowRange, type DashboardWindow } from '@/lib/dashboard-window';
import { urls } from '@/lib/urls';

interface ReadWindow {
  readonly window: DashboardWindow | undefined;
  readonly error: unknown;
}

export function DashboardPage() {
  const name = useParams().name ?? '';
  const dashboard = useDashboard(name);

  if (dashboard.isPending) {
    return <LoadingRows rows={6} />;
  }
  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  }
  return <DashboardView dashboard={dashboard.data.dashboard} />;
}

function DashboardView({ dashboard }: { readonly dashboard: Dashboard }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const edit = useEditDashboard();
  const remove = useDeleteDashboard();
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  const fallback = useMemo(() => defaultWindowOf(dashboard), [dashboard]);
  const read = useMemo((): ReadWindow => {
    try {
      return { window: readWindow(new URLSearchParams(search), fallback), error: undefined };
    } catch (err) {
      return { window: undefined, error: err };
    }
  }, [search, fallback]);

  // Written by hand rather than through the search-params setter, which would escape
  // the ':' in a time and make the link harder to read.
  const showWindow = (window: DashboardWindow) => void navigate({ search: windowSearch(window) });

  const save = (change: (content: DashboardContent) => DashboardContent, failure: string, success?: string) =>
    edit.mutate(
      { name: dashboard.name, edit: change },
      {
        onSuccess: () => {
          if (success !== undefined) {
            toast.success(success);
          }
        },
        onError: (error) => toast.error(failure, { description: error.message }),
      },
    );

  const header = (
    <PageHeader
      title={dashboard.name}
      description={`${dashboard.widgets.length} ${dashboard.widgets.length === 1 ? 'graph' : 'graphs'}. The window and period apply to every graph, and the link carries both.`}
      actions={
        <>
          <Button asChild variant="outline">
            <Link to={urls.metrics()}>
              <ChartLine className="size-4" />
              Add a graph
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </>
      }
    />
  );

  const deleteDialog = (
    <AlertDialog open={deleting} onOpenChange={setDeleting}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {dashboard.name}?</AlertDialogTitle>
          <AlertDialogDescription>Its graphs are removed with it, and links to it stop working. The metrics themselves are not touched.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              remove.mutate(dashboard.name, {
                onSuccess: () => {
                  toast.success(`Deleted ${dashboard.name}.`);
                  void navigate(urls.dashboards());
                },
                onError: (error) => toast.error('Could not delete the dashboard.', { description: error.message }),
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const { window } = read;
  if (window === undefined) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <EmptyState
            title="This link's time window cannot be read"
            description={read.error instanceof Error ? read.error.message : String(read.error)}
            action={
              <Button asChild variant="outline">
                <Link to={urls.dashboard(dashboard.name)}>Open on its default window</Link>
              </Button>
            }
          />
        </Card>
        {deleteDialog}
      </div>
    );
  }

  const removingWidget = dashboard.widgets.find((widget) => widget.id === removing);

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardHeader>
          <TimeRangeControls
            range={window.range}
            periodMs={window.periodMs}
            onRangeChange={(range) => showWindow(withWindowRange(window, range))}
            onPeriodChange={(periodMs) => showWindow({ range: window.range, periodMs })}
          />
          {isSameWindow(window, fallback) ? null : (
            <div className="flex flex-wrap items-center gap-3 pt-3 text-sm text-muted-foreground">
              <span>This is not the dashboard's default window.</span>
              <Button
                size="sm"
                variant="outline"
                disabled={edit.isPending}
                onClick={() => save((content) => withDefaultWindow(content, window), 'Could not save the default window.', 'Saved as the default window.')}
              >
                <Pin className="size-4" />
                Make it the default
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {dashboard.widgets.length === 0 ? (
        <Card>
          <EmptyState
            title="No graphs yet"
            description="Build a graph on the Metrics page, then choose Add to dashboard."
            action={
              <Button asChild variant="outline">
                <Link to={urls.metrics()}>Go to Metrics</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {dashboard.widgets.map((widget, index) => (
            <DashboardWidgetCard
              key={widget.id}
              dashboard={dashboard.name}
              widget={widget}
              window={window}
              isFirst={index === 0}
              isLast={index === dashboard.widgets.length - 1}
              busy={edit.isPending}
              onMove={(delta) => save((content) => withWidgetMoved(content, widget.id, delta), 'Could not move the graph.')}
              onRename={(title) => save((content) => withWidgetTitle(content, widget.id, title), 'Could not rename the graph.')}
              onRemove={() => setRemoving(widget.id)}
            />
          ))}
        </div>
      )}

      <AlertDialog open={removingWidget !== undefined} onOpenChange={(open) => setRemoving(open ? removing : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removingWidget === undefined ? 'this graph' : titleOf(removingWidget)}?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from this dashboard only. The metrics it plots are not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing !== undefined) {
                  save((content) => withWidgetRemoved(content, removing), 'Could not remove the graph.');
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {deleteDialog}
    </div>
  );
}
