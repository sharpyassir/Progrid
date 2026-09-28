/**
 * Runbook suggestions for the ticket workspace: simple scoring, no search engine. A runbook
 * scores for tags that name the asset or contract (asset:<id>, contract:<id>) or describe it
 * (os, provider, kind), for tags or title words matching the ticket's alert names, and for
 * title words that appear in the ticket text.
 */
export interface RunbookLite {
  id: string;
  slug: string;
  title: string;
  tags: string[];
}

export interface SuggestContext {
  assetTags: string[];
  alertNames: string[];
  text: string;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'not', 'has', 'have', 'but', 'you', 'our', 'all', 'can', 'please', 'how', 'what', 'when', 'into', 'out', 'your']);

/** Lower case words of three or more letters; CamelCase alert names are split ("HostDown" gives host, down, hostdown). */
export function words(text: string): string[] {
  const split = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const out = new Set<string>();
  for (const w of split.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  return [...out];
}

export function assetTags(a: { id: string; contractId: string; kind: string; os: string | null; provider: string | null }) {
  return [`asset:${a.id}`, `contract:${a.contractId}`, a.kind.toLowerCase(), a.kind.toLowerCase().replace(/_/g, '-'), ...words(a.os ?? ''), ...words(a.provider ?? '')];
}

export function suggestRunbooks(runbooks: RunbookLite[], ctx: SuggestContext, limit = 5) {
  const assetSet = new Set(ctx.assetTags.map((t) => t.toLowerCase()));
  const alertWords = new Set(ctx.alertNames.flatMap(words));
  const textWords = new Set(words(ctx.text));
  const scored = runbooks.map((r) => {
    const tags = r.tags.map((t) => t.toLowerCase());
    const titleWords = words(r.title);
    const reasons: string[] = [];
    let score = 0;
    for (const t of tags) if (assetSet.has(t)) (score += 5), reasons.push(`tag ${t}`);
    for (const w of new Set([...tags.flatMap(words), ...titleWords])) if (alertWords.has(w)) (score += 3), reasons.push(`alert ${w}`);
    for (const w of titleWords) if (textWords.has(w)) (score += 1), reasons.push(`text ${w}`);
    return { id: r.id, slug: r.slug, title: r.title, tags: r.tags, score, reasons: [...new Set(reasons)] };
  });
  return scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
