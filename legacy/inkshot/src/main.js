import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player } from './player.js';
import { Arsenal } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';

const SKY = 0x9bd8ff;
const BEST_KEY = 'inkshot-best';

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* storage unavailable: best score just won't persist */
  }
}

function start() {
  const canvas = document.getElementById('game');
  const hud = new Hud();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    hud.showOverlay('NO WEBGL', 'This browser could not start WebGL.', 'RETRY');
    hud.playBtn.addEventListener('click', () => location.reload());
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(SKY);
  renderer.shadowMap.enabled = true;
  renderer.autoClear = false; // two passes per frame: world, then weapon

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 45, 120);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a9e7e, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4d6, 2.4);
  sun.position.set(25, 40, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const level = buildLevel(scene);
  const effects = new Effects(scene);
  const sfx = new Sfx();
  const player = new Player(camera);
  const arsenal = new Arsenal(window.innerWidth / window.innerHeight);
  const enemies = new EnemyManager(scene, level, effects);

  const game = {
    scene, camera, level, effects, sfx, hud, player, arsenal, enemies,
    state: 'menu', // menu | playing | paused | dead
    score: 0,
    best: loadBest(),

    addScore(n) {
      this.score += n;
      hud.setScore(this.score);
    },
    heal(n) {
      player.health = Math.min(100, player.health + n);
      hud.setHealth(player.health);
    },
    damagePlayer(n) {
      if (this.state !== 'playing') return;
      player.health -= n;
      hud.setHealth(player.health);
      hud.hurt();
      sfx.hurt();
      if (player.health <= 0) die();
    },
    onWaveStart(n) {
      hud.setWave(n);
      hud.message(`WAVE ${n}`);
      sfx.wave();
    },
    onWaveCleared(n) {
      hud.message('WAVE CLEARED!');
      this.addScore(n * 50);
      this.heal(15);
    },
  };
  window.__game = game; // handy for poking at state from devtools

  // --- state transitions ---
  let everLocked = false;
  let fallbackLook = false; // pointer lock unavailable: look with plain mouse movement

  function reset() {
    game.score = 0;
    player.reset();
    arsenal.reset();
    enemies.reset();
    effects.clear();
    hud.setScore(0);
    hud.setWave(1);
    hud.setHealth(100);
    arsenal.refreshHud(game);
  }

  function resume() {
    game.state = 'playing';
    hud.hideOverlay();
    hud.showHud(true);
  }

  function pause() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    arsenal.release();
    player.keys.clear();
    hud.showOverlay('PAUSED', 'Take a breather.', 'RESUME');
  }

  function die() {
    game.state = 'dead';
    arsenal.release();
    player.keys.clear();
    sfx.gameOver();
    if (game.score > game.best) {
      game.best = game.score;
      saveBest(game.best);
    }
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showHud(false);
    hud.showOverlay(
      'WIPED OUT',
      `Score ${game.score.toLocaleString()} · Wave ${enemies.wave} · Best ${game.best.toLocaleString()}`,
      'PLAY AGAIN',
    );
  }

  function lockFailed() {
    if (everLocked || game.state === 'playing') return;
    fallbackLook = true;
    resume();
  }

  hud.playBtn.addEventListener('click', () => {
    hud.playBtn.blur();
    sfx.init();
    if (game.state === 'menu' || game.state === 'dead') {
      reset();
      game.state = 'paused';
    }
    if (fallbackLook) {
      resume();
      return;
    }
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(lockFailed);
    } catch {
      lockFailed();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      everLocked = true;
      fallbackLook = false;
      if (game.state === 'paused') resume();
    } else {
      pause();
    }
  });
  document.addEventListener('pointerlockerror', lockFailed);
  window.addEventListener('blur', () => {
    if (fallbackLook) pause();
  });

  // --- input ---
  document.addEventListener('mousemove', (e) => {
    if (game.state !== 'playing') return;
    if (document.pointerLockElement === canvas || fallbackLook) player.look(e.movementX, e.movementY);
  });
  document.addEventListener('mousedown', (e) => {
    if (game.state === 'playing' && e.button === 0) arsenal.press();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) arsenal.release();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('wheel', (e) => {
    if (game.state === 'playing') arsenal.cycle(e.deltaY > 0 ? 1 : -1, game);
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (game.state !== 'playing') return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    player.keys.add(e.code);
    if (e.code === 'KeyR') arsenal.reload(game);
    else if (e.code === 'Digit1') arsenal.switchTo(0, game);
    else if (e.code === 'Digit2') arsenal.switchTo(1, game);
    else if (e.code === 'Escape' && fallbackLook) pause();
  });
  window.addEventListener('keyup', (e) => player.keys.delete(e.code));

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    arsenal.resize(w / h);
  });

  // --- loop ---
  hud.showOverlay('INKSHOT', game.best ? `Survive the waves. Best: ${game.best.toLocaleString()}` : 'Survive the waves.', 'PLAY');
  let last = performance.now();
  let orbit = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (game.state === 'playing') {
      player.update(dt, level.colliders);
      arsenal.update(dt, game);
      enemies.update(dt, game);
      effects.update(dt);
      if (game.state === 'playing') player.sync(); // pick up recoil this frame
    } else if (game.state === 'menu' || game.state === 'dead') {
      // Slow fly-around behind the menu.
      orbit += dt * 0.12;
      camera.position.set(Math.sin(orbit) * 26, 11, Math.cos(orbit) * 26);
      camera.lookAt(0, 1.5, 0);
      effects.update(dt);
    }

    renderer.clear();
    renderer.render(scene, camera);
    if (game.state === 'playing' || game.state === 'paused') {
      renderer.clearDepth();
      renderer.render(arsenal.scene, arsenal.camera);
    }
  }
  requestAnimationFrame(frame);
}

start();
