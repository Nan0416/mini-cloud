import { ServiceUnreachableError } from '@mini-cloud/shared';
import { WifiOff } from 'lucide-react';
import { useConnection } from '@/hooks/use-connection';
import { useServiceHealth } from '@/hooks/use-service-health';

/**
 * One banner for "there is no service to talk to", so a dead control plane reads as
 * one problem rather than as every panel on the page failing separately.
 *
 * Only transport failures get a banner. Anything the service actually answered — a
 * 401, a 404, a 500 — is specific to the panel that asked, and `ErrorState` says so
 * there, next to the thing that failed.
 */
export function OfflineBanner() {
  const { error } = useServiceHealth();
  const { connection } = useConnection();
  if (!(error instanceof ServiceUnreachableError) || connection === undefined) {
    return null;
  }

  return (
    <div className="flex items-start gap-2.5 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
      <WifiOff className="mt-0.5 size-4 shrink-0" />
      <p>
        Cannot reach the service at {connection.apiUrl}. It may be stopped, or the browser may have blocked the request before it left: check that MINI_CLOUD_CORS_ORIGINS on the
        service includes {window.location.origin}. Use the address in the top bar to point this console somewhere else.
      </p>
    </div>
  );
}
