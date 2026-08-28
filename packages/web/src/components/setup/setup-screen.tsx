import { Cloud } from 'lucide-react';
import { ConnectionForm } from './connection-form';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConnection } from '@/hooks/use-connection';

/**
 * What a visitor sees before the console knows where their service is.
 *
 * This copy carries the whole explanation of what the page is, because for a hosted
 * build it is the first and possibly only thing anyone reads. It says what the page
 * does with the address — talks to it from this browser, sends it nowhere — since
 * asking a stranger to point a page at the control plane of their own machines is
 * only reasonable if the page says what it is going to do.
 */
export function SetupScreen() {
  const { connect } = useConnection();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center px-4">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Cloud className="size-5 text-primary" />
          <span>mini-cloud</span>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Connect to your mini-cloud</CardTitle>
            <CardDescription>
              This console is a static page. It holds no data and knows nothing about your fleet until you tell it where your control plane is — then it talks to that address
              directly from this browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ConnectionForm onConnect={connect} />

            <div className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Reachable over HTTPS?</span> Any address with a certificate works, from any device — including a phone. Your service
                needs
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">MINI_CLOUD_CORS_ORIGINS={window.location.origin}</code>
                so its browser checks let this page through.
              </p>
              <p>
                <span className="font-medium text-foreground">Plain http:// address?</span> Only <code className="rounded bg-muted px-1 py-0.5 font-mono">localhost</code> or{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">127.0.0.1</code> on the machine running this browser — a LAN address is blocked from an HTTPS page, Safari
                refuses loopback entirely, and Chrome will ask your permission first. To use one of those, serve this console from the same machine as your service instead.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
