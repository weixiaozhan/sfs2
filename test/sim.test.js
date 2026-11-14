// node test/sim.test.js —— 轨道数学与飞行物理的无界面测试
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const src = ['data', 'kepler', 'rocket', 'sim'].map((f) => fs.readFileSync(path.join(__dirname, '../js', f + '.js'), 'utf8').replace("'use strict';", '')).join('\n');
const ctx = {};
vm.runInNewContext(src + '\nthis.E={BODIES,PARTS,PRESETS,keplerPropagate,orbitElements,instantiate,presetDesign,buildStages,stageStats,Vessel,physStep,railStep,checkSOI,splitVessel,predictSegments,bodyRel,totalMass};', ctx);
const E = ctx.E;
const close = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1. 开普勒传播：椭圆一周回到原点，能量守恒
{
  const mu = E.BODIES.aeria.mu, r = 4e5, v = Math.sqrt(mu / r) * 1.2;
  const el = E.orbitElements(r, 0, 0, v, mu);
  const s = E.keplerPropagate(r, 0, 0, v, mu, el.period);
  close(s.x, r, 1e-3, 'period x'); close(s.y, 0, 1e-2, 'period y');
  const h = E.keplerPropagate(r, 0, 0, v, mu, el.period / 2);
  close(Math.hypot(h.x, h.y), el.ra, 1e-2, 'apoapsis');
  // 双曲线：与数值积分对比
  let x = r, y = 0, vx = 0, vy = Math.sqrt(mu / r) * 1.6; const dt = 0.01; const T = 3000;
  const k = E.keplerPropagate(x, y, vx, vy, mu, T);
  for (let i = 0; i < T / dt; i++) { const d = Math.hypot(x, y), a = -mu / (d * d * d); vx += a * x * dt / 2; vy += a * y * dt / 2; x += vx * dt; y += vy * dt; const d2 = Math.hypot(x, y), a2 = -mu / (d2 * d2 * d2); vx += a2 * x * dt / 2; vy += a2 * y * dt / 2; }
  close(k.x, x, 5, 'hyperbola x'); close(k.y, y, 5, 'hyperbola y');
  const b = E.keplerPropagate(k.x, k.y, k.vx, k.vy, mu, -T);
  close(b.x, r, 1e-2, 'backward');
}

// 2. 分级
{
  const st = E.buildStages(E.instantiate(E.presetDesign('探月号（登月往返）')));
  assert.strictEqual(st.length, 6);
  assert.strictEqual(st[0].ignite.length, 3, '助推器与芯级同时点火');
  assert.strictEqual(st[1].decouple.length, 2);
  assert(st[5].chutes.length === 1);
  for (const name of Object.keys(E.PRESETS)) {
    const stats = E.stageStats(E.presetDesign(name));
    const dv = stats.reduce((a, s) => a + s.dv, 0);
    console.log(name, 'Δv', dv.toFixed(0), 'TWR', stats[0].twr.toFixed(2), stats.map((s) => s.dv.toFixed(0)).join('/'));
    assert(stats[0].twr > 1.2);
  }
}

// 3. 自动驾驶：轨道号入轨，然后在轨传播一圈并返回着陆
function fly(name) {
  const parts = E.instantiate(E.presetDesign(name));
  const stages = E.buildStages(parts);
  const v = new E.Vessel(parts, 'aeria');
  v.placeOnSurface(Math.PI / 2);
  return { v, stages, si: 0, debris: [], t: 0 };
}
function stage(f) {
  const st = f.stages[f.si++], v = f.v;
  if (st.decouple.length) { v.parts = v.parts.filter((p) => !st.decouple.includes(p.id)); f.debris.push(...E.splitVessel(v)); }
  for (const p of v.parts) { if (st.ignite.includes(p.id)) p.on = true; if (st.chutes.includes(p.id)) p.deployed = true; }
}
{
  const f = fly('轨道号（两级入轨）'), v = f.v, b = E.BODIES.aeria;
  stage(f); v.throttle = 1;
  let ev = null, maxQ = 0;
  for (let i = 0; i < 60 * 50 * 20; i++) {
    const r = Math.hypot(v.pos.x, v.pos.y), alt = r - b.radius;
    const el = E.orbitElements(v.pos.x, v.pos.y, v.vel.x || 1e-9, v.vel.y, b.mu);
    // 重力转弯：目标俯仰随高度变化
    const up = Math.atan2(v.pos.y, v.pos.x) - Math.PI / 2;
    let pitch = alt < 800 ? 0 : Math.min(1.45, (alt - 800) / 26000 * 1.5);
    if (el.ra - b.radius > 45000) { pitch = Math.PI / 2; v.throttle = (alt > 30000 && Math.abs(r - el.ra) < 1500) || el.rp > b.radius ? 1 : 0; }
    if (alt > 30000 && el.ra - b.radius > 45000 && el.ra - r < 3000) v.throttle = 1;
    const err = Math.atan2(Math.sin(up - pitch - v.angle), Math.cos(up - pitch - v.angle));
    const rot = Math.abs(err) < 0.01 ? 0 : Math.sign(err - v.angVel * 0.5);
    if (f.si < 2 && !v.isThrusting() && v.throttle > 0) stage(f);
    ev = E.physStep(v, 0.02, rot); f.t += 0.02;
    maxQ = Math.max(maxQ, v.q);
    assert(ev !== 'crash', 'crashed during ascent');
    if (el.rp - b.radius > 32000 && el.e < 1) break;
  }
  const el = E.orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu);
  console.log('orbit: Pe', ((el.rp - b.radius) / 1e3).toFixed(1), 'km Ap', ((el.ra - b.radius) / 1e3).toFixed(1), 'km at T+', f.t.toFixed(0), 's maxQ', maxQ.toFixed(0), 'fuel left dv', v.activeDv().dv.toFixed(0));
  assert(el.rp - b.radius > 30000, 'reached orbit');
  // 在轨传播一圈
  const x0 = v.pos.x, y0 = v.pos.y;
  for (let i = 0; i < 100; i++) E.railStep(v, el.period / 100, f.t + i * el.period / 100);
  close(v.pos.x, x0, 5, 'rail period x'); close(v.pos.y, y0, 5, 'rail period y');
  assert.strictEqual(v.body, 'aeria');
  // 离轨：逆行点火，再分离返回舱、开伞
  v.throttle = 1;
  for (let i = 0; i < 50 * 400; i++) {
    const tgt = Math.atan2(v.vel.x, -v.vel.y);   // 机头指向逆行
    const err = Math.atan2(Math.sin(tgt - v.angle), Math.cos(tgt - v.angle));
    E.physStep(v, 0.02, Math.abs(err) < 0.01 ? 0 : Math.sign(err - v.angVel * 0.5));
    const e2 = E.orbitElements(v.pos.x, v.pos.y, v.vel.x, v.vel.y, b.mu);
    if (e2.rp < b.radius + 5000 || !v.isThrusting()) break;
  }
  v.throttle = 0;
  while (f.si < f.stages.length - 1) stage(f);
  let res = null, n = 0, deployed = false;
  while (!res && n++ < 50 * 4000) {
    const alt = Math.hypot(v.pos.x, v.pos.y) - b.radius;
    if (!deployed && alt < 2400) { stage(f); deployed = true; }
    res = E.physStep(v, 0.02, 0);
  }
  console.log('landing:', res, 'impact', v.impactSpeed && v.impactSpeed.toFixed(2), 'm/s, parts', v.parts.length);
  assert.strictEqual(res, 'land');
}

// 4. 引力范围切换与轨迹预测：从低轨做地月转移
{
  const b = E.BODIES.aeria, r = b.radius + 40000, t0 = 0;
  const a = (r + E.BODIES.selo.a) / 2, vp = Math.sqrt(b.mu * (2 / r - 1 / a));
  const tof = Math.PI * Math.sqrt(a * a * a / b.mu);
  // 让塞洛在到达时位于远点方向：出发点角度 = 塞洛届时角度 + π
  const moonAng = E.BODIES.selo.phase + E.BODIES.selo.n * tof;
  const dep = moonAng + Math.PI + 0.06;
  const o = { body: 'aeria', pos: { x: r * Math.cos(dep), y: r * Math.sin(dep) }, vel: { x: -vp * Math.sin(dep), y: vp * Math.cos(dep) }, landed: false };
  const segs = E.predictSegments('aeria', o.pos.x, o.pos.y, o.vel.x, o.vel.y, t0, 3);
  console.log('prediction:', segs.map((s) => s.body + (s.end ? '→' + s.end.type : '')).join(' | '));
  assert(segs.length >= 2 && segs[1].body === 'selo', 'encounter predicted');
  let t = t0, entered = false;
  for (let i = 0; i < 4000 && !entered; i++) { E.railStep(o, 60, t); t += 60; if (o.body === 'selo') entered = true; }
  assert(entered, 'entered selo SOI');
  const d = Math.hypot(o.pos.x, o.pos.y);
  assert(d < E.BODIES.selo.soi * 1.001, 'inside SOI');
  const el = E.orbitElements(o.pos.x, o.pos.y, o.vel.x, o.vel.y, E.BODIES.selo.mu);
  close(el.rp, segs[1].el.rp, 2000, 'predicted periapsis matches flown');
  console.log('selo flyby Pe', ((el.rp - E.BODIES.selo.radius) / 1e3).toFixed(0), 'km');
  for (let i = 0; i < 20000 && o.body === 'selo'; i++) { E.railStep(o, 60, t); t += 60; }
  assert.notStrictEqual(o.body, 'selo', 'left SOI again');
}
console.log('all tests passed');
