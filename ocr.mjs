// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// Tekstherkenning (OCR) voor foto's van facturen en gescande PDF's, lokaal met Tesseract.js.
// Alles komt van deze site (vendor/tesseract/): de module, de worker, de rekenkern (WebAssembly) en het
// Nederlandse taalmodel. Er gaat niets naar buiten: de foto blijft in de browser.
// De uitvoer heeft dezelfde vorm als die van pdflezer.mjs (pagina's met regels en tekstdelen met x-posities),
// zodat factuur.js er niets van hoeft te weten. Posities worden geschaald naar A4-punten (595 breed).
import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import './vendor/jsqr/jsQR.js';   // zet self.jsQR

const BASIS = new URL('./vendor/tesseract/', import.meta.url).href;
const A4_BREED = 595;
const MAX_ZIJDE = 3400;   // groter levert weinig op en kost veel tijd
const MIN_BREED = 1400;   // kleinere foto's eerst vergroten

let werkerBelofte = null;
let voortgangNu = null;

function werker() {
  if (!werkerBelofte) {
    werkerBelofte = Tesseract.createWorker('nld', 1, {
      workerPath: BASIS + 'worker.min.js',
      corePath: BASIS + 'core',        // kiest zelf de SIMD-versie of de gewone
      langPath: BASIS + 'lang',
      gzip: true,
      workerBlobURL: false,            // geen blob:-worker; de CSP staat alleen eigen bestanden toe
      cacheMethod: 'none',             // de service worker bewaart het model al (offline)
      logger: (m) => { if (voortgangNu) voortgangNu(m); }
    }).catch((e) => { werkerBelofte = null; throw e; });
  }
  return werkerBelofte;
}

// Foto (Blob) of PDF-pagina (Blob) naar een grijs canvas van een redelijke maat, rechtop (EXIF).
async function naarCanvas(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  let schaal = Math.min(1, MAX_ZIJDE / Math.max(bmp.width, bmp.height));
  if (bmp.width * schaal < MIN_BREED) schaal = Math.min(MIN_BREED / bmp.width, MAX_ZIJDE / Math.max(bmp.width, bmp.height));
  const b = Math.round(bmp.width * schaal), h = Math.round(bmp.height * schaal);
  const canvas = new OffscreenCanvas(b, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, b, h);
  ctx.filter = 'grayscale(1) contrast(1.15)';
  ctx.drawImage(bmp, 0, 0, b, h);
  bmp.close();
  return canvas;
}

function qrIn(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = self.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return code && code.data ? code.data : null;
}

// Tesseract-woorden naar regels met tekstdelen: woorden met een kleine tussenruimte vormen één deel,
// net als de tekststukken van pdf.js ("Totaal factuurbedrag", "€ 1.512,50").
function regelsUit(data, schaal) {
  const regels = [];
  for (const blok of data.blocks || []) {
    for (const alinea of blok.paragraphs || []) {
      for (const lijn of alinea.lines || []) {
        const woorden = (lijn.words || []).filter((w) => w.text && w.text.trim() && w.confidence > 15)
          .sort((a, b) => a.bbox.x0 - b.bbox.x0);
        if (!woorden.length) continue;
        const hoogte = Math.max(8, lijn.bbox.y1 - lijn.bbox.y0);
        const delen = [];
        let huidig = null;
        for (const w of woorden) {
          if (huidig && w.bbox.x0 - huidig.x1 <= hoogte * 0.9) {
            huidig.s += ' ' + w.text.trim();
            huidig.x1 = w.bbox.x1;
          } else {
            huidig = { x0: w.bbox.x0, x1: w.bbox.x1, s: w.text.trim() };
            delen.push(huidig);
          }
        }
        regels.push({
          y: Math.round(lijn.bbox.y0 * schaal),
          delen: delen.map((d) => ({ x: Math.round(d.x0 * schaal), w: Math.round((d.x1 - d.x0) * schaal), s: d.s }))
        });
      }
    }
  }
  // Zelfde regelvolgorde en samenvoeging als pdflezer: regels op (bijna) dezelfde hoogte horen bij elkaar.
  regels.sort((a, b) => a.y - b.y || a.delen[0].x - b.delen[0].x);
  const samen = [];
  for (const r of regels) {
    const vorige = samen[samen.length - 1];
    if (vorige && Math.abs(vorige.y - r.y) <= 4) vorige.delen.push(...r.delen);
    else samen.push({ y: r.y, delen: r.delen.slice() });
  }
  for (const r of samen) {
    r.delen.sort((a, b) => a.x - b.x);
    r.tekst = r.delen.map((d) => d.s).join(' ');
  }
  return samen;
}

// beelden: Blobs (foto's of gerenderde PDF-pagina's). voortgang({fase, deel}) met fase 'laden' of 'lezen'.
export async function leesBeelden(beelden, { voortgang } = {}) {
  voortgangNu = (m) => {
    if (!voortgang) return;
    if (m.status === 'recognizing text') voortgang({ fase: 'lezen', deel: m.progress || 0 });
    else voortgang({ fase: 'laden', deel: m.progress || 0 });
  };
  try {
    const w = await werker();
    const paginas = [], qrCodes = [];
    let zekerheid = 0;
    for (let i = 0; i < beelden.length; i++) {
      const canvas = await naarCanvas(beelden[i]);
      const qr = qrIn(canvas);
      if (qr) qrCodes.push({ pagina: i + 1, tekst: qr });
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const { data } = await w.recognize(png, {}, { blocks: true, text: false });
      const schaal = A4_BREED / canvas.width;
      paginas.push({ nr: i + 1, hoogte: Math.round(canvas.height * schaal), regels: regelsUit(data, schaal) });
      zekerheid += data.confidence || 0;
    }
    return { paginas, qrCodes, aantalPaginas: beelden.length, ocr: true, zekerheid: beelden.length ? zekerheid / beelden.length : 0 };
  } finally {
    voortgangNu = null;
  }
}
