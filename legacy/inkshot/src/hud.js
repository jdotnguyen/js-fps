const $ = (id) => document.getElementById(id);

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.overlay = $('overlay');
    this.title = $('overlay-title');
    this.sub = $('overlay-sub');
    this.playBtn = $('play');
    this.waveEl = $('wave');
    this.scoreEl = $('score');
    this.healthFill = $('health-fill');
    this.weaponEl = $('weapon-name');
    this.ammoEl = $('ammo');
    this.hitEl = $('hitmarker');
    this.vignette = $('vignette');
    this.messageEl = $('message');
  }

  setWave(n) { this.waveEl.textContent = n; }
  setScore(n) { this.scoreEl.textContent = n.toLocaleString(); }

  setHealth(hp) {
    const v = Math.max(0, Math.min(100, hp));
    this.healthFill.style.width = `${v}%`;
    this.healthFill.style.background = v > 50 ? '#4ade80' : v > 25 ? '#ffd23f' : '#ff4d6d';
  }

  setWeapon(name, ammo, mag, reloading = false) {
    this.weaponEl.textContent = name;
    this.ammoEl.textContent = reloading ? 'RELOAD' : `${ammo} / ${mag}`;
  }

  hitMarker(kill = false) {
    this.hitEl.classList.toggle('kill', kill);
    replay(this.hitEl, 'show');
  }

  hurt() { replay(this.vignette, 'show'); }

  message(text) {
    this.messageEl.textContent = text;
    replay(this.messageEl, 'show');
  }

  showOverlay(title, sub, button) {
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.playBtn.textContent = button;
    this.overlay.hidden = false;
  }

  hideOverlay() { this.overlay.hidden = true; }
  showHud(on) { this.root.hidden = !on; }
}
