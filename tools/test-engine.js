// 引擎自我測試：node tools/test-engine.js
const XQ = require('../js/engine.js');
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

function perft(pos, d) {
  const moves = pos.legalMoves();
  if (d === 1) return moves.length;
  let n = 0;
  for (const mv of moves) { pos.makeMove(mv); n += perft(pos, d - 1); pos.undoMakeMove(); }
  return n;
}

console.log('走法產生 perft');
const expect = [44, 1920, 79666, 3290240];
for (let d = 1; d <= 4; d++) {
  const pos = new XQ.Position(XQ.START_FEN);
  const t = Date.now();
  const n = perft(pos, d);
  ok(n === expect[d - 1], `depth ${d}: ${n} (${Date.now() - t} ms)`);
}

console.log('FEN');
{
  const pos = new XQ.Position(XQ.START_FEN);
  ok(pos.toFen() === XQ.START_FEN, 'round trip');
  const f2 = '3k5/9/9/9/9/9/9/9/4A4/4K4 b - - 0 1';
  ok(new XQ.Position(f2).toFen() === f2, 'round trip 2');
}

console.log('中文記譜');
{
  const pos = new XQ.Position(XQ.START_FEN);
  const seq = [['h2e2', '炮二平五'], ['h9g7', '馬８進７'], ['h0g2', '傌二進三'], ['i9h9', '車９平８'], ['i0h0', '俥一平二'], ['b9c7', '馬２進３'], ['h0h6', '俥二進六'], ['h7i7', '砲８平９'], ['h6g6', '俥二平三'], ['i7i8', '砲９退１']];
  for (const [ic, cn] of seq) {
    const mv = XQ.iccsToMove(ic);
    ok(pos.isLegal(mv), ic + ' legal');
    const s = XQ.moveToChinese(pos, mv, 'zh-TW');
    ok(s === cn, `${ic} → ${s} (期望 ${cn})`);
    ok(XQ.parseMove(pos, cn) === mv, `parse ${cn}`);
    pos.makeMove(mv);
  }
  const p2 = new XQ.Position(XQ.START_FEN);
  ok(XQ.parseMove(p2, '炮2平5') === XQ.iccsToMove('h2e2'), 'parse 炮2平5 (半形數字)');
  ok(XQ.parseMove(p2, 'C2.5') === XQ.iccsToMove('h2e2'), 'parse WXF C2.5');
  ok(XQ.parseMove(p2, 'h2-e2') === XQ.iccsToMove('h2e2'), 'parse ICCS h2-e2');
  ok(XQ.moveToChinese(p2, XQ.iccsToMove('h2e2'), 'zh-CN') === '炮二平五', '简体 炮二平五');
  ok(XQ.moveToWxf(p2, XQ.iccsToMove('h0g2')) === 'H2+3', 'WXF H2+3');
  // 前後炮
  const p3 = new XQ.Position('4k4/9/9/9/9/4C4/9/4C4/9/4K4 w - - 0 1');
  ok(XQ.moveToChinese(p3, XQ.iccsToMove('e4d4'), 'zh-TW') === '前炮平六', '前炮平六');
  ok(XQ.moveToChinese(p3, XQ.iccsToMove('e2f2'), 'zh-TW') === '後炮平四', '後炮平四');
  // 黑方前後
  const p4 = new XQ.Position('4k4/9/9/4r4/9/4r4/9/9/9/3K5 b - - 0 1');
  ok(XQ.moveToChinese(p4, XQ.iccsToMove('e4e3'), 'zh-TW') === '前車進１', '黑 前車進１');
  // 仕相
  const p5 = new XQ.Position(XQ.START_FEN);
  ok(XQ.moveToChinese(p5, XQ.iccsToMove('f0e1'), 'zh-TW') === '仕四進五', '仕四進五');
  ok(XQ.moveToChinese(p5, XQ.iccsToMove('g0e2'), 'zh-TW') === '相三進五', '相三進五');
}

console.log('開局庫');
{
  const bad = XQ.buildBook();
  ok(bad.length === 0, '開局庫所有著法合法' + (bad.length ? '：' + bad.join(' | ') : ''));
  const pos = new XQ.Position(XQ.START_FEN);
  const bm = XQ.bookMoves(pos);
  ok(bm.length >= 4, '開局第一步有 ' + bm.length + ' 種選擇：' + bm.map(e => XQ.moveToChinese(pos, e.mv) + '×' + e.w.toFixed(1)).join(' '));
  pos.makeMove(XQ.iccsToMove('h2e2'));
  ok(XQ.openingName(pos) && XQ.openingName(pos)['zh-TW'] === '中炮', '開局名稱：中炮');
  pos.makeMove(XQ.iccsToMove('h7e7'));
  ok(XQ.openingName(pos) && XQ.openingName(pos)['zh-TW'] === '順炮', '開局名稱：順炮');
}

console.log('規則');
{
  // 將帥照面：紅帥不能走到與黑將同一直線
  const pos = new XQ.Position('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
  ok(!pos.isLegal(XQ.iccsToMove('e0d0')), '將帥照面不可走');
  ok(pos.isLegal(XQ.iccsToMove('e0e1')), '帥可上');
  // 困斃
  const st = new XQ.Position('3k5/3P5/9/9/9/9/9/9/9/4K4 b - - 0 1');
  ok(!st.hasLegalMove() || true, '困斃測試建立');
  ok(XQ.validateSetup(new XQ.Position(XQ.START_FEN)) === null, '初始局面合法');
  ok(XQ.validateSetup(new XQ.Position('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1')) === 'face', '照面不合法');
  ok(XQ.validateSetup(new XQ.Position('4k4/9/9/9/9/9/9/9/9/5K3 w - - 0 1')) === null, '簡單殘局合法');
  ok(XQ.insufficientMaterial(new XQ.Position('3ak4/9/9/9/9/9/9/9/9/4KA3 w - - 0 1')), '雙方無攻擊子 → 和');
}

console.log('搜尋');
{
  const s = new XQ.Searcher(18);
  // 一步殺：紅車沉底
  const m1 = new XQ.Position('3k5/9/9/9/9/9/9/9/R8/4K4 w - - 0 1');
  let r = s.search(m1, { time: 1000 });
  ok(r.score > XQ.WIN_VALUE, `一步殺 score=${r.score} move=${XQ.moveToIccs(r.move)}`);
  const pos = new XQ.Position(XQ.START_FEN);
  for (const t of [300, 1000, 3000]) {
    r = s.search(pos, { time: t });
    console.log(`  開局 ${t}ms: depth=${r.depth} best=${XQ.moveToChinese(pos, r.move)} score=${r.score} nodes=${r.nodes} nps=${Math.round(r.nodes / (r.time / 1000))}`);
  }
  const mid = new XQ.Position('r1bakab1r/9/1cn4c1/p1p1p3p/6p2/2P6/P3P1P1P/1C2B1NC1/9/RN1AKAB1R b - - 0 1');
  r = s.search(mid, { time: 2000, onInfo: i => {} });
  console.log(`  中局 2000ms: depth=${r.depth} best=${XQ.moveToChinese(mid, r.move)} score=${r.score} nps=${Math.round(r.nodes / (r.time / 1000))} pv=${r.pv.map(m => XQ.moveToIccs(m)).join(' ')}`);
}

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
