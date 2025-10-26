import { Dimension, Dimensions } from '../../models';

export function convertDimensionsToDimensionArray(dimensions?: ReadonlyArray<Dimension> | Dimensions): Dimension[] {
  if (dimensions === undefined) {
    return [];
  } else if (Array.isArray(dimensions)) {
    return dimensions;
  } else {
    return Object.entries(dimensions).map((pair) => ({
      key: pair[0],
      value: pair[1],
    }));
  }
}

export function sortDimensions(dimensions: ReadonlyArray<Dimension>): Dimension[] {
  const dims: Dimension[] = Array.from(dimensions);
  dims.sort((d1, d2) => {
    if (d1.key !== d2.key) {
      return d1.key.localeCompare(d2.key);
    } else {
      return d1.value.localeCompare(d2.value);
    }
  });
  return dims;
}

export function deduplicateDimensions(dimensions: ReadonlyArray<Dimension>): Dimension[] {
  const _dims = sortDimensions(dimensions);
  const results: Dimension[] = [];
  for (let i = 0; i < _dims.length; i++) {
    if (results.length > 0 && results[results.length - 1].key === _dims[i].key && results[results.length - 1].value === _dims[i].value) {
      // skip
    } else {
      results.push(_dims[i]);
    }
  }

  return results;
}
