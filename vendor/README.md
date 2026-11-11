<!-- SPDX-FileCopyrightText: 2026 Henri ter Hofte
     SPDX-License-Identifier: EUPL-1.2 -->
# vendor

`qrcode.js`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4,
Copyright (c) 2009 Kazuhiko Arase, MIT-licentie (zie de kop van het bestand).

Ongewijzigd overgenomen uit de npm-release `qrcode-generator-1.4.4.tgz` (`package/qrcode.js`).

    SHA-256  18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780
    npm integrity  sha512-HM7yY8O2ilqhmULxGMpcHSF1EhJJ9yBj8gvDEuZ6M+KGJ0YY2hKpnXvRD+hZPLrDVck3ExIGhmPtSdcjC+guuw==

Controle: `curl -sL https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-1.4.4.tgz | tar xzO package/qrcode.js | sha256sum`

`pdfjs/`: [pdf.js](https://github.com/mozilla/pdf.js) 4.10.38 (npm `pdfjs-dist`), Copyright 2024 Mozilla Foundation,
Apache-2.0 (`pdfjs/LICENSE`). Ongewijzigd: `build/pdf.min.mjs` en `build/pdf.worker.min.mjs`.

    SHA-256  27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c  pdf.min.mjs
    SHA-256  1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36  pdf.worker.min.mjs
    npm integrity  sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==

`jsqr/`: [jsQR](https://github.com/cozmo/jsQR) 1.4.0 (npm `jsqr`), Cosmo Wolfe en anderen,
Apache-2.0 (`jsqr/LICENSE`). Ongewijzigd: `dist/jsQR.js`.

    SHA-256  bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  jsQR.js
    npm integrity  sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==

`tesseract/`: [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (npm `tesseract.js`, `dist/tesseract.esm.min.js`
en `dist/worker.min.js`) en [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 5.1.1
(`tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js`), Apache-2.0, ongewijzigd. De worker bevat
kleine MIT/BSD-onderdelen (regenerator-runtime, buffer, ieee754, zlib.js). Taalmodel `lang/nld.traineddata.gz`:
tessdata_best (integer) uit npm `@tesseract.js-data/nld` 1.0.0, map `4.0.0_best_int`, Apache-2.0.

    SHA-256  2537be686335e4b2637e933cdc85a52dd80267a592689c1bd63235c8591540ae  tesseract.esm.min.js
    SHA-256  aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc  worker.min.js
    SHA-256  ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf  core/tesseract-core-simd-lstm.wasm.js
    SHA-256  8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa  core/tesseract-core-lstm.wasm.js
    SHA-256  a2d904b6ddc4feb0d31ecfcd7361a554102e7aa2e278c54f4fc029e0d0815571  lang/nld.traineddata.gz
