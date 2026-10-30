"use strict";
/* ============================================================
   BRILLIANT BLOCKS — 基本に忠実な落ちものパズル
   準拠事項(ガイドライン系の標準ルール):
   - 盤面 10x20(+上方バッファ2行) / 7種1巡(7-bag)
   - SRS回転 + 標準Wall Kick(JLSTZ / I 別テーブル)
   - HOLDは1ピースにつき1回 / NEXT 5個 / ゴースト表示
   - ロックディレイ 500ms・リセット最大15回
   - ソフトドロップ 20倍 / ハードドロップ 2点/セル
   - スコア: 公式倍率表 + T-Spin(3-corner判定) + B2B x1.5
             + コンボ 50点 + Perfect Clear ボーナス
   - レベル: 10ライン毎に上昇、重力はガイドライン系テーブル
   - マラソン: 150ラインでクリア
   ============================================================ */
const COLS = 10, VISIBLE = 20, ROWS = 22, HIDDEN = ROWS - VISIBLE;
const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
const COLORS = {
  I: ["#a5f7ff", "#37e6ff", "#0e9dc4"], O: ["#fff6a8", "#ffd93b", "#d9a400"],
  T: ["#efc2ff", "#c05cff", "#8a1fd0"], S: ["#c2ffc9", "#4de361", "#18a52e"],
  Z: ["#ffc2c2", "#ff5252", "#c41f1f"], J: ["#c2d4ff", "#4d7cff", "#1f3fc4"],
  L: ["#ffe3b3", "#ff9d2e", "#c46300"], G: ["#666", "#444", "#222"]
};
const BASE = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]]
};
function rotateMatrix(m, dir) {
  const n = m.length, out = Array.from({length: n}, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (dir > 0) out[x][n - 1 - y] = m[y][x]; else out[n - 1 - x][y] = m[y][x];
  return out;
}
const SHAPES = {};
for (const t of TYPES) {
  SHAPES[t] = [BASE[t]];
  for (let s = 1; s < 4; s++) SHAPES[t].push(rotateMatrix(SHAPES[t][s - 1], 1));
}
/* Wall Kick: [dx, dy] dyは盤面座標(下が+)。ガイドライン表(y上向き)から変換済み */
const KICKS_JLSTZ = {
  "0>1": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]], "1>0": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "1>2": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],   "2>1": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "2>3": [[0,0],[1,0],[1,-1],[0,2],[1,2]],    "3>2": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "3>0": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], "0>3": [[0,0],[1,0],[1,-1],[0,2],[1,2]]
};
const KICKS_I = {
  "0>1": [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],  "1>0": [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  "1>2": [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],  "2>1": [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  "2>3": [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],  "3>2": [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  "3>0": [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],  "0>3": [[0,0],[-1,0],[2,0],[-1,-2],[2,1]]
};
const KICKS_180 = [[0,0],[0,-1],[1,0],[-1,0],[1,-1],[-1,-1],[0,1]];
const GRAVITY_MS = [1000,793,618,473,355,262,190,135,94,64,43,28,18,11,7,5,4,3,2,1.5,1];
function gravityMs(level) { return GRAVITY_MS[Math.min(level, GRAVITY_MS.length) - 1]; }
const LOCK_DELAY = 500, MAX_LOCK_RESETS = 15, MARATHON_GOAL = 150;

function createBoard() { return Array.from({length: ROWS}, () => Array(COLS).fill(null)); }
function cellsOf(type, state, px, py) {
  const m = SHAPES[type][state], out = [];
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++)
    if (m[y][x]) out.push([px + x, py + y]);
  return out;
}
function collides(board, type, state, px, py) {
  for (const [x, y] of cellsOf(type, state, px, py)) {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && board[y][x]) return true;
  }
  return false;
}
/* 出現位置: ピース全体が表示盤面の最上段から見える高さ(主流実装・旧版と同じ)。
   ガイドラインの出現行(21・22行目)はバッファ内だが、出現直後に全体が見えるのが標準的な見え方。
   Iだけは形状の都合で1行上から出す。 */
function spawnY(type) {
  const cells = cellsOf(type, 0, 0, 0);
  const minDy = Math.min(...cells.map(c => c[1]));
  return HIDDEN - minDy;
}
function makeBag(rng) {
  const bag = TYPES.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
/* T-Spin: 3-corner判定。frontが2未満ならMini(5番目キック成功時は通常に昇格) */
function detectTSpin(board, piece, lastAction, kickIndex) {
  if (piece.type !== "T" || lastAction !== "rotate") return null;
  const cx = piece.x + 1, cy = piece.y + 1;
  const filled = (x, y) => (x < 0 || x >= COLS || y >= ROWS) ? true : (y < 0 ? false : !!board[y][x]);
  const corners = [[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]];
  const count = corners.filter(([x, y]) => filled(x, y)).length;
  if (count < 3) return null;
  const frontIdx = {0: [0,1], 1: [1,3], 2: [2,3], 3: [0,2]}[piece.state];
  const front = frontIdx.filter(i => filled(corners[i][0], corners[i][1])).length;
  if (front < 2 && kickIndex !== 4) return "mini";
  return "tspin";
}
/* スコア表(レベル倍率前) */
const SCORE_TABLE = {
  single: 100, double: 300, triple: 500, tetris: 800,
  tspin: 400, tspin_single: 800, tspin_double: 1600, tspin_triple: 2400,
  mini: 100, mini_single: 200, mini_double: 400
};
const LINE_NAMES = ["", "single", "double", "triple", "tetris"];
const PC_TABLE = [0, 800, 1200, 1800, 2000];
function scoreClear({lines, tspin, b2bActive, level, combo, isPC}) {
  let key, base = 0, difficult = false;
  if (tspin === "tspin") { key = lines === 0 ? "tspin" : "tspin_" + LINE_NAMES[lines]; base = SCORE_TABLE[key]; difficult = lines > 0; }
  else if (tspin === "mini") { key = lines >= 2 ? "mini_double" : (lines === 1 ? "mini_single" : "mini"); base = SCORE_TABLE[key]; }
  else if (lines > 0) { key = LINE_NAMES[lines]; base = SCORE_TABLE[key]; difficult = lines === 4; }
  let pts = base * level;
  if (difficult && b2bActive) pts = Math.floor(pts * 1.5);
  let label = "";
  if (tspin === "tspin") label = lines === 0 ? "T-SPIN" : "T-SPIN " + ["", "SINGLE", "DOUBLE", "TRIPLE"][lines];
  else if (tspin === "mini") label = lines === 0 ? "T-SPIN MINI" : "T-SPIN MINI " + ["", "SINGLE", "DOUBLE"][lines];
  else if (lines === 4) label = "TETRIS";
  else if (lines > 0) label = ["", "SINGLE", "DOUBLE", "TRIPLE"][lines];
  if (combo >= 1) pts += 50 * combo; /* コンボはレベル倍率なし(50 x カウント) */
  let pcBonus = 0;
  if (isPC && lines > 0) { pcBonus = PC_TABLE[lines] * level; if (lines === 4 && b2bActive) pcBonus += 1500 * level; pts += pcBonus; }
  return {points: pts, label, difficult, pcBonus};
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {COLS, ROWS, VISIBLE, HIDDEN, TYPES, SHAPES, KICKS_JLSTZ, KICKS_I,
    gravityMs, createBoard, cellsOf, collides, makeBag, detectTSpin, scoreClear, spawnY, LOCK_DELAY, MAX_LOCK_RESETS, MARATHON_GOAL};
}

/* ================= 以下、ブラウザ専用 ================= */
if (typeof document !== "undefined") {
const $ = id => document.getElementById(id);
const boardCv = $("board"), fxCv = $("fx"), holdCv = $("hold"), nextCv = $("next");
const bctx = boardCv.getContext("2d"), fctx = fxCv.getContext("2d");
const CELL = 30;
const settings = Object.assign({das: 150, arr: 30, sfx: true, volume: 0.8, effects: true, shake: true, vegas: true},
  JSON.parse(localStorage.getItem("brilliant-settings") || "{}"));
let highScore = +(localStorage.getItem("brilliant-high") || 0);

let S = null;         // ゲーム状態
let particles = [], floats = [], beams = [], rings = [], trails = [], clearingRows = null, clearAnimUntil = 0;
let fever = 0, feverUntil = 0, hitStopUntil = 0, trailAcc = 0;
const vegasOn = () => settings.effects && settings.vegas;
const isFever = () => performance.now() < feverUntil;
let lastTime = 0, dropAcc = 0, lockAcc = 0, lockResets = 0, grounded = false;
let lastAction = null, lastKick = -1, holdUsed = false, paused = false, running = false, countingDown = false;
let endless = false, startAt = 0, playMs = 0, rafId = null;
const keys = {left: false, right: false, down: false};
let dasAcc = 0, arrAcc = 0, activeDir = 0, dasCharged = false;

/* ---------- サウンド(WebAudio合成) ---------- */
let AC = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); return AC; }
function tone(freq, dur, type, vol, when = 0, slide = 0) {
  if (!settings.sfx) return;
  try {
    const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + when;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol * settings.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
const sfx = {
  move: () => tone(220, 0.03, "square", 0.05),
  rotate: () => tone(440, 0.05, "square", 0.07, 0, 160),
  hold: () => { tone(660, 0.06, "triangle", 0.12); tone(880, 0.07, "triangle", 0.1, 0.05); },
  soft: () => tone(180, 0.02, "square", 0.03),
  hard: () => { tone(120, 0.12, "sawtooth", 0.22, 0, -70); tone(60, 0.16, "sine", 0.3); },
  lock: () => tone(200, 0.05, "square", 0.1),
  clear: n => [523, 659, 784].slice(0, 2 + n).forEach((f, i) => tone(f, 0.1, "triangle", 0.14, i * 0.05)),
  tetris: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, "triangle", 0.16, i * 0.06)),
  tspin: () => [392, 587, 880, 1175].forEach((f, i) => tone(f, 0.12, "square", 0.1, i * 0.05)),
  levelup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.15, i * 0.09)),
  pc: () => [784, 988, 1175, 1568, 2093].forEach((f, i) => tone(f, 0.18, "sine", 0.16, i * 0.07)),
  over: () => [440, 349, 262, 196].forEach((f, i) => tone(f, 0.25, "sawtooth", 0.1, i * 0.16)),
  count: () => tone(440, 0.08, "square", 0.1),
  go: () => tone(880, 0.3, "square", 0.14),
  laser: () => tone(1400, 0.2, "sawtooth", 0.07, 0, -1150),
  fever: () => [440, 554, 659, 880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.13, "square", 0.11, i * 0.055)),
  jackpot: () => { for (let i = 0; i < 14; i++) tone(1800 + Math.random() * 1600, 0.09, "sine", 0.1, i * 0.045); [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.2, "triangle", 0.13, 0.1 + i * 0.07)); }
};

/* ---------- 状態生成 ---------- */
function newState() {
  return {board: createBoard(), queue: [], hold: null, score: 0, lines: 0, level: 1,
    combo: -1, b2b: false, piece: null, stats: {tetris: 0, tspin: 0, pc: 0, maxCombo: 0}, over: false};
}
function refill(st) { while (st.queue.length < 10) st.queue.push(...makeBag(Math.random)); }
function spawn(st, fromHold) {
  refill(st);
  const type = fromHold || st.queue.shift();
  const piece = {type, state: 0, x: type === "O" ? 4 : 3, y: spawnY(type)};
  /* 出現位置で重なれば1行上、それでも重なればゲームオーバー(ブロックアウト) */
  if (collides(st.board, piece.type, 0, piece.x, piece.y)) piece.y -= 1;
  st.piece = piece; lockResets = 0; lockAcc = 0; grounded = false; lastAction = null; lastKick = -1;
  if (collides(st.board, piece.type, 0, piece.x, piece.y)) return false;
  return true;
}

/* ---------- 描画: 宝石ブロック ---------- */
function drawBlock(ctx, type, px, py, size, alpha = 1, ghost = false) {
  const [hi, mid, lo] = COLORS[type];
  ctx.save(); ctx.globalAlpha = alpha;
  if (ghost) {
    ctx.strokeStyle = mid; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, size - 4, size - 4);
    ctx.fillStyle = mid; ctx.globalAlpha = 0.13; ctx.fillRect(px + 2, py + 2, size - 4, size - 4);
    ctx.restore(); return;
  }
  const g = ctx.createLinearGradient(px, py, px, py + size);
  g.addColorStop(0, hi); g.addColorStop(0.45, mid); g.addColorStop(1, lo);
  ctx.fillStyle = g;
  ctx.shadowColor = mid; ctx.shadowBlur = 7;
  roundRect(ctx, px + 1, py + 1, size - 2, size - 2, 6); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.5)";
  roundRect(ctx, px + 4, py + 3, size - 8, size * 0.32, 4); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath(); ctx.arc(px + size * 0.3, py + size * 0.26, size * 0.07, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
  roundRect(ctx, px + 1.5, py + 1.5, size - 3, size - 3, 6); ctx.stroke();
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawBoard() {
  bctx.clearRect(0, 0, 300, 600);
  const bg = bctx.createLinearGradient(0, 0, 0, 600);
  bg.addColorStop(0, "#171036"); bg.addColorStop(1, "#070418");
  bctx.fillStyle = bg; bctx.fillRect(0, 0, 300, 600);
  bctx.strokeStyle = "rgba(140,120,255,.10)"; bctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { bctx.beginPath(); bctx.moveTo(x * CELL, 0); bctx.lineTo(x * CELL, 600); bctx.stroke(); }
  for (let y = 1; y < VISIBLE; y++) { bctx.beginPath(); bctx.moveTo(0, y * CELL); bctx.lineTo(300, y * CELL); bctx.stroke(); }
  if (!S) return;
  const now = performance.now();
  for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = S.board[y][x]; if (!t) continue;
    const py = (y - HIDDEN) * CELL;
    if (clearingRows && clearingRows.includes(y)) {
      const k = 1 - Math.max(0, (clearAnimUntil - now)) / 260;
      bctx.save(); bctx.globalAlpha = 1 - k;
      bctx.fillStyle = "#fff"; bctx.fillRect(x * CELL, py, CELL, CELL); bctx.restore();
    } else drawBlock(bctx, t, x * CELL, py, CELL);
  }
  if (S.piece && !S.over && !clearingRows) {
    let gy = S.piece.y;
    while (!collides(S.board, S.piece.type, S.piece.state, S.piece.x, gy + 1)) gy++;
    if (settings.effects && gy !== S.piece.y)
      for (const [x, y] of cellsOf(S.piece.type, S.piece.state, S.piece.x, gy))
        if (y >= HIDDEN) drawBlock(bctx, S.piece.type, x * CELL, (y - HIDDEN) * CELL, CELL, 1, true);
    for (const [x, y] of cellsOf(S.piece.type, S.piece.state, S.piece.x, S.piece.y))
      if (y >= HIDDEN) drawBlock(bctx, S.piece.type, x * CELL, (y - HIDDEN) * CELL, CELL);
  }
}
function drawPreview(cv, type, used) {
  const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
  if (!type) return;
  const size = 22, m = SHAPES[type][0];
  const w = m.length * size, ox = (cv.width - w) / 2, oy = (cv.height - 2 * size) / 2 - 2;
  ctx.save(); if (used) ctx.globalAlpha = 0.3;
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++)
    if (m[y][x]) drawBlock(ctx, type, ox + x * size, oy + y * size, size);
  ctx.restore();
}
function drawNext() {
  const ctx = nextCv.getContext("2d"); ctx.clearRect(0, 0, nextCv.width, nextCv.height);
  if (!S) return;
  for (let i = 0; i < 5; i++) {
    const type = S.queue[i]; if (!type) continue;
    const size = i === 0 ? 24 : 19, m = SHAPES[type][0];
    const ox = (nextCv.width - m.length * size) / 2, oy = i * 66 + (i === 0 ? 4 : 10);
    ctx.save(); if (i > 0) ctx.globalAlpha = 0.92 - i * 0.1;
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++)
      if (m[y][x]) drawBlock(ctx, type, ox + x * size, oy + y * size, size);
    ctx.restore();
  }
}

/* ---------- エフェクト ---------- */
function burst(x, y, type, n = 10, power = 3, kind = "spark") {
  if (!settings.effects) return;
  const [, mid] = COLORS[type] || ["#fff", "#ffd76a"];
  for (let i = 0; i < n; i++) particles.push({
    x, y, vx: (Math.random() - 0.5) * power * 2, vy: -Math.random() * power - 1,
    life: 1, size: 2 + Math.random() * 3.5, color: Math.random() < 0.3 ? "#ffffff" : mid,
    kind, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3
  });
  if (particles.length > 520) particles.splice(0, particles.length - 520);
}
/* ===== VEGAS演出: 花火・コイン・レーザー・衝撃波・残像 ===== */
function fireworks(x, y, n = 46) {
  if (!vegasOn()) return;
  const palette = ["#ffd76a", "#ff5dd2", "#37e6ff", "#7dff8a", "#c05cff", "#ffffff"];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + Math.random() * 0.3, sp = 1.6 + Math.random() * 3.4;
    particles.push({x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6, life: 1,
      size: 2 + Math.random() * 3, color: palette[i % palette.length], kind: "spark", rot: 0, vr: 0, grav: 0.05});
  }
  if (particles.length > 520) particles.splice(0, particles.length - 520);
}
function coinFountain(x, y, n = 26) {
  if (!vegasOn()) return;
  for (let i = 0; i < n; i++) particles.push({
    x: x + (Math.random() - 0.5) * 60, y, vx: (Math.random() - 0.5) * 2.4, vy: -3 - Math.random() * 4.4,
    life: 1.4, size: 3.4 + Math.random() * 3, color: "#ffd76a", kind: "coin", rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4
  });
  if (particles.length > 520) particles.splice(0, particles.length - 520);
}
function laserSweep(rows) {
  if (!vegasOn()) return;
  for (const y of rows) beams.push({x: 0, y: (y - HIDDEN) * CELL + CELL / 2, w: 300, h: 5, life: 1, color: "#ffffff"});
  sfx.laser();
}
function ringFx(x, y, color = "#ffd76a") { if (vegasOn()) rings.push({x, y, r: 6, life: 1, color}); }
function flashFx(color = "#ffffff") {
  if (!vegasOn()) return;
  const f = $("flash"); f.style.background = color;
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}
function punchFx() {
  if (!vegasOn()) return;
  const st = $("board-stage"); st.classList.remove("punch"); void st.offsetWidth; st.classList.add("punch");
}
function addFever(n) {
  if (!vegasOn() || isFever()) return;
  fever = Math.min(100, fever + n);
  if (fever >= 100) {
    feverUntil = performance.now() + 15000;
    document.body.classList.add("fever");
    showBanner("FEVER TIME!!", "✦ VEGAS MODE ✦", true);
    sfx.fever();
    fireworks(70, 160, 40); fireworks(230, 160, 40); fireworks(150, 300, 52);
    coinFountain(150, 320, 22);
  }
}
function updateFever(dt) {
  const now = performance.now();
  if (isFever()) fever = Math.max(0, 100 * (feverUntil - now) / 15000);
  else { fever = Math.max(0, fever - dt * 0.0035); if (document.body.classList.contains("fever")) document.body.classList.remove("fever"); }
  $("fever-fill").style.width = fever + "%";
}
function floatText(x, y, text, color = "#ffd76a", size = 20) {
  if (!settings.effects) return;
  floats.push({x, y, text, color, size, life: 1});
}
function showBanner(main, sub = "", rainbow = false) {
  const b = $("banner");
  b.innerHTML = "";
  b.textContent = main;
  if (sub) { const s = document.createElement("small"); s.textContent = sub; b.appendChild(s); }
  b.classList.remove("pop", "rainbow"); void b.offsetWidth;
  if (rainbow) b.classList.add("rainbow");
  b.classList.add("pop");
}
function shake() {
  if (!settings.effects || !settings.shake) return;
  const st = $("board-stage"); st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake");
}
function drawFx(dt) {
  fctx.clearRect(0, 0, 300, 600);
  /* 残像トレイル */
  trails = trails.filter(t => t.life > 0);
  for (const t of trails) {
    t.life -= dt / 300;
    for (const [x, y] of t.cells) if (y >= HIDDEN)
      drawBlock(fctx, t.type, x * CELL, (y - HIDDEN) * CELL, CELL, Math.max(0, t.life) * 0.4, true);
  }
  /* レーザービーム */
  beams = beams.filter(b => b.life > 0);
  for (const b of beams) {
    b.life -= dt / 300;
    fctx.save(); fctx.globalAlpha = Math.max(0, b.life);
    fctx.fillStyle = b.color; fctx.shadowColor = "#ffd76a"; fctx.shadowBlur = 22;
    fctx.fillRect(b.x, b.y - (b.h * (2 - b.life)) / 2, b.w, b.h * (2 - b.life)); fctx.restore();
  }
  /* 衝撃波リング */
  rings = rings.filter(r => r.life > 0);
  for (const r of rings) {
    r.r += dt / 4.4; r.life -= dt / 430;
    fctx.save(); fctx.globalAlpha = Math.max(0, r.life);
    fctx.strokeStyle = r.color; fctx.lineWidth = 3; fctx.shadowColor = r.color; fctx.shadowBlur = 14;
    fctx.beginPath(); fctx.arc(r.x, r.y, r.r, 0, 7); fctx.stroke(); fctx.restore();
  }
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += p.grav !== undefined ? p.grav : 0.16; p.life -= dt / (p.kind === "coin" ? 1150 : 620);
    if (p.rot !== undefined) p.rot += p.vr || 0;
    fctx.save(); fctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    if (p.kind === "coin") {
      fctx.translate(p.x, p.y); fctx.rotate(p.rot);
      fctx.fillStyle = "#ffd76a"; fctx.shadowColor = "#ffbe3c"; fctx.shadowBlur = 10;
      fctx.beginPath(); fctx.arc(0, 0, p.size, 0, 7); fctx.fill();
      fctx.fillStyle = "#fff3b0"; fctx.beginPath(); fctx.arc(0, 0, p.size * 0.55, 0, 7); fctx.fill();
    } else {
      fctx.fillStyle = p.color; fctx.shadowColor = p.color; fctx.shadowBlur = 8;
      fctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    fctx.restore();
  }
  floats = floats.filter(f => f.life > 0);
  for (const f of floats) {
    f.y -= dt / 22; f.life -= dt / 1050;
    fctx.save(); fctx.globalAlpha = Math.max(0, f.life);
    fctx.font = `900 ${f.size}px sans-serif`; fctx.textAlign = "center";
    fctx.fillStyle = f.color; fctx.shadowColor = f.color; fctx.shadowBlur = 14;
    fctx.fillText(f.text, f.x, f.y); fctx.restore();
  }
}
/* 背景の星 */
const starCv = $("bg-stars"), sctx = starCv.getContext("2d");
let stars = [];
function initStars() {
  starCv.width = innerWidth; starCv.height = innerHeight;
  stars = Array.from({length: 110}, () => ({x: Math.random() * starCv.width, y: Math.random() * starCv.height,
    r: Math.random() * 1.6 + 0.3, p: Math.random() * 6.28, s: 0.4 + Math.random()}));
}
addEventListener("resize", initStars); initStars();
function drawStars(t) {
  sctx.clearRect(0, 0, starCv.width, starCv.height);
  for (const s of stars) {
    sctx.save(); sctx.globalAlpha = 0.35 + 0.6 * Math.abs(Math.sin(t / 1400 * s.s + s.p));
    sctx.fillStyle = "#ffeec2"; sctx.shadowColor = "#ffd76a"; sctx.shadowBlur = 6;
    sctx.beginPath(); sctx.arc(s.x, s.y, s.r, 0, 7); sctx.fill(); sctx.restore();
  }
}

/* ---------- ゲーム進行 ---------- */
function updateHud() {
  $("score").textContent = S.score.toLocaleString();
  $("high-score").textContent = highScore.toLocaleString();
  $("level").textContent = S.level;
  $("lines").textContent = S.lines;
  $("lines-left").textContent = endless ? "/ ∞" : "/ " + MARATHON_GOAL;
  const b2b = $("b2b");
  b2b.textContent = S.b2b ? "B2B ACTIVE ✦" : "B2B ―";
  b2b.className = "chip" + (S.b2b ? " on" : "");
  const cb = $("combo");
  cb.textContent = S.combo >= 1 ? `COMBO ${S.combo}` : "";
  cb.className = "chip" + (S.combo >= 1 ? " combo-on" : "");
  $("board-stage").classList.toggle("b2b-on", S.b2b);
  let topY = ROWS;
  for (let y = 0; y < ROWS; y++) if (S.board[y].some(c => c)) { topY = y; break; }
  $("board-stage").classList.toggle("danger", running && !S.over && topY - HIDDEN <= 5);
}
function tryMove(dx, dy) {
  const p = S.piece; if (!p) return false;
  if (!collides(S.board, p.type, p.state, p.x + dx, p.y + dy)) {
    p.x += dx; p.y += dy;
    if (dy === 0) lastAction = "move";
    onSuccessfulShift();
    return true;
  }
  return false;
}
function onSuccessfulShift() {
  if (grounded && lockResets < MAX_LOCK_RESETS) { lockAcc = 0; lockResets++; }
}
function tryRotate(dir) {
  const p = S.piece; if (!p || p.type === "O") return false;
  const from = p.state, to = (from + dir + 4) % 4;
  const table = p.type === "I" ? KICKS_I : KICKS_JLSTZ;
  const kicks = table[from + ">" + to];
  for (let i = 0; i < kicks.length; i++) {
    const [kx, ky] = kicks[i];
    if (!collides(S.board, p.type, to, p.x + kx, p.y + ky)) {
      p.x += kx; p.y += ky; p.state = to; lastAction = "rotate"; lastKick = i;
      onSuccessfulShift(); sfx.rotate(); return true;
    }
  }
  return false;
}
function tryRotate180() {
  const p = S.piece; if (!p || p.type === "O") return false;
  const to = (p.state + 2) % 4;
  for (let i = 0; i < KICKS_180.length; i++) {
    const [kx, ky] = KICKS_180[i];
    if (!collides(S.board, p.type, to, p.x + kx, p.y + ky)) {
      p.x += kx; p.y += ky; p.state = to; lastAction = "rotate"; lastKick = -1;
      onSuccessfulShift(); sfx.rotate(); return true;
    }
  }
  return false;
}
function doHold() {
  if (!S.piece || holdUsed) return;
  sfx.hold();
  const cur = S.piece.type, held = S.hold;
  S.hold = cur; holdUsed = true;
  burst(150, 60, cur, 8, 2);
  if (!spawn(S, held)) return gameOver();
  drawPreview(holdCv, S.hold, true); drawNext(); updateHud();
}
function ghostY() {
  const p = S.piece; let gy = p.y;
  while (!collides(S.board, p.type, p.state, p.x, gy + 1)) gy++;
  return gy;
}
function hardDrop() {
  const p = S.piece; if (!p) return;
  const gy = ghostY(), dist = gy - p.y;
  if (settings.effects) for (const [x] of cellsOf(p.type, p.state, p.x, p.y))
    for (let y = Math.max(HIDDEN, p.y); y < gy; y += 2) burst(x * CELL + 15, (y - HIDDEN) * CELL + 15, p.type, 1, 0.7);
  p.y = gy; S.score += dist * 2;
  sfx.hard(); shake();
  if (vegasOn() && dist > 3) {
    for (const [x] of cellsOf(p.type, p.state, p.x, gy)) ringFx(x * CELL + 15, (Math.max(HIDDEN, gy) - HIDDEN) * CELL + 26, COLORS[p.type][1]);
  }
  lockPiece();
}
function lockPiece() {
  const p = S.piece;
  for (const [x, y] of cellsOf(p.type, p.state, p.x, p.y)) {
    if (y < 0) return gameOver();           /* ロックアウト */
    S.board[y][x] = p.type;
  }
  sfx.lock();
  const tspin = detectTSpin(S.board, p, lastAction, lastKick);
  const full = [];
  for (let y = 0; y < ROWS; y++) if (S.board[y].every(c => c)) full.push(y);
  const lines = full.length;
  /* Perfect Clear判定: 満杯行を除いた全行が空 = 消去後に盤面が空 */
  const boardAfterEmpty = lines > 0 && S.board.every((row, ry) => full.includes(ry) || row.every(c => !c));
  const wasB2B = S.b2b;
  const res = scoreClear({lines, tspin, b2bActive: wasB2B, level: S.level, combo: lines > 0 ? S.combo + 1 : -1, isPC: boardAfterEmpty});
  if (lines > 0) {
    S.combo++; S.stats.maxCombo = Math.max(S.stats.maxCombo, S.combo);
    if (res.difficult) S.b2b = true; else if (!(tspin && lines === 0)) S.b2b = false;
    S.score += res.points;
    if (lines === 4) S.stats.tetris++;
    if (tspin) S.stats.tspin++;
    if (boardAfterEmpty) { S.stats.pc++; }
    const oldLevel = S.level;
    S.lines += lines;
    S.level = Math.floor(S.lines / 10) + 1;
    /* 演出 */
    clearingRows = full; clearAnimUntil = performance.now() + 260;
    for (const y of full) for (let x = 0; x < COLS; x++) burst(x * CELL + 15, (y - HIDDEN) * CELL + 15, S.board[y][x], 5, 3.4);
    laserSweep(full);
    addFever(lines * 14 + (res.difficult ? 20 : 0) + Math.max(0, S.combo) * 3);
    if (boardAfterEmpty) { showBanner("PERFECT CLEAR!", res.label, true); sfx.pc(); sfx.jackpot(); flashFx("#ffd76a"); punchFx(); hitStopUntil = performance.now() + 150;
      fireworks(80, 220, 52); fireworks(220, 220, 52); fireworks(150, 380, 60); coinFountain(150, 430, 42);
      floatText(150, 240, "+" + res.points.toLocaleString(), "#ffffff", 30); }
    else if (lines === 4) { showBanner(wasB2B ? "B2B TETRIS!" : "TETRIS!", wasB2B ? "✦ BRILLIANT ✦" : "", true); sfx.tetris(); shake(); punchFx(); flashFx("#ffffff"); hitStopUntil = performance.now() + 95;
      fireworks(150, 300, 56); ringFx(150, 300, "#ffd76a"); if (wasB2B) coinFountain(150, 380, 26);
      floatText(150, 260, "+" + res.points.toLocaleString(), "#ffd76a", 28); }
    else if (tspin) { showBanner(res.label + "!", wasB2B && res.difficult ? "BACK-TO-BACK" : "", false); sfx.tspin(); if (lines >= 2) fireworks(150, 320, 36);
      floatText(150, 260, "+" + res.points.toLocaleString(), "#e0aaff", 24); }
    else { sfx.clear(lines); floatText(150, 260, "+" + res.points.toLocaleString(), "#a5f7ff", 19); }
    if (S.combo >= 1) floatText(150, 300, "COMBO " + S.combo, "#ff7ad9", 17);
    setTimeout(() => {
      S.board = S.board.filter((_, ry) => !full.includes(ry));
      while (S.board.length < ROWS) S.board.unshift(Array(COLS).fill(null));
      clearingRows = null;
      finishSpawn();
    }, settings.effects ? 240 : 0);
    if (S.level > oldLevel) setTimeout(() => { showBanner("LEVEL " + S.level, "SPEED UP!"); sfx.levelup(); fireworks(90, 200, 40); fireworks(210, 200, 40); }, 300);
    updateHud();
    if (!endless && S.lines >= MARATHON_GOAL) return marathonClear();
    return;
  }
  /* 消去なし */
  S.combo = -1;
  if (tspin) {
    S.score += res.points;
    showBanner(res.label + "!", "", false); sfx.tspin();
    floatText(150, 260, "+" + res.points.toLocaleString(), "#e0aaff", 20);
  }
  finishSpawn();
  updateHud();
}
function finishSpawn() {
  holdUsed = false;
  if (!spawn(S)) return gameOver();
  drawPreview(holdCv, S.hold, false); drawNext(); updateHud();
}

/* ---------- メインループ ---------- */
function frame(t) {
  if (!running) return;
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(50, t - (lastTime || t)); lastTime = t;
  drawStars(t);
  if (!paused && !countingDown && S && !S.over && !clearingRows) {
    playMs += dt;
    updateFever(dt);
    if (vegasOn() && S.piece && performance.now() >= hitStopUntil) {
      trailAcc += dt;
      if (trailAcc > 46 && (keys.down || isFever())) {
        trailAcc = 0;
        trails.push({cells: cellsOf(S.piece.type, S.piece.state, S.piece.x, S.piece.y), type: S.piece.type, life: 0.55});
        if (trails.length > 14) trails.shift();
      }
    }
    /* DAS / ARR */
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir !== 0 && dir === activeDir) {
      dasAcc += dt;
      if (dasAcc >= settings.das) {
        dasCharged = true; arrAcc += dt;
        const step = settings.arr === 0 ? 10 : Math.floor(arrAcc / settings.arr);
        if (settings.arr === 0) { while (tryMove(dir, 0)) {} arrAcc = 0; sfx.move(); }
        else if (step > 0) { arrAcc -= step * settings.arr; for (let i = 0; i < step; i++) if (tryMove(dir, 0)) sfx.move(); }
      }
    }
    /* 重力 / ソフトドロップ(ヒットストップ中は落下だけ止める) */
    const hitFrozen = performance.now() < hitStopUntil;
    const interval = keys.down ? Math.min(20, gravityMs(S.level) / 20) : gravityMs(S.level);
    if (!hitFrozen) dropAcc += dt;
    while (dropAcc >= interval) {
      dropAcc -= interval;
      if (!tryMove(0, 1)) break;
      if (keys.down) S.score += 1;   /* ソフトドロップ 1点/セル */
    }
    /* ロックディレイ */
    grounded = collides(S.board, S.piece.type, S.piece.state, S.piece.x, S.piece.y + 1);
    if (grounded && !hitFrozen) { lockAcc += dt; if (lockAcc >= LOCK_DELAY) { lockPiece(); lockAcc = 0; dropAcc = 0; } }
    else lockAcc = 0;
    if (S && S.piece) updateHudSoft();
  }
  drawBoard(); drawFx(dt);
}
function updateHudSoft() { $("score").textContent = S.score.toLocaleString(); }

/* ---------- 入力: 標準キーマップ ---------- */
/*  ←→ 移動 / ↓ ソフト / Space ハード / ↑・X 右回転 / Z 左回転
    A 180°回転 / C・Shift HOLD / P・Esc 一時停止 / R リスタート / M ミュート */
function startDirection(dirKey, dir) {
  keys[dirKey] = true; activeDir = dir; dasAcc = 0; arrAcc = 0; dasCharged = false;
  if (tryMove(dir, 0)) sfx.move();
}
function endDirection(dirKey, otherKey, otherDir) {
  keys[dirKey] = false;
  if (keys[otherKey]) startDirection(otherKey, otherDir);
  else activeDir = 0;
}
document.addEventListener("keydown", e => {
  if (!$("settings-overlay").hidden) { if (e.code === "Escape") closeSettings(); return; }
  const codes = ["ArrowLeft","ArrowRight","ArrowDown","ArrowUp","Space","KeyZ","KeyX","KeyA","KeyC","ShiftLeft","ShiftRight","KeyP","KeyR","KeyM","Escape","Enter"];
  if (!codes.includes(e.code)) return;
  e.preventDefault();
  if (e.code === "KeyM") { settings.sfx = !settings.sfx; saveSettings(); syncSettingsUi(); return; }
  if (!running || !S) { if (e.code === "KeyR" || e.code === "Enter") startGame(); return; }
  if (e.code === "KeyR") { startGame(); return; }
  if (e.code === "KeyP" || e.code === "Escape") { if (!countingDown) togglePause(); return; }
  if (paused || countingDown || S.over || clearingRows || e.repeat) return;
  switch (e.code) {
    case "ArrowLeft": if (!keys.left) startDirection("left", -1); break;
    case "ArrowRight": if (!keys.right) startDirection("right", 1); break;
    case "ArrowDown": keys.down = true; dropAcc = Math.max(dropAcc, gravityMs(S.level) / 20); break;
    case "ArrowUp": case "KeyX": tryRotate(1); break;
    case "KeyZ": tryRotate(-1); break;
    case "KeyA": tryRotate180(); break;
    case "Space": hardDrop(); dropAcc = 0; lockAcc = 0; break;
    case "KeyC": case "ShiftLeft": case "ShiftRight": doHold(); break;
  }
});
document.addEventListener("keyup", e => {
  if (e.code === "ArrowLeft") endDirection("left", "right", 1);
  if (e.code === "ArrowRight") endDirection("right", "left", -1);
  if (e.code === "ArrowDown") keys.down = false;
});
document.addEventListener("blur", () => { keys.left = keys.right = keys.down = false; activeDir = 0; });

/* タッチボタン */
document.querySelectorAll(".touch-pad button").forEach(btn => {
  const act = btn.dataset.act;
  const press = e => { e.preventDefault(); if (!running || paused || countingDown || !S || S.over) return;
    if (act === "left") { if (tryMove(-1, 0)) sfx.move(); }
    if (act === "right") { if (tryMove(1, 0)) sfx.move(); }
    if (act === "down") { if (tryMove(0, 1)) S.score += 1; }
    if (act === "cw") tryRotate(1); if (act === "ccw") tryRotate(-1);
    if (act === "hard") hardDrop(); if (act === "hold") doHold();
  };
  btn.addEventListener("pointerdown", press);
});

/* ---------- 開始・終了 ---------- */
function fmtTime(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function startGame(keepEndless = false) {
  S = newState(); refill(S);
  endless = keepEndless; holdUsed = false; paused = false; playMs = 0; dropAcc = 0; lockAcc = 0;
  particles = []; floats = []; beams = []; rings = []; trails = []; clearingRows = null;
  fever = 0; feverUntil = 0; hitStopUntil = 0; document.body.classList.remove("fever");
  $("start-overlay").hidden = true; $("results").hidden = true; $("pause-visual").hidden = true;
  $("pause").textContent = "一時停止（P）";
  if (!spawn(S)) return gameOver();
  running = true; lastTime = 0;
  drawPreview(holdCv, null); drawNext(); updateHud();
  $("status").textContent = "プレイ中 — 150ラインを目指そう！";
  cancelAnimationFrame(rafId); rafId = requestAnimationFrame(frame);
  countdown();
}
function countdown() {
  const el = $("countdown");
  countingDown = true; el.hidden = false;
  const seq = ["3", "2", "1", "GO!"]; let i = 0;
  const step = () => {
    if (i >= seq.length) { el.hidden = true; countingDown = false; return; }
    el.textContent = seq[i];
    el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
    if (seq[i] === "GO!") sfx.go(); else sfx.count();
    i++; setTimeout(step, seq[i] === undefined ? 350 : 620);
  };
  step();
}
function saveHigh() {
  if (S.score > highScore) { highScore = S.score; localStorage.setItem("brilliant-high", String(highScore)); }
  $("start-high-score").textContent = highScore.toLocaleString();
}
function showResults(title, eyebrow) {
  saveHigh();
  $("results-title").textContent = title;
  $("results-eyebrow").textContent = eyebrow;
  $("results-score").textContent = S.score.toLocaleString();
  $("results-lines").textContent = S.lines;
  $("results-level").textContent = S.level;
  $("results-time").textContent = fmtTime(playMs);
  $("results-tetrises").textContent = S.stats.tetris;
  $("results-tspins").textContent = S.stats.tspin;
  $("results-pcs").textContent = S.stats.pc;
  $("results-maxcombo").textContent = Math.max(0, S.stats.maxCombo);
  $("results-high-score").textContent = highScore.toLocaleString();
  $("continue-endless").hidden = !(title === "MARATHON COMPLETE!");
  $("results").hidden = false;
  updateHud();
}
function gameOver() {
  S.over = true; sfx.over(); shake();
  for (let x = 0; x < COLS; x++) burst(x * CELL + 15, 60, "T", 4, 2);
  $("status").textContent = "GAME OVER";
  setTimeout(() => showResults("GAME OVER", "RESULTS"), 650);
}
function marathonClear() {
  sfx.pc(); showBanner("MARATHON COMPLETE!", "✦ CONGRATULATIONS ✦", true);
  $("status").textContent = "MARATHON COMPLETE!";
  setTimeout(() => showResults("MARATHON COMPLETE!", "✦ CLEAR ✦"), 900);
}
function togglePause() {
  if (!S || S.over) return;
  paused = !paused;
  $("pause-visual").hidden = !paused;
  $("pause").textContent = paused ? "再開（P）" : "一時停止（P）";
  $("status").textContent = paused ? "一時停止中" : "プレイ中";
}

/* ---------- 設定 ---------- */
function saveSettings() { localStorage.setItem("brilliant-settings", JSON.stringify(settings)); }
function syncSettingsUi() {
  $("setting-das").value = settings.das; $("setting-das-value").textContent = settings.das + " ms";
  $("setting-arr").value = settings.arr; $("setting-arr-value").textContent = settings.arr + " ms";
  $("setting-sfx").checked = settings.sfx;
  $("setting-volume").value = settings.volume * 100; $("setting-volume-value").textContent = Math.round(settings.volume * 100) + "%";
  $("setting-effects").checked = settings.effects;
  $("setting-shake").checked = settings.shake;
  $("setting-vegas").checked = settings.vegas;
  $("toggle-sound").textContent = settings.sfx ? "SOUND ON（M）" : "SOUND OFF（M）";
}
function openSettings() { syncSettingsUi(); $("settings-overlay").hidden = false; }
function closeSettings() { $("settings-overlay").hidden = true; saveSettings(); }
$("setting-das").addEventListener("input", e => { settings.das = +e.target.value; syncSettingsUi(); });
$("setting-arr").addEventListener("input", e => { settings.arr = +e.target.value; syncSettingsUi(); });
$("setting-sfx").addEventListener("change", e => { settings.sfx = e.target.checked; syncSettingsUi(); });
$("setting-volume").addEventListener("input", e => { settings.volume = +e.target.value / 100; syncSettingsUi(); });
$("setting-effects").addEventListener("change", e => { settings.effects = e.target.checked; });
$("setting-shake").addEventListener("change", e => { settings.shake = e.target.checked; });
$("setting-vegas").addEventListener("change", e => { settings.vegas = e.target.checked; if (!settings.vegas) { document.body.classList.remove("fever"); fever = 0; feverUntil = 0; } });
$("reset-settings").addEventListener("click", () => { Object.assign(settings, {das: 150, arr: 30, sfx: true, volume: 0.8, effects: true, shake: true, vegas: true}); syncSettingsUi(); saveSettings(); });
$("close-settings").addEventListener("click", closeSettings);
$("open-settings").addEventListener("click", openSettings);
$("toggle-sound").addEventListener("click", () => { settings.sfx = !settings.sfx; saveSettings(); syncSettingsUi(); });
$("pause").addEventListener("click", togglePause);
$("restart").addEventListener("click", () => startGame());
$("start-game").addEventListener("click", () => startGame());
$("play-again").addEventListener("click", () => startGame());
$("continue-endless").addEventListener("click", () => { endless = true; $("results").hidden = true; running = true; paused = false; if (!spawn(S)) return gameOver(); holdUsed = false; drawNext(); updateHud(); });

/* ---------- 起動 ---------- */
S = newState(); refill(S); spawn(S);
$("start-high-score").textContent = highScore.toLocaleString();
$("high-score").textContent = highScore.toLocaleString();
syncSettingsUi(); drawPreview(holdCv, null); drawNext(); updateHud(); drawBoard(); drawStars(0);
running = false;
}
