/* Changing Room - materials and the darkroom studio rig.
 *
 * Deliberately NOT the AngelGotchi Builder's magenta/teal scheme. This page is
 * a dark product studio: one warm key, a cool fill, a soft top bounce, and a
 * restrained back rim. Clothes are the product, so the light stays close to
 * neutral and the colour stays true.
 */

import * as THREE from 'three';

export const PALETTE = {
  ink:    0x0d0d0e,
  carbon: 0x17171a,
  bone:   0xe8e4dc,
  ash:    0x8a867e,
  acid:   0xc8ff2f
};

/**
 * A small emissive-panel room, PMREM'd for image based lighting. RoomEnvironment
 * is a white box and would wash a darkroom out, so this is a dim custom one.
 */
export function darkStudioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry();
  geo.deleteAttribute('uv');

  const mk = (hex, intensity) => new THREE.MeshBasicMaterial({
    color: new THREE.Color(hex).multiplyScalar(intensity),
    side: THREE.BackSide
  });

  /* the room itself, very dark so nothing lifts the blacks */
  const room = new THREE.Mesh(geo, mk(0x14141a, 1));
  room.scale.set(24, 14, 24);
  scene.add(room);

  const panel = (hex, intensity, pos, scale, rot) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(intensity)
    }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    scene.add(m);
    return m;
  };

  panel(0xfff2e2, 4.2, [3.6, 4.2, 4.0], [5.0, 5.0, 0.2], [0, -0.6, 0]);  // key
  panel(0xcfe0ff, 1.5, [-4.6, 1.6, 3.0], [4.0, 4.0, 0.2], [0, 0.7, 0]);  // fill
  panel(0xffffff, 1.1, [0, 7.0, 0], [8.0, 0.2, 8.0]);                    // top bounce
  panel(0xdcd2ff, 1.3, [-2.0, 2.4, -5.0], [4.0, 3.0, 0.2]);              // back rim

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  geo.dispose();
  scene.traverse((o) => { if (o.material) o.material.dispose(); });
  return rt.texture;
}

/** The directional rig: shape and a shadow the environment cannot give. */
export function buildLights(scene) {
  const g = new THREE.Group();

  /* High and fairly frontal: a lower key throws a long theatrical shadow
     across the floor, which fights the product. */
  const key = new THREE.DirectionalLight(0xfff4e8, 2.1);
  key.position.set(2.2, 7.2, 3.6);
  key.castShadow = true;
  /* 1024 is plenty for one figure at this framing, and it keeps the page
     comfortable on integrated GPUs and phones. */
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 16;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -2.4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;   /* stops acne on thin garment shells */
  g.add(key);

  const fill = new THREE.DirectionalLight(0xbccbe4, 0.55);
  fill.position.set(-3.4, 1.0, 2.4);
  g.add(fill);

  const rim = new THREE.DirectionalLight(0xf2ecff, 1.0);
  rim.position.set(-2.2, 2.0, -3.4);
  g.add(rim);

  scene.add(g);
  return { group: g, key: key };
}

export function makeFabricMaterial(spec, map) {
  const common = {
    map: map || null,
    color: 0xffffff,           /* colourway is baked into the atlas */
    roughness: spec.rough != null ? spec.rough : 0.86,
    metalness: 0.0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    vertexColors: true,        /* baked AO */
    envMapIntensity: 0.42,
    dithering: true            /* kills banding in the dark gradient */
  };

  /* Physical only where it earns its cost. Cotton jersey has almost no sheen
     and the difference would be invisible; the bodycon's spandex highlight and
     the sweatshirt's fleece halo are the two places it reads. */
  if (spec.sheen) {
    return new THREE.MeshPhysicalMaterial(Object.assign({}, common, {
      sheen: spec.sheen,
      sheenRoughness: spec.sheenRough != null ? spec.sheenRough : 0.6,
      sheenColor: new THREE.Color(0xffffff)
    }));
  }
  return new THREE.MeshStandardMaterial(common);
}

/* A contact shadow needs something to fall on. Against a flat near-black
   background a black shadow is simply invisible, so the studio gets a floor:
   a soft radial pool, slightly lifted off the background, fading out well
   before the edges so it never reads as a hard disc. */
export function buildFloor() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0.00, '#3a3a40');
  g.addColorStop(0.45, '#23232a');
  g.addColorStop(0.78, '#131317');
  g.addColorStop(1.00, '#0d0d0e');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  /* The plane has to be big enough that its far edge is never in frame - a
     9-unit floor reads as a horizon line across the middle of the stage. Keep
     the pool small by repeating the gradient and clamping, so everything past
     it is background colour and the floor has no visible edge at all. */
  const SPAN = 44, POOL = 9;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(SPAN / POOL, SPAN / POOL);
  tex.offset.set(-(SPAN / POOL - 1) / 2, -(SPAN / POOL - 1) / 2);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.94, metalness: 0.0, envMapIntensity: 0.18
    })
  );
  mesh.receiveShadow = true;
  return mesh;
}

export function makePropMaterial(colour) {
  return new THREE.MeshStandardMaterial({
    color: colour != null ? colour : 0x8d8d92,
    roughness: 0.72,
    metalness: 0.0,
    envMapIntensity: 0.5
  });
}

/* ------------------------------------------------------ contact shadow ---- */

/* Ported from the official webgl_shadow_contact example. This is what actually
   grounds the figure; without it a dark studio render floats. Re-rendered only
   when the outfit changes, not every frame. */
export function createContactShadow(renderer, opts) {
  opts = opts || {};
  const size = opts.size || 3.0;
  const res = opts.res || 512;
  const height = opts.height || 1.2;
  const darkness = opts.darkness != null ? opts.darkness : 1.35;

  const group = new THREE.Group();
  group.position.y = opts.y != null ? opts.y : -1.75;

  const rt = new THREE.WebGLRenderTarget(res, res);
  rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(res, res);
  rtBlur.texture.generateMipmaps = false;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: rt.texture, opacity: opts.opacity != null ? opts.opacity : 0.9,
      transparent: true, depthWrite: false
    })
  );
  plane.scale.y = -1;          /* the render target comes out flipped */
  plane.renderOrder = 1;
  group.add(plane);

  const camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
  camera.rotation.x = Math.PI / 2;
  group.add(camera);

  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.userData.darkness = { value: darkness };
  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = depthMat.userData.darkness;
    shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
    );
  };
  depthMat.depthTest = false;
  depthMat.depthWrite = false;

  const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size));
  blurPlane.visible = false;
  group.add(blurPlane);

  let hBlur = null, vBlur = null;

  function setShaders(H, V) {
    hBlur = new THREE.ShaderMaterial(H);
    vBlur = new THREE.ShaderMaterial(V);
    hBlur.depthTest = false;
    vBlur.depthTest = false;
  }

  function blur(amount) {
    if (!hBlur) return;
    blurPlane.visible = true;

    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse.value = rt.texture;
    hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurPlane, camera);

    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse.value = rtBlur.texture;
    vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(rt);
    renderer.render(blurPlane, camera);

    blurPlane.visible = false;
  }

  function update(scene) {
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = depthMat;
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;

    blur(2.4);
    /* second, weaker pass: below about 0.4 the blur artifacts come back */
    blur(2.4 * 0.4);

    renderer.setRenderTarget(null);
    renderer.setClearAlpha(clearAlpha);
    scene.background = bg;
  }

  return { group, update, setShaders, plane };
}
