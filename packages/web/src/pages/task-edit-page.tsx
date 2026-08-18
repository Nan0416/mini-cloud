import type { CreateTaskRequest, UpdateTaskRequest } from '@mini-cloud/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingRows } from '@/components/common/states';
import { TaskForm } from '@/components/task/task-form';
import { useTask, useUpdateTask } from '@/hooks/use-tasks';
import { urls } from '@/lib/urls';

function isUpdate(request: CreateTaskRequest | UpdateTaskRequest): request is UpdateTaskRequest {
  return 'taskId' in request;
}

export function TaskEditPage() {
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const task = useTask(taskId);
  const update = useUpdateTask();

  if (task.isPending) {
    return <LoadingRows rows={8} />;
  }
  if (task.error !== null) {
    return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  }

  return (
    <>
      <PageHeader title={`Edit ${task.data.task.name}`} description="Saving writes a new version. Running instances keep the definition they were launched from." />
      <TaskForm
        // Remounts when a different version lands, so the form seeds from the loaded
        // task exactly once instead of re-seeding over what the user has typed.
        key={`${task.data.task.taskId}:${task.data.task.version}`}
        mode="edit"
        task={task.data.task}
        isSubmitting={update.isPending}
        submitError={update.error?.message}
        onCancel={() => navigate(urls.task(taskId))}
        onSubmit={(request) => {
          if (!isUpdate(request)) {
            return;
          }
          update.mutate(request, {
            onSuccess: (response) => {
              toast.success(`Saved version ${response.version}.`);
              navigate(urls.task(taskId));
            },
          });
        }}
      />
    </>
  );
}
