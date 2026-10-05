import { NOTIFIER_LIMITS, type Notifier } from '@mini-cloud/shared';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/common/form-field';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateNotifier, useUpdateNotifier } from '@/hooks/use-notifiers';
import { BLANK_NOTIFIER_FORM, notifierFormOf, notifierOf, type NotifierFormValues } from '@/lib/notifier-editor';

export interface NotifierDialogBodyProps {
  /** Absent to create one. */
  readonly notifier?: Notifier;
  readonly onClose: () => void;
}

/**
 * The inside of the create and edit dialog. Rendered only while the dialog is open, so
 * it seeds from the notifier each time it opens and a refetch cannot overwrite typing.
 */
export function NotifierDialogBody({ notifier, onClose }: NotifierDialogBodyProps) {
  const mode = notifier === undefined ? 'create' : 'edit';
  const create = useCreateNotifier();
  const update = useUpdateNotifier();
  const [values, setValues] = useState<NotifierFormValues>(notifier === undefined ? BLANK_NOTIFIER_FORM : notifierFormOf(notifier));
  const [showErrors, setShowErrors] = useState(false);
  const patch = (change: Partial<NotifierFormValues>) => setValues((current) => ({ ...current, ...change }));

  const result = notifierOf(values, mode);
  const pending = create.isPending || update.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowErrors(true);
    if (result.notifier === undefined || pending) {
      return;
    }
    const onError = (error: Error) => toast.error(`Could not ${mode === 'create' ? 'add' : 'save'} the notifier.`, { description: error.message });
    if (notifier === undefined) {
      create.mutate(result.notifier, {
        onSuccess: ({ notifier: created }) => {
          toast.success(`Added ${created.name}. Send it a test to check the webhook.`);
          onClose();
        },
        onError,
      });
      return;
    }
    update.mutate(
      { ...result.notifier, notifierId: notifier.notifierId, version: notifier.version },
      {
        onSuccess: ({ notifier: saved }) => {
          toast.success(`Saved ${saved.name}.`);
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <DialogContent>
      <form className="space-y-4" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add a Discord notifier' : `Edit ${notifier?.name}`}</DialogTitle>
          <DialogDescription>
            Messages are posted to a Discord channel through a webhook. Create one in the channel’s settings, under Integrations → Webhooks, and copy its URL.
          </DialogDescription>
        </DialogHeader>

        <FormField label="Name" htmlFor="notifier-name" hint="How monitors list it. You can rename it later.">
          <Input
            id="notifier-name"
            value={values.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Home alerts"
            maxLength={NOTIFIER_LIMITS.nameLength}
            autoFocus
          />
        </FormField>
        <FormField label="Channel" htmlFor="notifier-channel" hint="The channel’s name, for your reference. The webhook decides where messages go.">
          <Input
            id="notifier-channel"
            value={values.channel}
            onChange={(event) => patch({ channel: event.target.value })}
            placeholder="#alerts"
            maxLength={NOTIFIER_LIMITS.channelLength}
          />
        </FormField>
        <FormField
          label="Webhook URL"
          htmlFor="notifier-webhook"
          hint={
            mode === 'create'
              ? 'Kept on the control plane and never shown again.'
              : `Leave empty to keep the current webhook (id ${notifier?.target.webhookId}). The URL is never shown once saved.`
          }
        >
          <Input
            id="notifier-webhook"
            value={values.webhookUrl}
            onChange={(event) => patch({ webhookUrl: event.target.value })}
            placeholder={mode === 'create' ? 'https://discord.com/api/webhooks/…' : 'Keep the current webhook'}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
        </FormField>
        <FormField label="Description" htmlFor="notifier-description" optional>
          <Textarea
            id="notifier-description"
            rows={2}
            value={values.description}
            onChange={(event) => patch({ description: event.target.value })}
            maxLength={NOTIFIER_LIMITS.descriptionLength}
          />
        </FormField>

        {showErrors && result.problem !== undefined ? <p className="text-sm text-destructive">{result.problem}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || (showErrors && result.problem !== undefined)}>
            {pending ? <Spinner /> : null}
            {mode === 'create' ? 'Add notifier' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
