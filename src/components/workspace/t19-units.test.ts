/**
 * T19's pure rules (plan 04 T19; A31, A32): one side panel at a time, shortcuts that never take a key being typed or
 * composed and can be turned off, the palette's own commands only, and the view the workspace opens on.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CABINS } from "@awardgrid/core/query/schema";
import { resolveDraft } from "@awardgrid/core/workspace/query-editor";
import { filterCommands, type WorkspaceCommand } from "./commands";
import { isTypingTarget, shortcutFor, type KeyInput } from "./keyboard";
import { NO_PANEL, panelReducer } from "./panel-state";
import { effectiveView, readShortcutsOn, readViewChoice, writeShortcutsOn, writeViewChoice } from "./prefs";
import { addDays, blankDraft, codesFromText, localToday, queryErrors } from "./query-draft";

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

const A = { snapshotId: "s1", rowKey: "r1" };
const B = { snapshotId: "s1", rowKey: "r2" };

describe("panelReducer", () => {
  it("the assistant and a detail never stand together; either replaces the other", () => {
    const assistant = panelReducer(NO_PANEL, { type: "assistant" });
    expect(assistant.kind).toBe("assistant");
    const detail = panelReducer(assistant, { type: "detail", option: A });
    expect(detail).toEqual({ kind: "detail", option: A, selected: A });
    const back = panelReducer(detail, { type: "assistant" });
    expect(back).toEqual({ kind: "assistant", selected: A });
    expect(panelReducer(back, { type: "close" })).toEqual({ kind: "none", selected: A });
  });

  it("re-opening what is open changes nothing; another option replaces the first", () => {
    const detail = panelReducer(NO_PANEL, { type: "detail", option: A });
    expect(panelReducer(detail, { type: "detail", option: { ...A } })).toBe(detail);
    expect(panelReducer(detail, { type: "detail", option: B })).toEqual({ kind: "detail", option: B, selected: B });
    const assistant = panelReducer(NO_PANEL, { type: "assistant" });
    expect(panelReducer(assistant, { type: "assistant" })).toBe(assistant);
  });

  it("a new snapshot closes a detail of another and forgets the selection; the same snapshot keeps both", () => {
    const detail = panelReducer(NO_PANEL, { type: "detail", option: A });
    expect(panelReducer(detail, { type: "snapshot", snapshotId: "s1" })).toBe(detail);
    expect(panelReducer(detail, { type: "snapshot", snapshotId: "s2" })).toEqual(NO_PANEL);
    const assistant = panelReducer(detail, { type: "assistant" });
    expect(panelReducer(assistant, { type: "snapshot", snapshotId: "s2" })).toEqual({ kind: "assistant", selected: null });
    expect(panelReducer(assistant, { type: "snapshot", snapshotId: null })).toEqual({ kind: "assistant", selected: null });
  });
});

const el = (tagName: string, extra: Partial<{ type: string; role: string; editable: boolean }> = {}) =>
  ({
    tagName,
    type: extra.type,
    isContentEditable: extra.editable ?? false,
    closest: (selector: string) => (extra.editable && selector.includes("contenteditable") ? {} : null),
    getAttribute: (name: string) => (name === "role" ? (extra.role ?? null) : null),
  }) as unknown as EventTarget;

const key = (k: string, patch: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  target: el("DIV"),
  ...patch,
});

describe("shortcutFor", () => {
  it("/ focuses the query from the page, and never while typing", () => {
    expect(shortcutFor(key("/"), true, true)).toBe("focus_query");
    for (const target of [el("INPUT", { type: "text" }), el("INPUT", { type: "search" }), el("INPUT"), el("TEXTAREA"), el("SELECT"), el("DIV", { editable: true }), el("DIV", { role: "combobox" }), el("DIV", { role: "textbox" })]) {
      expect(shortcutFor(key("/", { target }), true, true)).toBeNull();
      expect(isTypingTarget(target)).toBe(true);
    }
    // A checkbox or a button is not typing.
    expect(shortcutFor(key("/", { target: el("INPUT", { type: "checkbox" }) }), true, false)).toBe("focus_query");
    expect(shortcutFor(key("/", { target: el("BUTTON") }), true, false)).toBe("focus_query");
  });

  it("nothing is taken mid-composition (IME), including Safari's keyCode 229", () => {
    expect(shortcutFor(key("/", { isComposing: true }), true, true)).toBeNull();
    expect(shortcutFor(key("/", { keyCode: 229 }), true, true)).toBeNull();
    expect(shortcutFor(key("k", { metaKey: true, isComposing: true }), true, true)).toBeNull();
    expect(shortcutFor(key("Enter", { ctrlKey: true, keyCode: 229 }), true, false)).toBeNull();
  });

  it("the platform's own modifier: Cmd+K / Cmd+Enter on a Mac, Ctrl+K / Ctrl+Enter elsewhere, even from a field", () => {
    expect(shortcutFor(key("k", { metaKey: true }), true, true)).toBe("palette");
    expect(shortcutFor(key("K", { ctrlKey: true, target: el("INPUT", { type: "text" }) }), true, false)).toBe("palette");
    expect(shortcutFor(key("Enter", { metaKey: true }), true, true)).toBe("submit");
    expect(shortcutFor(key("Enter", { ctrlKey: true }), true, false)).toBe("submit");
  });

  it("on a Mac, Control+K stays the text field's own key (delete to the end of the line); elsewhere Meta+K is not taken", () => {
    expect(shortcutFor(key("k", { ctrlKey: true, target: el("INPUT", { type: "text" }) }), true, true)).toBeNull();
    expect(shortcutFor(key("k", { ctrlKey: true }), true, true)).toBeNull();
    expect(shortcutFor(key("Enter", { ctrlKey: true }), true, true)).toBeNull();
    expect(shortcutFor(key("k", { metaKey: true }), true, false)).toBeNull();
    expect(shortcutFor(key("k", { metaKey: true, ctrlKey: true }), true, true)).toBeNull();
  });

  it("modified keys that belong to the browser or assistive technology are left alone", () => {
    expect(shortcutFor(key("k", { metaKey: true, altKey: true }), true, true)).toBeNull();
    expect(shortcutFor(key("k", { ctrlKey: true, shiftKey: true }), true, false)).toBeNull();
    expect(shortcutFor(key("/", { ctrlKey: true }), true, false)).toBeNull();
    expect(shortcutFor(key("/", { altKey: true }), true, true)).toBeNull();
    expect(shortcutFor(key("k"), true, true)).toBeNull();
    expect(shortcutFor(key("Enter"), true, true)).toBeNull();
    expect(shortcutFor(key("Escape"), true, true)).toBeNull();
  });

  it("turned off, nothing is a shortcut", () => {
    expect(shortcutFor(key("/"), false, true)).toBeNull();
    expect(shortcutFor(key("k", { metaKey: true }), false, true)).toBeNull();
    expect(shortcutFor(key("Enter", { ctrlKey: true }), false, false)).toBeNull();
  });
});

describe("filterCommands", () => {
  const commands: WorkspaceCommand[] = [
    { id: "focus_query", label: "聚焦查询条件", keywords: ["Focus the query"] },
    { id: "view_matrix", label: "切换到矩阵", keywords: ["Matrix view"] },
    { id: "open_assistant", label: "打开AI辅助", keywords: ["AI assistance"] },
  ];
  it("keeps the list's order and matches every word, in either language, ignoring case and width", () => {
    expect(filterCommands(commands, "").map((c) => c.id)).toEqual(["focus_query", "view_matrix", "open_assistant"]);
    expect(filterCommands(commands, "矩阵").map((c) => c.id)).toEqual(["view_matrix"]);
    expect(filterCommands(commands, "MATRIX view").map((c) => c.id)).toEqual(["view_matrix"]);
    expect(filterCommands(commands, "ＡＩ").map((c) => c.id)).toEqual(["open_assistant"]);
    expect(filterCommands(commands, "rm -rf /")).toEqual([]);
  });
});

describe("workspace preferences", () => {
  it("the matrix is the default for more than one route; a view chosen by hand wins, per account", () => {
    const one = { origins: ["HKG"], destinations: ["SEA"] };
    const many = { origins: ["HKG", "PVG"], destinations: ["SEA"] };
    expect(effectiveView(null, one)).toBe("list");
    expect(effectiveView(null, many)).toBe("matrix");
    expect(effectiveView(null, null)).toBe("list");
    const store = new MemoryStorage();
    expect(readViewChoice("a", store)).toBeNull();
    writeViewChoice("a", "calendar", store);
    expect(readViewChoice("a", store)).toBe("calendar");
    expect(readViewChoice("b", store)).toBeNull();
    expect(effectiveView(readViewChoice("a", store), many)).toBe("calendar");
  });

  it("shortcuts are on until turned off; unreadable or missing storage gives the defaults", () => {
    const store = new MemoryStorage();
    expect(readShortcutsOn("a", store)).toBe(true);
    writeShortcutsOn("a", false, store);
    expect(readShortcutsOn("a", store)).toBe(false);
    expect(readShortcutsOn("b", store)).toBe(true);
    store.setItem(JSON.stringify(["awardgrid-prefs-v1", "a", "view"]), "{not json");
    expect(readViewChoice("a", store)).toBeNull();
    store.setItem(JSON.stringify(["awardgrid-prefs-v1", "a", "view"]), JSON.stringify("javascript:alert(1)"));
    expect(readViewChoice("a", store)).toBeNull();
    expect(readShortcutsOn("a", null)).toBe(true);
    expect(readViewChoice("a", null)).toBeNull();
  });
});


describe("the query draft", () => {
  it("reads codes separated by commas, spaces or 、, upper-cased, once each; anything else is named as unknown", () => {
    expect(codesFromText(" hkg, pvg、NRT  hnd，hkg ")).toMatchObject({ codes: ["HKG", "PVG", "NRT", "HND"], bad: [] });
    expect(codesFromText("HK1, ZZ9Q, sea")).toMatchObject({ codes: ["SEA"], bad: ["HK1", "ZZ9Q"] });
    expect(codesFromText("")).toEqual({ codes: [], bad: [], expanded: [] });
    // Any other three-letter code is an airport, as core takes it.
    expect(codesFromText("BNE")).toEqual({ codes: ["BNE"], bad: [], expanded: [] });
  });

  it("a city code or name expands to its airports, through core, and says so (T19 review PRD-1)", () => {
    expect(codesFromText("tyo")).toEqual({ codes: ["NRT", "HND"], bad: [], expanded: [{ code: "TYO", airports: ["NRT", "HND"] }] });
    expect(codesFromText("Tokyo, SEA").codes).toEqual(["NRT", "HND", "SEA"]);
    expect(codesFromText("东京").codes).toEqual(["NRT", "HND"]);
    // SHA is both the metro and Hongqiao: the metro, as the grid reads it (core expandPlace).
    expect(codesFromText("SHA").codes).toEqual(["PVG", "SHA"]);
    // An airport listed under a city is itself, and the same airport twice is once.
    expect(codesFromText("NRT, TYO").codes).toEqual(["NRT", "HND"]);
    const draft = blankDraft("2026-10-18");
    const query = resolveDraft({ ...draft, query: { ...draft.query, origins: codesFromText("TYO").codes, destinations: ["SEA"] } }, "2026-10-18");
    expect(query.origins).toEqual(["NRT", "HND"]);
  });

  it("names every broken field in the bar's order, the first one first", () => {
    const today = "2026-10-18";
    const draft = blankDraft(today);
    const empty = queryErrors(draft, { origins: "", destinations: "" }, today);
    expect(empty.map((e) => [e.field, e.key])).toEqual([
      ["origins", "workspace.q.err.origins_required"],
      ["destinations", "workspace.q.err.destinations_required"],
    ]);
    const typed = { ...draft, query: { ...draft.query, origins: [], destinations: ["SEA"], cabins: [] } };
    const errors = queryErrors(typed, { origins: "HK1", destinations: "SEA" }, today);
    expect(errors.map((e) => [e.field, e.key, e.vars])).toEqual([
      ["origins", "workspace.q.unknown_code", { code: "HK1" }],
      ["cabins", "workspace.q.err.cabins_required", undefined],
    ]);
  });

  it("dates: a range already over, a range past core's span cap (said with the cap), and an inverted one", () => {
    const today = "2026-10-18";
    const base = blankDraft(today);
    const withDates = (from: string, to: string) => ({ query: { ...base.query, origins: ["HKG"], destinations: ["SEA"], date_from: from, date_to: to }, dates: { kind: "fixed" as const, from, to } });
    const texts = { origins: "HKG", destinations: "SEA" };
    expect(queryErrors(withDates("2026-09-01", "2026-09-30"), texts, today)).toEqual([{ field: "dates", key: "workspace.q.err.ends_in_past" }]);
    expect(queryErrors(withDates("2026-10-18", "2027-03-01"), texts, today)).toEqual([{ field: "dates", key: "workspace.q.err.span_exceeds_core_limit", vars: { days: "92" } }]);
    expect(queryErrors(withDates("2026-11-10", "2026-11-01"), texts, today)).toEqual([{ field: "dates", key: "workspace.q.err.end_before_start" }]);
    expect(queryErrors(withDates("2026-10-20", "2026-10-30"), texts, today)).toEqual([]);
  });

  it("a blank draft is the next 30 days (today included) in core's default cabins; with airports it resolves to a valid query", () => {
    const draft = blankDraft("2026-10-18");
    expect(draft.dates).toEqual({ kind: "fixed", from: "2026-10-18", to: "2026-11-16" });
    expect(draft.query.cabins).toEqual(DEFAULT_CABINS);
    const query = resolveDraft({ ...draft, query: { ...draft.query, origins: ["HKG"], destinations: ["SEA"] } }, "2026-10-18");
    expect(query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-11-16", min_cabin_pct: 100 });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("today is the browser's calendar day, never shifted through UTC", () => {
    // 23:30 local on the 18th is the 18th, whatever UTC says.
    expect(localToday(new Date(2026, 9, 18, 23, 30))).toBe("2026-10-18");
    expect(localToday(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});
