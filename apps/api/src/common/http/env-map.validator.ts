import { registerDecorator, type ValidationOptions } from 'class-validator';

export const ENV_KEY = /^[A-Z_][A-Z0-9_]{0,63}$/;
export const ENV_MAX_ENTRIES = 200;
export const ENV_MAX_VALUE_BYTES = 32 * 1024;

/** Why an environment map is refused, or null when it is fine. */
export function envMapProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'must be an object of NAME: "value" pairs';
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > ENV_MAX_ENTRIES) return `may hold at most ${ENV_MAX_ENTRIES} variables`;
  for (const [k, val] of entries) {
    if (!ENV_KEY.test(k)) return `has an invalid variable name "${k.slice(0, 70)}" (upper case letters, digits and _, not starting with a digit, at most 64 characters)`;
    if (typeof val !== 'string') return `value of ${k} must be a string`;
    if (Buffer.byteLength(val, 'utf8') > ENV_MAX_VALUE_BYTES) return `value of ${k} is larger than 32 KB`;
  }
  return null;
}

/** Environment variables for apps and Git deploys: names ^[A-Z_][A-Z0-9_]{0,63}$, string values up to 32 KB, at most 200. */
export function IsEnvMap(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isEnvMap',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (v: unknown) => envMapProblem(v) === null,
        defaultMessage: (a) => `${a?.property} ${envMapProblem(a?.value) ?? 'is invalid'}`,
      },
    });
}
