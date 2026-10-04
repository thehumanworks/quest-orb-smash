import * as THREE from 'three';

export function makeGlowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- GPU point particles (one draw call, ring-buffer allocation) ----------
const PVS = `
attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main(){
  vColor = aColor; vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * projectionMatrix[1][1] * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PFS = `
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = 1.0 - r; a *= a;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

export class Particles {
  constructor(scene, n = 900) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVS, fragmentShader: PFS,
      uniforms: { uScale: { value: 500 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
    this.active = 0;
  }
  burst(p, color, count = 40, speed = 3, size = 0.035, life = 0.7, white = 0.25) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.75);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = s * Math.cos(th) * sp; this.vel[i * 3 + 1] = u * sp + 0.6; this.vel[i * 3 + 2] = s * Math.sin(th) * sp;
      const w = Math.random() < white ? 1 : 0;
      this.col[i * 3] = w ? 1 : c.r; this.col[i * 3 + 1] = w ? 1 : c.g; this.col[i * 3 + 2] = w ? 1 : c.b;
      this.size[i] = size * (0.5 + Math.random());
      this.max[i] = this.life[i] = life * (0.5 + Math.random() * 0.7);
      this.alpha[i] = 1;
    }
    this.active = this.n;
  }
  update(dt, halfHeight) {
    this.mat.uniforms.uScale.value = halfHeight;
    if (!this.active) return;
    let alive = 0;
    const drag = Math.pow(0.12, dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      const j = i * 3;
      this.vel[j] *= drag; this.vel[j + 1] = this.vel[j + 1] * drag - 2.5 * dt; this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.alpha[i] = f * f;
    }
    this.active = alive;
    const a = this.geo.attributes;
    a.position.needsUpdate = true; a.aAlpha.needsUpdate = true; a.aColor.needsUpdate = true; a.aSize.needsUpdate = true;
  }
}

// ---------- expanding shock rings ----------
export class Rings {
  constructor(scene, n = 12) {
    const geo = new THREE.RingGeometry(0.82, 1, 40);
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false; m.renderOrder = 6;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 0.3, r0: 0.1, r1: 0.5 });
    }
    this.i = 0;
  }
  spawn(p, color, r0, r1, dur, camPos) {
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    it.m.position.copy(p); it.m.lookAt(camPos);
    it.m.material.color.set(color);
    it.t = 0; it.dur = dur; it.r0 = r0; it.r1 = r1; it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt;
      const f = it.t / it.dur;
      if (f >= 1) { it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 3);
      it.m.scale.setScalar(it.r0 + (it.r1 - it.r0) * e);
      it.m.material.opacity = 1 - f;
    }
  }
}

// ---------- floating score popups (canvas sprites) ----------
export class Popups {
  constructor(scene, n = 12) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      s.visible = false; s.renderOrder = 10;
      scene.add(s);
      this.items.push({ s, c, tex, t: 0, life: 1, sc: 0.3 });
    }
    this.i = 0;
  }
  spawn(p, text, color, scale = 0.32, life = 0.9) {
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    const g = it.c.getContext('2d');
    g.clearRect(0, 0, 256, 128);
    g.font = '900 64px system-ui, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width;
    const fs = w > 240 ? Math.floor(64 * 240 / w) : 64;
    g.font = `900 ${fs}px system-ui, Arial, sans-serif`;
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, 128, 64);
    g.fillStyle = color; g.fillText(text, 128, 64);
    it.tex.needsUpdate = true;
    it.s.position.copy(p);
    it.t = 0; it.life = life; it.sc = scale; it.s.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.t += dt;
      const f = it.t / it.life;
      if (f >= 1) { it.s.visible = false; continue; }
      it.s.position.y += dt * 0.45;
      const pop = f < 0.12 ? 0.6 + (f / 0.12) * 0.6 : 1.2 - Math.min(0.2, (f - 0.12) * 1.5);
      it.s.scale.set(it.sc * 2 * pop, it.sc * pop, 1);
      it.s.material.opacity = f > 0.6 ? 1 - (f - 0.6) / 0.4 : 1;
    }
  }
}

// ---------- full-view colour flash (a small inverted sphere glued to the head) ----------
export class Flash {
  constructor(camera) {
    this.m = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.m.renderOrder = 999; this.m.visible = false; this.m.frustumCulled = false;
    camera.add(this.m);
    this.v = 0;
  }
  fire(color, strength) { this.m.material.color.set(color); this.v = Math.max(this.v, strength); }
  update(dt) {
    if (this.v <= 0) { this.m.visible = false; return; }
    this.v = Math.max(0, this.v - dt * 2.8);
    this.m.visible = true; this.m.material.opacity = this.v;
  }
}
