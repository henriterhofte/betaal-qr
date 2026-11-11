// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// EPC-QR (EPC069-12, versie 002): de "SEPA Credit Transfer"-QR-code die bank-apps kunnen scannen.
// Puur rekenwerk, geen DOM: bruikbaar in de pagina en in test.html.
(function (root) {
  'use strict';

  var MAX_NAAM = 70;
  var MAX_OMSCHRIJVING = 140;
  var MAX_KENMERK = 35;
  var MAX_BYTES = 331;

  // Tekens die alle SEPA-banken accepteren. Andere tekens vervangen we, zodat geen bank de betaling weigert.
  var SEPA_TEKENS = /[^A-Za-z0-9\/\-?:().,'+ ]/g;

  function sepaTekst(s) {
    var schoon = String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // é -> e, ë -> e
      .replace(/[&]/g, '+')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(SEPA_TEKENS, '')
      .replace(/ {2,}/g, ' ')
      .trim();
    return schoon;
  }

  function normaliseerIban(s) {
    return String(s || '').replace(/[\s.\-]/g, '').toUpperCase();
  }

  function ibanGeldig(iban) {
    iban = normaliseerIban(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    return mod97(iban) === 1;
  }

  function formatteerIban(iban) {
    return normaliseerIban(iban).replace(/(.{4})/g, '$1 ').trim();
  }

  // Bedrag -> centen (geheel getal); null als leeg, NaN als niet eenduidig te lezen.
  // Streng: alleen vormen die maar op één manier te lezen zijn, want een verkeerd gelezen bedrag is erger dan een foutmelding.
  //   9669 | 9669,30 | 9669.30 | 9.669,30 | 9,669.30 | 1.250 (= 1250) | ,50
  var BEDRAG_VORMEN = [
    /^(\d+)()$/,
    /^(\d*)[.,](\d{1,2})$/,
    /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/,
    /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/
  ];
  function bedragInCenten(s) {
    var t = String(s || '').replace(/[€\s]/g, '').replace(/^EUR/i, '');
    if (t === '') return null;
    for (var i = 0; i < BEDRAG_VORMEN.length; i++) {
      var m = BEDRAG_VORMEN[i].exec(t);
      if (!m) continue;
      var heel = m[1].replace(/[.,]/g, '') || '0', frac = m[2] || '';
      if (heel.length > 12) return NaN;
      return parseInt(heel, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    }
    return NaN;
  }

  function centenNaarEpc(c) {
    return 'EUR' + Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');
  }

  function centenNaarTekst(c) {
    var heel = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return '€ ' + heel + ',' + String(c % 100).padStart(2, '0');
  }

  // ISO 11649-betalingskenmerk ("RF18 5390 0754 7034"): mod-97-controle zoals bij IBAN.
  function rfKenmerkGeldig(s) {
    var k = String(s || '').replace(/\s/g, '').toUpperCase();
    if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(k)) return false;
    return mod97(k) === 1;
  }

  // ISO 7064 mod 97-10 (IBAN en RF-kenmerk): eerste 4 tekens naar achteren, letters als 10..35.
  function mod97(k) {
    var r = k.slice(4) + k.slice(0, 4), rest = 0;
    for (var i = 0; i < r.length; i++) {
      var c = r.charCodeAt(i), d = c >= 65 ? String(c - 55) : r[i];
      for (var j = 0; j < d.length; j++) rest = (rest * 10 + (d.charCodeAt(j) - 48)) % 97;
    }
    return rest;
  }

  function utf8Lengte(s) {
    return new TextEncoder().encode(s).length;
  }

  // invoer: {naam, iban, bic, bedrag, omschrijving}
  // Uitvoer: {ok, fouten: {veld: tekst}, waarschuwingen: [tekst], payload, velden}
  function maak(invoer) {
    var fouten = {}, waarschuwingen = [];

    var naam = sepaTekst(invoer.naam);
    if (!naam) fouten.naam = 'Vul de naam van de ontvanger in.';
    else if (naam.length > MAX_NAAM) fouten.naam = 'Maximaal ' + MAX_NAAM + ' tekens.';
    else if (naam !== String(invoer.naam || '').trim()) waarschuwingen.push('Naam aangepast naar SEPA-tekens: "' + naam + '".');

    var iban = normaliseerIban(invoer.iban);
    if (!iban) fouten.iban = 'Vul het IBAN in.';
    else if (!ibanGeldig(iban)) fouten.iban = 'Dit IBAN klopt niet (controlegetal of lengte).';

    var bic = normaliseerIban(invoer.bic);
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) fouten.bic = 'Een BIC heeft 8 of 11 tekens, bijvoorbeeld RABONL2U.';

    var centen = bedragInCenten(invoer.bedrag);
    if (centen === null) fouten.bedrag = 'Vul een bedrag in.';
    else if (isNaN(centen)) fouten.bedrag = 'Gebruik een bedrag zoals 9669,30.';
    else if (centen < 1 || centen > 99999999999) fouten.bedrag = 'Het bedrag moet tussen € 0,01 en € 999.999.999,99 liggen.';

    var ruw = String(invoer.omschrijving || '').trim();
    var kenmerk = '', omschrijving = '';
    if (rfKenmerkGeldig(ruw)) {
      kenmerk = ruw.replace(/\s/g, '').toUpperCase();
      if (kenmerk.length > MAX_KENMERK) fouten.omschrijving = 'Kenmerk te lang.';
    } else {
      omschrijving = sepaTekst(ruw);
      if (omschrijving.length > MAX_OMSCHRIJVING) fouten.omschrijving = 'Maximaal ' + MAX_OMSCHRIJVING + ' tekens (nu ' + omschrijving.length + ').';
      else if (omschrijving !== ruw.replace(/\s+/g, ' ')) waarschuwingen.push('Omschrijving aangepast naar SEPA-tekens: "' + omschrijving + '".');
      if (!omschrijving) waarschuwingen.push('Geen omschrijving: zet er meestal het factuurnummer in.');
    }

    var ok = Object.keys(fouten).length === 0;
    var payload = null;
    if (ok) {
      payload = [
        'BCD', '002', '1', 'SCT',
        bic, naam, iban, centenNaarEpc(centen),
        '',            // purpose code
        kenmerk,       // gestructureerd kenmerk (RF...)
        omschrijving   // vrije omschrijving
      ].join('\n').replace(/\n+$/, '');
      if (utf8Lengte(payload) > MAX_BYTES) {
        ok = false;
        fouten.omschrijving = 'De QR-code wordt te groot; maak naam of omschrijving korter.';
        payload = null;
      }
    }

    return {
      ok: ok, fouten: fouten, waarschuwingen: waarschuwingen, payload: payload,
      velden: { naam: naam, iban: iban, bic: bic, centen: centen, kenmerk: kenmerk, omschrijving: omschrijving }
    };
  }

  // Een bestaande EPC-QR lezen (bijvoorbeeld van een factuur). Geeft null als het geen geldige
  // SEPA-overschrijving is. Versie 001 (BIC verplicht) en 002; tekenset 1 (UTF-8) of anders.
  function lees(tekst) {
    var r = String(tekst || '').replace(/\r\n?/g, '\n').split('\n');
    if (r[0] !== 'BCD' || !/^00[12]$/.test(r[1] || '') || r[3] !== 'SCT') return null;
    var iban = normaliseerIban(r[6]);
    if (!ibanGeldig(iban)) return null;
    var centen = null;
    var m = /^EUR(\d{1,9})(?:\.(\d{1,2}))?$/.exec(r[7] || '');
    if (m) centen = parseInt(m[1], 10) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
    return {
      bic: normaliseerIban(r[4]), naam: String(r[5] || '').trim(), iban: iban, centen: centen,
      kenmerk: String(r[9] || '').trim(), omschrijving: String(r[10] || '').trim()
    };
  }

  root.EPC = {
    maak: maak, lees: lees, ibanGeldig: ibanGeldig, normaliseerIban: normaliseerIban, formatteerIban: formatteerIban,
    bedragInCenten: bedragInCenten, centenNaarTekst: centenNaarTekst, rfKenmerkGeldig: rfKenmerkGeldig,
    sepaTekst: sepaTekst
  };
})(typeof self !== 'undefined' ? self : this);
