'use strict';
// 部件外观。坐标系：(0,0) 为部件左上角，x 向右，y 向下，单位为格（1 格 = 1 米）
function metalGrad(ctx, w, c0, c1, c2) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, c0); g.addColorStop(0.45, c1); g.addColorStop(1, c2);
  return g;
}
function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function bell(ctx, w, h, top, c0, c1, wideTop, wideBot) {
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(w * 0.2, 0, w * 0.6, top);
  ctx.fillStyle = metalGrad(ctx, w, c0, c1, c0);
  poly(ctx, [[w * (0.5 - wideTop), top], [w * (0.5 + wideTop), top], [w * (0.5 + wideBot), h], [w * (0.5 - wideBot), h]]);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(w * (0.5 - wideBot), h - 0.12, w * wideBot * 2, 0.12);
}

function drawPart(ctx, p, flip) {
  const w = p.w, h = p.h, type = p.type;
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = 'rgba(20,24,32,0.55)';
  switch (type) {
    case 'capsule':
      ctx.fillStyle = metalGrad(ctx, w, '#8f99a8', '#eef1f5', '#7c8696');
      poly(ctx, [[w * 0.28, 0], [w * 0.72, 0], [w, h * 0.88], [w, h], [0, h], [0, h * 0.88]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a2f38'; ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.fillStyle = '#17324d'; ctx.beginPath(); ctx.arc(w / 2, h * 0.45, w * 0.17, 0, 7); ctx.fill();
      ctx.fillStyle = '#6fc3ff'; ctx.beginPath(); ctx.arc(w / 2 - 0.06, h * 0.42, w * 0.07, 0, 7); ctx.fill();
      break;
    case 'probe':
      ctx.fillStyle = metalGrad(ctx, w, '#8a6a1f', '#e6c35a', '#7a5c18');
      poly(ctx, [[w * 0.15, 0], [w * 0.85, 0], [w, h * 0.3], [w, h], [0, h], [0, h * 0.3]]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#20252d'; ctx.fillRect(w * 0.35, h * 0.35, w * 0.3, h * 0.35);
      ctx.fillStyle = '#5dffa0'; ctx.fillRect(w * 0.42, h * 0.45, w * 0.06, h * 0.12);
      break;
    case 'chute': {
      ctx.fillStyle = '#d9622f';
      ctx.beginPath(); ctx.ellipse(w / 2, h, w * 0.3, h * 0.75, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f3efe6'; ctx.fillRect(w * 0.44, h * 0.3, w * 0.12, h * 0.7);
      if (p.dep > 0) {
        const k = p.dep, cw = 7 * (0.25 + 0.75 * k), top = -9 * k, ch = 3.2 * (0.4 + 0.6 * k);
        ctx.strokeStyle = 'rgba(230,230,230,0.8)'; ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) { ctx.moveTo(w / 2, h * 0.3); ctx.lineTo(w / 2 + i * cw / 4, top + ch); }
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? '#f3efe6' : '#e2622b';
          ctx.beginPath();
          ctx.moveTo(w / 2 - cw / 2 + i * cw / 4, top + ch);
          ctx.quadraticCurveTo(w / 2 - cw / 2 + (i + 0.5) * cw / 4 + (i - 1.5) * 0.3, top - ch * 0.45 * (1 - Math.abs(i - 1.5) / 3), w / 2 - cw / 2 + (i + 1) * cw / 4, top + ch);
          ctx.closePath(); ctx.fill();
        }
      }
      break;
    }
    case 'nose':
      ctx.fillStyle = metalGrad(ctx, w, '#9aa3b0', '#f4f6f9', '#8a94a2');
      ctx.beginPath(); ctx.moveTo(0, h); ctx.quadraticCurveTo(0, h * 0.35, w / 2, 0); ctx.quadraticCurveTo(w, h * 0.35, w, h); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d6452f';
      ctx.beginPath(); ctx.moveTo(w * 0.27, h * 0.3); ctx.quadraticCurveTo(w * 0.38, h * 0.08, w / 2, 0); ctx.quadraticCurveTo(w * 0.62, h * 0.08, w * 0.73, h * 0.3); ctx.closePath(); ctx.fill();
      break;
    case 'tankS': case 'tankM': case 'tankL': case 'tankXL':
      ctx.fillStyle = metalGrad(ctx, w, '#a3acb9', '#f7f8fa', '#929cab');
      ctx.fillRect(0, 0, w, h); ctx.strokeRect(0, 0, w, h);
      ctx.fillStyle = '#2d333d'; ctx.fillRect(0, 0, w, 0.22); ctx.fillRect(0, h - 0.22, w, 0.22);
      ctx.fillStyle = type === 'tankL' || type === 'tankXL' ? '#2f6fd0' : '#d6452f';
      ctx.fillRect(w * 0.12, h * 0.5 - 0.25, w * 0.1, 0.5);
      if (p.def && p.def.fuel && p.fuel < p.def.fuel) {
        ctx.fillStyle = 'rgba(40,48,60,0.28)';
        ctx.fillRect(0, 0.22, w, (h - 0.44) * (1 - p.fuel / p.def.fuel));
      }
      break;
    case 'engS': bell(ctx, w, h, h * 0.3, '#4a515b', '#9aa2ad', 0.14, 0.33); break;
    case 'engM': bell(ctx, w, h, h * 0.28, '#3d434c', '#8b929c', 0.18, 0.44); break;
    case 'engL':
      ctx.fillStyle = '#3a4048'; ctx.fillRect(w * 0.1, 0, w * 0.8, h * 0.25);
      for (const cx of [0.22, 0.5, 0.78]) {
        ctx.save(); ctx.translate(w * cx - w * 0.16, h * 0.2);
        bell(ctx, w * 0.32, h * 0.8, 0.2, '#3d434c', '#8b929c', 0.2, 0.5);
        ctx.restore();
      }
      break;
    case 'engV': bell(ctx, w, h, h * 0.22, '#3b4a66', '#9fb4d8', 0.12, 0.5); break;
    case 'srb':
      ctx.fillStyle = metalGrad(ctx, w, '#8d8f93', '#e4e5e7', '#7e8085');
      ctx.fillRect(0, 0, w, h * 0.88); ctx.strokeRect(0, 0, w, h * 0.88);
      ctx.fillStyle = '#e08a2c'; ctx.fillRect(0, h * 0.1, w, 0.25); ctx.fillRect(0, h * 0.7, w, 0.25);
      ctx.fillStyle = '#3a3f47';
      poly(ctx, [[w * 0.3, h * 0.88], [w * 0.7, h * 0.88], [w * 0.88, h], [w * 0.12, h]]); ctx.fill();
      if (p.def && p.fuel < p.def.fuel) { ctx.fillStyle = 'rgba(40,48,60,0.25)'; ctx.fillRect(0, 0, w, h * 0.88 * (1 - p.fuel / p.def.fuel)); }
      break;
    case 'decoupler': case 'decouplerL':
      ctx.fillStyle = '#262a31'; ctx.fillRect(0, h * 0.15, w, h * 0.7);
      ctx.fillStyle = '#f0c030';
      for (let x = 0.15; x < w - 0.2; x += 0.6) poly(ctx, [[x, h * 0.85], [x + 0.25, h * 0.85], [x + 0.5, h * 0.15], [x + 0.25, h * 0.15]]), ctx.fill();
      break;
    case 'sideSep':
      ctx.fillStyle = '#262a31'; ctx.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.6);
      ctx.fillStyle = '#f0c030'; ctx.fillRect(w * 0.1, h * 0.42, w * 0.8, h * 0.16);
      break;
    case 'adapter':
      ctx.fillStyle = metalGrad(ctx, w, '#7c8592', '#d9dde3', '#6f7886');
      poly(ctx, [[w * 0.25, 0], [w * 0.75, 0], [w, h], [0, h]]); ctx.fill(); ctx.stroke();
      break;
    case 'leg': {
      const ext = PARTS.leg.ext;
      ctx.save();
      if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
      // 默认朝右伸出
      ctx.strokeStyle = '#aab2bf'; ctx.lineWidth = 0.22; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0.1, 0.3); ctx.lineTo(w * 0.5 + 0.6, h + ext - 0.15); ctx.stroke();
      ctx.strokeStyle = '#6d7582'; ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(0.1, h - 0.3); ctx.lineTo(w * 0.5 + 0.45, h + ext * 0.6); ctx.stroke();
      ctx.strokeStyle = '#2d333d'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(w * 0.5 - 0.1, h + ext - 0.08); ctx.lineTo(w * 0.5 + 1.2, h + ext - 0.08); ctx.stroke();
      ctx.restore();
      break;
    }
  }
}

function drawFlame(ctx, p, power, vac) {
  const w = p.w, h = p.h;
  const base = p.type === 'engL' ? 0.42 : p.type === 'engM' || p.type === 'srb' ? 0.36 : 0.3;
  const len = (p.type === 'engL' ? 9 : p.type === 'engV' ? 3 : 5.5) * (0.35 + 0.65 * power) * (0.9 + Math.random() * 0.2);
  const spread = vac ? 1.9 : 1;
  const g = ctx.createLinearGradient(0, h, 0, h + len);
  if (p.type === 'srb') { g.addColorStop(0, 'rgba(255,240,200,0.95)'); g.addColorStop(0.3, 'rgba(255,170,60,0.8)'); g.addColorStop(1, 'rgba(255,90,20,0)'); }
  else { g.addColorStop(0, 'rgba(220,240,255,0.95)'); g.addColorStop(0.25, 'rgba(255,200,90,0.8)'); g.addColorStop(1, 'rgba(255,110,30,0)'); }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(w * (0.5 - base), h);
  ctx.quadraticCurveTo(w * (0.5 - base * spread), h + len * 0.5, w * 0.5, h + len);
  ctx.quadraticCurveTo(w * (0.5 + base * spread), h + len * 0.5, w * (0.5 + base), h);
  ctx.closePath(); ctx.fill();
}

// 在已设好变换（原点 = 质心，y 向下，单位 = 米）的画布上绘制整枚火箭
function drawVesselParts(ctx, parts, com, midX, vac) {
  for (const p of parts) {
    ctx.save();
    ctx.translate(p.x - com.x, -(p.y + p.h - com.y));
    if (p.firing > 0) drawFlame(ctx, p, p.firing, vac);
    drawPart(ctx, p, p.x + p.w / 2 < midX);
    ctx.restore();
  }
}
