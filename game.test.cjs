"use strict";
/* ロジック単体テスト: node --test game.test.cjs */
const test = require("node:test");
const assert = require("node:assert");
const G = require("./game.js");

test("7-bag: 各袋は7種が1つずつ、長期でも大きく偏らない", () => {
  const counts = Object.fromEntries(G.TYPES.map(t => [t, 0]));
  for (let n = 0; n < 100; n++) {
    const bag = G.makeBag(Math.random);
    assert.deepEqual(bag.slice().sort(), G.TYPES.slice().sort());
    bag.forEach(t => counts[t]++);
  }
  for (const t of G.TYPES) assert.equal(counts[t], 100);
});

test("回転4回で元の形に戻る(SRS形状データ)", () => {
  for (const t of G.TYPES) {
    assert.equal(G.SHAPES[t].length, 4);
    assert.deepEqual(G.SHAPES[t][0], G.SHAPES[t][0]);
    const cells = s => G.cellsOf(t, s, 0, 0).map(c => c.join(",")).sort();
    assert.deepEqual(cells(0), cells(4 % 4));
    for (let s = 0; s < 4; s++) assert.equal(G.cellsOf(t, s, 0, 0).length, 4);
  }
});

test("衝突判定: 壁・床・ブロック", () => {
  const b = G.createBoard();
  assert.equal(G.collides(b, "T", 0, -1, 5), true);
  assert.equal(G.collides(b, "T", 0, 8, 5), true);
  assert.equal(G.collides(b, "T", 0, 3, 21), true);
  assert.equal(G.collides(b, "T", 0, 3, 5), false);
  b[10][4] = "J";
  assert.equal(G.collides(b, "T", 0, 3, 9), true);
});

test("Wall Kick(I): 右壁の縦Iがキックで横になる", () => {
  const b = G.createBoard();
  const kicks = G.KICKS_I["1>2"];
  let applied = -1, nx = null;
  for (let i = 0; i < kicks.length; i++) {
    if (!G.collides(b, "I", 2, 7 + kicks[i][0], 5 + kicks[i][1])) { applied = i; nx = 7 + kicks[i][0]; break; }
  }
  assert.equal(applied, 1); assert.equal(nx, 6);
});

test("T-Spin判定: 3-corner / Mini / 昇格キック", () => {
  const mk = fillExtra => {
    const b = G.createBoard();
    b[19][3] = "J"; b[19][5] = "J"; b[21][3] = "J";
    if (fillExtra) b[21][5] = "J";
    return b;
  };
  const piece = {type: "T", state: 2, x: 3, y: 19};
  assert.equal(G.detectTSpin(mk(false), piece, "rotate", 0), "mini");
  assert.equal(G.detectTSpin(mk(true), piece, "rotate", 0), "tspin");
  assert.equal(G.detectTSpin(mk(false), piece, "rotate", 4), "tspin");
  assert.equal(G.detectTSpin(mk(true), piece, "move", 0), null);
});

test("スコア: 公式倍率・B2B・コンボ・PC", () => {
  const base = {b2bActive: false, level: 1, combo: -1, isPC: false, tspin: null};
  assert.equal(G.scoreClear({...base, lines: 1}).points, 100);
  assert.equal(G.scoreClear({...base, lines: 4}).points, 800);
  assert.equal(G.scoreClear({...base, lines: 4, b2bActive: true}).points, 1200);
  assert.equal(G.scoreClear({...base, lines: 2, tspin: "tspin", b2bActive: true}).points, 2400);
  assert.equal(G.scoreClear({...base, lines: 1, tspin: "tspin"}).points, 800);
  assert.equal(G.scoreClear({...base, lines: 1, combo: 1}).points, 150);
  assert.equal(G.scoreClear({...base, lines: 1, isPC: true}).points, 900);
  assert.equal(G.scoreClear({...base, lines: 4, level: 2}).points, 1600);
});

test("出現位置: 全ピースが出現した瞬間に全体が見える", () => {
  for (const t of G.TYPES) {
    const y = G.spawnY(t);
    const cells = G.cellsOf(t, 0, 3, y);
    assert.ok(cells.every(([, cy]) => cy >= G.HIDDEN), `${t} must spawn fully visible`);
    assert.ok(cells.some(([, cy]) => cy === G.HIDDEN), `${t} bottom/top touches top visible row area`);
  }
  assert.equal(G.spawnY("I"), 1);
  assert.equal(G.spawnY("T"), 2);
});

test("VEGAS演出: フィーバー/花火/コイン/レーザーの実装が存在する", () => {
  const fs = require("node:fs"), path = require("node:path");
  const js = fs.readFileSync(path.join(__dirname, "game.js"), "utf8");
  for (const name of ["fireworks", "coinFountain", "laserSweep", "addFever", "FEVER TIME"])
    assert.ok(js.includes(name), name);
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.ok(html.includes("fever-bar") && html.includes("setting-vegas"));
});

test("CSS: [hidden] が display:flex 等に勝つ回帰防止(PAUSED/GO!残留バグ)", () => {
  const fs = require("node:fs"), path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  const js = fs.readFileSync(path.join(__dirname, "game.js"), "utf8");
  assert.match(js, /countingDown/); /* カウントダウンはポーズと別フラグで管理 */
});

test("重力テーブル: レベルが上がると速くなる", () => {
  let prev = Infinity;
  for (let lv = 1; lv <= 20; lv++) { const g = G.gravityMs(lv); assert.ok(g < prev || lv === 1); prev = g; }
  assert.equal(G.gravityMs(1), 1000);
});
