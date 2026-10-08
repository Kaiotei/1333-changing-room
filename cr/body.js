/* Changing Room - body landmarks and the mannequin.
 *
 * The figure is a faceless display form: no face, no eyes, no hair. That is a
 * deliberate choice, not a shortcut. Hair was the worst-looking thing in v1 and
 * a shop-display form both removes it and puts all attention on the clothing.
 *
 * Everything in the app measures off BODY_LEVELS. Torsos are roughly 1.4:1
 * wide to deep, so the rings are superellipses rather than circles - a circular
 * cross-section makes the shell shallower than the body and the chest pokes
 * through the print.
 */

import * as THREE from 'three';

/* Avatar is 3.37 world units tall = 68in, so 1 inch = 0.0495 world. Garment
   dimensions can then be sanity-checked against real sizing. */
export const INCH = 0.0495;

export const Y = {
  ground:   -1.75,
  ankle:    -1.62,
  knee:     -0.86,
  thigh:    -0.30,
  crotch:   -0.15,
  hip:       0.02,
  waist:     0.15,
  bust:      0.55,
  armpit:    0.66,
  shoulder:  0.95,
  neckbase:  1.05,
  headtop:   1.62
};

/* aX = half width, aZ = half depth, e = superellipse exponent (2 is an ellipse,
   higher is boxier). Girths noted where they were checked against real sizing. */
export const BODY_LEVELS = [
  { y: Y.ankle,    aX: 0.062, aZ: 0.070, e: 2.00 },
  { y: Y.knee,     aX: 0.098, aZ: 0.100, e: 2.00 },
  { y: Y.thigh,    aX: 0.150, aZ: 0.155, e: 2.00 },
  { y: Y.crotch,   aX: 0.228, aZ: 0.168, e: 2.10 },   // 25.5in
  { y: Y.hip,      aX: 0.248, aZ: 0.182, e: 2.20 },   // 27.5in
  { y: Y.waist,    aX: 0.208, aZ: 0.152, e: 2.05 },   // 23.0in
  { y: Y.bust,     aX: 0.268, aZ: 0.190, e: 2.30 },   // 29.3in
  { y: Y.armpit,   aX: 0.272, aZ: 0.194, e: 2.35 },
  { y: Y.shoulder, aX: 0.315, aZ: 0.150, e: 2.70 },   // acromion
  { y: Y.neckbase, aX: 0.100, aZ: 0.094, e: 2.00 }    // 12.3in
];

/* The arm axis is shared by the mannequin and the sleeve builder. If these ever
   drift apart the sleeve runs through the bicep, so it lives in exactly one
   place and is never inlined as a literal. */
export const ARM = {
  /* 28deg. This is the figure's arm angle AND the angle every procedural sleeve
     is cut for - they are the same number by design, and the comment above about
     them never drifting apart is load-bearing. It sat at 0.28rad (16deg) for one
     revision while the body was posed at 28, which is why the sweatshirt and
     crop sleeves hung well inboard of the arms inside them. */
  out: 28 * Math.PI / 180,
  fwd: 0.05,
  originX: 0.315,
  originY: 0.92,
  rootR: 0.078,
  wristR: 0.062,
  length: 0.94
};
ARM.origin = (s) => new THREE.Vector3(s * ARM.originX, ARM.originY, 0);
ARM.dir = (s) => new THREE.Vector3(
  s * Math.sin(ARM.out), -Math.cos(ARM.out), Math.sin(ARM.fwd)
).normalize();
ARM.radius = (t) => ARM.rootR + (ARM.wristR - ARM.rootR) * t;

/* A snapshot of the authored landmarks, taken before anything can overwrite
   them. Garment specs are tuned against these heights, so remapping from here
   onto a supplied body is what lets those specs survive a body swap. */
const AUTHORED_Y = Object.assign({}, Y);
const REMAP = { from: [], to: [] };

/**
 * Replaces the body table with measurements taken off a supplied mesh.
 * Y and BODY_LEVELS are mutated in place rather than reassigned, because
 * garment.js holds references to both - mutating means every garment refits
 * with no further plumbing.
 */
export function applyDerivedBody(D) {
  Object.keys(D.Y).forEach((k) => { if (k in Y) Y[k] = D.Y[k]; });

  BODY_LEVELS.length = 0;
  D.levels.forEach((l) => BODY_LEVELS.push({ y: l.y, aX: l.aX, aZ: l.aZ, e: l.e }));
  BODY_LEVELS.sort((a, b) => a.y - b.y);

  if (D.arm && D.arm.originX != null && D.arm.out != null) {
    ARM.originX = D.arm.originX;
    ARM.originY = D.arm.originY;
    ARM.out = D.arm.out;
  }

  /* Piecewise map from authored heights to the supplied body's equivalents,
     anchored on the landmarks the two share. */
  const keys = ['ground', 'crotch', 'hip', 'waist', 'bust', 'armpit', 'shoulder', 'neckbase', 'headtop']
    .filter((k) => AUTHORED_Y[k] !== undefined && D.Y[k] !== undefined);
  REMAP.from = keys.map((k) => AUTHORED_Y[k]);
  REMAP.to = keys.map((k) => D.Y[k]);
}

/**
 * Converts a height authored against the procedural body into the equivalent
 * height on whatever body is currently loaded. Identity until a supplied body
 * has been measured.
 */
export function remapY(y) {
  const f = REMAP.from, t = REMAP.to;
  if (f.length < 2) return y;
  if (y <= f[0]) return t[0] + (y - f[0]);
  if (y >= f[f.length - 1]) return t[t.length - 1] + (y - f[f.length - 1]);
  for (let i = 1; i < f.length; i++) {
    if (y <= f[i]) {
      const k = (y - f[i - 1]) / (f[i] - f[i - 1] || 1);
      return t[i - 1] + (t[i] - t[i - 1]) * k;
    }
  }
  return y;
}

export function isBodyDerived() { return REMAP.from.length >= 2; }

/* theta 0 is +Z (front), +PI/2 is +X (the viewer's right). */
export function ringPoint(ring, theta, out) {
  out = out || new THREE.Vector3();
  const st = Math.sin(theta), ct = Math.cos(theta), k = 2 / ring.e;
  out.x = ring.aX * Math.sign(st) * Math.pow(Math.abs(st), k);
  out.z = ring.aZ * Math.sign(ct) * Math.pow(Math.abs(ct), k);
  return out;
}

export function bodyRingAt(y) {
  const L = BODY_LEVELS;
  if (y <= L[0].y) return { y, aX: L[0].aX, aZ: L[0].aZ, e: L[0].e };
  if (y >= L[L.length - 1].y) {
    const t = L[L.length - 1];
    return { y, aX: t.aX, aZ: t.aZ, e: t.e };
  }
  for (let i = 0; i < L.length - 1; i++) {
    if (y >= L[i].y && y <= L[i + 1].y) {
      const f = (y - L[i].y) / (L[i + 1].y - L[i].y);
      return {
        y,
        aX: L[i].aX + (L[i + 1].aX - L[i].aX) * f,
        aZ: L[i].aZ + (L[i + 1].aZ - L[i].aZ) * f,
        e:  L[i].e  + (L[i + 1].e  - L[i].e)  * f
      };
    }
  }
  return { y, aX: 0.2, aZ: 0.15, e: 2 };
}

/* Below the crotch the body splits into two legs, but a dress or a long tee
   hangs off the HIP and must not neck in to follow them. */
export function bodyRingForGarment(y) {
  return bodyRingAt(Math.max(y, Y.crotch));
}

/* ------------------------------------------------------------ mannequin ---- */

/* The figure is now ONE torso rather than four stacked bands.
 *
 * The bands existed so `applyBodyVisibility` could switch off whichever slab a
 * garment covered. That mechanism is retired (Aug 10 2026, at the owner's
 * instruction): every form of hiding - the band switches, the leg clipping
 * plane and the ray-derived alpha mask - was deleting real geometry and leaving
 * the figure in pieces, upper arms floating free of the shoulders. Nothing is
 * hidden now. The body simply intersects the clothing and is allowed to.
 *
 * What makes that safe is the material, not the geometry: the ghost is
 * transparent and depth-TESTED, so opaque cloth in front of it occludes it for
 * free. Where the body is inside a garment it is invisible because the garment
 * is drawn over it, and where it emerges - collar, sleeve, hem - it emerges as
 * a faint apparition rather than an opaque limb. Poke-through stops being a
 * defect to detect and becomes something you cannot see.
 *
 * Names are kept so that re-enabling `hides` degrades to a no-op instead of
 * hiding the wrong thing.
 */
export const BODY_PARTS = [
  'head', 'neck', 'torso',
  'armL_upper', 'armL_fore', 'handL',
  'armR_upper', 'armR_fore', 'handR',
  'legL', 'legR'
];

/* How far inside the garment shell the ghost is drawn. The clothing placement
   is correct and the body is what was wrong, so the body is fitted to the
   clothes rather than the other way round. Only the openings actually matter -
   collar, cuff, hem - since everything else is behind cloth. */
const SLIM = { torso: 0.93, arm: 0.88, leg: 0.80 };

/* The ghost's limb angles, ABSOLUTE, measured from vertical. Not offsets - set
   these to the angle you want the limb to sit at and that is where it goes.
   (They were deltas for one revision; owner then gave absolute figures, so the
   semantics changed with them. 28 and 13 are those figures.)

   They live HERE, on the body, and deliberately not in ARM or in the garment
   specs: the clothing placement is correct and the figure was what sat wrong
   inside it, so the figure is what moves. Nothing a garment is cut from
   changes, which is why editing these two numbers cannot shift a sleeve or a
   pant leg. */
export const POSE = {
  /* Reads ARM.out rather than repeating it: the sleeve and the arm inside it
     have to be the same angle, so there is one number and this is a view of it. */
  arm: ARM.out,
  leg: 10 * Math.PI / 180,   /* from vertical, pivoting at the hip */
  /* Where each leg is rooted, half the gap between them at the groin. This is
     an offset, not an angle, so it separates the tops without changing the
     lean. At the authored 0.118 the two legs were exactly tangent - each is
     0.148 * SLIM.leg = 0.118 in radius - so their inner walls met at x = 0 and
     the crotch read as one solid column. 0.145 opens about 0.054 between them,
     a little over an inch, which is a gap rather than a stance. */
  legHipX: 0.145
};

function lathe(y0, y1, rings, segs, material, shrink) {
  const pos = [], idx = [];
  const p = new THREE.Vector3();
  const k = shrink == null ? 1 : shrink;
  for (let i = 0; i < rings; i++) {
    const y = y0 + (y1 - y0) * (i / (rings - 1));
    const r0 = bodyRingAt(y);
    const r = { aX: r0.aX * k, aZ: r0.aZ * k, e: r0.e };
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      ringPoint(r, th, p);
      pos.push(p.x, y, p.z);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 2, d = a + segs + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/**
 * The angel: a holographic shell rather than a lit solid.
 *
 * Three properties are doing the work, and none of them is decoration.
 *
 * `transparent` with `depthWrite:false` puts the figure in the transparent
 * pass, drawn AFTER the clothing and still depth-tested against it. Cloth in
 * front therefore hides it with no mask, no ray cast and no per-triangle
 * bookkeeping - the depth buffer is the hidden surface removal, which is what
 * it was built to be.
 *
 * `AdditiveBlending` on a near-black studio means the form only ever adds
 * light. It cannot darken the garment it sits behind, so the worst case for a
 * limb that pushes through a sleeve is a faint glow on the fabric rather than a
 * lump of skin.
 *
 * The fresnel term - bright where the surface turns away from the eye - is what
 * reads as an apparition instead of a grey ghost. Both faces are drawn, so the
 * far wall shows through the near one and the volume glows from inside.
 */
export function ghostMaterial(opts) {
  opts = opts || {};
  return new THREE.ShaderMaterial({
    uniforms: {
      uCore:    { value: new THREE.Color(opts.core || 0xdfe6ea) },
      uRim:     { value: new THREE.Color(opts.rim || 0xffffff) },
      uOpacity: { value: opts.opacity == null ? 0.34 : opts.opacity }
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCore;
      uniform vec3 uRim;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        /* abs(), not the raw dot: back faces arrive with a flipped normal and
           without it the far wall of every limb goes black. */
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        vec3 c = mix(uCore, uRim, rim);
        /* THREE.Color linearises a hex on the way in, and a raw ShaderMaterial
           gets none of the renderer's output encode on the way out, so without
           this the ghost renders noticeably darker than the colour named above.
           An approximate sRGB encode is enough for an additive glow. */
        c = pow(max(c, 0.0), vec3(0.4545));
        gl_FragColor = vec4(c, uOpacity * (0.26 + 0.90 * rim));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

function limb(from, to, r0, r1, segs, material) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, false);
  const m = new THREE.Mesh(g, material);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return m;
}

/**
 * Builds the display form.
 * @returns {{ group: THREE.Group, parts: Map<string, THREE.Object3D>, material: THREE.Material }}
 */
export function buildMannequin(opts) {
  opts = opts || {};
  const group = new THREE.Group();
  const parts = new Map();

  const mat = opts.material || ghostMaterial(opts);

  /* Nothing casts or receives. A hologram that drops a solid shadow reads as a
     solid, and the contact shadow under the figure should be the CLOTHES'
     shadow - that is the silhouette the page is selling. */
  function add(name, mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = name;
    group.add(mesh);
    parts.set(name, mesh);
    return mesh;
  }

  /* Low poly throughout, and faceted on purpose: an angel built from flat
     planes catches the rim term edge by edge and reads as something rendered
     rather than something photographed. Segment counts here are the whole of
     the "low poly" instruction - keep them small. */
  const SEG = { ring: 14, limb: 7 };

  /* head: a faceted ovoid, no face, no features. Icosahedron rather than a
     UV sphere so there is no pole pinch and no seam for the rim to catch on. */
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.168, 1), mat);
  head.scale.set(1.0, 1.24, 1.06);
  head.position.y = 1.40;
  add('head', head);

  add('neck', limb(
    new THREE.Vector3(0, 1.00, 0), new THREE.Vector3(0, 1.21, 0),
    0.086, 0.070, SEG.limb, mat
  ));

  /* ONE torso, hip to collar, drawn inside the shirt rather than in bands that
     a garment used to switch off. Few rings: the superellipse profile carries
     the shape and extra rings only cost triangles. */
  add('torso', lathe(-0.46, Y.neckbase, 7, SEG.ring, mat, SLIM.torso));

  /* shoulder caps close the top of the torso and blend into the arms */
  [-1, 1].forEach((s) => {
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.082, 1), mat);
    cap.position.set(s * 0.262, 0.925, 0);
    cap.scale.set(1.15, 1.0, 1.0);
    add(s < 0 ? 'shoulderL' : 'shoulderR', cap);
  });

  [-1, 1].forEach((s) => {
    const tag = s < 0 ? 'L' : 'R';
    const o = ARM.origin(s);
    /* ARM.dir(s) rebuilt at the posed angle, rather than ARM.out itself being
       changed - that constant is read by the sleeve builder too. */
    const d = new THREE.Vector3(
      s * Math.sin(POSE.arm), -Math.cos(POSE.arm), Math.sin(ARM.fwd)
    ).normalize();
    const elbow = o.clone().addScaledVector(d, ARM.length * 0.52);
    const wrist = o.clone().addScaledVector(d, ARM.length);
    const r = (t) => ARM.radius(t) * SLIM.arm;
    add('arm' + tag + '_upper', limb(o, elbow, r(0), r(0.52), SEG.limb, mat));
    add('arm' + tag + '_fore',  limb(elbow, wrist, r(0.52), r(1), SEG.limb, mat));
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.076, 1), mat);
    hand.scale.set(0.8, 1.5, 0.55);
    hand.position.copy(wrist).addScaledVector(d, 0.07);
    add('hand' + tag, hand);
  });

  /* One tapering leg per side, hip to ankle, with no knee join and no foot.
     The foot was a box wedge that only ever existed to be hidden by a shoe, and
     the thigh/calf split showed as a seam wherever a hem crossed it. Shoes
     anchor at the ground on their own, so nothing needs a foot underneath. */
  [-1, 1].forEach((s) => {
    const tag = s < 0 ? 'L' : 'R';
    const hip = new THREE.Vector3(s * POSE.legHipX, -0.40, 0);
    const ank = new THREE.Vector3(s * 0.140, Y.ankle - 0.02, 0);
    /* Swing the whole leg about the hip as a rigid rod, so its length is
       unchanged and only its angle moves. The authored line leans about 1deg
       off vertical; POSE.leg replaces that angle outright. */
    const v = ank.clone().sub(hip);
    const len = v.length();
    ank.set(
      hip.x + s * len * Math.sin(POSE.leg),
      hip.y - len * Math.cos(POSE.leg),
      hip.z + v.z
    );
    add('leg' + tag, limb(
      hip, ank, 0.148 * SLIM.leg, 0.062 * SLIM.leg, SEG.limb, mat
    ));
  });

  return { group, parts, material: mat };
}


/**
 * RETIRED Aug 10 2026 - nothing calls this. Kept as the record of the approach.
 *
 * Applies the union of every worn garment's `hides` list, plus leg clipping
 * planes for hems that fall mid-thigh. It was replaced by not hiding anything:
 * the ghost body is transparent and depth-tested, so cloth occludes it without
 * any geometry being removed, and removing geometry is what left the figure in
 * disconnected pieces.
 *
 * The part names it reads - `chestUpper`, `hips`, `legL_thigh`, `footL` - no
 * longer exist on the mannequin, so re-enabling it as-is hides nothing. That is
 * deliberate: it fails to a working figure rather than a dismembered one. The
 * `hides` and `clipLegsAbove` fields are still in specs.js and are also unread.
 */
export function applyBodyVisibility(parts, legMaterial, wornSpecs) {
  const hidden = new Set();
  let legClip = null;

  for (const spec of wornSpecs) {
    if (!spec) continue;
    (spec.hides || []).forEach((p) => hidden.add(p));
    if (spec.clipLegsAbove != null) {
      legClip = legClip == null ? spec.clipLegsAbove : Math.max(legClip, spec.clipLegsAbove);
    }
  }

  for (const [name, mesh] of parts) {
    mesh.visible = !hidden.has(name);
  }

  /* max, so a crop top worn with pants does not clip more than the pants alone */
  legMaterial.clippingPlanes = legClip == null
    ? []
    : [new THREE.Plane(new THREE.Vector3(0, -1, 0), legClip + 0.04)];
}
