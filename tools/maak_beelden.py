#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Henri ter Hofte
# SPDX-License-Identifier: EUPL-1.2
"""Maakt de app-iconen en de previewafbeelding voor social media opnieuw.

    python tools/maak_beelden.py

- icon.svg, icon-192.png, icon-512.png: het app-icoon (petrol, drie QR-hoeken en een euroteken);
- icon-maskable-512.png: dezelfde, met ruimte rondom, voor Android (die snijdt iconen bij in een vorm);
- beeld/og.png: de preview (1200 x 630) als iemand de site deelt, gemaakt van tools/og.html.
Nodig: Pillow, segno, playwright met Chrome. Alleen nodig als je de beelden wilt veranderen.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFont

WORTEL = Path(__file__).resolve().parent.parent
PETROL = "#0d5a62"
LEISTEEN = "#1c2b30"

SVG = f"""<!-- SPDX-FileCopyrightText: 2026 Henri ter Hofte
     SPDX-License-Identifier: EUPL-1.2 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="{PETROL}"/>
  <g fill="none" stroke="#fff" stroke-width="28">
    <rect x="86" y="86" width="112" height="112" rx="10"/>
    <rect x="314" y="86" width="112" height="112" rx="10"/>
    <rect x="86" y="314" width="112" height="112" rx="10"/>
  </g>
  <g fill="#fff">
    <rect x="122" y="122" width="40" height="40"/>
    <rect x="350" y="122" width="40" height="40"/>
    <rect x="122" y="350" width="40" height="40"/>
  </g>
  <text x="370" y="420" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="170" fill="#fff" text-anchor="middle">€</text>
</svg>
"""


def teken(maskable: bool) -> Image.Image:
    s = 512
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, s - 1, s - 1], fill=PETROL)   # volle achtergrond: Android snijdt zelf bij
        schaal, mid = 0.72, s / 2                       # inhoud binnen de veilige cirkel (80 %)
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], 96, fill=PETROL)
        schaal, mid = 1.0, s / 2
    t = lambda v: mid + (v - mid) * schaal                # noqa: E731
    for x, y in [(86, 86), (314, 86), (86, 314)]:
        d.rounded_rectangle([t(x), t(y), t(x + 112), t(y + 112)], 10 * schaal, outline="white", width=round(28 * schaal))
        d.rectangle([t(x + 36), t(y + 36), t(x + 76), t(y + 76)], fill="white")
    f = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf" if Path("C:/Windows/Fonts/arialbd.ttf").exists()
                           else "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", round(170 * schaal))
    d.text((t(370), t(420)), "€", font=f, fill="white", anchor="ms")
    return im


def iconen() -> None:
    (WORTEL / "icon.svg").write_text(SVG, encoding="utf-8", newline="\n")
    gewoon = teken(False)
    for maat in (192, 512):
        gewoon.resize((maat, maat), Image.LANCZOS).save(WORTEL / f"icon-{maat}.png", optimize=True)
    teken(True).convert("RGB").save(WORTEL / "icon-maskable-512.png", optimize=True)
    print("iconen gemaakt")


def og() -> None:
    from playwright.sync_api import sync_playwright
    q = segno.make("https://betaal.terhofte.net", error="m", micro=False)
    buf = io.BytesIO()
    q.save(buf, kind="png", scale=12, border=2, dark="#172326", light="#ffffff")
    html = (WORTEL / "tools" / "og.html").read_text(encoding="utf-8")
    html = html.replace("QR_DATA_URI", "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
    html = html.replace("ICOON_SVG", SVG.split("-->", 1)[1].strip().replace("<svg ", '<svg width="44" height="44" ', 1))
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome")
        pg = br.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        pg.set_content(html)
        pg.screenshot(path=str(WORTEL / "beeld" / "og.png"))
        br.close()
    Image.open(WORTEL / "beeld" / "og.png").convert("RGB").save(WORTEL / "beeld" / "og.png", optimize=True)
    print("beeld/og.png gemaakt")


if __name__ == "__main__":
    iconen()
    og()
