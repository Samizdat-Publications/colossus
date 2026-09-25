import * as THREE from 'three';

export interface JointDef {
  name: string;
  parent: string | null;
  head: number[];
  tail: number[];
  radius: number;
}

/**
 * A character skeleton made of pivots whose rest rotation is identity, so every bone's local axes
 * match the character's axes at rest (X = character's left, Y = up, Z = forward). Poses are
 * authored as Euler offsets in that frame.
 *
 * root   : placed in the world (position + yaw) by gameplay
 * offset : child of root, driven by poses for root motion (bob, lean, roll, kneel drop)
 */
export class Rig {
  readonly root = new THREE.Group();
  readonly offset = new THREE.Group();
  readonly bones: THREE.Object3D[] = [];
  readonly names: string[] = [];
  readonly index = new Map<string, number>();
  readonly parentIndex: number[] = [];
  readonly restLocal: THREE.Vector3[] = [];
  readonly restWorld: THREE.Vector3[] = [];
  readonly tailLocal: THREE.Vector3[] = [];
  readonly radius: number[] = [];

  private constructor() {
    this.root.add(this.offset);
  }

  get count(): number {
    return this.bones.length;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  i(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`rig has no bone ${name}`);
    return i;
  }

  bone(name: string): THREE.Object3D {
    return this.bones[this.i(name)];
  }

  private addBone(def: JointDef, headWorld: THREE.Vector3): void {
    const pivot = new THREE.Group();
    pivot.name = `pivot_${def.name}`;
    const pi = def.parent ? this.i(def.parent) : -1;
    const parentObj = pi >= 0 ? this.bones[pi] : this.offset;
    const parentWorld = pi >= 0 ? this.restWorld[pi] : new THREE.Vector3();
    pivot.position.copy(headWorld).sub(parentWorld);
    parentObj.add(pivot);
    this.index.set(def.name, this.bones.length);
    this.bones.push(pivot);
    this.names.push(def.name);
    this.parentIndex.push(pi);
    this.restLocal.push(pivot.position.clone());
    this.restWorld.push(headWorld.clone());
    this.tailLocal.push(new THREE.Vector3().fromArray(def.tail).sub(new THREE.Vector3().fromArray(def.head)));
    this.radius.push(def.radius);
  }

  /** Build from joint definitions (greybox and data-only use). */
  static fromJoints(defs: JointDef[]): Rig {
    const rig = new Rig();
    for (const d of defs) rig.addBone(d, new THREE.Vector3().fromArray(d.head));
    return rig;
  }

  /**
   * Build from a loaded glTF armature: pivots are placed at the bone nodes' rest positions and
   * every non-bone child (the bone-parented meshes) is moved under its pivot, keeping its world
   * transform. `src` must be in rest pose with an identity root transform.
   */
  static fromObject(src: THREE.Object3D, defs: JointDef[]): Rig {
    const rig = new Rig();
    src.updateMatrixWorld(true);
    const boneNames = new Set(defs.map((d) => d.name));
    const nodes = new Map<string, THREE.Object3D>();
    for (const d of defs) {
      const node = src.getObjectByName(d.name);
      if (!node) throw new Error(`glTF is missing bone ${d.name}`);
      nodes.set(d.name, node);
      rig.addBone(d, node.getWorldPosition(new THREE.Vector3()));
    }
    rig.root.updateMatrixWorld(true);
    for (const d of defs) {
      const node = nodes.get(d.name)!;
      const pivot = rig.bone(d.name);
      for (const child of [...node.children]) {
        if (boneNames.has(child.name)) continue;
        pivot.attach(child);
      }
    }
    return rig;
  }

  worldPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    return this.bones[i].getWorldPosition(out);
  }

  tailWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.tailLocal[i]).applyMatrix4(this.bones[i].matrixWorld);
  }

  /** World position of a point given in rest character space, attached to bone i. */
  attachedPoint(i: number, restPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(restPoint).sub(this.restWorld[i]).applyMatrix4(this.bones[i].matrixWorld);
  }

  update(): void {
    this.root.updateMatrixWorld(true);
  }
}
