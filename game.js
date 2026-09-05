"use strict";

const COLS = 10;
const ROWS = 20;
const CELL = 30;
const DROP_INTERVAL = 700;
const SHAPES = [
  [[1, 1, 1, 1]],                 // I
  [[1, 1], [1, 1]],               // O
  [[0, 1, 0], [1, 1, 1]],         // T
  [[0, 1, 1], [1, 1, 0]],         // S
  [[1, 1, 0], [0, 1, 1]],         // Z
  [[1, 0, 0], [1, 1, 1]],         // J
  [[0, 0, 1], [1, 1, 1]],         // L
];
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
  const shape = SHAPES[type].map(row => row.slice());
  piece = { shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0, color: type + 1 };
  dropElapsed = 0;
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

function move(dx, dy) {
  if (collides(piece.shape, piece.x + dx, piece.y + dy)) return false;
  piece.x += dx;
  piece.y += dy;
  return true;
}

function rotate() {
  const rotated = piece.shape[0].map((_, x) => piece.shape.map(row => row[x]).reverse());
  // 壁や固定済みブロックに重なる回転は取り消す。
  if (!collides(rotated, piece.x, piece.y)) piece.shape = rotated;
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
  } else {
    lockPiece();
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
    dropElapsed += time - lastTime;
    if (dropElapsed >= dropInterval()) {
      // フレームの余りを保持する。固定後はspawnPieceで時間をリセットする。
      while (!gameOver && dropElapsed >= dropInterval()) {
        dropElapsed -= dropInterval();
        stepDown();
      }
      draw();
    }
  }
  lastTime = time;
  requestAnimationFrame(update);
}

restart();
requestAnimationFrame(update);
