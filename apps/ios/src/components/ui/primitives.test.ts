/**
 * The base controls' semantics (UI/UX v1 T04). Rendered to static markup, as the shell's other component tests are
 * (node environment, no DOM): what a screen reader and a test locator can rely on. Geometry, colour and keyboard
 * behaviour are checked in the browser (e2e/uiux/foundations.spec.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Chip, IconButton, Notice, SegmentedControl, Sheet, TextField, applyThemePreference, isThemePreference } from "./index";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Button", () => {
  it("keeps the existing class names the shell's markup and the Simulator driver select on", () => {
    expect(html(h(Button, { variant: "primary", children: "Run" }))).toContain('class="ag-button ag-button-primary"');
    expect(html(h(Button, { children: "Watch" }))).toContain('class="ag-button"');
    expect(html(h(Button, { variant: "danger", children: "Remove key" }))).toContain('class="ag-button ag-button-danger"');
    expect(html(h(Button, { children: "x" }))).toContain('type="button"');
  });

  it("a disabled button says why, and the reason is its description", () => {
    const out = html(h(Button, { variant: "primary", disabled: true, disabledReason: "Add a departure date first", children: "Find award options" }));
    const id = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain(">Add a departure date first<");
    expect(out).toContain("disabled");
  });

  it("an enabled button shows no reason even if one is passed", () => {
    expect(html(h(Button, { disabledReason: "unused", children: "Go" }))).not.toContain("unused");
  });

  it("loading keeps the label, is busy and aria-disabled (not disabled, so it keeps focus), and names what it is doing", () => {
    const out = html(h(Button, { variant: "primary", loading: true, loadingLabel: "Searching", children: "Apply and search" }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).not.toMatch(/\sdisabled=""/);
    expect(out).toContain(">Apply and search<");
    expect(out).toContain('class="sr-only">Searching<');
  });
});

describe("IconButton", () => {
  it("has an accessible name and a decorative icon", () => {
    const out = html(h(IconButton, { icon: "close", label: "Close" }));
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('class="ag-icon-button"');
  });
  it("the outlined variant adds its class", () => {
    expect(html(h(IconButton, { icon: "close", label: "Clear", variant: "outlined" }))).toContain('class="ag-icon-button ag-icon-button-outlined"');
  });
});

describe("TextField", () => {
  it("labels the input, and describes it with help and error, error first", () => {
    const out = html(h(TextField, { label: "Return date", help: "YYYY-MM-DD", error: "Not a real date." }));
    const inputId = /<input[^>]*\sid="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`for="${inputId}"`);
    expect(out).toContain('aria-invalid="true"');
    const described = /aria-describedby="([^"]+)"/.exec(out)?.[1]?.split(" ") ?? [];
    expect(described).toHaveLength(2);
    expect(out.indexOf(`id="${described[0]}"`)).toBeGreaterThan(-1);
    expect(out).toMatch(new RegExp(`id="${described[0]}"[^>]*>Not a real date\\.`));
  });

  it("is not marked invalid without an error", () => {
    expect(html(h(TextField, { label: "Note" }))).not.toContain("aria-invalid");
  });
});

describe("Chip", () => {
  it("a toggle chip reports aria-pressed and shows a check mark when selected", () => {
    const on = html(h(Chip, { selected: true, children: "HKG" }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("<svg");
    expect(html(h(Chip, { selected: false, children: "HKG" }))).toContain('aria-pressed="false"');
  });
  it("an opener chip has no pressed state", () => {
    expect(html(h(Chip, { children: "More filters" }))).not.toContain("aria-pressed");
  });
  it("the filter variant adds its class; the default is a toggle", () => {
    expect(html(h(Chip, { variant: "filter", selected: false, children: "Nonstop" }))).toContain('class="ag-chip ag-chip-filter"');
    expect(html(h(Chip, { children: "HKG" }))).toContain('class="ag-chip"');
  });
});

describe("SegmentedControl", () => {
  it("is a labelled radio group with one tab stop on the checked option", () => {
    const out = html(
      h(SegmentedControl<"list" | "calendar">, {
        label: "Result view",
        value: "calendar",
        onChange: () => {},
        options: [
          { value: "list", label: "List" },
          { value: "calendar", label: "Calendar" },
        ],
      }),
    );
    expect(out).toContain('role="radiogroup" aria-label="Result view"');
    expect(out).toMatch(/role="radio" aria-checked="false" tabindex="-1"[^>]*>List</);
    expect(out).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*>Calendar</);
  });
  it("a disabled option is rendered disabled", () => {
    const out = html(
      h(SegmentedControl<"a" | "b">, {
        label: "Cabin",
        value: "a",
        onChange: () => {},
        options: [
          { value: "a", label: "Economy" },
          { value: "b", label: "Premium", disabled: true },
        ],
      }),
    );
    expect(out).toMatch(/tabindex="-1" disabled=""[^>]*>Premium</);
    expect(out).not.toMatch(/disabled=""[^>]*>Economy</);
  });
  it("keeps one tab stop when the checked option is disabled, and checks nothing when the value matches nothing", () => {
    const options = [
      { value: "a" as const, label: "Economy", disabled: true },
      { value: "b" as const, label: "Premium" },
      { value: "c" as const, label: "Business" },
    ];
    const disabledChecked = html(h(SegmentedControl<"a" | "b" | "c">, { label: "Cabin", value: "a", onChange: () => {}, options }));
    expect(disabledChecked.match(/tabindex="0"/g)).toHaveLength(1);
    expect(disabledChecked).toMatch(/aria-checked="false" tabindex="0"[^>]*>Premium</);
    const missing = html(h(SegmentedControl<"a" | "b" | "c">, { label: "Cabin", value: "z" as "a", onChange: () => {}, options }));
    expect(missing).not.toContain('aria-checked="true"');
    expect(missing.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

describe("Notice", () => {
  it("is not a live region unless the state just changed", () => {
    expect(html(h(Notice, { tone: "warning", children: "Results are incomplete." }))).not.toContain("role=");
    expect(html(h(Notice, { tone: "warning", live: true, children: "x" }))).toContain('role="status"');
    expect(html(h(Notice, { tone: "danger", live: true, children: "x" }))).toContain('role="alert"');
  });
});

describe("Sheet", () => {
  it("renders nothing when closed, and a labelled modal dialog when open", () => {
    expect(html(h(Sheet, { open: false, title: "T", onClose: () => {}, children: "body" }))).toBe("");
    const out = html(h(Sheet, { open: true, title: "Sample sheet", onClose: () => {}, children: "body" }));
    expect(out).toContain('role="dialog" aria-modal="true"');
    const labelled = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`id="${labelled}"`);
    expect(out).toContain('aria-label="Close"');
  });
});

describe("theme preference", () => {
  it("system clears the attribute; light and dark pin it", () => {
    const attrs = new Map<string, string>();
    const root = {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    } as unknown as HTMLElement;
    applyThemePreference("dark", root);
    expect(attrs.get("data-theme")).toBe("dark");
    applyThemePreference("system", root);
    expect(attrs.has("data-theme")).toBe(false);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });
});

describe("ui.css", () => {
  const css = readFileSync(path.join(import.meta.dirname, "ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("reads only Quiet Precision tokens: no older colour name, no hex", () => {
    const names = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.startsWith("--ag-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
