// Dev-only gallery (open /towers.html under `npm run dev`): every tower model at four ranks.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HAND_NAMES, HandType, rankLabel, Suit, SUIT_SYMBOL } from '../game/cards';
import { towerStatsFor } from '../game/data';
import { buildTowerModel, TowerModel } from '../render/towers';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0630);
const camera = new THREE.PerspectiveCamera(new URLSearchParams(location.search).has('hand') ? 40 : 28, innerWidth / innerHeight, 0.5, 400);
scene.add(new THREE.HemisphereLight(0xb08cff, 0x2a0845, 1.4));
const key = new THREE.DirectionalLight(0xfff0f8, 2.4);
key.position.set(-18, 30, 14);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x00f0ff, 0.8);
rim.position.set(20, 10, -20);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.82));
composer.addPass(new OutputPass());

const params = new URLSearchParams(location.search);
const only = params.has('hand') ? Number(params.get('hand')) : null;
const hands = only === null ? [...Array(10).keys()] : [only];
const SUITS: Suit[] = ['H', 'S', 'C', 'D'];
const RANKS = [3, 8, 12, 14];
const GAP = 3.2;
const ROWS = 4;

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshToonMaterial({ color: 0x2b0d4a }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const labels = document.getElementById('labels')!;
const tags: { el: HTMLElement; at: THREE.Vector3 }[] = [];
function tag(text: string, at: THREE.Vector3, cls = 'lbl') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  labels.appendChild(el);
  tags.push({ el, at });
}

const towers: TowerModel[] = [];
// hands run left to right, rank tiers front to back
hands.forEach((type, colIdx) => {
  const x = (colIdx - (hands.length - 1) / 2) * GAP;
  tag(HAND_NAMES[type], new THREE.Vector3(x, 2.5, -((ROWS - 1) / 2) * GAP - 1.8), 'lbl row');
  for (let row = 0; row < ROWS; row++) {
    let rank = RANKS[row];
    if (type === HandType.Straight || type === HandType.StraightFlush) rank = Math.max(rank, 5 + row);
    if (type === HandType.StraightFlush) rank = Math.min(rank, 13);
    if (type === HandType.RoyalFlush) rank = 14;
    const suited = type === HandType.Flush || type === HandType.StraightFlush || type === HandType.RoyalFlush;
    const suit = suited ? SUITS[row] : null;
    const stats = towerStatsFor({ type, rank, suit, score: 0 });
    const m = buildTowerModel(stats);
    const z = (row - (ROWS - 1) / 2) * GAP;
    m.group.position.set(x, 0, z);
    scene.add(m.group);
    towers.push(m);
    tag(`${rankLabel(rank)}${suit ? SUIT_SYMBOL[suit] : ''}`, new THREE.Vector3(x, 0, z + 1.35));
  }
});

const controls = new OrbitControls(camera, renderer.domElement);
const camDist = only === null ? hands.length * GAP * 1.5 : 15;
const tilt = Number(params.get('tilt') ?? 0.95);
camera.position.set(0, Math.sin(tilt) * camDist, Math.cos(tilt) * camDist);
controls.target.set(0, 0.8, 0);
controls.update();

const v = new THREE.Vector3();
let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  // fake aim: sweep every head around slowly
  for (const t of towers) t.head.rotation.y += dt * 0.6;
  controls.update();
  composer.render();
  for (const t of tags) {
    v.copy(t.at).project(camera);
    t.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    t.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
