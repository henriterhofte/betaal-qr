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


def als_beeld(teksten, schaal: float = 2.5):
    """Tekent een factuur (dezelfde teksten en posities als de PDF) als plaatje, zoals een scan."""
    from PIL import Image, ImageDraw, ImageFont
    font_pad = next((p for p in ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"] if Path(p).exists()))
    im = Image.new("L", (round(595 * schaal), round(842 * schaal)), 255)
    d = ImageDraw.Draw(im)
    for x, y, grootte, tekst in teksten:
        d.text((x * schaal, y * schaal), tekst, font=ImageFont.truetype(font_pad, round(grootte * schaal)), fill=0, anchor="ls")
    return im


def als_foto(im):
    """Maakt van een scan iets dat op een telefoonfoto lijkt: scheef, met een rand, wat onscherp, JPEG."""
    import io
    from PIL import Image, ImageFilter
    scheef = im.convert("RGB").rotate(-2.2, expand=True, fillcolor=(120, 110, 95), resample=Image.BICUBIC)
    rand = Image.new("RGB", (scheef.width + 160, scheef.height + 200), (120, 110, 95))
    rand.paste(scheef, (70, 110))
    rand = rand.filter(ImageFilter.GaussianBlur(0.8))
    buf = io.BytesIO()
    rand.save(buf, "JPEG", quality=72)
    return buf.getvalue()


def pdf_met_volle_afbeelding(im) -> bytes:
    """Een PDF met alleen een plaatje van de hele pagina (een scan, zonder tekstlaag)."""
    ruw = zlib.compress(im.convert("L").tobytes(), 9)
    b, h = im.size
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>",
    ]
    stroom = b"q 595 0 0 842 0 0 cm /Im1 Do Q"
    objs.append(b"<< /Length %d >>\nstream\n" % len(stroom) + stroom + b"\nendstream")
    objs.append(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n"
                % (b, h, len(ruw)) + ruw + b"\nendstream")
    uit = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(uit))
        uit += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(uit)
    uit += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        uit += b"%010d 00000 n \n" % off
    uit += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(uit)


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
    facturen["scan"] = (pdf([([], (100, 100, 60, pxs, brs))]), {"status": "herk"})   # tekstherkenning vindt niets

    # 5. Webshop, al betaald met iDEAL (zoals veel webwinkels): tabel met kolom "Totaal",
    #    "Totaalprijs incl. BTW", en een zin "t.n.v. … onder vermelding" voor wie op rekening koopt.
    t5 = [(43, 67, 14, "Factuur 5550001"), (43, 109, 10, "J. Klant"), (43, 125, 10, "Klantweg 9"),
          (43, 205, 10, "Factuurnummer"), (181, 205, 10, ":"), (188, 205, 10, "5550001"),
          (43, 244, 10, "Datum"), (181, 244, 10, ":"), (188, 244, 10, "11-07-2026"),
          (43, 263, 10, "Betaalmethode"), (181, 263, 10, ":"), (188, 263, 10, "iDEAL"),
          (54, 312, 9, "#"), (158, 312, 9, "Productnaam"), (453, 312, 9, "Prijs"), (508, 312, 9, "Totaal"),
          (54, 329, 9, "1"), (158, 329, 9, "Tafelventilator"), (440, 329, 9, "€ 18,13"), (503, 329, 9, "€ 18,13"),
          (412, 401, 9, "Subtotaal"), (482, 401, 9, "€"), (513, 401, 9, "22,22"),
          (408, 419, 9, "21% BTW"), (482, 419, 9, "€"), (519, 419, 9, "4,67"),
          (356, 437, 9, "Totaalprijs incl. BTW"), (482, 437, 9, "€"), (513, 437, 9, "26,89"),
          (372, 454, 9, "Betaald met iDEAL"), (482, 454, 9, "€"), (513, 454, 9, "26,89"),
          (43, 484, 9, "Heb je de factuur nog niet betaald en koop je zakelijk op rekening? Dan kun je het bedrag binnen 14"),
          (43, 498, 9, "dagen na factuurdatum overmaken op IBAN NL91ABNA0417164300 t.n.v. Voorbeeld Webshop BV onder"),
          (43, 511, 9, "vermelding van het factuurnummer 5550001."),
          (43, 759, 8, "Voorbeeld Webshop BV"), (241, 759, 8, "IBAN: NL91ABNA0417164300"),
          (43, 769, 8, "Webweg 9"), (265, 769, 8, "BIC: ABNANL2A"), (252, 778, 8, "KVK nummer: 12345678")]
    facturen["webshop-betaald"] = (pdf([(t5, None)]), {
        "geblokkeerd": "al betaald", "naam": "Voorbeeld Webshop BV", "iban": IBAN_A, "bedrag": "26,89",
        "omschrijving": "Factuur 5550001"})

    # 6. Tabel met kopjes en "Totaal te betalen € 0,00" + "Voldaan": betaald; het totaal staat onder de kop.
    t6 = [(198, 35, 9, "Accu Voorbeeld B.V."), (442, 35, 9, "IBAN:"), (466, 35, 9, "NL44 RABO 01234 56 789"),
          (442, 45, 9, "BIC:"), (518, 45, 9, "RABONL2U"), (442, 55, 9, "KVK:"), (519, 55, 9, "12.34.56.78"),
          (74, 90, 14, "Factuur"), (74, 125, 10, "Factuuradres:"), (74, 137, 10, "J. Klant"),
          (44, 255, 8, "Klantnummer"), (110, 255, 8, "Factuurnummer"), (185, 255, 8, "Factuurdatum"), (438, 255, 8, "Betaalwijze"), (496, 255, 8, "Betalingstermijn"),
          (37, 265, 8, "399580"), (108, 265, 8, "2718011"), (179, 265, 8, "16-08-2026"), (428, 265, 8, "iDeal | Wero"), (496, 265, 8, "Voldaan"),
          (396, 345, 9, "Subtotaal"), (465, 345, 9, "btw"), (520, 345, 9, "Totaal"),
          (412, 354, 9, "€ 39,09"), (476, 354, 9, "€ 8,21"), (531, 354, 9, "€ 47,30"),
          (428, 375, 9, "Totaal te betalen"), (533, 375, 9, "€ 0,00")]
    facturen["nul-te-betalen"] = (pdf([(t6, None)]), {
        "geblokkeerd": "al betaald", "naam": "Accu Voorbeeld B.V.", "iban": IBAN_B, "bedrag": "47,30",
        "omschrijving": "Factuur 2718011"})

    # 7. Buitenlandse webshop zonder IBAN: subtotaal en eindtotaal; de naam staat in een regel met "|".
    t7 = [(40, 54, 12, "Factuur"), (103, 54, 12, "SE-1001"), (40, 77, 10, "Factuurnummer"), (113, 77, 10, "SE-1001"),
          (355, 302, 10, "Totaalbedrag"), (475, 302, 10, "34,99"), (355, 320, 10, "BTW (20%)"), (475, 320, 10, "8,20"),
          (355, 338, 10, "Totaal:"), (475, 338, 10, "40,99"), (40, 378, 10, "Datum:"), (75, 378, 10, "2026-11-08"),
          (40, 536, 8, "Voorbeeld AB | Storgatan 1 | Malmo | SE-21121 | Sweden"), (40, 550, 8, "BTW/VAT/TVA NR: SE556000000001")]
    facturen["geen-iban"] = (pdf([(t7, None)]), {
        "naam": "Voorbeeld AB", "bedrag": "40,99", "omschrijving": "Factuur SE-1001", "iban": "",
        "statusbevat": "geen rekeningnummer"})

    # 8. Automatische incasso.
    t8 = briefhoofd("Energie Voorbeeld B.V.", IBAN_A, "ABNANL2A", "E-77", "01-11-2026",
                    [("Termijnbedrag november", "100,00")], ("100,00", "21,00", "121,00"),
                    termijn="Het bedrag wordt rond 28-11-2026 automatisch afgeschreven van je rekening.")
    facturen["incasso"] = (pdf([(t8, None)]), {"geblokkeerd": "automatisch afgeschreven", "bedrag": "121,00"})

    # 9. Tekstherkenning: dezelfde factuur als 'kolommen', als foto (JPEG, scheef) en als gescande PDF.
    verwacht_ocr = {"naam": "Voorbeeld Schilders B.V.", "iban": IBAN_A, "bedrag": "1.512,50",
                    "omschrijving": "Factuur 2026-0417", "statusbevat": "tekstherkenning"}
    scan = als_beeld(t1)
    bestanden = {
        "foto-kolommen.jpg": (als_foto(scan), verwacht_ocr),
        "scan-kolommen.pdf": (pdf_met_volle_afbeelding(scan), verwacht_ocr),   # ± 180 dpi, gangbaar voor een scanner
    }

    for naam, (data, verwacht) in facturen.items():
        bestanden[f"{naam}.pdf"] = (data, verwacht)
    for naam, (data, verwacht) in bestanden.items():
        (UIT / naam).write_bytes(data)
        (UIT / (naam.rsplit(".", 1)[0] + ".verwacht.json")).write_text(json.dumps(verwacht, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{naam}  {len(data)} bytes")


if __name__ == "__main__":
    main()
