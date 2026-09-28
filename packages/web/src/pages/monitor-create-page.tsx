import { METRIC_STATISTICS } from '@mini-cloud/shared';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { MonitorForm } from '@/components/monitor/monitor-form';
import { useCreateMonitor } from '@/hooks/use-monitors';
import { blankMonitorForm, metricFromSearch } from '@/lib/monitor-editor';
import { urls } from '@/lib/urls';

export function MonitorCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateMonitor();
  // Read once: the form seeds itself on mount and owns its state from then on.
  const initial = useMemo(() => blankMonitorForm(metricFromSearch(params, METRIC_STATISTICS)), [params]);

  return (
    <>
      <PageHeader title="Create monitor" description="It starts with insufficient data, and is first evaluated within a minute." />
      <MonitorForm
        mode="create"
        initial={initial}
        isSubmitting={create.isPending}
        submitError={create.error?.message}
        onCancel={() => void navigate(urls.monitors())}
        onSubmit={(name, definition) =>
          create.mutate(
            { name, ...definition },
            {
              onSuccess: () => {
                toast.success(`Created ${name}.`);
                void navigate(urls.monitor(name));
              },
            },
          )
        }
      />
    </>
  );
}
