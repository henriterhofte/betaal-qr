#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Henri ter Hofte
# SPDX-License-Identifier: EUPL-1.2
"""Maakt de synthetische testfacturen in tests/facturen/ (verzonnen bedrijven, voorbeeld-IBAN's).

    python tools/maak_testfacturen.py

Alleen nodig als je de facturen wilt veranderen; ze staan in de repo. Nodig: segno (QR-codes).
Elke factuur krijgt een <naam>.verwacht.json met wat tools/test.py na het inlezen in de app verwacht.
De PDF's zijn met de hand opgebouwd (Helvetica, WinAnsi), zonder tijdstempels: reproduceerbaar.
"""
from __future__ import annotations

import json
import zlib
from pathlib import Path

import segno

UIT = Path(__file__).resolve().parent.parent / "tests" / "facturen"

# Voorbeeld-IBAN's met een geldig controlegetal (geen echte rekeningen van deze bedrijven).
IBAN_A = "NL91 ABNA 0417 1643 00"
IBAN_B = "NL44 RABO 0123 4567 89"
IBAN_VALS = "NL20 INGB 0001 2345 67"


def mod97_ok(iban: str) -> bool:
    s = iban.replace(" ", "")
    r = s[4:] + s[:4]
    return int("".join(str(int(c, 36)) for c in r)) % 97 == 1


for i in (IBAN_A, IBAN_B, IBAN_VALS):
    assert mod97_ok(i), i


def pdf(pagina_inhoud: list[tuple[list[tuple[float, float, float, str]], tuple | None]]) -> bytes:
    """pagina_inhoud: per pagina ([(x, y_van_boven, grootte, tekst)], afbeelding) met afbeelding = (x, y, maat, pixels, breedte)."""
    objs: list[bytes] = []

    def nieuw(b: bytes) -> int:
        objs.append(b)
        return len(objs)

    font = nieuw(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    kids = []
    page_ids = []
    for teksten, afb in pagina_inhoud:
        ops = []
        res_x = b""
        if afb:
            x, y, maat, pixels, breedte = afb
            img = nieuw(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n"
                        % (breedte, breedte, len(pixels)) + pixels + b"\nendstream")
            res_x = b" /XObject << /Im1 %d 0 R >>" % img
            ops.append(f"q {maat} 0 0 {maat} {x} {842 - y - maat} cm /Im1 Do Q")
        for x, y, grootte, tekst in teksten:
            t = tekst.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"BT /F1 {grootte} Tf {x} {842 - y} Td ({t}) Tj ET")
        stroom = "\n".join(ops).encode("cp1252")
        inhoud = nieuw(b"<< /Length %d >>\nstream\n" % len(stroom) + stroom + b"\nendstream")
        page_ids.append((inhoud, res_x))
    # pagina-objecten na de inhoud
    pages_obj = len(objs) + len(page_ids) + 1
    for inhoud, res_x in page_ids:
        kids.append(nieuw(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >>%s >> >>"
                          % (pages_obj, inhoud, font, res_x)))
    assert nieuw(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))) == pages_obj
    catalog = nieuw(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_obj)

    uit = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(uit))
        uit += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(uit)
    uit += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        uit += b"%010d 00000 n \n" % off
    uit += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    return bytes(uit)


def qr_pixels(tekst: str, schaal: int = 4) -> tuple[bytes, int]:
    q = segno.make(tekst, error="m", micro=False)
    rijen = [list(r) for r in q.matrix_iter(scale=schaal, border=4)]
    breedte = len(rijen)
    ruw = b"".join(bytes(0 if px else 255 for px in r) for r in rijen)
    return zlib.compress(ruw, 9), breedte


def epc(naam, iban, bedrag, oms, bic=""):
    return "\n".join(["BCD", "002", "1", "SCT", bic, naam, iban.replace(" ", ""), bedrag, "", "", oms])


def briefhoofd(naam, iban, bic, nr, datum, regels, totaal, termijn="Betalingen binnen 14 dagen na factuurdatum onder vermelding van het factuurnummer."):
    t = [
        (94, 46, 14, naam), (94, 62, 8, "Voorbeeldstraat 1"), (94, 76, 8, "1234 AB Voorbeeldstad"),
        (94, 128, 20, "Factuur"),
        (94, 166, 10, "Dhr. J. Klant"), (94, 178, 10, "Klantweg 9"), (94, 190, 10, "9876 ZY Klantdorp"),
        (94, 252, 10, "Factuurnummer"), (242, 252, 10, "Uw ordernummer"), (448, 252, 10, "Datum"),
        (94, 264, 10, nr), (448, 264, 10, datum),
        (94, 333, 10, "Omschrijving"), (491, 333, 10, "Totaal in EUR"),
    ]
    y = 365
    for oms, bedrag in regels:
        t += [(94, y, 10, oms), (498, y, 10, bedrag)]
        y += 17
    t += [(94, y + 10, 10, "Totaal excl. BTW"), (498, y + 10, 10, totaal[0]),
          (94, y + 27, 10, "BTW 21 %"), (498, y + 27, 10, totaal[1]),
          (94, y + 50, 10, "Totaal factuurbedrag"), (457, y + 50, 10, "EUR"), (498, y + 50, 10, totaal[2]),
          (94, 732, 8, "Betalingscondities:"), (200, 732, 8, termijn),
          (94, 807, 7, "T. 012-3456789"), (200, 807, 7, "IBAN: " + iban), (320, 807, 7, "BTWnr. NL00 123 4567 B01"),
          (94, 815, 7, "KvK 12345678"), (200, 815, 7, "BIC:"), (221, 815, 7, bic)]
    return t


def main() -> None:
    UIT.mkdir(parents=True, exist_ok=True)
    facturen = {}

    # 1. Kolomindeling zoals veel boekhoudpakketten: labels boven waarden, IBAN in de voettekst,
    #    en een bijlage met een ander (afgerond) totaal dat NIET gekozen mag worden.
    t1 = briefhoofd("Voorbeeld Schilders B.V.", IBAN_A, "ABNANL2A", "2026-0417", "11-11-2026",
                    [("Schilderwerk kozijnen", "1.000,00"), ("Materiaal", "250,00")], ("1.250,00", "262,50", "1.512,50"))
    bijlage = [(84, 100, 16, "Bijlage: specificatie"), (84, 130, 10, "Totaal inclusief B.T.W.: EUR 1.512,46")]
    facturen["kolommen"] = (pdf([(t1, None), (bijlage, None)]), {
        "naam": "Voorbeeld Schilders B.V.", "iban": IBAN_A, "bic": "ABNANL2A", "bedrag": "1.512,50",
        "omschrijving": "Factuur 2026-0417", "vervaldatum": "2026-11-25"})

    # 2. Factuur met een EPC-QR die klopt met de tekst, en een betalingskenmerk.
    naam2 = "Groen Dak Installaties BV"
    t2 = briefhoofd(naam2, IBAN_B, "RABONL2U", "F-8812", "02-11-2026",
                    [("Sedumdak 24 m2", "2.400,00")], ("2.400,00", "504,00", "2.904,00"),
                    termijn="Graag uiterlijk 30-11-2026 betalen o.v.v. betalingskenmerk.")
    t2 += [(94, 560, 10, "Betalingskenmerk: 1234 5678 9012 3456"), (360, 560, 9, "Scan met je bank-app:")]
    px, br = qr_pixels(epc(naam2, IBAN_B, "EUR2904.00", "1234567890123456", "RABONL2U"))
    facturen["met-qr"] = (pdf([(t2, (360, 575, 110, px, br))]), {
        "naam": naam2, "iban": IBAN_B, "bic": "RABONL2U", "bedrag": "2.904,00",
        "omschrijving": "1234567890123456", "vervaldatum": "2026-11-30"})

    # 3. "Vervalst": een opgeplakte QR met een ander IBAN dan in de tekst. De app moet dat melden.
    t3 = briefhoofd(naam2, IBAN_B, "RABONL2U", "F-8813", "03-11-2026",
                    [("Onderhoud", "100,00")], ("100,00", "21,00", "121,00"))
    px3, br3 = qr_pixels(epc("Groen Dak Installaties", IBAN_VALS, "EUR121.00", "Factuur F-8813"))
    facturen["vervalst"] = (pdf([(t3, (360, 575, 110, px3, br3))]), {
        "iban": IBAN_VALS, "bedrag": "121,00", "waarschuwing": "is anders dan het IBAN in de tekst"})

    # 4. Scan: alleen een plaatje, geen tekst.
    pxs, brs = qr_pixels("geen betaal-QR", schaal=2)
    facturen["scan"] = (pdf([([], (100, 100, 60, pxs, brs))]), {"status": "geen tekst"})

    for naam, (data, verwacht) in facturen.items():
        (UIT / f"{naam}.pdf").write_bytes(data)
        (UIT / f"{naam}.verwacht.json").write_text(json.dumps(verwacht, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{naam}.pdf  {len(data)} bytes")


if __name__ == "__main__":
    main()
