/**
 * Trip plans and sample mode (release plan step 18). Sample mode's plans are its own: the services built over sample
 * data keep them under sample/, so the account's plans are not shown there, the account's file is never touched, and
 * nothing saved in sample mode outlives leaving it. A plan's "Try with sample data" switches to sample data and hands
 * the plan over (SampleStart), which is searched there once sample mode has booted, sending nothing.
 */
import { parseQuery } from "@awardgrid/core/query/parse";
import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "../app/bootstrap";
import { type SampleStart, readDataSource, resolveBoot, runSampleStart } from "../app/data-source";
import { MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { PLANS_NAMESPACE, planFromDraft } from "../store/plans-store";
import { SAMPLE_INDEX, enterSampleData, exitSampleData } from "./boot";

const NOW = new Date("2026-10-18T08:30:00Z");
const TODAY = "2026-10-18";

async function planOf(text: string, id: string) {
  const parsed = await parseQuery(text, { today: TODAY });
  return planFromDraft({ text, query: parsed.query, notices: parsed.notices }, NOW.toISOString(), id);
}

/** Services as App boots them: through resolveBoot, on the choice the files hold. */
async function boot(files: MemoryFileStore, reboot: (start?: SampleStart) => void = () => {}) {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  const options = await resolveBoot(
    { keys: new MemoryKeyStore(), anthropicKeys: new MemoryKeyStore(), snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch, assertNative: () => {} },
    { beforeSwitch: async () => {}, reboot },
  );
  return { services: await bootstrap(options), fetchImpl };
}

describe("trip plans in sample mode", () => {
  it("the account's plans are not shown in sample mode, and plans saved there are kept under sample/, then deleted on exit", async () => {
    const files = new MemoryFileStore();
    const live = await boot(files);
    expect((await live.services.plans.save(await planOf("HKG to SEA next 30 days business", "plan-live"))).ok).toBe(true);
    const liveFile = [...files.files.entries()].filter(([path]) => path.startsWith(`${PLANS_NAMESPACE}.`));
    expect(liveFile).toHaveLength(1);

    await enterSampleData(files);
    const sample = await boot(files);
    expect(sample.services.dataSource.kind).toBe("sample");
    expect(sample.services.plans.all()).toEqual([]);
    expect((await sample.services.plans.save(await planOf("LAX to Tokyo next month", "plan-sample"))).ok).toBe(true);
    // Written under sample/ and listed for the exit; the account's file is as it was.
    expect([...files.files.keys()].filter((path) => path.includes(PLANS_NAMESPACE)).sort()).toEqual([liveFile[0]![0], `sample/${PLANS_NAMESPACE}.a.json`].sort());
    expect(JSON.parse(files.files.get(SAMPLE_INDEX)!)).toContain(`${PLANS_NAMESPACE}.a.json`);
    expect(files.files.get(liveFile[0]![0])).toBe(liveFile[0]![1]);

    await exitSampleData(files);
    expect([...files.files.keys()].filter((path) => path.startsWith("sample/"))).toEqual([]);
    const back = await boot(files);
    expect(back.services.dataSource.kind).toBe("live");
    expect(back.services.plans.all().map((p) => p.id)).toEqual(["plan-live"]);
    // Nothing in any of this went to the network.
    expect(live.fetchImpl).not.toHaveBeenCalled();
    expect(sample.fetchImpl).not.toHaveBeenCalled();
  });

  it("'Try with sample data' hands the plan over: entering sample mode reboots with it, in sample mode", async () => {
    const files = new MemoryFileStore();
    const reboot = vi.fn();
    const live = await boot(files, reboot);
    const plan = await planOf("Hong Kong to Seattle next month, business", "plan-try");
    await live.services.dataSource.enterSample({ text: plan.text, query: plan.query });
    expect(await readDataSource(files)).toBe("sample");
    expect(reboot).toHaveBeenCalledWith({ text: plan.text, query: plan.query });
    // Entering without a plan hands nothing over, as before.
    const again = vi.fn();
    const other = new MemoryFileStore();
    await (await boot(other, again)).services.dataSource.enterSample();
    expect(again).toHaveBeenCalledWith(undefined);
  });

  it("the handed-over plan is searched on the sample data: a workspace run labelled with its words, saved, nothing sent", async () => {
    const files = new MemoryFileStore();
    const plan = await planOf("Hong Kong to Seattle next month, business", "plan-try");
    await enterSampleData(files);
    const { services, fetchImpl } = await boot(files);
    await runSampleStart(services, { text: plan.text, query: plan.query });
    const shown = services.workspace.getState().displayedSnapshot;
    expect(shown?.query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: plan.query.date_from, date_to: plan.query.date_to, cabins: ["J"] });
    expect(shown!.rows.length).toBeGreaterThan(5);
    expect(services.lastSearch.get()?.text).toBe("Hong Kong to Seattle next month, business");
    // Saved like any search, under sample/; the host's transport (the account's) was never called.
    expect([...files.files.keys()].some((path) => path.startsWith("sample/workspace"))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
