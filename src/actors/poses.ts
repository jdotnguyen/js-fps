import * as THREE from 'three';
import type { PoseFile, PoseStep } from '../data/types/poses.ts';
import { JOINTS } from './skeleton.ts';

const D2R = Math.PI / 180;

/** A pose as quaternions per joint (JOINTS order), ready to slerp. */
export interface CompiledPose {
  name: string;
  joints: THREE.Quaternion[];
  rootRot: THREE.Quaternion;
  rootPos: THREE.Vector3;
  pelvis: THREE.Vector3;
}

export function emptyPose(name = 'rest'): CompiledPose {
  return {
    name,
    joints: JOINTS.map(() => new THREE.Quaternion()),
    rootRot: new THREE.Quaternion(),
    rootPos: new THREE.Vector3(),
    pelvis: new THREE.Vector3(),
  };
}

const euler = new THREE.Euler();
function q(deg: readonly number[] | undefined, out: THREE.Quaternion): THREE.Quaternion {
  if (!deg) return out.identity();
  euler.set((deg[0] ?? 0) * D2R, (deg[1] ?? 0) * D2R, (deg[2] ?? 0) * D2R, 'XYZ');
  return out.setFromEuler(euler);
}

/** Validated data/poses.json compiled once; poses are shared read-only. */
export class PoseLibrary {
  private readonly poses = new Map<string, CompiledPose>();
  private readonly sequences = new Map<string, PoseStep[]>();

  constructor(file: PoseFile) {
    for (const [name, data] of Object.entries(file.poses)) {
      const p = emptyPose(name);
      JOINTS.forEach((j, i) => {
        const target = p.joints[i];
        if (target) q(data.joints[j.name], target);
      });
      q(data.rootRot, p.rootRot);
      if (data.rootPos) p.rootPos.fromArray(data.rootPos);
      if (data.pelvis) p.pelvis.fromArray(data.pelvis);
      this.poses.set(name, p);
    }
    for (const [name, steps] of Object.entries(file.sequences)) this.sequences.set(name, steps);
  }

  has(name: string): boolean {
    return this.poses.has(name);
  }

  get(name: string): CompiledPose {
    const p = this.poses.get(name);
    if (!p) throw new Error(`unknown pose "${name}"`);
    return p;
  }

  sequence(name: string): readonly PoseStep[] {
    const s = this.sequences.get(name);
    if (!s) throw new Error(`unknown pose sequence "${name}"`);
    return s;
  }
}

/** out = slerp(a, b, t) for every channel. `out` may alias `a`. */
export function blendPose(a: CompiledPose, b: CompiledPose, t: number, out: CompiledPose): CompiledPose {
  out.joints.forEach((oq, i) => {
    const qa = a.joints[i];
    const qb = b.joints[i];
    if (qa && qb) oq.slerpQuaternions(qa, qb, t);
  });
  out.rootRot.slerpQuaternions(a.rootRot, b.rootRot, t);
  out.rootPos.lerpVectors(a.rootPos, b.rootPos, t);
  out.pelvis.lerpVectors(a.pelvis, b.pelvis, t);
  return out;
}

export function copyPose(src: CompiledPose, out: CompiledPose): CompiledPose {
  out.joints.forEach((oq, i) => {
    const s = src.joints[i];
    if (s) oq.copy(s);
  });
  out.rootRot.copy(src.rootRot);
  out.rootPos.copy(src.rootPos);
  out.pelvis.copy(src.pelvis);
  return out;
}
