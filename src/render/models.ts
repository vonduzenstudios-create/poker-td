// Procedural low-poly models, all cel shaded with ink outlines.
import * as THREE from 'three';
import { HandType } from '../game/cards';
import { EnemyKind, TowerStats } from '../game/data';
import { chipTexture, dieTexture, reelTexture, textTexture } from './textures';
import { neonMat, toonMat, toonMesh } from './toon';

export interface TowerModel {
  group: THREE.Group;
  /** Part that turns to face the target. */
  head: THREE.Object3D;
  /** Height that projectiles leave from. */
  muzzleY: number;
  /** Neon ring at the base, recolored when disabled. */
  ring: THREE.Mesh;
}

export function buildTowerModel(s: TowerStats): TowerModel {
  const g = new THREE.Group();
  const c = s.color;
  const tier = s.hand.type;
  const lift = 0.15 + (s.hand.rank - 2) * 0.025; // higher cards build taller towers

  // base: a stack of chips
  const base = toonMesh(new THREE.CylinderGeometry(0.85, 0.95, 0.35, 8), toonMat(0x2a1640));
  base.position.y = 0.18;
  g.add(base);
  const plinth = toonMesh(new THREE.CylinderGeometry(0.62, 0.7, 0.3 + lift, 8), toonMat(0x3d1f5c));
  plinth.position.y = 0.35 + (0.3 + lift) / 2;
  g.add(plinth);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 32), neonMat(c, 2.2));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.38;
  g.add(ring);

  const head = new THREE.Group();
  const top = 0.65 + lift;
  head.position.y = top;
  g.add(head);
  let muzzleY = top + 0.5;

  const body = toonMat(c, 0.25);
  const glow = neonMat(c, 2.5);
  switch (tier) {
    case HandType.HighCard: {
      const cone = toonMesh(new THREE.ConeGeometry(0.3, 0.9, 6), body);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, 0.35, 0.2);
      head.add(cone);
      muzzleY = top + 0.35;
      break;
    }
    case HandType.Pair: {
      for (const x of [-0.22, 0.22]) {
        const barrel = toonMesh(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8), body);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(x, 0.35, 0.25);
        head.add(barrel);
      }
      const hub = toonMesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), toonMat(0x4b2a6e));
      hub.position.y = 0.3;
      head.add(hub);
      muzzleY = top + 0.35;
      break;
    }
    case HandType.TwoPair: {
      const torus = toonMesh(new THREE.TorusGeometry(0.42, 0.12, 8, 16), body);
      torus.position.y = 0.5;
      head.add(torus);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), glow);
      core.position.y = 0.5;
      head.add(core);
      muzzleY = top + 0.5;
      break;
    }
    case HandType.Trips: {
      const prism = toonMesh(new THREE.OctahedronGeometry(0.5), toonMat(c, 0.6));
      prism.position.y = 0.7;
      prism.scale.y = 1.5;
      head.add(prism);
      muzzleY = top + 0.7;
      break;
    }
    case HandType.Straight: {
      const rail = toonMesh(new THREE.BoxGeometry(0.3, 0.3, 1.8), body);
      rail.position.set(0, 0.35, 0.4);
      head.add(rail);
      const coil = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 1.4), glow);
      coil.position.set(0, 0.53, 0.4);
      head.add(coil);
      muzzleY = top + 0.35;
      break;
    }
    case HandType.Flush:
    case HandType.StraightFlush: {
      const orb = toonMesh(new THREE.IcosahedronGeometry(0.45, 0), toonMat(c, 0.8));
      orb.position.y = 0.7;
      head.add(orb);
      const n = tier === HandType.StraightFlush ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.65 + i * 0.15, 0.03, 6, 32), glow);
        r.position.y = 0.7;
        r.rotation.x = Math.PI / 2 + i * 0.5;
        r.rotation.y = i * 0.9;
        head.add(r);
      }
      muzzleY = top + 0.7;
      break;
    }
    case HandType.FullHouse: {
      // a speaker stack
      const box = toonMesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), toonMat(0x221133));
      box.position.y = 0.5;
      head.add(box);
      for (const y of [0.3, 0.72]) {
        const cone = new THREE.Mesh(new THREE.CircleGeometry(y > 0.5 ? 0.18 : 0.3, 16), glow);
        cone.position.set(0, y, 0.51);
        head.add(cone);
      }
      muzzleY = top + 0.5;
      break;
    }
    case HandType.Quads: {
      const pole = toonMesh(new THREE.CylinderGeometry(0.15, 0.25, 1.4, 8), toonMat(0x4b2a6e));
      pole.position.y = 0.7;
      head.add(pole);
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.35 - i * 0.07, 0.05, 6, 20), glow);
        coil.rotation.x = Math.PI / 2;
        coil.position.y = 0.4 + i * 0.4;
        head.add(coil);
      }
      const ball = toonMesh(new THREE.SphereGeometry(0.3, 12, 8), toonMat(c, 0.9));
      ball.position.y = 1.55;
      head.add(ball);
      muzzleY = top + 1.55;
      break;
    }
    case HandType.RoyalFlush: {
      const gem = toonMesh(new THREE.DodecahedronGeometry(0.6), toonMat(0xffd700, 0.7));
      gem.position.y = 0.9;
      head.add(gem);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 6, 5), glow);
      crown.rotation.x = Math.PI / 2;
      crown.position.y = 0.9;
      head.add(crown);
      muzzleY = top + 0.9;
      break;
    }
  }
  g.scale.setScalar(1.2);
  return { group: g, head, muzzleY: muzzleY * 1.2, ring };
}

export interface EnemyModel {
  group: THREE.Group;
  /** Called every frame with time and movement direction angle. */
  animate(t: number, heading: number, dt: number): void;
  /** Boss-only hooks. */
  boss?: BossParts;
}

export interface BossParts {
  reels: THREE.Mesh[];
  shield: THREE.Mesh;
  screen: THREE.Mesh;
  screenTex: THREE.CanvasTexture;
}

let chipTex: THREE.CanvasTexture | null = null;
let coinTex: THREE.CanvasTexture | null = null;
let dieMats: THREE.Material[] | null = null;

export function buildEnemyModel(kind: EnemyKind): EnemyModel {
  const group = new THREE.Group();
  switch (kind) {
    case 'runner': {
      chipTex ??= chipTexture('#ff2fa8', '#fff6fb');
      const chip = toonMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 20), [
        toonMat(0xff2fa8), toonMat(0xffffff, 0, chipTex), toonMat(0xffffff, 0, chipTex),
      ] as unknown as THREE.Material, 0.04);
      const roller = new THREE.Group();
      chip.rotation.x = Math.PI / 2;
      roller.add(chip);
      roller.position.y = 0.48;
      group.add(roller);
      return {
        group,
        animate(_t, heading, dt) {
          group.rotation.y = heading;
          chip.rotation.y += dt * 9; // roll along the path
        },
      };
    }
    case 'coin': {
      coinTex ??= chipTexture('#ffcf3f', '#fff2a8');
      const coin = toonMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16), [
        toonMat(0xffcf3f, 0.3), toonMat(0xffffff, 0.1, coinTex), toonMat(0xffffff, 0.1, coinTex),
      ] as unknown as THREE.Material, 0.03);
      coin.rotation.x = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(coin);
      holder.position.y = 0.4;
      group.add(holder);
      const phase = Math.random() * 6;
      return {
        group,
        animate(t) {
          holder.rotation.y = t * 6 + phase;
          holder.position.y = 0.4 + Math.abs(Math.sin(t * 8 + phase)) * 0.35;
        },
      };
    }
    case 'brute': {
      dieMats ??= [1, 6, 2, 5, 3, 4].map((n) => toonMat(0xffffff, 0, dieTexture(n)));
      const die = toonMesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), dieMats as unknown as THREE.Material, 0.06);
      die.position.y = 0.6;
      group.add(die);
      let roll = 0;
      return {
        group,
        animate(_t, heading, dt) {
          group.rotation.y = heading;
          roll += dt * 2.2;
          // tumble in quarter turns with a little hop
          const q = Math.floor(roll);
          const f = roll - q;
          const ease = f < 0.7 ? 0 : (f - 0.7) / 0.3;
          die.rotation.x = (q + ease) * (Math.PI / 2);
          die.position.y = 0.6 + Math.sin(ease * Math.PI) * 0.25;
        },
      };
    }
    case 'wraith': {
      const card = toonMesh(new THREE.BoxGeometry(0.8, 1.1, 0.05), toonMat(0x7df9ff, 0.7), 0.04);
      const mat = card.material as THREE.MeshToonMaterial;
      mat.transparent = true;
      mat.opacity = 0.75;
      card.position.y = 1.0;
      group.add(card);
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), neonMat(0xff3df2, 3));
      eye.position.set(0, 0.1, 0.035);
      card.add(eye);
      const eye2 = eye.clone();
      eye2.position.z = -0.035;
      eye2.rotation.y = Math.PI;
      card.add(eye2);
      const phase = Math.random() * 6;
      return {
        group,
        animate(t, heading) {
          group.rotation.y = heading + Math.sin(t * 2 + phase) * 0.6;
          card.position.y = 1.0 + Math.sin(t * 3 + phase) * 0.18;
        },
      };
    }
    case 'guard': {
      const disc = toonMesh(new THREE.CylinderGeometry(0.6, 0.7, 0.4, 16), toonMat(0x1a1a2e));
      disc.position.y = 0.45;
      group.add(disc);
      const wheelTop = new THREE.Group();
      wheelTop.position.y = 0.67;
      group.add(wheelTop);
      for (let i = 0; i < 12; i++) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.55, 0.55, 0.04, 1, 1, false, (i / 12) * Math.PI * 2, (Math.PI * 2) / 12),
          toonMat(i % 2 ? 0xff2f4f : 0x111111, 0.2),
        );
        wheelTop.add(seg);
      }
      const shield = toonMesh(
        new THREE.CylinderGeometry(0.95, 0.95, 0.9, 16, 1, true, -Math.PI / 3, (Math.PI * 2) / 3),
        toonMat(0x00f0ff, 0.9), 0,
      );
      const smat = shield.material as THREE.MeshToonMaterial;
      smat.transparent = true;
      smat.opacity = 0.55;
      smat.side = THREE.DoubleSide;
      shield.position.y = 0.6;
      const shieldPivot = new THREE.Group();
      shieldPivot.add(shield);
      group.add(shieldPivot);
      return {
        group,
        animate(t, heading) {
          group.rotation.y = heading;
          wheelTop.rotation.y = t * 4;
          shieldPivot.rotation.y = Math.PI / 2 + Math.sin(t * 1.5) * 0.4;
        },
      };
    }
    case 'boss':
      return buildBoss(group);
  }
}

function buildBoss(group: THREE.Group): EnemyModel {
  const s = 1.25;
  const root = new THREE.Group();
  root.scale.setScalar(s);
  group.add(root);
  // treads
  for (const x of [-0.95, 0.95]) {
    const tread = toonMesh(new THREE.BoxGeometry(0.5, 0.5, 2.0), toonMat(0x1b1030));
    tread.position.set(x, 0.25, 0);
    root.add(tread);
    const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 2.02), neonMat(0xff3df2, 2));
    glowStrip.position.set(x, 0.42, 0);
    root.add(glowStrip);
  }
  // cabinet
  const cab = toonMesh(new THREE.BoxGeometry(2.0, 2.4, 1.4), toonMat(0x7b2ff7, 0.15));
  cab.position.y = 1.7;
  root.add(cab);
  const topper = toonMesh(new THREE.CylinderGeometry(0.7, 0.7, 2.0, 16, 1, false, 0, Math.PI), toonMat(0xff3df2, 0.4));
  topper.rotation.z = Math.PI / 2;
  topper.rotation.y = Math.PI / 2;
  topper.position.y = 2.9;
  root.add(topper);
  // reels
  const rt = reelTexture();
  const reels: THREE.Mesh[] = [];
  const window = toonMesh(new THREE.BoxGeometry(1.7, 0.75, 0.2), toonMat(0x120022));
  window.position.set(0, 1.95, 0.65);
  root.add(window);
  for (let i = 0; i < 3; i++) {
    const tex = rt.clone();
    tex.needsUpdate = true;
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.45, 16), [
      toonMat(0xfff4fb, 0, tex), toonMat(0xe3c9ff), toonMat(0xe3c9ff),
    ] as unknown as THREE.Material);
    reel.rotation.z = Math.PI / 2;
    reel.position.set(-0.52 + i * 0.52, 1.95, 0.52);
    root.add(reel);
    reels.push(reel);
  }
  // visor screen
  const screenTex = textTexture('PIT BOSS', '#ff3df2', 256, 64);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 2.62, 0.71);
  root.add(screen);
  // lever arm
  const lever = toonMesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), toonMat(0xcccccc));
  lever.position.set(1.2, 2.2, 0);
  root.add(lever);
  const knob = toonMesh(new THREE.SphereGeometry(0.2, 12, 8), toonMat(0xff2f4f, 0.6));
  knob.position.set(1.2, 2.8, 0);
  root.add(knob);
  // marquee bulbs
  const bulbs: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), neonMat(0xffe66d, 2.5));
    b.position.set(-0.9 + i * 0.2, 2.98, 0.72);
    root.add(b);
    bulbs.push(b);
  }
  // shield bubble (hidden until phase 2)
  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.0, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00f0ff).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.6, toneMapped: false }),
  );
  shield.position.y = 1.7;
  shield.visible = false;
  root.add(shield);

  return {
    group,
    boss: { reels, shield, screen, screenTex },
    animate(t, heading) {
      group.rotation.y = heading;
      root.position.y = Math.abs(Math.sin(t * 2.5)) * 0.06;
      bulbs.forEach((b, i) => (b.visible = Math.floor(t * 6 + i) % 2 === 0));
      lever.rotation.x = Math.sin(t * 1.3) * 0.3;
      shield.rotation.y = t * 0.8;
    },
  };
}

/** Flat card pad that sits on a build tile while you are dealing. */
export function buildPad(): { group: THREE.Group; card: THREE.Mesh; frame: THREE.Mesh } {
  const group = new THREE.Group();
  const base = toonMesh(new THREE.BoxGeometry(1.6, 0.12, 1.9), toonMat(0x1d0b33), 0.04);
  base.position.y = 0.06;
  group.add(base);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 2.0), neonMat(0x00f0ff, 1.6));
  frame.position.y = 0.03;
  group.add(frame);
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.82),
    new THREE.MeshBasicMaterial({ transparent: true, color: 0xa8a8a8 }),
  );
  card.rotation.x = -Math.PI / 2;
  card.position.y = 0.6;
  group.add(card);
  return { group, card, frame };
}
