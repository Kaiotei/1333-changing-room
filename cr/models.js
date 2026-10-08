/* Changing Room - the supplied model manifest.
 *
 * Adding a model is a data change, not a code change: prepare the .glb into
 * models/ and, if it needs it, add an entry here. Anything absent falls back to
 * procedural geometry, so a partial delivery works.
 *
 * Everything in models/ is produced from the raw exports in 3D/ by the prep
 * script - the raw files total 254 MB and 6.2 million triangles, which no web
 * page can load. Prep strips baked textures (colour comes from the colourway at
 * runtime and the print is projected as a decal, so they are wrong here as well
 * as huge), decimates to a triangle budget, then computes normals on the
 * decimated mesh. Result is 5.3 MB across all six.
 *
 * `anchorMode`:
 *   bottom  lowest point sits at anchorY   (figure on the floor, shoe sole)
 *   top     highest point sits at anchorY  (cap crown level with the head top)
 *   hand    highest point sits at the hand (a bag carried at the side)
 *   centre  midpoint sits at anchorY
 *
 * Anchoring gets an item to the right landmark; it cannot get it to the right
 * PLACE, because ingest centres a model on its bounding box in X and Z and a
 * bounding box has no idea which end is the front. A cap's brim drags the box
 * centre forward of the crown, so the crown lands behind the skull; a shoe's
 * toe does the same to the ankle. Hence the nudges below, which are eyeball
 * calibration in world units and are meant to be adjusted by looking:
 *
 *   zOff     forward (+Z is the front) after anchoring
 *   yOff     vertical, after anchoring, without changing size
 *   sizeMul  multiplies the fitted height, anchor point held
 *   yaw      twist about the figure's centreline, radians
 *
 * One inch is 0.0495 world units, so 0.05 is about an inch.
 */

// The demo loads the original prepped models from 1333covenant.com (CORS-open).
// Point this at your own models/ folder; anything missing falls back to procedural geometry.
export const MODEL_DIR = 'https://1333covenant.com/changingroom/models/';

/* One figure. The male mannequin was dropped at the owner's instruction; its
   file stays in models/ but nothing references it, and the Figure row is gone
   from the page. The map is kept keyed rather than flattened to a constant
   because the measurement path already reads landmarks off whichever mesh is
   loaded, so adding a figure back is a data change here and nothing else. */
export const MANNEQUINS = {
  female: {
    label: 'Female',
    file: 'mannequin-female.glb',
    targetHeight: 3.37,
    anchorMode: 'bottom',
    anchorY: -1.75
  }
};
export const DEFAULT_MANNEQUIN = 'female';

/* Headwear splits three ways. `hat-normal` is the general cap and covers every
   blank that is NOT a five panel, a bucket or a booney - so dad hats, the
   vintage cap, the corduroy cap, the denim hat, the strapback and the youth
   cap all point at it. Bucket and booney have no model yet and keep their
   procedural geometry until one arrives. */
const HAT_NORMAL = 'hat-normal.glb';

/* Cap sizes are written as a chain rather than three loose numbers, because
   what was asked for is a relationship: the youth cap is the small one, the
   general cap is 2% larger than that, and the five panel is its own size. Nudge
   YOUTH_H and the general cap keeps its 2%. */
const YOUTH_H = 0.27 * 1.02;
const CAP_H   = YOUTH_H * 1.02;
/* 0.9025 is two successive 5% reductions on the five panel, both asked for on
   Aug 10 2026. Left as the product so a third is one more factor, not a
   recalculation. */
const FIVEP_H = 0.30 * 0.90 * 0.9025;

export const PROPS = {
  dadCap:    { file: HAT_NORMAL,          anchorMode: 'top',    targetHeight: CAP_H,   zOff: 0.085 },
  youthCap:  { file: HAT_NORMAL,          anchorMode: 'top',    targetHeight: YOUTH_H, zOff: 0.078 },
  fivePanel: { file: 'hat-fivepanel.glb', anchorMode: 'top',    targetHeight: FIVEP_H, zOff: 0.090 },
  /* the supplied file is already a matched pair, so nothing is mirrored here.
     RESTORED to shoes.glb - this is the exact mesh from the visually-confirmed
     working iteration. shoes-tex.glb is a different mesh prepped from raw, and
     swapping it in changed what the clipping test sees. Do not swap it back
     without the user confirming clipping still looks right. */
  /* spreadX, not widthMul. The earlier 5% X scale widened the stance but
     stretched each shoe by the same 5%, and lining the shoes up under the legs
     needed 27% of it - a visibly wider shoe. spreadX translates the two halves
     apart instead, so the shoes keep their shape and only the gap changes.
     0.083 puts each shoe's centre at x 0.360, directly under the ghost's ankle
     at POSE.leg 10deg / POSE.legHipX 0.145 (body.js). If either of those two
     numbers moves, this one follows. Measured, not guessed - the raw pair fits
     with its centres at 0.277. */
  /* tint: authored black, so the side artwork reads against it. Sampling the
     colourway off the product photo returns white and the shoe disappears.

     sideArt.outer: the two OUTSIDE (lateral) mockup views. CROSSED ON PURPOSE -
     `right` (the figure's own right foot, side=+1) points at
     white-LEFT-outside.png and vice versa. Confirmed live and reported
     backwards Aug 10 2026: the file literally named "right" rendered on the
     figure's right foot, but was the wrong art for it. The mockup filenames
     evidently name which side of a photo PAIR the shot was laid out on, not
     which foot wears the shoe - checked the geometry itself
     (tools/decalcheck.html has a UV-vs-world-Z probe) and each photo's own
     toe/heel orientation lands correctly on whichever foot it is projected
     onto, so the fix is which file goes to which foot, not the projection
     math. If a future drop renames these, verify the actual render before
     assuming filename == foot.

     sideArt.inner: the two INSIDE (medial) views, supplied Aug 10 2026,
     same product photography set as the outer pair. Crossed the same way as
     outer on the working assumption that both pairs share the same naming
     convention - this half has NOT been confirmed against a render the way
     outer was, only checked for correct triangle coverage. Swap if it turns
     out backwards the way outer did. */
  highTop:   { file: 'shoes.glb',         anchorMode: 'bottom', targetHeight: 0.32, zOff: 0.183,
               spreadX: 0.083, tint: 0x141416,
               sideArt: {
                 outer: {
                   right: '/shop%20images/august%2026/womens-high-top-shoes/white-left-outside.png',
                   left:  '/shop%20images/august%2026/womens-high-top-shoes/white-right-outside.png'
                 },
                 inner: {
                   right: '/shop%20images/womens-high-top-canvas-shoes-white-left-inside-6a617cb212530.png',
                   left:  '/shop%20images/womens-high-top-canvas-shoes-white-right-inside-6a617cb212cc6.png'
                 }
               } },
  /* wrap: 'planar' for the same reason the pants use it - a tote is an
     all-over print and the design covers the whole face of the bag, so a
     chest-style decal patch on the front of it showed as a pale blob rather
     than the artwork. Wrapping maps the whole photo across the shell. */
  tote:      { file: 'tote.glb',          anchorMode: 'hand',   targetHeight: 0.62, sideInset: 0.03,
               wrap: 'planar' }
  /* bucket, booney: no model yet, procedural fallback
     crossbody:      dropped for now, see EXCLUDE below */
};

/* Products held out of the wardrobe entirely. The urban crossbody has no
   supplied model and its procedural stand-in is not worth showing. */
export const EXCLUDE = new Set(['urban-crossbody-bag',
  /* NO SHORTS BLANK EXISTS. The pants spec runs waist to ankle, so anything
     short renders as full-length trousers. Both shorts products belong here;
     black-33-jorts was missed when kids-cotton-essential-shorts was added and
     was rendering as long pants until Aug 17 2026. If a shorts product is ever
     added, it goes here too until a real shorts spec exists. */
  'kids-cotton-essential-shorts',
  'black-33-jorts',
  /* Aug 16 2026, owner's call: the TOP slot shows t-shirts, jerseys and
     hoodies only. THESE ARE ALL STILL SOLD IN THE SHOP - the Changing Room is
     a limited preview, not a mirror of the catalog, so holding an item out
     here must never mean removing it from shop.html or the feeds. Note several
     are typed 'tee' in wardrobe.js because makewardrobe's classifier buckets
     any upper-body blank that way; the name is what actually distinguishes
     them. Raw Edge Hoody is deliberately NOT here - it is a hoody, so it
     qualifies. */
  'off-shoulder-sports-crop',
  'jester-girl-tank-top',
  'ice-cream-polo',
  'preppy-polo',
  'lace-paneling-shirt',
  'mock-neck-crewneck',
  '333-button-up',
  'bodycon-cotton-tee',
  'camo-off-shoulder',
  'denim-jacket',
  'off-the-shoulder-tee',
  'snow-washed-kids-tank',
  'angel-tank',
  'embroidered-logo-ringer-tee',
  'jesus-tank',
  'rhythm-dress-shirt']);

/* One shirt and one pair of pants were supplied. The shirt stands in for every
   upper-body blank; the silhouettes differ, so this is a placeholder until
   per-blank files exist, and the procedural shells remain the better fit for
   the ones that differ most (crop, bodycon, tank).

   No anchorY or targetHeight here on purpose: a garment is fitted between the
   collar and the hem of whichever body is loaded, so its placement is derived
   in main.js and any literal written here would only be overwritten. What is
   left is the correction on top of that fit. */
const SHIRT = 'shirt.glb';
export const GARMENTS = {
  basicTee:    { file: SHIRT, yOff: 0.105 },
  aopTee:      { file: SHIRT, yOff: 0.105 },
  championTee: { file: SHIRT, yOff: 0.095 },
  jerseyTee:   { file: SHIRT, yOff: 0.100 },
  /* THE SUPPLIED PANTS SHELL. It stays. Removing this entry routes the blank
     to the PROCEDURAL buildPants() builder, which is a different, generated
     pair of trousers - not this model. That was done once, on a misreading of
     "project onto the pants the way jerseys do" as "use the jersey code path",
     and it was wrong: the ask was for the ARTWORK to wrap this model, not for
     the model to be replaced.

     `wrap: 'planar'` is what delivers that - see applyWrappedTexture in
     props.js. The whole product photo is mapped across the shell's own
     surface, rather than a small chest-style decal being stamped on the
     front, which is the visible difference between these pants and the
     jerseys the owner was comparing them to.

     Uniform scale is the only size knob ingest has, so shrinking the pants
     shortens them as well as narrowing them. yOff carries most of the drop and
     also buys back the length the second 10% took off the inseam.

     yaw is NEGATIVE to bring the viewer's-right leg forward: three.js rotates
     (1,0,0) to (cos, 0, -sin), so a positive angle sends that side back.

     widthMul buys back exactly what sizeMul took off the girth (1/0.81 = 1.235)
     plus a little ease. Measured, not guessed - see tools/fit-check.mjs. */
  pants:       { file: 'pants.glb', yOff: -0.150, zOff: -0.028, sizeMul: 0.81,
                 widthMul: 1.28, yaw: -5 * Math.PI / 180, wrap: 'planar' },

  /* THERE IS DELIBERATELY NO `sweatshirt` ENTRY HERE. Aug 17 2026, the owner's
     call, and getting it wrong once already cost a round trip - so, precisely:
     the hoodie is built from **the PROCEDURAL jersey geometry**, which means it
     must have no entry in this map at all. A key here routes its blank to a
     supplied GLB; absence is what sends it to buildGarment() in garment.js.

     The trap that produced the wrong answer the first time: `jerseyTee` below
     DOES have an entry (shirt.glb), but `jerseyTee` is the "Seek First Jersey
     TEE" blank, not a jersey. The real jerseys - footy, soccer, hockey - route
     to `aopJersey`, which has no entry and therefore renders procedurally.
     That procedural shell is "the jersey model". See SPECS.sweatshirt in
     specs.js, which now derives its shape from SPECS.aopJersey and adds a hood.

     Previously this key pointed at `hoodie.glb`, a hood-UP supplied shell whose
     bounding box top was the crown rather than the collar, so anchorMode 'top'
     pinned the wrong landmark and the fit needed escalating fudge factors
     (yOff 0.36 then 0.44, sizeMul 1.10 then 1.10*1.10) without ever sitting
     right. `models/hoodie.glb` is now referenced by nothing. */

  /* SUPPLIED JOGGERS SHELL. Now LIVE: "Camo Cotton Joggers" shipped Aug 16
     2026 and specKeyFor() routes it here (the /jogger/ branch in specs.js),
     so this is no longer preview-only - editing it changes a real product.
     wrap:'planar' because the camo art is all-over, same reasoning as the
     wide-leg pants above. changingroom/_dev/camo-preview.html still drives
     this same entry directly, which is how the six shell-and-camo pairings
     were checked before any of it was wired up. */
  /* Joggers started from the exact fit correction pants earned (0.81/1.28,
     yOff -0.150, zOff -0.028) - both are pants-kind shells anchored waist to
     ankle. The two offsets have since been corrected on the owner's eye:
     DOWN 0.05 (yOff -0.150 -> -0.200, about an inch at 0.0495/in) and FORWARD
     0.033 (zOff -0.028 -> +0.005, +Z is the front). sizeMul/widthMul/yaw are
     still the pants numbers and were NOT touched - the report was about where
     the shell sits, not how big it is. */
  joggers:     { file: 'sweatpants.glb', yOff: -0.200, zOff: 0.005, sizeMul: 0.81,
                 widthMul: 1.28, yaw: -5 * Math.PI / 180, wrap: 'planar' }
};

/* Seamless camo swatches, tiled across a shell by applyTiledTexture (props.js)
   instead of the usual "wrap the product photo once" path.
 *
 * TWO PRODUCTS, THREE COLOURWAYS EACH. A camo is a COLOUR here, not its own
 * product - the owner's decision, and this map is keyed to match: design ->
 * colourway name -> swatch. The colourway strings must equal shop.html's
 * COLORS entries exactly, because that is what the swatch buttons pass; a
 * mismatch silently falls back to wrapping the product photo instead.
 *
 * Both pant types share the same three swatch FILES - it is the same camo
 * printed on two blanks, so a second copy would be byte-identical.
 *
 * `repeat` is tiles across the shell's HEIGHT. 3 puts the pattern on at about
 * the scale it reads at in the product photos; raising it shrinks the camo. */
export const PATTERNS = {
  'camo-cotton-pants': {
    repeat: 3,
    colours: {
      'Dark Forest': 'https://1333covenant.com/changingroom/patterns/dark-forest.jpg',
      'Digigreen':   'https://1333covenant.com/changingroom/patterns/digigreen.jpg',
      'Yukon':       'https://1333covenant.com/changingroom/patterns/yukon.jpg'
    }
  },
  'camo-cotton-joggers': {
    repeat: 3,
    colours: {
      'Dark Forest': 'https://1333covenant.com/changingroom/patterns/dark-forest.jpg',
      'Digigreen':   'https://1333covenant.com/changingroom/patterns/digigreen.jpg',
      'Yukon':       'https://1333covenant.com/changingroom/patterns/yukon.jpg'
    }
  }
};

/** The tileable swatch for a design + colourway, or null if there is none. */
export function patternFor(design, colour) {
  const p = PATTERNS[design];
  if (!p || !colour) return null;
  const url = p.colours[colour];
  return url ? { url, repeat: p.repeat } : null;
}

/* Where a print is projected onto a model. `size[2]` is the projector DEPTH and
   wants to be shallow: DecalGeometry does no backface culling, so a deep box
   stamps the print on the far side as well.

   `yFrac` is height as a fraction of the target's own bounding box - 0 at the
   hem, 1 at the collar - which is what a garment needs, because the shell is
   stretched to fit whichever body is loaded and a fixed offset from its middle
   drifts off the top as it grows. The hats keep the absolute offset: they are
   scaled to a fixed size, so there is nothing to drift. */
export const DECAL = {
  /* cap/bucket/bag switched to `fill` (Aug 10 2026), same reasoning as the
     shoes: a small hand-guessed literal box is a small hand-guessed literal
     box, whatever the object. Sizing it as a fraction of the shell's own
     bounding box instead means it always covers a real proportion of the
     actual object, regardless of how that guess was tuned against a different
     model at a different scale. */
  /* yFrac 0.62 (was centred on the whole shell, ~0.5): the shipped cap mesh is
     one merged shell running brim-to-crown, and its FRONT-most point overall
     is the brim tip, not the crown - so a shallow decal anchored there only
     ever reaches brim-adjacent geometry, no matter how it's centred
     vertically. depth 0.45 is what actually reaches back and up to the crown
     dome; fill dropped to 0.55 to compensate so the box does not also balloon
     wide. Verified (tools/hatcheck.html): old config's triangles landed 21%
     to 41% up the shell (the brim/bill, matching the RED "wrong" mark in the
     owner's screenshot); this lands 34% to 88% (the crown front, matching the
     GREEN "correct" mark). */
  cap:     { yFrac: 0.62, fill: 0.55, depth: 0.45 },
  bucket:  { pos: [0, 0.04, 0], fill: 0.72 },
  garment: { yFrac: 0.68, size: [0.46, 0.52, 0.22] },   /* chest, ~3in below the collar */
  bag:     { yFrac: 0.58, fill: 0.62 },
  /* Side projection, one per foot. `fill` sizes it off the shoe's own bounding
     box rather than a literal, because the artwork covers the whole side panel
     and the shoe is scaled to the figure. depth 0.30 reaches in from the outer
     face far enough to wrap the side but stops short of the other shoe, which
     matters because the pair is one merged mesh. */
  shoe:    { axis: 'x', yFrac: 0.52, fill: 0.94, depth: 0.30 },
  /* Medial (inner) face. Deliberately mirrors `shoe` above - same yFrac, same
     fill - because the outer face's coverage is the one confirmed to look
     right, and there is no reason for the inner to be framed differently.
     Only the axis, the reach and the projector's X position differ.
     These were briefly much more conservative (fill 0.62) while the real bug
     was misdiagnosed as unavoidable surface curvature. It was not: decalProxy
     was orienting medial normals against the MERGED PAIR's centroid and
     culling them all. With that fixed (see the `origin` argument there) the
     face takes a full decal like any other - 245 triangles before, 3160 after.
     depth 0.42 reaches from the inner wall across most of the shoe without
     running into the outer face's own territory at the far side. */
  shoeInner: { axis: 'x-in', yFrac: 0.52, fill: 0.94, depth: 0.42, innerX: 0.19 }
};

export function propUrl(key) {
  const e = PROPS[key];
  return e ? MODEL_DIR + e.file : null;
}
export function garmentUrl(key) {
  const e = GARMENTS[key];
  return e ? MODEL_DIR + e.file : null;
}
export function mannequinUrl(which) {
  const e = MANNEQUINS[which || DEFAULT_MANNEQUIN];
  return e ? MODEL_DIR + e.file : null;
}
