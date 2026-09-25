/**
 * T21: what a screen looks like to a person at one width and text scale, as facts a test can hold (plan 04 T21 Step 3:
 * "inspect every long-label/action bounding box"; A35). Read from the rendered page, never from the design:
 *
 *   - overflowX   the page, or a screen's own full-width scroll area, is wider than the screen (measured against
 *                 clientWidth: see below);
 *   - clipped     text cut by its own box (overflow hidden or clip, no ellipsis on purpose), spilling out of a box that
 *                 lets it show, running out of the control it belongs to (a label in a span hanging out of its button, a
 *                 value wrapping past its row, a day's words running into the next day), past the viewport's side outside
 *                 a sideways scroller; a box that clips cutting off text or a control; a select's or a field's value
 *                 wider than the field (unless it ends in an ellipsis on purpose);
 *   - overlaps    two controls covering each other (a tap could hit the wrong one), and text drawn over other text (line
 *                 boxes of different texts, or of one text's lines, covering each other). These are measured on what is
 *                 on screen, so each screen-level scroller (the page, an app screen's own scroll area) is stepped through
 *                 its whole height (T21 review 2 CLOSE-3). Fixed layers (a bar, a sheet) are compared among themselves;
 *                 sticky parts count with the page at rest, and once scrolled each is a layer of its own, since
 *                 content passes under them by design. With a modal dialog open, only the dialog's controls and text count.
 *
 * Looked at like anything else: text under aria-hidden (it is drawn; the attribute only hides it from assistive tech:
 * review 2 DELTA-1). Left out: screen-reader-only text (a 1-px box), hidden and inert content. Each entry names the
 * element by its role or tag and its first words, so a failure says where to look.
 */
import type { Page } from "@playwright/test";

export interface LayoutAudit {
  overflowX: number;
  clipped: string[];
  overlaps: string[];
}

export async function auditLayout(page: Page): Promise<LayoutAudit> {
  return page.evaluate(() => {
    // The layout viewport, not innerWidth: a mobile browser zooms out to fit a page that is too wide, and innerWidth
    // grows with it, which would hide exactly the overflow this looks for.
    const vw = document.documentElement.clientWidth;
    const CONTROLS = "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='radio'], [role='tab'], [role='gridcell'][tabindex], summary";
    // Boxes whose words belong inside them: a control's, a gridcell's, a label's.
    const HOLDERS = "button, a[href], [role='button'], [role='radio'], [role='tab'], [role='gridcell'], summary, label";
    const name = (el: Element) => {
      const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const id = el.getAttribute("data-testid") ?? el.className?.toString().split(" ")[0] ?? "";
      return `${el.tagName.toLowerCase()}${id ? `.${id}` : ""} "${text}"`;
    };
    const shown = (el: Element) => {
      // What a person can see: a closed <details>' content keeps layout boxes, but is neither drawn nor hit.
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && !el.closest("[inert]");
    };
    const clips = (cs: CSSStyleDeclaration) => cs.overflowX !== "visible" || cs.overflowY !== "visible";
    const cutsOff = (cs: CSSStyleDeclaration) => ["hidden", "clip"].includes(cs.overflowX) || ["hidden", "clip"].includes(cs.overflowY);
    const scroller = (cs: CSSStyleDeclaration) => ["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY);
    // An ellipsis is on purpose only where the box can draw one (review 3 SHUT-3): one line of a block box that does not
    // wrap, cut only sideways, or a line clamp cut only at the clamp. A flex box, or wrapped lines cut in height, cut the
    // words with nothing to say so.
    const drawsEllipsis = (el: Element, cs: CSSStyleDeclaration) => {
      if (cs.webkitLineClamp?.match(/\d/) && cs.display.includes("-webkit-box")) return el.scrollWidth <= el.clientWidth + 1;
      if (cs.textOverflow !== "ellipsis" || !["block", "inline-block", "flow-root", "list-item", "table-cell"].includes(cs.display)) return false;
      const nowrap = ["nowrap", "pre"].includes(cs.whiteSpace) || cs.getPropertyValue("text-wrap-mode") === "nowrap";
      return nowrap && el.scrollHeight <= el.clientHeight + 1;
    };
    const formField = (el: Element) => ["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(el.tagName);
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    // The layer an element is drawn in: a fixed bar or sheet sits over the page by design; a sticky part (the results
    // header, a matrix's date column) is the page's at rest and its own once the page has scrolled under it. Each sticky
    // part is a layer of its own: the header and the date column scroll past each other by design too.
    const stickyIds = new Map<Element, number>();
    const layer = (el: Element) => {
      let sticky: Element | null = null;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const position = getComputedStyle(p).position;
        if (position === "fixed") return "fixed";
        if (position === "sticky") sticky = p;
      }
      if (!sticky) return "page";
      if (!stickyIds.has(sticky)) stickyIds.set(sticky, stickyIds.size);
      return `sticky ${stickyIds.get(sticky)}`;
    };
    type Box = { left: number; top: number; right: number; bottom: number };
    // A box cut by the ancestors that clip it, from `from` up to (not including) `until`.
    const clipBy = (box: Box, from: Element | null, until: Element | null): Box => {
      let { left, top, right, bottom } = box;
      for (let p = from; p && p !== until && p !== document.body; p = p.parentElement) {
        if (!clips(getComputedStyle(p))) continue;
        const pr = p.getBoundingClientRect();
        left = Math.max(left, pr.left);
        top = Math.max(top, pr.top);
        right = Math.min(right, pr.right);
        bottom = Math.min(bottom, pr.bottom);
      }
      return { left, top, right: Math.max(right, left), bottom: Math.max(bottom, top) };
    };
    const textRects = (node: Text) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    };
    const texts = (root: Node) => {
      const out: Text[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (!(n.textContent ?? "").trim()) continue;
        const el = n.parentElement;
        if (el && shown(el) && !formField(el)) out.push(n);
      }
      return out;
    };

    const clipped: string[] = [];
    const all = Array.from(document.body.querySelectorAll("*"));
    for (const el of all) {
      if (!shown(el)) continue;
      const cs = getComputedStyle(el);
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
      const holder = el.matches(HOLDERS);
      const over = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      // Text or a control's content that runs out of its own box, even where the box lets it show (review SIZE-4): a
      // label hanging below its button, a word drawn into the next cell. Scroll areas and form fields scroll their own.
      if ((ownText || holder) && cs.display !== "inline" && !formField(el) && !scroller(cs) && el.clientWidth > 1 && over && !cutsOff(cs)) {
        clipped.push(`${name(el)} spills its box (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
        continue;
      }
      if (ownText && cutsOff(cs) && !drawsEllipsis(el, cs) && over) {
        clipped.push(`${name(el)} cut (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
        continue;
      }
      if (ownText) {
        const r = el.getBoundingClientRect();
        if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && cs.position !== "fixed") clipped.push(`${name(el)} past the side (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
      }
    }
    // Words that run out of the control or cell they belong to, even when they sit in a child span that grows to fit
    // them (the iOS segment's label, a row's value, a day's words: review 2 CLOSE-1, DELTA-1, REACH-2).
    for (const holder of all) {
      if (!holder.matches(HOLDERS) || !shown(holder)) continue;
      const box = holder.getBoundingClientRect();
      for (const node of texts(holder)) {
        // Only the part of the words a person can see, cut by any clipping box inside the control (an ellipsis box).
        const out = textRects(node)
          .map((r) => clipBy({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, node.parentElement, holder))
          .find((r) => r.right - r.left > 1 && r.bottom - r.top > 1 && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1));
        if (out) {
          clipped.push(`${name(holder)}: "${(node.textContent ?? "").trim().slice(0, 24)}" runs out of it (${Math.round(out.left)}–${Math.round(out.right)} × ${Math.round(out.top)}–${Math.round(out.bottom)} in ${Math.round(box.left)}–${Math.round(box.right)} × ${Math.round(box.top)}–${Math.round(box.bottom)})`);
          break;
        }
      }
    }
    // A box that clips (overflow hidden or clip, not a scroll area) and has more content than it shows cuts it off,
    // whether that is its own text, a child's, or a control with no words (review SIZE-4, review 2 CLOSE-1).
    for (const el of all) {
      if (!shown(el) || formField(el)) continue;
      const cs = getComputedStyle(el);
      if (!cutsOff(cs) || scroller(cs) || el.clientWidth <= 2 || el.clientHeight <= 2 || drawsEllipsis(el, cs)) continue;
      if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) continue;
      if ((el.textContent ?? "").trim() || el.querySelector(CONTROLS)) clipped.push(`${name(el)} cuts its content (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
    }
    // A field's value wider than the field (review 2 CLOSE-2): a closed select cannot be scrolled, and a field someone is
    // not typing in shows only its start. Fine when it ends in an ellipsis on purpose; a focused field scrolls its text.
    const ruler = document.createElement("canvas").getContext("2d");
    for (const el of all) {
      if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement) || !shown(el) || !ruler) continue;
      if (el instanceof HTMLInputElement && (!["text", "search", "email", "tel", "url", "number", ""].includes(el.getAttribute("type") ?? "") || el === document.activeElement)) continue;
      const value = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? "") : el.value || el.placeholder;
      if (!value.trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis") continue;
      ruler.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el instanceof HTMLSelectElement && cs.appearance !== "none" ? 20 : 0);
      const width = ruler.measureText(value).width;
      if (width > room + 1) clipped.push(`${name(el)} value "${value.slice(0, 24)}" cut (${Math.round(width)} in ${Math.round(room)})`);
    }

    // ---- what covers what, on screen, at every scroll position of each screen-level scroller ----
    const modals = Array.from(document.querySelectorAll("[aria-modal='true']")).filter(shown);
    const modal = modals.length > 0 ? modals[modals.length - 1]! : null;
    const overlaps = new Set<string>();
    const overText = new Set<string>();
    const visibleRect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      const box = clipBy({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, el.parentElement, null);
      return { left: Math.max(box.left, 0), top: Math.max(box.top, 0), right: Math.min(box.right, vw), bottom: Math.min(box.bottom, window.innerHeight) };
    };
    const measure = (atRest: boolean) => {
      // Sticky parts count with the page at rest; once scrolled, content passes under them by design.
      const sameLayer = (a: string, b: string) => a === b || (atRest && a !== "fixed" && b !== "fixed");
      const controls = Array.from((modal ?? document).querySelectorAll(CONTROLS))
        .filter(shown)
        .map((el) => ({ el, r: visibleRect(el), layer: layer(el) }))
        .filter(({ r }) => r.right - r.left > 1 && r.bottom - r.top > 1);
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!;
          const b = controls[j]!;
          if (!sameLayer(a.layer, b.layer)) continue;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          // A label that wraps its own input is one control.
          if (a.el.closest("label") && a.el.closest("label") === b.el.closest("label")) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 4 && h > 4) overlaps.add(`${name(a.el)} × ${name(b.el)} (${Math.round(w)}×${Math.round(h)})`);
        }
      }
      // Glyphs drawn over other glyphs (review SIZE-4, REG-3): each text's line boxes, as the reader sees them (cut by
      // the scroll areas around them), must not cover another text's, or another line of the same text, by more than a
      // quarter of the smaller one's height: a font's glyph box is taller than its size, and CJK fonts' more so.
      const lines: Array<{ node: Text; layer: string; r: Box }> = [];
      for (const node of texts(modal ?? document.body)) {
        const el = node.parentElement!;
        const box = visibleRect(el);
        if (box.right - box.left <= 1 || box.bottom - box.top <= 1) continue;
        const where = layer(el);
        for (const r of textRects(node)) {
          const cut = { left: Math.max(r.left, box.left), top: Math.max(r.top, box.top), right: Math.min(r.right, box.right), bottom: Math.min(r.bottom, box.bottom) };
          if (cut.right - cut.left > 1 && cut.bottom - cut.top > 1) lines.push({ node, layer: where, r: cut });
        }
      }
      for (let i = 0; i < lines.length && overText.size < 20; i++) {
        for (let j = i + 1; j < lines.length && overText.size < 20; j++) {
          const a = lines[i]!;
          const b = lines[j]!;
          if (!sameLayer(a.layer, b.layer)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          const smaller = Math.min(a.r.bottom - a.r.top, b.r.bottom - b.r.top);
          if (w > 3 && h > Math.max(3, smaller * 0.25)) overText.add(`text "${(a.node.textContent ?? "").trim().slice(0, 24)}" over "${(b.node.textContent ?? "").trim().slice(0, 24)}" (${Math.round(w)}×${Math.round(h)})`);
        }
      }
    };
    // Every screen-level scroller (the page itself, an app screen's own scroll area, a matrix's, a dialog's body). The at-rest
    // pass is at the top of all of them, wherever the page was left (review 3 SHUT-1). Then each is stepped through its
    // whole height by a little less than the part of it that is on screen; one inside another is first brought into view
    // (review 3 SHUT-2). Everything is put back where it was.
    const root = document.scrollingElement ?? document.documentElement;
    const screenScrollers = all.filter((el) => {
      if (!shown(el)) return false;
      const cs = getComputedStyle(el);
      return ["auto", "scroll"].includes(cs.overflowY) && el.clientHeight >= window.innerHeight * 0.4;
    });
    const scrollers = [root, ...screenScrollers].filter((el) => el.scrollHeight > el.clientHeight + 1 && (!modal || el === root || modal.contains(el)));
    // Every scroll position bringing one into view can move (any scroll area, either axis), to put back after.
    const saved = [root, ...all.filter((el) => scroller(getComputedStyle(el)))].map((el) => [el, el.scrollTop, el.scrollLeft] as const);
    const toTop = () => scrollers.forEach((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    toTop();
    measure(true);
    for (const el of scrollers) {
      toTop();
      let visible = el === root ? window.innerHeight : 0;
      if (el !== root) {
        el.scrollIntoView({ block: "start", behavior: "instant" });
        const r = el.getBoundingClientRect();
        const box = clipBy({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, el.parentElement, null);
        visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
        if (scrollers.some((other) => other !== el && other.contains(el) && other.scrollTop > 0)) measure(false);
      }
      const step = Math.max(40, Math.floor(visible * 0.75));
      const end = el.scrollHeight - el.clientHeight;
      for (let y = step; ; y = Math.min(y + step, end)) {
        el.scrollTo({ top: Math.min(y, end), behavior: "instant" });
        measure(false);
        if (y >= end) break;
      }
    }
    for (const [el, top, left] of saved) el.scrollTo({ top, left, behavior: "instant" });
    // Wider than the screen: the document, or a screen's own full-width scroll area (the iOS results, editor, details or
    // compare scroller), which a person would have to drag sideways (T22 review PROD-1). A narrower or shorter scroller
    // (the matrix, a table, the filter chips) scrolls sideways by design and is left out.
    const screenWide = all
      .filter((el) => shown(el) && scroller(getComputedStyle(el)) && el.clientWidth >= vw - 1 && el.clientHeight >= window.innerHeight * 0.4)
      .reduce((most, el) => Math.max(most, el.scrollWidth - el.clientWidth), 0);
    const overflowX = Math.max(0, document.documentElement.scrollWidth - vw, screenWide > 1 ? screenWide : 0);
    return { overflowX, clipped: clipped.slice(0, 20), overlaps: [...[...overlaps].slice(0, 20), ...overText] };
  });
}

/**
 * The iOS shell never scrolls its document: each screen scrolls its own area, and the header and tab bar stay put.
 * A document taller than the screen lets a drag slide the whole shell off, leaving the screen half blank (T21 review 2
 * REACH-1). The Web scrolls its document on purpose, so this is for the iOS surface only.
 */
export async function documentScrolls(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight));
}
