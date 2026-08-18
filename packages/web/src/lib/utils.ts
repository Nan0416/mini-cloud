import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, letting a caller's utility win over a component's default.
 * `clsx` alone would emit both `px-2` and `px-4` and leave the winner to CSS source
 * order, which is not something a caller can reason about.
 */
export function cn(...inputs: ReadonlyArray<ClassValue>): string {
  return twMerge(clsx(inputs));
}
