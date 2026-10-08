/* Changing Room - the 11 clothing blanks.
 *
 * 69 products are only 19 distinct blanks; 17 of them share the basic tee.
 * The artwork is a print, not a garment, so one spec serves a whole family.
 *
 * Five knobs do most of the work:
 *   easeX/easeZ  how much bigger than the body
 *   padX/padZ    flat clearance on top of that
 *   straight     how far the garment ignores the body's waist nip.
 *                0.92 is a boxy Champion tee, 0.05 is a bodycon.
 *   flareAmt     how much the hem swings out
 *   mN           where the neckline stops and the shoulder seam starts.
 *                0.52 crew, 0.66 tank, 0.72 bodycon.
 */

import { Y, INCH, remapY, isBodyDerived } from './body.js?v=30';

const BASE = {
  waistY: Y.waist,
  layer: 1,
  S: 16,
  flareAmt: 0,
  flarePow: 1.0,
  flareFrom: 0,     /* fraction of waist->hem to stay flat before flaring */
  neckBand: 0.020,
  ribbed: false,
  sheen: 0
};

/** @type {Record<string, object>} */
export const SPECS = {
  basicTee: {
    ...BASE, label: 'tee',
    hemY: -0.22, neckY: 1.06, scoopF: 0.055, scoopB: 0.012,
    neckRX: 0.118, neckRZ: 0.108, mN: 0.52,
    easeX: 1.14, easeZ: 1.16, padX: 0.022, padZ: 0.020,
    straight: 0.75, flareAmt: 0.09, shExt: 0.012,
    armBotY: 0.66, phiMax: 0.52, phiTop: 0.18, tPeak: 0.50,
    sleeveLen: 0.30, cuffR: 0.104, sag: 0.028,
    rough: 0.86,
    hides: ['chestUpper', 'chestLower', 'waist']
  },

  aopTee: {
    ...BASE, label: 'aop tee', printMode: 'aop',
    hemY: -0.22, neckY: 1.06, scoopF: 0.055, scoopB: 0.012,
    neckRX: 0.118, neckRZ: 0.108, mN: 0.52,
    easeX: 1.14, easeZ: 1.16, padX: 0.022, padZ: 0.020,
    straight: 0.75, flareAmt: 0.09, shExt: 0.012,
    armBotY: 0.66, phiMax: 0.52, phiTop: 0.18, tPeak: 0.50,
    sleeveLen: 0.30, cuffR: 0.104, sag: 0.028,
    rough: 0.74,
    hides: ['chestUpper', 'chestLower', 'waist']
  },

  tank: {
    ...BASE, label: 'tank',
    hemY: -0.20, neckY: 1.02, scoopF: 0.150, scoopB: 0.085,
    neckRX: 0.150, neckRZ: 0.118, mN: 0.66,
    easeX: 1.06, easeZ: 1.08, padX: 0.014, padZ: 0.012,
    straight: 0.35, flareAmt: 0.12, flarePow: 1.2, shExt: 0.000,
    armBotY: 0.60, phiMax: 0.38, phiTop: 0.42, tPeak: 0.40,
    sleeveLen: 0, cuffR: 0, sag: 0,
    rough: 0.84,
    hides: ['chestLower', 'waist']
  },

  championTee: {
    ...BASE, label: 'champion tee',
    hemY: -0.33, neckY: 1.07, scoopF: 0.050, scoopB: 0.012,
    neckRX: 0.130, neckRZ: 0.120, mN: 0.50,
    easeX: 1.34, easeZ: 1.36, padX: 0.030, padZ: 0.028,
    straight: 0.92, flareAmt: 0.02, shExt: 0.075,
    armBotY: 0.55, phiMax: 0.62, phiTop: 0.22, tPeak: 0.55,
    sleeveLen: 0.42, cuffR: 0.142, sag: 0.050,
    rough: 0.88,
    hides: ['chestUpper', 'chestLower', 'waist', 'hips']
  },

  jerseyTee: {
    ...BASE, label: 'jersey',
    hemY: -0.25, neckY: 1.06, scoopF: 0.058, scoopB: 0.014,
    neckRX: 0.120, neckRZ: 0.110, mN: 0.52,
    easeX: 1.20, easeZ: 1.22, padX: 0.024, padZ: 0.022,
    straight: 0.70, flareAmt: 0.07, shExt: 0.020,
    armBotY: 0.64, phiMax: 0.54, phiTop: 0.19, tPeak: 0.50,
    sleeveLen: 0.33, cuffR: 0.110, sag: 0.032,
    rough: 0.72,
    hides: ['chestUpper', 'chestLower', 'waist']
  },

  /* A soccer/hockey jersey is an ALL-OVER print garment, unlike the "jersey
     tee" it was sharing a spec with. Routing it through the non-aop path sent
     an all-over design to the motif separator, which found one dense patch in
     the middle and cut everything else away - the small square in the centre of
     the shirt. Same blank and same shell as jerseyTee, only printMode differs. */
  aopJersey: {
    ...BASE, label: 'jersey', printMode: 'aop',
    hemY: -0.25, neckY: 1.06, scoopF: 0.058, scoopB: 0.014,
    neckRX: 0.120, neckRZ: 0.110, mN: 0.52,
    easeX: 1.20, easeZ: 1.22, padX: 0.024, padZ: 0.022,
    straight: 0.70, flareAmt: 0.07, shExt: 0.020,
    armBotY: 0.64, phiMax: 0.54, phiTop: 0.19, tPeak: 0.50,
    sleeveLen: 0.33, cuffR: 0.110, sag: 0.032,
    rough: 0.72,
    hides: ['chestUpper', 'chestLower', 'waist']
  },

  crop: {
    ...BASE, label: 'crop',
    hemY: 0.20, neckY: 1.04, scoopF: 0.090, scoopB: 0.030,
    neckRX: 0.130, neckRZ: 0.115, mN: 0.56,
    easeX: 1.08, easeZ: 1.10, padX: 0.016, padZ: 0.014,
    straight: 0.45, flareAmt: 0.05, shExt: 0.006,
    armBotY: 0.63, phiMax: 0.56, phiTop: 0.18, tPeak: 0.45,
    sleeveLen: 0.15, cuffR: 0.106, sag: 0.012,
    rough: 0.85,
    hides: ['chestUpper', 'chestLower']
  },

  bodycon: {
    ...BASE, label: 'bodycon', S: 20,
    hemY: -0.78, neckY: 1.02, scoopF: 0.170, scoopB: 0.095,
    neckRX: 0.180, neckRZ: 0.128, mN: 0.72,
    /* AUTHORED VALUES - leave them alone. Raising padX/padZ (tried at
       0.024/0.022) widens the dress at EVERY height, bust and hip included,
       and that is what got reported as a bulge/bump. Leg clearance is not
       their job. */
    easeX: 1.02, easeZ: 1.03, padX: 0.010, padZ: 0.009,
    /* The ONLY change from the original spec: flareAmt was -0.03, a negative
       value, so the hem tapered slightly INWARD. +0.08 makes it open outward
       by the same small degree instead. Everything else here - flarePow and
       flareFrom left at BASE's defaults - is deliberately untouched, so the
       silhouette is the one that was already working, just no longer pinching
       in at the bottom. Resist the urge to add flareFrom/flarePow overrides
       or to chase full leg clearance with a bigger number; both were tried and
       both read as a bump. */
    straight: 0.05, flareAmt: 0.08, shExt: 0.000,
    armBotY: 0.66, phiMax: 0.40, phiTop: 0.46, tPeak: 0.32,
    sleeveLen: 0, cuffR: 0, sag: 0,
    rough: 0.62, sheen: 0.60, sheenRough: 0.25, printMode: 'aop',
    hides: ['chestLower', 'waist', 'hips'],
    clipLegsAbove: -0.74
  },

  teeDress: {
    ...BASE, label: 'tee dress',
    hemY: -0.76, neckY: 1.06, scoopF: 0.060, scoopB: 0.014,
    neckRX: 0.120, neckRZ: 0.110, mN: 0.52,
    easeX: 1.14, easeZ: 1.16, padX: 0.022, padZ: 0.020,
    straight: 0.55, flareAmt: 0.34, flarePow: 1.35, shExt: 0.012,
    armBotY: 0.66, phiMax: 0.52, phiTop: 0.18, tPeak: 0.50,
    sleeveLen: 0.26, cuffR: 0.108, sag: 0.026,
    rough: 0.86,
    hides: ['chestUpper', 'chestLower', 'waist', 'hips'],
    clipLegsAbove: -0.72
  },

  /* THE HOODIE = THE JERSEY SHELL + A HOOD. Aug 17 2026, the owner's call.
     Its geometry is not authored here any more: it is spread from aopJersey
     below (see SPECS.sweatshirt after this object, which is where the derive
     happens, because a key cannot reference a sibling inside its own literal).

     `hood: true` is what makes it a hoodie - main.js adds buildHood()'s mesh
     to the garment group for any spec carrying it, on BOTH the procedural and
     the supplied-shell path.

     The old authored sweatshirt block that used to sit here - easeX 1.30,
     sleeveLen 0.66, ribbed, the heavier sheen - is gone on purpose. Restoring
     it would put the boxy sweatshirt silhouette back and undo the ask. */

  buttonup: {
    ...BASE, label: 'button up', layer: 2,
    hemY: -0.30, neckY: 1.06, scoopF: 0.075, scoopB: 0.016,
    neckRX: 0.132, neckRZ: 0.122, mN: 0.50,
    easeX: 1.24, easeZ: 1.28, padX: 0.028, padZ: 0.026,
    straight: 0.80, flareAmt: 0.05, shExt: 0.038,
    armBotY: 0.58, phiMax: 0.58, phiTop: 0.20, tPeak: 0.52,
    sleeveLen: 0.62, cuffR: 0.096, sag: 0.052,
    rough: 0.78,
    hides: ['chestUpper', 'chestLower', 'waist', 'armL_upper', 'armR_upper']
  },

  pants: {
    ...BASE, label: 'wide leg pants', layer: 0, kind: 'pants',
    waistY: 0.17, bandH: 0.055,
    crotchY: -0.18, crotchDrop: 0.055,
    easeX: 1.08, easeZ: 1.10, padX: 0.016, padZ: 0.014,
    straight: 0.30, flareAmt: 0, hemY: Y.ankle,
    /* Wide leg, but the legs still have to read as two. At 0.215 with centres
       0.15 apart they merge into a single column and the whole thing looks
       like a floor-length skirt. */
    rThighX: 0.158, rThighZ: 0.152,
    rKneeX: 0.150, rKneeZ: 0.146,
    rHemX: 0.170, rHemZ: 0.164,
    rough: 0.80, printMode: 'aop',
    hides: ['hips'],
    clipLegsAbove: null
  }
};

/* Joggers are the pants blank on a different supplied shell (sweatpants.glb vs
   pants.glb - see GARMENTS in models.js, keyed on this same name). Everything
   the spec controls is identical: same kind, so main.js anchors it waist to
   ankle exactly like the wide-leg pair, and same aop printMode, so the camo
   wraps rather than being stamped as a chest-sized patch. Derived from
   SPECS.pants rather than copied, so a fit correction earned on the pants
   cannot silently drift away from these. Only the label and the leg radii
   differ - a jogger tapers to a cuff, which is the whole visual difference
   from a wide leg, and the radii are what the procedural fallback would use
   if the GLB were ever missing. */
/* The hoodie, derived from the JERSEY shell exactly as the owner specified -
   same silhouette, same sleeves, same ease - with a hood added at the nape and
   two deliberate departures:
   - NO printMode:'aop'. A jersey is an all-over print; a hoodie in this catalog
     carries a chest graphic, so leaving printMode unset keeps it on the
     centred-print path rather than wrapping the whole photo over the garment.
   - layer 2, which aopJersey does not set. Layering is what lets a hoodie sit
     OVER another top without z-fighting it; it is fit metadata, not shape. */
SPECS.sweatshirt = {
  ...SPECS.aopJersey, label: 'hoodie', layer: 2, hood: true,
  printMode: undefined,
  hides: ['chestUpper', 'chestLower', 'waist', 'armL_upper', 'armR_upper']
};

SPECS.joggers = {
  ...SPECS.pants, label: 'joggers',
  rThighX: 0.150, rThighZ: 0.144,
  rKneeX:  0.130, rKneeZ:  0.126,
  rHemX:   0.098, rHemZ:   0.094
};

/* Which blank each wardrobe record uses. Runs on the record id and name, never
   on `design`, because design is shared across garments - blue-crew alone
   covers the tee, the crop, the pants and the sweatshirt. */
export function specKeyFor(rec) {
  const n = (rec.name || '').toLowerCase();
  const slot = rec.slot;

  /* "Camo Cotton Joggers" gets the tapered sweatpants shell; every other
     bottom keeps the wide-leg pants shell. Matched on /jogger/ ALONE and
     deliberately not on /sweat ?pant/ - "Flared Sweat Pants" is a live product
     and it is flared, not tapered, so widening this regex would swap a working
     garment onto the wrong shell. */
  if (slot === 'BOTTOM') return /jogger/.test(n) ? 'joggers' : 'pants';
  if (slot === 'DRESS') return /bodycon/.test(n) ? 'bodycon' : 'teeDress';

  if (/sweatshirt|hood(?:ie|y)|crewneck|jacket/.test(n)) return 'sweatshirt';
  if (/dress shirt|button ?up/.test(n)) return 'buttonup';
  if (/all over print|aop/.test(n)) return 'aopTee';
  /* "Seek First Jersey TEE" is a tee with a front print; a soccer, hockey or
     ball jersey is an all-over garment. The word "tee" is what separates them,
     so test for it rather than listing every sport. */
  if (/jersey/.test(n) && !/tee/.test(n)) return 'aopJersey';
  if (/champion/.test(n)) return 'championTee';
  if (/crop/.test(n)) return 'crop';
  if (/tank|razorback/.test(n)) return 'tank';
  if (/jersey/.test(n)) return 'jerseyTee';
  return 'basicTee';
}

/* Heights in a spec are authored against the procedural body. When a supplied
   body is measured they have to be carried onto its proportions, or a hem
   tuned to one figure lands somewhere else on another. remapY is the
   piecewise map between the two landmark sets. */
const HEIGHT_FIELDS = ['hemY', 'neckY', 'armBotY', 'waistY', 'crotchY', 'clipLegsAbove'];

export function specFor(rec) {
  const key = specKeyFor(rec);
  const base = SPECS[key];
  const ov = SPEC_OVERRIDES[rec.id];
  const spec = Object.assign({ __key: key }, base, ov || {});

  if (isBodyDerived()) {
    HEIGHT_FIELDS.forEach((f) => {
      if (typeof spec[f] === 'number') spec[f] = remapY(spec[f]);
    });
  }
  return spec;
}

/* Hand-authored corrections, keyed on the wardrobe record id. Kept out of the
   generated wardrobe.js so regenerating the catalog cannot clobber them. */
export const SPEC_OVERRIDES = {
  /* A BABY TEE ON A FULL TEE BLANK. specKeyFor routes on the NAME, and
     "Pink Retro Angel Shirt" contains no word that says cropped or fitted, so
     it falls to basicTee and hangs like a standard unisex tee. The blank is
     actually `womens-micro-rib-raglan-baby-tee` - visible only in its image
     path, which specKeyFor deliberately does not read.
     Overridden by id rather than by widening the name regex, because the name
     carries no signal to widen on and guessing one would catch other products.
     Values: shorter hem, less ease, a little more waist shaping than a boxy
     tee. NOT visually confirmed - report what to nudge. */
  'pink-retro-angel-shirt': {
    hemY: 0.02, easeX: 1.05, easeZ: 1.07, padX: 0.012, padZ: 0.011,
    straight: 0.30, flareAmt: 0.02, sleeveLen: 0.18, cuffR: 0.098
  }
};

/* ------------------------------------------------------------- props ----- */

/* Rigid items. Each entry may name a GLB; if the file is absent the procedural
   fallback is used, so nothing here blocks the page from working. */
export const PROPS = {
  /* anchorY is the headband / ankle / strap height, and it is the number to
     tune if a prop sits wrong. The head spans y 1.16 to 1.64, so a cap band
     belongs near the brow at 1.47, which puts the crown apex level with the
     top of the head. Shoe scale: a foot on a 68in figure is about 10in, i.e.
     0.50 world, and the base geometry is 0.27 long. */
  dadCap:      { glb: 'https://1333covenant.com/changingroom/models/dad-cap.glb',        kind: 'cap',    anchorY: 1.478, scale: 1.00, hides: [] },
  youthCap:    { glb: 'https://1333covenant.com/changingroom/models/dad-cap.glb',        kind: 'cap',    anchorY: 1.480, scale: 0.92, hides: [] },
  fivePanel:   { glb: 'https://1333covenant.com/changingroom/models/five-panel-cap.glb', kind: 'cap',    anchorY: 1.482, scale: 1.00, hides: [] },
  bucket:      { glb: 'https://1333covenant.com/changingroom/models/bucket-hat.glb',     kind: 'bucket', anchorY: 1.452, scale: 1.00, hides: [] },
  booney:      { glb: 'https://1333covenant.com/changingroom/models/booney-hat.glb',     kind: 'bucket', anchorY: 1.448, scale: 1.06, hides: [] },
  highTop:     { glb: 'https://1333covenant.com/changingroom/models/high-top-shoe.glb',  kind: 'shoe',   anchorY: -1.60, scale: 1.75, hides: ['footL', 'footR'] },
  tote:        { glb: 'https://1333covenant.com/changingroom/models/tote-bag.glb',       kind: 'bag',    anchorY: 0.62,  scale: 1.00, hides: [] },
  crossbody:   { glb: 'https://1333covenant.com/changingroom/models/crossbody-bag.glb',  kind: 'bag',    anchorY: 0.58,  scale: 1.00, hides: [] }
};

export function propKeyFor(rec) {
  const n = (rec.name || '').toLowerCase();
  if (rec.slot === 'FEET') return 'highTop';
  if (rec.slot === 'CARRY') return /crossbody/.test(n) ? 'crossbody' : 'tote';
  if (/booney/.test(n)) return 'booney';
  if (/bucket/.test(n)) return 'bucket';
  if (/five panel/.test(n)) return 'fivePanel';
  if (/youth/.test(n)) return 'youthCap';
  return 'dadCap';
}
