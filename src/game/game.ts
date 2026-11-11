// Game state machine, combat simulation and the round flow.
import * as THREE from 'three';
import { audio } from '../audio';
import {
  buildDeck, Card, dealWithTips, describeHand, evaluateHand, HandResult, makeRng, rerollWithTips, Rng, Suit,
} from './cards';
import {
  DamageType, ECONOMY, ENEMIES, EnemyDef, EnemyKind, hpScale, SUIT_COLOR, towerStatsFor, TowerStats, WAVES,
} from './data';
import { buildEnemyModel, buildPad, buildTowerModel, EnemyModel, TowerModel } from '../render/models';
import { Stage, tileToWorld } from '../render/scene';
import { cardTexture, updateTextTexture } from '../render/textures';
import { neonMat, toonMat, toonMesh } from '../render/toon';
import { Element, Vfx } from '../render/vfx';

export type Phase = 'menu' | 'place' | 'reroll' | 'select' | 'ready' | 'wave' | 'won' | 'lost';

export interface Pad {
  tile: [number, number];
  card: Card | null;
  group: THREE.Group;
  cardMesh: THREE.Mesh;
  frame: THREE.Mesh;
  marked: boolean;
}

export interface Enemy {
  kind: EnemyKind;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  dist: number;
  pos: THREE.Vector3;
  heading: number;
  model: EnemyModel;
  hpBar: THREE.Group;
  hpFill: THREE.Mesh;
  resist: DamageType | null;
  speedMult: number;
  speedT: number;
  slowT: number;
  slowAmt: number;
  burnT: number;
  burnDps: number;
  poisonT: number;
  poisonDps: number;
  shredT: number;
  stunT: number;
  alive: boolean;
  // boss
  phase: number;
  bossT: number;
  stealT: number;
  shieldHits: number;
  armorT: number;
}

export interface Tower {
  id: number;
  stats: TowerStats;
  tile: [number, number];
  pos: THREE.Vector3;
  model: TowerModel;
  cooldown: number;
  disabledT: number;
  beamTarget: Enemy | null;
  beamTick: number;
  beam: THREE.Mesh | null;
  /** Wide soft glow drawn around the beam core. */
  beamGlow?: THREE.Mesh;
  kills: number;
  damageDone: number;
}

interface Projectile {
  mesh: THREE.Object3D;
  target: Enemy;
  last: THREE.Vector3;
  speed: number;
  onHit: (at: THREE.Vector3, enemy: Enemy | null) => void;
  color: number;
  size: number;
  el: Element;
  /** Lobbed projectiles fly a ballistic arc of this peak height instead of homing. */
  arc: number;
  start: THREE.Vector3;
  t: number;
  dur: number;
  spin: number;
}

export interface ShotOpts {
  el?: Element;
  arc?: number;
  /** Custom mesh, for boulders. */
  mesh?: THREE.Object3D;
}

interface Fx {
  obj: THREE.Object3D;
  life: number;
  max: number;
  update: (k: number, dt: number) => void;
}

export interface GameEvents {
  onChange(): void;
  onBanner(text: string, sub?: string, color?: string): void;
  onFloat(pos: THREE.Vector3, text: string, color: string): void;
  onSelectTower(t: Tower | null): void;
}

const tmpV = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

export class Game {
  phase: Phase = 'menu';
  gold = ECONOMY.startGold;
  waveIndex = 0; // index of the next wave to run (0..9)
  tips = 0;
  rerollsLeft = ECONOMY.rerollsPerRound;
  wild = false;
  speed = 1;
  pads: Pad[] = [];
  /** Indices into pads, in the order the player selected them. */
  selection: number[] = [];
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  selectedTower: Tower | null = null;
  time = 0;
  private deck: Card[] = [];
  private dealt: Card[] = [];
  private rng: Rng;
  private projectiles: Projectile[] = [];
  private fx: Fx[] = [];
  private spawnQueue: { at: number; kind: EnemyKind }[] = [];
  private waveTime = 0;
  private segLens: number[] = [];
  private pathLen = 0;
  private nextTowerId = 1;
  boss: Enemy | null = null;
  vfx: Vfx;

  constructor(public stage: Stage, public events: GameEvents, seed?: number) {
    this.rng = makeRng(seed ?? Date.now());
    this.vfx = new Vfx(stage.scene, stage.camera, stage.renderer);
    const w = stage.waypoints;
    for (let i = 0; i < w.length - 1; i++) {
      const l = w[i].distanceTo(w[i + 1]);
      this.segLens.push(l);
      this.pathLen += l;
    }
  }

  // ------------------------------------------------------------ round flow

  start(wild: boolean) {
    this.wild = wild;
    this.gold = ECONOMY.startGold;
    this.waveIndex = 0;
    this.beginRound();
    audio.setLayer(0);
  }

  private beginRound() {
    this.phase = 'place';
    this.tips = 0;
    this.rerollsLeft = ECONOMY.rerollsPerRound;
    this.pads = [];
    this.selection = [];
    this.dealt = [];
    this.events.onBanner(`ROUND ${this.waveIndex + 1}`, 'Tip the dealer, then click 5 open tiles to deal', '#00f0ff');
    this.events.onChange();
  }

  canTip(): boolean {
    return this.phase === 'place' && this.pads.length === 0 && this.gold >= ECONOMY.tipCost && this.tips < ECONOMY.maxTipsPerRound;
  }

  tip() {
    if (!this.canTip()) return;
    this.gold -= ECONOMY.tipCost;
    this.tips++;
    audio.tip();
    this.events.onChange();
  }

  isTileFree(tx: number, ty: number): boolean {
    if (!this.stage.isBuildable(tx, ty)) return false;
    if (this.pads.some((p) => p.tile[0] === tx && p.tile[1] === ty)) return false;
    return !this.towers.some((t) => t.tile[0] === tx && t.tile[1] === ty);
  }

  placePad(tx: number, ty: number): boolean {
    if (this.phase !== 'place' || this.pads.length >= 5 || !this.isTileFree(tx, ty)) return false;
    if (this.pads.length === 0) {
      // the whole deal is decided when the first pad lands, so tips count
      const r = dealWithTips(buildDeck(this.wild), this.tips, this.rng);
      this.dealt = r.hand;
      this.deck = r.deck;
    }
    const { group, card, frame } = buildPad();
    tileToWorld(tx, ty, group.position);
    this.stage.scene.add(group);
    const pad: Pad = { tile: [tx, ty], card: this.dealt[this.pads.length], group, cardMesh: card, frame, marked: false };
    this.pads.push(pad);
    this.showCard(pad, true);
    audio.flip();
    if (this.pads.length === 5) {
      this.phase = 'reroll';
      this.events.onBanner('MARK CARDS TO REROLL', 'Click cards, then Reroll (or Keep All)', '#ff3df2');
    }
    this.events.onChange();
    return true;
  }

  private showCard(pad: Pad, flip: boolean) {
    const mat = pad.cardMesh.material as THREE.MeshBasicMaterial;
    mat.map = cardTexture(pad.card);
    mat.needsUpdate = true;
    if (flip) {
      // flip-in animation
      const m = pad.cardMesh;
      this.addFx(m, 0.35, (k) => {
        m.rotation.set(-Math.PI / 2 + 0.55, 0, 0);
        m.scale.set(Math.abs(Math.cos((1 - k) * Math.PI)), 1, 1);
        m.position.y = 0.6 + Math.sin(k * Math.PI) * 0.6;
      }, false);
    }
  }

  toggleMark(i: number) {
    if (this.phase !== 'reroll') return;
    this.pads[i].marked = !this.pads[i].marked;
    audio.click();
    this.refreshPadLooks();
    this.events.onChange();
  }

  reroll() {
    if (this.phase !== 'reroll') return;
    const idx = this.pads.map((p, i) => (p.marked ? i : -1)).filter((i) => i >= 0);
    if (idx.length > 0 && this.rerollsLeft > 0) {
      const hand = this.pads.map((p) => p.card!);
      const r = rerollWithTips(hand, this.deck, idx, this.tips, this.rng);
      this.deck = r.deck;
      idx.forEach((i) => {
        this.pads[i].card = r.hand[i];
        this.pads[i].marked = false;
        this.showCard(this.pads[i], true);
      });
      this.rerollsLeft--;
      audio.reroll();
    }
    if (this.rerollsLeft <= 0 || idx.length === 0) this.enterSelect();
    this.refreshPadLooks();
    this.events.onChange();
  }

  keepAll() {
    if (this.phase !== 'reroll') return;
    this.pads.forEach((p) => (p.marked = false));
    this.enterSelect();
    this.refreshPadLooks();
    this.events.onChange();
  }

  private enterSelect() {
    this.phase = 'select';
    this.selection = [];
    this.events.onBanner('PLAY YOUR HAND', 'Select cards. Your tower builds on the last one you pick.', '#ffe66d');
  }

  toggleSelect(i: number) {
    if (this.phase !== 'select') return;
    const at = this.selection.indexOf(i);
    if (at >= 0) this.selection.splice(at, 1);
    else this.selection.push(i);
    audio.click();
    this.refreshPadLooks();
    this.events.onChange();
  }

  /** Hand formed by the current selection. */
  currentHand(): HandResult | null {
    if (this.selection.length === 0) return null;
    return evaluateHand(this.selection.map((i) => this.pads[i].card!));
  }

  /** Best hand available from all 5 cards, for hints. */
  bestPossible(): HandResult | null {
    if (this.pads.length < 5) return null;
    return evaluateHand(this.pads.map((p) => p.card!));
  }

  buildTower() {
    if (this.phase !== 'select' || this.selection.length === 0) return;
    const hand = this.currentHand()!;
    const pad = this.pads[this.selection[this.selection.length - 1]];
    const tile = pad.tile;
    for (const p of this.pads) this.removePad(p);
    this.pads = [];
    this.selection = [];
    const t = this.addTower(hand, tile);
    audio.build();
    this.events.onBanner(t.stats.name.toUpperCase(), describeHand(hand), '#' + t.stats.color.toString(16).padStart(6, '0'));
    this.phase = 'ready';
    this.tips = 0;
    this.events.onChange();
  }

  private removePad(p: Pad) {
    const g = p.group;
    this.addFx(g, 0.3, (k) => g.scale.setScalar(Math.max(0.001, 1 - k)), true);
  }

  addTower(hand: HandResult, tile: [number, number]): Tower {
    const stats = towerStatsFor(hand);
    const model = buildTowerModel(stats);
    const pos = tileToWorld(tile[0], tile[1]);
    model.group.position.copy(pos);
    this.stage.scene.add(model.group);
    // rise-up animation
    this.addFx(model.group, 0.5, (k) => {
      model.group.scale.set(1.2, 1.2 * Math.min(1, 0.05 + k * 1.15), 1.2);
    }, false);
    const t: Tower = {
      id: this.nextTowerId++, stats, tile, pos, model, cooldown: 0.3, disabledT: 0,
      beamTarget: null, beamTick: 0, beam: null, kills: 0, damageDone: 0,
    };
    this.towers.push(t);
    this.burst(pos.clone().setY(1), stats.color, 24, 5);
    return t;
  }

  sellValue(t: Tower): number {
    return ECONOMY.sellValue[t.stats.hand.type];
  }

  sellTower(t: Tower) {
    const i = this.towers.indexOf(t);
    if (i < 0 || this.phase === 'won' || this.phase === 'lost') return;
    this.towers.splice(i, 1);
    const v = this.sellValue(t);
    this.gold += v;
    this.events.onFloat(t.pos.clone().setY(2), `+${v}`, '#ffe66d');
    audio.cash();
    if (t.beam) this.stage.scene.remove(t.beam);
    if (t.beamGlow) this.stage.scene.remove(t.beamGlow);
    const g = t.model.group;
    this.addFx(g, 0.35, (k) => g.scale.setScalar(Math.max(0.001, 1 - k)), true);
    this.burst(t.pos.clone().setY(1), 0xffe66d, 16, 4);
    if (this.selectedTower === t) this.selectTower(null);
    this.events.onChange();
  }

  selectTower(t: Tower | null) {
    this.selectedTower = t;
    const ring = this.stage.rangeRing;
    if (t) {
      ring.visible = true;
      ring.position.set(t.pos.x, 0.1, t.pos.z);
      ring.scale.setScalar(t.stats.range);
      (ring.material as THREE.MeshBasicMaterial).color.set(t.stats.color).multiplyScalar(1.4);
    } else ring.visible = false;
    this.events.onSelectTower(t);
  }

  towerAt(tx: number, ty: number): Tower | undefined {
    return this.towers.find((t) => t.tile[0] === tx && t.tile[1] === ty);
  }

  padIndexAt(tx: number, ty: number): number {
    return this.pads.findIndex((p) => p.tile[0] === tx && p.tile[1] === ty);
  }

  refreshPadLooks() {
    this.pads.forEach((p, i) => {
      const selOrder = this.selection.indexOf(i);
      const last = selOrder >= 0 && selOrder === this.selection.length - 1;
      let color = 0x00f0ff;
      if (this.phase === 'reroll' && p.marked) color = 0xff3b5c;
      if (this.phase === 'select') color = selOrder >= 0 ? (last ? 0xffe66d : 0x39ff88) : 0x444466;
      (p.frame.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(2);
      p.cardMesh.position.y = selOrder >= 0 || (this.phase === 'reroll' && p.marked) ? 1.0 : 0.6;
    });
  }

  startWave() {
    if (this.phase !== 'ready') return;
    const wave = WAVES[this.waveIndex];
    this.phase = 'wave';
    this.waveTime = 0;
    this.spawnQueue = [];
    for (const g of wave.groups) {
      for (let i = 0; i < g.count; i++) this.spawnQueue.push({ at: (g.delay ?? 0) + i * g.gap, kind: g.kind });
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    const isBoss = wave.groups.some((g) => g.kind === 'boss');
    audio.setLayer(isBoss ? 2 : 1);
    if (isBoss) {
      audio.bossRoar();
      this.stage.shake = 1.2;
      this.events.onBanner('THE PIT BOSS', 'The house always wins... unless you do', '#ff3df2');
    } else {
      audio.wave();
      this.events.onBanner(`WAVE ${this.waveIndex + 1}`, wave.name, '#ff3df2');
    }
    this.events.onChange();
  }

  private endWave() {
    this.waveIndex++;
    for (const p of this.projectiles) this.stage.scene.remove(p.mesh);
    this.projectiles = [];
    for (const t of this.towers) {
      if (t.beam) t.beam.visible = false;
      if (t.beamGlow) t.beamGlow.visible = false;
    }
    audio.setLayer(0);
    if (this.waveIndex >= WAVES.length) {
      this.phase = 'won';
      audio.win();
      this.events.onBanner('JACKPOT!', `You beat the Pit Boss with ${this.gold} gold left`, '#ffe66d');
      this.events.onChange();
      return;
    }
    this.gold += ECONOMY.waveClearBonus;
    this.events.onFloat(new THREE.Vector3(0, 3, 0), `Wave clear +${ECONOMY.waveClearBonus}`, '#ffe66d');
    audio.cash();
    this.beginRound();
  }

  private bust(reason: string) {
    if (this.phase === 'lost') return;
    this.phase = 'lost';
    audio.setLayer(0);
    audio.lose();
    this.events.onBanner('BUSTED', reason, '#ff3b5c');
    this.events.onChange();
  }

  // ------------------------------------------------------------ simulation

  update(rawDt: number) {
    const dt = Math.min(rawDt, 0.05) * this.speed;
    this.time += dt;
    if (this.phase === 'wave') {
      this.waveTime += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveTime) this.spawn(this.spawnQueue.shift()!.kind);
    }
    if (this.phase === 'wave' || this.phase === 'lost' || this.phase === 'won') {
      this.updateEnemies(dt);
      if (this.phase === 'wave') this.updateTowers(dt);
      this.updateProjectiles(dt);
      if (this.phase === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0) this.endWave();
    } else {
      // towers idle-spin while building
      for (const t of this.towers) t.model.head.rotation.y += dt * 0.3;
    }
    this.updateFx(rawDt);
    this.vfx.update(dt);
    audio.setBeams(this.phase === 'wave' ? this.towers.filter((t) => t.beam?.visible).length : 0);
    // pads hover-bob while dealing
    for (const p of this.pads) p.cardMesh.rotation.z = Math.sin(this.time * 2 + p.tile[0]) * 0.04;
  }

  private spawn(kind: EnemyKind, atDist = 0) {
    const def = ENEMIES[kind];
    const hp = kind === 'boss' ? def.hp : def.hp * hpScale(this.waveIndex);
    const model = buildEnemyModel(kind);
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.14), new THREE.MeshBasicMaterial({ color: 0x120022, depthTest: false, transparent: true }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.08), new THREE.MeshBasicMaterial({ color: 0x39ff88, depthTest: false, transparent: true, toneMapped: false }));
    fill.position.z = 0.001;
    bg.renderOrder = 10;
    fill.renderOrder = 11;
    bar.add(bg, fill);
    bar.scale.setScalar(kind === 'boss' ? 3.5 : 1);
    this.stage.scene.add(model.group, bar);
    const e: Enemy = {
      kind, def, hp, maxHp: hp, dist: atDist, pos: new THREE.Vector3(), heading: 0, model, hpBar: bar, hpFill: fill,
      resist: def.resist, speedMult: 1, speedT: 0, slowT: 0, slowAmt: 0, burnT: 0, burnDps: 0, poisonT: 0, poisonDps: 0,
      shredT: 0, stunT: 0, alive: true, phase: 1, bossT: 5, stealT: 10, shieldHits: 0, armorT: 0,
    };
    this.placeOnPath(e);
    this.enemies.push(e);
    if (kind === 'boss') this.boss = e;
  }

  private placeOnPath(e: Enemy) {
    let d = e.dist;
    const w = this.stage.waypoints;
    for (let i = 0; i < this.segLens.length; i++) {
      if (d <= this.segLens[i] || i === this.segLens.length - 1) {
        const k = Math.min(1, d / this.segLens[i]);
        e.pos.lerpVectors(w[i], w[i + 1], k);
        e.heading = Math.atan2(w[i + 1].x - w[i].x, w[i + 1].z - w[i].z);
        return;
      }
      d -= this.segLens[i];
    }
  }

  private updateEnemies(dt: number) {
    const cam = this.stage.camera;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // status effects
      if (e.burnT > 0) { e.burnT -= dt; this.applyRaw(e, e.burnDps * dt, null); }
      if (e.poisonT > 0) { e.poisonT -= dt; this.applyRaw(e, e.poisonDps * dt, null); }
      if (!e.alive) continue;
      e.slowT = Math.max(0, e.slowT - dt);
      e.shredT = Math.max(0, e.shredT - dt);
      e.stunT = Math.max(0, e.stunT - dt);
      if (e.speedT > 0) { e.speedT -= dt; if (e.speedT <= 0) e.speedMult = 1; }
      if (e.kind === 'boss') this.updateBoss(e, dt);
      const slow = e.slowT > 0 ? 1 - e.slowAmt : 1;
      const v = e.stunT > 0 ? 0 : e.def.speed * slow * e.speedMult;
      e.dist += v * dt;
      if (e.dist >= this.pathLen) {
        this.leak(e);
        continue;
      }
      this.placeOnPath(e);
      e.model.group.position.copy(e.pos);
      e.model.animate(this.time, e.heading, dt * (v / Math.max(e.def.speed, 0.01)));
      // health bar faces the camera
      const h = e.kind === 'boss' ? 5.2 : e.def.size * 2 + 0.9;
      e.hpBar.position.set(e.pos.x, h, e.pos.z);
      e.hpBar.quaternion.copy(cam.quaternion);
      const f = Math.max(0, e.hp / e.maxHp);
      e.hpFill.scale.x = Math.max(0.001, f);
      e.hpFill.position.x = -(1 - f) * 0.5;
      const col = (e.hpFill.material as THREE.MeshBasicMaterial).color;
      if (e.kind === 'boss' && e.shieldHits > 0) col.set(0x00f0ff);
      else col.set(f > 0.5 ? 0x39ff88 : f > 0.25 ? 0xffe66d : 0xff3b5c);
      // status particles: frost mist, burn embers, poison bubbles
      const sz = e.kind === 'boss' ? 2.2 : e.def.size * 1.3;
      if (e.slowT > 0 && Math.random() < dt * 24) this.vfx.frostTick(e.pos, sz);
      if (e.burnT > 0 && Math.random() < dt * 30) this.vfx.burnTick(e.pos, sz);
      if (e.poisonT > 0 && Math.random() < dt * 14) this.vfx.poisonTick(e.pos, sz);
      // frost tint
      e.model.group.scale.setScalar((e.kind === 'boss' ? 1 : 1.3) * (e.slowT > 0 ? 0.92 : 1));
    }
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private updateBoss(e: Enemy, dt: number) {
    const parts = e.model.boss!;
    const hpFrac = e.hp / e.maxHp;
    if (e.phase === 1 && hpFrac <= 0.66) {
      e.phase = 2;
      e.shieldHits = 40;
      parts.shield.visible = true;
      audio.bossRoar();
      this.stage.shake = 0.8;
      this.events.onBanner('RAISE!', 'The Pit Boss shields up. Break it with many hits.', '#00f0ff');
    }
    if (e.phase === 2 && hpFrac <= 0.33) {
      e.phase = 3;
      audio.bossRoar();
      this.stage.shake = 1;
      this.events.onBanner('HOUSE EDGE', 'It steals cards and shuts your towers down', '#ff3b5c');
    }
    parts.shield.visible = e.shieldHits > 0;
    if (e.armorT > 0) { e.armorT -= dt; if (e.armorT <= 0) e.resist = null; }

    // reels spin every 8 seconds and land on a random buff
    e.bossT -= dt;
    for (const r of parts.reels) {
      const tex = ((r.material as unknown as THREE.MeshToonMaterial[])[0]).map!;
      if (e.bossT < 1.2) tex.offset.y += dt * 4;
    }
    if (e.bossT <= 0) {
      e.bossT = 8;
      audio.slotSpin();
      const roll = Math.floor(this.rng() * 3);
      for (const r of parts.reels) ((r.material as unknown as THREE.MeshToonMaterial[])[0]).map!.offset.y = roll * 0.125 * 2;
      if (roll === 0) {
        e.resist = this.rng() < 0.5 ? 'phys' : 'magic';
        e.armorT = 6;
        this.events.onFloat(e.pos.clone().setY(6), `${e.resist === 'phys' ? 'PHYSICAL' : 'MAGIC'} ARMOR`, '#7df9ff');
      } else if (roll === 1) {
        e.speedMult = 2.2;
        e.speedT = 3;
        this.events.onFloat(e.pos.clone().setY(6), 'SPEED BURST', '#ffe66d');
      } else {
        for (let i = 0; i < 4; i++) this.spawn('runner', Math.max(0, e.dist - 1 - i * 0.8));
        this.events.onFloat(e.pos.clone().setY(6), 'CHIPS IN!', '#ff2fa8');
      }
    }
    // phase 3: steal a card, disabling a tower
    if (e.phase === 3) {
      e.stealT -= dt;
      if (e.stealT <= 0) {
        e.stealT = 10;
        const live = this.towers.filter((t) => t.disabledT <= 0);
        if (live.length) {
          const t = live[Math.floor(this.rng() * live.length)];
          t.disabledT = 5;
          audio.steal();
          audio.lightning(2, this.pan(t.pos));
          this.vfx.chainLightning([e.pos.clone().setY(3), t.pos.clone().setY(1.5)], 0xff3b5c);
          this.events.onFloat(t.pos.clone().setY(3), 'CARD STOLEN', '#ff3b5c');
        }
      }
    }
    const label = e.shieldHits > 0 ? `SHIELD ${e.shieldHits}` : e.phase === 3 ? 'HOUSE EDGE' : e.armorT > 0 ? `${e.resist === 'phys' ? 'PHYS' : 'MAGIC'} ARMOR` : 'PIT BOSS';
    if ((parts.screen.userData.label as string | undefined) !== label) {
      parts.screen.userData.label = label;
      updateTextTexture(parts.screenTex, label, e.shieldHits > 0 ? '#00f0ff' : e.phase === 3 ? '#ff3b5c' : '#ff3df2');
    }
  }

  private leak(e: Enemy) {
    this.killEnemy(e, false);
    if (e.kind === 'boss') {
      this.gold = Math.min(this.gold, 0) - 1;
      this.bust('The Pit Boss cashed out with your bankroll');
      return;
    }
    const cost = e.def.bounty * ECONOMY.leakMultiplier;
    this.gold -= cost;
    audio.leak();
    this.events.onFloat(e.pos.clone().setY(2), `-${cost}`, '#ff3b5c');
    if (this.gold < 0) this.bust('An enemy got through and your stack hit zero');
    this.events.onChange();
  }

  private killEnemy(e: Enemy, reward: boolean) {
    e.alive = false;
    this.stage.scene.remove(e.model.group, e.hpBar);
    if (e === this.boss) this.boss = null;
    if (reward) {
      this.gold += e.def.bounty;
      audio.kill();
      if (e.def.bounty >= 5) audio.chip();
      this.events.onFloat(e.pos.clone().setY(1.6), `+${e.def.bounty}`, '#ffe66d');
      this.burst(e.pos.clone().setY(0.8), e.kind === 'coin' ? 0xffcf3f : 0xff3df2, e.kind === 'boss' ? 120 : 12, e.kind === 'boss' ? 12 : 4);
      this.vfx.death(e.pos.clone().setY(0.8), e.kind === 'coin' ? 0xffcf3f : 0xff3df2, e.kind === 'boss' ? 4 : e.def.size);
      if (e.kind === 'boss') this.stage.shake = 1.5;
      this.events.onChange();
    }
  }

  private applyRaw(e: Enemy, amount: number, src: Tower | null) {
    if (!e.alive) return;
    e.hp -= amount;
    if (src) src.damageDone += amount;
    if (e.hp <= 0) {
      if (src) src.kills++;
      this.killEnemy(e, true);
    }
  }

  /** Full damage pipeline: dodge, boss shield, armor, guard shield, shred, crit. */
  private damage(e: Enemy, base: number, type: DamageType, src: Tower, opts: { canDodge?: boolean; suit?: Suit | null } = {}) {
    if (!e.alive) return;
    if (opts.canDodge && e.def.dodge > 0 && this.rng() < e.def.dodge) {
      this.events.onFloat(e.pos.clone().setY(2), 'miss', '#7df9ff');
      return;
    }
    if (e.shieldHits > 0) {
      e.shieldHits--;
      audio.shieldHit();
      return;
    }
    let dmg = base * this.auraMult(src);
    if (e.resist && e.resist === type) dmg *= 0.5;
    if (src.stats.high && src.stats.hand.type === 4 && e.resist === 'phys') dmg *= 1.5; // railgun armor piercing
    if (e.def.shield > 0 && e.slowT <= 0 && e.shredT <= 0) dmg *= 1 - e.def.shield;
    if (e.shredT > 0) dmg *= 1.25;
    const suit = opts.suit;
    if (suit === 'D' && this.rng() < 0.25) {
      dmg *= 3;
      this.events.onFloat(e.pos.clone().setY(2.2), 'CRIT!', '#ff5ce1');
      this.vfx.crit(e.pos.clone().setY(1));
      audio.crit(this.pan(e.pos));
    }
    if (suit === 'H') { e.burnT = 3; e.burnDps = Math.max(e.burnDps * 0.5, base * 0.3); }
    if (suit === 'S') { e.poisonT = 3; e.poisonDps = Math.max(e.poisonDps * 0.5, base * 0.25); e.shredT = 3; }
    if (suit === 'C') { e.slowT = 2; e.slowAmt = 0.4; }
    this.applyRaw(e, dmg, src);
  }

  private auraMult(t: Tower): number {
    for (const o of this.towers) {
      if (o !== t && o.stats.hand.type === 9 && o.disabledT <= 0 && o.pos.distanceTo(t.pos) <= 6) return 1.25;
    }
    return 1;
  }

  private inRange(t: Tower, range = t.stats.range): Enemy[] {
    return this.enemies
      .filter((e) => e.alive && (e.pos.x - t.pos.x) ** 2 + (e.pos.z - t.pos.z) ** 2 <= range * range)
      .sort((a, b) => b.dist - a.dist);
  }

  private updateTowers(dt: number) {
    for (const t of this.towers) {
      const s = t.stats;
      if (t.disabledT > 0) {
        t.disabledT -= dt;
        (t.model.ring.material as THREE.MeshBasicMaterial).color.set(0x333344);
        t.model.head.rotation.z = 0.4;
        if (t.beam) t.beam.visible = false;
        if (t.beamGlow) t.beamGlow.visible = false;
        if (t.disabledT <= 0) {
          (t.model.ring.material as THREE.MeshBasicMaterial).color.set(s.color).multiplyScalar(2.2);
          t.model.head.rotation.z = 0;
        }
        continue;
      }
      const targets = this.inRange(t);
      if (targets[0]) {
        const a = Math.atan2(targets[0].pos.x - t.pos.x, targets[0].pos.z - t.pos.z);
        t.model.head.rotation.y = lerpAngle(t.model.head.rotation.y, a, Math.min(1, dt * 12));
      }
      if (s.attack === 'beam') {
        this.updateBeam(t, targets[0] ?? null, dt);
        continue;
      }
      t.cooldown -= dt;
      if (t.cooldown > 0 || targets.length === 0) continue;
      t.cooldown = 1 / s.rate;
      this.fire(t, targets);
    }
  }

  private dmgTypeOf(t: Tower): DamageType {
    return t.stats.dmgType === 'suit' ? 'magic' : t.stats.dmgType;
  }

  /** Stereo position of a world point: -1 at the left edge of the screen, 1 at the right. */
  private pan(p: THREE.Vector3): number {
    return THREE.MathUtils.clamp(tmpV.copy(p).project(this.stage.camera).x, -1, 1);
  }

  private fire(t: Tower, targets: Enemy[]) {
    const s = t.stats;
    const from = t.pos.clone().setY(t.model.muzzleY);
    const type = this.dmgTypeOf(t);
    const pan = this.pan(t.pos);
    switch (s.attack) {
      case 'single': {
        const target = targets[0];
        const jackpot = s.hand.type === 9;
        for (let i = 0; i < s.count; i++) {
          this.later(i * 0.09, () => {
            if (!target.alive) return;
            this.vfx.muzzle(from, s.color, jackpot ? 1.8 : 1);
            this.projectile(from, target, s.color, jackpot ? 0.32 : 0.14, 26, (at, hit) => {
              if (hit) this.damage(hit, s.damage, type, t, { canDodge: true });
              if (jackpot) {
                this.vfx.jackpot(at);
                this.stage.shake = Math.max(this.stage.shake, 0.12);
              } else {
                this.vfx.impact(at, s.color, 0.8);
                if (hit) audio.thud(this.pan(at));
              }
            });
            if (!jackpot && i > 0) audio.dart(pan);
          });
        }
        if (jackpot) audio.jackpot(pan);
        else audio.dart(pan);
        break;
      }
      case 'multi': {
        const magic = s.dmgType === 'magic';
        this.vfx.muzzle(from, s.color, magic ? 1.5 : 1);
        for (const target of targets.slice(0, s.count)) {
          this.projectile(from, target, s.color, magic ? 0.2 : 0.16, magic ? 20 : 24, (at, hit) => {
            if (hit) this.damage(hit, s.damage, type, t, { canDodge: true });
            if (magic) this.vfx.arcaneHit(at, s.color);
            else {
              this.vfx.impact(at, s.color, 1);
              audio.ping(this.pan(at));
            }
          }, { el: magic ? 'D' : null });
        }
        if (magic) audio.arcane(pan);
        else audio.dart(pan);
        break;
      }
      case 'chain': {
        let cur: Enemy | undefined = targets[0];
        let p = from;
        let dmg = s.damage;
        const hit = new Set<Enemy>();
        const pts: THREE.Vector3[] = [from];
        for (let i = 0; i < s.count && cur; i++) {
          hit.add(cur);
          const to = cur.pos.clone().setY(1);
          pts.push(to);
          this.damage(cur, dmg, type, t, { canDodge: true });
          dmg *= 0.85;
          p = to;
          const last: Enemy = cur;
          cur = this.enemies
            .filter((e) => e.alive && !hit.has(e) && e.pos.distanceTo(last.pos) < 4)
            .sort((a, b) => a.pos.distanceTo(last.pos) - b.pos.distanceTo(last.pos))[0];
        }
        void p;
        this.vfx.chainLightning(pts, s.color);
        audio.lightning(pts.length - 1, pan);
        break;
      }
      case 'pierce': {
        const dir = targets[0].pos.clone().setY(0).sub(tmpV.copy(t.pos).setY(0)).normalize();
        const end = t.pos.clone().addScaledVector(dir, s.range);
        for (const e of [...this.enemies]) {
          if (!e.alive) continue;
          const rel = e.pos.clone().sub(t.pos).setY(0);
          const along = rel.dot(dir);
          if (along < 0 || along > s.range) continue;
          const perp = rel.addScaledVector(dir, -along).length();
          if (perp <= s.radius + e.def.size * 0.6) {
            this.damage(e, s.damage, type, t);
            this.vfx.impact(e.pos.clone().setY(0.9), s.color, 1.2);
          }
        }
        end.setY(from.y * 0.6);
        this.beamFlash(from, end, s.color, 0.25, 0.22);
        this.vfx.rail(from, end, s.color);
        this.stage.shake = Math.max(this.stage.shake, 0.1);
        audio.railgun(pan);
        break;
      }
      case 'splash': {
        // a lobbed boulder that smashes into the floor
        const target = targets[0];
        const el = s.suit as Element;
        this.vfx.muzzle(from, s.color, 1.3);
        audio.boulderLaunch(pan);
        this.projectile(from, target, s.color, 0.34, 13, (at) => {
          const ground = at.clone().setY(0);
          for (const e of [...this.enemies]) {
            if (e.alive && e.pos.distanceTo(ground) <= s.radius) this.damage(e, s.damage, type, t, { suit: s.suit });
          }
          this.vfx.boulderSmash(ground, s.radius, s.color, el);
          this.stage.shake = Math.max(this.stage.shake, 0.22);
          audio.boulderSmash(s.radius / 2.4, this.pan(ground), el);
        }, { el, arc: 3.2, mesh: this.boulderMesh(s.color) });
        break;
      }
      case 'pulse': {
        for (const e of targets) {
          this.damage(e, s.damage, type, t);
          if (s.high && e.kind !== 'boss') e.stunT = Math.max(e.stunT, 0.5);
        }
        this.vfx.bassDrop(t.pos, s.radius, s.color, s.high);
        this.stage.shake = Math.max(this.stage.shake, 0.3);
        audio.bassDrop(pan);
        break;
      }
    }
  }

  /** A chunky cel shaded rock with glowing seams in the tower color. */
  private boulderMesh(color: number): THREE.Object3D {
    const g = new THREE.Group();
    const rock = toonMesh(new THREE.DodecahedronGeometry(0.42, 0), toonMat(0x4a2c6e), 0.05);
    rock.scale.set(1, 0.85, 1.1);
    g.add(rock);
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 4, 12), neonMat(color, 3));
    seam.rotation.x = Math.PI / 2;
    g.add(seam);
    const seam2 = seam.clone();
    seam2.rotation.set(0, Math.PI / 2, 0.4);
    g.add(seam2);
    return g;
  }

  private updateBeam(t: Tower, target: Enemy | null, dt: number) {
    const s = t.stats;
    if (!t.beam) {
      t.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), neonMat(0xffffff, 1, 0.95));
      (t.beam.material as THREE.MeshBasicMaterial).color.set(s.color).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(4);
      t.beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), neonMat(s.color, 2, 0.35));
      const gm = t.beamGlow.material as THREE.MeshBasicMaterial;
      gm.blending = THREE.AdditiveBlending;
      gm.depthWrite = false;
      this.stage.scene.add(t.beam, t.beamGlow);
    }
    if (!target) {
      t.beam.visible = false;
      if (t.beamGlow) t.beamGlow.visible = false;
      return;
    }
    const from = t.pos.clone().setY(t.model.muzzleY);
    const to = target.pos.clone().setY(0.8);
    const pulse = Math.sin(this.time * 40);
    placeCylinder(t.beam, from, to, 0.06 + pulse * 0.02);
    t.beam.visible = true;
    if (t.beamGlow) {
      placeCylinder(t.beamGlow, from, to, 0.22 + Math.sin(this.time * 23) * 0.05 + Math.random() * 0.04);
      t.beamGlow.visible = true;
    }
    this.vfx.beamContact(to, s.color, s.suit as Element);
    if (Math.random() < dt * 20) this.vfx.glow(from, s.color, 0.6, 0.15);
    t.beamTick -= dt;
    // continuous damage, suit effect refreshed twice a second
    const applySuit = t.beamTick <= 0;
    if (applySuit) t.beamTick = 0.5;
    this.damage(target, s.damage * dt, 'magic', t, { suit: applySuit ? s.suit : null });
    if (applySuit) audio.beamZap(this.pan(to), s.suit as Element);
  }

  // ------------------------------------------------------------ projectiles & fx

  private later(delay: number, fn: () => void) {
    const o = new THREE.Object3D();
    this.fx.push({ obj: o, life: 0, max: delay + 0.0001, update: (k) => { if (k >= 1) fn(); } });
  }

  private projectile(from: THREE.Vector3, target: Enemy, color: number, size: number, speed: number, onHit: Projectile['onHit'], opts: ShotOpts = {}) {
    const mesh = opts.mesh ?? new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), neonMat(color, 3));
    mesh.position.copy(from);
    this.stage.scene.add(mesh);
    const arc = opts.arc ?? 0;
    const dist = from.distanceTo(target.pos);
    this.projectiles.push({
      mesh, target, last: target.pos.clone(), speed, onHit, color, size, el: opts.el ?? null,
      arc, start: from.clone(), t: 0, dur: Math.max(0.35, dist / speed), spin: (Math.random() - 0.5) * 14,
    });
  }

  private updateProjectiles(dt: number) {
    this.projectiles = this.projectiles.filter((p) => {
      if (p.target.alive) p.last.copy(p.target.pos);
      if (p.arc > 0) {
        // ballistic lob that still tracks where the target is now
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        const dest = tmpV.copy(p.last).setY(0.3);
        p.mesh.position.lerpVectors(p.start, dest, k);
        p.mesh.position.y += 4 * p.arc * k * (1 - k);
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.z += p.spin * 0.6 * dt;
        this.vfx.trail(p.mesh.position, p.color, p.size * 0.6, p.el);
        if (k >= 1) {
          this.stage.scene.remove(p.mesh);
          p.onHit(dest.clone(), p.target.alive ? p.target : null);
          return false;
        }
        return true;
      }
      const dest = tmpV.copy(p.last).setY(0.8);
      const d = dest.clone().sub(p.mesh.position);
      const step = p.speed * dt;
      if (d.length() <= step + 0.2) {
        this.stage.scene.remove(p.mesh);
        p.onHit(dest.clone(), p.target.alive ? p.target : null);
        return false;
      }
      p.mesh.position.addScaledVector(d.normalize(), step);
      this.vfx.trail(p.mesh.position, p.color, p.size, p.el);
      return true;
    });
  }

  private addFx(obj: THREE.Object3D, max: number, update: (k: number, dt: number) => void, removeAtEnd = true, addToScene = false) {
    if (addToScene) this.stage.scene.add(obj);
    this.fx.push({
      obj, life: 0, max,
      update: (k, dt) => {
        update(k, dt);
        if (k >= 1 && removeAtEnd) obj.parent?.remove(obj);
      },
    });
  }

  private updateFx(dt: number) {
    const d = dt * this.speed;
    this.fx = this.fx.filter((f) => {
      f.life += d;
      const k = Math.min(1, f.life / f.max);
      f.update(k, d);
      return k < 1;
    });
  }

  private beamFlash(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, dur: number) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), neonMat(color, 3, 1));
    (m.material as THREE.MeshBasicMaterial).transparent = true;
    placeCylinder(m, from, to, width);
    const mat = m.material as THREE.MeshBasicMaterial;
    this.addFx(m, dur, (k) => {
      mat.opacity = 1 - k;
      m.scale.x = m.scale.z = width * (1 - k * 0.7);
    }, true, true);
  }

  burst(at: THREE.Vector3, color: number, count: number, power: number) {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = neonMat(color, 2.5);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(at);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).normalize().multiplyScalar(power * (0.5 + Math.random()));
      const spin = Math.random() * 10;
      this.addFx(m, 0.6 + Math.random() * 0.4, (k, dt) => {
        v.y -= 14 * dt;
        m.position.addScaledVector(v, dt);
        if (m.position.y < 0.1) { m.position.y = 0.1; v.y *= -0.4; v.x *= 0.7; v.z *= 0.7; }
        m.rotation.x += spin * dt;
        m.scale.setScalar(Math.max(0.001, 1 - k));
      }, true, true);
    }
  }

  // ------------------------------------------------------------ debug helpers for automated playtests

  debugDealHand(hand: HandResult, tile: [number, number]) {
    return this.addTower(hand, tile);
  }

  get wavesTotal() {
    return WAVES.length;
  }

  suitColor(s: Suit) {
    return SUIT_COLOR[s];
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function placeCylinder(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, width: number) {
  const d = to.clone().sub(from);
  const len = d.length();
  m.position.copy(from).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(up, d.normalize());
  m.scale.set(width, len, width);
}
