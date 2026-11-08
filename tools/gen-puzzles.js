// 殺法題目產生器：隨機擺出殘局，用引擎驗證「紅先 N 步絕殺且第一步唯一」。
// 用法：node tools/gen-puzzles.js <N> <要幾題> [seed]
const XQ = require('../js/engine.js');
const N = +(process.argv[2] || 2), WANT = +(process.argv[3] || 5);
let seed = +(process.argv[4] || Date.now() % 100000);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const S = new XQ.Searcher(20);

const BP = [[3, 9], [4, 9], [5, 9], [3, 8], [4, 8], [5, 8], [3, 7], [4, 7], [5, 7]];
const RP = [[3, 0], [4, 0], [5, 0], [3, 1], [4, 1], [5, 1], [3, 2], [4, 2], [5, 2]];
const BA = [[3, 9], [5, 9], [4, 8], [3, 7], [5, 7]], BB = [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]];
const RA = [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]], RB = [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]];

function gen() {
  const pos = new XQ.Position();
  const occ = new Set();
  const put = (f, r, pc) => { const sq = r * 9 + f; if (occ.has(sq)) return false; occ.add(sq); pos.addPiece(sq, pc); return true; };
  const B = t => 8 | t;
  // 黑方：將 + 士象 + 少量守子
  const [kf, kr] = rnd() < 0.7 ? pick(BP.slice(0, 6)) : pick(BP);
  put(kf, kr, B(XQ.KING));
  const na = Math.floor(rnd() * 3), nb = Math.floor(rnd() * 3);
  for (let i = 0; i < na; i++) { const [f, r] = pick(BA); put(f, r, B(XQ.ADVISOR)); }
  for (let i = 0; i < nb; i++) { const [f, r] = pick(BB); put(f, r, B(XQ.BISHOP)); }
  const nDef = rnd() < 0.55 ? 1 : (rnd() < 0.3 ? 2 : 0);
  for (let i = 0; i < nDef; i++) {
    const t = pick([XQ.ROOK, XQ.KNIGHT, XQ.CANNON, XQ.PAWN, XQ.PAWN]);
    for (let k = 0; k < 20; k++) { const f = Math.floor(rnd() * 9), r = Math.floor(rnd() * 10); if (t === XQ.PAWN && (r > 6 || (r >= 5 && f % 2))) continue; if (put(f, r, B(t))) break; }
  }
  // 紅方：帥 + 2~3 個進攻子
  const [rf, rr] = pick(RP);
  put(rf, rr, XQ.KING);
  if (rnd() < 0.5) { const [f, r] = pick(RA); put(f, r, XQ.ADVISOR); }
  if (rnd() < 0.5) { const [f, r] = pick(RB); put(f, r, XQ.BISHOP); }
  const nAtk = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nAtk; i++) {
    const t = pick([XQ.ROOK, XQ.ROOK, XQ.KNIGHT, XQ.KNIGHT, XQ.CANNON, XQ.CANNON, XQ.PAWN]);
    for (let k = 0; k < 30; k++) {
      const f = Math.floor(rnd() * 9), r = 3 + Math.floor(rnd() * 7);
      if (t === XQ.PAWN && (r < 5)) continue;
      if (put(f, r, t)) break;
    }
  }
  pos.chkList = [pos.kingAttacked(pos.side)];
  return pos;
}

function mateDist(pos, depth) {
  const r = S.search(pos, { depth, time: 4000, exact: true });
  if (r.score > XQ.WIN_VALUE && r.score <= XQ.MATE_VALUE) return { plies: XQ.MATE_VALUE - r.score, r };
  return null;
}

const out = [];
const seen = new Set();
let tries = 0;
while (out.length < WANT && tries < 200000) {
  tries++;
  const pos = gen();
  if (XQ.validateSetup(pos)) continue;
  if (pos.inCheck()) continue;
  const fen = pos.toFen();
  if (seen.has(fen)) continue;
  seen.add(fen);
  // 必須剛好 N 步殺
  const m = mateDist(pos, 2 * N - 1);
  if (!m || (m.plies + 1) / 2 !== N) continue;
  // 第一步唯一
  const legal = pos.legalMoves();
  let mating = 0;
  for (const mv of legal) {
    pos.makeMove(mv);
    let isMate;
    if (!pos.hasLegalMove()) isMate = true;
    else if (N === 1) isMate = false;
    else { const r = S.search(pos, { depth: 2 * N - 2, time: 4000, exact: true }); isMate = r.score < -XQ.WIN_VALUE && -r.score <= XQ.MATE_VALUE && (XQ.MATE_VALUE + r.score) <= 2 * N - 2; }
    pos.undoMakeMove();
    if (isMate) mating++;
    if (mating > 1) break;
  }
  if (mating !== 1) continue;
  // 黑方要有足夠應著（避免太單調）
  const sol = m.r.pv.map(XQ.moveToIccs);
  const pieces = fen.split(' ')[0].replace(/[0-9\/]/g, '').length;
  out.push({ n: N, fen, sol, pieces, cn: (() => { const p = new XQ.Position(fen); return m.r.pv.map(mv => { const s = XQ.moveToChinese(p, mv); p.makeMove(mv); return s; }).join(' '); })() });
  console.error(`found ${out.length}/${WANT} after ${tries} tries: ${fen}  ${out[out.length - 1].cn}`);
}
console.log(JSON.stringify(out, null, 1));
