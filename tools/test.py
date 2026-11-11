#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Henri ter Hofte
# SPDX-License-Identifier: EUPL-1.2
"""Tests in een echte Chrome (Playwright), via een lokale webserver op de werkmap.

    python tools/test.py                         # unit-tests + testfacturen in tests/facturen/
    python tools/test.py --pdf factuur.pdf ...   # ook eigen PDF's inlezen (alleen tonen, niets bewaren)

1. test.html: de unit-tests van epc.js en factuur.js; de gemaakte QR-code wordt teruggelezen met OpenCV.
2. index.html: elke testfactuur wordt in de echte app geopend (met de echte Content-Security-Policy);
   de ingevulde velden en meldingen worden vergeleken met <naam>.verwacht.json.
3. Overtredingen van de CSP in de console laten de test falen.

Nodig: playwright (pip), Chrome; voor de QR-controle opencv-python-headless, numpy en Pillow.
Eindcode 0 = alles goed.
"""
from __future__ import annotations

import argparse
import base64
import functools
import http.server
import io
import json
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

WORTEL = Path(__file__).resolve().parent.parent
FACTUREN = WORTEL / "tests" / "facturen"
VERWACHT_QR = ("BCD\n002\n1\nSCT\nRABONL2U\nB.V. Bouwbedrijf Hoffman Beltrum-Zutphen\n"
               "NL23RABO0105502855\nEUR9669.30\n\n\nFactuur 2632601")
fouten = 0


def meld(ok: bool, tekst: str) -> None:
    global fouten
    if not ok:
        fouten += 1
    print(("ok   " if ok else "FOUT ") + tekst)


class StilleHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def log_message(self, *args):
        pass


def wacht_tot(pg, selector: str, test, timeout: float = 30) -> str:
    """Pollt de tekst van een element (zonder eval, dat de CSP verbiedt)."""
    eind = time.time() + timeout
    tekst = ""
    while time.time() < eind:
        tekst = pg.inner_text(selector) if pg.locator(selector).count() else ""
        if test(tekst):
            return tekst
        time.sleep(0.2)
    return tekst


def unit(pg, basis: str) -> None:
    pg.goto(basis + "test.html")
    uit = wacht_tot(pg, "#uitkomst", lambda t: "GESLAAGD" in t or "MISLUKT" in t)
    for regel in uit.splitlines():
        if regel.startswith("FOUT") or regel.startswith("     "):
            print(regel)
    meld(uit.rstrip().endswith("ALLE TESTS GESLAAGD"), f"unit-tests ({sum(1 for r in uit.splitlines() if r.startswith('ok'))} geslaagd)")
    gif = pg.inner_text("#qr-gif")
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError:
        print("     QR-controle overgeslagen (opencv/numpy/Pillow ontbreekt)")
        return
    beeld = Image.open(io.BytesIO(base64.b64decode(gif.split(",", 1)[1]))).convert("L")
    tekst, _, _ = cv2.QRCodeDetector().detectAndDecode(np.array(beeld))
    meld(tekst == VERWACHT_QR, "QR-code door OpenCV teruggelezen: inhoud exact gelijk aan de EPC-verwachting")


def open_factuur(pg, basis: str, pdf: Path) -> str:
    pg.goto(basis + "index.html")
    pg.set_input_files("#factuur-bestand", str(pdf))
    return wacht_tot(pg, "#factuur-status", lambda t: t and "wordt gelezen" not in t)


def velden(pg) -> dict:
    return {v: pg.input_value("#" + v) for v in ["naam", "iban", "bic", "bedrag", "omschrijving"]}


def naar_controle(pg) -> dict:
    pg.click("#naar2")
    return {"waarschuwingen": pg.inner_text("#waarschuwingen"),
            "verval": pg.inner_text("#c-verval") if pg.is_visible("#c-verval") else "",
            "herkomst": pg.text_content("#c-herkomst-lijst") or ""}


def facturen(pg, basis: str) -> None:
    for pdf in sorted(FACTUREN.glob("*.pdf")):
        verwacht = json.loads(pdf.with_suffix(".verwacht.json").read_text(encoding="utf-8"))
        status = open_factuur(pg, basis, pdf)
        if "status" in verwacht:
            meld(verwacht["status"] in status, f"{pdf.name}: status bevat '{verwacht['status']}' ({status[:70]}…)")
            continue
        v = velden(pg)
        for k in ["naam", "iban", "bic", "bedrag", "omschrijving"]:
            if k in verwacht:
                meld(v[k] == verwacht[k], f"{pdf.name}: {k} = {v[k]!r}" + ("" if v[k] == verwacht[k] else f" (verwacht {verwacht[k]!r})"))
        if "statusbevat" in verwacht:
            meld(verwacht["statusbevat"] in status, f"{pdf.name}: melding bevat '{verwacht['statusbevat']}'")
        if verwacht.get("iban") == "":
            continue   # zonder IBAN kan stap 2 niet
        if "geblokkeerd" in verwacht:
            titel = pg.inner_text("#fm-titel") if pg.is_visible("#factuur-melding") else ""
            meld(verwacht["geblokkeerd"] in titel, f"{pdf.name}: melding '{titel}'")
            meld(pg.is_disabled("#naar2") and not pg.is_editable("#bedrag"), f"{pdf.name}: gegevens grijs en 'Volgende' uit")
            pg.click("#fm-toch")
            meld(pg.is_enabled("#naar2") and pg.is_editable("#bedrag"), f"{pdf.name}: 'Toch betalen' geeft vrij")
        c = naar_controle(pg)
        if "geblokkeerd" in verwacht:
            meld("toch te betalen" in c["waarschuwingen"], f"{pdf.name}: stap 2 waarschuwt dat je toch betaalt")
        if "vervaldatum" in verwacht:
            j, m, d = verwacht["vervaldatum"].split("-")
            meld(f"{d}-{m}-{j}" in c["verval"], f"{pdf.name}: betalen vóór {c['verval']!r}")
        if "waarschuwing" in verwacht:
            meld(verwacht["waarschuwing"] in c["waarschuwingen"], f"{pdf.name}: waarschuwing '{verwacht['waarschuwing']}'")
        if "vervaldatum" in verwacht:
            herinnering(pg, pdf.name, verwacht)


def herinnering(pg, naam: str, verwacht: dict) -> None:
    """Stap 3: datum vooraf ingevuld; .ics downloaden en met icalendar (onafhankelijk) controleren."""
    pg.click("#naar3")
    meld(pg.input_value("#betaaldatum") == verwacht["vervaldatum"], f"{naam}: betaaldatum in stap 3 = {pg.input_value('#betaaldatum')!r}")
    pg.fill("#betaaldatum", "2026-12-01")   # de datum moet aan te passen zijn
    with pg.expect_download() as dl:
        pg.click("#ics")
    data = Path(dl.value.path()).read_bytes()
    try:
        from icalendar import Calendar
    except ImportError:
        print("     .ics-controle overgeslagen (icalendar ontbreekt)")
        return
    ev = Calendar.from_ical(data).walk("VEVENT")[0]
    beschrijving = str(ev.get("DESCRIPTION"))
    bijlage = ev.get("ATTACH")
    meld(str(ev.decoded("DTSTART")) == "2026-12-01", f"{naam}: .ics op aangepaste datum ({ev.decoded('DTSTART')})")
    meld(verwacht["iban"] in beschrijving and verwacht["bedrag"] in beschrijving, f"{naam}: .ics bevat IBAN en bedrag")
    meld(bijlage is not None and data.count(b"BEGIN:VALARM") == 2, f"{naam}: .ics heeft QR-bijlage en twee meldingen")
    if bijlage is not None:
        try:
            import cv2
            import numpy as np
            png = base64.b64decode(bijlage.to_ical()) if not isinstance(bijlage, bytes) else bijlage
            beeld = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
            tekst, _, _ = cv2.QRCodeDetector().detectAndDecode(beeld)
            meld(tekst.startswith("BCD") and verwacht["iban"].replace(" ", "") in tekst, f"{naam}: QR in de .ics is leesbaar en klopt")
        except ImportError:
            pass


def doneren(pg, basis: str) -> None:
    """De doneervraag: zichtbaar, weg te klikken (ook na herladen), en via de kopbalk altijd terug te halen."""
    pg.goto(basis + "index.html")
    meld(pg.is_visible("#doneren") and pg.is_visible("#doneren img"), "doneren: vast blok met foto zichtbaar in stap 1")
    pg.click("#doneren [data-doneer=later]")
    meld(not pg.is_visible("#doneren"), "doneren: 'Niet nu' verbergt het blok")
    pg.reload()
    meld(not pg.is_visible("#doneren"), "doneren: na herladen nog steeds verborgen")
    pg.click("#naar-doneren")
    meld(pg.is_visible("#doneren"), "doneren: knop in de kopbalk toont het toch")
    pg.click("#doneren [data-doneer=gedaan]")
    meld("Dank je wel" in pg.inner_text("main"), "doneren: 'Al gedaan' geeft een bedankje")


def eigen(pg, basis: str, paden: list[str]) -> None:
    for p in paden:
        pdf = Path(p)
        print(f"\n== {pdf.name}")
        print("   status:", open_factuur(pg, basis, pdf))
        for k, w in velden(pg).items():
            print(f"   {k:13} {w}")
        try:
            c = naar_controle(pg)
            print("   vervaldatum  ", c["verval"] or "-")
            for r in c["waarschuwingen"].splitlines():
                print("   melding:", r)
        except Exception as e:  # stap 2 kan niet als er velden ontbreken
            print("   (stap 2 niet bereikbaar:", str(e).splitlines()[0], ")")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", nargs="*", default=[], help="eigen PDF's om in te lezen (alleen tonen)")
    ap.add_argument("--chrome", default="chrome", help="Playwright-kanaal of pad (standaard: de geïnstalleerde Chrome)")
    a = ap.parse_args()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(StilleHandler, directory=str(WORTEL)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    basis = f"http://127.0.0.1:{server.server_address[1]}/"

    with sync_playwright() as p:
        browser = p.chromium.launch(**({"executable_path": a.chrome} if "/" in a.chrome or "\\" in a.chrome else {"channel": a.chrome}))
        pg = browser.new_page()
        csp = []
        pg.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)
        unit(pg, basis)
        csp.clear()   # test.html heeft geen CSP; vanaf hier telt het
        facturen(pg, basis)
        doneren(pg, basis)
        if a.pdf:
            eigen(pg, basis, a.pdf)
        meld(not csp, "geen CSP-overtredingen in de app" + ("" if not csp else ":\n     " + "\n     ".join(sorted(set(csp))[:5])))
        browser.close()
    server.shutdown()
    print("\nALLES GOED" if not fouten else f"\n{fouten} FOUT(EN)")
    sys.exit(1 if fouten else 0)


if __name__ == "__main__":
    main()
