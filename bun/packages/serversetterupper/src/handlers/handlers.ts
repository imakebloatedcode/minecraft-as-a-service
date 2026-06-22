import type { ZodMiniOptional } from "zod/mini";
import type {
  ProxyServerConfiguration,
  GameServerConfiguration,
} from "../configuration/index";
import { all } from "@mcman/deepmerge";
import type { SomeType } from "zod/v4/core";
import { z } from "zod/mini";

export type Primitive =
  | string
  | number
  | boolean
  | Primitive[]
  | undefined
  | null;
export type PrimitiveDiscriminator = {
  handles: Primitive[];
};

export interface Handler<V extends "game" | "proxy" = "game" | "proxy"> {
  type: "game" | "proxy";
  handles: (string[] | [...string[], PrimitiveDiscriminator])[]; // This is an array of recursive keys. ["some", "thing"] is the same as obj.some.thing. All items under those keys are considered "handled"
  items: {
    outputFormat: (value: any) => string; // An error is thrown if this is not equal to any other output formats for the same file
    handler: (
      data: V extends "game"
        ? GameServerConfiguration
        : ProxyServerConfiguration,
    ) => Record<string, unknown> | unknown[]; // The output is merged with all of the other handlers for this file
    path: string[]; // These are the path segments to where the file should be relative to all other configurations. ..s are not evaluated, and are put into the path literally.
  }[];
}

export function primitiveDeepEqual(x: Primitive, y: Primitive): boolean {
  if (Array.isArray(x)) {
    if (!Array.isArray(y)) {
      return false;
    }
    if (x.length !== y.length) {
      return false;
    }
    return x.every((v, i) => primitiveDeepEqual(v, y[i]!));
  } else {
    return x === y;
  }
}
export type HandledMap = Map<
  string,
  HandledMap | true | PrimitiveDiscriminator
>;

export class HandlerGroup {
  #handledCache: HandledMap | undefined;
  readonly handlers: Handler[];
  constructor(handlers: Handler[]) {
    this.handlers = handlers;
  }
  #pathJoin(path: string[]) {
    return path.map((value) => btoa(value)).join("#");
  }
  #pathSplit(path: string) {
    return path.split("#").map((value) => atob(value));
  }
  getHandled(noCache: boolean = false) {
    if (this.#handledCache && !noCache) {
      return this.#handledCache;
    }
    // Get which items were handled
    const handled: HandledMap = new Map();
    for (const { handles } of this.handlers) {
      for (const tree of handles) {
        type HandledValues = HandledMap extends Map<any, infer V> ? V : never;
        let ref: HandledValues = handled as HandledValues;

        const hasPrimitiveDiscriminator =
          typeof tree[tree.length - 1] === "object";

        for (let index = 0; index < tree.length - 1; index++) {
          const entry = tree[index]!;

          if (typeof entry === "object") {
            throw new TypeError("Expected a string for this entry");
          }

          // The next to last item
          if (index === tree.length - 2) {
            if (hasPrimitiveDiscriminator) {
              if (ref instanceof Map) {
                const item = ref.get(entry);
                // It is PrimitiveDiscriminator because hasPrimitiveDiscriminator is true
                const newItem = tree[index + 1] as PrimitiveDiscriminator;
                if (item === true) {
                  // True covers all values, so don't mess with it
                } else if (item instanceof Map) {
                  throw new Error(
                    "Type conflict: one handler claims to handle an object, but another claims to handle one or more primitives",
                  );
                } else if (typeof item === "object") {
                  item.handles.push(...newItem.handles);
                } else {
                  // Item is undefined, so add it
                  ref.set(entry, { handles: newItem.handles.slice() });
                }
              } else if (ref === true) {
                // True covers all values, so don't mess with it
              } else {
                // We have a discriminator, which is a type mismatch
                throw new Error(
                  "Type conflict: one handler claims to handle one or more primitives, but another claims to handle an object",
                );
              }
              break;
            }
          }

          if (ref instanceof Map) {
            const item = ref.get(entry);
            if (item) {
              ref = item;
            } else {
              const newItem = new Map();
              ref.set(entry, newItem);
              ref = newItem;
            }
          } else if (ref === true) {
            // Break as true means all values are already accepted
            break;
          } else {
            // We have a primitive handles list, but this handler has a string entry, indicating an expected object
            throw new Error(
              "Type conflict: one handler claims to handle one or more primitives, but another claims to handle an object",
            );
          }
        }
        if (!hasPrimitiveDiscriminator) {
          const entry = tree[tree.length - 1] as string; // Can only be string unless the array is empty
          if (ref instanceof Map) {
            ref.set(entry, true);
          } else if (ref === true) {
            // True covers all values, so don't mess with it
          } else {
            // We have a discriminator, which is a type mismatch
            throw new Error(
              "Type conflict: one handler claims that an item is a primitive, but another claims to handle a property of it",
            );
          }
        }
      }
    }
    if (!noCache) {
      this.#handledCache = handled;
    }
    return handled;
  }
  handle(data: GameServerConfiguration | ProxyServerConfiguration) {
    // Get file handlers
    const stringifyHandlers = new Map<
      string,
      Handler["items"][number]["outputFormat"]
    >();
    for (const handler of this.handlers.flatMap((v) => v.items)) {
      const path = this.#pathJoin(handler.path);
      if (stringifyHandlers.has(path)) {
        if (stringifyHandlers.get(path) !== handler.outputFormat) {
          throw new Error(
            "Got two different output file formats for the same file",
          );
        }
      } else {
        stringifyHandlers.set(path, handler.outputFormat);
      }
    }
    // Validate handling
    {
      const handled = this.getHandled();
      // Check if all items in the configuration were handled.
      function recurse(
        item: Record<string, unknown> | unknown[],
        ref: HandledMap,
        chain: string[] = [],
      ) {
        if (Array.isArray(item)) {
          // Pretend like arrays are simply their items
          for (const subItem of item) {
            recurse(subItem as Record<string, unknown> | unknown[], ref, chain);
          }
        } else {
          for (const key of Object.keys(item)) {
            // Hack: an empty object should be counted as not present
            if (
              typeof item[key] === "object" &&
              Object.entries(item[key]!).filter((v) => v[1] !== undefined)
                .length === 0
            ) {
              continue;
            }
            const fullChain = [...chain, key];
            const childRef = ref.get(key);
            if (childRef) {
              const childItem = item[key]!;
              if (childRef === true) {
                continue;
              } else if (childRef instanceof Map) {
                if (typeof childItem === "object") {
                  // Includes array on purpose
                  recurse(
                    childItem as Record<string, unknown>,
                    childRef,
                    fullChain,
                  );
                } else if (childItem === undefined) {
                  // Allow undefined as this property may be optional
                } else {
                  throw new Error(
                    `Expected object but got type ${Array.isArray(childItem) ? "array" : typeof childItem}`,
                  );
                }
              } else {
                // That means we expect primitives
                if (
                  childRef.handles.findIndex((value) =>
                    primitiveDeepEqual(value, childItem as Primitive),
                  ) === -1
                ) {
                  throw new Error(`Unhandled item ${fullChain.join(".")}`);
                }
              }
            } else {
              throw new Error(`Unhandled item ${fullChain.join(".")}`);
            }
          }
        }
      }
      recurse(data as unknown as Record<string, unknown>, handled);
    }
    // Generate files
    const fileData = new Map<string, (Record<string, unknown> | unknown[])[]>();
    for (const handler of this.handlers.flatMap((v) => v.items)) {
      const path = this.#pathJoin(handler.path);
      if (!fileData.has(path)) {
        fileData.set(path, []);
      }
      const outputs = fileData.get(path)!;
      outputs.push(handler.handler(data));
    }
    // Output files
    const output = new Map<string[], string>();
    for (const [filePath, dataItems] of fileData.entries()) {
      const handler = stringifyHandlers.get(filePath)!;
      const merged = all<any>(dataItems);
      output.set(this.#pathSplit(filePath), handler(merged));
    }
    return output;
  }
}

export namespace MappingsZodInterop {
  type UsedZodTypes =
    | z.ZodMiniObject
    | z.ZodMiniString
    | z.ZodMiniNumber
    | z.ZodMiniBoolean
    | z.ZodMiniArray<UsedZodTypes>
    | z.ZodMiniTuple<UsedZodTypes[]>
    | z.ZodMiniUnion
    | z.ZodMiniObject;
  //| ZodMiniOptional<UsedZodTypes>;
  function primitiveToZod(primitive: Primitive): SomeType {
    if (Array.isArray(primitive)) {
      return z.tuple(
        primitive.map((value) => primitiveToZod(value)) as [
          SomeType,
          ...SomeType[],
        ],
      );
    } else {
      return z.literal(primitive);
    }
  }
  export function combineMappings(
    def: UsedZodTypes | ZodMiniOptional,
    map: HandledMap extends Map<unknown, infer T> ? T : never,
  ): SomeType {
    if (map === true) {
      return def;
    } else if (map instanceof Map) {
      const definition = def._zod.def;
      if (definition.type === "object") {
        const relevantOptions: Record<string, SomeType> = {};
        for (const [key, value] of Object.entries(definition.shape)) {
          const childMap = map.get(key);
          if (childMap === undefined) {
            if (value._zod.def.type === "optional") {
              continue;
            }
            throw new Error(`Unknown key ${key}`);
          }
          // Unsafe
          const newValue = combineMappings(value as UsedZodTypes, childMap);
          relevantOptions[key] = newValue;
        }
        return z.object(relevantOptions);
      } else if (definition.type === "optional") {
        return combineMappings(definition.innerType as UsedZodTypes, map);
      } else if (definition.type === "union") {
        return z.union(
          definition.options.map((value) =>
            combineMappings(value as UsedZodTypes, map),
          ),
        );
      } else if (definition.type === "array") {
        return z.array(combineMappings(definition.element, map));
      } else {
        throw new Error(
          `Zod/support map mismatch: Support map declares an object is expected, but zod claims to have an ${definition.type}`,
        );
      }
    } else {
      const { handles } = map;
      if (handles.length === 1) {
        const item = handles[0]!;
        return z._default(primitiveToZod(item), item);
      } else {
        return z.union(handles.map((value) => primitiveToZod(value)));
      }
    }
  }
}
