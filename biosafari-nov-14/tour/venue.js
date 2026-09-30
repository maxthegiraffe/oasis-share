// Primal Moves, Marina del Rey, as set up for the Biohacking Safari (Nov 14).
//
// Built from the layout Max confirmed (2026-09-30), not imagined:
//   - the April Safari zone map in Base44 (VenueZone, event safari_april_2026)
//     for where the stage, rug, sauna, Acacia booths, Giraffeteria, bus,
//     registration and vendors go;
//   - Max: upstairs runs along the right side (back lounge, four rooms, front
//     lounge, a three-room tea lounge next to it); the Acacia Grove is to the
//     right of the stage; the cold plunges are outside behind the building;
//     the drink booths move to the entrance for Nov 14;
//   - photos (the /biosafari gallery, Peerspace, primalmoves.com): the long
//     brick wall with steel factory windows is the left wall and the stage
//     stands on it; the rig and barrel sauna are at the back by a door.
//
// Units are feet. x runs from the left (brick) wall 0 to the right wall 66;
// z from the back wall 0 to the front (entrance) wall 110; y is up.
import * as THREE from 'three';

export const SIZE = { w: 66, d: 110, h: 22, mezz: 10 };

// Where each tour zone's label sits, and where the camera goes to look at it.
export const ANCHORS = {
  basecamp: { at: [40, 4, 98], eye: [84, 58, 160], look: [34, 0, 92] },
  savanna: { at: [26, 5, 56], eye: [82, 60, 110], look: [24, 0, 54] },
  acacia: { at: [24, 6, 12], eye: [70, 56, 66], look: [22, 0, 16] },
  hole: { at: [12, 8, 2], eye: [20, 64, -64], look: [16, 0, 0] },
  oasis: { at: [56, 20, 40], eye: [128, 74, 72], look: [54, 11, 40] },
  tea: { at: [56, 20, 84], eye: [124, 70, 124], look: [54, 11, 80] },
};
export const OVERVIEW = { eye: [118, 104, 176], look: [30, 2, 50] };

// ---- materials ------------------------------------------------------------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 8;
  return t;
}
const brickTex = (rx, ry) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b9b0a4'; g.fillRect(0, 0, w, h);
  const bh = 16, bw = 48;
  for (let r = 0; r < h / bh; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let c = -1; c < w / bw + 1; c++) {
      const v = 140 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${Math.floor(v * 0.42)},${Math.floor(v * 0.3)})`;
      g.fillRect(c * bw + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
}, [rx, ry]);
const rugTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#b8583a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,245,230,.85)'; g.lineWidth = 5;
  g.strokeRect(24, 24, w - 48, h - 48);
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(24, 90 + i * 70); g.lineTo(140, 90 + i * 70); g.stroke(); }
  g.beginPath(); g.arc(w / 2, h / 2, 70, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(w / 2, 24); g.lineTo(w / 2, h - 24); g.stroke();
  for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(w - 150, 60 + i * 55); g.lineTo(w - 24, 60 + i * 55); g.stroke(); }
});
const concreteTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#b8b2a8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { const v = 160 + Math.random() * 40; g.fillStyle = `rgba(${v},${v - 4},${v - 10},.25)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
}, [4, 6]);
const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
const MAT = {
  steel: M('#202225', { roughness: 0.5, metalness: 0.6 }),
  wood: M('#8a5a32'), woodL: M('#b98a5a'), dark: M('#3a2e25'),
  blue: M('#1f2f7a', { roughness: 0.9 }), mustard: M('#d49a22', { roughness: 0.9 }),
  yellow: M('#e2b33a', { roughness: 0.95 }), orange: M('#c4552c', { roughness: 0.9 }),
  cream: M('#efe6d2'), white: M('#f4f1ea'), glass: M('#cfe3ec', { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 }),
  rubber: M('#2a2b2e', { roughness: 1 }), grass: M('#7d9a58', { roughness: 1 }), water: M('#6fb6c9', { roughness: 0.15 }),
  olive: M('#6f6a3a'), plaster: M('#d8cdb8'), pink: M('#caa1a6'), sage: M('#9fb08f'), giraffe: M('#d49a3a'),
  banner: M('#f1ebdf'), booth: M('#e9e2d4'), busCream: M('#efe4c8'), busBlue: M('#5e8aa6'),
};
const box = (w, h, d, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x + w / 2, y + h / 2, z + d / 2);
  m.castShadow = true; m.receiveShadow = true;
  return m;
};

// ---- the building ------------------------------------------------------------
export function buildVenue(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const add = (...ms) => ms.forEach((m) => g.add(m));
  const { w: W, d: D, h: H, mezz: MY } = SIZE;

  // floor and the yard behind
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, D / 2); floor.receiveShadow = true; add(floor);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(44, 16), M('#c9c2b4'));
  yard.rotation.x = -Math.PI / 2; yard.position.set(22, 0.02, -8); yard.receiveShadow = true; add(yard);
  add(box(10, 0.1, 10, MAT.grass, 30, 0.03, -14));

  // walls: left (brick with the factory windows) and back; the front and right
  // walls are cut away so the model can be seen into
  const wallL = box(1, H, D, new THREE.MeshStandardMaterial({ map: brickTex(D / 8, H / 6), roughness: 0.9 }), -1, 0, 0);
  const wallB = box(W + 1, H, 1, new THREE.MeshStandardMaterial({ map: brickTex(W / 8, H / 6), roughness: 0.9 }), -1, 0, -1);
  add(wallL, wallB);
  wallB.material.transparent = true; g.userData.backWall = wallB;
  // steel pilasters and five high factory windows on the left wall
  for (let z = 4; z < D; z += 18) add(box(0.6, H, 1, MAT.steel, 0, 0, z));
  for (const zc of [14, 32, 50, 68, 86]) {
    add(box(0.3, 7, 13, MAT.steel, 0, 11, zc - 6.5));
    const pane = box(0.2, 6.2, 12.2, M('#e8eef0', { roughness: 0.2, emissive: '#fff6e0', emissiveIntensity: 0.25 }), 0.2, 11.4, zc - 6.1);
    add(pane);
    for (let k = 1; k < 5; k++) add(box(0.25, 6.2, 0.15, MAT.steel, 0.25, 11.4, zc - 6.1 + k * 2.44));
    add(box(0.25, 0.15, 12.2, MAT.steel, 0.25, 14.4, zc - 6.1));
    // candles on the sill
    for (let k = 0; k < 6; k++) add(box(0.3, 0.6, 0.3, M('#fff3d6', { emissive: '#ffcf80', emissiveIntensity: 0.8 }), 0.6, 10.6, zc - 5 + k * 2));
  }
  // back door out to the yard
  add(box(5, 8, 0.3, M('#3b4046'), 13, 0, -0.2));

  // ---- the watering hole: rig + barrel sauna inside, plunges outside ----------
  add(box(22, 0.08, 12, MAT.rubber, 1, 0.01, 1.5));
  for (let x = 2; x <= 18; x += 5.3) for (const z of [2.5, 11]) add(box(0.4, 10, 0.4, MAT.steel, x, 0, z));
  for (const z of [2.5, 11]) add(box(16.4, 0.4, 0.4, MAT.steel, 2, 9.6, z));
  for (let x = 2; x <= 18; x += 5.3) add(box(0.4, 0.4, 8.9, MAT.steel, x, 9.6, 2.5));
  for (const x of [6, 9]) add(box(0.1, 3, 0.1, M('#999'), x, 6.6, 6.5));
  const sauna = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 8, 24), MAT.wood);
  sauna.rotation.z = Math.PI / 2; sauna.position.set(24, 3.4, 5); sauna.castShadow = true; add(sauna);
  for (const dx of [-3.8, 3.8]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.18, 8, 24), MAT.steel); ring.rotation.y = Math.PI / 2; ring.position.set(24 + dx * 0.9, 3.4, 5); add(ring); }
  for (const x of [8, 16]) {
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.6, 24), M('#9aa3a8', { metalness: 0.7, roughness: 0.35 }));
    tub.position.set(x, 1.3, -8); tub.castShadow = true; add(tub);
    const wtr = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), MAT.water); wtr.rotation.x = -Math.PI / 2; wtr.position.set(x, 2.55, -8); add(wtr);
  }
  add(box(0.3, 8, 0.3, MAT.steel, 24, 0, -12), box(2, 0.2, 0.3, MAT.steel, 23, 8, -12));

  // ---- the Acacia Grove: booths right of the stage and along the back ---------
  const booth = (x, z, rotY = 0) => {
    const b = new THREE.Group();
    b.add(box(6, 3, 2.4, MAT.booth, -3, 0, -1.2));
    b.add(box(0.2, 7, 3, MAT.banner, -3.4, 0, -4.4));
    b.add(box(0.2, 7, 3, MAT.banner, 3.2, 0, -4.4));
    b.position.set(x, 0, z); b.rotation.y = rotY; add(b);
  };
  for (const x of [30, 38]) booth(x, 6);
  for (const z of [20, 30]) booth(5, z, -Math.PI / 2);

  // ---- the stage on the brick wall, and the Savanna rug facing it -------------
  add(box(9, 0.05, 30, M('#7d4a2e'), 1, 0.02, 41));
  add(box(3.2, 3, 10, MAT.blue, 1.5, 0, 50));
  add(box(1.2, 3.8, 10, MAT.blue, 1.2, 0, 50));
  for (const z of [44, 63]) { add(box(3, 3.4, 3, MAT.mustard, 2, 0, z)); }
  add(box(2.6, 1.4, 2.6, MAT.wood, 6, 0, 53));
  const plush = (x, z) => {
    add(box(1.4, 3, 1, MAT.giraffe, x, 0, z));
    add(box(0.6, 4, 0.6, MAT.giraffe, x + 0.4, 3, z + 0.2));
    add(box(1.2, 0.8, 0.8, MAT.giraffe, x + 0.3, 7, z + 0.1));
  };
  plush(2.5, 41.5); plush(2.5, 67.5);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(27, 42), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 2; rug.position.set(28.5, 0.04, 56); rug.receiveShadow = true; add(rug);
  // yellow modular couches in rows facing the stage (toward -x)
  for (const [x, z0, n] of [[16, 42, 4], [22, 40, 5], [28, 43, 4]]) {
    for (let i = 0; i < n; i++) { add(box(3.6, 1.6, 4, MAT.yellow, x, 0, z0 + i * 4.3)); add(box(1, 2.6, 4, MAT.yellow, x + 3.2, 0, z0 + i * 4.3)); }
  }
  add(box(3.4, 2.6, 9, MAT.orange, 35, 0, 44), box(3.4, 2.6, 9, MAT.orange, 35, 0, 58));
  for (const [x, z, c] of [[18, 66, MAT.blue], [21, 69, MAT.orange], [25, 66, MAT.yellow], [31, 70, MAT.blue], [14, 38, MAT.orange]]) {
    const bb = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), c); bb.scale.y = 0.6; bb.position.set(x, 0.8, z); bb.castShadow = true; add(bb);
  }

  // ---- upstairs along the right side ------------------------------------------
  const MX = 44; // the mezzanine's inner edge
  add(box(W - MX, 0.8, 89, M('#6b4a30'), MX, MY, 1));
  for (let z = 6; z < 90; z += 14) add(box(0.6, MY, 0.6, MAT.steel, MX + 0.2, 0, z));
  // railing along the open edge, with the stair landing left open
  for (let z = 1; z < 90; z += 3) if (z < 12 || z > 18) add(box(0.15, 3.4, 0.15, MAT.steel, MX, MY + 0.8, z));
  add(box(0.2, 0.2, 10, MAT.steel, MX, MY + 4.1, 1), box(0.2, 0.2, 71, MAT.steel, MX, MY + 4.1, 19));
  // black steel stair up the inner edge, landing at the back
  for (let i = 0; i < 14; i++) add(box(4, 0.35, 1.3, MAT.steel, MX - 4.2, (i + 1) * (MY + 0.8) / 14 - 0.35, 32 - i * 1.3));
  add(box(0.2, MY + 1, 18, MAT.steel, MX - 4.3, 0, 13.5));
  const up = MY + 0.8, wallH = 7.5;
  const part = (z, mat = MAT.plaster) => add(box(W - MX - 6, wallH, 0.3, mat, MX + 6, up, z));
  const lounge = (z0, z1, sofa) => {
    add(box(4, 2.4, (z1 - z0) - 3, sofa, W - 5, up, z0 + 1.5));
    add(box(3.5, 1.2, 3.5, MAT.woodL, W - 11, up, (z0 + z1) / 2 - 1.75));
  };
  // back lounge
  part(15); lounge(1, 15, MAT.orange);
  // four treatment rooms
  const rooms = [[15, 28, MAT.pink], [28, 41, MAT.sage], [41, 54, MAT.pink], [54, 67, MAT.sage]];
  for (const [z0, z1, mat] of rooms) {
    part(z1);
    add(box(0.3, wallH, (z1 - z0) - 4, mat, MX + 6, up, z0 + 0.5)); // inner wall, a doorway toward the front
    add(box(6, 2.4, 2.6, MAT.white, W - 10, up, (z0 + z1) / 2 - 1.3)); // massage table
    add(box(2, 2.4, 1.6, MAT.woodL, W - 3, up, z0 + 1));
  }
  // front lounge
  lounge(67, 78, MAT.mustard); part(78);
  // the three-room tea lounge next to it
  for (const [z0, z1] of [[78, 82], [82, 86], [86, 90]]) {
    part(z1, MAT.olive);
    add(box(0.3, wallH, (z1 - z0) - 1.6, MAT.olive, MX + 6, up, z0 + 0.3));
    add(box(2.6, 1, 2, MAT.dark, W - 12, up, (z0 + z1) / 2 - 1));
    add(box(3.4, 1.8, 2.6, MAT.mustard, W - 5, up, z0 + 0.7));
  }

  // ---- the Giraffeteria, back right, under the mezzanine ----------------------
  add(box(14, 3.4, 3, MAT.woodL, 48, 0, 5), box(14, 0.3, 3.4, MAT.dark, 48, 3.4, 4.8));
  add(box(14, 6, 1.2, MAT.dark, 48, 0, 1.2));

  // ---- Basecamp at the front ---------------------------------------------------
  const bus = new THREE.Group();
  bus.add(box(24, 5.2, 7.4, MAT.busCream, 0, 1.4, 0), box(24, 1.8, 7.5, MAT.busBlue, 0, 1.4, -0.05));
  bus.add(box(22, 1.7, 7.6, M('#39505e', { roughness: 0.2 }), 1, 4.1, -0.1));
  for (const x of [4, 19]) for (const z of [-0.2, 7.2]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.8, 16), MAT.steel); wh.rotation.x = Math.PI / 2; wh.position.set(x, 1.4, z + 0.2); bus.add(wh); }
  bus.position.set(3, 0, 82); add(bus);
  booth(8, 100, 0); // front-left vendor
  add(box(16, 3, 3, MAT.woodL, 31, 0, 92), box(16, 0.2, 3.4, MAT.dark, 31, 3, 91.8)); // registration
  // the drink booths, moved to the entrance for Nov 14
  for (const x of [52, 60]) booth(x, 100, 0);
  add(box(12, 0.05, 8, M('#3c3c3c'), 30, 0.03, 101)); // entrance mat

  // ---- people, for scale ---------------------------------------------------------
  const tones = ['#f0e0c8', '#e6c9a8', '#c99f7a', '#8d5f3c', '#5b3b27'];
  const shirts = ['#f4f1ea', '#e2b33a', '#3a5a7a', '#c4552c', '#7d9a58', '#1f2f7a', '#d8cdb8'];
  const person = (x, z, y = 0) => {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.4, 4, 8), M(shirts[(x * 7 + z) % shirts.length | 0]));
    body.position.y = 2.1; p.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), M(tones[(x + z) % tones.length | 0]));
    head.position.y = 4.4; p.add(head);
    p.position.set(x, y, z); p.traverse((o) => { o.castShadow = true; }); add(p);
  };
  const crowd = [[12, 60], [13, 48], [40, 38], [42, 66], [14, 30], [26, 22], [34, 14], [36, 20], [20, 8], [6, 16], [8, 34], [50, 10], [56, 10],
    [36, 84], [40, 88], [46, 96], [55, 104], [62, 98], [20, 96], [12, 104], [30, 104], [38, 72], [44, 50], [44, 70], [16, 75], [24, 78],
    [10, -6], [20, -10], [4, 10], [52, 20]];
  crowd.forEach(([x, z]) => person(x, z));
  [[50, 8], [52, 24], [50, 48], [52, 70], [50, 84], [58, 60]].forEach(([x, z]) => person(x, z, up));

  return g;
}

export function lights(scene) {
  scene.add(new THREE.HemisphereLight('#fff6e8', '#6e5a48', 1.1));
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.2);
  sun.position.set(-60, 120, 60); sun.target.position.set(33, 0, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 320 });
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
  fill.position.set(120, 80, 160); scene.add(fill);
}
