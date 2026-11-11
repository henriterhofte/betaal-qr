// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
(function () {
  'use strict';

  var OPSLAG = 'betaalqr.ontvangers';
  var $ = function (id) { return document.getElementById(id); };
  var velden = ['naam', 'iban', 'bic', 'bedrag', 'omschrijving'];
  var laatste = null;   // uitkomst van EPC.maak() voor stap 2 en 3

  // Clickjacking: GitHub Pages kan geen frame-ancestors-header sturen, dus weigeren we zelf in een frame te werken.
  if (window.top !== window.self) {
    $('app').remove();
    $('ingebed').hidden = false;
    return;
  }

  // Bewust GEEN vooraf ingevulde links (?iban=… of #iban=…): zo'n link op dit domein zou een
  // handig phishingmiddel zijn ("betaal via betaal.terhofte.net/#iban=<oplichter>").

  // ---- bewaarde ontvangers (alleen localStorage van deze browser) ----
  function leesOntvangers() {
    try { return JSON.parse(localStorage.getItem(OPSLAG) || '[]') || []; } catch (e) { return []; }
  }
  function schrijfOntvangers(lijst) {
    try { localStorage.setItem(OPSLAG, JSON.stringify(lijst)); return true; } catch (e) { return false; }
  }
  function vulLijst(kies) {
    var sel = $('opgeslagen');
    var lijst = leesOntvangers().sort(function (a, b) { return a.naam.localeCompare(b.naam, 'nl'); });
    sel.length = 1;
    lijst.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.iban;
      opt.textContent = o.naam + ' · ' + EPC.formatteerIban(o.iban);
      sel.appendChild(opt);
    });
    sel.value = kies || '';
    $('verwijder').disabled = !sel.value;
    $('veld-opgeslagen').hidden = lijst.length === 0;
  }

  $('opgeslagen').addEventListener('change', function () {
    var iban = this.value;
    var o = leesOntvangers().filter(function (x) { return x.iban === iban; })[0];
    $('verwijder').disabled = !o;
    if (!o) return;
    $('naam').value = o.naam;
    $('iban').value = EPC.formatteerIban(o.iban);
    $('bic').value = o.bic || '';
    controleer();
    $('bedrag').focus();
  });

  $('verwijder').addEventListener('click', function () {
    var iban = $('opgeslagen').value;
    if (!iban) return;
    schrijfOntvangers(leesOntvangers().filter(function (x) { return x.iban !== iban; }));
    vulLijst();
  });

  // ---- stap 1: invullen ----
  var aangeraakt = {};
  function invoer() {
    var i = {};
    velden.forEach(function (v) { i[v] = $(v).value; });
    return i;
  }
  function controleer(alles) {
    $('teller').textContent = $('omschrijving').value.length;
    var r = EPC.maak(invoer());
    velden.forEach(function (v) {
      var toon = (alles || aangeraakt[v]) && r.fouten[v];
      $('fout-' + v).textContent = toon || '';
      $(v).setAttribute('aria-invalid', toon ? 'true' : 'false');
    });
    return r;
  }
  velden.forEach(function (v) {
    $(v).addEventListener('input', function () { controleer(); });
    $(v).addEventListener('blur', function () {
      aangeraakt[v] = true;
      if (v === 'iban' && EPC.ibanGeldig(this.value)) this.value = EPC.formatteerIban(this.value);
      controleer();
    });
  });

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('form').classList.contains('geblokkeerd')) return;
    var r = controleer(true);
    if (!r.ok) {
      var eerste = velden.filter(function (v) { return r.fouten[v]; })[0];
      if (eerste) $(eerste).focus();
      return;
    }
    laatste = r;
    vulControle(r);
    naarStap(2);
  });

  $('wis').addEventListener('click', function () {
    velden.forEach(function (v) { $(v).value = ''; });
    aangeraakt = {};
    herkenning = null;
    factuurStatus('');
    zetGeblokkeerd(null);
    $('opgeslagen').value = '';
    $('verwijder').disabled = true;
    controleer();
    $('naam').focus();
  });

  // ---- factuur (PDF) lokaal lezen ----
  // herkenning: wat uit de laatst gelezen factuur kwam, om in stap 2 de herkomst te tonen.
  var herkenning = null;
  var VELDNAMEN = { naam: 'Naam', iban: 'IBAN', bic: 'BIC', bedrag: 'Bedrag', omschrijving: 'Omschrijving' };

  function factuurStatus(tekst, soort) {
    var s = $('factuur-status');
    s.hidden = !tekst;
    s.className = 'factuur-status' + (soort ? ' ' + soort : '');
    s.textContent = tekst || '';
  }

  function bedragAlsInvoer(c) {
    return c == null ? '' : EPC.centenNaarTekst(c).replace('€ ', '');
  }

  async function leesFactuur(bestand) {
    if (!bestand) return;
    if (bestand.size > 25 * 1024 * 1024) { factuurStatus('Dit bestand is groter dan 25 MB; dat is voor een factuur ongebruikelijk.', 'fout'); return; }
    // Aan de inhoud zien of het een PDF is: mailapps geven bijlagen vaak door als "binair bestand"
    // (application/octet-stream), soms zonder .pdf in de naam. Een PDF begint met %PDF- (in de eerste 1 kB).
    var kop = new TextDecoder('latin1').decode(await bestand.slice(0, 1024).arrayBuffer());
    if (kop.indexOf('%PDF-') < 0) { factuurStatus('Dit is geen PDF. Kies of deel een factuur als PDF-bestand.', 'fout'); return; }
    if (!/\.pdf$/i.test(bestand.name)) bestand = new File([bestand], (bestand.name || 'factuur') + '.pdf', { type: 'application/pdf' });
    zetGeblokkeerd(null);
    factuurStatus('Factuur wordt gelezen…');
    var res;
    try {
      var mod = await import('./pdflezer.mjs');
      res = await mod.leesPdf(await bestand.arrayBuffer());
    } catch (e) {
      var wachtwoord = e && /password/i.test(e.name + ' ' + e.message);
      factuurStatus(wachtwoord ? 'Deze PDF is met een wachtwoord beveiligd. Vul de gegevens zelf in.'
        : 'Deze PDF kon niet worden gelezen. Vul de gegevens zelf in.', 'fout');
      return;
    }

    var a = Factuur.analyseer(res.paginas);
    var g = a.velden, bron = Object.assign({}, a.bron), meldingen = a.waarschuwingen.map(function (t) { return { t: t }; });
    var uit = { naam: g.naam || '', iban: g.iban || '', bic: g.bic || '', centen: g.centen, omschrijving: Factuur.omschrijving(g) };
    if (g.kenmerk) bron.omschrijving = bron.kenmerk; else if (g.factuurnummer) bron.omschrijving = bron.factuurnummer;
    bron.bedrag = bron.centen;

    // Een EPC-QR op de factuur is exact; vergelijk hem wel met de tekst (een opgeplakte QR is een bekende fraudetruc).
    var qr = null;
    res.qrCodes.some(function (q) { var l = EPC.lees(q.tekst); if (l) { qr = l; qr.pagina = q.pagina; } return !!l; });
    if (qr) {
      var qrBron = 'betaal-QR-code op de factuur, pagina ' + qr.pagina;
      if (g.iban && g.iban !== qr.iban) meldingen.push({ t: 'Het IBAN in de QR-code op de factuur (' + EPC.formatteerIban(qr.iban) + ') is anders dan het IBAN in de tekst (' + EPC.formatteerIban(g.iban) + '). Dat kan op fraude wijzen. Bel de afzender op een nummer dat je al had.', ernstig: true });
      if (g.centen != null && qr.centen != null && g.centen !== qr.centen) meldingen.push({ t: 'Het bedrag in de QR-code op de factuur (' + EPC.centenNaarTekst(qr.centen) + ') is anders dan het bedrag in de tekst (' + EPC.centenNaarTekst(g.centen) + ').', ernstig: true });
      uit.iban = qr.iban; bron.iban = qrBron;
      if (qr.naam) { uit.naam = qr.naam; bron.naam = qrBron; }
      if (qr.bic) { uit.bic = qr.bic; bron.bic = qrBron; }
      if (qr.centen != null) { uit.centen = qr.centen; bron.bedrag = qrBron; }
      if (qr.kenmerk || qr.omschrijving) { uit.omschrijving = qr.kenmerk || qr.omschrijving; bron.omschrijving = qrBron; }
    }

    // Is dit IBAN al bekend? Dan de bewaarde naam gebruiken (betrouwbaarder dan een gok uit het briefhoofd).
    var bekend = leesOntvangers().filter(function (o) { return o.iban === uit.iban; })[0];
    if (bekend) { uit.naam = bekend.naam; bron.naam = 'je bewaarde ontvanger'; if (!uit.bic && bekend.bic) { uit.bic = bekend.bic; bron.bic = 'je bewaarde ontvanger'; } }
    else if (uit.iban) meldingen.push({ t: 'Dit rekeningnummer staat nog niet bij je bewaarde ontvangers. Betaal je deze ontvanger voor het eerst? Controleer het rekeningnummer dan via een tweede bron, zoals hun website of een eerdere factuur.' });

    var invoerWaarden = { naam: uit.naam, iban: uit.iban ? EPC.formatteerIban(uit.iban) : '', bic: uit.bic, bedrag: bedragAlsInvoer(uit.centen), omschrijving: uit.omschrijving };
    velden.forEach(function (v) { $(v).value = invoerWaarden[v] || ''; aangeraakt[v] = !!invoerWaarden[v]; });
    $('opgeslagen').value = bekend ? bekend.iban : '';
    controleer();

    herkenning = { bestand: bestand.name, waarden: invoerWaarden, bron: bron, meldingen: meldingen, vervaldatum: g.vervaldatum || null };

    var gevonden = velden.filter(function (v) { return invoerWaarden[v]; });
    var mist = ['naam', 'iban', 'bedrag', 'omschrijving'].filter(function (v) { return !invoerWaarden[v]; });
    var tekstloos = res.paginas.every(function (p) { return p.regels.length === 0; });
    if (tekstloos && !qr) {
      factuurStatus('Deze PDF bevat geen tekst; waarschijnlijk is het een scan. Die kan Betaal-QR nog niet lezen. Vul de gegevens zelf in.', 'fout');
      herkenning = null;
      return;
    }
    // Zegt de factuur dat er niets (meer) betaald hoeft te worden? Dan tonen we wat herkend is, maar
    // grijs en zonder door te kunnen, met "Toch betalen" voor als Betaal-QR het verkeerd ziet.
    if (a.status) {
      factuurStatus('Gelezen uit ' + bestand.name + '.', 'ok');
      zetGeblokkeerd(a.status);
      return;
    }
    if (!gevonden.length) {
      factuurStatus('In ' + bestand.name + ' staan geen betaalgegevens die Betaal-QR herkent. Is het wel een factuur? Vul de gegevens zelf in.', 'let-op');
      herkenning = null;
      return;
    }
    if (!invoerWaarden.iban) {
      factuurStatus('Gelezen uit ' + bestand.name + ', maar er staat geen rekeningnummer op de factuur. Vaak betekent dat: al betaald (bijvoorbeeld in een webshop) of automatische incasso. Kijk op de factuur. Moet je wel betalen, vul het rekeningnummer dan zelf in.', 'let-op');
      $('iban').focus();
      return;
    }
    factuurStatus('Gelezen uit ' + bestand.name + '. Gevonden: ' + (gevonden.map(function (v) { return VELDNAMEN[v].toLowerCase(); }).join(', ') || 'niets') + '.' +
      (mist.length ? ' Niet gevonden: ' + mist.map(function (v) { return VELDNAMEN[v].toLowerCase(); }).join(', ') + '; vul die zelf in.' : '') +
      ' Controleer alles met de factuur.', mist.length ? 'let-op' : 'ok');
    var leeg = mist.filter(function (v) { return v !== 'omschrijving'; })[0];
    $(leeg || 'naar2').focus();
  }

  var STATUS_TEKST = {
    betaald: ['Deze factuur lijkt al betaald', 'Dan hoef je niets te doen.'],
    incasso: ['Dit bedrag wordt waarschijnlijk automatisch afgeschreven', 'Dan hoef je niets te doen. Betaal je het zelf ook, dan betaal je mogelijk dubbel.'],
    credit: ['Dit lijkt een creditnota', 'Bij een creditnota krijg je geld terug; je hoeft niets te betalen.'],
    bewijs: ['Dit lijkt een kaartje of betaalbewijs', 'Dat is meestal al betaald; je hoeft dan niets te doen.']
  };
  // status: {soort, bron} uit Factuur.analyseer, of null om weer vrij te geven.
  function zetGeblokkeerd(status) {
    var aan = !!status;
    $('form').classList.toggle('geblokkeerd', aan);
    velden.forEach(function (v) { $(v).readOnly = aan; });
    $('opgeslagen').disabled = aan;
    $('naar2').disabled = aan;
    $('factuur-melding').hidden = !aan;
    if (!aan) return;
    var tekst = STATUS_TEKST[status.soort];
    $('fm-titel').textContent = tekst[0];
    $('fm-bron').textContent = 'Op de factuur staat: ' + status.bron.replace(/^pagina (\d+): (.*)$/, '$2 (pagina $1)') + '.';
    $('fm-uitleg').textContent = tekst[1] + (velden.some(function (v) { return $(v).value; }) ? ' Hieronder zie je wat Betaal-QR herkende.' : '');
    if (herkenning) herkenning.status = status;
    $('fm-toch').focus();
  }
  $('fm-toch').addEventListener('click', function () {
    var st = herkenning && herkenning.status;
    zetGeblokkeerd(null);
    if (st) herkenning.meldingen.unshift({ t: 'Volgens de factuur hoeft er niets betaald te worden (' + st.bron + '). Je hebt gekozen om toch te betalen: controleer dat je niet dubbel betaalt.', ernstig: true });
    var leeg = ['naam', 'iban', 'bedrag'].filter(function (v) { return !$(v).value; })[0];
    $(leeg || 'naar2').focus();
  });

  $('factuur-bestand').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';   // dezelfde PDF nog eens kiezen moet ook werken
    leesFactuur(f);
  });
  // Slepen en neerzetten op stap 1 (computer)
  ['dragover', 'dragenter'].forEach(function (t) {
    $('stap1').addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); $('factuur-zone').classList.add('sleep'); } });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    $('stap1').addEventListener(t, function () { $('factuur-zone').classList.remove('sleep'); });
  });
  $('stap1').addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    leesFactuur(f);
  });

  function datumTekst(iso) {
    var d = new Date(iso + 'T12:00:00');
    var dag = d.toLocaleDateString('nl-NL', { weekday: 'long' });
    return dag + ' ' + iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);
  }

  // ---- stap 2: controleren ----
  function vulControle(r) {
    var v = r.velden;
    $('c-bedrag').textContent = EPC.centenNaarTekst(v.centen);
    $('c-naam').textContent = v.naam;
    $('c-iban').textContent = EPC.formatteerIban(v.iban) + (v.bic ? ' (' + v.bic + ')' : '');
    $('c-oms').textContent = v.kenmerk ? 'Kenmerk ' + v.kenmerk : (v.omschrijving || '—');
    var ul = $('waarschuwingen'); ul.textContent = '';
    ibanWijzigingen(v).forEach(function (t) { meld(t).classList.add('ernstig'); });

    // Herkomst en meldingen van een gelezen factuur (alleen voor velden die nog zo zijn als gelezen)
    var lijst = $('c-herkomst-lijst'); lijst.textContent = '';
    $('c-herkomst').hidden = !herkenning;
    $('c-verval-rij').hidden = !(herkenning && herkenning.vervaldatum);
    if (herkenning) {
      if (herkenning.vervaldatum) $('c-verval').textContent = datumTekst(herkenning.vervaldatum);
      velden.forEach(function (veld) {
        var nu = $(veld).value.trim();
        if (!nu) return;
        var li = document.createElement('li');
        var gelijk = nu === String(herkenning.waarden[veld] || '').trim();
        li.textContent = VELDNAMEN[veld] + ': ' + (gelijk ? (herkenning.bron[veld] || 'uit ' + herkenning.bestand) : 'door jou ingevuld of aangepast');
        lijst.appendChild(li);
      });
      if (herkenning.vervaldatum) {
        var lv = document.createElement('li');
        lv.textContent = 'Betalen vóór: ' + (herkenning.bron.vervaldatum || 'uit ' + herkenning.bestand);
        lijst.appendChild(lv);
      }
      herkenning.meldingen.forEach(function (m) { var li = meld(m.t); if (m.ernstig) li.classList.add('ernstig'); });
    }
    r.waarschuwingen.forEach(meld);
    var bekend = leesOntvangers().some(function (o) { return o.iban === v.iban; });
    $('bewaar').checked = false;
    $('bewaar').parentNode.hidden = bekend;
  }
  function meld(t) {
    var li = document.createElement('li');
    li.textContent = t;
    $('waarschuwingen').appendChild(li);
    return li;
  }

  // Factuurfraude ("ons rekeningnummer is gewijzigd"): bekende naam met een ander IBAN dan bewaard.
  function ibanWijzigingen(v) {
    var naam = v.naam.toLowerCase();
    return leesOntvangers().filter(function (o) {
      return EPC.sepaTekst(o.naam).toLowerCase() === naam && o.iban !== v.iban;
    }).map(function (o) {
      return 'Let op: voor "' + o.naam + '" heb je eerder IBAN ' + EPC.formatteerIban(o.iban) +
        ' bewaard. Een gewijzigd rekeningnummer is een bekende vorm van fraude. Bel de ontvanger op een nummer dat je al had.';
    });
  }

  $('terug1').addEventListener('click', function () { naarStap(1); });
  $('naar3').addEventListener('click', function () {
    if (!laatste) return;
    if ($('bewaar').checked) {
      var v = laatste.velden;
      var lijst = leesOntvangers().filter(function (x) { return x.iban !== v.iban; });
      lijst.push({ naam: v.naam, iban: v.iban, bic: v.bic });
      schrijfOntvangers(lijst);
      vulLijst(v.iban);
    }
    vulBetalen(laatste);
    naarStap(3);
  });

  // ---- stap 3: betalen ----
  function vulBetalen(r) {
    var v = r.velden;
    tekenQr(r.payload);
    $('b-bedrag').textContent = EPC.centenNaarTekst(v.centen);
    $('b-naam').textContent = v.naam;
    $('k-naam').textContent = v.naam;
    $('k-iban').textContent = EPC.formatteerIban(v.iban);
    $('k-bedrag').textContent = kopieerTekst('bedrag');
    $('k-oms').textContent = kopieerTekst('omschrijving') || '—';
    $('payload').textContent = r.payload;
    var verval = herkenning && herkenning.vervaldatum;
    $('betaaldatum').value = verval || '';
    $('datum-herkomst').textContent = verval ? 'Uit de factuur. Je kunt de datum aanpassen.' : '';
    werkDatumBij();
  }

  // ---- later betalen: aanwijzing voor de bank-app en een agendaherinnering ----
  function vandaagIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function werkDatumBij() {
    var d = $('betaaldatum').value;
    var tip = $('datum-tip');
    $('ics').disabled = !d;
    if (!d) {
      tip.textContent = 'Kies een datum om een herinnering te maken.';
    } else if (d < vandaagIso()) {
      tip.textContent = 'Let op: ' + Herinnering.datumTekst(d) + ' is al voorbij. Betaal zo snel mogelijk.';
    } else if (d === vandaagIso()) {
      tip.textContent = 'Vandaag betalen.';
    } else {
      tip.textContent = 'Wil je het nu al regelen? Scan de code en kies in je bank-app als datum ' + Herinnering.datumTekst(d) +
        ' (heet vaak "Later uitvoeren", "Datum" of "Inplannen"). Of zet een herinnering in je agenda.';
    }
  }
  $('betaaldatum').addEventListener('input', function () {
    $('datum-herkomst').textContent = herkenning && herkenning.vervaldatum && this.value !== herkenning.vervaldatum ? 'Door jou aangepast.' : $('datum-herkomst').textContent;
    werkDatumBij();
  });
  $('ics').addEventListener('click', function () {
    var d = $('betaaldatum').value;
    if (!laatste || !d) return;
    var png = $('qr').toDataURL('image/png').split(',')[1];
    var ics = Herinnering.maak(laatste.velden, d, png, { url: location.origin + '/' });
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = bestandsnaam().replace(/^betaal-qr-/, 'betalen-').replace(/\.png$/, '.ics');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  function tekenQr(payload) {
    var qr = qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), rand = 4, schaal = 8;
    var c = $('qr'), px = (n + 2 * rand) * schaal;
    c.width = px; c.height = px;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
    g.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
      if (qr.isDark(r, k)) g.fillRect((k + rand) * schaal, (r + rand) * schaal, schaal, schaal);
    }
  }

  function kopieerTekst(veld) {
    var v = laatste.velden;
    if (veld === 'naam') return v.naam;
    if (veld === 'iban') return v.iban;
    if (veld === 'bedrag') return Math.floor(v.centen / 100) + ',' + String(v.centen % 100).padStart(2, '0');
    return v.kenmerk || v.omschrijving;
  }
  document.querySelectorAll('.kopieer').forEach(function (knop) {
    knop.addEventListener('click', function () {
      if (!laatste) return;
      var meldKort = function (t) { knop.textContent = t; setTimeout(function () { knop.textContent = 'Kopieer'; }, 1500); };
      if (!navigator.clipboard) { meldKort('Lukt niet'); return; }
      navigator.clipboard.writeText(kopieerTekst(knop.dataset.veld)).then(function () { meldKort('Gekopieerd'); }, function () { meldKort('Lukt niet'); });
    });
  });

  function bestandsnaam() {
    var oms = (laatste.velden.kenmerk || laatste.velden.omschrijving || 'betaling').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40);
    return 'betaal-qr-' + oms.replace(/^-|-$/g, '') + '.png';
  }
  $('download').addEventListener('click', function () {
    if (!laatste) return;
    $('qr').toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = bestandsnaam();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  });
  // Delen via het deelmenu van de telefoon: naar de bank-app (als die afbeeldingen aanneemt), naar Foto's of naar jezelf.
  var kanDelen = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  $('deel').hidden = !kanDelen;
  $('deel').addEventListener('click', function () {
    if (!laatste) return;
    $('qr').toBlob(function (blob) {
      navigator.share({ files: [new File([blob], bestandsnaam(), { type: 'image/png' })] }).catch(function () {});
    });
  });

  $('terug2').addEventListener('click', function () { naarStap(2); });
  $('nieuw').addEventListener('click', function () {
    velden.forEach(function (v) { $(v).value = ''; });
    aangeraakt = {};
    laatste = null;
    herkenning = null;
    factuurStatus('');
    zetGeblokkeerd(null);
    $('opgeslagen').value = '';
    controleer();
    naarStap(1);
  });

  // ---- doneren ----
  // "Al gedaan" verbergt de vraag een jaar, "Niet nu" dertig dagen (alleen in de opslag van deze browser).
  // De knop "Doneren" in de kopbalk werkt altijd, ook als de vraag verborgen is.
  var DONEER_OPSLAG = 'betaalqr.doneren';
  var DAG = 24 * 60 * 60 * 1000;
  var doneerToch = false;   // via de kopbalk gevraagd: dan toch tonen
  var huidigeStap = 1;
  function doneerVerborgen() {
    if (doneerToch) return false;
    try { var d = JSON.parse(localStorage.getItem(DONEER_OPSLAG) || 'null'); return !!(d && d.tot > Date.now()); } catch (e) { return false; }
  }
  function pasDonerenToe(n) {
    var weg = doneerVerborgen();
    $('doneer-actief').hidden = weg;
    $('doneren').hidden = n === 3 || weg;   // in stap 3 staat het blok al in de kaart
  }
  document.querySelectorAll('[data-doneer]').forEach(function (knop) {
    knop.addEventListener('click', function () {
      var gedaan = knop.dataset.doneer === 'gedaan';
      try { localStorage.setItem(DONEER_OPSLAG, JSON.stringify({ tot: Date.now() + (gedaan ? 365 : 30) * DAG, reden: knop.dataset.doneer })); } catch (e) {}
      doneerToch = false;
      var blok = knop.closest('.doneer');
      if (gedaan) {
        var dank = document.createElement('p');
        dank.className = 'doneer-dank';
        dank.setAttribute('role', 'status');
        dank.textContent = 'Dank je wel! Daar wordt de natuur blij van.';
        blok.parentNode.insertBefore(dank, blok.nextSibling);
        setTimeout(function () { dank.remove(); }, 6000);
      }
      pasDonerenToe(huidigeStap);
    });
  });
  $('naar-doneren').addEventListener('click', function (e) {
    e.preventDefault();
    doneerToch = true;
    pasDonerenToe(huidigeStap);
    var doel = $('stap3').hidden ? $('doneren') : $('doneer-actief');
    doel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (doel.querySelector('h2[tabindex]') || doel).focus({ preventScroll: true });
  });

  // ---- stappen wisselen ----
  function naarStap(n) {
    huidigeStap = n;
    [1, 2, 3].forEach(function (i) { $('stap' + i).hidden = i !== n; });
    // De slogan is voor wie begint; in stap 2 en 3 kost hij op een telefoon ruimte boven de kaart.
    document.querySelector('.slogan').hidden = n !== 1;
    pasDonerenToe(n);
    document.querySelectorAll('.stappen li').forEach(function (li) {
      var i = +li.dataset.stap;
      li.classList.toggle('gedaan', i <= n);
      if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('kop' + n).focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  // ---- vertrouwen: de CSP leesbaar tonen, de commit en de offline-status ----
  var cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  $('csp').textContent = cspMeta ? cspMeta.content.split(/;\s*/).join(';\n') : 'geen';
  var bron = self.BETAALQR_BRON;
  if (bron && bron.commit) {
    var a = $('broncommit');
    a.textContent = bron.commit.slice(0, 12);
    a.href = 'https://github.com/henriterhofte/betaal-qr/tree/' + bron.commit;
  } else {
    $('bron').textContent = 'Lokale ontwikkelversie (niet gebouwd met tools/bouw.py).';
  }

  vulLijst();
  controleer();
  naarStap(1);
  $('kop1').blur();

  // ---- een PDF die met de app is gedeeld (Android) of geopend ("Openen met", laptop) ----
  // Delen: de service worker heeft het bestand in de lokale cache gezet; wij halen het op en wissen het.
  var gedeeld = new URLSearchParams(location.search).get('gedeeld');
  if (gedeeld) {
    history.replaceState(null, '', location.pathname);
    if (!('caches' in self)) {
      factuurStatus('Het gedeelde bestand kon niet worden geopend. Kies het met "Factuur openen…".', 'fout');
    } else {
      caches.open('betaalqr-gedeeld').then(function (c) {
        // Eerst de beschrijving van wat er binnenkwam (voor "Wat Betaal-QR ontving"), dan het bestand.
        return c.match('gedeeld-info').then(function (ri) { return ri ? ri.json() : null; }).catch(function () { return null; })
          .then(function (info) {
            c.delete('gedeeld-info');
            toonOntvangen(info);
            if (gedeeld !== '1') {
              factuurStatus(gedeeld === 'fout'
                ? 'Er ging iets mis bij het ontvangen van het gedeelde bestand. Kies de factuur met "Factuur openen…".'
                : 'Er kwam geen bestand mee met het delen, alleen tekst of een link. Bewaar de PDF eerst (bijvoorbeeld in Downloads) en deel hem dan vanuit Bestanden, of kies hem met "Factuur openen…".', 'let-op');
              return;
            }
            return c.match('gedeelde-factuur').then(function (r) {
              if (!r) return;
              var naam = decodeURIComponent(r.headers.get('X-Bestandsnaam') || 'factuur');
              return r.blob().then(function (b) {
                c.delete('gedeelde-factuur');
                leesFactuur(new File([b], naam, { type: b.type || 'application/octet-stream' }));
              });
            });
          });
      }).catch(function () { factuurStatus('Het gedeelde bestand kon niet worden geopend. Kies het met "Factuur openen…".', 'fout'); });
    }
  }
  // "Wat Betaal-QR ontving": technische details van het delen, om problemen met een mailapp te kunnen uitzoeken.
  function toonOntvangen(info) {
    var blok = $('ontvangen');
    if (!info || !info.velden) { blok.hidden = true; return; }
    var lijst = $('ontvangen-lijst');
    lijst.textContent = '';
    if (!info.velden.length) {
      var leeg = document.createElement('li'); leeg.textContent = 'Niets: het delen bevatte geen gegevens.'; lijst.appendChild(leeg);
    }
    info.velden.forEach(function (v) {
      var li = document.createElement('li');
      li.textContent = v.soort === 'bestand'
        ? 'Bestand "' + (v.naam || '(geen naam)') + '", type ' + (v.type || '(onbekend)') + ', ' + Math.round(v.grootte / 1024) + ' kB (veld "' + v.veld + '")'
        : 'Tekst van ' + v.lengte + ' tekens (veld "' + v.veld + '"), geen bestand';
      lijst.appendChild(li);
    });
    blok.hidden = false;
  }
  // ---- installeren als app ----
  // Al geïnstalleerd: korte tip, geen uitleg. Anders: de uitleg voor deze browser bovenaan, en als de
  // browser het toestaat (Chrome, Edge) een echte knop die het installatievenster opent.
  function alsAppGeinstalleerd() {
    $('deel-tip').textContent = 'Je kunt een factuur ook delen naar Betaal-QR, of op je laptop openen met Betaal-QR.';
    $('installeren').hidden = true;
  }
  if ((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone) {
    alsAppGeinstalleerd();
  } else {
    var ua = navigator.userAgent;
    var browser = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
      : /Android/.test(ua) ? 'android' : /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : null;
    var eigen = browser && document.querySelector('.install-lijst [data-browser="' + browser + '"]');
    if (eigen) { eigen.classList.add('jouw-browser'); eigen.parentNode.insertBefore(eigen, eigen.parentNode.firstChild); }
    var installVraag = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();          // geen automatische balk; wij tonen de knop in de uitleg
      installVraag = e;
      $('install-nu').hidden = false;
    });
    $('install-knop').addEventListener('click', function () {
      if (!installVraag) return;
      installVraag.prompt();
      installVraag.userChoice.then(function () { installVraag = null; $('install-nu').hidden = true; });
    });
    window.addEventListener('appinstalled', alsAppGeinstalleerd);
  }
  // Openen met (File Handling API): het bestand komt via launchQueue binnen, zonder netwerk.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(function (params) {
      if (!params.files || !params.files.length) return;
      params.files[0].getFile().then(leesFactuur);
    });
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    // Updates: de browser kijkt bij elke start of sw.js veranderd is (de build zet de commit erin).
    // Is er een nieuwe versie actief geworden terwijl deze pagina open is, dan bieden we vernieuwen aan;
    // niet automatisch, want je kunt net iets aan het invullen zijn.
    var hadVersie = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadVersie) $('nieuwe-versie').hidden = false;
      hadVersie = true;
    });
    $('vernieuw').addEventListener('click', function () { location.reload(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      // Een geïnstalleerde app blijft vaak dagen open op de achtergrond: kijk ook bij terugkomen.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
      return navigator.serviceWorker.ready;
    }).then(function () {
      $('offline').textContent = 'Deze pagina staat nu ook offline op dit apparaat.';
    }).catch(function () {
      $('offline').textContent = 'Offline gebruik is in deze browser niet beschikbaar.';
    });
  }
})();
