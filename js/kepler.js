'use strict';
// 二体轨道数学：普适变量法传播 + 轨道根数
function stumpC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / (-z);
  return 0.5 - z / 24;
}
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120;
}

function keplerPropagate(rx, ry, vx, vy, mu, dt) {
  if (dt === 0) return { x: rx, y: ry, vx, vy };
  if (dt < 0) {
    const s = keplerPropagate(rx, ry, -vx, -vy, mu, -dt);
    s.vx = -s.vx; s.vy = -s.vy;
    return s;
  }
  const r0 = Math.hypot(rx, ry), v2 = vx * vx + vy * vy, rv = rx * vx + ry * vy;
  const sm = Math.sqrt(mu);
  const alpha = 2 / r0 - v2 / mu;
  if (alpha > 0) {
    const T = 2 * Math.PI / (sm * Math.pow(alpha, 1.5));
    if (dt > T) dt = dt % T;
  }
  const F = (chi) => {
    const z = alpha * chi * chi;
    return rv / sm * chi * chi * stumpC(z) + (1 - alpha * r0) * chi * chi * chi * stumpS(z) + r0 * chi - sm * dt;
  };
  // F 单调递增，先找区间再做带保护的牛顿迭代
  let lo = 0, hi = alpha > 0 ? sm * dt * alpha : sm * dt / r0;
  if (!(hi > 0)) hi = 1;
  for (let i = 0; i < 200; i++) {
    const f = F(hi);
    if (!isFinite(f) || f >= 0) break;
    lo = hi; hi *= 2;
  }
  let chi = 0.5 * (lo + hi);
  for (let i = 0; i < 80; i++) {
    const z = alpha * chi * chi, C = stumpC(z), S = stumpS(z);
    const f = rv / sm * chi * chi * C + (1 - alpha * r0) * chi * chi * chi * S + r0 * chi - sm * dt;
    if (!isFinite(f) || f > 0) hi = chi; else lo = chi;
    const df = rv / sm * chi * (1 - z * S) + (1 - alpha * r0) * chi * chi * C + r0;
    let next = chi - f / df;
    if (!isFinite(next) || next <= lo || next >= hi) next = 0.5 * (lo + hi);
    if (Math.abs(next - chi) <= 1e-13 * Math.abs(chi)) { chi = next; break; }
    chi = next;
  }
  const z = alpha * chi * chi, C = stumpC(z), S = stumpS(z);
  const f = 1 - chi * chi / r0 * C, g = dt - chi * chi * chi / sm * S;
  const x = f * rx + g * vx, y = f * ry + g * vy;
  const r = Math.hypot(x, y);
  const fd = sm / (r * r0) * (z * S - 1) * chi, gd = 1 - chi * chi / r * C;
  return { x, y, vx: fd * rx + gd * vx, vy: fd * ry + gd * vy };
}

function orbitElements(rx, ry, vx, vy, mu) {
  const r = Math.hypot(rx, ry), v2 = vx * vx + vy * vy, rv = rx * vx + ry * vy;
  const h = rx * vy - ry * vx;
  const ex = ((v2 - mu / r) * rx - rv * vx) / mu, ey = ((v2 - mu / r) * ry - rv * vy) / mu;
  const e = Math.hypot(ex, ey);
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const p = h * h / mu;
  // 束缚轨道用半长轴计算，竖直上升（近乎径向）时也稳定
  const bound = energy < 0;
  const rp = bound ? Math.max(0, a * (1 - e)) : p / (1 + e);
  const ra = bound ? a * (1 + e) : Infinity;
  const w = e > 1e-9 ? Math.atan2(ey, ex) : Math.atan2(ry, rx);
  const period = bound ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;
  return { a, e, p, h, rp, ra, w, period, energy };
}

// 圆锥曲线可见的真近点角范围（±lim），超出 rmax 的部分被裁掉；轨道退化时返回 0
function conicLimit(el, rmax) {
  if (!(el.p > 1)) return 0;
  if (el.ra <= rmax) return Math.PI;
  if (!isFinite(rmax)) return el.e >= 1 ? Math.acos(-1 / el.e) * 0.995 : Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (el.p / rmax - 1) / el.e)));
}
function conicPoint(el, nu) {
  const r = el.p / (1 + el.e * Math.cos(nu));
  return [r * Math.cos(el.w + nu), r * Math.sin(el.w + nu)];
}
// 自适应采样：对落在视口内的弧段不断细分，直到每段在屏幕上不超过 maxPx 像素。
// toScreen(pt) -> [sx, sy]；返回屏幕坐标折线
function conicScreenPath(el, rmax, toScreen, W, H, maxPx) {
  const lim = conicLimit(el, rmax), out = [];
  if (!lim) return out;
  const at = (nu) => toScreen(conicPoint(el, nu));
  const sub = (n0, a, n1, b, depth) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > maxPx && depth < 22) {
      const m = len * 0.2 + 4;   // 弧相对弦的鼓出量留余量
      if (Math.max(a[0], b[0]) > -m && Math.min(a[0], b[0]) < W + m && Math.max(a[1], b[1]) > -m && Math.min(a[1], b[1]) < H + m) {
        const nm = 0.5 * (n0 + n1), mid = at(nm);
        sub(n0, a, nm, mid, depth + 1); sub(nm, mid, n1, b, depth + 1);
        return;
      }
    }
    out.push(b);
  };
  const N = 96;
  let pn = -lim, pp = at(pn);
  out.push(pp);
  for (let i = 1; i <= N; i++) { const nu = -lim + 2 * lim * i / N, pt = at(nu); sub(pn, pp, nu, pt, 0); pn = nu; pp = pt; }
  return out;
}
