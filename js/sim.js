'use strict';
// 飞行物理：刚体火箭、大气阻力、着陆碰撞、轨道传播与引力范围切换
function bodyRel(id, t) {
  const b = BODIES[id], th = b.phase + b.n * t, c = Math.cos(th), s = Math.sin(th);
  return { x: b.a * c, y: b.a * s, vx: -b.a * b.n * s, vy: b.a * b.n * c };
}
function bodyAbs(id, t) {
  let x = 0, y = 0;
  while (BODIES[id].parent) { const r = bodyRel(id, t); x += r.x; y += r.y; id = BODIES[id].parent; }
  return { x, y };
}
function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

class Vessel {
  constructor(parts, body) {
    this.parts = parts;
    this.body = body;
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;      // 0 = 箭体朝 +y，逆时针为正
    this.angVel = 0;
    this.throttle = 0;
    this.landed = false;
    this.destroyed = false;
    this.q = 0;
    this.refresh();
  }
  refresh() {
    const ps = this.parts;
    this.an = analyze(ps);
    this.controllable = ps.some((p) => p.def.command);
    this.engines = [];
    this.pools = [];
    this.chutes = ps.filter((p) => p.def.chute);
    for (let i = 0; i < ps.length; i++) if (ps[i].def.thrust) { this.engines.push(ps[i]); this.pools.push(enginePool(ps, this.an, i)); }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of ps) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h);
    }
    this.bounds = { minX, maxX, minY, maxY };
    const W = maxX - minX, L = maxY - minY, midX = (minX + maxX) / 2;
    this.cdaFront = (ps.some((p) => p.def.nose || p.type === 'capsule') ? 0.25 : 0.4) * Math.PI * W * W / 4;
    this.cdaSide = 0.8 * W * L;
    this.tolerance = ps.some((p) => p.def.leg) ? 14 : 8;
    this.corners = [];
    for (const p of ps) {
      if (p.def.leg) {
        const out = (p.x + p.w / 2) < midX ? -0.6 : 0.6;
        const y0 = p.y - p.def.ext;
        this.corners.push([p.x + out, y0], [p.x + p.w + out, y0], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]);
      } else {
        this.corners.push([p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]);
      }
    }
    this.updateMass();
    this.reach = 0;
    for (const c of this.corners) this.reach = Math.max(this.reach, Math.hypot(c[0] - this.com.x, c[1] - this.com.y));
  }
  updateMass() {
    let m = 0, cx = 0, cy = 0;
    for (const p of this.parts) {
      const pm = p.def.mass + p.fuel;
      m += pm; cx += pm * (p.x + p.w / 2); cy += pm * (p.y + p.h / 2);
    }
    this.mass = m;
    this.com = { x: cx / m, y: cy / m };
  }
  localToWorld(lx, ly) {
    const dx = lx - this.com.x, dy = ly - this.com.y, c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.pos.x + dx * c - dy * s, y: this.pos.y + dx * s + dy * c };
  }
  worldToLocal(wx, wy) {
    const dx = wx - this.pos.x, dy = wy - this.pos.y, c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: dx * c + dy * s + this.com.x, y: -dx * s + dy * c + this.com.y };
  }
  placeOnSurface(angle) {
    const b = BODIES[this.body];
    let minY = Infinity;
    for (const c of this.corners) minY = Math.min(minY, c[1]);
    const r = b.radius + (this.com.y - minY);
    this.pos = { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    this.angle = angle - Math.PI / 2;
    this.vel = { x: 0, y: 0 };
    this.landed = true;
  }
  isThrusting() {
    return this.engines.some((p, i) => p.on && (p.def.srb || this.throttle > 0) && this.pools[i].some((t) => t.fuel > 1e-9));
  }
  fuelInfo() {
    let fuel = 0, cap = 0;
    for (const p of this.parts) if (p.def.fuel) { fuel += p.fuel; cap += p.def.fuel; }
    return { fuel, cap };
  }
  // 当前已点火发动机可用的 Δv
  activeDv() {
    const seen = new Set();
    let fuel = 0, F = 0, mdot = 0;
    this.engines.forEach((p, i) => {
      if (!p.on) return;
      let f = 0;
      for (const t of this.pools[i]) { if (!seen.has(t)) { seen.add(t); fuel += t.fuel; } f += t.fuel; }
      if (f > 1e-9) { F += p.def.thrust; mdot += p.def.thrust / (p.def.ispVac * G0); }
    });
    this.updateMass();
    if (!mdot || fuel <= 0) return { dv: 0, thrust: 0 };
    return { dv: F / mdot * Math.log(this.mass / (this.mass - fuel)), thrust: F };
  }
}

// 一步动力飞行积分。返回 null | 'land' | 'crash'
function physStep(v, dt, rot) {
  const b = BODIES[v.body];
  v.updateMass();
  const r = Math.hypot(v.pos.x, v.pos.y), ux = v.pos.x / r, uy = v.pos.y / r;
  const rho = atmoDensity(b, r - b.radius);
  const ax = -Math.sin(v.angle), ay = Math.cos(v.angle);
  let F = 0;
  const pr = Math.min(1, rho / 1.2);
  for (let i = 0; i < v.engines.length; i++) {
    const p = v.engines[i];
    p.firing = 0;
    if (!p.on) continue;
    const thr = p.def.srb ? 1 : v.throttle;
    if (thr <= 0) continue;
    const isp = p.def.ispVac + (p.def.ispSL - p.def.ispVac) * pr;
    const f = p.def.thrust * thr, need = f / (isp * G0) * dt;
    const got = drainPool(v.pools[i], need);
    if (got <= 0) continue;
    F += f * got / need;
    p.firing = thr * got / need;
  }
  const g = b.mu / (r * r), at = F / v.mass;
  v.q = 0;
  if (v.landed) {
    if (at * (ax * ux + ay * uy) > g) v.landed = false;
    else { v.vel.x = 0; v.vel.y = 0; v.angVel = 0; return null; }
  }
  if (v.controllable) {
    if (rot) v.angVel += rot * 2.2 * dt;
    else { const d = 3 * dt; v.angVel = Math.abs(v.angVel) < d ? 0 : v.angVel - Math.sign(v.angVel) * d; }
    v.angVel = Math.max(-2, Math.min(2, v.angVel));
  }
  v.vel.x += (at * ax - g * ux) * dt;
  v.vel.y += (at * ay - g * uy) * dt;
  if (rho > 0) {
    const sp = Math.hypot(v.vel.x, v.vel.y);
    if (sp > 1e-3) {
      const sinA = Math.abs(ax * v.vel.y - ay * v.vel.x) / sp;
      let cda = v.cdaFront + (v.cdaSide - v.cdaFront) * sinA * sinA, chute = 0;
      for (const c of v.chutes) if (c.deployed) { c.dep = Math.min(1, c.dep + dt / 1.5); chute += 900 * c.dep * c.dep; }
      cda += chute;
      const k = 0.5 * rho * cda / (1000 * v.mass);
      const f = 1 / (1 + k * sp * dt);   // 隐式阻力，数值稳定
      v.vel.x *= f; v.vel.y *= f;
      v.q = 0.5 * rho * sp * sp;
      if (chute > 0) {
        const err = wrapAngle(Math.atan2(v.vel.x, -v.vel.y) - v.angle);
        v.angVel += (err * 6 - v.angVel * 4) * dt * Math.min(1, k * sp * sp / 5);
      }
    }
  }
  v.pos.x += v.vel.x * dt; v.pos.y += v.vel.y * dt;
  v.angle += v.angVel * dt;
  // 地面接触
  const r2 = Math.hypot(v.pos.x, v.pos.y);
  if (r2 - b.radius < v.reach + 1) {
    let minR = Infinity;
    for (const c of v.corners) { const w = v.localToWorld(c[0], c[1]); minR = Math.min(minR, Math.hypot(w.x, w.y)); }
    const pen = b.radius - minR;
    if (pen >= 0) {
      const sp = Math.hypot(v.vel.x, v.vel.y);
      const tilt = Math.abs(wrapAngle(v.angle - (Math.atan2(v.pos.y, v.pos.x) - Math.PI / 2)));
      v.impactSpeed = sp;
      if (sp > v.tolerance || (v.controllable && tilt > 0.7)) { v.destroyed = true; return 'crash'; }
      v.pos.x += v.pos.x / r2 * pen; v.pos.y += v.pos.y / r2 * pen;
      v.vel.x = 0; v.vel.y = 0; v.angVel = 0; v.landed = true;
      return 'land';
    }
  }
  return null;
}

// 动力飞行时的引力范围检查
function checkSOI(o, t) {
  const b = BODIES[o.body];
  if (b.parent && Math.hypot(o.pos.x, o.pos.y) > b.soi) {
    const rel = bodyRel(o.body, t);
    o.pos.x += rel.x; o.pos.y += rel.y; o.vel.x += rel.vx; o.vel.y += rel.vy;
    o.body = b.parent;
    return true;
  }
  for (const c of b.children) {
    const rel = bodyRel(c, t);
    if (Math.hypot(o.pos.x - rel.x, o.pos.y - rel.y) < BODIES[c].soi) {
      o.pos.x -= rel.x; o.pos.y -= rel.y; o.vel.x -= rel.vx; o.vel.y -= rel.vy;
      o.body = c;
      return true;
    }
  }
  return false;
}

// 在轨（开普勒）推进 h 秒，自动处理引力范围的进入与离开
function railStep(o, h, t, depth) {
  if (o.landed || h <= 0) return;
  const b = BODIES[o.body];
  const x0 = o.pos.x, y0 = o.pos.y, vx0 = o.vel.x, vy0 = o.vel.y;
  let s = keplerPropagate(x0, y0, vx0, vy0, b.mu, h);
  const cross = (test) => {
    let lo = 0, hi = h;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (test(keplerPropagate(x0, y0, vx0, vy0, b.mu, mid), mid)) hi = mid; else lo = mid;
    }
    return hi;
  };
  if ((depth || 0) < 4) {
    if (b.parent && Math.hypot(s.x, s.y) > b.soi) {
      const tau = cross((q) => Math.hypot(q.x, q.y) > b.soi);
      s = keplerPropagate(x0, y0, vx0, vy0, b.mu, tau);
      const rel = bodyRel(o.body, t + tau);
      o.pos.x = s.x + rel.x; o.pos.y = s.y + rel.y; o.vel.x = s.vx + rel.vx; o.vel.y = s.vy + rel.vy;
      o.body = b.parent;
      railStep(o, h - tau, t + tau, (depth || 0) + 1);
      return;
    }
    for (const c of b.children) {
      const soi = BODIES[c].soi;
      const inside = (q, tau) => { const rel = bodyRel(c, t + tau); return Math.hypot(q.x - rel.x, q.y - rel.y) < soi; };
      if (inside(s, h)) {
        const tau = cross(inside);
        s = keplerPropagate(x0, y0, vx0, vy0, b.mu, tau);
        const rel = bodyRel(c, t + tau);
        o.pos.x = s.x - rel.x; o.pos.y = s.y - rel.y; o.vel.x = s.vx - rel.vx; o.vel.y = s.vy - rel.vy;
        o.body = c;
        railStep(o, h - tau, t + tau, (depth || 0) + 1);
        return;
      }
    }
  }
  o.pos.x = s.x; o.pos.y = s.y; o.vel.x = s.vx; o.vel.y = s.vy;
}

// 分离后把不含指令部件的部分变成残骸
function splitVessel(v) {
  const comps = components(v.parts);
  if (comps.length <= 1) { v.refresh(); return []; }
  const rootComp = comps.find((c) => c.some((p) => p.type === 'capsule')) || comps.find((c) => c.some((p) => p.def.command)) || comps[0];
  v.updateMass();
  const oldCom = v.com, c = Math.cos(v.angle), s = Math.sin(v.angle), w = v.angVel;
  const place = (ves) => {
    const dx = ves.com.x - oldCom.x, dy = ves.com.y - oldCom.y;
    const ox = dx * c - dy * s, oy = dx * s + dy * c;
    ves.pos = { x: v.pos.x + ox, y: v.pos.y + oy };
    ves.vel = { x: v.vel.x - w * oy, y: v.vel.y + w * ox };
    return { ox, oy };
  };
  const out = [];
  const oldPos = { x: v.pos.x, y: v.pos.y }, oldVel = { x: v.vel.x, y: v.vel.y };
  const offs = [];
  for (const comp of comps) {
    if (comp === rootComp) continue;
    const d = new Vessel(comp, v.body);
    d.angle = v.angle; d.angVel = w; d.throttle = 0;
    for (const p of d.parts) if (!p.def.srb) p.on = false;
    offs.push([d, place(d)]);
    out.push(d);
  }
  v.parts = rootComp;
  v.refresh();
  const ro = place(v);
  // place() 依赖旧位置，根部件最后处理后再修正残骸
  for (const [d, o] of offs) {
    d.pos = { x: oldPos.x + o.ox, y: oldPos.y + o.oy };
    d.vel = { x: oldVel.x - w * o.oy, y: oldVel.y + w * o.ox };
    let nx = o.ox - ro.ox, ny = o.oy - ro.oy;
    const n = Math.hypot(nx, ny) || 1;
    nx /= n; ny /= n;
    const share = v.mass / (v.mass + d.mass);
    if (!v.landed) {
      d.vel.x += nx * 1.5 * share; d.vel.y += ny * 1.5 * share;
      v.vel.x -= nx * 1.5 * (1 - share); v.vel.y -= ny * 1.5 * (1 - share);
    }
    d.landed = false;
  }
  return out;
}

// 轨迹预测：返回若干段圆锥曲线（含飞出/相遇/撞击事件）
function predictSegments(bodyId, x, y, vx, vy, t, maxSeg) {
  const segs = [];
  for (let k = 0; k < (maxSeg || 3); k++) {
    const b = BODIES[bodyId];
    const el = orbitElements(x, y, vx, vy, b.mu);
    const seg = { body: bodyId, el, end: null };
    segs.push(seg);
    if (!(el.p > 1)) break;
    const bound = el.ra < b.soi;
    if (bound && !b.children.length) { if (el.rp < b.radius) seg.end = { type: 'impact' }; break; }
    let minSoi = Infinity;
    for (const c of b.children) minSoi = Math.min(minSoi, BODIES[c].soi);
    let cx = x, cy = y, cvx = vx, cvy = vy, tt = t, next = null;
    for (let i = 0; i < 5000 && !next; i++) {
      const rr = Math.hypot(cx, cy), vv = Math.hypot(cvx, cvy) + 1e-9;
      let h = Math.min(0.03 * rr / vv, 0.4 * minSoi / vv);
      if (bound) h = Math.min(h, el.period / 200);
      const s = keplerPropagate(cx, cy, cvx, cvy, b.mu, h);
      const bis = (test) => {
        let lo = 0, hi = h;
        for (let j = 0; j < 30; j++) { const m = 0.5 * (lo + hi); if (test(keplerPropagate(cx, cy, cvx, cvy, b.mu, m), m)) hi = m; else lo = m; }
        return hi;
      };
      if (Math.hypot(s.x, s.y) < b.radius) { seg.end = { type: 'impact', x: s.x, y: s.y }; return segs; }
      if (b.parent && Math.hypot(s.x, s.y) > b.soi) {
        const tau = bis((q) => Math.hypot(q.x, q.y) > b.soi);
        const q = keplerPropagate(cx, cy, cvx, cvy, b.mu, tau), rel = bodyRel(bodyId, tt + tau);
        seg.end = { type: 'exit', x: q.x, y: q.y };
        next = { body: b.parent, x: q.x + rel.x, y: q.y + rel.y, vx: q.vx + rel.vx, vy: q.vy + rel.vy, t: tt + tau };
        break;
      }
      for (const c of b.children) {
        const soi = BODIES[c].soi;
        const inside = (q, tau) => { const rel = bodyRel(c, tt + tau); return Math.hypot(q.x - rel.x, q.y - rel.y) < soi; };
        if (inside(s, h)) {
          const tau = bis(inside);
          const q = keplerPropagate(cx, cy, cvx, cvy, b.mu, tau), rel = bodyRel(c, tt + tau);
          seg.end = { type: 'encounter', x: q.x, y: q.y, child: c };
          next = { body: c, x: q.x - rel.x, y: q.y - rel.y, vx: q.vx - rel.vx, vy: q.vy - rel.vy, t: tt + tau };
          break;
        }
      }
      cx = s.x; cy = s.y; cvx = s.vx; cvy = s.vy; tt += h;
      if (bound && tt - t > el.period) return segs;
    }
    if (!next) break;
    bodyId = next.body; x = next.x; y = next.y; vx = next.vx; vy = next.vy; t = next.t;
  }
  return segs;
}
