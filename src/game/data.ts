// All balance numbers live here so tuning never touches game logic.
import { HandResult, HandType, Suit } from './cards';

export type DamageType = 'phys' | 'magic' | 'pure';
export type Attack = 'single' | 'multi' | 'chain' | 'pierce' | 'splash' | 'pulse' | 'beam';

export const ECONOMY = {
  startGold: 100,
  tipCost: 10,
  maxTipsPerRound: 10,
  rerollsPerRound: 1,
  leakMultiplier: 3,
  /** Refund when selling, by hand type. */
  sellValue: [5, 10, 20, 30, 45, 55, 70, 90, 120, 150],
  /** Gold bonus for clearing a wave. */
  waveClearBonus: 10,
};

export interface TowerDef {
  name: string;
  attack: Attack;
  dmgType: DamageType | 'suit';
  damage: number;
  /** Attacks per second. Beam towers use damage as damage per second. */
  rate: number;
  range: number;
  /** multi: targets, chain: jumps, single: shots per attack */
  count: number;
  /** splash or pulse radius */
  radius: number;
  color: number;
  blurb: string;
  highBonus: string;
}

export const TOWERS: TowerDef[] = [
  { name: 'Neon Dart', attack: 'single', dmgType: 'phys', damage: 7, rate: 3.2, range: 6.5, count: 1, radius: 0, color: 0xff9a3c,
    blurb: 'Rapid single-target darts.', highBonus: 'Face card high: +40% attack speed.' },
  { name: 'Twin Beam', attack: 'single', dmgType: 'phys', damage: 11, rate: 1.9, range: 7, count: 2, radius: 0, color: 0xffb347,
    blurb: 'Fires an alternating double shot.', highBonus: 'Jacks or better: triple shot.' },
  { name: 'Ricochet', attack: 'multi', dmgType: 'phys', damage: 16, rate: 1.5, range: 7.5, count: 2, radius: 0, color: 0xffd23f,
    blurb: 'Hits 2 targets at once.', highBonus: 'Jacks or better: 3 targets.' },
  { name: 'Prism', attack: 'chain', dmgType: 'magic', damage: 22, rate: 1.2, range: 7.5, count: 3, radius: 0, color: 0x7df9ff,
    blurb: 'Magic lightning that chains through 3 enemies.', highBonus: 'Jacks or better: 4 jumps.' },
  { name: 'Railgun', attack: 'pierce', dmgType: 'phys', damage: 90, rate: 0.5, range: 12, count: 1, radius: 0.8, color: 0xff6ec7,
    blurb: 'Slow piercing shot that hits everything in a line.', highBonus: 'Jacks or better: +50% damage vs armor.' },
  { name: 'Suit Tower', attack: 'splash', dmgType: 'suit', damage: 34, rate: 1.0, range: 8, count: 1, radius: 2.4, color: 0xffffff,
    blurb: 'Elemental splash. Its suit picks the element.', highBonus: 'Jacks or better: bigger splash.' },
  { name: 'Bass Drop', attack: 'pulse', dmgType: 'phys', damage: 85, rate: 0.45, range: 5, count: 1, radius: 5, color: 0xff3df2,
    blurb: 'Shockwave that hits every enemy around it.', highBonus: 'Jacks or better: shockwave stuns briefly.' },
  { name: 'Storm Coil', attack: 'multi', dmgType: 'magic', damage: 38, rate: 2.0, range: 8.5, count: 4, radius: 0, color: 0x9d7bff,
    blurb: 'Magic bolts at 4 targets.', highBonus: 'Jacks or better: 5 targets.' },
  { name: 'Laser Array', attack: 'beam', dmgType: 'suit', damage: 130, rate: 1, range: 9, count: 1, radius: 0, color: 0xffffff,
    blurb: 'Continuous elemental beam plus its suit effect.', highBonus: 'Always premium.' },
  { name: 'Jackpot', attack: 'single', dmgType: 'magic', damage: 220, rate: 1.0, range: 10, count: 1, radius: 0, color: 0xffd700,
    blurb: 'Huge magic hits. Towers nearby deal +25% damage.', highBonus: 'Always premium.' },
];

export const SUIT_COLOR: Record<Suit, number> = { H: 0xff3b5c, S: 0x39ff88, C: 0x6fd8ff, D: 0xff5ce1 };
export const SUIT_EFFECT: Record<Suit, string> = {
  H: 'Burn: extra fire damage over 3s',
  S: 'Poison: damage over time, armor shred (+25% damage taken)',
  C: 'Frost: slows 40% for 2s',
  D: 'Crit: 25% chance for triple damage',
};

export interface TowerStats extends TowerDef {
  hand: HandResult;
  mult: number;
  high: boolean;
  suit: Suit | null;
}

/** Turn a played hand into concrete tower stats. Card rank scales damage. */
export function towerStatsFor(hand: HandResult): TowerStats {
  const def = TOWERS[hand.type];
  const mult = 1 + (Math.min(hand.rank, 14) - 2) * 0.1; // 2 -> 1.0, A -> 2.2
  const high = hand.rank >= 11 || hand.type >= HandType.StraightFlush;
  // only elemental towers (flush family) use their suit
  const suit = def.dmgType === 'suit' ? hand.suit : null;
  const s: TowerStats = { ...def, hand, mult, high, suit, damage: def.damage * mult };
  if (high) {
    switch (hand.type) {
      case HandType.HighCard: s.rate *= 1.4; break;
      case HandType.Pair: s.count = 3; break;
      case HandType.TwoPair: s.count = 3; break;
      case HandType.Trips: s.count = 4; break;
      case HandType.Flush: s.radius *= 1.4; break;
      case HandType.Quads: s.count = 5; break;
    }
  }
  if (suit) s.color = SUIT_COLOR[suit];
  return s;
}

export type EnemyKind = 'runner' | 'brute' | 'wraith' | 'coin' | 'guard' | 'boss';

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  bounty: number;
  resist: DamageType | null;
  dodge: number;
  /** Damage reduction from a shield that drops while slowed or poisoned. */
  shield: number;
  size: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  runner: { name: 'Chip Runner', hp: 60, speed: 3.0, bounty: 2, resist: null, dodge: 0, shield: 0, size: 0.5 },
  brute: { name: 'Dice Brute', hp: 340, speed: 1.35, bounty: 6, resist: 'phys', dodge: 0, shield: 0, size: 0.75 },
  wraith: { name: 'Card Wraith', hp: 180, speed: 2.1, bounty: 5, resist: 'magic', dodge: 0.2, shield: 0, size: 0.6 },
  coin: { name: 'Coin Swarm', hp: 30, speed: 2.5, bounty: 1, resist: null, dodge: 0, shield: 0, size: 0.32 },
  guard: { name: 'Roulette Guard', hp: 420, speed: 1.7, bounty: 8, resist: null, dodge: 0, shield: 0.6, size: 0.7 },
  boss: { name: 'The Pit Boss', hp: 7500, speed: 0.75, bounty: 200, resist: null, dodge: 0, shield: 0, size: 1.6 },
};

export interface SpawnGroup { kind: EnemyKind; count: number; gap: number; delay?: number }
export interface WaveDef { name: string; groups: SpawnGroup[] }

export const WAVES: WaveDef[] = [
  { name: 'Chip Runners', groups: [{ kind: 'runner', count: 12, gap: 0.9 }] },
  { name: 'Faster Chips', groups: [{ kind: 'runner', count: 16, gap: 0.7 }] },
  { name: 'Dice Brutes', groups: [{ kind: 'brute', count: 8, gap: 1.6 }] },
  { name: 'Coin Swarm', groups: [{ kind: 'coin', count: 30, gap: 0.25 }] },
  { name: 'Wraith Shuffle', groups: [{ kind: 'wraith', count: 10, gap: 1.1 }, { kind: 'runner', count: 10, gap: 0.6, delay: 3 }] },
  { name: 'Roulette Guards', groups: [{ kind: 'guard', count: 6, gap: 1.8 }, { kind: 'coin', count: 12, gap: 0.3, delay: 4 }] },
  { name: 'Heavy Table', groups: [{ kind: 'brute', count: 12, gap: 1.2 }, { kind: 'wraith', count: 8, gap: 1.2, delay: 5 }] },
  { name: 'Chip Rush', groups: [{ kind: 'runner', count: 40, gap: 0.35 }] },
  { name: 'Full Floor', groups: [
    { kind: 'runner', count: 10, gap: 0.5 }, { kind: 'brute', count: 6, gap: 1.4, delay: 2 },
    { kind: 'wraith', count: 6, gap: 1.2, delay: 6 }, { kind: 'coin', count: 16, gap: 0.25, delay: 10 },
    { kind: 'guard', count: 4, gap: 1.8, delay: 12 },
  ] },
  { name: 'The Pit Boss', groups: [{ kind: 'boss', count: 1, gap: 1 }, { kind: 'runner', count: 8, gap: 0.8, delay: 6 }] },
];

/** Enemy health grows each wave. */
export function hpScale(waveIndex: number): number {
  return 1 + 0.3 * waveIndex;
}

// ---- Map: a grid of tiles with one winding path. Tile (0,0) is top-left. ----
export const MAP_W = 22;
export const MAP_H = 14;
export const TILE = 2;

/** Path corners in tile coordinates. Enemies walk from first to last. */
export const PATH_POINTS: [number, number][] = [
  [-1, 2], [4, 2], [4, 10], [9, 10], [9, 3], [14, 3], [14, 11], [18, 11], [18, 6], [22, 6],
];
