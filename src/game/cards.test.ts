import { describe, expect, it } from 'vitest';
import {
  buildDeck, Card, dealWithTips, describeHand, evaluateHand, HandType, makeRng, rerollWithTips, Suit,
} from './cards';

let nextId = 1000;
function c(spec: string): Card {
  if (spec === 'JK') return { rank: 0, suit: null, joker: true, id: nextId++ };
  const suit = spec.slice(-1) as Suit;
  const r = spec.slice(0, -1);
  const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[r] ?? Number(r);
  return { rank, suit, id: nextId++ };
}
const hand = (s: string) => s.split(' ').map(c);

describe('evaluateHand', () => {
  const cases: [string, HandType, number][] = [
    ['AH', HandType.HighCard, 14],
    ['2H 9C', HandType.HighCard, 9],
    ['2H 2C', HandType.Pair, 2],
    ['JH JC 4S', HandType.Pair, 11],
    ['JH JC 4S 4D', HandType.TwoPair, 11],
    ['7H 7C 7S', HandType.Trips, 7],
    ['5H 6C 7S 8D 9H', HandType.Straight, 9],
    ['AH 2C 3S 4D 5H', HandType.Straight, 5],
    ['10H JC QS KD AH', HandType.Straight, 14],
    ['2H 7H 9H JH KH', HandType.Flush, 13],
    ['3H 3C 3S 9D 9H', HandType.FullHouse, 3],
    ['QH QC QS QD', HandType.Quads, 12],
    ['5S 6S 7S 8S 9S', HandType.StraightFlush, 9],
    ['10D JD QD KD AD', HandType.RoyalFlush, 14],
  ];
  for (const [s, type, rank] of cases) {
    it(`${s} -> ${HandType[type]} (${rank})`, () => {
      const r = evaluateHand(hand(s));
      expect(r.type).toBe(type);
      expect(r.rank).toBe(rank);
    });
  }

  it('flush keeps its suit', () => {
    expect(evaluateHand(hand('2C 7C 9C JC KC')).suit).toBe('C');
  });

  it('a 4-card run is not a straight', () => {
    expect(evaluateHand(hand('5H 6C 7S 8D')).type).toBe(HandType.HighCard);
  });

  it('pair of jacks beats pair of twos', () => {
    expect(evaluateHand(hand('JH JC')).score).toBeGreaterThan(evaluateHand(hand('2H 2C')).score);
  });

  it('jokers become the best card', () => {
    expect(evaluateHand(hand('JK')).type).toBe(HandType.HighCard);
    expect(evaluateHand(hand('KH JK')).type).toBe(HandType.Pair);
    expect(evaluateHand(hand('KH KC JK')).type).toBe(HandType.Trips);
    expect(evaluateHand(hand('10D JD QD KD JK')).type).toBe(HandType.RoyalFlush);
    expect(evaluateHand(hand('9S 9C JK JK')).type).toBe(HandType.Quads);
  });

  it('describes hands', () => {
    expect(describeHand(evaluateHand(hand('JH JC')))).toBe('Pair of Jacks');
  });
});

describe('dealing', () => {
  it('deals 5 unique cards and leaves 47', () => {
    const { hand: h, deck } = dealWithTips(buildDeck(false), 0, makeRng(1));
    expect(h).toHaveLength(5);
    expect(deck).toHaveLength(47);
    expect(new Set([...h, ...deck].map((x) => x.id)).size).toBe(52);
  });

  it('tips improve the average hand', () => {
    const avg = (tips: number) => {
      const rng = makeRng(42);
      let total = 0;
      for (let i = 0; i < 400; i++) total += evaluateHand(dealWithTips(buildDeck(false), tips, rng).hand).type;
      return total / 400;
    };
    expect(avg(5)).toBeGreaterThan(avg(0) + 0.3);
  });

  it('reroll replaces only marked cards', () => {
    const rng = makeRng(7);
    const { hand: h, deck } = dealWithTips(buildDeck(false), 0, rng);
    const r = rerollWithTips(h, deck, [1, 3], 0, rng);
    expect(r.hand[0]).toBe(h[0]);
    expect(r.hand[2]).toBe(h[2]);
    expect(r.hand[4]).toBe(h[4]);
    expect(r.deck).toHaveLength(45);
  });
});
