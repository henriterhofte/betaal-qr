#!/usr/bin/env python3
"""Draait test.html in headless Chrome en leest de gemaakte QR-code terug met OpenCV.

    python tools/test.py [--chrome PAD]

Nodig: Chrome of Chromium; voor de QR-controle opencv-python-headless, numpy en Pillow.
Eindcode 0 = alles goed.
"""
from __future__ import annotations

import argparse
import base64
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WORTEL = Path(__file__).resolve().parent.parent
VERWACHT = ("BCD\n002\n1\nSCT\nRABONL2U\nB.V. Bouwbedrijf Hoffman Beltrum-Zutphen\n"
            "NL23RABO0105502855\nEUR9669.30\n\n\nFactuur 2632601")


def zoek_chrome() -> str:
    for kandidaat in [
        shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ]:
        if kandidaat and Path(kandidaat).exists():
            return kandidaat
    sys.exit("Chrome niet gevonden: geef --chrome")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as profiel:
        dom = subprocess.run(
            [a.chrome or zoek_chrome(), "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
             f"--user-data-dir={profiel}", "--allow-file-access-from-files", "--virtual-time-budget=3000",
             "--dump-dom", (WORTEL / "test.html").as_uri()],
            capture_output=True, text=True, encoding="utf-8", timeout=120).stdout

    m = re.search(r'<pre id="uitkomst">(.*?)</pre>', dom, re.S)
    if not m:
        sys.exit("Geen testuitkomst in de pagina")
    uitkomst = html.unescape(m.group(1))
    print(uitkomst)
    fout = not uitkomst.rstrip().endswith("ALLE TESTS GESLAAGD")

    g = re.search(r'<pre id="qr-gif">data:image/gif;base64,([^<]+)</pre>', dom)
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError:
        print("QR-controle overgeslagen (opencv/numpy/Pillow ontbreekt)")
    else:
        beeld = Image.open(io.BytesIO(base64.b64decode(g.group(1)))).convert("L")
        tekst, _, _ = cv2.QRCodeDetector().detectAndDecode(np.array(beeld))
        if tekst == VERWACHT:
            print("ok   QR-code door OpenCV gelezen: inhoud exact gelijk aan de EPC-verwachting")
        else:
            print(f"FOUT QR-code gelezen als {tekst!r}")
            fout = True
    sys.exit(1 if fout else 0)


if __name__ == "__main__":
    main()
