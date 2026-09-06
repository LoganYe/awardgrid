import { describe, expect, it } from "vitest";
import { BOTTOM_SHEET_DISMISS_PX, DRAG_SLOP_PX, dragOffset, dragOutcome, isDrag } from "@/components/drawers/drag";

describe("dragOffset", () => {
  it("measures how far down the pointer has moved", () => {
    expect(dragOffset({ startY: 500, currentY: 620 })).toBe(120);
    expect(dragOffset({ startY: 0, currentY: 7 })).toBe(7);
  });

  it("clamps upward movement to zero: a bottom sheet cannot be lifted off the bottom edge", () => {
    expect(dragOffset({ startY: 500, currentY: 400 })).toBe(0);
    expect(dragOffset({ startY: 500, currentY: 500 })).toBe(0);
  });
});

describe("dragOutcome", () => {
  it("closes past the 120 px threshold (spec §6)", () => {
    expect(BOTTOM_SHEET_DISMISS_PX).toBe(120);
    expect(dragOutcome(121)).toBe("dismiss");
    expect(dragOutcome(400)).toBe("dismiss");
  });

  it("springs back at or below the threshold", () => {
    expect(dragOutcome(0)).toBe("settle");
    expect(dragOutcome(119)).toBe("settle");
    expect(dragOutcome(120)).toBe("settle");
  });

  it("takes a custom threshold", () => {
    expect(dragOutcome(60, 50)).toBe("dismiss");
    expect(dragOutcome(40, 50)).toBe("settle");
  });
});

describe("isDrag", () => {
  it("separates a tap from a drag so the handle's click does not fire twice", () => {
    expect(isDrag(0)).toBe(false);
    expect(isDrag(DRAG_SLOP_PX)).toBe(false);
    expect(isDrag(DRAG_SLOP_PX + 1)).toBe(true);
  });
});
