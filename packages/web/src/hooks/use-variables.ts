import { useApi } from '@/hooks/use-connection';
import type { ReplacementVariables } from '@mini-cloud/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';

export function useVariables() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.variables(),
    queryFn: () => api.listReplacementVariables({}),
  });
}

export function useSetVariables() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: ReplacementVariables) => api.setReplacementVariables({ variables }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.variables() }),
  });
}
