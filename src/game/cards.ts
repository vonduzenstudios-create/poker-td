// Deck, dealing and poker hand evaluation. Pure logic, no rendering.

export type Suit = 'H' | 'S' | 'C' | 'D';
export const SUITS: Suit[] = ['H', 'S', 'C', 'D'];

export interface Card {
  /** 2..14 (11=J, 12=Q, 13=K, 14=A). 0 for a joker. */
  rank: number;
  suit: Suit | null;
  joker?: boolean;
  id: number;
}

export enum HandType {
  HighCard = 0,
  Pair,
  TwoPair,
  Trips,
  Straight,
  Flush,
  FullHouse,
  Quads,
  StraightFlush,
  RoyalFlush,
}

export const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush',
];

export interface HandResult {
  type: HandType;
  /** The rank that defines the hand's strength (pair rank, straight high card, etc). */
  rank: number;
  /** Set for flush, straight flush and royal flush. */
  suit: Suit | null;
  /** Single comparable number, higher is better. */
  score: number;
}

const RANK_NAMES: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const RANK_PLURAL: Record<number, string> = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights',
  9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
};
const RANK_SINGLE: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
export const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', S: '♠', C: '♣', D: '♦' };
export const SUIT_NAME: Record<Suit, string> = { H: 'Hearts', S: 'Spades', C: 'Clubs', D: 'Diamonds' };

export function rankLabel(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank);
}

export function cardLabel(c: Card): string {
  return c.joker ? 'JOKER' : `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit!]}`;
}

export function describeHand(h: HandResult): string {
  switch (h.type) {
    case HandType.HighCard: return `${RANK_SINGLE[h.rank]} High`;
    case HandType.Pair: return `Pair of ${RANK_PLURAL[h.rank]}`;
    case HandType.TwoPair: return `Two Pair, ${RANK_PLURAL[h.rank]} up`;
    case HandType.Trips: return `Three ${RANK_PLURAL[h.rank]}`;
    case HandType.Straight: return `Straight to the ${RANK_SINGLE[h.rank]}`;
    case HandType.Flush: return `${SUIT_NAME[h.suit!]} Flush, ${RANK_SINGLE[h.rank]} high`;
    case HandType.FullHouse: return `Full House, ${RANK_PLURAL[h.rank]} full`;
    case HandType.Quads: return `Four ${RANK_PLURAL[h.rank]}`;
    case HandType.StraightFlush: return `${SUIT_NAME[h.suit!]} Straight Flush`;
    case HandType.RoyalFlush: return `Royal Flush of ${SUIT_NAME[h.suit!]}`;
  }
}

/** Small seedable RNG so tests and debugging are reproducible. */
export type Rng = () => number;
export function makeRng(seed = Date.now()): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDeck(wild: boolean): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit, id: id++ });
  if (wild) {
    deck.push({ rank: 0, suit: null, joker: true, id: id++ });
    deck.push({ rank: 0, suit: null, joker: true, id: id++ });
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeResult(type: HandType, rank: number, suit: Suit | null, kick = 0): HandResult {
  return { type, rank, suit, score: type * 10000 + rank * 100 + kick };
}

/** Evaluate 1 to 5 natural cards (no jokers). Straights and flushes need all 5 cards. */
function evaluateNatural(cards: Card[]): HandResult {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // groups sorted by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);

  let isFlush = false;
  let isStraight = false;
  let straightHigh = 0;
  if (cards.length === 5) {
    isFlush = cards.every((c) => c.suit === cards[0].suit);
    if (groups.length === 5) {
      if (ranksDesc[0] - ranksDesc[4] === 4) {
        isStraight = true;
        straightHigh = ranksDesc[0];
      } else if (ranksDesc.join(',') === '14,5,4,3,2') {
        isStraight = true; // wheel
        straightHigh = 5;
      }
    }
  }
  const suit = isFlush ? cards[0].suit : null;
  if (isStraight && isFlush) {
    return straightHigh === 14
      ? makeResult(HandType.RoyalFlush, 14, suit)
      : makeResult(HandType.StraightFlush, straightHigh, suit);
  }
  const [g0, g1] = groups;
  if (g0[1] === 4) return makeResult(HandType.Quads, g0[0], null);
  if (g0[1] === 3 && g1 && g1[1] >= 2) return makeResult(HandType.FullHouse, g0[0], null, g1[0]);
  if (isFlush) return makeResult(HandType.Flush, ranksDesc[0], suit, ranksDesc[1]);
  if (isStraight) return makeResult(HandType.Straight, straightHigh, null);
  if (g0[1] === 3) return makeResult(HandType.Trips, g0[0], null);
  if (g0[1] === 2 && g1 && g1[1] === 2) return makeResult(HandType.TwoPair, g0[0], null, g1[0]);
  if (g0[1] === 2) return makeResult(HandType.Pair, g0[0], null, groups[1]?.[0] ?? 0);
  return makeResult(HandType.HighCard, ranksDesc[0], null, ranksDesc[1] ?? 0);
}

/** Best hand formed by exactly these cards. Jokers become whatever card scores best. */
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length === 0) throw new Error('evaluateHand needs at least one card');
  const naturals = cards.filter((c) => !c.joker);
  const jokers = cards.length - naturals.length;
  if (jokers === 0) return evaluateNatural(naturals);

  let best: HandResult | null = null;
  const tryWith = (extra: Card[]) => {
    const r = evaluateNatural([...naturals, ...extra]);
    if (!best || r.score > best.score) best = r;
  };
  const all: Card[] = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) all.push({ rank, suit, id: -1 });
  if (jokers === 1) {
    for (const a of all) tryWith([a]);
  } else {
    for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j++) tryWith([all[i], all[j]]);
  }
  return best!;
}

/**
 * Deal 5 cards. Each tip makes the dealer secretly deal one more candidate hand,
 * and the player gets the best of them.
 */
export function dealWithTips(deckTemplate: Card[], tips: number, rng: Rng): { hand: Card[]; deck: Card[] } {
  let best: { hand: Card[]; deck: Card[]; score: number } | null = null;
  for (let i = 0; i <= tips; i++) {
    const deck = shuffle(deckTemplate, rng);
    const hand = deck.splice(0, 5);
    const score = evaluateHand(hand).score;
    if (!best || score > best.score) best = { hand, deck, score };
  }
  return { hand: best!.hand, deck: best!.deck };
}

/**
 * Replace the cards at `indices`. With tips active the dealer tries (1 + tips)
 * replacement draws and keeps the one that makes the best 5-card hand.
 */
export function rerollWithTips(hand: Card[], deck: Card[], indices: number[], tips: number, rng: Rng): { hand: Card[]; deck: Card[] } {
  if (indices.length === 0) return { hand, deck };
  let best: { hand: Card[]; deck: Card[]; score: number } | null = null;
  for (let i = 0; i <= tips; i++) {
    const d = shuffle(deck, rng);
    const h = hand.slice();
    for (const idx of indices) h[idx] = d.shift()!;
    const score = evaluateHand(h).score;
    if (!best || score > best.score) best = { hand: h, deck: d, score };
  }
  return { hand: best!.hand, deck: best!.deck };
}
