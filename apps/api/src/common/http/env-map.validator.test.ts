import { describe, expect, it } from 'vitest';
import { envMapProblem } from './env-map.validator';

describe('environment map validation', () => {
  it('accepts upper case names with string values', () => {
    expect(envMapProblem({ GREETING: 'hi', _X1: '' })).toBeNull();
  });
  it('refuses bad names, non strings, large values and too many entries', () => {
    expect(envMapProblem({ greeting: 'hi' })).toMatch(/invalid variable name/);
    expect(envMapProblem({ '1A': 'x' })).toMatch(/invalid variable name/);
    expect(envMapProblem({ ['A'.repeat(65)]: 'x' })).toMatch(/invalid variable name/);
    expect(envMapProblem({ A: 1 })).toMatch(/must be a string/);
    expect(envMapProblem({ A: 'x'.repeat(32 * 1024 + 1) })).toMatch(/32 KB/);
    expect(envMapProblem(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`V${i}`, 'x'])))).toMatch(/200/);
    expect(envMapProblem(['A'])).toMatch(/object/);
  });
});
