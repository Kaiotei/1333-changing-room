/* Changing Room - loading and normalising supplied GLB models.
 *
 * Supplied models arrive at arbitrary scale, position and orientation. Meshy
 * centres on the bounding box; Hunyuan3D writes whatever frame the generator
 * produced, through trimesh, with no exporter-side correction at all. So
 * nothing about a supplied file may be assumed - it is measured.
 *
 * Everything is normalised into a wrapper Group rather than baked into the
 * geometry. Baking is destructive, breaks re-normalisation, desynchronises a
 * skinned mesh from its bind matrix, and has one sharp edge: three.js flips
 * gl.frontFace for a negative-determinant matrix, which is the only reason the
 * mirrored left shoe renders correctly. Bake that -1 in and it turns inside out.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const CDN = 'https://unpkg.com/three@0.185.1/';

let loader = null;
function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  /* Meshy's compressed export can emit either of these, so both are wired up
     front - a missing decoder otherwise fails as an unexplained parse error. */
  const draco = new DRACOLoader().setDecoderPath(CDN + 'examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * @returns {Promise<{ok:boolean, root?:THREE.Object3D, gltf?:object, reason?:string, missing?:boolean}>}
 */
export function loadGLB(url) {
  return new Promise((resolve) => {
    getLoader().load(
      url,
      (gltf) => {
        const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!root) { resolve({ ok: false, reason: 'glb contains no scene' }); return; }
        resolve({ ok: true, root, gltf });
      },
      undefined,
      (err) => {
        /* A 404 is expected while a model has not been supplied yet, and falls
           back silently. Anything else is a real failure and must be surfaced -
           swallowing every error is how a broken mannequin looks like a missing
           one. */
        const msg = (err && (err.message || String(err))) || 'unknown error';
        const missing = /404|not found|failed to load/i.test(msg);
        if (!missing) console.error('[changing room] failed to load ' + url + ': ' + msg);
        resolve({ ok: false, reason: msg, missing });
      }
    );
  });
}

/** Drops anything that is not renderable geometry and repairs what is. */
export function sanitise(root) {
  const notes = [];
  const drop = [];
  let meshes = 0, tris = 0, noNormal = 0, noUV = 0;

  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      const g = o.geometry;
      if (!g || !g.attributes.position) { drop.push(o); return; }
      meshes++;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      /* GLTFLoader never computes these. A primitive with no NORMAL accessor
         renders flat black under a PBR material and produces normal-less
         decals. */
      if (!g.attributes.normal) { g.computeVertexNormals(); noNormal++; }
      if (!g.attributes.uv) noUV++;
    } else if (o.isLight || o.isCamera || o.isPoints || o.isLine) {
      drop.push(o);
    }
  });

  drop.forEach((o) => o.parent && o.parent.remove(o));
  if (noNormal) notes.push(noNormal + ' mesh(es) had no normals; computed them');
  if (noUV) notes.push(noUV + ' mesh(es) have no UVs (fine, prints project as decals)');
  if (drop.length) notes.push('dropped ' + drop.length + ' non-mesh node(s)');
  return { meshes, tris: Math.round(tris), notes };
}

/**
 * A world-space bounding box that is actually correct.
 *
 * Box3.setFromObject has three traps here: it does not update ancestors, it
 * ignores object.visible, and its default path transforms the geometry's AABB
 * rather than the vertices, which over-reports any node carrying a baked
 * rotation. `precise` fixes the last one for static meshes but is WRONG for
 * skinned ones, where it reads the bind pose and ignores skinning entirely.
 */
export function measure(root) {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().makeEmpty();
  const tmp = new THREE.Box3();
  const v = new THREE.Vector3();

  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.isSkinnedMesh) {
      if (!o.boundingBox) o.computeBoundingBox();
      box.union(tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld));
    } else {
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      }
    }
  });
  return box;
}

/**
 * Guesses the up axis from proportions. Returns null when it cannot tell,
 * which is the honest answer for anything that is not clearly elongated.
 *
 * Note that a glTF with a baked -90deg X rotation on its root (the Blender and
 * Sketchfab pattern) is ALREADY visually Y-up. Measure first; do not re-rotate
 * on the strength of a node name.
 */
export function detectUp(box) {
  const s = box.getSize(new THREE.Vector3());
  const dims = [['x', s.x], ['y', s.y], ['z', s.z]].sort((a, b) => b[1] - a[1]);
  if (dims[0][1] < dims[1][1] * 1.5) return null;   /* too square to call */
  return dims[0][0];
}

/**
 * Wraps a supplied model in a Group, uniformly scaled and re-origined.
 *
 * @param {object} opts
 *   targetHeight  scale so the model's Y extent equals this (omit to keep scale)
 *   widthMul      extra scale on the horizontal axes, on top of the uniform
 *                 fit. A number does both; [x, z] sets them separately.
 *   spreadX       for a mirrored pair merged into one mesh: move each half out
 *                 by this much, in final world units. See spreadPair().
 *   anchorY       world Y the model's BOTTOM should sit at
 *   anchorMode    'bottom' (feet on ground) | 'centre' | 'top'
 *   upAxis        force 'x' | 'y' | 'z'; omit to auto-detect
 *   yaw           extra Y rotation in radians
 *
 * `widthMul` exists because a garment has two independent fits and one uniform
 * scale cannot serve both. Length is set by where the hem should land; girth is
 * set by the body it has to go around. Shortening a supplied pants shell to
 * crop it also narrowed it by the same factor, and once the shell is narrower
 * than the leg there is nothing left for hidden surface removal to work with -
 * masking can only hide skin that has cloth on the far side of it. Every
 * dress-up system separates the two for this reason.
 */
export function normalise(root, opts) {
  opts = opts || {};
  const notes = [];
  const wrap = new THREE.Group();
  wrap.add(root);

  let box = measure(wrap);
  if (box.isEmpty()) return { wrap, box, notes: ['model has no measurable geometry'] };

  const up = opts.upAxis || detectUp(box);
  if (up === 'z') { root.rotateX(-Math.PI / 2); notes.push('rotated from Z-up'); }
  else if (up === 'x') { root.rotateZ(Math.PI / 2); notes.push('rotated from X-up'); }
  if (opts.yaw) root.rotateY(opts.yaw);

  wrap.updateMatrixWorld(true);
  box = measure(wrap);

  /* A number widens both horizontal axes; [x, z] separates them, which is what
     a matched pair of shoes needs - the two are one mesh centred between them,
     so scaling X moves them apart and scaling Z would only make them longer. */
  const w = opts.widthMul || 1;
  const wx = Array.isArray(w) ? w[0] : w;
  const wz = Array.isArray(w) ? w[1] : w;

  let scale = 1;
  if (opts.targetHeight) {
    const h = box.getSize(new THREE.Vector3()).y || 1;
    scale = opts.targetHeight / h;
    /* Y stays on the uniform scale so targetHeight still means what it says;
       only the two horizontal axes carry the girth adjustment. */
    wrap.scale.set(scale * wx, scale, scale * wz);
    wrap.updateMatrixWorld(true);
    box = measure(wrap);
  } else if (wx !== 1 || wz !== 1) {
    wrap.scale.set(wx, 1, wz);
    wrap.updateMatrixWorld(true);
    box = measure(wrap);
  }

  const c = box.getCenter(new THREE.Vector3());
  wrap.position.x -= c.x;
  wrap.position.z -= c.z;
  const mode = opts.anchorMode || 'bottom';
  const anchorY = opts.anchorY != null ? opts.anchorY : 0;
  if (mode === 'bottom') wrap.position.y += anchorY - box.min.y;
  else if (mode === 'top') wrap.position.y += anchorY - box.max.y;
  else wrap.position.y += anchorY - c.y;

  wrap.updateMatrixWorld(true);
  return { wrap, box: measure(wrap), scale, up, notes };
}

/**
 * Pulls the two halves of a mirrored pair apart, without resizing either.
 *
 * A matched pair of shoes ships as ONE merged mesh with a single primitive, so
 * there is no node to move and `widthMul` was the only lever available - but
 * scaling X to widen the stance stretches each shoe by the same factor, and
 * getting the shoes out under the legs needed 27%, which is a visibly wider
 * shoe. This moves instead of scaling: every vertex on the +X side goes out by
 * `dx` and every vertex on the -X side by the same amount inward. Shape is
 * untouched, only the gap changes.
 *
 * Safe here because the halves are genuinely disjoint about x = 0 - the inner
 * edges sit 0.15 either side of it - so the sign of a vertex's world X says
 * which shoe it belongs to with no ambiguity.
 *
 * The offset is computed in WORLD space and pushed back through the mesh's
 * inverse, because these files carry a baked +90deg X node rotation and writing
 * `dx` straight onto the local X attribute would be right only by accident.
 */
export function spreadPair(root, dx) {
  if (!dx) return;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    inv.copy(o.matrixWorld).invert();
    /* a local-space vector equivalent to (dx,0,0) in world space */
    a.set(0, 0, 0).applyMatrix4(inv);
    b.set(dx, 0, 0).applyMatrix4(inv);
    b.sub(a);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const side = v.clone().applyMatrix4(o.matrixWorld).x >= 0 ? 1 : -1;
      pos.setXYZ(i, v.x + b.x * side, v.y + b.y * side, v.z + b.z * side);
    }
    pos.needsUpdate = true;
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
}

/** Load + sanitise + normalise, with a full report for the inspector. */
export async function ingest(url, opts) {
  const res = await loadGLB(url);
  if (!res.ok) return { ok: false, url, reason: res.reason, missing: res.missing };

  const san = sanitise(res.root);
  const raw = measure(res.root);
  const rawSize = raw.getSize(new THREE.Vector3());

  let skinned = false;
  res.root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });

  const norm = normalise(res.root, opts);
  /* After normalising, so `spreadX` is in final world units and does not get
     multiplied by the fit scale. */
  if (opts && opts.spreadX) spreadPair(norm.wrap, opts.spreadX);
  const size = measure(norm.wrap).getSize(new THREE.Vector3());

  return {
    ok: true, url,
    object: norm.wrap,
    gltf: res.gltf,
    generator: (res.gltf.asset && res.gltf.asset.generator) || 'unknown',
    meshes: san.meshes,
    tris: san.tris,
    skinned,
    rawSize: rawSize.toArray().map((n) => +n.toFixed(4)),
    size: size.toArray().map((n) => +n.toFixed(4)),
    scale: norm.scale,
    up: norm.up,
    notes: san.notes.concat(norm.notes)
  };
}
