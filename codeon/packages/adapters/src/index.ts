/**
 * @codeon/adapters — barrel export.
 *
 * Port implementations that connect the pure domain (packages/core/src/ports)
 * to real infrastructure: PostgreSQL, pgvector, and in-memory stubs.
 */

// Event bus
export { InMemoryEventBus } from './event-bus/InMemoryEventBus.js';
export type {
  EventBusErrorContext,
  ErrorHandlerFn,
  InMemoryEventBusOptions,
} from './event-bus/InMemoryEventBus.js';

// Storage
export { PostgresRepository } from './storage/PostgresRepository.js';

// Retrieval
export { PgVectorUserMemoryRetriever } from './retrieval/PgVectorUserMemoryRetriever.js';
export { PgVectorProblemRetriever } from './retrieval/PgVectorProblemRetriever.js';
