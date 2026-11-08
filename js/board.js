/* 棋盤繪製與操作：Canvas 繪製木紋棋盤、雕刻棋子、走子動畫、拖放與點選。 */
(function (global) {
  'use strict';

  const BOARD_THEMES = {
    oak: { tex: 'assets/textures/board_oak.jpg', base: '#d6ab72', line: '#3c230f', text: '#4b2b12', mark: '#3c230f', shade: 0.16, tint: 'rgba(222,160,80,0.16)' },
    maple: { tex: 'assets/textures/board_maple.jpg', base: '#cfad7f', line: '#35261a', text: '#3f2d1c', mark: '#35261a', shade: 0.14 },
    rosewood: { tex: 'assets/textures/board_rosewood.jpg', base: '#7c3a1c', line: '#f1d6a0', text: '#f4dcaa', mark: '#f1d6a0', shade: 0.22, lighten: 0.0 },
    paper: { tex: null, base: '#f0e5ca', base2: '#e6d6b2', line: '#2c2620', text: '#3b3028', mark: '#2c2620', shade: 0.1, noise: true },
    jade: { tex: null, base: '#c3dccb', base2: '#93bfa6', line: '#1f4a3a', text: '#1f4a3a', mark: '#1f4a3a', shade: 0.14, noise: true },
    ink: { tex: null, base: '#262b30', base2: '#1a1e22', line: '#cdb98a', text: '#cdb98a', mark: '#cdb98a', shade: 0.25, noise: true },
  };
  const PIECE_SETS = {
    wood: { kind: 'carved' },
    ivory: { kind: 'flat' },
    classic: { kind: 'image', dir: 'assets/pieces/classic/' },
    trad: { kind: 'image', dir: 'assets/pieces/trad/' },
  };
  const FONTS = {
    kai: '"XQ Kai", "LXGW WenKai TC", "KaiTi", "STKaiti", "DFKai-SB", "BiauKai", serif',
    song: '"Noto Serif TC", "Songti TC", "PMingLiU", "SimSun", serif',
    hei: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", sans-serif',
  };
  // 16 以上是西洋棋子（王后象馬車兵），給被吃清單、記譜用
  const CW = ['', '王', '后', '象', '馬', '車', '', '兵'], CWS = ['', '王', '后', '象', '马', '车', '', '兵'];
  const CHARS = {
    'zh-TW': ['', '帥', '仕', '相', '傌', '俥', '炮', '兵', '', '將', '士', '象', '馬', '車', '砲', '卒'].concat(CW, [''], CW.slice(1)),
    'zh-CN': ['', '帅', '仕', '相', '马', '车', '炮', '兵', '', '将', '士', '象', '马', '车', '炮', '卒'].concat(CWS, [''], CWS.slice(1)),
  };
  const LETTER = ['', 'K', 'A', 'B', 'N', 'R', 'C', 'P'];
  const CHESS_LETTER = ['', 'K', 'Q', 'B', 'N', 'R', '', 'P'];
  const CHESS_GLYPH = ['', '♚', '♛', '♝', '♞', '♜', '', '♟'];
  const STONE = 32;
  const RED_INK = '#b3221a', BLACK_INK = '#1c1a18';
  const MX = 0.7, MY = 1.0; // 邊界（以格寬為單位）
  const imageCache = new Map();

  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const p = new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }

  const ease = t => 1 - Math.pow(1 - t, 3);

  class BoardView {
    constructor(canvas, wrap) {
      this.canvas = canvas;
      this.wrap = wrap;
      this.ctx = canvas.getContext('2d');
      this.board = new Int8Array(90);
      this.flipped = false;
      this.selected = -1;
      this.targets = [];
      this.lastMove = 0;
      this.checkSq = -1;
      this.arrows = [];
      this.marks = [];
      this.anim = null;
      this.drag = null;
      this.pointer = null;
      this.theme = 'oak';
      this.pieceSet = 'wood';
      this.font = 'kai';
      this.lang = 'zh-TW';
      this.coords = true;
      this.showTargets = true;
      this.showLast = true;
      this.animMs = 220;
      this.interactive = true;
      this.images = {};
      this.sprites = new Map();
      this.dpr = 1;
      this.s = 40;
      this.onTap = null;
      this.onDrop = null;
      this.onDragStart = null;
      this.canDrag = null;
      this._raf = 0;
      this._bindInput();
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(wrap);
      else global.addEventListener('resize', () => this.resize());
      this.resize();
    }

    // ---------------------------------------------------------------- 設定
    async setTheme(theme, pieceSet, font, lang) {
      if (theme) this.theme = BOARD_THEMES[theme] ? theme : 'oak';
      if (pieceSet) this.pieceSet = PIECE_SETS[pieceSet] ? pieceSet : 'wood';
      if (font) this.font = FONTS[font] ? font : 'kai';
      if (lang) this.lang = lang === 'zh-CN' ? 'zh-CN' : 'zh-TW';
      const th = BOARD_THEMES[this.theme], ps = PIECE_SETS[this.pieceSet];
      const jobs = [];
      if (th.tex && !this.images[th.tex]) jobs.push(loadImage(th.tex).then(img => { this.images[th.tex] = img; }));
      if (!this.images.pieceWood) jobs.push(loadImage('assets/textures/piece_wood.jpg').then(img => { this.images.pieceWood = img; }));
      if (ps.kind === 'image') {
        for (const side of ['r', 'b']) for (const L of LETTER.slice(1)) {
          const key = ps.dir + side + L;
          if (!this.images[key]) jobs.push(loadImage(ps.dir + side + L + '.svg').then(img => { this.images[key] = img; }));
        }
      }
      for (const side of ['w', 'b']) for (const L of ['K', 'Q', 'B', 'N', 'R', 'P']) {
        const key = 'chess' + side + L;
        if (!this.images[key]) jobs.push(loadImage('assets/pieces/chess/' + side + L + '.svg').then(img => { this.images[key] = img; }));
      }
      this.sprites.clear();
      this.bg = null;
      this.requestDraw();
      await Promise.all(jobs);
      try {
        if (document.fonts && document.fonts.load) {
          await Promise.race([
            Promise.all([
              document.fonts.load('700 40px "XQ Kai"', '帥將楚河漢界'),
              document.fonts.load('700 40px ' + FONTS[this.font].split(',')[0], CHARS[this.lang].join('')),
            ]),
            new Promise(r => setTimeout(r, 2500)),
          ]);
        }
      } catch (e) { /* 字型載入失敗時用系統字 */ }
      this.sprites.clear();
      this.bg = null;
      this.requestDraw();
    }
    setOptions(o) {
      if ('coords' in o) this.coords = o.coords;
      if ('coordStyle' in o) this.coordStyle = o.coordStyle;
      if ('riverText' in o) this.riverText = o.riverText;
      if ('showTargets' in o) this.showTargets = o.showTargets;
      if ('showLast' in o) this.showLast = o.showLast;
      if ('animMs' in o) this.animMs = o.animMs;
      this.bg = null;
      this.requestDraw();
    }
    setFlipped(f) { if (this.flipped !== !!f) { this.flipped = !!f; this.bg = null; this.requestDraw(); } }
    setPosition(board, opts) {
      this.board = Int8Array.from(board);
      opts = opts || {};
      this.lastMove = opts.lastMove || 0;
      this.checkSq = opts.checkSq == null ? -1 : opts.checkSq;
      if (!opts.keepSelection) { this.selected = -1; this.targets = []; }
      this.requestDraw();
    }
    select(sq, targets, style) { this.selected = sq; this.targets = targets || []; this.targetStyle = style || 'move'; this.requestDraw(); }
    setArrows(arrows) { this.arrows = arrows || []; this.requestDraw(); }
    setMarks(marks) { this.marks = marks || []; this.requestDraw(); }
    // 技能狀態：護盾、凍結、石陣
    setEffects(e) { this.effects = e || null; this.requestDraw(); }
    // 技能特效動畫
    fx(kind, o) {
      if (!this.animMs && kind !== 'thunder') return;
      if (document.hidden) return;
      o = o || {};
      const ms = o.ms || ({ thunder: 760, fire: 950, freeze: 700, shield: 700, portal: 760, swap: 650, snipe: 560, knife: 520, spy: 700, rage: 800, phoenix: 1000, stones: 560, chain: 700, fort: 1000, arrows: 800, boats: 760, cicada: 700, promote: 600 }[kind] || 600);
      (this.fxList || (this.fxList = [])).push({ kind, sqs: o.sqs || [], from: o.from == null ? -1 : o.from, to: o.to == null ? -1 : o.to, side: o.side || 0, t0: performance.now(), ms, seed: (Math.random() * 1e9) | 0 });
      this._fxLoop();
    }
    _fxLoop() {
      if (this._fxRaf) return;
      const step = ts => {
        this._fxRaf = 0;
        const t = ts || performance.now();
        this.fxList = (this.fxList || []).filter(f => t - f.t0 < f.ms);
        this.draw(t);
        if (this.fxList.length) this._fxRaf = requestAnimationFrame(step);
      };
      this._fxRaf = requestAnimationFrame(step);
    }

    // ---------------------------------------------------------------- 尺寸
    resize() {
      const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
      if (!w || !h) return;
      const s = Math.max(16, Math.floor(Math.min(w / (8 + 2 * MX), h / (9 + 2 * MY)) * 2) / 2);
      const dpr = Math.min(global.devicePixelRatio || 1, 3);
      if (s === this.s && dpr === this.dpr && this.canvas.width) { if (this.onResize) this.onResize(this.W, this.H); return; }
      this.s = s; this.dpr = dpr;
      this.W = Math.round(s * (8 + 2 * MX)); this.H = Math.round(s * (9 + 2 * MY));
      this.x0 = (this.W - 8 * s) / 2; this.y0 = (this.H - 9 * s) / 2;
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.sprites.clear();
      this.bg = null;
      this.draw();
      if (this.onResize) this.onResize(this.W, this.H);
    }
    sqToXY(sq) {
      const f = sq % 9, r = (sq / 9) | 0;
      const col = this.flipped ? 8 - f : f, row = this.flipped ? r : 9 - r;
      return [this.x0 + col * this.s, this.y0 + row * this.s];
    }
    xyToSq(x, y, loose) {
      const col = Math.round((x - this.x0) / this.s), row = Math.round((y - this.y0) / this.s);
      if (col < 0 || col > 8 || row < 0 || row > 9) return -1;
      const cx = this.x0 + col * this.s, cy = this.y0 + row * this.s;
      if (!loose && Math.hypot(x - cx, y - cy) > this.s * 0.62) return -1;
      const f = this.flipped ? 8 - col : col, r = this.flipped ? row : 9 - row;
      return r * 9 + f;
    }

    // ---------------------------------------------------------------- 背景
    renderBackground() {
      const { W, H, s, x0, y0, dpr } = this;
      const th = BOARD_THEMES[this.theme];
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = th.base;
      g.fillRect(0, 0, W, H);
      const tex = th.tex && this.images[th.tex];
      if (tex) {
        const sc = Math.max(W / tex.width, H / tex.height) * 1.02;
        g.drawImage(tex, (W - tex.width * sc) / 2, (H - tex.height * sc) / 2, tex.width * sc, tex.height * sc);
      } else if (th.base2) {
        const lg = g.createLinearGradient(0, 0, W, H);
        lg.addColorStop(0, th.base); lg.addColorStop(1, th.base2);
        g.fillStyle = lg; g.fillRect(0, 0, W, H);
      }
      if (th.tint) { g.fillStyle = th.tint; g.fillRect(0, 0, W, H); }
      if (th.noise) {
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < (W * H) / 26; i++) {
          g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
          g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
        }
      }
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + th.shade + ')');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);

      g.strokeStyle = th.line;
      g.lineCap = 'square';
      const lw = Math.max(1, s * 0.028);
      g.lineWidth = lw;
      const X = c2 => x0 + c2 * s, Y = r2 => y0 + r2 * s;
      g.beginPath();
      for (let r = 0; r < 10; r++) { g.moveTo(X(0), Y(r)); g.lineTo(X(8), Y(r)); }
      for (let c2 = 0; c2 < 9; c2++) {
        if (c2 === 0 || c2 === 8) { g.moveTo(X(c2), Y(0)); g.lineTo(X(c2), Y(9)); }
        else { g.moveTo(X(c2), Y(0)); g.lineTo(X(c2), Y(4)); g.moveTo(X(c2), Y(5)); g.lineTo(X(c2), Y(9)); }
      }
      g.moveTo(X(3), Y(0)); g.lineTo(X(5), Y(2)); g.moveTo(X(5), Y(0)); g.lineTo(X(3), Y(2));
      g.moveTo(X(3), Y(7)); g.lineTo(X(5), Y(9)); g.moveTo(X(5), Y(7)); g.lineTo(X(3), Y(9));
      g.stroke();
      g.lineWidth = Math.max(2, s * 0.07);
      const pad = s * 0.13;
      g.strokeRect(X(0) - pad, Y(0) - pad, 8 * s + 2 * pad, 9 * s + 2 * pad);
      // 炮位、兵位記號
      g.lineWidth = Math.max(1, s * 0.03);
      g.strokeStyle = th.mark;
      const gap = s * 0.08, arm = s * 0.17;
      const mark = (c2, r2) => {
        const x = X(c2), y = Y(r2);
        g.beginPath();
        for (const dx of [-1, 1]) {
          if ((c2 === 0 && dx < 0) || (c2 === 8 && dx > 0)) continue;
          for (const dy of [-1, 1]) {
            g.moveTo(x + dx * gap, y + dy * (gap + arm));
            g.lineTo(x + dx * gap, y + dy * gap);
            g.lineTo(x + dx * (gap + arm), y + dy * gap);
          }
        }
        g.stroke();
      };
      for (const [c2, r2] of [[1, 2], [7, 2], [1, 7], [7, 7]]) mark(c2, r2);
      for (const c2 of [0, 2, 4, 6, 8]) { mark(c2, 3); mark(c2, 6); }
      // 楚河漢界
      const fam = FONTS.kai;
      g.fillStyle = th.text;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(s * 0.56) + 'px ' + fam;
      const ry = Y(4.5);
      const rt = this.riverText;
      const left = rt ? [rt[0], rt[1]] : ['楚', '河'];
      const right = rt ? [rt[2], rt[3]] : this.lang === 'zh-CN' ? ['汉', '界'] : ['漢', '界'];
      g.globalAlpha = 0.86;
      g.fillText(left[0], X(1.35), ry); g.fillText(left[1], X(2.65), ry);
      g.fillText(right[0], X(5.35), ry); g.fillText(right[1], X(6.65), ry);
      g.globalAlpha = 1;
      if (this.coords && this.coordStyle === 'iccs') {
        g.font = '600 ' + Math.max(9, Math.round(s * 0.28)) + 'px ' + FONTS.song;
        g.fillStyle = th.text;
        g.globalAlpha = 0.78;
        const letters = 'abcdefghi';
        for (let c2 = 0; c2 < 9; c2++) {
          const L = letters[this.flipped ? 8 - c2 : c2];
          g.fillText(L, X(c2), Y(9) + s * 0.66);
          g.fillText(L, X(c2), Y(0) - s * 0.66);
        }
        for (let r2 = 0; r2 < 10; r2++) {
          const n = String(this.flipped ? r2 : 9 - r2);
          g.fillText(n, X(0) - s * 0.5, Y(r2));
          g.fillText(n, X(8) + s * 0.5, Y(r2));
        }
        g.globalAlpha = 1;
      } else if (this.coords) {
        g.font = '600 ' + Math.max(9, Math.round(s * 0.28)) + 'px ' + FONTS.song;
        g.fillStyle = th.text;
        g.globalAlpha = 0.78;
        const topNums = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const botRed = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
        const botBlack = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];
        const topRed = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
        const top = this.flipped ? topRed : topNums;
        const bot = this.flipped ? botBlack : botRed;
        for (let c2 = 0; c2 < 9; c2++) {
          g.fillText(top[c2], X(c2), Y(0) - s * 0.66);
          g.fillText(bot[c2], X(c2), Y(9) + s * 0.66);
        }
        g.globalAlpha = 1;
      }
      this.bg = c;
    }

    // ---------------------------------------------------------------- 棋子
    // 西洋棋子：琺瑯圓座加上 Cburnett 立體棋子圖；石陣：花崗岩圓石
    specialSprite(pc, lifted) {
      const key = pc + (lifted ? 'L' : '');
      const s = this.s, dpr = this.dpr, R = s * 0.455;
      const size = Math.ceil(R * 2 + s * 0.36);
      const c = document.createElement('canvas');
      c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const cx = size / 2, cy = size / 2;
      g.save();
      g.shadowColor = 'rgba(20,12,5,' + (lifted ? 0.5 : 0.42) + ')';
      g.shadowBlur = R * (lifted ? 0.5 : 0.24);
      g.shadowOffsetY = R * (lifted ? 0.22 : 0.1);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
      const lg = g.createLinearGradient(0, cy - R, 0, cy + R);
      if (pc === STONE) { lg.addColorStop(0, '#9a9a94'); lg.addColorStop(1, '#55554f'); }
      else if (((pc >> 3) & 1) === 0) { lg.addColorStop(0, '#5f7398'); lg.addColorStop(1, '#253049'); }
      else { lg.addColorStop(0, '#f7efdc'); lg.addColorStop(1, '#cdb88c'); }
      g.fillStyle = lg; g.fill();
      g.restore();
      if (pc === STONE) {
        let sd = 11;
        const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
        for (let i = 0; i < 70; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)'; g.beginPath(); g.arc(cx + (rnd() - 0.5) * 2 * R, cy + (rnd() - 0.5) * 2 * R, R * (0.04 + rnd() * 0.08), 0, Math.PI * 2); g.fill(); }
        g.restore();
        g.lineWidth = R * 0.07; g.strokeStyle = 'rgba(30,30,28,0.6)';
        g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#f1ead8';
        g.font = '700 ' + Math.round(R * 1.0) + 'px ' + FONTS[this.font];
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('陣', cx, cy + R * 0.05);
      } else {
        const white = ((pc >> 3) & 1) === 0;
        g.lineWidth = R * 0.09; g.strokeStyle = white ? '#d9b86e' : '#7b5631';
        g.beginPath(); g.arc(cx, cy, R * 0.92, 0, Math.PI * 2); g.stroke();
        const hl = g.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.05, cx, cy, R);
        hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.04)'); hl.addColorStop(1, 'rgba(0,0,0,0.12)');
        g.fillStyle = hl; g.beginPath(); g.arc(cx, cy, R * 0.88, 0, Math.PI * 2); g.fill();
        const img = this.images['chess' + (white ? 'w' : 'b') + CHESS_LETTER[pc & 7]];
        if (img) g.drawImage(img, cx - R * 0.84, cy - R * 0.9, R * 1.68, R * 1.68);
        else {
          g.fillStyle = white ? '#f4f4f4' : '#1d1d1d';
          g.font = Math.round(R * 1.25) + 'px "Segoe UI Symbol", "Noto Sans Symbols 2", serif';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(CHESS_GLYPH[pc & 7] + '︎', cx, cy + R * 0.06);
        }
      }
      const out = { c, size };
      this.sprites.set(key, out);
      return out;
    }
    sprite(pc, lifted) {
      const key = pc + (lifted ? 'L' : '');
      const cached = this.sprites.get(key);
      if (cached) return cached;
      if (pc >= 16) return this.specialSprite(pc, lifted);
      const s = this.s, dpr = this.dpr, R = s * 0.455;
      const size = Math.ceil(R * 2 + s * 0.36);
      const c = document.createElement('canvas');
      c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const cx = size / 2, cy = size / 2;
      const red = pc < 8;
      const ink = red ? RED_INK : BLACK_INK;
      const set = PIECE_SETS[this.pieceSet];
      const ch = CHARS[this.lang][pc];
      // 陰影
      g.save();
      g.shadowColor = 'rgba(30,15,5,' + (lifted ? 0.5 : 0.42) + ')';
      g.shadowBlur = R * (lifted ? 0.5 : 0.24);
      g.shadowOffsetY = R * (lifted ? 0.22 : 0.1);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fillStyle = set.kind === 'flat' ? '#efe6d2' : '#c99a5e';
      g.fill();
      g.restore();
      if (set.kind === 'image') {
        const img = this.images[set.dir + (red ? 'r' : 'b') + LETTER[pc & 7]];
        if (img) {
          g.drawImage(img, cx - R * 1.04, cy - R * 1.04, R * 2.08, R * 2.08);
          this.sprites.set(key, { c, size });
          return { c, size };
        }
      }
      if (set.kind === 'flat') {
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
        const lg = g.createLinearGradient(0, cy - R, 0, cy + R);
        lg.addColorStop(0, '#fbf6ea'); lg.addColorStop(1, '#e9dcc0');
        g.fillStyle = lg; g.fill();
        g.lineWidth = R * 0.07; g.strokeStyle = ink;
        g.beginPath(); g.arc(cx, cy, R * 0.84, 0, Math.PI * 2); g.stroke();
        g.lineWidth = R * 0.04; g.strokeStyle = 'rgba(60,40,20,.45)';
        g.beginPath(); g.arc(cx, cy, R - R * 0.02, 0, Math.PI * 2); g.stroke();
      } else {
        // 木頭本體
        g.save();
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
        const wood = this.images.pieceWood;
        if (wood) {
          const off = (pc * 37) % 60;
          g.drawImage(wood, off, off, wood.width * 0.5, wood.height * 0.5, cx - R, cy - R, R * 2, R * 2);
          g.fillStyle = 'rgba(255,236,200,0.18)';
          g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        } else {
          g.fillStyle = '#e2bf88';
          g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        }
        const rg = g.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.05, cx, cy, R * 1.02);
        rg.addColorStop(0, 'rgba(255,250,235,0.62)');
        rg.addColorStop(0.45, 'rgba(255,240,210,0.10)');
        rg.addColorStop(0.86, 'rgba(90,50,15,0.10)');
        rg.addColorStop(1, 'rgba(70,35,8,0.55)');
        g.fillStyle = rg;
        g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        g.restore();
        // 邊緣
        g.lineWidth = Math.max(1, R * 0.05);
        g.strokeStyle = 'rgba(80,45,15,0.55)';
        g.beginPath(); g.arc(cx, cy, R - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
        // 刻線圈
        const rr = R * 0.8;
        g.lineWidth = Math.max(1, R * 0.05);
        g.strokeStyle = 'rgba(255,248,230,0.55)';
        g.beginPath(); g.arc(cx + 0.6, cy + 0.8, rr, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = ink;
        g.globalAlpha = 0.9;
        g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
      // 字
      const fs = Math.round(R * (this.font === 'kai' ? 1.12 : 1.0));
      g.font = (this.font === 'hei' ? '800 ' : '700 ') + fs + 'px ' + FONTS[this.font];
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const m = g.measureText(ch);
      const asc = m.actualBoundingBoxAscent || fs * 0.8, desc = m.actualBoundingBoxDescent || fs * 0.12;
      const ty = cy + (asc - desc) / 2;
      if (set.kind !== 'flat') {
        g.fillStyle = 'rgba(255,250,236,0.7)';
        g.fillText(ch, cx + 0.7, ty + 1);
        g.fillStyle = 'rgba(40,20,5,0.35)';
        g.fillText(ch, cx - 0.5, ty - 0.6);
      }
      g.fillStyle = ink;
      g.fillText(ch, cx, ty);
      const out = { c, size };
      this.sprites.set(key, out);
      return out;
    }
    // 給 DOM 用的小圖（被吃棋子、調色盤）
    pieceDataURL(pc, px) {
      const save = { s: this.s, dpr: this.dpr, sprites: this.sprites };
      this.s = px / 0.95; this.dpr = 2; this.sprites = new Map();
      const sp = this.sprite(pc);
      const url = sp.c.toDataURL();
      Object.assign(this, save);
      return url;
    }

    // ---------------------------------------------------------------- 繪製
    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }
    drawPiece(g, pc, x, y, lifted, alpha, scale) {
      const sp = this.sprite(pc, lifted);
      const sz = sp.size * (scale || 1);
      if (alpha != null && alpha < 1) g.globalAlpha = alpha;
      g.drawImage(sp.c, x - sz / 2, y - sz / 2 - (lifted ? this.s * 0.06 : 0), sz, sz);
      g.globalAlpha = 1;
    }
    corners(g, x, y, color, size, lw) {
      const s = this.s, d = s * size, a = s * 0.16;
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath();
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
        g.moveTo(x + dx * d, y + dy * (d - a));
        g.lineTo(x + dx * d, y + dy * d);
        g.lineTo(x + dx * (d - a), y + dy * d);
      }
      g.stroke();
    }
    arrow(g, from, to, color) {
      const [x1, y1] = this.sqToXY(from), [x2, y2] = this.sqToXY(to);
      const s = this.s, ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
      const head = s * 0.38, w = s * 0.13;
      g.save();
      g.translate(x1, y1); g.rotate(ang);
      g.globalAlpha = 0.78;
      g.fillStyle = color;
      g.beginPath();
      const start = s * 0.18, end = len - s * 0.12;
      g.moveTo(start, -w / 2); g.lineTo(end - head, -w / 2); g.lineTo(end - head, -head * 0.55);
      g.lineTo(end, 0); g.lineTo(end - head, head * 0.55); g.lineTo(end - head, w / 2); g.lineTo(start, w / 2);
      g.closePath(); g.fill();
      g.restore();
    }
    draw(now) {
      const g = this.ctx, s = this.s;
      if (!this.W) return;
      if (!this.bg) this.renderBackground();
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, this.W, this.H);
      g.drawImage(this.bg, 0, 0, this.W, this.H);
      const lineColor = BOARD_THEMES[this.theme].line;
      const accent = this.theme === 'ink' || this.theme === 'rosewood' ? '#ffd27a' : '#1f6f8b';
      // 最後一步
      if (this.showLast && this.lastMove) {
        const from = this.lastMove & 255, to = this.lastMove >> 8;
        const [fx, fy] = this.sqToXY(from), [tx, ty] = this.sqToXY(to);
        g.fillStyle = 'rgba(31,111,139,0.16)';
        g.beginPath(); g.arc(fx, fy, s * 0.2, 0, Math.PI * 2); g.fill();
        this.corners(g, fx, fy, accent, 0.4, Math.max(1.5, s * 0.04));
        this.corners(g, tx, ty, accent, 0.52, Math.max(2, s * 0.06));
      }
      // 將軍光暈
      if (this.checkSq >= 0) {
        const [kx, ky] = this.sqToXY(this.checkSq);
        const rg = g.createRadialGradient(kx, ky, s * 0.3, kx, ky, s * 0.85);
        rg.addColorStop(0, 'rgba(230,40,20,0.75)'); rg.addColorStop(1, 'rgba(230,40,20,0)');
        g.fillStyle = rg;
        g.beginPath(); g.arc(kx, ky, s * 0.85, 0, Math.PI * 2); g.fill();
      }
      // 選取光圈
      if (this.selected >= 0) {
        const [sx, sy] = this.sqToXY(this.selected);
        g.fillStyle = 'rgba(40,140,100,0.28)';
        g.beginPath(); g.arc(sx, sy, s * 0.58, 0, Math.PI * 2); g.fill();
      }
      // 自訂標記
      for (const mk of this.marks) {
        const [mx, my] = this.sqToXY(mk.sq);
        g.strokeStyle = mk.color || '#d4a017'; g.lineWidth = Math.max(2, s * 0.07);
        g.beginPath(); g.arc(mx, my, s * 0.5, 0, Math.PI * 2); g.stroke();
      }
      // 可走位置（空格）
      const skillMode = this.targetStyle === 'skill';
      const tset = new Set(this.showTargets || skillMode ? this.targets : []);
      for (const t of tset) {
        if (this.board[t]) continue;
        const [x, y] = this.sqToXY(t);
        g.fillStyle = skillMode ? 'rgba(212,150,20,0.85)' : 'rgba(32,120,90,0.75)';
        g.beginPath(); g.arc(x, y, s * (skillMode ? 0.16 : 0.13), 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
        g.stroke();
      }
      // 石陣
      const ef = this.effects;
      if (ef && ef.stones) for (const st of ef.stones) {
        const [x, y] = this.sqToXY(st.sq);
        this.drawPiece(g, STONE, x, y, false);
        this.badge(g, x, y, st.left, '#5d5d57');
      }
      // 棋子
      const anim = this.anim;
      let t = 1;
      if (anim) {
        t = Math.min(1, ((now || performance.now()) - anim.t0) / anim.ms);
      }
      for (let sq = 0; sq < 90; sq++) {
        const pc = this.board[sq];
        if (!pc) continue;
        if (anim && sq === anim.to) continue;
        if (this.drag && sq === this.drag.from) {
          const [x, y] = this.sqToXY(sq);
          this.drawPiece(g, pc, x, y, false, 0.35);
          continue;
        }
        const [x, y] = this.sqToXY(sq);
        this.drawPiece(g, pc, x, y, sq === this.selected && !this.drag);
      }
      // 凍結、護盾
      if (ef) {
        for (const fz of ef.frozen || []) {
          if (anim && fz.sq === anim.to) continue;
          const [x, y] = this.sqToXY(fz.sq);
          g.save();
          g.fillStyle = 'rgba(170,215,255,0.5)';
          g.beginPath(); g.arc(x, y, s * 0.46, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1.2, s * 0.035); g.lineCap = 'round';
          for (let k = 0; k < 6; k++) {
            const a = k * Math.PI / 3, r1 = s * 0.36;
            const ex = x + Math.cos(a) * r1, ey = y + Math.sin(a) * r1;
            g.beginPath(); g.moveTo(x + Math.cos(a) * s * 0.12, y + Math.sin(a) * s * 0.12); g.lineTo(ex, ey); g.stroke();
            const bx = x + Math.cos(a) * r1 * 0.68, by = y + Math.sin(a) * r1 * 0.68;
            for (const d of [-0.6, 0.6]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + d) * s * 0.1, by + Math.sin(a + d) * s * 0.1); g.stroke(); }
          }
          g.strokeStyle = 'rgba(90,160,230,0.95)'; g.lineWidth = Math.max(1.5, s * 0.05);
          g.beginPath(); g.arc(x, y, s * 0.47, 0, Math.PI * 2); g.stroke();
          g.restore();
          this.badge(g, x, y, fz.left, '#3b86c6');
        }
        for (const sh of ef.shields || []) {
          if (anim && sh.sq === anim.to) continue;
          const [x, y] = this.sqToXY(sh.sq);
          g.save();
          g.shadowColor = 'rgba(40,220,255,0.9)'; g.shadowBlur = s * 0.25;
          g.strokeStyle = 'rgba(60,220,255,0.95)'; g.lineWidth = Math.max(2, s * 0.06);
          g.beginPath();
          for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3, r1 = s * 0.56; const px = x + Math.cos(a) * r1, py = y + Math.sin(a) * r1; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
          g.stroke();
          g.restore();
          this.badge(g, x, y, sh.left, '#0f9fc0');
        }
      }
      // 可吃目標（技能模式用金色）
      for (const tq of tset) {
        if (!this.board[tq] || (anim && tq === anim.to)) continue;
        const [x, y] = this.sqToXY(tq);
        g.strokeStyle = skillMode ? 'rgba(222,160,20,0.95)' : 'rgba(200,40,25,0.9)'; g.lineWidth = Math.max(2, s * (skillMode ? 0.085 : 0.07));
        g.beginPath(); g.arc(x, y, s * 0.5, 0, Math.PI * 2); g.stroke();
        if (skillMode) { g.strokeStyle = 'rgba(255,240,190,0.7)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, s * 0.57, 0, Math.PI * 2); g.stroke(); }
      }
      // 動畫中的棋子
      if (anim) {
        const [fx, fy] = this.sqToXY(anim.from), [tx, ty] = this.sqToXY(anim.to);
        const e = ease(t);
        if (anim.captured && t < 1) this.drawPiece(g, anim.captured, tx, ty, false, 1 - e * 0.9, 1 - e * 0.15);
        const lift = Math.sin(Math.PI * t) * s * 0.08;
        this.drawPiece(g, anim.piece, fx + (tx - fx) * e, fy + (ty - fy) * e - lift, t < 1 && t > 0);
      }
      for (const a of this.arrows) this.arrow(g, a.from, a.to, a.color || '#1f8a5b');
      if (this.fxList && this.fxList.length) this.drawFx(g, now || performance.now());
      if (this.drag) this.drawPiece(g, this.board[this.drag.from], this.drag.x, this.drag.y, true, 1, 1.1);
      if (anim) {
        if (t < 1) this._raf = requestAnimationFrame(ts => { this._raf = 0; this.draw(ts); });
        else { const done = anim.done; this.anim = null; this.draw(); if (done) done(); }
      }
      g.strokeStyle = lineColor;
    }
    badge(g, x, y, n, color) {
      if (n == null) return;
      const s = this.s, bx = x + s * 0.34, by = y - s * 0.34, r = s * 0.15;
      g.save();
      g.fillStyle = color; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = '700 ' + Math.round(r * 1.3) + 'px ' + FONTS.hei;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), bx, by + r * 0.06);
      g.restore();
    }
    // 技能特效（粒子、光束、法陣）
    drawFx(g, now) {
      const s = this.s;
      const circle = (x, y, r) => { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); };
      for (const f of this.fxList) {
        const t = Math.max(0, Math.min(1, (now - f.t0) / f.ms));
        let sd = f.seed || 1;
        const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        const at = sq => this.sqToXY(sq);
        g.save();
        switch (f.kind) {
          case 'thunder': {
            const [x, y] = at(f.to);
            if (t < 0.55) {
              g.globalAlpha = 1 - t / 0.55;
              g.strokeStyle = '#fffbe6'; g.lineWidth = Math.max(2, s * 0.09); g.lineJoin = 'round';
              g.shadowColor = '#8fd0ff'; g.shadowBlur = s * 0.6;
              for (let b = 0; b < 2; b++) {
                g.beginPath();
                let px = x + (rnd() - 0.5) * s * 2.4;
                g.moveTo(px, -s * 0.2);
                const segs = 8;
                for (let i = 1; i <= segs; i++) { const yy = y * i / segs; px = i === segs ? x : x + (rnd() - 0.5) * s * 1.1 * (1 - i / segs); g.lineTo(px, yy); }
                g.stroke();
                g.lineWidth = Math.max(1, s * 0.035);
              }
            }
            g.globalAlpha = 1;
            const rg = g.createRadialGradient(x, y, 0, x, y, s * (0.5 + t * 1.1));
            rg.addColorStop(0, 'rgba(255,255,230,' + (0.85 * (1 - t)) + ')'); rg.addColorStop(1, 'rgba(120,190,255,0)');
            g.fillStyle = rg; circle(x, y, s * (0.5 + t * 1.1)); g.fill();
            break;
          }
          case 'fire': {
            for (const sq of f.sqs) {
              const [x, y] = at(sq);
              for (let k = 0; k < 14; k++) {
                const ph = rnd(), sp = 0.6 + rnd() * 0.8, ox = (rnd() - 0.5) * s * 0.9;
                const tt = (t * sp + ph * 0.3) % 1;
                const px = x + ox * (1 - tt * 0.4), py = y + s * 0.35 - tt * s * 1.1;
                const r = s * (0.2 - tt * 0.15) * (1 - t * 0.5);
                const rg = g.createRadialGradient(px, py, 0, px, py, Math.max(0.5, r));
                rg.addColorStop(0, 'rgba(255,240,150,' + (1 - t) + ')'); rg.addColorStop(0.5, 'rgba(255,120,20,' + 0.8 * (1 - t) + ')'); rg.addColorStop(1, 'rgba(180,20,0,0)');
                g.fillStyle = rg; circle(px, py, r); g.fill();
              }
            }
            break;
          }
          case 'freeze': case 'shield': case 'spy': case 'rage': case 'stones': case 'promote': {
            const [x, y] = at(f.to);
            const col = { freeze: '170,220,255', shield: '60,220,255', spy: '170,90,230', rage: '255,80,30', stones: '150,150,140', promote: '255,215,80' }[f.kind];
            g.strokeStyle = 'rgba(' + col + ',' + (1 - t) + ')';
            g.lineWidth = Math.max(2, s * 0.08 * (1 - t));
            circle(x, y, s * (0.3 + t * 0.6)); g.stroke();
            if (f.kind === 'freeze' || f.kind === 'promote') {
              g.lineWidth = Math.max(1, s * 0.04);
              for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + t; g.beginPath(); g.moveTo(x + Math.cos(a) * s * 0.2 * t, y + Math.sin(a) * s * 0.2 * t); g.lineTo(x + Math.cos(a) * s * (0.25 + 0.6 * t), y + Math.sin(a) * s * (0.25 + 0.6 * t)); g.stroke(); }
            }
            if (f.kind === 'rage' || f.kind === 'spy') {
              const rg = g.createRadialGradient(x, y, 0, x, y, s * 0.7);
              rg.addColorStop(0, 'rgba(' + col + ',' + 0.55 * (1 - t) + ')'); rg.addColorStop(1, 'rgba(' + col + ',0)');
              g.fillStyle = rg; circle(x, y, s * 0.7); g.fill();
            }
            if (f.kind === 'stones') for (let k = 0; k < 10; k++) { const a = rnd() * Math.PI * 2, d = s * (0.3 + t * 0.5 * (0.6 + rnd())); g.fillStyle = 'rgba(120,110,95,' + (1 - t) + ')'; circle(x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.05); g.fill(); }
            break;
          }
          case 'portal': case 'swap': case 'cicada': {
            const pts = [[f.from, 1 - t], [f.to, t]];
            if (f.kind === 'swap') { pts[0][1] = 1 - Math.abs(t - 0.5) * 2; pts[1][1] = pts[0][1]; }
            for (const [sq, k] of pts) {
              if (sq < 0) continue;
              const [x, y] = at(sq);
              const col = f.kind === 'cicada' ? '255,200,60' : '160,90,255';
              for (let i = 0; i < 3; i++) {
                g.strokeStyle = 'rgba(' + col + ',' + (0.9 * Math.max(0.15, k)) + ')';
                g.lineWidth = Math.max(1.5, s * 0.05);
                g.beginPath(); g.arc(x, y, s * (0.2 + i * 0.14) * (0.5 + k * 0.6), t * 9 + i * 2, t * 9 + i * 2 + Math.PI * 1.3); g.stroke();
              }
            }
            break;
          }
          case 'snipe': case 'knife': {
            const [x2, y2] = at(f.to);
            if (f.from >= 0 && t < 0.45) {
              const [x1, y1] = at(f.from);
              g.strokeStyle = f.kind === 'snipe' ? 'rgba(255,170,40,' + (1 - t / 0.45) + ')' : 'rgba(220,40,40,' + (1 - t / 0.45) + ')';
              g.lineWidth = Math.max(2, s * 0.08); g.shadowColor = '#ffb040'; g.shadowBlur = s * 0.3;
              g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + (x2 - x1) * Math.min(1, t / 0.25), y1 + (y2 - y1) * Math.min(1, t / 0.25)); g.stroke();
            }
            if (t > 0.2) {
              const k = (t - 0.2) / 0.8;
              const rg = g.createRadialGradient(x2, y2, 0, x2, y2, s * (0.3 + k * 0.7));
              rg.addColorStop(0, 'rgba(255,230,160,' + (1 - k) + ')'); rg.addColorStop(1, 'rgba(255,90,20,0)');
              g.fillStyle = rg; circle(x2, y2, s * (0.3 + k * 0.7)); g.fill();
              if (f.kind === 'knife') { g.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')'; g.lineWidth = Math.max(2, s * 0.06); g.beginPath(); g.moveTo(x2 - s * 0.45, y2 + s * 0.35); g.quadraticCurveTo(x2, y2 - s * 0.1, x2 + s * 0.45, y2 - s * 0.35); g.stroke(); }
            }
            break;
          }
          case 'phoenix': {
            const [x, y] = at(f.to);
            for (let k = 0; k < 18; k++) {
              const a = rnd() * Math.PI * 2, d = s * (0.1 + rnd() * 0.6) * t;
              const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d - t * s * 0.8 * rnd();
              g.fillStyle = 'rgba(255,' + (150 + ((rnd() * 90) | 0)) + ',40,' + (1 - t) + ')';
              circle(px, py, s * 0.06 * (1 - t * 0.5)); g.fill();
            }
            g.strokeStyle = 'rgba(255,200,60,' + (1 - t) + ')'; g.lineWidth = Math.max(2, s * 0.07);
            circle(x, y, s * (0.25 + t * 0.5)); g.stroke();
            break;
          }
          case 'chain': case 'boats': {
            for (const sq of f.sqs) {
              const [x, y] = at(sq);
              if (f.kind === 'chain') {
                g.strokeStyle = 'rgba(255,205,70,' + (1 - t) + ')'; g.lineWidth = Math.max(2, s * 0.07);
                for (let i = 0; i < 2; i++) { circle(x + (i ? s * 0.18 : -s * 0.18), y, s * (0.32 + t * 0.25)); g.stroke(); }
              } else {
                const up = f.side === 0 ? -1 : 1;
                g.strokeStyle = 'rgba(255,255,255,' + (1 - t) + ')'; g.lineWidth = Math.max(2, s * 0.07); g.lineCap = 'round';
                for (let i = 0; i < 2; i++) { const yy = y + up * s * (t * 0.6 + i * 0.22) - up * s * 0.1; g.beginPath(); g.moveTo(x - s * 0.22, yy - up * s * 0.14); g.lineTo(x, yy); g.lineTo(x + s * 0.22, yy - up * s * 0.14); g.stroke(); }
              }
            }
            break;
          }
          case 'fort': {
            if (!f.sqs.length) break;
            const xs = f.sqs.map(q => at(q)[0]), ys = f.sqs.map(q => at(q)[1]);
            const x0 = Math.min(...xs) - s * 0.6, x1 = Math.max(...xs) + s * 0.6, y0 = Math.min(...ys) - s * 0.6, y1 = Math.max(...ys) + s * 0.6;
            const a = Math.sin(Math.PI * t);
            g.fillStyle = 'rgba(80,170,255,' + 0.25 * a + ')'; g.strokeStyle = 'rgba(120,200,255,' + 0.9 * a + ')'; g.lineWidth = Math.max(2, s * 0.06);
            g.beginPath();
            const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
            g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.stroke();
            break;
          }
          case 'arrows': {
            const up = f.side === 0 ? 1 : -1;
            for (let k = 0; k < 9; k++) {
              const x = this.x0 + rnd() * 8 * s, ph = rnd() * 0.4;
              const tt = Math.min(1, Math.max(0, (t - ph) / 0.6));
              if (tt <= 0 || tt >= 1) continue;
              const ys = up > 0 ? this.y0 - s : this.y0 + 10 * s, ye = this.y0 + (up > 0 ? 7 : 2) * s;
              const y = ys + (ye - ys) * tt;
              g.strokeStyle = 'rgba(90,60,30,' + (1 - tt * 0.5) + ')'; g.lineWidth = Math.max(1.5, s * 0.04);
              g.beginPath(); g.moveTo(x, y - up * s * 0.5); g.lineTo(x, y); g.stroke();
              g.beginPath(); g.moveTo(x - s * 0.08, y - up * s * 0.12); g.lineTo(x, y); g.lineTo(x + s * 0.08, y - up * s * 0.12); g.stroke();
            }
            break;
          }
        }
        g.restore();
      }
    }
    // 走子動畫：先套用新局面，再讓棋子從原位滑到新位
    animate(mv, newBoard, captured, opts, done) {
      const from = mv & 255, to = mv >> 8;
      this.setPosition(newBoard, opts);
      if (!this.animMs || document.hidden) { if (done) done(); return; }
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
      this.anim = { from, to, piece: newBoard[to], captured, t0: performance.now(), ms: this.animMs, done };
      this.draw(performance.now());
    }

    // ---------------------------------------------------------------- 輸入
    _pt(e) {
      const r = this.canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (this.W / r.width), (e.clientY - r.top) * (this.H / r.height)];
    }
    _bindInput() {
      const c = this.canvas;
      c.addEventListener('pointerdown', e => {
        if (!this.interactive) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const [x, y] = this._pt(e);
        const sq = this.xyToSq(x, y);
        this.pointer = { id: e.pointerId, x0: x, y0: y, sq };
        this.dragFrom = (sq >= 0 && this.canDrag && this.canDrag(sq)) ? sq : -1;
        if (this.dragFrom >= 0) { try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        e.preventDefault();
      });
      c.addEventListener('pointermove', e => {
        if (!this.pointer || e.pointerId !== this.pointer.id) return;
        const [x, y] = this._pt(e);
        if (this.dragFrom >= 0 && !this.drag && Math.hypot(x - this.pointer.x0, y - this.pointer.y0) > this.s * 0.22) {
          this.drag = { from: this.dragFrom, x, y };
          if (this.onDragStart) this.onDragStart(this.dragFrom);
        }
        if (this.drag) { this.drag.x = x; this.drag.y = y; this.requestDraw(); }
      });
      const end = (e, cancel) => {
        if (!this.pointer || e.pointerId !== this.pointer.id) return;
        const [x, y] = this._pt(e);
        if (this.drag) {
          const from = this.drag.from, to = cancel ? -1 : this.xyToSq(x, y, true);
          this.drag = null;
          if (this.onDrop) this.onDrop(from, to);
        } else if (!cancel && this.pointer.sq >= 0 && this.onTap) this.onTap(this.pointer.sq);
        this.pointer = null; this.dragFrom = -1;
        this.requestDraw();
      };
      c.addEventListener('pointerup', e => end(e, false));
      c.addEventListener('pointercancel', e => end(e, true));
      c.addEventListener('contextmenu', e => e.preventDefault());
    }
    toBlob(cb) {
      try { this.canvas.toBlob(cb, 'image/png'); } catch (e) { cb(null); }
    }
  }

  global.XQBoardView = BoardView;
  global.XQBoardThemes = Object.keys(BOARD_THEMES);
  global.XQPieceSets = Object.keys(PIECE_SETS);
  global.XQPieceChars = CHARS;
})(window);
