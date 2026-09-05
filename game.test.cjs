// 実行: node game.test.cjs（ゲーム自体の実行にはNode.js不要）
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(`${__dirname}/game.js`, "utf8");

function createGame(storage = {}) {
  const elements = {};
  const listeners = {};
  const context = new Proxy({}, { get: () => () => {} });
  const sandbox = {
    assert,
    document: {
      hidden: false,
      addEventListener(name, listener) { listeners[name] = listener; },
      getElementById(id) {
        return elements[id] ??= {
          width: id === "board" ? 300 : 120,
          height: id === "board" ? 600 : 80,
          getContext: () => context,
          addEventListener(name, listener) { this[name] = listener; },
        };
      },
    },
    localStorage: {
      getItem(key) { return storage[key] ?? null; },
      setItem(key, value) { storage[key] = value; },
    },
    requestAnimationFrame() {},
    key(code, repeat = false, modifiers = {}) { listeners.keydown({ code, repeat, preventDefault() {}, ...modifiers }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return code => vm.runInContext(code, sandbox);
}

const storage = {};
const run = createGame(storage);
run(`
  assert.equal(board.length, 20);
  assert.ok(board.every(row => row.length === 10));
  assert.ok(SHAPES.every(shape => shape.flat().filter(Boolean).length === 4));
  bag = [];
  assert.equal(new Set(Array.from({ length: 7 }, nextType)).size, 7);
  assert.ok(collides([[1]], -1, 0));
  assert.ok(collides([[1]], 10, 0));
  assert.ok(collides([[1]], 0, 20));
  board[5][5] = 1;
  assert.ok(collides([[1]], 5, 5));

  restart();
  piece = { rotation: 0, shape: [[1, 1], [1, 1]], x: 4, y: 0, color: 2 };
  const initialX = piece.x;
  key("ArrowLeft"); key("ArrowRight");
  assert.equal(piece.x, initialX);
  const originalPiece = JSON.stringify(piece);
  assert.equal(ghostY(), 18);
  assert.equal(JSON.stringify(piece), originalPiece);
  key("Space");
  assert.equal(score, 36);
  assert.equal(board[19][4], 2);
  assert.equal(board[18][5], 2);

  restart();
  spawnPiece(0);
  const originalShape = JSON.stringify(piece.shape);
  for (let i = 0; i < 4; i++) key("ArrowUp");
  assert.equal(JSON.stringify(piece.shape), originalShape);
  piece = { rotation: 1, shape: ROTATIONS[0][1], x: 7, y: 0, color: 1 };
  key("ArrowUp");
  assert.equal(piece.rotation, 1);

  // 1〜4行の同時消去と従来の得点。
  for (let count = 1; count <= 4; count++) {
    restart();
    for (let y = 20 - count; y < 20; y++) {
      board[y].fill(2);
      board[y][4] = 0;
    }
    piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: 16, color: 1 };
    lockPiece();
    assert.equal(score, [0, 100, 300, 500, 800][count]);
    assert.equal(totalLines, count);
    assert.equal(board.flat().filter(Boolean).length, 4 - count);
  }

  restart();
  const next = upcomingType;
  hardDrop();
  assert.equal(piece.color - 1, next);
  const beforeHold = piece.color - 1;
  const afterHold = upcomingType;
  key("KeyC");
  assert.equal(heldType, beforeHold);
  assert.equal(piece.color - 1, afterHold);
  const heldPiece = JSON.stringify(piece);
  const heldNext = upcomingType;
  key("KeyC");
  assert.equal(JSON.stringify(piece), heldPiece);
  assert.equal(upcomingType, heldNext);
  hardDrop();
  assert.equal(holdUsed, false);
  const beforeSwap = piece.color - 1;
  const nextBeforeSwap = upcomingType;
  key("ArrowUp"); key("ArrowDown"); key("KeyC");
  assert.equal(piece.color - 1, beforeHold);
  assert.equal(heldType, beforeSwap);
  assert.equal(piece.y, 0);
  assert.equal(JSON.stringify(piece.shape), JSON.stringify(ROTATIONS[beforeHold][0]));
  assert.equal(upcomingType, nextBeforeSwap);

  restart();
  board[10].fill(1);
  piece = { rotation: 0, shape: [[1, 1], [1, 1]], x: 4, y: 0, color: 2 };
  assert.equal(ghostY(), 8);
  restart();
  key("ArrowDown");
  assert.equal(score, 1);
  assert.equal(piece.y, 1);
  update(0); update(699);
  assert.equal(piece.y, 1);
  update(700);
  assert.equal(piece.y, 2);

  totalLines = 9;
  board[19].fill(1); board[19][4] = 0;
  piece = { rotation: 0, shape: [[1], [1], [1], [1]], x: 4, y: 16, color: 1 };
  lockPiece();
  assert.equal(level, 2);
  assert.equal(dropInterval(), 640);
  update(1339);
  assert.equal(piece.y, 0);
  update(1340);
  assert.equal(piece.y, 1);
  level = 100;
  assert.equal(dropInterval(), 100);

  restart();
  update(0); update(300);
  key("KeyP");
  const pausedState = JSON.stringify([board, piece, score, heldType, upcomingType]);
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyC"]) key(code);
  update(10000);
  assert.equal(JSON.stringify([board, piece, score, heldType, upcomingType]), pausedState);
  assert.equal(dropElapsed, 300);
  pauseButton.click();
  assert.equal(paused, false);
  update(20000); update(20399);
  assert.equal(piece.y, 0);
  update(20400);
  assert.equal(piece.y, 1);

  board[0].fill(1, 3, 7); board[1].fill(1, 3, 7);
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
  board[0].fill(1, 3, 7); board[1].fill(1, 3, 7);
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
  for (let time = 16; time <= 1008; time += 16) update(time);
  assert.equal(piece.y, 10);
  assert.equal(dropElapsed, 8);
  restart();
  update(0); update(1450);
  assert.equal(piece.y, 2);
  assert.equal(dropElapsed, 50);
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
      key("Space");
      assert.equal(score - previousScore,
        distance * 2 + [0, 100, 300, 500, 800][totalLines - previousLines]);
      drops++;
    } else {
      key(["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyC", "KeyP", "KeyP"][action]);
    }
    time += randomInt(250);
    update(time);
    assert.equal(board.length, 20);
    assert.equal(new Set(board).size, 20);
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

  // 長いフレームでも、新しいブロックへ前の時間を持ち越さない。
  restart();
  update(0); update(100000);
  assert.equal(piece.y, 0);
  assert.equal(dropElapsed, 0);
  assert.equal(board.flat().filter(Boolean).length, 4);
`);
console.log("PASS: all-piece rotation, 20,000 operations, ghost/drop agreement, board invariants and timer boundaries.");

const lockTests = createGame();
lockTests(`
  function floorPiece() {
    restart();
    spawnPiece(1);
    piece.y = 18;
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
  piece.y = 17;
  update(700);
  assert.equal(piece.y, 18);
  assert.equal(lockElapsed, 0);
  update(1199);
  assert.equal(occupied(), 0);
  update(1200);
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
  piece = { rotation: 0, shape: ROTATIONS[0][0], x: 0, y: 18, color: 1 };
  update(400);
  key("ArrowLeft"); key("ArrowUp"); key("ArrowDown");
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
  piece.y = 8;
  board[10][4] = 3;
  lockResets = 15;
  update(0); update(400);
  key("ArrowRight");
  assert.equal(isGrounded(), false);
  update(1100);
  assert.equal(piece.y, 9);
  assert.equal(lockElapsed, 400);
  update(7400);
  assert.equal(piece.y, 18);
  assert.equal(lockResets, 15);
  update(7499);
  assert.equal(occupied(), 1);
  update(7500);
  assert.equal(occupied(), 5);

  // 回転によって足場を離れた場合も落下を再開。
  restart();
  spawnPiece(0);
  piece.shape = ROTATIONS[0][1];
  piece.rotation = 1;
  piece.y = 6;
  board[10][piece.x + 2] = 3;
  update(0); update(400);
  key("ArrowUp");
  assert.equal(isGrounded(), false);
  assert.equal(lockResets, 1);
  assert.equal(lockElapsed, 0);
  update(1100);
  assert.equal(piece.y, 7);

  floorPiece();
  update(400);
  key("KeyP");
  update(10000);
  assert.equal(lockElapsed, 400);
  key("KeyP");
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
  board[19].fill(3);
  board[19][4] = board[19][5] = 0;
  update(499);
  assert.equal(totalLines, 0);
  update(500);
  assert.equal(totalLines, 1);
  assert.equal(score, 100);
  assert.equal(occupied(), 2);

  floorPiece();
  board[0].fill(3, 3, 7); board[1].fill(3, 3, 7);
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
    restart(); spawnPiece(type); piece.y = 5;
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
      restart(); spawnPiece(type); piece.y = 5;
      for (let i = 0; i < state; i++) rotate();
      const before = JSON.stringify(piece);
      const current = cells(piece.shape, piece.x, piece.y);
      const target = cells(ROTATIONS[type][(state + 1) % 4], piece.x, piece.y);
      const obstacle = target.find(([x,y]) => !current.some(([cx,cy]) => cx === x && cy === y));
      if (obstacle) {
        board[obstacle[1]][obstacle[0]] = 7;
        lockElapsed = 200;
        key("ArrowUp");
        assert.equal(JSON.stringify(piece), before);
        assert.equal(lockElapsed, 200);
        assert.equal(lockResets, 0);
      }

      // 全種類・全方向でゴースト位置と固定マス・ドロップ得点が一致。
      restart(); spawnPiece(type); piece.y = 5;
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
  // 壁際は座標補正しない。空白部分が盤外にあっても実ブロックで判定。
  restart(); spawnPiece(0); rotate(); piece.x = -2;
  assert.equal(collides(piece.shape, piece.x, piece.y), false);
  const atWall = JSON.stringify(piece);
  rotate();
  assert.equal(JSON.stringify(piece), atWall);

  // HOLDで向きを初期化し、NEXTを余分に消費しない。
  restart(); spawnPiece(2); piece.y = 5; rotate(); hold();
  hardDrop();
  const nextBefore = upcomingType;
  hold();
  assert.equal(piece.color, 3);
  assert.equal(piece.rotation, 0);
  assert.deepEqual(piece.shape, ROTATIONS[2][0]);
  assert.equal(upcomingType, nextBefore);
  assert.equal(JSON.stringify(ROTATIONS), originalStates);
`);
console.log("PASS: fixed rotation centers, four states, O stability, I coordinates, collision rejection, all-orientation ghost/drop and HOLD reset.");
