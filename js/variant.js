/*!
 * 變體引擎 VX Engine：中西大戰（西洋棋 vs 象棋）與魔幻技能版。
 * 棋盤沿用象棋座標：sq = rank * 9 + file，rank 0 為下方（先手方）底線。
 * 棋子代碼：side * 8 + type，西洋棋子再加 16；STONE（八陣圖石陣）= 32。
 *   象棋 type：1 帥 2 仕 3 相 4 傌 5 俥 6 炮 7 兵
 *   西洋棋 type：1 王 2 后 3 象（主教）4 馬（騎士）5 車 7 兵
 * 著法編碼：a | (b << 7) | (promo << 14) | (skill << 17)，127 代表「沒有」。
 * 可在網頁主執行緒、Web Worker 或 Node.js（測試）中執行。
 */
function VXEngineModule(global) {
  'use strict';

  // ------------------------------------------------------------------ 常數
  const RED = 0, BLACK = 1;
  const KING = 1, ADVISOR = 2, BISHOP = 3, KNIGHT = 4, ROOK = 5, CANNON = 6, PAWN = 7;
  const QUEEN = 2;
  const CHESS = 16, STONE = 32, NONE = 127;
  const MATE = 30000, WIN = 29000, INF = 32000;
  const FILES = 'abcdefghi';
  const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();
  const isPiece = pc => pc > 0 && pc < STONE;
  const sideOf = pc => (pc >> 3) & 1;
  const FILE_OF = new Int8Array(90), RANK_OF = new Int8Array(90);
  for (let i = 0; i < 90; i++) { FILE_OF[i] = i % 9; RANK_OF[i] = (i / 9) | 0; }
  const sqAt = (f, r) => (f < 0 || f > 8 || r < 0 || r > 9 ? -1 : r * 9 + f);
  const inPalace = (sq, s) => { const f = FILE_OF[sq], r = RANK_OF[sq]; return f >= 3 && f <= 5 && (s === RED ? r <= 2 : r >= 7); };
  const ownHalf = (sq, s) => (s === RED ? RANK_OF[sq] <= 4 : RANK_OF[sq] >= 5);
  const relRank = (sq, s) => (s === RED ? RANK_OF[sq] : 9 - RANK_OF[sq]);

  // 技能表：cost 能量、cd 冷卻（自己的回合數）、once 每局一次、steps 選擇目標的步數
  const SKILLS = [null,
    { id: 1, key: 'chain', cost: 5, cd: 6, steps: 0, group: 'tactic' },
    { id: 2, key: 'cicada', cost: 3, cd: 5, steps: 1, group: 'tactic' },
    { id: 3, key: 'swap', cost: 2, cd: 3, steps: 2, group: 'tactic' },
    { id: 4, key: 'boats', cost: 3, cd: 5, steps: 0, group: 'tactic' },
    { id: 5, key: 'fort', cost: 3, cd: 5, steps: 0, group: 'tactic' },
    { id: 6, key: 'knife', cost: 5, cd: 6, steps: 2, group: 'tactic' },
    { id: 7, key: 'spy', cost: 6, cd: 0, once: true, steps: 1, group: 'tactic' },
    { id: 8, key: 'arrows', cost: 0, cd: 5, steps: 0, group: 'tactic' },
    { id: 9, key: 'fire', cost: 5, cd: 6, steps: 1, group: 'tactic' },
    { id: 10, key: 'stones', cost: 2, cd: 3, steps: 1, group: 'tactic' },
    { id: 11, key: 'thunder', cost: 7, cd: 6, steps: 1, group: 'hero' },
    { id: 12, key: 'shield', cost: 2, cd: 3, steps: 1, group: 'hero' },
    { id: 13, key: 'freeze', cost: 3, cd: 4, steps: 1, group: 'hero' },
    { id: 14, key: 'portal', cost: 3, cd: 4, steps: 2, group: 'hero' },
    { id: 15, key: 'rage', cost: 5, cd: 0, once: true, steps: 1, group: 'hero' },
    { id: 16, key: 'snipe', cost: 3, cd: 3, steps: 2, group: 'hero', needs: 'cannon' },
    { id: 17, key: 'phoenix', cost: 6, cd: 0, once: true, steps: 1, group: 'hero' },
  ];
  const SKILL_ID = {};
  SKILLS.forEach(s => { if (s) SKILL_ID[s.key] = s.id; });
  const PRESETS = {
    tactician: ['chain', 'cicada', 'fort', 'arrows'],
    schemer: ['knife', 'spy', 'swap', 'stones'],
    hero: ['thunder', 'shield', 'freeze', 'portal'],
    blaze: ['fire', 'snipe', 'rage', 'boats'],
  };
  const TACTICAL = new Set([1, 2, 6, 7, 9, 11, 13, 16]);
  const E_MAX = 10, E_START = 2;
  const SHIELD_PLIES = 6, FREEZE_PLIES = 4, STONE_PLIES = 6, MAX_STONES = 2;

  // ------------------------------------------------------------------ 預先計算的走法表
  const ORTH = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const RAYS_O = [], RAYS_D = [], ADJ_O = [], ADJ_D = [], KN = [], HJ = [], HJR = [], EL = [];
  const HORSE = [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]];
  const LJUMP = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  for (let sq = 0; sq < 90; sq++) {
    const f = FILE_OF[sq], r = RANK_OF[sq];
    RAYS_O[sq] = ORTH.map(([df, dr]) => { const a = []; for (let k = 1; ; k++) { const t = sqAt(f + df * k, r + dr * k); if (t < 0) break; a.push(t); } return a; });
    RAYS_D[sq] = DIAG.map(([df, dr]) => { const a = []; for (let k = 1; ; k++) { const t = sqAt(f + df * k, r + dr * k); if (t < 0) break; a.push(t); } return a; });
    ADJ_O[sq] = ORTH.map(([df, dr]) => sqAt(f + df, r + dr)).filter(t => t >= 0);
    ADJ_D[sq] = DIAG.map(([df, dr]) => sqAt(f + df, r + dr)).filter(t => t >= 0);
    KN[sq] = LJUMP.map(([df, dr]) => sqAt(f + df, r + dr)).filter(t => t >= 0);
    HJ[sq] = []; HJR[sq] = []; EL[sq] = [];
    for (const [df, dr, lf, lr] of HORSE) {
      const t = sqAt(f + df, r + dr), leg = sqAt(f + lf, r + lr);
      if (t >= 0 && leg >= 0) HJ[sq].push([t, leg]);
      const h = sqAt(f - df, r - dr);
      if (h >= 0) { const l2 = sqAt(f - df + lf, r - dr + lr); if (l2 >= 0) HJR[sq].push([h, l2]); }
    }
    for (const [df, dr] of DIAG) {
      const t = sqAt(f + 2 * df, r + 2 * dr), eye = sqAt(f + df, r + dr);
      if (t >= 0 && eye >= 0) EL[sq].push([t, eye]);
    }
  }

  // ------------------------------------------------------------------ 雜湊（Zobrist）
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZK = new Int32Array(64 * 90), ZL = new Int32Array(64 * 90);
  for (let i = 0; i < ZK.length; i++) { ZK[i] = rnd(); ZL[i] = rnd(); }
  const ZSK = rnd(), ZSL = rnd();
  const ZE = new Int32Array(2 * 16), ZX = new Int32Array(8), ZF = new Int32Array(2 * 90), ZC = new Int32Array(2 * 32 * 3);
  for (let i = 0; i < ZE.length; i++) ZE[i] = rnd();
  for (let i = 0; i < ZX.length; i++) ZX[i] = rnd();
  for (let i = 0; i < ZF.length; i++) ZF[i] = rnd();
  for (let i = 0; i < ZC.length; i++) ZC[i] = rnd();

  // ------------------------------------------------------------------ 子力與位置分
  const PST = [];
  (function buildPst() {
    for (let pc = 0; pc < 32; pc++) {
      const a = new Int16Array(90);
      if (pc && (pc & 7)) {
        const s = sideOf(pc), tp = pc & 7, chess = (pc & CHESS) !== 0;
        for (let sq = 0; sq < 90; sq++) {
          const f = FILE_OF[sq], rr = relRank(sq, s), cf = 4 - Math.abs(f - 4);
          let v = 0;
          if (!chess) {
            if (tp === KING) v = f === 4 ? 6 : 0;
            else if (tp === ADVISOR) v = 120 + (f === 4 && rr === 1 ? 8 : 0);
            else if (tp === BISHOP) v = 120 + (f === 4 && rr === 2 ? 8 : 0);
            else if (tp === KNIGHT) v = 270 + cf * 6 + (rr >= 3 && rr <= 7 ? 12 + (rr - 3) * 4 : 0) - (f === 0 || f === 8 ? 12 : 0) - (rr === 9 ? 10 : 0);
            else if (tp === ROOK) v = 600 + (rr >= 5 ? 14 : 0) + (f >= 3 && f <= 5 ? 4 : 0);
            else if (tp === CANNON) v = 285 + (f === 4 ? 14 : 0) + (rr <= 2 ? 4 : 0) - (rr >= 8 ? 8 : 0);
            else if (tp === PAWN) v = rr <= 4 ? 30 + (f === 4 ? 6 : 0) : rr === 9 ? 45 : 70 + (rr - 5) * 12 + (f >= 3 && f <= 5 ? 14 : 0);
          } else {
            if (tp === KING) v = rr <= 1 ? 16 - (f === 4 ? 0 : 4) : 6 - rr * 14;
            else if (tp === QUEEN) v = 900 + cf * 3 + (rr >= 2 && rr <= 7 ? 6 : 0);
            else if (tp === ROOK) v = 600 + (rr >= 6 ? 14 : 0) + (f >= 2 && f <= 6 ? 3 : 0);
            else if (tp === BISHOP) v = 330 + cf * 5 + (rr >= 2 && rr <= 7 ? 8 : 0);
            else if (tp === KNIGHT) v = 296 + cf * 8 + (rr >= 3 && rr <= 7 ? 14 : 0) - (rr === 0 ? 14 : 0);
            else if (tp === PAWN) v = 60 + Math.max(0, rr - 1) * Math.max(0, rr - 1) * 4 + (f >= 3 && f <= 5 && rr >= 2 ? 8 : 0);
          }
          a[sq] = v;
        }
      }
      PST[pc] = a;
    }
  })();
  const BASE_VALUE = pc => { const tp = pc & 7; if (pc & CHESS) return [0, 0, 900, 330, 300, 600, 0, 80][tp]; return [0, 0, 120, 120, 270, 600, 285, 50][tp]; };

  // ------------------------------------------------------------------ 開局擺法
  function placeArmy(b, army, s, opt) {
    const back = s === RED ? 0 : 9, step = s === RED ? 1 : -1, bit = s << 3;
    if (army === 'chess') {
      // 車騎象后王象 · 騎車：車守住騎士（不讓炮第一步就白吃），兩隻主教分走兩種斜線
      const row = [ROOK, KNIGHT, BISHOP, opt.queen ? QUEEN : 0, KING, BISHOP, 0, KNIGHT, ROOK];
      row.forEach((tp, f) => { if (tp) b[back * 9 + f] = CHESS | bit | tp; });
      const pr = back + step;
      const files = opt.pawns === 'five' ? [0, 2, 4, 6, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (const f of files) b[pr * 9 + f] = CHESS | bit | PAWN;
    } else {
      const row = [ROOK, KNIGHT, BISHOP, ADVISOR, KING, ADVISOR, BISHOP, KNIGHT, ROOK];
      row.forEach((tp, f) => { b[back * 9 + f] = bit | tp; });
      const cr = back + 2 * step, pr = back + 3 * step;
      b[cr * 9 + 1] = bit | CANNON; b[cr * 9 + 7] = bit | CANNON;
      for (const f of [0, 2, 4, 6, 8]) b[pr * 9 + f] = bit | PAWN;
    }
  }
  function normConf(c) {
    c = c || {};
    const armies = Array.isArray(c.armies) && c.armies.length === 2 ? c.armies.map(a => (a === 'chess' ? 'chess' : 'xq')) : ['xq', 'chess'];
    const decks = [0, 1].map(s => {
      const d = (c.decks && c.decks[s]) || [];
      return d.map(k => (typeof k === 'number' ? k : SKILL_ID[k])).filter(id => SKILLS[id] && !(SKILLS[id].needs === 'cannon' && armies[s] === 'chess')).slice(0, 6);
    });
    return { v: 1, armies, skills: !!c.skills, decks, pawns: c.pawns || 'nine', queen: c.queen === true || c.queen === 'full', kdiag: c.kdiag != null ? !!c.kdiag : armies[0] !== armies[1], free: c.free != null ? !!c.free : armies[0] !== armies[1], xqpromo: c.xqpromo != null ? !!c.xqpromo : armies[0] !== armies[1], kind: c.kind || (c.skills ? 'skill' : 'cvx') };
  }

  // ------------------------------------------------------------------ 局面
  class Position {
    constructor(conf) {
      this.board = new Int8Array(90);
      this.shU = new Int16Array(90);
      this.frU = new Int16Array(90);
      this.cdU = new Int16Array(64);
      this.used = new Uint8Array(64);
      this.stones = [];
      this.ncU = [0, 0];
      this.en = [0, 0];
      this.extra = 0;
      this.side = RED;
      this.ply = 0;
      this.halfmove = 0;
      this.kingSq = [-1, -1];
      this.key = 0; this.lock = 0;
      this.hist = [];
      this.nShield = 0;
      this.conf = normConf(conf);
      this.skills = this.conf.skills;
      this.deck = this.conf.decks;
      this.armies = this.conf.armies;
      this.kdiag = this.conf.kdiag;
      this.free = this.conf.free;
      this.xqpromo = this.conf.xqpromo;
      if (conf !== null) this.setup();
    }
    setup() {
      const b = this.board;
      b.fill(0);
      placeArmy(b, this.armies[0], RED, this.conf);
      placeArmy(b, this.armies[1], BLACK, this.conf);
      this.init = Int8Array.from(b);
      this.en = this.skills ? [E_START, E_START] : [0, 0];
      this.findKings();
      this.rehash();
    }
    clone() {
      const p = new Position(null);
      p.conf = this.conf; p.skills = this.skills; p.deck = this.deck; p.armies = this.armies; p.init = this.init; p.kdiag = this.kdiag; p.free = this.free; p.xqpromo = this.xqpromo;
      p.board.set(this.board); p.shU.set(this.shU); p.frU.set(this.frU); p.cdU.set(this.cdU); p.used.set(this.used);
      p.stones = this.stones.map(x => Object.assign({}, x)); p.ncU = this.ncU.slice(); p.en = this.en.slice();
      p.extra = this.extra; p.side = this.side; p.ply = this.ply; p.halfmove = this.halfmove; p.kingSq = this.kingSq.slice();
      p.key = this.key; p.lock = this.lock;
      return p;
    }
    findKings() {
      this.kingSq[0] = this.kingSq[1] = -1;
      for (let sq = 0; sq < 90; sq++) { const pc = this.board[sq]; if (isPiece(pc) && (pc & 7) === KING) this.kingSq[sideOf(pc)] = sq; }
    }
    rehash() {
      let k = 0, l = 0;
      for (let sq = 0; sq < 90; sq++) { const pc = this.board[sq]; if (pc) { k ^= ZK[pc * 90 + sq]; l ^= ZL[pc * 90 + sq]; } }
      if (this.side) { k ^= ZSK; l ^= ZSL; }
      this.key = k; this.lock = l;
    }
    // 技能狀態雜湊（能量、冷卻、護盾、凍結…），只在技能模式使用
    aux() {
      if (!this.skills) return 0;
      let h = ZE[this.en[0]] ^ ZE[16 + this.en[1]] ^ ZX[this.extra & 3];
      if (this.ncU[0] > this.ply) h ^= ZX[4];
      if (this.ncU[1] > this.ply) h ^= ZX[5];
      const ply = this.ply;
      for (let sq = 0; sq < 90; sq++) {
        if (this.shU[sq] > ply) h ^= ZF[sq] * (this.shU[sq] - ply);
        if (this.frU[sq] > ply) h ^= ZF[90 + sq] * (this.frU[sq] - ply);
      }
      for (let s = 0; s < 2; s++) for (const id of this.deck[s]) {
        const i = s * 32 + id, left = this.cdU[i] - ply;
        h ^= ZC[i * 3 + (this.used[i] ? 2 : left > 0 ? 1 : 0)];
      }
      return h;
    }
    isFrozen(sq) { return this.frU[sq] > this.ply; }
    isShielded(sq) { return this.shU[sq] > this.ply; }
    capturable(t, s) { const pc = this.board[t]; return isPiece(pc) && sideOf(pc) !== s && !(this.shU[t] > this.ply); }

    // ---------------------------------------------------------------- 走法產生（不含技能）
    genMoves(out, capOnly, allPromos) {
      const b = this.board, s = this.side, ply = this.ply;
      let n = 0;
      for (let sq = 0; sq < 90; sq++) {
        const pc = b[sq];
        if (!isPiece(pc) || sideOf(pc) !== s || this.frU[sq] > ply) continue;
        n = this.pieceMoves(out, n, sq, pc, s, capOnly, allPromos, null);
      }
      return n;
    }
    // capPred(t) 自訂「可以吃」的判斷（借刀殺人用），null 表示一般規則
    pieceMoves(out, n, sq, pc, s, capOnly, allPromos, capPred) {
      const b = this.board, tp = pc & 7;
      const can = capPred || (t => this.capturable(t, s));
      const add = t => { out[n++] = sq | (t << 7); };
      if (pc & CHESS) {
        if (tp === KING) { for (const t of ADJ_O[sq]) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } for (const t of ADJ_D[sq]) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
        else if (tp === KNIGHT) { for (const t of KN[sq]) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
        else if (tp === PAWN) {
          const dir = s === RED ? 9 : -9, r = RANK_OF[sq], last = s === RED ? 9 : 0, start = s === RED ? 1 : 8, f = FILE_OF[sq];
          const promo = t => { if (RANK_OF[t] === last) { out[n++] = sq | (t << 7) | (QUEEN << 14); out[n++] = sq | (t << 7) | (KNIGHT << 14); if (allPromos) { out[n++] = sq | (t << 7) | (ROOK << 14); out[n++] = sq | (t << 7) | (BISHOP << 14); } } else add(t); };
          const fw = sq + dir;
          if (!capPred && fw >= 0 && fw < 90 && !b[fw]) {
            if (!capOnly || RANK_OF[fw] === last) promo(fw);
            if (!capOnly && r === start) { const f2 = fw + dir; if (f2 >= 0 && f2 < 90 && !b[f2]) add(f2); }
          }
          for (const df of [-1, 1]) { const t = sqAt(f + df, r + (s === RED ? 1 : -1)); if (t >= 0 && b[t] && can(t)) promo(t); }
        } else {
          const dirs = tp === ROOK ? [RAYS_O[sq]] : tp === BISHOP ? [RAYS_D[sq]] : [RAYS_O[sq], RAYS_D[sq]];
          for (const set of dirs) for (const ray of set) for (const t of ray) {
            if (!b[t]) { if (!capOnly && !capPred) add(t); continue; }
            if (can(t)) add(t);
            break;
          }
        }
        return n;
      }
      if (tp === KING) { for (const t of ADJ_O[sq]) if (inPalace(t, s)) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } if (this.kdiag) for (const t of ADJ_D[sq]) if (inPalace(t, s)) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
      else if (tp === ADVISOR) { for (const t of ADJ_D[sq]) if (this.free || inPalace(t, s)) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
      else if (tp === BISHOP) { for (const [t, eye] of EL[sq]) if ((this.free || ownHalf(t, s)) && !b[eye]) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
      else if (tp === KNIGHT) { for (const [t, leg] of HJ[sq]) if (!b[leg]) { if (!b[t]) { if (!capOnly && !capPred) add(t); } else if (can(t)) add(t); } }
      else if (tp === ROOK) { for (const ray of RAYS_O[sq]) for (const t of ray) { if (!b[t]) { if (!capOnly && !capPred) add(t); continue; } if (can(t)) add(t); break; } }
      else if (tp === CANNON) {
        for (const ray of RAYS_O[sq]) {
          let i = 0;
          for (; i < ray.length; i++) { const t = ray[i]; if (b[t]) break; if (!capOnly && !capPred) add(t); }
          for (i++; i < ray.length; i++) { const t = ray[i]; if (!b[t]) continue; if (can(t)) add(t); break; }
        }
      } else if (tp === PAWN) {
        const fw = sq + (s === RED ? 9 : -9);
        const tg = [];
        if (fw >= 0 && fw < 90) tg.push(fw);
        if (!ownHalf(sq, s)) { const f = FILE_OF[sq]; if (f > 0) tg.push(sq - 1); if (f < 8) tg.push(sq + 1); }
        const last = s === RED ? 9 : 0;
        for (const t of tg) {
          const pro = this.xqpromo && !capPred && RANK_OF[t] === last;
          if (!b[t]) { if (pro) { out[n++] = sq | (t << 7) | (ROOK << 14); if (allPromos) { out[n++] = sq | (t << 7) | (KNIGHT << 14); out[n++] = sq | (t << 7) | (CANNON << 14); } } else if (!capOnly && !capPred) add(t); }
          else if (can(t)) { if (pro) { out[n++] = sq | (t << 7) | (ROOK << 14); if (allPromos) { out[n++] = sq | (t << 7) | (KNIGHT << 14); out[n++] = sq | (t << 7) | (CANNON << 14); } } else add(t); }
        }
      }
      return n;
    }

    // ---------------------------------------------------------------- 攻擊判定
    attacked(t, by) {
      const b = this.board, ply = this.ply, fr = this.frU;
      for (let d = 0; d < 4; d++) {
        const ray = RAYS_O[t][d];
        let i = 0;
        while (i < ray.length && !b[ray[i]]) i++;
        if (i === ray.length) continue;
        const p = ray[i], pc = b[p];
        if (isPiece(pc) && sideOf(pc) === by && !(fr[p] > ply)) {
          const tp = pc & 7;
          if (pc & CHESS) { if (tp === ROOK || tp === QUEEN) return true; if (tp === KING && i === 0) return true; }
          else {
            if (tp === ROOK) return true;
            if (i === 0) {
              if (tp === KING && inPalace(t, by)) return true;
              if (tp === PAWN) {
                if (FILE_OF[p] === FILE_OF[t]) { if (RANK_OF[t] - RANK_OF[p] === (by === RED ? 1 : -1)) return true; }
                else if (!ownHalf(p, by)) return true;
              }
            }
          }
        }
        for (i++; i < ray.length; i++) {
          const p2 = ray[i], pc2 = b[p2];
          if (!pc2) continue;
          if (isPiece(pc2) && sideOf(pc2) === by && !(pc2 & CHESS) && (pc2 & 7) === CANNON && !(fr[p2] > ply)) return true;
          break;
        }
      }
      for (let d = 0; d < 4; d++) {
        const ray = RAYS_D[t][d];
        let i = 0;
        while (i < ray.length && !b[ray[i]]) i++;
        if (i === ray.length) continue;
        const p = ray[i], pc = b[p];
        if (!isPiece(pc) || sideOf(pc) !== by || fr[p] > ply) continue;
        const tp = pc & 7;
        if (pc & CHESS) {
          if (tp === BISHOP || tp === QUEEN) return true;
          if (i === 0) { if (tp === KING) return true; if (tp === PAWN && RANK_OF[t] - RANK_OF[p] === (by === RED ? 1 : -1)) return true; }
        } else if (i === 0 && ((tp === ADVISOR && (this.free || inPalace(t, by))) || (tp === KING && this.kdiag && inPalace(t, by)))) return true;
      }
      for (const [h, leg] of HJR[t]) { const pc = b[h]; if (isPiece(pc) && !(pc & CHESS) && (pc & 7) === KNIGHT && sideOf(pc) === by && !b[leg] && !(fr[h] > ply)) return true; }
      for (const h of KN[t]) { const pc = b[h]; if (isPiece(pc) && (pc & CHESS) && (pc & 7) === KNIGHT && sideOf(pc) === by && !(fr[h] > ply)) return true; }
      if (this.free || ownHalf(t, by)) for (const [e, eye] of EL[t]) { const pc = b[e]; if (isPiece(pc) && !(pc & CHESS) && (pc & 7) === BISHOP && sideOf(pc) === by && !b[eye] && !(fr[e] > ply)) return true; }
      return false;
    }
    kingsFacing() {
      const a = this.kingSq[0], c = this.kingSq[1];
      if (a < 0 || c < 0 || FILE_OF[a] !== FILE_OF[c]) return false;
      if ((this.board[a] & CHESS) && (this.board[c] & CHESS)) return false;
      const lo = Math.min(a, c), hi = Math.max(a, c);
      for (let q = lo + 9; q < hi; q += 9) if (this.board[q]) return false;
      return true;
    }
    kingAttacked(s) { const k = this.kingSq[s]; if (k < 0) return true; return this.attacked(k, s ^ 1) || this.kingsFacing(); }
    inCheck() { return this.kingAttacked(this.side); }

    // ---------------------------------------------------------------- 走子與還原
    xor(sq, pc) { this.key ^= ZK[pc * 90 + sq]; this.lock ^= ZL[pc * 90 + sq]; }
    makeMove(mv) {
      if ((mv >> 17) & 31) return this.applySkill(mv);
      const from = mv & 127, to = (mv >> 7) & 127, promo = (mv >> 14) & 7;
      const b = this.board, pc = b[from], cap = b[to], s = this.side;
      const u = { mv, pc, cap, key: this.key, lock: this.lock, side: s, en0: this.en[0], en1: this.en[1], extra: this.extra, half: this.halfmove, shF: this.shU[from], shT: this.shU[to], frT: this.frU[to], frF: this.frU[from], k0: this.kingSq[0], k1: this.kingSq[1], st: null, snap: null };
      this.xor(from, pc);
      if (cap) this.xor(to, cap);
      const np = promo ? ((pc & ~7) | promo) : pc;
      b[to] = np; b[from] = 0;
      this.xor(to, np);
      this.shU[to] = this.shU[from]; this.shU[from] = 0; this.frU[to] = 0;
      if ((pc & 7) === KING) this.kingSq[s] = to;
      if (cap) { this.halfmove = 0; if (this.skills) this.en[s] = Math.min(E_MAX, this.en[s] + 1); } else this.halfmove++;
      this.finishTurn(u, 'move');
      this.hist.push(u);
      return u;
    }
    finishTurn(u, kind) {
      let sw = true;
      if (kind === 'chain') sw = false;
      else if (kind === 'move' && this.extra > 0) {
        this.extra--;
        if (this.extra > 0) { if (this.kingAttacked(this.side ^ 1)) this.extra = 0; else sw = false; }
      }
      this.ply++;
      if (this.stones.length) {
        for (let i = this.stones.length - 1; i >= 0; i--) {
          const st = this.stones[i];
          if (st.until <= this.ply) {
            (u.st || (u.st = [])).push(st);
            this.stones.splice(i, 1);
            if (this.board[st.sq] === STONE) { this.board[st.sq] = 0; this.xor(st.sq, STONE); }
          }
        }
      }
      if (sw) {
        this.side ^= 1; this.key ^= ZSK; this.lock ^= ZSL;
        if (this.skills) this.en[this.side] = Math.min(E_MAX, this.en[this.side] + 1);
      }
    }
    undoMove() {
      const u = this.hist.pop();
      if (!u) return;
      if (u.snap) { this.restore(u.snap); return; }
      if (u.st) for (const st of u.st) { this.stones.push(st); this.board[st.sq] = STONE; }
      const from = u.mv & 127, to = (u.mv >> 7) & 127;
      this.board[from] = u.pc; this.board[to] = u.cap;
      this.shU[from] = u.shF; this.shU[to] = u.shT; this.frU[to] = u.frT; this.frU[from] = u.frF;
      this.side = u.side; this.ply--; this.en[0] = u.en0; this.en[1] = u.en1; this.extra = u.extra; this.halfmove = u.half;
      this.kingSq[0] = u.k0; this.kingSq[1] = u.k1; this.key = u.key; this.lock = u.lock;
    }
    makeNull() {
      const u = { nul: true, key: this.key, lock: this.lock, side: this.side };
      this.side ^= 1; this.key ^= ZSK; this.lock ^= ZSL; this.ply++;
      this.hist.push(u);
    }
    undoNull() { const u = this.hist.pop(); this.side = u.side; this.key = u.key; this.lock = u.lock; this.ply--; }
    snapshot() {
      return {
        board: Int8Array.from(this.board), shU: Int16Array.from(this.shU), frU: Int16Array.from(this.frU), cdU: Int16Array.from(this.cdU), used: Uint8Array.from(this.used),
        stones: this.stones.map(x => Object.assign({}, x)), ncU: this.ncU.slice(), en: this.en.slice(), extra: this.extra, side: this.side, ply: this.ply,
        half: this.halfmove, kingSq: this.kingSq.slice(), key: this.key, lock: this.lock,
      };
    }
    restore(sn) {
      this.board.set(sn.board); this.shU.set(sn.shU); this.frU.set(sn.frU); this.cdU.set(sn.cdU); this.used.set(sn.used);
      this.stones = sn.stones; this.ncU = sn.ncU; this.en = sn.en; this.extra = sn.extra; this.side = sn.side; this.ply = sn.ply;
      this.halfmove = sn.half; this.kingSq = sn.kingSq; this.key = sn.key; this.lock = sn.lock;
    }

    // ---------------------------------------------------------------- 技能
    canUse(s, id) {
      const sk = SKILLS[id];
      if (!this.skills || !sk || this.extra > 0 || this.deck[s].indexOf(id) < 0) return false;
      const i = s * 32 + id;
      if (sk.once && this.used[i]) return false;
      if (this.cdU[i] > this.ply) return false;
      return this.en[s] >= sk.cost;
    }
    skillInfo(s, id) {
      const sk = SKILLS[id], i = s * 32 + id;
      return { id, key: sk.key, cost: sk.cost, used: !!(sk.once && this.used[i]), cdLeft: Math.max(0, Math.ceil((this.cdU[i] - this.ply) / 2)), energy: this.en[s] };
    }
    placeOk(pc, sq) {
      const s = sideOf(pc), tp = pc & 7, rr = relRank(sq, s);
      if (pc & CHESS) { if (tp === PAWN) return rr >= 1 && rr <= 8; return true; }
      if (tp === KING) return inPalace(sq, s);
      if (tp === ADVISOR) return this.free ? (FILE_OF[sq] + RANK_OF[sq]) % 2 === (s === RED ? 1 : 0) : inPalace(sq, s) && ((FILE_OF[sq] === 4) === (rr === 1));
      if (tp === BISHOP) { const f = FILE_OF[sq]; if (this.free) return f % 2 === 0 && rr % 2 === 0 && (f + rr) % 4 === 2; return rr === 0 || rr === 4 ? f === 2 || f === 6 : rr === 2 ? f === 0 || f === 4 || f === 8 : false; }
      if (tp === PAWN) return rr >= 3;
      return true;
    }
    genSkills(out, n, mode) {
      if (!this.skills || this.extra > 0) return n;
      const s = this.side, o = s ^ 1, b = this.board, ply = this.ply;
      const sm = (id, a, t) => { out[n++] = (a & 127) | ((t & 127) << 7) | (id << 17); };
      for (const id of this.deck[s]) {
        if (!this.canUse(s, id)) continue;
        if (mode === 'tactical' && !TACTICAL.has(id)) continue;
        switch (id) {
          case 1: case 5: case 8: sm(id, NONE, NONE); break;
          case 2: {
            const k = this.kingSq[s];
            if (k < 0) break;
            for (let q = 0; q < 90; q++) if (q !== k && !b[q] && inPalace(q, s)) sm(id, k, q);
            break;
          }
          case 3: {
            const L = [];
            for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) !== KING && !(this.frU[q] > ply)) L.push(q); }
            for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
              const p1 = b[L[i]], p2 = b[L[j]];
              if (p1 === p2) continue;
              if (this.placeOk(p1, L[j]) && this.placeOk(p2, L[i])) sm(id, L[i], L[j]);
            }
            break;
          }
          case 4: {
            let ok = false;
            for (let q = 0; q < 90 && !ok; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) === PAWN && !(this.frU[q] > ply)) { const fw = q + (s === RED ? 9 : -9); if (fw >= 0 && fw < 90 && !b[fw]) ok = true; } }
            if (ok) sm(id, NONE, NONE);
            break;
          }
          case 6: {
            for (let q = 0; q < 90; q++) {
              const pc = b[q];
              if (!isPiece(pc) || sideOf(pc) !== o || (pc & 7) === KING || this.frU[q] > ply || this.shU[q] > ply) continue;
              const buf = [];
              const m = this.pieceMoves(buf, 0, q, pc, o, true, false, t => { const x = b[t]; return isPiece(x) && sideOf(x) === o && (x & 7) !== KING && !(this.shU[t] > ply); });
              for (let i = 0; i < m; i++) { const t = (buf[i] >> 7) & 127; if (!buf.slice(0, i).some(v => ((v >> 7) & 127) === t)) sm(id, q, t); }
            }
            break;
          }
          case 7: case 9: {
            for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === o && (pc & 7) === PAWN && !(this.shU[q] > ply)) sm(id, NONE, q); }
            break;
          }
          case 10: {
            if (this.stones.filter(x => x.owner === s).length >= MAX_STONES) break;
            for (let q = 0; q < 90; q++) if (!b[q] && ownHalf(q, s)) sm(id, NONE, q);
            break;
          }
          case 11: case 13: {
            for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === o && (pc & 7) !== KING && !(this.shU[q] > ply) && !(id === 13 && this.frU[q] > ply)) sm(id, NONE, q); }
            break;
          }
          case 12: {
            for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) !== KING && !(this.shU[q] > ply)) sm(id, NONE, q); }
            break;
          }
          case 14: {
            for (let q = 0; q < 90; q++) {
              const pc = b[q];
              if (!isPiece(pc) || sideOf(pc) !== s || this.frU[q] > ply) continue;
              const tp = pc & 7;
              if (tp === KING || (!(pc & CHESS) && (tp === ADVISOR || tp === BISHOP))) continue;
              for (let t = 0; t < 90; t++) if (!b[t] && ownHalf(t, s) && this.placeOk(pc, t)) sm(id, q, t);
            }
            break;
          }
          case 15: {
            for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) === PAWN) sm(id, NONE, q); }
            break;
          }
          case 16: {
            for (let q = 0; q < 90; q++) {
              const pc = b[q];
              if (!isPiece(pc) || sideOf(pc) !== s || (pc & CHESS) || (pc & 7) !== CANNON || this.frU[q] > ply) continue;
              for (const ray of RAYS_O[q]) for (const t of ray) {
                if (!b[t]) continue;
                const x = b[t];
                if (isPiece(x) && sideOf(x) === o && (x & 7) !== KING && !(this.shU[t] > ply)) sm(id, q, t);
                break;
              }
            }
            break;
          }
          case 17: {
            const have = new Int8Array(64), base = new Int8Array(64);
            for (let q = 0; q < 90; q++) { if (isPiece(b[q])) have[b[q]]++; const x = this.init[q]; if (isPiece(x)) base[x]++; }
            for (let q = 0; q < 90; q++) {
              const x = this.init[q];
              if (!isPiece(x) || sideOf(x) !== s || (x & 7) === KING || b[q]) continue;
              if (have[x] < base[x]) sm(id, NONE, q);
            }
            break;
          }
        }
      }
      return n;
    }
    applySkill(mv) {
      const id = (mv >> 17) & 31, a = mv & 127, t = (mv >> 7) & 127;
      const u = { mv, snap: this.snapshot() };
      const s = this.side, o = s ^ 1, sk = SKILLS[id], b = this.board, ply = this.ply;
      this.en[s] -= sk.cost;
      this.cdU[s * 32 + id] = ply + 2 * sk.cd;
      if (sk.once) this.used[s * 32 + id] = 1;
      let kind = 'skill', removed = 0;
      const move = (x, y) => { b[y] = b[x]; b[x] = 0; this.shU[y] = this.shU[x]; this.frU[y] = this.frU[x]; this.shU[x] = 0; this.frU[x] = 0; };
      const kill = q => { b[q] = 0; this.shU[q] = 0; this.frU[q] = 0; removed++; };
      switch (id) {
        case 1: this.extra = 2; kind = 'chain'; break;
        case 2: move(a, t); break;
        case 3: { const x = b[a]; b[a] = b[t]; b[t] = x; const sh = this.shU[a]; this.shU[a] = this.shU[t]; this.shU[t] = sh; break; }
        case 4: {
          const list = [];
          for (let q = 0; q < 90; q++) { const pc = b[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) === PAWN && !(this.frU[q] > ply)) list.push(q); }
          list.sort((x, y) => (s === RED ? RANK_OF[y] - RANK_OF[x] : RANK_OF[x] - RANK_OF[y]));
          for (const q of list) {
            const fw = q + (s === RED ? 9 : -9);
            if (fw < 0 || fw >= 90 || b[fw]) continue;
            move(q, fw);
            if ((b[fw] & CHESS) && RANK_OF[fw] === (s === RED ? 9 : 0)) b[fw] = (b[fw] & ~7) | QUEEN;
          }
          break;
        }
        case 5: this.ncU[o] = ply + 2; break;
        case 6: kill(t); move(a, t); removed = 1; break;
        case 7: b[t] = (b[t] & ~8) | (s << 3); this.frU[t] = 0; break;
        case 8: { this.en[s] = Math.min(E_MAX, this.en[s] + 2); const st = Math.min(1, this.en[o]); this.en[o] -= st; this.en[s] = Math.min(E_MAX, this.en[s] + st); break; }
        case 9: {
          const seen = new Set([t]), queue = [t];
          while (queue.length) {
            const q = queue.shift();
            for (const nb of ADJ_O[q]) {
              const x = b[nb];
              if (!seen.has(nb) && isPiece(x) && sideOf(x) === o && (x & 7) === PAWN && !(this.shU[nb] > ply)) { seen.add(nb); queue.push(nb); }
            }
          }
          for (const q of seen) kill(q);
          this.en[s] = Math.min(E_MAX, this.en[s] + 1);
          break;
        }
        case 10: b[t] = STONE; this.stones.push({ sq: t, until: ply + STONE_PLIES, owner: s }); break;
        case 11: kill(t); break;
        case 12: this.shU[t] = ply + SHIELD_PLIES; break;
        case 13: this.frU[t] = ply + FREEZE_PLIES; break;
        case 14: move(a, t); break;
        case 15: b[t] = (b[t] & ~7) | ROOK; break;
        case 16: kill(t); move(a, t); this.en[s] = Math.min(E_MAX, this.en[s] + 1); break;
        case 17: b[t] = this.init[t]; this.shU[t] = 0; this.frU[t] = 0; break;
      }
      this.halfmove = removed ? 0 : this.halfmove + 1;
      this.findKings();
      this.rehash();
      this.finishTurn(u, kind);
      this.hist.push(u);
      return u;
    }

    // ---------------------------------------------------------------- 合法性
    legalMoves(withSkills) {
      const buf = new Int32Array(400);
      const n = this.genMoves(buf, false, true);
      const s = this.side, out = [];
      for (let i = 0; i < n; i++) { this.makeMove(buf[i]); if (!this.kingAttacked(s)) out.push(buf[i]); this.undoMove(); }
      let res = out;
      if (this.ncU[s] > this.ply) { const quiet = out.filter(m => !this.board[(m >> 7) & 127]); if (quiet.length) res = quiet; }
      if (withSkills) res = res.concat(this.legalSkills());
      return res;
    }
    legalSkills() {
      const buf = [];
      const n = this.genSkills(buf, 0, 'all');
      const s = this.side, out = [];
      for (let i = 0; i < n; i++) { this.makeMove(buf[i]); if (!this.kingAttacked(s)) out.push(buf[i]); this.undoMove(); }
      return out;
    }
    isLegal(mv) { return this.legalMoves(true).indexOf(mv) >= 0; }
    hasLegalMove() {
      const buf = new Int32Array(400);
      const n = this.genMoves(buf, false, false), s = this.side;
      for (let i = 0; i < n; i++) { this.makeMove(buf[i]); const ok = !this.kingAttacked(s); this.undoMove(); if (ok) return true; }
      return this.legalSkills().length > 0;
    }
    effects() {
      const ply = this.ply, sh = [], fz = [];
      for (let q = 0; q < 90; q++) { if (this.shU[q] > ply) sh.push({ sq: q, left: Math.ceil((this.shU[q] - ply) / 2) }); if (this.frU[q] > ply) fz.push({ sq: q, left: Math.ceil((this.frU[q] - ply) / 2) }); }
      return { shields: sh, frozen: fz, stones: this.stones.map(x => ({ sq: x.sq, owner: x.owner, left: Math.ceil((x.until - ply) / 2) })), noCapture: [this.ncU[0] > ply, this.ncU[1] > ply], extra: this.extra, en: this.en.slice() };
    }
    viewBoard() { const b = Int8Array.from(this.board); for (const st of this.stones) b[st.sq] = 0; return b; }
    evaluate() { return evaluate(this); }
    repKey() { return this.key + ':' + this.lock; }
  }

  // ------------------------------------------------------------------ 評估
  function evaluate(p) {
    const b = p.board, sc = [0, 0], ks = p.kingSq, ply = p.ply;
    const near = [0, 0];
    for (let sq = 0; sq < 90; sq++) {
      const pc = b[sq];
      if (!isPiece(pc)) continue;
      const s = sideOf(pc);
      let v = PST[pc][sq];
      if (p.frU[sq] > ply) v -= (v >> 3) + 20;
      if (p.shU[sq] > ply) v += 15;
      sc[s] += v;
      const tp = pc & 7;
      if (tp !== KING && tp !== ADVISOR && (tp !== PAWN || (pc & CHESS))) {
        const k = ks[s ^ 1];
        if (k >= 0 && Math.abs(FILE_OF[k] - FILE_OF[sq]) <= 2 && Math.abs(RANK_OF[k] - RANK_OF[sq]) <= 2) near[s]++;
      }
    }
    sc[0] += near[0] * near[0] * 8; sc[1] += near[1] * near[1] * 8;
    for (let s = 0; s < 2; s++) {
      const k = ks[s];
      if (k >= 0 && (b[k] & CHESS)) {
        let cover = 0;
        for (const q of ADJ_O[k]) if (isPiece(b[q]) && sideOf(b[q]) === s) cover++;
        for (const q of ADJ_D[k]) if (isPiece(b[q]) && sideOf(b[q]) === s) cover++;
        sc[s] += Math.min(cover, 4) * 6;
      }
    }
    let v = sc[p.side] - sc[p.side ^ 1];
    if (p.skills) { v += (p.en[p.side] - p.en[p.side ^ 1]) * 14; if (p.extra > 0) v += 90; }
    return v + 12;
  }

  // ------------------------------------------------------------------ 搜尋
  const ALPHA = 1, BETA = 2, EXACT = 3;
  class Searcher {
    constructor(hashBits) {
      this.size = 1 << (hashBits || 18); this.mask = this.size - 1;
      this.tk = new Int32Array(this.size); this.tl = new Int32Array(this.size); this.tm = new Int32Array(this.size);
      this.ts = new Int16Array(this.size); this.td = new Int8Array(this.size); this.tf = new Int8Array(this.size);
      this.history = new Int32Array(64 * 90);
      this.killers = [];
      this.path = [];
    }
    clear() { this.tk.fill(0); this.tl.fill(0); this.tm.fill(0); this.history.fill(0); }
    probe(k, l) { const i = k & this.mask; return this.tk[i] === k && this.tl[i] === l ? i : -1; }
    store(k, l, depth, flag, score, mv, ply) {
      const i = k & this.mask;
      if (this.tk[i] === k && this.tl[i] === l && this.td[i] > depth && flag !== EXACT) return;
      if (score > WIN) score += ply; else if (score < -WIN) score -= ply;
      this.tk[i] = k; this.tl[i] = l; this.td[i] = depth; this.tf[i] = flag; this.ts[i] = score; this.tm[i] = mv;
    }
    orderScore(p, mv, ttMv, ply) {
      if (mv === ttMv) return 1 << 30;
      const sk = (mv >> 17) & 31;
      const b = p.board, to = (mv >> 7) & 127;
      if (sk) {
        if (sk === 11 || sk === 16 || sk === 6) return 5e6 + BASE_VALUE(b[to]) * 10;
        if (sk === 9 || sk === 7) return 4e6;
        return 1e5;
      }
      const from = mv & 127, cap = b[to], promo = (mv >> 14) & 7;
      if (cap || promo) return 6e6 + (cap ? BASE_VALUE(cap) * 16 : 0) - BASE_VALUE(b[from]) + (promo === QUEEN ? 9000 : 0);
      const k = this.killers[ply];
      if (k && k[0] === mv) return 3e6;
      if (k && k[1] === mv) return 2.9e6;
      return this.history[(b[from] & 63) * 90 + to];
    }
    isRep(p) {
      const k = p.key, l = p.lock, path = this.path;
      for (let i = path.length - 2, n = 0; i >= 0 && n < p.halfmove + 2; i -= 1, n++) if (path[i][0] === k && path[i][1] === l) return true;
      return false;
    }
    qs(alpha, beta, ply) {
      const p = this.pos;
      if ((++this.nodes & 1023) === 0 && now() - this.t0 > this.limit) this.stop = true;
      if (this.stop) return 0;
      const stand = evaluate(p);
      if (ply >= 48) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const s = p.side;
      if (p.ncU[s] > p.ply) return alpha;
      const buf = new Int32Array(160), n = p.genMoves(buf, true, false);
      const arr = [];
      for (let i = 0; i < n; i++) arr.push([this.orderScore(p, buf[i], 0, ply), buf[i]]);
      arr.sort((x, y) => y[0] - x[0]);
      for (const [, mv] of arr) {
        const cap = p.board[(mv >> 7) & 127];
        if (cap && stand + BASE_VALUE(cap) + 200 < alpha && !((mv >> 14) & 7)) continue;
        p.makeMove(mv);
        if (p.kingAttacked(s)) { p.undoMove(); continue; }
        const same = p.side === s;
        const sc = same ? this.qs(alpha, beta, ply + 1) : -this.qs(-beta, -alpha, ply + 1);
        p.undoMove();
        if (this.stop) return 0;
        if (sc > alpha) { alpha = sc; if (sc >= beta) return sc; }
      }
      return alpha;
    }
    gen(p, ply, depth) {
      const buf = new Int32Array(400);
      let n = p.genMoves(buf, false, false);
      if (p.ncU[p.side] > p.ply) {
        let m = 0;
        for (let i = 0; i < n; i++) if (!p.board[(buf[i] >> 7) & 127]) buf[m++] = buf[i];
        if (m) n = m;
      }
      const out = Array.from(buf.subarray(0, n));
      if (p.skills && ply === 1 && depth >= 2) { const sb = []; const m = p.genSkills(sb, 0, 'tactical'); for (let i = 0; i < m; i++) out.push(sb[i]); }
      return out;
    }
    ab(depth, alpha, beta, ply, allowNull) {
      const p = this.pos;
      if ((++this.nodes & 1023) === 0 && now() - this.t0 > this.limit) this.stop = true;
      if (this.stop) return 0;
      if (this.isRep(p) || p.halfmove >= 120) return 0;
      if (alpha >= MATE - ply) return alpha;
      const inCheck = p.inCheck();
      if (inCheck && ply < 30) depth++;
      if (depth <= 0) return this.qs(alpha, beta, ply);
      const aux = p.aux(), hk = p.key ^ aux, hl = p.lock ^ (aux * 31);
      let ttMv = 0;
      const ti = this.probe(hk, hl);
      if (ti >= 0) {
        ttMv = this.tm[ti];
        if (this.td[ti] >= depth) {
          let sc = this.ts[ti];
          if (sc > WIN) sc -= ply; else if (sc < -WIN) sc += ply;
          const f = this.tf[ti];
          if (f === EXACT || (f === BETA && sc >= beta) || (f === ALPHA && sc <= alpha)) return sc;
        }
      }
      const s = p.side;
      if (allowNull && !inCheck && depth >= 3 && p.extra === 0 && beta < WIN && evaluate(p) >= beta) {
        let big = 0;
        for (let q = 0; q < 90 && big < 2; q++) { const pc = p.board[q]; if (isPiece(pc) && sideOf(pc) === s && (pc & 7) !== KING && (pc & 7) !== PAWN) big++; }
        if (big >= 2) {
          p.makeNull();
          this.path.push([p.key, p.lock]);
          const sc = -this.ab(depth - 3, -beta, -beta + 1, ply + 1, false);
          this.path.pop();
          p.undoNull();
          if (this.stop) return 0;
          if (sc >= beta) return beta;
        }
      }
      const moves = this.gen(p, ply, depth);
      const sc0 = moves.map(mv => this.orderScore(p, mv, ttMv, ply));
      const idx = moves.map((_, i) => i).sort((x, y) => sc0[y] - sc0[x]);
      let best = -INF, bestMv = 0, legal = 0, flag = ALPHA;
      for (const i of idx) {
        const mv = moves[i];
        const quiet = !((mv >> 17) & 31) && !p.board[(mv >> 7) & 127] && !((mv >> 14) & 7);
        p.makeMove(mv);
        if (p.kingAttacked(s)) { p.undoMove(); continue; }
        legal++;
        this.path.push([p.key, p.lock]);
        const same = p.side === s;
        const d = depth - 1;
        let sc;
        if (legal === 1) sc = same ? this.ab(d, alpha, beta, ply + 1, true) : -this.ab(d, -beta, -alpha, ply + 1, true);
        else {
          let r = 0;
          if (quiet && !inCheck && legal > 4 && depth >= 3 && sc0[i] < 2.9e6) r = legal > 10 ? 2 : 1;
          sc = same ? this.ab(d - r, alpha, alpha + 1, ply + 1, true) : -this.ab(d - r, -alpha - 1, -alpha, ply + 1, true);
          if (!this.stop && sc > alpha && (r || sc < beta)) sc = same ? this.ab(d, alpha, beta, ply + 1, true) : -this.ab(d, -beta, -alpha, ply + 1, true);
        }
        this.path.pop();
        p.undoMove();
        if (this.stop) return 0;
        if (sc > best) {
          best = sc; bestMv = mv;
          if (sc > alpha) {
            alpha = sc; flag = EXACT;
            if (sc >= beta) {
              flag = BETA;
              if (quiet) {
                const k = this.killers[ply] || (this.killers[ply] = [0, 0]);
                if (k[0] !== mv) { k[1] = k[0]; k[0] = mv; }
                this.history[(p.board[mv & 127] & 63) * 90 + ((mv >> 7) & 127)] += depth * depth;
              }
              break;
            }
          }
        }
      }
      if (!legal) {
        if (p.skills) { const sb = []; const m = p.genSkills(sb, 0, 'all'); for (let i = 0; i < m; i++) { p.makeMove(sb[i]); const ok = !p.kingAttacked(s); p.undoMove(); if (ok) return evaluate(p) - 200; } }
        return -MATE + ply;
      }
      this.store(hk, hl, depth, flag, best, bestMv, ply);
      return best;
    }
    rootMoves(p) {
      const s = p.side;
      let list = p.legalMoves(false).map(mv => ({ mv, score: 0 }));
      if (p.skills) {
        const sk = p.legalSkills();
        const byId = {};
        for (const mv of sk) (byId[(mv >> 17) & 31] || (byId[(mv >> 17) & 31] = [])).push(mv);
        for (const id of Object.keys(byId)) {
          let arr = byId[id];
          if (arr.length > 10) {
            arr = arr.map(mv => { p.makeMove(mv); this.path.push([p.key, p.lock]); const same = p.side === s; const v = same ? this.qs(-INF, INF, 1) : -this.qs(-INF, INF, 1); this.path.pop(); p.undoMove(); return { mv, v }; })
              .sort((x, y) => y.v - x.v).slice(0, 10).map(x => x.mv);
          }
          for (const mv of arr) list.push({ mv, score: 0, skill: true });
        }
      }
      return list;
    }
    search(pos, opts) {
      opts = opts || {};
      this.pos = pos; this.nodes = 0; this.stop = false; this.t0 = now();
      this.limit = Math.max(60, opts.time || 1000);
      const maxDepth = opts.depth || 64, noise = opts.noise || 0;
      this.killers = [];
      for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
      const hist = opts.history || [];
      this.path = hist.slice(-40).concat([[pos.key, pos.lock]]);
      const roots = this.rootMoves(pos);
      if (!roots.length) return { move: 0, score: -MATE, depth: 0, pv: [], nodes: 0 };
      if (roots.length === 1 && !opts.analysis) return { move: roots[0].mv, score: 0, depth: 1, pv: [roots[0].mv], nodes: 1 };
      const s = pos.side;
      let best = roots[0], bestScore = -INF, done = 0;
      for (let depth = 1; depth <= maxDepth; depth++) {
        let alpha = -INF, iterBest = null;
        const beta = INF;
        for (let i = 0; i < roots.length; i++) {
          const r = roots[i];
          pos.makeMove(r.mv);
          this.path.push([pos.key, pos.lock]);
          const same = pos.side === s;
          let sc;
          if (i === 0) sc = same ? this.ab(depth - 1, alpha, beta, 1, true) : -this.ab(depth - 1, -beta, -alpha, 1, true);
          else {
            sc = same ? this.ab(depth - 1, alpha, alpha + 1, 1, true) : -this.ab(depth - 1, -alpha - 1, -alpha, 1, true);
            if (!this.stop && sc > alpha) sc = same ? this.ab(depth - 1, alpha, beta, 1, true) : -this.ab(depth - 1, -beta, -alpha, 1, true);
          }
          this.path.pop();
          pos.undoMove();
          if (this.stop) break;
          r.score = sc;
          if (sc > alpha) { alpha = sc; iterBest = r; }
          else r.score = Math.min(sc, alpha - 1);
        }
        if (this.stop && !iterBest) break;
        if (iterBest) { best = iterBest; bestScore = iterBest.score; }
        if (!this.stop) done = depth;
        roots.sort((x, y) => (x === best ? -1 : y === best ? 1 : y.score - x.score));
        if (opts.onInfo) opts.onInfo({ depth, score: bestScore, pv: this.pv(pos, best.mv).map(moveToStr), nodes: this.nodes, time: Math.round(now() - this.t0) });
        if (this.stop || Math.abs(bestScore) > WIN) break;
        if (depth >= 2 && now() - this.t0 > this.limit * 0.45) break;
      }
      let pick = best;
      if (noise > 0 && Math.abs(bestScore) < WIN) {
        let top = -INF;
        for (const r of roots) { const v = r.score + (Math.random() * 2 - 1) * noise; if (v > top && r.score > bestScore - noise * 2) { top = v; pick = r; } }
      }
      return { move: pick.mv, score: pick === best ? bestScore : pick.score, depth: done, pv: this.pv(pos, pick.mv), nodes: this.nodes, time: Math.round(now() - this.t0) };
    }
    pv(pos, first) {
      const out = [first], seen = new Set();
      pos.makeMove(first);
      let n = 1;
      while (n < 8) {
        const aux = pos.aux(), i = this.probe(pos.key ^ aux, pos.lock ^ (aux * 31));
        if (i < 0 || !this.tm[i]) break;
        const mv = this.tm[i], k = pos.key + ':' + pos.lock;
        if (seen.has(k)) break;
        seen.add(k);
        const legal = pos.legalMoves(pos.skills);
        if (legal.indexOf(mv) < 0) break;
        pos.makeMove(mv); out.push(mv); n++;
      }
      for (let i = 0; i < n; i++) pos.undoMove();
      return out;
    }
  }

  // ------------------------------------------------------------------ 字串與記譜
  const sqName = sq => FILES[FILE_OF[sq]] + RANK_OF[sq];
  const parseSq = s => { if (!s || s.length < 2) return -1; const f = FILES.indexOf(s[0]), r = +s[1]; return f < 0 || isNaN(r) ? -1 : r * 9 + f; };
  function moveToStr(mv) {
    const sk = (mv >> 17) & 31, a = mv & 127, t = (mv >> 7) & 127, promo = (mv >> 14) & 7;
    if (sk) return '@' + SKILLS[sk].key + (a !== NONE ? ':' + sqName(a) : '') + (t !== NONE ? (a !== NONE ? '' : ':') + sqName(t) : '');
    return sqName(a) + sqName(t) + (promo ? '=' + 'xkqbnrcp'[promo] : '');
  }
  function strToMove(pos, s) {
    if (!s) return 0;
    let mv;
    if (s[0] === '@') {
      const m = /^@(\w+)(?::([a-i]\d)([a-i]\d)?)?$/.exec(s);
      if (!m || !SKILL_ID[m[1]]) return 0;
      const id = SKILL_ID[m[1]];
      let a = NONE, t = NONE;
      if (m[2] && m[3]) { a = parseSq(m[2]); t = parseSq(m[3]); }
      else if (m[2]) { if (id === 2) { a = pos.kingSq[pos.side]; } t = parseSq(m[2]); }
      mv = (a & 127) | ((t & 127) << 7) | (id << 17);
    } else {
      const a = parseSq(s.slice(0, 2)), t = parseSq(s.slice(2, 4));
      if (a < 0 || t < 0) return 0;
      const pm = /=([qbnr])/.exec(s);
      mv = a | (t << 7) | (pm ? ('xkqbnrcp'.indexOf(pm[1]) << 14) : 0);
    }
    return pos.legalMoves(true).indexOf(mv) >= 0 ? mv : 0;
  }

  // ------------------------------------------------------------------ 與主程式溝通
  function replay(conf, moves) {
    const pos = new Position(conf), keys = [[pos.key, pos.lock]];
    for (const s of moves || []) { const mv = strToMove(pos, s); if (!mv) break; pos.makeMove(mv); keys.push([pos.key, pos.lock]); }
    pos.hist.length = 0;
    return { pos, keys };
  }
  function makeHandler(post, hashBits) {
    const searcher = new Searcher(hashBits || 18);
    return function (m) {
      try {
        if (m.type === 'search') {
          const { pos, keys } = replay(m.conf, m.moves);
          const res = searcher.search(pos, { time: m.time, depth: m.depth, noise: m.noise, analysis: m.analysis, history: keys.slice(0, -1), onInfo: info => post(Object.assign({ type: 'info', id: m.id }, info)) });
          post({ type: 'result', id: m.id, move: res.move ? moveToStr(res.move) : null, score: res.score, depth: res.depth, pv: (res.pv || []).map(moveToStr), nodes: res.nodes });
        } else if (m.type === 'clear') searcher.clear();
        else if (m.type === 'ping') post({ type: 'pong', id: m.id });
      } catch (err) {
        post({ type: 'error', id: m.id, message: String((err && err.message) || err) });
      }
    };
  }

  const api = {
    RED, BLACK, KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN, QUEEN, CHESS, STONE, NONE, MATE, WIN,
    SKILLS, SKILL_ID, PRESETS, FILE_OF, RANK_OF, E_MAX,
    Position, Searcher, normConf, moveToStr, strToMove, sqName, parseSq, replay, makeHandler, evaluate,
    isPiece, sideOf, inPalace, ownHalf,
    skillOf: mv => (mv >> 17) & 31, fromOf: mv => mv & 127, toOf: mv => (mv >> 7) & 127, promoOf: mv => (mv >> 14) & 7,
  };
  const isWorker = typeof importScripts === 'function' && typeof document === 'undefined' && global && typeof global.postMessage === 'function';
  if (isWorker) {
    const handle = makeHandler(msg => global.postMessage(msg), 19);
    global.onmessage = e => handle(e.data);
    global.postMessage({ type: 'ready' });
  }
  return api;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VXEngineModule({});
} else if (typeof importScripts === 'function' && typeof document === 'undefined') {
  VXEngineModule(self);
} else if (typeof window !== 'undefined') {
  window.VXEngineModule = VXEngineModule;
  window.VX = VXEngineModule(window);
}
