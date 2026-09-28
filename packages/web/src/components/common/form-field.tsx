import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** A labelled control, with a hint under it, or an error in its place. */
export function FormField(props: {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
  readonly optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.htmlFor} className="flex items-center gap-1.5">
        {props.label}
        {props.optional === true ? <span className="text-xs font-normal text-muted-foreground">optional</span> : null}
      </Label>
      {props.children}
      {props.error !== undefined ? (
        <p className="text-xs text-destructive">{props.error}</p>
      ) : props.hint !== undefined ? (
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      ) : null}
    </div>
  );
}
