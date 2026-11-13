/** A card's dependency graph shown for a value nested inside that card is
 * drawn centred on what the value is made of: the first of its own source
 * identities (references, then calls) that is a node of the graph. Without
 * such a node the drawing keeps the graph's own focus. The graph data is
 * never changed; only where it is drawn from. */
export function dependencyGraphCentre(graph: { focus: string; nodes: readonly { id: string }[] },
  candidates: readonly string[] | undefined): string {
  return candidates?.find(identity => graph.nodes.some(node => node.id === identity)) ?? graph.focus;
}

/** What a value nested in a card shows (decision 10 of the 2026-11-11
 * dependencies note): only the parts it is made of. Several identities that
 * are nodes: those nodes and the card that contains them, centred on the
 * card. One: that node, centred, with its own direct links. None: the card's
 * whole graph. Only nodes and edges Fenel returned are kept; none is made up. */
export function dependencyGraphNested<G extends { focus: string; nodes: readonly { id: string }[];
  edges: readonly { from: string; to: string }[] }>(graph: G, candidates: readonly string[] | undefined): G {
  const drawn = [...new Set(candidates ?? [])].filter(identity => graph.nodes.some(node => node.id === identity));
  // The graph of that very identity (a retained reference) is already its own.
  if (!drawn.length || drawn.length === 1 && drawn[0] === graph.focus) return graph;
  if (drawn.length === 1) {
    const centre = drawn[0]!;
    const edges = graph.edges.filter(edge => edge.from === centre || edge.to === centre);
    const kept = new Set([centre, ...edges.flatMap(edge => [edge.from, edge.to])]);
    return { ...graph, focus: centre, nodes: graph.nodes.filter(node => kept.has(node.id)), edges };
  }
  const kept = new Set([graph.focus, ...drawn]);
  return { ...graph, nodes: graph.nodes.filter(node => kept.has(node.id)),
    edges: graph.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to)) };
}
