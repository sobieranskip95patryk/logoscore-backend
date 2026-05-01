/**
 * Mapa intencji jako graf JSON-LD.
 * @context: schema.org-like — minimalny, własny vocab.
 */
export interface IntentNode {
  '@id': string;            // np. "intent:abc123"
  '@type': 'Intent';
  text: string;
  createdAt: string;
}

export interface IntentEdge {
  '@id': string;
  '@type': 'IntentLink';
  from: string;             // @id node
  to: string;               // @id node
  weight: number;           // 0..1 — siła powiązania
}

export interface IntentGraph {
  '@context': {
    '@vocab': string;
    Intent: string;
    IntentLink: string;
  };
  '@id': string;            // sessionId
  nodes: IntentNode[];
  edges: IntentEdge[];
}

export const emptyGraph = (sessionId: string): IntentGraph => ({
  '@context': {
    '@vocab': 'https://mtaquestwebsidex.app/vocab#',
    Intent: 'https://mtaquestwebsidex.app/vocab#Intent',
    IntentLink: 'https://mtaquestwebsidex.app/vocab#IntentLink'
  },
  '@id': `session:${sessionId}`,
  nodes: [],
  edges: []
});

/**
 * Linearyzacja grafu do tekstu (kompatybilność z UI, fallback).
 */
export function graphToString(g: IntentGraph): string {
  if (!g.nodes.length) return 'POCZĄTEK MAPOWANIA WIZJI';
  return g.nodes.map(n => n.text).join(' -> ');
}

export function appendIntent(g: IntentGraph, text: string, weight = 0.8): IntentGraph {
  const id = `intent:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const node: IntentNode = {
    '@id': id, '@type': 'Intent', text, createdAt: new Date().toISOString()
  };
  const last = g.nodes[g.nodes.length - 1];
  const nodes = [...g.nodes, node];
  const edges = last ? [
    ...g.edges,
    {
      '@id': `link:${last['@id']}->${id}`,
      '@type': 'IntentLink' as const,
      from: last['@id'],
      to: id,
      weight
    }
  ] : g.edges;
  return { ...g, nodes, edges };
}
