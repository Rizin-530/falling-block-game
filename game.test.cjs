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
  piece = { shape: [[1, 1], [1, 1]], x: 4, y: 0, color: 2 };
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
  piece = { shape: [[1, 1, 1, 1]], x: 3, y: 0, color: 1 };
  const originalShape = JSON.stringify(piece.shape);
  for (let i = 0; i < 4; i++) key("ArrowUp");
  assert.equal(JSON.stringify(piece.shape), originalShape);
  piece = { shape: [[1], [1], [1], [1]], x: 9, y: 0, color: 1 };
  key("ArrowUp");
  assert.equal(piece.shape[0].length, 1);

  // 1〜4行の同時消去と従来の得点。
  for (let count = 1; count <= 4; count++) {
    restart();
    for (let y = 20 - count; y < 20; y++) {
      board[y].fill(2);
      board[y][4] = 0;
    }
    piece = { shape: [[1], [1], [1], [1]], x: 4, y: 16, color: 1 };
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
  assert.equal(JSON.stringify(piece.shape), JSON.stringify(SHAPES[beforeHold]));
  assert.equal(upcomingType, nextBeforeSwap);

  restart();
  board[10].fill(1);
  piece = { shape: [[1, 1], [1, 1]], x: 4, y: 0, color: 2 };
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
  piece = { shape: [[1], [1], [1], [1]], x: 4, y: 16, color: 1 };
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

  board[0].fill(1);
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
  board[0].fill(1);
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
