import { useCallback, useState, type RefCallback } from 'react';

export type ElementWidth<T extends Element> = readonly [RefCallback<T>, number];

/**
 * The rendered width of an element in CSS pixels, kept current as it resizes.
 *
 * A callback ref rather than an effect on a ref object, so it follows the element
 * itself: one that mounts late, after its data loads, is measured all the same.
 */
export function useElementWidth<T extends Element>(): ElementWidth<T> {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: T | null) => {
    // React 19 runs the cleanup below instead of calling this with null; the branch is
    // here because the type allows a null, not as somewhere to put teardown.
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      // Whole pixels, so a sub-pixel wobble does not re-render the chart.
      setWidth(Math.round(entries[entries.length - 1].contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
