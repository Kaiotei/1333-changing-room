/* Changing Room - measuring an arbitrary supplied mesh.
 *
 * One world-space triangle bake, bucketed by height, serving three consumers:
 *   - cross-section measurement, to rebuild the body table from real geometry
 *   - band slicing, to hide the body under a garment
 *   - decal pre-filtering, to project a print without wrapping it round the back
 *
 * Why triangle-plane intersection rather than raycasting: raycasting a single
 * unaccelerated mesh is O(rays x triangles), which is seconds on a 100k-triangle
 * generated mesh. Worse, Mesh.raycast honours material.side, so casting outward
 * from the spine strikes BACK faces and returns zero hits with no error at all
 * under the default FrontSide. Slicing never reads winding or normals, so
 * inverted normals and non-manifold geometry are simply irrelevant.
 */

import * as THREE from 'three';

export const SECTORS = 72;

/* ------------------------------------------------------------- the bake ---- */

/**
 * Bakes every triangle into world space once and buckets them by the Y range
 * each one spans, so a slice at any height only visits nearby triangles.
 * @param {THREE.Object3D} root
 * @param {number} bins
 */
export function buildSlicer(root, bins) {
  bins = bins || 512;
  root.updateMatrixWorld(true);

  const tris = [];
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    tris.push(o);
  });
  if (!tris.length) return null;

  let nTri = 0;
  tris.forEach((m) => {
    const g = m.geometry;
    nTri += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });

  const V = new Float32Array(nTri * 9);
  const v = new THREE.Vector3();
  let yMin = Infinity, yMax = -Infinity, t = 0;

  tris.forEach((m) => {
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const mw = m.matrixWorld;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
        const o = t * 9 + k * 3;
        V[o] = v.x; V[o + 1] = v.y; V[o + 2] = v.z;
        if (v.y < yMin) yMin = v.y;
        if (v.y > yMax) yMax = v.y;
      }
      t++;
    }
  });

  const h = (yMax - yMin) / bins || 1;
  const buckets = [];
  for (let i = 0; i < bins; i++) buckets.push([]);
  for (let i = 0; i < nTri; i++) {
    const a = V[i * 9 + 1], b = V[i * 9 + 4], c = V[i * 9 + 7];
    const lo = Math.max(0, Math.floor((Math.min(a, b, c) - yMin) / h));
    const hi = Math.min(bins - 1, Math.floor((Math.max(a, b, c) - yMin) / h));
    for (let k = lo; k <= hi; k++) buckets[k].push(i);
  }

  return { V, buckets, yMin, yMax, h, bins, nTri, meshes: tris };
}

/**
 * Every surface crossing at height y, binned by angle around a vertical axis.
 * theta 0 is +Z (front), +PI/2 is +X, matching ringPoint() in body.js.
 *
 * rMin is the arm-rejection mechanism and it is free: a ray leaving the spine
 * crosses the torso wall before it reaches the arm, so the nearest crossing in
 * a sector is the torso and the arm is discarded with no extra work.
 */
export function sliceAt(S, y, ax, az) {
  ax = ax || 0; az = az || 0;
  const bi = Math.min(S.bins - 1, Math.max(0, Math.floor((y - S.yMin) / S.h)));
  const list = S.buckets[bi], V = S.V;

  const rMin = new Float32Array(SECTORS).fill(Infinity);
  const rMax = new Float32Array(SECTORS).fill(0);
  const hits = new Uint16Array(SECTORS);
  let total = 0;

  for (let n = 0; n < list.length; n++) {
    const o = list[n] * 9;
    for (let e = 0; e < 3; e++) {
      const p = o + e * 3, q = o + ((e + 1) % 3) * 3;
      const y0 = V[p + 1], y1 = V[q + 1];
      if (y0 === y1) continue;
      if ((y0 - y) * (y1 - y) > 0) continue;      /* edge does not cross */
      const f = (y - y0) / (y1 - y0);
      const x = V[p] + (V[q] - V[p]) * f - ax;
      const z = V[p + 2] + (V[q + 2] - V[p + 2]) * f - az;
      const r = Math.hypot(x, z);
      let th = Math.atan2(x, z);
      if (th < 0) th += Math.PI * 2;
      let s = Math.floor((th / (Math.PI * 2)) * SECTORS);
      if (s >= SECTORS) s = SECTORS - 1;
      if (r < rMin[s]) rMin[s] = r;
      if (r > rMax[s]) rMax[s] = r;
      hits[s]++;
      total++;
    }
  }
  return { rMin, rMax, hits, total, y };
}

/* ------------------------------------------------------------ fitting ------ */

function at(arr, deg) {
  let i = Math.round((deg / 360) * SECTORS) % SECTORS;
  if (i < 0) i += SECTORS;
  return arr[i];
}
function median(list) {
  const s = list.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
}
function span(a, b, step) {
  const out = [];
  for (let d = a; d <= b; d += (step || 5)) out.push(d);
  return out;
}

/**
 * Fits one superellipse ring. The implicit form is
 *   |x/aX|^e + |z/aZ|^e = 1
 * which is exactly what ringPoint() in body.js parameterises with k = 2/e.
 *
 * aZ comes from the front and back sectors, which arms can never contaminate.
 * aX comes from the sides: use the nearest crossing below the armpit (torso
 * wall), and the FURTHEST above it, because up there the outer deltoid is the
 * measurement you actually want - the shoulder value is the acromion.
 */
export function fitRing(slice, useOuterX) {
  const { rMin, rMax } = slice;
  const rx = useOuterX ? rMax : rMin;

  const aZ = median(span(-25, 25).concat(span(155, 205)).map((d) => at(rMin, d)));
  const aX = median(span(65, 115).concat(span(245, 295)).map((d) => at(rx, d)));
  if (!Number.isFinite(aZ) || !Number.isFinite(aX) || aZ <= 0 || aX <= 0) return null;

  const r45 = median([45, 135, 225, 315].map((d) => at(rMin, d)));
  let e = 2;
  if (Number.isFinite(r45)) {
    const A = Math.abs((r45 * Math.SQRT1_2) / aX);
    const B = Math.abs((r45 * Math.SQRT1_2) / aZ);
    if (A > 0.05 && B > 0.05 && A < 0.999 && B < 0.999) {
      /* A^e + B^e = 1 is monotone decreasing in e for A,B in (0,1) */
      let lo = 1.5, hi = 6;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (Math.pow(A, mid) + Math.pow(B, mid) > 1) lo = mid; else hi = mid;
      }
      e = (lo + hi) / 2;
    }
  }
  return { aX, aZ, e };
}

/* Mean nearest-crossing radius: the girth profile every landmark reads off. */
function girth(slice) {
  let sum = 0, n = 0;
  for (let i = 0; i < SECTORS; i++) {
    if (Number.isFinite(slice.rMin[i])) { sum += slice.rMin[i]; n++; }
  }
  return n ? sum / n : NaN;
}

/* Is this height a single body rather than two legs?
 *
 * A parity test (odd crossing count means the axis is inside a closed surface)
 * is exact but only on a watertight mesh - it fails on overlapping primitives
 * and on generated soup. Coverage works on both: below the crotch the axis sits
 * in the gap between the legs, so rays fired front and back escape without
 * hitting anything and those sectors come back empty. Above it, every sector
 * hits something. */
function axisInside(slice) {
  let seen = 0;
  for (let i = 0; i < SECTORS; i++) if (slice.hits[i]) seen++;
  return seen >= SECTORS * 0.95;
}

/* The occupied height range, found as the largest contiguous run of occupied
 * histogram bins rather than a percentile.
 *
 * A percentile cuts into legitimately sparse extremities - feet have far fewer
 * vertices than a torso, so the 0.5th percentile lands above the soles and the
 * whole figure ends up floating. A contiguous-run test only rejects geometry
 * that is genuinely SEPARATED by empty space, which is what a floater is. */
function occupiedRange(S, warnings) {
  /* Occupancy comes from the triangle buckets, not a vertex histogram. A
     cylinder with one height segment has vertices only at its two ends, so
     counting vertices reads the whole shaft as empty and throws the legs away
     as floaters. buildSlicer already files each triangle into every bin its
     Y range spans, which is exactly the right measure. */
  const span = S.yMax - S.yMin || 1;
  const gapBins = Math.max(2, Math.ceil((span * 0.03) / S.h));

  let best = null, cur = null, gap = 0;
  for (let b = 0; b < S.bins; b++) {
    if (S.buckets[b].length > 0) {
      if (!cur) cur = { lo: b, hi: b };
      cur.hi = b;
      gap = 0;
    } else if (cur) {
      if (++gap > gapBins) {
        if (!best || cur.hi - cur.lo > best.hi - best.lo) best = cur;
        cur = null;
      }
    }
  }
  if (cur && (!best || cur.hi - cur.lo > best.hi - best.lo)) best = cur;
  if (!best) return { yLo: S.yMin, yHi: S.yMax };

  const yLo = S.yMin + best.lo * S.h;
  const yHi = S.yMin + (best.hi + 1) * S.h;

  let outside = 0;
  for (let i = 0; i < S.nTri; i++) {
    const cy = (S.V[i * 9 + 1] + S.V[i * 9 + 4] + S.V[i * 9 + 7]) / 3;
    if (cy < yLo || cy > yHi) outside++;
  }
  if (outside / S.nTri > 0.002) {
    warnings.push('floaters: ' + ((outside / S.nTri) * 100).toFixed(1) +
                  '% of triangles sit outside the main body and were ignored');
  }
  return { yLo, yHi };
}

/* -------------------------------------------------------- landmarks -------- */

/**
 * Derives the body landmarks and cross-section table from a supplied mesh.
 * @returns {{ Y: object, levels: Array, profile: Array, axis: {x:number,z:number}, warnings: string[] }}
 */
export function deriveBody(S, opts) {
  opts = opts || {};
  const warnings = [];
  const N = opts.samples || 200;

  const { yLo, yHi } = occupiedRange(S, warnings);
  const H = yHi - yLo;

  /* Axis fixed once at mid-torso. Recomputing per height makes the profile
     wobble as the body shifts off centre. */
  let ax = 0, az = 0;
  {
    const s0 = sliceAt(S, yLo + H * 0.58, 0, 0);
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < SECTORS; i++) {
      if (!Number.isFinite(s0.rMin[i])) continue;
      const th = ((i + 0.5) / SECTORS) * Math.PI * 2;
      sx += Math.sin(th) * s0.rMin[i];
      sz += Math.cos(th) * s0.rMin[i];
      n++;
    }
    if (n) { ax = sx / n; az = sz / n; }
  }

  const profile = [];
  for (let i = 0; i < N; i++) {
    const y = yLo + (H * i) / (N - 1);
    const sl = sliceAt(S, y, ax, az);
    profile.push({ y, g: girth(sl), slice: sl, inside: axisInside(sl) });
  }

  const gAt = (i) => profile[i].g;
  const frac = (i) => (profile[i].y - yLo) / H;

  const idxAtFrac0 = (f) => Math.min(N - 1, Math.max(0, Math.round(f * (N - 1))));

  /* Crotch: the lowest height where every sector hits something, i.e. where the
     two legs have become one body. Constrained to 40-55% of stature, because
     the geometric test alone drifts low when the thighs touch - and on a human
     figure the crotch is reliably near 47%, which is a stronger prior than the
     measurement in that failure case. */
  const crotchLo = idxAtFrac0(0.40), crotchHi = idxAtFrac0(0.55);
  let iCrotch = -1;
  for (let i = crotchLo; i <= crotchHi; i++) {
    if (profile[i].inside) { iCrotch = i; break; }
  }
  if (iCrotch < 0) {
    iCrotch = idxAtFrac0(0.47);
    warnings.push('crotch not detected geometrically; using 47 percent of stature');
  }

  const localMin = (a, b) => {
    let best = a;
    for (let i = a; i <= b; i++) if (!(gAt(i) >= gAt(best))) best = i;
    return best;
  };
  const localMax = (a, b) => {
    let best = a;
    for (let i = a; i <= b; i++) if (!(gAt(i) <= gAt(best))) best = i;
    return best;
  };
  const idxAtFrac = (f) => Math.min(N - 1, Math.max(0, Math.round(f * (N - 1))));

  const iWaist = localMin(idxAtFrac(0.50), idxAtFrac(0.66));
  const iHip = localMax(iCrotch, iWaist);
  const iBust = localMax(iWaist, idxAtFrac(0.78));

  /* The narrowest point near the top is the middle of the neck, not its base.
     The base is where the girth flares back out into the shoulders, so walk
     down from the minimum until it has grown by a clear margin. */
  const iNeckMin = localMin(idxAtFrac(0.80), idxAtFrac(0.96));
  let iNeck = iNeckMin;
  for (let i = iNeckMin; i > iBust; i--) {
    if (gAt(i) > gAt(iNeckMin) * 1.40) { iNeck = i; break; }
  }

  /* Shoulder is the acromion: the widest point of the TORSO WALL in the upper
     body. It has to be measured on rMin, the nearest crossing, not rMax - arms
     hanging at the sides are often wider than the shoulders themselves, so an
     outer-width search finds the bicep and lands a third of a body too low. */
  let iShoulder = iNeck;
  {
    let widest = -1;
    for (let i = iBust; i <= iNeck; i++) {
      const sl = profile[i].slice;
      const w = median(span(70, 110).concat(span(250, 290)).map((d) => at(sl.rMin, d)));
      if (Number.isFinite(w) && w >= widest) { widest = w; iShoulder = i; }
    }
  }

  /* Armpit: the HIGHEST height at which the arm is still a separate mass from
     the torso. Searching upward and taking the first separation finds wherever
     the arms happen to hang, not where they join. */
  let iArmpit = iBust;
  let foundArmpit = false;
  for (let i = iShoulder; i > iWaist; i--) {
    const sl = profile[i].slice;
    let sep = 0, n = 0;
    for (const d of span(65, 115).concat(span(245, 295))) {
      const a = at(sl.rMin, d), b = at(sl.rMax, d);
      if (!Number.isFinite(a) || a <= 0) continue;
      n++;
      if (b > a * 1.5) sep++;
    }
    if (n > 4 && sep > n * 0.4) { iArmpit = i; foundArmpit = true; break; }
  }
  if (!foundArmpit) {
    /* no separable arms (arms-down pose, or fused): sit just under the shoulder */
    iArmpit = Math.max(iBust, iShoulder - Math.round(N * 0.05));
    warnings.push('arms never separate from the torso; armpit placed just below the shoulder');
  }

  /* Anatomical guard rails, as a fraction of stature.
   *
   * Every landmark above is a geometric heuristic, and each one has a body
   * shape that defeats it - touching thighs sink the crotch, arms hanging
   * wider than the shoulders drag the acromion down. Human proportions are a
   * far stronger prior than any of those heuristics in their failure cases, so
   * a measurement outside a plausible band is clamped and reported rather than
   * trusted. The ring is still MEASURED at the clamped height, so the body's
   * real shape still comes from the mesh. */
  const BANDS = {
    crotch:   [0.44, 0.51],
    hip:      [0.49, 0.56],
    waist:    [0.54, 0.64],
    bust:     [0.66, 0.74],
    armpit:   [0.69, 0.77],
    shoulder: [0.77, 0.85],
    neckbase: [0.80, 0.88]
  };
  function guard(name, y) {
    const [lo, hi] = BANDS[name];
    const f = (y - yLo) / H;
    if (f >= lo && f <= hi) return y;
    const cf = Math.min(hi, Math.max(lo, f));
    warnings.push(name + ' measured at ' + (f * 100).toFixed(0) +
                  '% of stature, outside the plausible ' + (lo * 100).toFixed(0) + '-' +
                  (hi * 100).toFixed(0) + '% band; clamped to ' + (cf * 100).toFixed(0) + '%');
    return yLo + cf * H;
  }

  const Ymap = {
    ground: yLo,
    headtop: yHi,
    crotch:   guard('crotch',   profile[iCrotch].y),
    hip:      guard('hip',      profile[iHip].y),
    waist:    guard('waist',    profile[iWaist].y),
    bust:     guard('bust',     profile[iBust].y),
    armpit:   guard('armpit',   profile[iArmpit].y),
    shoulder: guard('shoulder', profile[iShoulder].y),
    neckbase: guard('neckbase', profile[iNeck].y)
  };

  /* keep the table strictly ascending whatever the clamps did */
  const asc = ['crotch', 'hip', 'waist', 'bust', 'armpit', 'shoulder', 'neckbase'];
  for (let i = 1; i < asc.length; i++) {
    if (Ymap[asc[i]] <= Ymap[asc[i - 1]]) {
      Ymap[asc[i]] = Ymap[asc[i - 1]] + H * 0.012;
    }
  }
  Ymap.ankle = yLo + H * 0.038;
  Ymap.knee  = yLo + (Ymap.crotch - yLo) * 0.46;
  Ymap.thigh = yLo + (Ymap.crotch - yLo) * 0.82;

  /* Measured rings, crotch upward. Below the crotch a slice contains two
     separate legs, so a measurement around the body's central axis is
     meaningless there and comes back unfittable. */
  const order = ['crotch', 'hip', 'waist', 'bust', 'armpit', 'shoulder', 'neckbase'];
  const levels = [];
  for (const key of order) {
    const y = Ymap[key];
    const sl = sliceAt(S, y, ax, az);
    /* at the shoulder the outer crossing IS the measurement we want - that
       value is the deltoid, not the ribcage */
    const ring = fitRing(sl, key === 'shoulder');
    if (!ring) { warnings.push('could not fit a ring at ' + key); continue; }
    levels.push({ y, aX: ring.aX, aZ: ring.aZ, e: ring.e, key });
  }

  /* Leg rings are tapered down from the crotch rather than measured. Garments
     never read below the crotch - bodyRingForGarment clamps there - and the
     pants builder carries its own explicit leg radii, so these exist only to
     keep the table shaped the way bodyRingAt expects. */
  const cr = levels.find((l) => l.key === 'crotch');
  if (cr) {
    const legs = [
      { key: 'thigh', y: Ymap.thigh, k: 0.66 },
      { key: 'knee',  y: Ymap.knee,  k: 0.43 },
      { key: 'ankle', y: Ymap.ankle, k: 0.27 }
    ];
    legs.forEach((L) => {
      levels.unshift({ y: L.y, aX: cr.aX * L.k, aZ: cr.aZ * L.k, e: 2.0, key: L.key, derived: 'tapered' });
    });
  }
  levels.sort((a, b) => a.y - b.y);

  /* Arm axis, measured rather than assumed: track the outer crossing in the
     side sectors from the armpit upward and fit a direction to it. */
  const arm = deriveArm(S, Ymap, ax, az, warnings);

  return { Y: Ymap, levels, profile, axis: { x: ax, z: az }, arm, warnings, height: H, yLo, yHi };
}

/* Measures where the arms actually are, instead of trusting a constant.
 *
 * Tracks the centre of the arm mass - midway between the torso wall and the
 * outer surface in the side sectors - down a long span below the shoulder. A
 * short span gives a slope fit so noisy the angle is meaningless. */
function deriveArm(S, Ymap, ax, az, warnings) {
  const yTop = Ymap.armpit;
  const yBot = Ymap.armpit - (Ymap.shoulder - Ymap.waist) * 1.1;
  const pts = [];
  const STEPS = 14;

  for (let i = 0; i <= STEPS; i++) {
    const y = yTop - ((yTop - yBot) * i) / STEPS;
    const sl = sliceAt(S, y, ax, az);
    const inner = median(span(70, 110).map((d) => at(sl.rMin, d)));
    const outer = median(span(70, 110).map((d) => at(sl.rMax, d)));
    if (!Number.isFinite(outer) || outer <= 0) continue;
    /* only a genuinely separated arm is usable */
    if (!Number.isFinite(inner) || outer < inner * 1.25) continue;
    pts.push({ y, x: (inner + outer) / 2 });
  }

  if (pts.length < 5) {
    warnings.push('arm axis not measurable (arms fused or absent); keeping the authored default');
    return null;
  }

  let sy = 0, sx = 0, syy = 0, sxy = 0;
  pts.forEach((p) => { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.x * p.y; });
  const n = pts.length;
  const denom = n * syy - sy * sy;
  const slope = Math.abs(denom) < 1e-9 ? 0 : (n * sxy - sx * sy) / denom;
  /* dx/dy negative means the arm moves outward as it descends: an A-pose */
  const out = Math.atan(-slope);
  const top = pts[0];

  return {
    originX: top.x,
    originY: top.y,
    out: Number.isFinite(out) ? Math.max(0, Math.min(1.4, out)) : 0,
    samples: n
  };
}

/* --------------------------------------------------------- decal proxy ----- */

/**
 * The triangles inside a decal box AND facing the projector, as a standalone
 * mesh at identity transform.
 *
 * DecalGeometry does no backface culling of its own - it clips against six
 * planes and never compares a normal to the projection direction - so without
 * this the print also lands on the far side of the target. It also walks every
 * triangle in the mesh, which is hundreds of milliseconds on a dense generated
 * model; handing it a proxy makes that microseconds.
 */
export function decalProxy(S, centre, half, forward, origin) {
  const keep = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();

  /* The supplied garments have UNRELIABLE WINDING - measured: the shirt is 54%
     outward / 46% inward, i.e. essentially random, and the pants 73%. So a
     cull that reads the winding-derived normal directly discards about half the
     genuinely front-facing triangles and keeps about half the rear ones, and
     the print lands in fragments or not at all. Orient each normal away from
     a reference point first, exactly as prepareCover does for the body, and
     the cull becomes winding-independent.
     `origin` is that reference point, defaulting to the mesh's own centroid.
     It MUST be overridden for a mesh holding more than one separate object -
     the shoes ship as one merged pair, so the pair's centroid sits between
     them at x=0, and orienting "away from" it flips every MEDIAL (inner-
     facing) triangle to point outward. They then all fail the facing test
     below, which is exactly why the inner-face decal only ever caught a
     handful of stray triangles no matter how the projector box was sized. */
  let mx = 0, my = 0, mz = 0;
  if (origin) {
    mx = origin.x; my = origin.y; mz = origin.z;
  } else {
    for (let t = 0; t < S.nTri; t++) {
      const o = t * 9;
      mx += (S.V[o] + S.V[o + 3] + S.V[o + 6]) / 3;
      my += (S.V[o + 1] + S.V[o + 4] + S.V[o + 7]) / 3;
      mz += (S.V[o + 2] + S.V[o + 5] + S.V[o + 8]) / 3;
    }
    mx /= S.nTri; my /= S.nTri; mz /= S.nTri;
  }

  for (let t = 0; t < S.nTri; t++) {
    const o = t * 9;
    const cx = (S.V[o] + S.V[o + 3] + S.V[o + 6]) / 3;
    const cy = (S.V[o + 1] + S.V[o + 4] + S.V[o + 7]) / 3;
    const cz = (S.V[o + 2] + S.V[o + 5] + S.V[o + 8]) / 3;
    if (Math.abs(cx - centre.x) > half.x) continue;
    if (Math.abs(cy - centre.y) > half.y) continue;
    if (Math.abs(cz - centre.z) > half.z) continue;
    e1.set(S.V[o + 3] - S.V[o], S.V[o + 4] - S.V[o + 1], S.V[o + 5] - S.V[o + 2]);
    e2.set(S.V[o + 6] - S.V[o], S.V[o + 7] - S.V[o + 1], S.V[o + 8] - S.V[o + 2]);
    n.crossVectors(e1, e2);
    if (n.x * (cx - mx) + n.y * (cy - my) + n.z * (cz - mz) < 0) n.negate();
    if (n.dot(forward) >= 0) continue;         /* faces away from the projector */
    for (let k = 0; k < 9; k++) keep.push(S.V[o + k]);
  }
  if (!keep.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.updateMatrixWorld(true);
  return m;
}

/* ----------------------------------------------------------- bands --------- */

/**
 * Sorts a mesh's index by triangle centroid height, once, so that hiding any
 * set of vertical bands afterwards is just rewriting geometry.groups - no
 * allocation, no shader recompile, and unlimited bands.
 *
 * Clipping planes cannot do this job: every plane is a half-space along Y, so
 * their union is at most two visible regions, i.e. exactly one hidden band. A
 * crop top worn with pants needs two hidden bands and three visible regions.
 */
/* ------------------------------------------------------------- cover ------ */

/**
 * A garment's OUTER surface, sampled as a radius per height and angle.
 *
 * This exists to answer one question per body triangle: does this one break out
 * through the garment? Hiding by HEIGHT cannot answer it - a height range is a
 * horizontal slab through the whole figure, so hiding the chest also hides both
 * arms, which occupy the same heights. Radius per angular sector separates
 * them, because an arm and a rib sit at different angles around the spine.
 *
 * Outer, specifically, and this is the part that is easy to get wrong. Testing
 * against the garment's NEAREST crossing looks equivalent and is not: where the
 * fabric runs close to horizontal - the shoulders of a tee, the collar, the hem
 * - a slice at that height cuts across the whole panel, so the nearest crossing
 * sits right next to the spine. Everything outside it, meaning the neck and
 * both shoulders, then counts as covered and vanishes. The furthest crossing
 * has no such failure: past it the body really is outside the garment.
 *
 * Watertightness is not required either way, which matters, because a garment
 * shell is open at the neck, the sleeves and the hem - an inside/outside parity
 * test on one would be meaningless.
 */
export function coverField(root) {
  const S = buildSlicer(root, 128);
  return (S && S.nTri) ? S : null;
}


/** Moller-Trumbore. Returns the hit distance along dir, or -1. */
function rayTri(px, py, pz, dx, dy, dz, V, o) {
  const ax = V[o], ay = V[o + 1], az = V[o + 2];
  const e1x = V[o + 3] - ax, e1y = V[o + 4] - ay, e1z = V[o + 5] - az;
  const e2x = V[o + 6] - ax, e2y = V[o + 7] - ay, e2z = V[o + 8] - az;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-9 && a < 1e-9) return -1;
  const f = 1 / a;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return -1;
  return f * (e2x * qx + e2y * qy + e2z * qz);
}

/** Does a ray from p along d hit the garment within `reach`? */
function rayHits(S, px, py, pz, dx, dy, dz, reach) {
  const y0 = Math.min(py, py + dy * reach), y1 = Math.max(py, py + dy * reach);
  if (y1 < S.yMin || y0 > S.yMax) return false;
  let b0 = Math.floor((y0 - S.yMin) / S.h);
  let b1 = Math.floor((y1 - S.yMin) / S.h);
  if (b0 < 0) b0 = 0;
  if (b1 > S.bins - 1) b1 = S.bins - 1;
  const V = S.V;
  for (let b = b0; b <= b1; b++) {
    const list = S.buckets[b];
    for (let n = 0; n < list.length; n++) {
      const t = rayTri(px, py, pz, dx, dy, dz, V, list[n] * 9);
      if (t > 1e-5 && t <= reach) return true;
    }
  }
  return false;
}

/** Nearest hit distance along dir within maxT, or Infinity. */
function rayFirst(S, px, py, pz, dx, dy, dz, maxT) {
  const y0 = Math.min(py, py + dy * maxT), y1 = Math.max(py, py + dy * maxT);
  if (y1 < S.yMin || y0 > S.yMax) return Infinity;
  let b0 = Math.floor((y0 - S.yMin) / S.h);
  let b1 = Math.floor((y1 - S.yMin) / S.h);
  if (b0 < 0) b0 = 0;
  if (b1 > S.bins - 1) b1 = S.bins - 1;
  const V = S.V;
  let best = Infinity;
  for (let b = b0; b <= b1; b++) {
    const list = S.buckets[b];
    for (let n = 0; n < list.length; n++) {
      const t = rayTri(px, py, pz, dx, dy, dz, V, list[n] * 9);
      if (t > 1e-3 && t <= maxT && t < best) best = t;
    }
  }
  return best;
}

/* How far behind a face the backward probe may ever reach. A limb is never
   thicker than this, so it is a sanity cap and nothing more. */
const MAX_BACK = 0.45;

/**
 * Hidden Surface Removal, the technique every avatar system uses for this.
 *
 * The key point, and the one every earlier attempt here missed: you do not
 * patch the protruding triangles, you hide the WHOLE region the garment covers.
 * Poke-through then cannot happen, because there is no skin left under the
 * cloth to poke through it. That is exactly what an authored alpha mask does in
 * Second Life or DAZ - this just derives the mask instead of painting it.
 *
 * Two things make a face count as covered:
 *
 *   1. cloth ahead of it within `reach` - it is simply underneath the garment
 *   2. cloth running THROUGH its own limb - the garment surface lies inside the
 *      flesh, so this face has already broken out through the cloth
 *
 * Case 2 is the thigh-through-the-pants case, and a fixed backward distance
 * cannot express it. Measured against the shipped meshes, this mannequin's legs
 * stood 1.2 to 5.7 inches proud of the pants, so a one-inch probe found nothing
 * behind the great majority of the protruding skin and it stayed drawn.
 *
 * Simply lengthening that probe is what broke this twice before, and for a real
 * reason: a long fixed reach behind a bare forearm eventually finds the shirt
 * across the gap and erases the arm. The bound here is not a distance at all,
 * it is the body's own far wall - cast along the ray into the body, see where
 * it comes out the other side, and accept cloth only up to THERE. Cloth nearer
 * than the far wall is inside this limb; cloth beyond it is across a gap and on
 * something else. That is scale-free: it stretches to a thigh and stays tight
 * on a hand resting against a clothed hip, with no constant to tune. `back`
 * survives only as a floor, so a thin face behaves exactly as it always did.
 *
 * Both directions of the face's axis are tried, because prepareCover orients
 * normals away from the figure's single vertical axis and on a two-legged
 * figure that axis runs between the legs - every inner-thigh face comes out
 * pointing the wrong way.
 *
 * Measured on the shipped meshes over 12 camera angles, counting only faces
 * with no cloth between them and the eye (tools/cover-check.mjs):
 *   thigh skin still drawn   18.0%  ->  0.2%
 *   hands still drawn        98.6%  -> 96.3%   (they must stay drawn)
 */
function covered(S, B, px, py, pz, nx, ny, nz, reach, back) {
  if (!S) return false;
  if (rayHits(S, px, py, pz, nx, ny, nz, reach)) return true;
  if (!B) return rayHits(S, px, py, pz, -nx, -ny, -nz, back);
  for (let s = 1; s >= -1; s -= 2) {
    const dx = s * nx, dy = s * ny, dz = s * nz;
    const exit = rayFirst(B, px, py, pz, dx, dy, dz, MAX_BACK);
    if (exit === Infinity) continue;
    /* the 1e-4 stops a garment lying exactly on the body wall being a coin toss */
    const lim = Math.min(MAX_BACK, Math.max(back, exit + 1e-4));
    if (rayHits(S, px, py, pz, dx, dy, dz, lim)) return true;
  }
  return false;
}

/**
 * Per-triangle visibility for the body mesh.
 *
 * The index is PARTITIONED rather than grouped: visible triangles first, then
 * hidden, and a single draw range covers the front of it. Groups would work too
 * but are only honoured when the material is an Array, and an arbitrary set of
 * triangles is not a contiguous run in any fixed ordering anyway.
 */

/** @param {object} bodyS a buildSlicer over the whole body, for the depth probe
 *                        in covered(). Optional - without it the backward probe
 *                        falls back to the old fixed distance. */
export function prepareCover(mesh, ax, az, bodyS) {
  const geo = mesh.geometry;
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  const src = geo.index.array.slice();
  const pos = geo.attributes.position;
  const nTri = src.length / 3;

  /* World space, always. These models carry a baked node rotation, so the
     geometry's local Y is the model's depth rather than its height. */
  mesh.updateMatrixWorld(true);
  const mw = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const wx = new Float32Array(nTri);
  const cy = new Float32Array(nTri);
  const wz = new Float32Array(nTri);
  const nx = new Float32Array(nTri);
  const ny = new Float32Array(nTri);
  const nz = new Float32Array(nTri);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < nTri; t++) {
    a.fromBufferAttribute(pos, src[t * 3]).applyMatrix4(mw);
    b.fromBufferAttribute(pos, src[t * 3 + 1]).applyMatrix4(mw);
    c.fromBufferAttribute(pos, src[t * 3 + 2]).applyMatrix4(mw);
    wx[t] = (a.x + b.x + c.x) / 3;
    cy[t] = (a.y + b.y + c.y) / 3;
    wz[t] = (a.z + b.z + c.z) / 3;
    e1.subVectors(b, a); e2.subVectors(c, a);
    n.crossVectors(e1, e2).normalize();
    /* Face windings on these models are not reliable, so orient the normal
       outward from the figure's own axis rather than trusting it. */
    if (n.x * (wx[t] - ax) + n.z * (wz[t] - az) < 0) n.negate();
    nx[t] = n.x; ny[t] = n.y; nz[t] = n.z;
  }

  geo.clearGroups();
  if (Array.isArray(mesh.material)) mesh.material = mesh.material[0];

  /* ---- alpha mask setup ------------------------------------------------
     Hiding whole triangles is what left a ragged edge everywhere a garment
     ends: a face is all-or-nothing, so the boundary can only ever follow the
     triangle edges it happens to land on. The games/Second Life answer is an
     alpha mask - decide per PIXEL, not per face - so coverage becomes a scalar
     carried on the vertices and interpolated across each triangle, and the
     fragment shader drops anything past the halfway line. The boundary then
     cuts through triangles wherever the cloth actually is.

     Vertices sharing a position must share a value or the mask tears along
     every triangle edge - the shipped mannequin is de-indexed, so each triangle
     owns its own three vertices and nothing is shared by default. Group by
     position once, here, rather than per rebuild. */
  const nVert = pos.count;
  const vertGroup = new Int32Array(nVert);
  const seen = new Map();
  let nGroup = 0;
  for (let i = 0; i < nVert; i++) {
    const k = Math.round(pos.getX(i) * 1e5) + ',' +
              Math.round(pos.getY(i) * 1e5) + ',' +
              Math.round(pos.getZ(i) * 1e5);
    let g = seen.get(k);
    if (g === undefined) { g = nGroup++; seen.set(k, g); }
    vertGroup[i] = g;
  }

  let cover = geo.getAttribute('aCover');
  if (!cover || cover.count !== nVert) {
    cover = new THREE.BufferAttribute(new Float32Array(nVert), 1);
    geo.setAttribute('aCover', cover);
  }
  /* nothing is hidden until applyCover says so */
  cover.array.fill(0);
  cover.needsUpdate = true;
  /* the mask replaces the old index-partition trick, so every triangle is drawn
     again and the shader decides what survives */
  geo.setDrawRange(0, Infinity);

  patchAlphaMask(mesh);

  return {
    mesh, src, nTri, wx, cy, wz, nx, ny, nz,
    cover, vertGroup, bodyS: bodyS || null,
    gSum: new Float32Array(nGroup), gCnt: new Float32Array(nGroup)
  };
}

/* Teach a material to drop masked fragments. `discard` on an interpolated
   varying IS alpha testing - the same mechanism an alpha-masked avatar skin
   uses - and it costs one compare, no sorting and no blending.
   The depth material needs the identical cut or the hidden skin keeps casting
   its shadow, which is how you get a shadow wearing nothing under an outfit. */
function patchAlphaMask(mesh) {
  const cut = (shader) => {
    shader.vertexShader = 'attribute float aCover;\nvarying float vCover;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCover = aCover;'
      );
    shader.fragmentShader = 'varying float vCover;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        'if ( vCover > 0.5 ) discard;\n#include <clipping_planes_fragment>'
      );
  };

  const mat = mesh.material;
  if (mat && !mat.userData.coverMasked) {
    mat.userData.coverMasked = true;
    mat.onBeforeCompile = cut;
    /* without a distinct cache key three.js may hand back a program compiled
       for an unpatched material with the same parameters */
    mat.customProgramCacheKey = () => 'coverMask';
    mat.needsUpdate = true;
  }

  if (!mesh.customDepthMaterial) {
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dm.onBeforeCompile = cut;
    dm.customProgramCacheKey = () => 'coverMaskDepth';
    mesh.customDepthMaterial = dm;
  }
}

/** @param {Array} fields coverField results for every worn garment */
export function applyCover(C, fields, margin) {
  if (!C) return 0;
  const { mesh, src, nTri, wx, cy, wz, nx, ny, nz, cover, vertGroup, bodyS, gSum, gCnt } = C;
  /* DO NOT "improve" these two numbers. This exact pair - long reach outward,
     short reach inward - is the configuration that was visually confirmed
     working on the HD mannequin. Both later attempts at making them symmetric
     (0.12/0.12, then 0.20/0.20), on the theory that a mis-oriented normal
     needed equal coverage in both directions, broke thigh clipping and had to
     be reverted. The asymmetry is doing real work: `back` is deliberately
     short so that a face is only hidden when the cloth is genuinely just
     behind it, not whenever any cloth happens to lie within a large radius.
     reach: how far ahead of a face to look for cloth. Must exceed the slack in
     a loose garment or the belly of it reads as uncovered. One inch is 0.0495.
     back: how far behind, to catch a face that has already pushed out. Since
     Aug 10 2026 this is only the FLOOR under the body's own far wall rather
     than the whole backward probe - see covered(). The number is unchanged and
     still frozen; what changed is that it no longer has to cover a limb's
     thickness on its own, which is why the thighs used to survive it. */
  const reach = margin == null ? 0.16 : margin;
  const back = 0.05;

  /* The test itself is unchanged - same surface cast, same two constants. Only
     what is done with the answer changed: instead of pulling a covered triangle
     out of the draw range, its verdict is deposited on its three vertices and
     averaged with every other face meeting there. That average is the mask. A
     vertex deep under cloth ends at 1, one out in the open at 0, and one on the
     hem somewhere between - so the 0.5 crossing traces the garment's real edge
     across the middle of a triangle instead of jumping around it. */
  gSum.fill(0);
  gCnt.fill(0);
  let hidden = 0;
  for (let t = 0; t < nTri; t++) {
    let hide = false;
    for (let f = 0; f < fields.length; f++) {
      if (covered(fields[f], bodyS, wx[t], cy[t], wz[t], nx[t], ny[t], nz[t], reach, back)) {
        hide = true; break;
      }
    }
    if (hide) hidden++;
    const v = hide ? 1 : 0;
    for (let j = 0; j < 3; j++) {
      const g = vertGroup[src[t * 3 + j]];
      gSum[g] += v;
      gCnt[g]++;
    }
  }

  const arr = cover.array;
  for (let i = 0; i < arr.length; i++) {
    const g = vertGroup[i];
    arr[i] = gCnt[g] ? gSum[g] / gCnt[g] : 0;
  }
  cover.needsUpdate = true;
  return hidden;
}

export function prepareBands(mesh) {
  const geo = mesh.geometry;
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  const src = geo.index.array;
  const pos = geo.attributes.position;
  const nTri = src.length / 3;

  /* Centroid heights must be WORLD space. Reading the local Y attribute looks
     right and silently isn't: supplied glTF models routinely carry a node
     rotation (the Blender exporter bakes +90deg X), so the geometry's local Y
     is the model's depth, not its height. Every band then resolves to an empty
     range and the whole body disappears. */
  mesh.updateMatrixWorld(true);
  const mw = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const worldY = (vi) => v.fromBufferAttribute(pos, vi).applyMatrix4(mw).y;

  const key = new Float32Array(nTri);
  const ord = new Array(nTri);
  for (let t = 0; t < nTri; t++) {
    ord[t] = t;
    key[t] = (worldY(src[t * 3]) + worldY(src[t * 3 + 1]) + worldY(src[t * 3 + 2])) / 3;
  }
  ord.sort((a, b) => key[a] - key[b]);

  const out = new src.constructor(src.length);
  const ys = new Float32Array(nTri);
  for (let i = 0; i < nTri; i++) {
    const t = ord[i];
    out[i * 3] = src[t * 3];
    out[i * 3 + 1] = src[t * 3 + 1];
    out[i * 3 + 2] = src[t * 3 + 2];
    ys[i] = key[t];
  }
  geo.setIndex(new THREE.BufferAttribute(out, 1));

  /* geometry.groups are ONLY honoured when material is an Array - the renderer
     ignores groups entirely on the single-material path. */
  if (!Array.isArray(mesh.material)) mesh.material = [mesh.material];

  return { ys, nTri, mesh };
}

/** @param {Array<[number,number]>} runs ascending, in the mesh's local Y */
export function showBands(band, runs) {
  const { ys, nTri, mesh } = band;
  const lower = (y) => {
    let a = 0, b = nTri;
    while (a < b) { const m = (a + b) >> 1; if (ys[m] < y) a = m + 1; else b = m; }
    return a;
  };
  const geo = mesh.geometry;
  geo.clearGroups();
  for (const [lo, hi] of runs) {
    const s = lower(lo), e = lower(hi);
    if (e > s) geo.addGroup(s * 3, (e - s) * 3, 0);
  }
}

/** Turns a set of hidden [lo,hi] bands into the visible runs showBands wants. */
export function invertBands(hidden, yLo, yHi) {
  const h = hidden.slice().filter((b) => b[1] > b[0]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of h) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }
  const runs = [];
  let cur = yLo;
  for (const b of merged) {
    if (b[0] > cur) runs.push([cur, b[0]]);
    cur = Math.max(cur, b[1]);
  }
  if (cur < yHi) runs.push([cur, yHi]);
  return runs;
}
