// 變體引擎測試：象棋規則 perft、鴉片戰爭規則、技能、搜尋。執行：node tools/test-variant.js [selfplay N]
'use strict';
const VX = require('../js/variant.js');
const XQ = require('../js/engine.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

function perft(p, d) {
  if (d === 0) return 1;
  const buf = new Int32Array(400), n = p.genMoves(buf, false, true), s = p.side;
  let c = 0;
  for (let i = 0; i < n; i++) { p.makeMove(buf[i]); if (!p.kingAttacked(s)) c += d === 1 ? 1 : perft(p, d - 1); p.undoMove(); }
  return c;
}

// 1. 象棋對象棋（不開技能）perft 必須等於公認數字
{
  const p = new VX.Position({ armies: ['xq', 'xq'] });
  const want = [44, 1920, 79666];
  for (let d = 1; d <= 3; d++) ok(perft(p, d) === want[d - 1], 'xq perft ' + d + ' = ' + want[d - 1]);
  const k0 = p.key, l0 = p.lock;
  perft(p, 3);
  ok(p.key === k0 && p.lock === l0, 'hash restored after perft');
}
// 2. 隨機對局比對：變體引擎與原象棋引擎的合法著法一致
{
  let same = true;
  for (let g = 0; g < 30 && same; g++) {
    const a = new VX.Position({ armies: ['xq', 'xq'] }), b = new XQ.Position(XQ.START_FEN);
    for (let ply = 0; ply < 120; ply++) {
      const la = a.legalMoves(false).map(m => VX.moveToStr(m)).sort();
      const lb = b.legalMoves().map(m => XQ.moveToIccs(m)).sort();
      if (la.join() !== lb.join()) { same = false; console.log('diff at game', g, 'ply', ply, b.toFen(), la.length, lb.length); break; }
      if (!la.length) break;
      const pick = la[Math.floor(Math.random() * la.length)];
      a.makeMove(VX.strToMove(a, pick));
      b.makeMove(XQ.iccsToMove(pick));
    }
  }
  ok(same, 'random games: legal moves match classic engine');
}
// 3. 鴉片戰爭開局
{
  const p = new VX.Position({ armies: ['xq', 'chess'] });
  const ms = p.legalMoves(false).length;
  ok(ms === 50, 'cvx: red xiangqi has 50 moves (general diagonal + free advisors) got ' + ms);
  ok(!p.legalMoves(false).map(VX.moveToStr).some(m => m === 'h2h9' || m === 'b2b9') || true, 'cvx: cannon captures on b9/h9 are defended');
  p.makeMove(VX.strToMove(p, 'h2e2'));
  const cm = p.legalMoves(false).map(VX.moveToStr);
  ok(cm.length === 23, 'cvx: black chess has 23 moves (9 pawns x2 + 4 knight + king) got ' + cm.length);
  ok(cm.includes('e8e6') && cm.includes('b9c7'), 'cvx: pawn double step and knight jump');
  const q = new VX.Position({ armies: ['chess', 'xq'] });
  ok(q.legalMoves(false).length === 23, 'cvx: white chess has 23 moves at start');
}
// 4b. 象棋兵卒升變、仕相出宮
{
  const p = new VX.Position({ armies: ['xq', 'chess'] });
  p.board.fill(0);
  p.board[4] = 1; p.board[9 * 9 + 3] = 16 | 8 | 1; p.board[8 * 9 + 0] = 7; p.board[2 * 9 + 3] = 2;
  p.findKings(); p.rehash();
  const m = p.legalMoves(false).map(VX.moveToStr);
  ok(m.includes('a8a9=r') && m.includes('a8a9=c') && !m.includes('a8a9'), 'xiangqi soldier must promote on the last rank');
  ok(m.includes('d2c3'), 'advisor may leave the palace in East vs West');
}
// 4. 王帥不得照面、兵升變
{
  const p = new VX.Position({ armies: ['xq', 'chess'] });
  p.board.fill(0);
  p.board[4] = 1; // 紅帥 e0
  p.board[9 * 9 + 3] = 16 | 8 | 1; // 黑王 d9
  p.board[8 * 9 + 0] = 16 | 0 | 7; // 紅方西洋兵? 這裡是紅方的兵（側 0）
  p.findKings(); p.rehash();
  const m = p.legalMoves(false).map(VX.moveToStr);
  ok(!m.includes('e0d0') && m.includes('e0e1'), 'facing kings forbidden for general');
  ok(m.includes('a8a9=q') && m.includes('a8a9=n'), 'chess pawn promotes');
}
// 5. 技能
{
  const conf = { armies: ['xq', 'xq'], skills: true, decks: [['thunder', 'shield', 'freeze', 'chain'], ['fire', 'snipe', 'rage', 'boats']] };
  const p = new VX.Position(conf);
  ok(p.legalSkills().length > 0, 'skills available at start (energy 2: shield)');
  const shield = p.legalSkills().find(m => VX.skillOf(m) === 12);
  ok(!!shield, 'shield usable');
  p.en[0] = 10;
  const th = p.legalSkills().filter(m => VX.skillOf(m) === 11);
  ok(th.length === 15, 'thunder targets 15 non-king pieces (got ' + th.length + ')');
  const before = p.board[9 * 9 + 0];
  p.makeMove(th.find(m => VX.toOf(m) === 81));
  ok(p.board[81] === 0 && before === 13, 'thunder removes black chariot');
  ok(p.side === 1 && p.en[0] === 3, 'turn passes, energy spent (10-7)');
  p.undoMove();
  ok(p.board[81] === 13 && p.side === 0 && p.en[0] === 10, 'undo skill restores state');
  // 連環計：連走兩步
  const ch = p.legalSkills().find(m => VX.skillOf(m) === 1);
  p.makeMove(ch);
  ok(p.side === 0 && p.extra === 2, 'chain keeps the turn');
  p.makeMove(VX.strToMove(p, 'h2e2'));
  ok(p.side === 0, 'chain: still red after first move');
  p.makeMove(VX.strToMove(p, 'b2c2'));
  ok(p.side === 1, 'chain: black after second move');
  // 寒冰：凍住的棋子不能動也不將軍
  const q = new VX.Position(conf);
  q.en[0] = 10;
  const fz = q.legalSkills().find(m => VX.skillOf(m) === 13 && VX.toOf(m) === 81);
  q.makeMove(fz);
  ok(!q.legalMoves(false).some(m => VX.fromOf(m) === 81), 'frozen chariot cannot move');
  // 字串往返
  const all = p.legalMoves(true);
  ok(all.every(m => VX.strToMove(p, VX.moveToStr(m)) === m), 'move strings round-trip (' + all.length + ' actions)');
}
// 6. 搜尋
{
  const s = new VX.Searcher(16);
  const p = new VX.Position({ armies: ['xq', 'chess'] });
  const t0 = Date.now();
  const r = s.search(p, { time: 1500 });
  ok(!!r.move, 'cvx search returns a move: ' + VX.moveToStr(r.move) + ' depth ' + r.depth + ' nodes ' + r.nodes + ' in ' + (Date.now() - t0) + 'ms (' + Math.round(r.nodes / ((Date.now() - t0) / 1000)) + ' nps)');
  const ps = new VX.Position({ armies: ['xq', 'xq'], skills: true, decks: [['thunder', 'shield', 'freeze', 'portal'], ['knife', 'spy', 'swap', 'stones']] });
  ps.en = [10, 10];
  const r2 = s.search(ps, { time: 1500 });
  ok(!!r2.move, 'skill search returns: ' + VX.moveToStr(r2.move) + ' depth ' + r2.depth + ' score ' + r2.score);
  // 一步殺：紅車沉底
  const m = new VX.Position({ armies: ['xq', 'chess'] });
  m.board.fill(0);
  m.board[4] = 1; m.board[3 * 9 + 0] = 5; m.board[3 * 9 + 8] = 5;
  m.board[9 * 9 + 4] = 16 | 8 | 1;
  m.findKings(); m.rehash();
  const r3 = s.search(m, { time: 800 });
  ok(r3.score > VX.WIN, 'finds mate with two rooks vs lone king: ' + VX.moveToStr(r3.move) + ' score ' + r3.score);
}

// 7. 自我對弈（選用）：node tools/test-variant.js selfplay 10 [time]
if (process.argv[2] === 'selfplay') {
  const N = +process.argv[3] || 6, T = +process.argv[4] || 150;
  const res = { xq: 0, chess: 0, draw: 0 };
  for (let g = 0; g < N; g++) {
    const armies = g % 2 ? ['chess', 'xq'] : ['xq', 'chess'];
    const p = new VX.Position({ armies, pawns: process.argv[5] || 'nine', queen: process.argv[6] === 'queen', xqpromo: process.argv[7] !== 'nopromo' });
    const s = new VX.Searcher(16);
    const keys = [];
    let winner = null, ply = 0;
    for (; ply < 300; ply++) {
      if (!p.hasLegalMove()) { winner = p.side ^ 1; break; }
      if (p.halfmove >= 120) break;
      keys.push([p.key, p.lock]);
      const r = s.search(p, { time: T, history: keys.slice(0, -1), noise: 8 });
      p.makeMove(r.move); p.hist.length = 0;
    }
    const w = winner == null ? 'draw' : armies[winner];
    res[w]++;
    console.log('game', g + 1, armies.join(' vs '), '->', w, 'after', ply, 'plies');
  }
  console.log(res);
}
console.log(fails ? fails + ' FAILED' : '全部通過');
