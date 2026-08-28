import { useApi } from '@/hooks/use-connection';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';

/**
 * Liveness probe behind the offline banner.
 *
 * Kept separate from the data queries so the banner says "the service is
 * unreachable" once, rather than every panel independently rendering its own
 * transport error and burying the actual cause. `/ping` needs no token, so this
 * keeps reporting on reachability even when authentication is rejecting everything
 * else — which is what makes the two failures distinguishable on screen.
 */
export function useServiceHealth() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.ping(),
    queryFn: () => api.ping(),
    refetchInterval: 15_000,
    // A failed probe is the signal, so retrying only delays the banner.
    retry: false,
  });
}
