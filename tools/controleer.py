#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Henri ter Hofte
# SPDX-License-Identifier: EUPL-1.2
"""Controleert dat wat op de site draait, gebouwd is uit de openbare broncode.

    git clone https://github.com/henriterhofte/betaal-qr && cd betaal-qr
    python tools/controleer.py                         # tegen https://betaal.terhofte.net/

Werkwijze:
  1. haalt sha256.json van de site en leest daaruit de commit;
  2. bouwt die commit zelf opnieuw (tools/bouw.py, in een tijdelijke map);
  3. vergelijkt elk zelf gebouwd bestand met sha256.json;
  4. downloadt elk bestand van de site en vergelijkt het ook daarmee.
Alleen standaardbibliotheek. Eindcode 0 = alles gelijk, 1 = verschil.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bouw import bouw  # noqa: E402


def haal(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "betaal-qr-controle", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="https://betaal.terhofte.net/")
    a = ap.parse_args()
    basis = a.url.rstrip("/") + "/"

    live = json.loads(haal(basis + "sha256.json"))
    commit = live["bron"]["commit"]
    print(f"Live gebouwd uit commit {commit} ({live['bron'].get('datum', '?')})")
    try:
        subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        sys.exit(f"Commit {commit} staat niet in deze clone: eerst 'git fetch origin'.")

    fouten = 0
    with tempfile.TemporaryDirectory() as tmp:
        eigen = bouw(commit, Path(tmp) / "site")

    if eigen["sha256"] != live["sha256"]:
        for p in sorted(set(eigen["sha256"]) | set(live["sha256"])):
            if eigen["sha256"].get(p) != live["sha256"].get(p):
                print(f"  VERSCHIL build  {p}: eigen {eigen['sha256'].get(p, '-')[:16]}  live {live['sha256'].get(p, '-')[:16]}")
                fouten += 1
    else:
        print(f"  Eigen build gelijk aan sha256.json ({len(eigen['sha256'])} bestanden)")

    for p, h in sorted(live["sha256"].items()):
        echt = hashlib.sha256(haal(basis + p)).hexdigest()
        if echt != h:
            print(f"  VERSCHIL site   {p}: geleverd {echt[:16]}  manifest {h[:16]}")
            fouten += 1
    if not fouten:
        print(f"  Elk bestand op de site klopt met sha256.json")
        print(f"gelijk: wat op {basis} draait, is gebouwd uit commit {commit}")
    else:
        print(f"{fouten} verschil(len) gevonden")
    sys.exit(1 if fouten else 0)


if __name__ == "__main__":
    main()
