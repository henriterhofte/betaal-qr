(function () {
  'use strict';

  var OPSLAG = 'betaalqr.ontvangers';
  var $ = function (id) { return document.getElementById(id); };
  var velden = ['naam', 'iban', 'bic', 'bedrag', 'omschrijving'];
  var laatste = null;

  // Clickjacking: GitHub Pages kan geen frame-ancestors-header sturen, dus weigeren we zelf in een frame te werken.
  if (window.top !== window.self) {
    document.querySelector('.layout').remove();
    $('ingebed').hidden = false;
    return;
  }

  // ---- opgeslagen ontvangers (alleen localStorage van deze browser) ----
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
  }

  $('opgeslagen').addEventListener('change', function () {
    var o = leesOntvangers().filter(function (x) { return x.iban === this.value; }, this)[0];
    $('verwijder').disabled = !o;
    if (!o) return;
    $('naam').value = o.naam;
    $('iban').value = EPC.formatteerIban(o.iban);
    $('bic').value = o.bic || '';
    $('bedrag').focus();
    werkBij();
  });

  $('bewaar').addEventListener('click', function () {
    var naam = $('naam').value.trim(), iban = EPC.normaliseerIban($('iban').value);
    if (!naam || !EPC.ibanGeldig(iban)) { werkBij(true); return; }
    var lijst = leesOntvangers().filter(function (x) { return x.iban !== iban; });
    lijst.push({ naam: naam, iban: iban, bic: EPC.normaliseerIban($('bic').value) });
    if (!schrijfOntvangers(lijst)) { alertTekst('Opslaan lukt niet in deze browser (privévenster?).'); return; }
    vulLijst(iban);
  });

  $('verwijder').addEventListener('click', function () {
    var iban = $('opgeslagen').value;
    if (!iban) return;
    schrijfOntvangers(leesOntvangers().filter(function (x) { return x.iban !== iban; }));
    vulLijst();
  });

  $('wis').addEventListener('click', function () {
    velden.forEach(function (v) { $(v).value = ''; });
    $('opgeslagen').value = '';
    $('verwijder').disabled = true;
    werkBij();
    $('naam').focus();
  });

  // ---- QR tekenen ----
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

  function alertTekst(t) {
    var ul = $('waarschuwingen'), li = document.createElement('li');
    li.textContent = t; ul.appendChild(li);
    return li;
  }

  // ---- formulier verwerken ----
  var aangeraakt = {};
  function werkBij(alles) {
    var invoer = {};
    velden.forEach(function (v) { invoer[v] = $(v).value; });
    $('teller').textContent = $('omschrijving').value.length;

    var r = EPC.maak(invoer);
    velden.forEach(function (v) {
      var toon = (alles || aangeraakt[v]) && r.fouten[v];
      $('fout-' + v).textContent = toon || '';
      $(v).setAttribute('aria-invalid', toon ? 'true' : 'false');
    });

    laatste = r.ok ? r : null;
    $('klaar').hidden = !r.ok;
    $('leeg').hidden = r.ok;
    if (!r.ok) return;

    tekenQr(r.payload);
    $('s-naam').textContent = r.velden.naam;
    $('s-iban').textContent = EPC.formatteerIban(r.velden.iban) + (r.velden.bic ? ' (' + r.velden.bic + ')' : '');
    $('s-bedrag').textContent = EPC.centenNaarTekst(r.velden.centen);
    $('s-oms').textContent = r.velden.kenmerk ? 'Kenmerk ' + r.velden.kenmerk : (r.velden.omschrijving || '—');
    $('payload').textContent = r.payload;
    var ul = $('waarschuwingen'); ul.textContent = '';
    ibanWijzigingen(r.velden).forEach(function (t) { alertTekst(t).classList.add('ernstig'); });
    r.waarschuwingen.forEach(alertTekst);
  }

  // Factuurfraude ("ons rekeningnummer is gewijzigd"): bekende naam met een ander IBAN dan opgeslagen.
  function ibanWijzigingen(v) {
    var naam = v.naam.toLowerCase();
    return leesOntvangers().filter(function (o) {
      return EPC.sepaTekst(o.naam).toLowerCase() === naam && o.iban !== v.iban;
    }).map(function (o) {
      return 'Let op: voor "' + o.naam + '" heb je eerder IBAN ' + EPC.formatteerIban(o.iban) +
        ' bewaard. Een gewijzigd rekeningnummer is een bekende vorm van fraude. Bel de ontvanger op een nummer dat je al had.';
    });
  }

  velden.forEach(function (v) {
    $(v).addEventListener('input', function () { werkBij(); });
    $(v).addEventListener('blur', function () {
      aangeraakt[v] = true;
      if (v === 'iban' && EPC.ibanGeldig(this.value)) this.value = EPC.formatteerIban(this.value);
      werkBij();
    });
  });

  // ---- kopiëren (vooral voor de telefoon: daar kun je de eigen QR-code niet scannen) ----
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
      var oud = 'Kopieer';
      var meld = function (t) { knop.textContent = t; setTimeout(function () { knop.textContent = oud; }, 1500); };
      if (!navigator.clipboard) { meld('Lukt niet'); return; }
      navigator.clipboard.writeText(kopieerTekst(knop.dataset.veld)).then(function () { meld('Gekopieerd'); }, function () { meld('Lukt niet'); });
    });
  });

  // ---- afbeelding opslaan en delen ----
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
  // Delen via het deelmenu van de telefoon (bijvoorbeeld naar jezelf, om op een ander apparaat te scannen).
  var kanDelen = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  $('deel').hidden = !kanDelen;
  $('deel').addEventListener('click', function () {
    if (!laatste) return;
    $('qr').toBlob(function (blob) {
      navigator.share({ files: [new File([blob], bestandsnaam(), { type: 'image/png' })] }).catch(function () {});
    });
  });

  // Bewust GEEN vooraf ingevulde links (?iban=… of #iban=…): zo'n link op dit domein zou een
  // handig phishingmiddel zijn ("betaal via betaal.terhofte.net/#iban=<oplichter>").

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
  werkBij();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then(function () {
      return navigator.serviceWorker.ready;
    }).then(function () {
      $('offline').textContent = 'Deze pagina staat nu ook offline op dit apparaat.';
    }).catch(function () {
      $('offline').textContent = 'Offline gebruik is in deze browser niet beschikbaar.';
    });
  }
})();
