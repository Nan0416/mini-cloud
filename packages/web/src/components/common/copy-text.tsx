import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface CopyTextProps {
  readonly value: string;
  /** Shown instead of the value. Useful for truncating a long id. */
  readonly label?: string;
  readonly className?: string;
  readonly mono?: boolean;
}

/**
 * A value with a copy button. Ids and command lines are here to be pasted into a
 * terminal, and selecting text out of a table cell reliably is fiddly.
 */
export function CopyText(props: CopyTextProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1_400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context. Failing silently is better than an
      // error toast for something the user can still do by hand.
    }
  }, [props.value]);

  return (
    <span className={cn('group/copy inline-flex max-w-full items-center gap-1.5', props.className)}>
      <span className={cn('truncate', props.mono !== false && 'font-mono text-[0.8125rem]')} title={props.value}>
        {props.label ?? props.value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${props.value}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/copy:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
