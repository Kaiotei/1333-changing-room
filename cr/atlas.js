/* Changing Room - painting one garment texture atlas.
 *
 * The colourway is BAKED into this canvas rather than applied as
 * material.color. three.js computes diffuse = map * color, so tinting a white
 * atlas blue would tint the print blue too. Baking is the only way to get
 * "the print sits on the fabric, and its transparency shows the fabric
 * through". Cost is one repaint per colourway click, a few milliseconds.
 */

import * as THREE from 'three';
import { ISLANDS } from './garment.js?v=30';
import { INCH } from './body.js?v=30';

const ATLAS = 1024;

function hexStr(h) {
  return '#' + ('000000' + (h >>> 0).toString(16)).slice(-6);
}

/* v = 0 is the bottom of the texture but the top of a canvas, so every island
   rect has to be flipped on the way in. */
function rectPx(isl) {
  return {
    x: isl.u0 * ATLAS,
    y: (1 - isl.v1) * ATLAS,
    w: (isl.u1 - isl.u0) * ATLAS,
    h: (isl.v1 - isl.v0) * ATLAS
  };
}

let heatherTile = null;
function getHeatherTile() {
  if (heatherTile) return heatherTile;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const id = x.createImageData(64, 64);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 118 + ((Math.random() * 74) | 0);
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  heatherTile = c;
  return c;
}

/**
 * @param {object} islands from buildGarment
 * @param {object} asset from preparePrintAsset (may be null)
 * @param {number} colour 0xRRGGBB fabric colour
 * @param {object} spec
 * @param {string} colourName
 * @returns {HTMLCanvasElement}
 */
export function buildGarmentAtlas(islands, asset, colour, spec, colourName) {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const x = c.getContext('2d');

  x.fillStyle = hexStr(colour);
  x.fillRect(0, 0, ATLAS, ATLAS);

  if (colourName && /heather|grey|gray|ash|granite|marl/i.test(colourName)) {
    x.save();
    x.globalCompositeOperation = 'overlay';
    x.globalAlpha = 0.22;
    const p = x.createPattern(getHeatherTile(), 'repeat');
    x.fillStyle = p;
    x.fillRect(0, 0, ATLAS, ATLAS);
    x.restore();
  }

  const aop = spec.printMode === 'aop' || (asset && asset.mode === 'aop');

  if (asset && aop && asset.source) {
    paintAOP(x, islands, asset);
  } else if (asset && asset.mode === 'tonal-fallback' && asset.source) {
    paintTonalFallback(x, islands, asset);
  } else if (asset && asset.print) {
    paintChestPrint(x, islands, asset, spec);
  }

  /* a hairline darker line just inside each island edge reads as stitching */
  x.strokeStyle = 'rgba(0,0,0,0.22)';
  x.lineWidth = 2;
  for (const key of ['FRONT', 'BACK', 'SLEEVE_L', 'SLEEVE_R']) {
    const r = rectPx(islands[key] || ISLANDS[key]);
    x.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }

  return c;
}

/* Standard chest print. Placement follows the flat lay rather than a fixed
   "2.75in below the neckline", because a tank's full-front print would
   otherwise float halfway up the garment. */
function paintChestPrint(x, islands, asset, spec) {
  const isl = islands.FRONT;
  const r = rectPx(isl);
  const lm = asset.lm, box = asset.printBox;

  const shoulderToHem = Math.max(1, lm.yHem - lm.yShoulder);
  const printBottomFrac = (box.y + box.h - lm.yShoulder) / shoulderToHem;

  /* print width in world units, from its share of the torso width */
  const chestW = isl.chestW || isl.panelW;
  let pw = (box.w / Math.max(1, lm.torsoW)) * chestW;
  const maxW = Math.min(12 * INCH, 0.80 * chestW);
  let scale = 1;
  if (pw > maxW) { scale = maxW / pw; pw = maxW; }
  const ph = pw * (box.h / box.w);

  let topY;
  if (printBottomFrac > 0.62) {
    /* full-front print: follow the photo, minus the flat lay's shoulder bias.
       +0.060, was -0.030: measured against the jester girl tank
       (tools/tankcheck.html), a design that runs most of the torso's height
       sat with its top only 0.16 below the neckline on its own, well clear of
       the collar - and still lost its top edge, because the ceiling below
       clamped it down before it ever got there. */
    const f = (box.y - lm.yShoulder) / shoulderToHem;
    topY = 0.95 - f * (0.95 - islands.hemY) + 0.060;
  } else {
    topY = (islands.neckY - islands.scoopF) - 2.75 * INCH;
  }
  /* 0.020, was 0.060: the tighter margin was the actual bug, not the formula
     above it - it clamped the jester girl tank's natural placement (0.86) down
     to 0.81, which is what read as the top of the design missing. 0.020 still
     guarantees real clearance from the collar, just not four times as much as
     needed. */
  topY = Math.min(topY, islands.neckY - islands.scoopF - 0.020);

  /* world -> island. v runs bottom-up over panelH from the hem. */
  const panelH = isl.panelH, panelW = isl.panelW;
  const vTop = (topY - islands.hemY) / panelH;
  const uMid = 0.5;

  const dw = (pw / panelW) * r.w;
  const dh = (ph / panelH) * r.h;
  const dx = r.x + uMid * r.w - dw / 2;
  const dy = r.y + (1 - vTop) * r.h;

  x.drawImage(asset.print, dx, dy, dw, dh);
}

/* No print could be separated (white on white). Use the de-shaded torso crop
   directly so the garment still looks right; per-colourway recolouring is lost
   for this one product, which is the right trade. */
function paintTonalFallback(x, islands, asset) {
  const lm = asset.lm;
  const r = rectPx(islands.FRONT);
  x.drawImage(
    asset.source,
    lm.torsoL, lm.yShoulder, lm.torsoW, lm.yHem - lm.yShoulder,
    r.x, r.y, r.w, r.h
  );
}

/* An AOP flat lay is an orthographic front view of the flattened garment, so
   the right move is not a different unwrap - it is blitting the photo's own
   silhouette regions into the matching islands. */
function paintAOP(x, islands, asset) {
  const lm = asset.lm;
  const src = asset.source;

  const f = rectPx(islands.FRONT);
  x.drawImage(src,
    lm.torsoL, lm.yNeckBottom, lm.torsoW, lm.yHem - lm.yNeckBottom,
    f.x, f.y, f.w, f.h);

  /* no back photo: mirror the front. On an all-over pattern this is invisible. */
  const b = rectPx(islands.BACK);
  x.save();
  x.translate(b.x + b.w, b.y);
  x.scale(-1, 1);
  x.drawImage(src,
    lm.torsoL, lm.yNeckBottom, lm.torsoW, lm.yHem - lm.yNeckBottom,
    0, 0, b.w, b.h);
  x.restore();

  /* sleeve wedges, rotated so their length runs along v */
  const sleeveTop = lm.yShoulder;
  const sleeveBot = lm.ySleeveHem;
  const sh = Math.max(4, sleeveBot - sleeveTop);
  [['SLEEVE_L', lm.minX, lm.torsoL], ['SLEEVE_R', lm.torsoR, lm.maxX]].forEach(([key, x0, x1]) => {
    const w = Math.max(4, x1 - x0);
    const rr = rectPx(ISLANDS[key]);
    x.save();
    x.translate(rr.x + rr.w / 2, rr.y + rr.h / 2);
    x.rotate(Math.PI / 2);
    x.drawImage(src, x0, sleeveTop, w, sh, -rr.h / 2, -rr.w / 2, rr.h, rr.w);
    x.restore();
  });
}

/** Wraps a painted atlas canvas as a texture with sane modern settings. */
export function atlasTexture(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  if (renderer) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
