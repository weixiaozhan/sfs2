'use strict';
// 星轨工坊 —— 天体与部件数据（单位：米 / 秒 / 吨 / 千牛）
const G0 = 9.80665;
const CHUTE_MAX_ALT = 2500;   // 降落伞可开伞的最大离地高度（米）

const BODIES = {
  helion: { name: '赫利昂', kind: 'star', radius: 3.5e7, mu: 3.3e17, parent: null, color: '#ffd27a' },
  vespa: {
    name: '维斯帕', parent: 'helion', a: 5.4e9, phase: 2.1, radius: 3.0e5, g: 8.9, color: '#d2a55e',
    atmo: { height: 45000, scale: 9000, rho0: 5, color: [226, 176, 104] },
  },
  aeria: {
    name: '艾瑞亚', parent: 'helion', a: 7.48e9, phase: 0, radius: 3.2e5, g: 9.8, color: '#3c8f52',
    atmo: { height: 30000, scale: 5000, rho0: 1.2, color: [96, 160, 255] },
  },
  selo: { name: '塞洛', parent: 'aeria', a: 2.0e7, phase: 1.0, radius: 8.5e4, g: 1.62, color: '#8d9097' },
  rubra: {
    name: '鲁布拉', parent: 'helion', a: 1.14e10, phase: 0.8, radius: 1.7e5, g: 3.7, color: '#b8502f',
    atmo: { height: 20000, scale: 4500, rho0: 0.12, color: [232, 150, 110] },
  },
};
const BODY_IDS = Object.keys(BODIES);
for (const id of BODY_IDS) {
  const b = BODIES[id];
  b.id = id;
  b.children = [];
  if (b.g) b.mu = b.g * b.radius * b.radius;
}
for (const id of BODY_IDS) {
  const b = BODIES[id];
  if (!b.parent) { b.soi = Infinity; continue; }
  const p = BODIES[b.parent];
  p.children.push(id);
  b.n = Math.sqrt(p.mu / (b.a * b.a * b.a));
  b.soi = b.a * Math.pow(b.mu / p.mu, 0.4);
}

function atmoDensity(b, alt) {
  const a = b.atmo;
  if (!a || alt >= a.height) return 0;
  const fade = Math.min(1, (a.height - alt) / (0.2 * a.height));
  return a.rho0 * Math.exp(-Math.max(alt, 0) / a.scale) * fade;
}

const PARTS = {
  capsule: { name: '指令舱', cat: '指令', w: 2, h: 2, mass: 1.2, command: true, desc: '载人指令舱，火箭的大脑' },
  probe: { name: '探测核心', cat: '指令', w: 2, h: 1, mass: 0.25, command: true, desc: '轻量无人控制核心' },
  chute: { name: '降落伞', cat: '指令', w: 2, h: 1, mass: 0.1, chute: true, desc: '2500 m 以下的大气中可开伞' },
  nose: { name: '整流罩', cat: '结构', w: 2, h: 2, mass: 0.1, nose: true, desc: '降低空气阻力' },
  tankS: { name: '燃料箱 S', cat: '燃料', w: 2, h: 2, mass: 0.2, fuel: 1.8, desc: '燃料 1.8 t' },
  tankM: { name: '燃料箱 M', cat: '燃料', w: 2, h: 4, mass: 0.4, fuel: 3.6, desc: '燃料 3.6 t' },
  tankL: { name: '燃料箱 L', cat: '燃料', w: 4, h: 4, mass: 0.8, fuel: 7.2, desc: '燃料 7.2 t' },
  tankXL: { name: '燃料箱 XL', cat: '燃料', w: 4, h: 8, mass: 1.6, fuel: 14.4, desc: '燃料 14.4 t' },
  engS: { name: '“雨燕”发动机', cat: '动力', w: 2, h: 2, mass: 0.35, thrust: 50, ispVac: 320, ispSL: 250, desc: '50 kN · 比冲 320 s' },
  engM: { name: '“苍鹭”发动机', cat: '动力', w: 2, h: 2, mass: 0.9, thrust: 180, ispVac: 290, ispSL: 255, desc: '180 kN · 比冲 290 s' },
  engL: { name: '“巨鲸”发动机', cat: '动力', w: 4, h: 3, mass: 3.0, thrust: 750, ispVac: 280, ispSL: 250, desc: '750 kN · 比冲 280 s' },
  engV: { name: '“深空”发动机', cat: '动力', w: 2, h: 2, mass: 0.3, thrust: 30, ispVac: 400, ispSL: 120, desc: '30 kN · 真空比冲 400 s' },
  srb: { name: '“火炬”固推', cat: '动力', w: 2, h: 6, mass: 0.8, fuel: 4.5, thrust: 220, ispVac: 230, ispSL: 210, srb: true, desc: '220 kN · 点燃后无法关闭' },
  decoupler: { name: '分离器', cat: '结构', w: 2, h: 1, mass: 0.05, decoupler: true, desc: '上下级分离' },
  decouplerL: { name: '大分离器', cat: '结构', w: 4, h: 1, mass: 0.1, decoupler: true, desc: '4 m 级间分离' },
  sideSep: { name: '侧向分离器', cat: '结构', w: 1, h: 2, mass: 0.05, decoupler: true, side: true, desc: '用于捆绑助推器' },
  adapter: { name: '变径段', cat: '结构', w: 4, h: 1, mass: 0.15, desc: '连接 4 m 与 2 m 部件' },
  leg: { name: '着陆腿', cat: '结构', w: 1, h: 2, mass: 0.05, leg: true, ext: 2.3, desc: '提高着陆耐撞速度' },
};
for (const k of Object.keys(PARTS)) PARTS[k].id = k;

const PRESETS = {
  '新手号（亚轨道）': [
    ['engM', -1, 0], ['tankM', -1, 2], ['decoupler', -1, 6], ['capsule', -1, 7], ['chute', -1, 9],
  ],
  '轨道号（两级入轨）': [
    ['engM', -1, 0], ['tankM', -1, 2], ['tankM', -1, 6], ['decoupler', -1, 10],
    ['engS', -1, 11], ['tankM', -1, 13], ['decoupler', -1, 17], ['capsule', -1, 18], ['chute', -1, 20],
  ],
  '探月号（登月往返）': [
    ['engM', -1, 0], ['tankM', -1, 2], ['tankM', -1, 6], ['decoupler', -1, 10],
    ['sideSep', -2, 4], ['sideSep', 1, 4],
    ['engM', -4, 0], ['tankM', -4, 2], ['nose', -4, 6],
    ['engM', 2, 0], ['tankM', 2, 2], ['nose', 2, 6],
    ['engS', -1, 11], ['tankM', -1, 13], ['decoupler', -1, 17],
    ['engS', -1, 18], ['tankM', -1, 20], ['leg', -2, 20], ['leg', 1, 20],
    ['decoupler', -1, 24], ['capsule', -1, 25], ['chute', -1, 27],
  ],
};

const MISSIONS = [
  { id: 'alt5', text: '飞到 5 km 高空' },
  { id: 'space', text: '冲出大气层（30 km）' },
  { id: 'orbit', text: '进入环绕艾瑞亚的稳定轨道' },
  { id: 'return', text: '从太空返回并安全着陆' },
  { id: 'seloSoi', text: '进入塞洛的引力范围' },
  { id: 'seloOrbit', text: '环绕塞洛' },
  { id: 'seloLand', text: '登陆塞洛' },
  { id: 'seloReturn', text: '登陆塞洛后返回艾瑞亚' },
  { id: 'escape', text: '逃离艾瑞亚，环绕赫利昂' },
  { id: 'rubraSoi', text: '抵达鲁布拉' },
  { id: 'rubraLand', text: '登陆鲁布拉' },
];

function fmtDist(m) {
  const a = Math.abs(m);
  if (!isFinite(m)) return '∞';
  if (a < 1e4) return m.toFixed(0) + ' m';
  if (a < 1e7) return (m / 1e3).toFixed(1) + ' km';
  if (a < 1e10) return (m / 1e6).toFixed(2) + ' Mm';
  return (m / 1e9).toFixed(2) + ' Gm';
}
function fmtTime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (d ? d + '天 ' : '') + p(h) + ':' + p(m) + ':' + p(ss);
}
