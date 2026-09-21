"use strict";

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 20;
const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const NEXT_COUNT = 5;
const MARATHON_TARGET_LINES = 150;
const GARBAGE_CELL = 8;
const VS_OUTCOMES = Object.freeze({ HUMAN_WIN: "HUMAN_WIN", CPU_WIN: "CPU_WIN", DRAW: "DRAW" });
const CPU_V0_1_CONFIG = Object.freeze({
  thinkDelayMs: 240,
  actionIntervalMs: 90,
  lineReward: 1000,
  holePenalty: 45,
  aggregateHeightPenalty: 4,
  maximumHeightPenalty: 7,
  bumpinessPenalty: 3,
  terminalPenalty: 1000000,
  maxSearchStates: 5000,
});
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
function createHumanControllerState() {
  return {
    heldKeys: { ArrowLeft: false, ArrowRight: false, ArrowDown: false },
    activeDirection: null,
    nextHorizontalTime: Infinity,
    nextSoftDropTime: Infinity,
    softDropScheduledPiece: null,
  };
}

let humanController = createHumanControllerState();
const HUMAN_CONTROLLER_FIELDS = [
  "heldKeys", "activeDirection", "nextHorizontalTime", "nextSoftDropTime", "softDropScheduledPiece",
];
// 既存のテストとデバッグ用コードからも入力状態を確認できるよう、公開名はController stateへ転送する。
for (const field of HUMAN_CONTROLLER_FIELDS) {
  Object.defineProperty(globalThis, field, {
    configurable: true,
    get: () => humanController[field],
    set: value => { humanController[field] = value; },
  });
}

function clearHeldKeys() {
  if (humanController.heldKeys.ArrowDown) dropElapsed = 0;
  for (const code of Object.keys(humanController.heldKeys)) humanController.heldKeys[code] = false;
  humanController.activeDirection = null;
  humanController.nextHorizontalTime = humanController.nextSoftDropTime = Infinity;
  humanController.softDropScheduledPiece = null;
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
const COLORS = ["", "#43d4ec", "#f4d35e", "#bc86ef", "#72d68b", "#ed6d79", "#6396ed", "#eea052", "#737b86"];
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
const vsResultsElement = document.getElementById("vs-results");
const vsResultsTitleElement = document.getElementById("vs-results-title");
const vsHumanScoreElement = document.getElementById("vs-human-score");
const vsHumanLinesElement = document.getElementById("vs-human-lines");
const vsCpuScoreElement = document.getElementById("vs-cpu-score");
const vsCpuLinesElement = document.getElementById("vs-cpu-lines");
const vsRematchButton = document.getElementById("vs-rematch");
const vsExitButton = document.getElementById("vs-exit");
const boardStageElement = document.querySelector(".board-stage");
const pauseVisualElement = document.getElementById("pause-visual");
const gameUiElement = document.querySelector("main");
const startOverlay = document.getElementById("start-overlay");
const startButton = document.getElementById("start-game");
const startVsButton = document.getElementById("start-vs");
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
const qaForceHumanTopOutButton = document.getElementById("qa-force-human-top-out");
const qaForceCpuTopOutButton = document.getElementById("qa-force-cpu-top-out");
const qaForceDoubleTopOutButton = document.getElementById("qa-force-double-top-out");
const qaTransactionalLockButton = document.getElementById("qa-transactional-lock");
const qaVsEngineButton = document.getElementById("qa-vs-engine");
const dualBoardTestElement = document.getElementById("dual-board-test");
const dualExitButton = document.getElementById("dual-exit");
const secondBoardCanvas = document.getElementById("second-board");
const secondBoardContext = secondBoardCanvas.getContext("2d");
const secondHoldCanvas = document.getElementById("second-hold");
const secondNextCanvas = document.getElementById("second-next");
const secondScoreElement = document.getElementById("second-score");
const secondLinesElement = document.getElementById("second-lines");
const secondLevelElement = document.getElementById("second-level");
const secondStatusElement = document.getElementById("second-status");
const secondPlayerTitleElement = document.getElementById("second-player-title");
const cpuIndicatorsElement = document.getElementById("cpu-incoming-indicator");
const vsIndicatorsElement = document.getElementById("vs-indicators");
const humanIncomingElement = document.getElementById("human-incoming");
const secondIncomingElement = document.getElementById("second-incoming");
const qaScenarioButtons = [
  document.getElementById("qa-149"), document.getElementById("qa-clear"),
  document.getElementById("qa-force-i"), document.getElementById("qa-top-out"), document.getElementById("qa-dual"),
  document.getElementById("qa-cpu"), document.getElementById("qa-vs-engine"), document.getElementById("qa-garbage-human"),
  qaForceHumanTopOutButton, qaForceCpuTopOutButton, qaForceDoubleTopOutButton, qaTransactionalLockButton,
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
function createEmptyRunStats() {
  return { activePlayMs: 0, tetrises: 0, tSpins: 0, tSpinMinis: 0, perfectClears: 0, maxCombo: 0 };
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createVsPieceSource(seed) {
  const runtimeSeed = Number.isSafeInteger(seed)
    ? seed >>> 0 : Math.floor(Math.random() * 0x100000000) >>> 0;
  const garbageSeed = (runtimeSeed ^ 0x9e3779b9) >>> 0;
  return {
    seed: runtimeSeed,
    sequence: [],
    bag: [],
    humanCursor: 0,
    cpuCursor: 0,
    pieceRandom: createSeededRandom(runtimeSeed),
    garbageRandom: {
      human: createSeededRandom(garbageSeed),
      cpu: createSeededRandom(garbageSeed),
    },
  };
}

function nextVsPieceType(source, side) {
  if (!source || (side !== "human" && side !== "cpu")) return null;
  const cursorKey = `${side}Cursor`;
  while (source.sequence.length <= source[cursorKey]) {
    if (source.bag.length === 0) {
      source.bag = [0, 1, 2, 3, 4, 5, 6];
      for (let i = source.bag.length - 1; i > 0; i--) {
        const j = Math.floor(source.pieceRandom() * (i + 1));
        [source.bag[i], source.bag[j]] = [source.bag[j], source.bag[i]];
      }
    }
    source.sequence.push(source.bag.pop());
  }
  const type = source.sequence[source[cursorKey]];
  source[cursorKey]++;
  return type;
}

function vsPieceSideFor(state, sideOverride = null) {
  if (sideOverride === "human" || sideOverride === "cpu") return sideOverride;
  if (state === currentPlayerState) return "human";
  if (state === secondaryPlayerState) return "cpu";
  return null;
}

function createPlayerState({ selectedStartLevel = 1, initialize = true, sequenceSide = null } = {}) {
  const state = {
    board: Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0)),
    piece: null,
    score: 0,
    gameOver: false,
    nextQueue: [],
    heldType: null,
    holdUsed: false,
    totalLines: (selectedStartLevel - 1) * 10,
    level: selectedStartLevel,
    dropElapsed: 0,
    lockElapsed: 0,
    lockResets: 0,
    bag: [],
    lastRotationKick: null,
    lastLockResult: null,
    lastPerfectClear: false,
    backToBackActive: false,
    comboCount: -1,
    runStats: createEmptyRunStats(),
  };
  if (initialize) {
    state.nextQueue = [nextTypeFor(state, sequenceSide)];
    advancePieceFor(state, sequenceSide);
  }
  return state;
}

function createAttackGarbageState() {
  return { humanIncoming: [], secondIncoming: [] };
}

function createVsMatchState({ active = false, pieceSource = null } = {}) {
  return {
    active,
    finished: false,
    outcome: null,
    resultSnapshot: null,
    pieceSource,
    pendingLocks: { human: null, cpu: null },
    settling: false,
  };
}

let currentPlayerState = createPlayerState({ initialize: false });
let dualBoardTestActive = false;
let cpuTestActive = false;
let vsEngineTestActive = false;
// VSエンジンを公開モードから起動したか。QA用のVSエンジンとは表示と保存方針を分ける。
let publicVsActive = false;
let secondaryPlayerState = null;
let dualFrameTime = null;
let cpuController = null;
let attackGarbageState = createAttackGarbageState();
let vsMatchState = createVsMatchState();
const PLAYER_STATE_FIELDS = [
  "board", "piece", "score", "gameOver", "nextQueue", "heldType", "holdUsed",
  "totalLines", "level", "dropElapsed", "lockElapsed", "lockResets", "bag",
  "lastRotationKick", "lastLockResult", "lastPerfectClear", "backToBackActive",
  "comboCount", "runStats",
];
for (const field of PLAYER_STATE_FIELDS) {
  Object.defineProperty(globalThis, field, {
    configurable: true,
    get: () => currentPlayerState[field],
    set: value => { currentPlayerState[field] = value; },
  });
}

let marathonComplete;
let paused;
let startScreenOpen = true;
// Manual Pauseとは分けて、windowが非アクティブな間だけsimulationを止める。
let focusSuspended = false;
let lastTime = null;
// Level 1は通常ゲーム。高Level選択時だけHigh Scoreの対象外にする。
let selectedStartLevel = 1;
let isQaRun = false;
let resultsStatsSnapshot = null;

function updateProgressUI() {
  linesElement.textContent = `${totalLines} / ${MARATHON_TARGET_LINES}`;
  b2bElement.textContent = backToBackActive ? "B2B ON" : "B2B OFF";
  comboElement.textContent = !gameOver && comboCount > 0 ? `COMBO ${comboCount}` : "";
  qaRunElement.hidden = !isQaRun;
}

function updateVsFixtureVisibility() {
  const visible = vsEngineTestActive && !publicVsActive && !vsMatchState.finished;
  if (qaVsEngineButton) qaVsEngineButton.hidden = publicVsActive;
  [qaForceHumanTopOutButton, qaForceCpuTopOutButton, qaForceDoubleTopOutButton, qaTransactionalLockButton].forEach(button => {
    if (button) button.hidden = !visible;
  });
}

// VS用QA fixtureは、QAのVS ENGINE TEST中だけ実行を許可する。
// 公開VSや他のQAモードからは、DOM経由で呼ばれても状態を変更しない。
function canUseVsQaFixtures() {
  return Boolean(isQaRun && vsEngineTestActive && !publicVsActive
    && vsMatchState?.active && !vsMatchState.finished);
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
  if (settingsOpen || qaOpen || isVsMatchFinished()) return;
  settingsWasPaused = paused;
  if (!startScreenOpen && !gameOver && !marathonComplete && !paused) {
    advanceTime(time);
    if (!gameOver && !marathonComplete) paused = true;
  }
  clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
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
  dualFrameTime = null;
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
  const focusable = [startButton, startVsButton, startSettingsButton, startDevToolsButton]
    .filter(element => !element.disabled && !element.hidden);
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

function showStartScreen() {
  startScreenOpen = true;
  updatePauseVisual();
  startHighScoreElement.textContent = highScore;
  startOverlay.hidden = false;
  gameUiElement.inert = true;
  clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
  statusElement.textContent = "開始待ち";
  startButton.focus?.();
}

function startGame() {
  selectedStartLevel = 1;
  publicVsActive = false;
  isQaRun = false;
  restart();
}

function playAgain() {
  selectedStartLevel = 1;
  publicVsActive = false;
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
  if (qaOpen || settingsOpen || isVsMatchFinished() || publicVsActive) return;
  qaWasPaused = paused;
  if (!startScreenOpen && !gameOver && !marathonComplete && !paused) {
    advanceTime(time);
    if (!gameOver && !marathonComplete) paused = true;
  }
  clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
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
  gameUiElement.inert = startScreenOpen || isVsMatchFinished();
  startOverlay.inert = false;
  qaOpen = false;
  clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
  if (!startScreenOpen && !gameOver && !marathonComplete && !isVsMatchFinished()) {
    paused = qaWasPaused;
    statusElement.textContent = paused ? "一時停止中" : "プレイ中";
    pauseButton.textContent = paused ? "再開（P）" : "一時停止（P）";
  }
  qaWasPaused = false;
  updatePauseVisual();
  (isVsMatchFinished() ? vsResultsTitleElement : startScreenOpen ? startDevToolsButton : devToolsButton).focus?.();
}

function startDebugLevel(selectedLevel) {
  selectedStartLevel = selectedLevel;
  publicVsActive = false;
  isQaRun = false;
  restart();
  closeQa();
}

function advancePreviewSimulation(state, elapsed) {
  if (!state || state.gameOver || elapsed <= 0 || isVsMatchFinished() || pendingVsLockFor(state)) return;
  let remaining = elapsed;
  while (remaining > 0 && !state.gameOver && !pendingVsLockFor(state)) {
    if (isGroundedFor(state)) {
      const timeUntilLock = Math.max(0, LOCK_DELAY - state.lockElapsed);
      state.dropElapsed = 0;
      state.lockElapsed += remaining;
      if (state.lockElapsed < LOCK_DELAY) break;
      const versus = vsEngineTestActive && state === secondaryPlayerState && attackGarbageState;
      const result = versus
        ? prepareVsLock("cpu", state)?.lockResult
        : resolveLockFor(state);
      if (!result) break;
      if (result.terminal) break;
      if (!versus) advancePieceFor(state);
      remaining = Math.max(0, remaining - timeUntilLock);
      continue;
    }
    const gravityInterval = getGravityInterval(state.level);
    const elapsedToStep = Math.min(remaining, gravityInterval - state.dropElapsed);
    state.dropElapsed += elapsedToStep;
    remaining -= elapsedToStep;
    if (state.dropElapsed >= gravityInterval) {
      state.dropElapsed = 0;
      movePlayer(state, 0, 1);
    }
  }
}

function calculateAttack(lockResult) {
  const lines = Number.isInteger(lockResult?.lines) ? lockResult.lines : 0;
  return [0, 0, 1, 2, 4][lines] ?? 0;
}

function createGarbagePacket(rows, holeColumn, randomSource = Math.random) {
  const normalizedRows = Number.isInteger(rows) ? rows : 0;
  if (normalizedRows <= 0) return null;
  const random = typeof randomSource === "function" ? randomSource : Math.random;
  const generatedHole = holeColumn === undefined
    ? Math.floor(random() * COLS) : holeColumn;
  const normalizedHole = Math.max(0, Math.min(COLS - 1, Math.floor(generatedHole)));
  return { rows: normalizedRows, holeColumn: normalizedHole };
}

function enqueueGarbagePacket(queue, rows, holeColumn, randomSource = Math.random) {
  const packet = typeof rows === "object" && rows !== null
    ? createGarbagePacket(rows.rows, rows.holeColumn, randomSource)
    : createGarbagePacket(rows, holeColumn, randomSource);
  if (packet) queue.push(packet);
  return queue;
}

function totalIncomingGarbage(queue) {
  return queue.reduce((total, packet) => total + Math.max(0, packet.rows), 0);
}

function cancelIncomingGarbage(queue, attackRows) {
  let remainingAttack = Math.max(0, Number.isInteger(attackRows) ? attackRows : 0);
  let cancelled = 0;
  const remainingQueue = queue.map(packet => ({ ...packet }));
  for (const packet of remainingQueue) {
    if (remainingAttack === 0) break;
    const cancelledRows = Math.min(packet.rows, remainingAttack);
    packet.rows -= cancelledRows;
    remainingAttack -= cancelledRows;
    cancelled += cancelledRows;
  }
  return {
    queue: remainingQueue.filter(packet => packet.rows > 0),
    cancelled,
    remainingAttack,
  };
}

function cloneGarbageQueue(queue) {
  return queue.map(packet => ({ rows: packet.rows, holeColumn: packet.holeColumn }));
}

function pendingVsLockFor(state) {
  if (!vsEngineTestActive || !state || !vsMatchState?.pendingLocks) return null;
  const side = state === currentPlayerState ? "human" : state === secondaryPlayerState ? "cpu" : null;
  return side ? vsMatchState.pendingLocks[side] : null;
}

function prepareVsLock(side, state) {
  if (!vsEngineTestActive || !vsMatchState.active || vsMatchState.finished || !state || state.gameOver) return null;
  if (side !== "human" && side !== "cpu") return null;
  const pending = vsMatchState.pendingLocks[side];
  if (pending) return pending;
  const lockResult = resolveLockFor(state);
  const record = { side, state, lockResult, coreTerminal: lockResult.terminal };
  vsMatchState.pendingLocks[side] = record;
  if (side === "cpu" && cpuController) resetCpuPlan(cpuController, "SETTLEMENT PENDING");
  if (side === "human") {
    clearHeldKeys();
    scoreElement.textContent = score;
    levelElement.textContent = level;
    if (record.coreTerminal) {
      statusElement.textContent = "VS TEST — TOP OUT";
    }
    updateProgressUI();
    showSpinFeedback();
    playLockEffects(lockResult.spin, lockResult.lines, lockResult.perfectClear, lockResult.levelChanged);
  }
  return record;
}

function createGarbageRow(holeColumn) {
  return Array.from({ length: COLS }, (_, x) => x === holeColumn ? 0 : GARBAGE_CELL);
}

function applyGarbagePackets(state, queue) {
  let appliedRows = 0;
  let garbageOverflow = false;
  for (const packet of queue) {
    for (let row = 0; row < packet.rows; row++) {
      if (state.board[0].some(cell => cell !== 0)) garbageOverflow = true;
      state.board = state.board.slice(1);
      state.board.push(createGarbageRow(packet.holeColumn));
      appliedRows++;
    }
  }
  queue.length = 0;
  return { appliedRows, garbageOverflow };
}

function createVsSettlementSide(pending, incomingSnapshot) {
  const coreTerminal = Boolean(pending?.coreTerminal);
  const rawAttack = pending && !coreTerminal ? calculateAttack(pending.lockResult) : 0;
  const cancellation = pending && !coreTerminal
    ? cancelIncomingGarbage(incomingSnapshot, rawAttack)
    : { queue: cloneGarbageQueue(incomingSnapshot), cancelled: 0, remainingAttack: 0 };
  return {
    pending,
    state: pending?.state ?? null,
    coreTerminal,
    rawAttack,
    cancelled: cancellation.cancelled,
    remainingIncoming: cancellation.queue,
    residualOutgoing: cancellation.remainingAttack,
    garbageApplied: 0,
    garbageOverflow: false,
    terminal: coreTerminal,
  };
}

function replaceGarbageQueue(queue, packets) {
  queue.splice(0, queue.length, ...cloneGarbageQueue(packets));
}

function vsGarbageRandomFor(recipient) {
  return vsMatchState?.pieceSource?.garbageRandom?.[recipient] ?? Math.random;
}

function flushVsSettlementWindow() {
  if (!vsEngineTestActive || !vsMatchState.active || vsMatchState.finished || vsMatchState.settling) return null;
  const pendingLocks = vsMatchState.pendingLocks;
  const humanPending = pendingLocks.human;
  const cpuPending = pendingLocks.cpu;
  if (!humanPending && !cpuPending) return null;
  // Remove the records before committing so a re-entrant update cannot settle them twice.
  vsMatchState.pendingLocks = { human: null, cpu: null };
  vsMatchState.settling = true;
  const preExisting = {
    human: cloneGarbageQueue(attackGarbageState.humanIncoming),
    cpu: cloneGarbageQueue(attackGarbageState.secondIncoming),
  };
  const human = createVsSettlementSide(humanPending, preExisting.human);
  const cpu = createVsSettlementSide(cpuPending, preExisting.cpu);

  let mutualCancelled = 0;
  let humanToCpu = human.residualOutgoing;
  let cpuToHuman = cpu.residualOutgoing;
  if (humanPending && cpuPending) {
    mutualCancelled = Math.min(humanToCpu, cpuToHuman);
    humanToCpu -= mutualCancelled;
    cpuToHuman -= mutualCancelled;
  }

  // Only locked sides consume the incoming snapshot. Newly generated attacks are added later.
  replaceGarbageQueue(attackGarbageState.humanIncoming,
    humanPending && !human.coreTerminal ? [] : preExisting.human);
  replaceGarbageQueue(attackGarbageState.secondIncoming,
    cpuPending && !cpu.coreTerminal ? [] : preExisting.cpu);
  if (humanPending && !human.coreTerminal) {
    const applied = applyGarbagePackets(human.state, human.remainingIncoming);
    human.garbageApplied = applied.appliedRows;
    human.garbageOverflow = applied.garbageOverflow;
    human.terminal = applied.garbageOverflow;
  }
  if (cpuPending && !cpu.coreTerminal) {
    const applied = applyGarbagePackets(cpu.state, cpu.remainingIncoming);
    cpu.garbageApplied = applied.appliedRows;
    cpu.garbageOverflow = applied.garbageOverflow;
    cpu.terminal = applied.garbageOverflow;
  }
  if (humanPending && !human.terminal) {
    advancePieceFor(human.state);
    human.terminal = human.state.gameOver;
  }
  if (cpuPending && !cpu.terminal) {
    advancePieceFor(cpu.state);
    cpu.terminal = cpu.state.gameOver;
  }

  const humanTerminal = humanPending ? human.terminal : currentPlayerState.gameOver;
  const cpuTerminal = cpuPending ? cpu.terminal : secondaryPlayerState.gameOver;
  if (humanToCpu > 0 && !cpuTerminal) {
    enqueueGarbagePacket(attackGarbageState.secondIncoming, humanToCpu, undefined, vsGarbageRandomFor("cpu"));
  }
  if (cpuToHuman > 0 && !humanTerminal) {
    enqueueGarbagePacket(attackGarbageState.humanIncoming, cpuToHuman, undefined, vsGarbageRandomFor("human"));
  }
  const outcome = resolveVsOutcome(humanTerminal, cpuTerminal);
  const transaction = {
    human: { lockResult: humanPending?.lockResult ?? null, rawAttack: human.rawAttack, ownCancelled: human.cancelled, residualOutgoing: human.residualOutgoing, garbageApplied: human.garbageApplied, terminal: humanTerminal },
    cpu: { lockResult: cpuPending?.lockResult ?? null, rawAttack: cpu.rawAttack, ownCancelled: cpu.cancelled, residualOutgoing: cpu.residualOutgoing, garbageApplied: cpu.garbageApplied, terminal: cpuTerminal },
    mutualCancelled,
    humanToCpu,
    cpuToHuman,
    outcome,
  };
  vsMatchState.settling = false;
  if (outcome) finalizeVsMatch(outcome);
  updateVersusIndicators();
  draw();
  return transaction;
}

function resolveVersusLockFor(state, incomingQueue, opponentQueue, { holeColumn } = {}) {
  const lockResult = resolveLockFor(state);
  const outcome = {
    lockResult,
    rawAttack: 0,
    cancelled: 0,
    outgoingAttack: 0,
    garbageApplied: 0,
    garbageOverflow: false,
    terminal: lockResult.terminal,
  };
  if (lockResult.terminal) return outcome;

  outcome.rawAttack = calculateAttack(lockResult);
  const cancellation = cancelIncomingGarbage(incomingQueue, outcome.rawAttack);
  incomingQueue.splice(0, incomingQueue.length, ...cancellation.queue);
  outcome.cancelled = cancellation.cancelled;
  outcome.outgoingAttack = cancellation.remainingAttack;
  if (outcome.outgoingAttack > 0) {
    const recipient = state === currentPlayerState ? "cpu" : "human";
    enqueueGarbagePacket(opponentQueue, outcome.outgoingAttack, holeColumn, vsGarbageRandomFor(recipient));
  }

  const applied = applyGarbagePackets(state, incomingQueue);
  outcome.garbageApplied = applied.appliedRows;
  outcome.garbageOverflow = applied.garbageOverflow;
  if (outcome.garbageOverflow) {
    state.gameOver = true;
    outcome.terminal = true;
    return outcome;
  }

  advancePieceFor(state);
  outcome.terminal = state.gameOver;
  return outcome;
}

function updateVersusIndicators() {
  if (!vsIndicatorsElement) return;
  vsIndicatorsElement.hidden = !vsEngineTestActive;
  if (cpuIndicatorsElement) cpuIndicatorsElement.hidden = !vsEngineTestActive;
  if (!vsEngineTestActive || !attackGarbageState) return;
  humanIncomingElement.textContent = totalIncomingGarbage(attackGarbageState.humanIncoming);
  secondIncomingElement.textContent = totalIncomingGarbage(attackGarbageState.secondIncoming);
}

function clonePlayerStateForSimulation(state) {
  return {
    ...state,
    board: state.board.map(row => row.slice()),
    piece: state.piece ? {
      ...state.piece,
      shape: state.piece.shape.map(row => row.slice()),
    } : null,
    nextQueue: state.nextQueue.slice(),
    bag: state.bag.slice(),
    lastLockResult: state.lastLockResult ? { ...state.lastLockResult } : null,
    runStats: { ...state.runStats },
  };
}

function analyzeBoardForCpu(board, completedLines = 0) {
  const heights = Array(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let foundBlock = false;
    for (let y = 0; y < TOTAL_ROWS; y++) {
      if (board[y][x]) {
        if (!foundBlock) {
          heights[x] = TOTAL_ROWS - y;
          foundBlock = true;
        }
      } else if (foundBlock) {
        holes++;
      }
    }
  }
  const aggregateHeight = heights.reduce((sum, height) => sum + height, 0);
  const maximumHeight = Math.max(...heights);
  const bumpiness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]), 0);
  return { completedLines, holes, heights, aggregateHeight, maximumHeight, bumpiness };
}

function evaluateCpuCandidate(metrics, terminal) {
  const value = metrics.completedLines * CPU_V0_1_CONFIG.lineReward
    - metrics.holes * CPU_V0_1_CONFIG.holePenalty
    - metrics.aggregateHeight * CPU_V0_1_CONFIG.aggregateHeightPenalty
    - metrics.maximumHeight * CPU_V0_1_CONFIG.maximumHeightPenalty
    - metrics.bumpiness * CPU_V0_1_CONFIG.bumpinessPenalty;
  return terminal ? value - CPU_V0_1_CONFIG.terminalPenalty : value;
}

function isBetterCpuCandidate(candidate, current) {
  if (!current) return true;
  if (candidate.evaluation !== current.evaluation) return candidate.evaluation > current.evaluation;
  if (candidate.actions.length !== current.actions.length) return candidate.actions.length < current.actions.length;
  if (candidate.finalRotation !== current.finalRotation) return candidate.finalRotation < current.finalRotation;
  if (candidate.finalX !== current.finalX) return candidate.finalX < current.finalX;
  return candidate.order < current.order;
}

function planCpuPlacement(state) {
  if (!state || !state.piece || state.gameOver) {
    return { actions: [], evaluation: -Infinity, finalX: null, finalRotation: null, landingY: null, metrics: null, candidateCount: 0 };
  }
  const searchActions = [PLAYER_ACTIONS.ROTATE_CW, PLAYER_ACTIONS.ROTATE_CCW,
    PLAYER_ACTIONS.MOVE_LEFT, PLAYER_ACTIONS.MOVE_RIGHT];
  const queue = [{ state: clonePlayerStateForSimulation(state), actions: [] }];
  const visited = new Set([`${state.piece.x},${state.piece.y},${state.piece.rotation}`]);
  let candidateCount = 0;
  let order = 0;
  let best = null;
  while (queue.length > 0 && visited.size <= CPU_V0_1_CONFIG.maxSearchStates) {
    const node = queue.shift();
    const landingY = landingYOn(node.state.board, node.state.piece);
    const candidateState = clonePlayerStateForSimulation(node.state);
    candidateState.piece.y = landingY;
    const result = resolveLockFor(candidateState);
    const metrics = analyzeBoardForCpu(candidateState.board, result.lines);
    const candidate = {
      actions: [...node.actions, PLAYER_ACTIONS.HARD_DROP],
      evaluation: evaluateCpuCandidate(metrics, result.terminal),
      finalX: node.state.piece.x,
      finalRotation: node.state.piece.rotation,
      landingY,
      metrics,
      terminal: result.terminal,
      order: order++,
    };
    candidateCount++;
    if (isBetterCpuCandidate(candidate, best)) best = candidate;

    for (const action of searchActions) {
      const next = clonePlayerStateForSimulation(node.state);
      if (!applyPlayerActionFor(next, action)) continue;
      const key = `${next.piece.x},${next.piece.y},${next.piece.rotation}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ state: next, actions: [...node.actions, action] });
    }
  }
  if (!best) {
    return { actions: [], evaluation: -Infinity, finalX: null, finalRotation: null, landingY: null, metrics: null, candidateCount };
  }
  return { ...best, candidateCount };
}

function createCpuControllerState({ enabled = false } = {}) {
  return {
    enabled,
    plannedPiece: null,
    actionQueue: [],
    thinkElapsed: 0,
    actionElapsed: 0,
    needsPlan: true,
    lastPlan: null,
    diagnosticStatus: enabled ? "THINKING" : "IDLE",
  };
}

function resetCpuPlan(controller, status = "THINKING") {
  controller.plannedPiece = null;
  controller.actionQueue = [];
  controller.thinkElapsed = 0;
  controller.actionElapsed = 0;
  controller.needsPlan = true;
  controller.lastPlan = null;
  controller.diagnosticStatus = status;
}

function advanceCpuController(controller, state, elapsed) {
  if (isVsMatchFinished() || pendingVsLockFor(state) || !controller || !controller.enabled || !state || elapsed <= 0) return;
  if (state.gameOver) {
    controller.enabled = false;
    controller.actionQueue = [];
    controller.diagnosticStatus = "TOP OUT";
    return;
  }
  if (controller.plannedPiece && controller.plannedPiece !== state.piece) resetCpuPlan(controller);
  if (controller.needsPlan) {
    controller.thinkElapsed += elapsed;
    controller.diagnosticStatus = "THINKING";
    if (controller.thinkElapsed < CPU_V0_1_CONFIG.thinkDelayMs) return;
    controller.thinkElapsed = 0;
    controller.lastPlan = planCpuPlacement(state);
    controller.actionQueue = controller.lastPlan.actions.slice();
    controller.plannedPiece = state.piece;
    controller.actionElapsed = 0;
    controller.needsPlan = false;
    controller.diagnosticStatus = controller.actionQueue.length ? "EXECUTING" : "NO PLAN";
    return;
  }
  controller.actionElapsed += elapsed;
  if (controller.actionElapsed < CPU_V0_1_CONFIG.actionIntervalMs) return;
  controller.actionElapsed = 0;
  const action = controller.actionQueue.shift();
  if (!action) {
    resetCpuPlan(controller);
    return;
  }
  const pieceBefore = state.piece;
  if (!applyPlayerActionFor(state, action)) {
    resetCpuPlan(controller, "REPLAN");
    return;
  }
  if (state.gameOver) {
    controller.enabled = false;
    controller.actionQueue = [];
    controller.diagnosticStatus = "TOP OUT";
    return;
  }
  if (state.piece !== pieceBefore) {
    resetCpuPlan(controller);
    return;
  }
  if (controller.actionQueue.length === 0) resetCpuPlan(controller);
}

function startDualBoardTest() {
  selectedStartLevel = 1;
  isQaRun = true;
  publicVsActive = false;
  dualBoardTestElement.classList.remove("public-vs");
  dualBoardTestActive = true;
  cpuTestActive = false;
  vsEngineTestActive = false;
  vsMatchState = createVsMatchState();
  attackGarbageState = createAttackGarbageState();
  restart();
  secondaryPlayerState = createPlayerState({ selectedStartLevel: 1 });
  cpuController = createCpuControllerState();
  dualFrameTime = null;
  qaOpen = false;
  qaWasPaused = false;
  qaOverlay.hidden = true;
  startScreenOpen = false;
  startOverlay.hidden = true;
  startOverlay.inert = false;
  gameUiElement.inert = false;
  paused = false;
  statusElement.textContent = "DUAL BOARD TEST";
  devToolsButton.hidden = false;
  pauseButton.disabled = false;
  pauseButton.textContent = "一時停止（P）";
  dualBoardTestElement.hidden = false;
  dualExitButton.textContent = "EXIT DUAL TEST";
  secondView.statusText = "";
  hideVsResults();
  updateVsFixtureVisibility();
  updatePauseVisual();
  draw();
}

function startCpuTest() {
  selectedStartLevel = 1;
  isQaRun = true;
  publicVsActive = false;
  dualBoardTestElement.classList.remove("public-vs");
  dualBoardTestActive = true;
  cpuTestActive = true;
  vsEngineTestActive = false;
  vsMatchState = createVsMatchState();
  attackGarbageState = createAttackGarbageState();
  restart();
  secondaryPlayerState = createPlayerState({ selectedStartLevel: 1 });
  cpuController = createCpuControllerState({ enabled: true });
  dualFrameTime = null;
  qaOpen = false;
  qaWasPaused = false;
  qaOverlay.hidden = true;
  startScreenOpen = false;
  startOverlay.hidden = true;
  startOverlay.inert = false;
  gameUiElement.inert = false;
  paused = false;
  statusElement.textContent = "CPU TEST";
  devToolsButton.hidden = false;
  pauseButton.disabled = false;
  pauseButton.textContent = "一時停止（P）";
  secondView.statusText = "CPU v0.1";
  dualExitButton.textContent = "EXIT DUAL TEST";
  hideVsResults();
  updateVsFixtureVisibility();
  dualBoardTestElement.hidden = false;
  updatePauseVisual();
  draw();
}

function startFreshVsMatch({ seed, publicMode = false } = {}) {
  selectedStartLevel = 1;
  publicVsActive = Boolean(publicMode);
  dualBoardTestElement.classList.toggle("public-vs", publicVsActive);
  isQaRun = !publicVsActive;
  dualBoardTestActive = true;
  cpuTestActive = true;
  vsEngineTestActive = true;
  vsMatchState = createVsMatchState({ active: true, pieceSource: createVsPieceSource(seed) });
  attackGarbageState = createAttackGarbageState();
  humanController = createHumanControllerState();
  restart({ preserveVsMatch: true });
  dualFrameTime = null;
  qaOpen = false;
  qaWasPaused = false;
  qaOverlay.hidden = true;
  startScreenOpen = false;
  startOverlay.hidden = true;
  startOverlay.inert = false;
  gameUiElement.inert = false;
  paused = false;
  statusElement.textContent = publicVsActive ? "VS CPU" : "VS ENGINE TEST";
  devToolsButton.hidden = publicVsActive;
  pauseButton.disabled = false;
  pauseButton.textContent = "一時停止（P）";
  secondView.statusText = publicVsActive ? "CPU" : "CPU v0.1 — VS";
  dualExitButton.textContent = publicVsActive ? "EXIT VS" : "EXIT DUAL TEST";
  if (secondPlayerTitleElement) secondPlayerTitleElement.textContent = "CPU";
  vsIndicatorsElement.hidden = false;
  dualBoardTestElement.hidden = false;
  hideVsResults();
  updateVsFixtureVisibility();
  updatePauseVisual();
  draw();
}

function startVsEngineTest(options = {}) {
  startFreshVsMatch({ ...options, publicMode: false });
}

function startPublicVsCpu() {
  enableAudio();
  startFreshVsMatch({ publicMode: true });
}

function exitVsMatch() {
  hideVsResults();
  vsMatchState = createVsMatchState();
  vsEngineTestActive = false;
  publicVsActive = false;
  dualBoardTestElement.classList.remove("public-vs");
  dualBoardTestActive = false;
  cpuTestActive = false;
  secondaryPlayerState = null;
  cpuController = createCpuControllerState();
  attackGarbageState = createAttackGarbageState();
  dualFrameTime = null;
  dualBoardTestElement.hidden = true;
  vsIndicatorsElement.hidden = true;
  isQaRun = false;
  selectedStartLevel = 1;
  humanController = createHumanControllerState();
  secondView.statusText = "";
  dualExitButton.textContent = "EXIT DUAL TEST";
  if (secondPlayerTitleElement) secondPlayerTitleElement.textContent = "PLAYER 2";
  devToolsButton.hidden = false;
  showStartScreen();
  updateVsFixtureVisibility();
  draw();
}

function exitDualBoardTest() {
  if (vsEngineTestActive) {
    exitVsMatch();
    return;
  }
  dualBoardTestActive = false;
  cpuTestActive = false;
  vsEngineTestActive = false;
  publicVsActive = false;
  dualBoardTestElement.classList.remove("public-vs");
  secondaryPlayerState = null;
  cpuController = createCpuControllerState();
  attackGarbageState = createAttackGarbageState();
  dualFrameTime = null;
  dualBoardTestElement.hidden = true;
  isQaRun = false;
  selectedStartLevel = 1;
  humanController = createHumanControllerState();
  secondView.statusText = "";
  updateVsFixtureVisibility();
  restart();
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

function queueQaGarbageToHuman() {
  if (!canUseVsQaFixtures() || !attackGarbageState) return;
  enqueueGarbagePacket(attackGarbageState.humanIncoming, 2, 4);
  qaMessageElement.textContent = "Queued 2 garbage rows for Human.";
  updateVersusIndicators();
}

function forceVsTopOut(state) {
  if (!canUseVsQaFixtures() || !state) return;
  state.board[SPAWN_Y + 1].fill(7);
  spawnPieceFor(state, 0);
  settleVsMatchOutcome();
  draw();
}

function forceVsHumanTopOut() {
  if (!canUseVsQaFixtures()) return;
  forceVsTopOut(currentPlayerState);
  closeQa();
}

function forceVsCpuTopOut() {
  if (!canUseVsQaFixtures()) return;
  forceVsTopOut(secondaryPlayerState);
  closeQa();
}

function forceVsDoubleTopOut() {
  if (!canUseVsQaFixtures() || !secondaryPlayerState) return;
  currentPlayerState.board[SPAWN_Y + 1].fill(7);
  secondaryPlayerState.board[SPAWN_Y + 1].fill(7);
  spawnPieceFor(currentPlayerState, 0);
  spawnPieceFor(secondaryPlayerState, 0);
  settleVsMatchOutcome();
  draw();
  closeQa();
}

function setupVsTransactionalLock() {
  if (!canUseVsQaFixtures() || !secondaryPlayerState) return;
  const setup = (state, lines) => {
    state.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    state.board[0][0] = 7;
    for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) {
      state.board[y].fill(2); state.board[y][4] = 0;
    }
    state.piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
    state.gameOver = false;
    state.nextQueue = [0, 1, 2, 3, 4];
    state.bag = [5, 6];
    state.lastLockResult = null;
    state.lockElapsed = 0;
    state.dropElapsed = 0;
  };
  setup(currentPlayerState, 4);
  setup(secondaryPlayerState, 1);
  // Both real Hard Drop action boundaries prepare a lock; the next RAF flushes them together.
  applyPlayerAction(PLAYER_ACTIONS.HARD_DROP);
  applyPlayerActionFor(secondaryPlayerState, PLAYER_ACTIONS.HARD_DROP);
  qaMessageElement.textContent = "Prepared Human/CPU locks; next frame settles both.";
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

function resolveVsOutcome(humanTerminal, cpuTerminal) {
  if (humanTerminal && cpuTerminal) return VS_OUTCOMES.DRAW;
  if (humanTerminal) return VS_OUTCOMES.CPU_WIN;
  if (cpuTerminal) return VS_OUTCOMES.HUMAN_WIN;
  return null;
}

function createVsResultSnapshot(outcome) {
  const snapshotPlayer = state => ({
    score: state?.score ?? 0,
    lines: state?.totalLines ?? 0,
    level: state?.level ?? 1,
    stats: { ...(state?.runStats ?? createEmptyRunStats()) },
  });
  return {
    outcome,
    human: snapshotPlayer(currentPlayerState),
    cpu: snapshotPlayer(secondaryPlayerState),
  };
}

function hideVsResults() {
  if (vsResultsElement) vsResultsElement.hidden = true;
}

function showVsResults(snapshot) {
  const titles = {
    [VS_OUTCOMES.HUMAN_WIN]: "YOU WIN",
    [VS_OUTCOMES.CPU_WIN]: "CPU WINS",
    [VS_OUTCOMES.DRAW]: "DRAW",
  };
  vsResultsTitleElement.textContent = titles[snapshot.outcome] ?? "VS RESULTS";
  vsHumanScoreElement.textContent = String(snapshot.human.score);
  vsHumanLinesElement.textContent = String(snapshot.human.lines);
  vsCpuScoreElement.textContent = String(snapshot.cpu.score);
  vsCpuLinesElement.textContent = String(snapshot.cpu.lines);
  vsResultsElement.hidden = false;
  replayAnimation(vsResultsElement, "results-enter");
  gameUiElement.inert = true;
  vsResultsTitleElement.focus?.();
}

function isVsMatchFinished() {
  return vsEngineTestActive && vsMatchState.finished;
}

function settleVsMatchOutcome() {
  if (!vsEngineTestActive || !vsMatchState.active || vsMatchState.finished || !secondaryPlayerState) return null;
  const outcome = resolveVsOutcome(currentPlayerState.gameOver, secondaryPlayerState.gameOver);
  if (outcome) finalizeVsMatch(outcome);
  return outcome;
}

function finalizeVsMatch(outcome) {
  if (!vsEngineTestActive || !vsMatchState.active || vsMatchState.finished || !outcome) return false;
  vsMatchState.pendingLocks = { human: null, cpu: null };
  vsMatchState.settling = false;
  vsMatchState.finished = true;
  vsMatchState.active = false;
  vsMatchState.outcome = outcome;
  vsMatchState.resultSnapshot = createVsResultSnapshot(outcome);
  clearHeldKeys();
  paused = false;
  dualFrameTime = null;
  if (cpuController) {
    cpuController.enabled = false;
    resetCpuPlan(cpuController, "MATCH FINISHED");
  }
  pauseButton.disabled = true;
  statusElement.textContent = "VS MATCH FINISHED";
  updatePauseVisual();
  showVsResults(vsMatchState.resultSnapshot);
  draw();
  return true;
}

// 7種類を1回ずつ使う順番をシャッフルする。
function nextTypeFor(state, sideOverride = null) {
  const source = vsMatchState?.pieceSource;
  const side = vsPieceSideFor(state, sideOverride);
  if (vsEngineTestActive && source && side) return nextVsPieceType(source, side);
  if (state.bag.length === 0) {
    state.bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = state.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.bag[i], state.bag[j]] = [state.bag[j], state.bag[i]];
    }
  }
  return state.bag.pop();
}

function nextType() {
  return nextTypeFor(currentPlayerState);
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

function spawnPieceFor(state, type = state.nextQueue[0]) {
  state.lastRotationKick = null;
  const shape = ROTATIONS[type][0];
  state.piece = { shape, rotation: 0, x: Math.floor((COLS - shape[0].length) / 2), y: SPAWN_Y, color: type + 1 };
  state.dropElapsed = 0;
  state.lockElapsed = 0;
  state.lockResets = 0;
  if (collidesOn(state.board, shape, state.piece.x, state.piece.y)) state.gameOver = true;
  return state.piece;
}

function spawnPiece(type = nextQueue[0]) {
  const spawned = spawnPieceFor(currentPlayerState, type);
  if (currentPlayerState.gameOver) {
    if (vsEngineTestActive) settleVsMatchOutcome();
    else endGame();
  }
  return spawned;
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

function advancePieceFor(state, sideOverride = null) {
  const type = state.nextQueue.shift();
  while (state.nextQueue.length < NEXT_COUNT) state.nextQueue.push(nextTypeFor(state, sideOverride));
  return spawnPieceFor(state, type);
}

function advancePiece() {
  const spawned = advancePieceFor(currentPlayerState);
  if (currentPlayerState.gameOver) endGame();
  return spawned;
}

function holdPlayer(state) {
  if (state.holdUsed || !state.piece) return false;
  const type = state.piece.color - 1;
  if (state.heldType === null) {
    state.heldType = type;
    advancePieceFor(state);
  } else {
    const previous = state.heldType;
    state.heldType = type;
    spawnPieceFor(state, previous);
  }
  state.holdUsed = true;
  return true;
}

function hold() {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  holdPlayer(currentPlayerState);
  if (currentPlayerState.gameOver) endGame();
}

function getGravityInterval(currentLevel = level) {
  const gravityLevel = Math.min(currentLevel, 15);
  return Math.pow(0.8 - ((gravityLevel - 1) * 0.007), gravityLevel - 1) * 1000;
}

function softDropUsesRepeat(controller = humanController, state = currentPlayerState) {
  return controller.heldKeys.ArrowDown && settings.softDropMs < getGravityInterval(state.level);
}

function togglePause(time = performance.now()) {
  if (gameOver || marathonComplete || isVsMatchFinished()) return;
  advanceTime(time);
  if (gameOver || marathonComplete) return;
  paused = !paused;
  updatePauseVisual();
  clearHeldKeys();
  dualFrameTime = null;
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

function drawPreviewOn(preview, types, size, targetContext = preview.getContext("2d")) {
  const ctx = targetContext;
  ctx.clearRect(0, 0, preview.width, preview.height);
  const slotHeight = preview.height / types.length;
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

function isGroundedFor(state) {
  return collidesOn(state.board, state.piece.shape, state.piece.x, state.piece.y + 1);
}

function isGrounded() {
  return isGroundedFor(currentPlayerState);
}

function resetLockDelayFor(state) {
  if (state.lockResets < MAX_LOCK_RESETS) {
    state.lockElapsed = 0;
    state.lockResets++;
  }
}

function resetLockDelay() {
  resetLockDelayFor(currentPlayerState);
}

function movePlayer(state, dx, dy) {
  if (collidesOn(state.board, state.piece.shape, state.piece.x + dx, state.piece.y + dy)) return false;
  const wasGrounded = isGroundedFor(state);
  state.piece.x += dx;
  state.piece.y += dy;
  // Gravity・Dropを含む実移動で解除。衝突した入力ではここへ到達しない。
  if (dx !== 0 || dy !== 0) state.lastRotationKick = null;
  if (dx !== 0 && wasGrounded) resetLockDelayFor(state);
  return true;
}

function move(dx, dy) {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  return movePlayer(currentPlayerState, dx, dy);
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

function rotatePlayer(state, direction = 1) {
  const rotation = (state.piece.rotation + direction + 4) % 4;
  const rotated = ROTATIONS[state.piece.color - 1][rotation];
  const transition = `${state.piece.rotation}>${rotation}`;
  const kicks = state.piece.color === 2 ? [[0,0]]
    : (state.piece.color === 1 ? I_KICKS : COMMON_KICKS)[transition];
  for (const [kickIndex, [dx, dy]] of kicks.entries()) {
    if (collidesOn(state.board, rotated, state.piece.x + dx, state.piece.y + dy)) continue;
    const wasGrounded = isGroundedFor(state);
    state.piece.x += dx;
    state.piece.y += dy;
    state.piece.shape = rotated;
    state.piece.rotation = rotation;
    state.lastRotationKick = kickIndex;
    if (wasGrounded) resetLockDelayFor(state);
    return true;
  }
  return false;
}

function rotate(direction = 1) {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  return rotatePlayer(currentPlayerState, direction);
}

function addScore(points) {
  score += points;
  scoreElement.textContent = score;
  updateHighScoreForMarathon(currentPlayerState);
}

function updateHighScoreForMarathon(state) {
  if (selectedStartLevel !== 1 || isQaRun || publicVsActive || state.score <= highScore) return;
  highScore = state.score;
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

// TetrisWikiの3-corner / 前側2角方式。第5候補の回転はMiniからFullへ。
// https://tetris.wiki/T-Spin （最新公式Guideline全文の保証ではない）
function detectTSpinFor(state) {
  if (state.piece.color !== 3 || state.lastRotationKick === null) return "NONE";
  const center = (state.piece.shape.length - 1) / 2;
  // 左上・右上・右下・左下。collidesで内部盤面の境界も占有扱いにする。
  const corners = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([dx, dy]) =>
    collidesOn(state.board, [[1]], state.piece.x + center + dx, state.piece.y + center + dy));
  if (corners.filter(Boolean).length < 3) return "NONE";
  // 状態0:上、1:右、2:下、3:左がTの突き出す側。
  const frontFilled = corners[state.piece.rotation] && corners[(state.piece.rotation + 1) % 4];
  return frontFilled || state.lastRotationKick === 4 ? "T_SPIN" : "T_SPIN_MINI";
}

function detectTSpin() {
  return detectTSpinFor(currentPlayerState);
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

function isBoardEmptyFor(state) {
  return state.board.every(row => row.every(cell => cell === 0));
}

function isBoardEmpty() {
  return isBoardEmptyFor(currentPlayerState);
}

function calculatePerfectClearScore(lines, level, b2bTetris) {
  const base = b2bTetris ? B2B_TETRIS_PERFECT_CLEAR_SCORE : PERFECT_CLEAR_SCORES[lines] ?? 0;
  return base * level;
}

function resolveLockFor(state) {
  // 現行テストとQA用の検出差し替えを維持しつつ、別Stateでは純粋なstate-aware判定を使う。
  const spin = state === currentPlayerState ? detectTSpin() : detectTSpinFor(state);
  const result = {
    spin,
    lines: 0,
    difficult: false,
    perfectClear: false,
    scoreDelta: 0,
    comboBefore: state.comboCount,
    comboAfter: state.comboCount,
    b2bBefore: state.backToBackActive,
    b2bBonusApplied: false,
    b2bAfter: state.backToBackActive,
    levelBefore: state.level,
    levelAfter: state.level,
    totalLinesBefore: state.totalLines,
    totalLinesAfter: state.totalLines,
    levelChanged: false,
    lockOut: false,
    topOut: false,
    terminal: false,
    statsDelta: { tetrises: 0, tSpins: 0, tSpinMinis: 0, perfectClears: 0 },
  };
  // 既存のHUD/Results用メタデータ形状は維持し、詳細なLock Resultは戻り値で渡す。
  state.lastLockResult = { spin, lines: 0 };
  state.lastPerfectClear = false;
  // 消去前の固定位置で判定。一部が見えていればLock Outにしない。
  const lockOut = state.piece.shape.every((row, dy) => row.every(cell => !cell || state.piece.y + dy < HIDDEN_ROWS));
  state.piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
    if (cell) state.board[state.piece.y + dy][state.piece.x + dx] = state.piece.color;
  }));
  if (lockOut) {
    state.gameOver = true;
    result.lockOut = true;
    result.topOut = true;
    result.terminal = true;
    return result;
  }
  const remaining = state.board.filter(row => row.some(cell => cell === 0));
  const cleared = TOTAL_ROWS - remaining.length;
  result.lines = cleared;
  state.lastLockResult.lines = cleared;
  while (remaining.length < TOTAL_ROWS) remaining.unshift(Array(COLS).fill(0));
  state.board = remaining;
  state.lastPerfectClear = cleared > 0 && isBoardEmptyFor(state);
  result.perfectClear = state.lastPerfectClear;
  // 今回の消去によるLevel上昇より前の倍率を使う。
  const previousLevel = state.level;
  let clearScore = calculateClearScore(result.spin, cleared, state.level);
  const difficult = isDifficultClear(result.spin, cleared);
  const b2bBonusApplied = state.backToBackActive && difficult;
  if (b2bBonusApplied) clearScore = clearScore * 3 / 2;
  const b2bTetrisPerfectClear = b2bBonusApplied && result.spin === "NONE" && cleared === 4;
  const perfectClearScore = state.lastPerfectClear
    ? calculatePerfectClearScore(cleared, state.level, b2bTetrisPerfectClear)
    : 0;
  state.comboCount = cleared > 0 ? state.comboCount + 1 : -1;
  if (cleared === 4) { state.runStats.tetrises++; result.statsDelta.tetrises = 1; }
  if (result.spin === "T_SPIN") { state.runStats.tSpins++; result.statsDelta.tSpins = 1; }
  else if (result.spin === "T_SPIN_MINI") { state.runStats.tSpinMinis++; result.statsDelta.tSpinMinis = 1; }
  if (state.lastPerfectClear) { state.runStats.perfectClears++; result.statsDelta.perfectClears = 1; }
  state.runStats.maxCombo = Math.max(state.runStats.maxCombo, state.comboCount);
  const comboScore = state.comboCount > 0 ? 50 * state.comboCount * state.level : 0;
  const scoreDelta = clearScore + perfectClearScore + comboScore;
  state.score += scoreDelta;
  // 最初の対象消去は開始だけ。0ラインは既存の連続状態を維持する。
  if (cleared > 0) state.backToBackActive = difficult;
  state.totalLines += cleared;
  state.level = Math.floor(state.totalLines / 10) + 1;
  state.dropElapsed = 0;
  state.holdUsed = false;
  result.difficult = difficult;
  result.scoreDelta = scoreDelta;
  result.comboAfter = state.comboCount;
  result.b2bBonusApplied = b2bBonusApplied;
  result.b2bAfter = state.backToBackActive;
  result.totalLinesAfter = state.totalLines;
  result.levelAfter = state.level;
  result.levelChanged = state.level !== previousLevel;
  return result;
}

function applyMarathonPolicy(state, result) {
  const marathonComplete = !result.terminal && result.totalLinesAfter >= MARATHON_TARGET_LINES;
  return {
    marathonComplete,
    shouldSpawn: !result.terminal && !marathonComplete,
    highScoreEligible: selectedStartLevel === 1 && !isQaRun && !publicVsActive,
  };
}

function lockPiece() {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return currentPlayerState.lastLockResult;
  if (vsEngineTestActive && attackGarbageState) {
    return prepareVsLock("human", currentPlayerState)?.lockResult ?? currentPlayerState.lastLockResult;
  }
  const result = resolveLockFor(currentPlayerState);
  if (result.lockOut) {
    endGame();
    return result;
  }
  const policy = applyMarathonPolicy(currentPlayerState, result);
  scoreElement.textContent = score;
  levelElement.textContent = level;
  updateHighScoreForMarathon(currentPlayerState);
  if (policy.marathonComplete) completeMarathon();
  else if (policy.shouldSpawn) advancePiece();
  updateProgressUI();
  showSpinFeedback();
  playLockEffects(result.spin, result.lines, result.perfectClear, result.levelChanged);
  return result;
}

function stepDown(softDrop = false) {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  if (move(0, 1)) {
    if (softDrop) addScore(1);
    return true;
  }
  return false;
}

function hardDrop() {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  let distance = 0;
  while (move(0, 1)) distance++;
  addScore(distance * 2);
  lockPiece();
}

function hardDropPlayer(state) {
  if (isVsMatchFinished() || pendingVsLockFor(state) || !state || state.gameOver || !state.piece) return false;
  let distance = 0;
  while (movePlayer(state, 0, 1)) distance++;
  state.score += distance * 2;
  const versus = vsEngineTestActive && state === secondaryPlayerState && attackGarbageState;
  const result = versus
    ? prepareVsLock("cpu", state)?.lockResult
    : resolveLockFor(state);
  if (!result) return false;
  if (!versus && !result.terminal) advancePieceFor(state);
  return { result, distance };
}

function drawCellOn(targetContext, x, y, color) {
  if (y < HIDDEN_ROWS || y >= TOTAL_ROWS) return;
  const visibleY = y - HIDDEN_ROWS;
  targetContext.fillStyle = COLORS[color];
  targetContext.fillRect(x * CELL + 1, visibleY * CELL + 1, CELL - 2, CELL - 2);
}

function drawCell(x, y, color) {
  drawCellOn(context, x, y, color);
}

function createPlayerView({ boardCanvas, boardContext, holdCanvas, nextCanvas, scoreElement, linesElement, levelElement, showMarathonTarget = false, statusElement = null, statusText = "" }) {
  return {
    boardCanvas, boardContext, holdCanvas,
    get holdContext() { return holdCanvas.getContext("2d"); },
    nextCanvas,
    get nextContext() { return nextCanvas.getContext("2d"); },
    scoreElement, linesElement, levelElement, showMarathonTarget, statusElement, statusText,
  };
}

function renderPlayer(state, view, { completed = false } = {}) {
  drawPreviewOn(view.nextCanvas, state.nextQueue, 16, view.nextContext);
  drawPreviewOn(view.holdCanvas, [state.heldType], 24, view.holdContext);
  const targetContext = view.boardContext;
  targetContext.clearRect(0, 0, view.boardCanvas.width, view.boardCanvas.height);
  targetContext.strokeStyle = "#191c22";
  targetContext.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    targetContext.beginPath();
    targetContext.moveTo(x * CELL, 0);
    targetContext.lineTo(x * CELL, VISIBLE_ROWS * CELL);
    targetContext.stroke();
  }
  for (let y = 0; y <= VISIBLE_ROWS; y++) {
    targetContext.beginPath();
    targetContext.moveTo(0, y * CELL);
    targetContext.lineTo(COLS * CELL, y * CELL);
    targetContext.stroke();
  }
  state.board.forEach((row, y) => row.forEach((color, x) => {
    if (color) drawCellOn(targetContext, x, y, color);
  }));
  if (state.piece && !state.gameOver && !completed) {
    const landingY = landingYOn(state.board, state.piece);
    targetContext.globalAlpha = 0.25;
    state.piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) drawCellOn(targetContext, state.piece.x + dx, landingY + dy, state.piece.color);
    }));
    targetContext.globalAlpha = 1;
    state.piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) drawCellOn(targetContext, state.piece.x + dx, state.piece.y + dy, state.piece.color);
    }));
  }
  if (view.scoreElement) view.scoreElement.textContent = state.score;
  if (view.linesElement) view.linesElement.textContent = view.showMarathonTarget && !publicVsActive
    ? `${state.totalLines} / ${MARATHON_TARGET_LINES}` : state.totalLines;
  if (view.levelElement) view.levelElement.textContent = state.level;
  if (view.statusElement) view.statusElement.textContent = state.gameOver
    ? `${view.statusText}${view.statusText ? " — " : ""}TOP OUT` : view.statusText;
}

function drawPreview(id, types) {
  const preview = document.getElementById(id);
  drawPreviewOn(preview, types, id === "next" ? 16 : 24);
}

let marathonView;
let secondView;

function draw() {
  renderPlayer(currentPlayerState, marathonView, { completed: marathonComplete });
  if (dualBoardTestActive && secondaryPlayerState) renderPlayer(secondaryPlayerState, secondView);
  updateVersusIndicators();
  updateVsFixtureVisibility();
}

function restart({ preserveVsMatch = false } = {}) {
  if (vsEngineTestActive && !preserveVsMatch) {
    startFreshVsMatch({ publicMode: publicVsActive });
    return;
  }
  clearSpinFeedback();
  clearEffects();
  hideResults();
  hideVsResults();
  startScreenOpen = false;
  startOverlay.hidden = true;
  startOverlay.inert = settingsOpen;
  gameUiElement.inert = settingsOpen || qaOpen;
  currentPlayerState = createPlayerState({
    selectedStartLevel,
    sequenceSide: vsEngineTestActive ? "human" : null,
  });
  clearHeldKeys();
  marathonComplete = false;
  paused = false;
  if (dualBoardTestActive) {
    secondaryPlayerState = createPlayerState({
      selectedStartLevel: 1,
      sequenceSide: vsEngineTestActive ? "cpu" : null,
    });
  }
  cpuController = createCpuControllerState({ enabled: cpuTestActive });
  if (vsEngineTestActive) {
    attackGarbageState = createAttackGarbageState();
    humanController = createHumanControllerState();
    vsMatchState = createVsMatchState({ active: true, pieceSource: vsMatchState.pieceSource });
  }
  if (secondView) secondView.statusText = vsEngineTestActive
    ? (publicVsActive ? "CPU" : "CPU v0.1 — VS") : cpuTestActive ? "CPU v0.1" : "";
  if (secondPlayerTitleElement) secondPlayerTitleElement.textContent = dualBoardTestActive ? "CPU" : "PLAYER 2";
  devToolsButton.hidden = publicVsActive;
  dualFrameTime = null;
  updatePauseVisual();
  levelElement.textContent = level;
  pauseButton.disabled = false;
  pauseButton.textContent = "一時停止（P）";
  lastTime = null;
  scoreElement.textContent = "0";
  statusElement.textContent = "プレイ中";
  updateProgressUI();
  updateVsFixtureVisibility();
  draw();
}

const PLAYER_ACTIONS = Object.freeze({
  MOVE_LEFT: "MOVE_LEFT",
  MOVE_RIGHT: "MOVE_RIGHT",
  ROTATE_CW: "ROTATE_CW",
  ROTATE_CCW: "ROTATE_CCW",
  SOFT_DROP: "SOFT_DROP",
  HARD_DROP: "HARD_DROP",
  HOLD: "HOLD",
});
const HUMAN_KEY_ACTIONS = Object.freeze({
  ArrowLeft: PLAYER_ACTIONS.MOVE_LEFT,
  ArrowRight: PLAYER_ACTIONS.MOVE_RIGHT,
  ArrowUp: PLAYER_ACTIONS.ROTATE_CW,
  KeyZ: PLAYER_ACTIONS.ROTATE_CCW,
  ArrowDown: PLAYER_ACTIONS.SOFT_DROP,
  Space: PLAYER_ACTIONS.HARD_DROP,
  KeyC: PLAYER_ACTIONS.HOLD,
});

function applyPlayerActionFor(state, action) {
  if (isVsMatchFinished() || pendingVsLockFor(state)) return false;
  switch (action) {
    case PLAYER_ACTIONS.MOVE_LEFT: return movePlayer(state, -1, 0);
    case PLAYER_ACTIONS.MOVE_RIGHT: return movePlayer(state, 1, 0);
    case PLAYER_ACTIONS.ROTATE_CW: return rotatePlayer(state, 1);
    case PLAYER_ACTIONS.ROTATE_CCW: return rotatePlayer(state, -1);
    case PLAYER_ACTIONS.HARD_DROP: return hardDropPlayer(state);
    case PLAYER_ACTIONS.HOLD: return holdPlayer(state);
    default: return false;
  }
}

function applyPlayerAction(action) {
  if (isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return false;
  switch (action) {
    case PLAYER_ACTIONS.MOVE_LEFT: return move(-1, 0);
    case PLAYER_ACTIONS.MOVE_RIGHT: return move(1, 0);
    case PLAYER_ACTIONS.ROTATE_CW: return rotate();
    case PLAYER_ACTIONS.ROTATE_CCW: return rotate(-1);
    case PLAYER_ACTIONS.SOFT_DROP: return stepDown(true);
    case PLAYER_ACTIONS.HARD_DROP: return hardDrop();
    case PLAYER_ACTIONS.HOLD: return hold();
    default: return false;
  }
}

function handleHumanKeyDown(code, time, isRepeat = false) {
  if (isRepeat || humanController.heldKeys[code]) return;
  if (code === "KeyR") { restart(); return; }
  if (code === "KeyP") { togglePause(time); return; }
  if (gameOver || marathonComplete || paused || isVsMatchFinished() || pendingVsLockFor(currentPlayerState)) return;

  // 入力前の時間は入力前の姿勢に適用し、着地・リセット前の時間を混ぜない。
  advanceTime(time);
  if (gameOver || marathonComplete) return;
  if (code in humanController.heldKeys) {
    humanController.heldKeys[code] = true;
    if (code === "ArrowDown") {
      humanController.nextSoftDropTime = softDropUsesRepeat() ? lastTime + settings.softDropMs : Infinity;
      humanController.softDropScheduledPiece = humanController.nextSoftDropTime < Infinity ? piece : null;
    } else {
      humanController.activeDirection = code;
      humanController.nextHorizontalTime = lastTime + settings.dasMs;
    }
  }
  if (HUMAN_KEY_ACTIONS[code]) applyPlayerAction(HUMAN_KEY_ACTIONS[code]);
  if (code === "ArrowDown") dropElapsed = 0;
  draw();
}

function handleHumanKeyUp(code, time) {
  if (!(code in humanController.heldKeys) || !humanController.heldKeys[code]) return;
  advanceTime(time);
  humanController.heldKeys[code] = false;
  if (code === "ArrowDown") {
    humanController.nextSoftDropTime = Infinity;
    humanController.softDropScheduledPiece = null;
    dropElapsed = 0;
  } else if (humanController.activeDirection === code) {
    const other = code === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    humanController.activeDirection = humanController.heldKeys[other] ? other : null;
    humanController.nextHorizontalTime = humanController.activeDirection ? lastTime + settings.dasMs : Infinity;
  }
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
  handleHumanKeyDown(event.code, event.timeStamp, event.repeat);
});
document.getElementById("restart").addEventListener("click", () => { enableAudio(); restart(); });
document.getElementById("play-again").addEventListener("click", () => { enableAudio(); playAgain(); });
startButton.addEventListener("click", () => { enableAudio(); startGame(); });
startVsButton.addEventListener("click", startPublicVsCpu);
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
document.getElementById("qa-garbage-human").addEventListener("click", queueQaGarbageToHuman);
qaForceHumanTopOutButton.addEventListener("click", forceVsHumanTopOut);
qaForceCpuTopOutButton.addEventListener("click", forceVsCpuTopOut);
qaForceDoubleTopOutButton.addEventListener("click", forceVsDoubleTopOut);
qaTransactionalLockButton.addEventListener("click", setupVsTransactionalLock);
document.getElementById("qa-dual").addEventListener("click", startDualBoardTest);
document.getElementById("qa-cpu").addEventListener("click", startCpuTest);
document.getElementById("qa-vs-engine").addEventListener("click", startVsEngineTest);
document.getElementById("dual-exit").addEventListener("click", exitDualBoardTest);
vsRematchButton.addEventListener("click", () => { enableAudio(); startFreshVsMatch({ publicMode: publicVsActive }); });
vsExitButton.addEventListener("click", exitVsMatch);
qaResetButton.addEventListener("click", () => {
  isQaRun = false;
  if (dualBoardTestActive) {
    exitDualBoardTest();
    closeQa();
    return;
  }
  restart();
  closeQa();
});
document.addEventListener("keyup", event => {
  handleHumanKeyUp(event.code, event.timeStamp);
});
pauseButton.addEventListener("click", event => { enableAudio(); togglePause(event.timeStamp); });

// 別タブから戻ったときに経過時間分が一気に落ちるのを防ぐ。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
});
window.addEventListener("blur", () => {
  focusSuspended = true;
  clearHeldKeys();
  lastTime = null;
  dualFrameTime = null;
});
window.addEventListener("focus", () => {
  focusSuspended = false;
  lastTime = null;
  dualFrameTime = null;
});

function canAdvanceSimulation() {
  return !startScreenOpen && !paused && !settingsOpen && !qaOpen && !focusSuspended
    && !document.hidden && !gameOver && !marathonComplete && !isVsMatchFinished()
    && !pendingVsLockFor(currentPlayerState);
}

function canAdvanceSharedSimulation() {
  return !startScreenOpen && !paused && !settingsOpen && !qaOpen && !focusSuspended && !document.hidden
    && !isVsMatchFinished();
}

function prepareHumanController(controller, state, time) {
  if (controller.heldKeys.ArrowDown && !softDropUsesRepeat(controller, state)) {
    controller.nextSoftDropTime = Infinity;
    controller.softDropScheduledPiece = null;
  } else if (softDropUsesRepeat(controller, state) && controller.softDropScheduledPiece !== state.piece) {
    controller.nextSoftDropTime = (lastTime ?? time) + settings.softDropMs;
    controller.softDropScheduledPiece = state.piece;
  }
  if (lastTime !== null && time - lastTime > MAX_INPUT_CATCHUP) {
    // 古い繰り返しは現在時刻の1回にまとめ、低更新頻度でも入力を進める。
    if (controller.activeDirection && controller.nextHorizontalTime <= time) controller.nextHorizontalTime = time;
    if (softDropUsesRepeat(controller, state) && controller.nextSoftDropTime <= time) controller.nextSoftDropTime = time;
  }
}

function advanceHumanController(controller, time) {
  if (controller.nextHorizontalTime === time) {
    applyPlayerAction(controller.activeDirection === "ArrowLeft"
      ? PLAYER_ACTIONS.MOVE_LEFT : PLAYER_ACTIONS.MOVE_RIGHT);
    controller.nextHorizontalTime += settings.arrMs;
  }
  if (controller.nextSoftDropTime === time) {
    applyPlayerAction(PLAYER_ACTIONS.SOFT_DROP);
    controller.nextSoftDropTime += settings.softDropMs;
  }
}

function advanceTime(time) {
  if (isVsMatchFinished()) return;
  prepareHumanController(humanController, currentPlayerState, time);
  while (canAdvanceSimulation()) {
    const due = Math.min(humanController.nextHorizontalTime, humanController.nextSoftDropTime);
    if (due > time) break;
    const pieceBeforeSimulation = piece;
    advanceSimulation(due, { softDropActive: softDropUsesRepeat(humanController, currentPlayerState) });
    if (gameOver || marathonComplete) break;
    if (piece !== pieceBeforeSimulation) {
      humanController.nextSoftDropTime = softDropUsesRepeat(humanController, currentPlayerState)
        ? due + settings.softDropMs : Infinity;
      humanController.softDropScheduledPiece = humanController.nextSoftDropTime < Infinity ? piece : null;
    } else if (humanController.nextSoftDropTime === due && !softDropUsesRepeat(humanController, currentPlayerState)) {
      humanController.nextSoftDropTime = Infinity;
      humanController.softDropScheduledPiece = null;
    }
    advanceHumanController(humanController, due);
    draw();
  }
  advanceSimulation(time, { softDropActive: softDropUsesRepeat(humanController, currentPlayerState) });
}

function advanceSimulation(time, { softDropActive = false } = {}) {
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
      if (softDropActive) break;
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
  const previousFrameTime = dualFrameTime;
  const sharedSimulationActive = canAdvanceSharedSimulation();
  const humanSimulationActive = canAdvanceSimulation();
  advanceTime(time);
  if (dualBoardTestActive && secondaryPlayerState && sharedSimulationActive && previousFrameTime !== null) {
    const elapsed = Math.max(0, time - previousFrameTime);
    if (!isVsMatchFinished() && ((!vsEngineTestActive && humanSimulationActive)
      || (vsEngineTestActive && !secondaryPlayerState.gameOver))) {
      advancePreviewSimulation(secondaryPlayerState, elapsed);
      if (cpuTestActive) advanceCpuController(cpuController, secondaryPlayerState, elapsed);
    }
    renderPlayer(secondaryPlayerState, secondView);
  }
  if (vsEngineTestActive && sharedSimulationActive && !paused && !settingsOpen && !qaOpen && !focusSuspended && !document.hidden) {
    flushVsSettlementWindow();
  }
  dualFrameTime = time;
  requestAnimationFrame(update);
}

marathonView = createPlayerView({
  boardCanvas: canvas,
  boardContext: context,
  holdCanvas: document.getElementById("hold"),
  nextCanvas: document.getElementById("next"),
  scoreElement,
  linesElement,
  levelElement,
  showMarathonTarget: true,
});
secondView = createPlayerView({
  boardCanvas: secondBoardCanvas,
  boardContext: secondBoardContext,
  holdCanvas: secondHoldCanvas,
  nextCanvas: secondNextCanvas,
  scoreElement: secondScoreElement,
  linesElement: secondLinesElement,
  levelElement: secondLevelElement,
  statusElement: secondStatusElement,
});

updateSettingsUI();
restart();
showStartScreen();
requestAnimationFrame(update);
