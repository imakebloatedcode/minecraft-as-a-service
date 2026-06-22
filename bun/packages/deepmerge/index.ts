import defaultIsMergeableObject from "./is-mergeable-object";

export interface Options {
  arrayMerge?(target: any[], source: any[], options?: ArrayMergeOptions): any[];
  clone?: boolean;
  customMerge?: (
    key: string | number | symbol,
    options?: FullOptions,
  ) => ((x: any, y: any) => any) | undefined;
  isMergeableObject?(value: object): boolean;
}

export interface FullOptions {
  arrayMerge<T>(target: T[], source: T[], options?: ArrayMergeOptions): T[];
  clone: boolean;
  customMerge?: (
    key: string | number | symbol,
    options?: FullOptions,
  ) => ((x: any, y: any) => any) | undefined;
  isMergeableObject(value: object): boolean;
  cloneUnlessOtherwiseSpecified: typeof cloneUnlessOtherwiseSpecified;
}

export interface ArrayMergeOptions {
  isMergeableObject(value: object): boolean;
  cloneUnlessOtherwiseSpecified(value: object, options?: Options): object;
}

function emptyTarget<T extends object | unknown[]>(
  val: T,
): T extends unknown[] ? [] : {} {
  // @ts-ignore
  return Array.isArray(val) ? [] : {};
}

function cloneUnlessOtherwiseSpecified<T extends object | unknown[]>(
  value: T,
  options: FullOptions,
): T {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(emptyTarget(value), value as any, options)
    : value;
}

function defaultArrayMerge<T extends object | unknown[]>(
  target: T[],
  source: T[],
  options: FullOptions,
): T[] {
  return target.concat(source).map(function (element) {
    return cloneUnlessOtherwiseSpecified(element, options);
  });
}

function getMergeFunction(key: string | number | symbol, options: FullOptions) {
  if (!options.customMerge) {
    return deepmerge;
  }
  const customMerge = options.customMerge(key);
  return typeof customMerge === "function" ? customMerge : deepmerge;
}

// Typescript does not differentiate between symbols, so no need to use keyof
function getEnumerableOwnPropertySymbols(target: object): symbol[] {
  return Object.getOwnPropertySymbols
    ? Object.getOwnPropertySymbols(target).filter(function (symbol) {
        return Object.propertyIsEnumerable.call(target, symbol);
      })
    : [];
}

function getKeys<T extends object>(target: T): (keyof T)[] {
  return (Object.keys(target) as (string | number | symbol)[]).concat(
    getEnumerableOwnPropertySymbols(target),
  ) as never;
}

function propertyIsOnObject(
  object: unknown,
  property: string | number | symbol,
) {
  try {
    // @ts-ignore
    return property in object;
  } catch (_) {
    return false;
  }
}

// Protects from prototype poisoning and unexpected merging up the prototype chain.
function propertyIsUnsafe(target: unknown, key: string | number | symbol) {
  return (
    propertyIsOnObject(target, key) && // Properties are safe to merge if they don't exist in the target yet,
    !(
      Object.hasOwnProperty.call(target, key) && // unsafe if they exist up the prototype chain,
      Object.propertyIsEnumerable.call(target, key)
    )
  ); // and also unsafe if they're nonenumerable.
}

function mergeObject<T>(
  target: Partial<T>,
  source: Partial<T>,
  options: FullOptions,
) {
  const destination: Partial<T> = {};
  if (options.isMergeableObject(target)) {
    getKeys(target).forEach(function (key) {
      destination[key] = cloneUnlessOtherwiseSpecified(target[key]!, options);
    });
  }
  getKeys(source).forEach(function (key) {
    if (propertyIsUnsafe(target, key)) {
      return;
    }

    if (
      propertyIsOnObject(target, key) &&
      options.isMergeableObject(source[key]!)
    ) {
      destination[key] = getMergeFunction(key, options)(
        target[key],
        source[key],
        options,
      );
    } else {
      destination[key] = cloneUnlessOtherwiseSpecified(source[key]!, options);
    }
  });
  // All keys are now in the object, so cast to T
  return destination as T;
}

export default function deepmerge<T extends object | unknown[]>(
  target: T extends unknown[] ? T[number][] : Partial<T>,
  source: T extends unknown[] ? T[number][] : Partial<T>,
  options: Options = {},
): T {
  const fullOptions: FullOptions = {
    arrayMerge: defaultArrayMerge,
    isMergeableObject: defaultIsMergeableObject,
    clone: false,
    ...options,
    // cloneUnlessOtherwiseSpecified is added to `options` so that custom arrayMerge()
    // implementations can use it. The caller may not replace it.
    cloneUnlessOtherwiseSpecified,
  };

  const sourceIsArray = Array.isArray(source);
  const targetIsArray = Array.isArray(target);
  const sourceAndTargetTypesMatch = sourceIsArray === targetIsArray;

  if (!sourceAndTargetTypesMatch) {
    return cloneUnlessOtherwiseSpecified(source as unknown as T, fullOptions);
  } else if (sourceIsArray) {
    return fullOptions.arrayMerge(
      target as unknown[],
      source as unknown[],
      fullOptions,
    ) as T;
  } else {
    return mergeObject(target as object, source as object, fullOptions);
  }
}

export function all<T>(objects: Partial<T>[], options?: Options): T {
  if (!Array.isArray(objects)) {
    throw new Error("first argument should be an array");
  }

  return objects.reduce(function (prev, next) {
    return deepmerge(prev, next, options);
  }, {}) as unknown as T;
}
