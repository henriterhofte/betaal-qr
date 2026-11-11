// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// Betaalgegevens herkennen in de tekst van een factuur. Puur rekenwerk, geen pdf.js en geen DOM,
// zodat het los te testen is (test.html).
//
// Invoer: pagina's met regels, zoals pdflezer.mjs ze maakt:
//   [{ nr: 1, hoogte: 842, regels: [{ y: 46, tekst: 'B.V. ...', delen: [{ x: 94, w: 266, s: 'B.V. ...' }] }] }]
// Uitvoer: { velden: {naam, iban, bic, centen, factuurnummer, kenmerk, factuurdatum, vervaldatum},
//            bron: {veld: 'pagina 1: "…"'}, alternatieven: {iban: [...], centen: [...]}, waarschuwingen: [...] }
// Alles is een voorstel: de gebruiker controleert het in stap 2.
(function (root) {
  'use strict';

  var EPC = root.EPC;

  // Vaste IBAN-lengtes van de meest voorkomende SEPA-landen (beperkt valse treffers van mod 97).
  var IBAN_LENGTE = { NL: 18, BE: 16, DE: 22, FR: 27, LU: 20, AT: 20, ES: 24, IT: 27, IE: 22, GB: 22, PT: 25,
    FI: 18, DK: 18, SE: 24, NO: 15, CH: 21, PL: 28, CZ: 24, SK: 24, SI: 19, HR: 21, GR: 27, MT: 31, CY: 28,
    EE: 20, LV: 21, LT: 20, HU: 28, RO: 24, BG: 22, IS: 26, LI: 21, MC: 27, SM: 27 };

  var BEDRAG = /(?:^|[^\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.,]*\d)/g;
  var DATUM = /\b(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4}|\d{2})\b/;
  var DATUM_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  var MAANDEN = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mrt: 3, maa: 3, maart: 3, mar: 3, march: 3,
    apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, augustus: 8, august: 8,
    sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  var DATUM_TEKST = /\b(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})\b/i;
  var RECHTSVORM = /(^|[\s,])(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|c\.?v\.?|gmbh|bvba|bv|nv|srl|sprl|sarl|ltd|llc|inc|plc|ag|kg|ab|as|a\/s|aps|oy|oyj|spa|sa|stichting|vereniging|gemeente|coöperatie|cooperatie|holding)([\s,.|]|$)/i;

  // Labels voor het bedrag. Sterk: wat er te betalen is (de eerste vindplaats wint; 0,00 = al betaald).
  // Zwak: een totaal; daarvan wint het onderste op de pagina (het eindtotaal staat meestal onderaan).
  var LABEL_TE_BETALEN = /totaal\s*factuurbedrag|(nog|resterend)\s*te\s*betalen|te\s*betalen|openstaand(e)?\s*(bedrag|saldo)|\bsaldo\b|te\s*voldoen|amount\s*due|total\s*due|balance(\s*due)?\b|outstanding|zu\s*zahlen|zahlbetrag|restbetrag|à\s*payer|a\s*payer|solde/;
  var LABEL_TOTAAL = /totaal|total|summe|eindbedrag|factuurbedrag|gesamtbetrag|rechnungsbetrag|montant/;
  // Geen eindtotaal: exclusief btw, subtotaal, netto, of alleen het btw-bedrag ("incl. btw" telt wel).
  function geenEindtotaal(label) {
    var s = String(label || '').toLowerCase();
    if (/excl|exkl|subtota|sub-tota|netto/.test(s)) return true;
    return /btw|b\.t\.w|vat|mwst|tva/.test(s) && !/incl|inkl/.test(s);
  }

  function laag(s) { return String(s || '').toLowerCase(); }

  // Bedragen in een tekst, in centen. Ook 0 (nodig voor "Resterend te betalen 0,00");
  // een min-teken of "-/-" ervoor betekent een aftrekpost en telt niet.
  function bedragenIn(tekst, metNul) {
    var uit = [], m;
    BEDRAG.lastIndex = 0;
    while ((m = BEDRAG.exec(tekst))) {
      var voor = tekst.slice(Math.max(0, m.index - 4), m.index + m[0].indexOf(m[1]));
      if (/-\/-|−|-\s*(€|eur)?\s*$/i.test(voor)) continue;
      var c = EPC.bedragInCenten(m[1]);
      if (typeof c === 'number' && !isNaN(c) && (c > 0 || (metNul && c === 0))) uit.push(c);
    }
    return uit;
  }

  // Signalen dat er niets (meer) betaald hoeft te worden. Volgorde: betaald, incasso, bewijs.
  var NIET_BETAALD = /niet\s+(tijdig\s+|volledig\s+)?(betaald|voldaan)|nog\s+niet|onbetaald|unpaid|not\s+paid/;
  var STATUS = [
    { soort: 'credit', re: /creditnota|credit\s*nota|creditfactuur|credit\s*note|gutschrift|note\s+de\s+crédit/ },
    { soort: 'betaald', re: /^(betaald|voldaan|paid|bezahlt|payée?)[.!]?$|\b(betaalwijze|betaalmethode|betalingswijze|betaalmiddel|betalingstermijn|payment\s*method|betaald\s*(met|per|via))\s*:?\s*(ideal|wero|creditcard|credit\s*card|visa|mastercard|maestro|american\s*express|amex|paypal|pin(betaling)?|apple\s*pay|google\s*pay|bancontact|sofort|contant|cadeaukaart)|(reeds|al|is|werd|zijn)\s+(volledig\s+)?(betaald|voldaan)|(betaald|voldaan)\s+(via|met|op|door|per)\b|already\s+paid|payment\s+received|bereits\s+bezahlt|déjà\s+payé/ },
    { soort: 'incasso', re: /automatisch\s+(afgeschreven|geïncasseerd|geincasseerd|geïnd|geind)|(automatische|sepa[- ]?)\s*incasso|wordt\s+(binnenkort\s+|op\s+[^.]{0,30})?(van\s+(uw|je)\s+(bank)?rekening\s+)?(afgeschreven|geïncasseerd|geincasseerd)|direct\s+debit|lastschrift/ },
    { soort: 'bewijs', re: /e-ticket|ticket\s*(nr|nummer)|kassabon|betaalbewijs|ontvangstbewijs|aankoopbewijs|instapkaart|boarding\s*pass|transactiebewijs/ }
  ];

  function citaat(p, regel) {
    var t = regel.tekst.length > 80 ? regel.tekst.slice(0, 77) + '…' : regel.tekst;
    return 'pagina ' + p.nr + ': "' + t + '"';
  }

  // Het deel van een regel dat bij een label hoort, en de waarde eronder in dezelfde kolom.
  function zoekLabel(p, regel, re) {
    for (var i = 0; i < regel.delen.length; i++) {
      if (re.test(laag(regel.delen[i].s))) return regel.delen[i];
    }
    return null;
  }
  // De waarde onder een label in dezelfde kolom: het deel dat horizontaal het meest overlapt met het
  // label (waarden staan vaak rechts uitgelijnd of gecentreerd, niet precies onder het begin van het label).
  function waardeOnder(p, ri, label, test) {
    var lb = label.x - 12, le = label.x + Math.max(label.w, 40) + 12;
    for (var j = ri + 1; j < p.regels.length && j <= ri + 3; j++) {
      var r = p.regels[j];
      if (r.y - p.regels[ri].y > 40) break;
      var beste = null, besteOverlap = 0;
      for (var k = 0; k < r.delen.length; k++) {
        var d = r.delen[k];
        var de = d.x + Math.max(d.w, 8);
        var overlap = Math.min(le, de) - Math.max(lb, d.x);
        if (overlap > besteOverlap && test(d.s)) { beste = d; besteOverlap = overlap; }
      }
      if (beste) return { tekst: beste.s, regel: r };
    }
    return null;
  }
  function naLabel(regel, label, re) {
    var i = regel.delen.indexOf(label);
    var rest = regel.delen.slice(i).map(function (d) { return d.s; }).join(' ');
    var zonderLabel = rest.replace(new RegExp('^.*?(' + re.source + ')', 'i'), '');
    return zonderLabel.replace(/^[\s:.#-]+/, '');
  }

  // 11-11-2026, 11/11/26, 2026-11-11 en 11 november 2026 (ook "11 nov. 2026").
  function datumVan(s) {
    s = s || '';
    var dag, maand, jaar, m;
    if ((m = DATUM_ISO.exec(s))) { jaar = +m[1]; maand = +m[2]; dag = +m[3]; }
    else if ((m = DATUM.exec(s))) { dag = +m[1]; maand = +m[2]; jaar = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else if ((m = DATUM_TEKST.exec(s)) && MAANDEN[m[2].toLowerCase()]) { dag = +m[1]; maand = MAANDEN[m[2].toLowerCase()]; jaar = +m[3]; }
    else return null;
    var d = new Date(Date.UTC(jaar, maand - 1, dag));
    if (d.getUTCDate() !== dag || d.getUTCMonth() !== maand - 1) return null;  // 31-02 e.d.
    return d;
  }
  function isoDatum(d) { return d ? d.toISOString().slice(0, 10) : null; }

  // ---- IBAN ----
  function ibansIn(tekst) {
    var uit = [], re = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{1,4}){3,8})/g, m;
    while ((m = re.exec(tekst.toUpperCase()))) {
      var s = m[1].replace(/ /g, '');
      var lengtes = IBAN_LENGTE[s.slice(0, 2)] ? [IBAN_LENGTE[s.slice(0, 2)]] : [];
      if (!lengtes.length) for (var l = Math.min(34, s.length); l >= 15; l--) lengtes.push(l);
      for (var i = 0; i < lengtes.length; i++) {
        var kand = s.slice(0, lengtes[i]);
        if (kand.length === lengtes[i] && EPC.ibanGeldig(kand)) { uit.push(kand); break; }
      }
    }
    return uit;
  }

  function analyseer(paginas) {
    var velden = {}, bron = {}, alternatieven = {}, waarschuwingen = [];
    var ibans = [];    // {iban, score, bron, pagina, y}
    var status = {};   // soort -> bron

    paginas.forEach(function (p) {
      p.regels.forEach(function (regel, ri) {
        var t = laag(regel.tekst);

        // Al betaald, incasso, creditnota, of een kaartje/betaalbewijs?
        var kaal = t.trim();
        if (!status.betaald) {
          // Een losse cel "Voldaan" of "Betaald" (bijvoorbeeld onder "Betalingstermijn") telt ook.
          regel.delen.some(function (d) {
            if (/^(betaald|voldaan|paid|bezahlt)[.!]?$/i.test(d.s.trim())) { status.betaald = citaat(p, regel); return true; }
            return false;
          });
        }
        STATUS.forEach(function (s) {
          if (status[s.soort] || !s.re.test(kaal) || NIET_BETAALD.test(kaal)) return;
          if (s.soort === 'betaald' && /te\s+(zijn|worden)\s+(betaald|voldaan)|dient|moet|graag|uiterlijk|binnen\s+\d/.test(kaal)) return;
          if (s.soort === 'incasso' && /indien|wil\s+je|wilt\s+u|kies|aanmelden|machtiging\s+(afgeven|geven)|liever/.test(kaal)) return;
          status[s.soort] = citaat(p, regel);
        });

        // IBAN's, met voorkeur voor regels met "iban", "rekening" of "t.n.v.";
        // regels over de rekening van de klant zelf ("uw rekening", "incasso") tellen niet.
        ibansIn(regel.tekst).forEach(function (iban) {
          var score = /iban|rekening|t\.?\s?n\.?\s?v|ten name van|bank/.test(t) ? 2 : 1;
          if (/uw (rekening|iban|bankrekening)|incasso|machtiging/.test(t)) score = 0;
          ibans.push({ iban: iban, score: score, bron: citaat(p, regel), pagina: p.nr, y: regel.y });
        });

        // BIC met label
        var bic = /\b(?:bic|swift)\b[\s:.-]*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i.exec(regel.tekst);
        if (bic && !velden.bic) { velden.bic = bic[1].toUpperCase(); bron.bic = citaat(p, regel); }

        // Factuurnummer: achter het label, of eronder in dezelfde kolom
        if (!velden.factuurnummer) {
          var reNr = /factuurnummer|factuurnr\.?|factuur\s*nr\.?|factuur\s*nummer|invoice\s*(number|no\.?|nr\.?)|rechnungs(nummer|nr\.?)|n[°o]\s*de\s*facture|^bill(\s*(no\.?|nr\.?|number))?(?=\s+[a-z]*\d)/;
          var lab = zoekLabel(p, regel, reNr);
          if (lab) {
            var na = naLabel(regel, lab, reNr).split(/\s{2,}|\s(?=[A-Za-z]{3,})/)[0];
            var heeftCijfer = function (s) { return /\d/.test(s) && /^[A-Za-z0-9.\/_-]{2,35}$/.test(String(s).trim()); };
            if (heeftCijfer(na)) { velden.factuurnummer = na.trim(); bron.factuurnummer = citaat(p, regel); }
            else {
              var onder = waardeOnder(p, ri, lab, heeftCijfer);
              if (onder) { velden.factuurnummer = onder.tekst.trim(); bron.factuurnummer = citaat(p, onder.regel); }
            }
          }
        }

        // Betalingskenmerk (16 cijfers, of RF-kenmerk)
        if (!velden.kenmerk) {
          var reK = /betalingskenmerk|betaalkenmerk|betalingsreferentie|payment\s*reference|verwendungszweck/;
          var labK = zoekLabel(p, regel, reK);
          var kandidaten = [];
          if (labK) {
            kandidaten.push({ s: naLabel(regel, labK, reK), r: regel });
            var o = waardeOnder(p, ri, labK, function (s) { return /\d{4}/.test(s); });
            if (o) kandidaten.push({ s: o.tekst, r: o.regel });
          }
          var rf = /\bRF\d{2}(?:\s?[A-Z0-9]{1,4}){1,6}\b/i.exec(regel.tekst);
          if (rf) kandidaten.push({ s: rf[0], r: regel });
          for (var ki = 0; ki < kandidaten.length && !velden.kenmerk; ki++) {
            var s = kandidaten[ki].s.trim();
            var cijfers = s.replace(/[\s.]/g, '');
            if (EPC.rfKenmerkGeldig(s)) velden.kenmerk = s.replace(/\s/g, '').toUpperCase();
            else if (/^\d{16}$/.test(cijfers.slice(0, 16)) && labK) velden.kenmerk = cijfers.slice(0, 16);
            if (velden.kenmerk) bron.kenmerk = citaat(p, kandidaten[ki].r);
          }
        }

        // Datums
        if (!velden.vervaldatum) {
          var reV = /vervaldatum|verval\s*datum|uiterlijk|betalen\s*(voor|vóór)|due\s*date|fällig|échéance/;
          if (reV.test(t)) {
            var labV = zoekLabel(p, regel, reV);
            var dv = datumVan(labV ? naLabel(regel, labV, /^/) : regel.tekst);
            if (!dv && labV) { var ov = waardeOnder(p, ri, labV, function (s) { return !!datumVan(s); }); if (ov) dv = datumVan(ov.tekst); }
            if (dv) { velden.vervaldatum = isoDatum(dv); bron.vervaldatum = citaat(p, regel); }
          }
        }
        if (!velden.factuurdatum) {
          var reD = /factuurdatum|invoice\s*date|rechnungsdatum|^datum\b|^date\b/;
          var labD = zoekLabel(p, regel, reD);
          if (labD) {
            var dd = datumVan(naLabel(regel, labD, reD));
            var bronRegel = regel;
            if (!dd) { var od = waardeOnder(p, ri, labD, function (s) { return !!datumVan(s); }); if (od) { dd = datumVan(od.tekst); bronRegel = od.regel; } }
            if (dd) { velden.factuurdatum = isoDatum(dd); bron.factuurdatum = citaat(p, bronRegel); }
          }
        }
        if (!velden.termijnDagen) {
          var tm = /binnen\s*(\d{1,3})\s*(dagen|days|tagen)|(\d{1,3})\s*dagen\s*na\s*factuurdatum|within\s*(\d{1,3})\s*days/.exec(t);
          if (tm) { velden.termijnDagen = parseInt(tm[1] || tm[3] || tm[4], 10); bron.termijnDagen = citaat(p, regel); }
        }
      });
    });

    // ---- bedrag ----
    // Per label-deel: het eerste bedrag rechts ervan op dezelfde regel, anders het bedrag eronder in
    // dezelfde kolom (tabellen met kopjes). "Te betalen"-labels gaan voor; staat daar 0,00, dan is de
    // factuur al betaald en zoeken we het totaal alleen nog om te tonen. Van de totalen wint het onderste
    // op de eerste pagina waar er een staat.
    function bedragBijLabel(p, regel, ri, re) {
      for (var i = 0; i < regel.delen.length; i++) {
        var d = regel.delen[i];
        var m = re.exec(laag(d.s));
        if (!m) continue;
        if (re === LABEL_TOTAAL && geenEindtotaal(d.s)) continue;
        // Op dezelfde regel: het laatste bedrag (op een totaalregel met netto, btw en totaal is dat het totaal).
        var rest = d.s.slice(m.index + m[0].length) + ' ' + regel.delen.slice(i + 1).map(function (x) { return x.s; }).join(' ');
        var b = bedragenIn(rest, true);
        if (b.length) return { centen: b[b.length - 1], bron: citaat(p, regel), y: regel.y, pagina: p.nr, regel: true };
        // Anders onder de kolomkop (tabellen); dat telt minder zwaar.
        var onder = waardeOnder(p, ri, d, function (s) { return bedragenIn(s, true).length > 0; });
        if (onder) return { centen: bedragenIn(onder.tekst, true)[0], bron: citaat(p, onder.regel), y: onder.regel.y, pagina: p.nr, regel: false };
      }
      return null;
    }
    var teBetalen = [], totalen = [];
    paginas.forEach(function (p) {
      p.regels.forEach(function (regel, ri) {
        var t = laag(regel.tekst);
        var g = LABEL_TE_BETALEN.test(t) && bedragBijLabel(p, regel, ri, LABEL_TE_BETALEN);
        if (g) { teBetalen.push(g); return; }
        g = LABEL_TOTAAL.test(t) && bedragBijLabel(p, regel, ri, LABEL_TOTAAL);
        if (g && g.centen > 0) totalen.push(g);
      });
    });
    var gekozen = null;
    if (teBetalen.length && teBetalen[0].centen === 0) {
      if (!status.betaald) status.betaald = teBetalen[0].bron;   // "Resterend te betalen 0,00"
    } else if (teBetalen.length) {
      gekozen = teBetalen[0];
      var anders = teBetalen.filter(function (g) { return g.centen > 0 && g.centen !== gekozen.centen; });
      if (anders.length) {
        alternatieven.centen = anders.map(function (g) { return g.centen; });
        waarschuwingen.push('Er staan meerdere bedragen "te betalen" in de factuur (ook ' +
          anders.map(function (g) { return EPC.centenNaarTekst(g.centen); }).join(', ') + '). Controleer welk bedrag je moet betalen.');
      }
    }
    if (!gekozen && totalen.length) {
      // Een totaal met het bedrag op dezelfde regel gaat voor een bedrag onder een kolomkop "Totaal"
      // (zo'n kolom staat ook in tabellen met losse regels of betalingen). Daarbinnen wint het onderste.
      var opRegel = totalen.filter(function (g) { return g.regel; });
      var kandidaten = opRegel.length ? opRegel : totalen;
      var eerstePagina = kandidaten[0].pagina;
      kandidaten.filter(function (g) { return g.pagina === eerstePagina; }).forEach(function (g) { if (!gekozen || g.y >= gekozen.y) gekozen = g; });
    }
    if (gekozen) { velden.centen = gekozen.centen; bron.centen = gekozen.bron; }

    // ---- IBAN kiezen ----
    var uniek = {};
    ibans.forEach(function (x) { if (!uniek[x.iban] || uniek[x.iban].score < x.score) uniek[x.iban] = x; });
    var lijst = Object.keys(uniek).map(function (k) { return uniek[k]; }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    if (lijst.length) {
      velden.iban = lijst[0].iban; bron.iban = lijst[0].bron;
      if (lijst.length > 1) {
        alternatieven.iban = lijst.slice(1).map(function (x) { return x.iban; });
        waarschuwingen.push('Er staan meerdere rekeningnummers in de factuur (ook ' +
          alternatieven.iban.map(EPC.formatteerIban).join(', ') + '). Controleer welk de juiste is.');
      }
    }
    // BIC moet bij het IBAN horen (land, en bij NL de bankcode)
    if (velden.bic && velden.iban) {
      var past = velden.bic.slice(4, 6) === velden.iban.slice(0, 2) &&
        (velden.iban.slice(0, 2) !== 'NL' || velden.bic.slice(0, 4) === velden.iban.slice(4, 8));
      if (!past) { delete velden.bic; delete bron.bic; }
    }

    // ---- naam ----
    // 1. "t.n.v. …" (tot "onder vermelding", een komma e.d.);
    // 2. anders het tekstdeel met een rechtsvorm (B.V., Stichting, AB, GmbH, …) met de beste score:
    //    bij de bedrijfsgegevens (KvK/BTW/IBAN) of in het briefhoofd telt mee; het adresblok van de klant
    //    ("Aan:", "t.a.v.", "Factuuradres") telt niet; bij gelijke score wint de bovenste;
    // 3. anders de bovenste regel van het blok met KvK/BTW-gegevens die op een naam lijkt.
    var p1 = paginas[0];
    if (p1) {
      for (var i = 0; i < p1.regels.length && !velden.naam; i++) {
        var tnv = /(?:\bt\.?\s?n\.?\s?v\.?|ten name van)\s*:?\s*(.{3,90})/i.exec(p1.regels[i].tekst);
        if (!tnv) continue;
        var naamTnv = tnv[1].split(/\s+(?:onder|o\.?v\.?v\.?|ovv|met|via|te|in|bij|op|onder vermelding)\b|[,;(]/i)[0].trim();
        if (naamTnv.length >= 2 && naamTnv.length <= 70 && !/iban|[A-Z]{2}\d{2}\s?[A-Z]{4}/i.test(naamTnv)) { velden.naam = naamTnv; bron.naam = citaat(p1, p1.regels[i]); }
      }
      var hoogte = p1.hoogte || 842;
      // Bedrijfsgegevens: KvK, IBAN/BIC, of een btw-nummer (niet een losse kolomkop "BTW").
      var GEGEVENS = /kvk|k\.v\.k|\biban\b|\bbic\b|handelsregister|chamber of commerce|(btw|vat|tva|ust)[\s\/a-z.-]{0,14}(nr|no|nummer|number|id)\b|\b[A-Z]{2}\d{8,12}B\d{2}\b/i;
      var gegevensY = p1.regels.filter(function (r) { return GEGEVENS.test(r.tekst); }).map(function (r) { return r.y; });
      var klantY = p1.regels.filter(function (r) { return /^(aan|t\.?\s?a\.?\s?v\.?|factuuradres|afleveradres|bezorgadres|klant(gegevens)?|bill\s*to|ship\s*to)\b\s*:?/i.test(r.tekst.trim()); }).map(function (r) { return r.y; });
      var bijGegevens = function (y) { return gegevensY.some(function (g) { return Math.abs(g - y) <= 60; }); };
      var inKlantblok = function (y) { return klantY.some(function (k) { return y >= k && y - k <= 50; }); };
      // Tekstdelen; een deel of regel met "|", "·" of "•" ertussen telt als losse stukken ("Doro AB | Straat 1 | Malmö").
      var SCHEIDER = /\s[|·•]\s/;
      var stukken = function (r) {
        var s = [];
        var voegToe = function (x) { x = x.trim(); if (x && s.indexOf(x) < 0) s.push(x); };
        r.delen.forEach(function (d) { d.s.split(SCHEIDER).forEach(voegToe); });
        if (SCHEIDER.test(r.tekst)) r.tekst.split(SCHEIDER).forEach(voegToe);
        return s;
      };
      var vreemd = /[:@]|www\.|https?:|onderdeel van|^\d+[\s,]|^\d{4}\s?[a-z]{2}\b|postbus|antwoordnummer|^(tel|fax|e-?mail|web)/i;
      if (!velden.naam) {
        var beste = null;
        p1.regels.forEach(function (r) {
          stukken(r).forEach(function (s) {
            s = s.trim();
            if (s.length < 3 || s.length > 70 || !RECHTSVORM.test(s) || vreemd.test(s)) return;
            var score = 0;
            if (bijGegevens(r.y)) score += 3;
            if (r.y <= hoogte * 0.12) score += 2; else if (r.y <= hoogte * 0.25) score += 1;
            if (inKlantblok(r.y)) score -= 5;
            if (!beste || score > beste.score) beste = { s: s, score: score, regel: r };
          });
        });
        if (beste && beste.score >= 0) { velden.naam = beste.s; bron.naam = citaat(p1, beste.regel); }
      }
      if (!velden.naam && gegevensY.length) {
        // Zonder rechtsvorm: de bovenste naamachtige regel kort boven de KvK/BTW-regel.
        var kvkY = Math.min.apply(null, gegevensY);
        for (var n = 0; n < p1.regels.length && !velden.naam; n++) {
          var r2 = p1.regels[n];
          if (r2.y < kvkY - 60 || r2.y > kvkY || inKlantblok(r2.y)) continue;
          var s2 = (r2.delen[0] ? r2.delen[0].s : r2.tekst).trim();
          if (s2.length >= 3 && s2.length <= 70 && /[a-z]{2}/i.test(s2) && !/\d/.test(s2) && !vreemd.test(s2) && !/^(factuur|invoice|rechnung|klantenservice|postadres)\b/i.test(s2)) {
            velden.naam = s2; bron.naam = citaat(p1, r2) + ' (geschat)';
            waarschuwingen.push('De naam van de ontvanger is geschat ("' + s2 + '"). Controleer hem met de factuur.');
          }
        }
      }
    }

    // ---- vervaldatum uit factuurdatum + termijn ----
    if (!velden.vervaldatum && velden.factuurdatum && velden.termijnDagen) {
      var d = new Date(velden.factuurdatum + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + velden.termijnDagen);
      velden.vervaldatum = isoDatum(d);
      bron.vervaldatum = 'factuurdatum + ' + velden.termijnDagen + ' dagen (' + bron.termijnDagen + ')';
    }

    // ---- status: wat het document zegt over betalen ----
    var st = null;
    ['credit', 'betaald', 'incasso', 'bewijs'].some(function (s) { if (status[s]) { st = { soort: s, bron: status[s] }; } return !!st; });
    // Een kaartje of betaalbewijs met een IBAN en een openstaand bedrag is waarschijnlijk toch een factuur.
    if (st && st.soort === 'bewijs' && velden.iban && velden.centen) st = null;

    return { velden: velden, bron: bron, alternatieven: alternatieven, waarschuwingen: waarschuwingen, status: st };
  }

  // Omschrijving voor de overschrijving: het betalingskenmerk als dat er is, anders "Factuur <nummer>".
  function omschrijving(velden) {
    if (velden.kenmerk) return velden.kenmerk;
    if (velden.factuurnummer) return 'Factuur ' + velden.factuurnummer;
    return '';
  }

  root.Factuur = { analyseer: analyseer, omschrijving: omschrijving, ibansIn: ibansIn, bedragenIn: bedragenIn };
})(typeof self !== 'undefined' ? self : this);
