<!-- SPDX-FileCopyrightText: 2026 Henri ter Hofte
     SPDX-License-Identifier: EUPL-1.2 -->
# Betaal-QR

**https://betaal.terhofte.net/**

Maak een betaal-QR-code (EPC069-12, "SEPA Credit Transfer", ook wel GiroCode) en scan die met je
bank-app. De bank-app vult dan naam, IBAN, bedrag en omschrijving in. Bevestigen doe je zelf.

- **Local-first.** Alles gebeurt in je browser. De pagina mag van de browser geen verbindingen maken
  (`connect-src 'none'`). Opgeslagen ontvangers staan alleen in de localStorage van die browser.
- **Offline.** Werkt na het eerste bezoek ook zonder internet (service worker), en is als app te installeren.
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
    python tools/test.py                # tests in headless Chrome + QR teruglezen met OpenCV
    python tools/bouw.py                # site bouwen naar _site/ (uit de commit HEAD, niet de werkmap)
    python tools/controleer.py          # live site vergelijken met een eigen build

Er is geen build-tooling en er zijn geen afhankelijkheden, behalve `vendor/qrcode.js` (qrcode-generator
1.4.4, MIT, ongewijzigd; zie [vendor/README.md](vendor/README.md)).

## Licentie en credits

Betaal-QR is © 2026 Henri ter Hofte en valt onder de **[EUPL-1.2](LICENSE)** (European Union Public
Licence 1.2; de tekst geldt in alle EU-talen, zie [joinup.ec.europa.eu](https://joinup.ec.europa.eu/collection/eupl)).
Elk bestand heeft een SPDX-kop. Waar dat niet kan (JSON, PNG, de ongewijzigde bibliotheek) staat de
informatie in [REUSE.toml](REUSE.toml), volgens de [REUSE-specificatie](https://reuse.software/).

Gebruikt werk van anderen, met dank:

| Wat | Van | Licentie |
|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (`vendor/qrcode.js`, ongewijzigd) | Kazuhiko Arase | MIT ([LICENSES/MIT.txt](LICENSES/MIT.txt)) |
| EPC069-12, *Quick Response Code: Guidelines to Enable Data Capture for the Initiation of a SEPA Credit Transfer* (de standaard, geen code) | European Payments Council | – |

De MIT-licentie is permissief en verenigbaar met de EUPL: de bibliotheek blijft onder MIT met de
oorspronkelijke copyrightregel (in de kop van het bestand), en het geheel wordt verspreid onder de EUPL-1.2.

"QR Code" is een geregistreerd handelsmerk van DENSO WAVE INCORPORATED.
