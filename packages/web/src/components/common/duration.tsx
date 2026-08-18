import { NA, formatDuration } from '@/lib/format';

export function DurationText(props: { readonly ms?: number }) {
  if (props.ms === undefined || !Number.isFinite(props.ms)) {
    return <span className="text-muted-foreground">{NA}</span>;
  }
  return (
    <span className="tabular whitespace-nowrap" title={`${props.ms} ms`}>
      {formatDuration(props.ms)}
    </span>
  );
}
