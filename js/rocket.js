'use strict';
// 火箭结构：连接关系、分级、质量与 Δv 估算
function instantiate(design) {
  return design.map((d, i) => {
    const def = PARTS[d.type];
    return { id: i, type: d.type, def, x: d.x, y: d.y, w: def.w, h: def.h, fuel: def.fuel || 0, on: false, deployed: false, dep: 0, firing: 0 };
  });
}
function presetDesign(name) {
  return PRESETS[name].map(([type, x, y]) => ({ type, x, y }));
}
function touching(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (ox === 0 && oy > 0) || (oy === 0 && ox > 0);
}
function overlapping(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function analyze(parts) {
  const n = parts.length;
  const adj = parts.map(() => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (touching(parts[i], parts[j])) { adj[i].push(j); adj[j].push(i); }
  }
  let root = parts.findIndex((p) => p.type === 'capsule');
  if (root < 0) root = parts.findIndex((p) => p.def.command);
  // depth = 从根到该部件路径上最少要经过几个分离器
  const depth = new Array(n).fill(Infinity);
  if (root >= 0) {
    depth[root] = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (depth[i] === Infinity) continue;
        for (const j of adj[i]) {
          const d = depth[i] + (parts[j].def.decoupler ? 1 : 0);
          if (d < depth[j]) { depth[j] = d; changed = true; }
        }
      }
    }
  }
  // 燃料组：不跨越分离器的连通块
  const group = new Array(n).fill(-1);
  let ng = 0;
  for (let i = 0; i < n; i++) {
    if (group[i] >= 0 || parts[i].def.decoupler) continue;
    const stack = [i]; group[i] = ng;
    while (stack.length) {
      const k = stack.pop();
      for (const j of adj[k]) if (group[j] < 0 && !parts[j].def.decoupler) { group[j] = ng; stack.push(j); }
    }
    ng++;
  }
  return { adj, root, depth, group };
}

function components(parts) {
  const an = analyze(parts);
  const seen = new Array(parts.length).fill(false), out = [];
  for (let i = 0; i < parts.length; i++) {
    if (seen[i]) continue;
    const comp = [], stack = [i]; seen[i] = true;
    while (stack.length) {
      const k = stack.pop(); comp.push(parts[k]);
      for (const j of an.adj[k]) if (!seen[j]) { seen[j] = true; stack.push(j); }
    }
    out.push(comp);
  }
  return out;
}
// 去掉指定部件后，保留含指令部件的那一块
function rootComponent(parts) {
  const comps = components(parts);
  return comps.find((c) => c.some((p) => p.type === 'capsule')) || comps.find((c) => c.some((p) => p.def.command)) || comps[0] || [];
}

function buildStages(parts) {
  const an = analyze(parts);
  if (an.root < 0) return [];
  const conn = parts.map((p, i) => i).filter((i) => an.depth[i] < Infinity);
  let maxD = 0;
  for (const i of conn) maxD = Math.max(maxD, an.depth[i]);
  const blocked = (i) => parts.some((q) => q.y + q.h === parts[i].y && Math.min(q.x + q.w, parts[i].x + parts[i].w) - Math.max(q.x, parts[i].x) > 0);
  const stages = [];
  for (let D = maxD; D >= 0; D--) {
    const st = { ignite: [], decouple: [], chutes: [] };
    if (D < maxD) st.decouple = conn.filter((i) => parts[i].def.decoupler && an.depth[i] === D + 1).map((i) => parts[i].id);
    st.ignite = conn.filter((i) => parts[i].def.thrust && an.depth[i] === D).map((i) => parts[i].id);
    if (D === maxD && D > 0) {
      const decs = conn.filter((i) => parts[i].def.decoupler && an.depth[i] === D);
      if (decs.length && decs.every((i) => parts[i].def.side)) {
        for (const i of conn) if (parts[i].def.thrust && an.depth[i] === D - 1 && !blocked(i)) st.ignite.push(parts[i].id);
      }
    }
    if (st.ignite.length || st.decouple.length) stages.push(st);
  }
  const ch = conn.filter((i) => parts[i].def.chute).map((i) => parts[i].id);
  if (ch.length) stages.push({ ignite: [], decouple: [], chutes: ch });
  return stages;
}

function totalMass(parts) {
  let m = 0;
  for (const p of parts) m += p.def.mass + p.fuel;
  return m;
}

// 从燃料池中按比例抽取
function drainPool(pool, amount) {
  let avail = 0;
  for (const t of pool) avail += t.fuel;
  if (avail <= 0) return 0;
  const f = Math.min(1, amount / avail);
  for (const t of pool) t.fuel -= t.fuel * f;
  return avail * f;
}
function enginePool(parts, an, i) {
  const p = parts[i];
  if (p.def.srb) return [p];
  const g = an.group[i], pool = [];
  for (let k = 0; k < parts.length; k++) if (an.group[k] === g && parts[k].def.fuel && !parts[k].def.thrust) pool.push(parts[k]);
  return pool;
}

// 逐级估算 Δv / 推重比（真空比冲）
function stageStats(design) {
  let parts = instantiate(design);
  const stages = buildStages(parts);
  const out = [];
  for (let s = 0; s < stages.length; s++) {
    const st = stages[s];
    if (st.decouple.length) parts = rootComponent(parts.filter((p) => !st.decouple.includes(p.id)));
    for (const p of parts) if (st.ignite.includes(p.id)) p.on = true;
    const next = stages[s + 1];
    let dropped = null;
    if (next && next.decouple.length) {
      const keep = new Set(rootComponent(parts.filter((p) => !next.decouple.includes(p.id))).map((p) => p.id));
      dropped = new Set(parts.filter((p) => !keep.has(p.id)).map((p) => p.id));
    }
    const an = analyze(parts);
    const m0 = totalMass(parts);
    let dv = 0, thrust0 = 0, burn = 0;
    for (let iter = 0; iter < 60; iter++) {
      const act = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p.def.thrust || !p.on) continue;
        const pool = enginePool(parts, an, i);
        const fuel = pool.reduce((a, t) => a + t.fuel, 0);
        if (fuel > 1e-9) act.push({ p, pool, fuel, mdot: p.def.thrust / (p.def.ispVac * G0), key: p.def.srb ? 's' + i : 'g' + an.group[i] });
      }
      if (!act.length) break;
      // 下一级会抛掉的发动机烧完后就该分级了
      if (dropped && parts.some((p) => p.def.thrust && p.on && dropped.has(p.id)) && !act.some((a) => dropped.has(a.p.id))) break;
      const byKey = {};
      let F = 0, mdot = 0;
      for (const a of act) {
        (byKey[a.key] = byKey[a.key] || { fuel: a.fuel, mdot: 0, pool: a.pool }).mdot += a.mdot;
        F += a.p.def.thrust; mdot += a.mdot;
      }
      if (iter === 0) thrust0 = F;
      let tmin = Infinity;
      for (const k in byKey) tmin = Math.min(tmin, byKey[k].fuel / byKey[k].mdot);
      const m = totalMass(parts);
      dv += F / mdot * Math.log(m / (m - mdot * tmin));
      burn += tmin;
      for (const k in byKey) {
        const g = byKey[k];
        drainPool(g.pool, g.mdot * tmin);
        if (g.pool.reduce((a, t) => a + t.fuel, 0) < 1e-7) for (const t of g.pool) t.fuel = 0;
      }
    }
    out.push({ stage: st, mass: m0, dv, twr: thrust0 / (m0 * 9.8), burn });
  }
  return out;
}
