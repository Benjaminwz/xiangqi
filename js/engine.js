/*!
 * 象棋引擎 XQ Engine
 * 規則判定、走法產生、局面評估、Alpha-Beta 搜尋、中文記譜、開局庫。
 * 可在網頁主執行緒、Web Worker 或 Node.js（測試）中執行。
 *
 * 棋盤座標：sq = rank * 9 + file，rank 0 為紅方底線、rank 9 為黑方底線，file 0~8 對應 ICCS 的 a~i。
 * 著法編碼：from | (to << 8)。
 * 搜尋架構參考「象棋小巫師」與 ElephantEye 的公開設計（PVS、置換表、空著裁剪、殺手著法、歷史表、靜態搜尋、長將判負）。
 */
function XQEngineModule(global) {
  'use strict';

  // ------------------------------------------------------------------ 常數
  const RED = 0, BLACK = 1;
  const KING = 1, ADVISOR = 2, BISHOP = 3, KNIGHT = 4, ROOK = 5, CANNON = 6, PAWN = 7;
  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const MATE_VALUE = 10000, BAN_VALUE = MATE_VALUE - 100, WIN_VALUE = MATE_VALUE - 200;
  const DRAW_VALUE = 20, ADVANCED_VALUE = 3;
  const NULL_OKAY_MARGIN = 200, NULL_SAFE_MARGIN = 400, NULL_DEPTH = 2;
  const LIMIT_DEPTH = 64, MAX_GEN = 160;
  const HASH_ALPHA = 1, HASH_BETA = 2, HASH_PV = 3, NO_HIT = -32000;
  const FILES = 'abcdefghi';
  const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

  const FILE_OF = new Int8Array(90), RANK_OF = new Int8Array(90);
  for (let i = 0; i < 90; i++) { FILE_OF[i] = i % 9; RANK_OF[i] = (i / 9) | 0; }
  const onBoard = (f, r) => f >= 0 && f < 9 && r >= 0 && r < 10;
  const inPalace = (f, r) => f >= 3 && f <= 5 && (r <= 2 || r >= 7);
  const halfOf = r => (r <= 4 ? RED : BLACK);

  // ------------------------------------------------------------------ 走法表
  const KING_TO = [], ADVISOR_TO = [], BISHOP_TO = [], BISHOP_EYE = [], KNIGHT_TO = [], KNIGHT_LEG = [];
  const KNIGHT_ATK_FROM = [], KNIGHT_ATK_LEG = [], RAYS = [], PAWN_TO = [[], []];
  (function buildTables() {
    const atkFrom = Array.from({ length: 90 }, () => []), atkLeg = Array.from({ length: 90 }, () => []);
    const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let sq = 0; sq < 90; sq++) {
      const f = FILE_OF[sq], r = RANK_OF[sq];
      const k = [], a = [], b = [], be = [], n = [], nl = [];
      if (inPalace(f, r)) {
        for (const [df, dr] of ORTH) { const nf = f + df, nr = r + dr; if (onBoard(nf, nr) && inPalace(nf, nr) && halfOf(nr) === halfOf(r)) k.push(nr * 9 + nf); }
        for (const [df, dr] of DIAG) { const nf = f + df, nr = r + dr; if (onBoard(nf, nr) && inPalace(nf, nr) && halfOf(nr) === halfOf(r)) a.push(nr * 9 + nf); }
      }
      for (const [df, dr] of DIAG) {
        const nf = f + 2 * df, nr = r + 2 * dr;
        if (onBoard(nf, nr) && halfOf(nr) === halfOf(r)) { b.push(nr * 9 + nf); be.push((r + dr) * 9 + f + df); }
      }
      for (const [df, dr] of [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]]) {
        const nf = f + df, nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const leg = Math.abs(dr) === 2 ? (r + dr / 2) * 9 + f : r * 9 + f + df / 2;
        n.push(nr * 9 + nf); nl.push(leg);
        atkFrom[nr * 9 + nf].push(sq); atkLeg[nr * 9 + nf].push(leg);
      }
      KING_TO.push(Int8Array.from(k)); ADVISOR_TO.push(Int8Array.from(a));
      BISHOP_TO.push(Int8Array.from(b)); BISHOP_EYE.push(Int8Array.from(be));
      KNIGHT_TO.push(Int8Array.from(n)); KNIGHT_LEG.push(Int8Array.from(nl));
      const rays = [];
      for (const [df, dr] of ORTH) {
        const ray = []; let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) { ray.push(nr * 9 + nf); nf += df; nr += dr; }
        rays.push(Int8Array.from(ray));
      }
      RAYS.push(rays);
      const pr = [], pb = [];
      if (r + 1 <= 9) pr.push(sq + 9);
      if (r >= 5) { if (f > 0) pr.push(sq - 1); if (f < 8) pr.push(sq + 1); }
      if (r - 1 >= 0) pb.push(sq - 9);
      if (r <= 4) { if (f > 0) pb.push(sq - 1); if (f < 8) pb.push(sq + 1); }
      PAWN_TO[RED].push(Int8Array.from(pr)); PAWN_TO[BLACK].push(Int8Array.from(pb));
    }
    for (let sq = 0; sq < 90; sq++) { KNIGHT_ATK_FROM.push(Int8Array.from(atkFrom[sq])); KNIGHT_ATK_LEG.push(Int8Array.from(atkLeg[sq])); }
  })();

  // ------------------------------------------------------------------ Zobrist
  let seed = 0x2545F491;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZK = new Int32Array(16 * 90), ZL = new Int32Array(16 * 90);
  for (let i = 0; i < 16 * 90; i++) { ZK[i] = rnd32(); ZL[i] = rnd32(); }
  const ZK_SIDE = rnd32(), ZL_SIDE = rnd32();

  // ------------------------------------------------------------------ 子力位置價值表（紅方視角，第一列為黑方底線）
  const KP_MID = [
     9,  9,  9, 11, 13, 11,  9,  9,  9,
    19, 24, 34, 42, 44, 42, 34, 24, 19,
    19, 24, 32, 37, 37, 37, 32, 24, 19,
    19, 23, 27, 29, 30, 29, 27, 23, 19,
    14, 18, 20, 27, 29, 27, 20, 18, 14,
     7,  0, 13,  0, 16,  0, 13,  0,  7,
     7,  0,  7,  0, 15,  0,  7,  0,  7,
     0,  0,  0,  1,  1,  1,  0,  0,  0,
     0,  0,  0,  2,  2,  2,  0,  0,  0,
     0,  0,  0, 11, 15, 11,  0,  0,  0];
  const KP_END = [
    10, 10, 10, 15, 15, 15, 10, 10, 10,
    35, 40, 45, 55, 60, 55, 45, 40, 35,
    40, 45, 48, 50, 50, 50, 48, 45, 40,
    42, 45, 48, 48, 48, 48, 48, 45, 42,
    38, 40, 40, 42, 42, 42, 40, 40, 38,
    20,  0, 22,  0, 24,  0, 22,  0, 20,
    18,  0, 20,  0, 22,  0, 20,  0, 18,
     0,  0,  0,  4, 10,  4,  0,  0,  0,
     0,  0,  0,  6, 12,  6,  0,  0,  0,
     0,  0,  0,  8, 13,  8,  0,  0,  0];
  const AB_SAFE = [
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0, 20,  0,  0,  0, 20,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
    18,  0,  0, 20, 23, 20,  0,  0, 18,
     0,  0,  0,  0, 23,  0,  0,  0,  0,
     0,  0, 20, 20,  0, 20, 20,  0,  0];
  const AB_THREAT = [
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0, 26,  0,  0,  0, 26,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
    24,  0,  0, 32, 40, 32,  0,  0, 24,
     0,  0,  0,  0, 40,  0,  0,  0,  0,
     0,  0, 32, 32,  0, 32, 32,  0,  0];
  const N_MID = [
    90, 90, 90, 96, 90, 96, 90, 90, 90,
    90, 96,103, 97, 94, 97,103, 96, 90,
    92, 98, 99,103, 99,103, 99, 98, 92,
    93,108,100,107,100,107,100,108, 93,
    90,100, 99,103,104,103, 99,100, 90,
    90, 98,101,102,103,102,101, 98, 90,
    92, 94, 98, 95, 98, 95, 98, 94, 92,
    93, 92, 94, 95, 92, 95, 94, 92, 93,
    85, 90, 92, 93, 78, 93, 92, 90, 85,
    88, 85, 90, 88, 90, 88, 90, 85, 88];
  const N_END = [
    92, 94, 96, 98, 98, 98, 96, 94, 92,
    94,100,102,104,106,104,102,100, 94,
    96,102,106,108,108,108,106,102, 96,
    96,104,108,110,110,110,108,104, 96,
    94,102,106,108,110,108,106,102, 94,
    94,100,104,106,106,106,104,100, 94,
    92, 98,100,102,102,102,100, 98, 92,
    90, 94, 96, 98, 96, 98, 96, 94, 90,
    88, 90, 92, 94, 88, 94, 92, 90, 88,
    86, 88, 90, 90, 90, 90, 90, 88, 86];
  const R_MID = [
    206,208,207,213,214,213,207,208,206,
    206,212,209,216,233,216,209,212,206,
    206,208,207,214,216,214,207,208,206,
    206,213,213,216,216,216,213,213,206,
    208,211,211,214,215,214,211,211,208,
    208,212,212,214,215,214,212,212,208,
    204,209,204,212,214,212,204,209,204,
    198,208,204,212,212,212,204,208,198,
    200,208,206,212,200,212,206,208,200,
    194,206,204,212,200,212,204,206,194];
  const R_END = [
    202,204,206,210,212,210,206,204,202,
    204,206,208,212,214,212,208,206,204,
    204,206,208,212,214,212,208,206,204,
    204,206,208,210,212,210,208,206,204,
    204,206,208,210,212,210,208,206,204,
    202,204,206,208,210,208,206,204,202,
    200,202,204,206,208,206,204,202,200,
    198,200,202,204,206,204,202,200,198,
    196,198,200,202,204,202,200,198,196,
    194,196,198,200,202,200,198,196,194];
  const C_MID = [
    100,100, 96, 91, 90, 91, 96,100,100,
     98, 98, 96, 92, 89, 92, 96, 98, 98,
     97, 97, 96, 91, 92, 91, 96, 97, 97,
     96, 99, 99, 98,100, 98, 99, 99, 96,
     96, 96, 96, 96,100, 96, 96, 96, 96,
     95, 96, 99, 96,100, 96, 99, 96, 95,
     96, 96, 96, 96, 96, 96, 96, 96, 96,
     97, 96,100, 99,101, 99,100, 96, 97,
     96, 97, 98, 98, 98, 98, 98, 97, 96,
     96, 96, 97, 99, 99, 99, 97, 96, 96];
  const C_END = [
     92, 92, 92, 92, 92, 92, 92, 92, 92,
     92, 92, 92, 92, 92, 92, 92, 92, 92,
     92, 92, 92, 92, 93, 92, 92, 92, 92,
     91, 92, 92, 92, 93, 92, 92, 92, 91,
     91, 91, 92, 92, 93, 92, 92, 91, 91,
     90, 91, 92, 92, 93, 92, 92, 91, 90,
     90, 90, 91, 91, 92, 91, 91, 90, 90,
     90, 90, 91, 91, 92, 91, 91, 90, 90,
     90, 90, 90, 91, 91, 91, 90, 90, 90,
     90, 90, 90, 90, 90, 90, 90, 90, 90];
  const MVV = [0, 100, 12, 12, 30, 60, 32, 10];
  const LVA = [0, 4, 12, 12, 30, 60, 32, 8];

  // 依局面子力（開中局/殘局、雙方進攻程度）產生每種棋子的位置價值表
  function buildPST(pos) {
    const c = pos ? pos.pcount : null;
    const cnt = pc => (c ? c[pc] : 0);
    let mid = 66, atk = [0, 0];
    if (c) {
      const m = (cnt(ROOK) + cnt(8 | ROOK)) * 6 + (cnt(KNIGHT) + cnt(8 | KNIGHT) + cnt(CANNON) + cnt(8 | CANNON)) * 3 +
        (cnt(ADVISOR) + cnt(8 | ADVISOR) + cnt(BISHOP) + cnt(8 | BISHOP) + cnt(PAWN) + cnt(8 | PAWN));
      mid = Math.max(0, Math.min(66, Math.round((132 - m) * m / 66)));
      for (let sd = 0; sd < 2; sd++) {
        const base = sd << 3; let a = 0;
        for (const t of [ROOK, KNIGHT, CANNON, PAWN]) {
          const pc = base | t;
          for (let j = 0; j < c[pc]; j++) {
            const sq = pos.plist[pc * 16 + j], r = RANK_OF[sq];
            if (halfOf(r) !== sd) a += (t === ROOK || t === KNIGHT) ? 2 : 1;
          }
        }
        const light = s => (cnt((s << 3) | ROOK) * 2 + cnt((s << 3) | KNIGHT) + cnt((s << 3) | CANNON));
        const diff = light(sd) - light(sd ^ 1);
        if (diff > 0) a += diff * 2;
        atk[sd] = Math.min(8, a);
      }
    } else atk = [4, 4];
    const mix = (A, B, w, total) => A.map((v, i) => Math.round((v * w + B[i] * (total - w)) / total));
    const kp = mix(KP_MID, KP_END, mid, 66), n = mix(N_MID, N_END, mid, 66), r = mix(R_MID, R_END, mid, 66), cn = mix(C_MID, C_END, mid, 66);
    const pst = [];
    for (let pc = 0; pc < 16; pc++) pst.push(new Int16Array(90));
    for (let sd = 0; sd < 2; sd++) {
      const ab = mix(AB_THREAT, AB_SAFE, atk[sd ^ 1], 8);
      const tables = [null, kp, ab, ab, n, r, cn, kp];
      for (let t = 1; t <= 7; t++) {
        const pc = (sd << 3) | t, out = pst[pc], tb = tables[t];
        for (let sq = 0; sq < 90; sq++) {
          const f = FILE_OF[sq], rk = RANK_OF[sq];
          out[sq] = sd === RED ? tb[(9 - rk) * 9 + f] : tb[rk * 9 + (8 - f)];
        }
      }
    }
    return pst;
  }
  const DEFAULT_PST = buildPST(null);

  // ------------------------------------------------------------------ FEN 字元
  const TYPE_CHARS = '.KABNRCP';
  function charToPiece(ch) {
    const u = ch.toUpperCase();
    let t = TYPE_CHARS.indexOf(u);
    if (u === 'H') t = KNIGHT; else if (u === 'E') t = BISHOP;
    if (t <= 0) return 0;
    return (ch === u ? 0 : 8) | t;
  }
  function pieceToChar(pc) { const ch = TYPE_CHARS[pc & 7]; return pc >= 8 ? ch.toLowerCase() : ch; }

  // ------------------------------------------------------------------ 局面
  class Position {
    constructor(fen) {
      this.board = new Int8Array(90);
      this.plist = new Int8Array(16 * 16);
      this.pcount = new Int8Array(16);
      this.pidx = new Int8Array(90);
      this.kingSq = new Int8Array(2);
      this.pst = DEFAULT_PST;
      this.clear();
      if (fen) this.fromFen(fen);
    }
    clear() {
      this.board.fill(0); this.pcount.fill(0); this.kingSq[0] = -1; this.kingSq[1] = -1;
      this.side = RED; this.key = 0; this.lock = 0; this.vlRed = 0; this.vlBlack = 0;
      this.mvList = [0]; this.pcList = [0]; this.keyList = [0]; this.lockList = [0]; this.chkList = [false];
      this.distance = 0;
    }
    addPiece(sq, pc) {
      this.board[sq] = pc;
      const n = this.pcount[pc];
      this.plist[pc * 16 + n] = sq; this.pidx[sq] = n; this.pcount[pc] = n + 1;
      if (pc < 8) this.vlRed += this.pst[pc][sq]; else this.vlBlack += this.pst[pc][sq];
      this.key ^= ZK[pc * 90 + sq]; this.lock ^= ZL[pc * 90 + sq];
      if ((pc & 7) === KING) this.kingSq[pc >> 3] = sq;
    }
    delPiece(sq, pc) {
      this.board[sq] = 0;
      const n = this.pcount[pc] - 1, i = this.pidx[sq], last = this.plist[pc * 16 + n];
      this.plist[pc * 16 + i] = last; this.pidx[last] = i; this.pcount[pc] = n;
      if (pc < 8) this.vlRed -= this.pst[pc][sq]; else this.vlBlack -= this.pst[pc][sq];
      this.key ^= ZK[pc * 90 + sq]; this.lock ^= ZL[pc * 90 + sq];
      if ((pc & 7) === KING && this.kingSq[pc >> 3] === sq) this.kingSq[pc >> 3] = -1;
    }
    setPST(pst) {
      this.pst = pst; this.vlRed = 0; this.vlBlack = 0;
      for (let sq = 0; sq < 90; sq++) { const pc = this.board[sq]; if (pc) { if (pc < 8) this.vlRed += pst[pc][sq]; else this.vlBlack += pst[pc][sq]; } }
    }
    fromFen(fen) {
      this.clear();
      const parts = String(fen).trim().split(/\s+/);
      const rows = (parts[0] || '').split('/');
      if (rows.length !== 10) throw new Error('FEN 需要 10 列');
      for (let i = 0; i < 10; i++) {
        const r = 9 - i; let f = 0;
        for (const ch of rows[i]) {
          if (ch >= '1' && ch <= '9') { f += ch.charCodeAt(0) - 48; continue; }
          const pc = charToPiece(ch);
          if (!pc || f > 8) throw new Error('FEN 含無效字元：' + ch);
          this.addPiece(r * 9 + f, pc); f++;
        }
        if (f !== 9) throw new Error('FEN 第 ' + (i + 1) + ' 列格數錯誤');
      }
      if (parts[1] === 'b') this.changeSide();
      this.chkList = [this.kingAttacked(this.side)];
      return this;
    }
    toFen(moveNo) {
      let s = '';
      for (let r = 9; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 9; f++) {
          const pc = this.board[r * 9 + f];
          if (!pc) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          s += pieceToChar(pc);
        }
        if (empty) s += empty;
        if (r > 0) s += '/';
      }
      return s + (this.side === RED ? ' w' : ' b') + ' - - 0 ' + (moveNo || 1);
    }
    copyFrom(o) {
      this.board.set(o.board); this.plist.set(o.plist); this.pcount.set(o.pcount); this.pidx.set(o.pidx); this.kingSq.set(o.kingSq);
      this.pst = o.pst; this.side = o.side; this.key = o.key; this.lock = o.lock; this.vlRed = o.vlRed; this.vlBlack = o.vlBlack;
      this.mvList = o.mvList.slice(); this.pcList = o.pcList.slice(); this.keyList = o.keyList.slice(); this.lockList = o.lockList.slice(); this.chkList = o.chkList.slice();
      this.distance = o.distance;
      return this;
    }
    clone() { return new Position().copyFrom(this); }
    changeSide() { this.side ^= 1; this.key ^= ZK_SIDE; this.lock ^= ZL_SIDE; }
    movePiece(mv) {
      const s = mv & 255, d = mv >> 8, pc = this.board[s], cap = this.board[d];
      if (cap) this.delPiece(d, cap);
      this.delPiece(s, pc); this.addPiece(d, pc);
      return cap;
    }
    undoMovePiece(mv, cap) {
      const s = mv & 255, d = mv >> 8, pc = this.board[d];
      this.delPiece(d, pc); this.addPiece(s, pc);
      if (cap) this.addPiece(d, cap);
    }
    // 某方的將（帥）是否被攻擊（含「將帥照面」）
    kingAttacked(sd) {
      const k = this.kingSq[sd];
      if (k < 0) return false;
      const b = this.board, ob = (sd ^ 1) << 3;
      const oPawn = ob | PAWN, oKnight = ob | KNIGHT, oRook = ob | ROOK, oCannon = ob | CANNON, oKing = ob | KING;
      if (sd === RED) { if (k + 9 < 90 && b[k + 9] === oPawn) return true; }
      else if (k - 9 >= 0 && b[k - 9] === oPawn) return true;
      const f = FILE_OF[k];
      if (f > 0 && b[k - 1] === oPawn) return true;
      if (f < 8 && b[k + 1] === oPawn) return true;
      const af = KNIGHT_ATK_FROM[k], al = KNIGHT_ATK_LEG[k];
      for (let i = 0; i < af.length; i++) if (b[af[i]] === oKnight && b[al[i]] === 0) return true;
      const rays = RAYS[k];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d], n = ray.length;
        let i = 0;
        for (; i < n; i++) { const p = b[ray[i]]; if (p) { if (p === oRook || p === oKing) return true; break; } }
        for (i++; i < n; i++) { const p = b[ray[i]]; if (p) { if (p === oCannon) return true; break; } }
      }
      return false;
    }
    inCheck() { return this.chkList[this.chkList.length - 1]; }
    lastMove() { return this.mvList[this.mvList.length - 1]; }
    lastCaptured() { return this.pcList[this.pcList.length - 1]; }
    // 產生（偽）合法著法
    genMoves(mvs, capOnly) {
      const b = this.board, sd = this.side, base = sd << 3;
      let n = 0;
      for (let t = KING; t <= PAWN; t++) {
        const pc = base | t, cnt = this.pcount[pc];
        for (let j = 0; j < cnt; j++) {
          const s = this.plist[pc * 16 + j];
          if (t === ROOK) {
            const rays = RAYS[s];
            for (let r = 0; r < 4; r++) {
              const ray = rays[r];
              for (let i = 0; i < ray.length; i++) {
                const d = ray[i], q = b[d];
                if (q === 0) { if (!capOnly) mvs[n++] = s | (d << 8); continue; }
                if ((q >> 3) !== sd) mvs[n++] = s | (d << 8);
                break;
              }
            }
          } else if (t === CANNON) {
            const rays = RAYS[s];
            for (let r = 0; r < 4; r++) {
              const ray = rays[r], len = ray.length;
              let i = 0;
              for (; i < len; i++) { const d = ray[i]; if (b[d]) break; if (!capOnly) mvs[n++] = s | (d << 8); }
              for (i++; i < len; i++) { const q = b[ray[i]]; if (q) { if ((q >> 3) !== sd) mvs[n++] = s | (ray[i] << 8); break; } }
            }
          } else if (t === KNIGHT || t === BISHOP) {
            const to = t === KNIGHT ? KNIGHT_TO[s] : BISHOP_TO[s], leg = t === KNIGHT ? KNIGHT_LEG[s] : BISHOP_EYE[s];
            for (let i = 0; i < to.length; i++) {
              if (b[leg[i]]) continue;
              const d = to[i], q = b[d];
              if (q === 0) { if (!capOnly) mvs[n++] = s | (d << 8); } else if ((q >> 3) !== sd) mvs[n++] = s | (d << 8);
            }
          } else {
            const to = t === KING ? KING_TO[s] : t === ADVISOR ? ADVISOR_TO[s] : PAWN_TO[sd][s];
            for (let i = 0; i < to.length; i++) {
              const d = to[i], q = b[d];
              if (q === 0) { if (!capOnly) mvs[n++] = s | (d << 8); } else if ((q >> 3) !== sd) mvs[n++] = s | (d << 8);
            }
          }
        }
      }
      return n;
    }
    // 檢查走完後己方是否被將
    tryMove(mv) {
      const cap = this.movePiece(mv), ok = !this.kingAttacked(this.side);
      this.undoMovePiece(mv, cap);
      return ok;
    }
    legalMoves() {
      const buf = new Int32Array(MAX_GEN), n = this.genMoves(buf, false), out = [];
      for (let i = 0; i < n; i++) if (this.tryMove(buf[i])) out.push(buf[i]);
      return out;
    }
    hasLegalMove() {
      const buf = new Int32Array(MAX_GEN), n = this.genMoves(buf, false);
      for (let i = 0; i < n; i++) if (this.tryMove(buf[i])) return true;
      return false;
    }
    isLegal(mv) {
      const s = mv & 255, d = mv >> 8;
      if (s >= 90 || d >= 90) return false;
      const pc = this.board[s];
      if (!pc || (pc >> 3) !== this.side) return false;
      return this.legalMoves().indexOf(mv) >= 0;
    }
    makeMove(mv) {
      const key = this.key, lock = this.lock;
      const cap = this.movePiece(mv);
      if (this.kingAttacked(this.side)) { this.undoMovePiece(mv, cap); return false; }
      this.changeSide();
      this.keyList.push(key); this.lockList.push(lock);
      this.mvList.push(mv); this.pcList.push(cap);
      this.chkList.push(this.kingAttacked(this.side));
      this.distance++;
      return true;
    }
    undoMakeMove() {
      this.distance--;
      this.chkList.pop(); this.keyList.pop(); this.lockList.pop();
      this.changeSide();
      this.undoMovePiece(this.mvList.pop(), this.pcList.pop());
    }
    nullMove() {
      this.keyList.push(this.key); this.lockList.push(this.lock);
      this.changeSide();
      this.mvList.push(0); this.pcList.push(0); this.chkList.push(false);
      this.distance++;
    }
    undoNullMove() {
      this.distance--;
      this.chkList.pop(); this.pcList.pop(); this.mvList.pop(); this.keyList.pop(); this.lockList.pop();
      this.changeSide();
    }
    nullOkay() { return (this.side === RED ? this.vlRed : this.vlBlack) > NULL_OKAY_MARGIN; }
    nullSafe() { return (this.side === RED ? this.vlRed : this.vlBlack) > NULL_SAFE_MARGIN; }
    mateValue() { return this.distance - MATE_VALUE; }
    banValue() { return this.distance - BAN_VALUE; }
    drawValue() { return (this.distance & 1) === 0 ? -DRAW_VALUE : DRAW_VALUE; }
    // 重複局面偵測：回傳 0 或 1 + (本方長將 ? 2 : 0) + (對方長將 ? 4 : 0)
    repStatus(recur) {
      let selfSide = false, perpCheck = true, oppPerpCheck = true;
      let i = this.mvList.length - 1;
      while (this.mvList[i] > 0 && this.pcList[i] === 0) {
        if (selfSide) {
          perpCheck = perpCheck && this.chkList[i];
          if (this.keyList[i] === this.key && this.lockList[i] === this.lock) {
            if (--recur === 0) return 1 + (perpCheck ? 2 : 0) + (oppPerpCheck ? 4 : 0);
          }
        } else oppPerpCheck = oppPerpCheck && this.chkList[i];
        selfSide = !selfSide;
        i--;
      }
      return 0;
    }
    repValue(rep) {
      const vl = ((rep & 2) ? this.banValue() : 0) + ((rep & 4) ? -this.banValue() : 0);
      return vl === 0 ? this.drawValue() : vl;
    }
    evaluate() {
      const d = this.dynEval();
      let vl = (this.side === RED ? this.vlRed - this.vlBlack + d : this.vlBlack - this.vlRed - d) + ADVANCED_VALUE;
      return vl === this.drawValue() ? vl - 1 : vl;
    }
    // 動態評估：車的靈活度、馬被蹩、空頭炮（紅方減黑方）
    dynEval() {
      const b = this.board, P = this.plist;
      let s = 0;
      for (let sd = 0; sd < 2; sd++) {
        const sign = sd === RED ? 1 : -1, base = sd << 3, ek = this.kingSq[sd ^ 1];
        let pc = base | ROOK;
        for (let j = 0; j < this.pcount[pc]; j++) {
          const rays = RAYS[P[pc * 16 + j]];
          let mob = 0;
          for (let r = 0; r < 4; r++) {
            const ray = rays[r];
            for (let i = 0; i < ray.length; i++) { const q = b[ray[i]]; if (q === 0) { mob++; continue; } if ((q >> 3) !== sd) mob++; break; }
          }
          s += sign * (mob - 6);
        }
        pc = base | KNIGHT;
        for (let j = 0; j < this.pcount[pc]; j++) {
          const sq = P[pc * 16 + j], to = KNIGHT_TO[sq], leg = KNIGHT_LEG[sq];
          let mob = 0;
          for (let i = 0; i < to.length; i++) { if (b[leg[i]]) continue; const q = b[to[i]]; if (q === 0 || (q >> 3) !== sd) mob++; }
          if (mob === 0) s -= sign * 12; else if (mob === 1) s -= sign * 6;
        }
        if (ek >= 0) {
          pc = base | CANNON;
          const ef = FILE_OF[ek];
          for (let j = 0; j < this.pcount[pc]; j++) {
            const sq = P[pc * 16 + j];
            if (FILE_OF[sq] !== ef) continue;
            const lo = Math.min(sq, ek), hi = Math.max(sq, ek);
            let between = 0;
            for (let x = lo + 9; x < hi; x += 9) if (b[x]) between++;
            if (between === 0) s += sign * 28;
          }
        }
      }
      return s;
    }
  }

  // ------------------------------------------------------------------ 搜尋
  class Searcher {
    constructor(hashBits) {
      this.allocHash(hashBits || 19);
      this.history = new Int32Array(1 << 15);
      this.killers = new Int32Array((LIMIT_DEPTH + 4) * 2);
      this.mvBuf = []; this.scBuf = [];
      for (let i = 0; i < LIMIT_DEPTH + 4; i++) { this.mvBuf.push(new Int32Array(MAX_GEN)); this.scBuf.push(new Int32Array(MAX_GEN)); }
      this.stop = false; this.nodes = 0;
    }
    allocHash(bits) {
      const n = 1 << bits;
      this.hashMask = n - 1;
      this.hLock = new Int32Array(n); this.hVal = new Int16Array(n); this.hMv = new Uint16Array(n);
      this.hDepth = new Int8Array(n); this.hFlag = new Uint8Array(n);
    }
    clearHash() { this.hFlag.fill(0); this.hDepth.fill(0); this.hMv.fill(0); }
    probeHash(alpha, beta, depth) {
      const pos = this.pos, i = pos.key & this.hashMask;
      if (this.hFlag[i] === 0 || this.hLock[i] !== pos.lock) { this.hashMv = 0; return NO_HIT; }
      this.hashMv = this.hMv[i];
      let vl = this.hVal[i], mate = false;
      if (vl > WIN_VALUE) { if (vl < BAN_VALUE) return NO_HIT; vl -= pos.distance; mate = true; }
      else if (vl < -WIN_VALUE) { if (vl > -BAN_VALUE) return NO_HIT; vl += pos.distance; mate = true; }
      if (this.hDepth[i] >= depth || mate) {
        const f = this.hFlag[i];
        if (f === HASH_BETA) return vl >= beta ? vl : NO_HIT;
        if (f === HASH_ALPHA) return vl <= alpha ? vl : NO_HIT;
        return vl;
      }
      return NO_HIT;
    }
    recordHash(flag, vl, depth, mv) {
      const pos = this.pos, i = pos.key & this.hashMask;
      if (this.hFlag[i] && this.hDepth[i] > depth) return;
      if (vl > WIN_VALUE) { if (mv === 0 && vl <= BAN_VALUE) return; vl += pos.distance; }
      else if (vl < -WIN_VALUE) { if (mv === 0 && vl >= -BAN_VALUE) return; vl -= pos.distance; }
      else if (vl === pos.drawValue() && mv === 0) return;
      this.hLock[i] = pos.lock; this.hFlag[i] = flag; this.hDepth[i] = depth; this.hVal[i] = vl; this.hMv[i] = mv;
    }
    setBest(mv, depth, ply) {
      if (this.pos.board[mv >> 8]) return;
      if ((this.history[mv] += depth * depth) > (1 << 20)) for (let i = 0; i < this.history.length; i++) this.history[i] >>= 1;
      const k = ply * 2;
      if (this.killers[k] !== mv) { this.killers[k + 1] = this.killers[k]; this.killers[k] = mv; }
    }
    timeUp() { return now() > this.deadline; }
    searchQuiesc(alpha, beta) {
      const pos = this.pos;
      if ((++this.nodes & 2047) === 0 && this.timeUp()) this.stop = true;
      if (this.stop) return 0;
      let vl = pos.distance - MATE_VALUE;
      if (vl >= beta) return vl;
      const rep = pos.repStatus(1);
      if (rep > 0) return pos.repValue(rep);
      if (pos.distance >= LIMIT_DEPTH) return pos.evaluate();
      let best = -MATE_VALUE, n;
      const ply = pos.distance, mvs = this.mvBuf[ply], sc = this.scBuf[ply], b = pos.board;
      if (pos.inCheck()) {
        n = pos.genMoves(mvs, false);
        for (let i = 0; i < n; i++) { const mv = mvs[i], cap = b[mv >> 8]; sc[i] = cap ? (1 << 22) + MVV[cap & 7] * 16 - LVA[b[mv & 255] & 7] : this.history[mv]; }
      } else {
        vl = pos.evaluate();
        if (vl > best) { best = vl; if (vl >= beta) return vl; if (vl > alpha) alpha = vl; }
        n = pos.genMoves(mvs, true);
        for (let i = 0; i < n; i++) { const mv = mvs[i]; sc[i] = MVV[b[mv >> 8] & 7] * 16 - LVA[b[mv & 255] & 7]; }
      }
      for (let i = 0; i < n; i++) {
        let bi = i, bs = sc[i];
        for (let j = i + 1; j < n; j++) if (sc[j] > bs) { bs = sc[j]; bi = j; }
        const mv = mvs[bi]; mvs[bi] = mvs[i]; mvs[i] = mv; sc[bi] = sc[i]; sc[i] = bs;
        if (!pos.makeMove(mv)) continue;
        vl = -this.searchQuiesc(-beta, -alpha);
        pos.undoMakeMove();
        if (this.stop) return 0;
        if (vl > best) { best = vl; if (vl >= beta) return vl; if (vl > alpha) alpha = vl; }
      }
      return best === -MATE_VALUE ? pos.distance - MATE_VALUE : best;
    }
    searchFull(alpha, beta, depth, noNull) {
      if (depth <= 0) return this.searchQuiesc(alpha, beta);
      const pos = this.pos;
      if ((++this.nodes & 2047) === 0 && this.timeUp()) this.stop = true;
      if (this.stop) return 0;
      let vl = pos.distance - MATE_VALUE;
      if (vl >= beta) return vl;
      const rep = pos.repStatus(1);
      if (rep > 0) return pos.repValue(rep);
      vl = this.probeHash(alpha, beta, depth);
      if (vl !== NO_HIT) return vl;
      const hashMv = this.hashMv;
      if (pos.distance >= LIMIT_DEPTH) return pos.evaluate();
      const inCheck = pos.inCheck();
      if (!noNull && !this.disableNull && !inCheck && pos.nullOkay()) {
        pos.nullMove();
        vl = -this.searchFull(-beta, 1 - beta, depth - NULL_DEPTH - 1, true);
        pos.undoNullMove();
        if (this.stop) return 0;
        if (vl >= beta && (pos.nullSafe() || this.searchFull(alpha, beta, depth - NULL_DEPTH, true) >= beta)) return vl;
        if (this.stop) return 0;
      }
      const ply = pos.distance, mvs = this.mvBuf[ply], sc = this.scBuf[ply], b = pos.board;
      const n = pos.genMoves(mvs, false);
      const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
      for (let i = 0; i < n; i++) {
        const mv = mvs[i];
        if (mv === hashMv) { sc[i] = 1 << 30; continue; }
        const cap = b[mv >> 8];
        if (cap) {
          const v = MVV[cap & 7], a = LVA[b[mv & 255] & 7];
          sc[i] = (v + 4 >= a ? (1 << 23) : (1 << 20)) + v * 16 - a;
        } else if (mv === k1) sc[i] = 1 << 22;
        else if (mv === k2) sc[i] = (1 << 22) - 1;
        else sc[i] = this.history[mv];
      }
      let best = -MATE_VALUE, bestMv = 0, flag = HASH_ALPHA, legal = 0;
      for (let i = 0; i < n; i++) {
        let bi = i, bs = sc[i];
        for (let j = i + 1; j < n; j++) if (sc[j] > bs) { bs = sc[j]; bi = j; }
        const mv = mvs[bi]; mvs[bi] = mvs[i]; mvs[i] = mv; sc[bi] = sc[i]; sc[i] = bs;
        const isCap = b[mv >> 8] !== 0;
        if (!pos.makeMove(mv)) continue;
        legal++;
        const givesCheck = pos.inCheck();
        const newDepth = givesCheck ? depth : depth - 1;
        if (best === -MATE_VALUE) vl = -this.searchFull(-beta, -alpha, newDepth, false);
        else {
          if (!this.disableNull && legal > 4 && depth >= 3 && !inCheck && !givesCheck && !isCap && bs < (1 << 21)) vl = -this.searchFull(-alpha - 1, -alpha, newDepth - 1, false);
          else vl = alpha + 1;
          if (vl > alpha && !this.stop) {
            vl = -this.searchFull(-alpha - 1, -alpha, newDepth, false);
            if (vl > alpha && vl < beta && !this.stop) vl = -this.searchFull(-beta, -alpha, newDepth, false);
          }
        }
        pos.undoMakeMove();
        if (this.stop) return 0;
        if (vl > best) {
          best = vl;
          if (vl >= beta) { flag = HASH_BETA; bestMv = mv; break; }
          if (vl > alpha) { flag = HASH_PV; bestMv = mv; alpha = vl; }
        }
      }
      if (best === -MATE_VALUE) return pos.distance - MATE_VALUE;
      this.recordHash(flag, best, depth, bestMv);
      if (bestMv) this.setBest(bestMv, depth, ply);
      return best;
    }
    searchRoot(depth) {
      const pos = this.pos, moves = this.rootMoves, scores = this.rootScores, full = this.noise > 0;
      let best = -MATE_VALUE;
      this.iterBest = 0;
      for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];
        if (!pos.makeMove(mv)) { scores[i] = -MATE_VALUE; continue; }
        const newDepth = pos.inCheck() ? depth : depth - 1;
        let vl;
        if (full || best === -MATE_VALUE) vl = -this.searchFull(-MATE_VALUE, MATE_VALUE, newDepth, false);
        else {
          vl = -this.searchFull(-best - 1, -best, newDepth, false);
          if (vl > best && !this.stop) vl = -this.searchFull(-MATE_VALUE, -best, newDepth, false);
        }
        pos.undoMakeMove();
        if (this.stop) break;
        scores[i] = vl;
        if (vl > best) { best = vl; this.iterBest = mv; this.iterBestScore = vl; }
      }
      if (!this.stop) {
        const order = moves.map((mv, i) => [mv, scores[i], i]);
        order.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
        for (let i = 0; i < order.length; i++) { moves[i] = order[i][0]; scores[i] = order[i][1]; }
        this.recordHash(HASH_PV, best, depth, moves[0]);
      }
      return best;
    }
    extractPV(first, max) {
      const pos = this.pos, pv = [];
      let mv = first, made = 0;
      max = max || 16;
      while (mv && pv.length < max) {
        if (!pos.isLegal(mv)) break;
        pos.makeMove(mv); made++; pv.push(mv);
        if (pos.repStatus(1)) break;
        const i = pos.key & this.hashMask;
        mv = (this.hFlag[i] && this.hLock[i] === pos.lock) ? this.hMv[i] : 0;
      }
      while (made-- > 0) pos.undoMakeMove();
      return pv;
    }
    // opts: { time(ms), depth, noise, onInfo(info) }
    search(pos, opts) {
      opts = opts || {};
      this.pos = pos;
      pos.distance = 0;
      pos.setPST(buildPST(pos));
      for (let i = 0; i < this.hDepth.length; i++) this.hDepth[i] = 0;
      this.history.fill(0); this.killers.fill(0);
      this.nodes = 0; this.stop = false;
      this.noise = opts.noise || 0;
      this.disableNull = !!opts.exact;
      const t0 = now(), timeLimit = opts.time || 1e9;
      this.deadline = t0 + timeLimit;
      const maxDepth = Math.min(opts.depth || LIMIT_DEPTH - 4, LIMIT_DEPTH - 4);
      const legal = pos.legalMoves();
      if (!legal.length) return { move: 0, score: pos.mateValue(), depth: 0, pv: [], nodes: 0 };
      const b = pos.board;
      legal.sort((x, y) => (MVV[b[y >> 8] & 7] - MVV[b[x >> 8] & 7]));
      this.rootMoves = legal; this.rootScores = new Int32Array(legal.length);
      let bestMove = legal[0], bestScore = 0, done = 0, pv = [legal[0]];
      if (legal.length === 1 && !opts.analysis) {
        this.searchRoot(1);
        return { move: legal[0], score: this.rootScores[0], depth: 1, pv: [legal[0]], nodes: this.nodes, forced: true };
      }
      for (let depth = 1; depth <= maxDepth; depth++) {
        const vl = this.searchRoot(depth);
        if (this.stop) {
          if (this.iterBest && this.iterBest !== bestMove && this.iterBestScore > bestScore) { bestMove = this.iterBest; bestScore = this.iterBestScore; pv = [bestMove]; }
          break;
        }
        bestMove = this.rootMoves[0]; bestScore = vl; done = depth;
        pv = this.extractPV(bestMove);
        if (opts.onInfo) opts.onInfo({ depth, score: vl, pv: pv.slice(), nodes: this.nodes, time: Math.round(now() - t0) });
        if (Math.abs(vl) > WIN_VALUE && depth >= MATE_VALUE - Math.abs(vl) + 1 && !opts.analysis) break;
        if (depth >= 2 && now() - t0 > timeLimit * 0.5) break;
      }
      if (this.noise > 0 && done > 0) {
        let bi = -1, bv = -Infinity;
        const allLose = this.rootScores.every(v => v < -WIN_VALUE);
        for (let i = 0; i < this.rootMoves.length; i++) {
          const sc = this.rootScores[i];
          if (!allLose && sc < -WIN_VALUE) continue;
          const v = sc + (Math.random() * 2 - 1) * this.noise;
          if (v > bv) { bv = v; bi = i; }
        }
        if (bi >= 0 && this.rootMoves[bi] !== bestMove) { bestMove = this.rootMoves[bi]; bestScore = this.rootScores[bi]; pv = this.extractPV(bestMove); }
      }
      return { move: bestMove, score: bestScore, depth: done, pv, nodes: this.nodes, time: Math.round(now() - t0) };
    }
  }

  // ------------------------------------------------------------------ 座標記譜
  function moveToIccs(mv) {
    const s = mv & 255, d = mv >> 8;
    return FILES[FILE_OF[s]] + RANK_OF[s] + FILES[FILE_OF[d]] + RANK_OF[d];
  }
  function iccsToMove(str) {
    const m = /^([a-i])([0-9])-?([a-i])([0-9])$/i.exec(String(str).trim());
    if (!m) return 0;
    const s = (+m[2]) * 9 + FILES.indexOf(m[1].toLowerCase()), d = (+m[4]) * 9 + FILES.indexOf(m[3].toLowerCase());
    return s === d ? 0 : (s | (d << 8));
  }
  function mirrorIccs(s) { const mf = c => FILES[8 - FILES.indexOf(c)]; return mf(s[0]) + s[1] + mf(s[2]) + s[3]; }

  // ------------------------------------------------------------------ 中文記譜
  const NAMES = {
    'zh-TW': ['', '帥', '仕', '相', '傌', '俥', '炮', '兵', '', '將', '士', '象', '馬', '車', '砲', '卒'],
    'zh-CN': ['', '帅', '仕', '相', '马', '车', '炮', '兵', '', '将', '士', '象', '马', '车', '炮', '卒'],
  };
  const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const FW_NUM = ['０', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
  const WXF_LETTERS = '.KAEHRCP';

  function tandemInfo(board, from) {
    const pc = board[from], sd = pc >> 3, ff = FILE_OF[from], fr = RANK_OF[from];
    const same = [];
    for (let r = 0; r < 10; r++) if (board[r * 9 + ff] === pc) same.push(r);
    same.sort((a, b) => (sd === RED ? b - a : a - b));
    let multi = false;
    if ((pc & 7) === PAWN && same.length >= 2) {
      for (let f = 0; f < 9 && !multi; f++) {
        if (f === ff) continue;
        let c = 0;
        for (let r = 0; r < 10; r++) if (board[r * 9 + f] === pc) c++;
        if (c >= 2) multi = true;
      }
    }
    return { count: same.length, index: same.indexOf(fr), multi };
  }

  function moveToChinese(pos, mv, lang) {
    const tw = lang !== 'zh-CN', names = tw ? NAMES['zh-TW'] : NAMES['zh-CN'];
    const b = pos.board, from = mv & 255, to = mv >> 8, pc = b[from];
    if (!pc) return '??';
    const t = pc & 7, sd = pc >> 3;
    const colNum = f => (sd === RED ? 9 - f : f + 1);
    const num = n => (sd === RED ? CN_NUM[n] : FW_NUM[n]);
    let head;
    const ti = (t === ADVISOR || t === BISHOP) ? { count: 1 } : tandemInfo(b, from);
    if (ti.count >= 2) {
      const back = tw ? '後' : '后';
      let prefix;
      if (ti.count === 2) prefix = ti.index === 0 ? '前' : back;
      else if (ti.count === 3) prefix = ['前', '中', back][ti.index];
      else prefix = CN_NUM[ti.index + 1];
      head = ti.multi ? prefix + num(colNum(FILE_OF[from])) : prefix + names[pc];
    } else head = names[pc] + num(colNum(FILE_OF[from]));
    const fr = RANK_OF[from], tr = RANK_OF[to];
    if (fr === tr) return head + '平' + num(colNum(FILE_OF[to]));
    const fwd = sd === RED ? tr > fr : tr < fr;
    const act = fwd ? (tw ? '進' : '进') : '退';
    const dest = (t === ADVISOR || t === BISHOP || t === KNIGHT) ? num(colNum(FILE_OF[to])) : num(Math.abs(tr - fr));
    return head + act + dest;
  }

  function moveToWxf(pos, mv) {
    const b = pos.board, from = mv & 255, to = mv >> 8, pc = b[from];
    if (!pc) return '??';
    const t = pc & 7, sd = pc >> 3;
    const colNum = f => (sd === RED ? 9 - f : f + 1);
    let head = WXF_LETTERS[t];
    const ti = (t === ADVISOR || t === BISHOP) ? { count: 1 } : tandemInfo(b, from);
    if (ti.count === 2) head += ti.index === 0 ? '+' : '-';
    else if (ti.count > 2) head += 'abcde'[ti.index];
    else head += colNum(FILE_OF[from]);
    const fr = RANK_OF[from], tr = RANK_OF[to];
    if (fr === tr) return head + '.' + colNum(FILE_OF[to]);
    const fwd = sd === RED ? tr > fr : tr < fr;
    const dest = (t === ADVISOR || t === BISHOP || t === KNIGHT) ? colNum(FILE_OF[to]) : Math.abs(tr - fr);
    return head + (fwd ? '+' : '-') + dest;
  }

  function normalizeNotation(s) {
    s = String(s).trim();
    const map = { '俥': '车', '伡': '车', '車': '车', '傌': '马', '馬': '马', '㐷': '马', '砲': '炮', '包': '炮', '帥': '将', '帅': '将', '將': '将', '仕': '士', '相': '象', '卒': '兵', '進': '进', '後': '后' };
    let out = '';
    for (const ch of s) {
      if (map[ch]) { out += map[ch]; continue; }
      const fw = FW_NUM.indexOf(ch); if (fw > 0) { out += fw; continue; }
      const cn = CN_NUM.indexOf(ch); if (cn > 0) { out += cn; continue; }
      if (/[\s,，、。;；]/.test(ch)) continue;
      out += ch.toUpperCase();
    }
    return out;
  }

  // 解析各種格式的單步著法（ICCS、中文、WXF）
  function parseMove(pos, text) {
    const t = String(text).trim();
    if (!t) return 0;
    const ic = iccsToMove(t);
    const legal = pos.legalMoves();
    if (ic && legal.indexOf(ic) >= 0) return ic;
    const n = normalizeNotation(t);
    for (const mv of legal) {
      if (normalizeNotation(moveToChinese(pos, mv, 'zh-TW')) === n) return mv;
      if (moveToWxf(pos, mv).toUpperCase() === n) return mv;
    }
    return 0;
  }

  // ------------------------------------------------------------------ 規則輔助
  // 某格子是否被 sd 方的棋子攻擊（可合法吃到）
  function attackersOf(pos, sq, sd) {
    const saveSide = pos.side;
    if (pos.side !== sd) pos.changeSide();
    const buf = new Int32Array(MAX_GEN), n = pos.genMoves(buf, true), out = [];
    for (let i = 0; i < n; i++) if ((buf[i] >> 8) === sq && pos.tryMove(buf[i])) out.push(buf[i] & 255);
    if (pos.side !== saveSide) pos.changeSide();
    return out;
  }
  // 棋子在 from 可合法吃到的對方棋子位置
  function capturesFrom(pos, from) {
    const pc = pos.board[from], sd = pc >> 3, saveSide = pos.side;
    if (pos.side !== sd) pos.changeSide();
    const buf = new Int32Array(MAX_GEN), n = pos.genMoves(buf, true), out = [];
    for (let i = 0; i < n; i++) if ((buf[i] & 255) === from && pos.tryMove(buf[i])) out.push(buf[i] >> 8);
    if (pos.side !== saveSide) pos.changeSide();
    return out;
  }
  // 對方棋子是否有根（被吃後可以吃回）
  function isProtected(pos, sq, attackerFrom) {
    const tgt = pos.board[sq], sd = tgt >> 3;
    const cap = pos.movePiece(attackerFrom | (sq << 8));
    const prot = attackersOf(pos, sq, sd).length > 0;
    pos.undoMovePiece(attackerFrom | (sq << 8), cap);
    return prot;
  }
  // 判斷某一著是否構成「捉」（簡化版亞洲規則）：走後該子新攻擊到對方無根的車馬炮或過河兵，或以馬、炮捉車
  function moveChases(pos, mv) {
    const from = mv & 255, to = mv >> 8, pc = pos.board[from], t = pc & 7;
    if (t === KING || t === PAWN) return false;
    const before = new Set(capturesFrom(pos, from).map(s => s));
    const p2 = pos.clone();
    if (!p2.makeMove(mv)) return false;
    if (p2.inCheck()) return false;
    const after = capturesFrom(p2, to);
    for (const s of after) {
      const tp = p2.board[s], tt = tp & 7;
      if (tt === KING) continue;
      if (tt === PAWN && halfOf(RANK_OF[s]) === (tp >> 3)) continue;
      if (before.has(s) && pos.board[s] === tp) continue;
      if (tt === ROOK && (t === KNIGHT || t === CANNON)) return true;
      if ((tt === ROOK && t === ROOK) || tt === ADVISOR || tt === BISHOP) { if (!isProtected(p2, s, to)) return true; continue; }
      if (!isProtected(p2, s, to)) return true;
    }
    return false;
  }
  // 雙方都沒有進攻棋子（車馬炮兵）→ 和棋
  function insufficientMaterial(pos) {
    const c = pos.pcount;
    for (const t of [KNIGHT, ROOK, CANNON, PAWN]) if (c[t] || c[8 | t]) return false;
    return true;
  }
  const ADVISOR_SQ = [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]];
  const BISHOP_SQ = [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]];
  // 檢查擺棋局面是否合法，回傳錯誤代碼或 null
  function validateSetup(pos) {
    const c = pos.pcount, b = pos.board;
    if (c[KING] !== 1 || c[8 | KING] !== 1) return 'kings';
    const limits = [0, 1, 2, 2, 2, 2, 2, 5];
    for (let t = 1; t <= 7; t++) if (c[t] > limits[t] || c[8 | t] > limits[t]) return 'count';
    for (let sq = 0; sq < 90; sq++) {
      const pc = b[sq]; if (!pc) continue;
      const t = pc & 7, sd = pc >> 3, f = FILE_OF[sq], r0 = RANK_OF[sq], r = sd === RED ? r0 : 9 - r0;
      if (t === KING && !(f >= 3 && f <= 5 && r <= 2)) return 'palace';
      if (t === ADVISOR && !ADVISOR_SQ.some(([x, y]) => x === f && y === r)) return 'advisor';
      if (t === BISHOP && !BISHOP_SQ.some(([x, y]) => x === f && y === r)) return 'bishop';
      if (t === PAWN && (r < 3 || (r <= 4 && f % 2 === 1))) return 'pawn';
    }
    const rk = pos.kingSq[RED], bk = pos.kingSq[BLACK];
    if (FILE_OF[rk] === FILE_OF[bk]) {
      let blocked = false;
      for (let x = rk + 9; x < bk; x += 9) if (b[x]) { blocked = true; break; }
      if (!blocked) return 'face';
    }
    if (pos.kingAttacked(pos.side ^ 1)) return 'check';
    return null;
  }

  // ------------------------------------------------------------------ 開局庫
  // [權重, 繁體名稱, 簡體名稱, 英文名稱, ICCS 著法]
  const BOOK_LINES = [
    [6, '中炮', '中炮', 'Central Cannon', 'h2e2'],
    [5, '中炮對屏風馬', '中炮对屏风马', 'Central Cannon vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7'],
    [4, '中炮過河車對屏風馬', '中炮过河车对屏风马', 'Central Cannon, River-crossing Rook vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5 h0h6'],
    [3, '中炮過河車對屏風馬平炮兌車', '中炮过河车对屏风马平炮兑车', 'Central Cannon vs Screen Horses, Cannon Exchange', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5 h0h6 h7i7 h6g6 i7i8 b0c2 d9e8'],
    [2, '中炮進七兵對屏風馬', '中炮进七兵对屏风马', 'Central Cannon, Seventh Pawn vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5 b0c2'],
    [2, '中炮巡河車對屏風馬', '中炮巡河车对屏风马', 'Central Cannon, Patrolling Rook vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 h0h4 g6g5'],
    [3, '五七炮對屏風馬', '五七炮对屏风马', 'Five-Seven Cannons vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 g3g4 c6c5 b2c2 c7b5'],
    [2, '五六炮對屏風馬', '五六炮对屏风马', 'Five-Six Cannons vs Screen Horses', 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 b2d2 a9b9 b0c2'],
    [2, '中炮急進中兵', '中炮急进中兵', 'Central Cannon, Rushing Central Pawn', 'h2e2 h9g7 h0g2 i9h9 e3e4'],
    [3, '中炮對反宮馬', '中炮对反宫马', 'Central Cannon vs Reverse Palace Horses', 'h2e2 b9c7 h0g2 h7f7 i0h0 h9g7 c3c4'],
    [2, '中炮對三步虎', '中炮对三步虎', 'Central Cannon vs Three-step Tiger', 'h2e2 h9g7 h0g2 h7i7 i0h0 i9h9 b0c2'],
    [3, '順炮直車對橫車', '顺炮直车对横车', 'Same-direction Cannons', 'h2e2 h7e7 h0g2 h9g7 i0h0 i9i8 b0c2'],
    [2, '順炮直車對緩開車', '顺炮直车对缓开车', 'Same-direction Cannons, Slow Rook', 'h2e2 h7e7 h0g2 h9g7 i0h0 b9c7'],
    [2, '列炮', '列炮', 'Opposite-direction Cannons', 'h2e2 b7e7 h0g2 b9c7 i0h0 a9b9'],
    [3, '仙人指路', '仙人指路', 'Pawn Opening', 'c3c4'],
    [2, '仙人指路對卒底炮', '仙人指路对卒底炮', 'Pawn Opening vs Cannon behind Pawn', 'c3c4 b7c7 h2e2 g9e7 h0g2 h9g7'],
    [2, '對兵局', '对兵局', 'Opposing Pawns', 'c3c4 g6g5 b0c2 b9c7'],
    [2, '仙人指路對飛象', '仙人指路对飞象', 'Pawn Opening vs Elephant', 'c3c4 g9e7 h2e2 h9g7'],
    [1, '仙人指路對中炮', '仙人指路对中炮', 'Pawn Opening vs Central Cannon', 'c3c4 h7e7 b0c2 h9g7'],
    [1, '仙人指路對起馬', '仙人指路对起马', 'Pawn Opening vs Horse', 'c3c4 h9g7 b0c2 g6g5'],
    [2, '飛相局', '飞相局', 'Elephant Opening', 'g0e2'],
    [1, '飛相對中炮', '飞相对中炮', 'Elephant Opening vs Central Cannon', 'g0e2 h7e7 h0g2 h9g7'],
    [1, '飛相對進卒', '飞相对进卒', 'Elephant Opening vs Pawn', 'g0e2 c6c5 h0g2 b9c7'],
    [1, '飛相對起馬', '飞相对起马', 'Elephant Opening vs Horse', 'g0e2 h9g7 h0g2 i9h9'],
    [2, '起馬局', '起马局', 'Horse Opening', 'h0g2'],
    [1, '起馬對挺卒', '起马对挺卒', 'Horse Opening vs Pawn', 'h0g2 g6g5 g3g4 h9g7'],
    [1, '起馬對中炮', '起马对中炮', 'Horse Opening vs Central Cannon', 'h0g2 h7e7 i0h0 h9g7'],
    [1, '過宮炮', '过宫炮', 'Palace-crossing Cannon', 'h2d2 h9g7 h0g2 i9h9'],
    [1, '士角炮', '士角炮', 'Advisor-corner Cannon', 'h2f2 h9g7 h0g2 b7e7'],
    [1, '邊兵局', '边兵局', 'Edge Pawn Opening', 'i3i4 h9g7'],
    // 只用來命名的短變例（權重 0，不影響電腦選步）
    [0, '順炮', '顺炮', 'Same-direction Cannons', 'h2e2 h7e7'],
    [0, '列炮', '列炮', 'Opposite-direction Cannons', 'h2e2 b7e7'],
    [0, '仙人指路對卒底炮', '仙人指路对卒底炮', 'Pawn Opening vs Cannon behind Pawn', 'c3c4 b7c7'],
    [0, '對兵局', '对兵局', 'Opposing Pawns', 'c3c4 g6g5'],
    [0, '仙人指路對飛象', '仙人指路对飞象', 'Pawn Opening vs Elephant', 'c3c4 g9e7'],
    [0, '仙人指路對飛象', '仙人指路对飞象', 'Pawn Opening vs Elephant', 'c3c4 c9e7'],
    [0, '仙人指路對中炮', '仙人指路对中炮', 'Pawn Opening vs Central Cannon', 'c3c4 h7e7'],
    [0, '仙人指路對中炮', '仙人指路对中炮', 'Pawn Opening vs Central Cannon', 'c3c4 b7e7'],
    [0, '飛相對中炮', '飞相对中炮', 'Elephant Opening vs Central Cannon', 'g0e2 h7e7'],
    [0, '飛相對中炮', '飞相对中炮', 'Elephant Opening vs Central Cannon', 'g0e2 b7e7'],
    [0, '起馬對中炮', '起马对中炮', 'Horse Opening vs Central Cannon', 'h0g2 h7e7'],
    [0, '中炮對反宮馬', '中炮对反宫马', 'Central Cannon vs Reverse Palace Horses', 'h2e2 b9c7 h0g2 h7f7'],
    [0, '中炮對屏風馬', '中炮对屏风马', 'Central Cannon vs Screen Horses', 'h2e2 h9g7 h0g2 b9c7'],
    [0, '中炮對三步虎', '中炮对三步虎', 'Central Cannon vs Three-step Tiger', 'h2e2 h9g7 h0g2 h7i7'],
  ];
  let bookMap = null, nameMap = null;
  function buildBook() {
    bookMap = new Map(); nameMap = new Map();
    const pos = new Position();
    const bad = [];
    for (const line of BOOK_LINES) {
      const [w, tw, cn, en, moves] = line;
      for (const mirror of [false, true]) {
        pos.fromFen(START_FEN);
        const list = moves.split(' ');
        let ok = true;
        for (let i = 0; i < list.length; i++) {
          const mv = iccsToMove(mirror ? mirrorIccs(list[i]) : list[i]);
          if (!mv || !pos.isLegal(mv)) { ok = false; bad.push(moves + ' @' + i); break; }
          if (w > 0) {
            const k = pos.key + ':' + pos.lock;
            let arr = bookMap.get(k);
            if (!arr) bookMap.set(k, arr = []);
            const weight = mirror ? w * 0.3 : w;
            const e = arr.find(x => x.mv === mv);
            if (e) e.w += weight; else arr.push({ mv, w: weight });
          }
          pos.makeMove(mv);
        }
        if (ok) {
          const k2 = pos.key + ':' + pos.lock;
          if (!nameMap.has(k2)) nameMap.set(k2, [tw, cn, en]);
        }
      }
    }
    return bad;
  }
  function bookMoves(pos) {
    if (!bookMap) buildBook();
    const arr = bookMap.get(pos.key + ':' + pos.lock);
    if (!arr) return [];
    return arr.filter(e => pos.isLegal(e.mv));
  }
  function bookMove(pos) {
    const arr = bookMoves(pos);
    if (!arr.length) return 0;
    let total = 0;
    for (const e of arr) total += e.w;
    let r = Math.random() * total;
    for (const e of arr) { r -= e.w; if (r <= 0) return e.mv; }
    return arr[arr.length - 1].mv;
  }
  function openingName(pos) {
    if (!nameMap) buildBook();
    const v = nameMap.get(pos.key + ':' + pos.lock);
    return v ? { 'zh-TW': v[0], 'zh-CN': v[1], en: v[2] } : null;
  }

  // ------------------------------------------------------------------ Worker / 本地引擎訊息處理
  function makeHandler(post, hashBits) {
    const searcher = new Searcher(hashBits || 19);
    const setup = (fen, moves) => {
      const pos = new Position(fen || START_FEN);
      for (const s of (moves || [])) {
        const mv = iccsToMove(s);
        if (!mv || !pos.makeMove(mv)) break;
      }
      return pos;
    };
    return function handle(m) {
      try {
        if (m.type === 'search') {
          const pos = setup(m.fen, m.moves);
          if (m.book) {
            const bm = bookMove(pos);
            if (bm) { post({ type: 'result', id: m.id, move: moveToIccs(bm), score: 0, depth: 0, pv: [moveToIccs(bm)], book: true }); return; }
          }
          const res = searcher.search(pos, {
            time: m.time, depth: m.depth, noise: m.noise, analysis: m.analysis,
            onInfo: info => post({ type: 'info', id: m.id, depth: info.depth, score: info.score, pv: info.pv.map(moveToIccs), nodes: info.nodes, time: info.time }),
          });
          post({ type: 'result', id: m.id, move: res.move ? moveToIccs(res.move) : null, score: res.score, depth: res.depth, pv: res.pv.map(moveToIccs), nodes: res.nodes, time: res.time });
        } else if (m.type === 'analyzeGame') {
          const pos = new Position(m.fen || START_FEN);
          const moves = m.moves || [];
          for (let i = 0; i <= moves.length; i++) {
            let res;
            if (!pos.hasLegalMove()) res = { move: 0, score: pos.mateValue(), depth: 0, pv: [] };
            else res = searcher.search(pos, { time: m.time || 300, depth: m.depth });
            post({ type: 'gameProgress', id: m.id, index: i, total: moves.length, score: res.score, best: res.move ? moveToIccs(res.move) : null, pv: res.pv.slice(0, 6).map(moveToIccs) });
            if (i < moves.length) {
              const mv = iccsToMove(moves[i]);
              if (!mv || !pos.makeMove(mv)) break;
            }
          }
          post({ type: 'gameDone', id: m.id });
        } else if (m.type === 'clear') {
          searcher.clearHash();
        } else if (m.type === 'ping') {
          post({ type: 'pong', id: m.id });
        }
      } catch (err) {
        post({ type: 'error', id: m.id, message: String((err && err.message) || err) });
      }
    };
  }

  const api = {
    RED, BLACK, KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN,
    START_FEN, MATE_VALUE, WIN_VALUE, BAN_VALUE,
    FILE_OF, RANK_OF, NAMES,
    Position, Searcher,
    moveToIccs, iccsToMove, mirrorIccs, moveToChinese, moveToWxf, parseMove, normalizeNotation,
    charToPiece, pieceToChar, moveChases, insufficientMaterial, validateSetup, attackersOf, capturesFrom,
    bookMoves, bookMove, openingName, buildBook, makeHandler,
    src: s => s & 255, dst: s => s >> 8, move: (s, d) => s | (d << 8),
  };

  const isWorker = typeof importScripts === 'function' && typeof document === 'undefined' && global && typeof global.postMessage === 'function';
  if (isWorker) {
    const handle = makeHandler(msg => global.postMessage(msg), 20);
    global.onmessage = e => handle(e.data);
    global.postMessage({ type: 'ready' });
  }
  return api;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XQEngineModule({});
} else if (typeof importScripts === 'function' && typeof document === 'undefined') {
  XQEngineModule(self);
} else if (typeof window !== 'undefined') {
  window.XQEngineModule = XQEngineModule;
  window.XQ = XQEngineModule(window);
}
