"use strict";

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 20;
const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const NEXT_COUNT = 5;
const LINE_CLEAR_SCORES = [0, 100, 300, 500, 800];
// 代表的なGuideline系得点。Mini Doubleも含む（https://tetris.wiki/Scoring）。
const T_SPIN_SCORES = [400, 800, 1200, 1600];
const T_SPIN_MINI_SCORES = [100, 200, 400];
// piece.yとboardは内部座標。Spawn枠は表示最上段の1行上。
const SPAWN_Y = HIDDEN_ROWS - 1;
const CELL = 30;
const DROP_INTERVAL = 700;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const HORIZONTAL_DAS = 170;
const HORIZONTAL_ARR = 50;
const SOFT_DROP_INTERVAL = 40;
const MAX_INPUT_CATCHUP = 250;
const heldKeys = { ArrowLeft: false, ArrowRight: false, ArrowDown: false };
let activeDirection = null;
let nextHorizontalTime = Infinity;
let nextSoftDropTime = Infinity;

function clearHeldKeys() {
  if (heldKeys.ArrowDown) dropElapsed = 0;
  for (const code of Object.keys(heldKeys)) heldKeys[code] = false;
  activeDirection = null;
  nextHorizontalTime = nextSoftDropTime = Infinity;
}
const SHAPES = [
  [[1, 1, 1, 1]],                 // I
  [[1, 1], [1, 1]],               // O
  [[0, 1, 0], [1, 1, 1]],         // T
  [[0, 1, 1], [1, 1, 0]],         // S
  [[1, 1, 0], [0, 1, 1]],         // Z
  [[1, 0, 0], [1, 1, 1]],         // J
  [[0, 0, 1], [1, 1, 1]],         // L
];
// 正方形の枠を固定して回転する。3×3は中央マス、I型は4マスの交点が中心。
// SHAPESはプレビュー用の余白なしの形として残す。
const ROTATIONS = SHAPES.map((shape, type) => {
  const size = type === 0 ? 4 : type === 1 ? 2 : 3;
  const initial = Array.from({ length: size }, () => Array(size).fill(0));
  shape.forEach((row, y) => row.forEach((cell, x) => {
    initial[y + (type === 0 ? 1 : 0)][x] = cell;
  }));
  const states = [initial];
  for (let rotation = 1; rotation < 4; rotation++) {
    const previous = states[rotation - 1];
    states.push(previous[0].map((_, x) => previous.map(row => row[x]).reverse()));
  }
  return states;
});
const COLORS = ["", "#43d4ec", "#f4d35e", "#bc86ef", "#72d68b", "#ed6d79", "#6396ed", "#eea052"];
const canvas = document.getElementById("board");
const context = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const statusElement = document.getElementById("status");
const levelElement = document.getElementById("level");
const highScoreElement = document.getElementById("high-score");
const linesElement = document.getElementById("lines");
const b2bElement = document.getElementById("b2b");
const comboElement = document.getElementById("combo");
const clearEventElement = document.getElementById("clear-event");
const CLEAR_EVENT_DURATION = 1200;
let clearEventTimer = null;
const pauseButton = document.getElementById("pause");
const HIGH_SCORE_KEY = "falling-block-high-score";
let highScore = 0;
try {
  const saved = Number(localStorage.getItem(HIGH_SCORE_KEY));
  if (Number.isSafeInteger(saved) && saved >= 0) highScore = saved;
} catch {
  // 保存が許可されていなくてもゲームは実行できる。
}
highScoreElement.textContent = highScore;
let board;
let piece;
let score;
let gameOver;
let paused;
let nextQueue = [];
let heldType;
let holdUsed;
let totalLines;
let level;
let dropElapsed = 0;
let lockElapsed = 0;
let lockResets = 0;
let lastTime = null;
let bag = [];
// nullは最後の成功した動きが回転ではないことを表す。候補番号は0始まり。
let lastRotationKick = null;
// 確定済みの結果は次のSpawnでも保持し、進行中ピースの回転資格とは分離する。
let lastLockResult = null;
let backToBackActive = false;
// -1: 継続なし、0: 最初の消去、1以上: Comboボーナス対象。
let comboCount = -1;

function updateProgressUI() {
  linesElement.textContent = totalLines;
  b2bElement.textContent = backToBackActive ? "B2B ON" : "B2B OFF";
  comboElement.textContent = !gameOver && comboCount > 0 ? `COMBO ${comboCount}` : "";
}

function clearSpinFeedback() {
  clearTimeout(clearEventTimer);
  clearEventTimer = null;
  clearEventElement.textContent = "";
}

function showSpinFeedback() {
  clearSpinFeedback();
  if (gameOver || lastLockResult.spin === "NONE") return;
  const name = lastLockResult.spin === "T_SPIN_MINI" ? "T-SPIN MINI" : "T-SPIN";
  const suffix = ["", " SINGLE", " DOUBLE", " TRIPLE"][lastLockResult.lines];
  clearEventElement.textContent = name + suffix;
  // 表示だけの実時間タイマー。Pause中も消え、ゲーム進行の時計には触れない。
  clearEventTimer = setTimeout(clearSpinFeedback, CLEAR_EVENT_DURATION);
}

// 7種類を1回ずつ使う順番をシャッフルする。
function nextType() {
  if (bag.length === 0) {
    bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

function collides(shape, x, y) {
  return shape.some((row, dy) => row.some((cell, dx) => {
    if (!cell) return false;
    const bx = x + dx;
    const by = y + dy;
    return bx < 0 || bx >= COLS || by < 0 || by >= TOTAL_ROWS || board[by][bx] !== 0;
  }));
}

function spawnPiece(type = nextQueue[0]) {
  lastRotationKick = null;
  const shape = ROTATIONS[type][0];
  piece = { shape, rotation: 0, x: Math.floor((COLS - shape[0].length) / 2), y: SPAWN_Y, color: type + 1 };
  dropElapsed = 0;
  lockElapsed = 0;
  lockResets = 0;
  if (collides(shape, piece.x, piece.y)) endGame();
}

function endGame() {
  lastRotationKick = null;
  gameOver = true;
  clearSpinFeedback();
  updateProgressUI();
  clearHeldKeys();
  statusElement.textContent = "ゲームオーバー — R またはボタンで再開";
  pauseButton.disabled = true;
}

function advancePiece() {
  const type = nextQueue.shift();
  while (nextQueue.length < NEXT_COUNT) nextQueue.push(nextType());
  spawnPiece(type);
}

function hold() {
  if (holdUsed) return;
  const type = piece.color - 1;
  if (heldType === null) {
    heldType = type;
    advancePiece();
  } else {
    const previous = heldType;
    heldType = type;
    spawnPiece(previous);
  }
  holdUsed = true;
}

function dropInterval() {
  return Math.max(100, DROP_INTERVAL - (level - 1) * 60);
}

function togglePause(time = performance.now()) {
  if (gameOver) return;
  advanceTime(time);
  if (gameOver) return;
  paused = !paused;
  clearHeldKeys();
  statusElement.textContent = paused ? "一時停止中" : "プレイ中";
  pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
}

function ghostY() {
  let y = piece.y;
  while (!collides(piece.shape, piece.x, y + 1)) y++;
  return y;
}

function drawPreview(id, types) {
  const preview = document.getElementById(id);
  const ctx = preview.getContext("2d");
  ctx.clearRect(0, 0, preview.width, preview.height);
  const slotHeight = preview.height / types.length;
  const size = id === "next" ? 16 : 24;
  types.forEach((type, index) => {
    if (type === null) return;
    const shape = SHAPES[type];
    const left = (preview.width - shape[0].length * size) / 2;
    const top = index * slotHeight + (slotHeight - shape.length * size) / 2;
    ctx.fillStyle = COLORS[type + 1];
    shape.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) ctx.fillRect(left + x * size + 1, top + y * size + 1, size - 2, size - 2);
    }));
  });
}

function isGrounded() {
  return collides(piece.shape, piece.x, piece.y + 1);
}

function resetLockDelay() {
  if (lockResets < MAX_LOCK_RESETS) {
    lockElapsed = 0;
    lockResets++;
  }
}

function move(dx, dy) {
  if (collides(piece.shape, piece.x + dx, piece.y + dy)) return false;
  const wasGrounded = isGrounded();
  piece.x += dx;
  piece.y += dy;
  // Gravity・Dropを含む実移動で解除。衝突した入力ではここへ到達しない。
  if (dx !== 0 || dy !== 0) lastRotationKick = null;
  if (dx !== 0 && wasGrounded) resetLockDelay();
  return true;
}

// SRSの左右回転候補。キーは回転前>回転後、座標は右・下が正。
// https://erikdemaine.org/papers/TetrisPieces_FUN2024/paper.pdf の表2・3
const COMMON_KICKS = {
  "0>1": [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
  "1>2": [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
  "2>3": [[0,0], [1,0], [1,-1], [0,2], [1,2]],
  "3>0": [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
  "0>3": [[0,0], [1,0], [1,-1], [0,2], [1,2]],
  "3>2": [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
  "2>1": [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
  "1>0": [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
};
const I_KICKS = {
  "0>1": [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],
  "1>2": [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],
  "2>3": [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],
  "3>0": [[0,0], [1,0], [-2,0], [1,2], [-2,-1]],
  "0>3": [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],
  "3>2": [[0,0], [1,0], [-2,0], [1,-2], [-2,1]],
  "2>1": [[0,0], [1,0], [-2,0], [1,2], [-2,-1]],
  "1>0": [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],
};

function rotate(direction = 1) {
  const rotation = (piece.rotation + direction + 4) % 4;
  const rotated = ROTATIONS[piece.color - 1][rotation];
  const transition = `${piece.rotation}>${rotation}`;
  const kicks = piece.color === 2 ? [[0,0]]
    : (piece.color === 1 ? I_KICKS : COMMON_KICKS)[transition];
  for (const [kickIndex, [dx, dy]] of kicks.entries()) {
    if (collides(rotated, piece.x + dx, piece.y + dy)) continue;
    const wasGrounded = isGrounded();
    piece.x += dx;
    piece.y += dy;
    piece.shape = rotated;
    piece.rotation = rotation;
    lastRotationKick = kickIndex;
    if (wasGrounded) resetLockDelay();
    return;
  }
}

function addScore(points) {
  score += points;
  scoreElement.textContent = score;
  if (score > highScore) {
    highScore = score;
    try {
      // 他のタブの記録を、起動時に読んだ古い値で上書きしない。
      const saved = Number(localStorage.getItem(HIGH_SCORE_KEY));
      const savedScore = Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
      highScore = Math.max(highScore, savedScore);
      if (highScore > savedScore) localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    } catch {
      // 保存できない場合も、このページ内では記録を維持する。
    }
    highScoreElement.textContent = highScore;
  }
}

// TetrisWikiの3-corner / 前側2角方式。第5候補の回転はMiniからFullへ。
// https://tetris.wiki/T-Spin （最新公式Guideline全文の保証ではない）
function detectTSpin() {
  if (piece.color !== 3 || lastRotationKick === null) return "NONE";
  const center = (piece.shape.length - 1) / 2;
  // 左上・右上・右下・左下。collidesで内部盤面の境界も占有扱いにする。
  const corners = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([dx, dy]) =>
    collides([[1]], piece.x + center + dx, piece.y + center + dy));
  if (corners.filter(Boolean).length < 3) return "NONE";
  // 状態0:上、1:右、2:下、3:左がTの突き出す側。
  const frontFilled = corners[piece.rotation] && corners[(piece.rotation + 1) % 4];
  return frontFilled || lastRotationKick === 4 ? "T_SPIN" : "T_SPIN_MINI";
}

function calculateClearScore(spin, lines, level) {
  const scores = spin === "T_SPIN" ? T_SPIN_SCORES
    : spin === "T_SPIN_MINI" ? T_SPIN_MINI_SCORES
    : spin === "NONE" ? LINE_CLEAR_SCORES : [];
  // 表にない組み合わせには得点を作らず、NaNの加算も防ぐ。
  return (scores[lines] ?? 0) * level;
}

// ライン消去を伴うTetris / Full / Miniが対象。0ラインは含めない。
function isDifficultClear(spin, lines) {
  return (spin === "NONE" && lines === 4)
    || (spin === "T_SPIN" && lines >= 1 && lines <= 3)
    || (spin === "T_SPIN_MINI" && lines >= 1 && lines <= 2);
}

function lockPiece() {
  lastLockResult = { spin: detectTSpin(), lines: 0 };
  // 消去前の固定位置で判定。一部が見えていればLock Outにしない。
  const lockOut = piece.shape.every((row, dy) => row.every(cell => !cell || piece.y + dy < HIDDEN_ROWS));
  piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
    if (cell) board[piece.y + dy][piece.x + dx] = piece.color;
  }));
  if (lockOut) {
    endGame();
    return;
  }
  const remaining = board.filter(row => row.some(cell => cell === 0));
  const cleared = TOTAL_ROWS - remaining.length;
  lastLockResult.lines = cleared;
  while (remaining.length < TOTAL_ROWS) remaining.unshift(Array(COLS).fill(0));
  board = remaining;
  // 今回の消去によるLevel上昇より前の倍率を使う。
  let clearScore = calculateClearScore(lastLockResult.spin, cleared, level);
  const difficult = isDifficultClear(lastLockResult.spin, cleared);
  if (backToBackActive && difficult) clearScore = clearScore * 3 / 2;
  comboCount = cleared > 0 ? comboCount + 1 : -1;
  const comboScore = comboCount > 0 ? 50 * comboCount * level : 0;
  addScore(clearScore + comboScore);
  // 最初の対象消去は開始だけ。0ラインは既存の連続状態を維持する。
  if (cleared > 0) backToBackActive = difficult;
  totalLines += cleared;
  level = Math.floor(totalLines / 10) + 1;
  levelElement.textContent = level;
  dropElapsed = 0;
  holdUsed = false;
  advancePiece();
  updateProgressUI();
  showSpinFeedback();
}

function stepDown(softDrop = false) {
  if (move(0, 1)) {
    if (softDrop) addScore(1);
  }
}

function hardDrop() {
  let distance = 0;
  while (move(0, 1)) distance++;
  addScore(distance * 2);
  lockPiece();
}

function drawCell(x, y, color) {
  if (y < HIDDEN_ROWS || y >= TOTAL_ROWS) return;
  const visibleY = y - HIDDEN_ROWS;
  context.fillStyle = COLORS[color];
  context.fillRect(x * CELL + 1, visibleY * CELL + 1, CELL - 2, CELL - 2);
}

function draw() {
  drawPreview("next", nextQueue);
  drawPreview("hold", [heldType]);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#191c22";
  context.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    context.beginPath();
    context.moveTo(x * CELL, 0);
    context.lineTo(x * CELL, VISIBLE_ROWS * CELL);
    context.stroke();
  }
  for (let y = 0; y <= VISIBLE_ROWS; y++) {
    context.beginPath();
    context.moveTo(0, y * CELL);
    context.lineTo(COLS * CELL, y * CELL);
    context.stroke();
  }
  board.forEach((row, y) => row.forEach((color, x) => {
    if (color) drawCell(x, y, color);
  }));
  if (!gameOver) {
    const landingY = ghostY();
    context.globalAlpha = 0.25;
    piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) drawCell(piece.x + dx, landingY + dy, piece.color);
    }));
    context.globalAlpha = 1;
    piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) drawCell(piece.x + dx, piece.y + dy, piece.color);
    }));
  }
}

function restart() {
  clearSpinFeedback();
  comboCount = -1;
  backToBackActive = false;
  lastLockResult = null;
  clearHeldKeys();
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  score = 0;
  gameOver = false;
  paused = false;
  heldType = null;
  holdUsed = false;
  totalLines = 0;
  level = 1;
  levelElement.textContent = level;
  pauseButton.disabled = false;
  pauseButton.textContent = "一時停止（P）";
  bag = [];
  nextQueue = [nextType()];
  dropElapsed = 0;
  lastTime = null;
  scoreElement.textContent = "0";
  statusElement.textContent = "プレイ中";
  advancePiece();
  updateProgressUI();
  draw();
}

document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyR", "KeyC", "KeyP", "KeyZ"].includes(event.code)) return;
  event.preventDefault();
  if (event.repeat || heldKeys[event.code]) return;
  if (event.code === "KeyR") {
    if (!event.repeat) restart();
    return;
  }
  if (event.code === "KeyP") {
    if (!event.repeat) togglePause(event.timeStamp);
    return;
  }
  if (gameOver || paused) return;
  // 入力前の時間は入力前の姿勢に適用し、着地・リセット前の時間を混ぜない。
  advanceTime(event.timeStamp);
  if (gameOver) return;
  if (event.code in heldKeys) {
    heldKeys[event.code] = true;
    if (event.code === "ArrowDown") nextSoftDropTime = lastTime + SOFT_DROP_INTERVAL;
    else {
      activeDirection = event.code;
      nextHorizontalTime = lastTime + HORIZONTAL_DAS;
    }
  }
  switch (event.code) {
    case "ArrowLeft": move(-1, 0); break;
    case "ArrowRight": move(1, 0); break;
    case "ArrowUp": if (!event.repeat) rotate(); break;
    case "KeyZ": if (!event.repeat) rotate(-1); break;
    case "ArrowDown": stepDown(true); dropElapsed = 0; break;
    case "Space": if (!event.repeat) hardDrop(); break;
    case "KeyC": if (!event.repeat) hold(); break;
  }
  draw();
});
document.getElementById("restart").addEventListener("click", restart);
document.addEventListener("keyup", event => {
  if (!(event.code in heldKeys) || !heldKeys[event.code]) return;
  advanceTime(event.timeStamp);
  heldKeys[event.code] = false;
  if (event.code === "ArrowDown") {
    nextSoftDropTime = Infinity;
    dropElapsed = 0;
  } else if (activeDirection === event.code) {
    const other = event.code === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    activeDirection = heldKeys[other] ? other : null;
    nextHorizontalTime = activeDirection ? lastTime + HORIZONTAL_DAS : Infinity;
  }
});
pauseButton.addEventListener("click", event => togglePause(event.timeStamp));

// 別タブから戻ったときに経過時間分が一気に落ちるのを防ぐ。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearHeldKeys();
  lastTime = null;
});
window.addEventListener("blur", () => { clearHeldKeys(); lastTime = null; });

function advanceTime(time) {
  if (lastTime !== null && time - lastTime > MAX_INPUT_CATCHUP) {
    // 古い繰り返しは現在時刻の1回にまとめ、低更新頻度でも入力を進める。
    if (activeDirection && nextHorizontalTime <= time) nextHorizontalTime = time;
    if (heldKeys.ArrowDown && nextSoftDropTime <= time) nextSoftDropTime = time;
  }
  while (!paused && !gameOver && !document.hidden) {
    const due = Math.min(nextHorizontalTime, nextSoftDropTime);
    if (due > time) break;
    advanceSimulation(due);
    if (gameOver) break;
    if (nextHorizontalTime === due) {
      move(activeDirection === "ArrowLeft" ? -1 : 1, 0);
      nextHorizontalTime += HORIZONTAL_ARR;
    }
    if (nextSoftDropTime === due) {
      stepDown(true);
      nextSoftDropTime += SOFT_DROP_INTERVAL;
    }
    draw();
  }
  advanceSimulation(time);
}

function advanceSimulation(time) {
  if (lastTime === null) lastTime = time;
  // 同じフレーム内で入力が先に処理されても時間を巻き戻さない。
  time = Math.max(time, lastTime);
  if (!gameOver && !paused && !document.hidden) {
    let remaining = time - lastTime;
    let changed = false;
    // 落下前と着地後の時間を分け、着地する前の時間を固定待ちに加えない。
    while (remaining > 0) {
      if (isGrounded()) {
        dropElapsed = 0;
        lockElapsed += remaining;
        if (lockElapsed >= LOCK_DELAY) {
          lockPiece();
          changed = true;
        }
        break;
      }
      if (heldKeys.ArrowDown) break;
      const elapsed = Math.min(remaining, dropInterval() - dropElapsed);
      dropElapsed += elapsed;
      remaining -= elapsed;
      if (dropElapsed >= dropInterval()) {
        dropElapsed = 0;
        stepDown();
        changed = true;
      }
    }
    if (changed) draw();
  }
  lastTime = time;
}

function update(time) {
  advanceTime(time);
  requestAnimationFrame(update);
}

restart();
requestAnimationFrame(update);
