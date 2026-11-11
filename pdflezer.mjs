// SPDX-FileCopyrightText: 2026 Henri ter Hofte
// SPDX-License-Identifier: EUPL-1.2
// Een PDF lokaal lezen met pdf.js: de tekst per regel (met posities), en een eventuele EPC-QR-code
// op de pagina's (gerenderd naar een canvas, gelezen met jsQR). Er gaat niets over het netwerk:
// het bestand komt als ArrayBuffer binnen en de CSP verbiedt verbindingen.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import './vendor/jsqr/jsQR.js';   // zet self.jsQR

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const MAX_PAGINAS_TEKST = 10;
const MAX_PAGINAS_QR = 3;
const REGEL_TOLERANTIE = 3;   // punten: delen met (bijna) dezelfde y horen bij één regel

// Opties die pdf.js binnen de CSP houden: geen eval, geen webfonts (blob:), geen ophalen van fonts of cmaps.
const OPTIES = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false };

export async function leesPdf(buffer, { qr = true } = {}) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), ...OPTIES }).promise;
  try {
    const paginas = [];
    const qrCodes = [];
    for (let nr = 1; nr <= Math.min(doc.numPages, MAX_PAGINAS_TEKST); nr++) {
      const page = await doc.getPage(nr);
      paginas.push(await tekstVan(page, nr));
      if (qr && nr <= MAX_PAGINAS_QR) {
        const gevonden = await qrVan(page).catch(() => null);
        if (gevonden) qrCodes.push({ pagina: nr, tekst: gevonden });
      }
    }
    return { paginas, qrCodes, aantalPaginas: doc.numPages };
  } finally {
    doc.destroy();
  }
}

// Een gescande PDF (zonder tekst) als plaatjes, voor de tekstherkenning (ocr.mjs). Schaal 3 is ongeveer 216 dpi.
export async function paginasAlsBeeld(buffer, max = 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), ...OPTIES }).promise;
  try {
    const beelden = [];
    for (let nr = 1; nr <= Math.min(doc.numPages, max); nr++) {
      const page = await doc.getPage(nr);
      const vp = page.getViewport({ scale: 3 });
      const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      beelden.push(await canvas.convertToBlob({ type: 'image/png' }));
    }
    return beelden;
  } finally {
    doc.destroy();
  }
}

async function tekstVan(page, nr) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const delen = [];
  for (const item of tc.items) {
    const s = (item.str || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    // Naar schermcoördinaten (y van boven naar beneden), ook bij gedraaide pagina's.
    const t = pdfjs.Util.transform(vp.transform, item.transform);
    delen.push({ x: Math.round(t[4]), y: Math.round(t[5]), w: Math.round(item.width), s });
  }
  delen.sort((a, b) => a.y - b.y || a.x - b.x);
  const regels = [];
  for (const d of delen) {
    const r = regels[regels.length - 1];
    if (r && Math.abs(r.y - d.y) <= REGEL_TOLERANTIE) r.delen.push(d);
    else regels.push({ y: d.y, delen: [d] });
  }
  for (const r of regels) {
    r.delen.sort((a, b) => a.x - b.x);
    r.tekst = r.delen.map((d) => d.s).join(' ');
  }
  return { nr, hoogte: Math.round(vp.height), regels };
}

async function qrVan(page) {
  // Schaal 2,5: een QR-code van 2,5 cm op A4 wordt dan ruim 170 pixels.
  const vp = page.getViewport({ scale: 2.5 });
  const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = self.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return code && code.data ? code.data : null;
}
