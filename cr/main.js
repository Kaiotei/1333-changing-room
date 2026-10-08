/* Changing Room - application.
 *
 * Catalog, cart, colourways, sizes, share links and photo export are ported
 * from v1 unchanged: they were correct. Everything visual is new.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

import { Y, buildMannequin, applyDerivedBody, remapY } from './body.js?v=30';
import { buildGarment, buildPants, buildHood } from './garment.js?v=30';
import { specFor, specKeyFor, PROPS, propKeyFor } from './specs.js?v=30';
import { preparePrintAsset, torsoPatch, silhouettePatch } from './prints.js?v=30';
import { buildGarmentAtlas, atlasTexture } from './atlas.js?v=30';
import { darkStudioEnvironment, buildLights, makeFabricMaterial, createContactShadow, buildFloor } from './materials.js?v=30';
import { buildProp, projectDecal, loadProp, tintTextured, applyWrappedTexture, applyTiledTexture } from './props.js?v=30';
import { buildSlicer, deriveBody, prepareCover, applyCover, coverField } from './slicer.js?v=30';
import * as MODELS from './models.js?v=30';

const SLOTS = ['HEAD', 'TOP', 'DRESS', 'BOTTOM', 'FEET', 'CARRY'];
const SLOT_LABELS = {
  HEAD: 'Headwear', TOP: 'Top', DRESS: 'Dress',
  BOTTOM: 'Bottom', FEET: 'Shoes', CARRY: 'Bag'
};
const PROP_SLOTS = new Set(['HEAD', 'FEET', 'CARRY']);

const WARDROBE = window.WARDROBE || [];
const MAPS = window.SHOP_MAPS || { COLORS: {}, SIZES: { default: [] }, SIZES_BY_DESIGN: {}, AUG7_IMAGES: {}, AUGUST: {} };

const BY_SLOT = {};
SLOTS.forEach((s) => { BY_SLOT[s] = []; });
WARDROBE.forEach((r) => {
  if (MODELS.EXCLUDE && MODELS.EXCLUDE.has(r.id)) return;   /* held out, see models.js */
  if (BY_SLOT[r.slot]) BY_SLOT[r.slot].push(r);
});
SLOTS.forEach((s) => BY_SLOT[s].sort((a, b) => (b.added || 0) - (a.added || 0)));

const state = { HEAD: -1, TOP: -1, DRESS: -1, BOTTOM: -1, FEET: -1, CARRY: -1 };
const colourPick = {};
const sizePick = {};
let currentSlot = 'TOP';

function recFor(slot) {
  const i = state[slot];
  return (i < 0 || i >= BY_SLOT[slot].length) ? null : BY_SLOT[slot][i];
}

/* ============================================================== scene ==== */

const stageEl = document.getElementById('stage');
const canvas = document.getElementById('gl');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;   /* colour-accurate for commerce */
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;              /* dress hems clip the legs */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d0e);
/* The floor has to be large enough that its far edge is off screen, but a lit
   floor against an unlit background still leaves a visible horizon. Fog set to
   the background colour dissolves it. Near is past the figure, so the garment
   itself is never fogged. */
scene.fog = new THREE.Fog(0x0d0d0e, 9, 19);
scene.environment = darkStudioEnvironment(renderer);
scene.environmentIntensity = 1.0;

/* The figure is 3.37 tall. At fov 34 the visible height is 2*d*tan(17deg), so
   d must be past ~6.2 for the whole form plus its shadow to fit. */
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
camera.position.set(0.55, 0.62, 6.9);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.62;
/* CAMERA FREEDOM, Aug 17 2026, on the owner's report: zoomed in, the view was
   pinned to the chest with no way to reach the head.
 *
 * Two separate limits were doing that and both had to go:
 *   - enablePan was false, so there was no way to slide the target up or down
 *     the figure at all. It is on now, with screenSpacePanning so a drag moves
 *     the view straight up rather than along the camera's own tilted plane,
 *     which is what makes "scroll up to the head" behave the way it reads.
 *   - the polar range was PI*0.22 to PI*0.56, a 61-degree window that could
 *     not look down at the shoes or up from below the chin. Widened to
 *     PI*0.06 - PI*0.88, which is nearly the full sphere while still stopping
 *     short of the poles, where OrbitControls gimbal-flips.
 *
 * The target is still the figure, so this stays "bound to the model" - panning
 * moves what you are looking AT up and down the body rather than flying free
 * of it, and panning is clamped below so it cannot wander off into empty
 * space. minDistance drops to 1.4 so a close look at the head or a shoe is
 * actually possible now that the view can get there. */
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.8;
controls.minPolarAngle = Math.PI * 0.06;
controls.maxPolarAngle = Math.PI * 0.88;
controls.minDistance = 1.4;
controls.maxDistance = 10.0;
controls.zoomSpeed = 0.7;
controls.target.set(0, 0.02, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.55;
controls.update();
controls.addEventListener('start', () => { controls.autoRotate = false; });
/* Keeps panning BOUND TO THE MODEL, as asked: the target may travel from the
   floor to just above the head and no further, and never sideways off the
   figure. Without this, pan is unlimited and the figure can be pushed out of
   frame entirely, which is the usual reason pan gets disabled in viewers like
   this one in the first place. */
controls.addEventListener('change', () => {
  const t = controls.target;
  t.y = Math.min(Math.max(t.y, Y.ground), Y.headtop + 0.15);
  t.x = Math.min(Math.max(t.x, -0.6), 0.6);
  t.z = Math.min(Math.max(t.z, -0.6), 0.6);
});

buildLights(scene);

const rig = new THREE.Group();
scene.add(rig);

const floor = buildFloor();
floor.position.y = Y.ground;
scene.add(floor);

/* The procedural mannequin is the DEFAULT figure (Aug 10 2026, at the owner's
   instruction). The supplied HD scans were A-posed by script twice and both
   passes deformed the arms; loadBody() below still works and is one call away,
   but nothing invokes it at boot. */
let mannequin = buildMannequin();
rig.add(mannequin.group);
/* Prepared cover masks, one per body mesh. The supplied figure is a single
   mesh and the procedural one is a bag of parts, so this is a list either way
   rather than two code paths. */
let bodyCovers = [];
let bodyRange = [Y.ground, Y.headtop];
let bodyAxis = { x: 0, z: 0 };  /* the figure's own vertical axis, measured */
let bodyKey = 'procedural';

async function loadBody(which) {
  const entry = MODELS.MANNEQUINS[which];
  if (!entry) return false;
  const r = await loadProp(MODELS.MODEL_DIR + entry.file, entry);
  if (!r) return false;

  rig.remove(mannequin.group);
  disposeGroup(mannequin.group);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xcfc9bf, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.55
  });
  const obj = r.object.clone(true);
  let mesh = null;
  obj.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; mesh = o; }
  });
  rig.add(obj);

  /* Measure the supplied body and rebuild the table garments are cut from. */
  const S = buildSlicer(obj);
  const D = deriveBody(S);
  applyDerivedBody(D);
  bodyRange = [D.yLo, D.yHi];
  bodyAxis = D.axis || { x: 0, z: 0 };
  if (D.warnings.length) console.info('[changing room] body measurement:', D.warnings.join(' | '));

  /* S is handed to prepareCover as well: the cover test probes into the body to
     find how thick the limb under a face is, so that a thigh standing proud of
     the pants still counts as inside them. */
  bodyCovers = mesh ? [prepareCover(mesh, bodyAxis.x, bodyAxis.z, S)] : [];

  mannequin = { group: obj, parts: new Map(), material: mat, supplied: true };
  bodyKey = which;
  return true;
}

const shadow = createContactShadow(renderer, { size: 3.2, y: Y.ground + 0.002, opacity: 0.85 });
shadow.setShaders(HorizontalBlurShader, VerticalBlurShader);
rig.add(shadow.group);
let shadowDirty = true;

const groups = {};
SLOTS.forEach((s) => { groups[s] = new THREE.Group(); rig.add(groups[s]); });

/* ============================================================ helpers ==== */

function disposeGroup(g) {
  /* The slot's sampled garment shape goes with its geometry, or an empty slot
     keeps hiding the body it no longer covers. */
  if (g.userData) g.userData.cover = null;
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => {
          for (const k in m) {
            const v = m[k];
            if (v && v.isTexture) v.dispose();
          }
          m.dispose();
        });
      }
    });
  }
}

function coloursFor(rec) {
  const c = MAPS.COLORS[rec.design];
  return (c && c.length) ? c : [];
}
function sizesFor(rec) {
  if (MAPS.SIZES_BY_DESIGN[rec.design]) return MAPS.SIZES_BY_DESIGN[rec.design];
  if (rec.sub === 'hat') return MAPS.SIZES.hat || ['One Size'];
  return MAPS.SIZES['default'] || ['XS', 'S', 'M', 'L', 'XL', '2XL'];
}
function imageFor(rec, colour) {
  if (colour) {
    const a7 = MAPS.AUG7_IMAGES[rec.design];
    if (a7 && a7[colour]) return a7[colour];
    const au = MAPS.AUGUST[rec.design];
    if (au && au.colors && au.colors[colour]) return au.colors[colour];
    /* LAST RESORT: match the colourway against the gallery filenames.
       Only the drop-specific maps above carry a colour->image table, so an
       older product has none and every colourway resolved to rec.img - the
       first photo, whatever colour that happens to be. Jesus Loves You Too is
       the case that exposed it: printSourceFor asks for White, White is in
       COLORS but in neither map, so the print was lifted off the LIGHT BLUE
       shirt. Its white photo does exist, in the gallery, named for its colour
       like every other file here. Slug both sides so "Baby Blue" matches
       "baby-blue". */
    const slug = colour.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hit = (rec.gallery || []).find((u) => {
      const f = decodeURIComponent(u).toLowerCase().split('/').pop();
      return f.includes('-' + slug + '-') || f.includes('-' + slug + '.');
    });
    if (hit) return hit;
  }
  return rec.img;
}

/* The print is extracted ONCE per design, from its cleanest colourway, and
   reused for every colour. Heather fabric has a sigma that overlaps the
   print's lightest tones and is genuinely unseparable - but every heather
   design in this catalog also ships in white or light blue, so picking the
   low-variance colourway sidesteps the problem entirely. */
function printSourceFor(rec) {
  const cols = coloursFor(rec);
  if (!cols.length) return rec.img;
  const pref = [/^white$/i, /^(natural|bone|ivory|fossil|stone)$/i, /light blue|baby blue/i];
  for (const p of pref) {
    const hit = cols.find((c) => p.test(c));
    if (hit) {
      const u = imageFor(rec, hit);
      if (u) return u;
    }
  }
  return imageFor(rec, cols[0]) || rec.img;
}

const assetCache = new Map();
const imgCache = new Map();
const sideArtCache = new Map();

/* {left, right} canvases for a prop whose design sits on its sides. Declared in
   models.js as `sideArt` on the PROPS entry; absent for everything but shoes,
   and a missing file just yields no decal on that side. */
async function sideArtFor(propKey) {
  const entry = propKey && MODELS.PROPS[propKey];
  if (!entry || !entry.sideArt) return null;
  if (sideArtCache.has(propKey)) return sideArtCache.get(propKey);
  const p = (async () => {
    /* { outer: {left,right}, inner: {left,right} } - shoes carry both faces;
       anything else naming just {left,right} is treated as outer-only, so a
       future single-sided prop does not need the nested shape. */
    const faces = (entry.sideArt.outer || entry.sideArt.inner)
      ? entry.sideArt
      : { outer: entry.sideArt };
    const out = {};
    for (const face of ['outer', 'inner']) {
      if (!faces[face]) continue;
      out[face] = {};
      for (const which of ['left', 'right']) {
        const u = faces[face][which];
        if (!u) continue;
        const a = await assetFor(u, 'aop');
        const cv = a && silhouettePatch(a);
        if (cv) out[face][which] = cv;
        else console.warn('[changing room] no side art for', propKey, face, which, u);
      }
    }
    return out;
  })();
  sideArtCache.set(propKey, p);
  return p;
}

function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

async function assetFor(url, mode) {
  const key = url + '|' + (mode || '');
  if (assetCache.has(key)) return assetCache.get(key);
  const p = (async () => {
    const img = await loadImage(url);
    if (!img) return null;
    try { return preparePrintAsset(img, { mode }); }
    catch (e) { console.warn('print prep failed', url, e); return null; }
  })();
  assetCache.set(key, p);
  return p;
}

/* ========================================================== building ===== */

/* Per slot, not global: boot rebuilds all six at once, and a single shared
   counter would make the first five cancel themselves as stale. */
const buildToken = {};
SLOTS.forEach((s) => { buildToken[s] = 0; });

async function rebuildSlot(slot) {
  const token = ++buildToken[slot];
  const stale = () => token !== buildToken[slot];
  const g = groups[slot];
  disposeGroup(g);

  const rec = recFor(slot);
  if (!rec) { refreshBody(); shadowDirty = true; return; }

  const colour = colourPick[slot] || null;
  const url = imageFor(rec, colour);

  if (PROP_SLOTS.has(slot)) {
    const propKey = propKeyFor(rec);
    const propSpec = PROPS[propKey];
    const asset = await assetFor(url);
    if (stale()) return;
    const tint = asset ? asset.fabric : 0x8d8d92;
    /* silhouettePatch, not torsoPatch: torsoPatch's crop is measured off
       SHOULDER and HEM landmarks (yShoulder, yNeckBottom, torso width), which
       assume a garment silhouette. A cap or bag photo has no shoulders and no
       hem, so those landmarks measure whatever the shape's proportions happen
       to produce - not garbage, but not a chest either, and it was the wrong
       shape often enough that the crop this produced was too thin a sliver of
       the source to read as the design. silhouettePatch makes no such
       assumption: it crops to the whole subject, whatever its shape. */
    const propCv = (asset && asset.print) || silhouettePatch(asset);
    /* Side artwork, for a prop printed on its flanks rather than its front.
       Each view is prepared like any other product photo - the separator's
       silhouette pass is what drops the white studio background, so what gets
       projected is the shoe, not a white tile with a shoe on it. */
    const sideArt = await sideArtFor(propKey);
    const node = await buildProp(propSpec, tint, propCv, propKey, sideArt);
    if (stale()) { disposeGroup(node); return; }
    g.add(node);
    g.userData.spec = propSpec;
    /* Caps and shoes wrap what they sit on, so their inner wall is a fair test
       of what to hide. A bag does not - it hangs beside the figure, and from
       the spine its near face reads as an inner wall in front of the whole arm,
       which would erase the hand holding it. */
    g.userData.cover = propSpec.kind === 'bag' ? null : coverFor(node);
    refreshBody();
    shadowDirty = true;
    return;
  }

  const spec = specFor(rec);
  const aop = spec.printMode === 'aop';

  /* fabric colour comes from the SELECTED colourway; the print comes from the
     design's cleanest colourway */
  const colourAsset = await assetFor(url, aop ? 'aop' : undefined);
  const printAsset = aop
    ? colourAsset
    : await assetFor(printSourceFor(rec));
  if (stale()) return;

  const tint = colourAsset ? colourAsset.fabric : 0xd8d4cc;

  /* A supplied garment shell replaces the procedural one for this blank. Its
     UVs are unknown, so the print is projected as a decal rather than painted
     into an atlas, and the colourway tints the material directly. */
  const gEntry = MODELS.GARMENTS[spec.__key];
  if (gEntry) {
    /* Scale the supplied shell to span its intended top and hem on THIS body.
       The manifest's literals were guessed against the procedural figure; the
       spec heights are already remapped onto the measured one, so derive from
       those instead. */
    const isPants = spec.kind === 'pants';
    const top = isPants ? spec.waistY : (Y.neckbase - 0.015);
    const bottom = isPants ? (Y.ankle + 0.02) : spec.hemY;

    /* The manifest's correction rides on top of that fit. yOff moves the
       anchor but deliberately not the size, so nudging a tee up does not also
       stretch it; sizeMul scales about the anchor, so shrinking pants raises
       the cuff and yOff is what puts the waist back where it belongs. */
    const fit = Object.assign({}, gEntry, {
      anchorMode: 'top',
      anchorY: top + (gEntry.yOff || 0),
      targetHeight: Math.max(0.25, (top - bottom) * (gEntry.sizeMul || 1))
    });
    const sup = await loadProp(MODELS.MODEL_DIR + gEntry.file, fit);
    if (stale()) return;
    if (sup) {
      const node = sup.object.clone(true);
      node.traverse((o) => {
        if (!o.isMesh) return;
        /* OWN the geometry, do not share the cached one.
           loadProp caches the ingested shell and hands the SAME object back on
           every rebuild; Object3D.clone(true) copies the node tree but shares
           geometry by reference. disposeGroup() then disposes that shared
           geometry every time a slot rebuilds - so the cache is left holding a
           disposed geometry, which is handed to the next colourway change.
           Cloning per instance means a slot only ever disposes what it owns.
           This is also what makes the per-colourway UV rewrite below safe:
           applyTiledTexture writes a uv attribute, and writing it into
           cache-owned geometry mutates every other instance of the shell. */
        o.geometry = o.geometry.clone();
        /* A supplied denim/canvas texture IS the material and is kept, tinted
           by the colourway, rather than replaced with the flat procedural
           fabric colour every other blank uses. */
        o.material = gEntry.textured
          ? tintTextured(o.material, tint)
          : new THREE.MeshStandardMaterial({
              color: tint, roughness: spec.rough != null ? spec.rough : 0.86,
              metalness: 0, envMapIntensity: 0.42, side: THREE.DoubleSide, dithering: true
            });
        o.castShadow = true; o.receiveShadow = true;
      });
      /* Depth nudge and twist, before the print is projected and before the
         shape is sampled - both read the node's world transform. The wrapper's
         origin sits on the figure's centreline, so yaw spins the garment about
         the body rather than about its own corner. */
      if (gEntry.zOff) node.position.z += gEntry.zOff;
      if (gEntry.yaw) node.rotation.y = gEntry.yaw;
      g.add(node);
      /* The hood, for the hoodie blank. Added to the GROUP, deliberately not
         merged into `node`: every projector below measures the shell's own
         bounding box, and a hood inside it would push that box up and lift the
         chest graphic off centre. It also has to go on AFTER the shell's
         material is built, so it can take a matching one. */
      if (spec.hood) {
        /* Collar height is READ OFF THE FITTED SHELL, not taken from
           spec.neckY. The shell is anchored by its bounding-box top at
           `top + yOff`, so its box top IS the collar - deriving from it means
           the hood follows any future yOff/sizeMul change automatically
           instead of drifting away from the neckline the moment one is
           nudged. */
        node.updateMatrixWorld(true);
        const shellTop = new THREE.Box3().setFromObject(node).max.y;
        const hood = new THREE.Mesh(
          buildHood(shellTop, spec.hoodScale || 1),
          new THREE.MeshStandardMaterial({
            color: tint, roughness: spec.rough != null ? spec.rough : 0.86,
            metalness: 0, envMapIntensity: 0.42, side: THREE.DoubleSide, dithering: true
          })
        );
        hood.castShadow = true; hood.receiveShadow = true;
        g.add(hood);
      }
      /* `wrap` maps the whole photo across the shell, the supplied-model
         equivalent of what the atlas does for a procedural garment. Without it
         an all-over design gets a chest-sized patch stamped on the front and
         reads as a mostly-blank garment - the difference the owner was seeing
         between the pants and the jerseys. */
      let wrapped = false;
      /* A REPEATING pattern (camo) beats wrapping the photo, and takes
         precedence over `wrap` for any design that has swatches registered.
         The photo path stretches one mockup across the bounding box exactly
         once, which puts the camo on at the wrong scale and made all three
         colourways read as the same garment. See PATTERNS in models.js. */
      /* `colour` is null until the shopper touches a swatch, and that default
         state is most of what gets looked at - so fall back to the design's
         FIRST colourway rather than dropping to the photo wrap. Without this
         the camo pants opened on a stretched Dark Forest mockup and only
         became a real tiled pattern once a swatch was clicked. */
      /* colour, falling back to the first swatch: nothing is preselected, and
         the default state is most of what gets looked at - without the
         fallback the camo pants open on a stretched product photo and only
         become a tiled pattern once a swatch is clicked. */
      const pat = MODELS.patternFor(rec.design, colour || coloursFor(rec)[0]);
      if (pat) {
        const swatch = await loadImage(pat.url);
        if (stale()) return;
        wrapped = swatch ? applyTiledTexture(node, swatch, pat.repeat) : false;
        if (!wrapped) console.warn('[changing room] pattern tile failed for', rec.id, pat.url);
      }
      if (!wrapped && gEntry.wrap === 'planar') {
        const wrapCv = silhouettePatch(printAsset) ||
                       (printAsset && printAsset.print) || null;
        wrapped = applyWrappedTexture(node, wrapCv, tint);
        if (!wrapped) console.warn('[changing room] wrap failed for', rec.id);
      }
      /* An all-over print and a tonal print both come back with `print: null`,
         and this used to stop there and project nothing - which is the blank
         white AOP tees and pants. Their artwork lives in `source`, so fall back
         to a torso crop of it. */
      if (!wrapped) {
        const printCv = (printAsset && printAsset.print) || torsoPatch(printAsset);
        if (printCv) projectDecal(node, node, printCv, MODELS.DECAL.garment);
        else if (printAsset) console.warn('[changing room] no print for', rec.id, printAsset.mode);
      }
      g.userData.spec = spec;
      g.userData.cover = coverFor(node);
      refreshBody();
      shadowDirty = true;
      return;
    }
  }

  const built = spec.kind === 'pants' ? buildPants(spec) : buildGarment(spec);

  const atlas = buildGarmentAtlas(
    built.islands,
    aop ? colourAsset : printAsset,
    tint, spec, colour
  );
  const tex = atlasTexture(atlas, renderer);
  const mat = makeFabricMaterial(spec, tex);

  const node = new THREE.Group();
  [built.torso].concat(built.sleeves, built.rims).forEach((geo) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    node.add(m);
  });

  if (stale()) { disposeGroup(node); return; }
  g.add(node);

  /* The hood, on the PROCEDURAL path - which is the one the hoodie actually
     takes, since SPECS.sweatshirt derives from the jersey and has no GLB.
     Same reasoning as the supplied-shell copy above: a separate mesh in the
     group, not merged into the shell, so the atlas and the cover sampler both
     still see the garment's own bounds. It shares the garment's material, so
     the colourway and the print's fabric tone carry onto it for free. */
  if (spec.hood) {
    node.updateMatrixWorld(true);
    const shellTop = new THREE.Box3().setFromObject(node).max.y;
    /* Its own flat material, NOT the shell's `mat`. The garment's material is
       bound to the atlas, whose UVs are the panel layout buildGarment writes -
       a sphere's own UVs index into that atlas at unrelated coordinates and
       would drag pieces of the chest print onto the hood. The colourway is
       what the hood needs, and that is `tint`. */
    const hood = new THREE.Mesh(
      buildHood(shellTop, spec.hoodScale || 1),
      new THREE.MeshStandardMaterial({
        color: tint, roughness: spec.rough != null ? spec.rough : 0.86,
        metalness: 0, envMapIntensity: 0.42, side: THREE.DoubleSide, dithering: true
      })
    );
    hood.castShadow = true;
    hood.receiveShadow = true;
    /* Added to the SLOT GROUP, not to `node`: coverFor(node) below samples the
       garment to decide which body parts are hidden, and a shell sitting
       behind the neck would read as covering the neck and head. */
    g.add(hood);
  }

  g.userData.spec = spec;
  g.userData.cover = coverFor(node);
  refreshBody();
  shadowDirty = true;
}

/* Sampling a garment costs one pass over its triangles, so it is done once at
   build time and kept on the slot rather than recomputed on every refresh. */
function coverFor(node) {
  if (!bodyCovers.length) return null;
  node.updateMatrixWorld(true);
  return coverField(node);
}

/**
 * Hide only the body that actually breaks through a garment.
 *
 * The previous version hid a RANGE OF HEIGHTS, and a height range is a
 * horizontal slab through the whole figure. Hiding "armpit down to hem" so a
 * chest would not poke through a tee erased both arms as well, because the arms
 * occupy those same heights; a dress spans further still and took the head.
 *
 * Height alone cannot distinguish an arm from a rib, but angle around the spine
 * can. So each garment is sampled into an inner radius per height and per
 * angular sector, and a body triangle is dropped only where it has reached that
 * radius - the fabric's inner wall - in its own sector. A sleeve then hides the
 * arm inside it and nothing else, and a triangle poking through the chest goes
 * without taking its neighbours.
 */
function refreshBody() {
  /* The ghost body hides nothing and is hidden by nothing, so there is no work
     here at all for the default figure - the depth buffer sorts it out during
     the transparent pass. Kept as a call site because the supplied-scan path
     below still needs it, and because every rebuildSlot() already reports here.

     What used to happen instead, and why none of it does now: whole body parts
     were switched off by each garment's `hides` list, a clipping plane cut the
     legs at a hem, and a ray-derived alpha mask erased any face it judged to be
     under cloth. Together they were removing far more than they should - the
     upper arms came away from the shoulders - which is what "things are
     disappearing" was. An apparition that intersects a sleeve costs nothing, so
     nothing is removed any more. */
  if (!mannequin.supplied) return;

  mannequin.material.clippingPlanes = [];
  if (!bodyCovers.length) return;
  const fields = SLOTS
    .map((s) => groups[s].userData.cover)
    .filter(Boolean);
  for (const C of bodyCovers) applyCover(C, fields);
}

function applyExclusivity(changed) {
  if (changed === 'DRESS' && state.DRESS >= 0) {
    state.TOP = -1; state.BOTTOM = -1;
    groups.TOP.userData.spec = null; groups.BOTTOM.userData.spec = null;
    rebuildSlot('TOP'); rebuildSlot('BOTTOM');
  } else if ((changed === 'TOP' || changed === 'BOTTOM') && state[changed] >= 0 && state.DRESS >= 0) {
    state.DRESS = -1;
    groups.DRESS.userData.spec = null;
    rebuildSlot('DRESS');
  }
}

/* ================================================================ UI ===== */

const el = (id) => document.getElementById(id);
const railEl = el('rail');
const nameEl = el('recName');
const priceEl = el('recPrice');
const metaEl = el('recMeta');
const swatchEl = el('swatches');
const sizeEl = el('sizeSel');
const counterEl = el('counter');
const slotLabelEl = el('slotLabel');

function renderRail() {
  railEl.innerHTML = '';
  SLOTS.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.dataset.slot = s;
    b.innerHTML = '<span class="slot-k">' + SLOT_LABELS[s] + '</span><span class="slot-v"></span>';
    b.addEventListener('click', () => { currentSlot = s; refreshUI(); });
    railEl.appendChild(b);
  });
}

function refreshRail() {
  railEl.querySelectorAll('.slot').forEach((b) => {
    const s = b.dataset.slot;
    const r = recFor(s);
    b.classList.toggle('on', s === currentSlot);
    b.classList.toggle('filled', !!r);
    b.querySelector('.slot-v').textContent = r ? r.name : 'none';
  });
}

function refreshUI() {
  refreshRail();
  const rec = recFor(currentSlot);
  const n = BY_SLOT[currentSlot].length;

  slotLabelEl.textContent = SLOT_LABELS[currentSlot];
  counterEl.textContent = (state[currentSlot] + 1) + ' / ' + n;

  if (!rec) {
    nameEl.textContent = 'Nothing on';
    priceEl.textContent = '';
    metaEl.textContent = SLOT_LABELS[currentSlot] + ' slot is empty';
    swatchEl.innerHTML = '';
    el('colourRow').hidden = true;
    el('sizeRow').hidden = true;
    el('actions').hidden = true;
    updateTotal();
    return;
  }

  nameEl.textContent = rec.name;
  priceEl.textContent = rec.price.toFixed(2);
  metaEl.textContent = rec.id;
  el('actions').hidden = false;
  el('btnCard').href = rec.card || '#';
  el('btnCrypto').href = rec.crypto || '#';

  const cols = coloursFor(rec);
  el('colourRow').hidden = cols.length === 0;
  swatchEl.innerHTML = '';
  swatchEl.classList.remove('need');
  cols.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'sw' + (colourPick[currentSlot] === c ? ' on' : '');
    b.title = c;
    b.textContent = c;
    b.addEventListener('click', () => {
      colourPick[currentSlot] = c;
      rebuildSlot(currentSlot);
      refreshUI();
    });
    swatchEl.appendChild(b);
  });

  const isShoe = rec.slot === 'FEET';
  el('sizeRow').hidden = isShoe;
  el('btnAdd').hidden = isShoe;
  if (!isShoe && sizeEl.dataset.for !== rec.id) {
    const opts = sizesFor(rec);
    /* A ONE-OPTION SIZE LIST IS NOT A CHOICE. Hats are SIZES.hat = ['One Size'],
       so the shopper was made to open a dropdown and pick the only entry in it
       before Add to cart or Wear-all would let them through. When there is
       exactly one size, select it and skip the "Select size" placeholder. */
    sizeEl.innerHTML = opts.length > 1 ? '<option value="">Select size</option>' : '';
    opts.forEach((s) => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sizeEl.appendChild(o);
    });
    sizeEl.dataset.for = rec.id;
    if (opts.length === 1) sizePick[currentSlot] = opts[0];
  }
  sizeEl.value = sizePick[currentSlot] || '';
  sizeEl.classList.remove('need');

  updateTotal();
}

function cycle(dir) {
  const n = BY_SLOT[currentSlot].length;
  if (!n) return;
  let cur = state[currentSlot] + 1;
  cur = (cur + dir + (n + 1)) % (n + 1);
  state[currentSlot] = cur - 1;
  delete colourPick[currentSlot];
  delete sizePick[currentSlot];
  if (state[currentSlot] < 0) groups[currentSlot].userData.spec = null;
  applyExclusivity(currentSlot);
  rebuildSlot(currentSlot);
  refreshUI();
}

function outfit() {
  const out = [];
  SLOTS.forEach((s) => {
    const r = recFor(s);
    if (r) out.push({ slot: s, rec: r, size: sizePick[s] || '', color: colourPick[s] || '' });
  });
  return out;
}
function updateTotal() {
  const items = outfit();
  const t = items.reduce((a, i) => a + i.rec.price, 0);
  el('total').textContent = t.toFixed(2);
  el('totalCount').textContent = items.length + (items.length === 1 ? ' piece' : ' pieces');
}

/* ============================================================== cart ===== */

function cartItem(e) {
  return {
    name: e.rec.name, price: e.rec.price, stripePriceId: e.rec.priceId,
    image: imageFor(e.rec, e.color), size: e.size, color: e.color
  };
}
function addToCart(items) {
  if (!window.Cart || !window.Cart.addItem) {
    alert('Cart is not available on this page. Use the Card or Crypto buttons.');
    return false;
  }
  items.forEach((i) => window.Cart.addItem(cartItem(i)));
  return true;
}

/* A colourway is as required as a size when the product has one. colourPick
   starts unset and no swatch is preselected, so an untouched product went to
   the cart with color:'' - an order with no colour on it. Mirrors the size
   guard directly above rather than defaulting to the first swatch, because a
   silent default ships whatever colour happens to be first. */
function colourMissing(slot, rec) {
  return coloursFor(rec).length > 0 && !colourPick[slot];
}
function flagColour() {
  swatchEl.classList.add('need');
  swatchEl.scrollIntoView({ block: 'nearest' });
}

el('btnAdd').addEventListener('click', () => {
  const rec = recFor(currentSlot);
  if (!rec) return;
  if (!sizeEl.value && rec.slot !== 'FEET') {
    sizeEl.classList.add('need');
    sizeEl.focus();
    return;
  }
  if (colourMissing(currentSlot, rec)) { flagColour(); return; }
  sizePick[currentSlot] = sizeEl.value;
  addToCart([{ slot: currentSlot, rec, size: sizeEl.value, color: colourPick[currentSlot] || '' }]);
});

sizeEl.addEventListener('change', () => {
  sizePick[currentSlot] = sizeEl.value;
  sizeEl.classList.remove('need');
});

el('btnRemove').addEventListener('click', () => {
  state[currentSlot] = -1;
  delete colourPick[currentSlot];
  delete sizePick[currentSlot];
  groups[currentSlot].userData.spec = null;
  rebuildSlot(currentSlot);
  refreshUI();
});

el('btnWearAll').addEventListener('click', () => {
  const items = outfit().filter((i) => i.slot !== 'FEET');
  const missing = items.filter((i) => !i.size);
  /* Same colour requirement as Add to cart above - Wear-all is the path that
     could quietly send several colourless items at once. */
  const noColour = items.filter((i) => colourMissing(i.slot, i.rec));
  if (!items.length) { flash('Nothing on yet'); return; }
  if (missing.length) { flash('Pick a size for: ' + missing.map((i) => i.rec.name).join(', ')); return; }
  if (noColour.length) { flash('Pick a colour for: ' + noColour.map((i) => i.rec.name).join(', ')); return; }
  if (addToCart(items)) flash('Added ' + items.length + ' pieces');
});

el('btnCart').addEventListener('click', () => { if (window.Cart) window.Cart.openCart(); });

function flash(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ===================================================== share / photo ===== */

el('btnShare').addEventListener('click', () => {
  const q = [];
  SLOTS.forEach((s) => {
    if (state[s] >= 0) {
      q.push(s + '=' + encodeURIComponent(recFor(s).id));
      if (colourPick[s]) q.push(s + 'c=' + encodeURIComponent(colourPick[s]));
    }
  });
  const url = location.origin + location.pathname + (q.length ? '?' + q.join('&') : '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => flash('Link copied'), () => prompt('Copy:', url));
  } else prompt('Copy:', url);
});

el('btnPhoto').addEventListener('click', () => {
  renderer.render(scene, camera);
  const W = 1100, H = 1400;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#0d0d0e';
  x.fillRect(0, 0, W, H);

  const ar = canvas.width / canvas.height;
  let dw = W - 120, dh = dw / ar;
  if (dh > H - 380) { dh = H - 380; dw = dh * ar; }
  x.drawImage(canvas, (W - dw) / 2, 90, dw, dh);

  x.fillStyle = '#e8e4dc';
  x.font = '600 34px "Bricolage Grotesque", system-ui, sans-serif';
  x.fillText('Changing Room', 60, 66);

  let y = 90 + dh + 66;
  x.font = '500 15px "JetBrains Mono", monospace';
  outfit().forEach((i) => {
    x.fillStyle = '#8a867e';
    x.fillText(SLOT_LABELS[i.slot].toUpperCase(), 60, y);
    x.fillStyle = '#e8e4dc';
    x.fillText(i.rec.name, 200, y);
    x.fillStyle = '#c8ff2f';
    x.textAlign = 'right';
    x.fillText(i.rec.price.toFixed(2), W - 60, y);
    x.textAlign = 'left';
    y += 34;
  });
  x.fillStyle = '#8a867e';
  x.fillText('1333covenant.com', 60, H - 44);
  x.fillStyle = '#c8ff2f';
  x.textAlign = 'right';
  x.font = '600 22px "JetBrains Mono", monospace';
  x.fillText(outfit().reduce((a, i) => a + i.rec.price, 0).toFixed(2), W - 60, H - 44);
  x.textAlign = 'left';

  let url;
  try { url = c.toDataURL('image/png'); }
  catch (e) { flash('Photo needs the page served over http'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = '1333-changing-room.png';
  a.click();
  flash('Saved');
});

el('btnReset').addEventListener('click', () => {
  SLOTS.forEach((s) => {
    state[s] = -1;
    groups[s].userData.spec = null;
    delete colourPick[s];
    delete sizePick[s];
    rebuildSlot(s);
  });
  refreshUI();
});

el('btnRandom').addEventListener('click', () => {
  SLOTS.forEach((s) => { state[s] = -1; groups[s].userData.spec = null; delete colourPick[s]; delete sizePick[s]; });
  const pick = (s) => { const n = BY_SLOT[s].length; if (n) state[s] = (Math.random() * n) | 0; };
  if (Math.random() < 0.28) pick('DRESS');
  else { pick('TOP'); if (Math.random() < 0.55) pick('BOTTOM'); }
  if (Math.random() < 0.7) pick('HEAD');
  if (Math.random() < 0.45) pick('FEET');
  if (Math.random() < 0.35) pick('CARRY');
  SLOTS.forEach(rebuildSlot);
  refreshUI();
});

el('prev').addEventListener('click', () => cycle(-1));
el('next').addEventListener('click', () => cycle(1));

window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') { cycle(-1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { cycle(1); e.preventDefault(); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const i = SLOTS.indexOf(currentSlot);
    currentSlot = SLOTS[(i + (e.key === 'ArrowUp' ? -1 : 1) + SLOTS.length) % SLOTS.length];
    refreshUI();
    e.preventDefault();
  }
});

/* ============================================================== boot ===== */

function resize() {
  const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function initFromURL() {
  const q = new URLSearchParams(location.search);
  SLOTS.forEach((s) => {
    const id = q.get(s);
    if (!id) return;
    const i = BY_SLOT[s].findIndex((r) => r.id === id);
    if (i >= 0) state[s] = i;
    const c = q.get(s + 'c');
    if (c) colourPick[s] = c;
  });
  /* Open on a slot that actually has something in it, so a shared link does
     not land on an empty "Nothing on" panel. */
  const filled = SLOTS.find((s) => state[s] >= 0);
  if (filled) currentSlot = filled;

  const yaw = parseFloat(q.get('yaw'));
  if (!isNaN(yaw)) {
    controls.autoRotate = false;
    const d = camera.position.distanceTo(controls.target);
    const a = (yaw * Math.PI) / 180;
    camera.position.set(
      controls.target.x + Math.sin(a) * d * 0.94,
      controls.target.y + 0.25 * d * 0.28,
      controls.target.z + Math.cos(a) * d * 0.94
    );
    controls.update();
  }
}

renderer.setAnimationLoop(() => {
  controls.update();
  if (shadowDirty) {
    mannequin.group.visible = true;
    shadow.plane.visible = false;
    shadow.update(scene);
    shadow.plane.visible = true;
    shadowDirty = false;
  }
  renderer.render(scene, camera);
});

renderRail();
resize();
initFromURL();
refreshUI();

/* Switching figures is not just a model swap: the new body is measured, the
   landmark table is rebuilt from it, and every garment is cut to those numbers.
   So the whole wardrobe has to be rebuilt, not just re-parented. */
const bodyPick = el('bodyPick');

function markBody() {
  if (!bodyPick) return;
  bodyPick.querySelectorAll('button[data-body]').forEach((b) => {
    b.classList.toggle('on', b.dataset.body === bodyKey);
  });
}

if (bodyPick) {
  bodyPick.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-body]');
    if (!b || b.dataset.body === bodyKey) return;
    bodyPick.classList.add('busy');
    try {
      if (await loadBody(b.dataset.body)) {
        markBody();
        SLOTS.forEach(rebuildSlot);
        shadowDirty = true;
      }
    } catch (e) {
      console.warn('[changing room] body switch failed', e);
    }
    bodyPick.classList.remove('busy');
  });
}

/* The procedural body is the figure. Nothing is fetched, so its cover masks are
   prepared inline and the wardrobe is built straight away.
   To go back to a supplied scan, call loadBody('female') here instead - it
   measures the mesh, rebuilds the landmark table and prepares its cover the
   same way. It is left wired up but unused because both scripted A-pose passes
   deformed the arms. */
markBody();
SLOTS.forEach(rebuildSlot);
refreshUI();

document.body.classList.add('ready');
