import { createHash } from "node:crypto";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function assertJsonNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not permit NaN or Infinity");
  }
}

function canonicalizeInternal(
  value: unknown,
  stack: Set<object>,
): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);

    case "boolean":
      return value ? "true" : "false";

    case "number":
      assertJsonNumber(value);
      return JSON.stringify(value);

    case "undefined":
      throw new TypeError("Canonical JSON does not permit undefined");

    case "bigint":
      throw new TypeError("Canonical JSON does not permit bigint");

    case "function":
    case "symbol":
      throw new TypeError(`Canonical JSON does not permit ${typeof value}`);

    case "object": {
      if (stack.has(value)) {
        throw new TypeError("Canonical JSON does not permit circular references");
      }

      const proto = Object.getPrototypeOf(value);
      if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
        throw new TypeError("Canonical JSON requires plain objects and arrays");
      }
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Canonical JSON rejects symbol keys");
      const names = Object.getOwnPropertyNames(value);
      for (const name of names) {
        if (Array.isArray(value) && name === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError("Canonical JSON rejects hidden state and accessors");
      }
      if (Array.isArray(value) && (names.length !== value.length + 1 ||
          !Array.from({length: value.length}, (_, i) => Object.hasOwn(value, i)).every(Boolean))) {
        throw new TypeError("Canonical JSON requires dense arrays without extra properties");
      }
      stack.add(value);
      try {
        if (Array.isArray(value)) {
          const encoded = value.map((item) => canonicalizeInternal(item, stack));
          return `[${encoded.join(",")}]`;
        }

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const encoded: string[] = [];

        for (const key of keys) {
          const item = record[key];
          if (item === undefined) {
            throw new TypeError(`Canonical JSON does not permit undefined at key "${key}"`);
          }
          encoded.push(`${JSON.stringify(key)}:${canonicalizeInternal(item, stack)}`);
        }

        return `{${encoded.join(",")}}`;
      } finally {
        stack.delete(value);
      }
    }
  }

  throw new TypeError("Unsupported value in canonical JSON");
}

export function canonicalJson(value: unknown): string {
  return canonicalizeInternal(value, new Set<object>());
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
