// HTML overlay: HUD, card hand, actions, tower panel, guide and menus.
import * as THREE from 'three';
import { audio } from './audio';
import { describeHand, HAND_NAMES, SUIT_NAME, SUIT_SYMBOL, Suit } from './game/cards';
import { ECONOMY, ENEMIES, SUIT_EFFECT, TOWERS, towerStatsFor, WAVES } from './game/data';
import { Game, Tower } from './game/game';
import { cardDataUrl } from './render/textures';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export class UI {
  game!: Game;
  private root = $('#ui');
  private bannerTimer = 0;
  private camera!: THREE.Camera;

  constructor() {
    this.root.innerHTML = `
      <div id="top">
        <div class="logo chrome">HIGH ROLLER DEFENSE</div>
        <div id="stats">
          <div class="stat gold"><div class="k">GOLD</div><div class="v" id="gold">0</div></div>
          <div class="stat"><div class="k">WAVE</div><div class="v" id="wave">1/10</div></div>
          <div class="stat"><div class="k">TIPS</div><div class="v" id="tips">0</div></div>
        </div>
        <div id="tools">
          <button class="ghost" id="speed" title="Game speed">1x</button>
          <button class="ghost" id="mute" title="Mute">♪</button>
          <button class="ghost" id="guideBtn" title="Hand guide">? Guide</button>
        </div>
      </div>
      <div id="boss"><div class="name chrome">THE PIT BOSS</div><div class="bar"><div class="fill"></div></div></div>
      <div id="banner"><div class="t chrome"></div><div class="s"></div></div>
      <div id="panel"></div>
      <div id="dock">
        <div id="hint"></div>
        <div id="hand"></div>
        <div id="preview"></div>
        <div id="actions"></div>
      </div>
      <div class="overlay" id="menu">
        <div class="title chrome">HIGH ROLLER<br/>DEFENSE</div>
        <div class="tag">Your poker hand is your tower</div>
        <div class="box">
          Each round, click <b>5 open tiles</b> to deal a card onto each. Mark any cards and <b>reroll</b> them once,
          then <b>select your hand</b>. The poker hand you play decides the tower, and higher cards build stronger
          towers. The tower rises on the <b>last card you select</b>.<br/><br/>
          Kills pay gold. Leaks cost gold. <b>Tip the dealer</b> (${ECONOMY.tipCost}g each, before dealing) for better odds.
          Hit zero and you bust. Survive ${WAVES.length} waves and beat the Pit Boss.<br/><br/>
          <span style="color:#7df9ff">Camera: WASD / arrows to pan, Q / E to rotate, mouse wheel to zoom. Click a tower to inspect or sell it.</span>
        </div>
        <label><input type="checkbox" id="wild" /> Wild cards (2 jokers in the deck)</label>
        <button class="big" id="play">Deal Me In</button>
      </div>
      <div class="overlay hidden" id="guide"><div class="box"></div><button id="guideClose">Close</button></div>
      <div class="overlay hidden" id="end"><div class="title chrome"></div><div class="tag"></div><button class="big" id="again">Play Again</button></div>
      <div id="floats"></div>
      <div class="scan"></div>
    `;
    $('#guide .box').innerHTML = this.guideHtml();
    $('#guideBtn').onclick = () => $('#guide').classList.remove('hidden');
    $('#guideClose').onclick = () => $('#guide').classList.add('hidden');
    $('#mute').onclick = () => ($('#mute').textContent = audio.toggleMute() ? '✕' : '♪');
    $('#speed').onclick = () => {
      this.game.speed = this.game.speed === 1 ? 2 : this.game.speed === 2 ? 3 : 1;
      $('#speed').textContent = `${this.game.speed}x`;
    };
    $('#again').onclick = () => location.reload();
  }

  attach(game: Game, camera: THREE.Camera, onPlay: (wild: boolean) => void) {
    this.game = game;
    this.camera = camera;
    $('#play').onclick = () => {
      $('#menu').classList.add('hidden');
      onPlay(($('#wild') as HTMLInputElement).checked);
    };
  }

  banner(text: string, sub = '', color = '#fff') {
    const b = $('#banner');
    $('.t', b).textContent = text;
    const s = $('.s', b);
    s.textContent = sub;
    s.style.color = color;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), 2600);
  }

  float(pos: THREE.Vector3, text: string, color: string) {
    const p = pos.clone().project(this.camera);
    if (p.z > 1) return;
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  /** Re-render everything that depends on game state. Cheap enough to call on every change. */
  refresh() {
    const g = this.game;
    const goldEl = $('#gold');
    goldEl.textContent = String(g.gold);
    goldEl.classList.toggle('low', g.gold < 20);
    $('#wave').textContent = `${Math.min(g.waveIndex + 1, g.wavesTotal)}/${g.wavesTotal}`;
    $('#tips').textContent = String(g.tips);
    this.renderHand();
    this.renderActions();
    if (g.phase === 'won' || g.phase === 'lost') {
      const end = $('#end');
      setTimeout(() => {
        end.classList.remove('hidden');
        $('.title', end).textContent = g.phase === 'won' ? 'JACKPOT!' : 'BUSTED';
        $('.tag', end).textContent = g.phase === 'won'
          ? `The Pit Boss is scrap. ${g.gold} gold in your stack.`
          : `You made it to wave ${g.waveIndex + 1} of ${g.wavesTotal}.`;
      }, 1800);
    }
  }

  private renderHand() {
    const g = this.game;
    const hand = $('#hand');
    const show = ['place', 'reroll', 'select'].includes(g.phase);
    hand.style.display = show ? 'flex' : 'none';
    if (!show) return;
    hand.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const pad = g.pads[i];
      const el = document.createElement('div');
      el.className = 'card';
      const img = document.createElement('img');
      img.src = cardDataUrl(pad ? pad.card : null);
      el.appendChild(img);
      if (!pad) el.classList.add('empty');
      else if (g.phase === 'reroll') {
        if (pad.marked) el.classList.add('marked');
        el.onclick = () => g.toggleMark(i);
      } else if (g.phase === 'select') {
        const ord = g.selection.indexOf(i);
        if (ord >= 0) {
          el.classList.add('sel');
          if (ord === g.selection.length - 1) el.classList.add('last');
          const b = document.createElement('div');
          b.className = 'ord';
          b.textContent = String(ord + 1);
          el.appendChild(b);
        } else if (g.selection.length > 0) el.classList.add('dim');
        el.onclick = () => g.toggleSelect(i);
      }
      hand.appendChild(el);
    }
  }

  private renderActions() {
    const g = this.game;
    const hint = $('#hint');
    const preview = $('#preview');
    const actions = $('#actions');
    actions.innerHTML = '';
    preview.innerHTML = '';
    const btn = (label: string, cls: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.disabled = disabled;
      b.onclick = () => { fn(); };
      actions.appendChild(b);
      return b;
    };
    const note = (html: string) => {
      const n = document.createElement('div');
      n.className = 'note';
      n.innerHTML = html;
      actions.appendChild(n);
    };
    $('#dock').style.display = g.phase === 'menu' ? 'none' : 'flex';

    switch (g.phase) {
      case 'place': {
        hint.innerHTML = g.pads.length === 0
          ? 'Tip the dealer for better odds, then <b>click 5 open tiles</b> to deal.'
          : `Click open tiles to deal: <b>${g.pads.length}/5</b>`;
        btn(`Tip Dealer (${ECONOMY.tipCost}g)`, 'gold', () => g.tip(), !g.canTip());
        note(g.tips > 0
          ? `Dealer is dealing <b>best of ${g.tips + 1}</b> hands. Rerolls favor you too.`
          : 'Each tip makes the dealer deal one more secret hand. You get the best.');
        break;
      }
      case 'reroll': {
        const marked = g.pads.filter((p) => p.marked).length;
        hint.innerHTML = 'Click cards to mark them, then reroll them all at once.';
        const best = g.bestPossible();
        if (best) preview.innerHTML = `Holding: <span class="hand">${describeHand(best)}</span>`;
        btn(`Reroll ${marked || ''}`.trim(), 'cyan', () => g.reroll(), marked === 0);
        btn('Keep All', '', () => g.keepAll());
        break;
      }
      case 'select': {
        hint.innerHTML = 'Select the cards to play. The tower builds on the <b>last</b> card you pick.';
        const h = g.currentHand();
        if (h) {
          const s = towerStatsFor(h);
          preview.innerHTML = `<span class="hand">${describeHand(h)}</span> → <span class="tower">${s.name}</span>` +
            `${s.suit ? ` (${SUIT_SYMBOL[s.suit as Suit]} ${SUIT_EFFECT[s.suit as Suit].split(':')[0]})` : ''}${s.high ? ' <b style="color:#39ff88">HIGH</b>' : ''}`;
        } else {
          const best = g.bestPossible();
          preview.innerHTML = best ? `Best available: <span class="hand">${describeHand(best)}</span>` : '';
        }
        btn(h ? `Build ${towerStatsFor(h).name}` : 'Select cards', 'gold', () => g.buildTower(), !h);
        if (h && g.selection.length < 5) btn('Select All', 'ghost', () => {
          for (let i = 0; i < 5; i++) if (!g.selection.includes(i)) g.toggleSelect(i);
        });
        break;
      }
      case 'ready': {
        hint.innerHTML = `Next up: <b>${WAVES[g.waveIndex].name}</b>. Click towers to inspect or sell them.`;
        btn(`Start Wave ${g.waveIndex + 1}`, 'cyan', () => g.startWave());
        break;
      }
      case 'wave': {
        hint.innerHTML = `Wave ${g.waveIndex + 1}: <b>${WAVES[g.waveIndex].name}</b>`;
        break;
      }
      default:
        hint.innerHTML = '';
    }
  }

  tick() {
    const g = this.game;
    if (!g) return;
    const bossEl = $('#boss');
    if (g.boss) {
      bossEl.classList.add('show');
      const fill = $('.fill', bossEl);
      fill.style.width = `${Math.max(0, (g.boss.hp / g.boss.maxHp) * 100)}%`;
      fill.classList.toggle('shield', g.boss.shieldHits > 0);
    } else bossEl.classList.remove('show');
    if (g.phase === 'wave') {
      const left = g.enemies.length;
      $('#hint').innerHTML = `Wave ${g.waveIndex + 1}: <b>${WAVES[g.waveIndex].name}</b> · ${left} on the floor`;
    }
    if (g.selectedTower && $('#panel').classList.contains('show')) this.fillPanel(g.selectedTower, false);
  }

  showTower(t: Tower | null) {
    const p = $('#panel');
    if (!t) {
      p.classList.remove('show');
      return;
    }
    p.classList.add('show');
    this.fillPanel(t, true);
  }

  private fillPanel(t: Tower, full: boolean) {
    const p = $('#panel');
    const s = t.stats;
    const color = '#' + s.color.toString(16).padStart(6, '0');
    if (!full) {
      const k = p.querySelector('#pk');
      const d = p.querySelector('#pd');
      if (k) k.textContent = String(t.kills);
      if (d) d.textContent = String(Math.round(t.damageDone));
      return;
    }
    const dmgLabel = s.dmgType === 'suit' ? `${SUIT_NAME[s.suit!]} (magic)` : s.dmgType === 'phys' ? 'Physical' : 'Magic';
    p.innerHTML = `
      <h3 style="color:${color}">${s.name}</h3>
      <div class="sub">${describeHand(s.hand)}${s.high ? ' · HIGH' : ''}</div>
      <div class="blurb">${s.blurb}${s.suit ? `<br/><b>${SUIT_SYMBOL[s.suit]}</b> ${SUIT_EFFECT[s.suit]}` : ''}${s.high ? `<br/><span style="color:#39ff88">${s.highBonus}</span>` : ''}</div>
      <table>
        <tr><td>Damage</td><td>${Math.round(s.damage)}${s.attack === 'beam' ? '/s' : ''}</td></tr>
        <tr><td>Type</td><td>${dmgLabel}</td></tr>
        <tr><td>Attack speed</td><td>${s.attack === 'beam' ? 'constant' : s.rate.toFixed(2) + '/s'}</td></tr>
        <tr><td>Range</td><td>${s.range}</td></tr>
        <tr><td>Card rank bonus</td><td>x${s.mult.toFixed(1)}</td></tr>
        <tr><td>Kills</td><td id="pk">${t.kills}</td></tr>
        <tr><td>Damage dealt</td><td id="pd">${Math.round(t.damageDone)}</td></tr>
      </table>
    `;
    const sell = document.createElement('button');
    sell.className = 'gold';
    sell.style.width = '100%';
    sell.textContent = `Sell for ${this.game.sellValue(t)}g`;
    sell.onclick = () => this.game.sellTower(t);
    p.appendChild(sell);
  }

  private guideHtml(): string {
    const rows = TOWERS.map((t, i) => `<tr><td><b>${HAND_NAMES[i]}</b></td><td style="color:#${t.color.toString(16).padStart(6, '0')}">${t.name}</td>
      <td>${t.dmgType === 'suit' ? 'Suit element' : t.dmgType === 'phys' ? 'Physical' : 'Magic'}</td><td>${t.blurb}</td><td>${t.highBonus}</td></tr>`).join('');
    const suits = (['H', 'S', 'C', 'D'] as Suit[]).map((s) => `<tr><td><b>${SUIT_SYMBOL[s]} ${SUIT_NAME[s]}</b></td><td>${SUIT_EFFECT[s]}</td></tr>`).join('');
    const enemies = Object.values(ENEMIES).map((e) => `<tr><td><b>${e.name}</b></td><td>${e.hp} hp</td><td>${e.bounty}g</td>
      <td>${e.resist ? `Resists ${e.resist === 'phys' ? 'physical' : 'magic'}` : ''}${e.dodge ? ` Dodges ${e.dodge * 100}%` : ''}${e.shield ? ' Shield until slowed or poisoned' : ''}</td></tr>`).join('');
    return `
      <h2 class="chrome" style="margin:0 0 6px;font-size:30px">HAND GUIDE</h2>
      Higher card ranks multiply damage (x1.0 for 2s up to x2.2 for Aces). Hands built on Jacks or better unlock a bonus.
      <h3>Hands and towers</h3>
      <table><tr><th>Hand</th><th>Tower</th><th>Damage</th><th>What it does</th><th>High bonus</th></tr>${rows}</table>
      <h3>Suits (Flush and Straight Flush)</h3>
      <table>${suits}</table>
      <h3>Enemies</h3>
      <table><tr><th>Enemy</th><th>Base HP</th><th>Bounty</th><th>Trait</th></tr>${enemies}</table>
      <p>Leaks cost ${ECONOMY.leakMultiplier}x the enemy's bounty. Wave clear pays ${ECONOMY.waveClearBonus}g. If the Pit Boss reaches the exit, you bust.</p>`;
  }
}
