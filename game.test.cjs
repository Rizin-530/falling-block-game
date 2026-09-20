// 実行: node game.test.cjs（ゲーム自体の実行にはNode.js不要）
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(`${__dirname}/game.js`, "utf8");

function createGame(storage = {}) {
  const elements = {};
  const listeners = {};
  const drawCalls = [];
  const displayTimers = new Map();
  let displayTime = 0;
  let timerId = 0;
  const context = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        if (sandbox.captureDraw) drawCalls.push({ name, args, color: target.fillStyle, alpha: target.globalAlpha ?? 1 });
      };
    },
  });
  const previewContext = new Proxy({}, { get: () => () => {} });
  function mockElement(id) {
    if (elements[id]) return elements[id];
    const classes = new Set();
    return elements[id] = {
      width: id === "board" ? 300 : 120,
      height: id === "board" ? 600 : id === "next" ? 200 : 80,
      offsetWidth: 0,
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const add = force === undefined ? !classes.has(name) : force;
          if (add) classes.add(name); else classes.delete(name);
          return add;
        },
      },
      focus() { this.focused = true; sandbox.document.activeElement = this; },
      getContext: () => id === "board" ? context : previewContext,
      addEventListener(name, listener) {
        this[name] = (event = { timeStamp: vm.runInContext("lastTime ?? 0", sandbox) }) => listener(event);
      },
    };
  }
  const sandbox = {
    assert,
    drawCalls,
    captureDraw: false,
    window: { addEventListener(name, listener) { listeners[name] = listener; } },
    emit(name) { listeners[name](); },
    document: {
      hidden: false,
      activeElement: null,
      body: mockElement("body"),
      addEventListener(name, listener) { listeners[name] = listener; },
      getElementById: mockElement,
      querySelector: mockElement,
      querySelectorAll(selector) {
        if (selector !== "[data-debug-level]") return [];
        return [1, 5, 10, 13, 15].map(level => {
          const element = mockElement(`debug-level-${level}`);
          element.dataset = { debugLevel: String(level) };
          return element;
        });
      },
    },
    localStorage: {
      getItem(key) { return storage[key] ?? null; },
      setItem(key, value) { storage[key] = value; },
    },
    requestAnimationFrame() {},
    setTimeout(callback, delay) {
      displayTimers.set(++timerId, { callback, time: displayTime + delay });
      return timerId;
    },
    clearTimeout(id) { displayTimers.delete(id); },
    advanceDisplayTime(elapsed) {
      displayTime += elapsed;
      for (const [id, timer] of displayTimers) {
        if (timer.time <= displayTime) {
          displayTimers.delete(id);
          timer.callback();
        }
      }
    },
    performance: { now: () => vm.runInContext("lastTime ?? 0", sandbox) },
    key(code, repeat = false, modifiers = {}) {
      listeners.keydown({ code, repeat, timeStamp: vm.runInContext("lastTime ?? 0", sandbox), preventDefault() {}, ...modifiers });
      // 既存ケースのkey()は単押し。長押しテストはpress/releaseで明示する。
      listeners.keyup({ code, timeStamp: vm.runInContext("lastTime ?? 0", sandbox), ...modifiers });
    },
    press(code, timeStamp, repeat = false, modifiers = {}) { listeners.keydown({ code, timeStamp, repeat, preventDefault() {}, ...modifiers }); },
    release(code, timeStamp) { listeners.keyup({ code, timeStamp }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return code => vm.runInContext(code, sandbox);
}

const storage = {};
const run = createGame(storage);
run(`
  assert.equal(board.length, TOTAL_ROWS);
  assert.ok(board.every(row => row.length === 10));
  assert.ok(SHAPES.every(shape => shape.flat().filter(Boolean).length === 4));
  bag = [];
  assert.equal(new Set(Array.from({ length: 7 }, nextType)).size, 7);
  assert.ok(collides([[1]], -1, 0));
  assert.ok(collides([[1]], 10, 0));
  assert.ok(collides([[1]], 0, TOTAL_ROWS));
  board[HIDDEN_ROWS + 5][5] = 1;
  assert.ok(collides([[1]], 5, HIDDEN_ROWS + 5));

  restart();
  piece = { rotation: 0, shape: [[1, 1], [1, 1]], x: 4, y: HIDDEN_ROWS + 0, color: 2 };
  const initialX = piece.x;
  key("ArrowLeft"); key("ArrowRight");
  assert.equal(piece.x, initialX);
  const originalPiece = JSON.stringify(piece);
  assert.equal(ghostY(), HIDDEN_ROWS + 18);
  assert.equal(JSON.stringify(piece), originalPiece);
  key("Space");
  assert.equal(score, 36);
  assert.equal(board[HIDDEN_ROWS + 19][4], 2);
  assert.equal(board[HIDDEN_ROWS + 18][5], 2);

  restart();
  spawnPiece(0);
  const originalShape = JSON.stringify(piece.shape);
  for (let i = 0; i < 4; i++) key("ArrowUp");
  assert.equal(JSON.stringify(piece.shape), originalShape);
  piece = { rotation: 1, shape: ROTATIONS[0][1], x: 7, y: HIDDEN_ROWS + 0, color: 1 };
  key("ArrowUp");
  assert.equal(piece.rotation, 2);
  assert.equal(piece.x, 6);

  // 1〜4行の同時消去と従来の得点。
  for (let count = 1; count <= 4; count++) {
    restart();
    board[0][0] = 7; // 通常得点テストなのでPerfect Clearにはしない。
    for (let y = TOTAL_ROWS - count; y < TOTAL_ROWS; y++) {
      board[y].fill(2);
      board[y][4] = 0;
    }
    piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: HIDDEN_ROWS + 16, color: 1 };
    lockPiece();
    assert.equal(score, [0, 100, 300, 500, 800][count]);
    assert.equal(totalLines, count);
    assert.equal(board.flat().filter(Boolean).length, 5 - count);
  }

  restart();
  const next = nextQueue[0];
  hardDrop();
  assert.equal(piece.color - 1, next);
  const beforeHold = piece.color - 1;
  const afterHold = nextQueue[0];
  key("KeyC");
  assert.equal(heldType, beforeHold);
  assert.equal(piece.color - 1, afterHold);
  const heldPiece = JSON.stringify(piece);
  const heldNext = nextQueue[0];
  key("KeyC");
  assert.equal(JSON.stringify(piece), heldPiece);
  assert.equal(nextQueue[0], heldNext);
  hardDrop();
  assert.equal(holdUsed, false);
  const beforeSwap = piece.color - 1;
  const nextBeforeSwap = nextQueue[0];
  key("ArrowUp"); key("ArrowDown"); key("KeyC");
  assert.equal(piece.color - 1, beforeHold);
  assert.equal(heldType, beforeSwap);
  assert.equal(piece.y, SPAWN_Y + 0);
  assert.equal(JSON.stringify(piece.shape), JSON.stringify(ROTATIONS[beforeHold][0]));
  assert.equal(nextQueue[0], nextBeforeSwap);

  restart();
  board[HIDDEN_ROWS + 10].fill(1);
  piece = { rotation: 0, shape: [[1, 1], [1, 1]], x: 4, y: HIDDEN_ROWS + 0, color: 2 };
  assert.equal(ghostY(), HIDDEN_ROWS + 8);
  restart();
  key("ArrowDown");
  assert.equal(score, 1);
  assert.equal(piece.y, SPAWN_Y + 1);
  update(0); update(999);
  assert.equal(piece.y, SPAWN_Y + 1);
  update(1000);
  assert.equal(piece.y, SPAWN_Y + 2);

  totalLines = 9;
  board[HIDDEN_ROWS + 19].fill(1); board[HIDDEN_ROWS + 19][4] = 0;
  piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: HIDDEN_ROWS + 16, color: 1 };
  lockPiece();
  assert.equal(level, 2);
  assert.ok(Math.abs(getGravityInterval() - 793) < 1);
  update(1792);
  assert.equal(piece.y, SPAWN_Y + 0);
  update(1793);
  assert.equal(piece.y, SPAWN_Y + 1);
  level = 100;
  assert.equal(getGravityInterval(), getGravityInterval(15));

  restart();
  update(0); update(300);
  key("KeyP");
  const pausedState = JSON.stringify([board, piece, score, heldType, nextQueue[0]]);
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyC"]) key(code);
  update(10000);
  assert.equal(JSON.stringify([board, piece, score, heldType, nextQueue[0]]), pausedState);
  assert.equal(dropElapsed, 300);
  pauseButton.click({ timeStamp: 20000 });
  assert.equal(paused, false);
  update(20000); update(20699);
  assert.equal(piece.y, SPAWN_Y + 0);
  update(20700);
  assert.equal(piece.y, SPAWN_Y + 1);

  board[HIDDEN_ROWS + 0].fill(1, 3, 7); board[HIDDEN_ROWS + 1].fill(1, 3, 7);
  spawnPiece();
  assert.ok(gameOver);
  const overState = JSON.stringify([board, piece, score]);
  key("Space"); key("KeyC"); key("KeyP"); update(30000);
  assert.equal(JSON.stringify([board, piece, score]), overState);
  assert.equal(paused, false);
  key("KeyR");
  assert.equal(gameOver, false);
  assert.equal(score, 0);
  assert.equal(level, 1);
  assert.equal(heldType, null);
  assert.equal(holdUsed, false);
  assert.ok(board.every(row => row.every(cell => cell === 0)));
  assert.equal(pauseButton.disabled, false);

  heldType = 0;
  board[HIDDEN_ROWS + 0].fill(1, 3, 7); board[HIDDEN_ROWS + 1].fill(1, 3, 7);
  key("KeyC");
  assert.ok(gameOver);
  restart();
  for (let i = 0; i < 100 && !gameOver; i++) hardDrop();
  assert.ok(gameOver);
  restart();
  addScore(12345);
  restart();
  assert.equal(highScore, 12345);
`);
assert.equal(storage["falling-block-high-score"], "12345");
createGame(storage)("assert.equal(highScore, 12345)");
for (const value of ["bad", "-1", "Infinity", "1.5"]) {
  createGame({ "falling-block-high-score": value })("assert.equal(highScore, 0)");
}
const blockedStorage = new Proxy({}, {
  get() { throw Error("Storage blocked"); },
  set() { throw Error("Storage blocked"); },
});
createGame(blockedStorage)("addScore(10); restart(); assert.equal(highScore, 10)");
console.log("PASS: existing controls, collisions, rotation, line clears, scores, gravity, game over, restart; NEXT, HOLD, ghost, levels, pause, high-score storage.");

const pureBoardTests = createGame();
pureBoardTests(`
  const emptyBoard = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  const single = [[1]];
  const shapeSnapshot = JSON.stringify(single);

  // Pure collision helper keeps the current wall, floor, block and hidden-row semantics.
  assert.equal(collidesOn(emptyBoard, single, 0, HIDDEN_ROWS - 1), false);
  assert.equal(collidesOn(emptyBoard, single, -1, HIDDEN_ROWS), true);
  assert.equal(collidesOn(emptyBoard, single, COLS, HIDDEN_ROWS), true);
  assert.equal(collidesOn(emptyBoard, single, 0, -1), true);
  assert.equal(collidesOn(emptyBoard, single, 0, TOTAL_ROWS), true);
  emptyBoard[HIDDEN_ROWS + 4][3] = 7;
  const collisionBoardSnapshot = JSON.stringify(emptyBoard);
  assert.equal(collidesOn(emptyBoard, single, 3, HIDDEN_ROWS + 4), true);
  assert.equal(JSON.stringify(emptyBoard), collisionBoardSnapshot);
  assert.equal(JSON.stringify(single), shapeSnapshot);

  // The legacy wrapper has the same result for representative positions.
  board = emptyBoard;
  for (const [shape, x, y] of [
    [single, 0, HIDDEN_ROWS],
    [single, -1, HIDDEN_ROWS],
    [single, 3, HIDDEN_ROWS + 4],
    [[[1, 1], [1, 1]], 4, TOTAL_ROWS - 2],
  ]) assert.equal(collides(shape, x, y), collidesOn(emptyBoard, shape, x, y));

  // landingYOn handles empty, stacked and uneven surfaces without mutation.
  const emptyBoardBeforeLanding = JSON.stringify(emptyBoard);
  const emptyPiece = { shape: [[1, 1], [1, 1]], x: 4, y: HIDDEN_ROWS, rotation: 0, color: 2 };
  const emptyPieceSnapshot = JSON.stringify(emptyPiece);
  assert.equal(landingYOn(emptyBoard, emptyPiece), TOTAL_ROWS - 2);
  assert.equal(JSON.stringify(emptyBoard), emptyBoardBeforeLanding);
  assert.equal(JSON.stringify(emptyPiece), emptyPieceSnapshot);

  const stackedBoard = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  stackedBoard[TOTAL_ROWS - 2][4] = 7;
  const stackedPiece = { shape: [[1]], x: 4, y: HIDDEN_ROWS, rotation: 0, color: 1 };
  assert.equal(landingYOn(stackedBoard, stackedPiece), TOTAL_ROWS - 3);
  stackedBoard[TOTAL_ROWS - 4][5] = 7;
  const unevenPiece = { shape: [[1, 1]], x: 4, y: HIDDEN_ROWS, rotation: 0, color: 1 };
  assert.equal(landingYOn(stackedBoard, unevenPiece), TOTAL_ROWS - 5);

  // A piece near the wall and the global ghost wrapper agree with the pure helper.
  const wallPiece = { shape: [[1, 1]], x: 0, y: HIDDEN_ROWS, rotation: 0, color: 1 };
  assert.equal(landingYOn(stackedBoard, wallPiece), TOTAL_ROWS - 1);
  restart(); piece = { shape: [[1, 1]], x: 0, y: HIDDEN_ROWS, rotation: 0, color: 1 };
  const pieceSnapshot = JSON.stringify(piece);
  assert.equal(ghostY(), landingYOn(board, piece));
  assert.equal(JSON.stringify(piece), pieceSnapshot);
`);
console.log("PASS: Phase 1 pure collision and landing helpers, wrapper parity and mutation safety.");

const playerStateTests = createGame();
playerStateTests(`
  const normal = createPlayerState();
  assert.equal(normal.board.length, TOTAL_ROWS);
  assert.ok(normal.board.every(row => row.length === COLS && row.every(cell => cell === 0)));
  assert.ok(normal.piece);
  assert.equal(normal.nextQueue.length, NEXT_COUNT);
  assert.equal(normal.score, 0);
  assert.equal(normal.totalLines, 0);
  assert.equal(normal.level, 1);
  assert.equal(normal.heldType, null);
  assert.equal(normal.holdUsed, false);
  assert.equal(normal.dropElapsed, 0);
  assert.equal(normal.lockElapsed, 0);
  assert.equal(normal.lockResets, 0);
  assert.equal(normal.lastRotationKick, null);
  assert.equal(normal.lastLockResult, null);
  assert.equal(normal.lastPerfectClear, false);
  assert.equal(normal.backToBackActive, false);
  assert.equal(normal.comboCount, -1);
  assert.deepEqual(normal.runStats, createEmptyRunStats());
  const debug = createPlayerState({ selectedStartLevel: 5 });
  assert.equal(debug.totalLines, 40); assert.equal(debug.level, 5);

  // Every mutable container belongs to its own PlayerState instance.
  const stateA = createPlayerState();
  const stateB = createPlayerState();
  assert.notEqual(stateA.board, stateB.board);
  assert.notEqual(stateA.board[0], stateB.board[0]);
  assert.notEqual(stateA.piece, stateB.piece);
  assert.notEqual(stateA.nextQueue, stateB.nextQueue);
  assert.notEqual(stateA.bag, stateB.bag);
  assert.notEqual(stateA.runStats, stateB.runStats);
  const stateBQueueLength = stateB.nextQueue.length; const stateBBagLength = stateB.bag.length;
  stateA.board[0][0] = 7; stateA.piece.x = 0; stateA.nextQueue.push(3); stateA.bag.push(4);
  stateA.dropElapsed = 123;
  stateA.runStats.tetrises = 1; stateA.lastLockResult = { spin: "NONE", lines: 1 };
  assert.equal(stateB.board[0][0], 0); assert.equal(stateB.nextQueue.length, stateBQueueLength);
  assert.equal(stateB.bag.length, stateBBagLength); assert.equal(stateB.runStats.tetrises, 0);
  assert.notEqual(stateB.piece.x, 0); assert.equal(stateB.dropElapsed, 0);
  assert.equal(stateB.lastLockResult, null);

  // State-aware spawn and queue progression do not touch another state.
  const spawnA = createPlayerState(); const spawnB = createPlayerState();
  spawnPieceFor(spawnA, 0); spawnPieceFor(spawnB, 2);
  spawnA.nextQueue = [1, 2, 3, 4, 5];
  const spawnBQueue = JSON.stringify(spawnB.nextQueue);
  const spawnBPiece = JSON.stringify(spawnB.piece);
  advancePieceFor(spawnA);
  assert.equal(JSON.stringify(spawnB.nextQueue), spawnBQueue);
  assert.equal(JSON.stringify(spawnB.piece), spawnBPiece);
  assert.equal(spawnA.piece.color, 2);

  // Movement and rotation update only the selected state, including lock metadata.
  const moveA = createPlayerState(); const moveB = createPlayerState();
  spawnPieceFor(moveA, 0); spawnPieceFor(moveB, 0);
  moveA.piece.y = TOTAL_ROWS - 2; moveB.piece.y = TOTAL_ROWS - 2;
  moveA.lockElapsed = 100; moveA.lockResets = 0; moveB.lockElapsed = 200;
  const moveBSnapshot = JSON.stringify(moveB);
  assert.equal(movePlayer(moveA, -1, 0), true);
  assert.equal(moveA.lockElapsed, 0); assert.equal(moveA.lockResets, 1);
  assert.equal(JSON.stringify(moveB), moveBSnapshot);

  const rotateA = createPlayerState(); const rotateB = createPlayerState();
  spawnPieceFor(rotateA, 2); spawnPieceFor(rotateB, 2);
  const rotateBSnapshot = JSON.stringify(rotateB);
  rotatePlayer(rotateA, 1);
  assert.equal(rotateA.piece.rotation, 1);
  assert.equal(JSON.stringify(rotateB), rotateBSnapshot);

  // HOLD uses only the selected state's piece, hold slot and queue.
  const holdA = createPlayerState(); const holdB = createPlayerState();
  spawnPieceFor(holdA, 2); spawnPieceFor(holdB, 5);
  holdA.nextQueue = [0, 1, 2, 3, 4]; holdA.bag = [];
  const holdBStateSnapshot = JSON.stringify(holdB);
  holdPlayer(holdA);
  assert.equal(holdA.heldType, 2); assert.equal(holdA.holdUsed, true);
  assert.equal(JSON.stringify(holdB), holdBStateSnapshot);

  // Legacy names still point at the one current PlayerState rather than a shadow copy.
  restart();
  const currentState = currentPlayerState;
  board[0][0] = 6; score = 12;
  assert.equal(currentState.board[0][0], 6); assert.equal(currentState.score, 12);
  assert.equal(board, currentState.board); assert.equal(piece, currentState.piece);
`);
console.log("PASS: Phase 2 PlayerState factory, independent instances, state-aware operations and legacy parity.");

const lockResultTests = createGame();
lockResultTests(`
  function emptyState() {
    const state = createPlayerState({ initialize: false });
    state.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    state.piece = { shape: [[1]], rotation: 0, x: 4, y: TOTAL_ROWS - 1, color: 1 };
    return state;
  }
  function clearState(lines, startLevel = 1, startLines = (startLevel - 1) * 10) {
    const state = createPlayerState({ initialize: false });
    state.level = startLevel; state.totalLines = startLines;
    state.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    state.board[0][0] = 7;
    for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) {
      state.board[y].fill(7); state.board[y][4] = 0;
    }
    state.piece = { shape: [[1], [1], [1], [1]], rotation: 1, x: 4, y: TOTAL_ROWS - 4, color: 1 };
    return state;
  }

  // Core lock resolution accepts a specific PlayerState and has no Marathon/UI side effects.
  const stateA = emptyState(); const stateB = emptyState();
  stateB.board[0][0] = 7; stateB.score = 42; stateB.totalLines = 8; stateB.level = 1;
  stateB.backToBackActive = true; stateB.comboCount = 3; stateB.runStats.tetrises = 2;
  const stateBSnapshot = JSON.stringify(stateB);
  const scoreTextBefore = scoreElement.textContent;
  const highScoreBefore = highScore;
  const result = resolveLockFor(stateA);
  assert.equal(result.lines, 0); assert.equal(result.spin, "NONE");
  assert.equal(result.scoreDelta, 0); assert.equal(result.comboBefore, -1); assert.equal(result.comboAfter, -1);
  assert.equal(result.totalLinesBefore, 0); assert.equal(result.totalLinesAfter, 0);
  assert.equal(result.lockOut, false); assert.equal(result.terminal, false);
  assert.equal(stateA.board[TOTAL_ROWS - 1][4], 1); assert.equal(stateA.score, 0);
  assert.equal(JSON.stringify(stateB), stateBSnapshot);
  assert.equal(scoreElement.textContent, scoreTextBefore); assert.equal(highScore, highScoreBefore);
  assert.equal(localStorage.getItem(HIGH_SCORE_KEY), null);

  // Single/Double/Triple/Tetris keep their existing score, B2B and level semantics.
  for (const [lines, points, difficult] of [[1, 100, false], [2, 300, false], [3, 500, false], [4, 800, true]]) {
    const state = clearState(lines);
    const locked = resolveLockFor(state);
    assert.equal(locked.lines, lines); assert.equal(locked.scoreDelta, points);
    assert.equal(locked.difficult, difficult); assert.equal(state.score, points);
    assert.equal(state.totalLines, lines); assert.equal(state.level, 1);
  }
  const boundary = clearState(1, 1, 9); const boundaryResult = resolveLockFor(boundary);
  assert.equal(boundaryResult.levelBefore, 1); assert.equal(boundaryResult.levelAfter, 2);
  assert.equal(boundaryResult.scoreDelta, 100); assert.equal(boundary.totalLines, 10);

  // T-Spin and Mini classification is taken from the existing state-aware corner rule.
  function spinState(frontCorners) {
    const state = emptyState();
    state.piece = { shape: ROTATIONS[2][0], rotation: 0, x: 4, y: HIDDEN_ROWS + 5, color: 3 };
    state.lastRotationKick = 0;
    for (const [index, [dx, dy]] of [[0,[-1,-1]], [1,[1,-1]], [2,[1,1]], [3,[-1,1]]]) {
      if (frontCorners.includes(index)) state.board[state.piece.y + 1 + dy][state.piece.x + 1 + dx] = 7;
    }
    return state;
  }
  assert.equal(resolveLockFor(spinState([0, 1, 2])).spin, "T_SPIN");
  assert.equal(resolveLockFor(spinState([1, 2, 3])).spin, "T_SPIN_MINI");

  // Perfect Clear is reported in the result while its existing score/stat update is preserved.
  const perfect = createPlayerState({ initialize: false });
  perfect.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  perfect.board[TOTAL_ROWS - 1].fill(7); perfect.board[TOTAL_ROWS - 1].fill(0, 3, 7);
  perfect.piece = { shape: [[1, 1, 1, 1]], rotation: 0, x: 3, y: TOTAL_ROWS - 1, color: 1 };
  const perfectResult = resolveLockFor(perfect);
  assert.equal(perfectResult.lines, 1); assert.equal(perfectResult.perfectClear, true);
  assert.equal(perfectResult.scoreDelta, 900); assert.equal(perfect.runStats.perfectClears, 1);

  // Marathon completion is decided after core scoring, and an overrun is retained.
  const finalClear = clearState(1, 15, 149); const finalResult = resolveLockFor(finalClear);
  const finalPolicy = applyMarathonPolicy(finalClear, finalResult);
  assert.equal(finalResult.totalLinesAfter, 150); assert.equal(finalPolicy.marathonComplete, true);
  assert.equal(finalPolicy.shouldSpawn, false); assert.equal(finalPolicy.highScoreEligible, true);
  const overrun = clearState(2, 15, 149); const overrunResult = resolveLockFor(overrun);
  assert.equal(overrunResult.totalLinesAfter, 151);
  assert.equal(applyMarathonPolicy(overrun, overrunResult).marathonComplete, true);
`);
console.log("PASS: Phase 3 PlayerState lock results, scoring parity, spin/Perfect Clear metadata, Marathon policy boundary and side-effect isolation.");

const review = createGame();
review(`
  // ブラウザのショートカットで盤面を変更しない。
  key("ArrowDown");
  const beforeShortcut = JSON.stringify([board, piece, score]);
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    key("KeyR", false, { [modifier]: true });
    key("Space", false, { [modifier]: true });
    key("KeyC", false, { [modifier]: true });
  }
  assert.equal(JSON.stringify([board, piece, score]), beforeShortcut);

  // フレーム境界の余りを蓄積し、落下速度を維持する。
  restart();
  level = 11;
  update(0);
  for (let time = 16; time <= 400; time += 16) update(time);
  assert.equal(piece.y, SPAWN_Y + Math.floor(400 / getGravityInterval(11)));
  assert.ok(Math.abs(dropElapsed - (400 % getGravityInterval(11))) < 0.001);
  restart();
  update(0); update(1450);
  assert.equal(piece.y, SPAWN_Y + 1);
  assert.equal(dropElapsed, 450);
`);
console.log("PASS: shortcut isolation and elapsed-time accuracy.");

review(`
  for (let type = 0; type < 7; type++) {
    restart();
    spawnPiece(type);
    const shapeBefore = JSON.stringify(piece.shape);
    for (let turn = 0; turn < 4; turn++) {
      rotate();
      assert.equal(piece.shape.flat().filter(Boolean).length, 4);
      assert.ok(!collides(piece.shape, piece.x, piece.y));
    }
    assert.equal(JSON.stringify(piece.shape), shapeBefore);
  }

  // シード固定の操作列で長時間相当の状態遷移を確認する。
  let seed = 123456;
  function randomInt(max) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * max);
  }
  Math.random = () => randomInt(65536) / 65536;
  restart();
  let time = 0;
  let drops = 0;
  for (let i = 0; i < 20000; i++) {
    if (gameOver || i % 113 === 0) restart();
    const action = randomInt(8);
    if (action === 0 && !paused) {
      const y = ghostY();
      assert.ok(!collides(piece.shape, piece.x, y));
      assert.ok(collides(piece.shape, piece.x, y + 1));
      const distance = y - piece.y;
      const previousScore = score;
      const previousLines = totalLines;
      const previousLevel = level;
      key("Space");
      assert.equal(score - previousScore,
        distance * 2 + [0, 100, 300, 500, 800][totalLines - previousLines] * previousLevel);
      drops++;
    } else {
      key(["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyC", "KeyP", "KeyP"][action]);
    }
    time += randomInt(250);
    update(time);
    assert.equal(board.length, TOTAL_ROWS);
    assert.equal(new Set(board).size, TOTAL_ROWS);
    assert.ok(board.every(row => row.length === 10 && row.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= 7)));
    if (!gameOver) assert.ok(!collides(piece.shape, piece.x, piece.y));
    assert.ok(Number.isSafeInteger(score));
    assert.equal(level, Math.floor(totalLines / 10) + 1);
    assert.ok(bag.length <= 7);
  }
  assert.ok(drops > 1000);
  restart();
  update(0); update(300);
  document.hidden = true;
  update(10000);
  assert.equal(dropElapsed, 300);
  document.hidden = false;
  lastTime = null; // visibilitychangeハンドラーと同じリセット
  update(20000);
  assert.equal(dropElapsed, 300);

  // 長いフレームの余りを、着地直後のLock Delayへ持ち越さない。
  restart();
  update(0); update(100000);
  assert.ok(isGrounded());
  assert.equal(dropElapsed, 0);
  assert.equal(lockElapsed, 0);
  assert.equal(board.flat().filter(Boolean).length, 0);
  update(100499); assert.equal(board.flat().filter(Boolean).length, 0);
  update(100500); assert.equal(board.flat().filter(Boolean).length, 4);
`);
console.log("PASS: all-piece rotation, 20,000 operations, ghost/drop agreement, board invariants and timer boundaries.");

const lockTests = createGame();
lockTests(`
  function floorPiece() {
    restart();
    spawnPiece(1);
    piece.y = HIDDEN_ROWS + 18;
    update(0);
  }
  function occupied() { return board.flat().filter(Boolean).length; }

  floorPiece();
  key("ArrowDown");
  assert.equal(occupied(), 0);
  assert.equal(score, 0);
  update(499);
  assert.equal(occupied(), 0);
  update(500);
  assert.equal(occupied(), 4);
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);

  // 自動落下で着地した時点から500msを測る。
  floorPiece();
  piece.y = HIDDEN_ROWS + 17;
  update(1000);
  assert.equal(piece.y, HIDDEN_ROWS + 18);
  assert.equal(lockElapsed, 0);
  update(1499);
  assert.equal(occupied(), 0);
  update(1500);
  assert.equal(occupied(), 4);

  floorPiece();
  update(400);
  key("ArrowLeft");
  assert.equal(piece.x, 3);
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 1);
  update(800);
  key("ArrowUp");
  assert.equal(lockResets, 2);
  update(1299);
  assert.equal(occupied(), 0);
  update(1300);
  assert.equal(occupied(), 4);

  // 失敗した操作とソフトドロップでは待ち時間を延長しない。
  floorPiece();
  piece = { rotation: 0, shape: ROTATIONS[0][0], x: 0, y: HIDDEN_ROWS + 18, color: 1 };
  update(400);
  key("ArrowLeft"); key("ArrowDown");
  assert.equal(lockElapsed, 400);
  assert.equal(lockResets, 0);
  update(500);
  assert.equal(occupied(), 4);

  floorPiece();
  for (let i = 1; i <= 15; i++) {
    update(i * 100);
    key(i % 2 ? "ArrowLeft" : "ArrowRight");
  }
  assert.equal(lockResets, 15);
  update(1900);
  key("ArrowRight"); key("ArrowUp");
  assert.equal(lockElapsed, 400);
  assert.equal(lockResets, 15);
  update(2000);
  assert.equal(occupied(), 4);

  // 上限に達した後で足場から外れても、残り時間と回数を保持。
  restart();
  spawnPiece(1);
  piece.y = HIDDEN_ROWS + 8;
  board[HIDDEN_ROWS + 10][4] = 3;
  lockResets = 15;
  update(0); update(400);
  key("ArrowRight");
  assert.equal(isGrounded(), false);
  update(1400);
  assert.equal(piece.y, HIDDEN_ROWS + 9);
  assert.equal(lockElapsed, 400);
  update(10400);
  assert.equal(piece.y, HIDDEN_ROWS + 18);
  assert.equal(lockResets, 15);
  update(10499);
  assert.equal(occupied(), 1);
  update(10500);
  assert.equal(occupied(), 5);

  // 回転によって足場を離れた場合も落下を再開。
  restart();
  spawnPiece(0);
  piece.shape = ROTATIONS[0][1];
  piece.rotation = 1;
  piece.y = HIDDEN_ROWS + 6;
  board[HIDDEN_ROWS + 10][piece.x + 2] = 3;
  update(0); update(400);
  key("ArrowUp");
  assert.equal(isGrounded(), false);
  assert.equal(lockResets, 1);
  assert.equal(lockElapsed, 0);
  update(1400);
  assert.equal(piece.y, HIDDEN_ROWS + 7);

  floorPiece();
  update(400);
  key("KeyP");
  update(10000);
  assert.equal(lockElapsed, 400);
  key("KeyP", false, { timeStamp: 20000 });
  update(20000); update(20099);
  assert.equal(occupied(), 0);
  update(20100);
  assert.equal(occupied(), 4);

  floorPiece();
  update(400);
  document.hidden = true;
  update(10000);
  assert.equal(lockElapsed, 400);
  document.hidden = false;
  lastTime = null;
  update(20000); update(20100);
  assert.equal(occupied(), 4);

  floorPiece();
  update(400); key("ArrowLeft"); update(600);
  key("KeyC");
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);
  assert.equal(occupied(), 0);
  key("Space");
  assert.equal(occupied(), 4);
  key("KeyC");
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);

  floorPiece();
  update(400); key("ArrowLeft"); update(600);
  key("KeyR");
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);
  assert.equal(dropElapsed, 0);
  assert.equal(lastTime, null);

  floorPiece();
  key("Space");
  assert.equal(occupied(), 4);
  assert.equal(score, 0);

  // 固定待ち後のライン消去・得点・次のブロック出現。
  floorPiece();
  board[HIDDEN_ROWS + 19].fill(3);
  board[HIDDEN_ROWS + 19][4] = board[HIDDEN_ROWS + 19][5] = 0;
  update(499);
  assert.equal(totalLines, 0);
  update(500);
  assert.equal(totalLines, 1);
  assert.equal(score, 100);
  assert.equal(occupied(), 2);

  floorPiece();
  board[HIDDEN_ROWS + 0].fill(3, 3, 7); board[HIDDEN_ROWS + 1].fill(3, 3, 7);
  update(500);
  assert.equal(gameOver, true);
`);
console.log("PASS: lock delay boundaries, reset limit, airborne transitions, pause, HOLD, restart, hard drop, line clear and game over.");

const rotationTests = createGame();
rotationTests(`
  function cells(shape, x = 0, y = 0) {
    const result = [];
    shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) result.push([x + dx, y + dy]);
    }));
    return result;
  }
  const originalStates = JSON.stringify(ROTATIONS);
  const expectedI = [
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ];
  for (let type = 0; type < 7; type++) {
    restart(); spawnPiece(type); piece.y = HIDDEN_ROWS + 5;
    const start = JSON.stringify(piece);
    const origin = [piece.x, piece.y];
    for (let state = 0; state < 4; state++) {
      assert.equal(piece.rotation, state);
      assert.deepEqual([piece.x, piece.y], origin);
      const before = cells(piece.shape);
      if (type === 0) assert.deepEqual(before, expectedI[state]);
      if (type === 1) assert.deepEqual(before, [[0,0],[1,0],[0,1],[1,1]]);
      const size = piece.shape.length;
      rotate();
      // 固定中心の90度回転: (x,y) → (size-1-y,x)。
      const expected = before.map(([x,y]) => [size - 1 - y, x]);
      assert.equal(JSON.stringify(cells(piece.shape).sort()), JSON.stringify(expected.sort()));
    }
    assert.equal(JSON.stringify(piece), start);

    for (let state = 0; state < 4; state++) {
      restart(); spawnPiece(type); piece.y = HIDDEN_ROWS + 5;
      for (let i = 0; i < state; i++) rotate();
      const current = cells(piece.shape, piece.x, piece.y);
      const target = cells(ROTATIONS[type][(state + 1) % 4], piece.x, piece.y);
      const obstacle = target.find(([x,y]) => !current.some(([cx,cy]) => cx === x && cy === y));
      if (obstacle) {
        board[obstacle[1]][obstacle[0]] = 7;
        lockElapsed = 200;
        key("ArrowUp");
        assert.ok(!collides(piece.shape, piece.x, piece.y));
        assert.equal(board[obstacle[1]][obstacle[0]], 7);
      }

      // 全種類・全方向でゴースト位置と固定マス・ドロップ得点が一致。
      restart(); spawnPiece(type); piece.y = HIDDEN_ROWS + 5;
      for (let i = 0; i < state; i++) rotate();
      const landing = ghostY();
      const fixed = cells(piece.shape, piece.x, landing);
      const expectedScore = (landing - piece.y) * 2;
      key("Space");
      assert.equal(score, expectedScore);
      assert.equal(board.flat().filter(Boolean).length, 4);
      fixed.forEach(([x,y]) => assert.equal(board[y][x], type + 1));
    }
  }
  // I型は左壁から右へ2マス補正。空白部分ではなく実ブロックで判定。
  restart(); spawnPiece(0); rotate(); piece.x = -2;
  assert.equal(collides(piece.shape, piece.x, piece.y), false);
  rotate();
  assert.equal(piece.rotation, 2);
  assert.equal(piece.x, 0);
  assert.ok(!collides(piece.shape, piece.x, piece.y));

  // HOLDで向きを初期化し、NEXTを余分に消費しない。
  restart(); spawnPiece(2); piece.y = HIDDEN_ROWS + 5; rotate(); hold();
  hardDrop();
  const nextBefore = nextQueue[0];
  hold();
  assert.equal(piece.color, 3);
  assert.equal(piece.rotation, 0);
  assert.deepEqual(piece.shape, ROTATIONS[2][0]);
  assert.equal(nextQueue[0], nextBefore);
  assert.equal(JSON.stringify(ROTATIONS), originalStates);
`);
console.log("PASS: fixed rotation centers, four states, O stability, I coordinates, collision rejection, all-orientation ghost/drop and HOLD reset.");

const kickTests = createGame();
kickTests(`
  function setup(type, state, x, y) {
    restart(); spawnPiece(type);
    piece.rotation = state;
    piece.shape = ROTATIONS[type][state];
    piece.x = x; piece.y = HIDDEN_ROWS + y;
    assert.ok(!collides(piece.shape, x, HIDDEN_ROWS + y));
  }
  function checkDrop() {
    const landing = ghostY();
    assert.ok(!collides(piece.shape, piece.x, landing));
    assert.ok(collides(piece.shape, piece.x, landing + 1));
    const expected = [];
    piece.shape.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) expected.push([piece.x + x, landing + y, piece.color]);
    }));
    const points = (landing - piece.y) * 2;
    key("Space");
    assert.equal(score, points);
    expected.forEach(([x,y,color]) => assert.equal(board[y][x], color));
    assert.equal(piece.rotation, 0);
  }
  // 位置・向き・補正先を明示したケース。
  const cases = [
    [2, 1, -1, 5, 0, 5],   // T: 左壁、90→180
    [2, 3, 8, 5, 7, 5],    // T: 右壁、270→0
    [2, 0, 3, 18, 2, 17],  // T: 床、0→90（左上へ）
    [0, 1, -2, 5, 0, 5],  // I: 左壁、2マス補正
    [0, 1, 7, 5, 6, 5],   // I: 右壁
    [0, 0, 3, 18, 4, 16], // I: 床、最後の候補で成功
    [0, 2, 3, 17, 5, 16], // I: 180→270
    [0, 3, -1, 5, 0, 5],  // I: 270→0
  ];
  for (const [type, state, x, y, expectedX, expectedY] of cases) {
    setup(type, state, x, y);
    assert.ok(collides(ROTATIONS[type][(state + 1) % 4], x, HIDDEN_ROWS + y));
    const grounded = isGrounded();
    lockElapsed = 200;
    key("ArrowUp");
    assert.deepEqual([piece.x, piece.y, piece.rotation], [expectedX, HIDDEN_ROWS + expectedY, (state + 1) % 4]);
    assert.ok(!collides(piece.shape, piece.x, piece.y));
    assert.equal(lockResets, grounded ? 1 : 0);
    assert.equal(lockElapsed, grounded ? 0 : 200);
    checkDrop();
  }
  // 共通グループの全種類で左壁Kickが使われる。
  for (const type of [2,3,4,5,6]) {
    setup(type, 1, -1, 5);
    key("ArrowUp");
    assert.equal(piece.x, 0);
    assert.equal(piece.rotation, 2);
    assert.ok(!collides(piece.shape, piece.x, piece.y));
  }
  // その場が空いていれば位置補正を行わない。
  for (let type = 0; type < 7; type++) {
    for (let state = 0; state < 4; state++) {
      setup(type, state, 3, 5);
      key("ArrowUp");
      assert.deepEqual([piece.x, piece.y, piece.rotation], [3, HIDDEN_ROWS + 5, (state + 1) % 4]);
    }
  }
  // 固定ブロックを避け、先に成功する候補を採用。
  setup(2, 0, 3, 5);
  board[HIDDEN_ROWS + 7][4] = 7;
  key("ArrowUp");
  assert.deepEqual([piece.x, piece.y, piece.rotation], [2,HIDDEN_ROWS + 5,1]);
  assert.equal(board[HIDDEN_ROWS + 7][4], 7);
  checkDrop();

  // 全候補が塞がっているときは位置・形・回転状態・固定待ちを維持。
  for (const type of [0,2,3,4,5,6]) {
    for (let state = 0; state < 4; state++) {
      setup(type, state, 3, 5);
      board.forEach(row => row.fill(7));
      piece.shape.forEach((row, y) => row.forEach((cell, x) => {
        if (cell) board[piece.y + y][piece.x + x] = 0;
      }));
      lockElapsed = 300; lockResets = 4;
      const before = JSON.stringify([piece, board, lockElapsed, lockResets]);
      key("ArrowUp");
      assert.equal(JSON.stringify([piece, board, lockElapsed, lockResets]), before);
    }
  }
  // O型は壁・床・障害物が近くても位置補正しない。
  setup(1, 0, 0, 18);
  board[HIDDEN_ROWS + 18][2] = 7;
  for (let i = 0; i < 4; i++) {
    key("ArrowUp");
    assert.deepEqual([piece.x, piece.y], [0,HIDDEN_ROWS + 18]);
    assert.deepEqual(piece.shape, [[1,1],[1,1]]);
  }
  // Kickでもロックディレイの延長上限を超えない。
  setup(2, 0, 3, 18);
  lockElapsed = 400; lockResets = MAX_LOCK_RESETS;
  key("ArrowUp");
  assert.equal(lockElapsed, 400);
  assert.equal(lockResets, MAX_LOCK_RESETS);

  setup(2, 1, -1, 5); key("ArrowUp"); key("KeyC");
  assert.equal(piece.rotation, 0);
  key("Space"); key("KeyC");
  assert.equal(piece.color, 3);
  assert.equal(piece.rotation, 0);
  assert.deepEqual([piece.x, piece.y], [3,SPAWN_Y]);
  key("ArrowUp"); key("KeyR");
  assert.equal(piece.rotation, 0);
  assert.equal(lockResets, 0);
`);
console.log("PASS: SRS kicks at both walls, floor, obstacles, all transitions, O stability, blocked rotation, ghost/drop, HOLD/restart and lock reset limit.");

const timingTests = createGame();
timingTests(`
  function timedKey(code, timeStamp) { key(code, false, { timeStamp }); }
  function nearFloor() {
    restart(); spawnPiece(1); piece.y = HIDDEN_ROWS + 17; update(0);
  }
  function occupied() { return board.flat().filter(Boolean).length; }
  nearFloor();
  timedKey("ArrowDown", 490);
  update(500);
  assert.equal(occupied(), 0);
  assert.equal(lockElapsed, 10);
  update(989);
  assert.equal(occupied(), 0);
  assert.equal(lockElapsed, 499);
  update(990);
  assert.equal(occupied(), 4);

  for (const code of ["ArrowLeft", "ArrowUp"]) {
    nearFloor(); timedKey("ArrowDown", 490);
    timedKey(code, 495);
    assert.equal(lockResets, 1);
    update(500);
    assert.equal(lockElapsed, 5);
    update(994); assert.equal(occupied(), 0);
    update(995); assert.equal(occupied(), 4);
  }
  // 壁に当たる失敗操作は待ち時間を延ばさない。
  nearFloor(); piece.x = 0; timedKey("ArrowDown", 490);
  timedKey("ArrowLeft", 495); update(500);
  assert.equal(lockElapsed, 10);
  assert.equal(lockResets, 0);

  // 床際TのKick成功でも、入力以前の時間をリセット後に加算しない。
  restart(); spawnPiece(2); piece.y = HIDDEN_ROWS + 18; update(0);
  timedKey("ArrowUp", 490); update(500);
  assert.deepEqual([piece.x, piece.y, piece.rotation], [2,HIDDEN_ROWS + 17,1]);
  assert.equal(lockElapsed, 10);
  assert.equal(lockResets, 1);
  update(989); assert.equal(occupied(), 0);
  update(990); assert.equal(occupied(), 4);

  // フレームの間で停止・再開しても、停止前後だけを計上。
  nearFloor(); timedKey("ArrowDown", 490);
  timedKey("KeyP", 495);
  assert.equal(lockElapsed, 5);
  update(10000); assert.equal(lockElapsed, 5);
  timedKey("KeyP", 20000);
  update(20010); assert.equal(lockElapsed, 15);
  update(20494); assert.equal(occupied(), 0);
  update(20495); assert.equal(occupied(), 4);

  nearFloor(); timedKey("ArrowDown", 490);
  pauseButton.click({ timeStamp: 495 });
  pauseButton.click({ timeStamp: 20000 });
  update(20010); assert.equal(lockElapsed, 15);

  nearFloor(); timedKey("Space", 490);
  assert.equal(occupied(), 4);
  assert.equal(lockElapsed, 0);
  update(500); assert.equal(dropElapsed, 10);

  nearFloor(); timedKey("ArrowDown", 490); timedKey("KeyC", 495);
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);
  update(500); assert.equal(dropElapsed, 5);
  timedKey("KeyR", 505);
  assert.equal(lastTime, null);
  assert.equal(dropElapsed, 0);
  assert.equal(lockElapsed, 0);
  assert.equal(lockResets, 0);

  // 高レベルでは入力前の自動落下を先に処理する。
  restart(); spawnPiece(1); level = 11; update(0);
  const highGravity = getGravityInterval(11);
  timedKey("ArrowLeft", 490);
  assert.equal(piece.y, SPAWN_Y + Math.floor(490 / highGravity));
  assert.ok(Math.abs(dropElapsed - (490 % highGravity)) < 0.001);
  update(500); assert.equal(piece.y, SPAWN_Y + Math.floor(500 / highGravity));
  assert.ok(Math.abs(dropElapsed - (500 % highGravity)) < 0.001);

  nearFloor(); level = 11;
  timedKey("ArrowDown", 90); update(100);
  assert.equal(lockElapsed, 10);
  update(589); assert.equal(occupied(), 0);
  update(590); assert.equal(occupied(), 4);

  // 遅いフレームの間に自然着地した場合の固定時間も保つ。
  nearFloor(); level = 11;
  timedKey("ArrowLeft", 590);
  assert.equal(lockResets, 1);
  update(600); assert.equal(lockElapsed, 10);
  // 入力時刻より古い描画時刻でも二重に経過時間を計上しない。
  update(595); assert.equal(lastTime, 600);
  update(610); assert.equal(lockElapsed, 20);
`);
console.log("PASS: timestamped input, 490ms landing, lock boundaries, resets, kicks, pause/buttons, HOLD, hard drop, restart and high-level gravity.");

const heldInputTests = createGame();
heldInputTests(`
  function fresh() { restart(); spawnPiece(1); update(0); }
  function cleared() {
    assert.ok(Object.values(heldKeys).every(value => !value));
    assert.equal(activeDirection, null);
    assert.equal(nextHorizontalTime, Infinity);
    assert.equal(nextSoftDropTime, Infinity);
  }
  fresh(); press("ArrowLeft",0); assert.equal(piece.x,3);
  update(169); assert.equal(piece.x,3);
  update(170); assert.equal(piece.x,2);
  update(219); assert.equal(piece.x,2);
  update(220); assert.equal(piece.x,1);
  release("ArrowLeft",221); update(400); assert.equal(piece.x,1);
  cleared();
  fresh(); press("ArrowRight",0); assert.equal(piece.x,5);
  for(let t=10;t<=220;t+=10) { press("ArrowRight",t,true); press("ArrowRight",t); update(t); }
  assert.equal(piece.x,7);
  update(270); update(320); assert.equal(piece.x,8);
  release("ArrowRight",320);
  fresh(); board[HIDDEN_ROWS + 0][6]=7; press("ArrowRight",0); update(170); update(220);
  assert.equal(piece.x,4);

  for (const first of ["ArrowLeft","ArrowRight"]) {
    fresh();
    const other=first==="ArrowLeft"?"ArrowRight":"ArrowLeft";
    const direction=other==="ArrowRight"?1:-1;
    press(first,0); press(other,10); assert.equal(piece.x,4);
    update(179); assert.equal(piece.x,4);
    update(180); assert.equal(piece.x,4+direction);
    release(other,181); update(350); assert.equal(piece.x,4+direction);
    update(351); assert.equal(piece.x,4);
    release(first,352); update(500); assert.equal(piece.x,4); cleared();
  }
  fresh(); press("ArrowDown",0); assert.equal(piece.y, SPAWN_Y + 1); assert.equal(score,1);
  update(39); assert.equal(piece.y, SPAWN_Y + 1);
  update(40); assert.equal(piece.y, SPAWN_Y + 2);
  update(80); assert.equal(piece.y, SPAWN_Y + 3); assert.equal(score,3);
  release("ArrowDown",81);
  update(1080); assert.equal(piece.y, SPAWN_Y + 3);
  update(1081); assert.equal(piece.y, SPAWN_Y + 4); assert.equal(score,3);
  fresh(); level=11; press("ArrowDown",0);
  for(let t=10;t<=200;t+=10) { press("ArrowDown",t,true); update(t); }
  assert.equal(piece.y, SPAWN_Y + 6); assert.equal(score,6);
  fresh(); piece.y = HIDDEN_ROWS + 17; press("ArrowDown",490); update(500);
  assert.equal(lockElapsed,10);
  for(let t=540;t<=980;t+=40) update(t);
  assert.equal(board.flat().filter(Boolean).length,0);
  update(990); assert.equal(board.flat().filter(Boolean).length,4);
  assert.equal(score,1);

  fresh(); piece.y = HIDDEN_ROWS + 18; press("ArrowLeft",0); update(170);
  assert.equal(lockResets,2); assert.equal(lockElapsed,0);
  update(220); update(270); update(320);
  assert.equal(piece.x,0); assert.equal(lockResets,4);
  assert.equal(lockElapsed,50); // 壁に当たる繰り返しではリセットしない。

  fresh(); press("ArrowRight",0); update(1000);
  assert.equal(piece.x,6); // 長い停止の繰り返しは復帰時の1回にまとめる。
  update(1050); assert.equal(piece.x,7);

  fresh(); press("ArrowLeft",0); press("ArrowDown",1);
  key("KeyP",false,{timeStamp:10}); cleared();
  update(1000); key("KeyP",false,{timeStamp:1000}); cleared();
  const x=piece.x; update(1200); assert.equal(piece.x,x);
  press("ArrowLeft",1210,true); cleared();
  fresh(); press("ArrowLeft",0); key("KeyR"); cleared();
  fresh(); press("ArrowLeft",0); board[HIDDEN_ROWS + 0].fill(7,3,7); board[HIDDEN_ROWS + 1].fill(7,3,7);
  spawnPiece(1); assert.ok(gameOver); cleared();
  fresh(); press("ArrowLeft",0); press("ArrowDown",1); emit("blur"); cleared();
  update(1000); press("ArrowLeft",1001,true); cleared();
  fresh(); press("ArrowRight",0); document.hidden=true; emit("visibilitychange"); cleared();
  document.hidden=false; emit("visibilitychange"); update(1000); cleared();

  // 回転・HOLD・Hard DropはOSの繰り返しでは再発動しない。
  fresh(); press("ArrowUp",0); const rotation=piece.rotation;
  press("ArrowUp",10,true); assert.equal(piece.rotation,rotation);
  press("KeyC",20); const held=heldType; const color=piece.color;
  press("KeyC",30,true); assert.equal(heldType,held); assert.equal(piece.color,color);
  press("Space",40); const snapshot=JSON.stringify(board);
  press("Space",50,true); assert.equal(JSON.stringify(board),snapshot);
`);
console.log("PASS: DAS/ARR, repeat independence, release, both directions, soft drop, lock timing, lifecycle resets and delayed frames.");

const slowFrameTests = createGame();
slowFrameTests(`
  function fresh() { restart(); spawnPiece(1); update(0); }
  function occupied() { return board.flat().filter(Boolean).length; }
  // 約60fpsでもDAS/ARRとソフトドロップの時刻は従来どおり。
  fresh(); press("ArrowRight",0); press("ArrowDown",0);
  for (let t=16;t<=240;t+=16) {
    update(t);
    assert.equal(piece.x, 5 + (t<170 ? 0 : 1+Math.floor((t-170)/50)));
    assert.equal(piece.y, SPAWN_Y+1+Math.floor(t/40));
    assert.equal(score,piece.y-SPAWN_Y);
  }
  // 250msまでは通常の取り戻し、超過時は各入力1回に限定。
  for (const gap of [249,250,251]) {
    fresh(); press("ArrowRight",0); press("ArrowDown",0); update(gap);
    assert.equal(piece.x,gap<=250 ? 7 : 6);
    assert.equal(piece.y,SPAWN_Y+(gap<=250 ? 7 : 2));
    assert.equal(score,piece.y-SPAWN_Y);
    const x=piece.x, y=piece.y;
    update(gap+50);
    assert.ok(piece.x>x);
    assert.ok(piece.y>y);
  }
  fresh(); level=11; press("ArrowDown",0);
  for(let t=300;t<=3000;t+=300) {
    update(t);
    assert.equal(piece.y,SPAWN_Y+1+t/300);
    assert.equal(score,piece.y-SPAWN_Y); // 通常落下との二重実行なし。
  }
  release("ArrowDown",3000);
  const resumedGravity = getGravityInterval(11);
  update(3000 + resumedGravity - 0.001); assert.equal(piece.y, SPAWN_Y + 11);
  update(3000 + resumedGravity); assert.equal(piece.y, SPAWN_Y + 12); assert.equal(score,11);
  for (const code of ["ArrowLeft","ArrowRight"]) {
    fresh(); const direction=code==="ArrowLeft"?-1:1;
    press(code,0);
    for(let t=300;t<=3000;t+=300) {
      update(t);
      assert.equal(piece.x,Math.max(0,Math.min(8,4+direction*(1+t/300))));
      assert.ok(!collides(piece.shape,piece.x,piece.y));
    }
    release(code,3000); const x=piece.x; update(3300); assert.equal(piece.x,x);
  }
  fresh(); press("ArrowRight",0); board[HIDDEN_ROWS + 0][7]=7;
  update(300); assert.equal(piece.x,5); // 固定ブロックを越えない。
  fresh(); press("ArrowRight",0); press("ArrowDown",0); update(1000);
  assert.deepEqual([piece.x,piece.y,score],[6,SPAWN_Y+2,2]);
  update(1039); assert.equal(piece.y, SPAWN_Y + 2);
  update(1040); assert.equal(piece.y, SPAWN_Y + 3);
  update(1049); assert.equal(piece.x,6);
  update(1050); assert.equal(piece.x,7);

  // 遅い更新で着地した瞬間には、着地前の時間を加えない。
  fresh(); piece.y = HIDDEN_ROWS + 16; press("ArrowDown",0); update(300);
  assert.equal(piece.y, HIDDEN_ROWS + 18); assert.equal(lockElapsed,0);
  update(600); assert.equal(lockElapsed,300); assert.equal(score,2);
  update(799); assert.equal(lockElapsed,499); assert.equal(occupied(),0);
  release("ArrowDown",799);
  update(800); assert.equal(occupied(),4); assert.equal(score,2);
  fresh(); piece.y = HIDDEN_ROWS + 18; press("ArrowLeft",0);
  for(const t of [300,600,900]) { update(t); assert.equal(lockElapsed,0); }
  assert.equal(piece.x,0); assert.equal(lockResets,4);
  update(1200); assert.equal(lockElapsed,300); assert.equal(lockResets,4);
  update(1399); assert.equal(occupied(),0);
  update(1400); assert.equal(occupied(),4);
  fresh(); piece.y = HIDDEN_ROWS + 18; lockResets=15; press("ArrowLeft",0); update(300);
  assert.equal(lockElapsed,300); assert.equal(lockResets,15);
  update(500); assert.equal(occupied(),4);
  // 床Kickの直前まで時間を進め、成功時にだけ固定待ちをリセット。
  fresh(); spawnPiece(2); piece.y = HIDDEN_ROWS + 18; press("ArrowDown",0); update(300);
  key("ArrowUp",false,{timeStamp:310});
  assert.deepEqual([piece.x,piece.y,piece.rotation],[2,HIDDEN_ROWS + 17,1]);
  assert.equal(lockElapsed,0); assert.equal(lockResets,1);
  update(610); assert.equal(lockElapsed,300);
  update(809); assert.equal(occupied(),0);
  update(810); assert.equal(occupied(),4);

  for(const action of ["pause","restart","over","blur","hidden"]) {
    fresh(); press("ArrowRight",0); press("ArrowDown",0); update(300);
    if(action==="pause") { key("KeyP"); update(900); key("KeyP"); }
    if(action==="restart") key("KeyR");
    if(action==="over") { board[HIDDEN_ROWS + 0].fill(7); board[HIDDEN_ROWS + 1].fill(7); spawnPiece(1); assert.ok(gameOver); }
    if(action==="blur") emit("blur");
    if(action==="hidden") { document.hidden=true; emit("visibilitychange"); document.hidden=false; emit("visibilitychange"); }
    assert.ok(Object.values(heldKeys).every(value=>!value));
    assert.equal(activeDirection,null);
    assert.equal(nextHorizontalTime,Infinity); assert.equal(nextSoftDropTime,Infinity);
    const x=piece.x, points=score; update(1200);
    assert.equal(piece.x,x); assert.equal(score,points);
  }
`);
console.log("PASS: normal frames, 249/250/251ms boundary, sustained 300ms frames, single stall recovery, lock timing/kicks and lifecycle resets.");

const controllerSeparationTests = createGame();
controllerSeparationTests(`
  // Human ControllerはPlayerStateと独立し、各ゲーム状態も共有しない。
  const firstController = createHumanControllerState();
  const secondController = createHumanControllerState();
  assert.notEqual(firstController, secondController);
  firstController.heldKeys.ArrowLeft = true;
  firstController.activeDirection = "ArrowLeft";
  firstController.nextHorizontalTime = 170;
  assert.equal(secondController.heldKeys.ArrowLeft, false);
  assert.equal(secondController.activeDirection, null);
  assert.equal(secondController.nextHorizontalTime, Infinity);
  assert.equal(humanController.heldKeys.ArrowLeft, false);

  // DOMイベントを渡さず、キーから正規化されたActionだけをゲームへ送る。
  assert.equal(HUMAN_KEY_ACTIONS.ArrowLeft, PLAYER_ACTIONS.MOVE_LEFT);
  assert.equal(HUMAN_KEY_ACTIONS.ArrowRight, PLAYER_ACTIONS.MOVE_RIGHT);
  assert.equal(HUMAN_KEY_ACTIONS.ArrowUp, PLAYER_ACTIONS.ROTATE_CW);
  assert.equal(HUMAN_KEY_ACTIONS.KeyZ, PLAYER_ACTIONS.ROTATE_CCW);
  assert.equal(HUMAN_KEY_ACTIONS.ArrowDown, PLAYER_ACTIONS.SOFT_DROP);
  assert.equal(HUMAN_KEY_ACTIONS.Space, PLAYER_ACTIONS.HARD_DROP);
  assert.equal(HUMAN_KEY_ACTIONS.KeyC, PLAYER_ACTIONS.HOLD);
  restart(); spawnPiece(1); update(0);
  const actionStartX = piece.x;
  applyPlayerAction(PLAYER_ACTIONS.MOVE_LEFT);
  assert.equal(piece.x, actionStartX - 1);

  // SimulationはController内部を読まず、明示されたsoftDropActiveだけでGravityを抑制する。
  restart(); spawnPiece(1); update(0);
  humanController.heldKeys.ArrowDown = true;
  const gravityStartY = piece.y;
  advanceSimulation(getGravityInterval() + 1);
  assert.equal(piece.y, gravityStartY + 1);
  clearHeldKeys();

  // Controller側のDAS/ARRとSoft Drop repeatは従来の時刻を維持する。
  restart(); spawnPiece(1); update(0);
  handleHumanKeyDown("ArrowRight", 0, false);
  assert.equal(piece.x, 5);
  advanceTime(169); assert.equal(piece.x, 5);
  advanceTime(170); assert.equal(piece.x, 6);
  advanceTime(220); assert.equal(piece.x, 7);
  handleHumanKeyUp("ArrowRight", 220);
  assert.equal(humanController.activeDirection, null);
  assert.equal(humanController.nextHorizontalTime, Infinity);

  restart(); spawnPiece(1); update(0);
  handleHumanKeyDown("ArrowDown", 0, false);
  assert.equal(piece.y, SPAWN_Y + 1);
  advanceTime(40); assert.equal(piece.y, SPAWN_Y + 2);
  handleHumanKeyUp("ArrowDown", 40);
  assert.equal(humanController.nextSoftDropTime, Infinity);
`);
console.log("PASS: Human Controller state/action mapping, simulation isolation and DAS/ARR/Soft Drop timing separation.");

const dualPlayerTests = createGame();
dualPlayerTests(`
  // Dual modeはDEV TOOLSからだけ開始し、Human/Secondを別Stateとして生成する。
  startDualBoardTest();
  assert.equal(dualBoardTestActive, true);
  assert.ok(secondaryPlayerState);
  assert.notEqual(secondaryPlayerState, currentPlayerState);
  assert.notEqual(secondaryPlayerState.board, currentPlayerState.board);
  assert.notEqual(secondaryPlayerState.piece, currentPlayerState.piece);
  assert.notEqual(secondaryPlayerState.nextQueue, currentPlayerState.nextQueue);
  assert.equal(selectedStartLevel, 1);
  assert.equal(isQaRun, true);

  // Humanの状態変更はSecondへ漏れず、Secondの変更もHumanへ漏れない。
  const secondSnapshot = JSON.stringify({ board:secondaryPlayerState.board, piece:secondaryPlayerState.piece,
    nextQueue:secondaryPlayerState.nextQueue, heldType:secondaryPlayerState.heldType, score:secondaryPlayerState.score,
    totalLines:secondaryPlayerState.totalLines, level:secondaryPlayerState.level, b2b:secondaryPlayerState.backToBackActive,
    combo:secondaryPlayerState.comboCount, stats:secondaryPlayerState.runStats });
  applyPlayerAction(PLAYER_ACTIONS.MOVE_LEFT); applyPlayerAction(PLAYER_ACTIONS.ROTATE_CW);
  assert.equal(JSON.stringify({ board:secondaryPlayerState.board, piece:secondaryPlayerState.piece,
    nextQueue:secondaryPlayerState.nextQueue, heldType:secondaryPlayerState.heldType, score:secondaryPlayerState.score,
    totalLines:secondaryPlayerState.totalLines, level:secondaryPlayerState.level, b2b:secondaryPlayerState.backToBackActive,
    combo:secondaryPlayerState.comboCount, stats:secondaryPlayerState.runStats }), secondSnapshot);
  const humanAfterActionSnapshot = JSON.stringify({ board:currentPlayerState.board, piece:currentPlayerState.piece,
    nextQueue:currentPlayerState.nextQueue, heldType:currentPlayerState.heldType, score:currentPlayerState.score,
    totalLines:currentPlayerState.totalLines, level:currentPlayerState.level, b2b:currentPlayerState.backToBackActive,
    combo:currentPlayerState.comboCount, stats:currentPlayerState.runStats });
  advancePreviewSimulation(secondaryPlayerState, getGravityInterval(1));
  assert.equal(JSON.stringify({ board:currentPlayerState.board, piece:currentPlayerState.piece,
    nextQueue:currentPlayerState.nextQueue, heldType:currentPlayerState.heldType, score:currentPlayerState.score,
    totalLines:currentPlayerState.totalLines, level:currentPlayerState.level, b2b:currentPlayerState.backToBackActive,
    combo:currentPlayerState.comboCount, stats:currentPlayerState.runStats }), humanAfterActionSnapshot);
  assert.equal(highScore, 0);

  // 同じRendererでState/Viewを指定して描画しても、Stateは変化しない。
  const renderBefore = JSON.stringify(secondaryPlayerState);
  renderPlayer(secondaryPlayerState, secondView);
  assert.equal(JSON.stringify(secondaryPlayerState), renderBefore);
  assert.equal(String(secondScoreElement.textContent), String(secondaryPlayerState.score));
  assert.equal(String(secondLinesElement.textContent), String(secondaryPlayerState.totalLines));
  assert.equal(String(secondLevelElement.textContent), String(secondaryPlayerState.level));

  // Secondは独自のGravity→Lock→Spawn cycleを持つが、Humanのcoreへは到達しない。
  secondaryPlayerState.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  secondaryPlayerState.piece = { shape:[[1]], rotation:0, x:4, y:TOTAL_ROWS - 1, color:1 };
  secondaryPlayerState.lockElapsed = LOCK_DELAY - 1;
  const secondLockedPiece = secondaryPlayerState.piece;
  advancePreviewSimulation(secondaryPlayerState, 1);
  assert.notEqual(secondaryPlayerState.piece, secondLockedPiece);
  assert.equal(secondaryPlayerState.board[TOTAL_ROWS - 1][4], 1);
  assert.equal(secondaryPlayerState.score, 0);

  // Secondのlock後は自分のQueue/Stateだけを進め、Marathon/Results/High Scoreへ到達しない。
  secondaryPlayerState.totalLines = MARATHON_TARGET_LINES;
  const secondAfterTarget = secondaryPlayerState.totalLines;
  const humanCompleteBefore = marathonComplete;
  const humanResultsBefore = resultsElement.hidden;
  advancePreviewSimulation(secondaryPlayerState, 1);
  assert.equal(secondaryPlayerState.totalLines, secondAfterTarget);
  assert.equal(marathonComplete, humanCompleteBefore);
  assert.equal(resultsElement.hidden, humanResultsBefore);
  assert.equal(highScore, 0);

  exitDualBoardTest();
  assert.equal(dualBoardTestActive, false);
  assert.equal(secondaryPlayerState, null);
  assert.equal(isQaRun, false);
  assert.equal(resultsElement.hidden, true);
`);
console.log("PASS: dual PlayerState independence, state-aware preview simulation, renderer purity/isolation and Marathon/High Score isolation.");

const cpuControllerTests = createGame();
cpuControllerTests(`
  const cpuState = createPlayerState({ initialize: true });
  cpuState.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  cpuState.piece = { shape: ROTATIONS[0][0].map(row => row.slice()), rotation:0, x:3, y:SPAWN_Y, color:1 };
  cpuState.nextQueue = [6, 5, 4, 3, 2];
  cpuState.bag = [1, 0];
  cpuState.heldType = 2;
  const liveSnapshot = JSON.stringify(cpuState);
  const clone = clonePlayerStateForSimulation(cpuState);
  clone.board[0][0] = 7; clone.board[0] = clone.board[0].slice();
  clone.piece.x = 0; clone.nextQueue[0] = 0; clone.bag.push(6); clone.runStats.tetrises = 4;
  assert.equal(JSON.stringify(cpuState), liveSnapshot);
  assert.notEqual(clone.board, cpuState.board);
  assert.notEqual(clone.board[0], cpuState.board[0]);
  assert.notEqual(clone.piece, cpuState.piece);
  assert.notEqual(clone.nextQueue, cpuState.nextQueue);
  assert.notEqual(clone.runStats, cpuState.runStats);

  const planBefore = planCpuPlacement(cpuState);
  assert.ok(planBefore.actions.length > 0);
  assert.equal(planBefore.actions.at(-1), PLAYER_ACTIONS.HARD_DROP);
  assert.equal(planBefore.actions.includes(PLAYER_ACTIONS.HOLD), false);
  assert.ok(planBefore.candidateCount > 0 && planBefore.candidateCount <= CPU_V0_1_CONFIG.maxSearchStates);
  assert.equal(JSON.stringify(cpuState), liveSnapshot);
  const planAgain = planCpuPlacement(cpuState);
  assert.deepEqual(planAgain, planBefore);

  const queueVariant = clonePlayerStateForSimulation(cpuState);
  queueVariant.nextQueue.reverse(); queueVariant.bag.reverse(); queueVariant.heldType = null; queueVariant.holdUsed = true;
  assert.deepEqual(planCpuPlacement(queueVariant), planBefore);
  currentPlayerState.score = 999999; currentPlayerState.board[0][0] = 7;
  assert.deepEqual(planCpuPlacement(cpuState), planBefore);
  const humanBeforeCpu = JSON.stringify(currentPlayerState);
  advanceCpuController(createCpuControllerState({ enabled:true }), cpuState, CPU_V0_1_CONFIG.thinkDelayMs);
  assert.equal(JSON.stringify(currentPlayerState), humanBeforeCpu);

  const replay = clonePlayerStateForSimulation(cpuState);
  const preDropActions = planBefore.actions.slice(0, -1);
  for (const action of preDropActions) assert.ok(applyPlayerActionFor(replay, action));
  assert.equal(replay.piece.x, planBefore.finalX);
  assert.equal(replay.piece.rotation, planBefore.finalRotation);
  assert.equal(landingYOn(replay.board, replay.piece), planBefore.landingY);
  const hardDropResult = applyPlayerActionFor(replay, PLAYER_ACTIONS.HARD_DROP);
  assert.ok(hardDropResult);
  assert.equal(replay.score >= 0, true);

  const oneLineBoard = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  for (let x = 0; x < COLS; x++) if (x < 3 || x > 6) oneLineBoard[TOTAL_ROWS - 1][x] = 1;
  const lineState = clonePlayerStateForSimulation(cpuState);
  lineState.board = oneLineBoard;
  lineState.piece = { shape: ROTATIONS[0][0].map(row => row.slice()), rotation:0, x:3, y:SPAWN_Y, color:1 };
  const linePlan = planCpuPlacement(lineState);
  assert.equal(linePlan.metrics.completedLines, 1);
  assert.equal(linePlan.finalRotation, 0);
  assert.equal(linePlan.finalX, 3);

  const flatMetrics = analyzeBoardForCpu(Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0)));
  const holeBoard = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  holeBoard[TOTAL_ROWS - 3][0] = 1; holeBoard[TOTAL_ROWS - 1][0] = 1;
  const holeMetrics = analyzeBoardForCpu(holeBoard);
  assert.equal(holeMetrics.holes, 1);
  assert.ok(evaluateCpuCandidate(flatMetrics, false) > evaluateCpuCandidate(holeMetrics, false));
  assert.ok(evaluateCpuCandidate(flatMetrics, false) > evaluateCpuCandidate(flatMetrics, true));

  const scheduler = createCpuControllerState({ enabled:true });
  const schedulerState = createPlayerState();
  const schedulerPiece = schedulerState.piece;
  advanceCpuController(scheduler, schedulerState, CPU_V0_1_CONFIG.thinkDelayMs - 1);
  assert.equal(scheduler.lastPlan, null);
  assert.equal(schedulerState.piece, schedulerPiece);
  advanceCpuController(scheduler, schedulerState, 1);
  assert.ok(scheduler.lastPlan);
  assert.equal(schedulerState.piece, schedulerPiece);
  const queueAfterPlan = scheduler.actionQueue.length;
  advanceCpuController(scheduler, schedulerState, CPU_V0_1_CONFIG.actionIntervalMs - 1);
  assert.equal(scheduler.actionQueue.length, queueAfterPlan);
  advanceCpuController(scheduler, schedulerState, 1);
  assert.ok(scheduler.actionQueue.length < queueAfterPlan || schedulerState.piece !== schedulerPiece);

  const blocked = createCpuControllerState({ enabled:true });
  const blockedState = createPlayerState();
  blockedState.piece.x = 0;
  blockedState.board[blockedState.piece.y + 1][0] = 7;
  blocked.plannedPiece = blockedState.piece;
  blocked.needsPlan = false;
  blocked.actionQueue = [PLAYER_ACTIONS.MOVE_LEFT];
  blocked.actionElapsed = CPU_V0_1_CONFIG.actionIntervalMs - 1;
  advanceCpuController(blocked, blockedState, 1);
  assert.equal(blocked.needsPlan, true);
  assert.deepEqual(blocked.actionQueue, []);

  const oldPlan = createCpuControllerState({ enabled:true });
  const oldPlanState = createPlayerState();
  oldPlan.plannedPiece = oldPlanState.piece;
  oldPlan.needsPlan = false;
  oldPlan.actionQueue = [PLAYER_ACTIONS.MOVE_RIGHT];
  oldPlanState.piece = { ...oldPlanState.piece, x: oldPlanState.piece.x };
  advanceCpuController(oldPlan, oldPlanState, 1);
  assert.equal(oldPlan.needsPlan, true);
  assert.deepEqual(oldPlan.actionQueue, []);

  const controllerA = createCpuControllerState({ enabled:true });
  const controllerB = createCpuControllerState({ enabled:true });
  controllerA.actionQueue.push(PLAYER_ACTIONS.MOVE_LEFT);
  controllerA.thinkElapsed = 10;
  assert.deepEqual(controllerB.actionQueue, []);
  assert.equal(controllerB.thinkElapsed, 0);

  const longRunState = createPlayerState();
  const longRunController = createCpuControllerState({ enabled:true });
  let spawnedPieces = 0;
  let previousPiece = longRunState.piece;
  for (let elapsed = 0; elapsed < 10000 && spawnedPieces < 2; elapsed += 16) {
    advancePreviewSimulation(longRunState, 16);
    advanceCpuController(longRunController, longRunState, 16);
    if (longRunState.piece !== previousPiece) { spawnedPieces++; previousPiece = longRunState.piece; }
  }
  assert.ok(spawnedPieces >= 2);

  startCpuTest();
  cpuController.actionQueue = [PLAYER_ACTIONS.MOVE_LEFT];
  cpuController.thinkElapsed = 120;
  restart();
  assert.equal(cpuController.enabled, true);
  assert.deepEqual(cpuController.actionQueue, []);
  assert.equal(cpuController.thinkElapsed, 0);
  exitDualBoardTest();
`);
console.log("PASS: CPU v0.1 cloning, deterministic reachable planning, heuristic metrics, action replay, scheduler timing and isolation.");

// 別々のVMが同じ保存領域を使い、他画面の更新を知らない状態を再現する。
const highScoreKey = "falling-block-high-score";
for (const [initial, points, expected] of [[undefined,100,100],["100",500,500],["500",100,500]]) {
  const shared = initial === undefined ? {} : { [highScoreKey]: initial };
  createGame(shared)(`addScore(${points}); assert.equal(score,${points}); assert.equal(highScore,${expected});`);
  assert.equal(shared[highScoreKey],String(expected));
}
for (const sequence of [
  [[0,1000,1000],[1,100,1000]],
  [[0,100,100],[1,1000,1000]],
  [[0,500,500],[1,300,500],[0,800,800],[1,600,800],[0,1200,1200]],
]) {
  const shared = { [highScoreKey]: "0", unrelated: "unchanged" };
  const games = [createGame(shared),createGame(shared)];
  for (const [tab,points,expected] of sequence) {
    games[tab](`restart(); addScore(${points}); assert.equal(score,${points});`);
    assert.equal(shared[highScoreKey],String(expected));
  }
  assert.equal(shared.unrelated,"unchanged");
}
const sharedDisplay = {};
const tabA = createGame(sharedDisplay), tabB = createGame(sharedDisplay);
tabA("addScore(1000)");
tabB("addScore(100); assert.equal(highScore,1000); assert.equal(Number(highScoreElement.textContent),1000); restart(); assert.equal(score,0); assert.equal(highScore,1000)");
// 読み直しで大きい記録を見つけた場合、書き込み自体を行わない。
const writes = [];
const tracked = new Proxy({}, { set(target,key,value) { writes.push(value); target[key]=value; return true; } });
const first = createGame(tracked), second = createGame(tracked);
first("addScore(1000)"); second("addScore(100)");
assert.deepEqual(writes,["1000"]);
// 起動後に保存値が不正になった場合も、保存直前の検証を通す。
for (const value of ["", "bad", "-1", "Infinity", "1.5", "9007199254740992"]) {
  const shared = {};
  const game = createGame(shared);
  shared[highScoreKey] = value;
  game("addScore(100); assert.equal(highScore,100); assert.equal(Number(highScoreElement.textContent),100)");
  assert.equal(shared[highScoreKey],"100");
}
const writeFailure = new Proxy({}, { set() { throw Error("Write blocked"); } });
createGame(writeFailure)("addScore(100); assert.equal(score,100); assert.equal(highScore,100); assert.equal(Number(highScoreElement.textContent),100); restart(); assert.equal(score,0); assert.equal(highScore,100); hardDrop(); assert.ok(score>0)");
let failRead = false, unexpectedWrites = 0;
const readFailure = new Proxy({}, {
  get() { if(failRead) throw Error("Read blocked"); return "0"; },
  set() { unexpectedWrites++; return true; },
});
const readFailureGame = createGame(readFailure);
failRead = true;
readFailureGame("addScore(100); assert.equal(highScore,100); assert.equal(Number(highScoreElement.textContent),100); restart(); assert.equal(score,0)");
assert.equal(unexpectedWrites,0);
console.log("PASS: shared high-score storage, stale tabs, update order, monotonic records, display, invalid values and read/write failures.");

const leftRotationTests = createGame();
leftRotationTests(`
  function setup(type, state=0, x=3, y=5) {
    restart(); spawnPiece(type);
    piece.rotation=state; piece.shape=ROTATIONS[type][state]; piece.x=x; piece.y=HIDDEN_ROWS+y;
    assert.ok(!collides(piece.shape,x,HIDDEN_ROWS+y)); update(0);
  }
  for(let type=0;type<7;type++) {
    setup(type); const before=JSON.stringify(piece);
    for(const state of [3,2,1,0]) {
      key("KeyZ"); assert.equal(piece.rotation,state);
      assert.deepEqual(piece.shape,ROTATIONS[type][state]);
      assert.deepEqual([piece.x,piece.y],[3,HIDDEN_ROWS + 5]);
    }
    assert.equal(JSON.stringify(piece),before);
    key("ArrowUp"); key("KeyZ"); assert.equal(JSON.stringify(piece),before);
    key("KeyZ"); key("ArrowUp"); assert.equal(JSON.stringify(piece),before);
  }
  // 左右壁、床、I型の全左遷移。期待位置はSRS表から指定。
  const cases=[
    [2,1,-1,5,0,5], [2,3,8,5,7,5], [2,0,3,18,4,17],
    [0,1,-2,5,0,5], [0,3,8,5,6,5], [0,0,3,18,2,16],
    [0,2,3,17,1,16],
  ];
  for(const [type,state,x,y,ex,ey] of cases) {
    setup(type,state,x,y); key("KeyZ");
    assert.deepEqual([piece.x,piece.y,piece.rotation],[ex,HIDDEN_ROWS+ey,(state+3)%4]);
    assert.ok(!collides(piece.shape,piece.x,piece.y));
    const snapshot=JSON.stringify([piece,board]);
    const landing=ghostY(); assert.equal(JSON.stringify([piece,board]),snapshot);
    assert.ok(!collides(piece.shape,piece.x,landing));
    assert.ok(collides(piece.shape,piece.x,landing+1));
    const cells=[];
    piece.shape.forEach((row,dy)=>row.forEach((cell,dx)=>{if(cell) cells.push([piece.x+dx,landing+dy]);}));
    const points=(landing-piece.y)*2;
    key("Space"); assert.equal(score,points);
    cells.forEach(([cx,cy])=>assert.equal(board[cy][cx],type+1));
  }
  for(const type of [2,3,4,5,6]) {
    setup(type,1,-1,5); key("KeyZ"); assert.equal(piece.x,0); assert.equal(piece.rotation,0);
  }
  setup(2); board[HIDDEN_ROWS + 7][4]=7; key("KeyZ");
  assert.deepEqual([piece.x,piece.y,piece.rotation],[4,HIDDEN_ROWS + 5,3]);
  assert.equal(board[HIDDEN_ROWS + 7][4],7);
  for(const type of [0,2,3,4,5,6]) {
    for(let state=0;state<4;state++) {
      setup(type,state); board.forEach(row=>row.fill(7));
      piece.shape.forEach((row,dy)=>row.forEach((cell,dx)=>{if(cell) board[piece.y+dy][piece.x+dx]=0;}));
      lockElapsed=300; lockResets=4;
      const before=JSON.stringify([piece,board,lockElapsed,lockResets]);
      key("KeyZ"); assert.equal(JSON.stringify([piece,board,lockElapsed,lockResets]),before);
    }
  }
  setup(1,0,0,18);
  for(let i=0;i<4;i++) { key("KeyZ"); assert.deepEqual([piece.x,piece.y],[0,HIDDEN_ROWS + 18]); assert.deepEqual(piece.shape,[[1,1],[1,1]]); }
  setup(2,0,3,18); key("KeyZ",false,{timeStamp:490}); update(500);
  assert.equal(lockElapsed,10); assert.equal(lockResets,1);
  update(989); assert.equal(board.flat().filter(Boolean).length,0);
  update(990); assert.equal(board.flat().filter(Boolean).length,4);
  setup(2,0,3,18); lockResets=15; lockElapsed=400; key("KeyZ");
  assert.equal(lockResets,15); assert.equal(lockElapsed,400);
  setup(2); key("KeyZ"); key("KeyC"); key("Space"); key("KeyC");
  assert.equal(piece.color,3); assert.equal(piece.rotation,0);
  assert.deepEqual([piece.x,piece.y],[3,SPAWN_Y]); assert.equal(lockResets,0);
  setup(2); press("KeyZ",0); press("KeyZ",10,true); assert.equal(piece.rotation,3);
  for(const modifier of ["ctrlKey","altKey","metaKey"]) {
    key("KeyZ",false,{[modifier]:true}); assert.equal(piece.rotation,3);
  }
  key("KeyP"); key("KeyZ"); assert.equal(piece.rotation,3);
  key("KeyR"); assert.equal(piece.rotation,0);
  board[HIDDEN_ROWS + 0].fill(7); board[HIDDEN_ROWS + 1].fill(7); spawnPiece(2);
  key("KeyZ"); assert.equal(piece.rotation,0);
`);
console.log("PASS: counterclockwise rotation, inverse turns, SRS kicks, blocked turns, lock limits/timing, ghost/drop, HOLD and Z input guards.");

const upperBoardTests = createGame();
upperBoardTests(`
  function fresh(type=1) { restart(); spawnPiece(type); update(0); }
  function occupied() { return board.flat().filter(Boolean).length; }
  function pieceCells() {
    const cells=[];
    piece.shape.forEach((row,dy)=>row.forEach((cell,dx)=>{
      if(cell) cells.push([piece.x+dx,piece.y+dy]);
    }));
    return cells;
  }
  assert.equal(VISIBLE_ROWS,20); assert.equal(HIDDEN_ROWS,20);
  assert.equal(TOTAL_ROWS,VISIBLE_ROWS+HIDDEN_ROWS);
  assert.equal(canvas.width,COLS*CELL); assert.equal(canvas.height,VISIBLE_ROWS*CELL);
  assert.equal(board.length,TOTAL_ROWS);
  assert.ok(board.every(row=>row.length===COLS));
  for(const y of [0,HIDDEN_ROWS-1,HIDDEN_ROWS,TOTAL_ROWS-1]) {
    assert.equal(collides([[1]],0,y),false);
    board[y][0]=7; assert.equal(collides([[1]],0,y),true); board[y][0]=0;
  }
  assert.ok(collides([[1]],0,-1)); assert.ok(collides([[1]],0,TOTAL_ROWS));
  assert.ok(collides([[1]],-1,HIDDEN_ROWS-1)); assert.ok(collides([[1]],COLS,HIDDEN_ROWS-1));
  for(let type=0;type<7;type++) {
    fresh(type);
    assert.equal(piece.y,HIDDEN_ROWS-1); assert.equal(piece.rotation,0);
    assert.equal(piece.x,type===1 ? 4 : 3);
    assert.deepEqual(piece.shape,ROTATIONS[type][0]);
    assert.equal(Math.min(...pieceCells().map(cell=>cell[1])),type===0 ? HIDDEN_ROWS : HIDDEN_ROWS-1);
    assert.equal(Math.max(...pieceCells().map(cell=>cell[1])),HIDDEN_ROWS);
    const original=JSON.stringify(piece);
    key("ArrowLeft"); key("ArrowRight"); assert.equal(JSON.stringify(piece),original);
    key("ArrowUp"); key("KeyZ"); assert.equal(JSON.stringify(piece),original);
    key("KeyZ"); key("ArrowUp"); assert.equal(JSON.stringify(piece),original);
    key("ArrowDown"); assert.equal(piece.y,HIDDEN_ROWS); assert.equal(score,1);
    // 全て非表示の状態でも回転・移動・ドロップ可能。
    piece.y=HIDDEN_ROWS-4;
    key("ArrowLeft"); key("KeyZ"); assert.ok(!collides(piece.shape,piece.x,piece.y));
    const landing=ghostY(), distance=landing-piece.y;
    const target=pieceCells().map(([x,y])=>[x,y+distance]);
    const points=score;
    key("Space");
    assert.equal(score,points+distance*2); assert.equal(occupied(),4);
    target.forEach(([x,y])=>assert.equal(board[y][x],type+1));
    assert.equal(gameOver,false);
  }
  // 非表示最下段よりさらに上でも、左右の壁Kickを許可。
  for(const code of ["ArrowUp","KeyZ"]) {
    for(const type of [0,2,3,4,5,6]) {
      fresh(type); piece.rotation=1; piece.shape=ROTATIONS[type][1];
      piece.x=type===0 ? -2 : -1; piece.y=HIDDEN_ROWS-4;
      key(code);
      assert.equal(piece.rotation,code==="ArrowUp" ? 2 : 0);
      assert.ok(!collides(piece.shape,piece.x,piece.y));
      assert.ok(pieceCells().every(([x,y])=>x>=0 && y<HIDDEN_ROWS));
    }
  }
  // 全種類のSpawn実セルを塞ぐとBlock Out。空白セルは衝突扱いしない。
  for(let type=0;type<7;type++) {
    fresh(type); const [x,y]=pieceCells()[0]; board[y][x]=7;
    spawnPiece(type); assert.ok(gameOver); assert.ok(pauseButton.disabled);
  }
  fresh(0); board[SPAWN_Y][3]=7; spawnPiece(0); assert.equal(gameOver,false);
  fresh(); board[0][0]=7; board[HIDDEN_ROWS-1][0]=7;
  spawnPiece(2); assert.equal(gameOver,false);
  // HOLD交換も同じSpawn位置と衝突判定を使う。
  fresh(2); heldType=1; piece.y=HIDDEN_ROWS+5;
  board[SPAWN_Y][4]=7; key("KeyC"); assert.ok(gameOver);
  fresh(2); heldType=0; piece.y=HIDDEN_ROWS+5; key("KeyZ");
  lockElapsed=300; lockResets=7; key("KeyC");
  assert.equal(piece.y,SPAWN_Y); assert.equal(piece.rotation,0);
  assert.equal(lockElapsed,0); assert.equal(lockResets,0); assert.ok(holdUsed);
  const held=JSON.stringify(piece); key("KeyC"); assert.equal(JSON.stringify(piece),held);
  key("Space"); assert.equal(holdUsed,false);
  // 隠れていること自体では固定待ちを開始しない。
  fresh(); piece.y=HIDDEN_ROWS-4; update(499);
  assert.equal(lockElapsed,0); assert.equal(gameOver,false);
  // 全セルが非表示で接地した場合も500msまでは固定しない。
  fresh(); piece.x=0; piece.y=HIDDEN_ROWS-3;
  board[HIDDEN_ROWS-1][0]=board[HIDDEN_ROWS-1][1]=7;
  const next=nextQueue[0];
  press("ArrowDown",0); update(499); assert.equal(gameOver,false); assert.equal(score,0);
  update(500); assert.ok(gameOver); assert.equal(occupied(),6);
  assert.equal(nextQueue[0],next); assert.ok(pauseButton.disabled);
  assert.ok(Object.values(heldKeys).every(value=>!value));
  const over=JSON.stringify([board,piece,score]);
  key("ArrowUp"); key("KeyZ"); key("Space"); update(2000);
  assert.equal(JSON.stringify([board,piece,score]),over);
  // Hard DropによるLock Outも即時に終了。
  fresh(); piece.x=0; piece.y=HIDDEN_ROWS-4;
  board[HIDDEN_ROWS-1][0]=board[HIDDEN_ROWS-1][1]=7;
  assert.equal(ghostY(),HIDDEN_ROWS-3); key("Space");
  assert.ok(gameOver); assert.equal(score,2);
  // 一部だけ非表示なら終了しない（中央のSpawnも空けておく）。
  fresh(); piece.x=0; piece.y=HIDDEN_ROWS-1;
  board[HIDDEN_ROWS+1][0]=board[HIDDEN_ROWS+1][1]=7;
  lockPiece(); assert.equal(gameOver,false); assert.equal(occupied(),6);
  assert.equal(board[HIDDEN_ROWS-1][0],2);
  // 消去前に全セルが非表示なら、完成行があってもLock Outを優先。
  fresh(); piece.x=0; piece.y=HIDDEN_ROWS-3;
  board[HIDDEN_ROWS-3].fill(7,2); board[HIDDEN_ROWS-2].fill(7,2);
  board[HIDDEN_ROWS-1][0]=board[HIDDEN_ROWS-1][1]=7;
  lockPiece(); assert.ok(gameOver); assert.equal(totalLines,0); assert.equal(score,0);
  assert.ok(board[HIDDEN_ROWS-2].every(Boolean));
  // 非表示と表示の境界をまたぐ2行消去。上のマーカーが表示内へ下がる。
  fresh(); piece.x=0; piece.y=HIDDEN_ROWS-1;
  board[HIDDEN_ROWS-1].fill(7,2); board[HIDDEN_ROWS].fill(7,2);
  board[HIDDEN_ROWS-2][8]=6;
  lockPiece(); assert.equal(gameOver,false); assert.equal(totalLines,2); assert.equal(score,300);
  assert.equal(board[HIDDEN_ROWS][8],6); assert.equal(board.length,TOTAL_ROWS);
  assert.ok(board.slice(0,2).every(row=>row.every(cell=>cell===0)));
  // 通常の1～4行消去でも、非表示ブロックを含む上部が同じ行数だけ下がる。
  for(let count=1;count<=4;count++) {
    fresh(0); piece.rotation=1; piece.shape=ROTATIONS[0][1]; piece.x=2; piece.y=TOTAL_ROWS-4;
    board[HIDDEN_ROWS-1][8]=6;
    for(let y=TOTAL_ROWS-count;y<TOTAL_ROWS;y++) { board[y].fill(7); board[y][4]=0; }
    lockPiece();
    assert.equal(totalLines,count); assert.equal(score,[0,100,300,500,800][count]);
    assert.equal(board[HIDDEN_ROWS-1+count][8],6); assert.equal(board.length,TOTAL_ROWS);
    assert.equal(new Set(board).size,TOTAL_ROWS);
    assert.ok(board.slice(0,count).every(row=>row.every(cell=>cell===0)));
  }
  // 内部・表示座標の境界を実際の描画命令で確認。
  captureDraw=true;
  fresh(); drawCalls.length=0;
  for(const y of [0,HIDDEN_ROWS-1,HIDDEN_ROWS,TOTAL_ROWS-1,TOTAL_ROWS]) drawCell(0,y,1);
  const fills=drawCalls.filter(call=>call.name==="fillRect");
  assert.equal(fills.length,2);
  assert.equal(fills[0].args[1],1); assert.equal(fills[1].args[1],(VISIBLE_ROWS-1)*CELL+1);
  fresh(); gameOver=true;
  for(const y of [0,HIDDEN_ROWS-1,HIDDEN_ROWS,TOTAL_ROWS-1]) board[y][0]=1;
  drawCalls.length=0; draw();
  assert.equal(drawCalls.filter(call=>call.name==="fillRect").length,2);
  assert.equal(drawCalls.filter(call=>call.name==="clearRect")[0].args[3],VISIBLE_ROWS*CELL);
  assert.equal(drawCalls.filter(call=>call.name==="lineTo").length,COLS+1+VISIBLE_ROWS+1);
  fresh(); drawCalls.length=0; draw();
  const active=drawCalls.filter(call=>call.name==="fillRect" && call.alpha===1);
  assert.equal(active.length,2); assert.ok(active.every(call=>call.args[1]===1));
  piece.y=HIDDEN_ROWS-2; drawCalls.length=0; draw();
  assert.equal(drawCalls.filter(call=>call.name==="fillRect" && call.alpha===1).length,0);
  // Ghostも非表示領域に着地する場合は描画しない。
  board[HIDDEN_ROWS][4]=board[HIDDEN_ROWS][5]=7; drawCalls.length=0; draw();
  assert.equal(drawCalls.filter(call=>call.name==="fillRect" && call.alpha===0.25).length,0);
  restart();
  assert.equal(board.length,TOTAL_ROWS); assert.equal(occupied(),0);
  assert.equal(piece.y,SPAWN_Y); assert.equal(gameOver,false); assert.equal(pauseButton.disabled,false);
  assert.equal(lockElapsed,0); assert.equal(lockResets,0); assert.equal(lastTime,null);
`);
console.log("PASS: hidden rows, spawn for all pieces, upper rotations/kicks, draw boundaries, ghost/drop, line shifts, block/lock out and restart.");

const nextQueueTests = createGame();
nextQueueTests(`
  function validQueue() {
    assert.equal(nextQueue.length,5);
    assert.ok(nextQueue.every(type=>Number.isInteger(type) && type>=0 && type<7));
    assert.ok(piece.color>=1 && piece.color<=7);
  }
  let seed=42;
  Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // 同じ乱数列の7-bag直接出力と比較。先読みで出現順を変えない。
  bag=[];
  const expected=Array.from({length:10011},()=>nextType());
  seed=42; restart(); validQueue();
  assert.equal(piece.color-1,expected[0]);
  assert.deepEqual(nextQueue,expected.slice(1,6));
  for(let i=1;i<=10000;i++) {
    const before=nextQueue.slice();
    // 積み上がりによる終了を避け、通常の固定経路でキュー消費を検証。
    board.forEach(row=>row.fill(0)); hardDrop(); validQueue();
    assert.equal(piece.color-1,before[0]);
    assert.equal(piece.color-1,expected[i]);
    assert.deepEqual(nextQueue,expected.slice(i+1,i+6));
    assert.deepEqual(nextQueue.slice(0,4),before.slice(1));
  }
  for(let i=0;i+7<=expected.length;i+=7) assert.equal(new Set(expected.slice(i,i+7)).size,7);
  // bag残り2個から、次bagへまたがって5個補充。
  bag=[6,5]; nextQueue=[2]; advancePiece();
  assert.equal(piece.color,3); assert.deepEqual(nextQueue.slice(0,2),[5,6]); validQueue();
  assert.equal(new Set([...nextQueue.slice(2),...bag]).size,7);
  restart(); let before=nextQueue.slice(); const original=piece.color-1;
  hold(); assert.equal(heldType,original); assert.equal(piece.color-1,before[0]);
  assert.deepEqual(nextQueue.slice(0,4),before.slice(1));
  before=nextQueue.slice(); hold(); assert.deepEqual(nextQueue,before);
  hardDrop(); before=nextQueue.slice(); hold(); assert.deepEqual(nextQueue,before);
  assert.equal(piece.color-1,original); assert.equal(piece.rotation,0); assert.equal(piece.y,SPAWN_Y);
  const oldQueue=nextQueue; seed=42; restart();
  assert.notEqual(nextQueue,oldQueue); assert.deepEqual(nextQueue,expected.slice(1,6));
  // Block Outでは出現に使った1個だけ消費し、終了後は維持。
  before=nextQueue.slice();
  board[SPAWN_Y].fill(7); board[HIDDEN_ROWS].fill(7);
  advancePiece(); assert.ok(gameOver); validQueue();
  assert.equal(piece.color-1,before[0]); assert.deepEqual(nextQueue.slice(0,4),before.slice(1));
  before=nextQueue.slice(); key("Space"); key("KeyC"); update(5000); draw();
  assert.deepEqual(nextQueue,before);
  // Lock OutとPauseもキューを進めない。
  restart(); spawnPiece(1); piece.x=0; piece.y=HIDDEN_ROWS-3;
  before=nextQueue.slice(); lockPiece(); assert.ok(gameOver); assert.deepEqual(nextQueue,before);
  restart(); before=nextQueue.slice(); key("KeyP"); update(1000); key("Space");
  assert.deepEqual(nextQueue,before);
  // NEXT描画を記録し、順番・中央配置・描画によるキュー不変を確認。
  const preview=document.getElementById("next");
  const rectangles=[];
  const ctx={clearRect(){rectangles.length=0;},fillRect(x,y,w,h){rectangles.push({x,y,w,h,color:this.fillStyle});}};
  preview.getContext=()=>ctx;
  for(let first=0;first<7;first++) {
    nextQueue=Array.from({length:5},(_,i)=>(first+i)%7);
    const state=JSON.stringify([nextQueue,bag,piece]); const randomBefore=seed;
    draw(); assert.equal(JSON.stringify([nextQueue,bag,piece]),state); assert.equal(seed,randomBefore);
    assert.equal(rectangles.length,20);
    for(let i=0;i<5;i++) {
      const cells=rectangles.slice(i*4,i*4+4);
      assert.ok(cells.every(cell=>cell.color===COLORS[nextQueue[i]+1]));
      const left=Math.min(...cells.map(c=>c.x)), right=Math.max(...cells.map(c=>c.x+c.w));
      const top=Math.min(...cells.map(c=>c.y)), bottom=Math.max(...cells.map(c=>c.y+c.h));
      assert.equal((left+right)/2,60); assert.equal((top+bottom)/2,i*40+20);
      assert.ok(top>=i*40 && bottom<=(i+1)*40);
    }
  }
`);
console.log("PASS: NEXT5 order, 10,000 fixed pieces, seeded 7-bag equivalence, bag boundary, HOLD, restart, top out, pause and preview centering.");

const levelScoreStorage = {};
const levelScoreTests = createGame(levelScoreStorage);
levelScoreTests(`
  function prepareClear(lines, startLevel, startLines=(startLevel-1)*10) {
    restart(); spawnPiece(0);
    level=startLevel; totalLines=startLines;
    board[0][0]=7; // 通常ライン得点だけを確認するためPerfect Clearを避ける。
    piece.rotation=1; piece.shape=ROTATIONS[0][1]; piece.x=2; piece.y=TOTAL_ROWS-4;
    for(let y=TOTAL_ROWS-lines;y<TOTAL_ROWS;y++) { board[y].fill(7); board[y][4]=0; }
  }
  const expectedByLevel=[[1,[100,300,500,800]],[2,[200,600,1000,1600]],[5,[500,1500,2500,4000]]];
  for(const [startLevel,points] of expectedByLevel) {
    for(let lines=1;lines<=4;lines++) {
      prepareClear(lines,startLevel); lockPiece();
      assert.equal(score,points[lines-1]);
      assert.equal(Number(scoreElement.textContent),score);
      assert.equal(totalLines,(startLevel-1)*10+lines);
      assert.equal(level,startLevel);
      assert.equal(board.flat().filter(Boolean).length,5-lines);
    }
  }
  for(const [startLines,startLevel,lines,points,newLines,newLevel] of [
    [9,1,1,100,10,2], [8,1,2,300,10,2], [19,2,4,1600,23,3],
  ]) {
    prepareClear(lines,startLevel,startLines); lockPiece();
    assert.equal(score,points); assert.equal(totalLines,newLines); assert.equal(level,newLevel);
    assert.equal(Number(levelElement.textContent),newLevel);
    assert.ok(Math.abs(getGravityInterval() - (newLevel === 2 ? 793 : 618)) < 1);
  }
  // 高Levelのドロップ得点と0行固定。倍率は適用しない。
  restart(); spawnPiece(1); level=5; totalLines=40;
  for(let i=0;i<3;i++) key("ArrowDown");
  assert.equal(score,3);
  piece.y=TOTAL_ROWS-2; lockPiece(); assert.equal(score,3); assert.equal(totalLines,40);
  restart(); spawnPiece(1); level=5; totalLines=40; piece.y=TOTAL_ROWS-12;
  assert.equal(ghostY()-piece.y,10); key("Space"); assert.equal(score,20); assert.equal(totalLines,40);
  prepareClear(0,5); lockPiece(); assert.equal(score,0);
  // 同じHard Dropで10マス下降＋2行消去。
  prepareClear(2,3); piece.y-=10;
  assert.equal(ghostY()-piece.y,10); key("Space");
  assert.equal(score,920); assert.equal(totalLines,22); assert.equal(level,3);
  // 倍率付き得点も既存の表示・保存経路へ流す。
  prepareClear(4,5); lockPiece(); assert.equal(highScore,4000);
  assert.equal(Number(highScoreElement.textContent),4000);
  restart(); assert.equal(score,0); assert.equal(highScore,4000);
`);
assert.equal(levelScoreStorage["falling-block-high-score"],"4000");
createGame(levelScoreStorage)("assert.equal(highScore,4000)");
console.log("PASS: line scores at levels 1/2/5, pre-clear level boundaries, zero clears, unscaled drops, combined score and high-score persistence.");

const spinTests = createGame();
spinTests(`
  const cornerOffsets = [[0,0],[2,0],[2,2],[0,2]];
  function setupSpin(rotation=0, corners=[0,1,2], direction=1, x=3, y=35) {
    restart(); spawnPiece(2);
    piece.x=x; piece.y=y;
    piece.rotation=(rotation-direction+4)%4;
    piece.shape=ROTATIONS[2][piece.rotation];
    for(const index of corners) {
      const [dx,dy]=cornerOffsets[index];
      if(y+dy>=0 && y+dy<TOTAL_ROWS && x+dx>=0 && x+dx<COLS) board[y+dy][x+dx]=7;
    }
    assert.equal(collides(piece.shape,piece.x,piece.y),false);
    key(direction===1 ? "ArrowUp" : "KeyZ");
    assert.equal(piece.rotation,rotation);
    assert.equal(lastRotationKick,0);
  }
  // 全方向・左右回転・全16通りの角。期待値は向きごとの明示表。
  const frontPairs=[[0,1],[1,2],[2,3],[3,0]];
  for(const direction of [1,-1]) for(let rotation=0;rotation<4;rotation++) {
    for(let mask=0;mask<16;mask++) {
      const corners=[0,1,2,3].filter(i=>mask & (1<<i));
      setupSpin(rotation,corners,direction);
      const expected=corners.length<3 ? "NONE"
        : frontPairs[rotation].every(i=>corners.includes(i)) ? "T_SPIN" : "T_SPIN_MINI";
      assert.equal(detectTSpin(),expected);
      lastRotationKick=null;
      assert.equal(detectTSpin(),"NONE"); // 同じ配置でも回転履歴なし
      lastRotationKick=0; lockPiece();
      assert.deepEqual(lastLockResult,{spin:expected,lines:0});
    }
  }
  for(const type of [0,1,3,4,5,6]) {
    restart(); spawnPiece(type); rotate(); assert.equal(detectTSpin(),"NONE");
  }
  setupSpin(0,[0,2,3]);
  board[36].fill(7); for(let x=3;x<=5;x++) board[36][x]=0;
  level=5; totalLines=40; hardDrop();
  assert.deepEqual(lastLockResult,{spin:"T_SPIN_MINI",lines:1});
  assert.equal(score,1000); assert.equal(totalLines,41);
  setupSpin();
  const beforeGhost=lastRotationKick;
  ghostY(); draw(); assert.equal(lastRotationKick,beforeGhost);
  assert.equal(move(-1,0),false); // 固定ブロックに阻まれる
  assert.equal(lastRotationKick,0);
  stepDown(true); assert.equal(score,0); assert.equal(lastRotationKick,0);
  assert.equal(ghostY(),piece.y);
  hardDrop(); assert.deepEqual(lastLockResult,{spin:"T_SPIN",lines:0});
  assert.equal(score,400); assert.equal(lastRotationKick,null);

  for(const dx of [-1,1]) {
    setupSpin(0,[]); assert.equal(move(dx,0),true);
    assert.equal(lastRotationKick,null);
    lockPiece(); assert.equal(lastLockResult.spin,"NONE");
  }
  setupSpin(0,[]); stepDown(true);
  assert.equal(lastRotationKick,null); assert.equal(score,1);
  setupSpin(0,[]); update(0); update(1000);
  assert.equal(piece.y,36); assert.equal(lastRotationKick,null); assert.equal(score,0);
  setupSpin(0,[]); const distance=ghostY()-piece.y;
  assert.ok(distance>0); hardDrop();
  assert.equal(lastLockResult.spin,"NONE"); assert.equal(score,distance*2);

  // 全候補失敗では直前の成功回転とロック時間を保持。
  setupSpin(0,[0,1,2,3]);
  for(let y=32;y<40;y++) for(let x=0;x<COLS;x++) {
    const dx=x-piece.x,dy=y-piece.y;
    if(!piece.shape[dy]?.[dx]) board[y][x]=7;
  }
  lockElapsed=123; lockResets=4;
  const blockedPiece=JSON.stringify(piece);
  for(const direction of [1,-1]) {
    rotate(direction); assert.equal(JSON.stringify(piece),blockedPiece);
    assert.equal(lastRotationKick,0); assert.equal(lockElapsed,123); assert.equal(lockResets,4);
  }

  // 実際に第5候補を通る0→1 / 0→3。左右を鏡写しにした盤面。
  function setupFifthKick(lines=3, mirror=false, mini=false) {
    restart(); spawnPiece(2); level=3; totalLines=20;
    piece.x=mirror ? 3 : 4; piece.y=33;
    const targetX=mirror ? 4 : 3, rotation=mirror ? 3 : 1;
    const target=ROTATIONS[2][rotation];
    for(let dy=0;dy<3;dy++) for(let x=0;x<COLS;x++) {
      if(!target[dy][x-targetX]) board[35+dy][x]=7;
    }
    // 消去本数だけを変えるため、Tから離れた列に穴を開ける。
    for(let row=0;row<3-lines;row++) board[35+row][0]=0;
    board[33][mirror ? 5 : 4]=7;
    if(mini) board[37][mirror ? 4 : 5]=0;
    board[38][targetX+1]=7;
    assert.equal(collides(piece.shape,piece.x,piece.y),false);
    key(mirror ? "KeyZ" : "ArrowUp");
    assert.equal(piece.rotation,rotation); assert.equal(piece.x,targetX); assert.equal(piece.y,35);
    assert.equal(lastRotationKick,4);
  }
  for(const mirror of [false,true]) {
    setupFifthKick(0,mirror,true);
    assert.equal(detectTSpin(),"T_SPIN");
    lastRotationKick=0; assert.equal(detectTSpin(),"T_SPIN_MINI");
    lastRotationKick=4;
    assert.equal(ghostY(),35); hardDrop();
    assert.equal(lastLockResult.spin,"T_SPIN");
  }
  for(let lines=0;lines<=3;lines++) {
    setupFifthKick(lines);
    const snapshot=JSON.stringify(board);
    assert.equal(detectTSpin(),"T_SPIN"); assert.equal(JSON.stringify(board),snapshot);
    hardDrop();
    assert.deepEqual(lastLockResult,{spin:"T_SPIN",lines});
    assert.equal(score,[400,800,1200,1600][lines]*3);
    assert.equal(totalLines,20+lines); assert.equal(level,3);
    assert.equal(lastRotationKick,null);
  }

  // 表示開始行は壁ではない。内部最上端・左右壁・床は占有扱い。
  setupSpin(0,[],1,3,HIDDEN_ROWS-1); assert.equal(detectTSpin(),"NONE");
  setupSpin(0,[0,1,2],1,3,HIDDEN_ROWS-1); assert.equal(detectTSpin(),"T_SPIN");
  for(const [rotation,x,y,corner] of [[1,-1,30,1],[3,8,30,0],[0,3,38,0],[2,3,-1,2]]) {
    restart(); spawnPiece(2); piece.rotation=rotation; piece.shape=ROTATIONS[2][rotation];
    piece.x=x; piece.y=y;
    const [dx,dy]=cornerOffsets[corner]; board[y+dy][x+dx]=7;
    assert.equal(collides(piece.shape,x,y),false);
    lastRotationKick=0;
    assert.equal(detectTSpin(),"T_SPIN_MINI");
  }

  setupSpin(); update(0); update(499);
  assert.equal(lastLockResult,null); update(500);
  assert.deepEqual(lastLockResult,{spin:"T_SPIN",lines:0});
  setupSpin(); lockElapsed=200; lockResets=14;
  rotate(1); assert.equal(lockElapsed,0); assert.equal(lockResets,15);
  lockElapsed=100; rotate(-1); assert.equal(lockElapsed,100); assert.equal(lockResets,15);
  setupSpin(); update(0); togglePause(200); update(1000);
  assert.equal(lastRotationKick,0); assert.equal(lockElapsed,200);
  togglePause(1000); update(1300); assert.equal(lastLockResult.spin,"T_SPIN");

  setupSpin(); hold(); assert.equal(lastRotationKick,null);
  holdUsed=false; hold(); assert.equal(piece.color,3); assert.equal(piece.rotation,0);
  assert.equal(lastRotationKick,null);
  setupSpin(); spawnPiece(2); assert.equal(lastRotationKick,null);
  setupSpin(); endGame(); assert.equal(lastRotationKick,null);
  restart(); assert.equal(lastRotationKick,null); assert.equal(lastLockResult,null);
  setupSpin(0,[0,1,2],1,3,10); hardDrop(); // 全マス非表示でLock Out
  assert.equal(gameOver,true); assert.equal(lastRotationKick,null);
  assert.deepEqual(lastLockResult,{spin:"T_SPIN",lines:0});
`);
console.log("PASS: T-spin/full/mini corners in all orientations, both rotations and fifth kicks, movement history, drops/gravity, 0-3 clears, internal boundaries, lock delay and lifecycle resets.");

spinTests(`
  for(const startLevel of [1,2,5]) for(let lines=0;lines<=3;lines++) {
    setupFifthKick(lines); level=startLevel; totalLines=(startLevel-1)*10;
    hardDrop();
    assert.equal(score,[400,800,1200,1600][lines]*startLevel);
    assert.equal(Number(scoreElement.textContent),score);
    assert.equal(totalLines,(startLevel-1)*10+lines); assert.equal(level,startLevel);
  }
  // Miniの得点統合テスト。分類済み姿勢の周囲を消去数に応じて構成。
  function setupMiniClear(lines) {
    setupSpin(1,[0,2,3]);
    for(let dy=3-lines;dy<3;dy++) for(let x=0;x<COLS;x++) {
      if(!piece.shape[dy][x-piece.x]) board[piece.y+dy][x]=7;
    }
    assert.equal(collides(piece.shape,piece.x,piece.y),false);
    assert.equal(detectTSpin(),"T_SPIN_MINI");
  }
  for(const startLevel of [1,2,5]) for(let lines=0;lines<=2;lines++) {
    setupMiniClear(lines); level=startLevel; totalLines=(startLevel-1)*10;
    lockPiece();
    assert.deepEqual(lastLockResult,{spin:"T_SPIN_MINI",lines});
    assert.equal(score,[100,200,400][lines]*startLevel);
    assert.equal(totalLines,(startLevel-1)*10+lines); assert.equal(level,startLevel);
  }
  for(const [startLines,startLevel,lines,points,newLevel] of [[9,1,1,800,2],[19,2,2,2400,3]]) {
    setupFifthKick(lines); totalLines=startLines; level=startLevel;
    hardDrop(); assert.equal(score,points); assert.equal(totalLines,startLines+lines);
    assert.equal(level,newLevel); assert.equal(Number(levelElement.textContent),newLevel);
  }
  setupFifthKick(2); level=2; totalLines=10; hardDrop();
  assert.equal(score,2400); assert.notEqual(score,3000);
  for(const [lines,normal,spin] of [[1,300,2400],[2,900,3600]]) {
    setupFifthKick(lines); lastRotationKick=null; hardDrop(); assert.equal(score,normal);
    setupFifthKick(lines); hardDrop(); assert.equal(score,spin);
  }
  // Soft Dropで接近→回転→距離0のHard Dropなら資格とDrop点を両立できる。
  setupFifthKick(2);
  piece.x=5; piece.y=23; piece.rotation=0; piece.shape=ROTATIONS[2][0]; lastRotationKick=null;
  level=2; totalLines=10;
  for(let i=0;i<10;i++) stepDown(true);
  assert.equal(piece.y,33); assert.equal(score,10);
  assert.equal(move(-1,0),true);
  rotate(); assert.equal(lastRotationKick,4); hardDrop(); assert.equal(score,2410);
  // Hard Dropは即固定するため、実Dropで得た20点＋次のピースのT-Spinを確認。
  restart(); spawnPiece(1); piece.y=28; hardDrop(); assert.equal(score,20);
  const dropPoints=score;
  setupFifthKick(2); score=dropPoints; level=2; totalLines=10;
  hardDrop(); assert.equal(score,2420);
  setupFifthKick(2); score=4; hardDrop(); assert.equal(score,3604);
  // 想定外の分類・ライン数には未定義の得点を加えない。
  for(const [spin,lines] of [["T_SPIN",4],["T_SPIN_MINI",3],["NONE",5],["UNKNOWN",1]]) {
    assert.equal(calculateClearScore(spin,lines,2),0);
  }
  setupFifthKick(3); level=5; totalLines=40; hardDrop();
  assert.equal(score,8000); assert.ok(highScore>=8000);
  const record=highScore;
  endGame(); assert.equal(score,8000); assert.equal(highScore,record);
  restart(); assert.equal(score,0); assert.equal(totalLines,0); assert.equal(level,1);
  assert.equal(lastRotationKick,null); assert.equal(lastLockResult,null); assert.equal(highScore,record);
  setupSpin(0,[0,1,2],1,3,10); hardDrop();
  assert.equal(gameOver,true); assert.equal(score,0); // Lock Outの早期終了は維持
`);
console.log("PASS: full/mini scoring at levels 1/2/5, zero clears, pre-clear levels, no double awards, unscaled drop totals, invalid combinations and restart/top out.");

const spinScoreStorage = {};
const spinScoreA = createGame(spinScoreStorage);
const spinScoreB = createGame(spinScoreStorage);
const awardSpinZero = `
  spawnPiece(2); piece.x=3; piece.y=35;
  board[35][3]=7; board[35][5]=7; board[37][5]=7;
  rotate(); rotate(-1);
  assert.equal(detectTSpin(),"T_SPIN"); hardDrop();
`;
spinScoreA("level=5; totalLines=40;" + awardSpinZero + "assert.equal(score,2000)");
spinScoreB(awardSpinZero + "assert.equal(score,400); assert.equal(highScore,2000)");
assert.equal(spinScoreStorage["falling-block-high-score"],"2000");
createGame(spinScoreStorage)("assert.equal(highScore,2000)");
const failedSpinStorage = {};
Object.defineProperty(failedSpinStorage,"falling-block-high-score", {
  get() { return "0"; }, set() { throw new Error("Storage unavailable"); },
});
createGame(failedSpinStorage)(awardSpinZero + `
  assert.equal(score,400); assert.equal(highScore,400); assert.equal(gameOver,false);
  assert.equal(Number(scoreElement.textContent),400);
  restart(); assert.equal(highScore,400); assert.equal(score,0);
`);
console.log("PASS: T-spin scores through shared high-score storage, reload and write failure.");

// 盤面だけを各消去の配置へ組み直す。score/Level/B2Bは固定間で引き継ぐ。
const b2bFixtures = `
  function prepareB2BClear(spin, lines) {
    board=Array.from({length:TOTAL_ROWS},()=>Array(COLS).fill(0));
    spawnPiece(spin==="NONE" ? 0 : 2);
    if(spin==="NONE") {
      piece.rotation=1; piece.shape=ROTATIONS[0][1]; piece.x=2; piece.y=36;
      for(let y=40-lines;y<40;y++) { board[y].fill(7); board[y][4]=0; }
    } else if(spin==="T_SPIN") {
      piece.x=4; piece.y=33;
      const target=ROTATIONS[2][1];
      for(let dy=0;dy<3;dy++) for(let x=0;x<COLS;x++) {
        if(!target[dy][x-3]) board[35+dy][x]=7;
      }
      for(let row=0;row<3-lines;row++) board[35+row][0]=0;
      board[33][4]=7; board[38][4]=7;
      rotate(); assert.equal(lastRotationKick,4);
    } else {
      piece.x=3; piece.y=35; rotate();
      board[35][3]=7; board[37][5]=7; board[37][3]=7;
      for(let dy=3-lines;dy<3;dy++) for(let x=0;x<COLS;x++) {
        if(!piece.shape[dy][x-3]) board[35+dy][x]=7;
      }
    }
    board[0][0]=7; // B2B/Combo単独テストではPerfect Clearボーナスを含めない。
    assert.equal(collides(piece.shape,piece.x,piece.y),false);
    assert.equal(detectTSpin(),spin);
  }
  function finishB2BClear(spin,lines) {
    prepareB2BClear(spin,lines);
    const previous=score, previousLevel=level;
    const expectedCombo=lines>0 ? comboCount+1 : -1;
    lockPiece();
    assert.equal(comboCount,expectedCombo);
    assert.deepEqual(lastLockResult,{spin,lines});
    assert.equal(Number(scoreElement.textContent),score);
    // B2B固有の期待値を維持し、独立したCombo点を除いた増分を返す。
    return score-previous-Math.max(expectedCombo,0)*50*previousLevel;
  }
`;
const b2bStorage = {};
const b2bTests = createGame(b2bStorage);
b2bTests(b2bFixtures);
b2bTests(`
  assert.equal(backToBackActive,false);
  assert.equal(finishB2BClear("NONE",4),800); assert.equal(backToBackActive,true);
  assert.equal(finishB2BClear("NONE",4),1200); assert.equal(score,2050);
  restart(); finishB2BClear("NONE",4);
  for(let i=0;i<2;i++) {
    assert.equal(finishB2BClear("NONE",0),0); assert.equal(backToBackActive,true);
  }
  assert.equal(finishB2BClear("NONE",4),1200); assert.equal(score,2000);
  for(let lines=1;lines<=3;lines++) {
    restart(); finishB2BClear("NONE",4);
    assert.equal(finishB2BClear("NONE",lines),[0,100,300,500][lines]);
    assert.equal(backToBackActive,false);
    assert.equal(finishB2BClear("NONE",4),800);
  }
  for(const [first,firstLines,second,secondLines,firstScore,secondScore] of [
    ["NONE",4,"T_SPIN",2,800,1800],
    ["T_SPIN",2,"NONE",4,1200,1200],
    ["T_SPIN",1,"T_SPIN",2,800,1800],
    ["T_SPIN_MINI",1,"T_SPIN",3,200,2400],
    ["T_SPIN",1,"T_SPIN_MINI",1,800,300],
    ["NONE",4,"T_SPIN_MINI",2,800,600],
    ["T_SPIN_MINI",2,"NONE",4,400,1200],
  ]) {
    restart(); assert.equal(finishB2BClear(first,firstLines),firstScore);
    assert.equal(backToBackActive,true);
    assert.equal(finishB2BClear(second,secondLines),secondScore);
    assert.equal(backToBackActive,true);
  }
  for(const spin of ["T_SPIN","T_SPIN_MINI"]) for(const active of [false,true]) {
    restart(); if(active) finishB2BClear("NONE",4);
    const beforeLines=totalLines, beforeLevel=level;
    assert.equal(finishB2BClear(spin,0),spin==="T_SPIN" ? 400 : 100);
    assert.equal(backToBackActive,active);
    assert.equal(totalLines,beforeLines); assert.equal(level,beforeLevel);
    assert.equal(finishB2BClear("NONE",4),active ? 1200 : 800);
  }
  restart(); level=3; totalLines=20;
  assert.equal(finishB2BClear("NONE",4),2400);
  assert.equal(finishB2BClear("NONE",4),3600);
  restart(); level=2; totalLines=10; finishB2BClear("NONE",4);
  assert.equal(finishB2BClear("T_SPIN",2),3600); // 二重得点・二重Level倍率なし
  restart(); level=3; totalLines=20; finishB2BClear("NONE",4);
  assert.equal(finishB2BClear("T_SPIN",2),5400);
  for(const active of [false,true]) {
    restart(); if(active) finishB2BClear("NONE",4);
    totalLines=9; level=1;
    assert.equal(finishB2BClear("T_SPIN",1),active ? 1200 : 800);
    assert.equal(totalLines,10); assert.equal(level,2);
  }
  // B2B中の実Hard Drop 10マス→次のT-Spin。得点は途中で書き換えない。
  restart(); level=2; totalLines=10; finishB2BClear("NONE",4);
  prepareB2BClear("NONE",0); piece.y-=10;
  const beforeDrop=score; hardDrop();
  assert.equal(score-beforeDrop,20); assert.equal(backToBackActive,true);
  finishB2BClear("T_SPIN",2); assert.equal(score-beforeDrop,3620);
  // 同じピースでSoft DropしてからKick。Drop点へ倍率を掛けない。
  prepareB2BClear("T_SPIN",2);
  piece.x=5; piece.y=23; piece.rotation=0; piece.shape=ROTATIONS[2][0]; lastRotationKick=null;
  const beforeSoft=score;
  for(let i=0;i<10;i++) stepDown(true);
  assert.equal(score-beforeSoft,10); assert.equal(piece.y,33);
  assert.equal(move(-1,0),true); rotate(); hardDrop();
  assert.equal(score-beforeSoft,3710);
  // HOLD/Spawn/Pauseではチェーンを失わない。
  hold(); assert.equal(backToBackActive,true);
  togglePause(0); togglePause(1000); assert.equal(backToBackActive,true);
  const record=highScore, finalScore=score;
  endGame(); assert.equal(score,finalScore); assert.equal(highScore,record);
  restart(); assert.equal(backToBackActive,false); assert.equal(highScore,record);
  assert.equal(finishB2BClear("NONE",4),800);
  restart(); assert.equal(backToBackActive,false);
  assert.equal(finishB2BClear("NONE",4),800);
  // 対象外の分類にB2Bを付けない。
  assert.equal(isDifficultClear("T_SPIN",4),false);
  assert.equal(isDifficultClear("T_SPIN_MINI",3),false);
`);
const b2bReload = createGame(b2bStorage);
b2bReload("assert.ok(highScore>0); assert.equal(backToBackActive,false)");
const sharedB2B = {};
const b2bA=createGame(sharedB2B), b2bB=createGame(sharedB2B);
for(const game of [b2bA,b2bB]) game(b2bFixtures);
b2bA('finishB2BClear("NONE",4); finishB2BClear("NONE",4); assert.equal(highScore,2050)');
b2bB('finishB2BClear("NONE",4); assert.equal(highScore,2050)');
assert.equal(sharedB2B["falling-block-high-score"],"2050");
const failedB2B = {};
Object.defineProperty(failedB2B,"falling-block-high-score", {
  get() { return "0"; }, set() { throw new Error("Storage unavailable"); },
});
createGame(failedB2B)(b2bFixtures + `
  finishB2BClear("NONE",4); finishB2BClear("NONE",4);
  assert.equal(score,2050); assert.equal(highScore,2050); assert.equal(gameOver,false);
`);
console.log("PASS: B2B start/continue/break, empty placements, mixed full/mini clears, levels, unscaled drops, lifecycle and high-score storage.");

const comboStorage = {};
const comboTests = createGame(comboStorage);
comboTests(b2bFixtures + `
  // Comboテストは控除せず、生の得点増分・状態を毎回確認する。
  function checkCombo(spin,lines,points,count,b2b) {
    prepareB2BClear(spin,lines);
    const previous=score;
    lockPiece();
    assert.equal(score-previous,points);
    assert.equal(comboCount,count); assert.equal(backToBackActive,b2b);
    assert.deepEqual(lastLockResult,{spin,lines});
    assert.equal(Number(scoreElement.textContent),score);
  }
  assert.equal(comboCount,-1);
  checkCombo("NONE",1,100,0,false);
  checkCombo("NONE",1,150,1,false); assert.equal(score,250);
  checkCombo("NONE",1,200,2,false);
  checkCombo("NONE",1,250,3,false);
  restart();
  for(const [lines,points,count,b2b] of [[1,100,0,false],[2,350,1,false],[3,600,2,false],[4,950,3,true]]) {
    checkCombo("NONE",lines,points,count,b2b);
  }
  for(const spin of ["NONE","T_SPIN","T_SPIN_MINI"]) {
    restart(); checkCombo("NONE",1,100,0,false); checkCombo("NONE",1,150,1,false);
    checkCombo(spin,0,spin==="NONE" ? 0 : spin==="T_SPIN" ? 400 : 100,-1,false);
    checkCombo("NONE",1,100,0,false);
    restart(); checkCombo("NONE",4,800,0,true);
    checkCombo(spin,0,spin==="NONE" ? 0 : spin==="T_SPIN" ? 400 : 100,-1,true);
    checkCombo("NONE",4,1200,0,true);
  }
  restart();
  checkCombo("NONE",1,100,0,false);
  checkCombo("T_SPIN",2,1250,1,true);
  checkCombo("NONE",4,1300,2,true);
  checkCombo("T_SPIN",1,1350,3,true);
  checkCombo("T_SPIN_MINI",1,500,4,true);
  checkCombo("T_SPIN_MINI",2,850,5,true);
  restart(); checkCombo("NONE",4,800,0,true); checkCombo("T_SPIN",2,1850,1,true);
  restart(); checkCombo("NONE",4,800,0,true);
  checkCombo("NONE",1,150,1,false); checkCombo("NONE",2,400,2,false);
  restart(); level=2; totalLines=10;
  checkCombo("NONE",4,1600,0,true); checkCombo("T_SPIN",2,3700,1,true);
  restart(); level=3; totalLines=20;
  checkCombo("NONE",1,300,0,false); checkCombo("NONE",1,450,1,false);
  checkCombo("NONE",2,1200,2,false); checkCombo("NONE",1,750,3,false);
  restart(); totalLines=8;
  checkCombo("NONE",1,100,0,false); checkCombo("NONE",1,150,1,false);
  assert.equal(totalLines,10); assert.equal(level,2);
  // 10回の連続消去。各回の増分を独立した期待値で確認。
  restart();
  for(let i=0;i<10;i++) checkCombo("NONE",1,100+50*i,i,false);
  assert.equal(score,3250); assert.equal(totalLines,10); assert.equal(level,2);
  // 固定しない操作・HOLD・PauseではComboを変更しない。
  spawnPiece(2); move(-1,0); rotate(); rotate(-1); stepDown(true); ghostY();
  assert.equal(comboCount,9);
  hold(); assert.equal(comboCount,9);
  togglePause(0); togglePause(0); assert.equal(comboCount,9);
  const record=highScore, previousScore=score;
  endGame(); assert.equal(score,previousScore); assert.equal(highScore,record);
  restart(); assert.equal(comboCount,-1); assert.equal(highScore,record);
  checkCombo("NONE",1,100,0,false);
  restart(); assert.equal(comboCount,-1); checkCombo("NONE",1,100,0,false);
  // Hard Drop点・Soft Drop点はLevel/B2B/Comboで増幅しない。
  restart(); level=2; totalLines=10; checkCombo("NONE",1,200,0,false);
  prepareB2BClear("NONE",2); piece.y-=10;
  const beforeDrop=score; hardDrop();
  assert.equal(score-beforeDrop,720); assert.equal(comboCount,1);
  restart(); level=2; totalLines=10; checkCombo("NONE",4,1600,0,true);
  prepareB2BClear("T_SPIN",2);
  piece.x=5; piece.y=23; piece.rotation=0; piece.shape=ROTATIONS[2][0]; lastRotationKick=null;
  const beforeSoft=score;
  for(let i=0;i<10;i++) stepDown(true);
  assert.equal(score-beforeSoft,10); assert.equal(comboCount,0);
  move(-1,0); rotate(); assert.equal(lastRotationKick,4); hardDrop();
  assert.equal(score-beforeSoft,3710); assert.equal(comboCount,1);
  // Lock Outでは従来の早期終了を維持し、得点を追加しない。
  prepareB2BClear("NONE",0); piece.y=10;
  const beforeOut=score; lockPiece(); assert.equal(gameOver,true); assert.equal(score,beforeOut);
  restart(); assert.equal(comboCount,-1);
`);
const comboAStorage = {};
const comboA=createGame(comboAStorage), comboB=createGame(comboAStorage);
for(const game of [comboA,comboB]) game(b2bFixtures);
comboA('finishB2BClear("NONE",1); finishB2BClear("NONE",1); assert.equal(score,250); assert.equal(highScore,250)');
comboB('finishB2BClear("NONE",1); assert.equal(highScore,250)');
assert.equal(comboAStorage["falling-block-high-score"],"250");
createGame(comboAStorage)('assert.equal(highScore,250); assert.equal(comboCount,-1)');
const failedCombo = {};
Object.defineProperty(failedCombo,"falling-block-high-score", {
  get() { return "0"; }, set() { throw new Error("Storage unavailable"); },
});
createGame(failedCombo)(b2bFixtures + `
  finishB2BClear("NONE",1); finishB2BClear("NONE",1);
  assert.equal(score,250); assert.equal(highScore,250); assert.equal(gameOver,false);
  restart(); assert.equal(highScore,250); assert.equal(comboCount,-1);
`);
console.log("PASS: Combo progression, ten clears, zero/spin-zero breaks, mixed clears, independent B2B, pre-clear level, unscaled drops, lifecycle and storage.");

const uiTests = createGame();
uiTests(b2bFixtures + `
  function checkUI() {
    assert.equal(linesElement.textContent,totalLines+" / "+MARATHON_TARGET_LINES);
    assert.equal(b2bElement.textContent,backToBackActive ? "B2B ON" : "B2B OFF");
    assert.equal(comboElement.textContent,!gameOver && comboCount>0 ? "COMBO "+comboCount : "");
  }
  restart(); checkUI(); assert.equal(linesElement.textContent,"0 / 150");
  for(const [spin,maximum] of [["NONE",4],["T_SPIN",3],["T_SPIN_MINI",2]]) {
    for(let lines=0;lines<=maximum;lines++) {
      restart(); finishB2BClear(spin,lines); checkUI();
      assert.equal(linesElement.textContent,lines+" / 150");
      const expected=spin==="NONE" ? "" : (spin==="T_SPIN" ? "T-SPIN" : "T-SPIN MINI")+[""," SINGLE"," DOUBLE"," TRIPLE"][lines];
      assert.equal(clearEventElement.textContent,expected);
    }
  }
  restart();
  for(let i=0;i<3;i++) { finishB2BClear("NONE",1); checkUI(); }
  assert.equal(comboElement.textContent,"COMBO 2");
  assert.equal(linesElement.textContent,"3 / 150");
  finishB2BClear("NONE",0); checkUI(); assert.equal(comboElement.textContent,"");
  restart(); finishB2BClear("NONE",4); checkUI();
  assert.equal(score,800); assert.equal(b2bElement.textContent,"B2B ON");
  finishB2BClear("NONE",1); checkUI();
  assert.equal(b2bElement.textContent,"B2B OFF"); assert.equal(comboElement.textContent,"COMBO 1");
  restart(); finishB2BClear("NONE",4); finishB2BClear("NONE",0); checkUI();
  assert.equal(b2bElement.textContent,"B2B ON"); assert.equal(comboElement.textContent,"");
  finishB2BClear("NONE",4); checkUI(); assert.equal(b2bElement.textContent,"B2B ON");
  finishB2BClear("NONE",4); checkUI(); assert.equal(comboElement.textContent,"COMBO 1");
  finishB2BClear("T_SPIN",0); checkUI(); assert.equal(comboElement.textContent,"");

  // 古い通知の期限が新しい通知を消さない。表示時計はゲーム時計と独立。
  restart(); finishB2BClear("T_SPIN",1);
  advanceDisplayTime(600); finishB2BClear("T_SPIN_MINI",1);
  advanceDisplayTime(600); assert.equal(clearEventElement.textContent,"T-SPIN MINI SINGLE");
  advanceDisplayTime(599); assert.notEqual(clearEventElement.textContent,"");
  const before=JSON.stringify({score,totalLines,level,highScore,lockElapsed,dropElapsed,lastTime,backToBackActive,comboCount});
  advanceDisplayTime(1); assert.equal(clearEventElement.textContent,"");
  assert.equal(JSON.stringify({score,totalLines,level,highScore,lockElapsed,dropElapsed,lastTime,backToBackActive,comboCount}),before);
  finishB2BClear("T_SPIN",2); finishB2BClear("NONE",1);
  assert.equal(clearEventElement.textContent,"");
  finishB2BClear("T_SPIN",1); togglePause();
  advanceDisplayTime(1200); assert.equal(clearEventElement.textContent,""); assert.ok(paused);
  togglePause(); checkUI();
  finishB2BClear("T_SPIN",1); restart(); checkUI();
  assert.equal(linesElement.textContent,"0 / 150"); assert.equal(b2bElement.textContent,"B2B OFF");
  assert.equal(comboElement.textContent,""); assert.equal(clearEventElement.textContent,"");
  advanceDisplayTime(1200); assert.equal(clearEventElement.textContent,"");
  finishB2BClear("T_SPIN",1); finishB2BClear("T_SPIN",1);
  const finalScore=score, finalLines=totalLines;
  endGame(); checkUI(); assert.equal(clearEventElement.textContent,""); assert.equal(comboElement.textContent,"");
  assert.equal(score,finalScore); assert.equal(totalLines,finalLines);
  advanceDisplayTime(1200); assert.equal(clearEventElement.textContent,"");
`);
console.log("PASS: LINES, independent B2B/Combo display, full/mini feedback, replacement/expiry, pause, restart and game over without score/timer changes.");

const gravityTests = createGame();
gravityTests(`
  function closeTo(actual, expected, tolerance = 1) {
    assert.ok(Math.abs(actual - expected) <= tolerance, actual + " is not close to " + expected);
  }
  closeTo(getGravityInterval(1), 1000);
  closeTo(getGravityInterval(5), 355);
  closeTo(getGravityInterval(10), 64);
  closeTo(getGravityInterval(15), 7);
  for (let currentLevel = 1; currentLevel < 15; currentLevel++) {
    assert.ok(getGravityInterval(currentLevel + 1) < getGravityInterval(currentLevel));
  }
  assert.equal(getGravityInterval(16), getGravityInterval(15));
  assert.equal(getGravityInterval(30), getGravityInterval(15));

  // 60fps相当の1フレームでも、高Levelなら複数マスを1マスずつ進める。
  restart(); spawnPiece(1); level = 15; update(0);
  const fastInterval = getGravityInterval();
  const startY = piece.y;
  update(16.7);
  assert.ok(piece.y - startY >= 2);
  assert.ok(!collides(piece.shape, piece.x, piece.y));

  // 床へ着地したフレームの余りはLock Delayへ入れない。
  restart(); spawnPiece(1); level = 15; piece.y = TOTAL_ROWS - 3; update(0);
  const landingTime = fastInterval * 10;
  update(landingTime);
  assert.equal(piece.y, TOTAL_ROWS - 2);
  assert.ok(isGrounded());
  assert.equal(lockElapsed, 0);
  assert.equal(board.flat().filter(Boolean).length, 0);
  update(landingTime + 499); assert.equal(board.flat().filter(Boolean).length, 0);
  update(landingTime + 500); assert.equal(board.flat().filter(Boolean).length, 4);

  // 固定ブロックも飛び越えない。
  restart(); level = 15;
  piece = { rotation: 0, shape: [[1]], x: 4, y: 30, color: 1 };
  board[32][4] = 7; update(0); update(fastInterval * 10);
  assert.equal(piece.y, 31);
  assert.ok(isGrounded());
  assert.equal(lockElapsed, 0);
  assert.equal(board[32][4], 7);

  // 同じ300msなら、更新頻度が違っても同じ距離と余りになる。
  function simulateFrames(frameLength) {
    restart(); spawnPiece(1); level = 10; update(0);
    let time = 0;
    while (time < 300) {
      time = Math.min(300, time + frameLength);
      update(time);
    }
    return { y: piece.y, remainder: dropElapsed };
  }
  const frameResults = [16.7, 50, 100, 300].map(simulateFrames);
  for (const result of frameResults) {
    assert.equal(result.y, frameResults[0].y);
    closeTo(result.remainder, frameResults[0].remainder, 0.001);
  }

  // Pause時間を復帰後のGravityへ加算しない。
  restart(); spawnPiece(1); level = 15; update(0); update(fastInterval * 2);
  const pausedY = piece.y;
  togglePause(fastInterval * 2); update(10000);
  assert.equal(piece.y, pausedY);
  togglePause(20000);
  update(20000 + fastInterval - 0.001); assert.equal(piece.y, pausedY);
  update(20000 + fastInterval + 0.001); assert.equal(piece.y, pausedY + 1);

  // RestartはLevel 1と空のGravity accumulatorへ戻す。
  level = 15; dropElapsed = 5; restart();
  assert.equal(level, 1); assert.equal(dropElapsed, 0); assert.equal(getGravityInterval(), 1000);
`);
console.log("PASS: nonlinear Marathon gravity values/cap, multi-row frames, collision safety, lock boundary, frame-rate consistency, pause and restart.");

const debugLevelStorage = { "falling-block-high-score": "500" };
const debugLevelTests = createGame(debugLevelStorage);
debugLevelTests(`
  function selectDebugLevel(value) {
    startDebugLevel(value);
  }
  const expectedIntervals = { 1: 1000, 5: 355, 10: 64, 13: 18, 15: 7 };
  for (const selected of [1, 5, 10, 13, 15]) {
    selectDebugLevel(selected);
    assert.equal(selectedStartLevel, selected);
    assert.equal(level, selected);
    assert.equal(totalLines, (selected - 1) * 10);
    assert.equal(Number(levelElement.textContent), selected);
    assert.equal(linesElement.textContent, ((selected - 1) * 10)+" / 150");
    assert.ok(Math.abs(getGravityInterval() - expectedIntervals[selected]) < 1);
    assert.equal(score, 0);
    assert.equal(board.flat().filter(Boolean).length, 0);
    assert.equal(heldType, null);
    assert.equal(holdUsed, false);
    assert.equal(backToBackActive, false);
    assert.equal(comboCount, -1);
    assert.equal(paused, false);
    assert.equal(dropElapsed, 0);
    assert.equal(lockElapsed, 0);
    assert.equal(lockResets, 0);
    assert.equal(nextQueue.length, NEXT_COUNT);
  }

  // Level変更は盤面・入力・HOLD・連鎖・表示・各タイマーを新ゲームへ戻す。
  selectDebugLevel(5); update(0); press("ArrowDown", 1);
  heldType = 2; holdUsed = true; backToBackActive = true; comboCount = 3;
  board[TOTAL_ROWS - 1][0] = 7; lockElapsed = 300; lockResets = 8;
  lastLockResult = { spin: "T_SPIN", lines: 1 }; showSpinFeedback();
  selectDebugLevel(13);
  assert.ok(Object.values(heldKeys).every(value => !value));
  assert.equal(nextHorizontalTime, Infinity); assert.equal(nextSoftDropTime, Infinity);
  assert.equal(board.flat().filter(Boolean).length, 0);
  assert.equal(heldType, null); assert.equal(holdUsed, false);
  assert.equal(backToBackActive, false); assert.equal(comboCount, -1);
  assert.equal(clearEventElement.textContent, "");
  assert.equal(lastLockResult, null); assert.equal(lastTime, null);
  assert.equal(dropElapsed, 0); assert.equal(lockElapsed, 0); assert.equal(lockResets, 0);

  // RestartとGame Over後も、選択中の開始Levelを維持する。
  addScore(50); hardDrop(); restart();
  assert.equal(level, 13); assert.equal(totalLines, 120); assert.equal(score, 0);
  endGame(); assert.ok(gameOver); key("KeyR");
  assert.equal(gameOver, false); assert.equal(level, 13); assert.equal(totalLines, 120);

  // Pause中の選択も、Pause解除済みの新ゲームとして開始する。
  update(0); key("KeyP"); assert.ok(paused);
  selectDebugLevel(10);
  assert.equal(paused, false); assert.equal(level, 10); assert.equal(statusElement.textContent, "プレイ中");

  // 選択Levelを得点倍率に使い、通常のLevel進行も継続する。
  function clearSingle() {
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    board[TOTAL_ROWS - 1].fill(7); board[TOTAL_ROWS - 1][4] = 0;
    piece = { rotation: 1, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
    lastRotationKick = null;
    lockPiece();
  }
  selectDebugLevel(10); clearSingle();
  assert.equal(score, 1000); assert.equal(totalLines, 91); assert.equal(level, 10);
  selectDebugLevel(5);
  for (let count = 0; count < 10; count++) clearSingle();
  assert.equal(totalLines, 50); assert.equal(level, 6);

  // 高Level試遊のScoreは表示するが、通常High Scoreは変更しない。
  selectDebugLevel(15); addScore(2000);
  assert.equal(score, 2000); assert.equal(highScore, 500);
  assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");
  restart(); assert.equal(highScore, 500); assert.equal(score, 0); assert.equal(level, 15);
  selectDebugLevel(1); addScore(600);
  assert.equal(highScore, 600); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "600");
  restart(); assert.equal(level, 1); assert.equal(totalLines, 0); assert.equal(highScore, 600);
`);
console.log("PASS: debug Level 1/5/10/13/15 selection, full restart state, gravity, progression, score multiplier and high-score isolation.");

const marathonStorage = {};
const marathonTests = createGame(marathonStorage);
marathonTests(`
  function prepareMarathonClear(startLines, cleared) {
    restart();
    totalLines = startLines;
    level = Math.floor(totalLines / 10) + 1;
    levelElement.textContent = level;
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    board[0][0] = 7; // Marathon単独テストではPerfect Clearボーナスを含めない。
    for (let y = TOTAL_ROWS - cleared; y < TOTAL_ROWS; y++) {
      board[y].fill(7);
      board[y][4] = 0;
    }
    piece = { rotation: 1, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
    lastRotationKick = null;
  }

  // 150ちょうどでも、複数ラインで飛び越しても、得点後に終了する。
  prepareMarathonClear(149, 1);
  let queueBefore = nextQueue.slice();
  let bagBefore = bag.slice();
  const pieceBefore = piece;
  lockPiece();
  assert.equal(totalLines, 150); assert.equal(level, 16); assert.equal(score, 1500);
  assert.equal(marathonComplete, true); assert.equal(gameOver, false);
  assert.equal(piece, pieceBefore); assert.deepEqual(nextQueue, queueBefore); assert.deepEqual(bag, bagBefore);
  assert.match(statusElement.textContent, /MARATHON COMPLETE/); assert.equal(pauseButton.disabled, true);

  prepareMarathonClear(148, 2); lockPiece();
  assert.equal(totalLines, 150); assert.equal(score, 4500); assert.equal(marathonComplete, true);
  prepareMarathonClear(148, 4); lockPiece();
  assert.equal(totalLines, 152); assert.equal(score, 12000); assert.equal(marathonComplete, true);

  // 最終T-SpinにもB2B・Combo・消去前Levelをすべて適用する。
  prepareMarathonClear(149, 1);
  detectTSpin = () => "T_SPIN";
  backToBackActive = true; comboCount = 0; addScore(20);
  queueBefore = nextQueue.slice();
  lockPiece();
  assert.equal(score, 20 + 800 * 15 * 3 / 2 + 50 * 15);
  assert.equal(totalLines, 150); assert.equal(level, 16); assert.equal(marathonComplete, true);
  assert.deepEqual(nextQueue, queueBefore);
  assert.equal(lastLockResult.spin, "T_SPIN"); assert.equal(lastLockResult.lines, 1);
  assert.equal(clearEventElement.textContent, "");
  assert.equal(Number(localStorage.getItem(HIGH_SCORE_KEY)), score);

  // T-Spin 0と通常の0ライン固定は149ラインのまま継続する。
  prepareMarathonClear(149, 0);
  detectTSpin = () => "T_SPIN";
  lockPiece();
  assert.equal(totalLines, 149); assert.equal(score, 400 * 15);
  assert.equal(marathonComplete, false); assert.equal(gameOver, false);
  prepareMarathonClear(149, 0);
  detectTSpin = () => "NONE";
  lockPiece();
  assert.equal(totalLines, 149); assert.equal(score, 0); assert.equal(marathonComplete, false);

  // Complete時に長押しを解除し、Restart以外の操作では状態を変えない。
  prepareMarathonClear(149, 1);
  heldKeys.ArrowLeft = heldKeys.ArrowDown = true;
  activeDirection = "ArrowLeft"; nextHorizontalTime = 10; nextSoftDropTime = 10;
  lockPiece();
  assert.ok(Object.values(heldKeys).every(value => !value));
  assert.equal(activeDirection, null); assert.equal(nextHorizontalTime, Infinity); assert.equal(nextSoftDropTime, Infinity);
  const frozenBoard = JSON.stringify(board);
  const frozenPiece = JSON.stringify(piece);
  const frozenScore = score;
  const frozenLines = totalLines;
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyZ", "ArrowDown", "Space", "KeyC", "KeyP"]) key(code);
  update(10000);
  assert.equal(JSON.stringify(board), frozenBoard); assert.equal(JSON.stringify(piece), frozenPiece);
  assert.equal(score, frozenScore); assert.equal(totalLines, frozenLines);
  assert.equal(paused, false); assert.match(statusElement.textContent, /MARATHON COMPLETE/);
  key("KeyR");
  assert.equal(marathonComplete, false); assert.equal(gameOver, false); assert.equal(score, 0);
  assert.equal(totalLines, 0); assert.equal(level, 1); assert.equal(pauseButton.disabled, false);
  prepareMarathonClear(149, 1); lockPiece();
  document.getElementById("restart").click();
  assert.equal(marathonComplete, false); assert.equal(totalLines, 0); assert.equal(level, 1);

  // Game Overとは排他的な終了状態にする。
  endGame();
  assert.equal(gameOver, true); assert.equal(marathonComplete, false);
`);

const debugMarathonStorage = { "falling-block-high-score": "500" };
const debugMarathonTests = createGame(debugMarathonStorage);
debugMarathonTests(`
  startDebugLevel(15);
  assert.equal(totalLines, 140); assert.equal(level, 15);
  totalLines = 149; level = 15;
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[TOTAL_ROWS - 1].fill(7); board[TOTAL_ROWS - 1][4] = 0;
  piece = { rotation: 1, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
  lockPiece();
  assert.equal(marathonComplete, true); assert.equal(totalLines, 150); assert.equal(level, 16);
  assert.equal(highScore, 500); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");
  restart();
  assert.equal(marathonComplete, false); assert.equal(totalLines, 140); assert.equal(level, 15);
  startDebugLevel(13);
  assert.equal(marathonComplete, false); assert.equal(totalLines, 120); assert.equal(level, 13);
`);
console.log("PASS: Marathon Complete at 150+, final scoring/B2B/Combo, no spawn, frozen input, restart, Game Over separation and debug high-score isolation.");

const resultsStorage = { "falling-block-high-score": "1000" };
const resultsTests = createGame(resultsStorage);
resultsTests(`
  function assertResults(title, expectedScore, expectedLines, expectedLevel, expectedHighScore, debug = "") {
    assert.equal(resultsElement.hidden, false);
    assert.equal(resultsTitleElement.textContent, title);
    assert.equal(Number(resultsScoreElement.textContent), expectedScore);
    assert.equal(Number(resultsLinesElement.textContent), expectedLines);
    assert.equal(Number(resultsLevelElement.textContent), expectedLevel);
    assert.equal(Number(resultsHighScoreElement.textContent), expectedHighScore);
    assert.equal(resultsDebugElement.textContent, debug);
  }
  restart();

  // 通常プレイとPauseではResultsを表示しない。
  assert.equal(resultsElement.hidden, true);
  key("KeyP"); assert.equal(paused, true); assert.equal(resultsElement.hidden, true);
  key("KeyP"); assert.equal(paused, false); assert.equal(resultsElement.hidden, true);

  // Game Overは終了時の既存状態と更新済みHigh Scoreを表示する。
  addScore(1200); totalLines = 37; level = 4; levelElement.textContent = level;
  endGame();
  assertResults("GAME OVER", 1200, 37, 4, 1200);
  assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "1200");
  const frozen = [JSON.stringify(board), JSON.stringify(piece), score, totalLines, level];
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyZ", "ArrowDown", "Space", "KeyC"]) key(code);
  assert.deepEqual([JSON.stringify(board), JSON.stringify(piece), score, totalLines, level], frozen);

  // PLAY AGAINは既存Restartを使い、Resultsを消して入力も戻す。
  document.getElementById("play-again").click();
  assert.equal(resultsElement.hidden, true); assert.equal(gameOver, false); assert.equal(marathonComplete, false);
  const startX = piece.x; key("ArrowLeft"); assert.equal(piece.x, startX - 1);

  // 150を超えた最終値と最終T-Spin得点をそのまま表示する。
  restart(); totalLines = 148; level = 15;
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[0][0] = 7;
  for (let y = TOTAL_ROWS - 4; y < TOTAL_ROWS; y++) { board[y].fill(7); board[y][4] = 0; }
  piece = { rotation: 1, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
  lockPiece();
  assertResults("MARATHON COMPLETE", 12000, 152, 16, 12000);

  restart(); totalLines = 149; level = 15;
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[0][0] = 7;
  board[TOTAL_ROWS - 1].fill(7); board[TOTAL_ROWS - 1][4] = 0;
  piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 3 };
  detectTSpin = () => "T_SPIN";
  lockPiece();
  assertResults("MARATHON COMPLETE", 12000, 150, 16, 12000);
  assert.equal(clearEventElement.textContent, "");
  key("KeyR"); assert.equal(resultsElement.hidden, true);
`);

const debugResultsStorage = { "falling-block-high-score": "500" };
const debugResultsTests = createGame(debugResultsStorage);
debugResultsTests(`
  startDebugLevel(15);
  totalLines = 149; level = 15; addScore(2000);
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[0][0] = 7;
  board[TOTAL_ROWS - 1].fill(7); board[TOTAL_ROWS - 1][4] = 0;
  piece = { rotation: 1, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
  lockPiece();
  assert.equal(resultsElement.hidden, false);
  assert.equal(resultsTitleElement.textContent, "MARATHON COMPLETE");
  assert.equal(resultsDebugElement.textContent, "DEBUG RUN");
  assert.equal(Number(resultsScoreElement.textContent), 3500);
  assert.equal(Number(resultsLinesElement.textContent), 150);
  assert.equal(Number(resultsLevelElement.textContent), 16);
  assert.equal(Number(resultsHighScoreElement.textContent), 500);
  assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");
  startDebugLevel(13);
  assert.equal(resultsElement.hidden, true); assert.equal(level, 13); assert.equal(totalLines, 120);
`);
console.log("PASS: Results visibility, Game Over/Complete titles, final values, high score, debug label, frozen input and shared Restart paths.");

const perfectClearStorage = {};
const perfectClearTests = createGame(perfectClearStorage);
perfectClearTests(`
  const originalDetectTSpin = detectTSpin;
  function preparePerfectClear(lines, startLevel = 1, startLines = (startLevel - 1) * 10) {
    restart();
    level = startLevel; totalLines = startLines; levelElement.textContent = level;
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    const shapes = {
      1: [[1,1,1,1]],
      2: [[1,1],[1,1]],
      3: [[1,0],[1,1],[1,0]],
      4: [[1],[1],[1],[1]],
    };
    const shape = shapes[lines];
    piece = { rotation: 0, shape, x: 4, y: TOTAL_ROWS - lines, color: lines === 3 ? 3 : lines === 2 ? 2 : 1 };
    for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) board[y].fill(7);
    shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) board[piece.y + dy][piece.x + dx] = 0;
    }));
    lastRotationKick = null;
  }

  // 1～4ラインの判定と代表的な追加得点。
  for (const [startLevel, expected] of [
    [1, [0,900,1500,2300,2800]],
    [2, [0,1800,3000,4600,5600]],
  ]) for (let lines = 1; lines <= 4; lines++) {
    preparePerfectClear(lines, startLevel);
    lockPiece();
    assert.equal(lastPerfectClear, true);
    assert.equal(score, expected[lines]);
    assert.equal(board.length, TOTAL_ROWS);
    assert.ok(board.every(row => row.length === COLS && row.every(cell => cell === 0)));
    assert.equal(gameOver, false); assert.equal(marathonComplete, false);
    assert.ok(piece); // Completeでなければ次ピースを通常Spawnする。
    assert.equal(clearEventElement.textContent, "PERFECT CLEAR");
  }

  // 表示領域が空でもhidden rowに残れば不成立。可視領域の1ブロック・0ラインも不成立。
  preparePerfectClear(1); board[0][0] = 7; lockPiece();
  assert.equal(lastPerfectClear, false); assert.equal(score, 100);
  preparePerfectClear(1); board[HIDDEN_ROWS][0] = 7; lockPiece();
  assert.equal(lastPerfectClear, false); assert.equal(score, 100);
  restart(); spawnPiece(1); piece.y = TOTAL_ROWS - 2; lockPiece();
  assert.equal(lastLockResult.lines, 0); assert.equal(lastPerfectClear, false); assert.equal(score, 0);

  // B2B適用済み通常Tetrisだけ3200を使い、最初のTetrisは2000を使う。
  preparePerfectClear(4); lockPiece();
  assert.equal(score, 2800); assert.equal(backToBackActive, true);
  preparePerfectClear(4); backToBackActive = true; lockPiece();
  assert.equal(score, 4400); assert.equal(backToBackActive, true);

  // T-Spin部分だけにB2B倍率を掛け、Double PCは通常の1200を加算する。
  preparePerfectClear(2, 2); detectTSpin = () => "T_SPIN";
  backToBackActive = true; lockPiece();
  assert.equal(lastLockResult.spin, "T_SPIN"); assert.equal(lastPerfectClear, true);
  assert.equal(score, 6000);
  assert.equal(clearEventElement.textContent, "PERFECT CLEAR · T-SPIN DOUBLE");
  detectTSpin = originalDetectTSpin;

  // Comboは独立加算し、Level境界では消去前Levelを両方の得点へ使う。
  preparePerfectClear(1); comboCount = 0; lockPiece();
  assert.equal(score, 950); assert.equal(comboCount, 1);
  preparePerfectClear(1, 1, 9); lockPiece();
  assert.equal(score, 900); assert.equal(totalLines, 10); assert.equal(level, 2);

  // Restartは表示状態とtimerを消し、前ゲームのtimerも新ゲームへ干渉しない。
  preparePerfectClear(1); lockPiece(); assert.equal(clearEventElement.textContent, "PERFECT CLEAR");
  restart(); assert.equal(lastPerfectClear, false); assert.equal(clearEventElement.textContent, "");
  advanceDisplayTime(CLEAR_EVENT_DURATION); assert.equal(clearEventElement.textContent, "");

  // Marathonの最終得点・High Score・ResultsへPCボーナスを反映する。
  preparePerfectClear(1, 15, 149); lockPiece();
  assert.equal(lastPerfectClear, true); assert.equal(score, 13500);
  assert.equal(totalLines, 150); assert.equal(level, 16); assert.equal(marathonComplete, true);
  assert.equal(highScore, 13500); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "13500");
  assert.equal(Number(resultsScoreElement.textContent), 13500);
  assert.equal(clearEventElement.textContent, "PERFECT CLEAR");

  preparePerfectClear(4, 15, 148); lockPiece();
  assert.equal(score, 42000); assert.equal(totalLines, 152); assert.equal(marathonComplete, true);
  assert.equal(Number(resultsScoreElement.textContent), 42000);
  assert.equal(Number(resultsLinesElement.textContent), 152);
`);

const debugPerfectClearStorage = { "falling-block-high-score": "500" };
const debugPerfectClearTests = createGame(debugPerfectClearStorage);
debugPerfectClearTests(`
  startDebugLevel(5);
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[TOTAL_ROWS - 1].fill(7);
  for (let x = 3; x < 7; x++) board[TOTAL_ROWS - 1][x] = 0;
  piece = { rotation: 0, shape: [[1,1,1,1]], x: 3, y: TOTAL_ROWS - 1, color: 1 };
  lockPiece();
  assert.equal(lastPerfectClear, true); assert.equal(score, 4500);
  assert.equal(highScore, 500); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");
`);
console.log("PASS: Perfect Clear detection across all/hidden rows, level scores, B2B Tetris, T-Spin, Combo, Marathon, Results, storage, feedback and restart.");

const effectTests = createGame();
effectTests(`
  // AudioContextは最初のユーザー操作で1つだけ作り、Restartでも再利用する。
  let audioContextCreations = 0;
  window.AudioContext = class {
    constructor() { audioContextCreations++; this.state = "running"; this.currentTime = 0; }
  };
  key("ArrowLeft"); key("ArrowRight"); document.getElementById("restart").click();
  assert.equal(audioContextCreations, 1);

  const soundEvents = [];
  playSound = type => soundEvents.push(type);
  let forcedSpin = "NONE";
  detectTSpin = () => forcedSpin;

  function prepareEffectClear(lines, perfect = false, startLines = 0) {
    restart(); soundEvents.length = 0; forcedSpin = "NONE";
    totalLines = startLines; level = Math.floor(totalLines / 10) + 1;
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    const shapes = { 1:[[1,1,1,1]], 2:[[1,1],[1,1]], 3:[[1,0],[1,1],[1,0]], 4:[[1],[1],[1],[1]] };
    piece = { rotation: 0, shape: shapes[lines], x: 4, y: TOTAL_ROWS - lines, color: 1 };
    for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) board[y].fill(7);
    piece.shape.forEach((row, dy) => row.forEach((cell, dx) => {
      if (cell) board[piece.y + dy][piece.x + dx] = 0;
    }));
    if (!perfect) board[0][0] = 7;
  }

  for (const [lines, sound] of [[1,"line"],[2,"double"],[3,"triple"],[4,"tetris"]]) {
    prepareEffectClear(lines); lockPiece();
    assert.deepEqual(soundEvents, [sound]);
    const count = soundEvents.length; draw(); draw(); assert.equal(soundEvents.length, count);
  }

  prepareEffectClear(1); forcedSpin = "T_SPIN"; lockPiece();
  assert.deepEqual(soundEvents, ["t-spin"]);
  prepareEffectClear(1); forcedSpin = "T_SPIN_MINI"; lockPiece();
  assert.deepEqual(soundEvents, ["t-spin-mini"]);
  prepareEffectClear(1, true); lockPiece();
  assert.deepEqual(soundEvents, ["perfect-clear"]);
  assert.ok(boardStageElement.classList.contains("effect-perfect"));
  soundEvents.length = 0; playLockEffects("NONE", 1, false, false);
  assert.deepEqual(soundEvents, ["line"]);
  assert.ok(boardStageElement.classList.contains("effect-line"));
  assert.ok(!boardStageElement.classList.contains("effect-perfect"));

  // Level Upは主要音に加える補助音。PCはT-Spinより優先する。
  prepareEffectClear(1, false, 9); lockPiece();
  assert.deepEqual(soundEvents, ["line", "level-up"]);
  assert.ok(levelElement.classList.contains("level-up"));
  prepareEffectClear(1, true, 9); forcedSpin = "T_SPIN"; lockPiece();
  assert.deepEqual(soundEvents, ["perfect-clear", "level-up"]);

  // Marathon Completeは同時成立した通常音とLevel Up音をまとめて置き換える。
  prepareEffectClear(1, true, 149); lockPiece();
  assert.deepEqual(soundEvents, ["complete"]);
  assert.ok(resultsElement.classList.contains("results-enter"));
  assert.ok(resultsElement.classList.contains("results-complete"));
  const completeCount = soundEvents.length; draw(); draw(); assert.equal(soundEvents.length, completeCount);

  restart(); soundEvents.length = 0;
  assert.ok(!boardStageElement.classList.contains("effect-perfect"));
  assert.ok(!levelElement.classList.contains("level-up"));
  assert.ok(!resultsElement.classList.contains("results-enter"));
  assert.ok(!resultsElement.classList.contains("results-complete"));
  endGame(); assert.deepEqual(soundEvents, ["game-over"]);
  assert.ok(resultsElement.classList.contains("results-enter"));

  // Restart後の次イベントでも同じclassと音を再発火できる。
  prepareEffectClear(4); lockPiece();
  assert.deepEqual(soundEvents, ["tetris"]);
  assert.ok(boardStageElement.classList.contains("effect-tetris"));
`);
console.log("PASS: event sound routing/priority, one-shot draw behavior, single AudioContext, visual classes, Results effects and Restart cleanup.");

const settingsStorage = { "falling-block-high-score": "4321" };
const settingsTests = createGame(settingsStorage);
settingsTests(`
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(settings.dasMs, 170); assert.equal(settings.arrMs, 50); assert.equal(settings.softDropMs, 40);
  assert.equal(settings.sfxEnabled, true); assert.equal(settings.sfxVolume, 100); assert.equal(settings.effectsEnabled, true);

  dasInput.value = "140"; dasInput.input();
  arrInput.value = "30"; arrInput.input();
  softDropInput.value = "25"; softDropInput.input();
  sfxInput.checked = false; sfxInput.change();
  volumeInput.value = "50"; volumeInput.input();
  effectsInput.checked = false; effectsInput.change();
  assert.deepEqual(settings, { dasMs:140, arrMs:30, softDropMs:25, sfxEnabled:false, sfxVolume:50, effectsEnabled:false });
  assert.ok(document.body.classList.contains("effects-off"));
  assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "4321");
  const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
  assert.deepEqual(savedSettings, settings);

  // 実際のrepeat時計が設定値を参照する。
  restart(); piece = { shape:[[1]], rotation:0, x:5, y:20, color:1 }; board = Array.from({length:TOTAL_ROWS},()=>Array(COLS).fill(0));
  press("ArrowLeft", 0); assert.equal(piece.x, 4);
  advanceTime(139); assert.equal(piece.x, 4);
  advanceTime(140); assert.equal(piece.x, 3);
  advanceTime(169); assert.equal(piece.x, 3);
  advanceTime(170); assert.equal(piece.x, 2);
  release("ArrowLeft", 170);
  press("ArrowDown", 200); const softY = piece.y; const softScore = score;
  advanceTime(224); assert.equal(piece.y, softY);
  advanceTime(225); assert.equal(piece.y, softY + 1); assert.equal(score, softScore + 1);
  release("ArrowDown", 225);

  // Settings中はheld inputを消し、ゲーム用キーを受け付けない。
  press("ArrowRight", 300); const settingsX = piece.x;
  openSettings(300); assert.equal(settingsOpen, true); assert.equal(paused, true);
  assert.equal(gameUiElement.inert, true); assert.equal(document.activeElement, closeSettingsButton);
  assert.equal(activeDirection, null); assert.equal(heldKeys.ArrowRight, false);
  press("ArrowRight", 350); press("Space", 350); assert.equal(piece.x, settingsX);
  key("Tab"); assert.equal(document.activeElement, dasInput);
  key("Tab", false, { shiftKey:true }); assert.equal(document.activeElement, closeSettingsButton);
  dasInput.focus(); key("Tab", false, { shiftKey:true }); assert.equal(document.activeElement, closeSettingsButton);
  closeSettings(); assert.equal(settingsOpen, false); assert.equal(paused, false); assert.equal(lastTime, null);
  assert.equal(gameUiElement.inert, false); assert.equal(document.activeElement, settingsButton);
  audioContext = null; settingsButton.click(); assert.equal(audioContext, null); assert.equal(settingsOpen, true);
  key("Escape"); assert.equal(settingsOpen, false);
  settingsButton.click(); settingsButton.click(); assert.equal(settingsOpen, true); closeSettings();

  // 元からPauseなら、閉じてもPauseのまま。
  togglePause(400); assert.equal(paused, true);
  openSettings(400); closeSettings(); assert.equal(paused, true);
  togglePause(450); assert.equal(paused, false);

  // 長時間開いてもGravityとLock Delayへ時間を持ち越さない。
  piece = { shape:[[1]], rotation:0, x:4, y:TOTAL_ROWS-1, color:1 }; lockElapsed = 400; lastTime = 500;
  openSettings(500); closeSettings(); advanceTime(30500);
  assert.equal(lockElapsed, 400); assert.equal(board[TOTAL_ROWS-1][4], 0);

  // Game Over / Completeから閉じても終了状態を維持する。
  restart(); endGame(); openSettings(31000); closeSettings(); assert.equal(gameOver, true);
  restart(); completeMarathon(); openSettings(32000); closeSettings(); assert.equal(marathonComplete, true); assert.equal(resultsElement.hidden, false);

  // Reset Defaultsは設定だけを戻し、High Scoreを保持する。
  highScore = 4321; highScoreElement.textContent = highScore;
  settings = { dasMs:100, arrMs:20, softDropMs:20, sfxEnabled:false, sfxVolume:0, effectsEnabled:false };
  resetSettingsButton.click(); assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(highScore, 4321); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "4321");
  restart(); assert.deepEqual(settings, DEFAULT_SETTINGS);

  // SFX OFF/ONとMaster Volume。既存0.045 gainへ割合を掛ける。
  let oscillatorCount = 0; const peaks = [];
  audioContext = {
    state:"running", currentTime:0, destination:{},
    createOscillator(){ return { type:"", frequency:{setValueAtTime(){}}, connect(){return this;}, start(){}, stop(){}, disconnect(){}, onended:null }; },
    createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(value){ peaks.push(value); } }, connect(){return this;}, disconnect(){} }; }
  };
  audioContext.createOscillator = () => { oscillatorCount++; return { frequency:{setValueAtTime(){}}, connect(){return this;}, start(){}, stop(){}, disconnect(){}, onended:null }; };
  settings.sfxEnabled = false; playSound("line"); assert.equal(oscillatorCount, 0);
  settings.sfxEnabled = true; settings.sfxVolume = 50; playSound("line"); assert.equal(oscillatorCount, 1); assert.ok(peaks.includes(0.0225));
  settings.sfxVolume = 0; playSound("line"); assert.equal(oscillatorCount, 1);

  // AudioContextの再開が完了する前に発生した最初の効果音も捨てない。
  let resumeCount = 0;
  audioContext.state = "suspended";
  audioContext.resume = () => ({
    then(callback) { resumeCount++; audioContext.state = "running"; callback(); return this; },
    catch() { return this; },
  });
  settings.sfxVolume = 100; playSound("line");
  assert.equal(resumeCount, 1); assert.equal(oscillatorCount, 2);

  // Effects OFFは文字を消さず、CSS用classだけを切り替える。
  settings.effectsEnabled = false; updateSettingsUI();
  clearEventElement.textContent = "T-SPIN"; assert.ok(document.body.classList.contains("effects-off")); assert.equal(clearEventElement.textContent, "T-SPIN");
  settings.effectsEnabled = true; updateSettingsUI(); assert.ok(!document.body.classList.contains("effects-off"));
`);

// 保存した設定は新しいゲームでも復元する。
createGame(settingsStorage)(`
  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.equal(highScore, 4321);
`);
const persistedSettings = {
  "falling-block-settings": JSON.stringify({ dasMs:120, arrMs:25, softDropMs:30, sfxEnabled:false, sfxVolume:45, effectsEnabled:false })
};
createGame(persistedSettings)(`
  assert.deepEqual(settings, { dasMs:120, arrMs:25, softDropMs:30, sfxEnabled:false, sfxVolume:45, effectsEnabled:false });
  assert.equal(dasInput.value, 120); assert.equal(document.getElementById("setting-volume-value").textContent, "45%");
  restart(); assert.equal(settings.dasMs, 120); assert.equal(settings.sfxEnabled, false);
`);
for (const value of ["{broken", JSON.stringify({ dasMs:-1000, arrMs:"abc", softDropMs:null, sfxVolume:999 })]) {
  createGame({ "falling-block-settings": value })(`
    assert.equal(settings.dasMs,170); assert.equal(settings.arrMs,50); assert.equal(settings.softDropMs,40);
    assert.equal(settings.sfxVolume,100); assert.equal(settings.sfxEnabled,true); assert.equal(settings.effectsEnabled,true);
  `);
}
createGame(blockedStorage)(`
  changeSetting("dasMs", 150); assert.equal(settings.dasMs, 150);
  restart(); assert.equal(settings.dasMs, 150);
`);
console.log("PASS: Settings defaults/storage validation, live DAS/ARR/drop timing, SFX/volume/effects, Pause restoration, lifecycle and high-score isolation.");

const softDropGravityTests = createGame();
softDropGravityTests(`
  const marathonGravity = getGravityInterval;
  function prepareDrop(gravityMs, softMs = 40) {
    restart();
    getGravityInterval = () => gravityMs;
    settings.softDropMs = softMs;
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    piece = { shape:[[1]], rotation:0, x:4, y:10, color:1 };
    score = 0; scoreElement.textContent = "0"; dropElapsed = 0; lockElapsed = 0; lastTime = null;
  }

  // Soft Dropが速い場合だけrepeatが担当し、成功した各cellへ1点を付ける。
  prepareDrop(1000, 40); press("ArrowDown", 0);
  assert.equal(piece.y, 11); assert.equal(score, 1); assert.equal(softDropUsesRepeat(), true);
  advanceTime(200); assert.equal(piece.y, 16); assert.equal(score, 6);
  release("ArrowDown", 200);

  // Gravityが速い場合はGravityだけが担当し、保持中の自然落下へ加点しない。
  prepareDrop(18, 40); press("ArrowDown", 0);
  assert.equal(piece.y, 11); assert.equal(score, 1); assert.equal(softDropUsesRepeat(), false);
  advanceTime(90); assert.equal(piece.y, 16); assert.equal(score, 1);
  release("ArrowDown", 90);

  // 同速ではGravityを選び、二つの下降を加算しない。
  prepareDrop(40, 40); press("ArrowDown", 0);
  advanceTime(120); assert.equal(piece.y, 14); assert.equal(score, 1); assert.equal(softDropUsesRepeat(), false);
  release("ArrowDown", 120);

  // 設定値20/40/100msをLevel番号でなく実intervalと比較する。
  prepareDrop(64, 20); heldKeys.ArrowDown = true; assert.equal(softDropUsesRepeat(), true);
  settings.softDropMs = 40; assert.equal(softDropUsesRepeat(), true);
  settings.softDropMs = 100; assert.equal(softDropUsesRepeat(), false); clearHeldKeys();

  // 高Gravityでは↓保持が通常Gravityより遅くならず、初回1点以外は加点しない。
  for (const testLevel of [13, 15]) {
    getGravityInterval = marathonGravity; restart(); level = testLevel; totalLines = (testLevel - 1) * 10;
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    piece = { shape:[[1]], rotation:0, x:4, y:5, color:1 }; score = 0; lastTime = null; dropElapsed = 0;
    const interval = getGravityInterval();
    press("ArrowDown", 0); const afterImmediate = piece.y;
    advanceTime(interval * 5 + 0.001);
    assert.equal(piece.y, afterImmediate + 5); assert.equal(score, 1);
    release("ArrowDown", interval * 5 + 0.001);
  }

  // 低FPSでもSoft Drop側は停止せず、Gravity側は既存の複数stepを使う。
  prepareDrop(1000, 40); press("ArrowDown", 0); advanceTime(300); const lowFpsSoftY = piece.y;
  advanceTime(600); assert.ok(piece.y > lowFpsSoftY); assert.equal(score, piece.y - 10); release("ArrowDown", 600);
  prepareDrop(18, 40); press("ArrowDown", 0); advanceTime(300);
  assert.equal(score, 1); assert.ok(piece.y > 11); assert.ok(piece.y < TOTAL_ROWS); release("ArrowDown", 300);

  // 大きなdtでも床を通過せず、接地前の余りをLock Delayへ加えない。
  prepareDrop(18, 40); piece.y = TOTAL_ROWS - 3; press("ArrowDown", 0);
  advanceTime(1000); assert.equal(piece.y, TOTAL_ROWS - 1); assert.equal(lockElapsed, 0); assert.equal(score, 1);

  // 同じadvanceTime内で固定・Level Upしても、旧pieceの期限を新pieceへ使わない。
  getGravityInterval = marathonGravity; restart(); settings.softDropMs = 40;
  let transitionLevel = 1;
  while (!(getGravityInterval(transitionLevel) > settings.softDropMs
    && getGravityInterval(transitionLevel + 1) <= settings.softDropMs)) transitionLevel++;
  level = transitionLevel; totalLines = transitionLevel * 10 - 1;
  board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  board[TOTAL_ROWS - 1].fill(7, 0, COLS - 1); board[0][0] = 7;
  piece = { shape:[[1]], rotation:0, x:COLS-1, y:TOTAL_ROWS-1, color:1 };
  heldKeys.ArrowDown = true; nextSoftDropTime = 40; softDropScheduledPiece = piece;
  lastTime = 0; lockElapsed = 460; score = 0;
  const oldLevelPiece = piece; advanceTime(40);
  assert.notEqual(piece, oldLevelPiece); assert.equal(level, transitionLevel + 1);
  assert.equal(piece.y, SPAWN_Y); assert.equal(score, 100 * transitionLevel);
  assert.equal(nextSoftDropTime, Infinity); assert.equal(softDropScheduledPiece, null);
  clearHeldKeys();

  // Levelが同じでも、新piece用repeatはSpawn時刻から新しく始める。
  prepareDrop(1000, 40); piece.y = TOTAL_ROWS - 1; lockElapsed = 460;
  heldKeys.ArrowDown = true; nextSoftDropTime = 40; softDropScheduledPiece = piece; lastTime = 0;
  const oldSameLevelPiece = piece; advanceTime(40);
  assert.notEqual(piece, oldSameLevelPiece); assert.equal(piece.y, SPAWN_Y); assert.equal(score, 0);
  assert.equal(nextSoftDropTime, 80); assert.equal(softDropScheduledPiece, piece);
  advanceTime(79); assert.equal(piece.y, SPAWN_Y);
  advanceTime(80); assert.equal(piece.y, SPAWN_Y + 1); assert.equal(score, 1); clearHeldKeys();

  // HOLD / Hard Dropでpieceが変わった場合も旧期限を同じ時刻で使わない。
  prepareDrop(1000, 40); heldKeys.ArrowDown = true; nextSoftDropTime = 40; softDropScheduledPiece = piece; lastTime = 0;
  const beforeHold = piece; hold(); assert.notEqual(piece, beforeHold); advanceTime(0);
  assert.equal(piece.y, SPAWN_Y); assert.equal(nextSoftDropTime, 40); clearHeldKeys();
  prepareDrop(1000, 40); heldKeys.ArrowDown = true; nextSoftDropTime = 40; softDropScheduledPiece = piece; lastTime = 0;
  const beforeHardDrop = piece; hardDrop(); assert.notEqual(piece, beforeHardDrop); const spawnedY = piece.y; advanceTime(0);
  assert.equal(piece.y, spawnedY); assert.equal(nextSoftDropTime, 40); clearHeldKeys();

  getGravityInterval = marathonGravity;
`);
console.log("PASS: Soft Drop selects the faster interval, rejects stale piece deadlines, preserves scoring, high-level gravity, low-FPS progress and lock timing.");

const qaStorage = { "falling-block-high-score": "500" };
const qaTests = createGame(qaStorage);
qaTests(`
  restart();
  // Panelは既存Pause・inert・focus循環を使い、背景入力を遮断する。
  const qaStartX = piece.x; press("ArrowRight", 0); openQa(0);
  assert.equal(qaOpen, true); assert.equal(paused, true); assert.equal(gameUiElement.inert, true);
  assert.equal(activeDirection, null); assert.equal(nextSoftDropTime, Infinity); assert.equal(document.activeElement, qaCloseButton);
  press("ArrowLeft", 10); press("Space", 10); assert.equal(piece.x, qaStartX + 1);
  const pausedQaY = piece.y; const pausedQaLock = lockElapsed;
  advanceTime(1000); assert.equal(piece.y, pausedQaY); assert.equal(lockElapsed, pausedQaLock);
  key("Tab"); assert.equal(document.activeElement, debugLevelButtons[0]);
  key("Tab", false, { shiftKey:true }); assert.equal(document.activeElement, qaCloseButton);
  closeQa(); assert.equal(paused, false); assert.equal(gameUiElement.inert, false); assert.equal(document.activeElement, devToolsButton);
  advanceTime(5000); assert.equal(piece.y, pausedQaY); assert.equal(lockElapsed, pausedQaLock);

  // 149 Lines fixtureは通常SingleからCompleteへ進み、Perfect Clearにはしない。
  const qaSounds = []; playSound = type => qaSounds.push(type);
  openQa(20); loadQa149To150();
  assert.equal(isQaRun, true); assert.equal(score, 0); assert.equal(totalLines, 149);
  assert.equal(level, Math.floor(149 / 10) + 1); assert.equal(gameOver, false); assert.equal(marathonComplete, false);
  assert.equal(board.length, TOTAL_ROWS); assert.ok(board.every(row => row.length === COLS));
  assert.deepEqual(board[TOTAL_ROWS-1].slice(3,7), [0,0,0,0]); assert.equal(board[TOTAL_ROWS-2][0], 7);
  assert.equal(piece.color, 1); assert.equal(piece.rotation, 0); assert.equal(piece.x, 3); assert.equal(piece.y, SPAWN_Y);
  assert.equal(qaRunElement.hidden, false); assert.deepEqual(qaSounds, []);
  hardDrop(); assert.equal(totalLines, 150); assert.equal(marathonComplete, true); assert.equal(lastPerfectClear, false);
  assert.equal(resultsElement.hidden, false); assert.equal(resultsDebugElement.textContent, "QA RUN");
  assert.deepEqual(qaSounds, ["complete"]); assert.equal(highScore, 500); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");

  // PLAY AGAINはNormalへ戻し、通常Restartは現在のRun条件を維持する。
  document.getElementById("play-again").click();
  assert.equal(isQaRun, false); assert.equal(selectedStartLevel, 1); assert.equal(level, 1); assert.equal(totalLines, 0);
  assert.equal(gameOver, false); assert.equal(qaRunElement.hidden, true);
  markQaRun(); restart(); assert.equal(isQaRun, true); assert.equal(qaRunElement.hidden, false);

  // CLEAR BOARDは固定盤面だけを空にし、Score/Lines/Queue/HOLD/active pieceを維持する。
  board[0][0] = 7; board[TOTAL_ROWS-1][9] = 7; score = 321; totalLines = 12; level = 2; heldType = 4;
  const clearPiece = piece; const clearQueue = JSON.stringify(nextQueue);
  lockElapsed = 300; lockResets = 5; lastRotationKick = 2;
  openQa(30); clearQaBoard();
  assert.ok(board.every(row => row.length === COLS && row.every(cell => cell === 0)));
  assert.equal(piece, clearPiece); assert.equal(score, 321); assert.equal(totalLines, 12); assert.equal(level, 2);
  assert.equal(JSON.stringify(nextQueue), clearQueue); assert.equal(heldType, 4);
  assert.equal(lockElapsed, 0); assert.equal(lockResets, 0); assert.equal(lastRotationKick, null);

  // FORCE Iは既存定義・Spawnを使い、Queue/HOLD/Scoreを変えず古いrepeatを消す。
  const forceQueue = JSON.stringify(nextQueue); const forceHold = heldType; const forceScore = score;
  openQa(40); heldKeys.ArrowDown = true; nextSoftDropTime = 40; softDropScheduledPiece = piece;
  forceQaI();
  assert.equal(piece.color, 1); assert.equal(piece.shape, ROTATIONS[0][0]); assert.equal(piece.rotation, 0);
  assert.equal(piece.x, 3); assert.equal(piece.y, SPAWN_Y); assert.equal(JSON.stringify(nextQueue), forceQueue);
  assert.equal(heldType, forceHold); assert.equal(score, forceScore); assert.equal(nextSoftDropTime, Infinity); assert.equal(softDropScheduledPiece, null);

  // Spawn位置が塞がれている場合は何も消さず、安全に失敗する。
  const failedPiece = piece; board[SPAWN_Y + 1][3] = 6; const failedBoard = JSON.stringify(board);
  openQa(50); forceQaI(); assert.equal(qaOpen, true); assert.equal(piece, failedPiece);
  assert.equal(JSON.stringify(board), failedBoard); assert.ok(qaMessageElement.textContent.includes("CLEAR BOARD")); closeQa();

  // Top Out fixtureは次の通常Spawn衝突によってGame Overへ進む。
  qaSounds.length = 0; openQa(60); loadQaTopOut();
  assert.equal(isQaRun, true); assert.equal(gameOver, false); assert.equal(piece.color, 1);
  assert.equal(piece.y, TOTAL_ROWS - 2); assert.equal(board[SPAWN_Y][3], 7);
  hardDrop(); assert.equal(gameOver, true); assert.equal(resultsElement.hidden, false);
  assert.equal(resultsTitleElement.textContent, "GAME OVER"); assert.equal(resultsDebugElement.textContent, "QA RUN");
  assert.deepEqual(qaSounds, ["game-over"]); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "500");
  openQa(70); closeQa(); assert.equal(gameOver, true); assert.equal(resultsElement.hidden, false);

  // RESET QA RUNで明示的に通常開始へ戻り、再びHigh Score対象になる。
  openQa(80); qaResetButton.click(); assert.equal(isQaRun, false); assert.equal(qaRunElement.hidden, true);
  assert.equal(selectedStartLevel, 1); addScore(600); assert.equal(highScore, 600); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "600");
  openQa(90); clearQaBoard(); assert.equal(isQaRun, true);
  startDebugLevel(1); assert.equal(isQaRun, false); assert.equal(totalLines, 0);

  // QA状態そのものをlocalStorageへ保存しない。
  assert.equal(localStorage.getItem("isQaRun"), null);
  assert.equal(localStorage.getItem("qa-run"), null);
`);
console.log("PASS: QA Assist fixtures, normal completion/top-out paths, board/I tools, high-score exclusion, modal safety and normal-run recovery.");

const statsTests = createGame();
statsTests(`
  function finishStatsEvent(spin, lines, perfectClear = false) {
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    if (!perfectClear) board[0][0] = 7;
    if (lines > 0) {
      for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) board[y].fill(7, 0, COLS - 1);
      piece = { shape:Array.from({ length:lines }, () => [1]), rotation:0, x:COLS-1, y:TOTAL_ROWS-lines, color:3 };
    } else {
      piece = { shape:[[1]], rotation:0, x:4, y:TOTAL_ROWS-1, color:3 };
    }
    detectTSpin = () => spin;
    lockPiece();
  }

  // 新しいRunは全項目を0から始める。
  assert.deepEqual(runStats, {
    activePlayMs:0, tetrises:0, tSpins:0, tSpinMinis:0, perfectClears:0, maxCombo:0
  });
  assert.equal(formatPlayTime(0), "00:00");
  assert.equal(formatPlayTime(62_000), "01:02");
  assert.equal(formatPlayTime(3_735_000), "1:02:15");

  // Tetrisは固定イベントごとに1回。Perfect Clearなら両方を独立して数える。
  finishStatsEvent("NONE", 4); assert.equal(runStats.tetrises, 1); assert.equal(runStats.perfectClears, 0);
  finishStatsEvent("NONE", 4, true); assert.equal(runStats.tetrises, 2); assert.equal(runStats.perfectClears, 1);

  // Full/Miniは既存分類の片方だけを数え、line数では増幅しない。0-lineも数える。
  finishStatsEvent("T_SPIN", 0); assert.equal(runStats.tSpins, 1); assert.equal(runStats.tSpinMinis, 0);
  finishStatsEvent("T_SPIN", 2); assert.equal(runStats.tSpins, 2); assert.equal(runStats.tSpinMinis, 0);
  finishStatsEvent("T_SPIN_MINI", 1); assert.equal(runStats.tSpins, 2); assert.equal(runStats.tSpinMinis, 1);
  finishStatsEvent("NONE", 1, true); assert.equal(runStats.perfectClears, 2);

  // HUDと同じCombo値の最大だけを保持し、break後に小さい値へ戻さない。
  restart(); finishStatsEvent("NONE", 1); finishStatsEvent("NONE", 1); finishStatsEvent("NONE", 1);
  assert.equal(comboCount, 2); assert.equal(runStats.maxCombo, 2);
  finishStatsEvent("NONE", 0); assert.equal(comboCount, -1); assert.equal(runStats.maxCombo, 2);
  finishStatsEvent("NONE", 1); assert.equal(runStats.maxCombo, 2);

  // 最終TetrisをcountしてからComplete Resultsのsnapshotを作る。
  restart(); totalLines = 146; level = 15; finishStatsEvent("NONE", 4);
  assert.equal(marathonComplete, true); assert.equal(runStats.tetrises, 1);
  assert.equal(resultsStatsSnapshot.tetrises, 1); assert.equal(resultsTetrisesElement.textContent, 1);

  // Pause・Settings・QA panelの時間は除外し、activeな低FPS時間はdt全体を数える。
  restart(); lastTime = 0; advanceTime(1000); assert.equal(runStats.activePlayMs, 1000);
  togglePause(1000); advanceTime(6000); assert.equal(runStats.activePlayMs, 1000);
  togglePause(6000); advanceTime(8000); assert.equal(runStats.activePlayMs, 3000);
  openSettings(8000); advanceTime(13000); closeSettings(); advanceTime(13000);
  assert.equal(runStats.activePlayMs, 3000);
  advanceTime(13500); assert.equal(runStats.activePlayMs, 3500);
  openQa(13500); advanceTime(18500); closeQa(); advanceTime(18500);
  assert.equal(runStats.activePlayMs, 3500);
  advanceTime(19000); assert.equal(runStats.activePlayMs, 4000);

  // frame途中のTop Out後は残り時間を数えず、終了後も停止する。
  openQa(19000); loadQaTopOut(); lockElapsed = 400; lastTime = 0;
  advanceTime(1000); assert.equal(gameOver, true); assert.equal(runStats.activePlayMs, 100);
  assert.equal(resultsStatsSnapshot.activePlayMs, 100); assert.equal(resultsPlayTimeElement.textContent, "00:00");
  advanceTime(5000); assert.equal(runStats.activePlayMs, 100);

  // Resultsは値をcopyし、Restartで新Runを作っても終了時snapshotを変えない。
  runStats = { activePlayMs:62_000, tetrises:3, tSpins:2, tSpinMinis:1, perfectClears:2, maxCombo:4 };
  showResults("GAME OVER"); const oldSnapshot = resultsStatsSnapshot;
  assert.equal(resultsPlayTimeElement.textContent, "01:02");
  assert.equal(resultsTetrisesElement.textContent, 3); assert.equal(resultsTSpinsElement.textContent, 2);
  assert.equal(resultsTSpinMinisElement.textContent, 1); assert.equal(resultsPerfectClearsElement.textContent, 2);
  assert.equal(resultsMaxComboElement.textContent, 4);
  restart(); assert.deepEqual(runStats, createEmptyRunStats());
  assert.deepEqual(oldSnapshot, { activePlayMs:62_000, tetrises:3, tSpins:2, tSpinMinis:1, perfectClears:2, maxCombo:4 });

  // Settings/Pauseは値を維持し、QAの新scenarioとPLAY AGAINは新Runとしてresetする。
  runStats.tetrises = 2; togglePause(0); togglePause(0); assert.equal(runStats.tetrises, 2);
  openSettings(0); changeSetting("sfxEnabled", false); changeSetting("effectsEnabled", false); closeSettings();
  assert.equal(runStats.tetrises, 2);
  openQa(0); clearQaBoard(); assert.equal(runStats.tetrises, 2);
  openQa(0); forceQaI(); assert.equal(runStats.tetrises, 2);
  openQa(0); loadQa149To150(); assert.deepEqual(runStats, createEmptyRunStats());
  runStats.tSpins = 1; document.getElementById("play-again").click(); assert.deepEqual(runStats, createEmptyRunStats());
  runStats.perfectClears = 1; openQa(0); loadQaTopOut(); assert.deepEqual(runStats, createEmptyRunStats());

  // Debug/QAやSFX/Effects設定に関係なくStatsは記録する。
  startDebugLevel(5);
  settings.sfxEnabled = false; settings.effectsEnabled = false;
  finishStatsEvent("NONE", 4); assert.equal(runStats.tetrises, 1);
  endGame(); assert.equal(resultsDebugElement.textContent, "DEBUG RUN");
  assert.equal(resultsTetrisesElement.textContent, 1);

  // StatsはSettings/High Scoreと異なりlocalStorageへ保存しない。
  assert.equal(localStorage.getItem("falling-block-run-stats"), null);
  assert.equal(localStorage.getItem("runStats"), null);
`);
console.log("PASS: Run statistics counts, active play time, pause/modal/terminal exclusion, Results snapshot and Run lifecycle resets.");

const focusTests = createGame();
focusTests(`
  // Playing中のblurはGravity・Lock Delay・PLAY TIMEをすべて停止する。
  restart(); lastTime = 0; advanceTime(1000);
  const playingY = piece.y; const playingDrop = dropElapsed; const playingTime = runStats.activePlayMs;
  emit("blur"); advanceTime(11000);
  assert.equal(focusSuspended, true); assert.equal(piece.y, playingY);
  assert.equal(dropElapsed, playingDrop); assert.equal(runStats.activePlayMs, playingTime);

  // focus後の最初のframeは再同期だけで、blur中の10秒を処理しない。
  emit("focus"); advanceTime(11000);
  assert.equal(focusSuspended, false); assert.equal(piece.y, playingY);
  assert.equal(runStats.activePlayMs, playingTime);
  advanceTime(13000); assert.equal(runStats.activePlayMs, playingTime + 2000);

  // held inputとrepeat deadlineはblurで消え、focusだけでは再発火しない。
  restart(); press("ArrowRight", 0); press("ArrowDown", 0);
  emit("blur"); const inputX = piece.x; const inputY = piece.y; const inputScore = score;
  assert.equal(activeDirection, null); assert.equal(nextHorizontalTime, Infinity);
  assert.equal(nextSoftDropTime, Infinity); assert.equal(softDropScheduledPiece, null);
  emit("focus"); advanceTime(10000);
  assert.equal(piece.x, inputX); assert.equal(piece.y, inputY); assert.equal(score, inputScore);

  // 接地後400msを維持し、blur時間では固定せず、復帰後の残り100msで固定する。
  restart(); piece = { shape:[[1]], rotation:0, x:4, y:TOTAL_ROWS-1, color:3 };
  lastTime = 0; advanceTime(400); assert.equal(lockElapsed, 400);
  const groundedPiece = piece; emit("blur"); advanceTime(10400);
  assert.equal(piece, groundedPiece); assert.equal(lockElapsed, 400);
  emit("focus"); advanceTime(10400); advanceTime(10499); assert.equal(piece, groundedPiece);
  advanceTime(10500); assert.notEqual(piece, groundedPiece);

  // Manual Pause・Settings・QA・terminal状態はfocusで解除しない。
  restart(); togglePause(0); emit("blur"); emit("focus"); assert.equal(paused, true);
  togglePause(0); openSettings(0); emit("blur"); emit("focus"); assert.equal(settingsOpen, true); assert.equal(paused, true); closeSettings();
  openQa(0); emit("blur"); emit("focus"); assert.equal(qaOpen, true); assert.equal(paused, true); closeQa();
  restart(); endGame(); emit("blur"); emit("focus"); assert.equal(gameOver, true); assert.equal(resultsElement.hidden, false);
  restart(); completeMarathon(); emit("blur"); emit("focus"); assert.equal(marathonComplete, true); assert.equal(resultsElement.hidden, false);

  // blurとhiddenが重なっても安全で、event順序に関係なく巨大deltaを作らない。
  restart(); lastTime = 0; advanceTime(100); const overlapTime = runStats.activePlayMs;
  emit("blur"); document.hidden = true; emit("visibilitychange"); advanceTime(10100);
  document.hidden = false; emit("visibilitychange"); advanceTime(10100);
  assert.equal(runStats.activePlayMs, overlapTime);
  emit("focus"); advanceTime(10100); assert.equal(runStats.activePlayMs, overlapTime);

  // focusがhidden解除より先でも停止を維持し、高Gravityでも復帰時に落下burstしない。
  restart(); selectedStartLevel = 15; restart(); lastTime = 0; advanceTime(20);
  const highGravityY = piece.y; emit("blur"); document.hidden = true; emit("visibilitychange");
  emit("focus"); advanceTime(30020); assert.equal(piece.y, highGravityY);
  document.hidden = false; emit("visibilitychange"); advanceTime(30020);
  assert.equal(piece.y, highGravityY); assert.equal(runStats.activePlayMs, 20);

  // blur中Restartでも裏では進まず、focus後に通常の新Runとして再開する。
  emit("blur"); restart(); const restartedPiece = piece; advanceTime(20100);
  assert.equal(piece, restartedPiece); assert.equal(runStats.activePlayMs, 0);
  emit("focus"); advanceTime(20100); advanceTime(21100);
  assert.equal(runStats.activePlayMs, 1000);
`);
console.log("PASS: window focus suspension, input clearing, timestamp resync, lock delay, modal/terminal preservation and restart safety.");

const startScreenStorage = { "falling-block-high-score": "12345" };
const startScreenTests = createGame(startScreenStorage);
startScreenTests(`
  // 初期ロードは開始前。長時間経過やgameplay keyでも背景Runを進めない。
  assert.equal(startScreenOpen, true); assert.equal(startOverlay.hidden, false);
  assert.equal(gameUiElement.inert, true); assert.equal(document.activeElement, startButton);
  assert.equal(startHighScoreElement.textContent, 12345);
  const initialPiece = JSON.stringify(piece); const initialBoard = JSON.stringify(board);
  advanceTime(30000);
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyZ", "ArrowDown", "Space", "KeyC", "KeyP", "KeyR"]) key(code);
  assert.equal(JSON.stringify(piece), initialPiece); assert.equal(JSON.stringify(board), initialBoard);
  assert.equal(runStats.activePlayMs, 0); assert.equal(lockElapsed, 0); assert.equal(score, 0);

  // TabはSTARTとSETTINGSだけを循環し、blur/hiddenから戻っても開始前を維持する。
  key("Tab", false, { shiftKey:true }); assert.equal(document.activeElement, startDevToolsButton);
  key("Tab"); assert.equal(document.activeElement, startButton);
  emit("blur"); emit("focus"); document.hidden = true; emit("visibilitychange");
  document.hidden = false; emit("visibilitychange"); advanceTime(60000);
  assert.equal(startScreenOpen, true); assert.equal(runStats.activePlayMs, 0);

  // START画面からSettingsを閉じても開始せず、設定値とfocusを維持する。
  startSettingsButton.click(); assert.equal(settingsOpen, true); assert.equal(startOverlay.inert, true);
  changeSetting("softDropMs", 55); advanceTime(90000); closeSettings();
  assert.equal(startScreenOpen, true); assert.equal(settingsOpen, false); assert.equal(paused, false);
  assert.equal(gameUiElement.inert, true); assert.equal(document.activeElement, startSettingsButton);
  assert.equal(settings.softDropMs, 55); assert.equal(runStats.activePlayMs, 0);

  // STARTは過去のDebug/QA選択を捨て、Level 1のfresh Normal Runを作る。
  selectedStartLevel = 15; isQaRun = true; runStats.tetrises = 4; score = 99;
  const beforeStartPiece = piece; startButton.click();
  assert.equal(startScreenOpen, false); assert.equal(startOverlay.hidden, true); assert.equal(gameUiElement.inert, false);
  assert.equal(selectedStartLevel, 1); assert.equal(isQaRun, false); assert.equal(level, 1); assert.equal(totalLines, 0); assert.equal(score, 0);
  assert.deepEqual(runStats, createEmptyRunStats()); assert.notEqual(piece, beforeStartPiece); assert.equal(lastTime, null);
  advanceTime(90000); assert.equal(runStats.activePlayMs, 0); const startedY = piece.y;
  advanceTime(91000); assert.equal(runStats.activePlayMs, 1000); assert.equal(piece.y, startedY + 1);

  // STARTをSpace相当のbutton clickで起動しても、そのkeydownはHard Dropへ漏れない。
  showStartScreen(); const spaceStartPiece = piece; press("Space", 92000); startButton.click(); release("Space", 92000);
  assert.equal(startScreenOpen, false); assert.equal(piece.y, SPAWN_Y); assert.notEqual(piece, spaceStartPiece);
  assert.equal(score, 0); assert.equal(board.flat().filter(Boolean).length, 0);

  // 開始後のRestart / PLAY AGAINはSTART画面を挟まず従来どおりfresh Runへ入る。
  restart(); assert.equal(startScreenOpen, false);
  endGame(); document.getElementById("play-again").click();
  assert.equal(startScreenOpen, false); assert.equal(gameOver, false); assert.equal(resultsElement.hidden, true);

  // QA fixture内のrestartはpanelの背景inertを解除しない。
  openQa(93000); markQaRun(); restart(); assert.equal(qaOpen, true); assert.equal(gameUiElement.inert, true); closeQa();
  assert.equal(localStorage.getItem("startScreenOpen"), null); assert.equal(localStorage.getItem("gameStarted"), null);
`);
console.log("PASS: initial Start Screen, simulation/input gating, Settings return, Normal Run start, timestamp reset, focus trap and lifecycle regressions.");

const devToolsHtml = fs.readFileSync(`${__dirname}/index.html`, "utf8");
assert.ok(!devToolsHtml.includes('id="debug-level"'));
assert.ok(!devToolsHtml.includes('id="open-qa"'));
assert.ok(devToolsHtml.includes('id="open-dev-tools"'));
assert.ok(devToolsHtml.includes('id="start-dev-tools"'));
assert.ok(devToolsHtml.includes("DEBUG START") && devToolsHtml.includes("QA ASSIST"));

const devToolsTests = createGame();
devToolsTests(`
  // 閲覧だけではRun種別を変えず、Playing時間・入力repeatを停止する。
  startGame(); lastTime = 0; advanceTime(1000); const activeBeforeDev = runStats.activePlayMs;
  press("ArrowRight", 1000); press("ArrowDown", 1000); const beforeOpen = { x:piece.x, y:piece.y, score };
  devToolsButton.click();
  assert.equal(qaOpen, true); assert.equal(paused, true); assert.equal(isQaRun, false); assert.equal(selectedStartLevel, 1);
  assert.equal(gameUiElement.inert, true); assert.equal(document.activeElement, qaCloseButton);
  assert.equal(activeDirection, null); assert.equal(nextHorizontalTime, Infinity); assert.equal(nextSoftDropTime, Infinity);
  advanceTime(31000); assert.deepEqual({ x:piece.x, y:piece.y, score }, beforeOpen);
  assert.equal(runStats.activePlayMs, activeBeforeDev);
  closeQa(); assert.equal(paused, false); assert.equal(document.activeElement, devToolsButton);
  advanceTime(31000); assert.equal(runStats.activePlayMs, activeBeforeDev);

  // Manual PauseとStart ScreenはDEV TOOLSを閉じても元の状態を維持する。
  togglePause(31000); openQa(31000); closeQa(); assert.equal(paused, true);
  togglePause(31000); showStartScreen(); startDevToolsButton.click();
  assert.equal(qaOpen, true); assert.equal(paused, false); assert.equal(startOverlay.inert, true);
  closeQa(); assert.equal(startScreenOpen, true); assert.equal(gameUiElement.inert, true);
  assert.equal(document.activeElement, startDevToolsButton);

  // panel内だけでfocusを循環し、Escapeは背景操作へ漏らさず閉じる。
  startDevToolsButton.click(); key("Tab"); assert.equal(document.activeElement, debugLevelButtons[0]);
  key("Tab", false, { shiftKey:true }); assert.equal(document.activeElement, qaCloseButton);
  key("Escape"); assert.equal(qaOpen, false); assert.equal(startScreenOpen, true);

  // SpaceでPlaying側の入口を押してもHard Dropせず、button clickだけでpanelを開く。
  startGame(); const spacePiece = piece; const spaceBoard = JSON.stringify(board); const spaceScore = score;
  press("Space", 32000, false, { target:{ closest:() => devToolsButton } }); devToolsButton.click(); release("Space", 32000);
  assert.equal(piece, spacePiece); assert.equal(JSON.stringify(board), spaceBoard); assert.equal(score, spaceScore); assert.equal(qaOpen, true);
  closeQa();

  // 既存のDebug開始処理を各buttonから1回だけ呼び、Level 1のNormal意味も維持する。
  openQa(33000); debugLevelButtons[1].click(); assert.equal(level, 5); assert.equal(totalLines, 40);
  assert.equal(selectedStartLevel, 5); assert.equal(isQaRun, false); assert.equal(qaOpen, false);
  openQa(34000); debugLevelButtons[4].click(); assert.equal(level, 15); assert.equal(totalLines, 140);
  openQa(35000); debugLevelButtons[0].click(); assert.equal(level, 1); assert.equal(totalLines, 0); assert.equal(isQaRun, false);

  // Settingsと同時には開かず、blur/focusでも開いたpanelと停止状態を維持する。
  openSettings(36000); openQa(36000); assert.equal(settingsOpen, true); assert.equal(qaOpen, false); closeSettings();
  openQa(37000); emit("blur"); emit("focus"); advanceTime(67000);
  assert.equal(qaOpen, true); assert.equal(paused, true); assert.equal(runStats.activePlayMs, 0); closeQa();

  assert.equal(localStorage.getItem("devToolsOpen"), null); assert.equal(localStorage.getItem("qaOpen"), null);
`);
console.log("PASS: consolidated DEV TOOLS UI, modal timing/input safety, focus, Normal/Debug semantics and Settings/focus regressions.");

const finalUiHtml = fs.readFileSync(`${__dirname}/index.html`, "utf8");
const finalUiCss = fs.readFileSync(`${__dirname}/style.css`, "utf8");
assert.ok(finalUiHtml.includes('id="pause-visual"') && finalUiHtml.includes('>PAUSED</div>'));
assert.ok(finalUiCss.includes(".pause-visual") && finalUiCss.includes("pointer-events: none"));

const finalUiTests = createGame();
finalUiTests(`
  // 開始待ち・通常プレイではPause表示を出さず、手動Pauseだけ盤面へ表示する。
  assert.equal(startScreenOpen, true); assert.equal(pauseVisualElement.hidden, true);
  assert.equal(linesElement.textContent, "0 / 150");
  startGame(); assert.equal(pauseVisualElement.hidden, true);
  togglePause(0); assert.equal(paused, true); assert.equal(pauseVisualElement.hidden, false);
  togglePause(0); assert.equal(paused, false); assert.equal(pauseVisualElement.hidden, true);

  // Manual Pause中でもSettings・DEV TOOLSを開いている間は重複表示しない。
  togglePause(0); openSettings(0); assert.equal(pauseVisualElement.hidden, true);
  closeSettings(); assert.equal(paused, true); assert.equal(pauseVisualElement.hidden, false);
  togglePause(0); openQa(0); assert.equal(pauseVisualElement.hidden, true);
  closeQa(); assert.equal(paused, false); assert.equal(pauseVisualElement.hidden, true);

  // focus停止だけではPause表示を出さず、終了・再開・開始画面でも残さない。
  emit("blur"); assert.equal(pauseVisualElement.hidden, true); emit("focus");
  togglePause(0); endGame(); assert.equal(pauseVisualElement.hidden, true);
  restart(); togglePause(0); completeMarathon(); assert.equal(pauseVisualElement.hidden, true);
  restart(); togglePause(0); restart(); assert.equal(pauseVisualElement.hidden, true);
  showStartScreen(); assert.equal(pauseVisualElement.hidden, true);

  // 目標値には既存定数を使い、開始前・進行中・達成・超過を同じ形式で表示する。
  for (const lines of [0, 1, 149, 150, 152]) {
    totalLines = lines; updateProgressUI();
    assert.equal(linesElement.textContent, lines + " / " + MARATHON_TARGET_LINES);
  }
  selectedStartLevel = 15; restart(); assert.equal(linesElement.textContent, "140 / 150");
`);
console.log("PASS: board Pause overlay lifecycle and LINES current/150 HUD display without gameplay state changes.");

const playAgainStorage = {};
const playAgainTests = createGame(playAgainStorage);
playAgainTests(`
  function assertFreshNormalRun() {
    assert.equal(selectedStartLevel, 1); assert.equal(isQaRun, false);
    assert.equal(level, 1); assert.equal(totalLines, 0); assert.equal(linesElement.textContent, "0 / 150");
    assert.equal(score, 0); assert.equal(gameOver, false); assert.equal(marathonComplete, false);
    assert.equal(startScreenOpen, false); assert.equal(resultsElement.hidden, true); assert.equal(paused, false);
    assert.equal(qaOpen, false); assert.equal(settingsOpen, false); assert.equal(qaRunElement.hidden, true);
    assert.deepEqual(runStats, createEmptyRunStats()); assert.equal(heldType, null); assert.equal(holdUsed, false);
    assert.equal(comboCount, -1); assert.equal(backToBackActive, false);
    assert.equal(lockElapsed, 0); assert.equal(lockResets, 0); assert.equal(dropElapsed, 0); assert.equal(lastTime, null);
    assert.equal(activeDirection, null); assert.equal(nextHorizontalTime, Infinity);
    assert.equal(nextSoftDropTime, Infinity); assert.equal(softDropScheduledPiece, null);
    assert.equal(getGravityInterval(), getGravityInterval(1));
    assert.equal(board.length, TOTAL_ROWS); assert.ok(board.every(row => row.every(cell => cell === 0)));
    assert.ok(piece); assert.equal(nextQueue.length, NEXT_COUNT);
  }

  // Normal ResultsからもStart Screenを挟まずfresh Normal Runへ戻る。
  startGame(); runStats.tetrises = 2; endGame(); document.getElementById("play-again").click();
  assertFreshNormalRun();

  // 通常RESTARTはDebug条件を維持し、ResultsのPLAY AGAINだけがNormalへ戻す。
  startDebugLevel(15); restart();
  assert.equal(selectedStartLevel, 15); assert.equal(level, 15); assert.equal(totalLines, 140); assert.equal(isQaRun, false);
  runStats.tSpins = 1; endGame(); document.getElementById("play-again").click();
  assertFreshNormalRun();
  addScore(100); assert.equal(highScore, 100); assert.equal(localStorage.getItem(HIGH_SCORE_KEY), "100");

  // Debug Complete、QA Game Over、QA CompleteのどのResultsからでもNormalへ戻る。
  startDebugLevel(13); completeMarathon(); document.getElementById("play-again").click(); assertFreshNormalRun();
  openQa(0); loadQaTopOut(); hardDrop(); assert.equal(gameOver, true);
  document.getElementById("play-again").click(); assertFreshNormalRun();
  selectedStartLevel = 15; openQa(0); loadQa149To150(); hardDrop(); assert.equal(marathonComplete, true);
  document.getElementById("play-again").click(); assertFreshNormalRun();

  // 前Runの入力やResults待機時間を新Runへ持ち込まない。
  heldKeys.ArrowRight = true; activeDirection = "ArrowRight"; nextHorizontalTime = 10;
  heldKeys.ArrowDown = true; nextSoftDropTime = 10; softDropScheduledPiece = piece;
  runStats.activePlayMs = 5000; endGame(); lastTime = 1000;
  document.getElementById("play-again").click(); assertFreshNormalRun();
  advanceTime(31000); assert.equal(runStats.activePlayMs, 0); const freshY = piece.y;
  advanceTime(32000); assert.equal(runStats.activePlayMs, 1000); assert.equal(piece.y, freshY + 1);
`);
console.log("PASS: PLAY AGAIN always starts a fresh Normal Level 1 run while Restart preserves current Debug/QA conditions.");

const attackGarbageTests = createGame();
attackGarbageTests(`
  // AttackはLock Resultのライン数だけを使い、既存の得点メタデータを参照しない。
  assert.deepEqual([0, 1, 2, 3, 4].map(lines => calculateAttack({ lines })), [0, 0, 1, 2, 4]);
  assert.equal(calculateAttack({ lines: 2, spin: "T_SPIN", perfectClear: true }), 1);
  assert.equal(calculateAttack({ lines: 4, spin: "T_SPIN", perfectClear: true }), 4);
  assert.equal(calculateAttack({ lines: 99 }), 0);

  // Human/CPUのIncoming queueは独立し、0以下のPacketは作らない。
  const attackState = createAttackGarbageState();
  assert.notEqual(attackState.humanIncoming, attackState.secondIncoming);
  assert.equal(createGarbagePacket(0, 3), null);
  enqueueGarbagePacket(attackState.humanIncoming, 0, 3);
  enqueueGarbagePacket(attackState.humanIncoming, 2, 4);
  enqueueGarbagePacket(attackState.secondIncoming, { rows: 1, holeColumn: 8 });
  assert.equal(totalIncomingGarbage(attackState.humanIncoming), 2);
  assert.equal(totalIncomingGarbage(attackState.secondIncoming), 1);
  assert.deepEqual(attackState.humanIncoming, [{ rows: 2, holeColumn: 4 }]);

  // FIFO取消はPacket順を守り、部分消化時も後続Packetのholeを保持する。
  const incoming = [{ rows: 2, holeColumn: 1 }, { rows: 3, holeColumn: 7 }];
  const originalIncoming = JSON.stringify(incoming);
  const cancellation = cancelIncomingGarbage(incoming, 3);
  assert.equal(cancellation.cancelled, 3);
  assert.equal(cancellation.remainingAttack, 0);
  assert.deepEqual(cancellation.queue, [{ rows: 2, holeColumn: 7 }]);
  assert.equal(JSON.stringify(incoming), originalIncoming);
  const excess = cancelIncomingGarbage([{ rows: 1, holeColumn: 2 }], 3);
  assert.equal(excess.cancelled, 1);
  assert.equal(excess.remainingAttack, 2);
  assert.deepEqual(excess.queue, []);

  // Garbage rowは常にCOLS幅で、hole以外が占有される。
  const garbageRow = createGarbageRow(4);
  assert.equal(garbageRow.length, COLS);
  assert.equal(garbageRow[4], 0);
  assert.equal(garbageRow.filter(cell => cell === GARBAGE_CELL).length, COLS - 1);
  const applyState = createPlayerState();
  const originalBottom = applyState.board[TOTAL_ROWS - 1];
  const applyQueue = [{ rows: 2, holeColumn: 4 }];
  const applied = applyGarbagePackets(applyState, applyQueue);
  assert.deepEqual(applied, { appliedRows: 2, garbageOverflow: false });
  assert.equal(applyQueue.length, 0);
  assert.equal(applyState.board.length, TOTAL_ROWS);
  assert.ok(applyState.board.every(row => row.length === COLS));
  assert.deepEqual(applyState.board[TOTAL_ROWS - 1], garbageRow);
  assert.notEqual(applyState.board[TOTAL_ROWS - 1], originalBottom);
  applyState.board[0][0] = 1;
  const overflowQueue = [{ rows: 1, holeColumn: 0 }];
  assert.deepEqual(applyGarbagePackets(applyState, overflowQueue), { appliedRows: 1, garbageOverflow: true });
  const emptyTopState = createPlayerState();
  const emptyTopQueue = [{ rows: 1, holeColumn: 0 }];
  assert.deepEqual(applyGarbagePackets(emptyTopState, emptyTopQueue), { appliedRows: 1, garbageOverflow: false });

  // Lock Resultのライン数から攻撃を作り、Incomingを先に相殺してから適用する。
  function makeLineClearState(lines) {
    const state = createPlayerState();
    state.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    state.board[0][0] = 7; // Perfect Clearを避け、攻撃がスコアへ影響しないことも検証する。
    for (let y = TOTAL_ROWS - lines; y < TOTAL_ROWS; y++) {
      state.board[y].fill(2); state.board[y][4] = 0;
    }
    state.piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: TOTAL_ROWS - 4, color: 1 };
    return state;
  }
  for (const [lines, expectedAttack] of [[1, 0], [2, 1], [3, 2], [4, 4]]) {
    const state = makeLineClearState(lines);
    const opponent = [];
    const outcome = resolveVersusLockFor(state, [], opponent, { holeColumn: 6 });
    assert.equal(outcome.lockResult.lines, lines);
    assert.equal(outcome.rawAttack, expectedAttack);
    assert.equal(state.score, [0, 100, 300, 500, 800][lines]);
    assert.equal(outcome.outgoingAttack, expectedAttack);
    assert.equal(totalIncomingGarbage(opponent), expectedAttack);
    assert.equal(state.gameOver, false);
    assert.ok(state.piece);
  }
  const cancellationState = makeLineClearState(2);
  const cancellationQueue = [{ rows: 3, holeColumn: 3 }];
  const cancellationOpponent = [];
  const cancellationOutcome = resolveVersusLockFor(cancellationState, cancellationQueue, cancellationOpponent);
  assert.equal(cancellationOutcome.rawAttack, 1);
  assert.equal(cancellationOutcome.cancelled, 1);
  assert.equal(cancellationOutcome.garbageApplied, 2);
  assert.equal(cancellationOpponent.length, 0);
  assert.equal(cancellationState.board[TOTAL_ROWS - 1][3], 0);
  assert.equal(cancellationState.board[TOTAL_ROWS - 1].filter(cell => cell === GARBAGE_CELL).length, COLS - 1);

  // Core LockのTop Outは攻撃・Spawnを行わない。GarbageによるoverflowだけがVS側を終端にする。
  const lockOutState = createPlayerState();
  lockOutState.board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
  lockOutState.piece = { rotation: 0, shape: [[1]], x: 0, y: 0, color: 1 };
  const lockOutOpponent = [];
  const lockOutOutcome = resolveVersusLockFor(lockOutState, [], lockOutOpponent);
  assert.equal(lockOutOutcome.terminal, true);
  assert.equal(lockOutOutcome.rawAttack, 0);
  assert.equal(lockOutOpponent.length, 0);
  assert.equal(lockOutState.piece.y, 0);
  const garbageOverflowState = createPlayerState();
  garbageOverflowState.board[0][0] = 7;
  const garbageOverflowQueue = [{ rows: 1, holeColumn: 0 }];
  const garbageOverflowOutcome = resolveVersusLockFor(garbageOverflowState, garbageOverflowQueue, []);
  assert.equal(garbageOverflowOutcome.garbageOverflow, true);
  assert.equal(garbageOverflowOutcome.terminal, true);
  assert.equal(garbageOverflowState.gameOver, true);

  // VS fixtureのRestartは両PlayerStateとIncomingを同時に初期化し、通常モードのResults/High Scoreを使わない。
  startGame(); openQa(0); startVsEngineTest();
  assert.equal(vsEngineTestActive, true);
  assert.equal(dualBoardTestActive, true);
  assert.equal(cpuTestActive, true);
  assert.equal(totalIncomingGarbage(attackGarbageState.humanIncoming), 0);
  assert.equal(totalIncomingGarbage(attackGarbageState.secondIncoming), 0);
  queueQaGarbageToHuman();
  assert.equal(totalIncomingGarbage(attackGarbageState.humanIncoming), 2);
  restart();
  assert.equal(totalIncomingGarbage(attackGarbageState.humanIncoming), 0);
  assert.equal(totalIncomingGarbage(attackGarbageState.secondIncoming), 0);
  assert.equal(currentPlayerState.gameOver, false);
  assert.equal(secondaryPlayerState.gameOver, false);
  assert.equal(resultsElement.hidden, true);
  exitDualBoardTest();
  assert.equal(vsEngineTestActive, false);
  assert.equal(secondaryPlayerState, null);
`);
console.log("PASS: Phase 7A attack table, FIFO garbage cancellation/application, overflow, VS lock flow, isolation and restart reset.");
