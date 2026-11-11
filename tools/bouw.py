#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Henri ter Hofte
# SPDX-License-Identifier: EUPL-1.2
"""Bouwt de site uit één git-commit, reproduceerbaar: dezelfde commit geeft byte voor byte dezelfde bestanden.

    python tools/bouw.py                       # commit HEAD -> _site/
    python tools/bouw.py --commit 1a2b3c --uit /tmp/site

Leest de bestanden met 'git show <commit>:<pad>' (dus niet uit de werkmap, en zonder
Windows-regeleinden). Verder gebeurt er bijna niets:
  - sw.js:     de cachenaam 'betaalqr-dev' wordt 'betaalqr-<commit>' (zodat elke uitrol de cache vernieuwt);
  - versie.js: nieuw, met de commit en de commitdatum (getoond onderaan de app);
  - sha256.json: nieuw, de SHA-256 van elk ander bestand plus de commit.
Alle andere bestanden zijn exact gelijk aan de repository. Alleen standaardbibliotheek.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

BESTANDEN = [
    "index.html", "controleer.html", "style.css", "app.js", "epc.js", "sw.js",
    "vendor/qrcode.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
]


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def bouw(commit: str, uit: Path) -> dict:
    commit = git("rev-parse", "--verify", commit + "^{commit}").decode().strip()
    datum = git("show", "-s", "--format=%cI", commit).decode().strip()
    if uit.exists():
        shutil.rmtree(uit)
    bestanden: dict[str, bytes] = {}
    for pad in BESTANDEN:
        bestanden[pad] = git("show", f"{commit}:{pad}")

    sw = bestanden["sw.js"]
    if sw.count(b"'betaalqr-dev'") != 1:
        sys.exit("sw.js: verwacht precies een keer 'betaalqr-dev'")
    bestanden["sw.js"] = sw.replace(b"'betaalqr-dev'", f"'betaalqr-{commit[:12]}'".encode())
    # REUSE-IgnoreStart (dit is de kop van het gemaakte versie.js, niet van dit bestand)
    bestanden["versie.js"] = (
        "// SPDX-FileCopyrightText: 2026 Henri ter Hofte\n"
        "// SPDX-License-Identifier: EUPL-1.2\n"
        "// Gemaakt door tools/bouw.py: uit welke commit deze site is gebouwd.\n"
        f"self.BETAALQR_BRON = {json.dumps({'commit': commit, 'datum': datum})};\n"
    ).encode()
    # REUSE-IgnoreEnd

    hashes = {p: hashlib.sha256(b).hexdigest() for p, b in sorted(bestanden.items())}
    manifest = {"bron": {"repo": "henriterhofte/betaal-qr", "commit": commit, "datum": datum}, "sha256": hashes}
    bestanden["sha256.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()

    for pad, inhoud in bestanden.items():
        doel = uit / pad
        doel.parent.mkdir(parents=True, exist_ok=True)
        doel.write_bytes(inhoud)
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", default="HEAD")
    ap.add_argument("--uit", type=Path, default=Path("_site"))
    a = ap.parse_args()
    m = bouw(a.commit, a.uit)
    print(f"Gebouwd uit {m['bron']['commit']} naar {a.uit}/")
    for p, h in m["sha256"].items():
        print(f"  {h}  {p}")


if __name__ == "__main__":
    main()
