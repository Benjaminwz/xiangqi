/* 象棋主程式：對局流程、電腦對手、介面、對話框、擺棋、覆盤分析、存檔與設定。 */
(function () {
  'use strict';
  const XQ = window.XQ, A = window.XQAudio, BoardView = window.XQBoardView, I18N = window.XQI18N, PUZZLES = window.XQPuzzles || [];
  const RED = XQ.RED, BLACK = XQ.BLACK;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  // ================================================================== 儲存
  const Store = {
    get(k, d) { try { const v = localStorage.getItem('xq.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('xq.' + k, JSON.stringify(v)); } catch (e) { /* 無法儲存 */ } },
    del(k) { try { localStorage.removeItem('xq.' + k); } catch (e) { /* ignore */ } },
  };

  // ================================================================== 設定
  const DEFAULTS = {
    lang: null, theme: 'auto', board: 'oak', pieces: 'wood', font: 'kai', notation: 'auto',
    coords: true, targets: true, last: true, anim: 'normal', evalBar: false, autoFlip: false, showArrow: true,
    sound: true, volume: 0.8, voice: 'key', bgm: false, bgmTrack: 0, bgmVolume: 0.35, vibrate: true,
    ruleCheck: true, ruleChase: true, moveLimit: 60, allowUndo: true,
    lastNew: {
      mode: 'pvc', side: 'red', level: 2, tc: 'none', handicap: 'none', redLevel: 3, blackLevel: 3,
      game: 'classic', armyFirst: 'xq', cxStrength: 'balanced', cvxSkills: false, deckA: 'hero', deckB: 'random', customA: [], customB: [],
    },
  };
  const S = Object.assign({}, DEFAULTS, Store.get('settings', {}));
  S.lastNew = Object.assign({}, DEFAULTS.lastNew, S.lastNew || {});
  if (!S.lang || !I18N[S.lang]) {
    const nl = (navigator.language || 'zh-TW').toLowerCase();
    S.lang = nl.startsWith('zh') ? (/cn|sg|hans/.test(nl) ? 'zh-CN' : 'zh-TW') : (nl.startsWith('en') ? 'en' : 'zh-TW');
  }
  const saveSettings = () => Store.set('settings', S);
  const ANIM_MS = { off: 0, fast: 130, normal: 220, slow: 380 };

  // ================================================================== 語言
  function t(key, params) {
    const d = I18N[S.lang] || I18N['zh-TW'];
    let s = d[key];
    if (s == null) s = I18N['zh-TW'][key];
    if (s == null) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
  }
  const sideName = s => t(s === RED ? 'side.red' : 'side.black');
  function applyI18n(root) {
    $$('[data-i18n]', root).forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-aria]', root).forEach(el => { const v = t(el.dataset.i18nAria); el.setAttribute('aria-label', v); el.title = v; });
    document.documentElement.lang = S.lang === 'en' ? 'en' : S.lang === 'zh-CN' ? 'zh-Hans' : 'zh-Hant';
    document.title = t('app.docTitle');
  }
  function notationOf(rec) {
    if (rec.vt) return rec.vt[S.lang] || rec.vt['zh-TW'];
    const n = S.notation === 'auto' ? (S.lang === 'en' ? 'wxf' : 'cn') : S.notation;
    if (n === 'iccs') return rec.iccs.slice(0, 2) + '-' + rec.iccs.slice(2);
    if (n === 'wxf') return rec.wxf;
    return S.lang === 'zh-CN' ? rec.cn : rec.tw;
  }

  // ================================================================== 引擎（Web Worker，無法使用時退回主執行緒）
  class EngineClient {
    constructor(hashBits, kind) { this.worker = null; this.local = null; this.mode = null; this.pending = new Map(); this.seq = 0; this.ready = null; this.hashBits = hashBits || 19; this.kind = kind || 'xq'; }
    ensure() {
      if (this.ready) return this.ready;
      this.ready = new Promise(resolve => {
        const tryWorker = (make, label, next) => {
          let w;
          try { w = make(); } catch (e) { next(); return; }
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; try { w.terminate(); } catch (e) { /* ignore */ } next(); } }, 5000);
          w.onmessage = e => {
            if (done || !e.data || e.data.type !== 'ready') return;
            done = true; clearTimeout(timer);
            this.worker = w; this.mode = label;
            w.onmessage = ev => this.onMsg(ev.data);
            w.onerror = () => {};
            resolve();
          };
          w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (!done) { done = true; clearTimeout(timer); try { w.terminate(); } catch (e) { /* ignore */ } next(); } };
        };
        const vx = this.kind === 'vx';
        const local = () => {
          this.local = (vx ? window.VX : XQ).makeHandler(msg => this.onMsg(msg), vx ? 17 : 18);
          this.mode = 'main';
          resolve();
          if (!EngineClient.warned) { EngineClient.warned = true; setTimeout(() => toast(t('toast.engineFallback')), 600); }
        };
        const blob = () => tryWorker(() => {
          const src = '(' + (vx ? window.VXEngineModule : window.XQEngineModule).toString() + ')(self);';
          return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        }, 'blob', local);
        if (location.protocol === 'file:') blob();
        else tryWorker(() => new Worker(vx ? 'js/variant.js' : 'js/engine.js'), 'file', blob);
      });
      return this.ready;
    }
    async request(msg, onInfo) {
      await this.ensure();
      const id = ++this.seq;
      msg.id = id;
      if (this.mode === 'main') {
        if (msg.time) msg.time = Math.min(msg.time, msg.type === 'analyzeGame' ? 250 : 1500);
        if (msg.analysis) msg.time = Math.min(msg.time || 1000, 1000);
      }
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onInfo });
        if (this.worker) this.worker.postMessage(msg);
        else setTimeout(() => { if (this.pending.has(id)) this.local(msg); }, 30);
      });
    }
    onMsg(m) {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'info' || m.type === 'gameProgress') { if (p.onInfo) p.onInfo(m); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    }
    cancel() {
      for (const p of this.pending.values()) p.reject({ cancelled: true });
      this.pending.clear();
      if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } this.worker = null; this.ready = null; this.mode = null; }
    }
    get busy() { return this.pending.size > 0; }
  }
  const ai = new EngineClient(), analyzer = new EngineClient(), vai = new EngineClient(18, 'vx');

  // ================================================================== 常數
  const LEVELS = [
    { key: 'novice', time: 250, depth: 1, noise: 150, book: false, elo: 600 },
    { key: 'beginner', time: 450, depth: 2, noise: 60, book: true, elo: 900 },
    { key: 'intermediate', time: 800, depth: 4, noise: 16, book: true, elo: 1200 },
    { key: 'advanced', time: 1500, depth: 0, noise: 0, book: true, elo: 1500 },
    { key: 'master', time: 3500, depth: 0, noise: 0, book: true, elo: 1800 },
    { key: 'grandmaster', time: 8000, depth: 0, noise: 0, book: true, elo: 2100 },
  ];
  const TCS = [
    { key: 'none', base: 0, inc: 0 }, { key: '3+2', base: 180e3, inc: 2e3 }, { key: '5', base: 300e3, inc: 0 },
    { key: '10', base: 600e3, inc: 0 }, { key: '15+10', base: 900e3, inc: 10e3 }, { key: '30', base: 1800e3, inc: 0 },
  ];
  // 讓子：以讓子方自己的視角，左馬/左車
  const HANDICAPS = { none: [], knight: ['N'], twoKnights: ['N', 'N2'], rook: ['R'], rookKnight: ['R', 'N'] };
  const HC_SQ = { // [紅方, 黑方]
    N: [1, 88], N2: [7, 82], R: [0, 89],
  };
  const PIECE_VALUE = [0, 0, 2, 2, 4, 9, 4.5, 1];
  const START_COUNT = [0, 1, 2, 2, 2, 2, 2, 5];

  // ================================================================== 中西大戰、魔幻技能（變體引擎 VX）
  const VXE = window.VX;
  const isVar = g => !!(g && g.variant);
  const SKILL_KEYS = VXE ? VXE.SKILLS.filter(Boolean).map(s => s.key) : [];
  const DECK_PRESETS = VXE ? VXE.PRESETS : {};
  const DECK_KEYS = ['tactician', 'schemer', 'hero', 'blaze'];
  const mvFrom = mv => (isVar(game) ? mv & 127 : mv & 255);
  const mvTo = mv => (isVar(game) ? (mv >> 7) & 127 : mv >> 8);
  const pcSide = pc => (pc >> 3) & 1;
  const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'], FW_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
  const VAL_XQ = [0, 0, 2, 2, 4, 9, 4.5, 1], VAL_CH = [0, 0, 13, 5, 4.5, 9, 0, 1.2];
  const RIVER_CVX = ['中', '土', '泰', '西'];
  let skillState = null;
  // 指定語言取字（記譜要同時存三種語言）
  function tl(lang, key, params) {
    const d = I18N[lang] || I18N['zh-TW'];
    let s = d[key];
    if (s == null) s = I18N['zh-TW'][key];
    if (s == null) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
  }
  function resolveDeck(choice, custom, army) {
    const okKey = k => !(k === 'snipe' && army === 'chess');
    if (choice === 'custom' && Array.isArray(custom) && custom.length === 4) return custom.filter(okKey).slice(0, 4);
    if (DECK_PRESETS[choice]) return DECK_PRESETS[choice].filter(okKey).concat(army === 'chess' && choice === 'blaze' ? ['thunder'] : []).slice(0, 4);
    const pool = SKILL_KEYS.filter(okKey), out = [];
    while (out.length < 4 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }
  function makeVariantConf(o, humanSide) {
    const kind = o.game === 'cvx' ? 'cvx' : 'skill';
    const armies = kind === 'cvx' ? (o.armyFirst === 'chess' ? ['chess', 'xq'] : ['xq', 'chess']) : ['xq', 'xq'];
    const skills = kind === 'skill' || !!o.cvxSkills;
    const decks = [[], []];
    if (skills) {
      const sideA = o.mode === 'pvc' ? humanSide : RED;
      decks[sideA] = resolveDeck(o.deckA, o.customA, armies[sideA]);
      decks[sideA ^ 1] = resolveDeck(o.deckB, o.customB, armies[sideA ^ 1]);
    }
    return VXE.normConf({ armies, skills, decks, queen: kind === 'cvx' && o.cxStrength === 'full', kind });
  }
  function variantTitle(v) {
    if (!v) return '';
    return t(v.kind === 'cvx' ? (v.skills ? 'vmode.cvxSkill' : 'vmode.cvx') : 'vmode.skill');
  }
  function vPieceLabel(pos, sq, lang) {
    const pc = pos.board[sq];
    if (!pc || pc >= 32) return VXE.sqName(sq);
    const chars = window.XQPieceChars[lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
    if (lang === 'en') return ((pc & 16) ? 'KQBNR P' : 'KAEHRCP')[(pc & 7) - 1] + VXE.sqName(sq);
    if (pc & 16) return chars[pc] + VXE.sqName(sq);
    const f = sq % 9;
    return chars[pc] + (pcSide(pc) === RED ? CN_NUM[9 - f] : FW_NUM[f + 1]);
  }
  function vText(pos, mv, lang) {
    const sk = (mv >> 17) & 31, a = mv & 127, b = (mv >> 7) & 127, promo = (mv >> 14) & 7;
    const chars = window.XQPieceChars[lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
    if (!sk) {
      const pc = pos.board[a], cap = pos.board[b];
      if (!(pc & 16)) {
        const base = lang === 'en' ? XQ.moveToWxf({ board: pos.board }, a | (b << 8)) : XQ.moveToChinese({ board: pos.board }, a | (b << 8), lang === 'zh-CN' ? 'zh-CN' : 'zh-TW');
        return promo ? base + '=' + (lang === 'en' ? 'KAEHRCP'[promo - 1] : chars[(pc & 8) | promo]) : base;
      }
      const name = lang === 'en' ? 'KQBNR P'[(pc & 7) - 1] : chars[pc];
      let s = name + VXE.sqName(a) + (cap ? '×' : '-') + VXE.sqName(b);
      if (promo) s += '=' + (lang === 'en' ? 'KQBNR P'[promo - 1] : chars[(pc & 24) | promo]);
      return s;
    }
    const key = VXE.SKILLS[sk].key, nm = tl(lang, 'sk.' + key + '.name');
    const head = lang === 'en' ? nm + ':' : '【' + nm + '】';
    const L = q => vPieceLabel(pos, q, lang);
    switch (key) {
      case 'swap': return head + L(a) + '⇄' + L(b);
      case 'knife': case 'snipe': return head + L(a) + '×' + L(b);
      case 'portal': return head + L(a) + '→' + VXE.sqName(b);
      case 'cicada': return head + L(a) + '→' + VXE.sqName(b);
      case 'stones': return head + VXE.sqName(b);
      case 'spy': case 'fire': case 'thunder': case 'shield': case 'freeze': case 'rage': return head + L(b);
      case 'phoenix': { const pc = pos.init[b]; return head + (lang === 'en' ? (((pc & 16) ? 'KQBNR P' : 'KAEHRCP')[(pc & 7) - 1]) : chars[pc]) + VXE.sqName(b); }
      default: return lang === 'en' ? nm : head;
    }
  }
  function vRecord(pos, mv) {
    const sk = (mv >> 17) & 31, a = mv & 127, b = (mv >> 7) & 127;
    return {
      mv, iccs: VXE.moveToStr(mv), side: pos.side, skill: sk, piece: sk ? 0 : pos.board[a], cap: sk ? 0 : (pos.board[b] && pos.board[b] < 32 ? pos.board[b] : 0),
      vt: { 'zh-TW': vText(pos, mv, 'zh-TW'), 'zh-CN': vText(pos, mv, 'zh-CN'), en: vText(pos, mv, 'en') },
    };
  }

  // ================================================================== 狀態
  let game = null, board = null, selected = -1, hintArrow = null, autoplayTimer = 0, clockTimer = 0;
  let editState = null, reviewData = null, anInfo = null, anTimer = 0, anToken = 0, analysisOn = false;
  let stats = Object.assign({ rating: 1200, games: 0, levels: {}, streak: 0, bestStreak: 0, puzzles: {}, hints: 0, undos: 0 }, Store.get('stats', {}));
  let lastInfo = null, posCache = null, sampleApi = null, downloadsApi = null, deferredInstall = null;
  const ui = {};

  // ================================================================== 對局核心
  function playersFor(o) {
    const human = { type: 'human' };
    if (o.mode === 'pvc') {
      const aiP = { type: 'ai', level: o.level };
      return o.humanSide === RED ? [human, aiP] : [aiP, human];
    }
    if (o.mode === 'cvc') return [{ type: 'ai', level: o.redLevel }, { type: 'ai', level: o.blackLevel }];
    if (o.mode === 'puzzle') return [human, { type: 'ai', level: 4, puzzle: true }];
    return [{ type: 'human' }, { type: 'human' }];
  }
  function handicapFen(key, side) {
    const list = HANDICAPS[key] || [];
    if (!list.length) return XQ.START_FEN;
    const p = new XQ.Position(XQ.START_FEN);
    for (const k of list) { const sq = HC_SQ[k][side]; const pc = p.board[sq]; if (pc) p.delPiece(sq, pc); }
    return p.toFen();
  }
  function createGame(o) {
    const variant = o.variant && VXE ? VXE.normConf(o.variant) : null;
    const startFen = variant ? null : (o.fen || XQ.START_FEN);
    const pos = variant ? new VXE.Position(variant) : new XQ.Position(startFen);
    const g = {
      id: o.id || uid(), created: o.created || Date.now(), mode: o.mode, startFen, pos, variant,
      moves: [], boards: [variant ? pos.viewBoard() : Int8Array.from(pos.board)], fx: [variant ? pos.effects() : null], keys: [pos.key + ':' + pos.lock], sides: [pos.side],
      viewPly: 0, result: null, players: o.players || playersFor(o), humanSide: o.humanSide == null ? RED : o.humanSide,
      tc: o.tc || 'none', handicap: o.handicap || 'none', clock: null, undos: o.undos || 0, hints: o.hints || 0,
      opening: null, puzzle: o.puzzle || null, daily: o.daily || null, headers: o.headers || {}, thinking: -1, saved: false,
    };
    const tc = TCS.find(x => x.key === g.tc);
    if (tc && tc.base) g.clock = { base: tc.base, inc: tc.inc, remain: [tc.base, tc.base], running: -1, stamp: 0, warned: [false, false] };
    return g;
  }
  function applyMove(mv) {
    const g = game, pos = g.pos;
    if (isVar(g)) {
      if (pos.legalMoves(true).indexOf(mv) < 0) return null;
      const before = pos.viewBoard();
      const rec = vRecord(pos, mv);
      rec.clockBefore = g.clock ? g.clock.remain.slice() : null;
      pos.makeMove(mv);
      pos.hist.length = 0;
      rec.check = pos.inCheck();
      const after = pos.viewBoard();
      if (rec.skill) {
        rec.removed = [];
        for (let q = 0; q < 90; q++) if (before[q] && !after[q] && pcSide(before[q]) !== rec.side) rec.removed.push(q);
        if (rec.removed.length) rec.cap = before[rec.removed[0]];
        rec.moved = [];
        for (let q = 0; q < 90; q++) if (!before[q] && after[q] && pcSide(after[q]) === rec.side) rec.moved.push(q);
      }
      g.moves.push(rec);
      g.boards.push(after);
      g.fx.push(pos.effects());
      g.keys.push(pos.key + ':' + pos.lock);
      g.sides.push(pos.side);
      posCache = null;
      return rec;
    }
    if (!pos.isLegal(mv)) return null;
    const side = pos.side, piece = pos.board[mv & 255], cap = pos.board[mv >> 8];
    let chase = false;
    if (S.ruleChase && !cap) { try { chase = XQ.moveChases(pos, mv); } catch (e) { chase = false; } }
    const rec = {
      mv, iccs: XQ.moveToIccs(mv), side, piece, cap, chase,
      tw: XQ.moveToChinese(pos, mv, 'zh-TW'), cn: XQ.moveToChinese(pos, mv, 'zh-CN'), wxf: XQ.moveToWxf(pos, mv),
      clockBefore: g.clock ? g.clock.remain.slice() : null,
    };
    pos.makeMove(mv);
    rec.check = pos.inCheck();
    g.moves.push(rec);
    g.boards.push(Int8Array.from(pos.board));
    g.keys.push(pos.key + ':' + pos.lock);
    g.sides.push(pos.side);
    if (g.startFen === XQ.START_FEN && g.moves.length <= 30) { const nm = XQ.openingName(pos); if (nm) g.opening = nm; }
    posCache = null;
    return rec;
  }
  function truncateTo(n) {
    const g = game;
    n = clamp(n, 0, g.moves.length);
    const keep = g.moves.slice(0, n), removed = g.moves[n];
    g.pos = isVar(g) ? new VXE.Position(g.variant) : new XQ.Position(g.startFen);
    g.moves = []; g.boards = [isVar(g) ? g.pos.viewBoard() : Int8Array.from(g.pos.board)]; g.fx = [isVar(g) ? g.pos.effects() : null]; g.keys = [g.pos.key + ':' + g.pos.lock]; g.sides = [g.pos.side]; g.opening = null;
    for (const m of keep) applyMove(m.mv);
    if (g.clock && removed && removed.clockBefore) g.clock.remain = removed.clockBefore.slice();
    g.viewPly = g.moves.length;
    posCache = null;
  }
  function positionAt(ply) {
    const g = game;
    if (ply === g.moves.length) return g.pos;
    if (posCache && posCache.id === g.id && posCache.ply === ply && posCache.len === g.moves.length) return posCache.pos;
    const p = isVar(g) ? new VXE.Position(g.variant) : new XQ.Position(g.startFen);
    for (let i = 0; i < ply; i++) { p.makeMove(g.moves[i].mv); if (isVar(g)) p.hist.length = 0; }
    posCache = { id: g.id, ply, len: g.moves.length, pos: p };
    return p;
  }
  const atLive = () => game && game.viewPly === game.moves.length;
  const isStudy = () => game && (game.mode === 'analysis' || game.mode === 'review');

  function startGame(o) {
    stopEverything();
    exitEditor(true);
    reviewData = null; hintArrow = null; anInfo = null; skillState = null;
    if (o.mode === 'pvc' && o.handicap && o.handicap !== 'none' && !o.fen && !o.variant) o.fen = handicapFen(o.handicap, o.humanSide === RED ? BLACK : RED);
    game = createGame(o);
    const cvx = !!(game.variant && game.variant.kind === 'cvx');
    board.setOptions({ coordStyle: cvx ? 'iccs' : 'xq', riverText: cvx ? RIVER_CVX : null });
    board.setEffects(null);
    if (o.moves) for (const ic of o.moves) { const mv = isVar(game) ? VXE.strToMove(game.pos, ic) : XQ.iccsToMove(ic); if (!mv || !applyMove(mv)) break; }
    if (o.result) game.result = o.result;
    if (o.clockRemain && game.clock) game.clock.remain = o.clockRemain.slice();
    game.viewPly = o.viewPly != null ? clamp(o.viewPly, 0, game.moves.length) : game.moves.length;
    let flip = false;
    if (game.mode === 'pvc' || game.mode === 'puzzle') flip = game.humanSide === BLACK;
    if (o.flip != null) flip = o.flip;
    board.setFlipped(flip);
    selected = -1;
    renderAll();
    if (!o.silent) A.play('start');
    if (game.clock && !game.result && atLive()) startClock();
    if (!game.result) scheduleTurn();
    maybeAnalyze();
    persist();
  }
  function stopEverything() {
    if (game) game.thinkToken = null;
    ai.cancel();
    vai.cancel();
    stopAutoplay();
    stopClockLoop();
    if (game) game.thinking = -1;
  }

  // 走一步（玩家、電腦都走這裡）
  function playMove(mv, source, opts) {
    const g = game;
    opts = opts || {};
    if (!g || g.result) return false;
    if (!atLive()) {
      if (isStudy()) truncateTo(g.viewPly);
      else { g.viewPly = g.moves.length; }
    }
    if (g.clock && g.clock.running === g.pos.side) { tickClock(); if (g.result) return false; g.clock.remain[g.pos.side] += g.clock.inc; }
    const rec = applyMove(mv);
    if (!rec) { A.play('illegal'); return false; }
    if (source === 'human' && (g.mode === 'pvc' || g.mode === 'pvp')) achOnMove(g, rec);
    if (g.mode === 'review') g.mode = 'analysis';
    g.viewPly = g.moves.length;
    selected = -1; hintArrow = null; skillState = null;
    adjudicate();
    if (!g.result && g.mode === 'puzzle') puzzleStep(rec);
    const checkSq = rec.check ? g.pos.kingSq[g.pos.side] : -1;
    if (isVar(g)) {
      const n = g.moves.length, a = mv & 127, b = (mv >> 7) & 127;
      const drawOpts = { lastMove: rec.skill ? 0 : a | (b << 8), checkSq };
      board.setEffects(g.fx[n]);
      if (rec.skill) { board.setPosition(g.boards[n], drawOpts); skillFx(rec, g.boards[n - 1]); }
      else if (opts.dropped) board.setPosition(g.boards[n], drawOpts);
      else board.animate(a | (b << 8), g.boards[n], rec.cap, drawOpts, null);
      if (!rec.skill && ((mv >> 14) & 7)) { board.fx('promote', { to: b }); setTimeout(() => A.play('promote'), 120); }
    } else {
      const drawOpts = { lastMove: mv, checkSq };
      if (opts.dropped) board.setPosition(g.pos.board, drawOpts);
      else board.animate(mv, g.pos.board, rec.cap, drawOpts, null);
    }
    moveFeedback(rec);
    if (g.clock) { if (g.result) stopClock(); else switchClock(); }
    if (S.autoFlip && g.mode === 'pvp' && !g.result) setTimeout(() => board.setFlipped(g.pos.side === BLACK), Math.max(250, board.animMs + 120));
    renderAll({ skipBoard: true });
    persist();
    if (g.result) onGameOver();
    else scheduleTurn();
    maybeAnalyze();
    return true;
  }
  // 技能特效、音效、橫幅
  function skillFx(rec, before) {
    const g = game, mv = rec.mv, a = mv & 127, b = (mv >> 7) & 127, key = VXE.SKILLS[rec.skill].key;
    const side = rec.side, pal = [];
    for (let q = 0; q < 90; q++) if (VXE.inPalace(q, side)) pal.push(q);
    const o = { from: a === 127 ? -1 : a, to: b === 127 ? -1 : b, side };
    if (key === 'fire') o.sqs = rec.removed || [b];
    else if (key === 'boats') o.sqs = rec.moved || [];
    else if (key === 'fort') o.sqs = pal;
    else if (key === 'chain') o.sqs = [g.pos.kingSq[side]].filter(x => x >= 0);
    board.fx(key, o);
    A.play('sk-' + key);
    if (S.vibrate) A.vibrate([18, 40, 18]);
    const name = t('sk.' + key + '.name');
    skillBanner(name, side);
    const human = g.players[side].type === 'human' && g.mode === 'pvc';
    toast(human ? t('sk.castYou', { name }) : t('sk.cast', { side: sideName(side), name }), human ? 'good' : null);
    if (S.voice !== 'off') A.speak(name);
  }
  function moveFeedback(rec) {
    const g = game;
    const mate = g.result && (g.result.reason === 'mate' || g.result.reason === 'stalemate');
    if (rec.skill) {
      if (rec.check && !mate) { setTimeout(() => A.play('check'), 380); setTimeout(() => banner(t('banner.check'), 'red'), 900); }
      return;
    }
    A.play(rec.cap ? 'capture' : 'move');
    if (S.vibrate) A.vibrate(rec.cap ? 28 : 14);
    if (rec.check && !mate) { setTimeout(() => A.play('check'), 90); banner(t('banner.check'), 'red'); }
    const text = notationOf(rec);
    if (S.voice === 'all') A.speak(rec.vt ? text : S.lang === 'en' ? text : (S.lang === 'zh-CN' ? rec.cn : rec.tw) + (rec.check && !mate ? '，' + t('voice.check') : ''));
    else if (S.voice === 'key' && !mate) {
      if (rec.check) A.speak(t('voice.check'));
      else if (rec.cap) A.speak(t('voice.capture'));
    }
  }

  // ================================================================== 勝負判定
  function setResult(winner, reason, extra) {
    game.result = Object.assign({ winner, reason }, extra || {});
  }
  function adjudicate() {
    const g = game, pos = g.pos;
    if (!pos.hasLegalMove()) { setResult(pos.side ^ 1, pos.inCheck() ? 'mate' : 'stalemate', { loser: pos.side }); return; }
    if (!isVar(g) && XQ.insufficientMaterial(pos)) { setResult(null, 'material'); return; }
    const n = g.moves.length, cur = g.keys[n];
    let first = -1, count = 0;
    for (let i = n; i >= 0; i--) {
      if (g.keys[i] === cur) { count++; first = i; }
      if (i > 0 && g.moves[i - 1].cap) break;
    }
    if (count >= 3) {
      const cyc = g.moves.slice(first, n);
      const by = [[], []];
      cyc.forEach(m => by[m.side].push(m));
      const chk = by.map(a => a.length > 0 && a.every(m => m.check));
      const cc = by.map(a => a.length > 0 && a.every(m => m.check || m.chase));
      if (S.ruleCheck && chk[0] !== chk[1]) { const loser = chk[0] ? RED : BLACK; setResult(loser ^ 1, 'perpCheck', { loser }); return; }
      if (S.ruleChase && cc[0] !== cc[1]) { const loser = cc[0] ? RED : BLACK; setResult(loser ^ 1, 'perpChase', { loser }); return; }
      setResult(null, 'repetition'); return;
    }
    if (S.moveLimit) {
      let k = 0;
      for (let i = n - 1; i >= 0 && !g.moves[i].cap; i--) k++;
      if (k >= S.moveLimit * 2) setResult(null, 'moveLimit', { n: S.moveLimit });
    }
  }
  function resultWord(r) {
    const g = game;
    if (r.reason === 'puzzleFail') return t('result.puzzleFail');
    if (r.winner == null) return t('result.draw');
    if (g.mode === 'pvc' || g.mode === 'puzzle') return r.winner === g.humanSide ? t('result.youWin') : t('result.youLose');
    return r.winner === RED ? t('result.redWin') : t('result.blackWin');
  }
  function resultReason(r) {
    const loser = r.loser != null ? r.loser : (r.winner != null ? r.winner ^ 1 : null);
    return t('reason.' + r.reason, { side: loser != null ? sideName(loser) : '', n: r.n || S.moveLimit });
  }
  function onGameOver() {
    const g = game, r = g.result;
    stopClock();
    g.thinking = -1;
    const humanSide = (g.mode === 'pvc' || g.mode === 'puzzle') ? g.humanSide : null;
    let word, tone;
    if (r.reason === 'mate') { word = t('banner.mate'); tone = 'red'; }
    else if (r.reason === 'stalemate') { word = t('banner.stalemate'); tone = 'red'; }
    else if (r.winner == null) { word = t('banner.draw'); tone = 'dark'; }
    else { word = r.winner === RED ? t('banner.redWin') : t('banner.blackWin'); tone = r.winner === RED ? 'red' : 'dark'; }
    if (g.mode === 'puzzle') {
      if (r.winner === RED) { word = t('banner.solved'); tone = 'jade'; }
      else { word = t('banner.failed'); tone = 'dark'; }
    }
    setTimeout(() => banner(word, tone), 120);
    setTimeout(() => {
      if (g.mode === 'puzzle') A.play(r.winner === RED ? 'solved' : 'lose');
      else if (r.winner == null) A.play('draw');
      else if (humanSide != null) A.play(r.winner === humanSide ? 'win' : 'lose');
      else A.play('win');
    }, 350);
    if (S.voice !== 'off') {
      if (r.reason === 'mate') A.speak(t('voice.mate'));
      else A.speak(resultWord(r));
    }
    let ratingChange = null;
    if (g.mode === 'pvc' && !g.statsDone) { ratingChange = isVar(g) ? recordVariantStats(g) : recordStats(g); g.statsDone = true; }
    if (!g.achDone && (g.mode === 'pvc' || g.mode === 'pvp')) { g.achDone = true; achOnGameOver(g); }
    if (g.mode === 'puzzle' && r.winner === RED && g.puzzle && !g.demoSolution) {
      stats.puzzles[g.puzzle.id] = true; Store.set('stats', stats);
      const solved = Object.keys(stats.puzzles).filter(k => stats.puzzles[k]).length;
      if (solved >= 10) unlock('pz10');
      if (solved >= PUZZLES.length) unlock('pzAll');
      if (g.daily) recordDaily(g.daily);
    }
    if (g.mode !== 'puzzle' && g.moves.length) saveToLibrary(g, true);
    persist();
    setTimeout(() => { if (game === g) showResultDialog(ratingChange); }, 1500);
  }
  // ================================================================== 成就、每日一題
  const ACH_LIST = [
    ['firstWin', 'classic'], ['beatAdvanced', 'classic'], ['beatMaster', 'classic'], ['beatGM', 'classic'], ['streak3', 'classic'], ['cleanWin', 'classic'],
    ['fastMate', 'classic'], ['rating1500', 'classic'], ['rating1800', 'classic'], ['games10', 'classic'], ['games50', 'classic'], ['pvp', 'classic'], ['review', 'classic'],
    ['pz10', 'puzzle'], ['pzAll', 'puzzle'], ['daily3', 'puzzle'], ['daily7', 'puzzle'],
    ['cvxXq', 'variant'], ['cvxChess', 'variant'], ['cvxFull', 'variant'], ['promote', 'variant'], ['skillFirst', 'variant'], ['skillAll', 'variant'], ['skillMate', 'variant'], ['chainDouble', 'variant'],
  ];
  const achCount = () => ACH_LIST.filter(([id]) => stats.ach && stats.ach[id]).length;
  function unlock(id) {
    if (!stats.ach) stats.ach = {};
    if (stats.ach[id]) return;
    stats.ach[id] = Date.now();
    Store.set('stats', stats);
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'toast ach';
      el.innerHTML = '<svg class="sk-ic" aria-hidden="true"><use href="#sk-trophy"/></svg><span>' + esc(t('ach.unlocked', { name: t('ach.' + id) })) + '</span>';
      ui.toastRoot.appendChild(el);
      while (ui.toastRoot.children.length > 3) ui.toastRoot.firstChild.remove();
      setTimeout(() => el.remove(), 3800);
      A.play('achieve');
    }, 1100);
  }
  function achOnGameOver(g) {
    const r = g.result;
    if (!r) return;
    if (g.mode === 'pvp' && g.moves.length >= 10) unlock('pvp');
    if (g.mode !== 'pvc') return;
    stats.played = (stats.played || 0) + 1;
    Store.set('stats', stats);
    if (stats.played >= 10) unlock('games10');
    if (stats.played >= 50) unlock('games50');
    if (r.winner !== g.humanSide) return;
    const lv = g.players[g.humanSide ^ 1].level;
    unlock('firstWin');
    if (lv >= 3) unlock('beatAdvanced');
    if (lv >= 4) unlock('beatMaster');
    if (lv >= 5) unlock('beatGM');
    if (lv >= 2 && !g.undos && !g.hints) unlock('cleanWin');
    if (r.reason === 'mate' && g.moves.filter(m => m.side === g.humanSide).length <= 30) unlock('fastMate');
    if (!isVar(g)) {
      if (stats.streak >= 3) unlock('streak3');
      if (stats.rating >= 1500) unlock('rating1500');
      if (stats.rating >= 1800) unlock('rating1800');
      return;
    }
    const army = g.variant.armies[g.humanSide];
    if (g.variant.kind === 'cvx') { unlock(army === 'chess' ? 'cvxChess' : 'cvxXq'); if (army === 'xq' && g.variant.queen) unlock('cvxFull'); }
    const last = g.moves[g.moves.length - 1];
    if (r.reason === 'mate' && last && last.skill && last.side === g.humanSide) unlock('skillMate');
  }
  function achOnMove(g, rec) {
    if (!isVar(g)) return;
    if (rec.skill) {
      const used = stats.skillsUsed || (stats.skillsUsed = {});
      const key = VXE.SKILLS[rec.skill].key;
      used[key] = (used[key] || 0) + 1;
      Store.set('stats', stats);
      unlock('skillFirst');
      if (SKILL_KEYS.every(k => used[k])) unlock('skillAll');
      return;
    }
    if ((rec.mv >> 14) & 7) unlock('promote');
    if (rec.cap) {
      // 連環計：從發動那一手起，同一回合吃了兩顆子
      let i = g.moves.length - 1, caps = 0;
      while (i >= 0 && g.moves[i].side === rec.side && !g.moves[i].skill) { if (g.moves[i].cap) caps++; i--; }
      if (caps >= 2 && i >= 0 && g.moves[i].side === rec.side && VXE.SKILLS[g.moves[i].skill] && VXE.SKILLS[g.moves[i].skill].key === 'chain') unlock('chainDouble');
    }
  }
  const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const todayKey = () => dayKey(new Date());
  const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); };
  function dailyPuzzle(key) {
    let h = 2166136261;
    for (const c of (key || todayKey())) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return PUZZLES[h % PUZZLES.length];
  }
  function dailyStreak() {
    const D = stats.daily || {};
    return D.last === todayKey() || D.last === yesterdayKey() ? (D.streak || 0) : 0;
  }
  function recordDaily(key) {
    const D = stats.daily || (stats.daily = { last: null, streak: 0, best: 0, total: 0 });
    if (D.last === key) return;
    const y = new Date(key + 'T12:00:00'); y.setDate(y.getDate() - 1);
    D.streak = D.last === dayKey(y) ? D.streak + 1 : 1;
    D.best = Math.max(D.best || 0, D.streak); D.total = (D.total || 0) + 1; D.last = key;
    Store.set('stats', stats);
    setTimeout(() => toast(t('daily.done', { s: D.streak }), 'good'), 1800);
    if (D.streak >= 3) unlock('daily3');
    if (D.streak >= 7) unlock('daily7');
  }
  function startDaily() {
    const key = todayKey(), p = dailyPuzzle(key);
    if ((stats.daily || {}).last === key) setTimeout(() => toast(t('daily.again')), 400);
    startPuzzle(p, { daily: key });
  }
  function achievementsDialog() {
    const got = stats.ach || {};
    const n = achCount();
    const fmtDate = ts => new Date(ts).toLocaleDateString(S.lang === 'en' ? 'en' : S.lang);
    const html = '<p class="field-hint" style="margin-top:0">' + esc(t('ach.progress', { a: n, b: ACH_LIST.length })) + '</p><div class="progress"><i style="width:' + Math.round(n / ACH_LIST.length * 100) + '%"></i></div>' +
      [['classic', 'ach.g.classic'], ['puzzle', 'ach.g.puzzle'], ['variant', 'ach.g.variant']].map(([grp, label]) => '<h3 class="sk-group">' + esc(t(label)) + '</h3><div class="sk-grid">' +
        ACH_LIST.filter(a => a[1] === grp).map(([id]) => {
          const at = got[id];
          return '<div class="sk-entry ach-entry' + (at ? ' on' : '') + '"><svg class="sk-ic big" aria-hidden="true"><use href="#' + (at ? 'sk-trophy' : 'sk-medal') + '"/></svg><span class="sk-body"><b>' + esc(t('ach.' + id)) + '</b><span class="sk-desc">' + esc(t('ach.' + id + '.d')) + '</span><small class="sk-meta">' + esc(at ? t('ach.when', { date: fmtDate(at) }) : t('ach.locked')) + '</small></span></div>';
        }).join('') + '</div>').join('');
    openModal({ title: t('ach.title'), body: html, wide: true });
  }

  function recordVariantStats(g) {
    const r = g.result, key = g.variant.kind;
    const V = stats.variants || (stats.variants = {});
    const L = V[key] || (V[key] = { w: 0, d: 0, l: 0 });
    if (r.winner == null) L.d++; else if (r.winner === g.humanSide) L.w++; else L.l++;
    Store.set('stats', stats);
    return null;
  }
  function recordStats(g) {
    const r = g.result, aiSide = g.humanSide ^ 1, lv = LEVELS[g.players[aiSide].level];
    const key = lv.key;
    const L = stats.levels[key] || (stats.levels[key] = { w: 0, d: 0, l: 0 });
    let score;
    if (r.winner == null) { L.d++; score = 0.5; stats.streak = 0; }
    else if (r.winner === g.humanSide) { L.w++; score = 1; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); }
    else { L.l++; score = 0; stats.streak = 0; }
    stats.games++;
    stats.hints += g.hints; stats.undos += g.undos;
    const before = stats.rating;
    const exp = 1 / (1 + Math.pow(10, (lv.elo - before) / 400));
    const k = g.moves.length < 10 ? 16 : 32;
    stats.rating = Math.round(before + k * (score - exp) * (g.hints || g.undos ? 0.5 : 1));
    Store.set('stats', stats);
    return { before, after: stats.rating };
  }

  // ================================================================== 輪到誰
  let turnTimer = 0;
  function scheduleTurn() {
    clearTimeout(turnTimer);
    const g = game;
    if (!g || g.result || editState) return;
    const p = g.players[g.pos.side];
    renderStatus();
    if (p.type === 'ai' && atLive()) turnTimer = setTimeout(requestAiMove, g.mode === 'cvc' ? 400 : 150);
  }
  async function requestAiMove() {
    const g = game;
    if (!g || g.result || !atLive()) return;
    const side = g.pos.side, p = g.players[side];
    if (p.type !== 'ai') return;
    const lv = LEVELS[p.level] || LEVELS[2];
    let time = lv.time;
    if (g.clock) time = Math.min(time, Math.max(200, g.clock.remain[side] / 28 + g.clock.inc * 0.7));
    const token = g.thinkToken = uid();
    g.thinking = side;
    lastInfo = null;
    renderCards(); renderStatus(); renderToolbar();
    const t0 = performance.now();
    try {
      const v = isVar(g);
      const msg = v ? { type: 'search', conf: g.variant, moves: g.moves.map(m => m.iccs), time, depth: lv.depth || 0, noise: lv.noise * 3 }
        : { type: 'search', fen: g.startFen, moves: g.moves.map(m => m.iccs), time, depth: lv.depth || 0, noise: lv.noise, book: lv.book && g.startFen === XQ.START_FEN && g.moves.length < 16 };
      if (p.puzzle) { msg.time = 900; msg.noise = 0; msg.book = false; }
      const res = await (v ? vai : ai).request(msg, info => { lastInfo = info; });
      if (game !== g || g.thinkToken !== token || g.result) return;
      const wait = Math.max(0, (g.mode === 'cvc' ? 450 : 260) - (performance.now() - t0));
      setTimeout(() => {
        if (game !== g || g.thinkToken !== token || g.result) return;
        g.thinking = -1;
        g.aiEval = { side, score: res.score, depth: res.depth, ply: g.moves.length };
        const mv = res.move ? (isVar(g) ? VXE.strToMove(g.pos, res.move) : XQ.iccsToMove(res.move)) : 0;
        if (mv) playMove(mv, 'ai'); else { renderAll(); }
      }, wait);
    } catch (e) {
      if (e && e.cancelled) return;
      console.error(e);
      if (game === g) { g.thinking = -1; renderAll(); }
    }
  }
  function moveNow() {
    const g = game;
    if (!g || g.thinking < 0 || !lastInfo || !lastInfo.pv || !lastInfo.pv.length) { toast(t('toast.notYet')); return; }
    const mv = isVar(g) ? VXE.strToMove(g.pos, lastInfo.pv[0]) : XQ.iccsToMove(lastInfo.pv[0]);
    if (!mv) { toast(t('toast.notYet')); return; }
    g.thinkToken = null;
    ai.cancel(); vai.cancel();
    g.thinking = -1;
    playMove(mv, 'ai');
  }
  function stopAi() {
    if (!game) return;
    game.thinkToken = null;
    clearTimeout(turnTimer);
    if (ai.busy) ai.cancel();
    if (vai.busy) vai.cancel();
    game.thinking = -1;
  }

  // ================================================================== 時鐘
  function startClock() { const c = game.clock; if (!c) return; c.running = game.pos.side; c.stamp = performance.now(); startClockLoop(); }
  function switchClock() { const c = game.clock; if (!c) return; c.running = game.pos.side; c.stamp = performance.now(); startClockLoop(); }
  function stopClock() { const c = game && game.clock; if (!c) return; if (c.running >= 0 && !game.result) tickClock(); c.running = -1; stopClockLoop(); renderClocks(); }
  function tickClock() {
    const g = game, c = g && g.clock;
    if (!c || c.running < 0 || g.result) return;
    const now = performance.now();
    c.remain[c.running] -= now - c.stamp;
    c.stamp = now;
    const side = c.running;
    if (c.remain[side] <= 10000 && !c.warned[side]) { c.warned[side] = true; A.play('tick'); }
    if (c.remain[side] <= 0) {
      c.remain[side] = 0;
      c.running = -1;
      stopAi();
      setResult(side ^ 1, 'time', { loser: side });
      renderAll();
      onGameOver();
    }
  }
  function startClockLoop() {
    if (clockTimer) return;
    clockTimer = setInterval(() => { if (!game || !game.clock || game.clock.running < 0) { stopClockLoop(); return; } tickClock(); renderClocks(); }, 200);
  }
  function stopClockLoop() { clearInterval(clockTimer); clockTimer = 0; }
  const fmtClock = ms => {
    ms = Math.max(0, ms);
    const s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    if (ms < 10000) return (ms / 1000).toFixed(1);
    return m + ':' + String(r).padStart(2, '0');
  };

  // ================================================================== 玩家操作
  function canHumanAct() {
    const g = game;
    if (!g || editState) return false;
    if (g.result && !isStudy()) return false;
    if (!atLive() && !isStudy()) return false;
    const side = g.sides[g.viewPly];
    if (g.result && atLive()) return false;
    return g.players[side].type === 'human' && g.thinking < 0;
  }
  function legalFrom(sq) {
    const pos = positionAt(game.viewPly);
    if (isVar(game)) return pos.legalMoves(false).filter(mv => (mv & 127) === sq);
    return pos.legalMoves().filter(mv => (mv & 255) === sq);
  }
  function selectSq(sq) {
    selected = sq;
    hintArrow = null;
    board.setArrows(arrowsNow());
    board.select(sq, sq >= 0 ? legalFrom(sq).map(mvTo) : []);
  }
  const ownPiece = (pos, pc) => !!pc && pc < 32 && pcSide(pc) === pos.side;
  // 找出 from→to 的合法著法；西洋兵升變時讓玩家選棋子
  async function pickMove(from, to) {
    const list = legalFrom(from).filter(mv => mvTo(mv) === to);
    if (!list.length) return 0;
    if (list.length === 1 || !isVar(game)) return list[0];
    const pos = positionAt(game.viewPly), pc = pos.board[from];
    const type = await askPromotion(pcSide(pc), !!(pc & 16));
    if (!type) return 0;
    return list.find(mv => ((mv >> 14) & 7) === type) || 0;
  }
  async function tryHumanMove(from, to, opts) {
    const g = game, ply = g.viewPly;
    const mv = await pickMove(from, to);
    if (!mv || game !== g || g.viewPly !== ply) { selectSq(-1); board.requestDraw(); return false; }
    humanMove(mv, opts);
    return true;
  }
  function onBoardTap(sq) {
    A.unlock();
    if (editState) { editorTap(sq); return; }
    const g = game;
    if (!g) return;
    if (skillState) { skillTap(sq); return; }
    if (!canHumanAct()) {
      if (g.result && atLive() && !isStudy()) return;
      if (!atLive() && !isStudy()) { toast(t('toast.viewingPast')); }
      return;
    }
    const pos = positionAt(g.viewPly);
    const pc = pos.board[sq];
    if (selected >= 0 && selected !== sq) {
      if (legalFrom(selected).some(mv => mvTo(mv) === sq)) { tryHumanMove(selected, sq); return; }
      if (!ownPiece(pos, pc)) { explainIllegal(pos, selected, sq); selectSq(-1); return; }
    }
    if (ownPiece(pos, pc)) {
      if (isVar(g) && pos.isFrozen(sq)) { A.play('illegal'); toast(t('sk.freeze.name') + ' ❄', 'bad'); return; }
      if (selected === sq) selectSq(-1);
      else { selectSq(sq); A.play('select'); }
    } else if (selected >= 0) selectSq(-1);
  }
  function explainIllegal(pos, from, to) {
    if (isVar(game)) {
      const buf = new Int32Array(400), n = pos.genMoves(buf, false, true);
      for (let i = 0; i < n; i++) if ((buf[i] & 127) === from && ((buf[i] >> 7) & 127) === to) {
        A.play('illegal');
        const cap = pos.board[to];
        toast(cap && pos.ncU[pos.side] > pos.ply ? t('sk.noCapture') : pos.inCheck() ? t('toast.inCheck') : t('toast.wouldBeCheck'), 'bad');
        return;
      }
      return;
    }
    const mv = from | (to << 8);
    const buf = new Int32Array(160), n = pos.genMoves(buf, false);
    for (let i = 0; i < n; i++) if (buf[i] === mv) { A.play('illegal'); toast(pos.inCheck() ? t('toast.inCheck') : t('toast.wouldBeCheck'), 'bad'); return; }
  }
  function humanMove(mv, opts) {
    const g = game;
    if (g.mode === 'pvc' && g.hintPending) g.hintPending = false;
    if (!atLive() && isStudy()) truncateTo(g.viewPly);
    playMove(mv, 'human', opts);
  }
  function onDragStart(sq) {
    A.unlock();
    if (editState) { editState.pick = sq; board.select(sq, []); return; }
    selectSq(sq);
  }
  function onDrop(from, to) {
    if (editState) { editorDrop(from, to); return; }
    if (to >= 0 && to !== from) {
      if (legalFrom(from).some(mv => mvTo(mv) === to)) { tryHumanMove(from, to, { dropped: true }); return; }
      explainIllegal(positionAt(game.viewPly), from, to);
    }
    board.requestDraw();
  }
  function canDrag(sq) {
    if (editState) return !!editState.board[sq];
    if (skillState || !canHumanAct()) return false;
    const pos = positionAt(game.viewPly), pc = pos.board[sq];
    return ownPiece(pos, pc) && !(isVar(game) && pos.isFrozen(sq));
  }

  // ================================================================== 技能：選目標、發動
  const SKILL_WHAT = {
    cicada: ['palace'], swap: ['first', 'second'], knife: ['puppet', 'victim'], spy: ['enemyPawn'], fire: ['enemyPawn'], stones: ['empty'],
    thunder: ['enemy'], shield: ['own'], freeze: ['enemy'], portal: ['mover', 'dest'], rage: ['ownPawn'], snipe: ['cannon', 'shot'], phoenix: ['revive'],
  };
  function skillSide() {
    const g = game;
    if (!g || !isVar(g) || !g.variant.skills) return -1;
    if (g.mode === 'pvc') return g.humanSide;
    return g.pos.side;
  }
  function skillBlockReason(id) {
    const g = game, pos = g.pos, side = g.pos.side, sk = VXE.SKILLS[id];
    if (!atLive() || g.result || g.players[side].type !== 'human' || g.thinking >= 0) return t('sk.notYourTurn');
    if (pos.extra > 0) return t('sk.duringChain');
    const info = pos.skillInfo(side, id);
    if (info.used) return t('sk.usedUp');
    if (info.cdLeft > 0) return t('sk.cooling', { n: info.cdLeft });
    if (info.energy < sk.cost) return t('sk.needEnergy', { n: sk.cost });
    return '';
  }
  function startSkill(id) {
    A.unlock();
    const g = game;
    if (!g || !isVar(g)) return;
    if (skillState && skillState.id === id) {
      // 再點一次：沒有目標的技能直接發動，有目標的就取消
      if (!skillState.actions[0] || VXE.SKILLS[id].steps > 0) { cancelSkill(); return; }
      const mv = skillState.actions[0];
      skillState = null;
      humanMove(mv);
      return;
    }
    if (skillSide() !== g.pos.side && g.mode === 'pvc') { toast(t('sk.notYourTurn'), 'bad'); A.play('illegal'); return; }
    const why = skillBlockReason(id);
    if (why) { toast(why, 'bad'); A.play('illegal'); return; }
    const actions = g.pos.legalSkills().filter(mv => VXE.skillOf(mv) === id);
    if (!actions.length) { toast(t('sk.noTarget'), 'bad'); A.play('illegal'); return; }
    selected = -1; hintArrow = null;
    const steps = VXE.SKILLS[id].steps;
    skillState = { id, steps, actions, selA: -1, targets: [] };
    if (steps === 1) skillState.targets = Array.from(new Set(actions.map(m => (m >> 7) & 127)));
    else if (steps === 2) {
      skillState.targets = Array.from(new Set(actions.map(m => m & 127)));
      if (skillState.targets.length === 1) { skillState.selA = skillState.targets[0]; skillState.targets = actions.map(m => (m >> 7) & 127); }
    }
    A.play('select');
    renderBoard(); renderStatus(); renderSkillBar();
  }
  function cancelSkill() {
    if (!skillState) return;
    skillState = null;
    renderBoard(); renderStatus(); renderSkillBar();
  }
  function skillTap(sq) {
    const S2 = skillState;
    if (!S2.steps) { cancelSkill(); return; }
    if (S2.steps === 1 || S2.selA >= 0) {
      const mv = S2.actions.find(m => (S2.steps === 1 || (m & 127) === S2.selA) && ((m >> 7) & 127) === sq);
      if (mv) { skillState = null; humanMove(mv); return; }
      if (S2.steps === 2 && S2.actions.some(m => (m & 127) === sq)) { S2.selA = sq; S2.targets = S2.actions.filter(m => (m & 127) === sq).map(m => (m >> 7) & 127); A.play('select'); renderBoard(); renderStatus(); return; }
      A.play('illegal'); cancelSkill(); return;
    }
    if (S2.targets.indexOf(sq) >= 0) {
      S2.selA = sq;
      S2.targets = S2.actions.filter(m => (m & 127) === sq).map(m => (m >> 7) & 127);
      A.play('select');
      renderBoard(); renderStatus();
      return;
    }
    A.play('illegal'); cancelSkill();
  }
  function skillPrompt() {
    const S2 = skillState;
    if (!S2) return '';
    const key = VXE.SKILLS[S2.id].key, name = t('sk.' + key + '.name');
    if (!S2.steps) return t('sk.armed', { name });
    const w = SKILL_WHAT[key] || ['enemy'];
    return t('sk.pick', { name, what: t('what.' + (S2.selA >= 0 && w[1] ? w[1] : w[0])) });
  }

  function undo() {
    const g = game;
    if (!g) return;
    if (editState) return;
    if (!g.moves.length) { toast(t('toast.noUndo')); return; }
    if (!S.allowUndo && g.mode === 'pvc' && !g.result) { toast(t('toast.undoDisabled')); return; }
    stopAi();
    let k = 1;
    if (g.mode === 'pvc' || g.mode === 'puzzle') {
      const human = g.humanSide;
      k = 0;
      let i = g.moves.length;
      do { i--; k++; } while (i > 0 && g.moves[i].side !== human);
      if (g.moves[i] && g.moves[i].side !== human) { toast(t('toast.noUndo')); return; }
      while (i > 0 && g.moves[i - 1].side === human) { i--; k++; } // 連環計：整個回合一起悔
    }
    skillState = null;
    const wasOver = !!g.result;
    truncateTo(g.moves.length - k);
    g.result = null; g.statsDone = g.statsDone && wasOver;
    g.undos++;
    selected = -1; hintArrow = null;
    A.play('move', 0.6);
    if (g.clock) { startClock(); }
    renderAll();
    scheduleTurn();
    maybeAnalyze();
    persist();
  }
  async function hint() {
    const g = game;
    if (!g || g.result || editState) return;
    if (!atLive()) jumpTo(g.moves.length);
    const side = g.pos.side;
    if (g.players[side].type !== 'human') { toast(t('toast.noHintNow')); return; }
    if (g.hintPending) return;
    // 殺法題：還在答案路線上就直接給答案
    if (g.mode === 'puzzle' && g.puzzle) {
      const sol = g.puzzle.sol, ply = g.moves.length;
      const onPath = g.moves.every((m, i) => m.iccs === sol[i]);
      if (onPath && sol[ply]) { showHint(XQ.iccsToMove(sol[ply])); return; }
    }
    g.hintPending = true;
    renderToolbar();
    toast(t('toast.hintPending'));
    try {
      const v = isVar(g), ply = g.moves.length;
      const res = v ? await vai.request({ type: 'search', conf: g.variant, moves: g.moves.map(m => m.iccs), time: 1600 })
        : await ai.request({ type: 'search', fen: g.startFen, moves: g.moves.map(m => m.iccs), time: 1600, book: g.startFen === XQ.START_FEN && g.moves.length < 12 });
      g.hintPending = false;
      renderToolbar();
      if (game !== g || g.result || g.pos.side !== side || !atLive() || g.moves.length !== ply) return;
      if (res.move) showHint(v ? VXE.strToMove(g.pos, res.move) : XQ.iccsToMove(res.move));
    } catch (e) { g.hintPending = false; renderToolbar(); }
  }
  function showHint(mv) {
    if (!mv) return;
    game.hints++;
    if (isVar(game) && VXE.skillOf(mv)) {
      const id = VXE.skillOf(mv), a = mv & 127, b = (mv >> 7) & 127;
      board.select(a === 127 ? -1 : a, b === 127 ? [] : [b], 'skill');
      A.play('select');
      toast(t('sk.hint', { name: t('sk.' + VXE.SKILLS[id].key + '.name') }) + ' · ' + notationOfMove(game.pos, mv), 'good');
      return;
    }
    hintArrow = { from: mvFrom(mv), to: mvTo(mv), color: '#1f8a5b' };
    selected = mvFrom(mv);
    board.select(selected, legalFrom(selected).map(mvTo));
    board.setArrows(arrowsNow());
    A.play('select');
    toast(t('toast.hint', { move: notationOfMove(positionAt(game.viewPly), mv) }), 'good');
  }
  function notationOfMove(pos, mv) {
    if (isVar(game)) return vText(pos, mv, S.lang);
    const n = S.notation === 'auto' ? (S.lang === 'en' ? 'wxf' : 'cn') : S.notation;
    if (n === 'iccs') { const s = XQ.moveToIccs(mv); return s.slice(0, 2) + '-' + s.slice(2); }
    if (n === 'wxf') return XQ.moveToWxf(pos, mv);
    return XQ.moveToChinese(pos, mv, S.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW');
  }
  function flip() { board.setFlipped(!board.flipped); renderCards(); renderEvalBar(); }
  async function offerDraw() {
    const g = game;
    if (!g || g.result) return;
    if (g.mode === 'pvc') {
      if (g.moves.length < 20) { toast(t('toast.drawTooEarly')); return; }
      const aiSide = g.humanSide ^ 1;
      toast(t('toast.drawThinking'));
      let score = null;
      const v = isVar(g);
      try {
        const res = v ? await vai.request({ type: 'search', conf: g.variant, moves: g.moves.map(m => m.iccs), time: 900 })
          : await analyzer.request({ type: 'search', fen: g.startFen, moves: g.moves.map(m => m.iccs), time: 900 });
        score = g.pos.side === aiSide ? res.score : -res.score;
      } catch (e) { return; }
      if (game !== g || g.result) return;
      if (score <= (v ? 60 : 25)) { setResult(null, 'agreement'); stopAi(); renderAll(); onGameOver(); toast(t('toast.drawAccepted'), 'good'); }
      else toast(t('toast.drawDeclined'), 'bad');
      maybeAnalyze();
    } else if (g.mode === 'pvp') {
      const ok = await confirmDialog(t('confirm.drawOffer', { side: sideName(g.pos.side) }), t('btn.agree'), t('btn.decline'));
      if (ok && !g.result) { setResult(null, 'agreement'); renderAll(); onGameOver(); }
    }
  }
  async function resign() {
    const g = game;
    if (!g || g.result) return;
    const ok = await confirmDialog(t('confirm.resign'), t('tool.resign'));
    if (!ok || g.result) return;
    const loser = g.mode === 'pvc' || g.mode === 'puzzle' ? g.humanSide : g.pos.side;
    stopAi();
    setResult(loser ^ 1, 'resign', { loser });
    renderAll();
    onGameOver();
  }

  // ================================================================== 殺法練習
  function puzzleStep(rec) {
    const g = game, pz = g.puzzle;
    if (!pz || rec.side !== RED) return;
    const redMoves = g.moves.filter(m => m.side === RED).length;
    if (redMoves >= pz.n) setResult(BLACK, 'puzzleFail', { loser: RED });
  }
  function startPuzzle(p, opts) {
    const idx = PUZZLES.indexOf(p);
    const sameN = PUZZLES.filter(x => x.n === p.n);
    p.label = t('pz.label', { n: p.n, i: sameN.indexOf(p) + 1 });
    p.index = idx;
    startGame({ mode: 'puzzle', fen: p.fen, humanSide: RED, puzzle: p, daily: opts && opts.daily });
    toast(t('status.puzzleGoal', { n: p.n }));
  }
  const puzzleTitle = g => (g.daily ? t('daily.label', { date: g.daily.slice(5).replace('-', '/') }) : g.puzzle.label);
  function nextPuzzle() {
    const g = game;
    const cur = g && g.puzzle ? g.puzzle.index : -1;
    let next = PUZZLES.find((p, i) => i > cur && !stats.puzzles[p.id]);
    if (!next) next = PUZZLES[(cur + 1) % PUZZLES.length];
    startPuzzle(next);
  }
  function showSolution() {
    const g = game;
    if (!g || !g.puzzle) return;
    const p = g.puzzle;
    startGame({ mode: 'puzzle', fen: p.fen, humanSide: RED, puzzle: p, silent: true });
    game.hints += 3;
    game.demoSolution = true;
    const sol = p.sol.slice();
    let i = 0;
    stopAi();
    const step = () => {
      if (game !== g && game.puzzle !== p) return;
      if (i >= sol.length || game.result) return;
      const mv = XQ.iccsToMove(sol[i++]);
      game.players = [{ type: 'human' }, { type: 'human' }];
      playMove(mv, 'demo');
      autoplayTimer = setTimeout(step, 1100);
    };
    autoplayTimer = setTimeout(step, 600);
  }

  // ================================================================== 檢視歷史
  function jumpTo(ply) {
    const g = game;
    if (!g) return;
    ply = clamp(ply, 0, g.moves.length);
    if (ply === g.viewPly) return;
    g.viewPly = ply;
    selected = -1; hintArrow = null;
    renderBoard();
    renderMoveList();
    renderStatus();
    renderCards();
    renderToolbar();
    if (ply === g.moves.length && !g.result) scheduleTurn();
    maybeAnalyze();
    if (reviewData && !reviewData.running) renderReview();
  }
  function toggleAutoplay() {
    if (autoplayTimer) { stopAutoplay(); return; }
    const g = game;
    if (!g || !g.moves.length) return;
    if (g.viewPly >= g.moves.length) jumpTo(0);
    const step = () => {
      if (!game || game.viewPly >= game.moves.length) { stopAutoplay(); return; }
      jumpTo(game.viewPly + 1);
      const rec = game.moves[game.viewPly - 1];
      A.play(rec.cap ? 'capture' : 'move', 0.7);
      autoplayTimer = setTimeout(step, 1100);
    };
    autoplayTimer = setTimeout(step, 300);
    renderNav();
  }
  function stopAutoplay() { if (autoplayTimer) { clearTimeout(autoplayTimer); autoplayTimer = 0; renderNav(); } }

  // ================================================================== 分析
  function maybeAnalyze() {
    clearTimeout(anTimer);
    const g = game;
    const want = g && !editState && !isVar(g) && (analysisOn || (S.evalBar && g.mode !== 'puzzle'));
    if (!want || (reviewData && reviewData.running)) { if (!(reviewData && reviewData.running)) analyzer.cancel(); anInfo = null; renderAnalysis(); renderEvalBar(); return; }
    anTimer = setTimeout(startAnalysis, 200);
  }
  function startAnalysis() {
    const g = game;
    if (!g) return;
    analyzer.cancel();
    const ply = g.viewPly, token = ++anToken, sideToMove = g.sides[ply];
    const pos = positionAt(ply);
    anInfo = { ply, sideToMove, depth: 0, pending: true };
    if (!pos.hasLegalMove()) { anInfo = { ply, sideToMove, terminal: true, score: -XQ.MATE_VALUE }; renderAnalysis(); renderEvalBar(); return; }
    renderAnalysis();
    const time = analysisOn ? 600000 : 2500;
    analyzer.request({ type: 'search', fen: g.startFen, moves: g.moves.slice(0, ply).map(m => m.iccs), time, depth: 60, analysis: true }, info => {
      if (token !== anToken || game !== g) return;
      anInfo = { ply, sideToMove, depth: info.depth, score: info.score, pv: info.pv, nodes: info.nodes, time: info.time };
      renderAnalysis(); renderEvalBar();
      board.setArrows(arrowsNow());
    }).then(res => {
      if (token !== anToken || game !== g) return;
      anInfo = Object.assign({}, anInfo, { done: true, pending: false });
      if (res && res.pv && res.pv.length && !anInfo.pv) Object.assign(anInfo, { score: res.score, pv: res.pv, depth: res.depth });
      renderAnalysis(); renderEvalBar();
    }).catch(() => {});
  }
  function arrowsNow() {
    const arr = [];
    if (hintArrow) arr.push(hintArrow);
    if (analysisOn && S.showArrow && anInfo && anInfo.pv && anInfo.pv.length && anInfo.ply === (game && game.viewPly)) {
      const mv = XQ.iccsToMove(anInfo.pv[0]);
      arr.push({ from: mv & 255, to: mv >> 8, color: '#2d5fa8' });
    }
    return arr;
  }
  const redScore = info => (info.sideToMove === RED ? info.score : -info.score);
  const winRate = sc => 1 / (1 + Math.exp(-sc / 160));
  function scoreText(sc) {
    if (Math.abs(sc) > XQ.WIN_VALUE) {
      const plies = XQ.MATE_VALUE - Math.abs(sc), n = Math.ceil(plies / 2);
      if (Math.abs(sc) < XQ.BAN_VALUE) return t('an.ban', { side: sideName(sc > 0 ? RED : BLACK) });
      return t('an.mateIn', { side: sideName(sc > 0 ? RED : BLACK), n });
    }
    return (sc > 0 ? '+' : '') + sc;
  }
  function pvText(ply, pv) {
    const pos = positionAt(ply).clone();
    const parts = [];
    for (const ic of pv.slice(0, 10)) {
      const mv = XQ.iccsToMove(ic);
      if (!mv || !pos.isLegal(mv)) break;
      const side = pos.side;
      parts.push('<span class="' + (side === RED ? 'pv-red' : 'pv-black') + '">' + esc(notationOfMove(pos, mv)) + '</span>');
      pos.makeMove(mv);
    }
    return parts.join(' ');
  }

  // 全局覆盤分析
  async function runReview() {
    const g = game;
    if (!g || !g.moves.length) return;
    analysisOn = false;
    $('#anToggle') && ($('#anToggle').checked = false);
    analyzer.cancel();
    const n = g.moves.length;
    reviewData = { id: g.id, n, evals: new Array(n + 1).fill(null), best: new Array(n + 1).fill(null), running: true, progress: 0 };
    showTab('analysis');
    renderReview();
    const time = clamp(Math.round(26000 / (n + 1)), 120, 650);
    try {
      await analyzer.request({ type: 'analyzeGame', fen: g.startFen, moves: g.moves.map(m => m.iccs), time }, m => {
        if (!reviewData || reviewData.id !== g.id) return;
        const side = g.sides[m.index];
        reviewData.evals[m.index] = side === RED ? m.score : -m.score;
        reviewData.best[m.index] = m.best;
        reviewData.progress = (m.index + 1) / (n + 1);
        renderReview();
      });
    } catch (e) { if (reviewData) reviewData.running = false; renderReview(); return; }
    if (!reviewData || reviewData.id !== g.id) return;
    reviewData.running = false;
    unlock('review');
    classifyMoves();
    renderReview();
    renderMoveList();
    maybeAnalyze();
  }
  function classifyMoves() {
    const g = game, R = reviewData;
    const cap = v => (v == null ? 0 : Math.abs(v) > XQ.WIN_VALUE ? Math.sign(v) * 1500 : clamp(v, -1500, 1500));
    const loss = [[], []];
    R.quality = [];
    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i], sgn = m.side === RED ? 1 : -1;
      const before = cap(R.evals[i]) * sgn, after = cap(R.evals[i + 1]) * sgn;
      const l = Math.max(0, before - after);
      let q;
      if (R.best[i] && R.best[i] === m.iccs) q = 'best';
      else if (l <= 20) q = 'good';
      else if (l <= 60) q = 'inacc';
      else if (l <= 150) q = 'mistake';
      else q = 'blunder';
      R.quality[i] = q;
      loss[m.side].push(l);
    }
    R.acc = loss.map(a => a.length ? Math.round(a.reduce((s, l) => s + 100 * Math.exp(-l / 170), 0) / a.length) : null);
    R.counts = [0, 1].map(sd => {
      const c = { best: 0, good: 0, inacc: 0, mistake: 0, blunder: 0 };
      g.moves.forEach((m, i) => { if (m.side === sd) c[R.quality[i]]++; });
      return c;
    });
  }

  // ================================================================== Claude 講棋（只在 claude.ai 中提供）
  let explainCtl = null;
  async function explainPosition() {
    if (!sampleApi || !game) return;
    const g = game, ply = g.viewPly, out = $('#explainOut'), btn = $('#explainBtn'), stop = $('#explainStop');
    if (explainCtl) explainCtl.abort();
    explainCtl = new AbortController();
    out.hidden = false;
    out.textContent = t('cl.thinking');
    btn.disabled = true; stop.hidden = false;
    const pos = positionAt(ply);
    const record = g.moves.slice(0, ply).map((m, i) => (i % 2 === 0 && g.sides[0] === RED ? (Math.floor(i / 2) + 1) + '. ' : '') + m.tw).join(' ');
    let engine = '';
    if (anInfo && anInfo.ply === ply && anInfo.pv) engine = '引擎評估（紅方視角，車約 200 分）：' + scoreText(redScore(anInfo)) + '，深度 ' + anInfo.depth + '，建議變著：' + anInfo.pv.slice(0, 8).join(' ') + '（ICCS 座標）';
    const langName = S.lang === 'en' ? 'English' : S.lang === 'zh-CN' ? '简体中文' : '繁體中文（台灣用語）';
    const prompt = [
      '你是象棋（中國象棋）教練。請用' + langName + '，以 150～250 字講解下面這個局面，寫給業餘棋友看。',
      '內容：1) 目前形勢與雙方子力；2) 剛才那步棋的意圖或問題；3) 輪走方接下來的具體計畫（用中文記譜舉一兩步）。不要用 Markdown 標題，分成 2～3 段即可。',
      '起始 FEN：' + g.startFen,
      '目前 FEN：' + pos.toFen(),
      '輪走方：' + (pos.side === RED ? '紅方' : '黑方'),
      '棋譜：' + (record || '（尚未走棋）'),
      engine,
    ].filter(Boolean).join('\n');
    try {
      await sampleApi(prompt, { signal: explainCtl.signal, onText: ({ text }) => { out.textContent = text; } });
    } catch (e) {
      const code = e && e.code;
      if (code === 'cancelled') { out.textContent = e.text || ''; out.hidden = !e.text; }
      else if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') { $('#explainBox').hidden = true; sampleApi = null; }
      else out.textContent = (e && e.text ? e.text + '\n\n' : '') + t(code === 'rate_limited' ? 'cl.rateLimited' : 'cl.error');
    } finally {
      btn.disabled = false; stop.hidden = true; explainCtl = null;
    }
  }

  // ================================================================== 繪製介面
  function renderAll(o) {
    o = o || {};
    if (!o.skipBoard) renderBoard();
    renderCards();
    renderStatus();
    renderMoveList();
    renderToolbar();
    renderNav();
    renderInfo();
    renderAnalysis();
    renderEvalBar();
    renderModeLabel();
    renderSkillBar();
  }
  function renderBoard() {
    const g = game;
    if (!g) return;
    if (editState) { board.setPosition(editState.board, {}); board.setEffects(null); board.setArrows([]); return; }
    if (isVar(g)) {
      const ply = g.viewPly, rec = ply > 0 ? g.moves[ply - 1] : null;
      const last = rec && !rec.skill ? (rec.mv & 127) | (((rec.mv >> 7) & 127) << 8) : 0;
      const checkSq = rec && rec.check ? positionAt(ply).kingSq[g.sides[ply]] : -1;
      board.setPosition(g.boards[ply], { lastMove: last, checkSq });
      board.setEffects(g.fx[ply]);
      if (skillState) board.select(skillState.selA, skillState.targets, 'skill');
      else if (selected >= 0) board.select(selected, legalFrom(selected).map(mvTo));
      board.setArrows(arrowsNow());
      return;
    }
    board.setEffects(null);
    const ply = g.viewPly, b = g.boards[ply];
    const last = ply > 0 ? g.moves[ply - 1].mv : 0;
    let checkSq = -1;
    if (ply > 0 && g.moves[ply - 1].check) { const king = g.sides[ply] === RED ? 1 : 9; checkSq = b.indexOf(king); }
    board.setPosition(b, { lastMove: last, checkSq });
    if (selected >= 0) board.select(selected, legalFrom(selected).map(mv => mv >> 8));
    board.setArrows(arrowsNow());
  }
  function renderModeLabel() {
    const g = game;
    if (!g) return;
    let s = t('mode.' + g.mode);
    if (isVar(g) && !editState) s = variantTitle(g.variant) + ' · ' + s;
    if (editState) s = t('mode.edit');
    else if (g.mode === 'pvc') s += ' · ' + t('level.' + LEVELS[g.players[g.humanSide ^ 1].level].key);
    else if (g.mode === 'cvc') s += ' · ' + t('level.' + LEVELS[g.players[0].level].key) + ' vs ' + t('level.' + LEVELS[g.players[1].level].key);
    else if (g.mode === 'puzzle' && g.puzzle) s = puzzleTitle(g) || s;
    if (g.handicap && g.handicap !== 'none') s += ' · ' + t('hc.' + g.handicap);
    ui.modeLabel.textContent = s;
  }
  function playerName(side) {
    const g = game, p = g.players[side];
    if (p.type === 'ai') return t('player.ai') + (p.puzzle ? '' : ' · ' + t('level.' + LEVELS[p.level].key));
    if (g.mode === 'pvc' || g.mode === 'puzzle') return t('player.you');
    const h = g.headers || {};
    const hn = side === RED ? h.Red : h.Black;
    return hn || sideName(side);
  }
  function capturedList(side) {
    const g = game, b = g.boards[g.viewPly], start = g.boards[0];
    const cnt = new Array(64).fill(0), base = new Array(64).fill(0);
    for (let i = 0; i < 90; i++) { if (b[i]) cnt[b[i]]++; if (start[i]) base[start[i]]++; }
    const out = [];
    const opp = (side ^ 1) << 3;
    for (const army of [0, 16]) for (const tp of [5, 2, 4, 6, 3, 7]) { const pc = army | opp | tp; for (let k = cnt[pc]; k < base[pc]; k++) out.push(pc); }
    return out;
  }
  function material(side) {
    const b = game.boards[game.viewPly];
    let v = 0;
    for (let i = 0; i < 90; i++) { const pc = b[i]; if (pc && pc < 32 && pcSide(pc) === side) v += (pc & 16 ? VAL_CH : PIECE_VALUE)[pc & 7]; }
    return v;
  }
  // 被吃棋子、技能圖示的小圖
  const capImgCache = new Map();
  function capPieceHtml(pc, chars) {
    if (pc & 16) {
      const key = pc + ':' + S.pieces;
      let url = capImgCache.get(key);
      if (!url) { try { url = board.pieceDataURL(pc, 22); capImgCache.set(key, url); } catch (e) { url = ''; } }
      return url ? '<img class="cap-img" src="' + url + '" alt="' + esc(chars[pc]) + '">' : '<span class="cap-piece chess">' + chars[pc] + '</span>';
    }
    return '<span class="cap-piece ' + (pc < 8 ? 'red' : 'black') + '">' + chars[pc] + '</span>';
  }
  const skIcon = (key, cls) => '<svg class="' + (cls || 'sk-ic') + '" aria-hidden="true"><use href="#sk-' + key + '"/></svg>';
  function energyHtml(n) {
    let h = '<span class="energy" title="' + esc(t('sk.energy')) + ' ' + n + '/10">';
    for (let i = 0; i < 10; i++) h += '<i' + (i < n ? ' class="on"' : '') + '></i>';
    return h + '<b>' + n + '</b></span>';
  }
  function deckMiniHtml(pos, side) {
    return '<span class="deck-mini">' + pos.deck[side].map(id => {
      const info = pos.skillInfo(side, id), sk = VXE.SKILLS[id];
      const ready = !info.used && !info.cdLeft && info.energy >= sk.cost;
      return '<span class="dm' + (ready ? ' ready' : '') + (info.used ? ' used' : '') + '" title="' + esc(t('sk.' + sk.key + '.name')) + '">' + skIcon(sk.key, 'dm-ic') + (info.cdLeft ? '<i>' + info.cdLeft + '</i>' : '') + '</span>';
    }).join('') + '</span>';
  }
  function renderCards() {
    const g = game;
    if (!g) return;
    const topSide = board.flipped ? RED : BLACK;
    const chars = window.XQPieceChars[S.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
    const toMove = editState ? editState.side : g.sides[g.viewPly];
    const vpos = isVar(g) && !editState ? positionAt(g.viewPly) : null;
    for (const [el, side] of [[ui.cardTop, topSide], [ui.cardBottom, topSide ^ 1]]) {
      el.classList.toggle('active', !g.result && !editState && toMove === side && atLive());
      const chessArmy = !!(vpos && vpos.armies[side] === 'chess');
      $('.avatar', el).className = 'avatar ' + (side === RED ? 'red' : 'black') + (chessArmy ? ' chess' : '');
      $('.avatar', el).textContent = chars[(side === RED ? 1 : 9) + (chessArmy ? 16 : 0)];
      if (editState) {
        $('.p-name', el).innerHTML = '<span class="side-dot ' + (side === RED ? 'red' : 'black') + '"></span>' + esc(sideName(side)) + (editState.side === side ? ' <span class="chip">' + esc(t(side === RED ? 'ed.redToMove' : 'ed.blackToMove')) + '</span>' : '');
        $('.p-sub', el).innerHTML = '';
        $('.clock', el).hidden = true;
        continue;
      }
      $('.p-name', el).innerHTML = '<span class="side-dot ' + (side === RED ? 'red' : 'black') + '"></span>' + esc(playerName(side)) +
        (vpos && vpos.armies[0] !== vpos.armies[1] ? ' <span class="army-chip' + (chessArmy ? ' chess' : '') + '">' + esc(t(chessArmy ? 'army.chess' : 'army.xq')) + '</span>' : '') +
        (g.thinking === side ? ' <span class="thinking" aria-label="' + esc(t('status.thinkingShort')) + '"><i></i><i></i><i></i></span>' : '');
      const caps = capturedList(side);
      const diff = Math.round(material(side) - material(side ^ 1));
      $('.p-sub', el).innerHTML = (vpos && vpos.skills ? energyHtml(vpos.en[side]) + deckMiniHtml(vpos, side) : '') +
        '<span class="captured">' + caps.map(pc => capPieceHtml(pc, chars)).join('') + '</span>' +
        (diff > 0 ? '<span class="mat-diff">+' + diff + '</span>' : '');
      const clock = $('.clock', el);
      clock.hidden = !g.clock;
    }
    if (!editState) renderClocks();
  }
  function renderClocks() {
    const g = game;
    if (!g || !g.clock) return;
    const topSide = board.flipped ? RED : BLACK;
    for (const [el, side] of [[ui.cardTop, topSide], [ui.cardBottom, topSide ^ 1]]) {
      const c = $('.clock', el), ms = g.clock.remain[side];
      c.textContent = fmtClock(ms);
      c.classList.toggle('running', g.clock.running === side);
      c.classList.toggle('low', ms < 20000);
    }
  }
  function renderStatus() {
    const g = game;
    if (!g) return;
    let html = '';
    if (editState) html = esc(t('status.edit'));
    else if (!atLive()) html = esc(t('status.viewing', { n: g.viewPly })) + ' <button class="btn-inline" data-act="live">' + esc(t('status.backToLive')) + '</button>';
    else if (g.result) html = '<b>' + esc(resultWord(g.result)) + '</b> · ' + esc(resultReason(g.result));
    else {
      const side = g.pos.side, p = g.players[side];
      if (g.thinking >= 0) html = esc(t('status.thinking', { name: playerName(side) }));
      else if (g.mode === 'puzzle') {
        const left = g.puzzle.n - g.moves.filter(m => m.side === RED).length;
        html = esc(t('status.puzzleGoal', { n: g.puzzle.n })) + ' · ' + esc(t('status.puzzleLeft', { n: left }));
      } else if (p.type === 'human' && g.mode === 'pvc') html = esc(t('status.yourTurn'));
      else html = esc(t('status.turn', { side: sideName(side) }));
      if (g.pos.inCheck()) html = '<span class="alert">' + esc(t('status.check')) + '</span> ' + html;
      if (isVar(g)) {
        if (skillState) html = '<span class="sk-prompt">' + esc(skillPrompt()) + '</span>';
        if (g.pos.extra > 0) html += ' <span class="chip sk-chip">' + esc(t('sk.extra', { n: g.pos.extra })) + '</span>';
        if (g.pos.ncU[side] > g.pos.ply) html += ' <span class="chip sk-chip">' + esc(t('sk.noCapture')) + '</span>';
      }
    }
    let chips = '';
    if (skillState && !editState) chips += '<button class="btn-inline" data-act="skCancel">' + esc(t('sk.cancel')) + '</button>';
    else if (!editState && g.viewPly > 0) chips += '<span class="chip">' + esc(notationOf(g.moves[g.viewPly - 1])) + '</span>';
    if (!editState && (S.evalBar || analysisOn) && anInfo && anInfo.score != null && anInfo.ply === g.viewPly) chips += '<span class="chip eval-chip">' + esc(scoreText(redScore(anInfo))) + '</span>';
    if (!editState && g.thinking >= 0 && g.mode !== 'cvc') chips += '<button class="btn-inline" data-act="moveNow">' + esc(t('tool.moveNow')) + '</button>';
    ui.status.innerHTML = '<span class="status-text">' + html + '</span>' + chips;
  }
  function renderMoveList() {
    const g = game;
    if (!g) return;
    ui.opening.textContent = g.opening ? (g.opening[S.lang] || g.opening['zh-TW']) : (isVar(g) ? variantTitle(g.variant) : '');
    if (!g.moves.length) {
      ui.moveList.innerHTML = '<li class="mv-empty">' + esc(isVar(g) ? t('ledger.empty') : g.startFen !== XQ.START_FEN ? t('ledger.emptyCustom') : t('ledger.empty')) + '</li>';
      return;
    }
    if (isVar(g)) {
      // 一回合一格（連環計會有好幾步）
      const turns = [];
      g.moves.forEach((m, i) => { const last = turns[turns.length - 1]; if (last && last.side === m.side) last.idx.push(i); else turns.push({ side: m.side, idx: [i] }); });
      const cellV = tr => '<span class="mv-multi">' + tr.idx.map(i => { const m = g.moves[i]; return '<button class="mv ' + (m.side === RED ? 'red' : 'black') + (m.skill ? ' skill' : '') + (g.viewPly === i + 1 ? ' current' : '') + '" data-ply="' + (i + 1) + '">' + (m.skill ? skIcon(VXE.SKILLS[m.skill].key, 'mv-ic') : '') + esc(notationOf(m)) + '</button>'; }).join('') + '</span>';
      let html = '', no = 1;
      for (let k = 0; k < turns.length; k += 2) {
        html += '<li class="mv-row"><span class="mv-no">' + (no++) + '.</span>' + cellV(turns[k]) + (turns[k + 1] ? cellV(turns[k + 1]) : '<span></span>') + '</li>';
      }
      if (g.result) html += '<li class="result-line">' + esc(resultWord(g.result) + '（' + resultReason(g.result) + '）') + '</li>';
      ui.moveList.innerHTML = html;
      const cur = $('.mv.current', ui.moveList);
      if (cur) cur.scrollIntoView({ block: 'nearest' });
      else if (atLive()) { const p = ui.moveList.parentElement; p.scrollTop = p.scrollHeight; }
      return;
    }
    const firstSide = g.sides[0];
    let html = '', row = [], no = 1;
    const q = reviewData && !reviewData.running && reviewData.id === g.id && reviewData.quality;
    const cell = i => {
      const m = g.moves[i];
      const cls = 'mv ' + (m.side === RED ? 'red' : 'black') + (g.viewPly === i + 1 ? ' current' : '');
      const mark = q ? qualityMark(q[i]) : '';
      return '<button class="' + cls + '" data-ply="' + (i + 1) + '">' + esc(notationOf(m)) + mark + '</button>';
    };
    let i = 0;
    if (firstSide === BLACK) { html += '<li class="mv-row"><span class="mv-no">1.</span><span class="mv">…</span>' + cell(0) + '</li>'; i = 1; no = 2; }
    for (; i < g.moves.length; i += 2) {
      row = [cell(i), i + 1 < g.moves.length ? cell(i + 1) : '<span></span>'];
      html += '<li class="mv-row"><span class="mv-no">' + no + '.</span>' + row.join('') + '</li>';
      no++;
    }
    if (g.result) html += '<li class="result-line">' + esc(resultWord(g.result) + '（' + resultReason(g.result) + '）') + '</li>';
    ui.moveList.innerHTML = html;
    const cur = $('.mv.current', ui.moveList);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    else if (atLive()) { const p = ui.moveList.parentElement; p.scrollTop = p.scrollHeight; }
  }
  function qualityMark(q) {
    if (!q || q === 'good') return '';
    const sym = { best: '★', inacc: '?!', mistake: '?', blunder: '??' }[q];
    return ' <span class="q q-' + q + '" title="' + esc(t('an.q.' + q)) + '">' + sym + '</span>';
  }
  function renderToolbar() {
    const g = game;
    if (!g) return;
    const live = atLive(), over = !!g.result;
    const humanTurn = live && !over && g.players[g.pos.side].type === 'human';
    ui.tUndo.disabled = !g.moves.length || g.mode === 'cvc' || !!editState;
    ui.tHint.disabled = !humanTurn || !!g.hintPending || !!editState;
    ui.tDraw.disabled = over || !(g.mode === 'pvc' || g.mode === 'pvp') || !!editState;
    ui.tResign.disabled = over || !(g.mode === 'pvc' || g.mode === 'pvp' || g.mode === 'puzzle') || !!editState;
    ui.toolbar.hidden = !!editState;
  }
  function renderNav() {
    const g = game;
    if (!g) return;
    ui.navFirst.disabled = ui.navPrev.disabled = g.viewPly === 0;
    ui.navNext.disabled = ui.navLast.disabled = g.viewPly >= g.moves.length;
    ui.navPlay.disabled = !g.moves.length;
    $('use', ui.navPlay).setAttribute('href', autoplayTimer ? '#i-pause' : '#i-play');
  }
  function renderInfo() {
    const g = game;
    if (!g || ui.tabInfo.hidden) return;
    const rows = [];
    rows.push([t('info.mode'), (isVar(g) ? variantTitle(g.variant) + ' · ' : '') + t('mode.' + g.mode)]);
    if (isVar(g)) {
      const v = g.variant, an = a => t(a === 'chess' ? 'army.chess' : 'army.xq');
      rows.push([t('side.red'), playerName(RED) + ' · ' + an(v.armies[0]) + (v.skills ? ' · ' + v.decks[0].map(id => t('sk.' + VXE.SKILLS[id].key + '.name')).join('、') : '')]);
      rows.push([t('side.black'), playerName(BLACK) + ' · ' + an(v.armies[1]) + (v.skills ? ' · ' + v.decks[1].map(id => t('sk.' + VXE.SKILLS[id].key + '.name')).join('、') : '')]);
      if (v.kind === 'cvx') rows.push([t('ng.cxStrength'), t(v.queen ? 'cx.full' : 'cx.balanced')]);
      rows.push([t('info.time'), t('tc.' + g.tc)]);
      rows.push([t('info.moves'), t('info.movesN', { n: Math.ceil(g.moves.length / 2) })]);
      if (g.result) rows.push([t('info.result'), resultWord(g.result) + '（' + resultReason(g.result) + '）']);
      rows.push([t('info.started'), new Date(g.created).toLocaleString(S.lang === 'en' ? 'en' : S.lang)]);
      ui.tabInfo.innerHTML = '<table class="info-table">' + rows.map(r => '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>' +
        '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn small" data-act="export">' + esc(t('menu.export')) + '</button><button class="btn small" data-act="save">' + esc(t('btn.save')) + '</button><button class="btn small" data-act="skills">' + esc(t('sk.book')) + '</button></div>';
      return;
    }
    rows.push([t('side.red'), playerName(RED)]);
    rows.push([t('side.black'), playerName(BLACK)]);
    if (g.opening) rows.push([t('info.opening'), g.opening[S.lang] || g.opening['zh-TW']]);
    rows.push([t('info.time'), t('tc.' + g.tc)]);
    if (g.handicap !== 'none') rows.push([t('ng.handicap'), t('hc.' + g.handicap)]);
    rows.push([t('info.moves'), t('info.movesN', { n: Math.ceil(g.moves.length / 2) })]);
    if (g.result) rows.push([t('info.result'), resultWord(g.result) + '（' + resultReason(g.result) + '）']);
    rows.push([t('info.started'), new Date(g.created).toLocaleString(S.lang === 'en' ? 'en' : S.lang)]);
    if (g.mode === 'pvc') rows.push([t('info.hintsUndos'), t('info.hu', { h: g.hints, u: g.undos })]);
    const fen = positionAt(g.viewPly).toFen(Math.floor(g.viewPly / 2) + 1);
    ui.tabInfo.innerHTML = '<table class="info-table">' + rows.map(r => '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>' +
      '<div class="an-section"><h3>FEN</h3><div class="an-pv" style="font:13px/1.5 ui-monospace,monospace;word-break:break-all">' + esc(fen) + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small" data-act="copyFen">' + esc(t('btn.copyFen')) + '</button><button class="btn small" data-act="export">' + esc(t('menu.export')) + '</button><button class="btn small" data-act="save">' + esc(t('btn.save')) + '</button></div></div>';
  }
  function renderEvalBar() {
    const show = (S.evalBar || analysisOn) && game && !editState && game.mode !== 'puzzle' && !isVar(game);
    ui.evalBar.hidden = !show;
    if (!show) return;
    ui.evalBar.classList.toggle('flipped', board.flipped);
    ui.evalBar.style.height = board.H ? board.H + 'px' : '';
    let wr = 0.5;
    if (anInfo && anInfo.score != null && anInfo.ply === game.viewPly) wr = winRate(redScore(anInfo));
    else if (anInfo && anInfo.terminal) wr = anInfo.sideToMove === RED ? 0 : 1;
    ui.evalFill.style.height = (wr * 100).toFixed(1) + '%';
    ui.evalBar.title = t('an.winrate') + ' ' + sideName(RED) + ' ' + Math.round(wr * 100) + '%';
  }
  function renderAnalysis() {
    const g = game;
    if (!g || !ui.anBody) return;
    $('#anToggle').checked = analysisOn;
    $('#arrowToggle').checked = S.showArrow;
    const box = ui.anBody;
    $('#anToggle').disabled = isVar(g);
    const eb = $('#explainBox');
    if (eb) eb.hidden = !sampleApi || isVar(g);
    if (isVar(g)) { box.innerHTML = '<p class="an-meta">' + esc(t('var.noAnalysis')) + '</p>'; return; }
    if (!analysisOn && !(S.evalBar && anInfo)) { box.innerHTML = '<p class="an-meta">' + esc(t('an.off')) + '</p>'; return; }
    if (!anInfo) { box.innerHTML = '<p class="an-meta">' + esc(t('an.waiting')) + '</p>'; return; }
    if (anInfo.terminal) { box.innerHTML = '<p class="an-meta">' + esc(t('an.terminal')) + '</p>'; return; }
    if (anInfo.score == null) { box.innerHTML = '<p class="an-meta">' + esc(t('an.waiting')) + '</p>'; return; }
    const sc = redScore(anInfo), wr = winRate(sc);
    box.innerHTML = '<div class="an-head"><div><div class="an-score ' + (sc >= 0 ? 'red' : 'black') + '">' + esc(scoreText(sc)) + '</div>' +
      '<div class="an-meta">' + esc(t('an.winrate')) + '：' + esc(sideName(RED)) + ' ' + Math.round(wr * 100) + '% · ' + esc(sideName(BLACK)) + ' ' + (100 - Math.round(wr * 100)) + '%</div></div>' +
      '<div class="an-meta" style="text-align:right">' + esc(t('an.depth', { d: anInfo.depth })) + '<br>' + esc(t('an.nodes', { n: ((anInfo.nodes || 0) / 1e4).toFixed(0) })) + '</div></div>' +
      '<div class="an-meta" style="margin-bottom:4px">' + esc(t('an.bestLine')) + '</div><div class="an-pv">' + (anInfo.pv ? pvText(anInfo.ply, anInfo.pv) : '') + '</div>';
  }
  function renderReview() {
    const R = reviewData, el = ui.reviewBody, g = game;
    if (!el || !g) return;
    if (isVar(g)) { el.innerHTML = ''; return; }
    if (!R || R.id !== g.id) {
      el.innerHTML = '<p class="an-meta">' + esc(t('an.reviewHint')) + '</p><button class="btn small" data-act="review"' + (g.moves.length ? '' : ' disabled') + '>' + esc(t('an.reviewRun')) + '</button>';
      return;
    }
    let html = '';
    if (R.running) html += '<p class="an-meta">' + esc(t('an.reviewing', { p: Math.round(R.progress * 100) })) + '</p><div class="progress"><i style="width:' + (R.progress * 100).toFixed(0) + '%"></i></div>';
    html += '<canvas class="review-chart" id="reviewChart" aria-label="' + esc(t('an.chart')) + '"></canvas>';
    if (!R.running && R.acc) {
      html += '<div class="review-summary">' + [RED, BLACK].map(sd => {
        const c = R.counts[sd];
        return '<div class="rs-card"><div style="color:var(--ink-3)">' + esc(playerName(sd)) + '</div><div class="acc">' + (R.acc[sd] == null ? '—' : R.acc[sd] + '%') + '</div><div style="color:var(--ink-3);margin-bottom:4px">' + esc(t('an.accuracy')) + '</div>' +
          ['best', 'inacc', 'mistake', 'blunder'].map(k => '<div class="rs-row"><span>' + esc(t('an.q.' + k)) + '</span><b>' + c[k] + '</b></div>').join('') + '</div>';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
    drawReviewChart();
  }
  function drawReviewChart() {
    const R = reviewData, cv = $('#reviewChart');
    if (!R || !cv) return;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 120, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const red = css.getPropertyValue('--red-side').trim() || '#b3261c', ink = css.getPropertyValue('--ink-3').trim() || '#888';
    const n = R.n, pad = 6;
    const X = i => pad + (w - 2 * pad) * (n ? i / n : 0);
    const Y = v => h - pad - (h - 2 * pad) * v;
    const vals = R.evals.map(v => (v == null ? null : winRate(Math.abs(v) > XQ.WIN_VALUE ? Math.sign(v) * 1500 : v)));
    g.strokeStyle = ink; g.globalAlpha = 0.5; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(pad, Y(0.5)); g.lineTo(w - pad, Y(0.5)); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    g.beginPath();
    let started = false;
    vals.forEach((v, i) => { if (v == null) return; if (!started) { g.moveTo(X(i), Y(0.5)); started = true; } g.lineTo(X(i), Y(v)); });
    let lastI = vals.length - 1;
    while (lastI > 0 && vals[lastI] == null) lastI--;
    g.lineTo(X(lastI), Y(0.5)); g.closePath();
    g.fillStyle = red; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    g.beginPath(); started = false;
    vals.forEach((v, i) => { if (v == null) return; if (!started) { g.moveTo(X(i), Y(v)); started = true; } else g.lineTo(X(i), Y(v)); });
    g.strokeStyle = red; g.lineWidth = 2; g.stroke();
    if (R.quality) R.quality.forEach((q, i) => {
      if (q !== 'mistake' && q !== 'blunder') return;
      const v = vals[i + 1]; if (v == null) return;
      g.fillStyle = q === 'blunder' ? '#c0362c' : '#d46a22';
      g.beginPath(); g.arc(X(i + 1), Y(v), 3.5, 0, Math.PI * 2); g.fill();
    });
    if (game && game.viewPly <= n) { g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X(game.viewPly), pad); g.lineTo(X(game.viewPly), h - pad); g.stroke(); }
    cv.onclick = e => { const r = cv.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - pad) / (r.width - 2 * pad)) * n); jumpTo(clamp(i, 0, n)); };
  }
  function showTab(name) {
    $$('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ui.tabMoves.hidden = name !== 'moves';
    ui.tabAnalysis.hidden = name !== 'analysis';
    ui.tabInfo.hidden = name !== 'info';
    if (name === 'info') renderInfo();
    if (name === 'analysis') { renderAnalysis(); renderReview(); }
  }

  // ================================================================== 提示訊息、橫幅
  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    ui.toastRoot.appendChild(el);
    while (ui.toastRoot.children.length > 3) ui.toastRoot.firstChild.remove();
    setTimeout(() => el.remove(), 2600);
  }
  function banner(word, tone) {
    const el = document.createElement('div');
    el.className = 'banner-word' + (tone === 'dark' ? ' dark' : tone === 'jade' ? ' jade' : '');
    el.textContent = word;
    ui.banner.innerHTML = '';
    ui.banner.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 1400);
  }

  function skillBanner(name, side) {
    const el = document.createElement('div');
    el.className = 'banner-word skill-word' + (side === BLACK ? ' dark' : '');
    el.innerHTML = '<small>' + esc(sideName(side)) + '</small>' + esc(name);
    ui.banner.innerHTML = '';
    ui.banner.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 1600);
  }

  // ================================================================== 技能列
  function renderSkillBar() {
    const bar = ui.skillBar;
    if (!bar) return;
    const g = game;
    const show = !!(g && isVar(g) && g.variant.skills && !editState);
    bar.hidden = !show;
    document.body.classList.toggle('has-skills', show);
    if (!show) return;
    const pos = positionAt(g.viewPly);
    const side = g.mode === 'pvc' ? g.humanSide : pos.side;
    const myTurn = atLive() && !g.result && pos.side === side && g.players[side].type === 'human' && g.thinking < 0;
    bar.classList.toggle('waiting', !myTurn);
    // 有技能剛變成可以發動時，提示音加上發光
    const readyNow = pos.deck[side].filter(id => { const info = pos.skillInfo(side, id); return !info.used && !info.cdLeft && info.energy >= VXE.SKILLS[id].cost; });
    const rkey = g.id + ':' + side;
    const prevReady = bar._ready && bar._ready.key === rkey ? bar._ready.ids : null;
    const fresh = myTurn && prevReady ? readyNow.filter(id => prevReady.indexOf(id) < 0) : [];
    if (atLive()) bar._ready = { key: rkey, ids: readyNow };
    if (fresh.length && g.mode === 'pvc') A.play('energy');
    bar.innerHTML = '<div class="sk-head"><span class="side-dot ' + (side === RED ? 'red' : 'black') + '"></span><span class="sk-who">' + esc(g.mode === 'pvc' ? t('player.you') : sideName(side)) + '</span>' + energyHtml(pos.en[side]) +
      '<button class="icon-btn sk-info" data-act="skills" aria-label="' + esc(t('sk.book')) + '" title="' + esc(t('sk.book')) + '"><svg class="ic"><use href="#i-info"/></svg></button></div>' +
      '<div class="sk-cards">' + pos.deck[side].map(id => {
        const sk = VXE.SKILLS[id], info = pos.skillInfo(side, id);
        const state = info.used ? 'used' : info.cdLeft ? 'cd' : info.energy < sk.cost ? 'poor' : 'ready';
        const armed = skillState && skillState.id === id;
        const off = !myTurn || pos.extra > 0 || state !== 'ready';
        return '<button type="button" class="sk-card ' + state + (armed ? ' armed' : '') + (off ? ' off' : '') + (fresh.indexOf(id) >= 0 ? ' just-ready' : '') + '" data-skill="' + id + '" title="' + esc(t('sk.' + sk.key + '.desc')) + '" aria-label="' + esc(t('sk.' + sk.key + '.name') + '，' + t('sk.cost', { n: sk.cost })) + '">' +
          skIcon(sk.key) + '<span class="sk-name">' + esc(t('sk.' + sk.key + '.name')) + '</span><span class="sk-cost">' + sk.cost + '</span>' +
          (info.used ? '<span class="sk-badge">' + esc(t('sk.used')) + '</span>' : info.cdLeft ? '<span class="sk-badge">' + info.cdLeft + '</span>' : '') + '</button>';
      }).join('') + '</div>';
  }
  function skillInfoDialog(id) {
    const sk = VXE.SKILLS[id];
    openModal({ title: t('sk.' + sk.key + '.name'), body: '<div class="sk-entry solo">' + skIcon(sk.key, 'sk-ic big') + '<span class="sk-body"><small class="sk-meta">' + esc(t('sk.cost', { n: sk.cost })) + ' · ' + esc(sk.once ? t('sk.once') : t('sk.cdN', { n: sk.cd })) + '</small><span class="sk-desc">' + esc(t('sk.' + sk.key + '.desc')) + '</span></span></div>' });
  }
  function skillCardsHtml(sel) {
    return [['tactic', 'sk.groupTactic'], ['hero', 'sk.groupHero']].map(([grp, label]) => '<h3 class="sk-group">' + esc(t(label)) + '</h3><div class="sk-grid">' +
      VXE.SKILLS.filter(s => s && s.group === grp).map(s => {
        const tag = sel ? 'button type="button"' : 'div';
        return '<' + tag + ' class="sk-entry' + (sel && sel.has(s.key) ? ' picked' : '') + '"' + (sel ? ' data-sk="' + s.key + '"' : '') + '>' + skIcon(s.key, 'sk-ic big') +
          '<span class="sk-body"><b>' + esc(t('sk.' + s.key + '.name')) + '</b><small class="sk-meta">' + esc(t('sk.cost', { n: s.cost })) + ' · ' + esc(s.once ? t('sk.once') : t('sk.cdN', { n: s.cd })) + (s.needs ? ' · ' + esc(t('army.xq')) : '') + '</small><span class="sk-desc">' + esc(t('sk.' + s.key + '.desc')) + '</span></span></' + (sel ? 'button' : 'div') + '>';
      }).join('') + '</div>').join('');
  }
  function skillsDialog() {
    openModal({ title: t('sk.book'), wide: true, body: '<p class="field-hint" style="margin-top:0">' + esc(t('help.skill1')) + ' ' + esc(t('help.skill2')) + '</p>' + skillCardsHtml(null) });
  }
  function deckPicker(initial) {
    return new Promise(resolve => {
      const sel = new Set(initial || []);
      let done = null;
      const body = document.createElement('div');
      const render = () => { body.innerHTML = '<p class="field-hint" style="margin-top:0">' + esc(t('deck.picked', { n: sel.size })) + '</p>' + skillCardsHtml(sel); };
      render();
      body.addEventListener('click', e => {
        const c = e.target.closest('[data-sk]');
        if (!c) return;
        const k = c.dataset.sk;
        if (sel.has(k)) sel.delete(k); else if (sel.size < 4) sel.add(k); else { toast(t('deck.needFour')); return; }
        A.play('select');
        render();
      });
      openModal({
        title: t('deck.pickTitle'), body, wide: true,
        actions: [{ label: t('btn.cancel'), ghost: true }, { label: t('btn.done'), primary: true, onClick: () => { if (sel.size !== 4) { toast(t('deck.needFour'), 'bad'); return false; } done = Array.from(sel); } }],
        onClose: () => resolve(done),
      });
    });
  }
  function askPromotion(side, chess) {
    return new Promise(resolve => {
      let picked = 0;
      const col = side === RED ? 'w' : 'b';
      const chars = window.XQPieceChars[S.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
      let body;
      if (chess) {
        const opts = [[2, 'Q', 'promo.q'], [5, 'R', 'promo.r'], [3, 'B', 'promo.b'], [4, 'N', 'promo.n']];
        body = '<p style="margin-top:0">' + esc(t('promo.ask')) + '</p><div class="promo-grid">' + opts.map(([tp, L, k]) => '<button type="button" class="promo-btn" data-tp="' + tp + '"><img src="assets/pieces/chess/' + col + L + '.svg" alt=""><span>' + esc(t(k)) + '</span></button>').join('') + '</div>';
      } else {
        const opts = [5, 4, 6];
        body = '<p style="margin-top:0">' + esc(t('promo.ask')) + '</p><div class="promo-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + opts.map(tp => { const code = (side << 3) | tp; let url = ''; try { url = board.pieceDataURL(code, 44); } catch (e) { url = ''; } return '<button type="button" class="promo-btn" data-tp="' + tp + '">' + (url ? '<img src="' + url + '" alt="">' : '') + '<span>' + esc(chars[code]) + '</span></button>'; }).join('') + '</div>';
      }
      const m = openModal({ title: t('promo.title'), body, onClose: () => resolve(picked) });
      m.body.addEventListener('click', e => { const b = e.target.closest('[data-tp]'); if (!b) return; picked = +b.dataset.tp; m.close(); });
    });
  }

  // ================================================================== 手機返回鍵
  // 開對話框、選單、棋譜面板時推一筆歷史紀錄；按返回鍵就關掉最上層，而不是離開網頁
  const overlays = [];
  let ignorePop = 0;
  function pushOverlay(closeFn) {
    if (inFrame || !window.history || !history.pushState) return () => {};
    const entry = { closeFn, active: true };
    try { history.pushState({ xqOverlay: true }, ''); } catch (e) { return () => {}; }
    overlays.push(entry);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1);
      ignorePop++;
      try { history.back(); } catch (e) { ignorePop--; }
    };
  }
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const entry = overlays.pop();
    if (entry && entry.active) { entry.active = false; entry.closeFn(); }
  });

  // ================================================================== 對話框
  const modalStack = [];
  function openModal(o) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const m = document.createElement('div');
    m.className = 'modal' + (o.wide ? ' wide' : '');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="modal-head"><h2 class="modal-title"></h2><button class="icon-btn" data-close aria-label="' + esc(t('btn.close')) + '"><svg class="ic"><use href="#i-close"/></svg></button></div><div class="modal-body"></div>' + (o.actions && o.actions.length ? '<div class="modal-foot"></div>' : '');
    $('.modal-title', m).textContent = o.title || '';
    const body = $('.modal-body', m);
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    let unhist = () => {};
    const close = val => {
      if (!wrap.parentNode) return;
      wrap.remove(); scrim.remove();
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      unhist();
      if (o.onClose) o.onClose(val);
    };
    const api = { el: m, body, close };
    if (o.actions) {
      const foot = $('.modal-foot', m);
      for (const a of o.actions) {
        const b = document.createElement('button');
        b.className = 'btn' + (a.primary ? ' primary' : '') + (a.ghost ? ' ghost' : '');
        b.textContent = a.label;
        if (a.id) b.id = a.id;
        b.onclick = () => { const r = a.onClick ? a.onClick(api) : undefined; if (r !== false) close(a.value); };
        foot.appendChild(b);
      }
    }
    $('[data-close]', m).onclick = () => close();
    scrim.onclick = () => close();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.appendChild(m);
    document.body.appendChild(scrim);
    document.body.appendChild(wrap);
    modalStack.push(api);
    unhist = pushOverlay(() => close());
    setTimeout(() => { const f = $('.btn.primary', m) || $('[data-close]', m); if (f && !o.noFocus) f.focus({ preventScroll: true }); }, 30);
    return api;
  }
  function confirmDialog(text, okLabel, cancelLabel) {
    return new Promise(resolve => {
      let result = false;
      openModal({
        title: t('confirm.title'), body: '<p>' + esc(text) + '</p>',
        actions: [{ label: cancelLabel || t('btn.cancel'), ghost: true }, { label: okLabel || t('btn.ok'), primary: true, onClick: () => { result = true; } }],
        onClose: () => resolve(result),
      });
    });
  }
  function seg(name, options, value) {
    return '<div class="seg" data-seg="' + name + '">' + options.map(([v, label]) => '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (String(v) === String(value)) + '">' + esc(label) + '</button>').join('') + '</div>';
  }
  function bindSeg(root, onChange) {
    $$('[data-seg]', root).forEach(s => s.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('button', s).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onChange(s.dataset.seg, b.dataset.v);
    }));
  }

  // ---------------------------------------------------------------- 新對局
  function deckPreview(choice, custom) {
    if (choice === 'random') return '<div class="deck-prev muted">' + esc(t('deck.random')) + ' × 4</div>';
    const keys = choice === 'custom' ? (custom || []) : (DECK_PRESETS[choice] || []);
    if (!keys.length) return '<div class="deck-prev muted">' + esc(t('deck.needFour')) + '</div>';
    return '<div class="deck-prev">' + keys.map(k => '<span class="deck-chip" title="' + esc(t('sk.' + k + '.desc')) + '">' + skIcon(k) + esc(t('sk.' + k + '.name')) + '</span>').join('') + '</div>';
  }
  function newGameDialog() {
    const o = Object.assign({}, DEFAULTS.lastNew, S.lastNew);
    if (!VXE) o.game = 'classic';
    o.customA = (o.customA || []).slice(); o.customB = (o.customB || []).slice();
    const levelGrid = key => '<div class="level-grid" data-levels="' + key + '">' + LEVELS.map((lv, i) => '<button type="button" data-lv="' + i + '" aria-pressed="' + (o[key] === i) + '"><b>' + esc(t('level.' + lv.key)) + '</b><small>' + esc(t('leveldesc.' + lv.key)) + '</small></button>').join('') + '</div>';
    const deckSeg = key => seg(key, DECK_KEYS.map(k => [k, t('deck.' + k)]).concat([['random', t('deck.random')], ['custom', t('deck.custom')]]), o[key]);
    const body = document.createElement('div');
    body.innerHTML =
      (VXE ? '<div class="field"><span class="field-label">' + esc(t('ng.game')) + '</span><div class="game-pick">' +
        ['classic', 'cvx', 'skill'].map(k => '<button type="button" class="gp gp-' + k + '" data-game="' + k + '" aria-pressed="' + (o.game === k) + '"><b>' + esc(t('game.' + k)) + '</b><small>' + esc(t('game.' + k + 'Desc')) + '</small></button>').join('') + '</div></div>' : '') +
      '<div class="field"><span class="field-label">' + esc(t('ng.mode')) + '</span>' + seg('mode', [['pvc', t('mode.pvc')], ['pvp', t('mode.pvp')], ['cvc', t('mode.cvc')]], o.mode) + '</div>' +
      '<div class="field" data-for="pvc"><span class="field-label">' + esc(t('ng.side')) + '</span>' + seg('side', [['red', t('ng.sideRed')], ['black', t('ng.sideBlack')], ['random', t('ng.sideRandom')]], o.side) + '</div>' +
      '<div class="field" data-g="cvx"><span class="field-label">' + esc(t('ng.armyFirst')) + '</span>' + seg('armyFirst', [['xq', t('army.xq')], ['chess', t('army.chess')]], o.armyFirst) + '</div>' +
      '<div class="field" data-g="cvx"><span class="field-label">' + esc(t('ng.cxStrength')) + '</span>' + seg('cxStrength', [['balanced', t('cx.balanced')], ['full', t('cx.full')]], o.cxStrength) + '</div>' +
      '<div class="field" data-g="cvx"><div class="row" style="padding:0"><label class="row-label" for="ngSkills">' + esc(t('ng.withSkills')) + '</label><span class="switch"><input type="checkbox" id="ngSkills"' + (o.cvxSkills ? ' checked' : '') + '><span></span></span></div></div>' +
      '<div class="field" data-g="skills"><span class="field-label" data-deck-label="A"></span>' + deckSeg('deckA') + '<div data-prev="A"></div></div>' +
      '<div class="field" data-g="skills"><span class="field-label" data-deck-label="B"></span>' + deckSeg('deckB') + '<div data-prev="B"></div></div>' +
      '<div class="field" data-for="pvc"><span class="field-label">' + esc(t('ng.level')) + '</span>' + levelGrid('level') + '</div>' +
      '<div class="field" data-for="cvc"><span class="field-label">' + esc(t('ng.redLevel')) + '</span>' + levelGrid('redLevel') + '</div>' +
      '<div class="field" data-for="cvc"><span class="field-label">' + esc(t('ng.blackLevel')) + '</span>' + levelGrid('blackLevel') + '</div>' +
      '<div class="field"><span class="field-label">' + esc(t('ng.time')) + '</span>' + seg('tc', TCS.map(x => [x.key, t('tc.' + x.key)]), o.tc) + '</div>' +
      '<div class="field" data-for="pvc" data-g="classic"><span class="field-label">' + esc(t('ng.handicap')) + '</span>' + seg('handicap', Object.keys(HANDICAPS).map(k => [k, t('hc.' + k)]), o.handicap) + '<div class="field-hint">' + esc(t('ng.handicapHint')) + '</div></div>' +
      '<p class="field-hint" data-g="cvx">' + esc(t('ng.cvxHint')) + '</p><p class="field-hint" data-g="skills">' + esc(t('ng.skillHint')) + '</p>';
    const skillsOn = () => o.game === 'skill' || (o.game === 'cvx' && o.cvxSkills);
    const sync = () => {
      $$('[data-for], [data-g]', body).forEach(f => {
        const g2 = f.dataset.g;
        const okMode = !f.dataset.for || f.dataset.for === o.mode;
        const okGame = !g2 || (g2 === 'skills' ? skillsOn() : g2 === o.game);
        f.hidden = !(okMode && okGame);
      });
      const lab = o.mode === 'pvc' ? ['ng.deckMine', 'ng.deckAi'] : ['ng.deckRed', 'ng.deckBlack'];
      $('[data-deck-label=A]', body).textContent = t(lab[0]);
      $('[data-deck-label=B]', body).textContent = t(lab[1]);
      $('[data-prev=A]', body).innerHTML = deckPreview(o.deckA, o.customA);
      $('[data-prev=B]', body).innerHTML = deckPreview(o.deckB, o.customB);
    };
    bindSeg(body, async (k, v) => {
      const prev = o[k];
      o[k] = v;
      if ((k === 'deckA' || k === 'deckB') && v === 'custom') {
        const ck = k === 'deckA' ? 'customA' : 'customB';
        const keys = await deckPicker(o[ck]);
        if (keys) o[ck] = keys;
        else if (o[ck].length !== 4) { o[k] = prev === 'custom' ? 'hero' : prev; $$('[data-seg=' + k + '] button', body).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === o[k]))); }
      }
      sync();
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-game]');
      if (!b) return;
      o.game = b.dataset.game;
      $$('[data-game]', body).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      A.play('select');
      sync();
    });
    const sk = $('#ngSkills', body);
    if (sk) sk.addEventListener('change', () => { o.cvxSkills = sk.checked; sync(); });
    $$('[data-levels]', body).forEach(grid => grid.addEventListener('click', e => {
      const b = e.target.closest('button[data-lv]');
      if (!b) return;
      $$('button', grid).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      o[grid.dataset.levels] = +b.dataset.lv;
    }));
    sync();
    openModal({
      title: t('ng.title'), body, wide: true,
      actions: [{ label: t('btn.cancel'), ghost: true }, {
        label: t('ng.start'), primary: true, onClick: () => {
          if (skillsOn() && ((o.deckA === 'custom' && o.customA.length !== 4) || (o.deckB === 'custom' && o.customB.length !== 4))) { toast(t('deck.needFour'), 'bad'); return false; }
          S.lastNew = o; saveSettings();
          const humanSide = o.side === 'random' ? (Math.random() < 0.5 ? RED : BLACK) : (o.side === 'black' ? BLACK : RED);
          const variant = o.game === 'classic' || !VXE ? null : makeVariantConf(o, humanSide);
          startGame({ mode: o.mode, humanSide, level: o.level, redLevel: o.redLevel, blackLevel: o.blackLevel, tc: o.tc, handicap: o.mode === 'pvc' && !variant ? o.handicap : 'none', variant });
          if (variant && variant.skills) setTimeout(() => toast(t('sk.tapInfo')), 900);
        },
      }],
    });
  }
  async function requestNewGame() {
    const g = game;
    if (g && !g.result && g.moves.length > 2 && (g.mode === 'pvc' || g.mode === 'pvp')) {
      const ok = await confirmDialog(t('confirm.newGame'), t('btn.continueNew'));
      if (!ok) return;
    }
    newGameDialog();
  }

  // ---------------------------------------------------------------- 結果
  function showResultDialog(rc) {
    const g = game, r = g.result;
    if (!r) return;
    if (g.mode === 'puzzle') {
      const ok = r.winner === RED;
      openModal({
        title: puzzleTitle(g),
        body: '<div class="result-hero"><div class="result-word' + (ok ? '' : ' black') + '">' + esc(ok ? t('banner.solved') : t('banner.failed')) + '</div><div class="result-reason">' + esc(ok ? t('pz.solved', { n: g.puzzle.n }) : t('pz.failed')) + '</div>' +
          (ok && g.daily ? '<div class="result-stats"><span>' + esc(t('daily.done', { s: dailyStreak() })) + '</span></div>' : '') + '</div>',
        actions: ok ? [{ label: t('btn.close'), ghost: true }, { label: t('btn.next'), primary: true, onClick: nextPuzzle }]
          : [{ label: t('btn.solution'), ghost: true, onClick: showSolution }, { label: t('btn.retry'), primary: true, onClick: () => startPuzzle(g.puzzle, { daily: g.daily }) }],
      });
      return;
    }
    const wordCls = r.winner == null ? ' draw' : (g.mode === 'pvc' ? (r.winner === g.humanSide ? '' : ' black') : (r.winner === RED ? '' : ' black'));
    let extra = '<span>' + esc(t('result.moves', { n: Math.ceil(g.moves.length / 2) })) + '</span>';
    if (rc) {
      const d = rc.after - rc.before;
      extra += '<span>' + esc(t('st.rating')) + ' ' + rc.before + ' → ' + rc.after + ' <span class="rating-delta ' + (d >= 0 ? 'up' : 'down') + '">(' + (d >= 0 ? '+' : '') + d + ')</span></span>';
    }
    if (g.opening) extra += '<span>' + esc(g.opening[S.lang] || g.opening['zh-TW']) + '</span>';
    if (isVar(g)) extra += '<span>' + esc(variantTitle(g.variant)) + '</span>';
    const again = () => {
      const o = S.lastNew;
      if (!(g.mode === 'pvc' || g.mode === 'pvp' || g.mode === 'cvc')) { newGameDialog(); return; }
      const humanSide = o.side === 'random' ? (Math.random() < 0.5 ? RED : BLACK) : g.humanSide;
      let variant = g.variant;
      if (variant && g.mode === 'pvc' && humanSide !== g.humanSide) variant = Object.assign({}, variant, { decks: [variant.decks[1], variant.decks[0]] });
      startGame({ mode: g.mode, humanSide, level: g.players[g.humanSide ^ 1].level, redLevel: g.players[0].level, blackLevel: g.players[1].level, tc: g.tc, handicap: g.handicap, variant });
    };
    const acts = [{ label: t('btn.close'), ghost: true }];
    if (!isVar(g)) acts.push({ label: t('btn.analyze'), onClick: () => { openLedger(); runReview(); } });
    acts.push({ label: t('btn.again'), primary: true, onClick: again });
    openModal({
      title: t('result.title'),
      body: '<div class="result-hero"><div class="result-word' + wordCls + '">' + esc(resultWord(r)) + '</div><div class="result-reason">' + esc(resultReason(r)) + '</div><div class="result-stats">' + extra + '</div></div>',
      actions: acts,
    });
  }

  // ---------------------------------------------------------------- 設定
  function settingsDialog() {
    const sw = (key, label, hint) => '<div class="row"><label class="row-label" for="set-' + key + '">' + esc(t(label)) + (hint ? '<small>' + esc(t(hint)) + '</small>' : '') + '</label><span class="switch"><input type="checkbox" id="set-' + key + '" data-key="' + key + '"' + (S[key] ? ' checked' : '') + '><span></span></span></div>';
    const sel = (key, label, opts) => '<div class="row"><label class="row-label" for="set-' + key + '">' + esc(t(label)) + '</label><select class="sel" id="set-' + key + '" data-key="' + key + '">' + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(S[key]) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>';
    const range = (key, label) => '<div class="row"><label class="row-label" for="set-' + key + '">' + esc(t(label)) + '</label><input type="range" id="set-' + key + '" data-key="' + key + '" min="0" max="1" step="0.05" value="' + S[key] + '"></div>';
    const body = document.createElement('div');
    body.className = 'settings-group';
    body.innerHTML =
      '<h3>' + esc(t('set.look')) + '</h3>' +
      sel('lang', 'set.lang', [['zh-TW', '繁體中文'], ['zh-CN', '简体中文'], ['en', 'English']]) +
      sel('theme', 'set.theme', [['auto', t('theme.auto')], ['light', t('theme.light')], ['dark', t('theme.dark')]]) +
      sel('board', 'set.board', window.XQBoardThemes.map(k => [k, t('board.' + k)])) +
      sel('pieces', 'set.pieces', window.XQPieceSets.map(k => [k, t('pieces.' + k)])) +
      sel('font', 'set.font', [['kai', t('font.kai')], ['song', t('font.song')], ['hei', t('font.hei')]]) +
      sel('notation', 'set.notation', [['auto', t('nt.auto')], ['cn', t('nt.cn')], ['wxf', t('nt.wxf')], ['iccs', t('nt.iccs')]]) +
      sel('anim', 'set.anim', ['off', 'fast', 'normal', 'slow'].map(k => [k, t('anim.' + k)])) +
      sw('coords', 'set.coords') + sw('targets', 'set.targets') + sw('last', 'set.last') +
      sw('evalBar', 'set.evalBar', 'set.evalBarHint') + sw('autoFlip', 'set.autoFlip', 'set.autoFlipHint') +
      '<h3>' + esc(t('set.soundGroup')) + '</h3>' +
      sw('sound', 'set.sound') + range('volume', 'set.volume') +
      sel('voice', 'set.voice', [['off', t('voice.off')], ['key', t('voice.key')], ['all', t('voice.all')]]) +
      '<div class="field-hint" id="voiceNote" hidden>' + esc(t('set.voiceMissing')) + '</div>' +
      sw('bgm', 'set.bgm') + sel('bgmTrack', 'set.bgmTrack', A.tracks.map((tr, i) => [i, tr.name[S.lang] || tr.name['zh-TW']])) + range('bgmVolume', 'set.bgmVolume') +
      ('vibrate' in navigator ? sw('vibrate', 'set.vibrate') : '<div class="row"><span class="row-label">' + esc(t('set.vibrate')) + '<small>' + esc(t('set.vibrateNA')) + '</small></span></div>') +
      '<h3>' + esc(t('set.rules')) + '</h3>' +
      sw('ruleCheck', 'set.ruleCheck', 'set.ruleCheckHint') + sw('ruleChase', 'set.ruleChase', 'set.ruleChaseHint') +
      sel('moveLimit', 'set.moveLimit', [[0, t('ml.off')], [50, t('ml.n', { n: 50 })], [60, t('ml.n', { n: 60 })], [100, t('ml.n', { n: 100 })]]) +
      sw('allowUndo', 'set.allowUndo', 'set.allowUndoHint') +
      '<h3>' + esc(t('set.other')) + '</h3>' +
      '<div class="row"><span class="row-label">' + esc(t('set.reset')) + '<small>' + esc(t('set.resetHint')) + '</small></span><button class="btn small" data-act="resetAll">' + esc(t('btn.clear')) + '</button></div>';
    const voiceNote = $('#voiceNote', body);
    voiceNote.hidden = S.voice === 'off' || A.hasVoice(S.lang);
    body.addEventListener('change', e => {
      const el = e.target.closest('[data-key]');
      if (!el) return;
      const k = el.dataset.key;
      let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      if (k === 'bgmTrack' || k === 'moveLimit') v = +v;
      S[k] = v;
      saveSettings();
      applySettings(k);
      if (k === 'voice') { voiceNote.hidden = v === 'off' || A.hasVoice(S.lang); if (v !== 'off') A.speak(t('voice.test'), true); }
      if (k === 'lang') { closeAllModals(); settingsDialog(); }
    });
    body.addEventListener('input', e => {
      const el = e.target;
      if (el.type !== 'range') return;
      S[el.dataset.key] = +el.value;
      applySettings(el.dataset.key);
    });
    body.addEventListener('click', async e => {
      if (!e.target.closest('[data-act=resetAll]')) return;
      const ok = await confirmDialog(t('set.resetConfirm'), t('btn.clear'));
      if (!ok) return;
      ['settings', 'stats', 'library', 'current'].forEach(k => Store.del(k));
      location.reload();
    });
    openModal({ title: t('set.title'), body, actions: [{ label: t('btn.done'), primary: true }], onClose: saveSettings });
  }
  function closeAllModals() { while (modalStack.length) modalStack[modalStack.length - 1].close(); }
  function applySettings(key) {
    const all = !key;
    if (all || key === 'theme') {
      if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', S.theme);
      if (reviewData) drawReviewChart();
    }
    if (all || ['board', 'pieces', 'font', 'lang'].includes(key)) board.setTheme(S.board, S.pieces, S.font, S.lang);
    if (all || ['coords', 'targets', 'last', 'anim'].includes(key)) board.setOptions({ coords: S.coords, showTargets: S.targets, showLast: S.last, animMs: ANIM_MS[S.anim] });
    if (all || ['sound', 'volume', 'voice', 'lang'].includes(key)) A.configure({ sound: S.sound, volume: S.volume, voice: S.voice, lang: S.lang });
    if (all || ['bgm', 'bgmTrack', 'bgmVolume'].includes(key)) A.setBgm(S.bgm, S.bgmTrack, S.bgmVolume);
    if (all || key === 'lang') { applyI18n(); renderDrawerCounts(); }
    if (all || ['sound', 'bgm'].includes(key)) {
      ui.btnSound.setAttribute('aria-pressed', String(S.sound));
      ui.btnMusic.setAttribute('aria-pressed', String(S.bgm));
      $('use', ui.btnSound).setAttribute('href', S.sound ? '#i-sound' : '#i-sound-off');
      $('use', ui.btnMusic).setAttribute('href', S.bgm ? '#i-music' : '#i-music-off');
    }
    if (key === 'evalBar' || key === 'showArrow') maybeAnalyze();
    if (game && !all) renderAll();
  }

  // ---------------------------------------------------------------- 殺法題
  function puzzlesDialog() {
    const groups = {};
    PUZZLES.forEach(p => { (groups[p.n] = groups[p.n] || []).push(p); });
    const solved = Object.keys(stats.puzzles).filter(k => stats.puzzles[k]).length;
    let html = '<p>' + esc(t('pz.intro')) + '</p><p class="field-hint" style="margin-top:-4px">' + esc(t('pz.total', { a: solved, b: PUZZLES.length })) + '</p>';
    for (const n of Object.keys(groups).sort((a, b) => a - b)) {
      const list = groups[n], done = list.filter(p => stats.puzzles[p.id]).length;
      html += '<div class="pz-group"><h3>' + esc(t('pz.group', { n })) + '<small>' + esc(t('pz.progress', { a: done, b: list.length })) + '</small></h3><div class="pz-grid">' +
        list.map((p, i) => '<button class="pz' + (stats.puzzles[p.id] ? ' solved' : '') + '" data-pz="' + p.id + '" aria-label="' + esc(t('pz.label', { n, i: i + 1 })) + '">' + (i + 1) + '</button>').join('') + '</div></div>';
    }
    const m = openModal({ title: t('pz.title'), body: html, wide: true });
    m.body.addEventListener('click', e => {
      const b = e.target.closest('[data-pz]');
      if (!b) return;
      m.close();
      startPuzzle(PUZZLES.find(p => p.id === b.dataset.pz));
    });
  }

  // ---------------------------------------------------------------- 匯出、匯入
  function pgnText(fmt) {
    const g = game;
    const d = new Date(g.created);
    const date = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    const res = g.result ? (g.result.winner == null ? '1/2-1/2' : g.result.winner === RED ? '1-0' : '0-1') : '*';
    if (isVar(g)) {
      const v = g.variant;
      const head = [['Game', v.kind === 'cvx' ? 'Xiangqi vs Chess' : 'Xiangqi Magic Skills'], ['Event', variantTitle(v) + ' · ' + t('mode.' + g.mode)], ['Date', date], ['Red', playerName(RED)], ['Black', playerName(BLACK)], ['Result', res], ['Armies', v.armies.join('-')]];
      if (v.kind === 'cvx') head.push(['Strength', v.queen ? 'full' : 'balanced']);
      if (v.skills) head.push(['RedSkills', v.decks[0].map(id => VXE.SKILLS[id].key).join(',')], ['BlackSkills', v.decks[1].map(id => VXE.SKILLS[id].key).join(',')]);
      const turns = [];
      g.moves.forEach(m => { const txt = fmt === 'iccs' ? m.iccs : notationOf(m); const last = turns[turns.length - 1]; if (last && last.side === m.side) last.txt.push(txt); else turns.push({ side: m.side, txt: [txt] }); });
      const lines = [];
      for (let k = 0; k < turns.length; k += 2) lines.push((k / 2 + 1) + '. ' + turns[k].txt.join(' + ') + (turns[k + 1] ? '  ' + turns[k + 1].txt.join(' + ') : ''));
      return head.map(([k, val]) => '[' + k + ' "' + String(val).replace(/"/g, "'") + '"]').join('\n') + '\n\n' + lines.join('\n') + (res !== '*' ? '\n' + res : '') + '\n';
    }
    const head = [['Game', 'Chinese Chess'], ['Event', t('mode.' + g.mode)], ['Date', date], ['Red', playerName(RED)], ['Black', playerName(BLACK)], ['Result', res]];
    if (g.opening) head.push(['Opening', g.opening['zh-TW']]);
    if (g.startFen !== XQ.START_FEN) head.push(['FEN', g.startFen]);
    head.push(['Format', fmt === 'iccs' ? 'ICCS' : fmt === 'wxf' ? 'WXF' : 'Chinese']);
    let s = head.map(([k, v]) => '[' + k + ' "' + String(v).replace(/"/g, "'") + '"]').join('\n') + '\n\n';
    const parts = [];
    const firstBlack = g.sides[0] === BLACK;
    g.moves.forEach((m, i) => {
      const txt = fmt === 'iccs' ? m.iccs.slice(0, 2).toUpperCase() + '-' + m.iccs.slice(2).toUpperCase() : fmt === 'wxf' ? m.wxf : (S.lang === 'zh-CN' ? m.cn : m.tw);
      const idx = i + (firstBlack ? 1 : 0);
      if (idx % 2 === 0) parts.push((idx / 2 + 1) + '. ' + txt);
      else if (i === 0) parts.push('1. ... ' + txt);
      else parts[parts.length - 1] += ' ' + txt;
    });
    return s + parts.join('\n') + (res !== '*' ? '\n' + res : '') + '\n';
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast(t('toast.copied'), 'good'); return true; }
    catch (e) { toast(t('toast.copyFailed'), 'bad'); return false; }
  }
  async function saveFile(name, data) {
    if (downloadsApi) {
      try {
        await downloadsApi.save({ filename: name.replace(/\.pgn$/i, '.txt'), data });
        return true;
      } catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && (e.code === 'unavailable' || e.code === 'not_granted')) { downloadsApi = null; }
        else { toast(t('toast.saveFailed'), 'bad'); return false; }
      }
    }
    if (inFrame) { toast(t('toast.saveFailed'), 'bad'); return false; }
    try {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) { toast(t('toast.saveFailed'), 'bad'); return false; }
  }
  // iPhone、Android 的分享選單（存到「檔案」、AirDrop、訊息…）
  async function shareData(name, blob, text) {
    try {
      const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: t('app.docTitle') });
      else if (text) await navigator.share({ text, title: t('app.docTitle') });
      else { saveFile(name, blob); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      saveFile(name, blob);
    }
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); };
  function exportDialog() {
    const g = game;
    if (!g) return;
    let fmt = isVar(g) ? 'cn' : S.lang === 'en' ? 'wxf' : 'cn';
    const body = document.createElement('div');
    const fen = isVar(g) ? '' : positionAt(g.viewPly).toFen(Math.floor(g.viewPly / 2) + 1);
    const canShare = !!navigator.share;
    const fmts = isVar(g) ? [['cn', t('io.readable')], ['iccs', t('nt.iccs')]] : [['cn', t('nt.cn')], ['wxf', t('nt.wxf')], ['iccs', t('nt.iccs')]];
    body.innerHTML =
      '<div class="field"><span class="field-label">' + esc(t('io.format')) + '</span>' + seg('fmt', fmts, fmt) + '</div>' +
      '<div class="field"><label class="field-label" for="pgnOut">' + esc(t('io.pgn')) + '</label><textarea class="ta" id="pgnOut" readonly></textarea>' +
      '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small" data-act="copyPgn">' + esc(t('btn.copy')) + '</button><button class="btn small" data-act="dlPgn">' + esc(t('btn.download')) + '</button>' + (canShare ? '<button class="btn small" data-act="sharePgn">' + esc(t('btn.share')) + '</button>' : '') + '<button class="btn small" data-act="savePgn">' + esc(t('btn.save')) + '</button></div></div>' +
      (isVar(g) ? '' : '<div class="field"><label class="field-label" for="fenOut">' + esc(t('io.fen')) + '</label><textarea class="ta" id="fenOut" readonly style="min-height:64px">' + esc(fen) + '</textarea>' +
      '<div style="margin-top:8px"><button class="btn small" data-act="copyFen2">' + esc(t('btn.copy')) + '</button></div></div>') +
      '<div class="field"><span class="field-label">' + esc(t('io.image')) + '</span><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-act="dlImg">' + esc(t('io.saveImage')) + '</button>' + (canShare ? '<button class="btn small" data-act="shareImg">' + esc(t('btn.share')) + '</button>' : '') + '</div></div>';
    const out = $('#pgnOut', body);
    const refresh = () => { out.value = pgnText(fmt); };
    refresh();
    bindSeg(body, (k, v) => { fmt = v; refresh(); });
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'copyPgn') { out.select(); copyText(out.value); }
      else if (act === 'dlPgn') saveFile('xiangqi-' + stamp() + '.pgn', out.value);
      else if (act === 'savePgn') { saveToLibrary(game, false); toast(t('toast.saved'), 'good'); }
      else if (act === 'copyFen2') { const f = $('#fenOut', body); f.select(); copyText(f.value); }
      else if (act === 'dlImg') board.toBlob(blob => { if (blob) saveFile('xiangqi-' + stamp() + '.png', blob); else toast(t('toast.saveFailed'), 'bad'); });
      else if (act === 'sharePgn') shareData('xiangqi-' + stamp() + '.txt', new Blob([out.value], { type: 'text/plain' }), out.value);
      else if (act === 'shareImg') board.toBlob(blob => { if (blob) shareData('xiangqi-' + stamp() + '.png', blob, null); });
    });
    openModal({ title: t('io.exportTitle'), body, wide: true });
  }
  function parseGameText(text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) return null;
    const headers = {};
    text = text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (m, k, v) => { headers[k] = v; return ' '; });
    let fen = headers.FEN || XQ.START_FEN;
    const fenOnly = /^[rnbakcpheRNBAKCPHE1-9]+(\/[rnbakcpheRNBAKCPHE1-9]+){9}(\s+[wbr])?/.exec(text.trim());
    const validFen = f => { try { const p = new XQ.Position(f); return !XQ.validateSetup(p) && p.hasLegalMove(); } catch (e) { return false; } };
    if (fenOnly && text.trim().split(/\s+/).length <= 6) return validFen(text.trim()) ? { fen: text.trim(), moves: [], headers } : null;
    if (!validFen(fen)) fen = XQ.START_FEN;
    const body = text.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/;[^\n]*/g, ' ');
    const tokens = body.split(/[\s,，、。]+/).map(x => x.replace(/^\d+\.+/, '').replace(/^\.+/, '')).filter(x => x && !/^\d+\.?$/.test(x) && !/^(1-0|0-1|1\/2-1\/2|\*|…|\.\.\.)$/.test(x));
    const pos = new XQ.Position(fen);
    const moves = [];
    for (const tok of tokens) {
      const mv = XQ.parseMove(pos, tok);
      if (!mv) {
        if (!moves.length && tokens.length > 1) continue;
        break;
      }
      pos.makeMove(mv);
      moves.push(XQ.moveToIccs(mv));
    }
    if (!moves.length && fen === XQ.START_FEN) return null;
    return { fen, moves, headers };
  }
  function importDialog() {
    const body = document.createElement('div');
    body.innerHTML = '<p>' + esc(t('io.importHint')) + '</p><textarea class="ta" id="importText" placeholder="1. 炮二平五 馬８進７&#10;2. 傌二進三 車９平８"></textarea>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"><label class="btn small" for="importFile">' + esc(t('io.chooseFile')) + '</label><input type="file" id="importFile" accept=".pgn,.txt,.text,text/plain" hidden><span class="field-hint" id="importName"></span></div>';
    const ta = $('#importText', body);
    $('#importFile', body).addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      $('#importName', body).textContent = f.name;
      const r = new FileReader();
      r.onload = () => { ta.value = String(r.result || ''); };
      r.readAsText(f);
    });
    openModal({
      title: t('io.importTitle'), body, wide: true,
      actions: [{ label: t('btn.cancel'), ghost: true }, {
        label: t('btn.import'), primary: true, onClick: () => {
          const res = parseGameText(ta.value);
          if (!res) { toast(t('toast.importFailed'), 'bad'); return false; }
          loadForReview(res);
          toast(t('toast.imported', { n: res.moves.length }), 'good');
        },
      }],
    });
  }
  function loadForReview(res) {
    const h = res.headers || {};
    let result = null;
    if (h.Result === '1-0') result = { winner: RED, reason: 'recorded' };
    else if (h.Result === '0-1') result = { winner: BLACK, reason: 'recorded' };
    else if (h.Result === '1/2-1/2') result = { winner: null, reason: 'recorded' };
    startGame({ mode: 'review', fen: res.fen, variant: res.variant || null, moves: res.moves, headers: h, silent: true, viewPly: 0, result, id: res.id, created: res.created });
    showTab('moves');
  }

  // ---------------------------------------------------------------- 我的棋譜
  function saveToLibrary(g, auto) {
    const lib = Store.get('library', []);
    const entry = {
      id: g.id, date: g.created, mode: g.mode, red: playerName(RED), black: playerName(BLACK), result: g.result,
      startFen: g.startFen, moves: g.moves.map(m => m.iccs), opening: g.opening, tc: g.tc, auto: !!auto, variant: g.variant || null,
    };
    const i = lib.findIndex(x => x.id === g.id);
    if (i >= 0) lib.splice(i, 1);
    lib.unshift(entry);
    Store.set('library', lib.slice(0, 200));
    g.saved = true;
  }
  function libraryDialog() {
    const render = () => {
      const lib = Store.get('library', []);
      if (!lib.length) return '<p>' + esc(t('lib.empty')) + '</p>';
      return '<div class="lib-list">' + lib.map(e => {
        const res = e.result ? (e.result.winner == null ? t('result.draw') : e.result.winner === RED ? t('result.redWin') : t('result.blackWin')) : t('lib.unfinished');
        const date = new Date(e.date).toLocaleString(S.lang === 'en' ? 'en' : S.lang, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const op = (e.variant ? variantTitle(e.variant) + ' · ' : '') + (e.opening ? (e.opening[S.lang] || e.opening['zh-TW']) + ' · ' : '');
        return '<div class="lib-item"><div class="lib-main"><div class="lib-title">' + esc(e.red + ' vs ' + e.black) + ' — ' + esc(res) + '</div><div class="lib-sub">' + esc(date + ' · ' + op + t('lib.moves', { n: Math.ceil(e.moves.length / 2) }) + ' · ' + t('mode.' + e.mode)) + '</div></div>' +
          '<div class="lib-actions"><button class="btn small" data-load="' + e.id + '">' + esc(t('btn.review')) + '</button><button class="icon-btn" data-del="' + e.id + '" aria-label="' + esc(t('btn.delete')) + '"><svg class="ic"><use href="#i-trash"/></svg></button></div></div>';
      }).join('') + '</div>';
    };
    const m = openModal({ title: t('lib.title'), body: render(), wide: true });
    m.body.addEventListener('click', async e => {
      const ld = e.target.closest('[data-load]'), del = e.target.closest('[data-del]');
      const lib = Store.get('library', []);
      if (ld) {
        const entry = lib.find(x => x.id === ld.dataset.load);
        if (!entry) return;
        m.close();
        loadForReview({ fen: entry.startFen || undefined, variant: entry.variant || null, moves: entry.moves, headers: { Red: entry.red, Black: entry.black, Result: entry.result ? (entry.result.winner == null ? '1/2-1/2' : entry.result.winner === RED ? '1-0' : '0-1') : '*' }, id: entry.id, created: entry.date });
        if (entry.result) game.result = entry.result;
        game.opening = entry.opening || game.opening;
        renderAll();
      } else if (del) {
        Store.set('library', lib.filter(x => x.id !== del.dataset.del));
        m.body.innerHTML = render();
      }
    });
  }

  // ---------------------------------------------------------------- 戰績
  function statsDialog() {
    const s = stats;
    let w = 0, d = 0, l = 0;
    Object.values(s.levels).forEach(x => { w += x.w; d += x.d; l += x.l; });
    const solved = Object.keys(s.puzzles).filter(k => s.puzzles[k]).length;
    const body = '<div class="stat-grid">' +
      '<div class="stat"><b>' + s.rating + '</b><span>' + esc(t('st.rating')) + '</span></div>' +
      '<div class="stat"><b>' + (w + d + l) + '</b><span>' + esc(t('st.games')) + '</span></div>' +
      '<div class="stat"><b>' + w + ' / ' + d + ' / ' + l + '</b><span>' + esc(t('st.wdl')) + '</span></div>' +
      '<div class="stat"><b>' + s.bestStreak + '</b><span>' + esc(t('st.streak')) + '</span></div>' +
      '<div class="stat"><b>' + solved + '/' + PUZZLES.length + '</b><span>' + esc(t('st.puzzles')) + '</span></div>' +
      '<div class="stat"><b>' + dailyStreak() + ' / ' + ((s.daily || {}).best || 0) + '</b><span>' + esc(t('st.daily')) + '</span></div>' +
      '<div class="stat"><b>' + achCount() + '/' + ACH_LIST.length + '</b><span>' + esc(t('menu.achievements')) + '</span></div>' +
      '</div><h3 style="font:700 15px/1.3 var(--font-display);margin:0 0 6px">' + esc(t('st.byLevel')) + '</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(t('st.level')) + '</th><th>' + esc(t('st.wins')) + '</th><th>' + esc(t('st.draws')) + '</th><th>' + esc(t('st.losses')) + '</th><th>' + esc(t('st.winRate')) + '</th></tr></thead><tbody>' +
      LEVELS.map(lv => { const x = s.levels[lv.key] || { w: 0, d: 0, l: 0 }; const n = x.w + x.d + x.l; return '<tr><td>' + esc(t('level.' + lv.key)) + '</td><td>' + x.w + '</td><td>' + x.d + '</td><td>' + x.l + '</td><td>' + (n ? Math.round((x.w + x.d * 0.5) / n * 100) + '%' : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      (VXE ? '<h3 style="font:700 15px/1.3 var(--font-display);margin:14px 0 6px">' + esc(t('ng.game')) + '</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(t('ng.game')) + '</th><th>' + esc(t('st.wins')) + '</th><th>' + esc(t('st.draws')) + '</th><th>' + esc(t('st.losses')) + '</th><th>' + esc(t('st.winRate')) + '</th></tr></thead><tbody>' +
        ['cvx', 'skill'].map(k => { const x = (s.variants || {})[k] || { w: 0, d: 0, l: 0 }; const n = x.w + x.d + x.l; return '<tr><td>' + esc(t('game.' + k)) + '</td><td>' + x.w + '</td><td>' + x.d + '</td><td>' + x.l + '</td><td>' + (n ? Math.round((x.w + x.d * 0.5) / n * 100) + '%' : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '<p class="field-hint">' + esc(t('st.note')) + '</p>';
    openModal({
      title: t('st.title'), body, wide: true,
      actions: [{ label: t('st.reset'), ghost: true, onClick: () => { confirmDialog(t('st.resetConfirm'), t('btn.clear')).then(ok => { if (ok) { stats = { rating: 1200, games: 0, levels: {}, streak: 0, bestStreak: 0, puzzles: {}, hints: 0, undos: 0 }; Store.set('stats', stats); toast(t('toast.done')); } }); } }, { label: t('btn.close'), primary: true }],
    });
  }

  // ---------------------------------------------------------------- 說明、關於、安裝
  function helpDialog() {
    const chars = window.XQPieceChars[S.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
    const pair = (r, b) => '<span class="pair"><span class="cap-piece red" style="width:26px;height:26px;font-size:15px">' + chars[r] + '</span><span class="cap-piece black" style="width:26px;height:26px;font-size:15px">' + chars[b] + '</span></span>';
    const rules = [[1, 9, 'help.king'], [2, 10, 'help.advisor'], [3, 11, 'help.bishop'], [4, 12, 'help.knight'], [5, 13, 'help.rook'], [6, 14, 'help.cannon'], [7, 15, 'help.pawn']];
    const body = '<div class="help"><h3>' + esc(t('help.goalT')) + '</h3><p>' + esc(t('help.goal')) + '</p>' +
      '<h3>' + esc(t('help.piecesT')) + '</h3><div class="piece-rules">' + rules.map(([r, b, k]) => '<div class="piece-rule">' + pair(r, b) + '<p style="margin:0">' + esc(t(k)) + '</p></div>').join('') + '</div>' +
      '<h3>' + esc(t('help.endT')) + '</h3><ul>' + ['help.end1', 'help.end2', 'help.end3', 'help.end4', 'help.end5'].map(k => '<li>' + esc(t(k)) + '</li>').join('') + '</ul>' +
      '<h3>' + esc(t('help.notationT')) + '</h3><p>' + esc(t('help.notation')) + '</p>' +
      (VXE ? '<h3>' + esc(t('help.cvxT')) + '</h3>' + ['help.cvx1', 'help.cvx2', 'help.cvx3', 'help.cvx4'].map(k => '<p>' + esc(t(k)) + '</p>').join('') +
        '<h3>' + esc(t('help.skillT')) + '</h3>' + ['help.skill1', 'help.skill2', 'help.skill3'].map(k => '<p>' + esc(t(k)) + '</p>').join('') +
        '<p><button class="btn small" data-act="skills">' + esc(t('sk.book')) + '</button></p>' : '') +
      '<h3>' + esc(t('help.controlsT')) + '</h3><ul>' + ['help.c1', 'help.c2', 'help.c3', 'help.c4'].map(k => '<li>' + t(k) + '</li>').join('') + '</ul></div>';
    openModal({ title: t('menu.help'), body, wide: true });
  }
  function aboutDialog() {
    const body = '<div class="help credits"><p>' + esc(t('about.intro')) + '</p><h3>' + esc(t('about.assets')) + '</h3><ul>' +
      '<li>' + t('about.textures') + '</li><li>' + t('about.pieces') + '</li><li>' + t('about.chess') + '</li><li>' + t('about.icons') + '</li><li>' + t('about.sounds') + '</li><li>' + t('about.music') + '</li><li>' + t('about.font') + '</li></ul>' +
      '<h3>' + esc(t('about.engineT')) + '</h3><p>' + esc(t('about.engine')) + '</p><p>' + esc(t('about.puzzles', { n: PUZZLES.length })) + '</p></div>';
    openModal({ title: t('menu.about'), body, wide: true });
  }
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  function installDialog() {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; }); return; }
    const share = '<svg class="ic" style="width:18px;height:18px;vertical-align:-3px" aria-hidden="true"><use href="#i-share"/></svg>';
    const iosNow = isIOS() && !isStandalone();
    const body = '<div class="help">' + (isStandalone() ? '<p class="install-now">' + esc(t('install.standalone')) + '</p>' : '') +
      (iosNow ? '<p class="install-now">' + share + ' ' + esc(t('install.iosNow')) + '</p>' : '') +
      '<p>' + esc(t('install.intro')) + '</p><h3>iPhone / iPad</h3><p>' + esc(t('install.ios')) + '</p><h3>Android</h3><p>' + esc(t('install.android')) + '</p><h3>' + esc(t('install.pcT')) + '</h3><p>' + esc(t('install.pc')) + '</p></div>';
    openModal({ title: t('menu.install'), body });
  }

  // ================================================================== 擺棋
  const PAL = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  const LIMIT = [0, 1, 2, 2, 2, 2, 2, 5];
  function enterEditor(fromCurrent) {
    stopEverything();
    analyzer.cancel();
    const g = game;
    if (isVar(g)) fromCurrent = false;
    skillState = null;
    const src = fromCurrent && g ? g.boards[g.viewPly] : new XQ.Position(XQ.START_FEN).board;
    editState = { board: Int8Array.from(src), side: fromCurrent && g ? g.sides[g.viewPly] : RED, brush: null, pick: -1 };
    board.setOptions({ coordStyle: 'xq', riverText: null });
    selected = -1; hintArrow = null;
    closeLedger();
    renderEditorBar();
    ui.editorBar.hidden = false;
    renderAll();
  }
  function exitEditor(silent) {
    if (!editState) return;
    editState = null;
    ui.editorBar.hidden = true;
    const cvx = !!(game && game.variant && game.variant.kind === 'cvx');
    board.setOptions({ coordStyle: cvx ? 'iccs' : 'xq', riverText: cvx ? RIVER_CVX : null });
    if (!silent && game) { renderAll(); scheduleTurn(); }
  }
  function validSquare(pc, sq) {
    const t2 = pc & 7, sd = pc >> 3, f = sq % 9, r0 = (sq / 9) | 0, r = sd === RED ? r0 : 9 - r0;
    if (t2 === 1) return f >= 3 && f <= 5 && r <= 2;
    if (t2 === 2) return [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]].some(([x, y]) => x === f && y === r);
    if (t2 === 3) return [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]].some(([x, y]) => x === f && y === r);
    if (t2 === 7) return r >= 5 || (r >= 3 && f % 2 === 0);
    return true;
  }
  function countPiece(pc) { let n = 0; for (const x of editState.board) if (x === pc) n++; return n; }
  function editorTap(sq) {
    const E = editState, cur = E.board[sq];
    if (E.brush === 'erase') { if (cur) { E.board[sq] = 0; A.play('select'); } }
    else if (E.brush) {
      const pc = E.brush;
      if (cur === pc) { E.board[sq] = 0; }
      else if (!validSquare(pc, sq)) { toast(t('toast.placeInvalid'), 'bad'); A.play('illegal'); return; }
      else if (countPiece(pc) >= LIMIT[pc & 7]) {
        if ((pc & 7) === 1) { for (let i = 0; i < 90; i++) if (E.board[i] === pc) E.board[i] = 0; E.board[sq] = pc; }
        else { toast(t('toast.tooMany'), 'bad'); A.play('illegal'); return; }
      } else E.board[sq] = pc;
      A.play('move', 0.7);
    } else if (E.pick >= 0) {
      if (E.pick !== sq) editorDrop(E.pick, sq);
      E.pick = -1;
      board.select(-1, []);
    } else if (cur) { E.pick = sq; board.select(sq, []); return; }
    renderEditorBar();
    board.setPosition(E.board, {});
  }
  function editorDrop(from, to) {
    const E = editState, pc = E.board[from];
    if (!pc) return;
    if (to < 0) { E.board[from] = 0; }
    else if (to !== from) {
      if (!validSquare(pc, to)) { toast(t('toast.placeInvalid'), 'bad'); A.play('illegal'); board.setPosition(E.board, {}); return; }
      E.board[to] = pc; E.board[from] = 0;
      A.play('move', 0.7);
    }
    E.pick = -1;
    renderEditorBar();
    board.setPosition(E.board, {});
  }
  function renderEditorBar() {
    const E = editState;
    if (!E) return;
    const chars = window.XQPieceChars[S.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'];
    const pal = PAL.map(pc => {
      const left = LIMIT[pc & 7] - countPiece(pc);
      return '<button class="pal ' + (pc < 8 ? 'red' : 'black') + '" data-pc="' + pc + '" aria-pressed="' + (E.brush === pc) + '" title="' + left + '">' + chars[pc] + '</button>';
    });
    pal.splice(7, 0, '<button class="pal erase" data-pc="erase" aria-pressed="' + (E.brush === 'erase') + '">' + esc(t('ed.erase')) + '</button>');
    ui.editorBar.innerHTML = '<div class="palette">' + pal.join('') + '</div>' +
      '<div class="editor-actions">' + seg('edSide', [[RED, t('ed.redToMove')], [BLACK, t('ed.blackToMove')]], E.side) +
      '<button class="btn small" data-ed="clear">' + esc(t('btn.clear')) + '</button><button class="btn small" data-ed="initial">' + esc(t('btn.initial')) + '</button>' +
      '<button class="btn small" data-ed="flip">' + esc(t('tool.flip')) + '</button><button class="btn small" data-ed="fen">' + esc(t('btn.pasteFen')) + '</button>' +
      '<button class="btn small ghost" data-ed="exit">' + esc(t('ed.exit')) + '</button><button class="btn small primary" data-ed="done">' + esc(t('btn.done')) + '</button></div>';
  }
  function editorAction(act) {
    const E = editState;
    if (act === 'clear') { E.board = new Int8Array(90); E.board[4] = 1; E.board[84] = 9; }
    else if (act === 'initial') { E.board = Int8Array.from(new XQ.Position(XQ.START_FEN).board); E.side = RED; }
    else if (act === 'flip') { flip(); return; }
    else if (act === 'exit') { exitEditor(false); return; }
    else if (act === 'fen') {
      const body = '<textarea class="ta" id="fenIn" style="min-height:80px" placeholder="rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"></textarea>';
      openModal({
        title: t('btn.pasteFen'), body,
        actions: [{ label: t('btn.cancel'), ghost: true }, {
          label: t('btn.ok'), primary: true, onClick: m => {
            try { const p = new XQ.Position($('#fenIn', m.el).value.trim()); E.board = Int8Array.from(p.board); E.side = p.side; renderEditorBar(); board.setPosition(E.board, {}); renderCards(); }
            catch (e) { toast(t('toast.importFailed'), 'bad'); return false; }
          },
        }],
      });
      return;
    } else if (act === 'done') { editorDone(); return; }
    renderEditorBar();
    board.setPosition(E.board, {});
    renderCards();
  }
  function editorFen() {
    const p = new XQ.Position();
    for (let i = 0; i < 90; i++) if (editState.board[i]) p.addPiece(i, editState.board[i]);
    if (editState.side === BLACK) p.changeSide();
    p.chkList = [p.kingAttacked(p.side)];
    return p;
  }
  function editorDone() {
    const p = editorFen();
    const err = XQ.validateSetup(p);
    if (err) { toast(t('setup.' + err), 'bad'); A.play('illegal'); return; }
    if (!p.hasLegalMove()) { toast(t('setup.nomoves'), 'bad'); return; }
    const fen = p.toFen();
    const body = document.createElement('div');
    body.innerHTML = '<p>' + esc(t('ed.startWith')) + '</p><div style="display:grid;gap:8px">' +
      '<button class="btn" data-go="red">' + esc(t('ed.playRed')) + '</button><button class="btn" data-go="black">' + esc(t('ed.playBlack')) + '</button>' +
      '<button class="btn" data-go="pvp">' + esc(t('mode.pvp')) + '</button><button class="btn primary" data-go="analysis">' + esc(t('mode.analysis')) + '</button></div>';
    const m = openModal({ title: t('ed.title'), body });
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      m.close();
      const go = b.dataset.go, flipNow = board.flipped;
      if (go === 'red' || go === 'black') startGame({ mode: 'pvc', fen, humanSide: go === 'red' ? RED : BLACK, level: S.lastNew.level, tc: 'none' });
      else if (go === 'pvp') startGame({ mode: 'pvp', fen, flip: flipNow });
      else { startGame({ mode: 'analysis', fen, flip: flipNow }); analysisOn = true; maybeAnalyze(); openLedger('analysis'); }
    });
  }

  // ================================================================== 抽屜選單、手機底部棋譜
  function openDrawer() {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const d = ui.drawerTpl.content.firstElementChild.cloneNode(true);
    applyI18n(d);
    $$('[data-count]', d).forEach(el => { el.textContent = t(el.dataset.count, { n: PUZZLES.length }); });
    const doneToday = (stats.daily || {}).last === todayKey();
    $$('[data-daily-sub]', d).forEach(el => { el.textContent = doneToday ? t('daily.subDone', { s: dailyStreak() }) : t('daily.sub', { n: dailyPuzzle().n, s: dailyStreak() }); });
    $$('[data-ach-sub]', d).forEach(el => { el.textContent = t('ach.sub', { a: achCount(), b: ACH_LIST.length }); });
    if (inFrame) $$('[data-menu=install]', d).forEach(el => { el.hidden = true; });
    let unhist = () => {};
    const close = () => { d.remove(); scrim.remove(); unhist(); };
    unhist = pushOverlay(close);
    scrim.onclick = close;
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      close();
      menuAction(b.dataset.menu);
    });
    document.body.appendChild(scrim);
    document.body.appendChild(d);
    const first = $('.drawer-item', d);
    if (first) first.focus();
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
  }
  function renderDrawerCounts() { /* 選單每次開啟時重建 */ }
  function menuAction(k) {
    if (k === 'new') requestNewGame();
    else if (k === 'puzzles') puzzlesDialog();
    else if (k === 'analysis') { startGame({ mode: 'analysis', fen: game && !isVar(game) ? positionAt(game.viewPly).toFen() : XQ.START_FEN, silent: true, flip: board.flipped }); analysisOn = true; maybeAnalyze(); openLedger('analysis'); }
    else if (k === 'skills') skillsDialog();
    else if (k === 'daily') startDaily();
    else if (k === 'achievements') achievementsDialog();
    else if (k === 'edit') enterEditor(true);
    else if (k === 'import') importDialog();
    else if (k === 'export') exportDialog();
    else if (k === 'library') libraryDialog();
    else if (k === 'stats') statsDialog();
    else if (k === 'settings') settingsDialog();
    else if (k === 'help') helpDialog();
    else if (k === 'about') aboutDialog();
    else if (k === 'install') installDialog();
  }
  const isMobile = () => window.matchMedia('(max-width: 899px)').matches && !window.matchMedia('(min-width: 600px) and (orientation: landscape)').matches;
  function openLedger(tab) {
    if (tab) showTab(tab);
    if (!isMobile()) return;
    const wasOpen = ui.ledger.classList.contains('open');
    ui.ledger.classList.add('open');
    if (!ui.ledgerScrim) {
      const s = document.createElement('div');
      s.className = 'scrim';
      s.style.zIndex = 44;
      s.onclick = closeLedger;
      document.body.appendChild(s);
      ui.ledgerScrim = s;
    }
    if (!wasOpen) ui.ledgerUnhist = pushOverlay(closeLedger);
    renderMoveList();
  }
  function closeLedger() {
    ui.ledger.classList.remove('open');
    if (ui.ledgerScrim) { ui.ledgerScrim.remove(); ui.ledgerScrim = null; }
    if (ui.ledgerUnhist) { const u = ui.ledgerUnhist; ui.ledgerUnhist = null; u(); }
  }

  // ================================================================== 存續
  function serialize(g) {
    return {
      v: 1, id: g.id, created: g.created, mode: g.mode, startFen: g.startFen, moves: g.moves.map(m => m.iccs), players: g.players,
      humanSide: g.humanSide, tc: g.tc, handicap: g.handicap, clockRemain: g.clock ? g.clock.remain.slice() : null, result: g.result,
      puzzle: g.puzzle ? g.puzzle.id : null, undos: g.undos, hints: g.hints, viewPly: g.viewPly, headers: g.headers, flip: board.flipped, statsDone: !!g.statsDone,
      variant: g.variant || null, daily: g.daily || null, achDone: !!g.achDone, demoSolution: !!g.demoSolution,
    };
  }
  function persist() { if (game && !game.demo) Store.set('current', serialize(game)); }
  function restore(d) {
    if (!d || !d.v || !Array.isArray(d.moves)) return false;
    try {
      const puzzle = d.puzzle ? PUZZLES.find(p => p.id === d.puzzle) : null;
      if (puzzle) { const sameN = PUZZLES.filter(x => x.n === puzzle.n); puzzle.label = t('pz.label', { n: puzzle.n, i: sameN.indexOf(puzzle) + 1 }); puzzle.index = PUZZLES.indexOf(puzzle); }
      if (d.variant && !VXE) return false;
      startGame({ id: d.id, created: d.created, mode: d.mode, fen: d.startFen || undefined, variant: d.variant || null, moves: d.moves, players: d.players, humanSide: d.humanSide, tc: d.tc, handicap: d.handicap, result: d.result, clockRemain: d.clockRemain, puzzle, undos: d.undos, hints: d.hints, viewPly: d.viewPly, headers: d.headers, flip: d.flip, silent: true, daily: d.daily || null });
      game.statsDone = !!d.statsDone; game.achDone = !!d.achDone; game.demoSolution = !!d.demoSolution;
      renderModeLabel();
      return true;
    } catch (e) { console.warn('restore failed', e); return false; }
  }

  // ================================================================== 啟動
  function bindUI() {
    ui.modeLabel = $('#modeLabel'); ui.cardTop = $('#cardTop'); ui.cardBottom = $('#cardBottom'); ui.status = $('#statusLine');
    ui.moveList = $('#moveList'); ui.opening = $('#openingName'); ui.banner = $('#banner'); ui.toastRoot = $('#toastRoot');
    ui.evalBar = $('#evalBar'); ui.evalFill = $('#evalFill'); ui.ledger = $('#ledger'); ui.toolbar = $('#toolbar'); ui.editorBar = $('#editorBar');
    ui.tabMoves = $('#tab-moves'); ui.tabAnalysis = $('#tab-analysis'); ui.tabInfo = $('#tab-info'); ui.anBody = $('#anBody'); ui.reviewBody = $('#reviewBody');
    ui.tUndo = $('#tUndo'); ui.tHint = $('#tHint'); ui.tDraw = $('#tDraw'); ui.tResign = $('#tResign');
    ui.navFirst = $('#navFirst'); ui.navPrev = $('#navPrev'); ui.navNext = $('#navNext'); ui.navLast = $('#navLast'); ui.navPlay = $('#navPlay');
    ui.btnSound = $('#btnSound'); ui.btnMusic = $('#btnMusic'); ui.drawerTpl = $('#drawerTpl'); ui.skillBar = $('#skillBar');
    if (ui.skillBar) {
      // 點技能卡發動；長按看說明
      let pressTimer = 0, longPressed = false;
      ui.skillBar.addEventListener('pointerdown', e => {
        const c = e.target.closest('[data-skill]');
        longPressed = false;
        if (!c) return;
        pressTimer = setTimeout(() => { longPressed = true; skillInfoDialog(+c.dataset.skill); }, 520);
      });
      const clear = () => clearTimeout(pressTimer);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => ui.skillBar.addEventListener(ev, clear));
      ui.skillBar.addEventListener('contextmenu', e => e.preventDefault());
      ui.skillBar.addEventListener('click', e => {
        const c = e.target.closest('[data-skill]');
        if (!c) return;
        if (longPressed) { longPressed = false; return; }
        startSkill(+c.dataset.skill);
      });
    }

    board = new BoardView($('#board'), $('#boardWrap'));
    board.onResize = (W) => { document.documentElement.style.setProperty('--board-w', (W + (ui.evalBar && !ui.evalBar.hidden ? 22 : 0)) + 'px'); renderEvalBar(); };
    board.onTap = onBoardTap; board.onDrop = onDrop; board.onDragStart = onDragStart; board.canDrag = canDrag;

    $('#btnMenu').onclick = openDrawer;
    $('#btnSettings').onclick = settingsDialog;
    ui.btnSound.onclick = () => { S.sound = !S.sound; saveSettings(); applySettings('sound'); toast(S.sound ? t('toast.soundOn') : t('toast.soundOff')); };
    ui.btnMusic.onclick = () => { A.unlock(); S.bgm = !S.bgm; saveSettings(); applySettings('bgm'); toast(S.bgm ? t('toast.musicOn', { name: A.tracks[S.bgmTrack].name[S.lang] || A.tracks[S.bgmTrack].name['zh-TW'] }) : t('toast.musicOff')); };
    $('#tNew').onclick = requestNewGame;
    ui.tUndo.onclick = undo;
    ui.tHint.onclick = hint;
    $('#tFlip').onclick = flip;
    ui.tDraw.onclick = offerDraw;
    ui.tResign.onclick = resign;
    $('#tLedger').onclick = () => openLedger();
    $('#ledgerClose').onclick = closeLedger;
    ui.navFirst.onclick = () => { stopAutoplay(); jumpTo(0); };
    ui.navPrev.onclick = () => { stopAutoplay(); jumpTo(game.viewPly - 1); };
    ui.navNext.onclick = () => { stopAutoplay(); jumpTo(game.viewPly + 1); };
    ui.navLast.onclick = () => { stopAutoplay(); jumpTo(game.moves.length); };
    ui.navPlay.onclick = toggleAutoplay;
    $$('.tabs [role=tab]').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
    ui.moveList.addEventListener('click', e => { const b = e.target.closest('[data-ply]'); if (b) { stopAutoplay(); jumpTo(+b.dataset.ply); } });
    $('#anToggle').addEventListener('change', e => { analysisOn = e.target.checked; maybeAnalyze(); renderAll({ skipBoard: true }); board.setArrows(arrowsNow()); });
    $('#arrowToggle').addEventListener('change', e => { S.showArrow = e.target.checked; saveSettings(); board.setArrows(arrowsNow()); });
    $('#explainBtn').onclick = explainPosition;
    $('#explainStop').onclick = () => { if (explainCtl) explainCtl.abort(); };
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'live') jumpTo(game.moves.length);
      else if (act === 'moveNow') moveNow();
      else if (act === 'review') runReview();
      else if (act === 'copyFen') copyText(positionAt(game.viewPly).toFen(Math.floor(game.viewPly / 2) + 1));
      else if (act === 'export') exportDialog();
      else if (act === 'save') { saveToLibrary(game, false); toast(t('toast.saved'), 'good'); }
      else if (act === 'skCancel') cancelSkill();
      else if (act === 'skills') skillsDialog();
    });
    ui.editorBar.addEventListener('click', e => {
      const p = e.target.closest('[data-pc]');
      if (p) { const v = p.dataset.pc; editState.brush = v === 'erase' ? 'erase' : (editState.brush === +v ? null : +v); editState.pick = -1; board.select(-1, []); renderEditorBar(); return; }
      const sbtn = e.target.closest('[data-seg=edSide] button');
      if (sbtn) { editState.side = +sbtn.dataset.v; renderEditorBar(); renderCards(); return; }
      const a = e.target.closest('[data-ed]');
      if (a) editorAction(a.dataset.ed);
    });
    // 鍵盤
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select') || modalStack.length) { if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(); return; }
      if (!game) return;
      const k = e.key;
      if (k === 'ArrowLeft') { jumpTo(game.viewPly - 1); e.preventDefault(); }
      else if (k === 'ArrowRight') { jumpTo(game.viewPly + 1); e.preventDefault(); }
      else if (k === 'Home') jumpTo(0);
      else if (k === 'End') jumpTo(game.moves.length);
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { undo(); e.preventDefault(); }
      else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (k === 'h' || k === 'H') hint();
      else if (k === 'f' || k === 'F') flip();
      else if (k === 'n' || k === 'N') requestNewGame();
      else if (k === 'Escape') { if (skillState) cancelSkill(); else selectSq(-1); closeLedger(); }
    });
    // 解除音訊鎖：iOS Safari 要在 touchend／click 裡才算使用者手勢，所以一直試到 AudioContext 真的在跑
    const unlock = () => { if (!A.unlocked || !A.running) A.unlock(); };
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') A.resume(); });
    window.addEventListener('pagehide', () => persist());
    window.addEventListener('orientationchange', () => setTimeout(() => board.resize(), 250));
    A.onBgmError = () => toast(t('toast.bgmError'), 'bad');
    A.onTrackChange = i => { S.bgmTrack = i; saveSettings(); };
    window.addEventListener('resize', () => { renderEvalBar(); if (reviewData) drawReviewChart(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  }

  async function lightUpCapabilities() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return;
    try { sampleApi = await c.use('sample'); } catch (e) { sampleApi = null; }
    if (sampleApi) $('#explainBox').hidden = isVar(game);
    try { downloadsApi = await c.use('downloads'); } catch (e) { downloadsApi = null; }
  }

  function boot(hotData) {
    bindUI();
    applySettings();
    applyI18n();
    const restored = (hotData && hotData.current && restore(hotData.current)) || restore(Store.get('current', null));
    if (!restored) startGame({ mode: 'pvc', humanSide: RED, level: S.lastNew.level, tc: 'none', silent: true });
    else if (game && !game.result && game.moves.length) setTimeout(() => toast(t('toast.resumed')), 400);
    showTab('moves');
    lightUpCapabilities();
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(() => ({ current: game ? serialize(game) : null })); } catch (e) { /* ignore */ } }
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !inFrame) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.XQApp = { get game() { return game; }, startGame, playMove, positionAt, board: () => board, settings: S, t };
  }

  const hot = window.claude && window.claude.hot;
  const go = data => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(data)); else boot(data); };
  if (hot && typeof hot.ready === 'function') { try { hot.ready(go); } catch (e) { go({}); } }
  else go((hot && hot.data) || {});
})();
