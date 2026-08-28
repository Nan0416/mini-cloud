import { Cloud, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { probeConnection } from '@/lib/api';
import { config } from '@/lib/config';
import { isUsableApiUrl, normalizeApiUrl, readRecentUrls, type Connection, type ProbeOutcome } from '@/lib/connection';

/**
 * Copy for a probe that did not succeed.
 *
 * `unreachable` names four causes because the browser gives us no way to tell them
 * apart: mixed content, a CORS rejection, a denied local-network permission and a
 * refused connection all arrive as the same `TypeError`. Listing them beats a bare
 * "could not connect", which sends people to restart a service that was running the
 * whole time.
 */
function failureMessage(outcome: ProbeOutcome, apiUrl: string): string {
  switch (outcome) {
    case 'needs-token':
      return 'That service is running and wants a token. Paste the value of its MINI_CLOUD_TOKEN below.';
    case 'bad-token':
      return 'That service rejected the token. Check it against the MINI_CLOUD_TOKEN the service was started with.';
    case 'unreachable':
      return `Nothing answered at ${apiUrl}. The service may be stopped, or the browser may have blocked the request before it left: MINI_CLOUD_CORS_ORIGINS on the service has to include ${window.location.origin}; a plain http:// address only works on the machine running this browser, and never in Safari; and Chrome asks permission before reaching one.`;
    default:
      return `Something answered at ${apiUrl} but it did not look like a mini-cloud service. Check the address and the port.`;
  }
}

/**
 * Collects a service URL, verifies it, and hands back a connection.
 *
 * Shared by the first-run screen and the "change it later" dialog, because they ask
 * the same question and a second copy of this form is a second place for the failure
 * copy to drift.
 */
export function ConnectionForm(props: { readonly initial?: Connection; readonly onConnect: (connection: Connection, remember: boolean) => void; readonly submitLabel?: string }) {
  // Seeded once, on mount. Callers give this a fresh mount when they need it
  // reseeded — a dialog rendering its body only while open — rather than syncing it
  // from an effect, which would overwrite whatever had been half-typed.
  const [apiUrl, setApiUrl] = useState(props.initial?.apiUrl ?? config.suggestedApiUrl);
  const [token, setToken] = useState(props.initial?.token ?? '');
  const [remember, setRemember] = useState(true);
  const [tokenRequired, setTokenRequired] = useState(props.initial?.token !== undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [recent] = useState(readRecentUrls);

  const valid = isUsableApiUrl(apiUrl);

  // Verification runs from this submit, so Chrome's local-network permission prompt —
  // which only appears for a public page reaching loopback — is provoked by a click
  // the visitor just made, rather than arriving unexplained during a background poll.
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid || busy) {
      return;
    }
    const candidate: Connection = { apiUrl: normalizeApiUrl(apiUrl), token: token.length > 0 ? token : undefined };
    setBusy(true);
    setFailure(undefined);
    const outcome = await probeConnection(candidate);
    setBusy(false);

    if (outcome === 'ok') {
      props.onConnect(candidate, remember);
      return;
    }
    if (outcome === 'needs-token') {
      setTokenRequired(true);
    }
    setFailure(failureMessage(outcome, candidate.apiUrl));
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="connection-url">Service address</Label>
        <Input
          id="connection-url"
          value={apiUrl}
          onChange={(event) => setApiUrl(event.target.value)}
          placeholder="https://mini-cloud.example.com"
          autoFocus
          autoComplete="url"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">Where your control plane is listening. The console talks to it directly from this browser; nothing is sent anywhere else.</p>
      </div>

      {recent.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Recent:</span>
          {recent.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => setApiUrl(url)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {url}
            </button>
          ))}
        </div>
      )}

      {tokenRequired ? (
        <div className="space-y-1.5">
          <Label htmlFor="connection-token">Token</Label>
          <Input
            id="connection-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="MINI_CLOUD_TOKEN"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Stored in this browser, where any script on this page could read it. On a shared machine, leave “Stay connected” off so it ends with the tab.
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox id="connection-remember" checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
        <Label htmlFor="connection-remember" className="font-normal text-muted-foreground">
          Stay connected on this browser
        </Label>
      </div>

      {failure === undefined ? null : (
        <div className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{failure}</p>
        </div>
      )}

      <Button type="submit" disabled={!valid || busy} className="w-full">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
        {busy ? 'Checking…' : (props.submitLabel ?? 'Connect')}
      </Button>
    </form>
  );
}
