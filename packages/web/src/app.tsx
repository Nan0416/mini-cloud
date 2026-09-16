import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Cloud } from 'lucide-react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConnectionProvider, useConnection } from '@/hooks/use-connection';
import { ThemeProvider, useTheme } from '@/hooks/use-theme';
import { SetupScreen } from '@/components/setup/setup-screen';
import { InternalServiceError, ServiceUnreachableError } from '@mini-cloud/shared';
import { AgentsPage } from '@/pages/agents-page';
import { InstancePage } from '@/pages/instance-page';
import { InstancesPage } from '@/pages/instances-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { OverviewPage } from '@/pages/overview-page';
import { PubSubPage } from '@/pages/pubsub-page';
import { TaskCreatePage } from '@/pages/task-create-page';
import { TaskEditPage } from '@/pages/task-edit-page';
import { TaskPage } from '@/pages/task-page';
import { TasksPage } from '@/pages/tasks-page';
import { VariablesPage } from '@/pages/variables-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything on screen is polled, so a refetch on window focus would only add
      // a duplicate request on top of the interval already running.
      refetchOnWindowFocus: false,
      staleTime: 2_000,
      retry: (failureCount, error) => {
        // A 400, 401 or 404 will not become true by asking again. Only a transport
        // failure or a fault inside the service is worth repeating.
        const worthRetrying = error instanceof ServiceUnreachableError || error instanceof InternalServiceError;
        return worthRetrying && failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Sonner needs the resolved theme, and it lives outside the Tailwind class tree. */
function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton />;
}

/** Deliberately almost nothing: one round trip, usually against the same machine. */
function ConnectingSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <Cloud className="size-6 animate-pulse text-primary" />
      <p className="text-sm">Connecting…</p>
    </div>
  );
}

/**
 * A gate rather than a route: every page below needs a client to call, so rendering
 * them without one means each panel discovering the same missing answer separately.
 */
function ConnectedApp() {
  const { state } = useConnection();
  if (state.status === 'probing') {
    return <ConnectingSplash />;
  }
  if (state.status === 'setup') {
    return <SetupScreen initial={state.candidate} outcome={state.outcome} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/new" element={<TaskCreatePage />} />
          <Route path="tasks/:taskId" element={<TaskPage />} />
          <Route path="tasks/:taskId/edit" element={<TaskEditPage />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="instances/:instanceId" element={<InstancePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="variables" element={<VariablesPage />} />
          <Route path="pubsub" element={<PubSubPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* Inside the query client, because switching service clears its cache. */}
        <ConnectionProvider>
          <TooltipProvider delayDuration={300}>
            <ConnectedApp />
            <ThemedToaster />
          </TooltipProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
