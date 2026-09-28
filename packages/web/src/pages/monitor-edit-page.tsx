import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingRows } from '@/components/common/states';
import { MonitorForm } from '@/components/monitor/monitor-form';
import { useMonitor, useUpdateMonitor } from '@/hooks/use-monitors';
import { monitorFormOf } from '@/lib/monitor-editor';
import { urls } from '@/lib/urls';

export function MonitorEditPage() {
  const name = useParams().name ?? '';
  const navigate = useNavigate();
  const monitor = useMonitor(name);
  const update = useUpdateMonitor();

  if (monitor.isPending) {
    return <LoadingRows rows={6} />;
  }
  if (monitor.isError) {
    return <ErrorState error={monitor.error} onRetry={() => void monitor.refetch()} />;
  }
  const current = monitor.data.monitor;

  return (
    <>
      <PageHeader title={`Edit ${current.name}`} description="Its state is kept until the next evaluation, within a minute, judges it against the new definition." />
      <MonitorForm
        // Keyed on the version, so the form is seeded from the definition it will be saved over.
        key={current.version}
        mode="edit"
        initial={monitorFormOf(current)}
        isSubmitting={update.isPending}
        submitError={update.error?.message}
        onCancel={() => void navigate(urls.monitor(current.name))}
        onSubmit={(_name, definition) =>
          update.mutate(
            { name: current.name, version: current.version, ...definition },
            {
              onSuccess: () => {
                toast.success(`Saved ${current.name}.`);
                void navigate(urls.monitor(current.name));
              },
            },
          )
        }
      />
    </>
  );
}
