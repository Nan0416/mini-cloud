import type { ReplacementVariables } from '@mini-cloud/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyValueEditor, pairsToRecord, recordToPairs, type KeyValuePair } from '@/components/common/key-value-editor';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingRows, Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useSetVariables, useVariables } from '@/hooks/use-variables';

/**
 * Mounted only once the variables have loaded, so the editor seeds from them in
 * `useState` rather than in an effect. A refetch afterwards cannot then discard
 * whatever is half-typed in the fields.
 */
function VariablesEditor(props: { readonly initial: ReplacementVariables }) {
  const [pairs, setPairs] = useState<ReadonlyArray<KeyValuePair>>(() => recordToPairs(props.initial));
  const save = useSetVariables();

  return (
    <>
      <CardContent>
        <KeyValueEditor
          pairs={pairs}
          onChange={setPairs}
          disabled={save.isPending}
          keyPlaceholder="HOME"
          valuePlaceholder="/Users/nan"
          addLabel="Add variable"
          emptyMessage="No variables set."
        />
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          onClick={() => {
            save.mutate(pairsToRecord(pairs), {
              onSuccess: (response) => {
                // Reseeded from the response, so blank rows the service dropped
                // disappear instead of lingering as phantom edits.
                setPairs(recordToPairs(response.variables));
                toast.success('Variables saved.');
              },
              onError: (error) => toast.error('Could not save the variables.', { description: error.message }),
            });
          }}
          disabled={save.isPending}
        >
          {save.isPending ? <Spinner /> : null}
          Save
        </Button>
      </CardFooter>
    </>
  );
}

export function VariablesPage() {
  const variables = useVariables();

  return (
    <>
      <PageHeader title="Replacement variables" description="Substituted into every task's command, working directory, arguments and environment before launch." />

      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
          <CardDescription>
            Referenced as <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{'${NAME}'}</code>. One definition can then target machines with different directory
            layouts.
          </CardDescription>
        </CardHeader>

        {variables.isPending ? (
          <LoadingRows rows={3} />
        ) : variables.error !== null ? (
          <ErrorState error={variables.error} onRetry={() => void variables.refetch()} />
        ) : (
          <VariablesEditor initial={variables.data.variables} />
        )}
      </Card>
    </>
  );
}
