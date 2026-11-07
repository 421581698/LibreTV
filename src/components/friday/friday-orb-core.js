/* ==========================================================================
 * FridayOrb Core · 金界展开 / J.A.R.V.I.S. Sigil
 * --------------------------------------------------------------------------
 * 从 golden-sigil-jarvis.html 抽取的 Canvas 2D 渲染内核，零依赖。
 * 网页实时渲染、组件预览与视频导出共用同一个 drawScene。
 *
 * 保留：八层绘制架构 / 九条蓝白金立体丝带 / 信标光核 / 激光扇区光柱 /
 *       工程刻度环 / 星尘拖尾 / 昼夜双主题 / 6 秒 30FPS 无缝循环
 * 移除：立体线框球体（原文件本来就没有）/ 页面外壳与按钮
 * 新增：受控 state 时间倍率、audioLevel 能量驱动、实例级生命周期
 *
 * 用法：
 *   import { createFridayOrb } from './friday-orb-core.js'
 *   const orb = createFridayOrb(canvas, { state: 'IDLE', audioLevel: 0 })
 *   orb.setState('LISTENING'); orb.setAudioLevel(64); orb.destroy()
 * ========================================================================== */
var TAU = Math.PI * 2;
var DUR = 6;
var FPS = 30;
var EXT = 1.24;   /* 内容真实外径（相对 R），含光雾与刻度环 */
var SAFE = 0.92;  /* 安全框占短边比例，四周均匀留白不裁切 */
var STATE_PACE = {
  IDLE: 1.00,
  LISTENING: 1.45,
  THINKING: 2.10,
  SPEAKING: 1.25
};
var STATE_ACTIVITY = {
  IDLE: 0.15,
  LISTENING: 0.55,
  THINKING: 0.80,
  SPEAKING: 0.62
};
var VALID_STATES = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING'];
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
/* 音频表头的非对称低通：起音灵敏、回落柔和，抑制 RMS 抖动。 */
export function smoothFridayEnergy(current, target, dt){
  var safeDt = clamp(Number(dt) || 0, 0, 0.12);
  var goal = clamp(Number(target) || 0, 0, 1);
  var tau = goal > current ? 0.085 : 0.24;
  var alpha = 1 - Math.exp(-safeDt / tau);
  return clamp(current + (goal - current) * alpha, 0, 1);
}
function lerp(a, b, t){ return a + (b - a) * t; }
function hexToRgb(h){
  var s = h.charAt(0) === '#' ? h.slice(1) : h;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function mixRgb(a, b, t){
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function css(c, a){
  a = a < 0 ? 0 : (a > 1 ? 1 : a);
  return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';
}
function mulberry32(seed){
  var a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function buildRamp(list){
  var cols = list.map(hexToRgb);
  return function(s){
    s = s - Math.floor(s);
    var n = cols.length - 1;
    var x = s * n;
    var i = Math.min(n - 1, Math.floor(x));
    return mixRgb(cols[i], cols[i + 1], x - i);
  };
}
function radiusFor(W, H){
  return Math.min(W, H) * 0.5 * SAFE / EXT;
}
/* --------------------------------------------------------------------------
 * 1 · 双主题色板
 * -------------------------------------------------------------------------- */
var PALETTES = {
  dark: {
    additive: true,
    ramp: buildRamp(['#1E5BFF', '#4FB6FF', '#BFEFFF', '#FFFFFF', '#FFD98C', '#FFB23C', '#FFFFFF', '#8FE0FF', '#1E5BFF']),
    hud: [127, 224, 255],
    warm: [255, 201, 106],
    neon: [150, 232, 255],
    ink: [196, 234, 255],
    grid: [104, 196, 255],
    ray: [186, 226, 255],
    rayGold: [255, 210, 142],
    coreMid: [255, 217, 140],
    coreOut: [255, 158, 50],
    dust: ['#FFFFFF', '#FFE3AE', '#BEE8FF'],
    hazeWarm: [255, 176, 74],
    hazeCool: [72, 130, 255],
    bloom: 0.345,
    hudA: 1.00
  },
  light: {
    additive: false,
    ramp: buildRamp(['#174B83', '#3D8BCB', '#D9EEFF', '#F4F0FF', '#B98224', '#FFF0C4', '#E7F4FF', '#6BA5D8', '#174B83']),
    hud: [31, 111, 178],
    warm: [184, 126, 24],
    neon: [62, 151, 222],
    ink: [36, 78, 138],
    grid: [58, 110, 176],
    ray: [64, 116, 178],
    rayGold: [194, 145, 48],
    coreMid: [246, 196, 94],
    coreOut: [190, 132, 30],
    dust: ['#B8862B', '#7A5A1C', '#3F6FA8'],
    hazeWarm: [232, 184, 88],
    hazeCool: [116, 174, 232],
    bloom: 0.12,
    hudA: 1.05
  }
};
/* --------------------------------------------------------------------------
 * 2 · 确定性静态模型（同一主题每次构建完全一致）
 * -------------------------------------------------------------------------- */
var MODELS = {};
function buildModel(theme){
  var rnd = mulberry32(theme === 'dark' ? 0x51C1A7 : 0x2F8B3D);
  var dust = [], rays = [], spirals = [], i;
  for(i = 0; i < 96; i++){
    dust.push({
      a: rnd() * TAU,
      r: 0.28 + 0.84 * Math.pow(rnd(), 0.62),
      spd: (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)),
      size: 0.55 + rnd() * 1.8,
      tw: rnd() * TAU,
      twk: 1 + Math.floor(rnd() * 3),
      col: Math.floor(rnd() * 3),
      bright: 0.35 + rnd() * 0.65,
      tail: 1 + Math.floor(rnd() * 2)
    });
  }
  for(i = 0; i < 28; i++){
    rays.push({
      a: (i / 28) * TAU + (rnd() - 0.5) * 0.05,
      len: 0.46 + rnd() * 0.42,
      w: 0.0016 + rnd() * 0.0032,
      k: 1 + Math.floor(rnd() * 3),
      ph: rnd() * TAU,
      gold: rnd() < 0.30
    });
  }
  var beams = [
    { a: 0.02, len: 1.12, w: 0.016 },
    { a: Math.PI * 0.5 + 0.12, len: 0.94, w: 0.012 },
    { a: Math.PI + 0.03, len: 1.08, w: 0.014 },
    { a: Math.PI * 1.5 - 0.09, len: 0.90, w: 0.010 },
    { a: Math.PI * 0.25, len: 0.82, w: 0.009 }
  ];
  for(i = 0; i < 6; i++){
    spirals.push({
      base: (i / 6) * TAU + 0.4,
      r0: 0.15 + (i / 6) * 0.13,
      sweep: 1.9 + (i % 3) * 0.4,
      dir: i % 2 === 0 ? 1 : -1,
      ph: rnd() * TAU,
      gold: i % 3 === 0,
      alpha: 0.055 + rnd() * 0.045
    });
  }
  return {
    dust: dust, rays: rays, beams: beams, spirals: spirals,
    ramp: PALETTES[theme].ramp
  };
}
function modelFor(theme){
  if(!MODELS[theme]) MODELS[theme] = buildModel(theme);
  return MODELS[theme];
}
/* 丝带轨道：六条环绕丝带 + 三条穿心花瓣丝带，共九条，无线框球体 */
var RIBBONS = [
  { type: 'ring',  rad: 0.975, asp: 0.70, rot: -0.10, w: 0.046, cc: 1, co: 0.02, cd: 1,
    tl: 2, ts: 2, tp: 0.0, pre: 0.045, ph: 0.0, lobes: 3, wob: 0.016, wp: 0.4, zp: 0.0, zs: 2,
    alpha: 0.97, n: 190, metal: true },
  { type: 'ring',  rad: 0.866, asp: 0.50, rot: 0.62, w: 0.036, cc: 1, co: 0.34, cd: -1,
    tl: 3, ts: -2, tp: 1.2, pre: 0.058, ph: 1.7, lobes: 5, wob: 0.022, wp: 1.1, zp: 0.9, zs: -2,
    alpha: 0.94, n: 180, metal: true },
  { type: 'petal', rad: 0.618, amp: 0.355, asp: 0.62, rot: 0.16, w: 0.070, cc: 1, co: 0.00, cd: 1,
    tl: 2, ts: 2, tp: 0.6, pre: 0.052, ph: 0.6, lobes: 3, wob: 0.009, wp: 0.2, zp: 0.0, zs: 2,
    alpha: 0.97, n: 220, metal: true },
  { type: 'petal', rad: 0.598, amp: 0.326, asp: 0.74, rot: 2.28, w: 0.054, cc: 1, co: 0.47, cd: -1,
    tl: 3, ts: -2, tp: 2.2, pre: -0.046, ph: 2.2, lobes: 4, wob: 0.011, wp: 1.4, zp: 1.5, zs: -2,
    alpha: 0.94, n: 220, metal: true },
  { type: 'ring',  rad: 0.740, asp: 0.86, rot: 0.24, w: 0.040, cc: 1, co: 0.60, cd: 1,
    tl: 2, ts: 3, tp: 2.4, pre: 0.036, ph: 3.1, lobes: 4, wob: 0.018, wp: 2.2, zp: 1.7, zs: 3,
    alpha: 0.95, n: 180, metal: false },
  { type: 'petal', rad: 0.558, amp: 0.306, asp: 0.54, rot: 4.30, w: 0.044, cc: 1, co: 0.25, cd: 1,
    tl: 3, ts: 1, tp: 4.1, pre: 0.038, ph: 4.1, lobes: 5, wob: 0.011, wp: 2.6, zp: 2.6, zs: 1,
    alpha: 0.93, n: 210, metal: false },
  { type: 'ring',  rad: 0.614, asp: 0.58, rot: -0.56, w: 0.030, cc: 1, co: 0.16, cd: -1,
    tl: 3, ts: -3, tp: 0.7, pre: 0.048, ph: 4.4, lobes: 3, wob: 0.024, wp: 0.8, zp: 2.4, zs: -1,
    alpha: 0.92, n: 170, metal: false },
  { type: 'ring',  rad: 0.490, asp: 0.80, rot: 0.95, w: 0.034, cc: 1, co: 0.47, cd: 1,
    tl: 2, ts: 1, tp: 3.3, pre: 0.062, ph: 5.2, lobes: 6, wob: 0.016, wp: 1.9, zp: 0.3, zs: 1,
    alpha: 0.94, n: 170, metal: false },
  { type: 'ring',  rad: 0.370, asp: 0.56, rot: 0.12, w: 0.024, cc: 1, co: 0.79, cd: -1,
    tl: 3, ts: -1, tp: 2.0, pre: 0.052, ph: 2.6, lobes: 4, wob: 0.022, wp: 2.7, zp: 1.3, zs: -2,
    alpha: 0.92, n: 160, metal: false }
];
/* HUD 外弧段（dir 决定转向，k 为 6 秒内圈数，整数保证无缝） */
var ARCS = [
  { r: 1.168, a0: 0.06, a1: 0.42, w: 0.0052, dir: 1, col: 'hud',  k: 1 },
  { r: 1.168, a0: 0.50, a1: 0.76, w: 0.0052, dir: 1, col: 'hud',  k: 1 },
  { r: 1.168, a0: 0.84, a1: 1.14, w: 0.0040, dir: 1, col: 'hud',  k: 1 },
  { r: 1.128, a0: 0.10, a1: 0.31, w: 0.0068, dir: -1, col: 'warm', k: 2 },
  { r: 1.128, a0: 0.38, a1: 0.53, w: 0.0068, dir: -1, col: 'warm', k: 2 },
  { r: 1.128, a0: 0.61, a1: 0.93, w: 0.0068, dir: -1, col: 'warm', k: 2 },
  { r: 1.128, a0: 1.00, a1: 1.16, w: 0.0055, dir: -1, col: 'warm', k: 2 },
  { r: 1.082, a0: 0.03, a1: 0.97, w: 0.0026, dir: 1, col: 'hud',  k: 1 }
];
var TOKENS = [
  'SYS.OK', 'AZ 114', 'EL 22.6', '0xA3F', 'LNK 98', 'CRC OK', 'NODE-7', 'DL .042',
  '1.16R', 'SYNC', 'BUF 12', 'PH 21.4', 'TH 037', 'READY', '0x5E2', 'DL .071', 'TRK 04', 'IDLE',
  'PWR 74', 'GATE 3', 'VEC 08', 'CAL OK'
];

export function createFridayOrb(canvas, options){
  if(!canvas || typeof canvas.getContext !== 'function'){ throw new Error('FridayOrb: 需要一个有效的 <canvas> 元素'); }
  var opts = Object.assign({ theme: 'dark', state: 'IDLE', audioLevel: 0, paused: false, interactive: true, autoPause: true, respectReducedMotion: true, dprCap: 2, quality: 0, ariaLabel: '', onBurst: null, onVisibility: null, onThemeChange: null }, options || {});
  var ctx = canvas.getContext('2d', { alpha: true });
  if(!ctx) throw new Error('FridayOrb: 当前环境不支持 Canvas 2D');
  var gridCache = { key: '', c: null };
  var bloomCanvas = null;
  var exportCanvas = null;
  var state = {
    theme: 'dark', t: 0.9, clock: 0.9,
    pace: STATE_PACE[normalizeState(opts.state)], targetPace: STATE_PACE[normalizeState(opts.state)],
    energy: clamp(opts.audioLevel / 100, 0, 1), targetEnergy: clamp(opts.audioLevel / 100, 0, 1),
    activity: STATE_ACTIVITY[normalizeState(opts.state)], phase: normalizeState(opts.state),
    paused: !!opts.paused, autoPaused: !!(opts.autoPause && typeof document !== 'undefined' && document.hidden), reduced: false, running: false,
    raf: 0, last: 0, lastRender: 0, frames: 0, flashAt: -99, bursts: []
  };
  var cssW = 0, cssH = 0, dpr = 1;
  var mqReduce = null, mqLight = null;
  var ro = null;
  var destroyed = false;

  function normalizeState(v){
    var s = String(v == null ? 'IDLE' : v).toUpperCase();
    return VALID_STATES.indexOf(s) >= 0 ? s : 'IDLE';
  }

  function gridLayer(W, H, theme, pal){
    var key = W + '|' + H + '|' + theme;
    if(gridCache.key === key && gridCache.c) return gridCache.c;
    var s = Math.max(32, Math.ceil(Math.min(W, H)));
    var c = document.createElement('canvas'); c.width = s; c.height = s;
    var g = c.getContext('2d'); var R = radiusFor(W, H); var ox = s * 0.5, oy = s * 0.5; var i, a, rr;
    g.lineWidth = 1; g.strokeStyle = css(pal.grid, pal.additive ? 0.10 : 0.075);
    for(i = 1; i <= 6; i++){ rr = R * (0.18 + i * 0.172); g.beginPath(); g.arc(ox, oy, rr, 0, TAU); g.stroke(); }
    g.save(); g.setLineDash([2, 7]); g.strokeStyle = css(pal.grid, pal.additive ? 0.13 : 0.09);
    for(i = 0; i < 24; i++){ a = (i / 24) * TAU; g.beginPath(); g.moveTo(ox + Math.cos(a) * R * 0.22, oy + Math.sin(a) * R * 0.22); g.lineTo(ox + Math.cos(a) * R * 1.20, oy + Math.sin(a) * R * 1.20); g.stroke(); }
    g.restore(); g.fillStyle = css(pal.grid, pal.additive ? 0.22 : 0.14); var dotR = Math.max(0.7, R * 0.006);
    for(i = 0; i < 36; i++){ a = (i / 36) * TAU + 0.05; rr = R * 1.20; g.beginPath(); g.arc(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr, dotR, 0, TAU); g.fill(); }
    gridCache = { key: key, c: c }; return c;
  }

  function drawBackdrop(W, H, cx, cy, R, pal, theme, t){
    var layer = gridLayer(W, H, theme, pal); var s = layer.width;
    ctx.save(); ctx.globalAlpha = 0.85 + 0.15 * Math.sin(TAU * t / DUR); ctx.drawImage(layer, cx - s * 0.5, cy - s * 0.5, s, s); ctx.restore();
  }

  function drawHaze(cx, cy, R, pal, t, glow){
    var breath = 1 + 0.025 * Math.sin(TAU * t / DUR);
    var g = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 1.19 * breath);
    g.addColorStop(0, css(pal.hazeWarm, (pal.additive ? 0.15 : 0.060) * glow)); g.addColorStop(0.30, css(pal.hazeWarm, (pal.additive ? 0.065 : 0.024) * glow));
    g.addColorStop(0.60, css(pal.hazeCool, (pal.additive ? 0.055 : 0.020) * glow)); g.addColorStop(1, css(pal.hazeCool, 0));
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.19 * breath, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawRadar(cx, cy, R, pal, t, u, activity){
    var base = -Math.PI * 0.5 + TAU * t / DUR; var span = 0.66; var seg = 18; var i, a0, a1, al;
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    for(i = 0; i < seg; i++){
      a0 = base - span * (i + 1) / seg; a1 = base - span * i / seg; al = (pal.additive ? 0.075 : 0.050) * Math.pow(1 - i / seg, 1.5);
      ctx.fillStyle = css(pal.hud, al * pal.hudA * (1 + activity * 0.35)); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.03, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = css(pal.hud, (pal.additive ? 0.22 : 0.16) * pal.hudA * (1 + activity * 0.4)); ctx.lineWidth = Math.max(0.6, 1.1 * u);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(base) * R * 1.03, cy + Math.sin(base) * R * 1.03); ctx.stroke(); ctx.restore();
  }

  function drawSpirals(cx, cy, R, t, pal, model, u){
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over'; ctx.lineCap = 'round';
    for(var k = 0; k < model.spirals.length; k++){
      var sp = model.spirals[k]; var steps = 30; var prevX = 0, prevY = 0;
      for(var j = 0; j <= steps; j++){
        var f = j / steps; var rr = R * (sp.r0 + f * 0.94); var a = sp.base + f * sp.sweep + sp.dir * TAU * t / DUR;
        var x = cx + Math.cos(a) * rr; var y = cy + Math.sin(a) * rr * 0.94;
        if(j > 0){
          var alpha = sp.alpha * Math.sin(f * Math.PI) * (pal.additive ? 1 : 0.7); var col = sp.gold ? pal.warm : pal.hud;
          ctx.strokeStyle = css(col, alpha); ctx.lineWidth = Math.max(0.45, (0.5 + 1.4 * Math.sin(f * Math.PI)) * u);
          ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(x, y); ctx.stroke();
        }
        prevX = x; prevY = y;
      }
    }
    ctx.restore();
  }

  function drawRibbon(cx, cy, R, cfg, t, pal, ramp, u, q, glow){
    function N(v, d){ return (typeof v === 'number' && isFinite(v)) ? v : d; }
    var rad = N(cfg.rad, 0.8), asp = N(cfg.asp, 0.72); var rot0 = N(cfg.rot, 0), pre = N(cfg.pre, 0), ph = N(cfg.ph, 0);
    var w0 = N(cfg.w, 0.04), lobes = N(cfg.lobes, 3), wob = N(cfg.wob, 0), wp = N(cfg.wp, 0);
    var zp = N(cfg.zp, 0), zs = N(cfg.zs, 0); var cc = N(cfg.cc, 1), co = N(cfg.co, 0), cd = N(cfg.cd, 1), al = N(cfg.alpha, 0.94);
    var tl = N(cfg.tl, 2), ts = N(cfg.ts, 0), tp = N(cfg.tp, 0), amp = N(cfg.amp, 0); var metal = !!cfg.metal; var isPetal = cfg.type === 'petal';
    var n = Math.max(80, Math.round(N(cfg.n, 170) * q)); var rot = rot0 + pre * Math.sin(TAU * t / DUR + ph);
    var cr = Math.cos(rot), sr = Math.sin(rot); var twist = TAU * ts * t / DUR + tp;
    var pts = [], i, th, rr, x0, y0, z;
    for(i = 0; i < n; i++){
      th = i / n * TAU; rr = isPetal ? R * (rad + amp * Math.cos(th - ph)) : R * rad; rr *= 1 + wob * Math.sin(lobes * th + wp);
      x0 = Math.cos(th) * rr; y0 = Math.sin(th) * rr * asp; z = Math.sin(lobes * th + zp + TAU * zs * t / DUR);
      pts.push({ x: cx + x0 * cr - y0 * sr, y: cy + x0 * sr + y0 * cr, z: z, th: th });
    }
    if(!isFinite(pts[0].x) || !isFinite(pts[0].y)) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = css(pal.hazeWarm, (pal.additive ? 0.045 : 0.028) * glow);
    ctx.lineWidth = R * w0 * 2.3; ctx.lineJoin = 'round'; ctx.beginPath();
    for(i = 0; i < n; i++){ if(i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y); }
    ctx.closePath(); ctx.stroke(); ctx.restore();
    var segs = [], p, pn, pp, dx, dy, dl, w, sg;
    for(i = 0; i < n; i++){
      p = pts[i]; pn = pts[(i + 1) % n]; pp = pts[(i - 1 + n) % n];
      dx = pn.x - pp.x; dy = pn.y - pp.y; dl = Math.sqrt(dx * dx + dy * dy) || 1;
      w = R * w0 * (0.34 + 0.66 * Math.abs(Math.cos(tl * p.th + twist))); if(!isFinite(w)) w = R * w0 * 0.5;
      segs.push({ z: (p.z + pn.z) * 0.5, x1: p.x, y1: p.y, x2: pn.x, y2: pn.y, nx: -dy / dl, ny: dx / dl, w: w, col: ramp((p.th / TAU) * cc + co + cd * t / DUR), dep: (p.z + 1) * 0.5 });
    }
    segs.sort(function(a, b){ return a.z - b.z; }); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for(i = 0; i < segs.length; i++){
      sg = segs[i]; var dep = sg.dep; var dk = pal.additive ? (0.52 + 0.48 * dep) : (0.80 + 0.20 * dep);
      var base = [sg.col[0] * dk, sg.col[1] * dk, sg.col[2] * dk];
      if(metal && dep < 0.62){
        var deep = pal.additive ? [base[0] * 0.28, base[1] * 0.28, base[2] * 0.28] : mixRgb(base, [24, 54, 98], 0.55);
        ctx.strokeStyle = css(deep, al * (pal.additive ? 0.58 + 0.30 * dep : 0.30 + 0.20 * dep)); ctx.lineWidth = sg.w * 0.34;
        ctx.beginPath(); ctx.moveTo(sg.x1 - sg.nx * sg.w * 0.32, sg.y1 - sg.ny * sg.w * 0.32); ctx.lineTo(sg.x2 - sg.nx * sg.w * 0.32, sg.y2 - sg.ny * sg.w * 0.32); ctx.stroke();
      }
      ctx.strokeStyle = css(base, al * (0.62 + 0.38 * dep)); ctx.lineWidth = sg.w;
      ctx.beginPath(); ctx.moveTo(sg.x1, sg.y1); ctx.lineTo(sg.x2, sg.y2); ctx.stroke();
      var lit = mixRgb(base, [255, 255, 255], pal.additive ? 0.62 : 0.34);
      ctx.strokeStyle = css(lit, al * (0.62 + 0.34 * dep)); ctx.lineWidth = Math.max(0.7 * u, sg.w * 0.17);
      ctx.beginPath(); ctx.moveTo(sg.x1 + sg.nx * sg.w * 0.30, sg.y1 + sg.ny * sg.w * 0.30); ctx.lineTo(sg.x2 + sg.nx * sg.w * 0.30, sg.y2 + sg.ny * sg.w * 0.30); ctx.stroke();
      if(metal && dep > 0.50){
        ctx.strokeStyle = css(pal.neon, (pal.additive ? 0.55 : 0.30) * dep * al * glow); ctx.lineWidth = Math.max(0.6 * u, sg.w * 0.075);
        ctx.beginPath(); ctx.moveTo(sg.x1 + sg.nx * sg.w * 0.45, sg.y1 + sg.ny * sg.w * 0.45); ctx.lineTo(sg.x2 + sg.nx * sg.w * 0.45, sg.y2 + sg.ny * sg.w * 0.45); ctx.stroke();
      }
    }
  }

  function drawRays(cx, cy, R, t, pal, model, u, glow){
    var i, r, a, pulse, len, half, x0, y0, x1, y1, g, col, top;
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    for(i = 0; i < model.rays.length; i++){
      r = model.rays[i]; a = r.a + TAU * t / DUR; pulse = 0.5 + 0.5 * Math.sin(TAU * t / DUR * r.k + r.ph);
      len = R * r.len * (0.84 + 0.16 * pulse); half = R * r.w * (0.5 + 0.5 * pulse) * 4.0;
      x0 = cx + Math.cos(a) * R * 0.10; y0 = cy + Math.sin(a) * R * 0.10; x1 = cx + Math.cos(a) * len; y1 = cy + Math.sin(a) * len;
      col = r.gold ? pal.rayGold : pal.ray; top = (pal.additive ? 0.26 : 0.18) * (0.40 + 0.60 * pulse) * glow;
      g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, css(col, top)); g.addColorStop(0.42, css(col, top * 0.42)); g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.lineTo(x1 - Math.cos(a + Math.PI * 0.5) * half * 0.12, y1 - Math.sin(a + Math.PI * 0.5) * half * 0.12);
      ctx.lineTo(x1 + Math.cos(a + Math.PI * 0.5) * half * 0.12, y1 + Math.sin(a + Math.PI * 0.5) * half * 0.12);
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = css(col, top * 1.15); ctx.lineWidth = Math.max(0.5 * u, R * 0.0016);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    for(i = 0; i < model.beams.length; i++){
      var b = model.beams[i]; var ba = b.a + Math.sin(TAU * t / DUR + i) * 0.010; var bl = R * b.len;
      var bx = cx + Math.cos(ba) * bl; var by = cy + Math.sin(ba) * bl; var bw = R * b.w;
      var bg = ctx.createLinearGradient(cx, cy, bx, by);
      bg.addColorStop(0, css(pal.warm, (pal.additive ? 0.30 : 0.20) * glow)); bg.addColorStop(0.55, css(pal.warm, (pal.additive ? 0.10 : 0.07) * glow)); bg.addColorStop(1, css(pal.warm, 0));
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(cx + Math.cos(ba) * R * 0.06, cy + Math.sin(ba) * R * 0.06);
      ctx.lineTo(bx - Math.cos(ba + Math.PI * 0.5) * bw, by - Math.sin(ba + Math.PI * 0.5) * bw);
      ctx.lineTo(bx + Math.cos(ba + Math.PI * 0.5) * bw, by + Math.sin(ba + Math.PI * 0.5) * bw);
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = css(pal.warm, (pal.additive ? 0.26 : 0.18) * glow); ctx.lineWidth = Math.max(0.5 * u, R * 0.0014);
      [-1, 1].forEach(function(sgn){
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ba) * R * 0.08, cy + Math.sin(ba) * R * 0.08);
        ctx.lineTo(bx + Math.cos(ba + Math.PI * 0.5) * bw * sgn, by + Math.sin(ba + Math.PI * 0.5) * bw * sgn); ctx.stroke();
      });
    }
    ctx.restore();
  }

  function drawTicks(cx, cy, R, t, pal, u, glow){
    var count = Math.round(72 * Math.max(0.7, Math.min(1, u * 2.6))); var rot = TAU * t / DUR;
    ctx.save(); ctx.lineCap = 'butt';
    for(var i = 0; i < count; i++){
      var a = (i / count) * TAU + rot; var major = i % 6 === 0; var r0 = R * (major ? 1.028 : 1.042); var r1 = R * (major ? 1.072 : 1.058);
      ctx.strokeStyle = major ? css(pal.hud, (pal.additive ? 0.52 : 0.38) * pal.hudA * glow) : css(pal.hud, (pal.additive ? 0.18 : 0.13) * pal.hudA * glow);
      ctx.lineWidth = Math.max(0.55, (major ? 1.35 : 0.8) * u);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHudArcs(cx, cy, R, t, pal, u, glow){
    ctx.save(); ctx.lineCap = 'butt';
    for(var i = 0; i < ARCS.length; i++){
      var a = ARCS[i]; var rot = a.dir * TAU * t / DUR * a.k; var col = a.col === 'warm' ? pal.warm : pal.hud;
      var rr = R * a.r; var lw = Math.max(0.7, R * a.w);
      ctx.strokeStyle = css(col, (pal.additive ? 0.20 : 0.14) * pal.hudA * glow); ctx.lineWidth = lw * 3.2;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a.a0 + rot, a.a1 + rot); ctx.stroke();
      ctx.strokeStyle = css(col, (pal.additive ? 0.80 : 0.56) * pal.hudA); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(cx, cy, rr, a.a0 + rot, a.a1 + rot); ctx.stroke();
      var ends = [a.a0 + rot, a.a1 + rot]; ctx.strokeStyle = css(col, (pal.additive ? 0.85 : 0.60) * pal.hudA); ctx.lineWidth = Math.max(0.8, lw * 1.5);
      for(var e = 0; e < 2; e++){
        var ang = ends[e]; var c0 = Math.cos(ang), s0 = Math.sin(ang);
        ctx.beginPath(); ctx.moveTo(cx + c0 * (rr - R * 0.012), cy + s0 * (rr - R * 0.012)); ctx.lineTo(cx + c0 * (rr + R * 0.012), cy + s0 * (rr + R * 0.012)); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawDataRing(cx, cy, R, t, pal, u, glow){
    var rr = R * 1.105; var fontPx = clamp(9 * u, 5, 11); var circ = TAU * rr; var N = clamp(Math.round(circ / (fontPx * 7.4)), 12, 32);
    var rot = TAU * t / DUR; var step = TAU / N;
    ctx.save(); ctx.font = '500 ' + fontPx.toFixed(1) + 'px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for(var i = 0; i < N; i++){
      var a = i * step + rot; var x = cx + Math.cos(a) * rr; var y = cy + Math.sin(a) * rr; var fade = 0.55 + 0.45 * Math.sin(i * 1.7 + TAU * t / DUR * 2);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI * 0.5);
      ctx.fillStyle = css(pal.ink, (pal.additive ? 0.52 : 0.42) * fade * pal.hudA * glow); ctx.fillText(TOKENS[i % TOKENS.length], 0, 0); ctx.restore();
    }
    ctx.restore();
  }

  function drawCore(cx, cy, R, t, pal, flash, energy){
    var pulse = 1 + (0.05 + 0.045 * energy) * Math.sin(TAU * t / DUR * 3) + (0.02 + 0.020 * energy) * Math.sin(TAU * t / DUR * 4 + 1.1);
    var rad = R * 0.295 * pulse * (1 + 0.10 * energy);
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,253,246,0.97)');
    g.addColorStop(0.20, css(pal.coreMid, (pal.additive ? 0.90 : 0.94) * (1 + 0.08 * energy)));
    g.addColorStop(0.44, css(pal.coreOut, (pal.additive ? 0.30 : 0.30) * (1 + 0.30 * energy)));
    g.addColorStop(0.74, css(pal.coreOut, 0.09 + 0.07 * energy)); g.addColorStop(1, css(pal.coreOut, 0));
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
    var ringR = R * 0.105; var rot = TAU * t / DUR * 2;
    for(var k = 0; k < 3; k++){
      var a0 = rot + k * TAU / 3; var a1 = a0 + TAU / 5.2;
      ctx.strokeStyle = css(pal.hud, (pal.additive ? 0.62 : 0.40) * (1 + 0.25 * energy)); ctx.lineWidth = Math.max(0.8, R * 0.0042);
      ctx.beginPath(); ctx.arc(cx, cy, ringR, a0, a1); ctx.stroke();
    }
    var p = (t % (DUR / 3)) / (DUR / 3); var pr = R * (0.12 + 0.20 * p) * (1 + 0.10 * energy);
    ctx.strokeStyle = css(pal.coreMid, (pal.additive ? 0.55 : 0.38) * Math.pow(1 - p, 1.8)); ctx.lineWidth = Math.max(0.8, R * 0.0035 * (1 - p * 0.5));
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.stroke();
    if(flash && flash > 0){
      ctx.strokeStyle = css([255, 255, 255], 0.75 * flash); ctx.lineWidth = Math.max(1, R * 0.006);
      ctx.beginPath(); ctx.arc(cx, cy, ringR * (1 + 0.5 * (1 - flash)), 0, TAU); ctx.stroke();
    }
    var cr = R * 0.052 * (1 + 0.30 * energy); var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(0.55, 'rgba(255,255,255,0.80)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawDust(cx, cy, R, t, pal, model, u, glow){
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over'; ctx.lineCap = 'round';
    for(var i = 0; i < model.dust.length; i++){
      var d = model.dust[i]; var baseA = d.a + d.spd * TAU * t / DUR;
      var rr = R * d.r * (1 + 0.016 * Math.sin(TAU * t / DUR * d.twk + d.tw)); var tw = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(TAU * t / DUR * d.twk + d.tw));
      var col = hexToRgb(pal.dust[d.col]); var bright = d.bright * Math.min(1.35, glow);
      for(var k = d.tail; k >= 1; k--){
        var a1 = baseA - d.spd * 0.030 * k; var a0 = baseA - d.spd * 0.030 * (k + 1);
        var x0 = cx + Math.cos(a0) * rr; var y0 = cy + Math.sin(a0) * rr * 0.92; var x1 = cx + Math.cos(a1) * rr; var y1 = cy + Math.sin(a1) * rr * 0.92;
        ctx.strokeStyle = css(col, 0.26 * tw * bright * (1 - (k - 1) / (d.tail + 0.6))); ctx.lineWidth = Math.max(0.4, 0.75 * u);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      var x = cx + Math.cos(baseA) * rr; var y = cy + Math.sin(baseA) * rr * 0.92;
      ctx.fillStyle = css(col, Math.min(1, 0.85 * tw * bright)); ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, d.size * 0.46 * u), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawScanline(cx, cy, R, t, pal, u){
    var p = (t % DUR) / DUR; var y = cy + (p * 2 - 1) * R * 1.10; var band = R * 0.085; var a = Math.sin(p * Math.PI);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 1.20, 0, TAU); ctx.clip(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    var g = ctx.createLinearGradient(0, y - band, 0, y + band);
    g.addColorStop(0, css(pal.hud, 0)); g.addColorStop(0.5, css(pal.hud, (pal.additive ? 0.055 : 0.035) * a)); g.addColorStop(1, css(pal.hud, 0));
    ctx.fillStyle = g; ctx.fillRect(cx - R * 1.2, y - band, R * 2.4, band * 2);
    ctx.strokeStyle = css(pal.hud, (pal.additive ? 0.22 : 0.14) * a); ctx.lineWidth = Math.max(0.5, 0.8 * u);
    ctx.beginPath(); ctx.moveTo(cx - Math.sqrt(Math.max(0, R * R * 1.44 - (y - cy) * (y - cy))), y); ctx.lineTo(cx + Math.sqrt(Math.max(0, R * R * 1.44 - (y - cy) * (y - cy))), y); ctx.stroke();
    ctx.restore();
  }

  function drawShockwave(cx, cy, R, t, pal, u){
    var p = (t % 3) / 3; var rad = R * (0.22 + 0.92 * p); var a = Math.pow(1 - p, 2.1) * (pal.additive ? 0.26 : 0.18);
    ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    ctx.strokeStyle = css(pal.hazeWarm, a); ctx.lineWidth = Math.max(0.6, 2.0 * (1 - p * 0.6) * u);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
    if(p > 0.12){
      var p2 = p - 0.12; ctx.strokeStyle = css(pal.hazeCool, Math.pow(1 - p2, 2.4) * (pal.additive ? 0.14 : 0.10)); ctx.lineWidth = Math.max(0.5, 1.0 * u);
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.22 + 0.92 * p2), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function applyBloom(strength, mode){
    var cw = ctx.canvas.width; var ch = ctx.canvas.height; if(cw < 4 || ch < 4) return;
    var tw = Math.max(48, Math.round(cw / 3)); var th = Math.max(48, Math.round(ch / 3));
    if(!bloomCanvas) bloomCanvas = document.createElement('canvas');
    if(bloomCanvas.width !== tw || bloomCanvas.height !== th){ bloomCanvas.width = tw; bloomCanvas.height = th; }
    var tctx = bloomCanvas.getContext('2d'); tctx.clearRect(0, 0, tw, th); try{ tctx.filter = 'blur(3px)'; }catch(e){}
    tctx.drawImage(ctx.canvas, 0, 0, tw, th); tctx.filter = 'none';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = mode; ctx.globalAlpha = strength;
    ctx.drawImage(bloomCanvas, 0, 0, cw, ch); ctx.restore();
  }

  function drawScene(W, H, t, themeName, o){
    o = o || {}; var pal = PALETTES[themeName] || PALETTES.dark; var model = modelFor(themeName);
    var R = radiusFor(W, H); var cx = W * 0.5; var cy = H * 0.5; var u = Math.min(W, H) / 1000;
    var energy = clamp(o.energy || 0, 0, 1); var activity = clamp(o.activity || 0, 0, 1);
    var glow = 1 + energy * 0.55 + activity * 0.12; var q = o.quality || autoQuality(W, H); var i;
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(W, H, cx, cy, R, pal, themeName, t); drawHaze(cx, cy, R, pal, t, glow); drawRadar(cx, cy, R, pal, t, Math.min(1, u * 2), activity);
    drawSpirals(cx, cy, R, t, pal, model, u);
    for(i = 0; i < 2; i++){ drawRibbon(cx, cy, R, RIBBONS[i], t, pal, model.ramp, u, q, glow); }
    drawRays(cx, cy, R, t, pal, model, u, glow);
    for(i = 2; i < RIBBONS.length; i++){ drawRibbon(cx, cy, R, RIBBONS[i], t, pal, model.ramp, u, q, glow); }
    drawTicks(cx, cy, R, t, pal, Math.min(1, u * 2), glow); drawHudArcs(cx, cy, R, t, pal, Math.min(1, u * 2), glow); drawDataRing(cx, cy, R, t, pal, u, glow);
    var flash = 0; if(o.flashAt != null && o.clock != null){ var fa = (o.clock - o.flashAt) / 0.5; if(fa >= 0 && fa <= 1) flash = 1 - fa; }
    drawCore(cx, cy, R, t, pal, flash, energy); drawDust(cx, cy, R, t, pal, model, u, glow);
    drawScanline(cx, cy, R, t, pal, u); if(pal.bloom > 0){ applyBloom(pal.bloom * (1 + energy * 0.60 + activity * 0.20), pal.additive ? 'lighter' : 'source-over'); }
    drawShockwave(cx, cy, R, t, pal, u);
    if(o.bursts && o.bursts.length && o.clock != null){
      ctx.save(); ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
      for(i = 0; i < o.bursts.length; i++){
        var b = o.bursts[i]; var age = (o.clock - b.t0) / 1.10; if(age < 0 || age > 1) continue;
        var e = 1 - Math.pow(1 - age, 3); var rr = R * (0.10 + 1.02 * e) * b.scale; var fade = Math.pow(1 - age, 1.6);
        ctx.strokeStyle = css(pal.warm, 0.55 * fade); ctx.lineWidth = Math.max(1, 3.0 * (1 - age) * Math.min(1, u * 2));
        ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = css(pal.hud, 0.38 * Math.pow(1 - age, 1.9)); ctx.lineWidth = Math.max(0.8, 1.4 * Math.min(1, u * 2));
        ctx.beginPath(); ctx.arc(b.x, b.y, rr * 0.74, 0, TAU); ctx.stroke();
        if(age < 0.75){
          var r6 = rr * 1.10; var af = Math.pow(1 - age / 0.75, 1.4); ctx.strokeStyle = css(pal.hud, 0.34 * af); ctx.lineWidth = Math.max(0.8, 2.0 * Math.min(1, u * 2));
          for(var s = 0; s < 6; s++){ var aa = s * TAU / 6 + (1 - e) * 0.5; ctx.beginPath(); ctx.arc(b.x, b.y, r6, aa, aa + TAU / 12); ctx.stroke(); }
        }
      }
      ctx.restore();
    }
  }

  function autoQuality(W, H){ var m = Math.min(W, H); return m < 430 ? 0.60 : (m < 700 ? 0.74 : 1); }
  function resolveTheme(name){ if(name === 'light' || name === 'dark') return name; if(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches){ return 'light'; } return 'dark'; }

  function measure(){
    if(destroyed) return;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
    var h = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 1));
    var nextDpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, opts.dprCap);
    var bw = Math.round(w * nextDpr);
    var bh = Math.round(h * nextDpr);
    if(w === cssW && h === cssH && canvas.width === bw && canvas.height === bh) return;
    cssW = w; cssH = h; dpr = nextDpr;
    canvas.width = bw;
    canvas.height = bh;
    gridCache.key = '';
    render();
  }

  function render(){
    if(destroyed || cssW < 2 || cssH < 2) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(cssW, cssH, state.t, state.theme, {
      bursts: state.bursts,
      clock: state.clock,
      flashAt: state.flashAt,
      energy: state.energy,
      activity: state.activity,
      quality: opts.quality || 0
    });
    state.frames++;
  }

  function shouldRun(){
    return !state.paused && !state.autoPaused && !state.reduced;
  }

  function loop(now){
    if(!state.running) return;
    if(!state.last) state.last = now;
    var dt = (now - state.last) / 1000;
    state.last = now;
    if(!(dt > 0)) dt = 0;
    if(dt > 0.12) dt = 0.12;
    var k = Math.min(1, dt * 4.5);
    state.pace += (state.targetPace - state.pace) * k;
    state.energy = smoothFridayEnergy(state.energy, state.targetEnergy, dt);
    state.t = (state.t + dt * state.pace) % DUR;
    state.clock += dt;
    if(now - state.lastRender >= 1000 / FPS - 2){
      state.lastRender = now;
      render();
    }
    state.raf = window.requestAnimationFrame(loop);
  }

  function play(){
    if(destroyed || state.running || !shouldRun()) return;
    state.running = true;
    state.last = 0;
    state.lastRender = 0;
    state.raf = window.requestAnimationFrame(loop);
  }
  
  function stop(){
    state.running = false;
    if(state.raf && typeof window !== 'undefined'){
      window.cancelAnimationFrame(state.raf);
    }
    state.raf = 0;
  }
  
  function syncLoop(){
    if(shouldRun()) play();
    else stop();
  }

  function setState(name){
    var s = normalizeState(name);
    state.phase = s;
    state.targetPace = STATE_PACE[s];
    state.activity = STATE_ACTIVITY[s];
    if(state.reduced) render();
  }

  function setAudioLevel(level){
    if(state.reduced) return;
    var v = Number(level);
    if(!isFinite(v)) v = 0;
    v = clamp(v / 100, 0, 1);
    /* 麦克风底噪门限 + 小幅死区，避免静音附近反复闪烁。 */
    v = v <= 0.018 ? 0 : (v - 0.018) / 0.982;
    if(Math.abs(state.targetEnergy - v) < 0.008) return;
    state.targetEnergy = v;
    if(state.reduced) render();
  }

  function setTheme(name){
    var resolved = resolveTheme(name);
    opts.theme = name;
    state.theme = resolved;
    if(mqLight){
      if(mqLight.removeEventListener) mqLight.removeEventListener('change', onSchemeChange);
      else if(mqLight.removeListener) mqLight.removeListener(onSchemeChange);
    }
    mqLight = null;
    if(name === 'auto' && typeof window !== 'undefined' && window.matchMedia){
      mqLight = window.matchMedia('(prefers-color-scheme: light)');
      if(mqLight.addEventListener) mqLight.addEventListener('change', onSchemeChange);
      else if(mqLight.addListener) mqLight.addListener(onSchemeChange);
    }
    gridCache.key = '';
    render();
    if(typeof opts.onThemeChange === 'function') opts.onThemeChange(resolved);
    return resolved;
  }

  function onSchemeChange(){
    if(opts.theme !== 'auto') return;
    state.theme = resolveTheme('auto');
    gridCache.key = '';
    render();
    if(typeof opts.onThemeChange === 'function') opts.onThemeChange(state.theme);
  }

  function setPaused(p){
    state.paused = !!p;
    if(state.paused) state.autoPaused = false;
    syncLoop();
    if(state.paused) render();
    return state.paused;
  }

  function burstAt(x, y, scale){
    if(state.bursts.length > 2) state.bursts.shift();
    state.bursts.push({ t0: state.clock, x: x, y: y, scale: scale || 1 });
    state.flashAt = state.clock;
    if(!state.running) render();
  }

  function burst(x, y, scale){
    var cx = (x == null) ? cssW * 0.5 : x;
    var cy = (y == null) ? cssH * 0.5 : y;
    burstAt(cx, cy, scale);
    if(typeof opts.onBurst === 'function') opts.onBurst({ x: cx, y: cy, scale: scale || 1 });
  }

  function onPointerDown(ev){
    if(!opts.interactive) return;
    if(ev.pointerType === 'mouse' && ev.button !== 0) return;
    var rect = canvas.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    var x = (ev.clientX - rect.left) / rect.width * cssW;
    var y = (ev.clientY - rect.top) / rect.height * cssH;
    var dx = x - cssW * 0.5;
    var dy = y - cssH * 0.5;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var maxR = radiusFor(cssW, cssH) * 1.16;
    var scale = clamp(1.12 - (dist / maxR) * 0.34, 0.7, 1.12);
    burst(x, y, scale);
  }

  function onVisibilityChange(){
    if(!opts.autoPause) return;
    var hidden = typeof document !== 'undefined' && document.hidden;
    if(hidden){
      if(!state.autoPaused){
        state.autoPaused = true;
        stop();
        if(typeof opts.onVisibility === 'function') opts.onVisibility(false);
      }
    }else if(state.autoPaused){
      state.autoPaused = false;
      state.last = 0;
      syncLoop();
      if(typeof opts.onVisibility === 'function') opts.onVisibility(true);
    }
  }

  function onReduceChange(e){
    state.reduced = !!e.matches;
    if(state.reduced){
      /* 减少动态效果时冻结相位并禁用音量驱动，保留单帧状态图。 */
      state.targetEnergy = 0;
      state.energy = 0;
      stop();
      render();
    }else{
      syncLoop();
    }
  }

  function onResize(){
    measure();
  }

  function destroy(){
    if(destroyed) return;
    destroyed = true;
    stop();
    if(ro) ro.disconnect();
    ro = null;
    canvas.removeEventListener('pointerdown', onPointerDown);
    if(typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    if(typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    if(mqReduce){
      if(mqReduce.removeEventListener) mqReduce.removeEventListener('change', onReduceChange);
      else if(mqReduce.removeListener) mqReduce.removeListener(onReduceChange);
    }
    if(mqLight){
      if(mqLight.removeEventListener) mqLight.removeEventListener('change', onSchemeChange);
      else if(mqLight.removeListener) mqLight.removeListener(onSchemeChange);
    }
    mqReduce = null;
    mqLight = null;
    gridCache = { key: '', c: null };
    bloomCanvas = null;
    exportCanvas = null;
    /* 释放 Canvas backing store，避免卸载后的高 DPR 像素缓冲继续占用内存。 */
    try{
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }catch(e){}
  }

  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'manipulation';
  canvas.style.webkitTapHighlightColor = 'transparent';
  if(opts.ariaLabel) canvas.setAttribute('aria-label', opts.ariaLabel);
  canvas.setAttribute('role', 'img');
  state.theme = resolveTheme(opts.theme);
  if(opts.theme === 'auto' && typeof window !== 'undefined' && window.matchMedia){
    mqLight = window.matchMedia('(prefers-color-scheme: light)');
    if(mqLight.addEventListener) mqLight.addEventListener('change', onSchemeChange);
    else if(mqLight.addListener) mqLight.addListener(onSchemeChange);
  }
  if(opts.respectReducedMotion && typeof window !== 'undefined' && window.matchMedia){
    mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.reduced = !!mqReduce.matches;
    if(mqReduce.addEventListener) mqReduce.addEventListener('change', onReduceChange);
    else if(mqReduce.addListener) mqReduce.addListener(onReduceChange);
  }
  if(opts.interactive) canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  if(typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  if(typeof window !== 'undefined') window.addEventListener('resize', onResize, { passive: true });
  if(typeof ResizeObserver !== 'undefined'){
    ro = new ResizeObserver(function(){ measure(); });
    ro.observe(canvas);
  }
  measure();
  if(state.reduced) render();
  else syncLoop();

  return {
    setState: setState,
    setAudioLevel: setAudioLevel,
    setTheme: setTheme,
    setPaused: setPaused,
    pause: function(){ return setPaused(true); },
    play: function(){ return setPaused(false); },
    burst: burst,
    resize: measure,
    renderAt: function(t){
      state.t = ((Number(t) % DUR) + DUR) % DUR;
      render();
    },
    exportFrame: function(t, theme, size){
      var s = size || 1080;
      if(!exportCanvas) exportCanvas = document.createElement('canvas');
      if(exportCanvas.width !== s || exportCanvas.height !== s){
        exportCanvas.width = s;
        exportCanvas.height = s;
      }
      var ectx = exportCanvas.getContext('2d');
      var saveCtx = ctx;
      ctx = ectx;
      try{
        ectx.setTransform(1, 0, 0, 1, 0, 0);
        ectx.clearRect(0, 0, s, s);
        drawScene(s, s, ((Number(t) % DUR) + DUR) % DUR, theme || state.theme, {
          quality: 1, energy: state.energy, activity: state.activity
        });
      }finally{
        ctx = saveCtx;
      }
      return exportCanvas;
    },
    getState: function(){
      return {
        theme: state.theme,
        phase: state.phase,
        t: state.t,
        pace: state.pace,
        energy: state.energy,
        running: state.running,
        paused: state.paused,
        autoPaused: state.autoPaused,
        reduced: state.reduced,
        width: cssW,
        height: cssH,
        dpr: dpr,
        frames: state.frames
      };
    },
    getMetrics: function(){
      var R = radiusFor(cssW, cssH);
      return {
        width: cssW, height: cssH, dpr: dpr,
        cx: cssW * 0.5, cy: cssH * 0.5, R: R,
        extent: R * EXT, diameter: R * EXT * 2,
        safeRatio: R * EXT * 2 / Math.min(cssW, cssH)
      };
    },
    destroy: destroy
  };
}

export var FRIDAY_ORB = {
  DURATION: DUR,
  FPS: FPS,
  STATES: VALID_STATES,
  STATE_PACE: STATE_PACE
};
