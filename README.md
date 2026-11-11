<!-- SPDX-FileCopyrightText: 2026 Henri ter Hofte
     SPDX-License-Identifier: EUPL-1.2 -->
# Betaal-QR

**https://betaal.terhofte.net/**

Maak een betaal-QR-code (EPC069-12, "SEPA Credit Transfer", ook wel GiroCode) en scan die met je
bank-app. De bank-app vult dan naam, IBAN, bedrag en omschrijving in. Bevestigen doe je zelf.

**Factuur in je mail? Fluitend betaald.** Open de PDF op je laptop en scan de QR-code met je bank-app.
Op de telefoon: **Factuur op papier? Foto, en fluitend betaald.**

- **Local-first.** Alles gebeurt in je browser. De pagina mag van de browser geen verbindingen maken
  (`connect-src 'none'`). Opgeslagen ontvangers staan alleen in de localStorage van die browser.
- **Offline.** Werkt na het eerste bezoek ook zonder internet (service worker), en is als app te installeren.
- **Factuur lezen.** Open een factuur als PDF en Betaal-QR vult naam, IBAN, BIC, bedrag en
  factuurnummer of betalingskenmerk in, en toont wanneer je moet betalen. Ook een betaal-QR op de factuur
  wordt gelezen en vergeleken met de tekst. Alles lokaal (pdf.js en jsQR, pas geladen als je een PDF kiest).
- **Foto's en scans.** Een foto van een papieren factuur (knop "Foto maken") of een gescande PDF wordt
  gelezen met tekstherkenning (Tesseract.js, Nederlands model), lokaal en pas geladen bij gebruik.
- **Later betalen.** Stap 3 noemt boven de QR-code de betaaldatum: standaard een dag vóór de uiterste
  datum op de factuur (niet in het verleden), altijd als dd-mm-jjjj en aan te passen. Daaronder maakt het een
  agendaherinnering (.ics) met de QR-code als bijlage en alle gegevens om te betalen, met meldingen
  twee dagen ervoor en op de dag zelf. Een uitvoerdatum kan niet in een EPC-QR; die kies je in je bank-app.
- **Delen en openen met.** Als geïnstalleerde app: op Android een PDF delen naar Betaal-QR (Web Share Target,
  afgevangen door de service worker), op de laptop een PDF openen met Betaal-QR (File Handling API).
- **Op de telefoon.** Kopieerknoppen per gegeven, en de afbeelding opslaan of delen.
- **Controleerbaar.** Een reproduceerbare build, `sha256.json`, een attestatie van GitHub en een wekelijkse
  controle. Zie [controleer.html](controleer.html).
- **Geen betaaldienst.** De app maakt alleen een plaatje van wat je invult. Hij heeft geen toegang
  tot rekeningen en komt nooit aan geld.

## Veiligheid

- Vooraf ingevulde links (`#iban=…`) zitten er bewust niet in: die zijn een phishingmiddel.
- De app werkt niet in een frame (clickjacking), en waarschuwt als een bekende ontvanger een ander IBAN
  heeft dan je eerder hebt bewaard (factuurfraude).
- Bedragen worden streng gelezen: wat je niet eenduidig kunt lezen, levert een foutmelding op in plaats van een gok.
- Namen en omschrijvingen worden teruggebracht tot de SEPA-tekenset, zodat geen bank ze weigert.

## Ontwikkelen

    python -m http.server               # lokaal bekijken (zonder service worker: die werkt alleen via https)
    python tools/test.py                # unit-tests + testfacturen in de app (Playwright + Chrome, OpenCV)
    python tools/test.py --pdf f.pdf    # ook een eigen factuur inlezen (alleen lokaal tonen)
    python tools/bouw.py                # site bouwen naar _site/ (uit de commit HEAD, niet de werkmap)
    python tools/controleer.py          # live site vergelijken met een eigen build
    python tools/maak_beelden.py        # app-iconen en previewafbeelding (beeld/og.png) opnieuw maken

Er is geen build-tooling. De enige afhankelijkheden staan ongewijzigd in `vendor/` (zie [vendor/README.md](vendor/README.md)).
De testfacturen in `tests/facturen/` zijn verzonnen en worden gemaakt met `tools/maak_testfacturen.py`.

## Licentie en credits

Betaal-QR is © 2026 Henri ter Hofte en valt onder de **[EUPL-1.2](LICENSE)** (European Union Public
Licence 1.2; de tekst geldt in alle EU-talen, zie [joinup.ec.europa.eu](https://joinup.ec.europa.eu/collection/eupl)).
Elk bestand heeft een SPDX-kop. Waar dat niet kan (JSON, PNG, de ongewijzigde bibliotheek) staat de
informatie in [REUSE.toml](REUSE.toml), volgens de [REUSE-specificatie](https://reuse.software/).

Gebruikt werk van anderen, met dank:

| Wat | Van | Licentie |
|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (`vendor/qrcode.js`, ongewijzigd) | Kazuhiko Arase | MIT ([LICENSES/MIT.txt](LICENSES/MIT.txt)) |
| [pdf.js](https://github.com/mozilla/pdf.js) 4.10.38 (`vendor/pdfjs/`, ongewijzigd) | Mozilla Foundation | Apache-2.0 ([LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)) |
| [jsQR](https://github.com/cozmo/jsQR) 1.4.0 (`vendor/jsqr/`, ongewijzigd) | Cosmo Wolfe en anderen | Apache-2.0 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 en tesseract.js-core 5.1.1 (`vendor/tesseract/`, ongewijzigd) | Jerome Wu, Balearica en anderen | Apache-2.0 (met kleine MIT/BSD-onderdelen) |
| Nederlands taalmodel (`vendor/tesseract/lang/`, tessdata_best via @tesseract.js-data/nld 1.0.0) | Google en Tesseract-bijdragers | Apache-2.0 |
| EPC069-12, *Quick Response Code: Guidelines to Enable Data Capture for the Initiation of a SEPA Credit Transfer* (de standaard, geen code) | European Payments Council | – |

MIT, BSD-3-Clause en Apache-2.0 zijn permissief en verenigbaar met de EUPL: de bibliotheken blijven onder hun eigen licentie,
met hun oorspronkelijke copyright- en licentieteksten, en het geheel wordt verspreid onder de EUPL-1.2.

"QR Code" is een geregistreerd handelsmerk van DENSO WAVE INCORPORATED.
