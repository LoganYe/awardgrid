#!/usr/bin/env python3
"""
The AwardGrid app icon (release decision D6), drawn from code so its provenance is plain: original artwork, with no
airline, alliance, loyalty-program or seats.aero mark, and not Capacitor's placeholder.

A table: a header band over three rows of three rounded cells, on a deep teal field (the app's accent family), with one
cell lit amber: the award seat the table finds. Drawn at 4096 px and downsampled, then flattened to RGB, because App
Store Connect rejects an icon with an alpha channel. iOS applies the rounded mask itself, so the square is full-bleed.

Not part of the build. Needs Python 3 with Pillow; run from the repository root after changing the art:

    python3 apps/ios/scripts/app-icon.py

and commit the PNG it writes into the asset catalogue.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S, OUT = 4096, 1024
TARGET = Path(__file__).resolve().parent.parent / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"


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


def draw() -> Image.Image:
    cell, gap, band, radius = 700, 130, 250, 150
    width = 3 * cell + 2 * gap
    x0 = (S - width) // 2
    y0 = (S - width) // 2 + (band + gap) // 2
    boxes = {(r, c): (x0 + c * (cell + gap), y0 + r * (cell + gap), x0 + c * (cell + gap) + cell, y0 + r * (cell + gap) + cell) for r in range(3) for c in range(3)}
    lit = boxes[(1, 2)]

    cells = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(cells)
    d.rounded_rectangle((x0, y0 - gap - band, x0 + width, y0 - gap), radius=radius, fill=(255, 255, 255, 96))
    for box in boxes.values():
        if box != lit:
            d.rounded_rectangle(box, radius=radius, fill=(255, 255, 255, 52))

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lx0, ly0, lx1, ly1 = lit
    ImageDraw.Draw(glow).rounded_rectangle((lx0 - 60, ly0 - 60, lx1 + 60, ly1 + 60), radius=radius + 60, fill=(255, 200, 87, 170))
    glow = glow.filter(ImageFilter.GaussianBlur(140))

    seat = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(seat).rounded_rectangle(lit, radius=radius, fill=rgb("#FFC857") + (255,))

    image = Image.alpha_composite(background(), glow)
    image = Image.alpha_composite(image, cells)
    image = Image.alpha_composite(image, seat)
    return image.convert("RGB").resize((OUT, OUT), Image.LANCZOS)


if __name__ == "__main__":
    icon = draw()
    assert icon.mode == "RGB" and icon.size == (OUT, OUT)
    icon.save(TARGET, "PNG", optimize=True)
    print(f"wrote {TARGET} ({OUT}x{OUT}, RGB, no alpha)")
