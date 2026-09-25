import * as THREE from 'three';
import { ARENA } from '../game/world';

/** Primitive arena: floor disc, ring wall, pillars, fallen column, rubble, braziers, seal. */
export function buildGreyboxArena(scene: THREE.Scene): { braziers: THREE.Vector3[] } {
  // floor with a flagstone-ish checker so movement reads
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 70 + ((x * 37 + y * 53) % 5) * 5;
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA.floorRadius / 4, ARENA.floorRadius / 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.floorRadius, 96),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);

  // central seal
  const seal = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.sealRadius - 0.6, ARENA.sealRadius, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.8 }),
  );
  seal.rotation.x = -Math.PI / 2;
  seal.position.y = 0.02;
  scene.add(seal);

  // ring wall with a gap at the gate
  const stone = new THREE.MeshStandardMaterial({ color: 0x5b5e66, roughness: 0.85, flatShading: true });
  const gateHalf = Math.atan2(ARENA.gate.width / 2, ARENA.wallRadius);
  const segs = 36;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const dg = Math.abs(Math.atan2(Math.sin(mid), Math.cos(mid)));
    if (dg < gateHalf + 0.05) continue;
    const h = ARENA.wallHeight * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7)));
    const w = 2 * ARENA.wallRadius * Math.sin((a1 - a0) / 2) + 0.2;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.4), stone);
    const r = ARENA.wallRadius + 1.2;
    blk.position.set(Math.sin(mid) * r, h / 2, Math.cos(mid) * r);
    blk.rotation.y = mid;
    blk.castShadow = true;
    blk.receiveShadow = true;
    scene.add(blk);
  }

  // pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x74767c, roughness: 0.8, flatShading: true });
  for (const p of ARENA.pillars) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, p.h, 12), pillarMat);
    m.position.set(p.x, p.h / 2, p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  for (const f of ARENA.fallen) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r, f.length, 12), pillarMat);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = (f.yaw * Math.PI) / 180 - Math.PI / 2;
    m.position.set(f.x, f.r, f.z);
    m.castShadow = true;
    scene.add(m);
  }
  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x5f5d59, roughness: 0.95, flatShading: true });
  for (const r of ARENA.rubble) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r, 0), rubbleMat);
    m.scale.y = 0.45;
    m.position.set(r.x, r.r * 0.3, r.z);
    m.castShadow = true;
    scene.add(m);
  }
  const braziers: THREE.Vector3[] = [];
  const fireMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff7a2a, emissiveIntensity: 4 });
  for (const b of ARENA.braziers) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1.8, 10), stone);
    base.position.set(b.x, 0.9, b.z);
    base.castShadow = true;
    scene.add(base);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 0.4, 12), stone);
    bowl.position.set(b.x, 2.0, b.z);
    scene.add(bowl);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 8), fireMat);
    fire.position.set(b.x, 2.6, b.z);
    scene.add(fire);
    braziers.push(new THREE.Vector3(b.x, 2.8, b.z));
  }
  return { braziers };
}
