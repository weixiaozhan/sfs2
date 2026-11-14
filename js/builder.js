'use strict';
// 装配车间：网格拼装、对称放置、分级与 Δv 预览
const Builder = {
  parts: [], mirror: true, cam: { x: 0, y: 0, cell: 22 }, drag: null, armed: null, pan: null, pointer: { x: 0, y: 0 },
  W: 0, H: 0,

  init() {
    this.canvas = document.getElementById('buildCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.buildPalette();
    const sel = document.getElementById('presetSel');
    for (const name of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = o.textContent = name; sel.appendChild(o); }
    sel.onchange = () => { if (sel.value) { this.parts = presetDesign(sel.value); sel.value = ''; this.changed(); this.fit(); } };
    document.getElementById('mirrorBtn').onclick = (e) => { this.mirror = !this.mirror; e.target.classList.toggle('on', this.mirror); };
    document.getElementById('clearBtn').onclick = () => { this.parts = []; this.changed(); };
    document.getElementById('statsBtn').onclick = () => document.getElementById('stats').classList.toggle('open');
    document.getElementById('launchBtn').onclick = () => this.launch();
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', () => { this.drag = null; this.pan = null; });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const g = this.toGrid(e.offsetX, e.offsetY), i = this.hit(g.x, g.y);
      if (i >= 0) { this.removeWithTwin(i); this.changed(); }
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const g = this.toGrid(e.offsetX, e.offsetY);
      this.cam.cell = Math.max(8, Math.min(48, this.cam.cell * (e.deltaY < 0 ? 1.12 : 0.89)));
      const s = this.toScreen(g.x, g.y);
      this.cam.x += e.offsetX - s[0]; this.cam.y += e.offsetY - s[1];
    }, { passive: false });
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('of_design') || 'null'); } catch (e) { /* ignore */ }
    this.parts = Array.isArray(saved) && saved.every((p) => PARTS[p.type]) && saved.length ? saved : presetDesign('轨道号（两级入轨）');
    this.changed();
  },

  buildPalette() {
    const el = document.getElementById('palette');
    const cats = ['指令', '燃料', '动力', '结构'];
    for (const cat of cats) {
      const h = document.createElement('h3'); h.textContent = cat; el.appendChild(h);
      for (const def of Object.values(PARTS)) {
        if (def.cat !== cat) continue;
        const it = document.createElement('div'); it.className = 'pitem'; it.dataset.type = def.id;
        const cv = document.createElement('canvas'); cv.width = cv.height = 88;
        const ctx = cv.getContext('2d');
        const ext = def.leg ? def.ext : 0;
        const s = 76 / Math.max(def.w + (def.leg ? 1.2 : 0), def.h + ext);
        ctx.translate(44 - def.w * s / 2, 44 - (def.h + ext) * s / 2); ctx.scale(s, s);
        drawPart(ctx, { type: def.id, def, w: def.w, h: def.h, fuel: def.fuel || 0, dep: 0 }, false);
        const tx = document.createElement('div');
        tx.innerHTML = `<div class="nm">${def.name}</div><div class="ds">${def.mass + (def.fuel || 0)} t · ${def.desc}</div>`;
        it.append(cv, tx);
        it.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') {
            e.preventDefault();
            this.drag = { type: def.id, fromPalette: true };
            this.pointer = this.local(e);
          } else {
            this.armed = this.armed === def.id ? null : def.id;
            el.querySelectorAll('.pitem').forEach((n) => n.classList.toggle('armed', n.dataset.type === this.armed));
          }
        });
        el.appendChild(it);
      }
    }
  },

  resize(W, H) { this.W = W; this.H = H; },
  toScreen(gx, gy) { return [this.W / 2 + this.cam.x + gx * this.cam.cell, this.H - 70 + this.cam.y - gy * this.cam.cell]; },
  toGrid(sx, sy) { return { x: (sx - this.W / 2 - this.cam.x) / this.cam.cell, y: (this.H - 70 + this.cam.y - sy) / this.cam.cell }; },
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; },
  rect(p) { const d = PARTS[p.type]; return { x: p.x, y: p.y, w: d.w, h: d.h }; },
  hit(gx, gy) {
    for (let i = this.parts.length - 1; i >= 0; i--) { const r = this.rect(this.parts[i]); if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) return i; }
    return -1;
  },
  twinIndex(i) {
    const p = this.parts[i], d = PARTS[p.type], mx = -(p.x + d.w);
    if (mx === p.x) return -1;
    return this.parts.findIndex((q, k) => k !== i && q.type === p.type && q.x === mx && q.y === p.y);
  },
  removeWithTwin(i) {
    const t = this.mirror ? this.twinIndex(i) : -1;
    const rm = [i]; if (t >= 0) rm.push(t);
    this.parts = this.parts.filter((_, k) => !rm.includes(k));
  },
  fit() {
    if (!this.parts.length) { this.cam.x = 0; this.cam.y = 0; return; }
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const p of this.parts) { const r = this.rect(p); minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h); minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w); }
    this.cam.cell = Math.max(8, Math.min(26, (this.H - 150) / (maxY - minY + 3), (this.W - 60) / (maxX - minX + 4)));
    this.cam.x = -(minX + maxX) / 2 * this.cam.cell;
    this.cam.y = minY * this.cam.cell - (this.H - 150 - (maxY - minY) * this.cam.cell) / 2;
  },

  // 拖动中部件的落点（含对称副本）
  ghosts() {
    const d = this.drag; if (!d) return null;
    const def = PARTS[d.type], g = this.toGrid(this.pointer.x, this.pointer.y);
    const x = Math.round(g.x - def.w / 2), y = Math.round(g.y - def.h / 2);
    const list = [{ type: d.type, x, y }];
    let valid = true;
    if (this.mirror) {
      const mx = -(x + def.w);
      if (mx !== x) {
        if (Math.abs(mx - x) < def.w) valid = false; else list.push({ type: d.type, x: mx, y });
      }
    }
    for (const gp of list) for (const p of this.parts) if (overlapping(this.rect(gp), this.rect(p))) valid = false;
    return { list, valid };
  },

  down(e) {
    const l = this.local(e), g = this.toGrid(l.x, l.y);
    this.pointer = l;
    if (e.button === 2) return;
    if (this.armed) { this.drag = { type: this.armed, fromPalette: true }; return; }
    const i = this.hit(g.x, g.y);
    if (i >= 0) {
      const p = this.parts[i];
      this.drag = { type: p.type, origin: this.parts.slice() };
      this.removeWithTwin(i);
    } else this.pan = { x: e.clientX, y: e.clientY };
  },
  move(e) {
    if (this.drag) {
      this.pointer = this.local(e);
      const tr = document.getElementById('trash');
      tr.classList.add('show');
      tr.classList.toggle('hot', this.overTrash());
    } else if (this.pan) {
      this.cam.x += e.clientX - this.pan.x; this.cam.y += e.clientY - this.pan.y;
      this.pan = { x: e.clientX, y: e.clientY };
    }
  },
  overTrash() { return this.pointer.x < 150 && this.pointer.y > this.H - 60; },
  up(e) {
    this.pan = null;
    if (!this.drag) return;
    this.pointer = this.local(e);
    const gh = this.ghosts(), d = this.drag;
    this.drag = null;
    document.getElementById('trash').classList.remove('show', 'hot');
    if (this.pointer.inside && !this.overTrash()) {
      if (gh.valid) this.parts.push(...gh.list);
      else if (d.origin) this.parts = d.origin;   // 放不下就回到原位
    }
    this.changed();
  },

  changed() {
    try { localStorage.setItem('of_design', JSON.stringify(this.parts)); } catch (e) { /* ignore */ }
    this.updateStats();
  },
  disconnected() {
    const inst = instantiate(this.parts), an = analyze(inst);
    return inst.map((p, i) => an.root < 0 || an.depth[i] === Infinity);
  },
  updateStats() {
    const el = document.getElementById('stats');
    const inst = instantiate(this.parts);
    const hasCmd = inst.some((p) => p.def.command);
    const disc = this.disconnected().filter(Boolean).length;
    let html = '<h3>火箭数据</h3>';
    html += `<div class="kv"><span>部件数</span><b>${inst.length}</b></div>`;
    html += `<div class="kv"><span>起飞质量</span><b>${totalMass(inst).toFixed(2)} t</b></div>`;
    if (!inst.length) html += '<div class="tip">从左侧拖出部件开始建造，或在上方载入示例火箭。</div>';
    else if (!hasCmd) html += '<div class="warn">⚠ 需要一个指令舱或探测核心</div>';
    else if (disc) html += `<div class="warn">⚠ 有 ${disc} 个部件没有连接到指令舱（红色），发射时会被丢弃</div>`;
    if (hasCmd) {
      const stats = stageStats(this.parts.filter((_, i) => !this.disconnected()[i]));
      let total = 0;
      html += '<h3>分级（按空格依次执行）</h3><table><tr><th>级</th><th>动作</th><th>推重比</th><th>Δv m/s</th></tr>';
      stats.forEach((s, i) => {
        total += s.dv;
        html += `<tr><td>${i + 1}</td><td>${stageLabel(s.stage)}</td><td>${s.twr ? s.twr.toFixed(2) : '—'}</td><td>${s.dv ? s.dv.toFixed(0) : '—'}</td></tr>`;
      });
      html += `</table><div class="kv" style="margin-top:6px"><span>总 Δv（真空）</span><b>${total.toFixed(0)} m/s</b></div>`;
      if (stats.length && stats[0].twr > 0 && stats[0].twr < 1.05) html += '<div class="warn">⚠ 第一级推重比不足 1，无法起飞</div>';
      if (!inst.some((p) => p.def.thrust)) html += '<div class="warn">⚠ 没有发动机</div>';
    }
    html += '<h3>Δv 参考</h3><div class="tip">进入艾瑞亚轨道 ≈ 2200<br>飞往塞洛 ≈ +700<br>登陆塞洛并返回 ≈ +1300<br>飞往鲁布拉 ≈ +1000（从轨道出发）</div>';
    html += '<h3>操作</h3><div class="tip">拖动放置 · 右键或拖到左下角删除<br>滚轮缩放 · 拖动空白处平移<br>触屏：先点选部件，再点画布放置</div>';
    el.innerHTML = html;
  },

  launch() {
    const disc = this.disconnected();
    const design = this.parts.filter((_, i) => !disc[i]);
    const inst = instantiate(design);
    if (!inst.some((p) => p.def.command)) { this.hint('需要一个指令舱或探测核心才能发射'); return; }
    Game.startFlight(design);
  },
  hint(t) {
    const el = document.getElementById('buildHint'); el.textContent = t; el.style.color = '#ffb163';
    clearTimeout(this._ht); this._ht = setTimeout(() => { el.textContent = ''; }, 3000);
  },

  render() {
    const ctx = this.ctx, W = this.W, H = this.H, c = this.cam.cell;
    ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0, 0, W, H);
    // 网格
    const g0 = this.toGrid(0, H), g1 = this.toGrid(W, 0);
    ctx.lineWidth = 1;
    for (let x = Math.floor(g0.x); x <= g1.x; x++) {
      const sx = Math.round(this.toScreen(x, 0)[0]) + 0.5;
      ctx.strokeStyle = x === 0 ? 'rgba(226,98,43,0.55)' : x % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    for (let y = Math.floor(g0.y); y <= g1.y; y++) {
      const sy = Math.round(this.toScreen(0, y)[1]) + 0.5;
      ctx.strokeStyle = y % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
    const disc = this.disconnected();
    const drawOne = (p, alpha, tint) => {
      const def = PARTS[p.type], s = this.toScreen(p.x, p.y + def.h);
      ctx.save(); ctx.translate(s[0], s[1]); ctx.scale(c, c); ctx.globalAlpha = alpha;
      drawPart(ctx, { type: p.type, def, w: def.w, h: def.h, fuel: def.fuel || 0, dep: 0 }, p.x + def.w / 2 < 0);
      if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, def.w, def.h); }
      ctx.restore();
    };
    this.parts.forEach((p, i) => drawOne(p, 1, disc[i] ? 'rgba(255,60,60,0.4)' : null));
    if (this.drag && this.pointer.inside) {
      const gh = this.ghosts();
      for (const p of gh.list) drawOne(p, 0.75, gh.valid ? 'rgba(90,255,150,0.18)' : 'rgba(255,60,60,0.45)');
    }
  },
};

function stageLabel(st) {
  const a = [];
  if (st.decouple.length) a.push('分离×' + st.decouple.length);
  if (st.ignite.length) a.push('点火×' + st.ignite.length);
  if (st.chutes.length) a.push('开伞');
  return a.join(' + ');
}
