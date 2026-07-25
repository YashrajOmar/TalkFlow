/**
 * @codeon/db — barrel export.
 *
 * All tables, relations, and types are exported from schema.ts.
 * Seeds are exported from seeds/.
 */

// Schema (tables + relations)
export * from './schema.js';

// Seed data
export { CONCEPT_TOPIC_SEEDS } from './seeds/concept-topics.js';
export type { PrerequisiteEdge } from './seeds/concept-topics.js';
export { CONCEPT_TOPIC_PREREQUISITES } from './seeds/concept-topics.js';
