/**
 * InMemoryEventBus — synchronous in-process event bus for development and testing.
 *
 * Production hardening applied:
 *
 * 1. waitForIdle() — lets tests wait for all async handlers to settle before
 *    making assertions. Without this, tests that publish an event and immediately
 *    assert on side effects have a race condition.
 *
 * 2. Error Handler Hook (Dead Letter Queue pattern) — instead of silently
 *    swallowing handler errors with console.error, callers can inject an
 *    onHandlerError callback. In tests this lets you assert that errors were
 *    raised. In production the RedisEventBus adapter uses this to push to a DLQ.
 *
 * 3. testMode flag — when true, publish() awaits all handlers synchronously
 *    so tests can use await bus.publish(event) without needing waitForIdle().
 *
 * Usage in tests:
 *   const bus = new InMemoryEventBus({ testMode: true });
 *   await bus.publish(event);
 *   // handlers are guaranteed complete here
 *
 * Usage in production (dev server):
 *   const bus = new InMemoryEventBus();
 *   bus.publish(event); // fire-and-forget, non-blocking
 */

import type {
  IEventBus,
  DomainEvent,
  DomainEventType,
  EventHandler,
} from '@codeon/core/ports';

export interface EventBusErrorContext {
  eventType: DomainEventType;
  handlerName: string;
  error: unknown;
}

export type ErrorHandlerFn = (ctx: EventBusErrorContext) => void | Promise<void>;

export interface InMemoryEventBusOptions {
  /**
   * When true, publish() awaits all handlers before returning.
   * Use in tests to eliminate race conditions.
   * Default: false
   */
  testMode?: boolean;

  /**
   * Called whenever a subscriber handler throws.
   * Simulates a Dead Letter Queue — callers can log, alert, or re-queue.
   * Default: console.error
   */
  onHandlerError?: ErrorHandlerFn;
}

export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<DomainEventType, Set<EventHandler<DomainEventType>>>();
  private readonly testMode: boolean;
  private readonly onHandlerError: ErrorHandlerFn;

  /** Active in-flight handler promises — tracked for waitForIdle() */
  private readonly inflightPromises = new Set<Promise<void>>();

  constructor(options: InMemoryEventBusOptions = {}) {
    this.testMode = options.testMode ?? false;
    this.onHandlerError =
      options.onHandlerError ??
      ((ctx) => {
        console.error(
          `[InMemoryEventBus] Handler "${ctx.handlerName}" failed for event "${ctx.eventType}":`,
          ctx.error
        );
      });
  }

  subscribe<T extends DomainEventType>(eventType: T, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler<DomainEventType>);
  }

  unsubscribe<T extends DomainEventType>(eventType: T, handler: EventHandler<T>): void {
    this.handlers.get(eventType)?.delete(handler as EventHandler<DomainEventType>);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlerSet = this.handlers.get(event.type);
    if (!handlerSet || handlerSet.size === 0) return;

    const handlerPromises: Promise<void>[] = [];

    for (const handler of handlerSet) {
      const handlerName = handler.name || 'anonymous';
      const p = Promise.resolve()
        .then(() => (handler as (e: DomainEvent) => Promise<void>)(event))
        .catch((err: unknown) => {
          this.onHandlerError({ eventType: event.type, handlerName, error: err });
        });

      handlerPromises.push(p);
    }

    if (this.testMode) {
      // testMode: await all handlers inline — no race conditions
      await Promise.all(handlerPromises);
    } else {
      // Production: fire-and-forget but track for waitForIdle()
      const grouped = Promise.all(handlerPromises).then(() => {
        this.inflightPromises.delete(grouped);
      });
      this.inflightPromises.add(grouped);
    }
  }

  /**
   * Wait for all in-flight handlers to complete.
   *
   * Use in tests when NOT using testMode:
   *   bus.publish(event); // fire-and-forget
   *   await bus.waitForIdle();
   *   expect(sideEffect).toBe(true); // safe to assert here
   */
  async waitForIdle(): Promise<void> {
    if (this.inflightPromises.size === 0) return;
    // Drain in waves — new promises may be added by handlers
    while (this.inflightPromises.size > 0) {
      await Promise.all([...this.inflightPromises]);
    }
  }

  /**
   * Remove all subscribers. Useful between tests to prevent cross-test pollution.
   */
  clear(): void {
    this.handlers.clear();
    this.inflightPromises.clear();
  }

  /**
   * Returns the number of subscribers for a given event type.
   * Useful in tests to verify subscription setup.
   */
  subscriberCount(eventType: DomainEventType): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }
}
