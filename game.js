"use strict";

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 20;
const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const NEXT_COUNT = 5;
const MARATHON_TARGET_LINES = 150;
const LINE_CLEAR_SCORES = [0, 100, 300, 500, 800];
const PERFECT_CLEAR_SCORES = [0, 800, 1200, 1800, 2000];
const B2B_TETRIS_PERFECT_CLEAR_SCORE = 3200;
// 代表的なGuideline系得点。Mini Doubleも含む（https://tetris.wiki/Scoring）。
const T_SPIN_SCORES = [400, 800, 1200, 1600];
const T_SPIN_MINI_SCORES = [100, 200, 400];
// piece.yとboardは内部座標。Spawn枠は表示最上段の1行上。
const SPAWN_Y = HIDDEN_ROWS - 1;
const CELL = 30;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const MAX_INPUT_CATCHUP = 250;
const SETTINGS_KEY = "falling-block-settings";
const DEFAULT_SETTINGS = Object.freeze({
  dasMs: 170,
  arrMs: 50,
  softDropMs: 40,
  sfxEnabled: true,
  sfxVolume: 100,
  effectsEnabled: true,
});

function validNumber(value, min, max, fallback) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...DEFAULT_SETTINGS };
    return {
      dasMs: validNumber(saved.dasMs, 80, 300, DEFAULT_SETTINGS.dasMs),
      arrMs: validNumber(saved.arrMs, 20, 100, DEFAULT_SETTINGS.arrMs),
      softDropMs: validNumber(saved.softDropMs, 20, 100, DEFAULT_SETTINGS.softDropMs),
      sfxEnabled: typeof saved.sfxEnabled === "boolean" ? saved.sfxEnabled : DEFAULT_SETTINGS.sfxEnabled,
      sfxVolume: validNumber(saved.sfxVolume, 0, 100, DEFAULT_SETTINGS.sfxVolume),
      effectsEnabled: typeof saved.effectsEnabled === "boolean" ? saved.effectsEnabled : DEFAULT_SETTINGS.effectsEnabled,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存できない環境でも現在のページ内では設定を使える。
  }
}

let settings = loadSettings();
const heldKeys = { ArrowLeft: false, ArrowRight: false, ArrowDown: false };
let activeDirection = null;
let nextHorizontalTime = Infinity;
let nextSoftDropTime = Infinity;
let softDropScheduledPiece = null;

function clearHeldKeys() {
  if (heldKeys.ArrowDown) dropElapsed = 0;
  for (const code of Object.keys(heldKeys)) heldKeys[code] = false;
  activeDirection = null;
  nextHorizontalTime = nextSoftDropTime = Infinity;
  softDropScheduledPiece = null;
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
const debugLevelButtons = [...document.querySelectorAll("[data-debug-level]")];
const resultsElement = document.getElementById("results");
const resultsTitleElement = document.getElementById("results-title");
const resultsDebugElement = document.getElementById("results-debug");
const resultsScoreElement = document.getElementById("results-score");
const resultsLinesElement = document.getElementById("results-lines");
const resultsLevelElement = document.getElementById("results-level");
const resultsHighScoreElement = document.getElementById("results-high-score");
const resultsPlayTimeElement = document.getElementById("results-play-time");
const resultsTetrisesElement = document.getElementById("results-tetrises");
const resultsTSpinsElement = document.getElementById("results-t-spins");
const resultsTSpinMinisElement = document.getElementById("results-t-spin-minis");
const resultsPerfectClearsElement = document.getElementById("results-perfect-clears");
const resultsMaxComboElement = document.getElementById("results-max-combo");
const boardStageElement = document.querySelector(".board-stage");
const pauseVisualElement = document.getElementById("pause-visual");
const gameUiElement = document.querySelector("main");
const startOverlay = document.getElementById("start-overlay");
const startButton = document.getElementById("start-game");
const startSettingsButton = document.getElementById("start-settings");
const startHighScoreElement = document.getElementById("start-high-score");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsButton = document.getElementById("open-settings");
const closeSettingsButton = document.getElementById("close-settings");
const resetSettingsButton = document.getElementById("reset-settings");
const dasInput = document.getElementById("setting-das");
const arrInput = document.getElementById("setting-arr");
const softDropInput = document.getElementById("setting-soft-drop");
const sfxInput = document.getElementById("setting-sfx");
const volumeInput = document.getElementById("setting-volume");
const effectsInput = document.getElementById("setting-effects");
const qaRunElement = document.getElementById("qa-run");
const qaOverlay = document.getElementById("qa-overlay");
const devToolsButton = document.getElementById("open-dev-tools");
const startDevToolsButton = document.getElementById("start-dev-tools");
const qaCloseButton = document.getElementById("qa-close");
const qaResetButton = document.getElementById("qa-reset");
const qaMessageElement = document.getElementById("qa-message");
const qaScenarioButtons = [
  document.getElementById("qa-149"), document.getElementById("qa-clear"),
  document.getElementById("qa-force-i"), document.getElementById("qa-top-out"),
];
const CLEAR_EVENT_DURATION = 1200;
let clearEventTimer = null;
let audioContext = null;
let settingsOpen = false;
let settingsWasPaused = false;
let qaOpen = false;
let qaWasPaused = false;
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
let marathonComplete;
let paused;
let startScreenOpen = true;
// Manual Pauseとは分けて、windowが非アクティブな間だけsimulationを止める。
let focusSuspended = false;
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
let lastPerfectClear = false;
let backToBackActive = false;
// -1: 継続なし、0: 最初の消去、1以上: Comboボーナス対象。
let comboCount = -1;
// Level 1は通常ゲーム。高Level選択時だけHigh Scoreの対象外にする。
let selectedStartLevel = 1;
let isQaRun = false;
function createEmptyRunStats() {
  return { activePlayMs: 0, tetrises: 0, tSpins: 0, tSpinMinis: 0, perfectClears: 0, maxCombo: 0 };
}
let runStats = createEmptyRunStats();
let resultsStatsSnapshot = null;

function updateProgressUI() {
  linesElement.textContent = `${totalLines} / ${MARATHON_TARGET_LINES}`;
  b2bElement.textContent = backToBackActive ? "B2B ON" : "B2B OFF";
  comboElement.textContent = !gameOver && comboCount > 0 ? `COMBO ${comboCount}` : "";
  qaRunElement.hidden = !isQaRun;
}

function updatePauseVisual() {
  const visible = paused && !settingsOpen && !qaOpen && !gameOver && !marathonComplete && !startScreenOpen;
  pauseVisualElement.hidden = !visible;
}

function clearSpinFeedback() {
  clearTimeout(clearEventTimer);
  clearEventTimer = null;
  clearEventElement.textContent = "";
}

function enableAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  } catch {
    // 音声が使えない環境でもゲームは継続する。
  }
}

function playSound(type) {
  if (!settings.sfxEnabled || settings.sfxVolume === 0 || !audioContext) return;
  if (audioContext.state === "suspended" || audioContext.state === "interrupted") {
    audioContext.resume().then(() => {
      if (audioContext.state === "running") playSound(type);
    }).catch(() => {});
    return;
  }
  if (audioContext.state !== "running") return;
  const sounds = {
    line: [[330, 0, 0.07]], double: [[360, 0, 0.08]], triple: [[400, 0, 0.09]],
    tetris: [[390, 0, 0.08], [520, 0.07, 0.11]],
    "t-spin": [[500, 0, 0.06], [660, 0.055, 0.1]],
    "t-spin-mini": [[440, 0, 0.08]],
    "perfect-clear": [[480, 0, 0.07], [640, 0.06, 0.08], [800, 0.13, 0.12]],
    "level-up": [[440, 0, 0.06], [560, 0.055, 0.09]],
    "game-over": [[300, 0, 0.1], [220, 0.09, 0.16]],
    complete: [[440, 0, 0.08], [590, 0.07, 0.09], [740, 0.15, 0.15]],
  }[type];
  if (!sounds) return;
  try {
    const now = audioContext.currentTime;
    for (const [frequency, delay, duration] of sounds) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.045 * settings.sfxVolume / 100, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now + delay);
      oscillator.stop(now + delay + duration + 0.01);
    }
  } catch {
    // 一部のAudioNodeが利用できなくてもゲーム処理へ影響させない。
  }
}

function replayAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function playLockEffects(spin, lines, perfectClear, levelChanged) {
  if (gameOver) return;
  let sound = null;
  let boardEffect = null;
  if (marathonComplete) sound = "complete";
  else if (perfectClear) { sound = "perfect-clear"; boardEffect = "effect-perfect"; }
  else if (spin === "T_SPIN") { sound = "t-spin"; boardEffect = "effect-spin"; }
  else if (spin === "T_SPIN_MINI") { sound = "t-spin-mini"; boardEffect = "effect-spin"; }
  else if (lines === 4) { sound = "tetris"; boardEffect = "effect-tetris"; }
  else if (lines > 0) { sound = ["", "line", "double", "triple"][lines]; boardEffect = "effect-line"; }
  if (sound) playSound(sound);
  if (levelChanged && !marathonComplete) playSound("level-up");
  if (boardEffect) {
    boardStageElement.classList.remove("effect-line", "effect-tetris", "effect-spin", "effect-perfect");
    replayAnimation(boardStageElement, boardEffect);
  }
  if ((spin !== "NONE" || perfectClear) && !gameOver) replayAnimation(clearEventElement, "event-pop");
  if (levelChanged) replayAnimation(levelElement, "level-up");
}

function clearEffects() {
  boardStageElement.classList.remove("effect-line", "effect-tetris", "effect-spin", "effect-perfect");
  clearEventElement.classList.remove("event-pop");
  levelElement.classList.remove("level-up");
  resultsElement.classList.remove("results-enter", "results-complete");
}

function updateSettingsUI() {
  dasInput.value = settings.dasMs;
  arrInput.value = settings.arrMs;
  softDropInput.value = settings.softDropMs;
  sfxInput.checked = settings.sfxEnabled;
  volumeInput.value = settings.sfxVolume;
  effectsInput.checked = settings.effectsEnabled;
  document.getElementById("setting-das-value").textContent = `${settings.dasMs} ms`;
  document.getElementById("setting-arr-value").textContent = `${settings.arrMs} ms`;
  document.getElementById("setting-soft-drop-value").textContent = `${settings.softDropMs} ms`;
  document.getElementById("setting-volume-value").textContent = `${settings.sfxVolume}%`;
  document.body.classList.toggle("effects-off", !settings.effectsEnabled);
}

function openSettings(time = performance.now()) {
  if (settingsOpen || qaOpen) return;
  settingsWasPaused = paused;
  if (!startScreenOpen && !gameOver && !marathonComplete && !paused) {
    advanceTime(time);
    if (!gameOver && !marathonComplete) paused = true;
  }
  clearHeldKeys();
  lastTime = null;
  settingsOpen = true;
  updatePauseVisual();
  updateSettingsUI();
  gameUiElement.inert = true;
  startOverlay.inert = true;
  settingsOverlay.hidden = false;
  if (!startScreenOpen && !gameOver && !marathonComplete) {
    statusElement.textContent = "設定中";
    pauseButton.textContent = "再開（P）";
  }
  closeSettingsButton.focus?.();
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOverlay.hidden = true;
  gameUiElement.inert = startScreenOpen;
  startOverlay.inert = false;
  settingsOpen = false;
  clearHeldKeys();
  lastTime = null;
  if (!startScreenOpen && !gameOver && !marathonComplete) {
    paused = settingsWasPaused;
    statusElement.textContent = paused ? "一時停止中" : "プレイ中";
    pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
  }
  settingsWasPaused = false;
  updatePauseVisual();
  (startScreenOpen ? startSettingsButton : settingsButton).focus?.();
}

function keepStartFocus(event) {
  if (event.code !== "Tab") return;
  const first = startButton;
  const last = startDevToolsButton;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (![startButton, startSettingsButton, startDevToolsButton].includes(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function showStartScreen() {
  startScreenOpen = true;
  updatePauseVisual();
  startHighScoreElement.textContent = highScore;
  startOverlay.hidden = false;
  gameUiElement.inert = true;
  clearHeldKeys();
  lastTime = null;
  statusElement.textContent = "開始待ち";
  startButton.focus?.();
}

function startGame() {
  selectedStartLevel = 1;
  isQaRun = false;
  restart();
}

function playAgain() {
  selectedStartLevel = 1;
  isQaRun = false;
  restart();
}

function keepSettingsFocus(event) {
  if (event.code !== "Tab") return;
  const focusable = [dasInput, arrInput, softDropInput, sfxInput, volumeInput, effectsInput, resetSettingsButton, closeSettingsButton]
    .filter(element => !element.disabled && !element.hidden);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function changeSetting(name, value) {
  settings[name] = value;
  updateSettingsUI();
  saveSettings();
}

function qaFocusableElements() {
  return [...debugLevelButtons, ...qaScenarioButtons, qaResetButton, qaCloseButton].filter(element => !element.disabled && !element.hidden);
}

function keepQaFocus(event) {
  if (event.code !== "Tab") return;
  const focusable = qaFocusableElements();
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

function openQa(time = performance.now()) {
  if (qaOpen || settingsOpen) return;
  qaWasPaused = paused;
  if (!startScreenOpen && !gameOver && !marathonComplete && !paused) {
    advanceTime(time);
    if (!gameOver && !marathonComplete) paused = true;
  }
  clearHeldKeys();
  lastTime = null;
  qaOpen = true;
  updatePauseVisual();
  qaMessageElement.textContent = "";
  gameUiElement.inert = true;
  startOverlay.inert = true;
  qaOverlay.hidden = false;
  if (!startScreenOpen && !gameOver && !marathonComplete) {
    statusElement.textContent = "DEV TOOLS";
    pauseButton.textContent = "再開（P）";
  }
  qaCloseButton.focus?.();
}

function closeQa() {
  if (!qaOpen) return;
  qaOverlay.hidden = true;
  gameUiElement.inert = startScreenOpen;
  startOverlay.inert = false;
  qaOpen = false;
  clearHeldKeys();
  lastTime = null;
  if (!startScreenOpen && !gameOver && !marathonComplete) {
    paused = qaWasPaused;
    statusElement.textContent = paused ? "一時停止中" : "プレイ中";
    pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
  }
  qaWasPaused = false;
  updatePauseVisual();
  (startScreenOpen ? startDevToolsButton : devToolsButton).focus?.();
}

function startDebugLevel(selectedLevel) {
  selectedStartLevel = selectedLevel;
  isQaRun = false;
  restart();
  closeQa();
}

function markQaRun() {
  isQaRun = true;
  updateProgressUI();
}

function resetQaPieceState() {
  clearHeldKeys();
  clearSpinFeedback();
  clearEffects();
  lastRotationKick = null;
  lastLockResult = null;
  lastPerfectClear = false;
  dropElapsed = 0;
  lockElapsed = 0;
  lockResets = 0;
  lastTime = null;
}

function loadQa149To150() {
  markQaRun();
  restart();
  totalLines = MARATHON_TARGET_LINES - 1;
  level = Math.floor(totalLines / 10) + 1;
  levelElement.textContent = level;
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[TOTAL_ROWS - 1].fill(7);
  board[TOTAL_ROWS - 1].fill(0, 3, 7);
  board[TOTAL_ROWS - 2][0] = 7;
  spawnPiece(0);
  updateProgressUI();
  draw();
  closeQa();
}

function clearQaBoard() {
  markQaRun();
  resetQaPieceState();
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  updateProgressUI();
  draw();
  closeQa();
}

function forceQaI() {
  markQaRun();
  clearHeldKeys();
  const shape = ROTATIONS[0][0];
  const x = Math.floor((COLS - shape[0].length) / 2);
  if (collides(shape, x, SPAWN_Y)) {
    qaMessageElement.textContent = "I PIECEを出現できません。先にCLEAR BOARDを使用してください。";
    return;
  }
  resetQaPieceState();
  spawnPiece(0);
  updateProgressUI();
  draw();
  closeQa();
}

function loadQaTopOut() {
  markQaRun();
  restart();
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  spawnPiece(0);
  piece.y = TOTAL_ROWS - 2;
  for (let y = SPAWN_Y; y <= SPAWN_Y + 1; y++) board[y].fill(7, 3, 7);
  resetQaPieceState();
  updateProgressUI();
  draw();
  closeQa();
}

function showSpinFeedback() {
  clearSpinFeedback();
  if (gameOver || (marathonComplete && !lastPerfectClear)) return;
  const messages = [];
  if (lastPerfectClear) messages.push("PERFECT CLEAR");
  if (lastLockResult.spin !== "NONE") {
    const name = lastLockResult.spin === "T_SPIN_MINI" ? "T-SPIN MINI" : "T-SPIN";
    const suffix = ["", " SINGLE", " DOUBLE", " TRIPLE"][lastLockResult.lines];
    messages.push(name + suffix);
  }
  if (messages.length === 0) return;
  clearEventElement.textContent = messages.join(" · ");
  // 表示だけの実時間タイマー。Pause中も消え、ゲーム進行の時計には触れない。
  clearEventTimer = setTimeout(clearSpinFeedback, CLEAR_EVENT_DURATION);
}

function showResults(title) {
  resultsStatsSnapshot = { ...runStats };
  resultsTitleElement.textContent = title;
  resultsDebugElement.textContent = [selectedStartLevel === 1 ? "" : "DEBUG RUN", isQaRun ? "QA RUN" : ""].filter(Boolean).join(" · ");
  resultsScoreElement.textContent = score;
  resultsLinesElement.textContent = totalLines;
  resultsLevelElement.textContent = level;
  resultsHighScoreElement.textContent = highScore;
  resultsPlayTimeElement.textContent = formatPlayTime(resultsStatsSnapshot.activePlayMs);
  resultsTetrisesElement.textContent = resultsStatsSnapshot.tetrises;
  resultsTSpinsElement.textContent = resultsStatsSnapshot.tSpins;
  resultsTSpinMinisElement.textContent = resultsStatsSnapshot.tSpinMinis;
  resultsPerfectClearsElement.textContent = resultsStatsSnapshot.perfectClears;
  resultsMaxComboElement.textContent = resultsStatsSnapshot.maxCombo;
  resultsElement.hidden = false;
  replayAnimation(resultsElement, "results-enter");
}

function formatPlayTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes).padStart(2, "0")}:${seconds}`;
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}:${seconds}`;
}

function hideResults() {
  resultsElement.hidden = true;
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

function collidesOn(board, shape, x, y) {
  return shape.some((row, dy) => row.some((cell, dx) => {
    if (!cell) return false;
    const bx = x + dx;
    const by = y + dy;
    return bx < 0 || bx >= COLS || by < 0 || by >= TOTAL_ROWS || board[by][bx] !== 0;
  }));
}

function collides(shape, x, y) {
  return collidesOn(board, shape, x, y);
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
  if (marathonComplete) return;
  lastRotationKick = null;
  gameOver = true;
  updatePauseVisual();
  clearSpinFeedback();
  updateProgressUI();
  clearHeldKeys();
  statusElement.textContent = "ゲームオーバー — R またはボタンで再開";
  pauseButton.disabled = true;
  showResults("GAME OVER");
  playSound("game-over");
}

function completeMarathon() {
  marathonComplete = true;
  updatePauseVisual();
  clearSpinFeedback();
  clearHeldKeys();
  statusElement.textContent = "MARATHON COMPLETE — R またはボタンで再開";
  pauseButton.disabled = true;
  resultsElement.classList.add("results-complete");
  showResults("MARATHON COMPLETE");
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

function getGravityInterval(currentLevel = level) {
  const gravityLevel = Math.min(currentLevel, 15);
  return Math.pow(0.8 - ((gravityLevel - 1) * 0.007), gravityLevel - 1) * 1000;
}

function softDropUsesRepeat() {
  return heldKeys.ArrowDown && settings.softDropMs < getGravityInterval();
}

function togglePause(time = performance.now()) {
  if (gameOver || marathonComplete) return;
  advanceTime(time);
  if (gameOver || marathonComplete) return;
  paused = !paused;
  updatePauseVisual();
  clearHeldKeys();
  statusElement.textContent = paused ? "一時停止中" : "プレイ中";
  pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
}

function landingYOn(board, piece) {
  let y = piece.y;
  while (!collidesOn(board, piece.shape, piece.x, y + 1)) y++;
  return y;
}

function ghostY() {
  return landingYOn(board, piece);
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
  if (selectedStartLevel === 1 && !isQaRun && score > highScore) {
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

function isBoardEmpty() {
  return board.every(row => row.every(cell => cell === 0));
}

function calculatePerfectClearScore(lines, level, b2bTetris) {
  const base = b2bTetris ? B2B_TETRIS_PERFECT_CLEAR_SCORE : PERFECT_CLEAR_SCORES[lines] ?? 0;
  return base * level;
}

function lockPiece() {
  lastLockResult = { spin: detectTSpin(), lines: 0 };
  lastPerfectClear = false;
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
  lastPerfectClear = cleared > 0 && isBoardEmpty();
  // 今回の消去によるLevel上昇より前の倍率を使う。
  const previousLevel = level;
  let clearScore = calculateClearScore(lastLockResult.spin, cleared, level);
  const difficult = isDifficultClear(lastLockResult.spin, cleared);
  const b2bBonusApplied = backToBackActive && difficult;
  if (b2bBonusApplied) clearScore = clearScore * 3 / 2;
  const b2bTetrisPerfectClear = b2bBonusApplied && lastLockResult.spin === "NONE" && cleared === 4;
  const perfectClearScore = lastPerfectClear
    ? calculatePerfectClearScore(cleared, level, b2bTetrisPerfectClear)
    : 0;
  comboCount = cleared > 0 ? comboCount + 1 : -1;
  if (cleared === 4) runStats.tetrises++;
  if (lastLockResult.spin === "T_SPIN") runStats.tSpins++;
  else if (lastLockResult.spin === "T_SPIN_MINI") runStats.tSpinMinis++;
  if (lastPerfectClear) runStats.perfectClears++;
  runStats.maxCombo = Math.max(runStats.maxCombo, comboCount);
  const comboScore = comboCount > 0 ? 50 * comboCount * level : 0;
  addScore(clearScore + perfectClearScore + comboScore);
  // 最初の対象消去は開始だけ。0ラインは既存の連続状態を維持する。
  if (cleared > 0) backToBackActive = difficult;
  totalLines += cleared;
  level = Math.floor(totalLines / 10) + 1;
  const levelChanged = level !== previousLevel;
  levelElement.textContent = level;
  dropElapsed = 0;
  holdUsed = false;
  if (totalLines >= MARATHON_TARGET_LINES) completeMarathon();
  else advancePiece();
  updateProgressUI();
  showSpinFeedback();
  playLockEffects(lastLockResult.spin, cleared, lastPerfectClear, levelChanged);
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
  if (!gameOver && !marathonComplete) {
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
  clearEffects();
  hideResults();
  startScreenOpen = false;
  startOverlay.hidden = true;
  startOverlay.inert = settingsOpen;
  gameUiElement.inert = settingsOpen || qaOpen;
  comboCount = -1;
  backToBackActive = false;
  lastLockResult = null;
  lastPerfectClear = false;
  runStats = createEmptyRunStats();
  clearHeldKeys();
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  score = 0;
  gameOver = false;
  marathonComplete = false;
  paused = false;
  updatePauseVisual();
  heldType = null;
  holdUsed = false;
  totalLines = (selectedStartLevel - 1) * 10;
  level = selectedStartLevel;
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
  if (settingsOpen) {
    keepSettingsFocus(event);
    if (event.code === "Escape") {
      event.preventDefault();
      closeSettings();
    }
    return;
  }
  if (qaOpen) {
    keepQaFocus(event);
    if (event.code === "Escape") {
      event.preventDefault();
      closeQa();
    }
    return;
  }
  if (startScreenOpen) {
    keepStartFocus(event);
    return;
  }
  if (event.target?.closest?.("button, input, select")) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyR", "KeyC", "KeyP", "KeyZ"].includes(event.code)) return;
  event.preventDefault();
  if (focusSuspended) return;
  enableAudio();
  if (event.repeat || heldKeys[event.code]) return;
  if (event.code === "KeyR") {
    if (!event.repeat) restart();
    return;
  }
  if (event.code === "KeyP") {
    if (!event.repeat) togglePause(event.timeStamp);
    return;
  }
  if (gameOver || marathonComplete || paused) return;
  // 入力前の時間は入力前の姿勢に適用し、着地・リセット前の時間を混ぜない。
  advanceTime(event.timeStamp);
  if (gameOver || marathonComplete) return;
  if (event.code in heldKeys) {
    heldKeys[event.code] = true;
    if (event.code === "ArrowDown") {
      nextSoftDropTime = softDropUsesRepeat() ? lastTime + settings.softDropMs : Infinity;
      softDropScheduledPiece = nextSoftDropTime < Infinity ? piece : null;
    }
    else {
      activeDirection = event.code;
      nextHorizontalTime = lastTime + settings.dasMs;
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
document.getElementById("restart").addEventListener("click", () => { enableAudio(); restart(); });
document.getElementById("play-again").addEventListener("click", () => { enableAudio(); playAgain(); });
startButton.addEventListener("click", () => { enableAudio(); startGame(); });
startSettingsButton.addEventListener("click", event => openSettings(event.timeStamp));
startDevToolsButton.addEventListener("click", event => openQa(event.timeStamp));
settingsButton.addEventListener("click", event => openSettings(event.timeStamp));
closeSettingsButton.addEventListener("click", closeSettings);
resetSettingsButton.addEventListener("click", () => {
  settings = { ...DEFAULT_SETTINGS };
  clearHeldKeys();
  updateSettingsUI();
  saveSettings();
});
dasInput.addEventListener("input", () => changeSetting("dasMs", Number(dasInput.value)));
arrInput.addEventListener("input", () => changeSetting("arrMs", Number(arrInput.value)));
softDropInput.addEventListener("input", () => changeSetting("softDropMs", Number(softDropInput.value)));
sfxInput.addEventListener("change", () => changeSetting("sfxEnabled", sfxInput.checked));
volumeInput.addEventListener("input", () => changeSetting("sfxVolume", Number(volumeInput.value)));
effectsInput.addEventListener("change", () => changeSetting("effectsEnabled", effectsInput.checked));
devToolsButton.addEventListener("click", event => openQa(event.timeStamp));
qaCloseButton.addEventListener("click", closeQa);
debugLevelButtons.forEach(button => button.addEventListener("click", () => {
  enableAudio();
  startDebugLevel(Number(button.dataset.debugLevel));
}));
document.getElementById("qa-149").addEventListener("click", loadQa149To150);
document.getElementById("qa-clear").addEventListener("click", clearQaBoard);
document.getElementById("qa-force-i").addEventListener("click", forceQaI);
document.getElementById("qa-top-out").addEventListener("click", loadQaTopOut);
qaResetButton.addEventListener("click", () => {
  isQaRun = false;
  restart();
  closeQa();
});
document.addEventListener("keyup", event => {
  if (!(event.code in heldKeys) || !heldKeys[event.code]) return;
  advanceTime(event.timeStamp);
  heldKeys[event.code] = false;
  if (event.code === "ArrowDown") {
    nextSoftDropTime = Infinity;
    softDropScheduledPiece = null;
    dropElapsed = 0;
  } else if (activeDirection === event.code) {
    const other = event.code === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    activeDirection = heldKeys[other] ? other : null;
    nextHorizontalTime = activeDirection ? lastTime + settings.dasMs : Infinity;
  }
});
pauseButton.addEventListener("click", event => { enableAudio(); togglePause(event.timeStamp); });

// 別タブから戻ったときに経過時間分が一気に落ちるのを防ぐ。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearHeldKeys();
  lastTime = null;
});
window.addEventListener("blur", () => {
  focusSuspended = true;
  clearHeldKeys();
  lastTime = null;
});
window.addEventListener("focus", () => {
  focusSuspended = false;
  lastTime = null;
});

function canAdvanceSimulation() {
  return !startScreenOpen && !paused && !settingsOpen && !qaOpen && !focusSuspended
    && !document.hidden && !gameOver && !marathonComplete;
}

function advanceTime(time) {
  if (heldKeys.ArrowDown && !softDropUsesRepeat()) {
    nextSoftDropTime = Infinity;
    softDropScheduledPiece = null;
  } else if (softDropUsesRepeat() && softDropScheduledPiece !== piece) {
    nextSoftDropTime = (lastTime ?? time) + settings.softDropMs;
    softDropScheduledPiece = piece;
  }
  if (lastTime !== null && time - lastTime > MAX_INPUT_CATCHUP) {
    // 古い繰り返しは現在時刻の1回にまとめ、低更新頻度でも入力を進める。
    if (activeDirection && nextHorizontalTime <= time) nextHorizontalTime = time;
    if (softDropUsesRepeat() && nextSoftDropTime <= time) nextSoftDropTime = time;
  }
  while (canAdvanceSimulation()) {
    const due = Math.min(nextHorizontalTime, nextSoftDropTime);
    if (due > time) break;
    const pieceBeforeSimulation = piece;
    advanceSimulation(due);
    if (gameOver || marathonComplete) break;
    if (piece !== pieceBeforeSimulation) {
      nextSoftDropTime = softDropUsesRepeat() ? due + settings.softDropMs : Infinity;
      softDropScheduledPiece = nextSoftDropTime < Infinity ? piece : null;
    } else if (nextSoftDropTime === due && !softDropUsesRepeat()) {
      nextSoftDropTime = Infinity;
      softDropScheduledPiece = null;
    }
    if (nextHorizontalTime === due) {
      move(activeDirection === "ArrowLeft" ? -1 : 1, 0);
      nextHorizontalTime += settings.arrMs;
    }
    if (nextSoftDropTime === due) {
      stepDown(true);
      nextSoftDropTime += settings.softDropMs;
    }
    draw();
  }
  advanceSimulation(time);
}

function advanceSimulation(time) {
  if (lastTime === null) lastTime = time;
  // 同じフレーム内で入力が先に処理されても時間を巻き戻さない。
  time = Math.max(time, lastTime);
  if (canAdvanceSimulation()) {
    const simulationElapsed = time - lastTime;
    let activeElapsed = simulationElapsed;
    let playTimeAlreadyAdded = 0;
    let remaining = time - lastTime;
    let changed = false;
    // 落下前と着地後の時間を分け、着地する前の時間を固定待ちに加えない。
    while (remaining > 0) {
      if (isGrounded()) {
        const timeUntilLock = Math.max(0, LOCK_DELAY - lockElapsed);
        dropElapsed = 0;
        lockElapsed += remaining;
        if (lockElapsed >= LOCK_DELAY) {
          playTimeAlreadyAdded = simulationElapsed - remaining + Math.min(remaining, timeUntilLock);
          runStats.activePlayMs += playTimeAlreadyAdded;
          lockPiece();
          if (gameOver || marathonComplete) {
            activeElapsed = playTimeAlreadyAdded;
          }
          changed = true;
        }
        break;
      }
      if (softDropUsesRepeat()) break;
      const gravityInterval = getGravityInterval();
      const elapsed = Math.min(remaining, gravityInterval - dropElapsed);
      dropElapsed += elapsed;
      remaining -= elapsed;
      if (dropElapsed >= gravityInterval) {
        dropElapsed = 0;
        stepDown();
        changed = true;
        // Gravityで着地したフレームの余りをLock Delayへ流さない。
        if (isGrounded()) break;
      }
    }
    runStats.activePlayMs += activeElapsed - playTimeAlreadyAdded;
    if (changed) draw();
  }
  lastTime = time;
}

function update(time) {
  advanceTime(time);
  requestAnimationFrame(update);
}

updateSettingsUI();
restart();
showStartScreen();
requestAnimationFrame(update);
