import { DASHBOARD_LIMITS, type Dashboard } from '@mini-cloud/shared';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { Spinner } from '@/components/common/states';
import { Timestamp } from '@/components/common/timestamp';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateDashboard, useDashboards } from '@/hooks/use-dashboards';
import { DASHBOARD_NAME_HINT, dashboardNameProblem } from '@/lib/dashboard-editor';
import { urls } from '@/lib/urls';

const COLUMNS: ReadonlyArray<Column<Dashboard>> = [
  {
    id: 'name',
    header: 'Name',
    cell: (dashboard) => (
      <Link to={urls.dashboard(dashboard.name)} className="font-medium hover:underline">
        {dashboard.name}
      </Link>
    ),
    compare: (left, right) => left.name.localeCompare(right.name),
  },
  {
    id: 'graphs',
    header: 'Graphs',
    cell: (dashboard) => <span className="tabular">{dashboard.widgets.length}</span>,
    compare: (left, right) => left.widgets.length - right.widgets.length,
  },
  {
    id: 'updated',
    header: 'Updated',
    cell: (dashboard) => <Timestamp value={dashboard.updatedAt} variant="relative" />,
    compare: (left, right) => left.updatedAt - right.updatedAt,
  },
];

export function DashboardsPage() {
  const dashboards = useDashboards();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Dashboards"
        description="Saved graphs, shown together over one time window. Add a graph from the Metrics page."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New dashboard
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <DataTable
          columns={COLUMNS}
          items={dashboards.data?.dashboards}
          rowKey={(dashboard) => dashboard.name}
          isLoading={dashboards.isPending}
          error={dashboards.error}
          onRetry={() => void dashboards.refetch()}
          onRowClick={(dashboard) => void navigate(urls.dashboard(dashboard.name))}
          search={(term, dashboard) => dashboard.name.toLowerCase().includes(term.toLowerCase())}
          searchPlaceholder="Filter by name"
          emptyTitle="No dashboards yet"
          emptyDescription="Build a graph on the Metrics page and choose Add to dashboard, or start an empty one here."
        />
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <NewDashboardBody taken={dashboards.data?.dashboards.map((dashboard) => dashboard.name) ?? []} onClose={() => setCreating(false)} /> : null}
      </Dialog>
    </>
  );
}

function NewDashboardBody(props: { readonly taken: ReadonlyArray<string>; readonly onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateDashboard();
  const [name, setName] = useState('');
  const problem = dashboardNameProblem(name, props.taken);
  const ready = name.length > 0 && problem === undefined && !create.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    create.mutate(
      { name, widgets: [] },
      {
        onSuccess: () => {
          props.onClose();
          void navigate(urls.dashboard(name));
        },
        onError: (error) => toast.error('Could not create the dashboard.', { description: error.message }),
      },
    );
  };

  return (
    <DialogContent>
      <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>It starts empty. Add graphs to it from the Metrics page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="new-dashboard-name">Name</Label>
          <Input id="new-dashboard-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="home-lab" maxLength={DASHBOARD_LIMITS.nameLength} autoFocus />
          <p className="text-xs text-muted-foreground">{problem ?? DASHBOARD_NAME_HINT}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            {create.isPending ? <Spinner /> : <Plus className="size-4" />}
            Create
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
