/**
 * Knowledge Graph Engine — manages concept relationships with confidence propagation.
 *
 * The Knowledge Graph represents the student's "brain":
 *   - Every concept is a node
 *   - Prerequisites are weighted directed edges
 *   - When a concept's mastery changes, confidence propagates through the graph
 *
 * Propagation Rules:
 *   - Mastering a concept → confidence BOOST in dependent concepts (they become more approachable)
 *   - Failing a concept  → confidence REDUCTION in dependent concepts (they become more daunting)
 *   - Propagation decays with graph distance and edge prerequisiteStrength
 */

import type { ConceptId } from '../entities/common.js';
import type { ConceptNode, ConceptEdge, KnowledgeGraph, PropagationResult } from '../entities/knowledge-graph.js';

const PROPAGATION_DECAY_FACTOR = 0.5;  // Confidence change halves at each graph hop
const MAX_PROPAGATION_DEPTH = 3;       // Maximum hops before propagation stops
const BOOST_MULTIPLIER = 0.15;         // Max confidence boost from mastering a prerequisite
const REDUCTION_MULTIPLIER = 0.25;     // Max confidence reduction from failing a prerequisite

/**
 * Propagate a mastery change from a source concept through the graph.
 *
 * @param graph       The global knowledge graph
 * @param originId    The concept that changed
 * @param masteryDelta Positive = improved, Negative = regressed
 * @returns           All concepts affected and their confidence deltas
 */
export function propagateConfidence(
  graph: KnowledgeGraph,
  originId: ConceptId,
  masteryDelta: number
): PropagationResult {
  const affected: PropagationResult['affectedConcepts'] = [];
  const visited = new Set<ConceptId>();

  /**
   * Recursive BFS through the graph.
   * Direction: originId → its dependents (concepts that require the origin as prerequisite)
   */
  function traverse(
    conceptId: ConceptId,
    accumulatedStrength: number,
    depth: number
  ): void {
    if (depth > MAX_PROPAGATION_DEPTH) return;
    if (visited.has(conceptId)) return;
    if (conceptId !== originId) visited.add(conceptId);

    const node = graph.nodes.get(conceptId);
    if (!node) return;

    // Visit all dependents of this concept
    for (const dependentId of node.dependents) {
      if (visited.has(dependentId)) continue;

      const dependentNode = graph.nodes.get(dependentId);
      if (!dependentNode) continue;

      // Find the prerequisite edge that connects this concept to the dependent
      const edge = dependentNode.prerequisites.find(
        (e: ConceptEdge) => e.targetConceptId === conceptId
      );
      if (!edge) continue;

      const edgeStrength = edge.prerequisiteStrength * accumulatedStrength;
      const isImprovement = masteryDelta > 0;

      const multiplier = isImprovement ? BOOST_MULTIPLIER : -REDUCTION_MULTIPLIER;
      const confidenceDelta = edgeStrength * multiplier * Math.abs(masteryDelta);

      affected.push({
        conceptId: dependentId,
        confidenceDelta,
        reason: isImprovement ? 'prerequisite_mastered' : 'prerequisite_failed',
      });

      visited.add(dependentId);

      // Continue propagating with decay
      traverse(dependentId, edgeStrength * PROPAGATION_DECAY_FACTOR, depth + 1);
    }
  }

  traverse(originId, 1.0, 0);

  return {
    originConceptId: originId,
    affectedConcepts: affected,
  };
}

/**
 * Find the shortest prerequisite path between two concepts using BFS.
 * Returns an ordered list of concept IDs, or null if unreachable.
 */
export function findPrerequisitePath(
  graph: KnowledgeGraph,
  fromId: ConceptId,
  toId: ConceptId
): ConceptId[] | null {
  if (fromId === toId) return [fromId];

  const queue: Array<{ id: ConceptId; path: ConceptId[] }> = [
    { id: fromId, path: [fromId] },
  ];
  const visited = new Set<ConceptId>([fromId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const node = graph.nodes.get(current.id);
    if (!node) continue;

    for (const edge of node.prerequisites) {
      const prereqId = edge.targetConceptId;
      if (visited.has(prereqId)) continue;
      visited.add(prereqId);

      const newPath = [prereqId, ...current.path];

      if (prereqId === toId) return newPath;

      queue.push({ id: prereqId, path: newPath });
    }
  }

  return null; // No path found
}

/**
 * Get all direct prerequisites of a concept, sorted by strength (strongest first).
 */
export function getOrderedPrerequisites(
  graph: KnowledgeGraph,
  conceptId: ConceptId
): Array<{ node: ConceptNode; strength: number }> {
  const node = graph.nodes.get(conceptId);
  if (!node) return [];

  return node.prerequisites
    .map((edge: ConceptEdge) => {
      const prereqNode = graph.nodes.get(edge.targetConceptId);
      return prereqNode
        ? { node: prereqNode, strength: edge.prerequisiteStrength }
        : null;
    })
    .filter((item): item is { node: ConceptNode; strength: number } => item !== null)
    .sort((a, b) => b.strength - a.strength);
}

/**
 * Find weak prerequisites for a concept given the student's current mastery map.
 * A prerequisite is "weak" if its mastery is below a threshold.
 */
export function findWeakPrerequisites(
  graph: KnowledgeGraph,
  conceptId: ConceptId,
  masteryMap: Map<ConceptId, number>,
  masteryThreshold = 0.6
): ConceptNode[] {
  const prereqs = getOrderedPrerequisites(graph, conceptId);
  return prereqs
    .filter(({ node, strength }) => {
      const mastery = masteryMap.get(node.id) ?? 0;
      return mastery < masteryThreshold && strength > 0.3; // Only hard dependencies
    })
    .map(({ node }) => node);
}
