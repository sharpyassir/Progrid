/**
 * Merges a customer's user-data into a marketplace app's #cloud-config.
 *
 * A cloud-config is a YAML mapping, and merging only needs its top level: each key with its
 * value text. List keys that both documents may carry (write_files, runcmd, packages,
 * bootcmd) are concatenated, app items first. For every other key the app's value wins and
 * the customer's is dropped; keys only the customer sets are kept. Block sequences are
 * re-indented as a whole and flow sequences ([a, b]) are split on their top level commas, so
 * nested values survive untouched.
 *
 * A customer script (#!) becomes one write_files entry plus one runcmd entry that runs it.
 */
export const MERGED_LIST_KEYS = ['write_files', 'runcmd', 'packages', 'bootcmd'] as const;

interface TopKey {
  key: string;
  /** Text after the colon on the key line. */
  inline: string;
  /** Following lines that belong to the key (indented, or sequence items at column 0). */
  body: string[];
}

export class CloudConfigMergeError extends Error {}

export function mergeCloudConfig(app: string, customer: string): string {
  const trimmed = customer.replace(/^﻿/, '').trimStart();
  let extra: TopKey[];
  if (trimmed.startsWith('#!')) {
    const script = trimmed.replace(/\s+$/, '').split('\n');
    extra = [
      { key: 'write_files', inline: '', body: ['  - path: /var/lib/cloud/prgd-user-data.sh', "    permissions: '0755'", '    content: |', ...script.map((l) => (l ? `      ${l}` : ''))] },
      { key: 'runcmd', inline: '', body: ['  - [ /var/lib/cloud/prgd-user-data.sh ]'] },
    ];
  } else if (/^#cloud-config\b/.test(trimmed)) {
    extra = parseTop(trimmed);
  } else {
    throw new CloudConfigMergeError('User data for a marketplace app must be a #cloud-config document or a script starting with #!');
  }
  if (!/^#cloud-config\b/.test(app.trimStart())) throw new CloudConfigMergeError('This app does not take user data');
  const base = parseTop(app.trimStart());
  const isList = (k: string) => (MERGED_LIST_KEYS as readonly string[]).includes(k);
  const byKey = new Map(extra.map((k) => [k.key, k]));
  const out: string[] = ['#cloud-config'];
  const seen = new Set<string>();
  for (const k of base) {
    seen.add(k.key);
    const theirs = byKey.get(k.key);
    if (isList(k.key) && theirs) out.push(`${k.key}:`, ...listItems(k), ...listItems(theirs));
    else out.push(render(k));
  }
  for (const k of extra) if (!seen.has(k.key)) out.push(isList(k.key) ? [`${k.key}:`, ...listItems(k)].join('\n') : render(k));
  return out.join('\n') + '\n';
}

function render(k: TopKey) {
  return [`${k.key}:${k.inline ? ` ${k.inline}` : ''}`, ...k.body].join('\n');
}

/** Splits a cloud-config into its top level keys. Comments between keys and document markers are dropped. */
function parseTop(doc: string): TopKey[] {
  const keys: TopKey[] = [];
  const lines = doc.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines.slice(1)) {
    if (/^(---|\.\.\.)\s*$/.test(line)) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/.exec(line);
    if (m) {
      keys.push({ key: m[1], inline: (m[2] ?? '').trim(), body: [] });
      continue;
    }
    if (/^#/.test(line)) continue;
    const cur = keys[keys.length - 1];
    if (!cur) {
      if (line.trim()) throw new CloudConfigMergeError(`Cannot read the cloud-config near "${line.trim().slice(0, 40)}"`);
      continue;
    }
    cur.body.push(line);
  }
  for (const k of keys) while (k.body.length && !k.body[k.body.length - 1].trim()) k.body.pop();
  return keys;
}

/** The items of a list key as block sequence lines indented by two spaces. */
function listItems(k: TopKey): string[] {
  if (k.inline) {
    const v = k.inline.replace(/\s+#.*$/, '');
    if (v === '[]') return [];
    if (!v.startsWith('[') || !v.endsWith(']')) throw new CloudConfigMergeError(`"${k.key}" must be a list`);
    return splitFlow(v.slice(1, -1)).map((item) => `  - ${item}`);
  }
  const first = k.body.find((l) => l.trim() && !l.trim().startsWith('#'));
  if (!first) return [];
  const base = first.length - first.trimStart().length;
  if (!first.trimStart().startsWith('-')) throw new CloudConfigMergeError(`"${k.key}" must be a list`);
  const out: string[] = [];
  for (const l of k.body) {
    if (!l.trim()) {
      out.push('');
      continue;
    }
    const ind = l.length - l.trimStart().length;
    if (ind < base) throw new CloudConfigMergeError(`Cannot read the "${k.key}" list near "${l.trim().slice(0, 40)}"`);
    out.push(`  ${l.slice(base)}`);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** Top level items of a flow sequence body, respecting quotes and nested brackets. */
function splitFlow(s: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && !(quote === '"' && s[i - 1] === '\\')) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}
