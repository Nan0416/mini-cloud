import { Plus, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface KeyValuePair {
  readonly key: string;
  readonly value: string;
}

export interface KeyValueEditorProps {
  readonly pairs: ReadonlyArray<KeyValuePair>;
  readonly onChange: (pairs: ReadonlyArray<KeyValuePair>) => void;
  readonly keyPlaceholder?: string;
  readonly valuePlaceholder?: string;
  readonly addLabel?: string;
  readonly emptyMessage?: string;
  readonly disabled?: boolean;
}

/**
 * Replaces the legacy TagEditor for environment and replacement variables.
 *
 * Rows are held as an ordered array rather than as an object, because an object
 * cannot represent a half-typed key: editing `PATH` to `PATHS` one keystroke at a
 * time would otherwise create and destroy a key on every character and lose focus.
 */
export function KeyValueEditor(props: KeyValueEditorProps) {
  const { pairs, onChange } = props;

  const update = useCallback(
    (index: number, patch: Partial<KeyValuePair>): void => {
      onChange(pairs.map((pair, position) => (position === index ? { ...pair, ...patch } : pair)));
    },
    [pairs, onChange],
  );

  const remove = useCallback(
    (index: number): void => {
      onChange(pairs.filter((_pair, position) => position !== index));
    },
    [pairs, onChange],
  );

  const duplicateKeys = new Set(pairs.map((pair) => pair.key.trim()).filter((key, index, all) => key.length > 0 && all.indexOf(key) !== index));

  return (
    <div className="space-y-2">
      {pairs.length === 0 ? <p className="text-sm text-muted-foreground">{props.emptyMessage ?? 'None set.'}</p> : null}

      {pairs.map((pair, index) => {
        const duplicate = duplicateKeys.has(pair.key.trim());
        return (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Input
                value={pair.key}
                disabled={props.disabled}
                aria-label={`Key ${index + 1}`}
                placeholder={props.keyPlaceholder ?? 'KEY'}
                onChange={(event) => update(index, { key: event.target.value })}
                className={duplicate ? 'border-destructive font-mono' : 'font-mono'}
              />
              {duplicate ? <p className="text-xs text-destructive">Duplicate key — only the last one is kept.</p> : null}
            </div>
            <Input
              value={pair.value}
              disabled={props.disabled}
              aria-label={`Value ${index + 1}`}
              placeholder={props.valuePlaceholder ?? 'value'}
              onChange={(event) => update(index, { value: event.target.value })}
              className="flex-1 font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={props.disabled}
              onClick={() => remove(index)}
              aria-label={`Remove ${pair.key.length > 0 ? pair.key : `row ${index + 1}`}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={() => onChange([...pairs, { key: '', value: '' }])}>
        <Plus className="size-4" />
        {props.addLabel ?? 'Add'}
      </Button>
    </div>
  );
}

/** Drops blank rows and lets a later duplicate win, matching object-literal semantics. */
export function pairsToRecord(pairs: ReadonlyArray<KeyValuePair>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key.length > 0) {
      record[key] = pair.value;
    }
  }
  return record;
}

export function recordToPairs(record: Readonly<Record<string, string>> | undefined): ReadonlyArray<KeyValuePair> {
  if (record === undefined) {
    return [];
  }
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}
