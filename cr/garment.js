/* Changing Room - procedural garment geometry.
 *
 * Real garment shells: an actual neck opening, actual armholes, an open hem,
 * and tapered sleeve tubes. Not photographs bent onto a cylinder.
 *
 * The central trick is that we never cut a hole. Deleting quads out of a grid
 * gives a staircase armhole and a staircase neckline. Instead the torso is
 * exactly two quad patches - front and back - whose angular range is remapped
 * through an armhole window phi(y). Below the armpit phi is 0 and the two arcs
 * meet at the side seam; through the armhole zone phi grows smoothly, so the
 * armhole boundary IS a grid line and is smooth by construction. The neck hole
 * falls out of the yoke's top edge the same way.
 */

import * as THREE from 'three';
import { Y, ARM, ringPoint, bodyRingAt, bodyRingForGarment } from './body.js?v=30';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/* -------------------------------------------------------------- profile ---- */

/* How far the armhole has eaten into the side, in radians, at height fraction
   t through the armhole zone. The second term (phiTop) is what puts the sleeve
   seam on the deltoid instead of near the neck. */
function armholePhi(t, spec) {
  if (t <= 0) return 0;
  const tPeak = spec.tPeak;
  const skew = Math.pow(t, Math.log(0.5) / Math.log(tPeak));
  const bulge = spec.phiMax * Math.pow(Math.sin(Math.PI * skew), 0.75);
  return bulge + spec.phiTop * Math.pow(t, 1.5);
}

/* The garment's cross-section at height y: the body ring, eased and padded,
   blended toward a straight column by `straightness`, then flared toward the
   hem, then clamped so it can never intersect the body. */
function garmentRing(y, spec) {
  const b = bodyRingForGarment(y);
  const bust = bodyRingForGarment(Y.bust);

  let flare = 1;
  if (spec.flareAmt && y < spec.waistY) {
    let f = Math.min(1, Math.max(0, (spec.waistY - y) / (spec.waistY - spec.hemY)));
    /* `flareFrom` holds the garment flat against the body for the top part of
       the waist-to-hem run and starts the flare only below it. A power curve
       alone cannot do this - it eases the flare in, but it still begins at the
       waist, so a dress meant to swing out only around the knees reads as an
       A-line from the hip down. 0 means flare the whole way, as before. */
    const from = spec.flareFrom || 0;
    if (from > 0) f = f <= from ? 0 : (f - from) / (1 - from);
    flare = 1 + spec.flareAmt * Math.pow(f, spec.flarePow);
  }

  const shapedX = b.aX * spec.easeX + spec.padX;
  const shapedZ = b.aZ * spec.easeZ + spec.padZ;
  const straightX = (bust.aX * spec.easeX + spec.padX) * flare;
  const straightZ = (bust.aZ * spec.easeZ + spec.padZ) * flare;

  let aX = shapedX + (straightX - shapedX) * spec.straight;
  let aZ = shapedZ + (straightZ - shapedZ) * spec.straight;
  if (spec.flareAmt && y < spec.waistY) { aX *= flare; aZ *= flare; }

  /* clearance: layer 0 bottoms, 1 tops and dresses, 2 outerwear */
  const clear = 0.008 + (spec.layer || 0) * 0.012;
  aX = Math.max(aX, b.aX + clear);
  aZ = Math.max(aZ, b.aZ + clear);

  return { y, aX, aZ, e: b.e };
}

/* The garment's top edge for column parameter m (0 at centre front, 1 at the
   shoulder point). Below mN it traces the neckline; above it, the shoulder
   seam. Front and back produce the same point at m = mN, so the neck hole
   closes for free. mN alone is what turns a crew neck into a tank. */
function topEdgePoint(m, spec, back, out) {
  out = out || new THREE.Vector3();
  const scoop = back ? spec.scoopB : spec.scoopF;
  const sign = back ? -1 : 1;

  if (m < spec.mN) {
    const psi = (m / spec.mN) * HALF_PI;
    out.x = spec.neckRX * Math.sin(psi);
    out.y = spec.neckY - scoop * Math.pow(Math.cos(psi), 1.3);
    out.z = sign * spec.neckRZ * Math.cos(psi);
  } else {
    const s = (m - spec.mN) / (1 - spec.mN);
    const shRing = garmentRing(Y.shoulder, spec);
    const nx = spec.neckRX, ny = spec.neckY - scoop * 0, nz = 0;
    const sx = shRing.aX * Math.cos(spec.phiTop);
    const sy = Y.shoulder + spec.shExt;
    const sz = sign * shRing.aZ * Math.sin(spec.phiTop) * 0.35;
    out.x = nx + (sx - nx) * s;
    out.y = ny + (sy - ny) * s - 0.012 * s * (1 - s) * 4;
    out.z = nz + (sz - nz) * s;
  }
  return out;
}

/* -------------------------------------------------------------- levels ---- */

function levelHeights(spec) {
  const hemY = spec.hemY, armBotY = spec.armBotY, shY = Y.shoulder;
  const nBody = Math.min(26, Math.max(6, Math.round((armBotY - hemY) / 0.055)));
  const nArm  = Math.min(14, Math.max(6, Math.round((shY - armBotY) / 0.032)));
  const nYoke = 7;

  const ys = [];
  for (let i = 0; i < nBody; i++) ys.push(hemY + (armBotY - hemY) * (i / nBody));
  /* cosine clustering through the armhole zone, so boundary vertices do not
     bunch up where phi changes fastest */
  for (let a = 0; a <= nArm; a++) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * a) / nArm);
    ys.push(armBotY + (shY - armBotY) * t);
  }
  return { ys, iArmBot: nBody - 1, iSh: ys.length - 1, nYoke };
}

/* --------------------------------------------------------------- build ---- */

/**
 * Builds one garment torso plus its sleeves.
 * @param {object} spec see specs.js
 * @returns {{ torso: THREE.BufferGeometry, sleeves: THREE.BufferGeometry[],
 *             rims: THREE.BufferGeometry[], islands: object }}
 */
export function buildGarment(spec) {
  const S = spec.S || 16;
  const { ys, iArmBot, iSh, nYoke } = levelHeights(spec);
  const NL = ys.length + nYoke;
  const stride = 2 * (S + 1);

  const pos = new Float32Array(NL * stride * 3);
  const P = new THREE.Vector3(), T = new THREE.Vector3();

  const idxOf = (i, p, j) => i * stride + p * (S + 1) + j;

  /* rows up to and including the shoulder ring */
  for (let i = 0; i <= iSh; i++) {
    const y = ys[i];
    const ring = garmentRing(y, spec);
    let phi = 0;
    if (y > spec.armBotY) {
      phi = armholePhi((y - spec.armBotY) / (Y.shoulder - spec.armBotY), spec);
    }
    const half = HALF_PI - phi;
    for (let p = 0; p < 2; p++) {
      for (let j = 0; j <= S; j++) {
        const f = j / S;
        const th = p === 0
          ? -half + 2 * half * f
          : (HALF_PI + phi) + 2 * half * f;
        ringPoint(ring, th, P);
        const o = idxOf(i, p, j) * 3;
        pos[o] = P.x; pos[o + 1] = y; pos[o + 2] = P.z;
      }
    }
  }

  /* yoke: blend each column from the shoulder ring out to its top-edge point */
  for (let k = 1; k <= nYoke; k++) {
    const i = iSh + k;
    const s = k / nYoke;
    const sm = s * s * (3 - 2 * s);
    for (let p = 0; p < 2; p++) {
      for (let j = 0; j <= S; j++) {
        const m = Math.abs((2 * j) / S - 1);
        topEdgePoint(m, spec, p === 1, T);
        const src = idxOf(iSh, p, j) * 3;
        const o = idxOf(i, p, j) * 3;
        const sx = pos[src], sy = pos[src + 1], sz = pos[src + 2];
        /* Mirror the top edge onto whichever side this column is actually on.
           Take the side from the shoulder ring's own x, NOT from the column
           index: the back patch runs the opposite way around, so j < S/2 is
           +x on the back and -x on the front. Deriving it from j put half of
           each armhole loop on the wrong side and made the sleeves span the
           whole body. */
        const tx = (sx < 0 ? -1 : 1) * Math.abs(T.x);
        pos[o]     = sx + (tx - sx) * sm;
        pos[o + 1] = sy + (T.y - sy) * sm;
        pos[o + 2] = sz + (T.z - sz) * sm;
      }
    }
  }

  /* indices: front winds CCW outward (+Z), back likewise (-Z) */
  const idx = [];
  for (let i = 0; i < NL - 1; i++) {
    for (let p = 0; p < 2; p++) {
      for (let j = 0; j < S; j++) {
        const a = idxOf(i, p, j), b = idxOf(i, p, j + 1);
        const c = idxOf(i + 1, p, j + 1), d = idxOf(i + 1, p, j);
        idx.push(a, b, c, a, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);

  const islands = computePanelUVs(geo, pos, NL, S, stride, idxOf, spec);
  geo.computeVertexNormals();
  smoothYoke(geo, pos, NL, S, iSh, nYoke, idxOf);
  bakeAO(geo, pos, spec);

  /* armhole loops, in the order the sleeve builder wants */
  const loops = { L: [], R: [] };
  for (let i = iArmBot; i < NL; i++) loops.R.push(vec(pos, idxOf(i, 0, S)));
  for (let i = NL - 1; i >= iArmBot; i--) loops.R.push(vec(pos, idxOf(i, 1, 0)));
  for (let i = iArmBot; i < NL; i++) loops.L.push(vec(pos, idxOf(i, 1, S)));
  for (let i = NL - 1; i >= iArmBot; i--) loops.L.push(vec(pos, idxOf(i, 0, 0)));

  const sleeves = [];
  if (spec.sleeveLen > 0) {
    sleeves.push(buildSleeve(spec, dedupeLoop(loops.R), 1, islands));
    sleeves.push(buildSleeve(spec, dedupeLoop(loops.L), -1, islands));
  }

  /* rim bands, so the openings read as finished edges rather than raw holes.
     Also what covers the hollow cut left by the leg clipping plane. */
  const rims = [];
  const hemLoop = [];
  for (let j = 0; j <= S; j++) hemLoop.push(vec(pos, idxOf(0, 0, j)));
  for (let j = 1; j <= S; j++) hemLoop.push(vec(pos, idxOf(0, 1, j)));
  rims.push(buildRim(hemLoop, 0.030, 1, spec.ribbed, islands, 'TRIM_HEM'));

  const neckLoop = [];
  for (let j = 0; j <= S; j++) neckLoop.push(vec(pos, idxOf(NL - 1, 0, j)));
  for (let j = S - 1; j >= 0; j--) neckLoop.push(vec(pos, idxOf(NL - 1, 1, j)));
  rims.push(buildRim(neckLoop, spec.neckBand || 0.020, -1, false, islands, 'TRIM_NECK'));

  return { torso: geo, sleeves, rims, islands };
}

function vec(pos, i) {
  return new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
}

/* Front and back patches meet at the side seam with coincident duplicate
   vertices - intentional, because the UV island must break there. But the
   duplicates give a hard shading crease, so average their normals. */
function dedupeLoop(loop) {
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    if (i > 0 && loop[i].distanceTo(loop[i - 1]) < 1e-5) continue;
    out.push(loop[i]);
  }
  if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < 1e-5) out.pop();
  return out;
}

/* ----------------------------------------------------------------- UVs ---- */

/* u is arc length normalised by ONE global reference width, not per ring.
   Per-ring normalisation is exactly what smears a print as the panel narrows
   toward the shoulder; with a global reference, narrower rings occupy less u,
   like a real pattern piece. v runs along the centre-front column so every
   ring is a horizontal line in UV and the island is a true rectangle. */
export const ISLANDS = {
  FRONT:     { u0: 0.020, u1: 0.480, v0: 0.510, v1: 0.990 },
  BACK:      { u0: 0.020, u1: 0.480, v0: 0.020, v1: 0.490 },
  SLEEVE_L:  { u0: 0.520, u1: 0.740, v0: 0.510, v1: 0.990 },
  SLEEVE_R:  { u0: 0.760, u1: 0.980, v0: 0.510, v1: 0.990 },
  TRIM_NECK: { u0: 0.520, u1: 0.980, v0: 0.400, v1: 0.470 },
  TRIM_HEM:  { u0: 0.520, u1: 0.980, v0: 0.310, v1: 0.380 },
  TRIM_CUFF: { u0: 0.520, u1: 0.980, v0: 0.220, v1: 0.290 }
};

function computePanelUVs(geo, pos, NL, S, stride, idxOf, spec) {
  const uv = new Float32Array(NL * stride * 2);
  const d = (a, b) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    return Math.hypot(ax - bx, ay - by, az - bz);
  };

  const ringLen = [], colLen = [];
  let Wref = 0, WrefChest = 0;
  const jc = Math.round(S / 2);

  for (let p = 0; p < 2; p++) {
    ringLen[p] = []; colLen[p] = [];
    for (let i = 0; i < NL; i++) {
      let acc = 0;
      const cl = [0];
      for (let j = 1; j <= S; j++) {
        acc += d(idxOf(i, p, j - 1), idxOf(i, p, j));
        cl.push(acc);
      }
      ringLen[p][i] = acc;
      colLen[p][i] = cl;
      if (acc > Wref) Wref = acc;
    }
  }
  /* chest reference drives print SCALE; Wref drives the unwrap */
  {
    let best = 1e9, bi = 0;
    for (let i = 0; i < NL; i++) {
      const yy = pos[idxOf(i, 0, jc) * 3 + 1];
      if (Math.abs(yy - Y.bust) < best) { best = Math.abs(yy - Y.bust); bi = i; }
    }
    WrefChest = ringLen[0][bi];
  }

  const H = [[], []];
  for (let p = 0; p < 2; p++) {
    H[p][0] = 0;
    for (let i = 1; i < NL; i++) {
      H[p][i] = H[p][i - 1] + d(idxOf(i - 1, p, jc), idxOf(i, p, jc));
    }
  }
  const Href = Math.max(H[0][NL - 1], H[1][NL - 1]);

  /* letterbox the panel inside its island so the print keeps its aspect */
  function fitRect(isl, panelW, panelH) {
    const iw = isl.u1 - isl.u0, ih = isl.v1 - isl.v0;
    const pa = panelW / panelH, ia = iw / ih;
    let w = iw, h = ih;
    if (pa < ia) w = iw * (pa / ia); else h = ih * (ia / pa);
    const cu = (isl.u0 + isl.u1) / 2, cv = (isl.v0 + isl.v1) / 2;
    return { u0: cu - w / 2, u1: cu + w / 2, v0: cv - h / 2, v1: cv + h / 2 };
  }

  const rF = fitRect(ISLANDS.FRONT, Wref, Href);
  const rB = fitRect(ISLANDS.BACK, Wref, Href);

  for (let p = 0; p < 2; p++) {
    const r = p === 0 ? rF : rB;
    for (let i = 0; i < NL; i++) {
      for (let j = 0; j <= S; j++) {
        const uRaw = 0.5 + (colLen[p][i][j] - ringLen[p][i] * 0.5) / Wref;
        const vRaw = H[p][i] / Href;
        const o = idxOf(i, p, j) * 2;
        uv[o]     = r.u0 + (r.u1 - r.u0) * Math.min(1, Math.max(0, uRaw));
        uv[o + 1] = r.v0 + (r.v1 - r.v0) * Math.min(1, Math.max(0, vRaw));
      }
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return {
    FRONT: Object.assign({}, rF, { panelW: Wref, panelH: Href, chestW: WrefChest }),
    BACK:  Object.assign({}, rB, { panelW: Wref, panelH: Href, chestW: WrefChest }),
    hemY: spec.hemY, neckY: spec.neckY, scoopF: spec.scoopF
  };
}

/* The yoke collapses from a wide shallow shoulder ring to a small neck ring
   over a few rows, which makes a fan of anisotropic quads with noisy normals.
   One Laplacian pass on interior vertices only - never touch the boundary,
   and never weld across the shoulder point, because that crease is the
   shoulder seam and it is correct. */
function smoothYoke(geo, pos, NL, S, iSh, nYoke, idxOf) {
  const nrm = geo.attributes.normal.array;
  for (let pass = 0; pass < 1; pass++) {
    const copy = nrm.slice();
    for (let k = 1; k < nYoke; k++) {
      const i = iSh + k;
      for (let p = 0; p < 2; p++) {
        for (let j = 1; j < S; j++) {
          const c = idxOf(i, p, j) * 3;
          const l = idxOf(i, p, j - 1) * 3, r = idxOf(i, p, j + 1) * 3;
          const dn = idxOf(i - 1, p, j) * 3;
          for (let a = 0; a < 3; a++) {
            nrm[c + a] = (copy[c + a] * 2 + copy[l + a] + copy[r + a] + copy[dn + a]) / 5;
          }
        }
      }
    }
  }
  geo.attributes.normal.needsUpdate = true;
}

/* Vertex-colour AO. Cheaper than an aoMap and it does not need a second UV
   set: darken the underarm, the inside of folds, and anywhere the garment
   nearly touches the body. */
function bakeAO(geo, pos, spec) {
  const n = geo.attributes.position.count;
  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(n * 3);
  const UP = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    const ny = nrm[i * 3 + 1];
    const b = bodyRingForGarment(y);
    const dx = Math.abs(pos[i * 3]) - b.aX;
    const dz = Math.abs(pos[i * 3 + 2]) - b.aZ;
    const dist = Math.max(0, Math.min(dx, dz));
    let ao = 1
      - 0.35 * Math.max(0, -ny)
      - 0.30 * (1 - Math.min(1, Math.max(0, (dist - 0.005) / 0.055)));
    ao = Math.min(1, Math.max(0.35, ao));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/* -------------------------------------------------------------- sleeve ---- */

function buildSleeve(spec, loop, side, islands) {
  const N = loop.length;
  const Ks = 8;
  const dir = ARM.dir(side);

  const C = new THREE.Vector3();
  loop.forEach((p) => C.add(p));
  C.multiplyScalar(1 / N);

  let e1 = new THREE.Vector3(0, 1, 0).cross(dir);
  if (e1.lengthSq() < 1e-6) e1 = new THREE.Vector3(1, 0, 0);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();

  const psi = [], rad = [];
  let rRoot = 0;
  for (let j = 0; j < N; j++) {
    const v = new THREE.Vector3().subVectors(loop[j], C);
    const a = v.dot(e1), b = v.dot(e2);
    psi.push(Math.atan2(b, a));
    const r = Math.hypot(a, b);
    rad.push(r);
    rRoot += r;
  }
  rRoot /= N;

  const pos = [], uv = [], idx = [];
  const L = spec.sleeveLen, rCuff = spec.cuffR, sag = spec.sag || 0;
  const isl = side > 0 ? ISLANDS.SLEEVE_R : ISLANDS.SLEEVE_L;

  for (let k = 0; k <= Ks; k++) {
    const s = k / Ks;
    const w = smoothstep(0, 0.45, s);
    const r = rRoot * (1 - s) + rCuff * s;
    const c = C.clone().addScaledVector(dir, L * s);
    c.y -= sag * s * s;
    for (let j = 0; j <= N; j++) {
      const jj = j % N;
      const shaped = new THREE.Vector3()
        .addScaledVector(e1, Math.cos(psi[jj]) * r)
        .addScaledVector(e2, Math.sin(psi[jj]) * r * 0.86);
      const orig = new THREE.Vector3().subVectors(loop[jj], C);
      const P = c.clone()
        .addScaledVector(orig, 1 - w)
        .addScaledVector(shaped, w);
      pos.push(P.x, P.y, P.z);
      uv.push(
        isl.u0 + (isl.u1 - isl.u0) * (j / N),
        isl.v1 - (isl.v1 - isl.v0) * s
      );
    }
  }
  for (let k = 0; k < Ks; k++) {
    for (let j = 0; j < N; j++) {
      const a = k * (N + 1) + j, b = a + 1, c = a + N + 2, d = a + N + 1;
      idx.push(a, b, c, a, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3).fill(1);
  for (let k = 0; k <= Ks; k++) {
    const ao = 0.72 + 0.28 * smoothstep(0, 0.5, k / Ks);
    for (let j = 0; j <= N; j++) {
      const i = k * (N + 1) + j;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/* ----------------------------------------------------------------- rim ---- */

/* A three-ring band that folds under and inward. Without it you see the unlit
   inside of the tube through the neck and hem, which is the one place
   DoubleSide alone looks obviously wrong. */
function buildRim(loop, depth, dirSign, ribbed, islands, islandKey) {
  const N = loop.length;
  const C = new THREE.Vector3();
  loop.forEach((p) => C.add(p));
  C.multiplyScalar(1 / N);

  const isl = ISLANDS[islandKey] || ISLANDS.TRIM_HEM;
  const rings = [
    { scale: 1.000, lift: 0.000 },
    { scale: 0.985, lift: 0.008 },
    { scale: 0.955, lift: 0.030 }
  ];

  const pos = [], uv = [], idx = [];
  for (let k = 0; k < rings.length; k++) {
    for (let j = 0; j < N; j++) {
      const v = new THREE.Vector3().subVectors(loop[j], C);
      let sc = rings[k].scale;
      if (ribbed) sc *= 1 + 0.012 * Math.cos(28 * ((j / N) * TAU));
      const P = C.clone().addScaledVector(v, sc);
      P.y = loop[j].y + dirSign * rings[k].lift * (depth / 0.030);
      pos.push(P.x, P.y, P.z);
      uv.push(
        isl.u0 + (isl.u1 - isl.u0) * (j / (N - 1)),
        isl.v0 + (isl.v1 - isl.v0) * (k / (rings.length - 1))
      );
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < N - 1; j++) {
      const a = k * N + j, b = a + 1, c = a + N + 1, d = a + N;
      idx.push(a, c, b, a, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const col = new Float32Array(g.attributes.position.count * 3).fill(0.82);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/* --------------------------------------------------------------- pants ---- */

/**
 * Waistband tube down to the crotch, then two tapered legs.
 * The crotch is the ugliest part of any procedural garment; expect a slight
 * pinch there. At this render size it reads acceptably.
 */
export function buildPants(spec) {
  const S = spec.S || 16;
  const segs = S * 2;
  const geos = [];

  const waistTop = spec.waistY + spec.bandH / 2;
  const crotchY = spec.crotchY;

  /* upper tube */
  const rows = 8;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const y = waistTop + (crotchY - waistTop) * t;
    const ring = garmentRing(y, spec);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * TAU;
      const p = ringPoint(ring, th, new THREE.Vector3());
      pos.push(p.x, y, p.z);
      uv.push(
        ISLANDS.FRONT.u0 + (ISLANDS.FRONT.u1 - ISLANDS.FRONT.u0) * (j / segs),
        ISLANDS.FRONT.v1 - (ISLANDS.FRONT.v1 - ISLANDS.FRONT.v0) * t * 0.32
      );
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 2, d = a + segs + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const hip = new THREE.BufferGeometry();
  hip.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hip.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hip.setIndex(idx);
  hip.computeVertexNormals();
  hip.setAttribute('color', new THREE.BufferAttribute(
    new Float32Array(hip.attributes.position.count * 3).fill(0.95), 3));
  geos.push(hip);

  /* legs */
  [-1, 1].forEach((side) => {
    const lp = [], lu = [], li = [];
    const nR = 14, nS = 14;
    const topC = new THREE.Vector3(side * 0.118, crotchY - spec.crotchDrop, 0);
    const botC = new THREE.Vector3(side * 0.150, Y.ankle + 0.02, 0.015);
    for (let i = 0; i < nR; i++) {
      const t = i / (nR - 1);
      const c = topC.clone().lerp(botC, t);
      const rx = lerp3(spec.rThighX, spec.rKneeX, spec.rHemX, t);
      const rz = lerp3(spec.rThighZ, spec.rKneeZ, spec.rHemZ, t);
      for (let j = 0; j <= nS; j++) {
        const th = (j / nS) * TAU;
        lp.push(c.x + Math.sin(th) * rx, c.y, c.z + Math.cos(th) * rz);
        lu.push(
          ISLANDS.FRONT.u0 + (ISLANDS.FRONT.u1 - ISLANDS.FRONT.u0) * (j / nS),
          ISLANDS.FRONT.v1 - (ISLANDS.FRONT.v1 - ISLANDS.FRONT.v0) * (0.32 + 0.68 * t)
        );
      }
    }
    for (let i = 0; i < nR - 1; i++) {
      for (let j = 0; j < nS; j++) {
        const a = i * (nS + 1) + j, b = a + 1, c = a + nS + 2, d = a + nS + 1;
        li.push(a, b, c, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
    g.setIndex(li);
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(g.attributes.position.count * 3).fill(0.92), 3));
    geos.push(g);
  });

  return {
    torso: geos[0],
    sleeves: geos.slice(1),
    rims: [],
    islands: {
      FRONT: Object.assign({}, ISLANDS.FRONT, { panelW: 1, panelH: 1, chestW: 1 }),
      BACK: Object.assign({}, ISLANDS.BACK, { panelW: 1, panelH: 1, chestW: 1 }),
      hemY: Y.ankle
    }
  };
}

function lerp3(a, b, c, t) {
  return t < 0.5 ? a + (b - a) * (t / 0.5) : b + (c - b) * ((t - 0.5) / 0.5);
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ hood ---- */

/* A small hood lying against the back of the neck, for the "hoodie" blank.
 *
 * WHY THIS IS GEOMETRY AND NOT A MODEL: the supplied hoodie.glb was a
 * hood-UP shell whose bounding box top was the crown, which is what forced the
 * anchor fudging (yOff 0.44, sizeMul 1.10*1.10) that never quite sat right.
 * The owner's call on Aug 17 2026 was to drop it and build the hoodie as the
 * JERSEY shell plus a hood at the nape - so the body of the garment inherits a
 * fit that is already correct, and the only new surface is the hood itself.
 *
 * The shape is a half-shell: a sphere clipped to its back half, squashed on Z
 * so it lies flat against the neck rather than ballooning, and rolled back a
 * little at the top so the opening faces up and forward the way a down hood
 * does. It is a separate mesh added to the garment group, NOT welded into the
 * shell - the chest decal projector reads the shell's bounding box, and
 * merging a hood into it would drag that box upward and lift the graphic off
 * centre. Keeping it separate is what lets the print stay exactly where the
 * jersey already puts it.
 *
 * @param {number} neckY   the garment's own collar height (spec.neckY, remapped)
 * @param {number} scale   1 is the default; the hood tracks the shell's width
 */
export function buildHood(neckY, scale) {
  const s = scale || 1;

  /* Sized off the neck, not off the torso: a hood is roughly a head's width
     across and sits in the hollow behind the collar.
     rX WIDENED 0.150 -> 0.195 (+30%) on the owner's report, Aug 17 2026. */
  const rX = 0.195 * s;      /* half width  */
  const rY = 0.170 * s;      /* height, collar to the top of the folded hood */
  const rZ = 0.105 * s;      /* how far it stands off the back - kept shallow  */

  /* phiStart 0.52*PI keeps the front lip just behind the collar so the hood
     never pokes through the neckline; the sphere is otherwise a full back
     half. thetaLength stops short of the pole so the top reads as a fold
     rather than a dome. */
  const geo = new THREE.SphereGeometry(
    1, 28, 20,
    Math.PI * 0.52, Math.PI * 0.96,   /* phi: the back half only */
    0, Math.PI * 0.62                 /* theta: down from the top, not a full ball */
  );
  geo.scale(rX, rY, rZ);

  /* ORDER MATTERS AND GETTING IT WRONG IS WHAT DETACHED THE HOOD.
     BufferGeometry.rotateX rotates about the WORLD ORIGIN, not about the
     geometry's own centre. The first version of this translated the hood up to
     the neck (y about 1.0) and THEN applied the quarter turn, which swung it
     down and back to roughly y 0, z -1.0 - off the figure entirely, which is
     exactly how it was reported. Scale and rotate at the origin, translate
     last. Every other builder in props.js follows the same order. */
  geo.rotateX(-HALF_PI);

  /* Placement is DERIVED from the rotated bounds rather than written as an
     offset of rX/rY/rZ. After a quarter turn those three no longer describe
     width/height/depth - height and depth have swapped - so any literal
     expressed in them is wrong the moment the rotation changes. Measuring the
     box instead means the hood tucks under the collar whatever the rotation
     is: its top sits 0.02 below the collar, and its front lip 0.05 behind the
     centreline, so the garment's own neckband overlaps it and no gap shows. */
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(0, neckY - 0.02 - b.max.y, -0.05 - b.max.z);

  geo.computeVertexNormals();
  return geo;
}
