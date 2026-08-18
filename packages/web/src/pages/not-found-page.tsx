import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { urls } from '@/lib/urls';

export function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
        <div className="space-y-1">
          <p className="font-medium">No page at this address</p>
          <p className="font-mono text-sm text-muted-foreground">{pathname}</p>
        </div>
        <Button asChild variant="outline">
          <Link to={urls.overview()}>Back to the overview</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
