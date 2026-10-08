/* Changing Room - rigid props: caps, bucket hats, shoes, bags.
 *
 * These are the categories where AI image-to-3D actually works, because a cap,
 * a shoe and a bag genuinely ARE closed solid volumes - the watertight
 * limitation that makes generated garments useless costs nothing here.
 *
 * So each prop has two paths: load a GLB if one exists, otherwise build a
 * procedural stand-in. The page works either way, and dropping a generated
 * file into models/ upgrades it with no code change.
 *
 * The brand logo is projected on as a decal rather than baked into UVs,
 * which is what makes arbitrary generated topology acceptable.
 */

import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { Y, ARM, POSE } from './body.js?v=30';
import { makePropMaterial } from './materials.js?v=30';
import { ingest } from './ingest.js?v=30';
import { buildSlicer, decalProxy } from './slicer.js?v=30';
import * as MODELS from './models.js?v=30';

const glbCache = new Map();

/** Loads and normalises a supplied model once. Resolves null when the file is
 *  simply absent, which is the expected case for a blank with no model yet. */
export function loadProp(url, opts) {
  const key = url + JSON.stringify(opts || {});
  if (glbCache.has(key)) return glbCache.get(key);
  const p = ingest(url, opts).then((r) => (r.ok ? r : null));
  glbCache.set(key, p);
  return p;
}

/* Where the hand ends up, from the arm axis measured off the loaded body. A
   carried bag hangs here, and hardcoding it would put the bag in mid-air the
   moment the figure changes. */
function handPoint(side) {
  /* POSE.arm, not ARM.out. ARM.out is the angle the SLEEVE is cut for and has
     to stay where it is; POSE.arm is where the figure's arm actually sits, and
     a carried bag hangs from the hand, not from the sleeve. They were the same
     number until the arms were posed out to 28deg, at which point the bag kept
     hanging at the old 16deg wrist - about 0.18 inboard of the hand holding it,
     which reads as the bag sitting against the model's hip. */
  const d = new THREE.Vector3(
    side * Math.sin(POSE.arm), -Math.cos(POSE.arm), Math.sin(ARM.fwd)
  ).normalize();
  const p = ARM.origin(side).addScaledVector(d, ARM.length);
  /* The slicer derives the arm's origin and angle but not its length, so this
     is an estimate. Clamp it to where a hanging wrist can actually be, rather
     than let a bad measurement throw the bag across the room. The outer bound
     has to clear the posed wrist or the clamp silently undoes the pose. */
  p.y = Math.min(Math.max(p.y, Y.crotch - 0.10), Y.waist + 0.10);
  p.x = side * Math.min(Math.max(Math.abs(p.x), 0.26), 0.90);
  return p;
}

/* ------------------------------------------------------- procedural ------ */

function capGeometry(peak) {
  const parts = [];

  const crown = new THREE.SphereGeometry(0.196, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
  crown.scale(1.0, 0.88, 1.06);
  parts.push(crown);

  /* the button on top */
  const btn = new THREE.SphereGeometry(0.018, 12, 8);
  btn.translate(0, 0.168, 0);
  parts.push(btn);

  /* a slight sweatband flare so the crown does not end in a raw circle */
  const band = new THREE.CylinderGeometry(0.199, 0.203, 0.030, 32, 1, true);
  band.translate(0, -0.014, 0);
  parts.push(band);

  /* the peak: a shallow curved wedge pointing forward, which is the part a
     flat-lay photo can never give you because in the photo it hangs down */
  const seg = 24;
  const pos = [], idx = [], uv = [];
  for (let r = 0; r <= 1; r++) {
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = (-0.62 + 1.24 * t) * Math.PI * 0.5;
      const rad = r === 0 ? 0.196 : 0.196 + peak;
      const x = Math.sin(a) * rad * (r === 0 ? 1 : 0.94);
      const z = Math.cos(a) * rad;
      const dip = r === 0 ? 0 : -0.030 - 0.020 * Math.cos(a);
      pos.push(x, -0.010 + dip, z);
      uv.push(t, r);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i, b = i + 1, c = i + seg + 2, d = i + seg + 1;
    idx.push(a, b, c, a, c, d);
  }
  const brim = new THREE.BufferGeometry();
  brim.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  brim.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  brim.setIndex(idx);
  brim.computeVertexNormals();
  parts.push(brim);

  return mergeGeoms(parts);
}

function bucketGeometry(brimW, droop) {
  const parts = [];
  const crown = new THREE.CylinderGeometry(0.196, 0.190, 0.150, 32, 1, true);
  crown.translate(0, 0.075, 0);
  parts.push(crown);

  const top = new THREE.SphereGeometry(0.196, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  top.scale(1, 0.42, 1);
  top.translate(0, 0.150, 0);
  parts.push(top);

  const seg = 36;
  const pos = [], idx = [], uv = [];
  for (let r = 0; r <= 1; r++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rad = r === 0 ? 0.190 : 0.190 + brimW;
      pos.push(Math.sin(a) * rad, r === 0 ? 0 : -droop, Math.cos(a) * rad);
      uv.push(i / seg, r);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i, b = i + 1, c = i + seg + 2, d = i + seg + 1;
    idx.push(a, b, c, a, c, d);
  }
  const brim = new THREE.BufferGeometry();
  brim.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  brim.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  brim.setIndex(idx);
  brim.computeVertexNormals();
  parts.push(brim);

  return mergeGeoms(parts);
}

/* A high top, built around the ankle rather than the floor. v1 anchored shoes
   at ground level, which drove the sole up into the leg on anything with a
   heel - that is the bug this fixes. */
function shoeGeometry() {
  const parts = [];

  const sole = new THREE.BoxGeometry(0.108, 0.036, 0.272);
  sole.translate(0, -0.122, 0.030);
  parts.push(sole);

  const foot = new THREE.BoxGeometry(0.100, 0.078, 0.250);
  foot.translate(0, -0.070, 0.026);
  parts.push(foot);

  const toe = new THREE.SphereGeometry(0.052, 18, 14);
  toe.scale(0.96, 0.72, 1.15);
  toe.translate(0, -0.084, 0.126);
  parts.push(toe);

  const collar = new THREE.CylinderGeometry(0.056, 0.050, 0.150, 20, 1, true);
  collar.translate(0, 0.028, -0.048);
  parts.push(collar);

  const heel = new THREE.SphereGeometry(0.050, 16, 12);
  heel.scale(1.0, 1.05, 0.86);
  heel.translate(0, -0.058, -0.086);
  parts.push(heel);

  return mergeGeoms(parts);
}

function bagGeometry(kind) {
  const parts = [];
  if (kind === 'crossbody') {
    const body = new THREE.BoxGeometry(0.185, 0.140, 0.070);
    body.translate(0, -0.180, 0);
    parts.push(body);
    const flap = new THREE.BoxGeometry(0.190, 0.070, 0.076);
    flap.translate(0, -0.118, 0.004);
    parts.push(flap);
  } else {
    const body = new THREE.BoxGeometry(0.230, 0.255, 0.078);
    body.translate(0, -0.210, 0);
    parts.push(body);
  }
  const strap = new THREE.TorusGeometry(0.145, 0.010, 8, 28, Math.PI);
  strap.rotateZ(Math.PI);
  strap.translate(0, -0.070, 0);
  parts.push(strap);
  return mergeGeoms(parts);
}

function mergeGeoms(list) {
  let total = 0, idxTotal = 0;
  list.forEach((g) => {
    if (!g.index) {
      const n = g.attributes.position.count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    total += g.attributes.position.count;
    idxTotal += g.index.count;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = new Uint32Array(idxTotal);
  let vo = 0, io = 0;
  list.forEach((g) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array;
    const nn = g.attributes.normal.array;
    pos.set(p, vo * 3);
    nor.set(nn, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * A supplied material that keeps its own texture instead of being replaced by
 * the flat procedural fabric colour - for shoes and pants, where the texture
 * (denim weave, rubber, canvas) is the material and cannot be reproduced by a
 * tint alone.
 *
 * `color` still applies - three.js multiplies it with the texture per pixel,
 * which is what lets a denim colourway shift the same weave toward black or
 * indigo without a second texture.
 *
 * metalness and roughness are overridden rather than kept. The source files
 * carry metallicFactor:1, roughnessFactor:1 - a fully metallic surface, which
 * is almost certainly an exporter default rather than an authored choice, and
 * it reads as flat grey under any lighting that is not a reflective studio HDRI:
 * a metal surface's colour comes from environment reflection, not its base
 * colour texture, so with a dim environment the fabric pattern barely shows.
 */
export function tintTextured(srcMat, colour) {
  if (!srcMat || !srcMat.map) return srcMat || makePropMaterial(colour);
  const m = new THREE.MeshStandardMaterial({
    map: srcMat.map,
    color: colour != null ? colour : 0xffffff,
    metalness: 0,
    roughness: 0.92,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide
  });
  m.map.colorSpace = THREE.SRGBColorSpace;
  return m;
}

/* ------------------------------------------------------------- build ----- */

/**
 * @param {object} propSpec from specs.js PROPS
 * @param {number} colour fabric colour for this colourway
 * @returns {Promise<THREE.Group>}
 */
/** @param {object} [sideArt] {left, right} canvases, for props printed on the
 *                            side rather than the front. Shoes only. */
export async function buildProp(propSpec, colour, printCanvas, propKey, sideArt) {
  /* A supplied model, if one exists for this blank. It arrives already scaled,
     oriented and anchored by ingest, so it needs no further placement. */
  const entry = propKey && MODELS.PROPS[propKey];

  const group = new THREE.Group();
  /* `tint` overrides the colourway sampled off the product photo. The canvas
     shoe is authored black and carries its design as side artwork, so sampling
     the photo's dominant colour gives white and washes the whole shoe out. */
  const mat = makePropMaterial(entry && entry.tint != null ? entry.tint : colour);
  /* Anchor off the measured body rather than the manifest's literals, so a
     hat still sits on the head after the figure is swapped. */
  const hand = handPoint(1);
  const fit = entry && Object.assign({}, entry, (
      entry.anchorMode === 'top'    ? { anchorY: Y.headtop + 0.045 }
    : entry.anchorMode === 'bottom' ? { anchorY: Y.ground }
    : entry.anchorMode === 'hand'   ? { anchorMode: 'top', anchorY: hand.y + 0.03 }
    : entry.anchorMode === 'centre' ? { anchorY: Y.bust - 0.22 }
    : {}));
  const supplied = entry ? await loadProp(MODELS.MODEL_DIR + entry.file, fit) : null;

  if (supplied) {
    const inst = supplied.object.clone(true);
    inst.traverse((o) => {
      if (!o.isMesh) return;
      o.material = entry.textured ? tintTextured(o.material, colour) : mat;
      o.castShadow = true; o.receiveShadow = true;
    });
    /* A carried bag hangs from the hand, so it follows the arm rather than a
       fixed offset - the arm angle is measured off the body and changes when
       the figure does. */
    if (entry.anchorMode === 'hand') {
      inst.position.x += hand.x - (entry.sideInset || 0);
      inst.position.z += hand.z;
      inst.rotation.y = 0.24;
    } else if (entry.side) {
      inst.position.x += entry.side;
      inst.rotation.y = 0.24;
    }
    if (entry.zOff) inst.position.z += entry.zOff;
    if (entry.yOff) inst.position.y += entry.yOff;
    group.add(inst);

    if (entry.wrap === 'planar' && printCanvas) {
      /* Whole photo across the shell, not a patch on the front of it - the
         same treatment the pants get, and for the same reason: on an all-over
         print a small front decal reads as a pale blob rather than the design.
         Done after the placement nudges above, because the wrap's UVs are
         computed from the shell's world bounding box. */
      if (!applyWrappedTexture(inst, printCanvas, colour)) {
        console.warn('[changing room] wrap failed for prop', propKey);
      }
    } else if (propSpec.kind === 'shoe' && sideArt) {
      /* Shoes are the one prop with artwork on BOTH flanks, not the front. Four
         decals: outer (lateral) and inner (medial) face, per foot. Nothing was
         projected here at all before this was built - the kind lookup below
         resolves to null for a shoe - which is why they were plain.
         The pair is a single merged mesh, so the projector's depth/reach is
         what keeps each decal on its own shoe rather than bleeding onto the
         other one; see the 'x' vs 'x-in' branches in projectDecal. */
      const outer = sideArt.outer || {};
      const inner = sideArt.inner || {};
      if (outer.right) projectDecal(group, inst, outer.right,
        Object.assign({}, MODELS.DECAL.shoe, { side: 1 }));
      if (outer.left) projectDecal(group, inst, outer.left,
        Object.assign({}, MODELS.DECAL.shoe, { side: -1 }));
      if (inner.right) projectDecal(group, inst, inner.right,
        Object.assign({}, MODELS.DECAL.shoeInner, { side: 1 }));
      if (inner.left) projectDecal(group, inst, inner.left,
        Object.assign({}, MODELS.DECAL.shoeInner, { side: -1 }));
    } else if (printCanvas) {
      const kind = propSpec.kind === 'bucket' ? 'bucket'
                 : propSpec.kind === 'cap' ? 'cap'
                 : propSpec.kind === 'bag' ? 'bag' : null;
      if (kind) projectDecal(group, inst, printCanvas, MODELS.DECAL[kind]);
    }
    return group;
  }

  /* procedural stand-in */
  let geo;
  switch (propSpec.kind) {
    case 'cap':    geo = capGeometry(0.086); break;
    case 'bucket': geo = bucketGeometry(0.088, 0.052); break;
    case 'shoe':   geo = shoeGeometry(); break;
    default:       geo = bagGeometry(propSpec.bagKind || 'tote'); break;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  place(mesh, propSpec, group, mat, printCanvas);
  return group;
}

function place(obj, spec, group, mat, printCanvas) {
  const s = spec.scale || 1;

  if (spec.kind === 'shoe') {
    /* one model, mirrored, anchored at the ankle and toed out slightly */
    [-1, 1].forEach((side) => {
      const m = obj.clone(true);
      m.scale.set(s * (side < 0 ? -1 : 1), s, s);
      m.position.set(side * 0.140, spec.anchorY, 0.0);
      m.rotation.y = side * 0.085;
      group.add(m);
    });
    return;
  }

  obj.scale.setScalar(s);
  if (spec.kind === 'bag') {
    obj.position.set(0.30, spec.anchorY, 0.06);
    obj.rotation.z = -0.16;
    obj.rotation.y = 0.22;
  } else {
    obj.position.set(0, spec.anchorY, 0);
  }
  group.add(obj);

  if (printCanvas && (spec.kind === 'cap' || spec.kind === 'bucket')) {
    addLogoDecal(obj, mat, printCanvas, spec);
  }
}

/**
 * Projects a graphic onto the front of a model, whatever its UVs are.
 *
 * Two things this has to get right, and the previous version got both wrong:
 *
 * 1. DecalGeometry reads the target's vertices through matrixWorld and returns
 *    WORLD-space geometry. Passing a local-space projector position therefore
 *    puts the box nowhere near the model, zero triangles survive clipping, and
 *    the result is an empty mesh - which throws no error, so a try/catch never
 *    notices. Build the position in world space, then bring the output back
 *    into the parent's frame.
 * 2. DecalGeometry does no backface culling at all, so a deep projector box
 *    also stamps the print on the far side. Feeding it a pre-filtered,
 *    front-facing proxy fixes that and makes it far faster on a dense mesh.
 */
/**
 * Wraps a whole product photo around a supplied shell, rather than stamping a
 * chest-sized decal on the front of it.
 *
 * This is the supplied-model equivalent of what the atlas does for procedural
 * garments, and it exists because those two were producing visibly different
 * results from the same artwork: a jersey (procedural + atlas) gets its design
 * painted across the entire garment surface, while a supplied shell got a
 * small patch projected onto its chest. On an all-over print - the wide leg
 * pants especially - that reads as a mostly-blank garment with a sticker on
 * it.
 *
 * Planar projection down -Z, computed from the shell's own world bounding box,
 * so u/v track the flat-lay photo the artwork came from. Front and back both
 * receive the image, which for an all-over pattern is correct and for a
 * one-sided print is a reasonable approximation of a garment printed both
 * sides. UVs are written in the mesh's LOCAL space via its inverse world
 * matrix, because these shells carry a baked node rotation and a non-uniform
 * ingest scale; sampling world position per vertex and normalising against the
 * world box is what keeps the mapping upright regardless of either.
 *
 * @param {THREE.Object3D} node   the ingested shell
 * @param {HTMLCanvasElement} canvas  artwork, already background-stripped
 * @param {number} tint           fabric colour, multiplied under the artwork
 */
/**
 * Tile a seamless swatch across a whole shell, instead of stretching one photo
 * over it the way applyWrappedTexture does.
 *
 * This exists because an all-over CAMO is a repeating pattern, not a graphic.
 * Wrapping the product photo maps the mockup - pants, white studio background
 * and all - across the bounding box exactly once, so the camo arrives at
 * roughly a third of its real scale, only over the part of the box the garment
 * actually occupies, and the colourway differences read as a vague change of
 * tone rather than three distinct camos. Feeding the supplied tileable swatch
 * through RepeatWrapping instead puts the pattern on at its own scale and
 * covers every triangle, front and back, seams included.
 *
 * UV construction is deliberately the SAME box-normalised projection
 * applyWrappedTexture uses (see the note there about local space and baked
 * ingest transforms) - only the repeat multiplier and the wrap mode differ, so
 * the two paths cannot drift apart. `repeat` is in tiles across the shell's
 * own height; X is derived from it so the tile stays square rather than
 * stretching on a wide garment.
 *
 * @param {THREE.Object3D} node       the ingested shell
 * @param {HTMLImageElement} img      seamless swatch
 * @param {number} repeat             tiles across the shell's height
 */
export function applyTiledTexture(node, img, repeat) {
  if (!img) return false;
  node.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(node);
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 1e-6 || size.y < 1e-6) return false;

  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  const tilesY = repeat || 3;
  /* square tiles: as many across the width as its share of the height */
  const tilesX = Math.max(1, tilesY * (size.x / size.y));

  const v = new THREE.Vector3();
  node.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      uv[i * 2]     = ((v.x - box.min.x) / size.x) * tilesX;
      uv[i * 2 + 1] = ((v.y - box.min.y) / size.y) * tilesY;
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.material = new THREE.MeshStandardMaterial({
      map: tex,
      /* neutral - the swatch carries its own colour, and multiplying a
         colourway tint into a camo would shift every one of its hues */
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0,
      envMapIntensity: 0.42,
      side: THREE.DoubleSide,
      dithering: true
    });
  });
  return true;
}

export function applyWrappedTexture(node, canvas, tint) {
  if (!canvas) return false;
  node.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(node);
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 1e-6 || size.y < 1e-6) return false;

  /* FLATTEN ONTO OPAQUE FABRIC FIRST. The artwork arrives from
     silhouettePatch with its studio background stripped to transparent, and
     this material does not read alpha - so every transparent pixel sampled as
     RGB (0,0,0), i.e. BLACK. On the pants that showed as a black wedge down
     each outer seam, where the planar projection runs off the edge of the
     garment silhouette and into the cleared corners of the crop.
     Baking the colourway underneath is also what the procedural atlas does
     (see buildGarmentAtlas), so the two paths now agree: colour is in the
     texture, and the material's own colour stays neutral rather than
     multiplying the tint in a second time. */
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const fx = flat.getContext('2d');
  fx.fillStyle = '#' + ('000000' + ((tint != null ? tint : 0xffffff) >>> 0).toString(16)).slice(-6);
  fx.fillRect(0, 0, flat.width, flat.height);
  fx.drawImage(canvas, 0, 0);

  const tex = new THREE.CanvasTexture(flat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;

  const v = new THREE.Vector3();
  node.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      uv[i * 2] = (v.x - box.min.x) / size.x;
      /* v runs bottom-up; CanvasTexture's default flipY already accounts for
         the canvas being top-down, so this lands the photo's hem at the hem. */
      uv[i * 2 + 1] = (v.y - box.min.y) / size.y;
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.material = new THREE.MeshStandardMaterial({
      map: tex,
      /* neutral: the colourway is already baked into `flat` above */
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0,
      envMapIntensity: 0.42,
      side: THREE.DoubleSide,
      dithering: true
    });
  });
  return true;
}

export function projectDecal(parent, target, canvas, cfg) {
  if (!cfg) return null;
  target.updateMatrixWorld(true);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const decalMat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.72, metalness: 0
  });

  const aspect = canvas.height / Math.max(1, canvas.width);
  const box = new THREE.Box3().setFromObject(target);
  const centre = box.getCenter(new THREE.Vector3());
  const h = box.max.y - box.min.y;
  const zSpan = box.max.z - box.min.z;

  /* Projector axis. 'z' is the default front projection, used by every garment
     and cap. 'x' and 'x-in' project along the shoe's own width axis - 'x' from
     outside in (the lateral/outer face), 'x-in' from the gap between the shoes
     outward (the medial/inner face) - which is what a shoe needs, since its
     artwork sits on the side panel and a front projection puts it on the toe
     box. `side` is +1 for the viewer's right, -1 for the left.

     BUG, fixed same day it shipped: this used to test `=== 'x'` only, so
     'x-in' silently fell through to the 'z' default everywhere below - not
     just in the branch that sets pos/forward, but in the fill/size
     computation above it too. The inner shoe decal's box ended up sized off
     the WHOLE shell's width (fill * ~0.97) fronting the toe, not the narrow
     gap it was meant to sit in - it never reached the 'x-in' logic at all. */
  const axis = cfg.axis === 'x-in' ? 'x-in' : (cfg.axis === 'x' ? 'x' : 'z');
  const side = cfg.side < 0 ? -1 : 1;

  /* Decal box in the projector's own frame: local X across, Y up, Z into the
     surface. `fill` sizes it from the target's own bounding box, which a shoe
     wants because its side panel IS the whole shoe; `size` gives literal
     dimensions, which a chest print wants because it must not grow with the
     garment.

     The literal path fits the canvas INSIDE size[0] x size[1] preserving
     aspect. It used to take size[0] as the width and derive the height from the
     aspect alone, ignoring size[1] entirely - so a tall print grew a tall box
     that ran off the top of the shell, and the part with no surface under it
     simply did not project. That is the tee graphics with their tops chopped,
     and the tonal fallback whose crop is taller still, which is why one of them
     showed only its bottom line of text. */
  let bw, bh;
  if (cfg.fill) {
    bw = (axis === 'x' || axis === 'x-in' ? zSpan : box.max.x - box.min.x) * cfg.fill;
    bh = h * cfg.fill;
  } else {
    bw = cfg.size[0];
    bh = bw * aspect;
    const maxH = cfg.size[1] != null ? cfg.size[1] : bh;
    if (bh > maxH) { bh = maxH; bw = bh / Math.max(1e-6, aspect); }
  }
  const size = new THREE.Vector3(bw, bh, cfg.size ? cfg.size[2] : (cfg.depth || 0.2));

  /* `yFrac` places the print as a fraction of the target's own height, 0 at the
     hem and 1 at the collar. An absolute offset from the midpoint - which is
     what this used to be - only holds for the one garment length it was tuned
     against: stretch the shell to fit a taller body and the print climbs off
     the top of it, which is why only the bottom edge was landing. */
  const py = cfg.yFrac != null ? box.min.y + h * cfg.yFrac
                               : box.min.y + h * 0.5 + (cfg.pos ? cfg.pos[1] : 0);

  let pos, forward, euler, half, origin = null;
  if (axis === 'x' || axis === 'x-in') {
    /* 'x' looks in from OUTSIDE the pair (the lateral face, box.max/min.x -
       genuinely the outer edge of a two-shoe merged mesh). 'x-in' is the new
       one: the MEDIAL face, which sits in the GAP BETWEEN the shoes, so
       box.min/max.x is the wrong shoe entirely - that is the other foot's
       outer edge, not this foot's inner one. There is no bounding-box shortcut
       for "this foot's own inner edge" on a merged mesh, so the projector
       position for 'x-in' is a literal, `cfg.innerX`, tuned against the
       shipped mesh rather than derived. */
    const inner = axis === 'x-in';
    const px = inner
      ? side * (cfg.innerX != null ? cfg.innerX : 0.05)
      : (side > 0 ? box.max.x : box.min.x) + side * 0.02;
    pos = new THREE.Vector3(px, py, centre.z + (cfg.zOff || 0));
    /* Outer face normal points away from the shoe's own bulk, i.e. away from
       the pair's centreline - forward has to point the OTHER way (into the
       shoe) to be kept by decalProxy's facing test, hence -side. The medial
       face's normal points the opposite way again (toward the centreline, out
       of the gap), so its forward flips back to +side. */
    forward = new THREE.Vector3(inner ? side : -side, 0, 0);
    /* euler's local Z axis has to equal -forward for the same reason it does
       in the outer case (see the comment there) - deriving it from `forward`
       directly, via -forward's own angle from +Z, rather than hand-keeping two
       separate sign tables in sync. */
    const zSign = inner ? -side : side;
    euler = new THREE.Euler(0, zSign * Math.PI / 2, 0);
    /* decalProxy's box is world-axis-aligned, so the local extents swap: the
       decal's depth runs along world X and its width along world Z. */
    half = new THREE.Vector3(size.z / 2, size.y / 2, size.x / 2);
    if (inner) {
      /* THIS shoe's own centre, not the merged pair's. decalProxy orients
         normals away from the point it is given, and the pair's centroid sits
         between the two shoes - so relative to it, a medial face reads as
         pointing "inward" and gets flipped to face outward, then culled. From
         this shoe's own centre the medial face correctly reads as outward and
         survives. Midpoint of the shoe's own span: its inner wall is at
         roughly cfg.innerX, its outer at the pair bbox edge. */
      const outerX = side > 0 ? box.max.x : box.min.x;
      origin = new THREE.Vector3(
        (px + outerX) / 2, centre.y, centre.z
      );
    }
  } else {
    pos = new THREE.Vector3(centre.x + (cfg.pos ? cfg.pos[0] : 0), py, box.max.z + 0.02);
    forward = new THREE.Vector3(0, 0, -1);
    euler = new THREE.Euler(0, 0, 0);
    half = size.clone().multiplyScalar(0.5);
  }

  const S = buildSlicer(target, 128);
  if (!S) { tex.dispose(); decalMat.dispose(); return null; }
  const proxy = decalProxy(S, pos, half, forward, origin);
  if (!proxy) { tex.dispose(); decalMat.dispose(); return null; }

  let geo;
  try {
    geo = new DecalGeometry(proxy, pos, euler, size);
  } catch (e) {
    tex.dispose(); decalMat.dispose();
    return null;
  }
  proxy.geometry.dispose();

  /* An empty decal is the classic silent failure, so say so rather than
     quietly rendering nothing. */
  if (!geo.attributes.position || geo.attributes.position.count === 0) {
    console.warn('[changing room] decal projected onto nothing - check DECAL placement in models.js');
    geo.dispose(); tex.dispose(); decalMat.dispose();
    return null;
  }

  parent.updateMatrixWorld(true);
  geo.applyMatrix4(new THREE.Matrix4().copy(parent.matrixWorld).invert());
  const mesh = new THREE.Mesh(geo, decalMat);
  parent.add(mesh);
  return mesh;
}
