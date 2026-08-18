import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingRows } from './states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (item: T) => ReactNode;
  /** Supply to make the column sortable. */
  readonly compare?: (left: T, right: T) => number;
  readonly className?: string;
  readonly headerClassName?: string;
}

export interface DataTableProps<T> {
  readonly columns: ReadonlyArray<Column<T>>;
  readonly items?: ReadonlyArray<T>;
  readonly rowKey: (item: T) => string;
  readonly isLoading?: boolean;
  readonly error?: unknown;
  readonly onRetry?: () => void;

  /** Free-text filter. Comma-separated terms match if *any* of them matches. */
  readonly search?: (term: string, item: T) => boolean;
  readonly searchPlaceholder?: string;

  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: ReactNode;

  /** Omit to show every row without pagination. */
  readonly pageSize?: number;
  readonly initialSort?: { readonly columnId: string; readonly direction: 'asc' | 'desc' };
  readonly onRowClick?: (item: T) => void;
  readonly toolbar?: ReactNode;
}

interface SortState {
  readonly columnId: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * The one table in the console.
 *
 * Filtering splits on commas and ORs the terms, which is the behaviour the legacy
 * console had and the reason `running, exit_failure` is a useful thing to type into
 * an instance list.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const { items, columns, search } = props;
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<SortState | undefined>(props.initialSort);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const all = items ?? [];
    if (search === undefined) {
      return all;
    }
    const terms = term
      .toLowerCase()
      .split(',')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (terms.length === 0) {
      return all;
    }
    return all.filter((item) => terms.some((segment) => search(segment, item)));
  }, [items, search, term]);

  const sorted = useMemo(() => {
    if (sort === undefined) {
      return filtered;
    }
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (column?.compare === undefined) {
      return filtered;
    }
    const compare = column.compare;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => compare(left, right) * direction);
  }, [filtered, sort, columns]);

  const pageSize = props.pageSize;
  const pageCount = pageSize === undefined ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  // Clamped rather than reset: deleting the last row of page three should land you on
  // page two, not back at the top of the list.
  const currentPage = Math.min(page, pageCount - 1);
  const visible = pageSize === undefined ? sorted : sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const toggleSort = (columnId: string): void => {
    setSort((previous) => {
      if (previous?.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }
      return { columnId, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  const hasAnyItems = (items ?? []).length > 0;
  const showToolbar = (search !== undefined && (hasAnyItems || term.length > 0)) || props.toolbar !== undefined;

  return (
    <div className="space-y-0">
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {search === undefined ? null : (
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setPage(0);
                }}
                placeholder={props.searchPlaceholder ?? 'Filter… (comma-separated)'}
                className="h-8 pl-8"
              />
            </div>
          )}
          {props.toolbar}
        </div>
      ) : null}

      {props.error !== undefined && props.error !== null ? (
        <ErrorState error={props.error} onRetry={props.onRetry} />
      ) : props.isLoading === true ? (
        <LoadingRows />
      ) : sorted.length === 0 ? (
        <EmptyState title={props.emptyTitle ?? 'Nothing here yet'} description={props.emptyDescription} action={props.emptyAction} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => {
                const sortable = column.compare !== undefined;
                const active = sort?.columnId === column.id;
                return (
                  <TableHead key={column.id} className={column.headerClassName}>
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        // `uppercase` is repeated from the `th` on purpose: a
                        // button does not inherit text-transform, so without it the
                        // sortable headers render in sentence case and the rest in
                        // caps.
                        className="inline-flex items-center gap-1 rounded uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {column.header}
                        {active ? sort.direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => (
              <TableRow
                key={props.rowKey(item)}
                onClick={props.onRowClick === undefined ? undefined : () => props.onRowClick?.(item)}
                className={cn(props.onRowClick !== undefined && 'cursor-pointer')}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} className={column.className}>
                    {column.cell(item)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pageSize !== undefined && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
          <span className="tabular">
            {currentPage * pageSize + 1}–{Math.min(sorted.length, (currentPage + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
