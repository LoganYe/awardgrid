#!/usr/bin/env python3
"""
The AwardGrid app icon (release decision D6), drawn from code so its provenance is plain: original artwork, with no
airline, alliance, loyalty-program or seats.aero mark, and not Capacitor's placeholder.

What the app does, as one picture: a table of options (two by two, the app's name), one cell of it lit amber, and in
that cell an airliner: the award seat the table finds. The plane is a generic top-down silhouette, nose to the top
right, drawn from the outline below; the field is the app's deep teal accent family. Chosen by the owner on 2026-09-26
from three directions (seat in the grid, flying over the grid, route to the seat).

Drawn at 4096 px and downsampled, then flattened to RGB, because App Store Connect rejects an icon with an alpha
channel. iOS applies the rounded mask itself, so the square is full-bleed.

Not part of the build. Needs Python 3 with Pillow; run from the repository root after changing the art:

    python3 apps/ios/scripts/app-icon.py

and commit the PNG it writes into the asset catalogue.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S, OUT = 4096, 1024
TARGET = Path(__file__).resolve().parent.parent / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
AMBER, INK = (255, 200, 87), (0, 57, 63)

# A top-down airliner, nose up, in units: about 101 long and 94 across the wings. The left side mirrors the right.
_RIGHT = [(0, -50), (2.5, -48.5), (4.5, -45.5), (5.8, -41), (6, -36), (6, -10), (47, 12), (47, 19), (6, 6), (6, 30),
          (19, 42), (19, 47), (5.5, 43), (3.5, 50), (0, 51.5)]
PLANE = _RIGHT + [(-x, y) for (x, y) in reversed(_RIGHT[1:-1])]


def rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background() -> Image.Image:
    top, bottom = rgb("#0A8A94"), rgb("#00393F")
    column = Image.new("RGB", (1, S))
    for y in range(S):
        column.putpixel((0, y), mix(top, bottom, y / (S - 1)))
    return column.resize((S, S)).convert("RGBA")


def plane(cx: float, cy: float, scale: float, degrees: float) -> list[tuple[float, float]]:
    """The outline, scaled, turned clockwise by `degrees` (0 = nose up) and centred on (cx, cy)."""
    t = math.radians(degrees)
    c, s = math.cos(t), math.sin(t)
    return [(cx + (x * c - y * s) * scale, cy + (x * s + y * c) * scale) for (x, y) in PLANE]


def draw() -> Image.Image:
    cell, gap, radius = 1480, 180, 280
    width = 2 * cell + gap
    x0 = y0 = (S - width) // 2
    boxes = {(r, c): (x0 + c * (cell + gap), y0 + r * (cell + gap), x0 + c * (cell + gap) + cell, y0 + r * (cell + gap) + cell)
             for r in range(2) for c in range(2)}
    lit = boxes[(0, 1)]

    cells = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(cells)
    for box in boxes.values():
        if box != lit:
            d.rounded_rectangle(box, radius=radius, fill=(255, 255, 255, 56))

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lx0, ly0, lx1, ly1 = lit
    ImageDraw.Draw(glow).rounded_rectangle((lx0 - 70, ly0 - 70, lx1 + 70, ly1 + 70), radius=radius + 70, fill=AMBER + (170,))
    glow = glow.filter(ImageFilter.GaussianBlur(150))

    seat = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seat)
    sd.rounded_rectangle(lit, radius=radius, fill=AMBER + (255,))
    sd.polygon(plane((lx0 + lx1) / 2, (ly0 + ly1) / 2, 10.4, 45), fill=INK + (255,))

    image = Image.alpha_composite(background(), glow)
    image = Image.alpha_composite(image, cells)
    image = Image.alpha_composite(image, seat)
    return image.convert("RGB").resize((OUT, OUT), Image.LANCZOS)


if __name__ == "__main__":
    icon = draw()
    assert icon.mode == "RGB" and icon.size == (OUT, OUT)
    icon.save(TARGET, "PNG", optimize=True)
    print(f"wrote {TARGET} ({OUT}x{OUT}, RGB, no alpha)")
