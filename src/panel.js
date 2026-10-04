import * as THREE from 'three';

// A floating canvas-texture scoreboard. Redraws only when the shown content changes.
export class Panel {
  constructor(width = 2.1, height = 1.05) {
    this.c = document.createElement('canvas');
    this.c.width = 1024; this.c.height = 512;
    this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 4;
    this.key = '';
  }
  // view = { lines: [{t, size, color, y, x?, align?, weight?}], border }
  draw(key, painter) {
    if (key === this.key) return;
    this.key = key;
    const g = this.g, W = 1024, H = 512;
    g.clearRect(0, 0, W, H);
    // glassy rounded backdrop
    g.save();
    roundRect(g, 8, 8, W - 16, H - 16, 36);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(18,6,40,0.82)');
    grd.addColorStop(1, 'rgba(6,2,18,0.82)');
    g.fillStyle = grd; g.fill();
    g.lineWidth = 6; g.strokeStyle = 'rgba(120,220,255,0.85)';
    g.shadowColor = 'rgba(0,229,255,0.9)'; g.shadowBlur = 24; g.stroke();
    g.restore();
    painter(g, W, H);
    this.tex.needsUpdate = true;
  }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function text(g, t, x, y, size, color, align = 'center', weight = 800, glow = true) {
  g.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Arial, sans-serif`;
  g.textAlign = align; g.textBaseline = 'middle';
  if (glow) { g.shadowColor = color; g.shadowBlur = size * 0.35; }
  g.fillStyle = color;
  g.fillText(t, x, y);
  g.shadowBlur = 0;
}
