import * as THREE from 'three';
import { Rig } from '../anim/rig';
import { GOLEM_POSE_DEFS, buildGolemPoses } from '../anim/golemPoses';
import { WARRIOR_POSE_DEFS, buildWarriorPoses } from '../anim/warriorPoses';
import { buildGreyboxGolem, buildGreyboxWarrior } from '../render/greybox';
import GOLEM_RIG from '../data/golem_rig.json';
import WARRIOR_RIG from '../data/warrior_rig.json';
import type { Pose } from '../anim/pose';

/**
 * Debug contact sheet: every pose of one character, one viewport cell per pose.
 * ?posesheet=golem|warrior&view=34|front|side|back|top&only=name1,name2
 */
export function runPoseSheet(kind: string, view: string, only: string[]): void {
  document.body.style.margin = '0';
  document.body.style.background = '#20232a';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2e36);
  scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3530, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 40);
  scene.add(sun);

  const isGolem = kind !== 'warrior';
  const defs = isGolem ? GOLEM_POSE_DEFS : WARRIOR_POSE_DEFS;
  let names = Object.keys(defs);
  if (only.length) names = names.filter((n) => only.includes(n));
  const rig = Rig.fromJoints(isGolem ? GOLEM_RIG.bones : WARRIOR_RIG.bones);
  if (isGolem) buildGreyboxGolem(rig);
  else buildGreyboxWarrior(rig);
  const poses = (isGolem ? buildGolemPoses(rig) : buildWarriorPoses(rig)) as Record<string, Pose>;
  scene.add(rig.root);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(isGolem ? 14 : 1.6, 32), new THREE.MeshStandardMaterial({ color: 0x3d434d }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // metre grid on the floor for scale
  const grid = new THREE.GridHelper(isGolem ? 28 : 3.2, isGolem ? 14 : 16, 0x55606e, 0x46505c);
  grid.position.y = 0.02;
  scene.add(grid);

  const n = names.length;
  const aspect = W / H;
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect * 0.75)));
  const rows = Math.ceil(n / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  const camera = new THREE.PerspectiveCamera(isGolem ? 38 : 36, cw / ch, 0.05, 500);
  const h = isGolem ? 7.5 : 0.9;
  const dist = isGolem ? 46 : 5.2;
  const dir =
    view === 'front'
      ? new THREE.Vector3(0, 0.12, 1)
      : view === 'side'
        ? new THREE.Vector3(1, 0.1, 0)
        : view === 'back'
          ? new THREE.Vector3(0, 0.25, -1)
          : view === 'top'
            ? new THREE.Vector3(0.01, 1, 0.2)
            : new THREE.Vector3(0.75, 0.3, 1);
  dir.normalize();
  camera.position.set(0, h, 0).addScaledVector(dir, dist);
  camera.lookAt(0, h, 0);

  names.forEach((name, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const x = col * cw;
    const y = H - (row + 1) * ch;
    poses[name].applyTo(rig);
    rig.update();
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, camera);
    const el = document.createElement('div');
    el.textContent = name;
    el.style.cssText = `position:absolute;left:${x + 4}px;top:${(row) * ch + 4}px;color:#fff;font:12px monospace;background:rgba(0,0,0,.55);padding:1px 4px`;
    document.body.appendChild(el);
  });
  (window as unknown as { __poseSheetReady: boolean }).__poseSheetReady = true;
}
