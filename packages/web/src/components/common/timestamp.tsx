import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NA, formatRelative, formatTimestamp, formatTimestampShort } from '@/lib/format';

export interface TimestampProps {
  readonly value?: number;
  /** Short form for table cells; long form for summaries. */
  readonly variant?: 'short' | 'long' | 'relative';
}

/**
 * A timestamp that reads as both. The cell shows whichever form fits, and the
 * tooltip always carries the other two, so "5 minutes ago" never costs you the
 * absolute time you needed for a log search.
 */
export function Timestamp(props: TimestampProps) {
  if (props.value === undefined || !Number.isFinite(props.value)) {
    return <span className="text-muted-foreground">{NA}</span>;
  }

  const variant = props.variant ?? 'short';
  const display = variant === 'relative' ? formatRelative(props.value) : variant === 'long' ? formatTimestamp(props.value) : formatTimestampShort(props.value);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tabular whitespace-nowrap">{display}</span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          <p className="tabular">{formatTimestamp(props.value)}</p>
          <p className="text-muted-foreground">{formatRelative(props.value)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
