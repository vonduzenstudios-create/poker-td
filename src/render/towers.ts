// Procedural tower models. Each poker hand has its own silhouette that reads as the hand
// (a pair is two towers, three of a kind is three, a full house is a whole castle, a flush
// is a swirling suit whirlpool), and the card rank picks a visual tier on top of that:
//   tier 0 (2-5)   bronze trim, flat roofs, short stubby build
//   tier 1 (6-10)  chrome trim, battlements, taller
//   tier 2 (J-K)   gold trim, battlements with pointed spires, more neon
//   tier 3 (A)     platinum gold, spires, floating gems and halos, brightest neon
// Height also grows smoothly with rank so a pair of 9s stands a little over a pair of 6s.
import * as THREE from 'three';
import { HandType, rankLabel, Suit, SUIT_SYMBOL } from '../game/cards';
import type { TowerStats } from '../game/data';
import { neonMat, toonMat, toonMesh } from './toon';

export interface TowerModel {
  group: THREE.Group;
  /** Part that turns to face the target. Turrets on multi-tower builds follow it. */
  head: THREE.Object3D;
  /** Height that projectiles leave from. */
  muzzleY: number;
  /** Neon ring at the base, recolored when disabled. */
  ring: THREE.Mesh;
}

/** 0 = 2-5, 1 = 6-10, 2 = J-K, 3 = A. */
export function towerTier(rank: number): number {
  if (rank >= 14) return 3;
  if (rank >= 11) return 2;
  if (rank >= 6) return 1;
  return 0;
}

const TRIM = [0x9a5a2a, 0x8f9ab2, 0xd99a1e, 0xf0c860];
const TRIM_GLOW = [0, 0, 0.06, 0.14];
const STONE = [0x2a1640, 0x321a56, 0x3a1d66, 0x46217c];
const GLOW = [1.3, 1.6, 2.0, 2.5];

interface Kit {
  tier: number;
  rank: number;
  /** Rank height multiplier: 1.0 for a 2, about 1.45 for an ace. */
  H: number;
  color: number;
  suit: Suit | null;
  body: THREE.Material;
  trim: THREE.Material;
  stone: THREE.Material;
  glow: THREE.Material;
  /** Glow multiplier for light colors. */
  dim: number;
  head: THREE.Object3D;
  /** Turrets that copy the head's aim. */
  aimers: THREE.Object3D[];
  /** Per-frame animations, given time in seconds. */
  anims: ((t: number) => void)[];
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>();
function glowMat(color: number, intensity: number): THREE.MeshBasicMaterial {
  const key = `${color}-${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = neonMat(color, intensity);
    glowCache.set(key, m);
  }
  return m;
}

export function buildTowerModel(s: TowerStats): TowerModel {
  const g = new THREE.Group();
  const rank = Math.min(Math.max(s.hand.rank, 2), 14);
  const tier = s.hand.type === HandType.RoyalFlush ? 3 : towerTier(rank);
  // Light colors (cyan, orange, white) bloom far more than deep ones, so tone their glow down.
  const c = new THREE.Color(s.color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dim = Math.min(1, 0.45 / Math.max(lum, 0.01));
  const k: Kit = {
    tier,
    rank,
    H: 1 + (rank - 2) * 0.038,
    color: s.color,
    suit: s.hand.suit,
    body: toonMat(s.color, (0.05 + tier * 0.04) * dim),
    trim: toonMat(TRIM[tier], TRIM_GLOW[tier]),
    stone: toonMat(STONE[tier]),
    glow: glowMat(s.color, GLOW[tier] * dim),
    dim,
    head: new THREE.Object3D(),
    aimers: [],
    anims: [],
  };

  const { ring, top } = buildBase(k, g, s);
  const stage = new THREE.Group();
  stage.position.y = top;
  g.add(stage);
  stage.add(k.head);

  let muzzle = 1;
  switch (s.hand.type) {
    case HandType.HighCard: muzzle = buildHighCard(k, stage); break;
    case HandType.Pair: muzzle = buildPair(k, stage); break;
    case HandType.TwoPair: muzzle = buildTwoPair(k, stage); break;
    case HandType.Trips: muzzle = buildTrips(k, stage); break;
    case HandType.Straight: muzzle = buildStraight(k, stage); break;
    case HandType.Flush: muzzle = buildFlush(k, stage); break;
    case HandType.FullHouse: muzzle = buildFullHouse(k, stage); break;
    case HandType.Quads: muzzle = buildQuads(k, stage); break;
    case HandType.StraightFlush: muzzle = buildStraightFlush(k, stage); break;
    case HandType.RoyalFlush: muzzle = buildRoyalFlush(k, stage); break;
  }

  // Animations run from the base ring's render hook, so the game loop needs no changes.
  // Everything is a pure function of time, so extra calls in one frame are harmless.
  const head = k.head;
  const aimers = k.aimers;
  const anims = k.anims;
  ring.onBeforeRender = () => {
    const t = performance.now() / 1000;
    for (const a of aimers) {
      a.rotation.y = head.rotation.y;
      a.rotation.z = head.rotation.z;
    }
    for (const f of anims) f(t);
  };

  g.scale.setScalar(1.2);
  return { group: g, head, muzzleY: (top + muzzle) * 1.2, ring };
}

// ---------------------------------------------------------------- shared parts

/** Stack of poker chips with a neon ring and a rank plaque. Returns the deck height. */
function buildBase(k: Kit, g: THREE.Group, s: TowerStats): { ring: THREE.Mesh; top: number } {
  const chips = 2 + Math.min(k.tier, 2) + (k.tier === 3 ? 1 : 0);
  const chipH = 0.13;
  for (let i = 0; i < chips; i++) {
    const r = 0.95 - i * 0.025;
    const mat = i % 2 === (chips - 1) % 2 ? k.stone : toonMat(0x1d0b33);
    const chip = toonMesh(new THREE.CylinderGeometry(r, r + 0.02, chipH, 20), mat, 0.04);
    chip.position.y = chipH / 2 + i * chipH;
    g.add(chip);
    // chip edge spots
    if (i % 2 === 0) {
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2 + i * 0.4;
        const spot = new THREE.Mesh(new THREE.BoxGeometry(0.16, chipH * 0.7, 0.03), glowMat(TRIM[k.tier], 0.8));
        spot.position.set(Math.sin(a) * (r + 0.01), chip.position.y, Math.cos(a) * (r + 0.01));
        spot.rotation.y = a;
        g.add(spot);
      }
    }
  }
  const top = chips * chipH;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 6, 40), neonMat(s.color, 2.2));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = top;
  g.add(ring);

  // rank plaque: a little card leaning on the front of the base
  const plaque = toonMesh(
    new THREE.BoxGeometry(0.36, 0.5, 0.03),
    [k.stone, k.stone, k.stone, k.stone, plaqueMat(k.rank, s.hand.suit, s.color, k.tier), k.stone] as unknown as THREE.Material,
    0.025,
  );
  plaque.position.set(0, top + 0.14, 0.86);
  plaque.rotation.x = -0.55;
  g.add(plaque);
  return { ring, top };
}

const plaqueCache = new Map<string, THREE.MeshBasicMaterial>();
function plaqueMat(rank: number, suit: Suit | null, color: number, tier: number): THREE.MeshBasicMaterial {
  const key = `${rank}-${suit}-${color}-${tier}`;
  let m = plaqueCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 128;
  const x = c.getContext('2d')!;
  const css = '#' + color.toString(16).padStart(6, '0');
  const trim = '#' + TRIM[tier].toString(16).padStart(6, '0');
  x.fillStyle = trim;
  x.fillRect(0, 0, 96, 128);
  x.fillStyle = '#fdf6ff';
  x.fillRect(6, 6, 84, 116);
  x.fillStyle = css === '#ffffff' ? '#7b2ff7' : css;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 58px "Arial Black", Arial, sans-serif';
  x.fillText(rankLabel(rank), 48, suit ? 52 : 64);
  if (suit) {
    x.font = 'bold 40px Arial, sans-serif';
    x.fillText(SUIT_SYMBOL[suit], 48, 100);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: tex, color: 0xb0b0b0 });
  plaqueCache.set(key, m);
  return m;
}

interface SpireOpts {
  /** Leave the roof open for a turret instead of a pointed spire. */
  turret?: boolean;
  /** Gets the tier 3 floating gem and halo. */
  hero?: boolean;
  /** Override shaft material. */
  shaft?: THREE.Material;
  /** Number of neon bands, default tier + 1. */
  bands?: number;
}

/**
 * One castle-style tower. Its roof changes with tier: flat cap, battlements,
 * battlements with a pointed spire, then spire plus a floating gem.
 * Returns the height a turret or crystal can sit at.
 */
function spire(k: Kit, parent: THREE.Object3D, x: number, z: number, r: number, h: number, o: SpireOpts = {}): number {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  parent.add(grp);
  const shaft = toonMesh(new THREE.CylinderGeometry(r * 0.86, r, h, 8), o.shaft ?? k.stone, 0.04);
  shaft.position.y = h / 2;
  grp.add(shaft);
  // body colored window slit facing the camera
  const slit = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, h * 0.32, 0.02), k.glow);
  slit.position.set(0, h * 0.55, r * 0.93);
  grp.add(slit);
  const bands = o.bands ?? k.tier + 1;
  for (let i = 0; i < bands; i++) {
    const y = h * (0.18 + (0.6 * i) / Math.max(bands, 1));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.04, 8), k.glow);
    band.position.y = y;
    grp.add(band);
  }
  // overhanging cap
  const capR = r * 1.18;
  const cap = toonMesh(new THREE.CylinderGeometry(capR, r * 0.9, 0.14, 8), k.trim, 0.035);
  cap.position.y = h + 0.07;
  grp.add(cap);
  let top = h + 0.14;
  if (k.tier >= 1) {
    // battlements
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = toonMesh(new THREE.BoxGeometry(r * 0.38, 0.13, r * 0.3), k.trim, 0.025);
      m.position.set(Math.sin(a) * capR * 0.86, top + 0.065, Math.cos(a) * capR * 0.86);
      m.rotation.y = a;
      grp.add(m);
    }
  }
  if (k.tier >= 2) {
    if (o.turret) {
      // pinnacles on the corners instead of a full roof
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const p = toonMesh(new THREE.ConeGeometry(r * 0.16, 0.28, 6), k.body, 0.02);
        p.position.set(Math.sin(a) * capR * 0.9, top + 0.27, Math.cos(a) * capR * 0.9);
        grp.add(p);
      }
    } else {
      const roofH = r * 2.6;
      const roof = toonMesh(new THREE.ConeGeometry(capR * 0.92, roofH, 8), k.tier === 3 ? k.trim : k.body, 0.04);
      roof.position.y = top + roofH / 2;
      grp.add(roof);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 6), k.glow);
      tip.position.y = top + roofH + r * 0.15;
      grp.add(tip);
      top += roofH + r * 0.3;
    }
  }
  if (k.tier === 3 && o.hero) {
    const gemY = top + (o.turret ? 0.75 : 0.32);
    const gem = toonMesh(new THREE.OctahedronGeometry(r * 0.5), toonMat(0xfff0b8, 0.45), 0.025);
    gem.position.y = gemY;
    grp.add(gem);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(r * 1.1, 0.025, 6, 24), glowMat(0xffd76a, 2.2));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = gemY;
    grp.add(halo);
    const phase = x * 3 + z * 5;
    k.anims.push((t) => {
      gem.rotation.y = t * 1.6 + phase;
      gem.position.y = gemY + Math.sin(t * 2 + phase) * 0.05;
      halo.rotation.x = Math.PI / 2 + Math.sin(t * 1.3 + phase) * 0.25;
    });
  }
  return o.turret ? h + 0.14 : top;
}

type TurretKind = 'dart' | 'barrel' | 'twin' | 'orb';

/** A small weapon that follows the head's aim. */
function turret(k: Kit, parent: THREE.Object3D, x: number, y: number, z: number, kind: TurretKind, size = 1): number {
  const t = new THREE.Group();
  t.position.set(x, y, z);
  t.scale.setScalar(size);
  parent.add(t);
  k.aimers.push(t);
  const housing = toonMesh(new THREE.SphereGeometry(0.17, 10, 8), k.body, 0.03);
  housing.position.y = 0.14;
  housing.scale.y = 0.8;
  t.add(housing);
  switch (kind) {
    case 'dart': {
      const nose = toonMesh(new THREE.ConeGeometry(0.1, 0.5, 6), k.trim, 0.025);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 0.16, 0.3);
      t.add(nose);
      for (const s of [-1, 1]) {
        const fin = toonMesh(new THREE.BoxGeometry(0.03, 0.14, 0.22), k.trim, 0.015);
        fin.position.set(s * 0.15, 0.16, -0.05);
        fin.rotation.z = s * 0.4;
        t.add(fin);
      }
      return 0.16 * size;
    }
    case 'barrel':
    case 'twin': {
      const xs = kind === 'twin' ? [-0.08, 0.08] : [0];
      for (const bx of xs) {
        const barrel = toonMesh(new THREE.CylinderGeometry(0.05, 0.065, 0.5, 8), k.trim, 0.02);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(bx, 0.15, 0.3);
        t.add(barrel);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 8), k.glow);
        tip.rotation.x = Math.PI / 2;
        tip.position.set(bx, 0.15, 0.56);
        t.add(tip);
      }
      return 0.15 * size;
    }
    case 'orb': {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), k.glow);
      orb.position.set(0, 0.2, 0.12);
      t.add(orb);
      return 0.2 * size;
    }
  }
}

const doubleCache = new Map<THREE.Material, THREE.Material>();
/** Double sided copy of a shared material, for open cylinders. */
function doubleSided(m: THREE.Material): THREE.Material {
  let d = doubleCache.get(m);
  if (!d) {
    d = m.clone();
    d.side = THREE.DoubleSide;
    doubleCache.set(m, d);
  }
  return d;
}

/** Thin glowing bar between two points, used for bridges of light and arcs. */
function beam(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r = 0.025): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// ---------------------------------------------------------------- suit emblems

let heartGeo: THREE.ExtrudeGeometry | null = null;
let diamondGeo: THREE.ExtrudeGeometry | null = null;
let stemGeo: THREE.ExtrudeGeometry | null = null;
const EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 10,
};

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.48);
  s.bezierCurveTo(-0.6, -0.05, -0.55, 0.45, -0.25, 0.45);
  s.bezierCurveTo(-0.08, 0.45, 0, 0.32, 0, 0.22);
  s.bezierCurveTo(0, 0.32, 0.08, 0.45, 0.25, 0.45);
  s.bezierCurveTo(0.55, 0.45, 0.6, -0.05, 0, -0.48);
  return s;
}

function centered(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.center();
  return geo;
}

/** An extruded suit symbol about one unit tall, facing +z. */
export function suitEmblem(suit: Suit, mat: THREE.Material, outline = 0.03): THREE.Group {
  const grp = new THREE.Group();
  stemGeo ??= (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.1);
    s.lineTo(0.17, -0.2);
    s.lineTo(-0.17, -0.2);
    s.closePath();
    return centered(new THREE.ExtrudeGeometry(s, EXTRUDE)) as THREE.ExtrudeGeometry;
  })();
  switch (suit) {
    case 'H': {
      heartGeo ??= centered(new THREE.ExtrudeGeometry(heartShape(), EXTRUDE)) as THREE.ExtrudeGeometry;
      grp.add(toonMesh(heartGeo, mat, outline));
      break;
    }
    case 'D': {
      diamondGeo ??= (() => {
        const s = new THREE.Shape();
        s.moveTo(0, 0.5);
        s.lineTo(0.36, 0);
        s.lineTo(0, -0.5);
        s.lineTo(-0.36, 0);
        s.closePath();
        return centered(new THREE.ExtrudeGeometry(s, EXTRUDE)) as THREE.ExtrudeGeometry;
      })();
      grp.add(toonMesh(diamondGeo, mat, outline));
      break;
    }
    case 'S': {
      heartGeo ??= centered(new THREE.ExtrudeGeometry(heartShape(), EXTRUDE)) as THREE.ExtrudeGeometry;
      const top = toonMesh(heartGeo, mat, outline);
      top.rotation.z = Math.PI;
      top.position.y = 0.1;
      top.scale.setScalar(0.9);
      grp.add(top);
      const stem = toonMesh(stemGeo, mat, outline);
      stem.position.y = -0.36;
      grp.add(stem);
      break;
    }
    case 'C': {
      for (const [x, y] of [[0, 0.24], [-0.21, -0.06], [0.21, -0.06]]) {
        const lobe = toonMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 14), mat, outline);
        lobe.rotation.x = Math.PI / 2;
        lobe.position.set(x, y, 0);
        grp.add(lobe);
      }
      const stem = toonMesh(stemGeo, mat, outline);
      stem.position.y = -0.33;
      grp.add(stem);
      break;
    }
  }
  return grp;
}

let swirlTex: THREE.CanvasTexture | null = null;
/** White spiral arms on black, tinted by the material color. */
function swirlTexture(): THREE.CanvasTexture {
  if (swirlTex) return swirlTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, '#3a3a3a');
  grad.addColorStop(1, '#151515');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#ffffff';
  x.lineCap = 'round';
  for (let arm = 0; arm < 4; arm++) {
    x.beginPath();
    for (let i = 0; i <= 60; i++) {
      const f = i / 60;
      const a = arm * (Math.PI / 2) + f * Math.PI * 2.2;
      const r = 10 + f * 112;
      const px = 128 + Math.cos(a) * r;
      const py = 128 + Math.sin(a) * r;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.lineWidth = 9;
    x.stroke();
  }
  swirlTex = new THREE.CanvasTexture(c);
  swirlTex.colorSpace = THREE.SRGBColorSpace;
  return swirlTex;
}

// ---------------------------------------------------------------- hands

/** High Card: one lone tower with a dart launcher. */
function buildHighCard(k: Kit, st: THREE.Group): number {
  const h = 1.0 * k.H;
  const top = spire(k, st, 0, 0, 0.3, h, { turret: true, hero: true });
  // buttresses
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const b = toonMesh(new THREE.BoxGeometry(0.08, h * 0.45, 0.3), k.stone, 0.025);
    b.position.set(Math.sin(a) * 0.36, h * 0.22, Math.cos(a) * 0.36);
    b.rotation.y = a;
    st.add(b);
  }
  return top + turret(k, st, 0, top, 0, 'dart', 1 + k.tier * 0.12);
}

/** Pair: twin towers joined by a sky bridge, one gun each. */
function buildPair(k: Kit, st: THREE.Group): number {
  const h = 1.1 * k.H;
  let top = 0;
  for (const x of [-0.44, 0.44]) {
    top = spire(k, st, x, 0, 0.25, h, { turret: true, hero: true });
    turret(k, st, x, top, 0, k.tier >= 2 ? 'twin' : 'barrel', 0.9 + k.tier * 0.08);
  }
  const bridge = toonMesh(new THREE.BoxGeometry(0.62, 0.12, 0.22), k.trim, 0.03);
  bridge.position.y = h * 0.68;
  st.add(bridge);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.24), k.glow);
  rail.position.y = h * 0.68 + 0.075;
  st.add(rail);
  if (k.tier >= 1) {
    // light arch between the tops
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.025, 6, 20, Math.PI), k.glow);
    arch.position.y = h * 0.68 + 0.06;
    st.add(arch);
  }
  return top + 0.15;
}

/** Two Pair: a tall pair at the back with guns and a short pair at the front with orbs. */
function buildTwoPair(k: Kit, st: THREE.Group): number {
  const h = 1.15 * k.H;
  const alt = toonMat(0x22103a);
  let top = 0;
  for (const x of [-0.45, 0.45]) {
    top = spire(k, st, x, -0.36, 0.22, h, { turret: true, hero: true });
    turret(k, st, x, top, -0.36, 'barrel', 0.85 + k.tier * 0.07);
  }
  for (const x of [-0.45, 0.45]) {
    const t2 = spire(k, st, x, 0.42, 0.18, h * 0.55, { turret: true, shaft: alt, bands: 1 });
    turret(k, st, x, t2, 0.42, 'orb', 0.8 + k.tier * 0.07);
  }
  // spinning ricochet disc in the middle
  const post = toonMesh(new THREE.CylinderGeometry(0.05, 0.08, h * 0.5, 6), k.trim, 0.02);
  post.position.set(0, h * 0.25, 0.03);
  st.add(post);
  const disc = new THREE.Group();
  disc.position.set(0, h * 0.5 + 0.18, 0.03);
  st.add(disc);
  const torus = toonMesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), k.body, 0.025);
  disc.add(torus);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), k.glow);
  disc.add(core);
  k.anims.push((t) => {
    disc.rotation.y = t * 3;
  });
  return top + 0.15;
}

/** Three of a Kind: three crystal towers feeding a floating prism with arcs of light. */
function buildTrips(k: Kit, st: THREE.Group): number {
  const h = 1.15 * k.H;
  const crystal = toonMat(k.color, 0.35 * k.dim);
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i / 3) * Math.PI * 2;
    const x = Math.sin(a) * 0.52;
    const z = Math.cos(a) * 0.52;
    const t = spire(k, st, x, z, 0.2, h, { turret: true, hero: true });
    const c = toonMesh(new THREE.OctahedronGeometry(0.16 + k.tier * 0.02), crystal, 0.025);
    c.scale.y = 1.6;
    c.position.set(x, t + 0.25, z);
    st.add(c);
    tops.push(new THREE.Vector3(x, t + 0.25, z));
    const ph = i * 2;
    k.anims.push((tt) => {
      c.rotation.y = tt * 1.5 + ph;
    });
  }
  const py = h + 0.95 + k.tier * 0.08;
  const prism = toonMesh(new THREE.OctahedronGeometry(0.28 + k.tier * 0.03), crystal, 0.035);
  prism.scale.y = 1.5;
  prism.position.y = py;
  st.add(prism);
  const arcs = tops.map((p) => {
    const b = beam(k.glow, p, new THREE.Vector3(0, py, 0), 0.02 + k.tier * 0.006);
    st.add(b);
    return b;
  });
  k.anims.push((t) => {
    prism.rotation.y = t * 0.9;
    prism.position.y = py + Math.sin(t * 1.8) * 0.06;
    arcs.forEach((b, i) => (b.visible = Math.sin(t * 13 + i * 2.1) + Math.sin(t * 7.3 + i) > -0.6));
  });
  return py;
}

/** Straight: five stepped pillars in a row carrying a rail cannon. The whole rig aims. */
function buildStraight(k: Kit, _st: THREE.Group): number {
  const rig = k.head;
  rig.position.y = 0;
  const step = 0.2 + k.tier * 0.02;
  const ys: number[] = [];
  for (let i = 0; i < 5; i++) {
    const hh = (0.32 + i * step) * k.H;
    const z = -0.62 + i * 0.31;
    const p = toonMesh(new THREE.BoxGeometry(0.44, hh, 0.27), k.stone, 0.035);
    p.position.set(0, hh / 2, z);
    rig.add(p);
    const cap = toonMesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), k.trim, 0.025);
    cap.position.set(0, hh + 0.04, z);
    rig.add(cap);
    // a neon pip on each step, one more per step, like the card run
    const pip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.02), k.glow);
    pip.position.set(0, hh * 0.6, z + 0.14);
    rig.add(pip);
    if (k.tier >= 1) {
      for (const s of [-1, 1]) {
        const fin = toonMesh(new THREE.BoxGeometry(0.05, hh * 0.6, 0.2), k.body, 0.02);
        fin.position.set(s * 0.26, hh * 0.35, z);
        rig.add(fin);
      }
    }
    ys.push(hh + 0.08);
  }
  // rails along the tops of the steps
  const a = new THREE.Vector3(0, ys[0] + 0.06, -0.62);
  const b = new THREE.Vector3(0, ys[4] + 0.06, 0.62 + 0.25);
  for (const x of [-0.13, 0.13]) {
    const rail = toonMesh(new THREE.BoxGeometry(0.07, 0.07, a.distanceTo(b)), k.trim, 0.02);
    rail.position.copy(a).lerp(b, 0.5).setX(x);
    rail.lookAt(rail.position.clone().add(b.clone().sub(a)));
    rig.add(rail);
  }
  const coil = beam(k.glow, a.clone().setY(a.y + 0.01), b.clone().setY(b.y + 0.01), 0.035);
  rig.add(coil);
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 16), k.glow);
  muzzle.position.copy(b);
  rig.add(muzzle);
  if (k.tier === 3) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 6, 20), glowMat(0xffd76a, 2.2));
    halo.position.copy(b).setZ(b.z - 0.12);
    rig.add(halo);
    k.anims.push((t) => halo.scale.setScalar(1 + Math.sin(t * 4) * 0.12));
  }
  return b.y;
}

/** Flush: a whirlpool of five same-suit emblems spiralling down into a glowing basin. */
function buildFlush(k: Kit, st: THREE.Group): number {
  const suit = k.suit ?? 'H';
  // basin
  const basin = toonMesh(new THREE.CylinderGeometry(0.82, 0.72, 0.24, 20, 1, true), doubleSided(k.trim), 0.03);
  basin.position.y = 0.12;
  st.add(basin);
  const waterMat = new THREE.MeshBasicMaterial({
    map: swirlTexture(), color: new THREE.Color(k.color).multiplyScalar((1.2 + k.tier * 0.25) * k.dim), toneMapped: false,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.78, 28), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.2;
  st.add(water);
  // central drain column
  const h = 1.15 * k.H;
  const col = toonMesh(new THREE.CylinderGeometry(0.1, 0.2, h, 8), k.stone, 0.03);
  col.position.y = h / 2;
  st.add(col);
  for (let i = 0; i < k.tier + 1; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17 - i * 0.02, 0.17 - i * 0.02, 0.04, 8), k.glow);
    band.position.y = h * (0.25 + i * 0.2);
    st.add(band);
  }
  // spiral of five emblems
  const em = toonMat(k.color, (0.25 + k.tier * 0.06) * k.dim);
  const swirl = new THREE.Group();
  st.add(swirl);
  for (let i = 0; i < 5; i++) {
    const f = i / 4;
    const a = i * ((Math.PI * 2) / 5) * 1.3;
    const r = 0.62 - f * 0.22;
    const e = suitEmblem(suit, em, 0.02);
    e.scale.setScalar(0.28 - f * 0.04 + k.tier * 0.015);
    e.position.set(Math.sin(a) * r, h * 0.95 - f * h * 0.62, Math.cos(a) * r);
    e.rotation.y = a + Math.PI / 2;
    e.rotation.z = 0.35;
    swirl.add(e);
  }
  // spray jets around the rim
  if (k.tier >= 1) {
    const jets = 4 + k.tier * 2;
    for (let i = 0; i < jets; i++) {
      const a = (i / jets) * Math.PI * 2;
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 5), k.glow);
      jet.position.set(Math.sin(a) * 0.8, 0.38, Math.cos(a) * 0.8);
      jet.rotation.set(Math.cos(a) * -0.4, 0, Math.sin(a) * 0.4);
      st.add(jet);
    }
  }
  // crowning emblem faces the target
  const crown = new THREE.Group();
  crown.position.y = h + 0.42;
  st.add(crown);
  k.aimers.push(crown);
  const big = suitEmblem(suit, toonMat(k.color, (0.35 + k.tier * 0.06) * k.dim), 0.03);
  big.scale.setScalar(0.5 + k.tier * 0.05);
  crown.add(big);
  if (k.tier >= 2) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 24), k.tier === 3 ? glowMat(0xffd76a, 2.2) : k.glow);
    crown.add(halo);
  }
  k.anims.push((t) => {
    water.rotation.z = -t * 2.2;
    swirl.rotation.y = t * 1.4;
    swirl.position.y = Math.sin(t * 2) * 0.03;
    big.position.y = Math.sin(t * 2.4) * 0.06;
  });
  return h + 0.42;
}

/** Full House: a whole castle. Three tall towers at the back, two at the front, a gate and a bass keep. */
function buildFullHouse(k: Kit, st: THREE.Group): number {
  const H = k.H;
  const wallH = 0.36 + k.tier * 0.05;
  const e = 0.66;
  // curtain walls
  const walls: [number, number, number, number][] = [
    [0, -e, 2 * e, 0.14], [-e, 0, 0.14, 2 * e], [e, 0, 0.14, 2 * e],
    [-e * 0.62, e, e * 0.76, 0.14], [e * 0.62, e, e * 0.76, 0.14],
  ];
  for (const [x, z, w, d] of walls) {
    const wall = toonMesh(new THREE.BoxGeometry(w, wallH, d), k.stone, 0.03);
    wall.position.set(x, wallH / 2, z);
    st.add(wall);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.035, d + 0.02), k.glow);
    lip.position.set(x, wallH * 0.55, z);
    st.add(lip);
    if (k.tier >= 1) {
      const long = Math.max(w, d);
      const n = Math.max(2, Math.round(long / 0.2));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        const m = toonMesh(new THREE.BoxGeometry(0.09, 0.1, 0.09), k.trim, 0.02);
        m.position.set(x + (w > d ? f * w : 0), wallH + 0.05, z + (w > d ? 0 : f * d));
        st.add(m);
      }
    }
  }
  // gate
  const gateH = wallH + 0.14;
  for (const s of [-1, 1]) {
    const post = toonMesh(new THREE.BoxGeometry(0.1, gateH, 0.2), k.trim, 0.025);
    post.position.set(s * 0.17, gateH / 2, e);
    st.add(post);
  }
  const lintel = toonMesh(new THREE.BoxGeometry(0.44, 0.1, 0.2), k.trim, 0.025);
  lintel.position.set(0, gateH, e);
  st.add(lintel);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, gateH - 0.06, 0.02), k.glow);
    bar.position.set(-0.08 + i * 0.08, (gateH - 0.06) / 2, e + 0.02);
    st.add(bar);
  }
  // three towers at the back, two at the front
  const backTops: number[] = [];
  for (const x of [-e, 0, e]) {
    const h = (x === 0 ? 1.5 : 1.25) * H;
    backTops.push(spire(k, st, x, -e, x === 0 ? 0.23 : 0.2, h, { hero: x === 0 }));
  }
  for (const x of [-e, e]) spire(k, st, x, e, 0.18, 0.82 * H);
  // flags on the back towers
  if (k.tier >= 1) {
    [-e, e].forEach((x, i) => {
      const y = backTops[i * 2];
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), k.trim);
      pole.position.set(x, y + 0.2, -e);
      st.add(pole);
      const flag = toonMesh(new THREE.BoxGeometry(0.24, 0.14, 0.015).translate(0.12, 0, 0), k.body, 0.015);
      flag.position.set(x, y + 0.32, -e);
      st.add(flag);
      k.anims.push((t) => (flag.rotation.y = Math.sin(t * 3 + i * 1.7) * 0.5 - 0.3));
    });
  }
  // keep with a bass speaker on the roof
  const keepH = 0.55 * H;
  const keep = toonMesh(new THREE.BoxGeometry(0.5, keepH, 0.46), k.stone, 0.03);
  keep.position.set(0, keepH / 2, 0.06);
  st.add(keep);
  const keepCap = toonMesh(new THREE.BoxGeometry(0.56, 0.08, 0.52), k.trim, 0.025);
  keepCap.position.set(0, keepH + 0.04, 0.06);
  st.add(keepCap);
  const cone = toonMesh(new THREE.CylinderGeometry(0.22, 0.1, 0.12, 16, 1, true), doubleSided(toonMat(0x120022)), 0.02);
  cone.position.set(0, keepH + 0.14, 0.06);
  st.add(cone);
  const dust = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6), k.glow);
  dust.position.set(0, keepH + 0.12, 0.06);
  st.add(dust);
  const wave = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 6, 24), k.glow);
  wave.rotation.x = Math.PI / 2;
  wave.position.set(0, keepH + 0.2, 0.06);
  st.add(wave);
  k.anims.push((t) => {
    const beat = Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)) ** 4;
    dust.scale.setScalar(1 + beat * 0.6);
    const f = (t * 1.1) % 1;
    wave.scale.setScalar(1 + f * 1.6);
    wave.visible = f < 0.75;
  });
  return keepH + 0.2;
}

/** Four of a Kind: four tesla coils around a great central coil with arcs between them. */
function buildQuads(k: Kit, st: THREE.Group): number {
  const H = k.H;
  const coilMat = toonMat(k.color, 0.4 * k.dim);
  const corner = 0.52;
  const balls: THREE.Vector3[] = [];
  for (const [x, z] of [[-corner, -corner], [corner, -corner], [-corner, corner], [corner, corner]]) {
    const top = spire(k, st, x, z, 0.17, 0.75 * H, { turret: true, bands: 1 });
    for (let i = 0; i < 2 + Math.min(k.tier, 2); i++) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.13 - i * 0.02, 0.025, 6, 14), k.glow);
      c.rotation.x = Math.PI / 2;
      c.position.set(x, top + 0.08 + i * 0.1, z);
      st.add(c);
    }
    const by = top + 0.2 + Math.min(k.tier, 2) * 0.1 + 0.12;
    const ball = toonMesh(new THREE.SphereGeometry(0.1, 10, 8), coilMat, 0.025);
    ball.position.set(x, by, z);
    st.add(ball);
    balls.push(new THREE.Vector3(x, by, z));
  }
  // central coil
  const ch = 1.4 * H;
  const pole = toonMesh(new THREE.CylinderGeometry(0.09, 0.2, ch, 8), k.stone, 0.03);
  pole.position.y = ch / 2;
  st.add(pole);
  const rings = 3 + k.tier;
  for (let i = 0; i < rings; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * (0.18 / rings), 0.035, 6, 20), k.glow);
    c.rotation.x = Math.PI / 2;
    c.position.y = ch * (0.3 + (0.65 * i) / rings);
    st.add(c);
  }
  const by = ch + 0.2;
  const ball = toonMesh(new THREE.SphereGeometry(0.22 + k.tier * 0.03, 14, 10), coilMat, 0.03);
  ball.position.y = by;
  st.add(ball);
  if (k.tier >= 2) {
    const crownRing = toonMesh(new THREE.TorusGeometry(0.3, 0.04, 6, 20), k.trim, 0.02);
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = by;
    st.add(crownRing);
  }
  const center = new THREE.Vector3(0, by, 0);
  const arcs = balls.map((b) => {
    const m = beam(k.glow, b, center, 0.018 + k.tier * 0.005);
    st.add(m);
    return m;
  });
  k.anims.push((t) => {
    arcs.forEach((m, i) => (m.visible = Math.sin(t * 17 + i * 1.9) + Math.sin(t * 5.1 + i * 3) > -0.3));
    ball.scale.setScalar(1 + Math.sin(t * 9) * 0.04);
  });
  return by;
}

/** Straight Flush: an ascending arc of five suit pillars around a laser emitter. */
function buildStraightFlush(k: Kit, st: THREE.Group): number {
  const suit = k.suit ?? 'S';
  const em = toonMat(k.color, 0.35 * k.dim);
  for (let i = 0; i < 5; i++) {
    const a = (-150 + i * 30) * (Math.PI / 180);
    const x = Math.cos(a) * 0.66;
    const z = Math.sin(a) * 0.66 + 0.06;
    const hh = (0.5 + i * 0.16) * k.H;
    const p = toonMesh(new THREE.CylinderGeometry(0.11, 0.14, hh, 6), k.stone, 0.03);
    p.position.set(x, hh / 2, z);
    st.add(p);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 6), k.glow);
    band.position.set(x, hh * 0.7, z);
    st.add(band);
    const cap = toonMesh(new THREE.CylinderGeometry(0.15, 0.12, 0.06, 6), k.trim, 0.02);
    cap.position.set(x, hh + 0.03, z);
    st.add(cap);
    const e = suitEmblem(suit, em, 0.02);
    e.scale.setScalar(0.3);
    e.position.set(x, hh + 0.25, z);
    st.add(e);
    const ph = i * 0.7;
    k.anims.push((t) => {
      e.rotation.y = Math.sin(t * 1.5 + ph) * 0.6;
      e.position.y = hh + 0.25 + Math.sin(t * 2.5 + ph) * 0.04;
    });
  }
  // emitter in front
  const ped = toonMesh(new THREE.CylinderGeometry(0.2, 0.28, 0.55, 8), k.stone, 0.03);
  ped.position.set(0, 0.275, 0.12);
  st.add(ped);
  const emit = new THREE.Group();
  emit.position.set(0, 0.55, 0.12);
  st.add(emit);
  k.aimers.push(emit);
  const housing = toonMesh(new THREE.SphereGeometry(0.24, 12, 10), k.trim, 0.03);
  housing.position.y = 0.2;
  emit.add(housing);
  const barrel = toonMesh(new THREE.CylinderGeometry(0.08, 0.13, 0.42, 10), k.body, 0.025);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.22, 0.3);
  emit.add(barrel);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 14), glowMat(k.color, 3 * k.dim));
  lens.position.set(0, 0.22, 0.515);
  emit.add(lens);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 24), k.glow);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.2;
  emit.add(halo);
  k.anims.push((t) => (halo.rotation.x = Math.PI / 2 + Math.sin(t * 2) * 0.3));
  return 0.55 + 0.22;
}

/** Royal Flush: a golden palace. Five spires rising to a crowned center with a jackpot gem. */
function buildRoyalFlush(k: Kit, st: THREE.Group): number {
  const gold = toonMat(0xf2b630, 0.12);
  const plat = toonMesh(new THREE.CylinderGeometry(0.85, 0.88, 0.12, 8), gold, 0.03);
  plat.position.y = 0.06;
  st.add(plat);
  const base = 0.12;
  const sideH = [0.85, 1.15];
  [-1, 1].forEach((s) => {
    sideH.forEach((h, i) => {
      const x = s * (0.7 - i * 0.3);
      const top = spire(k, st, x, -0.1 + i * 0.05, 0.15 + i * 0.02, h, {});
      void top;
    });
  });
  // main spire, built on the platform
  const mainH = 1.55;
  const mainGrp = new THREE.Group();
  mainGrp.position.y = base;
  st.add(mainGrp);
  const top = spire(k, mainGrp, 0, 0, 0.27, mainH, { turret: true });
  // crown
  const cy = base + top + 0.1;
  const band = toonMesh(new THREE.CylinderGeometry(0.3, 0.26, 0.16, 10, 1, true), doubleSided(gold), 0.025);
  band.position.y = cy;
  st.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pt = toonMesh(new THREE.ConeGeometry(0.06, 0.2, 5), gold, 0.02);
    pt.position.set(Math.sin(a) * 0.28, cy + 0.17, Math.cos(a) * 0.28);
    st.add(pt);
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), glowMat(i % 2 ? 0xff3df2 : 0x00f0ff, 3));
    jewel.position.set(Math.sin(a) * 0.3, cy, Math.cos(a) * 0.3);
    st.add(jewel);
  }
  // floating jackpot gem that faces the target
  const gy = cy + 0.62;
  const holder = new THREE.Group();
  holder.position.y = gy;
  st.add(holder);
  k.aimers.push(holder);
  const gem = toonMesh(new THREE.DodecahedronGeometry(0.28), toonMat(0xffd700, 0.5), 0.03);
  holder.add(gem);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 5), glowMat(0xffd76a, 2.2));
  halo.rotation.x = Math.PI / 2;
  holder.add(halo);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.02, 6, 32), k.glow);
  halo2.rotation.x = Math.PI / 2;
  holder.add(halo2);
  if (k.suit) {
    const e = suitEmblem(k.suit, toonMat(k.color, 0.35 * k.dim), 0.02);
    e.scale.setScalar(0.32);
    e.position.set(0, base + mainH * 0.55, 0.3);
    st.add(e);
  }
  k.anims.push((t) => {
    gem.rotation.y = t * 1.2;
    gem.rotation.x = t * 0.7;
    gem.position.y = Math.sin(t * 2) * 0.06;
    halo.rotation.z = -t * 0.8;
    halo2.rotation.x = Math.PI / 2 + Math.sin(t * 1.4) * 0.3;
  });
  return gy;
}
