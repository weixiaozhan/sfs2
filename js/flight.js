'use strict';
// 飞行界面：输入、时间加速、分级、任务、渲染
const WARPS = [1, 2, 4, 10, 100, 1000, 10000, 100000, 1000000], PHYS_MAX = 2;
const $ = (id) => document.getElementById(id);

function hash01(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

const Flight = {
  vessel: null, debris: [], particles: [], t: 0, warpIdx: 0, stages: [], stageIdx: 0,
  cam: { scale: 10, ox: 0, oy: 0 }, keys: {}, touchRot: 0, W: 0, H: 0, pred: [], predAge: 99, flags: {}, over: false,
  missionsDone: {}, stars: [],

  init() {
    this.canvas = $('flightCanvas'); this.ctx = this.canvas.getContext('2d');
    this.navCtx = $('nav').getContext('2d');
    for (let i = 0; i < 260; i++) this.stars.push([hash01(i * 3 + 1), hash01(i * 3 + 2), 0.3 + 0.7 * hash01(i * 3 + 3)]);
    try { this.missionsDone = JSON.parse(localStorage.getItem('of_missions') || '{}') || {}; } catch (e) { this.missionsDone = {}; }
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => { this.keys = {}; });
    // 画布：拖动平移 / 捏合缩放 / 点击部件
    const c = this.canvas, ptrs = new Map();
    let moved = 0, pinch = 0;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; });
    c.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      p[0] = e.clientX; p[1] = e.clientY;
      if (ptrs.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6) { this.cam.ox -= dx / this.cam.scale; this.cam.oy += dy / this.cam.scale; }
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoom(d / pinch);
        pinch = d; moved = 99;
      }
    });
    const end = (e) => {
      if (ptrs.has(e.pointerId) && ptrs.size === 1 && moved <= 6 && e.type === 'pointerup') this.click(e.offsetX, e.offsetY);
      ptrs.delete(e.pointerId); pinch = 0;
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18); }, { passive: false });
    // 按钮
    $('stageBtn').onclick = () => this.doStage();
    $('thrMax').onclick = () => this.setThrottle(1);
    $('thrCut').onclick = () => this.setThrottle(0);
    $('warpUp').onclick = () => this.setWarp(this.warpIdx + 1);
    $('warpDown').onclick = () => this.setWarp(this.warpIdx - 1);
    $('mapBtn').onclick = () => this.toggleMap();
    $('centerBtn').onclick = () => { this.cam.ox = 0; this.cam.oy = 0; };
    $('missionBtn').onclick = () => { $('missions').classList.toggle('hidden'); $('help').classList.add('hidden'); };
    $('helpBtn').onclick = () => { $('help').classList.toggle('hidden'); $('missions').classList.add('hidden'); };
    $('revertBtn').onclick = $('ovRetry').onclick = () => this.start(this.design);
    $('backBtn').onclick = $('ovBuild').onclick = () => Game.toBuild();
    $('ovClose').onclick = () => $('overlay').classList.add('hidden');
    const hold = (id, val) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); this.touchRot = val; });
      const up = () => { if (this.touchRot === val) this.touchRot = 0; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    };
    hold('rotL', 1); hold('rotR', -1);
    const bar = $('thrBar');
    const setFromBar = (e) => { const r = bar.getBoundingClientRect(); this.setThrottle(1 - (e.clientY - r.top) / r.height); };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); bar._d = true; setFromBar(e); });
    bar.addEventListener('pointermove', (e) => { if (bar._d) setFromBar(e); });
    bar.addEventListener('pointerup', () => { bar._d = false; });
    this.renderMissions();
  },

  resize(W, H) { this.W = W; this.H = H; },

  start(design) {
    this.design = design;
    const parts = instantiate(design);
    this.stages = buildStages(parts); this.stageIdx = 0;
    const v = new Vessel(parts, 'aeria');
    v.placeOnSurface(Math.PI / 2);
    this.vessel = v; this.debris = []; this.particles = []; this.t = 0; this.warpIdx = 0;
    this.keys = {}; this.touchRot = 0; this.pred = []; this.predAge = 99; this.over = false;
    this.flags = { launched: false, space: false, seloLanded: false };
    const hgt = v.bounds.maxY - v.bounds.minY;
    this.cam = { scale: Math.max(3, Math.min(16, this.H * 0.5 / hgt)), ox: 0, oy: 0 };
    this.closeScale = this.cam.scale; this.mapMode = false;
    $('overlay').classList.add('hidden');
    $('toasts').innerHTML = '';
    this.renderStages();
    this.toast('按 空格 点火起飞');
  },

  // ---------- 输入 ----------
  key(e, down) {
    if (Game.mode !== 'flight') return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys[k] = down;
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    if (!down || e.repeat) return;
    if (k === ' ') this.doStage();
    else if (k === 'z') this.setThrottle(1);
    else if (k === 'x') this.setThrottle(0);
    else if (k === '.' || k === '>') this.setWarp(this.warpIdx + 1);
    else if (k === ',' || k === '<') this.setWarp(this.warpIdx - 1);
    else if (k === '/') this.setWarp(0);
    else if (k === 'm') this.toggleMap();
    else if (k === 'r') this.start(this.design);
    else if (k === 'Escape') Game.toBuild();
  },
  rot() {
    const k = this.keys;
    return (k.a || k.ArrowLeft ? 1 : 0) - (k.d || k.ArrowRight ? 1 : 0) + this.touchRot;
  },
  setThrottle(x) {
    const v = this.vessel; if (!v || v.destroyed) return;
    v.throttle = Math.max(0, Math.min(1, x));
    if (v.throttle > 0 && this.warpIdx > PHYS_MAX && v.isThrusting()) this.setWarp(0);
  },
  zoom(f) {
    this.cam.scale = Math.max(2e-9, Math.min(60, this.cam.scale * f));
  },
  toggleMap() {
    const v = this.vessel, b = BODIES[v.body];
    if (!this.mapMode) {
      this.closeScale = this.cam.scale;
      const r = Math.hypot(v.pos.x, v.pos.y);
      let ext = Math.max(r, b.radius * 1.5);
      if (!v.landed) { const el = orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu); if (el.ra < b.soi) ext = Math.max(ext, el.ra); }
      this.cam.scale = Math.min(this.W, this.H) / (2.8 * ext);
      this.mapMode = true;
    } else { this.cam.scale = Math.min(this.closeScale, 60); this.cam.ox = 0; this.cam.oy = 0; this.mapMode = false; }
  },
  railThreshold(bodyId) { const b = BODIES[bodyId]; return b.radius + (b.atmo ? b.atmo.height : 2000); },
  canRail() {
    const v = this.vessel;
    if (v.landed) return null;
    if (v.isThrusting()) return '发动机工作时最高 4× 加速';
    if (Math.hypot(v.pos.x, v.pos.y) < this.railThreshold(v.body) + 50) return BODIES[v.body].atmo ? '在大气层内最高 4× 加速' : '离地面太近，最高 4× 加速';
    return null;
  },
  setWarp(i, quiet) {
    i = Math.max(0, Math.min(WARPS.length - 1, i));
    if (i > PHYS_MAX) { const why = this.canRail(); if (why) { if (!quiet && i > this.warpIdx) this.toast(why); i = Math.min(this.warpIdx, PHYS_MAX); } }
    this.warpIdx = i;
  },
  click(sx, sy) {
    const v = this.vessel; if (!v || v.destroyed) return;
    const s = this.cam.scale;
    const wx = v.pos.x + this.cam.ox + (sx - this.W / 2) / s, wy = v.pos.y + this.cam.oy - (sy - this.H / 2) / s;
    const l = v.worldToLocal(wx, wy);
    const p = v.parts.find((q) => l.x >= q.x && l.x < q.x + q.w && l.y >= q.y && l.y < q.y + q.h);
    if (!p) return;
    if (p.def.thrust) {
      if (p.def.srb) { if (!p.on) { p.on = true; this.toast('固推点火'); } }
      else { p.on = !p.on; this.toast(p.def.name + (p.on ? ' 已开启' : ' 已关闭')); }
    } else if (p.def.decoupler) this.fireDecouplers([p.id]);
    else if (p.def.chute) this.deployChutes([p.id]);
  },

  // ---------- 分级 ----------
  fireDecouplers(ids) {
    const v = this.vessel;
    if (!v.parts.some((p) => ids.includes(p.id))) return false;
    v.parts = v.parts.filter((p) => !ids.includes(p.id));
    const deb = splitVessel(v);
    this.debris.push(...deb);
    while (this.debris.length > 14) this.debris.shift();
    this.predAge = 99;
    return true;
  },
  deployChutes(ids) {
    const v = this.vessel, b = BODIES[v.body];
    const list = v.parts.filter((p) => ids.includes(p.id) && p.def.chute && !p.deployed);
    if (!list.length) return false;
    if (atmoDensity(b, Math.hypot(v.pos.x, v.pos.y) - b.radius) <= 0) { this.toast('这里没有空气，降落伞无法展开'); return false; }
    for (const p of list) p.deployed = true;
    this.toast('降落伞已展开');
    return true;
  },
  doStage() {
    const v = this.vessel; if (!v || v.destroyed) return;
    while (this.stageIdx < this.stages.length) {
      const st = this.stages[this.stageIdx];
      const has = (ids) => v.parts.some((p) => ids.includes(p.id));
      if (st.chutes.length) {
        if (!has(st.chutes)) { this.stageIdx++; continue; }
        if (this.deployChutes(st.chutes)) this.stageIdx++;
        break;
      }
      let did = false;
      if (st.decouple.length) did = this.fireDecouplers(st.decouple) || did;
      let lit = 0;
      for (const p of v.parts) if (st.ignite.includes(p.id) && !p.on) { p.on = true; lit++; }
      this.stageIdx++;
      if (lit) { did = true; if (v.landed && v.throttle === 0) v.throttle = 1; }
      if (did) {
        if (v.isThrusting() && this.warpIdx > PHYS_MAX) this.setWarp(0, true);
        break;
      }
    }
    if (this.stageIdx >= this.stages.length && !this._noMore) { /* 最后一级已执行 */ }
    this.renderStages();
  },
  renderStages() {
    const el = $('stageList');
    const rest = this.stages.slice(this.stageIdx);
    el.innerHTML = rest.length ? rest.map((s, i) => `<div class="${i ? '' : 'next'}">${i ? '' : '▶ '}${stageLabel(s)}</div>`).join('') : '<div>已无后续分级</div>';
  },

  // ---------- 模拟 ----------
  update(dt) {
    const v = this.vessel; if (!v) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    if (!v.destroyed) {
      if (k.w || k.Shift) this.setThrottle(v.throttle + dt * 0.7);
      if (k.s || k.Control) this.setThrottle(v.throttle - dt * 0.7);
      if (this.warpIdx > PHYS_MAX && this.canRail()) this.setWarp(PHYS_MAX, true);
      const warp = WARPS[this.warpIdx];
      if (this.warpIdx <= PHYS_MAX) {
        let rem = dt * warp;
        while (rem > 1e-9 && !v.destroyed) { const h = Math.min(0.02, rem); this.physAll(h); rem -= h; }
      } else this.railAll(dt * warp);
      this.checkMissions();
      this.predAge += 1;
      if (this.predAge > (this.warpIdx > PHYS_MAX ? 6 : 20)) this.updatePrediction();
    }
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.smoke) { p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt; p.size += dt * 2.5; }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.updateHud();
  },
  physAll(h) {
    const v = this.vessel;
    if (v.landed === false) this.flags.launched = true;
    const ev = physStep(v, h, this.rot());
    if (ev === 'crash') { this.explode(v); this.gameOver(); return; }
    if (ev === 'land') this.onLand();
    if (checkSOI(v, this.t)) this.onBodyChange();
    for (const d of this.debris) {
      if (physStep(d, h, 0) === 'crash') this.explode(d);
      checkSOI(d, this.t);
    }
    this.debris = this.debris.filter((d) => !d.destroyed);
    this.t += h;
    // 尾焰烟雾
    const b = BODIES[v.body], rho = atmoDensity(b, Math.hypot(v.pos.x, v.pos.y) - b.radius);
    if (rho > 0.02 && this.particles.length < 260) {
      const ax = -Math.sin(v.angle), ay = Math.cos(v.angle);
      for (const p of v.engines) {
        if (p.firing <= 0 || Math.random() > 0.35) continue;
        const w = v.localToWorld(p.x + p.w / 2, p.y - 1);
        this.particles.push({ x: w.x, y: w.y, vx: v.vel.x - ax * 25 + (Math.random() - 0.5) * 8, vy: v.vel.y - ay * 25 + (Math.random() - 0.5) * 8, life: 1.3, max: 1.3, size: p.w * 0.5, smoke: true });
      }
    }
  },
  railAll(total) {
    const v = this.vessel, n = 32;
    for (let i = 0; i < n; i++) {
      let h = total / n;
      if (!v.landed) {
        const b = BODIES[v.body], th = this.railThreshold(v.body);
        const el = orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu);
        if (el.rp < th) {
          const d = Math.hypot(v.pos.x, v.pos.y) - th;
          if (d < 50) { this.setWarp(0, true); this.toast(b.atmo ? '进入大气层，时间加速已停止' : '接近地表，时间加速已停止'); return; }
          h = Math.min(h, 0.25 * d / (Math.hypot(v.vel.x, v.vel.y) + 1) + 0.02);
        }
      }
      const pb = v.body;
      railStep(v, h, this.t);
      if (v.body !== pb) this.onBodyChange();
      for (const d of this.debris) {
        railStep(d, h, this.t);
        if (!d.landed && Math.hypot(d.pos.x, d.pos.y) < this.railThreshold(d.body)) d.destroyed = true;
      }
      this.debris = this.debris.filter((d) => !d.destroyed);
      this.t += h;
      if (this.warpIdx <= PHYS_MAX) return;
    }
  },
  onBodyChange() {
    this.particles = []; this.predAge = 99;
    this.toast('进入 ' + BODIES[this.vessel.body].name + ' 的引力范围', true);
    if (this.warpIdx > 4) this.warpIdx = 4;
  },
  onLand() {
    const v = this.vessel;
    if (!this.flags.launched) return;
    this.toast(`已在 ${BODIES[v.body].name} 着陆（${v.impactSpeed.toFixed(1)} m/s）`, true);
    v.throttle = 0;
    this.landedEvent = true;
  },
  explode(o) {
    const n = Math.min(90, 24 + o.parts.length * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 5 + Math.random() * 45, life = 0.6 + Math.random() * 1.4;
      this.particles.push({ x: o.pos.x + (Math.random() - 0.5) * 4, y: o.pos.y + (Math.random() - 0.5) * 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: 1 + Math.random() * 3, hot: true });
    }
  },
  gameOver() {
    const v = this.vessel;
    this.over = true; this.warpIdx = 0;
    $('ovTitle').textContent = '任务失败';
    $('ovText').textContent = v.impactSpeed > v.tolerance
      ? `火箭以 ${v.impactSpeed.toFixed(1)} m/s 撞上了${BODIES[v.body].name}表面（可承受 ${v.tolerance} m/s）。`
      : `火箭在${BODIES[v.body].name}表面侧翻了，着陆时请保持直立。`;
    $('overlay').classList.remove('hidden');
  },
  updatePrediction() {
    const v = this.vessel;
    this.predAge = 0;
    if (v.landed || v.destroyed) { this.pred = []; return; }
    this.pred = predictSegments(v.body, v.pos.x, v.pos.y, v.vel.x, v.vel.y, this.t, 3);
  },

  // ---------- 任务 ----------
  checkMissions() {
    const v = this.vessel, b = BODIES[v.body], f = this.flags;
    const alt = Math.hypot(v.pos.x, v.pos.y) - b.radius;
    const el = v.landed ? null : orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu);
    const orbiting = el && el.ra < b.soi && el.rp > this.railThreshold(v.body);
    const landed = this.landedEvent; this.landedEvent = false;
    const done = (id) => {
      if (this.missionsDone[id]) return;
      this.missionsDone[id] = 1;
      try { localStorage.setItem('of_missions', JSON.stringify(this.missionsDone)); } catch (e) { /* ignore */ }
      this.toast('★ 任务完成：' + MISSIONS.find((m) => m.id === id).text, true);
      this.renderMissions();
    };
    if (v.body === 'aeria') {
      if (alt > 5000) done('alt5');
      if (alt > 30000) { f.space = true; done('space'); }
      if (orbiting) done('orbit');
      if (landed && f.space) { done('return'); if (f.seloLanded) done('seloReturn'); }
    } else if (v.body === 'selo') {
      f.space = true; done('seloSoi');
      if (orbiting) done('seloOrbit');
      if (landed) { f.seloLanded = true; done('seloLand'); }
    } else if (v.body === 'helion') { f.space = true; done('escape'); }
    else if (v.body === 'rubra') { done('rubraSoi'); if (landed) done('rubraLand'); }
  },
  renderMissions() {
    $('missions').innerHTML = '<b>任务</b>' + MISSIONS.map((m) => `<div class="${this.missionsDone[m.id] ? 'done' : ''}">${this.missionsDone[m.id] ? '✔' : '○'} ${m.text}</div>`).join('');
  },
  toast(text, good) {
    const el = $('toasts');
    if (el.lastChild && el.lastChild.textContent === text) return;
    const d = document.createElement('div'); d.className = 'toast' + (good ? ' good' : ''); d.textContent = text;
    el.appendChild(d);
    while (el.children.length > 4) el.removeChild(el.firstChild);
    setTimeout(() => d.remove(), 3200);
  },

  // ---------- HUD ----------
  updateHud() {
    const v = this.vessel, b = BODIES[v.body];
    const r = Math.hypot(v.pos.x, v.pos.y), ux = v.pos.x / r, uy = v.pos.y / r;
    let minY = Infinity; for (const c of v.corners) minY = Math.min(minY, c[1]);
    const alt = Math.max(0, r - b.radius - (v.com.y - minY));
    const sp = Math.hypot(v.vel.x, v.vel.y), vr = v.vel.x * ux + v.vel.y * uy, vh = Math.abs(ux * v.vel.y - uy * v.vel.x);
    $('hBody').textContent = b.name;
    $('hTime').textContent = 'T+ ' + fmtTime(this.t);
    $('hAlt').textContent = fmtDist(alt);
    $('hSpd').textContent = sp.toFixed(sp < 100 ? 1 : 0) + ' m/s';
    $('hVH').textContent = vr.toFixed(0) + ' / ' + vh.toFixed(0);
    if (v.landed || v.destroyed) { $('hAp').textContent = '—'; $('hPe').textContent = '—'; }
    else {
      const el = orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu);
      $('hAp').textContent = el.ra < b.soi ? fmtDist(el.ra - b.radius) : '逃逸';
      $('hPe').textContent = fmtDist(el.rp - b.radius);
    }
    const dv = v.activeDv(), fi = v.fuelInfo();
    $('hMass').textContent = v.mass.toFixed(2) + ' t / ' + (dv.thrust ? (dv.thrust / (v.mass * b.mu / (r * r))).toFixed(2) : '—');
    $('hFuel').textContent = (fi.cap ? Math.round(100 * fi.fuel / fi.cap) + '%' : '—') + ' / ' + dv.dv.toFixed(0) + ' m/s';
    $('hWarp').textContent = '时间 ' + WARPS[this.warpIdx].toLocaleString('en-US') + '×';
    $('thrFill').style.height = (v.throttle * 100) + '%';
    $('mapBtn').classList.toggle('toggle', true); $('mapBtn').classList.toggle('on', this.mapMode);
    // 姿态指示
    const c = this.navCtx, R = 110;
    c.clearRect(0, 0, 220, 220);
    c.save(); c.translate(R, R);
    c.fillStyle = 'rgba(13,18,30,0.8)'; c.strokeStyle = '#2a3550'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 100, 0, 7); c.fill(); c.stroke();
    const mark = (dx, dy, col, len, wd) => { c.strokeStyle = col; c.lineWidth = wd; c.beginPath(); c.moveTo(dx * (100 - len), -dy * (100 - len)); c.lineTo(dx * 96, -dy * 96); c.stroke(); };
    mark(ux, uy, '#4b9be0', 22, 6);            // 天顶方向
    if (sp > 0.5) {
      mark(v.vel.x / sp, v.vel.y / sp, '#b8f04a', 30, 6);       // 顺行
      mark(-v.vel.x / sp, -v.vel.y / sp, '#f0734a', 18, 5);     // 逆行
    }
    c.rotate(-v.angle);
    c.fillStyle = '#f2f4f8';
    c.beginPath(); c.moveTo(0, -78); c.lineTo(22, 34); c.lineTo(0, 18); c.lineTo(-22, 34); c.closePath(); c.fill();
    c.restore();
  },

  // ---------- 渲染 ----------
  render() {
    const ctx = this.ctx, W = this.W, H = this.H, v = this.vessel, t = this.t, s = this.cam.scale;
    if (!v) return;
    const vb = bodyAbs(v.body, t);
    const cx = vb.x + v.pos.x + this.cam.ox, cy = vb.y + v.pos.y + this.cam.oy;
    const X = (wx) => W / 2 + (wx - cx) * s, Y = (wy) => H / 2 - (wy - cy) * s;
    const diag = Math.hypot(W, H) / 2 + 60;
    ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, W, H);
    const cb = BODIES[v.body];
    const camAlt = Math.hypot(v.pos.x + this.cam.ox, v.pos.y + this.cam.oy) - cb.radius;
    const sky = cb.atmo ? Math.min(1, atmoDensity(cb, camAlt) / cb.atmo.rho0 * 3) : 0;
    ctx.fillStyle = '#fff';
    for (const st of this.stars) { ctx.globalAlpha = st[2] * (1 - sky * 0.9); ctx.fillRect(st[0] * W, st[1] * H, st[2] > 0.8 ? 2 : 1, st[2] > 0.8 ? 2 : 1); }
    ctx.globalAlpha = 1;

    const bigCircle = (px, py, r, fill) => {
      if (r < 20000) { ctx.beginPath(); ctx.arc(px, py, Math.max(r, 0.1), 0, 6.2832); fill ? ctx.fill() : ctx.stroke(); return; }
      const dx = W / 2 - px, dy = H / 2 - py, d = Math.hypot(dx, dy);
      if (d > r + diag) return;
      if (d < r - diag) { if (fill) ctx.fillRect(0, 0, W, H); return; }
      const ang = Math.atan2(dy, dx), span = Math.asin(Math.min(1, 2.5 * diag / r));
      const inner = Math.max(0, r - 5 * diag), N = 48;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const a = ang - span + 2 * span * i / N; ctx.lineTo(px + r * Math.cos(a), py + r * Math.sin(a)); }
      if (fill) { for (let i = N; i >= 0; i--) { const a = ang - span + 2 * span * i / N; ctx.lineTo(px + inner * Math.cos(a), py + inner * Math.sin(a)); } ctx.closePath(); ctx.fill(); }
      else ctx.stroke();
    };

    // 轨道线与引力范围
    ctx.lineWidth = 1;
    for (const id of BODY_IDS) {
      const b = BODIES[id]; if (!b.parent) continue;
      const pa = bodyAbs(b.parent, t);
      if (b.a * s > 4 && b.a * s < 2e5) { ctx.strokeStyle = 'rgba(150,170,210,0.22)'; bigCircle(X(pa.x), Y(pa.y), b.a * s, false); }
      const ba = bodyAbs(id, t);
      if (b.soi * s > 12 && s < 2e-3) { ctx.strokeStyle = 'rgba(150,170,210,0.10)'; ctx.setLineDash([4, 6]); bigCircle(X(ba.x), Y(ba.y), b.soi * s, false); ctx.setLineDash([]); }
    }
    // 天体
    for (const id of BODY_IDS) {
      const b = BODIES[id], ba = bodyAbs(id, t), px = X(ba.x), py = Y(ba.y), rp = b.radius * s;
      if (Math.hypot(px - W / 2, py - H / 2) > diag + rp * 1.2 + (b.atmo ? b.atmo.height * s : 0) + 40) continue;
      if (b.kind === 'star') {
        const gr = Math.max(rp * 3.5, 10);
        const g = ctx.createRadialGradient(px, py, 0, px, py, gr);
        g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.28, 'rgba(255,210,122,0.9)'); g.addColorStop(0.32, 'rgba(255,190,90,0.35)'); g.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, gr, 0, 7); ctx.fill();
        continue;
      }
      if (b.atmo && b.atmo.height * s > 1.5) {
        const [r, g, bl] = b.atmo.color, N = 8;
        ctx.fillStyle = `rgba(${r},${g},${bl},0.14)`;
        for (let i = N; i >= 1; i--) bigCircle(px, py, (b.radius + b.atmo.height * 0.8 * (i / N) * (i / N)) * s, true);
      }
      ctx.fillStyle = b.color;
      bigCircle(px, py, Math.max(rp, 1.6), true);
      if (rp >= 20000) { ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; bigCircle(px, py, rp, false); ctx.lineWidth = 1; }
      if (rp > 4 && rp < 3000) {
        const sa = Math.atan2(-ba.y, -ba.x), k = Math.min(1, (3000 - rp) / 2000);
        const g = ctx.createLinearGradient(px + Math.cos(sa) * rp, py - Math.sin(sa) * rp, px - Math.cos(sa) * rp, py + Math.sin(sa) * rp);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.6 * k})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rp + 0.5, 0, 7); ctx.fill();
      }
      if (id === v.body && s > 0.35) this.drawGround(ctx, b, ba, X, Y, s, cx, cy);
      if (s < 4e-3) {
        ctx.fillStyle = 'rgba(210,220,240,0.8)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(b.name, px, py + Math.max(rp, 2) + 15);
      }
    }
    // 预测轨迹
    if (s < 0.03 && this.pred.length) {
      const cols = ['#6fd3ff', '#ffb04a', '#c58bff'];
      this.pred.forEach((seg, i) => {
        const b = BODIES[seg.body], ba = bodyAbs(seg.body, t);
        const pts = conicPoints(seg.el, b.soi, 220);
        if (!pts.length) return;
        ctx.strokeStyle = cols[i]; ctx.lineWidth = 1.6; ctx.globalAlpha = i ? 0.85 : 1;
        if (i) ctx.setLineDash([7, 5]);
        ctx.beginPath();
        for (const p of pts) ctx.lineTo(X(ba.x + p[0]), Y(ba.y + p[1]));
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        const label = (x, y, text) => {
          const px = X(ba.x + x), py = Y(ba.y + y);
          ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill();
          ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(text, px + 7, py - 6);
        };
        const el = seg.el;
        if (el.rp > b.radius) label(el.rp * Math.cos(el.w), el.rp * Math.sin(el.w), 'Pe ' + fmtDist(el.rp - b.radius));
        if (el.ra < b.soi && el.e > 1e-4) label(-el.ra * Math.cos(el.w), -el.ra * Math.sin(el.w), 'Ap ' + fmtDist(el.ra - b.radius));
        if (seg.end && seg.end.x !== undefined) label(seg.end.x, seg.end.y, seg.end.type === 'encounter' ? '相遇 ' + BODIES[seg.end.child].name : seg.end.type === 'exit' ? '飞出引力范围' : '撞击');
      });
    }
    // 粒子
    for (const p of this.particles) {
      const a = p.life / p.max;
      if (p.smoke) ctx.fillStyle = `rgba(200,200,205,${0.28 * a})`;
      else ctx.fillStyle = `rgba(255,${Math.floor(120 + 120 * a)},${Math.floor(40 * a)},${a})`;
      ctx.beginPath(); ctx.arc(X(vb.x + p.x), Y(vb.y + p.y), Math.max(1, p.size * s * (p.smoke ? 1 : a)), 0, 7); ctx.fill();
    }
    for (const d of this.debris) if (d.body === v.body) this.drawVessel(ctx, d, X(vb.x + d.pos.x), Y(vb.y + d.pos.y), s, false);
    if (!v.destroyed) this.drawVessel(ctx, v, X(vb.x + v.pos.x), Y(vb.y + v.pos.y), s, true);
  },

  drawVessel(ctx, v, sx, sy, s, main) {
    const size = (v.bounds.maxY - v.bounds.minY) * s;
    if (size < 12) {
      if (!main && size < 3 && s > 1e-4) return;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-v.angle);
      ctx.fillStyle = main ? '#ffffff' : '#8a93a5';
      const k = main ? 1 : 0.6;
      ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(6 * k, 7 * k); ctx.lineTo(0, 3 * k); ctx.lineTo(-6 * k, 7 * k); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    const b = BODIES[v.body], sp = Math.hypot(v.vel.x, v.vel.y);
    const heat = Math.min(1, v.q * sp / 5e7);
    ctx.save(); ctx.translate(sx, sy);
    if (heat > 0.05 && sp > 1) {
      const hx = v.vel.x / sp, hy = -v.vel.y / sp, R = v.reach * s * 1.3;
      const g = ctx.createRadialGradient(hx * R * 0.5, hy * R * 0.5, 0, 0, 0, R * 1.6);
      g.addColorStop(0, `rgba(255,200,120,${0.75 * heat})`); g.addColorStop(0.5, `rgba(255,110,40,${0.35 * heat})`); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 1.6, 0, 7); ctx.fill();
    }
    ctx.rotate(-v.angle); ctx.scale(s, s);
    const vac = atmoDensity(b, Math.hypot(v.pos.x, v.pos.y) - b.radius) < 0.05;
    drawVesselParts(ctx, v.parts, v.com, (v.bounds.minX + v.bounds.maxX) / 2, vac);
    ctx.restore();
  },

  drawGround(ctx, b, ba, X, Y, s, cx, cy) {
    const R = b.radius, ang = Math.atan2(cy - ba.y, cx - ba.x);
    const step = 45 / R, half = Math.min(0.5, (this.W / s) / R * 0.75 + step);
    const i0 = Math.floor((ang - half) / step), i1 = Math.ceil((ang + half) / step);
    if (i1 - i0 > 400) return;
    const seed = b.id.length * 97;
    for (let i = i0; i <= i1; i++) {
      const h = hash01(i + seed), a = i * step + (h - 0.5) * step * 0.6;
      if (b.id === 'aeria' && Math.abs(a - Math.PI / 2) * R < 70) continue;
      const px = X(ba.x + R * Math.cos(a)), py = Y(ba.y + R * Math.sin(a));
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 2 - a); ctx.scale(s, s);
      if (b.id === 'aeria' && h > 0.35) {
        const k = 0.7 + h;
        ctx.fillStyle = '#5b4630'; ctx.fillRect(-0.3, -2.2 * k, 0.6, 2.4 * k);
        ctx.fillStyle = h > 0.7 ? '#2c6e3d' : '#347f47';
        ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(2.6 * k, -1.8 * k); ctx.lineTo(-2.6 * k, -1.8 * k); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(0, 0, 2 + h * 5, 0.8 + h * 1.6, 0, Math.PI, 0); ctx.fill();
      }
      ctx.restore();
    }
    if (b.id === 'aeria') {
      const px = X(ba.x), py = Y(ba.y + R);
      if (Math.abs(px - this.W / 2) < this.W && Math.abs(py - this.H / 2) < this.H * 2) {
        ctx.save(); ctx.translate(px, py); ctx.scale(s, s);
        ctx.fillStyle = '#5d6470'; ctx.fillRect(-16, -0.05, 32, 1.6);
        ctx.fillStyle = '#7b8390'; ctx.fillRect(-16, -0.05, 32, 0.35);
        ctx.strokeStyle = '#a04a36'; ctx.lineWidth = 0.28;
        ctx.beginPath();
        for (let y = 0; y < 30; y += 3) { ctx.moveTo(-13, -y); ctx.lineTo(-10, -y - 3); ctx.moveTo(-10, -y); ctx.lineTo(-13, -y - 3); ctx.moveTo(-13, -y - 3); ctx.lineTo(-10, -y - 3); }
        ctx.moveTo(-13, 0); ctx.lineTo(-13, -30); ctx.moveTo(-10, 0); ctx.lineTo(-10, -30);
        ctx.stroke();
        ctx.restore();
      }
    }
  },
};
