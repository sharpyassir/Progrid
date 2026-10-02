import Ajv, { type ValidateFunction } from 'ajv';

/**
 * JSON Schema checks (ajv) for tool configs, tool inputs from the model and structured
 * outputs. Compiled validators are cached by schema text.
 */
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const cache = new Map<string, ValidateFunction>();

export function validator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let v = cache.get(key);
  if (!v) {
    v = ajv.compile(schema);
    if (cache.size > 2000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Null when the value matches, otherwise a short readable list of problems. */
export function schemaErrors(schema: Record<string, unknown>, value: unknown): string | null {
  let v: ValidateFunction;
  try {
    v = validator(schema);
  } catch (err) {
    return `the schema itself is invalid: ${(err as Error).message}`;
  }
  if (v(value)) return null;
  return (v.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}`).join('; ');
}

/** True when ajv can compile the schema. */
export function isValidSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'must be a JSON Schema object';
  try {
    ajv.compile(schema as Record<string, unknown>);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const UNSUPPORTED_STRICT = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'patternProperties', 'not', 'if', 'then', 'else', 'oneOf'];

/**
 * True when the schema qualifies for strict tool use: every object sets additionalProperties
 * false and lists required, and no keyword outside what strict mode supports is used.
 */
export function isStrictCompatible(schema: unknown, depth = 0): boolean {
  if (depth > 20 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const s = schema as Record<string, unknown>;
  if (UNSUPPORTED_STRICT.some((k) => k in s)) return false;
  const type = s.type;
  const isObject = type === 'object' || (type === undefined && 'properties' in s);
  if (isObject) {
    if (s.additionalProperties !== false || !Array.isArray(s.required)) return false;
    for (const p of Object.values((s.properties ?? {}) as Record<string, unknown>)) if (!isStrictCompatible(p, depth + 1)) return false;
  }
  if (type === 'array' && s.items !== undefined && !isStrictCompatible(s.items, depth + 1)) return false;
  for (const k of ['anyOf', 'allOf'] as const) if (Array.isArray(s[k]) && !(s[k] as unknown[]).every((x) => isStrictCompatible(x, depth + 1))) return false;
  if (type === undefined && !isObject && !('enum' in s) && !('const' in s) && !('anyOf' in s) && !('allOf' in s)) return false;
  return true;
}
