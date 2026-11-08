# 楚河漢界象棋

在電腦與手機（含 iPhone）瀏覽器上玩的象棋，單一網頁、不用安裝、不用帳號，對局只存在你自己的瀏覽器裡。

**線上遊玩：https://benjaminwz.github.io/xiangqi/**

## 玩法

- **經典象棋**：人機對弈（入門到特級大師六種難度）、雙人對弈、電腦對弈，可讓子、可計時；殺法練習 77 題、每日一題、25 個成就、擺棋、自由研究（引擎即時分析）、全局分析。
- **鴉片戰爭**：象棋軍對上西洋軍，在同一張棋盤上各照各的走法。為了平衡，象棋軍有三條出征規則：帥可在九宮內斜走、仕相不受九宮與河界限制、兵卒到底線升變為俥傌炮。「均衡」兵力（西洋軍開局無后）在電腦自我對戰中勝負接近；「完整」兵力有后，西洋軍較強。
- **魔幻技能**：每回合可以走棋，或花能量發動技能。共 17 個技能：兵法計策（連環計、金蟬脫殼、空城計、借刀殺人、火燒連營、八陣圖……）與英雄異能（天雷、能量護盾、寒冰凍結、傳送門、狂化、神射、鳳凰涅槃）。每方帶 4 個，可用預設組、隨機或自選。也能和鴉片戰爭一起開。

棋譜可匯入、匯出（PGN、中文記譜、WXF、ICCS、FEN），可存成「我的棋譜」，有戰績與等級分；介面有繁體中文、简体中文、English。

## 加到手機主畫面

- **iPhone / iPad**：用 Safari 開啟上面的網址 → 點下方「分享」→「加入主畫面」→「新增」。之後從主畫面圖示開啟就是全螢幕 App，離線也能玩。
- **Android**：用 Chrome 開啟 → 右上角選單 →「安裝應用程式」或「加到主畫面」。
- **電腦**：Chrome 或 Edge 網址列右側的安裝圖示。

## 素材來源與授權

| 素材 | 來源 | 授權 |
| --- | --- | --- |
| 棋盤、棋子木紋 | [Poly Haven](https://polyhaven.com/textures/wood) | CC0 |
| 圖組象棋子 | Wikimedia Commons（Wj654cj86、Inductiveload），經 [xiangqiboard.js](https://github.com/lengyanyu258/xiangqiboardjs) 整理 | 公有領域 |
| 西洋棋子 | [Cburnett](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces)，Wikimedia Commons（只移除了檔頭的 DOCTYPE） | CC BY-SA 3.0 |
| 技能圖示 | Lorc、Delapouite，[game-icons.net](https://game-icons.net)（轉成單色內嵌圖示） | CC BY 3.0 |
| 音效 | [Kenney](https://kenney.nl/assets) Impact Sounds、Casino Audio、Interface Sounds、Music Jingles、Sci-Fi Sounds | CC0 |
| 背景音樂 | 古琴〈流水〉〈平沙落雁〉〈酒狂〉、琴歌〈秋風詞〉，Charlie Huang 演奏，[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Liu_Shui.ogg)（轉檔為 MP3） | CC BY 2.5 |
| 棋子字型 | [霞鶩文楷 TC](https://github.com/lxgw/LxgwWenkaiTC)（只保留棋盤用到的字，授權全文見 `assets/fonts/OFL.txt`） | SIL OFL 1.1 |

電腦對手、規則判定、殺法題與介面程式都是本專案自己寫的，不依賴外部函式庫。

## 開發

```bash
node tools/test-engine.js     # 經典象棋引擎測試（perft、記譜、規則、搜尋）
node tools/test-variant.js    # 鴉片戰爭、魔幻技能引擎測試
node tools/build.js           # 重新產生 index.html、sw.js、简体字串（需要裝有 opencc 的 Python，用 PYTHON 環境變數指定）
```

原始頁面骨架在 `src/body.html`，樣式在 `css/app.css`，程式在 `js/`。
