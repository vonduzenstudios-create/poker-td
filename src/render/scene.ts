// Renderer, camera, post-processing and the static level: grid floor, felt path, sky and sun.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MAP_H, MAP_W, PATH_POINTS, TILE } from '../game/data';
import { neonMat, toonMat, toonMesh } from './toon';

export function tileToWorld(tx: number, ty: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((tx - MAP_W / 2 + 0.5) * TILE, 0, (ty - MAP_H / 2 + 0.5) * TILE);
}

export function worldToTile(x: number, z: number): [number, number] {
  return [Math.floor(x / TILE + MAP_W / 2), Math.floor(z / TILE + MAP_H / 2)];
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  hover: THREE.Mesh;
  rangeRing: THREE.Mesh;
  /** Every path tile as "x,y". */
  pathTiles = new Set<string>();
  /** Path corners in world space. */
  waypoints: THREE.Vector3[] = [];
  private lights: THREE.InstancedMesh;
  private lightCount = 0;
  private camTarget = new THREE.Vector3(0, 0, 1.5);
  private camDist = 29;
  private camYaw = 0;
  private keys = new Set<string>();
  private time = 0;
  private gridMat: THREE.ShaderMaterial;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 400);
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x2a0845, 60, 160);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // lights: a warm key light for the toon bands, cool fill, ambient for the shadow band
    this.scene.add(new THREE.HemisphereLight(0xb08cff, 0x2a0845, 1.4));
    const key = new THREE.DirectionalLight(0xfff0f8, 2.4);
    key.position.set(-18, 30, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 90;
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00f0ff, 0.8);
    rim.position.set(20, 10, -20);
    this.scene.add(rim);

    this.gridMat = gridMaterial();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), this.gridMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.6;
    this.scene.add(floor);

    // shadow catcher on top of the shader floor
    const shadowCatch = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_W * TILE + 6, MAP_H * TILE + 6),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    shadowCatch.rotation.x = -Math.PI / 2;
    shadowCatch.position.y = 0.01;
    shadowCatch.receiveShadow = true;
    this.scene.add(shadowCatch);

    this.buildBoard();
    this.lights = this.buildPath();
    this.buildSun();
    this.buildDecor();

    this.hover = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.92, 0.08, TILE * 0.92), neonMat(0x00f0ff, 1.5, 0.55));
    this.hover.visible = false;
    this.scene.add(this.hover);
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), neonMat(0xffffff, 1.4, 0.6));
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.position.y = 0.08;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.02, 16, 50);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.updateCamera(0);
  }

  isBuildable(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && !this.pathTiles.has(`${tx},${ty}`);
  }

  private buildBoard() {
    // a raised table top under the play area with a neon trim
    const w = MAP_W * TILE;
    const h = MAP_H * TILE;
    const table = toonMesh(new THREE.BoxGeometry(w + 1.2, 0.5, h + 1.2), toonMat(0x1b0b30), 0.08);
    table.position.y = -0.27;
    table.receiveShadow = true;
    this.scene.add(table);
    // dim grout between tiles, bright neon only on the rim
    const grout = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, h), new THREE.MeshBasicMaterial({ color: 0x4a1660 }));
    grout.position.y = -0.03;
    this.scene.add(grout);
    const rimMat = neonMat(0xff3df2, 2);
    for (const [rw, rh, x, z] of [[w + 1.4, 0.3, 0, -(h + 1.1) / 2], [w + 1.4, 0.3, 0, (h + 1.1) / 2], [0.3, h + 1.4, -(w + 1.1) / 2, 0], [0.3, h + 1.4, (w + 1.1) / 2, 0]]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.1, rh), rimMat);
      rim.position.set(x, 0, z);
      this.scene.add(rim);
    }
    // tile checker so build spots read clearly
    const geo = new THREE.BoxGeometry(TILE * 0.94, 0.04, TILE * 0.94);
    const tiles = new THREE.InstancedMesh(geo, toonMat(0xffffff), MAP_W * MAP_H);
    tiles.receiveShadow = true;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    let i = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        tileToWorld(x, y, p);
        m.makeTranslation(p.x, 0.0, p.z);
        tiles.setMatrixAt(i, m);
        tiles.setColorAt(i, col.set((x + y) % 2 ? 0x2b1150 : 0x341660));
        i++;
      }
    }
    this.scene.add(tiles);
  }

  private buildPath(): THREE.InstancedMesh {
    const pts = PATH_POINTS.map(([x, y]) => tileToWorld(x, y));
    this.waypoints = pts;
    // mark tiles
    for (let i = 0; i < PATH_POINTS.length - 1; i++) {
      const [ax, ay] = PATH_POINTS[i];
      const [bx, by] = PATH_POINTS[i + 1];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / steps);
        const y = Math.round(ay + ((by - ay) * s) / steps);
        this.pathTiles.add(`${x},${y}`);
      }
    }
    // felt strip segments
    const felt = toonMat(0x0f6b5c);
    const edgeLights: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b) + TILE * 0.9;
      const seg = toonMesh(new THREE.BoxGeometry(TILE * 0.9, 0.1, len), felt, 0.05);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.position.y = 0.06;
      seg.lookAt(b.x, 0.06, b.z);
      seg.receiveShadow = true;
      this.scene.add(seg);
      // chase lights along both edges
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(TILE * 0.5);
      const d = a.distanceTo(b);
      for (let t = 0; t < d; t += 0.8) {
        const p = a.clone().addScaledVector(dir, t);
        edgeLights.push(p.clone().add(side), p.clone().sub(side));
      }
    }
    const bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 6, 4),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      edgeLights.length,
    );
    const m = new THREE.Matrix4();
    edgeLights.forEach((p, i) => {
      m.makeTranslation(p.x, 0.16, p.z);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, new THREE.Color(0xffe66d));
    });
    this.lightCount = edgeLights.length;
    this.scene.add(bulbs);

    // entrance and exit arches
    this.scene.add(arch(pts[0], pts[1], 0x00f0ff));
    this.scene.add(arch(pts[pts.length - 1], pts[pts.length - 2], 0xff3df2));
    return bulbs;
  }

  private buildSun() {
    const sun = new THREE.Mesh(new THREE.CircleGeometry(38, 64), sunMaterial());
    sun.position.set(0, 12, -150);
    this.scene.add(sun);
  }

  private buildDecor() {
    // giant chip stacks and cards around the edges of the table, purely scenery
    const rnd = mulberry(7);
    const colors = [0xff2fa8, 0x00f0ff, 0xffe66d, 0x7b2ff7];
    for (let i = 0; i < 18; i++) {
      const side = i % 4;
      const along = rnd() * 2 - 1;
      const x = side < 2 ? along * (MAP_W + 6) : (side === 2 ? -1 : 1) * (MAP_W + 5 + rnd() * 6);
      const z = side < 2 ? (side === 0 ? -1 : 1) * (MAP_H + 5 + rnd() * 6) : along * (MAP_H + 4);
      const n = 2 + Math.floor(rnd() * 6);
      const c = colors[i % colors.length];
      for (let k = 0; k < n; k++) {
        const chip = toonMesh(new THREE.CylinderGeometry(1.4, 1.4, 0.45, 20), toonMat(c, 0.15), 0.06);
        chip.position.set(x + (rnd() - 0.5) * 0.3, 0.25 + k * 0.48, z + (rnd() - 0.5) * 0.3);
        this.scene.add(chip);
      }
    }
    // palm silhouettes on the horizon
    for (let i = 0; i < 10; i++) {
      const x = -90 + i * 20 + rnd() * 6;
      const z = -95 - rnd() * 20;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 14, 6), new THREE.MeshBasicMaterial({ color: 0x14002a }));
      trunk.position.set(x, 7, z);
      trunk.rotation.z = (rnd() - 0.5) * 0.3;
      this.scene.add(trunk);
      for (let l = 0; l < 6; l++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.6, 7, 4), new THREE.MeshBasicMaterial({ color: 0x14002a }));
        leaf.position.set(x, 14, z);
        leaf.rotation.z = Math.PI / 2.4;
        leaf.rotation.y = (l / 6) * Math.PI * 2;
        leaf.translateY(3);
        this.scene.add(leaf);
      }
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  updateCamera(dt: number) {
    const pan = 18 * dt;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.camTarget.x -= pan;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.camTarget.x += pan;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.camTarget.z -= pan;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.camTarget.z += pan;
    if (this.keys.has('q')) this.camYaw -= dt;
    if (this.keys.has('e')) this.camYaw += dt;
    this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x, -20, 20);
    this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z, -14, 14);
    const tilt = 0.95; // radians from horizontal-ish, top-down with a lean
    const y = Math.sin(tilt) * this.camDist;
    const back = Math.cos(tilt) * this.camDist;
    this.camera.position.set(
      this.camTarget.x + Math.sin(this.camYaw) * back,
      y,
      this.camTarget.z + Math.cos(this.camYaw) * back,
    );
    this.camera.lookAt(this.camTarget);
  }

  /** Small camera shake for the boss and big hits. */
  shake = 0;

  render(dt: number) {
    this.time += dt;
    this.updateCamera(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.gridMat.uniforms.uTime.value = this.time;
    // chase lights: a moving band of bright bulbs
    const col = new THREE.Color();
    for (let i = 0; i < this.lightCount; i++) {
      const k = (Math.floor(i / 2) - this.time * 12) % 6;
      const on = ((k + 6) % 6) < 2;
      this.lights.setColorAt(i, col.set(on ? 0xffffff : 0xff9a3c).multiplyScalar(on ? 3 : 0.7));
    }
    this.lights.instanceColor!.needsUpdate = true;
    this.composer.render();
  }
}

function arch(at: THREE.Vector3, toward: THREE.Vector3, color: number): THREE.Group {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.14, 8, 24, Math.PI), neonMat(color, 2.5));
  g.add(r);
  for (const x of [-1.6, 1.6]) {
    const post = toonMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), toonMat(0x1b0b30));
    post.position.set(x, 0.15, 0);
    g.add(post);
  }
  g.position.copy(at);
  g.lookAt(toward.x, 0, toward.z);
  return g;
}

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0b0322');
  grad.addColorStop(0.45, '#3a0d6b');
  grad.addColorStop(0.75, '#b0277a');
  grad.addColorStop(1, '#ff7b54');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz / 4.0;
        p.y += uTime * 0.4;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float dist = length(vWorld.xz);
        float fade = smoothstep(150.0, 30.0, dist);
        vec3 base = mix(vec3(0.05, 0.0, 0.12), vec3(0.16, 0.02, 0.25), fade);
        vec3 lineCol = mix(vec3(1.0, 0.24, 0.95), vec3(0.0, 0.94, 1.0), 0.5 + 0.5 * sin(dist * 0.05 - uTime * 0.5));
        gl_FragColor = vec4(base + lineCol * line * fade * 0.9, 1.0);
      }`,
  });
}

function sunMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vec3 top = vec3(1.0, 0.92, 0.42);
        vec3 bot = vec3(1.0, 0.18, 0.55);
        vec3 col = mix(bot, top, vUv.y) * 1.6;
        float y = vUv.y;
        float stripes = y < 0.48 ? step(0.35 + (0.48 - y) * 0.9, fract(y * 16.0)) : 1.0;
        if (stripes < 0.5) discard;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function mulberry(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
