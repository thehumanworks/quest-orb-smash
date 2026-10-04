import * as THREE from 'three';
import { Net, selfId } from './net.js';
import { Sfx } from './audio.js';
import { Particles, Rings, Popups, Flash, makeGlowTexture } from './fx.js';
import { Panel, text } from './panel.js';

// ------------------------------------------------------------------ constants
const ROUND_MS = 50000;
const COUNTDOWN_MS = 3000;
const WINS_NEEDED = 2; // best of 3
const COMBO_WINDOW = 2600;
const SLOT_X = [-0.7, 0.7]; // side-by-side arena slots (metres)
const PCOL = ['#00e5ff', '#ff2bd6'];
const PCOL_HEX = [0x00e5ff, 0xff2bd6];
const NEON = [0x00f0ff, 0x7cff00, 0xff00e1, 0xffe600, 0x8a5cff, 0x00ff9d, 0xff7a00];
const TIER = [null, 0x3dff8b, 0xffe94d, 0xffa53d, 0xff4d6a, 0xff4dd2, 0xb44dff, 0xffffff];
const BEST_KEY = 'orbSmashDuel.best';
const ROOM_KEY = 'orbSmashDuel.room';
const DEFAULT_ROOM = 'ORB1';
const params = new URLSearchParams(location.search);
const V3 = THREE.Vector3;
const r3 = (x) => Math.round(x * 1000) / 1000;
const tierHex = (mult, slot) => (mult <= 1 ? PCOL_HEX[slot] : TIER[Math.min(7, mult - 1)]);
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x07020f);
scene.background = BG;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 120);
const DESK_CAM = new V3(0, 1.7, 1.5);
const DESK_LOOK = new V3(0, 1.3, -3);
camera.position.copy(DESK_CAM);
camera.lookAt(DESK_LOOK);
scene.add(camera);

const glowTex = makeGlowTexture();
const glowMat = (color, opacity = 1) => new THREE.SpriteMaterial({ map: glowTex, color, opacity, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

// ------------------------------------------------------------------ VR-only environment (hidden in passthrough)
const env = new THREE.Group();
scene.add(env);
{
  const n = 1800, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 45 + Math.random() * 25;
    p[i * 3] = s * Math.cos(th) * r; p[i * 3 + 1] = u * r; p[i * 3 + 2] = s * Math.sin(th) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  env.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 2, sizeAttenuation: false })));
  const grid = new THREE.GridHelper(40, 80, 0x7a3cff, 0x2a0f55);
  grid.material.transparent = true; grid.material.opacity = 0.55;
  env.add(grid);
}

// ------------------------------------------------------------------ arena (positioned so that MY slot is at my local origin)
const arena = new THREE.Group();
scene.add(arena);

const portal = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.035, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.015, 6, 80),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  const haze = new THREE.Sprite(glowMat(0x5a2cff, 0.35)); haze.scale.setScalar(5);
  portal.add(ring, ring2, haze);
  portal.userData = { ring, ring2 };
  portal.position.set(0, 1.4, -9);
  arena.add(portal);
}

const slotRings = [0, 1].map((i) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PCOL_HEX[i], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.y = 0.01;
  arena.add(m);
  return m;
});

const panel = new Panel(2.4, 1.2);
panel.mesh.position.set(0, 2.75, -4.2);
panel.mesh.rotation.x = 0.16;
arena.add(panel.mesh);

// ------------------------------------------------------------------ fx
const particles = new Particles(scene, 1000);
const rings = new Rings(scene, 14);
const popups = new Popups(scene, 14);
const flash = new Flash(camera);

// ------------------------------------------------------------------ orbs (pooled)
const ORB_GEO = new THREE.IcosahedronGeometry(1, 3);
const BOMB_GEO = new THREE.IcosahedronGeometry(1, 0);
const ORB_VS = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ORB_FS = `uniform vec3 uColor; uniform float uWhite; varying vec3 vN; varying vec3 vV;
void main(){ float d = max(dot(normalize(vN), normalize(vV)), 0.0); vec3 c = mix(uColor, vec3(1.0), pow(d, 2.5) * uWhite); gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
}`;
const makeOrbMat = (color, white = 0.85) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(color) }, uWhite: { value: white } }, vertexShader: ORB_VS, fragmentShader: ORB_FS,
});

class Orb {
  constructor() {
    this.mat = makeOrbMat(0xffffff);
    this.core = new THREE.Mesh(ORB_GEO, this.mat);
    this.halo = new THREE.Sprite(glowMat(0xffffff, 0.9));
    this.group = new THREE.Group();
    this.group.add(this.core, this.halo);
    this.group.visible = false;
    arena.add(this.group);
    this.alive = false;
    this.p0 = new V3(); this.v = new V3(); this.pos = new V3();
    this.w = [0, 0, 0]; this.t = 0; this.r = 0.15; this.kind = 0; this.id = 0; this.ci = 0;
    this.spin = new V3();
  }
  activate(d) {
    this.id = d.id; this.kind = d.k; this.ci = d.c || 0; this.r = d.r;
    this.p0.fromArray(d.p); this.v.fromArray(d.v); this.w = d.w; this.t = 0;
    this.core.geometry = this.kind === 2 ? BOMB_GEO : ORB_GEO;
    const col = this.kind === 1 ? 0xffb300 : this.kind === 2 ? 0x7a0a00 : NEON[this.ci];
    this.mat.uniforms.uColor.value.setHex(col);
    this.mat.uniforms.uWhite.value = this.kind === 2 ? 0.15 : 0.9;
    this.halo.material.color.setHex(this.kind === 1 ? 0xffc400 : this.kind === 2 ? 0xff1a00 : NEON[this.ci]);
    this.core.scale.setScalar(this.r);
    this.halo.scale.setScalar(this.r * (this.kind === 1 ? 5.5 : 4.2));
    this.spin.set(Math.random() * 3 - 1.5, Math.random() * 3 - 1.5, 0);
    this.alive = true;
    this.calc();
    this.group.position.copy(this.pos);
    this.group.visible = true;
  }
  calc() {
    const t = this.t, a = this.w[0], f = this.w[1], ph = this.w[2];
    this.pos.copy(this.p0).addScaledVector(this.v, t);
    if (a) {
      this.pos.x += a * (Math.sin(t * f + ph) - Math.sin(ph));
      this.pos.y += a * 0.6 * (Math.cos(t * f * 0.8 + ph) - Math.cos(ph));
    }
  }
  deactivate() { this.alive = false; this.group.visible = false; }
}
const orbs = Array.from({ length: 48 }, () => new Orb());
const findOrb = (id) => orbs.find((o) => o.alive && o.id === id);
const clearOrbs = () => orbs.forEach((o) => o.deactivate());
function activateOrb(d) {
  const o = orbs.find((x) => !x.alive);
  if (o) o.activate(d);
}

// ------------------------------------------------------------------ sabres, hands, avatars
const HANDLE_GEO = new THREE.CylinderGeometry(0.017, 0.021, 0.15, 10).rotateX(-Math.PI / 2);
const BLADE_LEN = 0.6, BLADE_START = 0.06;
const CORE_GEO = new THREE.CylinderGeometry(0.011, 0.011, BLADE_LEN, 8).rotateX(-Math.PI / 2).translate(0, 0, -BLADE_START - BLADE_LEN / 2);
const GLOW_GEO = new THREE.CylinderGeometry(0.034, 0.034, BLADE_LEN + 0.03, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -BLADE_START - BLADE_LEN / 2);

function makeSabre(color) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(HANDLE_GEO, new THREE.MeshBasicMaterial({ color: 0x2c2c3e }));
  const core = new THREE.Mesh(CORE_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const glow = new THREE.Mesh(GLOW_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const tip = new THREE.Sprite(glowMat(color, 0.9));
  tip.position.z = -BLADE_START - BLADE_LEN; tip.scale.setScalar(0.13);
  g.add(handle, core, glow, tip);
  g.userData = { core, glow, tip, hex: -1 };
  return g;
}
const _c = new THREE.Color();
function setSabreColor(s, hex) {
  if (s.userData.hex === hex) return;
  s.userData.hex = hex;
  s.userData.glow.material.color.setHex(hex);
  s.userData.tip.material.color.setHex(hex);
  s.userData.core.material.color.setHex(0xffffff).lerp(_c.setHex(hex), 0.25);
}

const HAND_PTS = [
  ['index-finger-tip', 0.03, 0.013], ['middle-finger-tip', 0.025, 0.012], ['thumb-tip', 0.025, 0.012],
  ['ring-finger-tip', 0.022, 0.011], ['pinky-finger-tip', 0.02, 0.01], ['middle-finger-metacarpal', 0.055, 0.03],
];
const TIP_GEO = new THREE.SphereGeometry(1, 12, 8);

const ctrls = [0, 1].map((i) => {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  scene.add(controller, grip, hand);
  const sabre = makeSabre(PCOL_HEX[0]);
  sabre.visible = false;
  grip.add(sabre);
  const handGroup = new THREE.Group();
  scene.add(handGroup);
  const pts = HAND_PTS.map(([name, hitR, vizR]) => {
    const isPalm = name.includes('metacarpal');
    const m = new THREE.Mesh(TIP_GEO, new THREE.MeshBasicMaterial({ color: PCOL_HEX[0], transparent: isPalm, opacity: isPalm ? 0.35 : 1, blending: isPalm ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !isPalm }));
    m.scale.setScalar(vizR);
    const halo = new THREE.Sprite(glowMat(PCOL_HEX[0], 0.6));
    halo.scale.setScalar(isPalm ? 3 : 4);
    m.add(halo);
    m.visible = false;
    handGroup.add(m);
    return { name, hitR, m, cur: new V3(), prev: new V3(), valid: false };
  });
  const c = {
    i, controller, grip, hand, sabre, pts, source: null, isHand: false, bladeActive: false, fresh: true,
    base: new V3(), tip: new V3(), prevBase: new V3(), prevTip: new V3(),
  };
  controller.addEventListener('connected', (e) => { c.source = e.data; c.isHand = !!e.data.hand; sabre.visible = !c.isHand; c.fresh = true; });
  controller.addEventListener('disconnected', () => { c.source = null; c.isHand = false; sabre.visible = false; c.bladeActive = false; });
  controller.addEventListener('selectstart', () => onTrigger());
  return c;
});

// desktop-only cursor sabre (visual only; desktop smashing uses mouse raycasts)
const deskSabre = makeSabre(PCOL_HEX[0]);
deskSabre.scale.setScalar(0.8);
scene.add(deskSabre);

// opponent avatar (lives in arena coordinates)
const opp = (() => {
  const group = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), makeOrbMat(PCOL_HEX[1], 0.6));
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: 0x0b0b16 }));
  visor.position.set(0, 0.01, -0.09);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  stripe.position.set(0, 0.01, -0.118);
  const halo = new THREE.Sprite(glowMat(PCOL_HEX[1], 0.5)); halo.scale.setScalar(0.6);
  head.add(visor, stripe, halo);
  const label = makeLabel('RIVAL', PCOL[1]);
  label.position.set(0, 0.28, 0);
  const headRoot = new THREE.Group();
  headRoot.add(head);
  group.add(headRoot, label);
  const hands = [0, 1].map(() => {
    const root = new THREE.Group();
    const sabre = makeSabre(PCOL_HEX[1]);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), makeOrbMat(PCOL_HEX[1], 0.6));
    root.add(sabre, glove);
    group.add(root);
    return { root, sabre, glove, tp: new V3(), tq: new THREE.Quaternion(), kind: 0 };
  });
  group.visible = false;
  arena.add(group);
  return { group, headRoot, head, halo, label, hands, tp: new V3(0, 1.6, 0), tq: new THREE.Quaternion(), lastSeen: 0, slot: 1 };
})();

function makeLabel(str, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(0.4, 0.1, 1);
  s.userData.draw = (t, col) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.font = '900 44px system-ui, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 12; g.fillStyle = col; g.fillText(t, 128, 34);
    s.material.map.needsUpdate = true;
  };
  s.userData.draw(str, color);
  return s;
}

function setOppColor(slot) {
  if (opp.slot === slot) return;
  opp.slot = slot;
  const hex = PCOL_HEX[slot];
  opp.head.material.uniforms.uColor.value.setHex(hex);
  opp.halo.material.color.setHex(hex);
  opp.label.userData.draw('RIVAL', PCOL[slot]);
  for (const h of opp.hands) { setSabreColor(h.sabre, hex); h.glove.material.uniforms.uColor.value.setHex(hex); }
}

// ------------------------------------------------------------------ game state
const sfx = new Sfx();
const net = new Net();
const st = {
  phase: 'lobby', endsAt: 0, scores: [0, 0], combos: [0, 0], mults: [1, 1], wins: [0, 0], ready: [false, false],
  round: 0, wave: 1, lastWinner: -1, matchWinner: -1,
};
const newCombo = () => ({ combo: 0, mult: 1, last: 0 });
const hostCombo = [newCombo(), newCombo()];
const guestCombo = newCombo();
let peerId = null;
let isHost = true;
const versus = () => !!peerId;
const mySlot = () => (versus() ? (isHost ? 0 : 1) : 0);
const oppSlot = () => 1 - mySlot();
const slotX = (i) => (versus() ? SLOT_X[i] : 0);
const myCombo = () => (isHost || !versus() ? hostCombo[mySlot()] : guestCombo);
let nextOrbId = 1, nextSpawnAt = 0, roundStart = 0, lastStateSent = 0;
let readyLockUntil = 0, hitStopUntil = 0, prevPhase = 'lobby', lastBeep = -1, lastMult = 1;
let best = 0;
try { best = +localStorage.getItem(BEST_KEY) || 0; } catch (e) { /* private mode */ }
let newBest = false;
let statusMsg = '';
let fps = 0;

function applyCombo(c, kind, now) {
  if (now - c.last > COMBO_WINDOW) { c.combo = 0; c.mult = 1; }
  let pts;
  if (kind === 2) { c.combo = 0; pts = -40; } else { c.combo += kind === 1 ? 2 : 1; }
  c.mult = Math.min(8, 1 + Math.floor(c.combo / 4));
  if (kind !== 2) pts = (kind === 1 ? 50 : 10) * c.mult;
  c.last = now;
  return pts;
}
function syncCombos() {
  for (let i = 0; i < 2; i++) { st.combos[i] = hostCombo[i].combo; st.mults[i] = hostCombo[i].mult; }
}

function applySlotLayout() {
  arena.position.x = -slotX(mySlot());
  slotRings[0].position.x = slotX(0);
  slotRings[1].position.x = slotX(1);
  slotRings[1].visible = versus();
  slotRings[0].material.color.setHex(PCOL_HEX[0]);
  setOppColor(oppSlot());
  for (const c of ctrls) for (const p of c.pts) p.m.material.color.setHex(PCOL_HEX[mySlot()]);
}

function resetLobby() {
  st.phase = 'lobby'; st.scores = [0, 0]; st.wins = [0, 0]; st.ready = [false, false]; st.round = 0;
  st.lastWinner = -1; st.matchWinner = -1;
  hostCombo[0] = newCombo(); hostCombo[1] = newCombo(); syncCombos();
  clearOrbs();
  applySlotLayout();
  broadcastState();
}

function stateMsg() {
  return {
    ph: st.phase, rem: Math.max(0, Math.round(st.endsAt - performance.now())), s: st.scores, c: st.combos, m: st.mults,
    w: st.wins, rdy: st.ready, rd: st.round, wv: st.wave, lw: st.lastWinner, mw: st.matchWinner,
  };
}
function broadcastState() {
  if (versus() && isHost) { net.send('state', stateMsg(), peerId); lastStateSent = performance.now(); }
}

// ---------------- host-authoritative loop
function hostTick(now) {
  const players = versus() ? [0, 1] : [0];
  if (st.phase === 'lobby' || st.phase === 'roundEnd' || st.phase === 'matchEnd') {
    if (players.every((i) => st.ready[i])) startCountdown(now);
  } else if (st.phase === 'countdown') {
    if (now >= st.endsAt) {
      st.phase = 'playing'; st.endsAt = now + ROUND_MS; roundStart = now; nextSpawnAt = now + 300; st.wave = 1;
      broadcastState();
    }
  } else if (st.phase === 'playing') {
    const el = now - roundStart;
    const wave = 1 + Math.floor(el / 12000);
    if (wave !== st.wave) { st.wave = wave; broadcastState(); }
    if (now >= nextSpawnAt) {
      spawnPattern(wave);
      const base = Math.max(250, 800 - 115 * (wave - 1)) * (versus() ? 0.72 : 1);
      nextSpawnAt = now + base * (0.7 + Math.random() * 0.6);
    }
    let changed = false;
    for (const i of players) {
      const c = hostCombo[i];
      if (c.combo && now - c.last > COMBO_WINDOW) { c.combo = 0; c.mult = 1; changed = true; }
    }
    if (changed) { syncCombos(); broadcastState(); }
    if (now >= st.endsAt) endRound(now);
  }
  if (versus() && now - lastStateSent > 250) broadcastState();
}

function startCountdown(now) {
  if (st.phase === 'lobby' || st.phase === 'matchEnd') { st.wins = [0, 0]; st.round = 0; st.matchWinner = -1; }
  st.round++;
  st.scores = [0, 0];
  hostCombo[0] = newCombo(); hostCombo[1] = newCombo(); syncCombos();
  st.ready = [false, false];
  st.phase = 'countdown';
  st.endsAt = now + COUNTDOWN_MS;
  st.wave = 1;
  clearOrbs();
  broadcastState();
}

function endRound(now) {
  clearOrbs();
  if (versus()) {
    const w = st.scores[0] > st.scores[1] ? 0 : st.scores[1] > st.scores[0] ? 1 : -1;
    if (w >= 0) st.wins[w]++;
    st.lastWinner = w;
    if (w >= 0 && st.wins[w] >= WINS_NEEDED) { st.phase = 'matchEnd'; st.matchWinner = w; } else st.phase = 'roundEnd';
  } else {
    st.phase = 'roundEnd'; st.lastWinner = 0;
  }
  st.ready = [false, false];
  st.endsAt = now;
  broadcastState();
}

function spawnPattern(wave) {
  let n = 1;
  if (wave >= 2 && Math.random() < 0.15 + 0.08 * wave) n = 2;
  if (wave >= 4 && Math.random() < 0.15) n = 3;
  for (let k = 0; k < n; k++) spawnOne(wave);
}

function spawnOne(wave) {
  const speed = 2.3 + 0.45 * (wave - 1) + Math.random() * 0.5;
  let kind = 0;
  const r = Math.random();
  if (r < 0.07) kind = 1;
  else if (r < 0.07 + Math.min(0.22, 0.08 + 0.025 * wave)) kind = 2;
  let tx;
  if (versus()) {
    tx = Math.random() < 0.2 ? (Math.random() - 0.5) * 0.4 : SLOT_X[Math.random() < 0.5 ? 0 : 1] + (Math.random() - 0.5) * 1.0;
  } else tx = (Math.random() - 0.5) * 1.3;
  const ty = 0.95 + Math.random() * 0.85, tz = 0.15;
  const sx = tx * 0.5 + (Math.random() - 0.5) * 3.0, sy = 0.9 + Math.random() * 1.2, sz = -8.8;
  const v = new V3(tx - sx, ty - sy, tz - sz).normalize().multiplyScalar(kind === 1 ? speed * 1.25 : speed);
  const amp = Math.random() < 0.4 ? 0.08 + Math.random() * 0.22 : 0;
  const d = {
    id: nextOrbId++, k: kind, p: [r3(sx), r3(sy), sz], v: [r3(v.x), r3(v.y), r3(v.z)],
    w: [r3(amp), r3(1.5 + Math.random() * 2.5), r3(Math.random() * 6.28)],
    r: kind === 1 ? 0.12 : kind === 2 ? 0.17 : 0.15, c: Math.floor(Math.random() * NEON.length),
  };
  activateOrb(d);
  if (versus()) net.send('spawn', d, peerId);
}

// ---------------- hits
const _wp = new V3();
const camWorld = new V3();

function localHit(o, src) {
  if (!o.alive) return;
  if (isHost || !versus()) { applyHit(o, mySlot(), src); return; }
  // guest: instant local feedback, host decides who really got it
  const now = performance.now();
  const prevMult = guestCombo.mult, prevCombo = guestCombo.combo;
  const pts = applyCombo(guestCombo, o.kind, now);
  hitEffects(o, true, pts, guestCombo, src, prevMult, prevCombo);
  net.send('hit', { id: o.id, k: o.kind }, peerId);
  o.deactivate();
}

function applyHit(o, slot, src) {
  const now = performance.now();
  const c = hostCombo[slot];
  const prevMult = c.mult, prevCombo = c.combo;
  const pts = applyCombo(c, o.kind, now);
  st.scores[slot] = Math.max(0, st.scores[slot] + pts);
  syncCombos();
  hitEffects(o, slot === mySlot(), pts, c, src, prevMult, prevCombo);
  const id = o.id, kind = o.kind;
  o.deactivate();
  if (versus()) net.send('kill', { id, by: slot, k: kind, pts, s: st.scores, c: st.combos, m: st.mults }, peerId);
}

function hitEffects(o, mine, pts, combo, src, prevMult, prevCombo) {
  const wp = _wp.copy(o.pos).add(arena.position);
  const col = o.kind === 1 ? 0xffc400 : o.kind === 2 ? 0xff2a1a : NEON[o.ci];
  const label = (pts > 0 ? '+' : '') + pts;
  if (!mine) {
    const oc = PCOL_HEX[oppSlot()];
    particles.burst(wp, oc, 22, 2.2, 0.03, 0.5);
    particles.burst(wp, col, 12, 2.0, 0.03, 0.5);
    rings.spawn(wp, oc, o.r, o.r * 3, 0.25, camWorld);
    popups.spawn(wp, label, PCOL[oppSlot()], 0.2, 0.7);
    sfx.oppHit();
    return;
  }
  if (o.kind === 0) {
    particles.burst(wp, col, 44, 3.3, 0.035, 0.65);
    rings.spawn(wp, col, o.r, o.r * 4, 0.28, camWorld);
    sfx.hit(combo.combo);
    haptic(src, 0.6, 40);
    hitStop(45);
    popups.spawn(wp, label, combo.mult > 1 ? hexCss(tierHex(combo.mult, mySlot())) : '#ffffff', 0.26);
  } else if (o.kind === 1) {
    particles.burst(wp, 0xffd040, 90, 4.6, 0.045, 0.95, 0.45);
    rings.spawn(wp, 0xffd040, o.r, o.r * 6, 0.35, camWorld);
    rings.spawn(wp, 0xffffff, o.r, o.r * 3, 0.2, camWorld);
    sfx.gold();
    haptic(src, 1, 90);
    flash.fire(0xffa000, 0.3);
    hitStop(90);
    popups.spawn(wp, label + ' GOLD', '#ffd040', 0.34, 1.1);
  } else {
    particles.burst(wp, 0xff3010, 70, 4.2, 0.05, 0.8, 0.1);
    particles.burst(wp, 0xffa020, 30, 2.5, 0.04, 0.6, 0);
    rings.spawn(wp, 0xff2000, o.r, o.r * 7, 0.4, camWorld);
    sfx.bomb();
    haptic(0, 1, 220); haptic(1, 1, 220);
    flash.fire(0xff0000, 0.55);
    hitStop(140);
    popups.spawn(wp, label, '#ff4040', 0.32, 1.0);
    if (prevCombo >= 4) popups.spawn(wp.clone().setY(wp.y + 0.25), 'COMBO LOST', '#ff8080', 0.25, 1.0);
  }
  if (combo.mult > prevMult) {
    popups.spawn(wp.clone().setY(wp.y + 0.3), `x${combo.mult} COMBO!`, hexCss(tierHex(combo.mult, mySlot())), 0.32, 1.1);
    sfx.comboUp(combo.mult);
  }
}

function orbPassed(o) {
  if (o.kind !== 0) return;
  const players = versus() ? [0, 1] : [0];
  for (const i of players) {
    if (Math.abs(o.pos.x - slotX(i)) > 0.75 || o.pos.y < 0.5 || o.pos.y > 2.1) continue;
    if (isHost || !versus()) {
      const c = hostCombo[i];
      if (c.combo) { if (i === mySlot() && c.combo >= 4) sfx.comboBreak(); c.combo = 0; c.mult = 1; syncCombos(); broadcastState(); }
    } else if (i === mySlot() && guestCombo.combo) {
      if (guestCombo.combo >= 4) sfx.comboBreak();
      guestCombo.combo = 0; guestCombo.mult = 1;
    }
  }
}

function hitStop(ms) { hitStopUntil = Math.max(hitStopUntil, performance.now() + ms); }

function haptic(i, v, ms) {
  const s = ctrls[i] && ctrls[i].source;
  const a = s && s.gamepad && s.gamepad.hapticActuators && s.gamepad.hapticActuators[0];
  if (!a) return;
  try {
    if (a.pulse) a.pulse(v, ms);
    else if (a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: v, weakMagnitude: v });
  } catch (e) { /* ignore */ }
}

// ---------------- ready / trigger
function onTrigger() {
  sfx.unlock();
  const now = performance.now();
  if (!(st.phase === 'lobby' || st.phase === 'roundEnd' || st.phase === 'matchEnd')) return;
  if (now < readyLockUntil || st.ready[mySlot()]) return;
  st.ready[mySlot()] = true;
  sfx.ready();
  haptic(0, 0.3, 30); haptic(1, 0.3, 30);
  if (isHost || !versus()) broadcastState(); else net.send('ready', 1, peerId);
}

// ---------------- phase transitions (both host and guest)
function onPhaseChange(from, to, now) {
  if (to === 'countdown') { clearOrbs(); Object.assign(guestCombo, newCombo()); lastBeep = -1; newBest = false; }
  if (to === 'playing') {
    sfx.beep(true);
    haptic(0, 0.5, 80); haptic(1, 0.5, 80);
    popups.spawn(new V3(0, 1.75, -2), 'GO!', '#7cff9d', 0.5, 0.9);
  }
  if (to === 'roundEnd' || to === 'matchEnd') {
    clearOrbs();
    readyLockUntil = now + 1300;
    const mine = st.scores[mySlot()];
    newBest = mine > best;
    if (newBest) { best = mine; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ } }
    const won = versus() ? (to === 'matchEnd' ? st.matchWinner === mySlot() : st.lastWinner === mySlot()) : newBest;
    if (won) {
      sfx.win();
      for (let k = 0; k < 6; k++) {
        const p = new V3((Math.random() - 0.5) * 3, 1.6 + Math.random() * 1.4, -3.5 - Math.random()).add(arena.position);
        particles.burst(p, NEON[k % NEON.length], 50, 3.5, 0.045, 1.2, 0.3);
      }
    } else if (versus() && st.lastWinner >= 0) sfx.lose();
    else sfx.beep(false);
  }
  if (to === 'lobby') clearOrbs();
}

// ------------------------------------------------------------------ networking events
net.on('peerjoin', (id) => {
  if (peerId) return; // 1v1 only; extra peers are ignored
  peerId = id;
  isHost = selfId < id;
  statusMsg = '';
  resetLobby();
  sfx.join();
  updateDom();
});
net.on('peerleave', (id) => {
  if (id !== peerId) return;
  peerId = null; isHost = true;
  statusMsg = 'Rival left';
  resetLobby();
  sfx.leave();
  updateDom();
});
net.on('error', (e) => { statusMsg = 'Network: ' + e; updateDom(); });
net.on('msg', (type, d, from) => {
  if (from && peerId && from !== peerId) return;
  const now = performance.now();
  switch (type) {
    case 'pose': onPose(d, now); break;
    case 'state':
      if (isHost) return;
      st.phase = d.ph; st.endsAt = now + d.rem; st.scores = d.s; st.combos = d.c; st.mults = d.m; st.wins = d.w;
      st.ready = d.rdy; st.round = d.rd; st.wave = d.wv; st.lastWinner = d.lw; st.matchWinner = d.mw;
      break;
    case 'spawn': if (!isHost && st.phase === 'playing') activateOrb(d); break;
    case 'kill': {
      if (isHost) return;
      st.scores = d.s; st.combos = d.c; st.mults = d.m;
      const o = findOrb(d.id);
      if (o && d.by !== mySlot()) { hitEffects(o, false, d.pts, null, -1, 1, 0); o.deactivate(); }
      else if (o) o.deactivate();
      break;
    }
    case 'hit': {
      if (!isHost || st.phase !== 'playing') return;
      const o = findOrb(d.id);
      if (o) applyHit(o, oppSlot(), -1);
      break;
    }
    case 'ready':
      if (!isHost) return;
      if (st.phase === 'lobby' || st.phase === 'roundEnd' || st.phase === 'matchEnd') { st.ready[oppSlot()] = true; broadcastState(); }
      break;
  }
});

function onPose(d, now) {
  if (!Array.isArray(d) || d.length < 23) return;
  opp.lastSeen = now;
  const sx = slotX(oppSlot());
  opp.tp.set(d[0] + sx, d[1], d[2]); opp.tq.set(d[3], d[4], d[5], d[6]);
  for (let h = 0; h < 2; h++) {
    const o = 7 + h * 8, hh = opp.hands[h];
    hh.kind = d[o];
    hh.tp.set(d[o + 1] + sx, d[o + 2], d[o + 3]); hh.tq.set(d[o + 4], d[o + 5], d[o + 6], d[o + 7]);
  }
}

const _q = new THREE.Quaternion(), _p = new V3();
function poseOf(obj, out, i) {
  out[i] = r3(obj.position.x); out[i + 1] = r3(obj.position.y); out[i + 2] = r3(obj.position.z);
  out[i + 3] = r3(obj.quaternion.x); out[i + 4] = r3(obj.quaternion.y); out[i + 5] = r3(obj.quaternion.z); out[i + 6] = r3(obj.quaternion.w);
}
const poseBuf = new Array(23).fill(0);
function sendPose() {
  if (renderer.xr.isPresenting) {
    poseOf(camera, poseBuf, 0);
    for (let h = 0; h < 2; h++) {
      // map controller index -> left/right slot by handedness when known
      const c = ctrls.find((x) => x.source && x.source.handedness === (h === 0 ? 'left' : 'right')) || ctrls[h];
      const o = 7 + h * 8;
      const active = c.source && c.grip.visible;
      poseBuf[o] = active ? (c.isHand ? 2 : 1) : 0;
      if (active) poseOf(c.grip, poseBuf, o + 1);
    }
  } else {
    poseBuf.splice(0, 7, 0, 1.6, 0, 0, 0, 0, 1);
    poseBuf[7] = 0;
    poseBuf[15] = 1;
    poseOf(deskSabre, poseBuf, 16);
  }
  net.send('pose', poseBuf, peerId);
}

// ------------------------------------------------------------------ input update + collisions
function updateInputs() {
  for (const c of ctrls) {
    c.prevBase.copy(c.base); c.prevTip.copy(c.tip);
    const active = renderer.xr.isPresenting && c.source && !c.isHand && c.grip.visible;
    if (active) {
      c.sabre.updateWorldMatrix(true, false);
      c.base.set(0, 0, -BLADE_START).applyMatrix4(c.sabre.matrixWorld);
      c.tip.set(0, 0, -BLADE_START - BLADE_LEN).applyMatrix4(c.sabre.matrixWorld);
      if (!c.bladeActive || c.fresh) { c.prevBase.copy(c.base); c.prevTip.copy(c.tip); }
      c.bladeActive = true; c.fresh = false;
      setSabreColor(c.sabre, tierHex(myCombo().mult, mySlot()));
    } else c.bladeActive = false;
    // hands
    const joints = c.hand && c.hand.joints;
    for (const p of c.pts) {
      const j = joints && joints[p.name];
      const ok = renderer.xr.isPresenting && c.isHand && j && j.visible;
      p.prev.copy(p.cur);
      if (ok) {
        p.cur.copy(j.position);
        if (!p.valid) p.prev.copy(p.cur);
        p.m.position.copy(p.cur);
      }
      p.valid = !!ok;
      p.m.visible = !!ok;
    }
  }
}

function segDist2(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}
const _a = new V3(), _b = new V3(), _op = new V3();
const SUB = [0, 0.34, 0.67, 1];
function checkCollisions() {
  for (const o of orbs) {
    if (!o.alive) continue;
    _op.copy(o.pos).add(arena.position);
    let src = -1;
    for (const c of ctrls) {
      if (!c.bladeActive) continue;
      const rr = (o.r + 0.045) ** 2;
      for (const s of SUB) {
        _a.lerpVectors(c.prevBase, c.base, s); _b.lerpVectors(c.prevTip, c.tip, s);
        if (segDist2(_op, _a, _b) < rr) { src = c.i; break; }
      }
      if (src >= 0) break;
      for (const p of c.pts) {
        if (!p.valid) continue;
        const rr2 = (o.r + p.hitR) ** 2;
        for (const s of SUB) { _a.lerpVectors(p.prev, p.cur, s); if (_a.distanceToSquared(_op) < rr2) { src = 2 + c.i; break; } }
        if (src >= 0) break;
      }
    }
    if (src < 0) {
      for (const c of ctrls) {
        if (c.bladeActive) continue;
        for (const p of c.pts) {
          if (!p.valid) continue;
          const rr2 = (o.r + p.hitR) ** 2;
          for (const s of SUB) { _a.lerpVectors(p.prev, p.cur, s); if (_a.distanceToSquared(_op) < rr2) { src = 2 + c.i; break; } }
          if (src >= 0) break;
        }
        if (src >= 0) break;
      }
    }
    if (src >= 0) localHit(o, src);
  }
}

// ------------------------------------------------------------------ desktop mouse
const mouse = new THREE.Vector2(0, -0.1);
const ray = new THREE.Raycaster();
const _sph = new THREE.Sphere();
renderer.domElement.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (renderer.xr.isPresenting) return;
  if (st.phase === 'playing') {
    ray.setFromCamera(mouse, camera);
    let bestO = null, bestD = Infinity;
    for (const o of orbs) {
      if (!o.alive) continue;
      _sph.center.copy(o.pos).add(arena.position); _sph.radius = o.r * 1.5;
      const hit = ray.ray.intersectSphere(_sph, _p);
      if (hit) { const dd = hit.distanceTo(ray.ray.origin); if (dd < bestD) { bestD = dd; bestO = o; } }
    }
    if (bestO) localHit(bestO, -1);
  } else onTrigger();
});
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); onTrigger(); } });

function updateDeskSabre() {
  deskSabre.visible = !renderer.xr.isPresenting;
  if (!deskSabre.visible) return;
  ray.setFromCamera(mouse, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  const t = d.z < -0.01 ? (-0.6 - o.z) / d.z : 2.5;
  deskSabre.position.copy(o).addScaledVector(d, t).add(new V3(0, -0.15, 0.15));
  _q.setFromUnitVectors(new V3(0, 0, -1), d);
  deskSabre.quaternion.slerp(_q, 0.5);
  setSabreColor(deskSabre, tierHex(myCombo().mult, mySlot()));
}

// ------------------------------------------------------------------ in-world panel
function winsDots(g, x, y, slot, align) {
  for (let k = 0; k < WINS_NEEDED; k++) {
    const cx = align === 'left' ? x + k * 44 : x - k * 44;
    g.beginPath(); g.arc(cx, y, 14, 0, Math.PI * 2);
    g.lineWidth = 4; g.strokeStyle = PCOL[slot]; g.stroke();
    if (st.wins[slot] > k) { g.fillStyle = PCOL[slot]; g.shadowColor = PCOL[slot]; g.shadowBlur = 14; g.fill(); g.shadowBlur = 0; }
  }
}

function drawPanel(now) {
  const v = versus(), me = mySlot(), op = oppSlot();
  const rem = Math.max(0, st.endsAt - now);
  const secs = Math.ceil(rem / 1000);
  const mc = myCombo();
  const myMult = mc.mult, myComboN = mc.combo;
  const roomTxt = net.code ? (v ? `ROOM ${net.code} · 2/2` : `ROOM ${net.code} · 1/2`) : 'SOLO';
  const key = [st.phase, v, me, secs, st.scores.join(), st.mults.join(), st.combos.join(), myMult, myComboN, st.wins.join(), st.ready.join(),
    st.wave, best, roomTxt, statusMsg, newBest, st.lastWinner, st.matchWinner, st.round, Math.round(fps)].join('|');
  panel.draw(key, (g, W) => {
    text(g, 'ORB SMASH · DUEL', 40, 52, 30, '#9fefff', 'left', 800);
    text(g, roomTxt, W - 40, 52, 30, v ? '#7cff9d' : net.code ? '#ffd36b' : '#c9b8ff', 'right', 700);
    text(g, `${Math.round(fps)} fps`, W / 2, 52, 22, '#6f6a90', 'center', 600, false);
    const readyLine = (y) => {
      if (v) {
        text(g, `YOU ${st.ready[me] ? '✓ READY' : '…'}`, W / 2 - 40, y, 36, PCOL[me], 'right', 800);
        text(g, `RIVAL ${st.ready[op] ? '✓ READY' : '…'}`, W / 2 + 40, y, 36, PCOL[op], 'left', 800);
      } else if (st.ready[me]) text(g, '✓ READY', W / 2, y, 36, PCOL[me]);
    };
    if (st.phase === 'lobby') {
      text(g, 'ORB SMASH', W / 2, 150, 104, PCOL[me], 'center', 900);
      const sub = v ? 'Rival connected! Best of 3 rounds.' : statusMsg || (net.code ? `Waiting for a rival in room ${net.code}… or play solo` : 'Solo mode');
      text(g, sub, W / 2, 240, 34, '#ffffff', 'center', 600);
      text(g, '● +10', W / 2 - 250, 305, 34, '#00f0ff');
      text(g, '● GOLD +50', W / 2, 305, 34, '#ffc400');
      text(g, '✸ BOMB −40', W / 2 + 260, 305, 34, '#ff3b2a');
      readyLine(370);
      text(g, v ? 'Pull TRIGGER (or pinch) to ready up' : 'Pull TRIGGER (or pinch) to start', W / 2, 435, 40, '#ffe94d', 'center', 800);
      text(g, `Personal best ${best}`, W / 2, 482, 26, '#b9a8ff', 'center', 600, false);
    } else if (st.phase === 'countdown') {
      text(g, v ? `ROUND ${st.round}` : 'GET READY', W / 2, 130, 56, '#ffffff');
      text(g, String(Math.max(1, secs)), W / 2, 300, 230, PCOL[me], 'center', 900);
      if (v) { winsDots(g, 80, 470, me, 'left'); winsDots(g, W - 80, 470, op, 'right'); }
    } else if (st.phase === 'playing') {
      const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
      text(g, `${mm}:${ss}`, W / 2, 150, 96, secs <= 10 ? '#ff4d4d' : '#ffffff', 'center', 900);
      text(g, `WAVE ${st.wave}`, W / 2, 230, 32, '#c9b8ff', 'center', 700);
      text(g, 'YOU', 200, 115, 38, PCOL[me], 'center', 800);
      text(g, String(v ? st.scores[me] : st.scores[0]), 200, 215, 100, PCOL[me], 'center', 900);
      if (myMult > 1) text(g, `x${myMult}  ·  ${myComboN} combo`, 200, 305, 34, hexCss(tierHex(myMult, me)), 'center', 800);
      if (v) {
        text(g, 'RIVAL', W - 200, 115, 38, PCOL[op], 'center', 800);
        text(g, String(st.scores[op]), W - 200, 215, 100, PCOL[op], 'center', 900);
        if (st.mults[op] > 1) text(g, `x${st.mults[op]}`, W - 200, 305, 34, hexCss(tierHex(st.mults[op], op)), 'center', 800);
        winsDots(g, 80, 470, me, 'left'); winsDots(g, W - 80, 470, op, 'right');
        text(g, `ROUND ${st.round}`, W / 2, 470, 30, '#ffffff', 'center', 700);
      } else {
        text(g, 'BEST', W - 200, 115, 38, '#b9a8ff', 'center', 800);
        text(g, String(best), W - 200, 215, 80, '#b9a8ff', 'center', 900);
      }
      // time bar
      const f = rem / ROUND_MS;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(160, 395, W - 320, 14);
      g.fillStyle = secs <= 10 ? '#ff4d4d' : PCOL[me]; g.fillRect(160, 395, (W - 320) * f, 14);
    } else if (st.phase === 'roundEnd' && !v) {
      text(g, 'TIME!', W / 2, 135, 80, '#ffffff', 'center', 900);
      text(g, `SCORE ${st.scores[0]}`, W / 2, 245, 84, PCOL[me], 'center', 900);
      text(g, newBest ? '★ NEW PERSONAL BEST! ★' : `Personal best ${best}`, W / 2, 330, 40, newBest ? '#ffd040' : '#b9a8ff', 'center', 800);
      text(g, 'Pull TRIGGER to play again', W / 2, 430, 40, '#ffe94d', 'center', 800);
    } else {
      const matchOver = st.phase === 'matchEnd';
      let head, col;
      if (matchOver) { head = st.matchWinner === me ? 'YOU WIN THE MATCH!' : 'RIVAL WINS THE MATCH'; col = st.matchWinner === me ? '#7cff9d' : '#ff6b8b'; }
      else if (st.lastWinner === me) { head = `ROUND ${st.round} WON!`; col = '#7cff9d'; }
      else if (st.lastWinner < 0) { head = `ROUND ${st.round}: DRAW`; col = '#ffffff'; }
      else { head = `ROUND ${st.round} LOST`; col = '#ff6b8b'; }
      text(g, head, W / 2, 130, matchOver ? 70 : 76, col, 'center', 900);
      text(g, String(st.scores[me]), W / 2 - 60, 235, 84, PCOL[me], 'right', 900);
      text(g, '–', W / 2, 235, 70, '#ffffff', 'center', 700);
      text(g, String(st.scores[op]), W / 2 + 60, 235, 84, PCOL[op], 'left', 900);
      winsDots(g, W / 2 - 90 - 44, 310, me, 'left'); winsDots(g, W / 2 + 90 + 44, 310, op, 'right');
      readyLine(375);
      text(g, matchOver ? 'Both pull TRIGGER for a REMATCH' : `Both pull TRIGGER for round ${st.round + 1}`, W / 2, 440, 40, '#ffe94d', 'center', 800);
      if (newBest) text(g, `★ New personal best: ${best}`, W / 2, 485, 26, '#ffd040', 'center', 700, false);
    }
  });
}

// ------------------------------------------------------------------ DOM UI
const $ = (id) => document.getElementById(id);
const roomInput = $('room');
const cleanCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
let savedRoom = '';
try { savedRoom = localStorage.getItem(ROOM_KEY) || ''; } catch (e) { /* ignore */ }
roomInput.value = cleanCode(params.get('room')) || cleanCode(savedRoom) || DEFAULT_ROOM;
let pingMs = null;

function joinRoomCode(code) {
  code = cleanCode(code) || DEFAULT_ROOM;
  roomInput.value = code;
  try { localStorage.setItem(ROOM_KEY, code); } catch (e) { /* ignore */ }
  if (peerId) { peerId = null; isHost = true; }
  statusMsg = '';
  const turn = params.get('turn');
  net.join(code, turn ? [{ urls: turn, username: params.get('tu') || undefined, credential: params.get('tp') || undefined }] : []);
  resetLobby();
  updateDom();
}
function goSolo() {
  net.leave();
  peerId = null; isHost = true; statusMsg = '';
  resetLobby();
  updateDom();
}
$('join').onclick = () => { sfx.unlock(); joinRoomCode(roomInput.value); };
$('rand').onclick = () => {
  sfx.unlock();
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  joinRoomCode(s);
};
$('solo').onclick = () => { sfx.unlock(); goSolo(); };
roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoomCode(roomInput.value); e.stopPropagation(); });
$('toggle').onclick = () => { const ui = $('ui'); ui.classList.toggle('hidden'); $('toggle').textContent = ui.classList.contains('hidden') ? '+' : '–'; };

function updateDom() {
  let s;
  if (!net.code) s = '🎯 Solo mode (offline). Join a room to play 1v1.';
  else if (versus()) s = `✅ Rival connected in room <b>${net.code}</b>${pingMs != null ? ` · ping ${Math.round(pingMs)} ms` : ''}. You are <b style="color:${PCOL[mySlot()]}">${mySlot() === 0 ? 'LEFT (cyan)' : 'RIGHT (pink)'}</b>.`;
  else s = `⏳ In room <b>${net.code}</b>, waiting for a rival… (other headset: same URL, same code). You can play solo meanwhile.`;
  if (statusMsg) s += `<br><small>${statusMsg}</small>`;
  $('status').innerHTML = s;
}
setInterval(async () => {
  if (peerId) { const p = await net.ping(peerId); if (p != null) pingMs = p; } else pingMs = null;
  updateDom();
}, 2000);

async function setupXRButtons() {
  const note = $('xrnote');
  if (!('xr' in navigator)) {
    note.innerHTML = 'WebXR not available in this browser. Desktop mode: click orbs to smash, <kbd>Space</kbd> = ready. Open this URL in the Meta Quest Browser for VR/MR.';
    return;
  }
  const [ar, vr] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
  ]);
  $('ar').disabled = !ar; $('vr').disabled = !vr;
  $('ar').onclick = () => startXR('immersive-ar');
  $('vr').onclick = () => startXR('immersive-vr');
  note.textContent = ar ? 'Mixed Reality shows your real room (passthrough).' : vr ? 'Passthrough AR not supported here; VR works.' : 'No headset detected. Desktop mode: click orbs, Space = ready.';
}
let xrMode = null;
async function startXR(mode) {
  sfx.unlock();
  try {
    const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    xrMode = mode;
    await renderer.xr.setSession(session);
    try {
      if (session.supportedFrameRates && session.updateTargetFrameRate) {
        const rates = Array.from(session.supportedFrameRates);
        if (rates.includes(90)) session.updateTargetFrameRate(90);
      }
    } catch (e) { /* optional */ }
  } catch (e) {
    $('xrnote').textContent = 'Could not start ' + mode + ': ' + (e && e.message ? e.message : e);
  }
}
renderer.xr.addEventListener('sessionstart', () => {
  const ar = xrMode === 'immersive-ar';
  scene.background = ar ? null : BG;
  env.visible = !ar;
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = BG; env.visible = true; xrMode = null;
  camera.position.copy(DESK_CAM); camera.quaternion.identity(); camera.lookAt(DESK_LOOK);
  camera.fov = 70; camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  for (const c of ctrls) { c.bladeActive = false; for (const p of c.pts) { p.valid = false; p.m.visible = false; } }
});
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ main loop
let last = performance.now(), lastPose = 0, fpsAcc = 0, fpsN = 0, fpsT = 0;
const _size = new THREE.Vector2();
function loop() {
  const now = performance.now();
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += rawDt; fpsN++;
  if (now - fpsT > 1000) { fps = fpsN / Math.max(0.001, fpsAcc); fpsAcc = 0; fpsN = 0; fpsT = now; }
  camera.getWorldPosition(camWorld);

  if (isHost || !versus()) hostTick(now);
  if (st.phase !== prevPhase) { onPhaseChange(prevPhase, st.phase, now); prevPhase = st.phase; }
  if (st.phase === 'countdown') {
    const s = Math.ceil((st.endsAt - now) / 1000);
    if (s !== lastBeep && s > 0 && s <= 3) { lastBeep = s; sfx.beep(false); }
  }
  if (!isHost && versus() && guestCombo.combo && now - guestCombo.last > COMBO_WINDOW) { guestCombo.combo = 0; guestCombo.mult = 1; }

  updateInputs();
  updateDeskSabre();

  // orbs (frozen briefly during hit-stop)
  const odt = now < hitStopUntil ? rawDt * 0.06 : rawDt;
  for (const o of orbs) {
    if (!o.alive) continue;
    o.t += odt;
    o.calc();
    o.group.position.copy(o.pos);
    o.core.rotation.x += o.spin.x * odt; o.core.rotation.y += o.spin.y * odt;
    if (o.kind === 2) o.halo.material.opacity = 0.55 + 0.45 * Math.sin(now * 0.025);
    else if (o.kind === 1) o.halo.scale.setScalar(o.r * (5 + Math.sin(now * 0.02)));
    if (o.pos.z > 1.2 || o.t > 10) { orbPassed(o); o.deactivate(); }
  }
  if (st.phase === 'playing') checkCollisions();

  // fx
  let half = 600;
  if (renderer.xr.isPresenting) {
    const xc = renderer.xr.getCamera();
    if (xc.cameras && xc.cameras[0] && xc.cameras[0].viewport) half = xc.cameras[0].viewport.w / 2;
  } else half = renderer.getDrawingBufferSize(_size).y / 2;
  particles.update(rawDt, half);
  rings.update(rawDt);
  popups.update(rawDt);
  flash.update(rawDt);
  portal.userData.ring.rotation.z += rawDt * 0.3;
  portal.userData.ring2.rotation.z -= rawDt * 0.5;
  for (const r of slotRings) r.material.opacity = 0.55 + 0.25 * Math.sin(now * 0.004);

  // opponent avatar smoothing
  const showOpp = versus() && now - opp.lastSeen < 3000;
  opp.group.visible = showOpp;
  if (showOpp) {
    const k = 1 - Math.exp(-rawDt * 18);
    opp.headRoot.position.lerp(opp.tp, k); opp.headRoot.quaternion.slerp(opp.tq, k);
    opp.label.position.copy(opp.headRoot.position).y += 0.28;
    for (const h of opp.hands) {
      h.root.visible = h.kind > 0;
      h.sabre.visible = h.kind === 1; h.glove.visible = h.kind === 2;
      h.root.position.lerp(h.tp, k); h.root.quaternion.slerp(h.tq, k);
    }
  }

  if (versus() && now - lastPose > 33) { lastPose = now; sendPose(); }
  drawPanel(now);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
applySlotLayout();
setupXRButtons();
if (params.has('solo')) goSolo(); else joinRoomCode(roomInput.value);
renderer.setAnimationLoop(loop);

// debug / test hooks (used by the headless smoke test)
window.__orb = {
  st, selfId, net,
  get peer() { return peerId; },
  get isHost() { return isHost; },
  get fps() { return fps; },
  orbIds: () => orbs.filter((o) => o.alive).map((o) => o.id),
  hitAny: () => { const o = orbs.find((x) => x.alive && x.kind !== 2); if (o) { localHit(o, -1); return o.id; } return null; },
  trigger: () => onTrigger(),
};
