'use strict';
const Game = {
  mode: 'build',
  init() {
    Builder.init(); Flight.init();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    Builder.fit();
    let last = performance.now();
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      if (this.mode === 'build') Builder.render();
      else { Flight.update(dt); Flight.render(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = (canvas, target) => {
      const r = canvas.parentElement.getBoundingClientRect();
      const W = Math.max(50, Math.floor(r.width)), H = Math.max(50, Math.floor(r.height));
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      target.resize(W, H);
    };
    if (this.mode === 'build') fit(Builder.canvas, Builder); else fit(Flight.canvas, Flight);
  },
  startFlight(design) {
    this.mode = 'flight';
    document.getElementById('build').classList.add('hidden');
    document.getElementById('flight').classList.remove('hidden');
    this.resize();
    Flight.start(design);
  },
  toBuild() {
    this.mode = 'build';
    document.getElementById('flight').classList.add('hidden');
    document.getElementById('build').classList.remove('hidden');
    this.resize();
  },
};
window.addEventListener('DOMContentLoaded', () => Game.init());
