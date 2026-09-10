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
  const sandbox = {
    assert,
    drawCalls,
    captureDraw: false,
    window: { addEventListener(name, listener) { listeners[name] = listener; } },
    emit(name) { listeners[name](); },
    document: {
      hidden: false,
      addEventListener(name, listener) { listeners[name] = listener; },
      getElementById(id) {
        return elements[id] ??= {
          width: id === "board" ? 300 : 120,
          height: id === "board" ? 600 : id === "next" ? 200 : 80,
          getContext: () => id === "board" ? context : previewContext,
          addEventListener(name, listener) {
            this[name] = (event = { timeStamp: vm.runInContext("lastTime ?? 0", sandbox) }) => listener(event);
          },
        };
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
    press(code, timeStamp, repeat = false) { listeners.keydown({ code, timeStamp, repeat, preventDefault() {} }); },
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
    for (let y = TOTAL_ROWS - count; y < TOTAL_ROWS; y++) {
      board[y].fill(2);
      board[y][4] = 0;
    }
    piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: HIDDEN_ROWS + 16, color: 1 };
    lockPiece();
    assert.equal(score, [0, 100, 300, 500, 800][count]);
    assert.equal(totalLines, count);
    assert.equal(board.flat().filter(Boolean).length, 4 - count);
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
      assert.equal(board.flat().filter(Boolean).length,4-lines);
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
    assert.equal(Number(linesElement.textContent),totalLines);
    assert.equal(b2bElement.textContent,backToBackActive ? "B2B ON" : "B2B OFF");
    assert.equal(comboElement.textContent,!gameOver && comboCount>0 ? "COMBO "+comboCount : "");
  }
  restart(); checkUI(); assert.equal(Number(linesElement.textContent),0);
  for(const [spin,maximum] of [["NONE",4],["T_SPIN",3],["T_SPIN_MINI",2]]) {
    for(let lines=0;lines<=maximum;lines++) {
      restart(); finishB2BClear(spin,lines); checkUI();
      assert.equal(Number(linesElement.textContent),lines);
      const expected=spin==="NONE" ? "" : (spin==="T_SPIN" ? "T-SPIN" : "T-SPIN MINI")+[""," SINGLE"," DOUBLE"," TRIPLE"][lines];
      assert.equal(clearEventElement.textContent,expected);
    }
  }
  restart();
  for(let i=0;i<3;i++) { finishB2BClear("NONE",1); checkUI(); }
  assert.equal(comboElement.textContent,"COMBO 2");
  assert.equal(Number(linesElement.textContent),3);
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
  assert.equal(Number(linesElement.textContent),0); assert.equal(b2bElement.textContent,"B2B OFF");
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
    debugLevelSelect.value = String(value);
    debugLevelSelect.change();
  }
  const expectedIntervals = { 1: 1000, 5: 355, 10: 64, 13: 18, 15: 7 };
  for (const selected of [1, 5, 10, 13, 15]) {
    selectDebugLevel(selected);
    assert.equal(selectedStartLevel, selected);
    assert.equal(level, selected);
    assert.equal(totalLines, (selected - 1) * 10);
    assert.equal(Number(levelElement.textContent), selected);
    assert.equal(Number(linesElement.textContent), (selected - 1) * 10);
    assert.equal(debugLevelSelect.value, String(selected));
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
  assert.equal(clearEventElement.textContent, "T-SPIN SINGLE");
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
  debugLevelSelect.value = "15"; debugLevelSelect.change();
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
  debugLevelSelect.value = "13"; debugLevelSelect.change();
  assert.equal(marathonComplete, false); assert.equal(totalLines, 120); assert.equal(level, 13);
`);
console.log("PASS: Marathon Complete at 150+, final scoring/B2B/Combo, no spawn, frozen input, restart, Game Over separation and debug high-score isolation.");
