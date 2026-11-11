import * as THREE from 'three';
import './style.css';
import { audio } from './audio';
import { Game } from './game/game';
import { Stage, tileToWorld, worldToTile } from './render/scene';
import { UI } from './ui';

const stage = new Stage(document.getElementById('app')!);
const ui = new UI();
const seedParam = new URLSearchParams(location.search).get('seed');

const game = new Game(stage, {
  onChange: () => ui.refresh(),
  onBanner: (t, s, c) => ui.banner(t, s, c),
  onFloat: (p, t, c) => ui.float(p, t, c),
  onSelectTower: (t) => ui.showTower(t),
}, seedParam ? Number(seedParam) : undefined);

ui.attach(game, stage.camera, (wild) => {
  audio.start();
  game.start(wild);
});
ui.refresh();

// ---- mouse picking against the floor plane ----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let hoverTile: [number, number] | null = null;

function pick(e: PointerEvent): [number, number] | null {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
  if (!raycaster.ray.intersectPlane(floor, hit)) return null;
  return worldToTile(hit.x, hit.z);
}

const canvas = stage.renderer.domElement;
canvas.addEventListener('pointermove', (e) => {
  hoverTile = pick(e);
  updateHover();
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const t = pick(e);
  if (!t) return;
  const [tx, ty] = t;
  if (game.phase === 'place') {
    if (game.placePad(tx, ty)) return;
  }
  const padIdx = game.padIndexAt(tx, ty);
  if (padIdx >= 0) {
    if (game.phase === 'reroll') game.toggleMark(padIdx);
    else if (game.phase === 'select') game.toggleSelect(padIdx);
    return;
  }
  const tower = game.towerAt(tx, ty);
  game.selectTower(tower ?? null);
  updateHover();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') game.selectTower(null);
  if (e.key === ' ' && game.phase === 'ready') game.startWave();
});

function updateHover() {
  const h = stage.hover;
  if (!hoverTile || game.phase !== 'place') {
    h.visible = false;
    canvas.style.cursor = hoverTile && (game.towerAt(...hoverTile) || game.padIndexAt(...hoverTile) >= 0) ? 'pointer' : 'default';
    return;
  }
  const ok = game.isTileFree(...hoverTile) && game.pads.length < 5;
  h.visible = stage.isBuildable(...hoverTile);
  tileToWorld(hoverTile[0], hoverTile[1], h.position);
  h.position.y = 0.08;
  (h.material as THREE.MeshBasicMaterial).color.set(ok ? 0x00f0ff : 0xff3b5c).multiplyScalar(1.5);
  canvas.style.cursor = ok ? 'pointer' : 'not-allowed';
}

// ---- main loop ----
const clock = new THREE.Clock();
function frame() {
  const dt = clock.getDelta();
  game.update(dt);
  ui.tick();
  stage.render(dt);
  requestAnimationFrame(frame);
}
frame();

// expose for automated playtests and console tinkering
(window as unknown as { hrd: unknown }).hrd = { game, stage, audio };
