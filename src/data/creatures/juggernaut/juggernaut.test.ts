import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCreatureDef, validateCreaturePoses } from '../../types/creatures.ts';

// openspec rig-juggernaut D5: the Juggernaut's rig data names only joints its model has, and covers every joint that moves skin.

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const def = validateCreatureDef(read('./creature.json'), 'data/creatures/juggernaut/creature.json');
const poses = validateCreaturePoses(read('./poses.json'), 'data/creatures/juggernaut/poses.json');

function modelNodes(): string[] {
  const buf = readFileSync(new URL(`../../../../public/${def.model}`, import.meta.url));
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: Array<{ name?: string }> };
  return json.nodes.map((n) => n.name ?? '');
}

const fixture = read('../../../../scripts/fixtures/juggernaut-source.json') as { weighted: string[] };

test('every joint the Juggernaut data names is in its model', () => {
  const nodes = new Set(modelNodes());
  const named = [...Object.values(def.chains).flat(), ...Object.keys(def.limits), def.aimMarker];
  for (const j of named) assert.ok(nodes.has(j!), `"${j}" is a node of ${def.model}`);
});

test('the chains cover exactly the joints that carry skin weight', () => {
  const chained = Object.values(def.chains).flat().sort();
  assert.deepEqual(chained, [...fixture.weighted].sort());
});

test('the exported pose names only rigged joints', () => {
  const rigged = new Set(Object.values(def.chains).flat());
  const exported = poses.poses[def.heightPose]!;
  for (const part of [exported.joints, exported.offsets ?? {}, exported.scales ?? {}]) {
    for (const j of Object.keys(part)) assert.ok(rigged.has(j), `${j} is rigged`);
  }
});

test('left and right limbs are mirror images in the data', () => {
  for (const [l, r] of [['arm.L', 'arm.R'], ['leg.L', 'leg.R']] as const) {
    const pl = def.ik[l].pole;
    const pr = def.ik[r].pole;
    assert.deepEqual([-pl[0], pl[1], pl[2]], pr, `${l} and ${r} poles mirror`);
    def.chains[l]!.forEach((jl, i) => {
      const a = def.limits[jl]!;
      const b = def.limits[def.chains[r]![i]!]!;
      assert.equal(a.kind, b.kind);
      if (a.kind === 'hinge' && b.kind === 'hinge') {
        assert.deepEqual(a.range, b.range);
        assert.ok(Math.abs(a.axis[0] - b.axis[0]) < 1e-3 && Math.abs(a.axis[2] + b.axis[2]) < 1e-3, `${jl} hinge axis mirrors`);
      }
    });
  }
});
