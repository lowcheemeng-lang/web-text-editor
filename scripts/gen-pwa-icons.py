#!/usr/bin/env python3
"""Regenerate the PWA icons in `public/` — Task 8.

    python3 scripts/gen-pwa-icons.py

The app's favicon is an inline SVG data URI (`index.html`), which cannot be used
for the manifest's `icons`: a browser wants a raster icon of a known size to put on
a task bar, and Chrome's installability criteria name 192x192 and 512x512. So the
same mark is drawn here into real PNGs, and this script is the record of how — an
icon nobody can regenerate is an icon that can never be corrected.

The mark is the favicon's: a 1e88e5 rounded square with a white monospace "N",
which is what the tab has shown since Task 2.

Two flavours come out of it:

  icon-192.png, icon-512.png            the ordinary icon (`purpose: any`)
  icon-maskable-512.png                 full-bleed, mark inside the 80% safe zone

A maskable icon is not decoration: Android and Chrome's own install UI crop the
icon to whatever shape the platform uses (circle, squircle, teardrop) and only
guarantee the middle 80% of the image, so a rounded-square icon with its own
corners gets its corners cut off. The maskable variant therefore paints the
background edge to edge and keeps the letter inside the safe area. (D12 keeps
phones out of the MVP, but the icon costs nothing and the manifest stays honest
about what it is.)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PUBLIC = Path(__file__).resolve().parent.parent / "public"
BACKGROUND = (30, 136, 229)  # 1e88e5, the favicon's blue
INK = (255, 255, 255)
# DejaVu Sans Mono Bold: the same family the editor's own UI ships for code, and the
# closest thing on this machine to the favicon's generic `monospace`.
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
FONT_FALLBACK = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def draw_mark(size: int, *, maskable: bool) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if maskable:
        # Full bleed: the platform supplies the shape, so the icon must not.
        draw.rectangle((0, 0, size - 1, size - 1), fill=BACKGROUND)
        glyph_box = size * 0.56  # inside the guaranteed 80% circle
    else:
        radius = round(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BACKGROUND)
        glyph_box = size * 0.62

    font_path = FONT if Path(FONT).exists() else FONT_FALLBACK
    font = ImageFont.truetype(font_path, size=max(1, round(glyph_box)))
    box = draw.textbbox((0, 0), "N", font=font)
    width, height = box[2] - box[0], box[3] - box[1]
    # Centre on the glyph's own bounding box, not on the font's ascent/descent:
    # a monospace "N" sits above the baseline centre, and this is what makes it look
    # centred rather than low.
    draw.text(
        ((size - width) / 2 - box[0], (size - height) / 2 - box[1]),
        "N",
        font=font,
        fill=INK,
    )
    return image


def main() -> int:
    PUBLIC.mkdir(exist_ok=True)
    written: list[tuple[str, int, int]] = []
    for name, size, maskable in (
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ):
        path = PUBLIC / name
        image = draw_mark(size, maskable=maskable)
        image.save(path, format="PNG", optimize=True)
        written.append((name, size, path.stat().st_size))
    for name, size, bytes_ in written:
        print(f"{name:24} {size}x{size}  {bytes_} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
