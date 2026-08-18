import { Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBroadcast, useHubStatus, useSendTo } from '@/hooks/use-pubsub';

type Method = 'broadcast' | 'p2p';

/** Parses the payload box. A non-JSON body is published as a plain string. */
function parsePayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function PublishForm() {
  const [method, setMethod] = useState<Method>('broadcast');
  const [target, setTarget] = useState('');
  const [payload, setPayload] = useState('{\n  "hello": "world"\n}');

  const broadcast = useBroadcast();
  const sendTo = useSendTo();
  const pending = broadcast.isPending || sendTo.isPending;

  const publish = (): void => {
    const body = parsePayload(payload);
    const onError = (error: Error): void => {
      toast.error('Publish failed.', { description: error.message });
    };

    if (method === 'broadcast') {
      broadcast.mutate(
        { topic: target.trim(), payload: body },
        {
          onSuccess: (response) =>
            toast.success(
              response.deliveredTo === 0
                ? 'Published, but nobody is subscribed to that topic.'
                : `Delivered to ${response.deliveredTo} subscriber${response.deliveredTo === 1 ? '' : 's'}.`,
            ),
          onError,
        },
      );
      return;
    }

    sendTo.mutate(
      { recipientId: target.trim(), payload: body },
      {
        // deliveredTo 0 is the normal case for a subscriber that has dropped off, not
        // an error, so it is reported as information rather than as a failure.
        onSuccess: (response) => (response.deliveredTo === 0 ? toast.warning('That subscriber is not connected.') : toast.success('Delivered.')),
        onError,
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish a message</CardTitle>
        <CardDescription>Publishes over HTTP, so the message arrives without a sender id — only WebSocket publishers are attributed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="method">Delivery</Label>
            <Select value={method} onValueChange={(value) => setMethod(value === 'p2p' ? 'p2p' : 'broadcast')}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="broadcast">Broadcast</SelectItem>
                <SelectItem value="p2p">Point to point</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target">{method === 'broadcast' ? 'Topic' : 'Subscriber id'}</Label>
            <Input
              id="target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="font-mono"
              placeholder={method === 'broadcast' ? 'mini-cloud.agents' : 'the id from the subscriber’s welcome message'}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payload">Payload</Label>
          <Textarea id="payload" value={payload} onChange={(event) => setPayload(event.target.value)} className="min-h-32 font-mono text-[0.8125rem]" spellCheck={false} />
          <p className="text-xs text-muted-foreground">Parsed as JSON when it can be. Anything else is sent as a string.</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={publish} disabled={pending || target.trim().length === 0}>
            {pending ? <Spinner /> : <Send className="size-4" />}
            Publish
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PubSubPage() {
  const hub = useHubStatus();
  const topics = Object.entries(hub.data?.status.topicToSubscriberCount ?? {}).sort(([left], [right]) => left.localeCompare(right));

  return (
    <>
      <PageHeader title="Pub/Sub" description="The message hub the service uses to command agents, and that anything else on your network can use too." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle>Topics</CardTitle>
              <CardDescription>
                {hub.data === undefined ? 'Loading…' : `${hub.data.status.subscriberCount} subscriber${hub.data.status.subscriberCount === 1 ? '' : 's'} connected`}
              </CardDescription>
            </div>
          </CardHeader>

          {hub.isPending ? (
            <LoadingRows rows={3} />
          ) : hub.error !== null ? (
            <ErrorState error={hub.error} onRetry={() => void hub.refetch()} />
          ) : topics.length === 0 ? (
            <EmptyState title="No topics have subscribers" description="Agents subscribe to mini-cloud.agents and to their own command topic when they start." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Topic</TableHead>
                  <TableHead className="w-32 text-right">Subscribers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map(([topic, count]) => (
                  <TableRow key={topic}>
                    <TableCell className="font-mono text-[0.8125rem]">{topic}</TableCell>
                    <TableCell className="tabular text-right">{count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <PublishForm />
      </div>
    </>
  );
}
