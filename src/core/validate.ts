/**
 * Hand-rolled runtime validators that narrow `unknown` JSON to typed data and
 * throw errors with a readable path (ADR-0001), e.g.
 *   data/levels/slice01.json > rooms[2] > pieces[3] > kit: unknown value "corrdor_straight"
 */
export class ValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
    this.path = path;
  }
}

export type Validator<T> = (value: unknown, path: string) => T;

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return `string "${v.length > 40 ? v.slice(0, 40) + '...' : v}"`;
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const str: Validator<string> = (v, p) => {
  if (typeof v !== 'string') throw new ValidationError(p, `expected string, got ${describe(v)}`);
  return v;
};

export const num: Validator<number> = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(p, `expected finite number, got ${describe(v)}`);
  }
  return v;
};

export const bool: Validator<boolean> = (v, p) => {
  if (typeof v !== 'boolean') throw new ValidationError(p, `expected boolean, got ${describe(v)}`);
  return v;
};

export function numRange(min: number, max: number): Validator<number> {
  return (v, p) => {
    const n = num(v, p);
    if (n < min || n > max) throw new ValidationError(p, `expected ${min}..${max}, got ${n}`);
    return n;
  };
}

export function oneOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return (v, p) => {
    const s = str(v, p);
    if (!(values as readonly string[]).includes(s)) {
      throw new ValidationError(p, `unknown value "${s}", expected one of: ${values.join(', ')}`);
    }
    return s as T[number];
  };
}

export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (v, p) => (v === null ? null : inner(v, p));
}

/** A JSON scalar: string, finite number or boolean. */
export const scalar: Validator<string | number | boolean> = (v, p) => {
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return num(v, p);
};

export function arr<T>(item: Validator<T>): Validator<T[]> {
  return (v, p) => {
    if (!Array.isArray(v)) throw new ValidationError(p, `expected array, got ${describe(v)}`);
    return v.map((x, i) => item(x, `${p}[${i}]`));
  };
}

export function tuple3(item: Validator<number> = num): Validator<[number, number, number]> {
  return (v, p) => {
    if (!Array.isArray(v) || v.length !== 3) {
      throw new ValidationError(p, `expected [x, y, z], got ${describe(v)}`);
    }
    return [item(v[0], `${p}[0]`), item(v[1], `${p}[1]`), item(v[2], `${p}[2]`)];
  };
}

export const vec3 = tuple3();

export function record<T>(value: Validator<T>): Validator<Record<string, T>> {
  return (v, p) => {
    if (!isPlainObject(v)) throw new ValidationError(p, `expected object, got ${describe(v)}`);
    const out: Record<string, T> = {};
    for (const [k, x] of Object.entries(v)) out[k] = value(x, `${p} > ${k}`);
    return out;
  };
}

/** Marks a field optional inside `obj`. */
export interface Optional<T> {
  readonly optional: true;
  readonly validator: Validator<T>;
}

export function optional<T>(validator: Validator<T>): Optional<T> {
  return { optional: true, validator };
}

type Field = Validator<unknown> | Optional<unknown>;
type Shape = Record<string, Field>;
type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? never : K }[keyof S];
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? K : never }[keyof S];
type FieldType<F> = F extends Optional<infer T> ? T : F extends Validator<infer T> ? T : never;
export type Infer<S extends Shape> = { [K in RequiredKeys<S>]: FieldType<S[K]> } & {
  [K in OptionalKeys<S>]?: FieldType<S[K]>;
};

/**
 * Object validator. Unknown keys are errors, so typos like "fogDensty" fail loudly.
 */
export function obj<S extends Shape>(shape: S): Validator<Infer<S>> {
  return (v, p) => {
    if (!isPlainObject(v)) throw new ValidationError(p, `expected object, got ${describe(v)}`);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v)) {
      if (!(key in shape)) {
        throw new ValidationError(`${p} > ${key}`, `unknown field (allowed: ${Object.keys(shape).join(', ')})`);
      }
    }
    for (const [key, field] of Object.entries(shape)) {
      const path = `${p} > ${key}`;
      const isOptional = typeof field === 'object';
      if (!(key in v) || v[key] === undefined) {
        if (isOptional) continue;
        throw new ValidationError(path, 'missing required field');
      }
      out[key] = isOptional ? field.validator(v[key], path) : field(v[key], path);
    }
    return out as Infer<S>;
  };
}

/** Run a validator against data from a named source (usually a file path). */
export function validate<T>(validator: Validator<T>, value: unknown, source: string): T {
  return validator(value, source);
}
