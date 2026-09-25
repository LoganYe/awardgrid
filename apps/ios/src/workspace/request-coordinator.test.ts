/**
 * Coordinating the four entries that spend seats.aero calls (UI/UX v1 T17; docs/02 D09; acceptance A28, A29): search,
 * watch, ask and detail start one at a time, so each sees what the one before spent. A failure is the failed job's
 * own; the next one still runs. The counting stays with the one existing Quota.
 */
import { describe, expect, it } from "vitest";
import { RequestCoordinator, RequestNotStartedError } from "./request-coordinator";

it("serializes work without losing failures or deadlocking the next job", async () => {
  const c = new RequestCoordinator();
  const seen: string[] = [];
  const one = c.run("watch", async () => {
    seen.push("watch");
    throw new Error("synthetic");
  }).catch(() => undefined);
  const two = c.run("detail", async () => {
    seen.push("detail");
    return 7;
  });
  await one;
  expect(await two).toBe(7);
  expect(seen).toEqual(["watch", "detail"]);
});

describe("RequestCoordinator", () => {
  it("four entries fired at once run one at a time, in order, and all finish", async () => {
    const c = new RequestCoordinator();
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const job = (kind: "search" | "watch" | "ask" | "detail") =>
      c.run(kind, async () => {
        running += 1;
        most = Math.max(most, running);
        order.push(kind);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return kind;
      });
    const results = await Promise.all([job("search"), job("watch"), job("ask"), job("detail")]);
    expect(results).toEqual(["search", "watch", "ask", "detail"]);
    expect(order).toEqual(["search", "watch", "ask", "detail"]);
    expect(most).toBe(1);
    expect(c.active()).toBeNull();
    expect(c.waiting()).toBe(0);
  });

  it("a job stopped while it waits never starts; one already running finishes (no recall is claimed)", async () => {
    const c = new RequestCoordinator();
    let release!: () => void;
    const held = c.run("watch", () => new Promise<string>((resolve) => (release = () => resolve("watch done"))));
    const stop = new AbortController();
    let started = false;
    const queued = c.run(
      "ask",
      async () => {
        started = true;
        return "ask";
      },
      { signal: stop.signal },
    );
    // The first job starts on the next turn of the queue.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.active()).toBe("watch");
    expect(c.waiting()).toBe(1);
    stop.abort();
    release();
    expect(await held).toBe("watch done");
    await expect(queued).rejects.toBeInstanceOf(RequestNotStartedError);
    expect(started).toBe(false);
    // The queue goes on.
    expect(await c.run("detail", async () => 1)).toBe(1);
  });

  it("a job stopped while it waits rejects at once, even while the job ahead never settles (review COORD-1)", async () => {
    const c = new RequestCoordinator();
    void c.run("search", () => new Promise<void>(() => undefined));
    const stop = new AbortController();
    let started = false;
    const queued = c.run("ask", async () => void (started = true), { signal: stop.signal });
    stop.abort();
    await expect(queued).rejects.toBeInstanceOf(RequestNotStartedError);
    expect(started).toBe(false);
    expect(c.waiting()).toBe(0);
    expect(c.active()).toBe("search");
  });

  it("Stop after a job has started does not end it here: it runs to its end, and onStart said when it began", async () => {
    const c = new RequestCoordinator();
    const stop = new AbortController();
    let release!: () => void;
    const began: string[] = [];
    const job = c.run("ask", () => new Promise<string>((resolve) => (release = () => resolve("done"))), { signal: stop.signal, onStart: () => began.push("ask") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(began).toEqual(["ask"]);
    stop.abort();
    release();
    expect(await job).toBe("done");
  });

  it("idle() waits for every job queued so far, failed ones included", async () => {
    const c = new RequestCoordinator();
    const done: string[] = [];
    void c.run("search", async () => void done.push("a")).catch(() => undefined);
    void c.run("watch", async () => {
      done.push("b");
      throw new Error("synthetic");
    }).catch(() => undefined);
    await c.idle();
    expect(done).toEqual(["a", "b"]);
  });
});
