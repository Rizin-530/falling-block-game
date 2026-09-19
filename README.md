# Falling Block Game

**Play Online:** [Falling Block Gameをプレイ](https://rizin-530.github.io/falling-block-game/)

ブラウザで遊べる、シンプルな落ちものブロックパズルゲームです。150 Linesの消去を目指すMarathon形式で、HOLD、NEXT、Ghost、T-Spin、Back-to-Back、Combo、Perfect Clearなどに対応しています。Vanilla HTML / CSS / JavaScriptだけで動作します。

## ゲーム概要

7種類のピースを移動・回転させ、横一列を埋めるとラインが消えます。10 Lines消去するごとにLevelが上がり、自動落下が速くなります。

150 Linesを消去すると`MARATHON COMPLETE`です。新しいピースを出せない状態になると`GAME OVER`になり、どちらの場合もResults画面が表示されます。

## 主な機能

- 10×20の表示盤面と7種類のピース
- 7種類を1組として出現させる7-bag
- 次の5ピースを表示する`NEXT`
- 1ピースにつき1回交換できる`HOLD`
- 着地点を示すGhost Piece
- 左右90度回転とSRS系Wall Kick
- Soft Drop / Hard Drop
- Lock Delayと移動によるリセット上限
- Levelに応じて速くなるGravity
- T-Spin / T-Spin Mini
- Back-to-Back / Combo / Perfect Clear
- ブラウザに保存されるHigh Score
- Pause、効果音、Visual Effects
- ResultsとPlay Statistics

現代的な落ちものブロックパズルで一般的な仕組みを採用していますが、特定の公式仕様への完全準拠を示すものではありません。

## 遊び方

1. Start Screenの`START`を押すと、Level 1から通常プレイが始まります。
2. ピースを横移動・回転させ、横一列を隙間なく埋めてラインを消します。
3. 150 Linesを消去するとMarathon Completeです。
4. ピースが積み上がり、新しいピースを出せなくなるとGame Overです。

Results画面の`PLAY AGAIN`を押すと、直前のプレイ方法にかかわらずLevel 1の通常プレイが新しく始まります。

## 操作方法

| 操作 | キー |
|---|---|
| 左移動 | `←` |
| 右移動 | `→` |
| 右回転 | `↑` |
| 左回転 | `Z` |
| Soft Drop | `↓` |
| Hard Drop | `Space` |
| HOLD | `C` |
| Pause / Resume | `P` |
| Restart | `R` |

画面上のPause、Restart、Settingsなどのボタンも使用できます。

## Settings

`SETTINGS`では、次の項目を変更できます。

- **DAS**：左右キーを押し続けてから、連続移動が始まるまでの待ち時間
- **ARR**：連続移動が始まった後の横移動間隔
- **SOFT DROP**：Soft Drop中の落下間隔
- **SFX**：効果音のON / OFF
- **VOLUME**：効果音の音量
- **VISUAL EFFECTS**：ライン消去などの視覚効果のON / OFF

設定とHigh Scoreはブラウザの`localStorage`に保存されます。これらのデータを外部サーバーへ送信する処理はありません。

## Results / Play Statistics

Game OverまたはMarathon Completeになると、最終的なScore、Lines、Level、High Scoreと次のプレイ統計が表示されます。

- `PLAY TIME`：ゲームが実際に進行していた時間
- `TETRIS`：4 Lines同時消去の回数
- `T-SPIN`
- `T-SPIN MINI`
- `PERFECT CLEAR`
- `MAX COMBO`：そのプレイで記録した最大Combo

Play Timeには、Pause中やSettings、DEV TOOLSを開いている時間など、ゲーム進行が停止している時間は含まれません。

## 起動方法

ビルドやパッケージのインストールは不要です。

### ローカルHTTPサーバーを使う（推奨）

Pythonが利用できる場合は、プロジェクトのフォルダで次のコマンドを実行します。

```bash
python -m http.server 8000
```

その後、ブラウザで <http://localhost:8000/> を開きます。

### `index.html`を直接開く

簡単に試す場合は、このリポジトリをダウンロードし、`index.html`をWebブラウザで直接開くこともできます。

## DEV TOOLS

`DEV TOOLS`は、Levelごとの速度や終了条件を確認するための開発・試遊用機能です。

- **DEBUG START**：Level 1 / 5 / 10 / 13 / 15から開始
- **LOAD 149 → 150**：Marathon Complete直前の状態を準備
- **CLEAR BOARD**：固定済みブロックを消去
- **FORCE I**：操作中のピースをI型に変更
- **LOAD TOP OUT TEST**：Game Over確認用の状態を準備

Debug RunとQA RunのScoreはHigh Scoreへ保存されません。

## 技術構成

- HTML
- CSS
- Vanilla JavaScript
- Canvas API
- Web Audio API
- `localStorage`

外部フレームワークやライブラリは使用していません。

主なファイルは次の4つです。

| ファイル | 役割 |
|---|---|
| `index.html` | 画面構造と各パネル |
| `style.css` | レイアウト、配色、レスポンシブ表示 |
| `game.js` | ゲーム進行、入力、描画、保存処理 |
| `game.test.cjs` | ゲームロジックとUI状態の自動テスト |

テストはNode.jsで実行できます。

```bash
node --test game.test.cjs
```

## Version

v1.0.0
