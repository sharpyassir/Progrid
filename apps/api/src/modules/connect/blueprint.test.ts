import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { bindToolIds, validateBlueprint } from './blueprint';
import { DRAFT_SCHEMA, draftFromModel, fakeDraft } from './builder';
import { TEMPLATES } from './templates';
import { httpRequestExecutor } from './tools/http.executor';
import { progridExecutor } from './tools/progrid.executor';
import { schemaErrors, isStrictCompatible } from './tools/schema';
import { verifySignature } from './runs.service';
import { signPayload } from './tools/http.executor';

/** Config checks for the kinds the drafts use, without the Nest registry. */
const schemas: Record<string, Record<string, unknown>> = {
  http_request: httpRequestExecutor.configSchema,
  progrid: progridExecutor({} as never).configSchema,
  database_query: { type: 'object', properties: { mode: { enum: ['sql', 'mongo_find', 'mongo_aggregate'] } } },
  send_email: { type: 'object' },
  notify: { type: 'object', properties: { channel: { enum: ['email', 'webhook', 'progrid_console'] } }, required: ['channel'] },
  webhook_out: { type: 'object' },
};
const check = (kind: string, config: unknown) => (schemas[kind] ? schemaErrors(schemas[kind], config) : `unknown tool kind ${kind}`);

describe('templates', () => {
  it('ships the seven templates', () => {
    expect(TEMPLATES.map((t) => t.slug)).toEqual(['customer-support', 'sales', 'data-analyst', 'monitoring', 'research', 'developer', 'invoice']);
  });

  it.each(TEMPLATES.map((t) => [t.slug, t]))('%s is a valid blueprint', (_, t) => {
    const { issues } = validateBlueprint(t, check);
    expect(issues).toEqual([]);
  });

  it('uses strict compatible output schemas in agent nodes', () => {
    for (const t of TEMPLATES) {
      for (const n of t.workflow?.nodes ?? []) if (n.type === 'agent' && n.data?.outputSchema) expect(isStrictCompatible(n.data.outputSchema)).toBe(true);
    }
  });
});

describe('Build with AI drafts', () => {
  it.each([
    'Qualify leads from our website form and push good ones to the CRM',
    'Answer customer support emails about orders',
    'Every day check my servers and alert me if something is down',
    'Read invoices from suppliers and book them',
    'Answer questions about our sales database with SQL',
    'Summarize news about competitors',
    'Help debug failed deploys on GitHub',
    'Translate incoming webhook messages to French',
  ])('the fake model drafts a valid blueprint for "%s"', (prompt) => {
    const { blueprint, issues } = validateBlueprint(fakeDraft(prompt), check);
    expect(issues).toEqual([]);
    expect(blueprint.agent.name).toMatch(/Agent$/);
  });

  it('switches the trigger to a schedule when the description says so', () => {
    const d = fakeDraft('Every hour check the servers');
    expect(d.workflow?.nodes.find((n) => n.type === 'trigger')?.data).toEqual({ source: 'schedule', cron: '0 * * * *' });
  });

  it('parses the model structured output (JSON string fields) into a blueprint', () => {
    const raw = {
      agent: { name: 'Lead bot', description: 'd', instructions: 'i', effort: 'low' },
      tools: [{ name: 'push_lead', description: 'x', kind: 'http_request', connectionRef: 'crm', requiresApproval: false, configJson: '{"method":"POST","path":"/leads"}', inputSchemaJson: '' }],
      workflow: {
        enabled: true,
        nodes: [
          { id: 'trigger', type: 'trigger', x: 0, y: 0, dataJson: '{"source":"webhook"}' },
          { id: 'push', type: 'tool', x: 0, y: 100, dataJson: '{"toolId":"push_lead","input":{"email":"{{trigger.body.email}}"}}' },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'push', sourceHandle: '', label: '' }],
      },
      variables: [{ key: 'CRM_PIPELINE', description: 'p', required: true, secret: false }],
      connectionsNeeded: [{ ref: 'crm', kind: 'rest_api', name: 'CRM', description: 'c' }],
    };
    expect(schemaErrors(DRAFT_SCHEMA, raw)).toBeNull();
    const { blueprint, issues } = validateBlueprint(draftFromModel(raw), check);
    expect(issues).toEqual([]);
    expect(blueprint.tools[0].config).toEqual({ method: 'POST', path: '/leads' });
    const bound = bindToolIds(blueprint.workflow!, new Map([['push_lead', 'tool_123']]));
    expect(bound.nodes[1].data?.toolId).toBe('tool_123');
  });

  it('reports every problem in a bad draft', () => {
    const { issues } = validateBlueprint({
      agent: { name: '', effort: 'extreme', model: 'gpt-9' },
      tools: [{ name: 'Bad Name', kind: 'http_request' }, { name: 'ok', kind: 'teleport' }, { name: 'db', kind: 'database_query', config: { mode: 'nosql' }, connectionRef: 'missing' }],
      workflow: { nodes: [{ id: 'trigger', type: 'trigger' }, { id: 't', type: 'tool', data: { toolId: 'nope' } }], edges: [{ id: 'e', source: 'trigger', target: 't' }] },
      connectionsNeeded: [{ ref: 'x', kind: 'ftp' }],
    }, check);
    const text = issues.map((i) => `${i.path}: ${i.message}`).join('\n');
    expect(text).toMatch(/agent.name: name is required/);
    expect(text).toMatch(/unknown model gpt-9/);
    expect(text).toMatch(/effort must be/);
    expect(text).toMatch(/snake_case/);
    expect(text).toMatch(/kind must be one of/);
    expect(text).toMatch(/not in connectionsNeeded/);
    expect(text).toMatch(/unknown tool nope/);
  });

  it('has a draft schema usable for structured outputs', () => {
    expect(isStrictCompatible(DRAFT_SCHEMA)).toBe(true);
  });
});

describe('webhook signatures', () => {
  it('verifies X-Prgd-Signature with a 5 minute window', () => {
    const body = Buffer.from('{"a":1}');
    const { signature } = signPayload('whsec_test', body.toString());
    expect(verifySignature('whsec_test', signature, body)).toBe(true);
    expect(verifySignature('whsec_other', signature, body)).toBe(false);
    expect(verifySignature('whsec_test', signature, Buffer.from('{"a":2}'))).toBe(false);
    expect(verifySignature('whsec_test', signature, body, Date.now() + 10 * 60_000)).toBe(false);
    expect(verifySignature('whsec_test', 'garbage', body)).toBe(false);
  });
});
