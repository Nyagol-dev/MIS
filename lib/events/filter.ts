import { MutationEvent } from './types';

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function matchesEventFilter(
  filter: Record<string, unknown>,
  event: MutationEvent
): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  if ('field' in filter && typeof filter.field === 'string') {
    const filterField = filter.field;
    const changedField = event.changedFields.find(cf => cf.field === filterField);

    if (!changedField) {
      return false;
    }

    if ('from' in filter) {
      if (!isEqual(changedField.from, filter.from)) {
        return false;
      }
    }

    if ('to' in filter) {
      if (!isEqual(changedField.to, filter.to)) {
        return false;
      }
    }

    return true;
  }

  return true;
}
