'use client';

/**
 * Visual workflow editor on @xyflow/react. The canvas always runs left to right, also on
 * Arabic pages. Steps: Trigger, AI Agent, Tool, Condition (true and false outputs), Action,
 * Transform and End. The side panel edits the selected step.
 */
import '@xyflow/react/dist/style.css';
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, Connection as RFConnection, Controls, Edge, EdgeChange, Handle, MiniMap, Node, NodeChange,
  NodeProps, Position, ReactFlow, ReactFlowProvider, useReactFlow,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Graph, GraphEdge, GraphNode, NODE_TYPES, NodeType, pretty, Tool } from '@/lib/connect';
import { ctf, CStringKey } from '@/lib/i18n-connect';
import type { Locale } from '@/lib/i18n';
import { Field, JsonInput, useC } from './ui';

const COLORS: Record<NodeType, string> = {
  trigger: 'border-violet-400 bg-violet-50 dark:bg-violet-950/40', agent: 'border-blue-400 bg-blue-50 dark:bg-blue-950/40', tool: 'border-cyan-400 bg-cyan-50 dark:bg-cyan-950/40',
  condition: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40', action: 'border-green-400 bg-green-50 dark:bg-green-950/40', transform: 'border-neutral-400 bg-neutral-50 dark:bg-neutral-900',
  end: 'border-neutral-700 bg-white dark:border-neutral-300 dark:bg-neutral-900',
};
const ICONS: Record<NodeType, string> = { trigger: '⚡', agent: '✦', tool: '⚙', condition: '⑂', action: '➤', transform: '{ }', end: '■' };

type StepData = Record<string, unknown> & { _label: string; _summary: string };

/** Templates may be a string or a JSON value with {{...}} references inside. */
const asText = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

function summary(n: GraphNode, tools: Tool[]): string {
  const d = n.data ?? {};
  switch (n.type) {
    case 'trigger': return `${d.source ?? 'api'}${d.cron ? ` · ${d.cron}` : ''}`;
    case 'agent': return String(d.prompt ?? '');
    case 'tool': return tools.find((t) => t.id === d.toolId)?.name ?? String(d.toolId ?? '');
    case 'condition': return String(d.expression ?? '');
    case 'action': return String(d.kind ?? '');
    case 'transform': return asText(d.template);
    case 'end': return asText(d.output);
  }
}

const StepNode = memo(function StepNode({ data, type, selected }: NodeProps<Node<StepData>>) {
  const t = type as NodeType;
  return (
    <div className={`w-52 rounded-lg border-2 px-3 py-2 text-start text-neutral-900 shadow-sm dark:text-neutral-100 ${COLORS[t]} ${selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}>
      {t !== 'trigger' && <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-neutral-500" />}
      <div className="flex items-center gap-1.5 text-xs font-semibold"><span aria-hidden>{ICONS[t]}</span>{data._label}</div>
      {data._summary && <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-600 dark:text-neutral-400" title={data._summary}>{data._summary}</div>}
      {t === 'condition' ? (
        <>
          <Handle id="true" type="source" position={Position.Bottom} style={{ left: '28%' }} className="!h-3 !w-3 !bg-green-600" />
          <Handle id="false" type="source" position={Position.Bottom} style={{ left: '72%' }} className="!h-3 !w-3 !bg-red-600" />
          <div className="mt-1 flex justify-between px-4 text-[10px] font-medium"><span className="text-green-700 dark:text-green-400">true</span><span className="text-red-700 dark:text-red-400">false</span></div>
        </>
      ) : t !== 'end' && <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !bg-neutral-500" />}
    </div>
  );
});
const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, StepNode]));

const toRF = (g: Graph, tools: Tool[], locale: Locale): { nodes: Node<StepData>[]; edges: Edge[] } => ({
  nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position ?? { x: 0, y: 0 }, data: { ...n.data, _label: ctf(locale, `node_${n.type}` as CStringKey) as string, _summary: summary(n, tools) } })),
  edges: g.edges.map((e) => toRFEdge(e)),
});
const toRFEdge = (e: GraphEdge): Edge => ({
  id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, label: e.label ?? e.sourceHandle ?? undefined,
  style: e.sourceHandle === 'true' ? { stroke: '#16a34a' } : e.sourceHandle === 'false' ? { stroke: '#dc2626' } : undefined,
});
const fromRF = (nodes: Node<StepData>[], edges: Edge[]): Graph => ({
  nodes: nodes.map((n) => {
    const { _label, _summary, ...data } = n.data; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { id: n.id, type: n.type as NodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data };
  }),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle, label: typeof e.label === 'string' && e.label ? e.label : e.sourceHandle } : {}) })),
});

/** Layered layout from the trigger down: longest path decides the row, true branches go left of false. */
export function autoLayout(g: Graph): Graph {
  const out: Record<string, GraphEdge[]> = {};
  g.edges.forEach((e) => (out[e.source] ||= []).push(e));
  const level: Record<string, number> = {};
  const indeg: Record<string, number> = Object.fromEntries(g.nodes.map((n) => [n.id, 0]));
  g.edges.forEach((e) => { if (e.target in indeg) indeg[e.target]++; });
  const queue = g.nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  queue.forEach((id) => (level[id] = 0));
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    seen.add(id);
    for (const e of out[id] ?? []) {
      level[e.target] = Math.max(level[e.target] ?? 0, level[id] + 1);
      if (--indeg[e.target] === 0) queue.push(e.target);
    }
  }
  g.nodes.forEach((n) => { if (!seen.has(n.id)) level[n.id] = level[n.id] ?? 0; });
  // order within a row: follow parents, true before false
  const order: Record<string, number> = {};
  const rows: Record<number, string[]> = {};
  const byLevel = [...g.nodes].sort((a, b) => level[a.id] - level[b.id]);
  for (const n of byLevel) {
    const parents = g.edges.filter((e) => e.target === n.id);
    const rank = parents.length ? Math.min(...parents.map((p) => (order[p.source] ?? 0) * 10 + (p.sourceHandle === 'false' ? 5 : 0))) : 0;
    order[n.id] = rank;
    (rows[level[n.id]] ||= []).push(n.id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  Object.entries(rows).forEach(([lv, ids]) => {
    ids.sort((a, b) => order[a] - order[b]);
    ids.forEach((id, i) => { order[id] = i; pos[id] = { x: (i - (ids.length - 1) / 2) * 260, y: Number(lv) * 130 }; });
  });
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) };
}

/** Problems that block saving, in the person's language. Empty means valid. */
export function validateWorkflow(g: Graph, locale: Locale): string[] {
  const t = <K extends 'v_oneTrigger' | 'v_needEnd' | 'v_cycle'>(k: K) => ctf(locale, k) as string;
  const name = (n: GraphNode) => `${ctf(locale, `node_${n.type}` as CStringKey)} (${n.id})`;
  const errs: string[] = [];
  const triggers = g.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) errs.push(t('v_oneTrigger'));
  if (!g.nodes.some((n) => n.type === 'end')) errs.push(t('v_needEnd'));
  const out: Record<string, GraphEdge[]> = {};
  g.edges.forEach((e) => (out[e.source] ||= []).push(e));
  // cycles
  const state: Record<string, number> = {};
  const cyc = (id: string): boolean => { if (state[id] === 1) return true; if (state[id] === 2) return false; state[id] = 1; for (const e of out[id] ?? []) if (cyc(e.target)) return true; state[id] = 2; return false; };
  if (g.nodes.some((n) => cyc(n.id))) errs.push(t('v_cycle'));
  // reachability
  if (triggers.length === 1) {
    const reach = new Set<string>([triggers[0].id]);
    const stack = [triggers[0].id];
    while (stack.length) for (const e of out[stack.pop()!] ?? []) if (!reach.has(e.target)) { reach.add(e.target); stack.push(e.target); }
    g.nodes.filter((n) => !reach.has(n.id)).forEach((n) => errs.push(ctf(locale, 'v_unreachable')(name(n))));
  }
  for (const n of g.nodes) {
    const o = out[n.id] ?? [];
    if (n.type === 'condition' && (!o.some((e) => e.sourceHandle === 'true') || !o.some((e) => e.sourceHandle === 'false'))) errs.push(ctf(locale, 'v_conditionHandles')(name(n)));
    else if (n.type !== 'end' && n.type !== 'condition' && o.length === 0) errs.push(ctf(locale, 'v_noOutgoing')(name(n)));
    if (n.type === 'tool' && !n.data?.toolId) errs.push(ctf(locale, 'v_toolMissing')(name(n)));
  }
  return errs;
}

const DEFAULT_DATA: Record<NodeType, Record<string, unknown>> = {
  trigger: { source: 'api' }, agent: { prompt: '{{trigger.body}}' }, tool: { toolId: '', input: {} }, condition: { expression: '' },
  action: { kind: 'notify', config: {} }, transform: { template: {} }, end: { output: '{{steps}}' },
};

export const emptyGraph = (): Graph => autoLayout({
  nodes: [
    { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { source: 'api' } },
    { id: 'agent', type: 'agent', position: { x: 0, y: 0 }, data: { prompt: '{{trigger.body}}' } },
    { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: { output: '{{steps.agent.output}}' } },
  ],
  edges: [{ id: 'e_trigger_agent', source: 'trigger', target: 'agent' }, { id: 'e_agent_end', source: 'agent', target: 'end' }],
});

interface Props { initial: Graph; tools: Tool[]; onChange: (g: Graph) => void; height?: string; layoutKey?: number }

export function WorkflowEditor(props: Props) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}

function Editor({ initial, tools, onChange, height = 'h-[560px]', layoutKey }: Props) {
  const { c, locale } = useC();
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<Node<StepData>[]>(() => toRF(initial, tools, locale).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => toRF(initial, tools, locale).edges);
  const [selected, setSelected] = useState<string | null>(null);
  const first = useRef(true);

  // Relabel when the language or tool list changes.
  useEffect(() => { setNodes((ns) => toRF(fromRF(ns, []), tools, locale).nodes.map((n, i) => ({ ...ns[i], data: n.data }))); }, [locale, tools]);
  // Parent asked for a fresh layout or a new graph.
  useEffect(() => {
    if (layoutKey === undefined) return;
    const g = toRF(initial, tools, locale);
    setNodes(g.nodes); setEdges(g.edges);
    requestAnimationFrame(() => rf.fitView({ padding: 0.2 }));
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onChange(fromRF(nodes, edges));
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((ch: NodeChange<Node<StepData>>[]) => setNodes((ns) => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback((ch: EdgeChange[]) => setEdges((es) => applyEdgeChanges(ch, es)), []);
  const onConnect = useCallback((conn: RFConnection) => {
    if (conn.source === conn.target) return;
    setEdges((es) => {
      // a condition output leads to one step; other steps may fan out
      const filtered = conn.sourceHandle ? es.filter((e) => !(e.source === conn.source && e.sourceHandle === conn.sourceHandle)) : es;
      return addEdge(toRFEdge({ id: `e_${conn.source}_${conn.sourceHandle ?? ''}_${conn.target}`, source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle ?? undefined }), filtered);
    });
  }, []);

  function addNode(type: NodeType) {
    const used = new Set(nodes.map((n) => n.id));
    let i = 1; while (used.has(`${type}_${i}`)) i++;
    const id = type === 'trigger' && !used.has('trigger') ? 'trigger' : `${type}_${i}`;
    const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), -130);
    const g = toRF({ nodes: [{ id, type, position: { x: 0, y: maxY + 130 }, data: { ...DEFAULT_DATA[type] } }], edges: [] }, tools, locale);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...g.nodes[0], selected: true }]);
    setSelected(id);
  }

  function patchNode(id: string, patch: Record<string, unknown>, newId?: string) {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id) return n;
      const base = fromRF([n], []).nodes[0];
      const merged = { ...base, id: newId ?? id, data: { ...base.data, ...patch } };
      return { ...n, id: merged.id, data: toRF({ nodes: [merged], edges: [] }, tools, locale).nodes[0].data };
    }));
    if (newId && newId !== id) {
      setEdges((es) => es.map((e) => ({ ...e, source: e.source === id ? newId : e.source, target: e.target === id ? newId : e.target })));
      setSelected(newId);
    }
  }
  function removeNode(id: string) {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
  }

  const sel = nodes.find((n) => n.id === selected);
  const selGraph = sel ? fromRF([sel], []).nodes[0] : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-2">
        <div role="toolbar" aria-label={c('addNode')} className="flex flex-wrap items-center gap-1.5">
          <span className="me-1 text-xs font-medium text-neutral-500">{c('addNode')}:</span>
          {NODE_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => addNode(t)} title={ctf(locale, `nodeD_${t}` as CStringKey) as string} className="btn-ghost px-2 py-1 text-xs">
              <span aria-hidden>{ICONS[t]}</span> {ctf(locale, `node_${t}` as CStringKey) as string}
            </button>
          ))}
        </div>
        <div dir="ltr" className={`${height} overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800`} aria-label={c('canvas')} role="region">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onSelectionChange={({ nodes: s }) => setSelected(s[0]?.id ?? null)} deleteKeyCode={['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.2 }}
            colorMode="system" minZoom={0.3}>
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden sm:!block" />
          </ReactFlow>
        </div>
        <p className="text-xs text-neutral-500">{c('selectNodeHint')} {c('deleteWorkflowEdgeHint')}</p>
      </div>
      <aside className="card min-w-0 self-start" aria-label={c('editNode')}>
        {selGraph ? <NodeForm key={selGraph.id} node={selGraph} tools={tools} onPatch={(p, newId) => patchNode(selGraph.id, p, newId)} onDelete={() => removeNode(selGraph.id)} /> : <p className="text-sm text-neutral-500">{c('selectNodeHint')}</p>}
      </aside>
    </div>
  );
}

/** Edit one step. JSON fields keep their text until it parses. */
function NodeForm({ node, tools, onPatch, onDelete }: { node: GraphNode; tools: Tool[]; onPatch: (p: Record<string, unknown>, newId?: string) => void; onDelete: () => void }) {
  const { c, cd } = useC();
  const d = node.data ?? {};
  const [idText, setIdText] = useState(node.id);
  const jsonField = (key: string, label: string, hint?: string) => <JsonField key={key} label={label} hint={hint} value={d[key]} onValue={(v) => onPatch({ [key]: v })} />;
  const text = (key: string, label: string, hint?: string, mono = true, rows = 3) => (
    <Field label={label} hint={hint}>
      {(id, h) => <textarea id={id} aria-describedby={h} dir="ltr" rows={rows} className={`input text-start ${mono ? 'font-mono text-xs' : ''}`} value={String(d[key] ?? '')} onChange={(e) => onPatch({ [key]: e.target.value })} />}
    </Field>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-semibold">{cd('node_', node.type)}</h3>
        <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={onDelete}>{c('deleteNode')}</button>
      </div>
      <p className="text-xs text-neutral-500">{cd('nodeD_', node.type)}</p>
      <Field label={c('stepId')} hint="{{steps.<id>.output}}">
        {(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input font-mono text-xs" value={idText} onChange={(e) => setIdText(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} onBlur={() => idText && idText !== node.id && onPatch({}, idText)} />}
      </Field>
      {node.type === 'trigger' && (
        <>
          <Field label={c('source')}>
            {(id) => <select id={id} className="input" value={String(d.source ?? 'api')} onChange={(e) => onPatch({ source: e.target.value })}>
              {['api', 'webhook', 'schedule', 'manual'].map((s) => <option key={s} value={s}>{cd('trig_', s)}</option>)}
            </select>}
          </Field>
          {d.source === 'schedule' && (
            <Field label={c('cron')} hint="*/10 * * * *">{(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input font-mono" value={String(d.cron ?? '')} onChange={(e) => onPatch({ cron: e.target.value })} />}</Field>
          )}
        </>
      )}
      {node.type === 'agent' && (
        <>
          {text('prompt', c('prompt'), c('promptHint'), false, 4)}
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{c('restrictTools')}</legend>
            <p className="mb-1 text-xs text-neutral-500">{c('allTools')}</p>
            <div className="space-y-1">
              {tools.map((t) => {
                const ids = (d.toolIds as string[] | undefined) ?? [];
                return (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ids.includes(t.id)} onChange={(e) => { const next = e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id); onPatch({ toolIds: next.length ? next : undefined }); }} />
                    <code dir="ltr" className="font-mono text-xs">{t.name}</code>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {jsonField('outputSchema', c('outputSchema'))}
        </>
      )}
      {node.type === 'tool' && (
        <>
          <Field label={c('node_tool')}>
            {(id) => <select id={id} className="input" value={String(d.toolId ?? '')} onChange={(e) => onPatch({ toolId: e.target.value })}>
              <option value="">—</option>
              {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>}
          </Field>
          {jsonField('input', c('toolInput'), c('promptHint'))}
        </>
      )}
      {node.type === 'condition' && text('expression', c('expression'), c('expressionHint'))}
      {node.type === 'action' && (
        <>
          <Field label={c('actionKind')}>
            {(id) => <select id={id} className="input" value={String(d.kind ?? 'notify')} onChange={(e) => onPatch({ kind: e.target.value })}>
              {['send_email', 'notify', 'http_request', 'progrid'].map((k) => <option key={k} value={k}>{cd('act_', k)}</option>)}
            </select>}
          </Field>
          {jsonField('config', c('settingsJson'), c('promptHint'))}
        </>
      )}
      {node.type === 'transform' && <TemplateField key={`${node.id}-template`} label={c('templateJson')} hint={c('promptHint')} rows={5} value={d.template} onValue={(v) => onPatch({ template: v })} />}
      {node.type === 'end' && <TemplateField key={`${node.id}-output`} label={c('outputTemplate')} hint={c('promptHint')} value={d.output} onValue={(v) => onPatch({ output: v })} />}
    </div>
  );
}

/** A template that is JSON when it parses as an object or array, else plain text. */
function TemplateField({ label, hint, value, onValue, rows = 3 }: { label: string; hint?: string; value: unknown; onValue: (v: unknown) => void; rows?: number }) {
  const [textValue, setText] = useState(() => (value === undefined || value === null ? '' : typeof value === 'string' ? value : pretty(value)));
  return (
    <Field label={label} hint={hint}>
      {(id, h) => <textarea id={id} aria-describedby={h} dir="ltr" rows={rows} className="input text-start font-mono text-xs" value={textValue} onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (/^\s*[[{]/.test(t)) { try { onValue(JSON.parse(t)); return; } catch { /* not JSON yet: keep it as text */ } }
        onValue(t);
      }} />}
    </Field>
  );
}

function JsonField({ label, hint, value, onValue }: { label: string; hint?: string; value: unknown; onValue: (v: unknown) => void }) {
  const [textValue, setText] = useState(() => (value === undefined ? '' : pretty(value)));
  return (
    <JsonInput label={label} hint={hint} value={textValue} rows={5} onChange={(t) => {
      setText(t);
      if (!t.trim()) onValue(undefined);
      else { try { onValue(JSON.parse(t)); } catch { /* keep typing */ } }
    }} />
  );
}

export function useWorkflowValidation(g: Graph | null) {
  const { locale } = useC();
  return useMemo(() => (g ? validateWorkflow(g, locale) : []), [g, locale]);
}
