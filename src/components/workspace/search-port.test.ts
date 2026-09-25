/**
 * The Web search port (UI/UX v1 T18; review REG-1): an answer that lands after the account signed out in this tab is
 * never published, so a search in flight at logout cannot show or keep that account's rows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "@awardgrid/core/workspace/workspace-store";
import availability from "../../../packages/core/test/fixtures/uiux/availability-rows.json";
import type { QueryObject } from "@awardgrid/core/query/schema";

const pending: Array<(value: unknown) => void> = [];
vi.mock("@/components/grid/api", () => ({
  apiFind: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
}));

const { webSearchPort } = await import("./search-port");
const { WORKSPACE_STORE, forgetWorkspacesOnDevice, storageKey, webStorage } = await import("./storage");

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
}

const query = availability.query as unknown as QueryObject;
const answer = {
  ok: true,
  value: {
    grid: { query, meta: { api_calls_used: 1, served_from_cache: false } },
    rows: availability.rows,
    coverage: null,
  },
};

afterEach(() => {
  pending.length = 0;
});

describe("webSearchPort after a logout", () => {
  it("a search in flight at logout publishes nothing and leaves nothing on the browser", async () => {
    const backing = new MemoryStorage();
    const now = () => "2026-10-18T08:30:00.000Z";
    const workspace = new WorkspaceStore({ search: webSearchPort(), now, storage: webStorage(WORKSPACE_STORE, "user-a", backing) });
    const running = workspace.run(query);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    forgetWorkspacesOnDevice(backing);
    pending.shift()?.(answer);
    const outcome = await running;
    expect(outcome).toMatchObject({ kind: "failed", code: "signed_out" });
    expect(workspace.getState().displayedSnapshot).toBeNull();
    expect((await workspace.persist()).ok).toBe(true);
    expect(backing.getItem(storageKey(WORKSPACE_STORE, "user-a", "workspace-v1"))).toBeNull();
    expect(backing.length).toBe(0);
  });

  it("a port made before a logout sends nothing after it", async () => {
    const port = webSearchPort();
    forgetWorkspacesOnDevice(null);
    await expect(port.execute(query, { id: "run-1", revision: 1 })).rejects.toMatchObject({ code: "signed_out" });
    expect(pending).toHaveLength(0);
  });

  it("control: without a logout the answer is published", async () => {
    const backing = new MemoryStorage();
    const now = () => "2026-10-18T08:30:00.000Z";
    const workspace = new WorkspaceStore({ search: webSearchPort(), now, storage: webStorage(WORKSPACE_STORE, "user-a", backing) });
    const running = workspace.run(query);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()?.(answer);
    expect(await running).toMatchObject({ kind: "published" });
    expect(workspace.getState().displayedSnapshot?.rows.length).toBe(availability.rows.length);
    expect((await workspace.persist()).ok).toBe(true);
    expect(backing.getItem(storageKey(WORKSPACE_STORE, "user-a", "workspace-v1"))).not.toBeNull();
  });
});
