// Every texture is drawn on a canvas at runtime.
import * as THREE from 'three';
import { Card, rankLabel, SUIT_SYMBOL } from '../game/cards';

const SUIT_CSS: Record<string, string> = { H: '#ff3b5c', D: '#ff5ce1', S: '#2ee88a', C: '#55ccff' };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draw a playing card face. Used for both the 3D pads and the HTML hand. */
export function drawCard(card: Card | null, w = 200, h = 280): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const s = w / 200;
  // body
  const grad = g.createLinearGradient(0, 0, w, h);
  if (card) {
    grad.addColorStop(0, '#fdf6ff');
    grad.addColorStop(0.55, '#f3e6ff');
    grad.addColorStop(1, '#d9f4ff');
  } else {
    grad.addColorStop(0, '#2a0845');
    grad.addColorStop(1, '#0d1b4a');
  }
  roundRect(g, 4 * s, 4 * s, w - 8 * s, h - 8 * s, 18 * s);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 6 * s;
  g.strokeStyle = '#120022';
  g.stroke();

  if (!card) {
    // card back: vaporwave sun and grid
    g.save();
    roundRect(g, 14 * s, 14 * s, w - 28 * s, h - 28 * s, 12 * s);
    g.clip();
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#ff3df2');
    sky.addColorStop(0.5, '#7b2ff7');
    sky.addColorStop(1, '#0d1b4a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sun = g.createLinearGradient(0, 60 * s, 0, 170 * s);
    sun.addColorStop(0, '#ffe66d');
    sun.addColorStop(1, '#ff5f6d');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(w / 2, 140 * s, 60 * s, Math.PI, 0);
    g.fill();
    g.fillStyle = '#7b2ff7';
    for (let i = 0; i < 5; i++) g.fillRect(0, (100 + i * 9) * s, w, (2 + i) * s);
    g.strokeStyle = '#00f0ff';
    g.lineWidth = 2 * s;
    for (let i = -6; i <= 6; i++) {
      g.beginPath();
      g.moveTo(w / 2 + i * 8 * s, 140 * s);
      g.lineTo(w / 2 + i * 40 * s, h);
      g.stroke();
    }
    for (let y = 150; y < 280; y += 18) {
      g.beginPath();
      g.moveTo(0, y * s);
      g.lineTo(w, y * s);
      g.stroke();
    }
    g.restore();
    return c;
  }

  if (card.joker) {
    const jg = g.createLinearGradient(0, 0, w, h);
    jg.addColorStop(0, '#ff3df2');
    jg.addColorStop(0.5, '#00f0ff');
    jg.addColorStop(1, '#ffe66d');
    g.fillStyle = jg;
    g.font = `bold ${44 * s}px "Trebuchet MS", sans-serif`;
    g.textAlign = 'center';
    g.fillText('WILD', w / 2, 120 * s);
    g.font = `bold ${84 * s}px serif`;
    g.fillText('★', w / 2, 210 * s);
    return c;
  }

  const color = SUIT_CSS[card.suit!];
  const label = rankLabel(card.rank);
  const sym = SUIT_SYMBOL[card.suit!];
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${46 * s}px "Trebuchet MS", "Arial Black", sans-serif`;
  g.fillText(label, 34 * s, 40 * s);
  g.font = `${34 * s}px serif`;
  g.fillText(sym, 34 * s, 80 * s);
  g.save();
  g.translate(w - 34 * s, h - 40 * s);
  g.rotate(Math.PI);
  g.font = `bold ${46 * s}px "Trebuchet MS", "Arial Black", sans-serif`;
  g.fillText(label, 0, 0);
  g.font = `${34 * s}px serif`;
  g.fillText(sym, 0, -40 * s);
  g.restore();
  // big center suit with a neon halo
  g.shadowColor = color;
  g.shadowBlur = 24 * s;
  g.font = `${118 * s}px serif`;
  g.fillText(sym, w / 2, h / 2 + 6 * s);
  g.shadowBlur = 0;
  // holo sheen stripe
  const sheen = g.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(0,240,255,0.18)');
  sheen.addColorStop(0.65, 'rgba(255,61,242,0)');
  g.fillStyle = sheen;
  roundRect(g, 8 * s, 8 * s, w - 16 * s, h - 16 * s, 14 * s);
  g.fill();
  return c;
}

const cardTexCache = new Map<string, THREE.CanvasTexture>();
export function cardTexture(card: Card | null): THREE.CanvasTexture {
  const key = card ? `${card.rank}${card.suit}${card.joker ? 'J' : ''}` : 'back';
  let t = cardTexCache.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(drawCard(card, 200, 280));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cardTexCache.set(key, t);
  }
  return t;
}

const dataUrlCache = new Map<string, string>();
export function cardDataUrl(card: Card | null): string {
  const key = card ? `${card.rank}${card.suit}${card.joker ? 'J' : ''}` : 'back';
  let u = dataUrlCache.get(key);
  if (!u) {
    u = drawCard(card, 200, 280).toDataURL();
    dataUrlCache.set(key, u);
  }
  return u;
}

/** Poker chip face: stripes around the rim. */
export function chipTexture(base: string, stripe: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = base;
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = stripe;
  g.lineWidth = 16;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.arc(64, 64, 54, a, a + 0.35);
    g.stroke();
  }
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 64, 34, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Die face with n pips. */
export function dieTexture(n: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ff2f6d';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff6fb';
  const spots: Record<number, [number, number][]> = {
    1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]],
    4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[30, 30], [98, 30], [64, 64], [30, 98], [98, 98]],
    6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]],
  };
  for (const [x, y] of spots[n]) {
    g.beginPath();
    g.arc(x, y, 12, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Slot machine reel strip: symbols stacked vertically, wraps around a cylinder. */
export function reelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 512);
  const symbols = ['7', '♦', 'BAR', '★', '7', '♣', 'BAR', '♥'];
  const colors = ['#ff3b5c', '#ff5ce1', '#ffe66d', '#00f0ff', '#ff3b5c', '#39ff88', '#ffe66d', '#ff3b5c'];
  g.fillStyle = '#fff4fb';
  g.fillRect(0, 0, 128, 512);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  symbols.forEach((s, i) => {
    g.fillStyle = colors[i];
    g.font = s === 'BAR' ? 'bold 34px "Arial Black", sans-serif' : 'bold 52px "Arial Black", serif';
    g.fillText(s, 64, i * 64 + 32);
    g.fillStyle = '#e3c9ff';
    g.fillRect(0, i * 64 + 62, 128, 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Big glowing text for the boss screen and floating labels. */
export function textTexture(text: string, color = '#00f0ff', w = 256, h = 64): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#05000d';
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = `bold ${Math.floor(h * 0.6)}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function updateTextTexture(t: THREE.CanvasTexture, text: string, color = '#00f0ff') {
  const c = t.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05000d';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.font = `bold ${Math.floor(c.height * 0.6)}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillText(text, c.width / 2, c.height / 2);
  t.needsUpdate = true;
}
