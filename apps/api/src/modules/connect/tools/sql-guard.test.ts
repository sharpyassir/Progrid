import { describe, expect, it } from 'vitest';
import { checkMongo, checkSql, tokenizeSql } from './sql-guard';
import { isStrictCompatible, schemaErrors } from './schema';

const ro = { readOnly: true };

describe('SQL read only guard', () => {
  it.each([
    'SELECT * FROM orders WHERE id = $1',
    'select count(*) from public.orders;',
    "WITH recent AS (SELECT * FROM orders WHERE created_at > now() - interval '1 day') SELECT * FROM recent",
    'EXPLAIN SELECT 1',
    'SHOW TABLES',
    'SELECT replace(name, \'a\', \'b\'), o.update_count FROM orders o',
    "SELECT 'DELETE FROM users' AS text",
    'SELECT * FROM "Orders" ORDER BY id DESC',
  ])('allows %s', (sql) => {
    expect(checkSql(sql, ro)).toMatchObject({ ok: true });
  });

  it.each([
    ['INSERT INTO t VALUES (1)', /not a read/],
    ['UPDATE t SET a = 1', /not a read/],
    ['DELETE FROM t', /not a read/],
    ['DROP TABLE t', /not a read/],
    ['SELECT 1; DROP TABLE t', /one statement/],
    ['SELECT * FROM t; SELECT 2', /one statement/],
    ['WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', /DELETE is not allowed/],
    ['EXPLAIN ANALYZE DELETE FROM t', /not allowed/],
    ['SELECT * FROM t FOR UPDATE', /row locks|UPDATE/],
    ['SELECT * INTO new_t FROM t', /SELECT INTO/],
    ["SELECT pg_read_file('/etc/passwd')", /pg_read_file\(\) is not allowed/],
    ['SELECT pg_sleep(100)', /pg_sleep/],
    ['SET statement_timeout = 0', /not a read/],
    ['COPY t TO PROGRAM \'id\'', /not a read/],
    ['/*!50000 DROP TABLE t */ SELECT 1', /executable comments/],
    ["SELECT 'unterminated", /unclosed/],
  ])('refuses %s', (sql, reason) => {
    const r = checkSql(sql, ro);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it('allows writes when the connection is not read only', () => {
    expect(checkSql('UPDATE t SET a = 1 WHERE id = 2', { readOnly: false }).ok).toBe(true);
    expect(checkSql('UPDATE t SET a = 1; DROP TABLE t', { readOnly: false }).ok).toBe(false);
  });

  it('ignores keywords inside comments and strings', () => {
    expect(checkSql("SELECT 1 -- DROP TABLE t\n", ro).ok).toBe(true);
    expect(checkSql('SELECT /* delete */ 1', ro).ok).toBe(true);
    expect(checkSql("SELECT $$DROP TABLE t$$", ro).ok).toBe(true);
    expect(tokenizeSql("SELECT 'it''s'").map((t) => t.value)).toEqual(['SELECT', "it's"]);
  });

  describe('allowedTables', () => {
    const opts = { readOnly: true, allowedTables: ['orders', 'public.customers'] };
    it('extracts tables from FROM, JOIN and comma lists', () => {
      expect(checkSql('SELECT * FROM orders o JOIN public.customers c ON c.id = o.cid', opts)).toMatchObject({ ok: true, tables: ['orders', 'public.customers'] });
      expect(checkSql('SELECT * FROM public.orders', opts).ok).toBe(true);
    });
    it('refuses other tables, joins and subqueries over them', () => {
      expect(checkSql('SELECT * FROM users', opts)).toMatchObject({ ok: false, reason: expect.stringMatching(/users/) });
      expect(checkSql('SELECT * FROM orders JOIN payments p ON true', opts).reason).toMatch(/payments/);
      expect(checkSql('SELECT * FROM (SELECT * FROM secrets) s', opts).reason).toMatch(/secrets/);
      expect(checkSql('SELECT * FROM orders, users', opts).reason).toMatch(/users/);
      expect(checkSql('SELECT * FROM "Users"', opts).reason).toMatch(/users/);
    });
    it('allows CTE names and refuses catalogs and functions in FROM', () => {
      expect(checkSql('WITH big AS (SELECT * FROM orders) SELECT * FROM big', opts).ok).toBe(true);
      expect(checkSql('SELECT * FROM information_schema.tables', opts).reason).toMatch(/information_schema/);
      expect(checkSql('SELECT * FROM pg_catalog.pg_authid', opts).ok).toBe(false);
      expect(checkSql('SELECT * FROM generate_series(1, 10)', opts).reason).toMatch(/functions in FROM/);
    });
  });
});

describe('Mongo guard', () => {
  it('allows reads only', () => {
    expect(checkMongo({ operation: 'find', collection: 'orders', filter: { status: 'open' } }, ro).ok).toBe(true);
    expect(checkMongo({ operation: 'aggregate', collection: 'orders', pipeline: [{ $match: {} }, { $group: { _id: '$s' } }] }, ro).ok).toBe(true);
    expect(checkMongo({ operation: 'deleteMany', collection: 'orders' }, ro).reason).toMatch(/find, aggregate or countDocuments/);
  });

  it('refuses $out, $merge and server side JavaScript', () => {
    expect(checkMongo({ operation: 'aggregate', collection: 'o', pipeline: [{ $out: 'copy' }] }, ro).reason).toMatch(/\$out/);
    expect(checkMongo({ operation: 'aggregate', collection: 'o', pipeline: [{ $merge: { into: 'x' } }] }, ro).reason).toMatch(/\$merge/);
    expect(checkMongo({ operation: 'find', collection: 'o', filter: { $where: 'sleep(1000)' } }, ro).reason).toMatch(/\$where/);
    expect(checkMongo({ operation: 'aggregate', collection: 'o', pipeline: [{ $addFields: { x: { $function: { body: 'x', args: [], lang: 'js' } } } }] }, ro).reason).toMatch(/\$function/);
  });

  it('enforces allowedCollections including lookups', () => {
    const opts = { readOnly: true, allowedCollections: ['orders'] };
    expect(checkMongo({ operation: 'find', collection: 'orders' }, opts).ok).toBe(true);
    expect(checkMongo({ operation: 'find', collection: 'users' }, opts).reason).toMatch(/users/);
    expect(checkMongo({ operation: 'aggregate', collection: 'orders', pipeline: [{ $lookup: { from: 'users', localField: 'u', foreignField: '_id', as: 'u' } }] }, opts).reason).toMatch(/users/);
    expect(checkMongo({ operation: 'aggregate', collection: 'orders', pipeline: [{ $unionWith: 'payments' }] }, opts).reason).toMatch(/payments/);
  });
});

describe('JSON schema helpers', () => {
  it('validates tool input', () => {
    const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
    expect(schemaErrors(schema, { n: 1 })).toBeNull();
    expect(schemaErrors(schema, { n: 'x' })).toMatch(/must be integer/);
    expect(schemaErrors(schema, {})).toMatch(/required property 'n'/);
  });

  it('detects schemas that can use strict tool use', () => {
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false })).toBe(true);
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toBe(false);
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'string', maxLength: 3 } }, required: ['a'], additionalProperties: false })).toBe(false);
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'object', properties: {} } }, required: ['a'], additionalProperties: false })).toBe(false);
  });
});
