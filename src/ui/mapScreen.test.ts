import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from './mapScreen.ts';

test('map view: fit, round trip, zoom keeps the point under the cursor, clamps', () => {
  const v = new MapView();
  v.width = 800;
  v.height = 600;
  v.fit({ x0: -10, z0: -10, x1: 10, z1: 10 });
  assert.deepEqual(v.toScreen(0, 0), [400, 300]);
  const [wx, wz] = v.toWorld(123, 456);
  const back = v.toScreen(wx, wz);
  assert.ok(Math.abs(back[0] - 123) < 1e-9 && Math.abs(back[1] - 456) < 1e-9);
  const before = v.toWorld(100, 100);
  v.zoomAt(2, 100, 100);
  const after = v.toWorld(100, 100);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  for (let i = 0; i < 20; i++) v.zoomAt(2);
  assert.equal(v.zoom, 5);
  const cx = v.cx;
  v.pan(v.scale * 3, 0);
  assert.ok(Math.abs(v.cx - (cx - 3)) < 1e-9, 'dragging 3 m of pixels right moves the view 3 m left');
});
