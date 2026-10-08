/* Changing Room - lifting the print off a flat-lay product photo.
 *
 * The shop's art is a photograph of a garment, not a print file. To put it on
 * 3D geometry we have to separate the graphic from the fabric, so the fabric
 * colour can come from the colourway and the graphic can sit on top of it.
 *
 * Two measured facts from v1 that this still depends on:
 *   - garment fabric is always alpha 254-255
 *   - the baked drop shadow is BLACK at partial alpha (45-208)
 * so the shadow test is "translucent AND dark", never "greyish". That is what
 * makes heather, charcoal and black garments safe by construction rather than
 * by a lucky threshold.
 *
 * Two things that are NOT obvious and cost real debugging to find:
 *   - the print is not always darker than the fabric. The Champion chrome
 *     cross is lighter than its black tee. Distance has to be sign agnostic.
 *   - a single threshold cannot survive halftone. The Jeremiah tee's dither
 *     dots are far from the fabric, but the grey wash between them is very
 *     close. Hysteresis is mandatory, not a refinement.
 */

const WORK = 512;

/* ------------------------------------------------------------- helpers ---- */

function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/* Perceptual distance, cheap and sign agnostic. */
function redmean(r, g, b, fr, fg, fb) {
  const dr = r - fr, dg = g - fg, db = b - fb;
  const rm = (r + fr) * 0.5;
  return Math.sqrt(
    (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
  );
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------- stage 0: clean + fit ---- */

function loadToWorking(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(1, WORK / Math.max(iw, ih));
  const w = Math.max(8, Math.round(iw * s));
  const h = Math.max(8, Math.round(ih * s));
  const c = makeCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.drawImage(img, 0, 0, w, h);
  let id;
  try { id = x.getImageData(0, 0, w, h); }
  catch (e) { return null; }   /* tainted, file:// */
  return { canvas: c, ctx: x, id, w, h, srcW: iw };
}

/* Strip the baked drop shadow and harden the antialias rim. */
function stripShadow(id) {
  const d = id.data;
  let translucent = 0, opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a >= 250) { opaque++; continue; }
    if (a === 0) continue;
    const mx = Math.max(d[i], Math.max(d[i + 1], d[i + 2]));
    if (mx <= 64) { d[i + 3] = 0; }
    else { translucent++; d[i + 3] = a >= 128 ? 255 : 0; }
    if (d[i + 3] === 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
  }
  return translucent / Math.max(opaque, 1) > 0.15;   /* the clear tote */
}

/* ------------------------------------------ stage 1: silhouette landmarks -- */

function landmarks(id) {
  const { data: d, width: w, height: h } = id;
  const span = new Int32Array(h * 2).fill(-1);
  const width = new Int32Array(h);
  const runs = new Int32Array(h);

  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    let lo = -1, hi = -1, prev = false, nRuns = 0;
    for (let x = 0; x < w; x++) {
      const on = d[(y * w + x) * 4 + 3] >= 128;
      if (on) { if (lo < 0) lo = x; hi = x; if (!prev) nRuns++; }
      prev = on;
    }
    span[y * 2] = lo; span[y * 2 + 1] = hi;
    width[y] = lo < 0 ? 0 : hi - lo + 1;
    runs[y] = nRuns;
    if (lo >= 0) {
      if (lo < minX) minX = lo;
      if (hi > maxX) maxX = hi;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  let yShoulder = minY;
  for (let y = minY; y <= maxY; y++) {
    if (width[y] > 0.55 * bw) { yShoulder = y; break; }
  }

  /* the sleeve hem is where the silhouette narrows sharply below the shoulder */
  let ySleeveHem = Math.round(yShoulder + 0.30 * bh);
  for (let y = yShoulder + 3; y < maxY - 3; y++) {
    const a = width[y - 3] || 1;
    if ((a - width[y]) / a > 0.12) { ySleeveHem = y; break; }
  }

  /* median span over the body, which survives a curved hem where a min span
     would not (the jester tank dips low at centre, high at the sides) */
  const lo = [], hi = [];
  const y0 = Math.round(ySleeveHem + 0.05 * bh);
  const y1 = Math.round(maxY - 0.05 * bh);
  for (let y = y0; y <= y1; y++) {
    if (span[y * 2] >= 0) { lo.push(span[y * 2]); hi.push(span[y * 2 + 1]); }
  }
  lo.sort((a, b) => a - b); hi.sort((a, b) => a - b);
  const torsoL = lo.length ? lo[lo.length >> 1] : minX;
  const torsoR = hi.length ? hi[hi.length >> 1] : maxX;

  /* two runs on a row only happens where the neck is genuinely transparent,
     which is true of AOP cut-and-sew and false of a photographed cotton tee */
  let yNeckBottom = Math.round(yShoulder + 0.09 * bh);
  for (let y = Math.round(yShoulder + 0.12 * bh); y > yShoulder; y--) {
    if (runs[y] === 2) { yNeckBottom = y; break; }
  }

  return {
    minX, maxX, minY, maxY, bw, bh,
    yShoulder, ySleeveHem, yNeckBottom, yHem: maxY,
    torsoL, torsoR,
    torsoW: torsoR - torsoL + 1,
    bodyLenOverWidth: (maxY - yShoulder) / Math.max(1, torsoR - torsoL)
  };
}

/* --------------------------------------------------- stage 2: de-shade ---- */

/* Divide out low-frequency luminance so the photo's folds and its studio
   falloff do not fight the 3D lighting and double-shade the garment. */
function deShade(id, lm) {
  const { data: d, width: w, height: h } = id;
  const n = w * h;
  const L = new Float32Array(n);
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    L[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  /* fill outside with nearest inside so the blur does not pull in black */
  for (let pass = 0; pass < 3; pass++) {
    const cp = L.slice(), ci = inside.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (ci[i]) continue;
        let acc = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (ci[j]) { acc += cp[j]; cnt++; }
          }
        }
        if (cnt) { L[i] = acc / cnt; inside[i] = 1; }
      }
    }
  }

  const r = Math.max(2, Math.round(0.05 * lm.bw));
  const blur = boxBlur(L, w, h, r);

  const samples = [];
  for (let y = lm.ySleeveHem; y <= lm.yHem; y += 2) {
    for (let x = lm.torsoL; x <= lm.torsoR; x += 2) {
      const i = y * w + x;
      if (d[i * 4 + 3] >= 250) samples.push(L[i]);
    }
  }
  if (!samples.length) return;
  samples.sort((a, b) => a - b);
  const Lref = samples[Math.floor(samples.length * 0.60)];

  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 128) continue;
    const g = Math.min(1.40, Math.max(0.72, Lref / Math.max(blur[i], 8)));
    d[i * 4]     = Math.min(255, d[i * 4] * g);
    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * g);
    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * g);
  }
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.min(w - 1, Math.max(0, x - r))];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

/* ------------------------------------------ stage 3: fabric as a field ---- */

/* A single modal colour is right for the base swatch and wrong as a print
   reference: it cannot represent a ringer tee's contrast trim or a two-tone
   bucket hat, and on those the BODY then reads as print. A coarse grid of
   modal colours, bilinearly sampled, handles both. */
function fabricField(id, lm) {
  const { data: d, width: w } = id;
  const GX = 3, GY = 3;
  const cells = [];
  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) cells.push({ hist: new Map(), n: 0 });
  }

  const band = Math.max(3, Math.round(Math.min(lm.bw, lm.bh) * 0.045));
  const topCut = lm.minY + 0.12 * lm.bh;   /* skip neck labels */

  function push(x, y) {
    if (y < topCut) return;
    const i = (y * w + x) * 4;
    if (d[i + 3] < 250) return;
    const gx = Math.min(GX - 1, Math.floor(((x - lm.minX) / lm.bw) * GX));
    const gy = Math.min(GY - 1, Math.floor(((y - lm.minY) / lm.bh) * GY));
    const c = cells[gy * GX + gx];
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    let e = c.hist.get(k);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; c.hist.set(k, e); }
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    c.n++;
  }

  /* the edge ring is always cloth: prints never reach within a few percent
     of the silhouette */
  for (let y = lm.minY; y <= lm.maxY; y++) {
    const lo = -1;
    for (let k = 0; k < band; k += 2) {
      push(Math.min(lm.maxX, lm.minX + k), y);
      push(Math.max(lm.minX, lm.maxX - k), y);
    }
  }
  for (let x = lm.minX; x <= lm.maxX; x += 2) {
    for (let k = 0; k < band; k += 2) {
      push(x, Math.min(lm.maxY, lm.minY + k));
      push(x, Math.max(lm.minY, lm.maxY - k));
    }
  }

  const grid = [];
  let globalBest = null;
  for (let c = 0; c < cells.length; c++) {
    let best = null;
    for (const e of cells[c].hist.values()) if (!best || e.n > best.n) best = e;
    grid[c] = best ? [best.r / best.n, best.g / best.n, best.b / best.n, best.n / cells[c].n] : null;
    if (best && (!globalBest || best.n > globalBest.n)) globalBest = best;
  }
  const fallback = globalBest
    ? [globalBest.r / globalBest.n, globalBest.g / globalBest.n, globalBest.b / globalBest.n, 1]
    : [128, 128, 128, 0];
  for (let c = 0; c < grid.length; c++) if (!grid[c]) grid[c] = fallback;

  /* per-channel sigma about the field, the number the thresholds key off */
  let sum = 0, cnt = 0;
  for (let y = lm.minY; y <= lm.maxY; y += 3) {
    for (let k = 0; k < band; k += 3) {
      const x = Math.min(lm.maxX, lm.minX + k);
      const i = (y * w + x) * 4;
      if (d[i + 3] < 250) continue;
      const f = sampleField(grid, GX, GY, lm, x, y);
      sum += Math.abs(luma(d[i], d[i + 1], d[i + 2]) - luma(f[0], f[1], f[2]));
      cnt++;
    }
  }
  const sigma = cnt ? sum / cnt : 6;

  return { grid, GX, GY, sigma, dominant: fallback };
}

function sampleField(grid, GX, GY, lm, x, y) {
  const fx = Math.min(GX - 1e-3, Math.max(0, ((x - lm.minX) / lm.bw) * GX - 0.5));
  const fy = Math.min(GY - 1e-3, Math.max(0, ((y - lm.minY) / lm.bh) * GY - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(GX - 1, x0 + 1), y1 = Math.min(GY - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = grid[y0 * GX + x0], b = grid[y0 * GX + x1];
  const c = grid[y1 * GX + x0], e = grid[y1 * GX + x1];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = (a[i] * (1 - tx) + b[i] * tx) * (1 - ty) + (c[i] * (1 - tx) + e[i] * tx) * ty;
  }
  return out;
}

/* --------------------------------------------- stage 4: the print mask ---- */

function printMask(id, lm, field) {
  const { data: d, width: w, height: h } = id;
  const n = w * h;
  const delta = new Float32Array(n);
  const alpha = new Uint8Array(n);

  /* Threshold scale, which is easy to get wrong: redmean is NOT normalised.
     Black to white is 765, and a mere 25-level grey shift already returns 75 -
     roughly 3x a Euclidean distance. Sigma is measured in luma, so it has to
     be scaled into the same units before it can be compared.
     Reference points on this catalog: fabric shading after de-shade sits near
     25, a halftone's grey wash near 225, and its dots near 700. */
  const sigR = Math.max(3, field.sigma) * 3;
  const T_hi = Math.max(190, 3.2 * sigR);
  /* Left at 85/1.7 deliberately. Dropping it to 55/1.4 does fill the tees in a
     little further (floral-crest 0.076 -> 0.082) but costs far more than it
     buys on dark blanks, where fabric variance is high: the vintage cap went
     0.216 -> 0.321 by swallowing its own brim and crown shading. The shredding
     was structural, not a threshold, and the fix above already addressed it. */
  const T_lo = Math.max(85, 1.7 * sigR);

  for (let y = lm.minY; y <= lm.maxY; y++) {
    for (let x = lm.minX; x <= lm.maxX; x++) {
      const i = y * w + x;
      if (d[i * 4 + 3] < 250) continue;
      const f = sampleField(field.grid, field.GX, field.GY, lm, x, y);
      delta[i] = redmean(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], f[0], f[1], f[2]);
    }
  }

  /* hysteresis: seed on the strong dots, flood into the weak wash between */
  const stack = [];
  for (let i = 0; i < n; i++) if (delta[i] > T_hi) { alpha[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!alpha[j] && delta[j] > T_lo) { alpha[j] = 1; stack.push(j); }
    }
  }

  morph(alpha, w, h, 1, 1);   /* close: joins the dots of a halftone */

  /* NO opening pass here. An open is erode-then-dilate, and a radius-1 erode
     deletes every pixel that has an unset neighbour - which means every stroke
     under 3px wide disappears outright. This catalog is largely fine-line
     illustration: with the open in place, `floral-crest` and `love-lines` came
     back as a few disconnected blobs and measured 3-5% coverage. Speckle is
     handled below instead, where it can be done without eating the artwork. */

  /* restrict to the torso panel: this is what removes the Champion neck tag,
     the sleeve logos, and most surviving self-shadow */
  const cx = (lm.torsoL + lm.torsoR) / 2;
  const yTop = lm.yShoulder + 0.05 * lm.bh;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < lm.torsoL || x > lm.torsoR || y < yTop || y > lm.yHem) alpha[y * w + x] = 0;
    }
  }

  /* Drop speckle by looking at components of a DILATED copy, not of the mask
     itself. Fine linework is not one solid region - it is thousands of thin
     strokes - so componentising the raw mask rates each stroke separately,
     drops most of them for being small, and drops the outlying ones again for
     sitting too far off centre. Dilating first merges a design's strokes into a
     single large, centred component that comfortably passes both tests, while
     isolated fabric speckle stays small and still fails. Survivors are then
     intersected back with the original mask, so the artwork keeps its true
     edges rather than the fattened ones. */
  const grouped = alpha.slice();
  dilate(grouped, w, h, 3);
  const minArea = 0.0006 * lm.bw * lm.bh;
  dropComponents(grouped, w, h, minArea, cx, lm.torsoW * 0.44);
  for (let i = 0; i < n; i++) if (!grouped[i]) alpha[i] = 0;

  let count = 0;
  for (let i = 0; i < n; i++) if (alpha[i]) count++;

  return { alpha, delta, T_hi, T_lo, coverage: count / Math.max(1, lm.torsoW * (lm.yHem - lm.yShoulder)) };
}

/* Square dilation by `r`, separable so the radius is cheap. Used to group a
   design's strokes before componentising, never on the mask that is output. */
function dilate(a, w, h, r) {
  for (const horiz of [true, false]) {
    const cp = a.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a[y * w + x]) continue;
        for (let k = -r; k <= r; k++) {
          const nx = horiz ? x + k : x;
          const ny = horiz ? y : y + k;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (cp[ny * w + nx]) { a[y * w + x] = 1; break; }
        }
      }
    }
  }
}

function morph(a, w, h, dilateFirst, r) {
  const ops = dilateFirst ? [1, 0] : [0, 1];
  for (const op of ops) {
    const cp = a.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = op ? 0 : 1;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const s = cp[ny * w + nx];
            if (op) { if (s) { v = 1; dy = r; break; } }
            else if (!s) { v = 0; dy = r; break; }
          }
        }
        a[y * w + x] = v;
      }
    }
  }
}

function dropComponents(a, w, h, minArea, cx, maxOff) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!a[s] || seen[s]) continue;
    stack.length = 0; stack.push(s); seen[s] = 1;
    const cell = [];
    let sx = 0;
    while (stack.length) {
      const i = stack.pop();
      cell.push(i);
      sx += i % w;
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (a[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const off = Math.abs(sx / cell.length - cx);
    if (cell.length < minArea || off > maxOff) {
      for (const i of cell) a[i] = 0;
    }
  }
}

/* ----------------------------------------------- stage 5: un-mix + out ---- */

/**
 * @returns {null | {
 *   print: HTMLCanvasElement, printBox: {x,y,w,h},
 *   lm: object, fabric: number, sigma: number,
 *   coverage: number, mode: 'ok'|'tonal-fallback'|'aop',
 *   bodyLenOverWidth: number, source: HTMLCanvasElement
 * }}
 */
export function preparePrintAsset(img, opts) {
  opts = opts || {};
  const W = loadToWorking(img);
  if (!W) return null;

  const translucent = stripShadow(W.id);
  const lm = landmarks(W.id);
  if (!lm) return null;

  deShade(W.id, lm);
  W.ctx.putImageData(W.id, 0, 0);

  const field = fabricField(W.id, lm);
  const fabric = (Math.round(field.dominant[0]) << 16) |
                 (Math.round(field.dominant[1]) << 8) |
                  Math.round(field.dominant[2]);

  const source = makeCanvas(W.w, W.h);
  source.getContext('2d').drawImage(W.canvas, 0, 0);

  if (opts.mode === 'aop') {
    return {
      print: null, printBox: null, lm, fabric, sigma: field.sigma,
      coverage: 1, mode: 'aop', translucent,
      bodyLenOverWidth: lm.bodyLenOverWidth, source
    };
  }

  const mask = printMask(W.id, lm, field);

  /* nothing found: a tonal print (white on white). Keep the garment looking
     right by falling back to using the torso crop directly. */
  if (mask.coverage < 0.02) {
    return {
      print: null, printBox: null, lm, fabric, sigma: field.sigma,
      coverage: mask.coverage, mode: 'tonal-fallback', translucent,
      bodyLenOverWidth: lm.bodyLenOverWidth, source
    };
  }

  /* bounding box of what survived */
  let x0 = W.w, x1 = -1, y0 = W.h, y1 = -1;
  for (let y = 0; y < W.h; y++) {
    for (let x = 0; x < W.w; x++) {
      if (mask.alpha[y * W.w + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    return {
      print: null, printBox: null, lm, fabric, sigma: field.sigma,
      coverage: 0, mode: 'tonal-fallback', translucent,
      bodyLenOverWidth: lm.bodyLenOverWidth, source
    };
  }

  const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
  const out = makeCanvas(pw, ph);
  const ox = out.getContext('2d');
  const oid = ox.createImageData(pw, ph);
  const src = W.id.data;

  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const si = ((y + y0) * W.w + (x + x0));
      const di = (y * pw + x) * 4;
      if (!mask.alpha[si]) { oid.data[di + 3] = 0; continue; }

      /* soft alpha from the distance ramp, so halftone edges stay soft */
      const t = Math.min(1, Math.max(0,
        (mask.delta[si] - 0.6 * mask.T_lo) / Math.max(1, mask.T_hi - 0.6 * mask.T_lo)));
      const a = t * t * (3 - 2 * t);

      const f = sampleField(field.grid, field.GX, field.GY, lm, x + x0, y + y0);

      /* Un-mix. The photographed pixel is the print composited over THIS
         colourway's fabric, so solve for the print. Without this a black print
         lifted off a white tee carries white haze onto a navy colourway. */
      const aa = Math.max(0.15, a);
      for (let c = 0; c < 3; c++) {
        const obs = src[si * 4 + c];
        oid.data[di + c] = Math.min(255, Math.max(0, (obs - f[c] * (1 - aa)) / aa));
      }
      oid.data[di + 3] = Math.round(a * 255);
    }
  }
  ox.putImageData(oid, 0, 0);

  return {
    print: out,
    printBox: { x: x0, y: y0, w: pw, h: ph },
    lm, fabric, sigma: field.sigma,
    coverage: mask.coverage, mode: 'ok', translucent,
    bodyLenOverWidth: lm.bodyLenOverWidth, source
  };
}

/**
 * A chest-sized patch of the garment itself, for the cases where there is no
 * separated print to project.
 *
 * `preparePrintAsset` returns `print: null` in two situations, and BOTH of them
 * were reaching the renderer as a blank garment, because main.js only projected
 * a decal when `print` was non-null:
 *
 *   mode 'aop'             - an all-over print has no separable motif, the
 *                            pattern IS the fabric. Every AOP tee and the wide
 *                            leg pants went through here, which is why they
 *                            came out plain white while the AOP bodycons - the
 *                            only two garments on the procedural atlas path,
 *                            which reads `source` instead - looked right.
 *   mode 'tonal-fallback'  - the separator found under 2% coverage, i.e. a
 *                            white-on-white or tonal design it cannot cut out.
 *
 * In both cases the artwork is still sitting in `source`, the de-shaded product
 * photo. Cropping the torso out of it gives something honest to project: for an
 * AOP that is the actual repeating pattern, and for a tonal print it is the
 * design at the contrast it really has. Cropping matters - projecting `source`
 * whole would stamp a picture of a shirt, sleeves and background included, onto
 * the shirt.
 */
export function torsoPatch(asset) {
  if (!asset || !asset.source || !asset.lm) return null;
  const lm = asset.lm;

  /* Inset off the silhouette edges. The torso span includes the side seams, and
     a seam carries the shadow gradient the separator was built to avoid. */
  const w = lm.torsoR - lm.torsoL + 1;
  const x0 = Math.round(lm.torsoL + w * 0.10);
  const x1 = Math.round(lm.torsoR - w * 0.10);

  /* CHEST-SHAPED, not the whole torso. Height is taken from the width, not from
     the hem, because the decal box has a fixed aspect budget: a full-torso crop
     comes out around 1:2, and fitting that into the chest box shrinks it to a
     narrow strip down the middle of the shirt. Roughly 1:1.15 fills the box. */
  const top = lm.yNeckBottom != null ? lm.yNeckBottom : lm.yShoulder;
  const avail = lm.yHem - top;
  const y0 = Math.round(top + avail * 0.06);
  const y1 = Math.round(Math.min(lm.yHem - avail * 0.06, y0 + (x1 - x0) * 1.15));

  const pw = x1 - x0, ph = y1 - y0;
  if (pw < 8 || ph < 8) return null;

  const out = makeCanvas(pw, ph);
  out.getContext('2d').drawImage(asset.source, x0, y0, pw, ph, 0, 0, pw, ph);
  return out;
}

/**
 * The whole subject, cut out of its studio background.
 *
 * `torsoPatch` crops to the garment's chest, which is meaningless for a shoe.
 * This crops to the silhouette the landmark pass already found, so what comes
 * back is the product on transparency - the background is dropped by
 * `stripShadow` during preparation, so projecting this stamps the shoe and not
 * a white tile with a shoe in the middle of it.
 */
export function silhouettePatch(asset) {
  if (!asset || !asset.source || !asset.lm) return null;
  const lm = asset.lm;
  const pw = lm.maxX - lm.minX + 1;
  const ph = lm.maxY - lm.minY + 1;
  if (pw < 8 || ph < 8) return null;

  const out = makeCanvas(pw, ph);
  out.getContext('2d').drawImage(asset.source, lm.minX, lm.minY, pw, ph, 0, 0, pw, ph);
  return out;
}
