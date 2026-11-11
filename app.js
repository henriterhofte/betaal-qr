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
    $('opgeslagen').value = '';
    $('verwijder').disabled = true;
    controleer();
    $('naam').focus();
  });

  // ---- stap 2: controleren ----
  function vulControle(r) {
    var v = r.velden;
    $('c-bedrag').textContent = EPC.centenNaarTekst(v.centen);
    $('c-naam').textContent = v.naam;
    $('c-iban').textContent = EPC.formatteerIban(v.iban) + (v.bic ? ' (' + v.bic + ')' : '');
    $('c-oms').textContent = v.kenmerk ? 'Kenmerk ' + v.kenmerk : (v.omschrijving || '—');
    var ul = $('waarschuwingen'); ul.textContent = '';
    ibanWijzigingen(v).forEach(function (t) { meld(t).classList.add('ernstig'); });
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
  }

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
    $('opgeslagen').value = '';
    controleer();
    naarStap(1);
  });

  // ---- stappen wisselen ----
  function naarStap(n) {
    [1, 2, 3].forEach(function (i) { $('stap' + i).hidden = i !== n; });
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
