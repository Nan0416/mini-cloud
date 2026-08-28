import { Cloud, Menu, RefreshCw } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ConnectionControl } from './connection-control';
import { ThemeToggle } from './theme-toggle';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { urls } from '@/lib/urls';
import { cn } from '@/lib/utils';

export function TopBar(props: { readonly onOpenNav: () => void }) {
  const client = useQueryClient();
  // Everything on screen is polled, so one global refresh is more useful than a
  // button per panel — and the spin doubles as the indicator that polling is alive.
  const fetching = useIsFetching() > 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={props.onOpenNav} aria-label="Open navigation">
        <Menu className="size-4" />
      </Button>

      <Link to={urls.overview()} className="flex items-center gap-2 rounded font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Cloud className="size-5 text-primary" />
        <span>mini-cloud</span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <ConnectionControl />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => client.invalidateQueries()} aria-label="Refresh all data">
              <RefreshCw className={cn('size-4', fetching && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh everything</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </header>
  );
}
