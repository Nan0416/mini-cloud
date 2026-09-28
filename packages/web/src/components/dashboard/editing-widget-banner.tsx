import type { MetricGraph } from '@mini-cloud/shared';
import { LayoutDashboard, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDashboard, useEditDashboard } from '@/hooks/use-dashboards';
import { titleOf, withWidgetQueries } from '@/lib/dashboard-editor';
import { urls } from '@/lib/urls';

export interface EditingWidgetBannerProps {
  readonly dashboard: string;
  readonly widget: string;
  readonly graph: MetricGraph;
}

/** Shown on the metrics page while its graph is one of a dashboard's, opened to be edited. */
export function EditingWidgetBanner(props: EditingWidgetBannerProps) {
  const navigate = useNavigate();
  const dashboard = useDashboard(props.dashboard);
  const edit = useEditDashboard();

  const widget = dashboard.data?.dashboard.widgets.find((candidate) => candidate.id === props.widget);
  // Back on the window the graph was edited over, so what was just saved is what shows.
  const back = urls.dashboard(props.dashboard, { range: props.graph.range, periodMs: props.graph.periodMs });
  const empty = props.graph.queries.length === 0;

  const save = () =>
    edit.mutate(
      { name: props.dashboard, edit: (content) => withWidgetQueries(content, props.widget, props.graph.queries) },
      {
        onSuccess: () => {
          toast.success(`Saved to ${props.dashboard}.`);
          void navigate(back);
        },
        onError: (error) => toast.error('Could not save the graph.', { description: error.message }),
      },
    );

  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm">
          Editing <span className="font-medium">{widget === undefined ? 'a graph' : titleOf(widget)}</span> on <span className="font-medium">{props.dashboard}</span>.{' '}
          {empty ? <span className="text-muted-foreground">A graph needs at least one series; remove it from the dashboard instead.</span> : null}
          {dashboard.isSuccess && widget === undefined ? <span className="text-muted-foreground">It is no longer on the dashboard, so this cannot be saved to it.</span> : null}
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={back}>Discard</Link>
          </Button>
          <Button size="sm" onClick={save} disabled={empty || edit.isPending || (dashboard.isSuccess && widget === undefined)}>
            {edit.isPending ? <Spinner /> : <Save className="size-4" />}
            Save to dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
