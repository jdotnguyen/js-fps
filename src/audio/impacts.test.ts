import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { IMPACT_MANIFEST, impactUrls, type ImpactBank } from '../../scripts/impacts-generate.ts';
import { IMPACT_MIN_SPEED, IMPACT_RANGE, IMPACT_VOICES, ImpactAudio, impactSound, type Impact } from './impacts.ts';
import { SAMPLE_URLS } from './sounds.ts';

// adopt-physics-engine D16: what a hit sounds like, and how a pile of them is kept in hand.

function rig() {
  const played: Array<{ name: string; gain: number; stopped: boolean }> = [];
  let time = 0;
  const audio = new ImpactAudio({
    audio: {
      hasSound: () => true,
      variantCount: () => 4,
      play: (name, opts) => {
        const p = { name: String(name), gain: opts?.gain ?? 1, stopped: false };
        played.push(p);
        return { stop: () => void (p.stopped = true) };
      },
    },
    listener: () => new THREE.Vector3(),
    now: () => time,
  });
  const hit = (over: Partial<Impact> = {}) => audio.play({ id: 'a', material: 'glass', x: 1, y: 0, z: 0, speed: 1, ...over });
  return { audio, played, hit, wait: (s: number) => void (time += s) };
}

test('soft changes are silent, harder hits are louder, and a hard one uses the crash recording', () => {
  assert.equal(impactSound('glass', IMPACT_MIN_SPEED - 0.01), null);
  assert.ok(impactSound('metal', 2.5)!.gain > impactSound('metal', 0.8)!.gain);
  assert.equal(impactSound('cart', 0.8)!.sound, 'propCartKnock');
  assert.equal(impactSound('cart', 1.7)!.sound, 'propCartKnock', 'the shove');
  assert.equal(impactSound('cart', 2.6)!.sound, 'propCartCrash', 'the landing');
  assert.equal(impactSound('glass', 1)!.sound, 'propGlass');
  assert.equal(impactSound('glass', 4)!.sound, 'propGlassHard');
  assert.equal(impactSound('flesh', 3)!.sound, 'limbThud');
});

// livelier-cart-slam D7, medbay-attack "Instruments sound where they land".
test('the kidney dish clinks when nudged and spins down when it lands hard, once', () => {
  assert.equal(impactSound('dish', 0.9)!.sound, 'propMetal');
  const hard = impactSound('dish', 3)!;
  assert.equal(hard.sound, 'propDishSpin');
  assert.ok(hard.hard && hard.rest >= 2.5, 'its bounces do not cut the spin off');
  const r = rig();
  assert.equal(r.hit({ id: 'dish', material: 'dish', speed: 3 }), 'propDishSpin');
  assert.equal(r.hit({ id: 'dish', material: 'dish', speed: 2 }), null, 'a bounce straight after');
  r.wait(1);
  assert.equal(r.hit({ id: 'dish', material: 'dish', speed: 2 }), null, 'still spinning');
});

test('one thing rests between its sounds, but a crash cuts through the rest after a tap', () => {
  const r = rig();
  assert.equal(r.hit({ material: 'cart', speed: 0.8 }), 'propCartKnock');
  assert.equal(r.hit({ material: 'cart', speed: 0.9 }), null, 'another tap straight away');
  assert.equal(r.hit({ material: 'cart', speed: 2.6 }), 'propCartCrash', 'the crash is heard');
  assert.equal(r.hit({ material: 'cart', speed: 2.6 }), null, 'its bounces are not');
  r.wait(1.1);
  assert.equal(r.hit({ material: 'cart', speed: 2.6 }), 'propCartCrash');
});

test('only a few play at once, and taps are dropped before the crash', () => {
  const r = rig();
  r.hit({ id: 'cart', material: 'cart', speed: 2.6 });
  for (let i = 0; i < IMPACT_VOICES + 3; i++) r.hit({ id: `item${i}` });
  assert.equal(r.played.filter((p) => !p.stopped).length, IMPACT_VOICES);
  assert.equal(r.played[0]!.stopped, false, 'the cart crash is still playing');
});

test('far hits are silent, and stopping silences what is playing', () => {
  const r = rig();
  assert.equal(r.hit({ x: IMPACT_RANGE + 1 }), null);
  r.hit();
  r.audio.stopAll();
  assert.ok(r.played.every((p) => p.stopped));
});

test('every impact bank is registered from the build manifest, with its clips on disk', () => {
  for (const [bank, urls] of Object.entries(impactUrls())) {
    assert.deepEqual([...SAMPLE_URLS[bank as ImpactBank]], urls, bank);
    for (const u of urls) assert.ok(existsSync(new URL(`../../public/${u}`, import.meta.url)), u);
  }
  assert.equal(new Set(IMPACT_MANIFEST.map((s) => s.id)).size, IMPACT_MANIFEST.length);
});
