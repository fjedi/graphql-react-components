import isEqualWith from 'lodash/isEqualWith';
import isEqual from 'lodash/isEqual';
import uniq from 'lodash/uniq';
import get from 'lodash/get';

const ValidIdTypes = ['string', 'number'];
export function compareIds(id1: unknown, id2: unknown): boolean {
  //
  if (!ValidIdTypes.includes(typeof id1) || !ValidIdTypes.includes(typeof id2)) {
    return false;
  }
  return `${id1}` === `${id2}`;
}

export function compareValues(a: unknown, b: unknown): boolean {
  if (!a && !b) {
    return true;
  }
  if ((!a && b) || (a && !b)) {
    return false;
  }
  const aIsEmptyObject = !!a && typeof a === 'object' && Object.keys(a).length === 0;
  const bIsEmptyObject = !!b && typeof b === 'object' && Object.keys(b).length === 0;
  if (aIsEmptyObject || bIsEmptyObject) {
    return aIsEmptyObject === bIsEmptyObject;
  }
  return isEqualWith(a, b, () =>
    // @ts-ignore
    uniq(Object.keys(a).concat(Object.keys(b))).every((field) => {
      const value = get(a, field);
      const newValue = get(b, field);
      if (typeof value !== 'object' || !value) {
        return isEqual(value, newValue);
      }
      return compareValues(value, newValue);
    }),
  );
}
