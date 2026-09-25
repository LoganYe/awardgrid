/**
 * One queue for the four entries that spend seats.aero calls (UI/UX v1 T17; docs/02 D09; acceptance A29).
 *
 * A search, a watch run, one Ask tool call and one detail lookup each start only when the one before has finished,
 * so each reads the quota after the last one spent: two entries can never both see "one call left" and both send.
 * The count itself stays where it was: the one Quota, fed by the transport's own record of what was sent. The queue
 * counts nothing.
 *
 * Rules the call sites keep:
 *   - **Never re-entered.** An operation must not call `run` itself and wait for it: the inner call would wait for the
 *     outer, which waits for the inner. So each entry is queued at its outermost spending step, and what it calls
 *     inside (the engine, the transport) is never queued again: a watch run calls the engine directly, an Ask
 *     question queues each tool call rather than the whole question (which also waits for watch runs).
 *   - **A failure is the failed job's own.** It rejects that job's promise; the next job still runs.
 *   - **Stop before start.** A job whose signal is aborted while it waits never starts; one already started runs to its
 *     end (a native request in flight cannot be recalled, and is not claimed to be).
 */
export type RequestKind = "search" | "watch" | "ask" | "detail";

export class RequestNotStartedError extends Error {
  constructor(readonly kind: RequestKind) {
    super(`The ${kind} was stopped before it started; nothing was sent.`);
    this.name = "RequestNotStartedError";
  }
}

export class RequestCoordinator {
  #tail: Promise<void> = Promise.resolve();
  #active: RequestKind | null = null;
  #waiting = 0;

  /**
   * Run `operation` once every job queued before it has finished. It rejects as `operation` does. With a signal, a job
   * stopped while it waits rejects at once with RequestNotStartedError, and never starts; the queue keeps its place,
   * so the jobs after it still wait for the ones before. `onStart` is called just before `operation`, when the turn
   * comes, so a caller can say the job is running only once it is.
   */
  run<T>(kind: RequestKind, operation: () => Promise<T>, opts: { signal?: AbortSignal; onStart?: () => void } = {}): Promise<T> {
    const { signal } = opts;
    this.#waiting += 1;
    let counted = true;
    const leave = () => {
      if (counted) this.#waiting -= 1;
      counted = false;
    };
    // Set when the job's turn comes: from then on Stop no longer ends it here (a started request is not recalled).
    let turn = false;
    const queued = this.#tail.then(async () => {
      turn = true;
      leave();
      if (signal?.aborted) throw new RequestNotStartedError(kind);
      this.#active = kind;
      try {
        opts.onStart?.();
        return await operation();
      } finally {
        this.#active = null;
      }
    });
    // The queue follows the job's own turn, whatever the caller was told.
    this.#tail = queued.then(
      () => undefined,
      () => undefined,
    );
    if (!signal) return queued;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (turn) return;
        leave();
        reject(new RequestNotStartedError(kind));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      queued.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }

  /** The kind of job running now, or null. */
  active(): RequestKind | null {
    return this.#active;
  }

  /** How many jobs wait for their turn. */
  waiting(): number {
    return this.#waiting;
  }

  /** Resolves once every job queued so far has finished, whatever its outcome. */
  idle(): Promise<void> {
    return this.#tail;
  }
}
