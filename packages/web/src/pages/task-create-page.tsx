import type { CreateTaskRequest, UpdateTaskRequest } from '@mini-cloud/shared';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { TaskForm } from '@/components/task/task-form';
import { useCreateTask } from '@/hooks/use-tasks';
import { urls } from '@/lib/urls';

function isCreate(request: CreateTaskRequest | UpdateTaskRequest): request is CreateTaskRequest {
  return !('taskId' in request);
}

export function TaskCreatePage() {
  const navigate = useNavigate();
  const create = useCreateTask();

  return (
    <>
      <PageHeader title="Create task" description="A job runs to completion; a service is kept alive." />
      <TaskForm
        mode="create"
        isSubmitting={create.isPending}
        submitError={create.error?.message}
        onCancel={() => navigate(urls.tasks())}
        onSubmit={(request) => {
          if (!isCreate(request)) {
            return;
          }
          create.mutate(request, {
            onSuccess: (response) => {
              toast.success(`Created ${request.name}.`);
              navigate(urls.task(response.taskId));
            },
          });
        }}
      />
    </>
  );
}
