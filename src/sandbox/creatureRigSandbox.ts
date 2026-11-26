import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadJuggernaut } from '../render/fx/juggernaut.ts';
import type { LimbSide } from '../actors/creature/limbIk.ts';
import type { RigJoint } from '../actors/creature/rig.ts';
import type { Role } from '../data/types/creatures.ts';

/**
 * Creature rig sandbox: /sandbox/creature-rig.html (dev server only; openspec rig-juggernaut D10, spec creature-rig "A sandbox
 * shows each creature rig"). The Juggernaut in its neutral pose beside a 1.78 m figure, with:
 *   - gizmo handles for both hands, both feet, the look target and each limb's pole;
 *   - per-joint rotation for any chain, the named poses with a blend time, jaw and tongue sliders;
 *   - the selected joint's limit drawn at the joint, mesh part toggles, pause / step / 0.25x-1x;
 *   - a readout of each solver's remaining distance and the joints resting at a limit.
 * Console: window.creatureRig (rig, juggernaut, scene, camera, orbit, state, handles, select(joint), view("full" | "face" | "faceSide")).
 *   ?view=face|faceSide   start on the face
 */

const D2R = Math.PI / 180;
const LIMBS: LimbSide[] = ['arm.L', 'arm.R', 'leg.L', 'leg.R'];
const LIMB_LABEL: Record<LimbSide, string> = { 'arm.L': 'hand L', 'arm.R': 'hand R', 'leg.L': 'foot L', 'leg.R': 'foot R' };
const PARTS: Record<number, string> = { 3640: 'body', 708: 'eyes', 2968: 'teeth', 323: 'tongue', 2226: 'tongue teeth' };

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f25);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2018, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(6, 12, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor, new THREE.GridHelper(40, 40, 0x56606c, 0x3a414b));
  scene.add(humanFigure(-4.5));

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
  camera.position.set(4, 4.5, 13);
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 2.6, 0);
  orbit.update();

  const juggernaut = await loadJuggernaut(import.meta.env.BASE_URL);
  if (!juggernaut) throw new Error('the Juggernaut did not load');
  const rig = juggernaut.rig;
  scene.add(juggernaut.root);
  juggernaut.root.visible = true;
  rig.setPose(null);
  rig.update(0);

  // Handles: limb targets and poles, the look target.
  const handles = new Map<string, THREE.Mesh>();
  const handle = (name: string, color: number, at: THREE.Vector3, r = 0.09) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
    m.renderOrder = 10;
    m.position.copy(at);
    m.name = name;
    scene.add(m);
    handles.set(name, m);
    return m;
  };
  const enabled: Record<string, boolean> = { look: false };
  for (const side of LIMBS) {
    const limb = rig.limb(side);
    handle(side, side.startsWith('arm') ? 0x46c8ff : 0xffb84a, limb.contactPoint(new THREE.Vector3()));
    const mid = limb.hinges[0]!.bone.getWorldPosition(new THREE.Vector3());
    const pole = new THREE.Vector3(...rig.def.ik[side].pole).applyQuaternion(juggernaut.root.quaternion);
    handle(`${side} pole`, 0x9b7bff, mid.addScaledVector(pole, 1.2), 0.06);
    enabled[side] = false;
  }
  const head = rig.joint('head_09');
  handle('look', 0xff5a7a, head.bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.5, 6)), 0.12);

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(0.8);
  gizmo.addEventListener('dragging-changed', (e) => (orbit.enabled = !(e as unknown as { value: boolean }).value));
  scene.add(gizmo.getHelper());

  // Limit drawing for the selected joint.
  let selected: RigJoint | null = null;
  let limitGroup: THREE.Group | null = null;
  const showLimit = { on: true };
  const drawLimit = () => {
    limitGroup?.removeFromParent();
    limitGroup = null;
    if (!selected || !showLimit.on) return;
    limitGroup = limitHelper(selected);
    selected.bone.parent!.add(limitGroup);
  };

  const state = { paused: false, speed: 1, stepOnce: false };
  const panel = document.querySelector<HTMLElement>('#panel')!;
  panel.innerHTML = `
    <h3>Drag</h3>
    <div class="row" id="dragRow"></div>
    <h3>Targets on</h3>
    <div class="row" id="enableRow"></div>
    <h3>Pose</h3>
    <div class="row"><select id="pose"></select><input id="blend" type="number" min="0" max="5" step="0.1" value="0.5" style="width:52px"> s <button id="blendGo">Blend</button></div>
    <h3>Face</h3>
    <label>jaw <input id="jaw" type="range" min="0" max="1" step="0.01" value="0"></label>
    <label>tongue out <input id="tongueExtend" type="range" min="0" max="1" step="0.01" value="0"></label>
    <label>tongue curl <input id="tongueCurl" type="range" min="0" max="1" step="0.01" value="0"></label>
    <h3>Rotate a joint</h3>
    <div class="row"><select id="role"></select><select id="joint"></select></div>
    <label>x <input id="rx" type="range" min="-90" max="90" step="1" value="0"><span id="rxv">0</span></label>
    <label>y <input id="ry" type="range" min="-90" max="90" step="1" value="0"><span id="ryv">0</span></label>
    <label>z <input id="rz" type="range" min="-90" max="90" step="1" value="0"><span id="rzv">0</span></label>
    <div class="row"><button id="resetJoint">Reset joint</button><button id="resetAll">Reset all</button><label><input id="showLimit" type="checkbox" checked> limit</label></div>
    <h3>Parts</h3>
    <div class="row" id="parts"></div>
    <h3>Walk and act</h3>
    <div class="row"><button id="walk">Walk to look handle</button><input id="walkSpeed" type="number" min="0.2" max="3" step="0.1" value="0.9" style="width:52px"> m/s</div>
    <div class="row"><select id="sequence"></select><button id="act">Play</button><button id="still">Stand still</button></div>
    <h3>Time</h3>
    <div class="row"><button id="pause">Pause</button><button id="step">Step</button><select id="speed"><option>1</option><option>0.5</option><option>0.25</option></select>x</div>`;
  const $ = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;

  // Drag and enable rows.
  const dragRow = $('dragRow');
  for (const name of ['none', ...handles.keys()]) {
    const b = document.createElement('button');
    b.textContent = name === 'none' ? 'none' : (LIMB_LABEL[name as LimbSide] ?? name.replace(/^(arm|leg)\.(L|R) pole$/, (_, l, s) => `${l} ${s} pole`));
    b.onclick = () => {
      const h = handles.get(name);
      if (h) gizmo.attach(h);
      else gizmo.detach();
    };
    dragRow.appendChild(b);
  }
  const enableRow = $('enableRow');
  for (const name of [...LIMBS, 'look']) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox"> ${LIMB_LABEL[name as LimbSide] ?? name}`;
    const box = l.querySelector('input')!;
    box.onchange = () => (enabled[name] = box.checked);
    enableRow.appendChild(l);
  }
  // Poses.
  const poseSel = $<HTMLSelectElement>('pose');
  for (const n of ['(neutral)', ...rig.poseNames()]) poseSel.add(new Option(n, n));
  $('blendGo').onclick = () => rig.setPose(poseSel.value === '(neutral)' ? null : poseSel.value, Number($<HTMLInputElement>('blend').value));
  // Face.
  for (const k of ['jaw', 'tongueExtend', 'tongueCurl'] as const) {
    const input = $<HTMLInputElement>(k);
    input.oninput = () => rig.setFace({ [k]: Number(input.value) });
  }
  // Joint rotation.
  const roleSel = $<HTMLSelectElement>('role');
  const jointSel = $<HTMLSelectElement>('joint');
  for (const r of Object.keys(rig.def.chains)) roleSel.add(new Option(r, r));
  const axes = ['rx', 'ry', 'rz'].map((id) => $<HTMLInputElement>(id));
  const syncSliders = () => {
    const q = selected ? rig.getAdjustment(selected.name) : null;
    const e = new THREE.Euler().setFromQuaternion(q ?? new THREE.Quaternion(), 'XYZ');
    [e.x, e.y, e.z].forEach((a, i) => {
      axes[i]!.value = String(Math.round(a / D2R));
      $(`${axes[i]!.id}v`).textContent = axes[i]!.value;
    });
  };
  const select = (name: string) => {
    selected = rig.joint(name);
    jointSel.value = name;
    syncSliders();
    drawLimit();
  };
  const fillJoints = () => {
    jointSel.innerHTML = '';
    for (const j of rig.chain(roleSel.value as Role)) jointSel.add(new Option(j.name, j.name));
    select(jointSel.value);
  };
  roleSel.onchange = fillJoints;
  jointSel.onchange = () => select(jointSel.value);
  for (const input of axes) {
    input.oninput = () => {
      if (!selected) return;
      $(`${input.id}v`).textContent = input.value;
      const [x, y, z] = axes.map((a) => Number(a.value) * D2R);
      rig.setAdjustment(selected.name, x || y || z ? new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')) : null);
    };
  }
  $('resetJoint').onclick = () => {
    if (selected) rig.setAdjustment(selected.name, null);
    syncSliders();
  };
  $('resetAll').onclick = () => {
    rig.clearAdjustments();
    syncSliders();
  };
  $<HTMLInputElement>('showLimit').onchange = (e) => {
    showLimit.on = (e.target as HTMLInputElement).checked;
    drawLimit();
  };
  roleSel.value = 'arm.L';
  fillJoints();
  // Parts.
  const parts = $('parts');
  juggernaut.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const label = PARTS[o.geometry.attributes.position!.count] ?? o.name;
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" checked> ${label}`;
    l.querySelector('input')!.onchange = (e) => (o.visible = (e.target as HTMLInputElement).checked);
    parts.appendChild(l);
  });
  // Walk and act: the creature's gait and key-pose sequences (openspec juggernaut-walk-and-roar). Its footfalls are counted.
  const motion = { on: false, footfalls: 0 };
  juggernaut.onFootfall = () => void motion.footfalls++;
  const seqSel = $<HTMLSelectElement>('sequence');
  for (const n of juggernaut.acts.names()) seqSel.add(new Option(n, n));
  const startMotion = () => {
    if (motion.on) return;
    motion.on = true;
    const p = juggernaut.root.position;
    juggernaut.gait.placeAt(new THREE.Vector3(p.x, 0, p.z), juggernaut.root.rotation.y);
  };
  $('walk').onclick = () => {
    startMotion();
    const to = handles.get('look')!.position;
    const from = new THREE.Vector3(juggernaut.root.position.x, 0, juggernaut.root.position.z);
    const dest = new THREE.Vector3(to.x, 0, to.z);
    // Stop a body-length short of the handle, facing it.
    const along = dest.clone().sub(from);
    const len = along.length() - 3;
    if (len > 0.3) juggernaut.gait.walk([from, from.clone().addScaledVector(along.normalize(), len)], Number($<HTMLInputElement>('walkSpeed').value));
  };
  $('act').onclick = () => {
    startMotion();
    juggernaut.act(seqSel.value);
  };
  $('still').onclick = () => {
    juggernaut.acts.stop();
    motion.on = false;
    for (const side of LIMBS) rig.setLimbTarget(side, null);
  };

  // Time.
  $('pause').onclick = () => {
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? 'Play' : 'Pause';
  };
  $('step').onclick = () => (state.stepOnce = true);
  $<HTMLSelectElement>('speed').onchange = (e) => (state.speed = Number((e.target as HTMLSelectElement).value));

  // Each frame: feed the handles to the rig, evaluate, report.
  const readout = document.querySelector<HTMLElement>('#readout')!;
  const clock = new THREE.Clock();
  let sinceReadout = 0;
  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const real = Math.min(0.1, clock.getDelta());
    let dt = state.paused ? 0 : real * state.speed;
    if (state.stepOnce) {
      dt = 1 / 30;
      state.stepOnce = false;
    }
    rig.setLookTarget(enabled['look'] ? handles.get('look')!.position : null);
    if (motion.on) {
      // Walking or acting: the gait owns the limb targets (openspec juggernaut-walk-and-roar).
      juggernaut.acts.update(dt);
      juggernaut.gait.update(dt);
    } else {
      for (const side of LIMBS) {
        const limb = rig.limb(side);
        const mid = limb.hinges[0]!.bone.getWorldPosition(tmp);
        const pole = handles.get(`${side} pole`)!.position.clone().sub(mid);
        rig.setLimbTarget(side, enabled[side] ? handles.get(side)!.position : null, pole.lengthSq() > 1e-6 ? { pole } : {});
      }
    }
    rig.update(dt);
    orbit.update();
    renderer.render(scene, camera);
    sinceReadout += real;
    if (sinceReadout > 0.15) {
      sinceReadout = 0;
      readout.textContent = report();
    }
  });

  function report(): string {
    const base = rig.basePose;
    const lines = [`pose ${base.name ?? '(neutral)'} ${(base.progress * 100).toFixed(0)}%   face jaw ${rig.getFace().jaw.toFixed(2)} out ${rig.getFace().tongueExtend.toFixed(2)} curl ${rig.getFace().tongueCurl.toFixed(2)}`];
    for (const side of LIMBS) {
      const limb = rig.limb(side);
      lines.push(`${LIMB_LABEL[side].padEnd(7)} ${limb.hasTarget ? `${(limb.lastError * 100).toFixed(1)} cm to target` : 'off'}`);
    }
    lines.push(`walk    ${motion.on ? (juggernaut!.gait.walking ? 'walking' : 'standing') : 'off (handles drive the limbs)'}, ${motion.footfalls} footfalls; act ${juggernaut!.acts.playing ?? '-'}`);
    lines.push(`look    ${rig.lookAt.hasTarget ? `head ${(rig.lookAt.error(head) / D2R).toFixed(1)} deg off` : 'off'}`);
    const atLimit = rig.jointsAtLimit().map((j) => j.name);
    lines.push(`at a limit (${atLimit.length}): ${atLimit.join(', ') || '-'}`);
    if (selected) lines.push(`selected ${selected.name} (${selected.limit.kind})`);
    return lines.join('\n');
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  /** Camera presets: the whole creature, or its face from the front or the side. */
  const view = (name: 'full' | 'face' | 'faceSide') => {
    const h = head.bone.getWorldPosition(new THREE.Vector3());
    if (name === 'full') {
      camera.position.set(4, 4.5, 13);
      orbit.target.set(0, 2.6, 0);
    } else {
      orbit.target.copy(h).add(new THREE.Vector3(0, -0.45, 0.6));
      camera.position.copy(h).add(name === 'face' ? new THREE.Vector3(0.9, -0.5, 3.4) : new THREE.Vector3(3.2, -0.3, 1.2));
    }
    orbit.update();
  };
  const v = new URLSearchParams(location.search).get('view');
  if (v === 'face' || v === 'faceSide') view(v);
  (window as unknown as { creatureRig: unknown }).creatureRig = { rig, juggernaut, scene, camera, orbit, renderer, state, motion, handles, enabled, select, view };
}

/** A 1.78 m stand-in for scale. */
function humanFigure(x: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8aa0b8, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 6, 12), mat);
  body.position.y = 0.22 + 0.55 + 0.02;
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat);
  headMesh.position.y = 1.78 - 0.12;
  for (const m of [body, headMesh]) m.castShadow = true;
  g.add(body, headMesh);
  g.position.x = x;
  return g;
}

/** Lines showing a joint's limit, in its parent's frame at the joint: a hinge's arc or a ball joint's cone. */
function limitHelper(j: RigJoint): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(j.neutralT);
  g.quaternion.copy(j.neutralQ);
  const child = j.bone.children.find((c) => (c as THREE.Bone).isBone);
  const len = Math.max(0.2, child ? child.position.length() : 1);
  const lim = j.limit;
  const pts: THREE.Vector3[] = [];
  if (lim.kind === 'hinge') {
    const n = 24;
    const base = child ? child.position.clone().normalize().multiplyScalar(len) : new THREE.Vector3(0, len, 0);
    pts.push(new THREE.Vector3());
    for (let i = 0; i <= n; i++) {
      const a = lim.twist[0] + ((lim.twist[1] - lim.twist[0]) * i) / n;
      pts.push(base.clone().applyAxisAngle(lim.axis, a));
    }
    pts.push(new THREE.Vector3());
  } else {
    const n = 32;
    const axisDir = lim.axis.clone();
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const su = lim.cone[0] * Math.cos(t);
      const sv = lim.cone[1] * Math.sin(t);
      const ang = Math.hypot(su, sv);
      const ax = lim.u.clone().multiplyScalar(su).addScaledVector(lim.v, sv).normalize();
      const q = ang > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(ax, ang) : new THREE.Quaternion();
      const p = axisDir.clone().applyQuaternion(q).multiplyScalar(len);
      if (i % 4 === 0) pts.push(new THREE.Vector3(), p.clone());
      pts.push(p);
    }
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7dffb0, depthTest: false }));
  line.renderOrder = 11;
  g.add(line);
  return g;
}

void boot();
