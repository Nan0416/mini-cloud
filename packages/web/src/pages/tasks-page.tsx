import { Plus, Variable } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { TaskTable } from '@/components/task/task-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTasks } from '@/hooks/use-tasks';
import { urls } from '@/lib/urls';

export function TasksPage() {
  const tasks = useTasks();

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every command mini-cloud knows how to launch."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={urls.variables()}>
                <Variable className="size-4" />
                Variables
              </Link>
            </Button>
            <Button asChild>
              <Link to={urls.createTask()}>
                <Plus className="size-4" />
                Create task
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <TaskTable tasks={tasks.data?.tasks} isLoading={tasks.isPending} error={tasks.error} onRetry={() => void tasks.refetch()} />
      </Card>
    </>
  );
}
