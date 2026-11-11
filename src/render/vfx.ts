// Procedural attack effects: GPU point particles, spark streaks, cel shaded rock debris,
// camera facing lightning ribbons, shader shockwaves, ground decals and pooled flash lights.
// Nothing here loads a file; every texture and shape is generated in code.
import * as THREE from 'three';
import { toonMatUnique } from './toon';

/** Shapes drawn by the particle fragment shader. */
export const enum Shape {
  Glow = 0,
  Spark = 1,
  Snow = 2,
  Glint = 3,
  Smoke = 4,
  Bubble = 5,
}

export interface ParticleSpec {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  size1?: number;
  color: THREE.Color | number;
  color1?: THREE.Color | number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  shape?: Shape;
  /** Fade in over the first part of the life (smoke). */
  soft?: boolean;
}

const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Random unit vector, optionally biased upward. */
function randDir(out: THREE.Vector3, upBias = 0): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out.set(s * Math.cos(th), u, s * Math.sin(th));
  out.y = out.y * (1 - upBias) + upBias * Math.abs(out.y) + upBias * 0.5;
  return out.normalize();
}

// ------------------------------------------------------------------ point particles

const P_VERT = /* glsl */ `
attribute float psize;
attribute float palpha;
attribute float pshape;
attribute vec3 pcolor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = psize * uScale / max(0.1, -mv.z);
  vColor = pcolor;
  vAlpha = palpha;
  vShape = pshape;
  vRot = position.x * 3.1 + position.z * 1.7;
}`;

const P_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = 0.0;
  if (vShape < 0.5) {
    a = 1.0 - r; a *= a;
  } else if (vShape < 1.5) {
    a = smoothstep(1.0, 0.0, r) * 0.35 + smoothstep(0.35, 0.0, r);
  } else if (vShape < 2.5) {
    float ang = atan(p.y, p.x) + vRot;
    float arms = pow(abs(cos(ang * 3.0)), 18.0);
    float tips = pow(abs(cos(ang * 3.0 + 1.5708)), 30.0) * step(0.45, r) * step(r, 0.6);
    a = (1.0 - r) * (arms + tips) * 1.6 + smoothstep(0.25, 0.0, r);
  } else if (vShape < 3.5) {
    float ang = atan(p.y, p.x);
    float arms = pow(abs(cos(ang * 2.0)), 40.0);
    a = (1.0 - r) * arms * 1.8 + smoothstep(0.3, 0.0, r) + (1.0 - r) * 0.15;
  } else if (vShape < 4.5) {
    float n = sin(p.x * 5.0 + vRot) * sin(p.y * 4.0 - vRot) * 0.25;
    a = smoothstep(1.0, 0.15, r + n);
  } else {
    a = smoothstep(0.18, 0.0, abs(r - 0.78)) + smoothstep(0.18, 0.0, length(p - vec2(-0.3, 0.32))) * 0.8;
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, min(a, 1.0));
}`;

class Particles {
  readonly points: THREE.Points;
  private cap: number;
  private cursor = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private soft: Uint8Array;
  private gCol: Float32Array;
  private gSize: Float32Array;
  private gAlpha: Float32Array;
  private gShape: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  private live = 0;

  constructor(cap: number, blending: THREE.Blending) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col0 = new Float32Array(cap * 3);
    this.col1 = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap).fill(1);
    this.life.fill(1);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.soft = new Uint8Array(cap);
    this.gCol = new Float32Array(cap * 3);
    this.gSize = new Float32Array(cap);
    this.gAlpha = new Float32Array(cap);
    this.gShape = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('palpha', new THREE.BufferAttribute(this.gAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pshape', new THREE.BufferAttribute(this.gShape, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      uniforms: { uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 6 : 5;
  }

  emit(s: ParticleSpec) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = s.pos.x; this.pos[i3 + 1] = s.pos.y; this.pos[i3 + 2] = s.pos.z;
    const v = s.vel;
    this.vel[i3] = v ? v.x : 0; this.vel[i3 + 1] = v ? v.y : 0; this.vel[i3 + 2] = v ? v.z : 0;
    const c0 = typeof s.color === 'number' ? tmpC.set(s.color) : s.color;
    const c1 = s.color1 === undefined ? c0 : typeof s.color1 === 'number' ? tmpC2.set(s.color1) : s.color1;
    this.col0[i3] = c0.r; this.col0[i3 + 1] = c0.g; this.col0[i3 + 2] = c0.b;
    this.col1[i3] = c1.r; this.col1[i3 + 1] = c1.g; this.col1[i3 + 2] = c1.b;
    this.life[i] = 0;
    this.max[i] = s.life;
    this.s0[i] = s.size;
    this.s1[i] = s.size1 ?? s.size * 0.2;
    this.a0[i] = s.alpha ?? 1;
    this.grav[i] = s.gravity ?? 0;
    this.drag[i] = s.drag ?? 0;
    this.soft[i] = s.soft ? 1 : 0;
    this.gShape[i] = s.shape ?? Shape.Glow;
    this.live = Math.min(this.cap, this.live + 1);
  }

  update(dt: number, scale: number) {
    this.mat.uniforms.uScale.value = scale;
    const { pos, vel, life, max } = this;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] >= max[i]) {
        this.gAlpha[i] = 0;
        this.gSize[i] = 0;
        continue;
      }
      life[i] += dt;
      const k = Math.min(1, life[i] / max[i]);
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - this.grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.05 && this.grav[i] > 0) { pos[i3 + 1] = 0.05; vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      const fadeIn = this.soft[i] ? Math.min(1, k * 6) : 1;
      this.gAlpha[i] = this.a0[i] * fadeIn * Math.pow(1 - k, this.soft[i] ? 1.5 : 1.1);
      this.gSize[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.gCol[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * k;
      this.gCol[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * k;
      this.gCol[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * k;
    }
    for (const name of ['position', 'pcolor', 'psize', 'palpha', 'pshape']) this.geo.getAttribute(name).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ spark streaks

class Streaks {
  readonly lines: THREE.LineSegments;
  private cap: number;
  private cursor = 0;
  private p: Float32Array;
  private v: Float32Array;
  private c: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private len: Float32Array;
  private grav: Float32Array;
  private gPos: Float32Array;
  private gCol: Float32Array;
  private geo = new THREE.BufferGeometry();

  constructor(cap: number) {
    this.cap = cap;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.c = new Float32Array(cap * 3);
    this.life = new Float32Array(cap).fill(1);
    this.max = new Float32Array(cap).fill(1);
    this.len = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.gPos = new Float32Array(cap * 6);
    this.gCol = new Float32Array(cap * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.gCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, life: number, len = 0.05, gravity = 12) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.p[i3] = pos.x; this.p[i3 + 1] = pos.y; this.p[i3 + 2] = pos.z;
    this.v[i3] = vel.x; this.v[i3 + 1] = vel.y; this.v[i3 + 2] = vel.z;
    this.c[i3] = color.r; this.c[i3 + 1] = color.g; this.c[i3 + 2] = color.b;
    this.life[i] = 0;
    this.max[i] = life;
    this.len[i] = len;
    this.grav[i] = gravity;
  }

  update(dt: number) {
    const { p, v, c, gPos, gCol } = this;
    for (let i = 0; i < this.cap; i++) {
      const i3 = i * 3;
      const i6 = i * 6;
      if (this.life[i] >= this.max[i]) {
        gCol[i6] = gCol[i6 + 1] = gCol[i6 + 2] = gCol[i6 + 3] = gCol[i6 + 4] = gCol[i6 + 5] = 0;
        continue;
      }
      this.life[i] += dt;
      const k = Math.min(1, this.life[i] / this.max[i]);
      v[i3 + 1] -= this.grav[i] * dt;
      v[i3] *= 1 - 2 * dt; v[i3 + 2] *= 1 - 2 * dt;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.05) { p[i3 + 1] = 0.05; v[i3 + 1] *= -0.3; }
      const L = this.len[i];
      gPos[i6] = p[i3]; gPos[i6 + 1] = p[i3 + 1]; gPos[i6 + 2] = p[i3 + 2];
      gPos[i6 + 3] = p[i3] - v[i3] * L; gPos[i6 + 4] = p[i3 + 1] - v[i3 + 1] * L; gPos[i6 + 5] = p[i3 + 2] - v[i3 + 2] * L;
      const f = (1 - k) * (1 - k);
      gCol[i6] = c[i3] * f; gCol[i6 + 1] = c[i3 + 1] * f; gCol[i6 + 2] = c[i3 + 2] * f;
      gCol[i6 + 3] = c[i3] * f * 0.15; gCol[i6 + 4] = c[i3 + 1] * f * 0.15; gCol[i6 + 5] = c[i3 + 2] * f * 0.15;
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
  }
}

// ------------------------------------------------------------------ instanced cel shaded chunks (rock, ice)

class Chunks {
  readonly mesh: THREE.InstancedMesh;
  private cap: number;
  private cursor = 0;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private rv: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;

  constructor(cap: number, geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.r = new Float32Array(cap * 3);
    this.rv = new Float32Array(cap * 3);
    this.life = new Float32Array(cap).fill(1);
    this.max = new Float32Array(cap).fill(1);
    this.size = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, tmpC.set(0xffffff));
    }
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color | number, life: number, gravity = 22) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.p[i3] = pos.x; this.p[i3 + 1] = pos.y; this.p[i3 + 2] = pos.z;
    this.v[i3] = vel.x; this.v[i3 + 1] = vel.y; this.v[i3 + 2] = vel.z;
    for (let k = 0; k < 3; k++) { this.r[i3 + k] = Math.random() * 6; this.rv[i3 + k] = rand(-12, 12); }
    this.life[i] = 0;
    this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity;
    this.mesh.setColorAt(i, typeof color === 'number' ? tmpC.set(color) : color);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    const { p, v, r, rv } = this;
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] >= this.max[i]) {
        if (this.life[i] < 1e9) { this.life[i] = 1e9; this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); any = true; }
        continue;
      }
      any = true;
      this.life[i] += dt;
      const k = this.life[i] / this.max[i];
      const i3 = i * 3;
      v[i3 + 1] -= this.grav[i] * dt;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      const s = this.size[i] * Math.min(1, (1 - k) * 4);
      if (p[i3 + 1] < s * 0.5) {
        p[i3 + 1] = s * 0.5;
        v[i3 + 1] *= -0.3; v[i3] *= 0.55; v[i3 + 2] *= 0.55;
        rv[i3] *= 0.6; rv[i3 + 1] *= 0.6; rv[i3 + 2] *= 0.6;
      }
      r[i3] += rv[i3] * dt; r[i3 + 1] += rv[i3 + 1] * dt; r[i3 + 2] += rv[i3 + 2] * dt;
      tmpQ.setFromEuler(tmpE.set(r[i3], r[i3 + 1], r[i3 + 2]));
      tmpM.compose(tmpV.set(p[i3], p[i3 + 1], p[i3 + 2]), tmpQ, tmpV2.setScalar(Math.max(0.0001, s)));
      this.mesh.setMatrixAt(i, tmpM);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ lightning ribbons

const BOLT_VERT = /* glsl */ `
attribute vec3 tangent3;
attribute float side;
attribute float along;
uniform float uWidth;
varying float vSide;
varying float vAlong;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 mt = modelViewMatrix * vec4(position + tangent3, 1.0);
  vec2 d = normalize(mt.xy - mv.xy + 1e-5);
  float taper = 0.35 + 0.65 * sin(3.14159 * clamp(along, 0.0, 1.0));
  mv.xy += vec2(-d.y, d.x) * side * uWidth * taper;
  gl_Position = projectionMatrix * mv;
  vSide = side;
  vAlong = along;
}`;

const BOLT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uCore;
varying float vSide;
void main() {
  float s = abs(vSide);
  float a = uCore > 0.5 ? smoothstep(1.0, 0.2, s) : pow(1.0 - s, 2.0);
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const BOLT_MAX_PTS = 96;

class Bolt {
  readonly group = new THREE.Group();
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(BOLT_MAX_PTS * 2 * 3);
  private tan = new Float32Array(BOLT_MAX_PTS * 2 * 3);
  private side = new Float32Array(BOLT_MAX_PTS * 2);
  private along = new Float32Array(BOLT_MAX_PTS * 2);
  private glowMat: THREE.ShaderMaterial;
  private coreMat: THREE.ShaderMaterial;
  from = new THREE.Vector3();
  to = new THREE.Vector3();
  life = 1;
  max = 1;
  private rejitter = 0;
  private jag = 0.6;
  private branches = 2;
  active = false;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('tangent3', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('side', new THREE.BufferAttribute(this.side, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('along', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(new Uint16Array(BOLT_MAX_PTS * 6), 1).setUsage(THREE.DynamicDrawUsage));
    const mk = (core: boolean) => new THREE.ShaderMaterial({
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      uniforms: {
        uWidth: { value: core ? 0.05 : 0.32 },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        uCore: { value: core ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.glowMat = mk(false);
    this.coreMat = mk(true);
    const glow = new THREE.Mesh(this.geo, this.glowMat);
    const core = new THREE.Mesh(this.geo, this.coreMat);
    glow.frustumCulled = core.frustumCulled = false;
    glow.renderOrder = 8;
    core.renderOrder = 9;
    this.group.add(glow, core);
    this.group.visible = false;
  }

  fire(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, life: number, width: number, jag: number, branches: number) {
    this.from.copy(from);
    this.to.copy(to);
    this.life = 0;
    this.max = life;
    this.jag = jag;
    this.branches = branches;
    this.active = true;
    this.group.visible = true;
    (this.glowMat.uniforms.uColor.value as THREE.Color).copy(color).multiplyScalar(1.3);
    (this.coreMat.uniforms.uColor.value as THREE.Color).copy(color).lerp(tmpC.set(0xffffff), 0.6).multiplyScalar(3);
    this.glowMat.uniforms.uWidth.value = width;
    this.coreMat.uniforms.uWidth.value = width * 0.22;
    this.rebuild();
  }

  /** Midpoint displaced jagged path with a few forks. */
  private rebuild() {
    const idx = this.geo.index!.array as Uint16Array;
    let vi = 0;
    let ii = 0;
    const strip = (pts: THREE.Vector3[]) => {
      if (vi / 2 + pts.length > BOLT_MAX_PTS) return;
      const base = vi;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        tmpV.subVectors(b, a);
        for (const s of [-1, 1]) {
          const o = vi * 3;
          this.pos[o] = pts[i].x; this.pos[o + 1] = pts[i].y; this.pos[o + 2] = pts[i].z;
          this.tan[o] = tmpV.x; this.tan[o + 1] = tmpV.y; this.tan[o + 2] = tmpV.z;
          this.side[vi] = s;
          this.along[vi] = i / (pts.length - 1);
          vi++;
        }
        if (i > 0) {
          const p0 = base + (i - 1) * 2;
          const p1 = base + i * 2;
          idx[ii++] = p0; idx[ii++] = p0 + 1; idx[ii++] = p1;
          idx[ii++] = p1; idx[ii++] = p0 + 1; idx[ii++] = p1 + 1;
        }
      }
    };
    const main = jagged(this.from, this.to, 4, this.jag);
    strip(main);
    for (let b = 0; b < this.branches; b++) {
      const start = main[1 + Math.floor(Math.random() * (main.length - 3))];
      const dir = tmpV2.subVectors(this.to, this.from);
      const len = dir.length() * rand(0.2, 0.4);
      dir.normalize().add(randDir(new THREE.Vector3()).multiplyScalar(0.9)).normalize();
      const end = start.clone().addScaledVector(dir, len);
      end.y = Math.max(0.2, end.y);
      strip(jagged(start, end, 3, this.jag * 0.6));
    }
    this.geo.setDrawRange(0, ii);
    for (const n of ['position', 'tangent3', 'side', 'along']) this.geo.getAttribute(n).needsUpdate = true;
    this.geo.index!.needsUpdate = true;
  }

  update(dt: number) {
    if (!this.active) return;
    this.life += dt;
    const k = this.life / this.max;
    if (k >= 1) {
      this.active = false;
      this.group.visible = false;
      return;
    }
    this.rejitter -= dt;
    if (this.rejitter <= 0) {
      this.rejitter = 0.045;
      this.rebuild();
    }
    // a strobing fade, like a real arc
    const flick = 0.65 + 0.35 * Math.random();
    const o = (1 - k) * flick;
    this.glowMat.uniforms.uOpacity.value = o;
    this.coreMat.uniforms.uOpacity.value = Math.min(1, o * 1.6);
  }
}

function jagged(a: THREE.Vector3, b: THREE.Vector3, depth: number, amount: number): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()];
  let amt = amount * Math.min(1.5, a.distanceTo(b) / 4);
  for (let d = 0; d < depth; d++) {
    const next: THREE.Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
      m.x += (Math.random() - 0.5) * amt;
      m.y += (Math.random() - 0.5) * amt * 0.6;
      m.z += (Math.random() - 0.5) * amt;
      next.push(m, pts[i + 1]);
    }
    pts = next;
    amt *= 0.55;
  }
  return pts;
}

// ------------------------------------------------------------------ shockwave rings

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uWidth;
uniform float uFill;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float R = 0.08 + uK * 0.92;
  float ring = exp(-pow((r - R) / uWidth, 2.0));
  float inner = smoothstep(R, 0.0, r) * uFill;
  float a = (ring + inner) * (1.0 - uK) * step(r, 1.0);
  gl_FragColor = vec4(uColor, a);
}`;
const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface Timed {
  life: number;
  max: number;
  update(k: number, dt: number): void;
  done(): void;
}

// ------------------------------------------------------------------ procedural decal textures

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function craterTex() {
  return canvasTex((g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(8,0,18,0.95)');
    grad.addColorStop(0.45, 'rgba(25,6,45,0.8)');
    grad.addColorStop(0.75, 'rgba(40,12,70,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      let a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      let r = s * 0.12;
      g.beginPath();
      g.moveTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
      while (r < s * 0.46) {
        r += s * 0.05;
        a += (Math.random() - 0.5) * 0.5;
        g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
      }
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 3;
      g.stroke();
    }
  });
}

function frostTex() {
  return canvasTex((g, s) => {
    const h = s / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(220,250,255,0.75)');
    grad.addColorStop(0.55, 'rgba(140,220,255,0.45)');
    grad.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (depth > 0) {
        for (const t of [0.4, 0.7]) {
          const bx = x + (x2 - x) * t;
          const by = y + (y2 - y) * t;
          branch(bx, by, a + 0.9, len * 0.35, w * 0.6, depth - 1);
          branch(bx, by, a - 0.9, len * 0.35, w * 0.6, depth - 1);
        }
      }
    };
    for (let i = 0; i < 8; i++) branch(h, h, (i / 8) * Math.PI * 2 + Math.random() * 0.3, s * rand(0.3, 0.45), 3, 2);
  });
}

function scorchTex() {
  return canvasTex((g, s) => {
    const h = s / 2;
    for (let i = 0; i < 14; i++) {
      const x = h + (Math.random() - 0.5) * s * 0.35;
      const y = h + (Math.random() - 0.5) * s * 0.35;
      const r = s * rand(0.15, 0.32);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(10,0,10,0.45)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }
  });
}

// ------------------------------------------------------------------ the public effects API

export type Element = 'H' | 'S' | 'C' | 'D' | null;

const FROST = 0x9fe8ff;
const ICE = 0xd8f6ff;
const FIRE0 = 0xffe27a;
const FIRE1 = 0xff2a3c;
const TOXIC = 0x39ff88;
const GOLD = 0xffd700;

export class Vfx {
  private add: Particles;
  private alpha: Particles;
  private streaks: Streaks;
  private rocks: Chunks;
  private ice: Chunks;
  private bolts: Bolt[] = [];
  private lights: { light: THREE.PointLight; life: number; max: number; peak: number }[] = [];
  private timed: Timed[] = [];
  private ringGeo = new THREE.PlaneGeometry(2, 2);
  private decalGeo = new THREE.PlaneGeometry(2, 2);
  private tex: { crater: THREE.Texture; frost: THREE.Texture; scorch: THREE.Texture } | null = null;
  private spikeGeo = new THREE.ConeGeometry(0.16, 1, 5);
  private spikeMat = toonMatUnique(0xbff4ff, 0.6);
  private decals = 0;

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private renderer: THREE.WebGLRenderer) {
    this.add = new Particles(7000, THREE.AdditiveBlending);
    this.alpha = new Particles(2500, THREE.NormalBlending);
    this.streaks = new Streaks(1600);
    this.rocks = new Chunks(260, new THREE.DodecahedronGeometry(1, 0), toonMatUnique(0xffffff, 0));
    const iceMat = toonMatUnique(0xffffff, 0.35);
    this.ice = new Chunks(200, new THREE.OctahedronGeometry(1, 0).scale(0.6, 1.4, 0.6), iceMat);
    scene.add(this.alpha.points, this.add.points, this.streaks.lines, this.rocks.mesh, this.ice.mesh);
    for (let i = 0; i < 18; i++) {
      const b = new Bolt();
      this.bolts.push(b);
      scene.add(b.group);
    }
    // a fixed pool of lights keeps the shader light count constant (no recompiles)
    for (let i = 0; i < 6; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 9, 1.6);
      light.position.set(0, -50, 0);
      scene.add(light);
      this.lights.push({ light, life: 1, max: 1, peak: 0 });
    }
  }

  private textures() {
    this.tex ??= { crater: craterTex(), frost: frostTex(), scorch: scorchTex() };
    return this.tex;
  }

  update(dt: number) {
    const h = this.renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.add.update(dt, scale);
    this.alpha.update(dt, scale);
    this.streaks.update(dt);
    this.rocks.update(dt);
    this.ice.update(dt);
    for (const b of this.bolts) b.update(dt);
    for (const l of this.lights) {
      if (l.life >= l.max) continue;
      l.life += dt;
      const k = Math.min(1, l.life / l.max);
      l.light.intensity = l.peak * (1 - k) * (1 - k);
      if (k >= 1) l.light.position.y = -50;
    }
    this.timed = this.timed.filter((t) => {
      t.life += dt;
      const k = Math.min(1, t.life / t.max);
      t.update(k, dt);
      if (k >= 1) t.done();
      return k < 1;
    });
  }

  private after(max: number, update: (k: number, dt: number) => void, done: () => void = () => {}) {
    this.timed.push({ life: 0, max, update, done });
  }

  // ---------------------------------------------------------------- primitives

  flash(at: THREE.Vector3, color: number, intensity: number, dur: number) {
    let best = this.lights[0];
    for (const l of this.lights) {
      const rem = l.max - l.life;
      if (rem < best.max - best.life) best = l;
    }
    best.light.position.copy(at).setY(Math.max(at.y, 1.2));
    best.light.color.set(color);
    best.life = 0;
    best.max = dur;
    best.peak = intensity;
    best.light.intensity = intensity;
  }

  shockwave(at: THREE.Vector3, radius: number, color: number, dur: number, width = 0.08, fill = 0.25, y = 0.2) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color).multiplyScalar(1.6) },
        uK: { value: 0 },
        uWidth: { value: width },
        uFill: { value: fill },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, y, at.z);
    m.scale.setScalar(radius);
    m.renderOrder = 4;
    this.scene.add(m);
    this.after(dur, (k) => (mat.uniforms.uK.value = 1 - Math.pow(1 - k, 2.4)), () => {
      this.scene.remove(m);
      mat.dispose();
    });
  }

  decal(at: THREE.Vector3, radius: number, kind: 'crater' | 'frost' | 'scorch', tint: number, dur: number) {
    if (this.decals > 40) return;
    this.decals++;
    const mat = new THREE.MeshBasicMaterial({
      map: this.textures()[kind], color: new THREE.Color(tint).multiplyScalar(kind === 'crater' ? 2.2 : 1), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, toneMapped: kind !== 'crater',
      blending: THREE.NormalBlending,
    });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(at.x, 0.14 + this.decals * 0.0005, at.z);
    m.scale.setScalar(radius);
    m.renderOrder = 3;
    this.scene.add(m);
    this.after(dur, (k) => {
      mat.opacity = k < 0.05 ? k / 0.05 : 1 - Math.pow(Math.max(0, (k - 0.5) / 0.5), 2);
    }, () => {
      this.scene.remove(m);
      mat.dispose();
      this.decals--;
    });
  }

  sparks(at: THREE.Vector3, color: number, count: number, speed: number, upBias = 0.3, life = 0.45) {
    const c = tmpC2.set(color).multiplyScalar(3);
    for (let i = 0; i < count; i++) {
      const v = randDir(tmpV, upBias).multiplyScalar(speed * rand(0.4, 1.2));
      this.streaks.emit(at, v, c, life * rand(0.6, 1.3), 0.035, 14);
    }
  }

  glow(at: THREE.Vector3, color: number, size: number, life: number, vel?: THREE.Vector3) {
    this.add.emit({ pos: at, vel, life, size, size1: size * 1.6, color: tmpC.set(color).multiplyScalar(2), shape: Shape.Glow });
  }

  // ---------------------------------------------------------------- attack effects

  muzzle(at: THREE.Vector3, color: number, scale = 1) {
    this.add.emit({ pos: at, life: 0.12, size: 1.1 * scale, size1: 0.2, color: tmpC.set(color).lerp(tmpC2.set(0xffffff), 0.5).multiplyScalar(3), shape: Shape.Spark });
    for (let i = 0; i < 4 * scale; i++) {
      this.add.emit({
        pos: at, vel: randDir(tmpV).multiplyScalar(rand(1, 3)), life: rand(0.15, 0.3), size: 0.3 * scale, size1: 0,
        color: tmpC.set(color).multiplyScalar(2.5), shape: Shape.Glow, drag: 4,
      });
    }
  }

  /** Called every frame for a flying projectile. */
  trail(at: THREE.Vector3, color: number, size: number, el: Element = null) {
    this.add.emit({ pos: at, life: 0.22, size: size * 2.2, size1: 0, color: tmpC.set(color).multiplyScalar(2.2), shape: Shape.Glow });
    if (el === 'H') {
      this.add.emit({ pos: at, vel: randDir(tmpV).multiplyScalar(0.8).setY(1.5), life: rand(0.3, 0.5), size: size * 2.5, size1: 0.05, color: FIRE0, color1: FIRE1, shape: Shape.Glow, drag: 2 });
    } else if (el === 'C') {
      if (Math.random() < 0.6) this.add.emit({ pos: at, vel: randDir(tmpV).multiplyScalar(0.6), life: 0.6, size: 0.3, size1: 0.1, color: tmpC.set(ICE).multiplyScalar(2), shape: Shape.Snow, gravity: 1.5 });
    } else if (el === 'S') {
      if (Math.random() < 0.5) this.add.emit({ pos: at, vel: tmpV.set(0, -1.5, 0), life: 0.5, size: 0.22, size1: 0.1, color: tmpC.set(TOXIC).multiplyScalar(1.6), shape: Shape.Bubble, gravity: 4 });
    } else if (el === 'D') {
      if (Math.random() < 0.4) this.add.emit({ pos: at, life: 0.35, size: 0.5, size1: 0, color: tmpC.set(0xff9cf0).multiplyScalar(2.5), shape: Shape.Glint });
    }
  }

  /** Small physical hit: sparks and a pop. */
  impact(at: THREE.Vector3, color: number, scale = 1) {
    this.add.emit({ pos: at, life: 0.14, size: 1.0 * scale, size1: 1.8 * scale, color: tmpC.set(color).multiplyScalar(2.5), shape: Shape.Glow });
    this.sparks(at, color, Math.round(6 * scale), 6 * scale, 0.35, 0.3);
  }

  /** Magic bolt hit: a ring of motes that flare outward. */
  arcaneHit(at: THREE.Vector3, color: number) {
    this.add.emit({ pos: at, life: 0.2, size: 1.4, size1: 0.2, color: tmpC.set(color).lerp(tmpC2.set(0xffffff), 0.4).multiplyScalar(3), shape: Shape.Glint });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.add.emit({ pos: at, vel: tmpV.set(Math.cos(a) * 4, rand(-0.5, 1.5), Math.sin(a) * 4), life: 0.35, size: 0.35, size1: 0, color: tmpC.set(color).multiplyScalar(2.5), drag: 6 });
    }
  }

  /** Chain lightning through a list of points (tower muzzle first). */
  chainLightning(points: THREE.Vector3[], color: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      // two overlapping bolts per hop makes a thicker, living arc
      for (let k = 0; k < 2; k++) {
        const bolt = this.freeBolt();
        bolt.fire(a, b, c, 0.28 + i * 0.03, k === 0 ? 0.3 : 0.18, k === 0 ? 1.1 : 0.7, k === 0 ? 2 : 1);
      }
      // node: hot orb, crackling sparks, and a quick electric ring
      this.add.emit({ pos: b, life: 0.22, size: 1.6, size1: 0.4, color: tmpC.copy(c).lerp(tmpC2.set(0xffffff), 0.5).multiplyScalar(2.2), shape: Shape.Spark });
      this.add.emit({ pos: b, life: 0.3, size: 2.2, size1: 0.8, color: tmpC.copy(c).multiplyScalar(1), shape: Shape.Glow, alpha: 0.5 });
      this.sparks(b, color, 12, 7, 0.2, 0.35);
      for (let j = 0; j < 5; j++) {
        this.add.emit({ pos: b, vel: randDir(tmpV).multiplyScalar(rand(2, 5)), life: rand(0.2, 0.45), size: 0.4, size1: 0, color: tmpC.copy(c).multiplyScalar(3), shape: Shape.Glint, drag: 5 });
      }
      this.shockwave(b, 1.3, color, 0.25, 0.1, 0.1, 0.25);
      if (i < 2) this.flash(b, color, 5, 0.2);
    }
    this.muzzle(points[0], color, 1.4);
  }

  /** Lingering frost cloud and slow aura on a frozen enemy. */
  frostTick(at: THREE.Vector3, size: number) {
    if (Math.random() < 0.5) {
      const p = tmpV2.copy(at).add(tmpV.set(rand(-1, 1) * size, rand(0, 1.2) * size + 0.3, rand(-1, 1) * size));
      this.add.emit({ pos: p, vel: tmpV.set(0, -0.4, 0), life: 0.8, size: rand(0.18, 0.32), size1: 0.05, color: tmpC.set(ICE).multiplyScalar(1.8), shape: Shape.Snow, drag: 1 });
    }
    if (Math.random() < 0.25) {
      this.alpha.emit({ pos: tmpV2.copy(at).setY(0.3), vel: tmpV.set(rand(-0.4, 0.4), 0.15, rand(-0.4, 0.4)), life: 0.9, size: 1.2 * size + 0.6, size1: 2 * size + 1, color: 0xc8f2ff, alpha: 0.28, shape: Shape.Smoke, soft: true });
    }
  }

  burnTick(at: THREE.Vector3, size: number) {
    const p = tmpV2.copy(at).add(tmpV.set(rand(-0.5, 0.5) * size, rand(0.2, 1) * size + 0.3, rand(-0.5, 0.5) * size));
    this.add.emit({ pos: p, vel: tmpV.set(rand(-0.3, 0.3), rand(1.5, 2.8), rand(-0.3, 0.3)), life: rand(0.35, 0.6), size: rand(0.35, 0.6), size1: 0.05, color: FIRE0, color1: FIRE1, shape: Shape.Glow, drag: 1.5 });
  }

  poisonTick(at: THREE.Vector3, size: number) {
    const p = tmpV2.copy(at).add(tmpV.set(rand(-0.5, 0.5) * size, rand(0.4, 1.1) * size + 0.2, rand(-0.5, 0.5) * size));
    this.add.emit({ pos: p, vel: tmpV.set(0, rand(0.6, 1.2), 0), life: rand(0.5, 0.8), size: rand(0.15, 0.3), size1: 0.35, color: tmpC.set(TOXIC).multiplyScalar(1.5), shape: Shape.Bubble });
  }

  /** Frost nova: ice spikes erupt, shards fly, a frost patch spreads. */
  frostNova(at: THREE.Vector3, radius: number) {
    const ground = tmpV2.copy(at).setY(0.15).clone();
    this.shockwave(ground, radius * 1.1, FROST, 0.5, 0.05, 0.12);
    this.decal(ground, radius * 1.05, 'frost', 0xffffff, 3.5);
    this.flash(ground, FROST, 6, 0.4);
    // spikes burst out of the floor and shatter
    const n = Math.round(8 + radius * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(0.25, 0.95) * radius;
      const p = new THREE.Vector3(ground.x + Math.cos(a) * r, 0, ground.z + Math.sin(a) * r);
      this.spike(p, rand(0.5, 1.3) * (1 - r / radius * 0.4), a, rand(0, 0.12));
    }
    for (let i = 0; i < 26; i++) {
      this.ice.emit(tmpV.copy(ground).setY(0.5), randDir(new THREE.Vector3(), 0.6).multiplyScalar(rand(4, 9)), rand(0.06, 0.14), tmpC.set(ICE), rand(0.6, 1.1), 18);
    }
    for (let i = 0; i < 28; i++) {
      this.add.emit({ pos: tmpV.copy(ground).setY(0.6), vel: randDir(new THREE.Vector3(), 0.4).multiplyScalar(rand(2, 7)), life: rand(0.5, 1.1), size: rand(0.25, 0.5), size1: 0.05, color: tmpC.set(ICE).multiplyScalar(1.5), shape: Shape.Snow, drag: 2.5, gravity: 1 });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.alpha.emit({ pos: tmpV.set(ground.x + Math.cos(a) * radius * 0.4, 0.4, ground.z + Math.sin(a) * radius * 0.4), vel: new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)).multiplyScalar(rand(1, 2.5)), life: rand(0.9, 1.4), size: 1.6, size1: 3.4, color: 0x8fc8e8, alpha: 0.3, shape: Shape.Smoke, drag: 1.5, soft: true });
    }
  }

  private spike(p: THREE.Vector3, h: number, lean: number, delay: number) {
    const m = new THREE.Mesh(this.spikeGeo, this.spikeMat);
    m.position.copy(p);
    m.rotation.set(Math.sin(lean) * 0.35, rand(0, 6), -Math.cos(lean) * 0.35);
    m.scale.set(1, 0.001, 1);
    this.scene.add(m);
    const total = 0.75 + delay;
    this.after(total, (k) => {
      const t = k * total - delay;
      if (t < 0) return;
      const grow = Math.min(1, t / 0.08);
      const shrink = t > 0.5 ? 1 - (t - 0.5) / 0.25 : 1;
      m.scale.set(Math.max(0.001, shrink), Math.max(0.001, h * grow * (2 - grow)), Math.max(0.001, shrink));
      m.position.y = (h * grow) / 2;
    }, () => {
      this.scene.remove(m);
      // shatter
      for (let i = 0; i < 3; i++) this.ice.emit(tmpV.copy(p).setY(h * 0.6), randDir(new THREE.Vector3(), 0.5).multiplyScalar(rand(1.5, 4)), rand(0.04, 0.08), tmpC.set(ICE), 0.5, 18);
      this.add.emit({ pos: tmpV.copy(p).setY(h * 0.5), life: 0.25, size: 0.6, size1: 0, color: tmpC.set(ICE).multiplyScalar(3), shape: Shape.Glint });
    });
  }

  /** Boulder smash: crater, dust wall, cel shaded rock debris, shockwave and an element tint. */
  boulderSmash(at: THREE.Vector3, radius: number, color: number, el: Element) {
    const g = new THREE.Vector3(at.x, 0.15, at.z);
    this.shockwave(g, radius * 1.15, color, 0.45, 0.07, 0.3);
    this.shockwave(g, radius * 0.7, 0xfff3c0, 0.25, 0.12, 0.2);
    this.decal(g, radius * 0.75, 'crater', color, 4);
    this.flash(g, color, 7, 0.3);
    this.add.emit({ pos: tmpV.copy(g).setY(0.6), life: 0.16, size: radius * 1.3, size1: radius * 2, color: tmpC.set(color).lerp(tmpC2.set(0xffffff), 0.3).multiplyScalar(1.2), shape: Shape.Glow, alpha: 0.6 });
    // rock debris, cel shaded with outlines from the toon ramp
    const rockCol = new THREE.Color(0x4a2c6e);
    for (let i = 0; i < 22; i++) {
      const v = randDir(new THREE.Vector3(), 0.75).multiplyScalar(rand(4, 10));
      const c = Math.random() < 0.3 ? tmpC.set(color).multiplyScalar(0.8) : tmpC.copy(rockCol).offsetHSL(0, 0, rand(-0.08, 0.1));
      this.rocks.emit(tmpV2.copy(g).setY(0.6), v, rand(0.1, 0.28), c, rand(1.2, 1.9));
    }
    // ring of dust rolling outward along the floor
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand(-0.15, 0.15);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      this.alpha.emit({ pos: tmpV.copy(g).addScaledVector(dir, 0.3).setY(0.5), vel: dir.multiplyScalar(rand(4, 7)).setY(rand(0.4, 1.2)), life: rand(0.8, 1.3), size: 1.2, size1: 3.2, color: 0x5d3f80, alpha: 0.55, shape: Shape.Smoke, drag: 3.5, soft: true });
    }
    for (let i = 0; i < 6; i++) {
      this.alpha.emit({ pos: tmpV.copy(g).setY(0.8), vel: new THREE.Vector3(rand(-1, 1), rand(1.5, 3), rand(-1, 1)), life: rand(1, 1.5), size: 1.8, size1: 3.8, color: 0x6e4a92, alpha: 0.45, shape: Shape.Smoke, drag: 2, soft: true });
    }
    this.sparks(g.clone().setY(0.4), color, 26, 11, 0.6, 0.55);
    // element signature on top of the smash
    if (el === 'C') this.frostNova(g, radius * 0.9);
    else if (el === 'H') this.firePlume(g, radius);
    else if (el === 'S') this.toxicCloud(g, radius);
    else if (el === 'D') this.gemShatter(g, radius);
  }

  firePlume(at: THREE.Vector3, radius: number) {
    this.decal(at, radius * 0.9, 'scorch', 0xffffff, 3);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.7;
      this.add.emit({
        pos: tmpV.set(at.x + Math.cos(a) * r, 0.3, at.z + Math.sin(a) * r),
        vel: tmpV2.set(Math.cos(a) * rand(0.5, 2), rand(2.5, 6), Math.sin(a) * rand(0.5, 2)),
        life: rand(0.4, 0.8), size: rand(0.7, 1.3), size1: 0.1, color: FIRE0, color1: FIRE1, shape: Shape.Glow, drag: 2,
      });
    }
    for (let i = 0; i < 8; i++) this.alpha.emit({ pos: tmpV.copy(at).setY(1.2), vel: tmpV2.set(rand(-0.6, 0.6), rand(1.5, 2.5), rand(-0.6, 0.6)), life: 1.3, size: 1.2, size1: 3, color: 0x2a1030, alpha: 0.45, shape: Shape.Smoke, soft: true });
    this.sparks(at.clone().setY(0.5), FIRE0, 20, 9, 0.8, 0.8);
  }

  toxicCloud(at: THREE.Vector3, radius: number) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.6;
      this.add.emit({ pos: tmpV.set(at.x + Math.cos(a) * r, 0.5, at.z + Math.sin(a) * r), vel: tmpV2.set(Math.cos(a) * 0.8, rand(0.2, 0.6), Math.sin(a) * 0.8), life: rand(1.2, 1.8), size: 1.5, size1: 2.8, color: tmpC.set(TOXIC).multiplyScalar(0.55), alpha: 0.6, shape: Shape.Smoke, soft: true, drag: 1 });
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      this.add.emit({ pos: tmpV.set(at.x + Math.cos(a) * r, 0.2, at.z + Math.sin(a) * r), vel: tmpV2.set(0, rand(0.8, 2), 0), life: rand(0.6, 1.2), size: rand(0.15, 0.35), size1: 0.45, color: tmpC.set(TOXIC).multiplyScalar(1.8), shape: Shape.Bubble });
    }
  }

  gemShatter(at: THREE.Vector3, radius: number) {
    for (let i = 0; i < 18; i++) {
      this.ice.emit(tmpV.copy(at).setY(0.6), randDir(new THREE.Vector3(), 0.7).multiplyScalar(rand(4, 8)), rand(0.07, 0.13), tmpC.set(0xff7be8), rand(0.6, 1), 18);
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.add.emit({ pos: tmpV.set(at.x + Math.cos(a) * r, rand(0.3, 1.5), at.z + Math.sin(a) * r), life: rand(0.3, 0.6), size: rand(0.6, 1.1), size1: 0, color: tmpC.set(0xffa6f3).multiplyScalar(3), shape: Shape.Glint });
    }
  }

  /** Bass Drop: stacked sonic rings, a ground slam, and equalizer bars of light around the edge. */
  bassDrop(at: THREE.Vector3, radius: number, color: number, stun: boolean) {
    const g = new THREE.Vector3(at.x, 0.2, at.z);
    for (let i = 0; i < 3; i++) {
      this.after(i * 0.09, () => {}, () => this.shockwave(g, radius * (1 - i * 0.12), i === 1 ? 0xffffff : color, 0.55, 0.05, i === 0 ? 0.3 : 0.05));
    }
    this.flash(g, color, 8, 0.35);
    const bars = 28;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      const r = radius * 0.92;
      const p = new THREE.Vector3(g.x + Math.cos(a) * r, 0.2, g.z + Math.sin(a) * r);
      const h = rand(1.5, 4);
      for (let j = 0; j < 5; j++) {
        this.add.emit({ pos: p, vel: tmpV.set(0, h * (0.6 + j * 0.35), 0), life: 0.35 + j * 0.03, size: 0.45, size1: 0.1, color: tmpC.set(color).lerp(tmpC2.set(0x00f0ff), j / 5).multiplyScalar(2.6), shape: Shape.Spark, drag: 6 });
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.alpha.emit({ pos: tmpV.copy(g).setY(0.3), vel: tmpV2.set(Math.cos(a), 0.1, Math.sin(a)).multiplyScalar(radius * 1.6), life: 0.7, size: 1, size1: 2.4, color: 0x4b2a6e, alpha: 0.4, shape: Shape.Smoke, drag: 3, soft: true });
    }
    for (let i = 0; i < 10; i++) this.rocks.emit(tmpV.copy(g).setY(0.3), randDir(new THREE.Vector3(), 0.9).multiplyScalar(rand(3, 6)), rand(0.06, 0.14), tmpC.set(0x3d1f5c), 1.1);
    if (stun) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.add.emit({ pos: tmpV.set(g.x + Math.cos(a) * radius * 0.5, 1.2, g.z + Math.sin(a) * radius * 0.5), vel: tmpV2.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(3), life: 0.6, size: 0.6, size1: 0, color: tmpC.set(0xffe66d).multiplyScalar(2.5), shape: Shape.Glint });
      }
    }
  }

  /** Railgun: a white hot core line, a helix of particles around it and a cone of debris at the end. */
  rail(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const d = to.clone().sub(from);
    const len = d.length();
    const dir = d.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const upv = new THREE.Vector3().crossVectors(side, dir).normalize();
    const c = new THREE.Color(color);
    const bolt = this.freeBolt();
    bolt.fire(from, to, c.clone().lerp(tmpC.set(0xffffff), 0.3), 0.3, 0.5, 0.05, 0);
    const n = Math.round(len * 6);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const ang = t * len * 2.2;
      const off = side.clone().multiplyScalar(Math.cos(ang) * 0.35).addScaledVector(upv, Math.sin(ang) * 0.35);
      const p = from.clone().addScaledVector(d, t).add(off);
      this.add.emit({ pos: p, vel: off.multiplyScalar(2.5), life: rand(0.35, 0.6), size: 0.35, size1: 0, color: tmpC.copy(c).multiplyScalar(2.6), shape: Shape.Glow, drag: 3 });
    }
    for (let i = 1; i < 5; i++) {
      const p = from.clone().addScaledVector(d, i / 5);
      this.add.emit({ pos: p, life: 0.25, size: 1.6, size1: 2.6, color: tmpC.copy(c).multiplyScalar(1.4), shape: Shape.Glow, alpha: 0.7 });
    }
    this.muzzle(from, color, 2);
    this.flash(from, color, 10, 0.25);
    for (let i = 0; i < 18; i++) {
      const v = dir.clone().multiplyScalar(rand(4, 10)).add(randDir(tmpV).multiplyScalar(3));
      this.streaks.emit(to, v, tmpC.copy(c).multiplyScalar(3), rand(0.25, 0.5), 0.04, 6);
    }
  }

  /** Per frame contact effect for continuous beams. */
  beamContact(at: THREE.Vector3, color: number, el: Element) {
    this.add.emit({ pos: at, life: 0.08, size: rand(0.9, 1.4), size1: 1.6, color: tmpC.set(color).lerp(tmpC2.set(0xffffff), 0.5).multiplyScalar(2.5), shape: Shape.Spark });
    if (Math.random() < 0.6) this.streaks.emit(at, randDir(tmpV, 0.5).multiplyScalar(rand(3, 6)), tmpC.set(color).multiplyScalar(3), 0.3, 0.03, 14);
    if (el === 'H') this.burnTick(at.clone().setY(0.3), 0.5);
    else if (el === 'C' && Math.random() < 0.5) this.add.emit({ pos: at, vel: randDir(tmpV).multiplyScalar(2), life: 0.5, size: 0.35, size1: 0.05, color: tmpC.set(ICE).multiplyScalar(2), shape: Shape.Snow, drag: 3 });
    else if (el === 'S' && Math.random() < 0.4) this.poisonTick(at.clone().setY(0.2), 0.6);
    else if (el === 'D' && Math.random() < 0.3) this.add.emit({ pos: at.clone().add(randDir(tmpV).multiplyScalar(0.4)), life: 0.3, size: 0.6, size1: 0, color: tmpC.set(0xffa6f3).multiplyScalar(3), shape: Shape.Glint });
  }

  /** Jackpot hit: a fountain of gold coins and glints. */
  jackpot(at: THREE.Vector3) {
    this.shockwave(at.clone().setY(0.2), 2.2, GOLD, 0.4, 0.08, 0.2);
    this.flash(at, GOLD, 10, 0.3);
    for (let i = 0; i < 18; i++) {
      this.add.emit({ pos: at, vel: randDir(new THREE.Vector3(), 0.8).multiplyScalar(rand(3, 7)), life: rand(0.6, 1), size: rand(0.35, 0.6), size1: 0.1, color: tmpC.set(GOLD).multiplyScalar(2.5), shape: Shape.Glint, gravity: 12 });
    }
    for (let i = 0; i < 6; i++) this.rocks.emit(at, randDir(new THREE.Vector3(), 0.9).multiplyScalar(rand(3, 6)), 0.12, tmpC.set(GOLD), 0.9);
  }

  crit(at: THREE.Vector3) {
    this.add.emit({ pos: at, life: 0.35, size: 2.6, size1: 0.3, color: tmpC.set(0xff9cf0).multiplyScalar(3), shape: Shape.Glint });
    this.sparks(at, 0xff5ce1, 10, 6, 0.4, 0.35);
  }

  /** Enemy death: core flash, ring, sparks. */
  death(at: THREE.Vector3, color: number, size: number) {
    this.add.emit({ pos: at, life: 0.2, size: 2 * size + 1, size1: 3 * size + 1.5, color: tmpC.set(color).multiplyScalar(2), shape: Shape.Glow });
    this.shockwave(at.clone().setY(0.2), 1.2 + size, color, 0.35, 0.1, 0.1);
    this.sparks(at, color, Math.round(10 + size * 10), 6, 0.5, 0.5);
  }

  private freeBolt(): Bolt {
    let b = this.bolts.find((x) => !x.active);
    if (!b) {
      b = this.bolts.reduce((a, x) => (x.life / x.max > a.life / a.max ? x : a));
    }
    return b;
  }
}
