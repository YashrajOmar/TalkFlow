import type { ConceptCategory, ConceptId } from './common.js';

/**
 * A weighted edge representing a prerequisite relationship.
 * prerequisiteStrength: 0.0–1.0
 *   1.0 = hard prerequisite (cannot understand without it)
 *   0.3 = soft prerequisite (helpful but not strictly required)
 */
export interface ConceptEdge {
  readonly targetConceptId: ConceptId;
  readonly prerequisiteStrength: number;
  readonly relationship: EdgeRelationship;
}

export type EdgeRelationship =
  | 'requires'      // Hard dependency
  | 'builds_upon'   // Extends a concept
  | 'specializes'   // A specific application
  | 'related';      // Thematically related but not dependent

/**
 * A node in the global knowledge graph.
 * This represents the concept itself, NOT the student's relationship to it.
 * Student-specific state lives in ConceptMastery on StudentProfile.
 */
export interface ConceptNode {
  readonly id: ConceptId;
  readonly name: string;
  readonly description: string;
  readonly category: ConceptCategory;

  // Graph topology
  readonly prerequisites: ConceptEdge[];  // Concepts this node depends on
  readonly dependents: ConceptId[];       // Concepts that depend on this node

  // Importance metadata
  readonly interviewImportance: number;   // 0.0–1.0 (FAANG signal)
  readonly cpImportance: number;          // 0.0–1.0 (competitive programming signal)

  // Curriculum metadata
  readonly typicalEloToLearn: number;     // Approximate Elo needed to learn this
  readonly averageDaysToMaster: number;   // Community average
  readonly tags: string[];
}

/**
 * The full global knowledge graph.
 * Shared across all students — student-specific mastery is overlaid separately.
 */
export interface KnowledgeGraph {
  readonly nodes: Map<ConceptId, ConceptNode>;
  readonly version: string;  // e.g., '2025.1'
  readonly updatedAt: Date;
}

/**
 * Confidence propagation result — computed when a concept's mastery changes.
 * Lists all concepts whose confidence should be updated as a cascade effect.
 */
export interface PropagationResult {
  readonly originConceptId: ConceptId;
  readonly affectedConcepts: Array<{
    readonly conceptId: ConceptId;
    readonly confidenceDelta: number;  // Positive = boost, negative = reduction
    readonly reason: 'prerequisite_mastered' | 'prerequisite_failed';
  }>;
}
