// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// Een agendaherinnering (.ics, RFC 5545) voor een betaling: een afspraak voor de hele dag op de
// betaaldatum, met meldingen twee dagen ervoor en op de dag zelf (09:00), alle betaalgegevens in de
// beschrijving en de QR-code als bijlage (niet elke agenda toont bijlagen; de tekst is genoeg om te betalen).
// Puur rekenwerk, geen DOM.
(function (root) {
  'use strict';

  var EPC = root.EPC;

  // Tekstwaarde escapen (RFC 5545 §3.3.11).
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  // Regels vouwen op 75 octets (UTF-8), vervolgregels beginnen met een spatie (§3.1).
  function vouw(regel) {
    var bytes = new TextEncoder().encode(regel);
    if (bytes.length <= 75) return regel;
    var uit = [], huidig = '', lengte = 0, max = 75;
    for (var i = 0; i < regel.length; i++) {
      var ch = regel[i];
      var code = regel.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) { ch += regel[++i]; }   // surrogaatpaar niet splitsen
      var n = new TextEncoder().encode(ch).length;
      if (lengte + n > max) { uit.push(huidig); huidig = ' '; lengte = 1; max = 75; }
      huidig += ch; lengte += n;
    }
    uit.push(huidig);
    return uit.join('\r\n');
  }

  function datumIcs(iso) { return iso.replace(/-/g, ''); }
  function volgendeDag(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function stempel(nu) { return nu.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function datumTekst(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    var dagen = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    return dagen[d.getUTCDay()] + ' ' + iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);
  }

  function korteDatum(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getUTCDay()] + ' ' + alsTekst(iso);
  }
  // 'JJJJ-MM-DD' -> 'dd-mm-jjjj': altijd zo, wat de taal van de browser ook is (die geeft soms mm/dd/jjjj).
  function alsTekst(iso) { return iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : ''; }
  function dagErbij(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // Wat iemand intikt naar 'JJJJ-MM-DD', of null. Dag eerst: 24-11-2026, 24/11/26, 24.11.2026, 24112026;
  // en de ISO-vorm 2026-11-24. Een niet-bestaande datum (31-02) geeft null.
  function leesDatum(tekst) {
    var s = String(tekst || '').trim(), j, m, d, r;
    if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { j = +r[1]; m = +r[2]; d = +r[3]; }
    else if ((r = /^(\d{1,2})\s*[-\/.\s]\s*(\d{1,2})\s*[-\/.\s]\s*(\d{4}|\d{2})$/.exec(s)) || (r = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(s))) {
      d = +r[1]; m = +r[2]; j = +r[3]; if (r[3].length === 2) j += 2000;
    } else return null;
    var t = new Date(Date.UTC(j, m - 1, d));
    if (t.getUTCFullYear() !== j || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return t.toISOString().slice(0, 10);
  }
  // Voorstel voor de betaaldatum: een dag voor de uiterste datum, maar niet in het verleden.
  // (Overboekingen zijn in Nederland direct en ook in het weekend; met feestdagen hoeft geen rekening te worden gehouden.)
  function voorstelBetaaldatum(uiterlijk, vandaag) {
    if (!uiterlijk) return '';
    var d = dagErbij(uiterlijk, -1);
    return d < vandaag ? vandaag : d;
  }

  // betaling: EPC.maak(...).velden; datum: 'JJJJ-MM-DD'; qrPngBase64: optioneel; opties: {uid, nu, url, uiterlijk}
  function maak(betaling, datum, qrPngBase64, opties) {
    opties = opties || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum || '')) throw new Error('datum ontbreekt of is ongeldig');
    var v = betaling;
    var bedrag = EPC.centenNaarTekst(v.centen);
    var oms = v.kenmerk || v.omschrijving || '';
    var kort = v.naam.length > 40 ? v.naam.slice(0, 38) + '…' : v.naam;

    var beschrijving = [
      'Betaal ' + bedrag + ' aan ' + v.naam + '.',
      '',
      'Naam: ' + v.naam,
      'IBAN: ' + EPC.formatteerIban(v.iban),
      v.bic ? 'BIC: ' + v.bic : null,
      'Bedrag: ' + bedrag,
      v.kenmerk ? 'Betalingskenmerk: ' + v.kenmerk : 'Omschrijving: ' + (oms || '(geen)'),
      'Betaaldatum: ' + datumTekst(datum),
      opties.uiterlijk && opties.uiterlijk !== datum ? 'Uiterste betaaldatum (factuur): ' + datumTekst(opties.uiterlijk) : null,
      '',
      qrPngBase64 ? 'De betaal-QR-code zit als bijlage bij deze afspraak (niet elke agenda toont die). Lukt scannen niet, neem de gegevens hierboven dan over in je bank-app.' : 'Neem de gegevens hierboven over in je bank-app.',
      'Vergelijk het IBAN met de factuur en let op de naam-nummercontrole van je bank.',
      '',
      'Gemaakt met Betaal-QR' + (opties.url ? ' (' + opties.url + ')' : '') + '.'
    ].filter(function (r) { return r !== null; }).join('\n');

    var r = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Betaal-QR//betaal.terhofte.net//NL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + (opties.uid || 'betaling-' + Date.now() + '-' + Math.random().toString(36).slice(2)) + '@betaal.terhofte.net',
      'DTSTAMP:' + stempel(opties.nu || new Date()),
      'DTSTART;VALUE=DATE:' + datumIcs(datum),
      'DTEND;VALUE=DATE:' + datumIcs(volgendeDag(datum)),
      'SUMMARY:' + esc('Betalen: ' + bedrag + ' aan ' + kort + (oms ? ' (' + oms + ')' : '')),
      'DESCRIPTION:' + esc(beschrijving),
      'TRANSP:TRANSPARENT',
      'CATEGORIES:' + esc('Betalingen')
    ];
    if (qrPngBase64) {
      r.push('ATTACH;FMTTYPE=image/png;ENCODING=BASE64;VALUE=BINARY;X-FILENAME=betaal-qr.png:' + qrPngBase64);
    }
    // Twee dagen ervoor om 09:00 en op de dag zelf om 09:00 (een hele-dag-afspraak begint om 00:00).
    [['-P1DT15H', 'Over twee dagen betalen: '], ['PT9H', 'Vandaag betalen: ']].forEach(function (a) {
      r.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:' + a[0], 'DESCRIPTION:' + esc(a[1] + bedrag + ' aan ' + kort), 'END:VALARM');
    });
    r.push('END:VEVENT', 'END:VCALENDAR');
    return r.map(vouw).join('\r\n') + '\r\n';
  }

  root.Herinnering = { maak: maak, datumTekst: datumTekst, korteDatum: korteDatum, alsTekst: alsTekst, leesDatum: leesDatum,
    voorstelBetaaldatum: voorstelBetaaldatum, vouw: vouw, esc: esc };
})(typeof self !== 'undefined' ? self : this);
