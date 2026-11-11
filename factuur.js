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
  var RECHTSVORM = /(^|[\s,])(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|c\.?v\.?|gmbh|bvba|bv|nv|srl|sprl|ltd|stichting|vereniging|gemeente|coöperatie|cooperatie|holding)([\s,.]|$)/i;

  // Labels voor het te betalen bedrag, van sterk naar zwak.
  var BEDRAG_LABELS = [
    /totaal\s*factuurbedrag|nog\s*te\s*betalen|te\s*betalen|openstaand(e)?\s*(bedrag|saldo)|totaal\s*te\s*voldoen|amount\s*due|total\s*due|balance\s*due|zu\s*zahlen|zahlbetrag|à\s*payer|a\s*payer/,
    /totaal\s*(incl|inclusief)|totaalbedrag|factuurbedrag|total\s*(incl|amount)|gesamtbetrag|rechnungsbetrag/,
    /\btotaal\b|\btotal\b|\bsumme\b/
  ];
  var GEEN_EINDBEDRAG = /excl|exkl|btw|b\.t\.w|vat|mwst|tva|subtotaal|sub-totaal|subtotal/;

  function laag(s) { return String(s || '').toLowerCase(); }

  function bedragenIn(tekst) {
    var uit = [], m;
    BEDRAG.lastIndex = 0;
    while ((m = BEDRAG.exec(tekst))) {
      var c = EPC.bedragInCenten(m[1]);
      if (typeof c === 'number' && !isNaN(c) && c > 0) uit.push(c);
    }
    return uit;
  }

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
  function waardeOnder(p, ri, label, test) {
    for (var j = ri + 1; j < p.regels.length && j <= ri + 3; j++) {
      var r = p.regels[j];
      if (r.y - p.regels[ri].y > 40) break;
      for (var k = 0; k < r.delen.length; k++) {
        var d = r.delen[k];
        if (d.x >= label.x - 12 && d.x <= label.x + Math.max(label.w, 40) + 12 && test(d.s)) return { tekst: d.s, regel: r };
      }
    }
    return null;
  }
  function naLabel(regel, label, re) {
    var i = regel.delen.indexOf(label);
    var rest = regel.delen.slice(i).map(function (d) { return d.s; }).join(' ');
    var zonderLabel = rest.replace(new RegExp('^.*?(' + re.source + ')', 'i'), '');
    return zonderLabel.replace(/^[\s:.#-]+/, '');
  }

  function datumVan(s) {
    var m = DATUM.exec(s || '');
    if (!m) return null;
    var j = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    var d = new Date(Date.UTC(j, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
    if (d.getUTCDate() !== parseInt(m[1], 10)) return null;  // 31-02 e.d.
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
    var ibans = [];    // {iban, score, bron}

    paginas.forEach(function (p) {
      p.regels.forEach(function (regel, ri) {
        var t = laag(regel.tekst);

        // IBAN's, met voorkeur voor regels met "iban", "rekening" of "t.n.v.";
        // regels over de rekening van de klant zelf ("uw rekening", "incasso") tellen niet.
        ibansIn(regel.tekst).forEach(function (iban) {
          var score = /iban|rekening|t\.?\s?n\.?\s?v|ten name van|bank/.test(t) ? 2 : 1;
          if (/uw (rekening|iban|bankrekening)|incasso|machtiging/.test(t)) score = 0;
          ibans.push({ iban: iban, score: score, bron: citaat(p, regel) });
        });

        // BIC met label
        var bic = /\b(?:bic|swift)\b[\s:.-]*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i.exec(regel.tekst);
        if (bic && !velden.bic) { velden.bic = bic[1].toUpperCase(); bron.bic = citaat(p, regel); }

        // Factuurnummer: achter het label, of eronder in dezelfde kolom
        if (!velden.factuurnummer) {
          var reNr = /factuurnummer|factuurnr\.?|factuur\s*nr\.?|factuur\s*nummer|invoice\s*(number|no\.?|nr\.?)|rechnungs(nummer|nr\.?)|n[°o]\s*de\s*facture/;
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
          var reD = /factuurdatum|invoice\s*date|rechnungsdatum|^datum$|^date$/;
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

    // ---- bedrag: het sterkste label wint; binnen dat label de eerste vindplaats ----
    for (var niveau = 0; niveau < BEDRAG_LABELS.length && velden.centen == null; niveau++) {
      var gevonden = [];
      paginas.forEach(function (p) {
        p.regels.forEach(function (regel, ri) {
          var t = laag(regel.tekst);
          if (!BEDRAG_LABELS[niveau].test(t)) return;
          if (niveau > 0 && GEEN_EINDBEDRAG.test(t)) return;
          var b = bedragenIn(regel.tekst);
          var r = regel;
          if (!b.length && p.regels[ri + 1] && p.regels[ri + 1].y - regel.y < 20) { r = p.regels[ri + 1]; b = bedragenIn(r.tekst); }
          if (b.length) gevonden.push({ centen: b[b.length - 1], bron: citaat(p, r) });
        });
      });
      if (gevonden.length) {
        velden.centen = gevonden[0].centen;
        bron.centen = gevonden[0].bron;
        var anders = gevonden.filter(function (g) { return g.centen !== velden.centen; });
        if (anders.length) {
          alternatieven.centen = anders.map(function (g) { return g.centen; });
          waarschuwingen.push('Er staan meerdere eindbedragen in de factuur (ook ' +
            anders.map(function (g) { return EPC.centenNaarTekst(g.centen); }).join(', ') + '). Controleer welk bedrag je moet betalen.');
        }
      }
    }

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

    // ---- naam: "t.n.v.", anders de bovenste regel met een rechtsvorm op pagina 1 ----
    var p1 = paginas[0];
    if (p1) {
      for (var i = 0; i < p1.regels.length && !velden.naam; i++) {
        var tnv = /(?:t\.?\s?n\.?\s?v\.?|ten name van)\s*:?\s*(.{3,70})/i.exec(p1.regels[i].tekst);
        if (tnv && !/iban|[A-Z]{2}\d{2}/.test(tnv[1])) { velden.naam = tnv[1].trim(); bron.naam = citaat(p1, p1.regels[i]); }
      }
      var grens = (p1.hoogte || 842) * 0.25;
      for (var n = 0; n < p1.regels.length && !velden.naam; n++) {
        var reg = p1.regels[n];
        if (reg.y > grens) break;
        var deel = reg.delen[0] ? reg.delen[0].s : reg.tekst;
        if (RECHTSVORM.test(deel) && deel.length <= 70) { velden.naam = deel.trim(); bron.naam = citaat(p1, reg); }
      }
    }

    // ---- vervaldatum uit factuurdatum + termijn ----
    if (!velden.vervaldatum && velden.factuurdatum && velden.termijnDagen) {
      var d = new Date(velden.factuurdatum + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + velden.termijnDagen);
      velden.vervaldatum = isoDatum(d);
      bron.vervaldatum = 'factuurdatum + ' + velden.termijnDagen + ' dagen (' + bron.termijnDagen + ')';
    }

    return { velden: velden, bron: bron, alternatieven: alternatieven, waarschuwingen: waarschuwingen };
  }

  // Omschrijving voor de overschrijving: het betalingskenmerk als dat er is, anders "Factuur <nummer>".
  function omschrijving(velden) {
    if (velden.kenmerk) return velden.kenmerk;
    if (velden.factuurnummer) return 'Factuur ' + velden.factuurnummer;
    return '';
  }

  root.Factuur = { analyseer: analyseer, omschrijving: omschrijving, ibansIn: ibansIn, bedragenIn: bedragenIn };
})(typeof self !== 'undefined' ? self : this);
