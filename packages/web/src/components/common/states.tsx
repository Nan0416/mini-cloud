import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { InternalServiceError, NotFoundError, ServiceUnreachableError, UnauthenticatedError } from '@mini-cloud/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function LoadingRows(props: { readonly rows?: number; readonly className?: string }) {
  const rows = props.rows ?? 4;
  return (
    <div className={cn('space-y-2 p-4', props.className)}>
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function Spinner(props: { readonly className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', props.className)} />;
}

export function EmptyState(props: { readonly title: string; readonly description?: string; readonly action?: ReactNode; readonly icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">{props.icon ?? <Inbox className="size-5" />}</div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{props.title}</p>
        {props.description === undefined ? null : <p className="max-w-md text-sm text-muted-foreground">{props.description}</p>}
      </div>
      {props.action}
    </div>
  );
}

interface Explanation {
  readonly title: string;
  readonly detail: string;
  /** Whether the same request could plausibly succeed if repeated unchanged. */
  readonly retryable: boolean;
}

/**
 * Turns an error into words the reader can act on.
 *
 * The three cases need different sentences: "there is no service to ask", "this thing
 * does not exist", and "the service refused you". A single "Something went wrong"
 * covers none of them, and the retry button would be a lie for two.
 */
function explain(error: unknown): Explanation {
  const detail = error instanceof Error ? error.message : 'An unexpected error occurred.';

  if (error instanceof ServiceUnreachableError) {
    return { title: 'The service is not answering', detail, retryable: true };
  }
  if (error instanceof NotFoundError) {
    return { title: 'Not found', detail, retryable: false };
  }
  if (error instanceof UnauthenticatedError) {
    return {
      title: 'The service requires a token',
      // The console has no login screen by design, so the fix is a rebuild rather
      // than anything the reader can do on this page.
      detail: 'It is running with MINI_CLOUD_TOKEN set. Rebuild the console with VITE_MINI_CLOUD_TOKEN set to the same value, or start the service without a token.',
      retryable: false,
    };
  }
  if (error instanceof InternalServiceError) {
    return { title: 'The service failed', detail, retryable: true };
  }
  return { title: 'Could not load this', detail, retryable: false };
}

export function ErrorState(props: { readonly error: unknown; readonly onRetry?: () => void; readonly className?: string }) {
  const { title, detail, retryable } = explain(props.error);

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', props.className)}>
      <div className="rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-lg text-sm text-muted-foreground">{detail}</p>
      </div>
      {props.onRetry !== undefined && retryable ? (
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
