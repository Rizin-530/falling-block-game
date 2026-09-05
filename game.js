"use strict";

const COLS = 10;
const ROWS = 20;
const CELL = 30;
const DROP_INTERVAL = 700;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
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
let upcomingType;
let heldType;
let holdUsed;
let totalLines;
let level;
let dropElapsed = 0;
let lockElapsed = 0;
let lockResets = 0;
let lastTime = null;
let bag = [];

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
    return bx < 0 || bx >= COLS || by < 0 || by >= ROWS || board[by][bx] !== 0;
  }));
}

function spawnPiece(type = upcomingType) {
  const shape = ROTATIONS[type][0];
  piece = { shape, rotation: 0, x: Math.floor((COLS - shape[0].length) / 2), y: 0, color: type + 1 };
  dropElapsed = 0;
  lockElapsed = 0;
  lockResets = 0;
  if (collides(shape, piece.x, piece.y)) {
    gameOver = true;
    statusElement.textContent = "ゲームオーバー — R またはボタンで再開";
    pauseButton.disabled = true;
  }
}

function advancePiece() {
  const type = upcomingType;
  upcomingType = nextType();
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

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  lastTime = null;
  statusElement.textContent = paused ? "一時停止中" : "プレイ中";
  pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
}

function ghostY() {
  let y = piece.y;
  while (!collides(piece.shape, piece.x, y + 1)) y++;
  return y;
}

function drawPreview(id, type) {
  const preview = document.getElementById(id);
  const ctx = preview.getContext("2d");
  ctx.clearRect(0, 0, preview.width, preview.height);
  if (type === null) return;
  const shape = SHAPES[type].map(row => row.slice());
  const size = 24;
  const left = (preview.width - shape[0].length * size) / 2;
  const top = (preview.height - shape.length * size) / 2;
  ctx.fillStyle = COLORS[type + 1];
  shape.forEach((row, y) => row.forEach((cell, x) => {
    if (cell) ctx.fillRect(left + x * size + 1, top + y * size + 1, size - 2, size - 2);
  }));
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
  if (dx !== 0 && wasGrounded) resetLockDelay();
  return true;
}

// SRSの右回転候補。キーは回転前>回転後、座標は右・下が正。
// https://erikdemaine.org/papers/TetrisPieces_FUN2024/paper.pdf の表2・3
const COMMON_KICKS = {
  "0>1": [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
  "1>2": [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
  "2>3": [[0,0], [1,0], [1,-1], [0,2], [1,2]],
  "3>0": [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
};
const I_KICKS = {
  "0>1": [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],
  "1>2": [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],
  "2>3": [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],
  "3>0": [[0,0], [1,0], [-2,0], [1,2], [-2,-1]],
};

function rotate() {
  const rotation = (piece.rotation + 1) % 4;
  const rotated = ROTATIONS[piece.color - 1][rotation];
  const transition = `${piece.rotation}>${rotation}`;
  const kicks = piece.color === 2 ? [[0,0]]
    : (piece.color === 1 ? I_KICKS : COMMON_KICKS)[transition];
  for (const [dx, dy] of kicks) {
    if (collides(rotated, piece.x + dx, piece.y + dy)) continue;
    const wasGrounded = isGrounded();
    piece.x += dx;
    piece.y += dy;
    piece.shape = rotated;
    piece.rotation = rotation;
    if (wasGrounded) resetLockDelay();
    return;
  }
}

function addScore(points) {
  score += points;
  scoreElement.textContent = score;
  if (score > highScore) {
    highScore = score;
    highScoreElement.textContent = highScore;
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    } catch {
      // 保存できない場合も、このページ内では記録を維持する。
    }
  }
}

function lockPiece() {
  piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
    if (cell) board[piece.y + dy][piece.x + dx] = piece.color;
  }));
  const remaining = board.filter(row => row.some(cell => cell === 0));
  const cleared = ROWS - remaining.length;
  while (remaining.length < ROWS) remaining.unshift(Array(COLS).fill(0));
  board = remaining;
  addScore([0, 100, 300, 500, 800][cleared]);
  totalLines += cleared;
  level = Math.floor(totalLines / 10) + 1;
  levelElement.textContent = level;
  dropElapsed = 0;
  holdUsed = false;
  advancePiece();
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
  context.fillStyle = COLORS[color];
  context.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
}

function draw() {
  drawPreview("next", upcomingType);
  drawPreview("hold", heldType);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#191c22";
  context.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    context.beginPath();
    context.moveTo(x * CELL, 0);
    context.lineTo(x * CELL, ROWS * CELL);
    context.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
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
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
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
  upcomingType = nextType();
  dropElapsed = 0;
  lastTime = null;
  scoreElement.textContent = "0";
  statusElement.textContent = "プレイ中";
  advancePiece();
  draw();
}

document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyR", "KeyC", "KeyP"].includes(event.code)) return;
  event.preventDefault();
  if (event.code === "KeyR") {
    if (!event.repeat) restart();
    return;
  }
  if (event.code === "KeyP") {
    if (!event.repeat) togglePause();
    return;
  }
  if (gameOver || paused) return;
  switch (event.code) {
    case "ArrowLeft": move(-1, 0); break;
    case "ArrowRight": move(1, 0); break;
    case "ArrowUp": if (!event.repeat) rotate(); break;
    case "ArrowDown": stepDown(true); dropElapsed = 0; break;
    case "Space": if (!event.repeat) hardDrop(); break;
    case "KeyC": if (!event.repeat) hold(); break;
  }
  draw();
});
document.getElementById("restart").addEventListener("click", restart);
pauseButton.addEventListener("click", togglePause);

// 別タブから戻ったときに経過時間分が一気に落ちるのを防ぐ。
document.addEventListener("visibilitychange", () => { lastTime = null; });

function update(time) {
  if (lastTime === null) lastTime = time;
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
  requestAnimationFrame(update);
}

restart();
requestAnimationFrame(update);
