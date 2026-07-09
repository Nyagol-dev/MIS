import { ChangedField } from './types';

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function computeChangedFields(
  oldData: Record<string, unknown> | null | undefined,
  newData: Record<string, unknown> | null | undefined
): ChangedField[] {
  const oldObj = oldData || {};
  const newObj = newData || {};

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const changed: ChangedField[] = [];

  for (const key of allKeys) {
    const fromVal = oldObj[key];
    const toVal = newObj[key];

    if (!isEqual(fromVal, toVal)) {
      changed.push({
        field: key,
        from: fromVal,
        to: toVal,
      });
    }
  }

  return changed;
}

export function resolveTemplatePlaceholders(
  template: Record<string, unknown>,
  sourceData: Record<string, unknown>
): Record<string, unknown> {
  return resolveValue(template, sourceData) as Record<string, unknown>;
}

function resolveValue(value: unknown, sourceData: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exactMatch = value.match(/^\{\{([^}]+)\}\}$/);
    if (exactMatch) {
      const key = exactMatch[1].trim();
      if (key in sourceData) {
        return sourceData[key];
      }
      return value;
    }

    return value.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      if (trimmedKey in sourceData) {
        const val = sourceData[trimmedKey];
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val);
        }
        return String(val);
      }
      return match;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, sourceData));
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = resolveValue((value as Record<string, unknown>)[key], sourceData);
    }
    return result;
  }

  return value;
}
