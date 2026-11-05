/*!
 * Mind Board — offline chess & checkers.
 * Single-file game logic: rules engines, AI, and user interface.
 * No network access, no external assets. Data lives only in localStorage.
 */
'use strict';

/* =====================================================================
 * ENGINES (self-contained: this function is also loaded into a Web Worker)
 * ===================================================================== */
function MindBoardEngines() {
  'use strict';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const INF = 1e9, MATE = 100000;

  /* ------------------------------ CHESS ------------------------------ */
  const Chess = (function () {
    const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
    const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const DIRS8 = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
    // Castling rights: 1 = white king-side, 2 = white queen-side, 4 = black king-side, 8 = black queen-side
    const CR = new Array(64).fill(15);
    CR[56] = 13; CR[63] = 14; CR[60] = 12; CR[0] = 7; CR[7] = 11; CR[4] = 3;
    const KNT = [], KGT = [], RAYS = [];
    for (let sq = 0; sq < 64; sq++) {
      const r = sq >> 3, c = sq & 7;
      KNT[sq] = []; KGT[sq] = [];
      for (const [dr, dc] of KN) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) KNT[sq].push(rr * 8 + cc); }
      for (const [dr, dc] of KG) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) KGT[sq].push(rr * 8 + cc); }
      RAYS[sq] = DIRS8.map(([dr, dc]) => {
        const a = []; let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { a.push(rr * 8 + cc); rr += dr; cc += dc; }
        return a;
      });
    }

    function initial() {
      const b = new Array(64).fill(0);
      const back = [R, N, B, Q, K, B, N, R];
      for (let c = 0; c < 8; c++) { b[c] = -back[c]; b[8 + c] = -P; b[48 + c] = P; b[56 + c] = back[c]; }
      return { b, turn: 1, castle: 15, ep: -1, half: 0, full: 1, kings: [60, 4] };
    }
    function clone(s) { return { b: s.b.slice(), turn: s.turn, castle: s.castle, ep: s.ep, half: s.half, full: s.full, kings: s.kings.slice() }; }
    function sqIdx(n) { return (8 - (+n[1])) * 8 + 'abcdefgh'.indexOf(n[0]); }
    function sqName(i) { return 'abcdefgh'[i & 7] + (8 - (i >> 3)); }
    function fromFEN(f) {
      const [pl, tu, ca, ep, h, fu] = f.trim().split(/\s+/);
      const b = new Array(64).fill(0), kings = [0, 0];
      const map = { p: P, n: N, b: B, r: R, q: Q, k: K };
      let sq = 0;
      for (const ch of pl) {
        if (ch === '/') continue;
        if (/\d/.test(ch)) { sq += +ch; continue; }
        const v = map[ch.toLowerCase()], col = ch === ch.toUpperCase() ? 1 : -1;
        b[sq] = v * col; if (v === K) kings[col === 1 ? 0 : 1] = sq; sq++;
      }
      let castle = 0;
      if (ca && ca.includes('K')) castle |= 1; if (ca && ca.includes('Q')) castle |= 2;
      if (ca && ca.includes('k')) castle |= 4; if (ca && ca.includes('q')) castle |= 8;
      return { b, turn: tu === 'b' ? -1 : 1, castle, ep: !ep || ep === '-' ? -1 : sqIdx(ep), half: +(h || 0), full: +(fu || 1), kings };
    }

    function attacked(b, sq, by) {
      const r = sq >> 3, c = sq & 7;
      const pr = r + (by === 1 ? 1 : -1);
      if (pr >= 0 && pr < 8) {
        if (c > 0 && b[pr * 8 + c - 1] === by * P) return true;
        if (c < 7 && b[pr * 8 + c + 1] === by * P) return true;
      }
      const n = by * N, k = by * K, bb = by * B, rr = by * R, q = by * Q;
      const kn = KNT[sq]; for (let i = 0; i < kn.length; i++) if (b[kn[i]] === n) return true;
      const kg = KGT[sq]; for (let i = 0; i < kg.length; i++) if (b[kg[i]] === k) return true;
      const rays = RAYS[sq];
      for (let d = 0; d < 8; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const p = b[ray[i]];
          if (p) { if (p === q || (d < 4 ? p === bb : p === rr)) return true; break; }
        }
      }
      return false;
    }
    function mv(from, to, p, cap, promo, flag) { return { from, to, p, cap, promo, flag }; }
    function pseudo(s, capOnly) {
      const b = s.b, t = s.turn, out = [];
      for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (p === 0 || (p > 0) !== (t > 0)) continue;
        const a = p * t;
        if (a === P) {
          const r = sq >> 3, c = sq & 7, dir = t === 1 ? -8 : 8, r1 = r + (t === 1 ? -1 : 1);
          const last = t === 1 ? 0 : 7, start = t === 1 ? 6 : 1;
          if (r1 < 0 || r1 > 7) continue;
          const f = sq + dir;
          if (b[f] === 0) {
            if (r1 === last) {
              out.push(mv(sq, f, p, 0, Q, ''));
              if (!capOnly) out.push(mv(sq, f, p, 0, R, ''), mv(sq, f, p, 0, B, ''), mv(sq, f, p, 0, N, ''));
            } else if (!capOnly) {
              out.push(mv(sq, f, p, 0, 0, ''));
              if (r === start && b[f + dir] === 0) out.push(mv(sq, f + dir, p, 0, 0, 'd'));
            }
          }
          for (let k = 0; k < 2; k++) {
            const cc = c + (k ? 1 : -1);
            if (cc < 0 || cc > 7) continue;
            const to = r1 * 8 + cc, tp = b[to];
            if (tp !== 0 && (tp > 0) !== (t > 0)) {
              if (r1 === last) {
                out.push(mv(sq, to, p, tp, Q, ''));
                if (!capOnly) out.push(mv(sq, to, p, tp, R, ''), mv(sq, to, p, tp, B, ''), mv(sq, to, p, tp, N, ''));
              } else out.push(mv(sq, to, p, tp, 0, ''));
            } else if (to === s.ep && tp === 0) out.push(mv(sq, to, p, -t * P, 0, 'e'));
          }
        } else if (a === N || a === K) {
          const ts = a === N ? KNT[sq] : KGT[sq];
          for (let i = 0; i < ts.length; i++) {
            const to = ts[i], tp = b[to];
            if (tp === 0) { if (!capOnly) out.push(mv(sq, to, p, 0, 0, '')); }
            else if ((tp > 0) !== (t > 0)) out.push(mv(sq, to, p, tp, 0, ''));
          }
          if (a === K && !capOnly) {
            const base = t === 1 ? 56 : 0, ks = t === 1 ? 1 : 4, qs = t === 1 ? 2 : 8, e = -t;
            if (sq === base + 4) {
              if ((s.castle & ks) && b[base + 5] === 0 && b[base + 6] === 0 && b[base + 7] === t * R &&
                !attacked(b, base + 4, e) && !attacked(b, base + 5, e) && !attacked(b, base + 6, e))
                out.push(mv(sq, base + 6, p, 0, 0, 'c'));
              if ((s.castle & qs) && b[base + 3] === 0 && b[base + 2] === 0 && b[base + 1] === 0 && b[base] === t * R &&
                !attacked(b, base + 4, e) && !attacked(b, base + 3, e) && !attacked(b, base + 2, e))
                out.push(mv(sq, base + 2, p, 0, 0, 'c'));
            }
          }
        } else {
          const rays = RAYS[sq], d0 = a === R ? 4 : 0, d1 = a === B ? 4 : 8;
          for (let d = d0; d < d1; d++) {
            const ray = rays[d];
            for (let i = 0; i < ray.length; i++) {
              const to = ray[i], tp = b[to];
              if (tp === 0) { if (!capOnly) out.push(mv(sq, to, p, 0, 0, '')); }
              else { if ((tp > 0) !== (t > 0)) out.push(mv(sq, to, p, tp, 0, '')); break; }
            }
          }
        }
      }
      return out;
    }
    function make(s, m) {
      const b = s.b, t = s.turn;
      const u = [s.castle, s.ep, s.half, s.kings[0], s.kings[1]];
      b[m.from] = 0;
      b[m.to] = m.promo ? m.promo * t : m.p;
      if (m.flag === 'e') b[m.to + (t === 1 ? 8 : -8)] = 0;
      else if (m.flag === 'c') {
        if (m.to > m.from) { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = 0; }
        else { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = 0; }
      }
      if (m.p === t * K) s.kings[t === 1 ? 0 : 1] = m.to;
      s.castle &= CR[m.from] & CR[m.to];
      s.ep = -1;
      if (m.flag === 'd') {
        const c = m.to & 7;
        if ((c > 0 && b[m.to - 1] === -t * P) || (c < 7 && b[m.to + 1] === -t * P)) s.ep = (m.from + m.to) >> 1;
      }
      s.half = (m.p === t * P || m.cap) ? 0 : s.half + 1;
      if (t === -1) s.full++;
      s.turn = -t;
      return u;
    }
    function unmake(s, m, u) {
      const t = -s.turn; s.turn = t; if (t === -1) s.full--;
      const b = s.b;
      b[m.from] = m.p;
      if (m.flag === 'e') { b[m.to] = 0; b[m.to + (t === 1 ? 8 : -8)] = m.cap; }
      else {
        b[m.to] = m.cap;
        if (m.flag === 'c') {
          if (m.to > m.from) { b[m.from + 3] = b[m.from + 1]; b[m.from + 1] = 0; }
          else { b[m.from - 4] = b[m.from - 1]; b[m.from - 1] = 0; }
        }
      }
      s.castle = u[0]; s.ep = u[1]; s.half = u[2]; s.kings[0] = u[3]; s.kings[1] = u[4];
    }
    function inCheck(s) { return attacked(s.b, s.kings[s.turn === 1 ? 0 : 1], -s.turn); }
    function legal(s) {
      const out = [], ki = s.turn === 1 ? 0 : 1;
      for (const m of pseudo(s, false)) {
        const u = make(s, m);
        if (!attacked(s.b, s.kings[ki], s.turn)) out.push(m);
        unmake(s, m, u);
      }
      return out;
    }
    function perft(s, d) {
      if (d === 0) return 1;
      let n = 0; const ki = s.turn === 1 ? 0 : 1;
      for (const m of pseudo(s, false)) {
        const u = make(s, m);
        if (!attacked(s.b, s.kings[ki], s.turn)) n += d === 1 ? 1 : perft(s, d - 1);
        unmake(s, m, u);
      }
      return n;
    }
    function key(s) { return s.b.join(',') + '|' + s.turn + '|' + s.castle + '|' + s.ep; }
    function insufficient(b) {
      const minors = [];
      for (let i = 0; i < 64; i++) {
        const a = Math.abs(b[i]);
        if (a === P || a === R || a === Q) return false;
        if (a === N || a === B) minors.push([a, ((i >> 3) + (i & 7)) & 1]);
      }
      if (minors.length <= 1) return true;
      if (minors.every((x) => x[0] === B && x[1] === minors[0][1])) return true;
      return false;
    }
    function outcome(s, keys) {
      const ms = legal(s);
      if (!ms.length) return inCheck(s) ? { winner: -s.turn, reason: 'checkmate' } : { winner: 0, reason: 'stalemate' };
      if (s.half >= 100) return { winner: 0, reason: 'fifty' };
      if (insufficient(s.b)) return { winner: 0, reason: 'material' };
      if (keys && keys.length) {
        const k = key(s); let n = 0;
        for (const x of keys) if (x === k) n++;
        if (n >= 3) return { winner: 0, reason: 'repetition' };
      }
      return null;
    }
    const LET = { 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
    function san(s, m) {
      let str;
      const a = Math.abs(m.p);
      if (m.flag === 'c') str = m.to > m.from ? 'O-O' : 'O-O-O';
      else if (a === P) str = (m.cap ? 'abcdefgh'[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + LET[m.promo] : '');
      else {
        const others = legal(s).filter((o) => o.p === m.p && o.to === m.to && o.from !== m.from);
        let dis = '';
        if (others.length) {
          const sf = others.some((o) => (o.from & 7) === (m.from & 7));
          const sr = others.some((o) => (o.from >> 3) === (m.from >> 3));
          dis = !sf ? 'abcdefgh'[m.from & 7] : !sr ? String(8 - (m.from >> 3)) : sqName(m.from);
        }
        str = LET[a] + dis + (m.cap ? 'x' : '') + sqName(m.to);
      }
      const u = make(s, m);
      const chk = inCheck(s), mate = chk && legal(s).length === 0;
      unmake(s, m, u);
      return str + (mate ? '#' : chk ? '+' : '');
    }

    /* ---- evaluation ---- */
    const VAL = [0, 100, 320, 330, 500, 900, 0];
    const PST = {
      1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
      2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
      3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
      4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
      5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
      6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
      7: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
    };
    function evaluate(s) {
      const b = s.b;
      let phase = 0, mat = 0, score = 0, wb = 0, bb = 0;
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (!p) continue;
        const a = p > 0 ? p : -p;
        if (a === Q) phase += 4; else if (a === R) phase += 2; else if (a === N || a === B) phase += 1;
        if (a === B) { if (p > 0) wb++; else bb++; }
        mat += p > 0 ? VAL[a] : -VAL[a];
      }
      const endgame = phase <= 6;
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (!p) continue;
        const a = p > 0 ? p : -p;
        const tbl = a === K && endgame ? PST[7] : PST[a];
        const v = tbl[p > 0 ? i : (i ^ 56)];
        score += p > 0 ? v : -v;
      }
      score += mat;
      if (wb >= 2) score += 30; if (bb >= 2) score -= 30;
      if (endgame && Math.abs(mat) >= 300) {
        // "Mop-up": help the stronger side drive the lone king to the edge.
        const strong = mat > 0 ? 1 : -1;
        const sk = s.kings[strong === 1 ? 0 : 1], wk = s.kings[strong === 1 ? 1 : 0];
        const lr = wk >> 3, lc = wk & 7;
        const cd = Math.max(3 - lr, lr - 4) + Math.max(3 - lc, lc - 4);
        const kd = Math.abs((sk >> 3) - lr) + Math.abs((sk & 7) - lc);
        score += strong * (cd * 10 + (14 - kd) * 4);
      }
      return s.turn === 1 ? score : -score;
    }
    function same(a, b) { return a && b && a.from === b.from && a.to === b.to && a.promo === b.promo; }
    function sortMoves(ms, killers) {
      for (const m of ms) {
        let sc = 0;
        if (m.cap) sc = 10000 + VAL[Math.abs(m.cap)] * 10 - VAL[Math.abs(m.p)] / 10;
        else if (m.promo) sc = 9000 + m.promo;
        else if (killers && (same(killers[0], m) || same(killers[1], m))) sc = 8000;
        m._o = sc;
      }
      ms.sort((a, b) => b._o - a._o);
      return ms;
    }
    function quiesce(s, alpha, beta, ctx, qd) {
      ctx.nodes++;
      const stand = evaluate(s);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd >= ctx.qmax) return stand;
      const ms = sortMoves(pseudo(s, true), null);
      const ki = s.turn === 1 ? 0 : 1;
      for (const m of ms) {
        const u = make(s, m);
        if (attacked(s.b, s.kings[ki], s.turn)) { unmake(s, m, u); continue; }
        const v = -quiesce(s, -beta, -alpha, ctx, qd + 1);
        unmake(s, m, u);
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
      return alpha;
    }
    function negamax(s, depth, alpha, beta, ply, ctx) {
      if ((++ctx.nodes & 2047) === 0 && now() > ctx.deadline) ctx.stop = true;
      if (ctx.stop) return 0;
      if (s.half >= 100) return 0;
      const ki = s.turn === 1 ? 0 : 1;
      const inChk = attacked(s.b, s.kings[ki], -s.turn);
      if (depth <= 0) {
        if (!inChk || ply >= ctx.extLimit) return ctx.qmax ? quiesce(s, alpha, beta, ctx, 0) : evaluate(s);
        depth = 1; // check extension at the horizon
      }
      const ms = sortMoves(pseudo(s, false), ctx.killers[ply]);
      let best = -INF, count = 0;
      for (const m of ms) {
        const u = make(s, m);
        if (attacked(s.b, s.kings[ki], s.turn)) { unmake(s, m, u); continue; }
        count++;
        const v = -negamax(s, depth - 1, -beta, -alpha, ply + 1, ctx);
        unmake(s, m, u);
        if (ctx.stop) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) {
          if (!m.cap) { const k = ctx.killers[ply] || (ctx.killers[ply] = []); if (!same(k[0], m)) { k[1] = k[0]; k[0] = m; } }
          break;
        }
      }
      if (!count) return inChk ? -MATE + ply : 0;
      return best;
    }
    const LEVELS = [
      { random: true },
      { depth: 1, q: 0, noise: 90, time: 800 },
      { depth: 2, q: 4, noise: 25, time: 1500 },
      { depth: 4, q: 8, noise: 0, time: 1800 },
      { depth: 7, q: 10, noise: 0, time: 2800 }
    ];
    function think(state, level, keys) {
      const s = clone(state);
      const L = LEVELS[Math.max(0, Math.min(4, level - 1))];
      const moves = legal(s);
      if (!moves.length) return null;
      const pack = (m) => ({ from: m.from, to: m.to, promo: m.promo || 0 });
      if (L.random) {
        const caps = moves.filter((m) => m.cap);
        if (caps.length && Math.random() < 0.5) return pack(pick(caps));
        return pack(pick(moves));
      }
      const ctx = { nodes: 0, stop: false, deadline: now() + L.time, qmax: L.q, killers: [], extLimit: 0 };
      const rep = new Map();
      for (const m of moves) {
        const u = make(s, m); const k = key(s); unmake(s, m, u);
        let n = 0; if (keys) for (const x of keys) if (x === k) n++;
        rep.set(m, n);
      }
      let bestMove = moves[0];
      let order = sortMoves(moves.slice(), null);
      for (let depth = 1; depth <= L.depth; depth++) {
        ctx.extLimit = depth + 4;
        let alpha = -INF, iterBest = null, iterScore = -INF;
        for (const m of order) {
          const u = make(s, m);
          let v = L.noise ? -negamax(s, depth - 1, -INF, INF, 1, ctx) : -negamax(s, depth - 1, -INF, -alpha, 1, ctx);
          unmake(s, m, u);
          if (ctx.stop) break;
          const n = rep.get(m);
          if (n >= 2) v = 0; else if (n === 1 && v > 0) v -= 25;
          if (L.noise) v += (Math.random() * 2 - 1) * L.noise;
          if (v > iterScore) { iterScore = v; iterBest = m; }
          if (v > alpha) alpha = v;
        }
        if (iterBest) bestMove = iterBest;
        if (ctx.stop) break;
        order = [iterBest, ...order.filter((m) => m !== iterBest)];
        if (Math.abs(iterScore) > MATE - 1000) break;
      }
      return pack(bestMove);
    }
    return { initial, clone, fromFEN, legal, pseudo, make, unmake, inCheck, attacked, perft, key, outcome, san, sqName, evaluate, think, VAL };
  })();

  /* ---------------- DRAUGHTS (configurable: Classic 8x8 & International 10x10) ---------------- */
  // Piece codes: 1 = light man, 2 = light king, -1 = dark man, -2 = dark king.
  // Light always starts at the bottom and moves "up" (towards row 0).
  function makeDraughts(V) {
    const n = V.n, NN = n * n, HALF = n / 2;
    const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const inb = (r, c) => r >= 0 && r < n && c >= 0 && c < n;
    function initial() {
      const b = new Array(NN).fill(0);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if ((r + c) % 2 === 1) { if (r < V.rows) b[r * n + c] = -1; else if (r >= n - V.rows) b[r * n + c] = 1; }
      }
      return { b, turn: V.first, quiet: 0, endPly: 0, endCond: 0 };
    }
    function clone(s) { return { b: s.b.slice(), turn: s.turn, quiet: s.quiet, endPly: s.endPly || 0, endCond: s.endCond || 0 }; }
    function dfs(b, pos, p, path, caps, out) {
      const r = (pos / n) | 0, c = pos % n, king = Math.abs(p) === 2, t = p > 0 ? 1 : -1;
      // Classic rule: a man that reaches the crown row while capturing is crowned and the move ends.
      if (V.crownStops && !king && caps.length && r === (t === 1 ? 0 : n - 1)) {
        out.push({ from: path[0], to: pos, path: path.slice(), caps: caps.slice() });
        return;
      }
      let extended = false;
      for (const [dr, dc] of DIRS) {
        if (!king || !V.flying) {
          if (!king && !V.menBack && dr !== (t === 1 ? -1 : 1)) continue;
          const r2 = r + 2 * dr, c2 = c + 2 * dc;
          if (!inb(r2, c2)) continue;
          const m = (r + dr) * n + c + dc, l = r2 * n + c2;
          if (b[m] * t < 0 && caps.indexOf(m) < 0 && b[l] === 0) {
            extended = true;
            path.push(l); caps.push(m);
            dfs(b, l, p, path, caps, out);
            path.pop(); caps.pop();
          }
        } else {
          let rr = r + dr, cc = c + dc;
          while (inb(rr, cc) && b[rr * n + cc] === 0) { rr += dr; cc += dc; }
          if (!inb(rr, cc)) continue;
          const m = rr * n + cc;
          if (b[m] * t >= 0 || caps.indexOf(m) >= 0) continue; // own piece or an already-jumped piece blocks the line
          let lr = rr + dr, lc = cc + dc;
          while (inb(lr, lc) && b[lr * n + lc] === 0) {
            extended = true;
            path.push(lr * n + lc); caps.push(m);
            dfs(b, lr * n + lc, p, path, caps, out);
            path.pop(); caps.pop();
            lr += dr; lc += dc;
          }
        }
      }
      if (!extended && caps.length) out.push({ from: path[0], to: pos, path: path.slice(), caps: caps.slice() });
    }
    function captures(s) {
      const b = s.b, t = s.turn;
      let out = [];
      for (let sq = 0; sq < NN; sq++) {
        const p = b[sq];
        if (p * t <= 0) continue;
        b[sq] = 0; // the moving piece leaves its square (it may pass over / land on it again)
        dfs(b, sq, p, [sq], [], out);
        b[sq] = p;
      }
      if (!out.length) return out;
      if (V.maxCapture) {
        let max = 0;
        for (const m of out) if (m.caps.length > max) max = m.caps.length;
        out = out.filter((m) => m.caps.length === max);
      }
      const seen = new Set();
      return out.filter((m) => { const k = m.path.join('-'); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    function legal(s) {
      const cap = captures(s);
      if (cap.length) return cap;
      const b = s.b, t = s.turn, out = [];
      for (let sq = 0; sq < NN; sq++) {
        const p = b[sq];
        if (p * t <= 0) continue;
        const r = (sq / n) | 0, c = sq % n;
        if (Math.abs(p) === 1) {
          const dr = t === 1 ? -1 : 1;
          for (const dc of [-1, 1]) {
            const rr = r + dr, cc = c + dc;
            if (inb(rr, cc) && b[rr * n + cc] === 0) out.push({ from: sq, to: rr * n + cc, path: [sq, rr * n + cc], caps: [] });
          }
        } else {
          for (const [dr, dc] of DIRS) {
            let rr = r + dr, cc = c + dc;
            while (inb(rr, cc) && b[rr * n + cc] === 0) {
              out.push({ from: sq, to: rr * n + cc, path: [sq, rr * n + cc], caps: [] });
              if (!V.flying) break;
              rr += dr; cc += dc;
            }
          }
        }
      }
      return out;
    }
    function counts(b) {
      const c = { wm: 0, wk: 0, bm: 0, bk: 0 };
      for (let i = 0; i < b.length; i++) { const p = b[i]; if (p === 1) c.wm++; else if (p === 2) c.wk++; else if (p === -1) c.bm++; else if (p === -2) c.bk++; }
      return c;
    }
    // International endgame rules: returns 0 (none), 32 (16 moves each) or 10 (5 moves each) plies.
    function endLimit(c) {
      if (!V.endgame) return 0;
      const wT = c.wm + c.wk, bT = c.bm + c.bk;
      const wLone = c.wk === 1 && c.wm === 0, bLone = c.bk === 1 && c.bm === 0;
      let lim = 0;
      const check = (lone, oT, oK) => { if (lone && oK >= 1) { if (oT === 3) lim = Math.max(lim, 32); else if (oT <= 2) lim = lim ? Math.min(lim, 10) : 10; } };
      check(wLone, bT, c.bk); check(bLone, wT, c.wk);
      return lim;
    }
    function apply(s, m) {
      const nx = clone(s), b = nx.b;
      const p = b[m.from];
      b[m.from] = 0;
      for (const c of m.caps) b[c] = 0;
      let np = p;
      const r = (m.to / n) | 0;
      if (p === 1 && r === 0) np = 2; else if (p === -1 && r === n - 1) np = -2;
      b[m.to] = np;
      nx.quiet = (m.caps.length || Math.abs(p) === 1) ? 0 : s.quiet + 1;
      if (V.endgame) {
        const lim = endLimit(counts(b));
        if (lim && lim === (s.endCond || 0) && !m.caps.length) nx.endPly = (s.endPly || 0) + 1;
        else nx.endPly = 0;
        nx.endCond = lim;
      }
      nx.turn = -s.turn;
      return nx;
    }
    function key(s) { return s.b.join(',') + '|' + s.turn; }
    function outcome(s, keys) {
      const ms = legal(s);
      if (!ms.length) {
        const c = counts(s.b);
        const left = s.turn === 1 ? c.wm + c.wk : c.bm + c.bk;
        return { winner: -s.turn, reason: left ? 'blocked' : 'wipeout' };
      }
      if (s.quiet >= V.quietLimit) return { winner: 0, reason: 'quiet' };
      const c = counts(s.b);
      if (V.kingsDraw && c.wm === 0 && c.bm === 0 && c.wk === 1 && c.bk === 1) return { winner: 0, reason: 'kings' };
      if (V.endgame && s.endCond && s.endPly >= s.endCond) return { winner: 0, reason: s.endCond === 32 ? 'endgame16' : 'endgame5' };
      if (keys && keys.length) {
        const k = key(s); let cnt = 0;
        for (const x of keys) if (x === k) cnt++;
        if (cnt >= 3) return { winner: 0, reason: 'repetition' };
      }
      return null;
    }
    function num(sq) { return ((sq / n) | 0) * HALF + ((sq % n) >> 1) + 1; }
    function notation(m) { return m.caps.length ? m.path.map(num).join('x') : num(m.from) + '-' + num(m.to); }
    const ADV = 28 / (n - 1);
    function evaluate(s) {
      const b = s.b;
      let sc = 0, wm = 0, bm = 0, wk = 0, bk = 0;
      const lo = Math.floor(n / 4), hi = n - 1 - lo;
      for (let i = 0; i < NN; i++) {
        const p = b[i]; if (!p) continue;
        const r = (i / n) | 0, c = i % n;
        const center = (c >= lo && c <= hi && r >= lo && r <= hi) ? 6 : 0;
        if (p === 1) { wm++; sc += 100 + (n - 1 - r) * ADV + center + (r === n - 1 ? 8 : 0); }
        else if (p === -1) { bm++; sc -= 100 + r * ADV + center + (r === 0 ? 8 : 0); }
        else if (p === 2) { wk++; sc += V.kingVal + (V.flying && r + c === n - 1 ? 14 : center); }
        else { bk++; sc -= V.kingVal + (V.flying && r + c === n - 1 ? 14 : center); }
      }
      const kv = V.kingVal / 100;
      const wt = wm + wk * kv, bt = bm + bk * kv, total = wm + bm + wk + bk;
      if (wt !== bt) sc += (wt > bt ? 1 : -1) * (V.pieces * 2 - total) * 3; // when ahead, trade down
      return s.turn === 1 ? sc : -sc;
    }
    function ordered(s, ms) {
      return ms.map((m) => {
        let sc = m.caps.length * 100;
        const p = s.b[m.from], r = (m.to / n) | 0;
        if ((p === 1 && r === 0) || (p === -1 && r === n - 1)) sc += 50;
        return [sc, m];
      }).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    }
    function negamax(s, depth, alpha, beta, ply, ctx) {
      if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) ctx.stop = true;
      if (ctx.stop) return 0;
      const ms = legal(s);
      if (!ms.length) return -MATE + ply;
      if (s.quiet >= V.quietLimit) return 0;
      const forcing = ms[0].caps.length > 0;
      if (depth <= 0 && (!forcing || ply >= ctx.extLimit)) return evaluate(s);
      let best = -INF;
      for (const m of ordered(s, ms)) {
        const v = -negamax(apply(s, m), depth - 1, -beta, -alpha, ply + 1, ctx);
        if (ctx.stop) return 0;
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }
    function think(state, level, keys) {
      const s = clone(state);
      const L = V.levels[Math.max(0, Math.min(4, level - 1))];
      const moves = legal(s);
      if (!moves.length) return null;
      const pack = (m) => ({ path: m.path.slice() });
      if (L.random || moves.length === 1) return pack(pick(moves));
      const ctx = { nodes: 0, stop: false, deadline: now() + L.time, extLimit: 0 };
      const rep = new Map();
      for (const m of moves) {
        const k = key(apply(s, m)); let cnt = 0;
        if (keys) for (const x of keys) if (x === k) cnt++;
        rep.set(m, cnt);
      }
      let bestMove = moves[0];
      let order = ordered(s, moves);
      for (let depth = 1; depth <= L.depth; depth++) {
        ctx.extLimit = depth + 8;
        let alpha = -INF, iterBest = null, iterScore = -INF;
        for (const m of order) {
          let v = L.noise ? -negamax(apply(s, m), depth - 1, -INF, INF, 1, ctx) : -negamax(apply(s, m), depth - 1, -INF, -alpha, 1, ctx);
          if (ctx.stop) break;
          const cnt = rep.get(m);
          if (cnt >= 2) v = 0; else if (cnt === 1 && v > 0) v -= 20;
          if (L.noise) v += (Math.random() * 2 - 1) * L.noise;
          if (v > iterScore) { iterScore = v; iterBest = m; }
          if (v > alpha) alpha = v;
        }
        if (iterBest) bestMove = iterBest;
        if (ctx.stop) break;
        order = [iterBest, ...order.filter((m) => m !== iterBest)];
        if (Math.abs(iterScore) > MATE - 1000) break;
      }
      return pack(bestMove);
    }
    return { n, V, initial, clone, legal, apply, key, outcome, notation, num, evaluate, think, counts };
  }

  // Classic (English / American) checkers: 8x8, 12 each, dark moves first, men move & capture forward only,
  // kings move one square, any capture may be chosen but a started sequence must be completed.
  const Classic = makeDraughts({
    n: 8, rows: 3, pieces: 12, first: -1, flying: false, menBack: false, maxCapture: false, crownStops: true,
    quietLimit: 80, kingsDraw: true, endgame: false, kingVal: 160,
    levels: [
      { random: true },
      { depth: 2, noise: 70, time: 800 },
      { depth: 4, noise: 20, time: 1500 },
      { depth: 7, noise: 0, time: 2000 },
      { depth: 16, noise: 0, time: 2800 }
    ]
  });
  // International draughts (FMJD): 10x10, 20 each, light moves first, men capture backwards,
  // flying kings, maximum-capture rule, promotion only when a move ends on the far row.
  const Dama = makeDraughts({
    n: 10, rows: 4, pieces: 20, first: 1, flying: true, menBack: true, maxCapture: true, crownStops: false,
    quietLimit: 50, kingsDraw: false, endgame: true, kingVal: 320,
    levels: [
      { random: true },
      { depth: 2, noise: 70, time: 900 },
      { depth: 3, noise: 20, time: 1500 },
      { depth: 5, noise: 0, time: 2200 },
      { depth: 14, noise: 0, time: 3000 }
    ]
  });

  const AI = {
    think(game, state, level, keys) {
      if (game === 'chess') return Chess.think(state, level, keys);
      return (game === 'dama' ? Dama : Classic).think(state, level, keys);
    }
  };
  return { Chess, Classic, Dama, AI };
}

const Engines = MindBoardEngines();
if (typeof module !== 'undefined' && module.exports) module.exports = Engines;

/* =====================================================================
 * USER INTERFACE
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  const { Chess, Classic, Dama, AI } = Engines;
  const $ = (s, root = document) => root.querySelector(s);
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  }
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ icons & pieces ------------------------------ */
  const ICON = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

  const CBASE = '<path d="M11 37.5h23a1.6 1.6 0 0 1 1.6 1.6v1.3a1.6 1.6 0 0 1-1.6 1.6H11a1.6 1.6 0 0 1-1.6-1.6v-1.3a1.6 1.6 0 0 1 1.6-1.6z"/>';
  const COLLAR = '<path d="M16.3 25.2h12.4a1.3 1.3 0 0 1 0 2.6H16.3a1.3 1.3 0 0 1 0-2.6z"/>';
  const ROYAL_BODY = '<path d="M14 37.5c0-4.6 2.1-7.6 3.6-11.3h9.8c1.5 3.7 3.6 6.7 3.6 11.3z"/>';
  const CH = {
    1: { body: '<path d="M16.5 37.5c0-6.5 2.6-10.6 4.3-13.5h3.4c1.7 2.9 4.3 7 4.3 13.5z"/><path d="M18 21.6h9a1.2 1.2 0 0 1 0 2.4h-9a1.2 1.2 0 0 1 0-2.4z"/><circle cx="22.5" cy="14" r="5.6"/>' },
    2: { body: '<path d="M14 37.5c0-5.5 2.2-8.6 4.8-11.2l-5.3.6c-2.2.2-3.6-2-2.6-3.9l7.6-10.6 1.2-5.2 3.9 3.6c6 1 9.6 6.5 9.6 13.6 0 5.3-.9 9.2-1.5 13.1z"/>',
      detail: '<circle class="eye" cx="19" cy="16" r="1.25"/><path class="detail" d="M25 12.3c3 2.2 4.8 6 5.2 11"/>' },
    3: { body: '<path d="M15 37.5c0-4.5 3-6.8 4.6-9h5.8c1.6 2.2 4.6 4.5 4.6 9z"/><path d="M18 26.2h9a1.2 1.2 0 0 1 0 2.4h-9a1.2 1.2 0 0 1 0-2.4z"/><path d="M22.5 9.5c4.2 3.2 7.2 7.2 7.2 11.2 0 3.8-3.1 5.5-7.2 5.5s-7.2-1.7-7.2-5.5c0-4 3-8 7.2-11.2z"/><circle cx="22.5" cy="7.3" r="2.3"/>',
      detail: '<path class="detail" d="M25.2 14.2l-4.4 6.2"/>' },
    4: { body: '<path d="M12.5 37.5l1.8-4.3h16.4l1.8 4.3z"/><path d="M15.6 33.2l1.1-14.4h11.6l1.1 14.4z"/><path d="M13 10.5h4v3h3.2v-3h4.6v3H28v-3h4v6.8a1.3 1.3 0 0 1-1.3 1.3H14.3a1.3 1.3 0 0 1-1.3-1.3z"/>' },
    5: { body: ROYAL_BODY + '<path d="M12 13.2l4.4 12.9h12.2l4.4-12.9-4.1 6.1-1.5-9.1-2.6 8.6-2.3-10.2-2.3 10.2-2.6-8.6-1.5 9.1z"/><circle cx="12" cy="12.4" r="1.9"/><circle cx="17.6" cy="9.4" r="1.9"/><circle cx="22.5" cy="7.4" r="1.9"/><circle cx="27.4" cy="9.4" r="1.9"/><circle cx="33" cy="12.4" r="1.9"/>' + COLLAR },
    6: { body: ROYAL_BODY + '<path d="M15.6 25.6c-2.4-3.8-2.6-8.6 1.4-10.8 2.6-1.4 4.6-.4 5.5 1.6.9-2 2.9-3 5.5-1.6 4 2.2 3.8 7 1.4 10.8z"/><path d="M21.2 4.5h2.6v3.1h3v2.6h-3v6.4h-2.6v-6.4h-3V7.6h3z"/>' + COLLAR }
  };
  const PIECE_NAME = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
  function chessSVG(p) {
    const a = Math.abs(p), d = CH[a];
    return `<svg class="pc ${p > 0 ? 'pw' : 'pb'}" viewBox="0 0 45 45" aria-hidden="true"><g class="body">${d.body}${CBASE}</g>${d.detail || ''}</svg>`;
  }
  function checkerSVG(p) {
    const k = Math.abs(p) === 2;
    return `<svg class="pc ck ${p > 0 ? 'cw' : 'cb'}" viewBox="0 0 100 100" aria-hidden="true"><ellipse class="edge" cx="50" cy="55" rx="41" ry="39"/><circle class="top" cx="50" cy="50" r="40"/><circle class="ring" cx="50" cy="50" r="30"/>${k ? '<path class="crown" d="M31 62l-4.5-23 12.5 9.5 11-15.5 11 15.5 12.5-9.5-4.5 23z"/>' : '<circle class="ring" cx="50" cy="50" r="19"/>'}</svg>`;
  }

  /* ------------------------------ storage ------------------------------ */
  const STORE_KEY = 'mindboard:v1'; // same key as v1 so existing progress is migrated, not lost
  const LEVEL_NAMES = ['Novice', 'Casual', 'Club', 'Expert', 'Master'];
  const LEVEL_DESC = ['Plays almost at random', 'Grabs material, misses tactics', 'Looks a few moves ahead', 'Calculates tactics', 'Deep, patient search'];
  const SIDE = { chess: { 1: 'White', '-1': 'Black' }, checkers: { 1: 'Light', '-1': 'Dark' }, dama: { 1: 'Light', '-1': 'Dark' } };
  const GAMES = ['chess', 'checkers', 'dama'];
  const MODES = ['ai', 'friend'];
  const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  function defaults() {
    const per = (f) => ({ chess: f(), checkers: f(), dama: f() });
    return {
      v: 2,
      settings: { sound: true, hints: true, anim: true, coords: true, flip: false },
      progress: per(() => 1),
      saves: per(() => ({ ai: null, friend: null })),
      last: per(() => ({ mode: 'ai', level: 1, side: 'w' })),
      tutorial: false,
      seen: { checkers: false, dama: false }
    };
  }
  const validSave = (sv, mode) => sv && typeof sv === 'object' && Array.isArray(sv.moves) && sv.moves.length < 3000 && sv.mode === mode;
  function sanitize(d) {
    const o = defaults();
    if (!d || typeof d !== 'object' || (d.v !== 1 && d.v !== 2)) return o;
    if (d.settings && typeof d.settings === 'object') for (const k in o.settings) if (typeof d.settings[k] === 'boolean') o.settings[k] = d.settings[k];
    o.tutorial = d.tutorial === true;
    for (const g of GAMES) {
      o.progress[g] = clampInt(d.progress && d.progress[g], 1, 5, 1);
      const l = d.last && d.last[g];
      if (l && typeof l === 'object') o.last[g] = { mode: l.mode === 'friend' ? 'friend' : 'ai', level: clampInt(l.level, 1, 5, 1), side: ['w', 'b', 'r'].includes(l.side) ? l.side : 'w' };
    }
    if (d.v === 1) {
      // v1 had one save per game and its "checkers" used different rules: keep the chess save, drop the old checkers save.
      const sv = d.saves && d.saves.chess;
      if (sv && (sv.mode === 'ai' || sv.mode === 'friend') && validSave(sv, sv.mode)) o.saves.chess[sv.mode] = sv;
      return o;
    }
    for (const g of GAMES) for (const m of MODES) {
      const sv = d.saves && d.saves[g] && d.saves[g][m];
      if (validSave(sv, m)) o.saves[g][m] = sv;
    }
    if (d.seen && typeof d.seen === 'object') { o.seen.checkers = d.seen.checkers === true; o.seen.dama = d.seen.dama === true; }
    return o;
  }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? sanitize(JSON.parse(raw)) : defaults(); }
    catch (e) { return defaults(); }
  }
  let storageWarned = false;
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch (e) { if (!storageWarned) { storageWarned = true; toast('Storage is unavailable — progress will not be kept.'); } }
  }
  const data = load();

  /* ------------------------------ sound ------------------------------ */
  let actx = null;
  function ensureAudio() {
    if (!data.settings.sound) return null;
    try {
      if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }
  function tone(freq, dur, type, vol, when) {
    const c = ensureAudio(); if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.06, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SFX = {
    move() { tone(430, 0.07, 'triangle', 0.07); tone(215, 0.09, 'sine', 0.05); },
    capture() { tone(190, 0.13, 'triangle', 0.09); tone(330, 0.06, 'square', 0.02, 0.02); },
    check() { tone(660, 0.1, 'sine', 0.06); tone(880, 0.14, 'sine', 0.05, 0.09); },
    select() { tone(760, 0.035, 'sine', 0.03); },
    error() { tone(150, 0.12, 'triangle', 0.05); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'sine', 0.06, i * 0.14)); },
    draw() { [440, 440].forEach((f, i) => tone(f, 0.18, 'sine', 0.05, i * 0.16)); }
  };
  const sfx = (n) => { if (data.settings.sound) try { SFX[n](); } catch (e) { /* ignore */ } };

  /* ------------------------------ AI worker ------------------------------ */
  let worker = null, thinkSeq = 0;
  const pending = new Map();
  function runSync(job, cb) {
    setTimeout(() => { let mv = null; try { mv = AI.think(job.game, job.state, job.level, job.keys); } catch (e) { mv = null; } cb(mv); }, 20);
  }
  try {
    const src = "'use strict';var E=(" + MindBoardEngines.toString() + ")();" +
      'self.onmessage=function(e){var d=e.data,mv=null;try{mv=E.AI.think(d.game,d.state,d.level,d.keys);}catch(err){mv=null;}self.postMessage({id:d.id,move:mv});};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e) => { const job = pending.get(e.data.id); if (job) { pending.delete(e.data.id); job.cb(e.data.move); } };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      worker = null; // fall back to the main thread
      for (const [id, job] of pending) { pending.delete(id); runSync(job, job.cb); }
    };
  } catch (e) { worker = null; }
  function think(game, state, level, keys, cb) {
    const job = { id: ++thinkSeq, game, state, level, keys, cb };
    if (worker) { pending.set(job.id, job); try { worker.postMessage({ id: job.id, game, state, level, keys }); return; } catch (e) { pending.delete(job.id); } }
    runSync(job, cb);
  }

  /* ------------------------------ game adapters ------------------------------ */
  const A = {
    chess: {
      title: 'Chess',
      initial: () => Chess.initial(),
      legal: (s) => Chess.legal(s),
      apply: (s, m) => { const n = Chess.clone(s); Chess.make(n, m); return n; },
      key: (s) => Chess.key(s),
      outcome: (s, k) => Chess.outcome(s, k),
      note: (s, m) => Chess.san(Chess.clone(s), m),
      pack: (m) => ({ f: m.from, t: m.to, p: m.promo || 0 }),
      match: (s, d) => d && Chess.legal(s).find((m) => m.from === d.f && m.to === d.t && (m.promo || 0) === (d.p || 0)),
      fromAI: (s, d) => d && Chess.legal(s).find((m) => m.from === d.from && m.to === d.to && (m.promo || 0) === (d.promo || 0)),
      victims: (s, m) => (m.cap ? [m.cap] : []),
      victimSquares: (s, m) => (m.cap ? [m.flag === 'e' ? m.to + (s.turn === 1 ? 8 : -8) : m.to] : []),
      piece: chessSVG
    },
    checkers: draughtsAdapter(Classic, 'Classic Checkers', 'Checkers', '8×8'),
    dama: draughtsAdapter(Dama, 'International Dama', 'Dama', '10×10')
  };
  function draughtsAdapter(E, title, short, size) {
    return {
      title, short, size, n: E.n,
      initial: () => E.initial(),
      legal: (s) => E.legal(s),
      apply: (s, m) => E.apply(s, m),
      key: (s) => E.key(s),
      outcome: (s, k) => E.outcome(s, k),
      note: (s, m) => E.notation(m),
      num: (sq) => E.num(sq),
      pack: (m) => ({ path: m.path.slice() }),
      match: (s, d) => d && Array.isArray(d.path) && E.legal(s).find((m) => m.path.join() === d.path.join()),
      fromAI: (s, d) => d && Array.isArray(d.path) && E.legal(s).find((m) => m.path.join() === d.path.join()),
      victims: (s, m) => m.caps.map((c) => s.b[c]),
      victimSquares: (s, m) => m.caps.slice(),
      piece: checkerSVG
    };
  }
  A.chess.n = 8; A.chess.short = 'Chess'; A.chess.size = '8×8';

  /* ------------------------------ session ------------------------------ */
  const AI_DELAY = 750; // gives a short window to take back a move before the AI answers
  let G = null;
  const cur = () => G.states[G.states.length - 1];
  function newSession(game, opts) {
    const ad = A[game], s0 = ad.initial();
    G = {
      game, A: ad, n: ad.n, NN: ad.n * ad.n, mode: opts.mode, level: opts.level, human: opts.human,
      states: [s0], moves: [], notes: [], keys: [ad.key(s0)],
      legal: ad.legal(s0), selected: -1, partial: null, over: null, paused: false,
      aiReq: 0, aiTimer: null, thinking: false, cursor: -1, flip: false, resultShown: false
    };
    G.cursor = G.legal.length ? G.legal[0].from : 0;
  }
  function pushMove(m) {
    const s = cur(), note = G.A.note(s, m), n = G.A.apply(s, m);
    G.states.push(n); G.moves.push(m); G.notes.push(note); G.keys.push(G.A.key(n));
    G.legal = G.A.legal(n);
    G.over = G.A.outcome(n, G.keys);
  }
  // Saves are kept per game AND per mode: data.saves[game].ai / data.saves[game].friend
  function saveSession() {
    if (!G) return;
    data.saves[G.game][G.mode] = G.over ? null : { mode: G.mode, level: G.level, human: G.human, moves: G.moves.map(G.A.pack), t: Date.now() };
    persist();
  }
  function restore(game, mode) {
    const sv = data.saves[game][mode];
    if (!sv) return false;
    const clear = () => { data.saves[game][mode] = null; persist(); G = null; };
    newSession(game, { mode, level: clampInt(sv.level, 1, 5, 1), human: sv.human === -1 ? -1 : 1 });
    try {
      for (const d of sv.moves) {
        const m = G.A.match(cur(), d);
        if (!m || G.over) throw new Error('bad save');
        pushMove(m);
      }
    } catch (e) {
      clear();
      toast('That saved game could not be restored, so it was cleared.');
      return false;
    }
    if (G.over) { clear(); return false; }
    G.cursor = G.legal.length ? G.legal[0].from : 0;
    return true;
  }
  const aiTurn = () => G && G.mode === 'ai' && !G.over && cur().turn !== G.human;
  function cancelAI() {
    if (!G) return;
    G.aiReq++; clearTimeout(G.aiTimer); G.aiTimer = null; G.thinking = false;
  }
  function scheduleAI(delay) {
    if (!G) return;
    cancelAI();
    if (!aiTurn() || G.paused) { renderChrome(); return; }
    const id = G.aiReq, g = G;
    G.thinking = true;
    renderChrome();
    G.aiTimer = setTimeout(() => {
      if (G !== g || id !== G.aiReq) return;
      think(G.game, cur(), G.level, G.keys, (mv) => {
        if (G !== g || id !== G.aiReq || G.paused || G.over) return;
        G.thinking = false;
        let m = G.A.fromAI(cur(), mv);
        if (!m && G.legal.length) m = G.legal[Math.floor(Math.random() * G.legal.length)];
        if (m) commitMove(m);
      });
    }, delay == null ? AI_DELAY : delay);
  }
  function canInteract() {
    return !!G && !G.over && !G.paused && !modals.length && $('#play').hidden === false &&
      (G.mode === 'friend' || cur().turn === G.human);
  }
  function canUndo() {
    if (!G || !G.moves.length || G.paused) return false;
    if (G.mode === 'friend') return true;
    if (G.over) return false;
    return cur().turn !== G.human; // only your own move, and only before the AI has replied
  }
  function undo() {
    if (!canUndo()) { if (G && G.mode === 'ai' && G.moves.length && !G.over) toast('You can only take back a move before the AI replies.'); return; }
    cancelAI();
    G.states.pop(); G.moves.pop(); G.notes.pop(); G.keys.pop();
    G.over = null; G.resultShown = false;
    G.legal = G.A.legal(cur());
    G.selected = -1; G.partial = null;
    sfx('select');
    saveSession(); render(); scheduleAI();
  }
  function commitMove(m, opt) {
    opt = opt || {};
    if (!G || G.over) return;
    const prev = cur();
    pushMove(m);
    G.selected = -1; G.partial = null;
    const caps = G.A.victims(prev, m).length;
    if (!G.over) {
      if (G.game === 'chess' && Chess.inCheck(cur())) sfx('check');
      else sfx(caps ? 'capture' : 'move');
    } else sfx(caps ? 'capture' : 'move');
    render();
    if (!opt.noAnim) animateMove(m, prev, opt.startIdx || 0);
    if (G.over) finishGame();
    else { saveSession(); scheduleAI(); }
  }
  function finishGame() {
    cancelAI();
    data.saves[G.game][G.mode] = null;
    let unlocked = 0;
    const w = G.over.winner;
    if (G.mode === 'ai' && w === G.human && G.level >= data.progress[G.game] && G.level < 5) {
      data.progress[G.game] = G.level + 1; unlocked = G.level + 1;
    }
    persist();
    const g = G;
    setTimeout(() => {
      if (G !== g || !G.over) return;
      if (w === 0) sfx('draw'); else if (G.mode === 'friend' || w === G.human) sfx('win'); else sfx('lose');
      G.resultShown = true;
      showResult(unlocked);
    }, 800);
    renderChrome();
  }

  /* ------------------------------ board ------------------------------ */
  const boardEl = $('#board');
  let squares = [];
  function buildBoard(n) {
    boardEl.innerHTML = '';
    squares = [];
    boardEl.style.setProperty('--n', n);
    boardEl.classList.toggle('n10', n === 10);
    for (let v = 0; v < n * n; v++) { const node = el('div', { class: 'sq', role: 'gridcell' }); node._sig = ''; squares.push(node); boardEl.appendChild(node); }
  }
  const viewToSq = (v) => (G && G.flip ? G.NN - 1 - v : v);
  const nodeOf = (sq) => squares[G.flip ? G.NN - 1 - sq : sq];
  function sqFromPoint(x, y) {
    const r = boardEl.getBoundingClientRect(), n = G.n;
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return -1;
    const c = Math.floor((x - r.left) / (r.width / n)), rr = Math.floor((y - r.top) / (r.height / n));
    return viewToSq(Math.min(n - 1, rr) * n + Math.min(n - 1, c));
  }
  function sqName(sq) {
    const n = G.n, r = (sq / n) | 0, c = sq % n;
    if (G.game === 'chess') return 'abcdefgh'[c] + (8 - r);
    return (r + c) % 2 === 1 ? 'square ' + G.A.num(sq) : 'light square';
  }
  function checkerCands() {
    const p = G.partial;
    return G.legal.filter((m) => m.from === p[0] && p.every((x, i) => m.path[i] === x));
  }
  function targets() {
    const map = new Map();
    if (!G || G.selected < 0) return map;
    if (G.game === 'chess') { for (const m of G.legal) if (m.from === G.selected) map.set(m.to, m.cap ? 'cap' : 'move'); }
    else {
      const cands = checkerCands(), k = G.partial.length;
      for (const m of cands) if (m.path.length > k) map.set(m.path[k], m.caps.length ? 'cap' : 'move');
      for (const m of cands) { const t = m.path[m.path.length - 1]; if (!map.has(t)) map.set(t, 'final'); }
    }
    return map;
  }
  function displayBoard() {
    const s = cur();
    if (!G.partial || G.partial.length < 2) return { b: s.b, pend: [] };
    const b = s.b.slice(), from = G.partial[0], at = G.partial[G.partial.length - 1];
    const p = b[from]; b[from] = 0; b[at] = p;
    const cands = checkerCands();
    return { b, pend: cands.length ? cands[0].caps.slice(0, G.partial.length - 1) : [] };
  }
  function pieceLabel(p) {
    if (!p) return 'empty';
    const side = SIDE[G.game][p > 0 ? 1 : -1].toLowerCase();
    if (G.game === 'chess') return side + ' ' + PIECE_NAME[Math.abs(p)];
    return side + (Math.abs(p) === 2 ? ' king' : ' piece');
  }
  function render() {
    if (!G) return;
    const n = G.n, NN = G.NN;
    G.flip = G.mode === 'ai' ? G.human === -1 : (data.settings.flip && cur().turn === -1);
    boardEl.classList.toggle('flipped', G.flip);
    boardEl.classList.toggle('game-checkers', G.game !== 'chess');
    const s = cur(), { b, pend } = displayBoard(), tg = targets(), hints = data.settings.hints;
    const last = G.moves.length ? G.moves[G.moves.length - 1] : null;
    const checkSq = G.game === 'chess' && Chess.inCheck(s) ? s.kings[s.turn === 1 ? 0 : 1] : -1;
    const must = G.game !== 'chess' && hints && G.selected < 0 && canInteract() && G.legal.length && G.legal[0].caps.length
      ? new Set(G.legal.map((m) => m.from)) : null;
    const mid = G.partial && G.partial.length > 1 ? G.partial[G.partial.length - 1] : -1;
    const trail = mid >= 0 ? G.partial.slice(0, -1) : [];
    const coords = data.settings.coords;
    for (let v = 0; v < NN; v++) {
      const sq = viewToSq(v), node = squares[v];
      const r = (sq / n) | 0, c = sq % n, dark = (r + c) % 2 === 1;
      let cls = 'sq ' + (dark ? 'd' : 'l');
      if (last && (sq === last.from || sq === last.to) && mid < 0) cls += ' last';
      if (sq === G.selected && mid < 0) cls += ' sel';
      if (sq === mid) cls += ' sel';
      const t = tg.get(sq);
      if (t) cls += hints ? ' t-' + t : ' t-quiet';
      if (sq === checkSq) cls += ' check';
      if (must && must.has(sq)) cls += ' must';
      if (pend.includes(sq)) cls += ' pend';
      if (trail.includes(sq)) cls += ' trail';
      if (sq === G.cursor) cls += ' cur';
      if (node.className !== cls) node.className = cls;
      let lab = '';
      if (coords) {
        if (G.game === 'chess') {
          if (v >= 56) lab += `<span class="co f">${'abcdefgh'[c]}</span>`;
          if (v % 8 === 0) lab += `<span class="co r">${8 - r}</span>`;
        } else if (dark) lab = `<span class="co nm">${G.A.num(sq)}</span>`; // draughts: official square numbers
      }
      const p = b[sq], sig = p + '|' + lab;
      if (node._sig !== sig) {
        node._sig = sig;
        node.innerHTML = lab + (p ? G.A.piece(p) : '');
        node.setAttribute('aria-label', sqName(sq) + ', ' + pieceLabel(p));
      }
    }
    renderChrome();
  }
  function animateMove(m, prev, startIdx) {
    if (!data.settings.anim || reducedMotion()) return;
    const path = (G.game !== 'chess' ? m.path : [m.from, m.to]).slice(startIdx);
    const dest = nodeOf(path[path.length - 1]), pc = dest && dest.querySelector('.pc');
    if (!pc || path.length < 2) return;
    const rt = dest.getBoundingClientRect();
    const frames = path.map((sq) => { const r = nodeOf(sq).getBoundingClientRect(); return { transform: `translate(${r.left - rt.left}px,${r.top - rt.top}px)` }; });
    frames[frames.length - 1] = { transform: 'translate(0,0)' };
    const seg = 190, dur = seg * (path.length - 1);
    try { pc.animate(frames, { duration: dur, easing: path.length > 2 ? 'linear' : 'cubic-bezier(.2,.75,.25,1)' }); } catch (e) { /* ignore */ }
    if (G.game === 'chess' && m.flag === 'c') {
      const rf = m.to > m.from ? m.from + 3 : m.from - 4, rto = m.to > m.from ? m.from + 1 : m.from - 1;
      const rn = nodeOf(rto), rp = rn.querySelector('.pc');
      if (rp) {
        const a = nodeOf(rf).getBoundingClientRect(), bR = rn.getBoundingClientRect();
        try { rp.animate([{ transform: `translate(${a.left - bR.left}px,0)` }, { transform: 'translate(0,0)' }], { duration: seg + 40, easing: 'cubic-bezier(.2,.75,.25,1)' }); } catch (e) { /* ignore */ }
      }
    }
    const vs = G.A.victimSquares(prev, m);
    vs.forEach((sq, i) => {
      if (G.game !== 'chess' && i < startIdx) return;
      const p = prev.b[sq]; if (!p) return;
      const n = nodeOf(sq), gh = el('div', { class: 'cap-ghost' }, G.A.piece(p));
      n.appendChild(gh);
      const delay = G.game !== 'chess' ? seg * (i - startIdx) + seg * 0.6 : seg * 0.6;
      try {
        const an = gh.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.55)' }], { duration: 260, delay, easing: 'ease-in', fill: 'forwards' });
        an.onfinish = () => gh.remove();
      } catch (e) { gh.remove(); }
      setTimeout(() => gh.remove(), delay + 400);
    });
  }
  function animateStep(fromSq, toSq) {
    if (!data.settings.anim || reducedMotion()) return;
    const dest = nodeOf(toSq), pc = dest.querySelector('.pc');
    if (!pc) return;
    const a = nodeOf(fromSq).getBoundingClientRect(), b = dest.getBoundingClientRect();
    try { pc.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: 'translate(0,0)' }], { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' }); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ chrome: status, panels, moves ------------------------------ */
  function materialOf(b) {
    let w = 0, k = 0;
    for (const p of b) { if (p > 0) w += [0, 1, 3, 3, 5, 9, 0][p]; else if (p < 0) k += [0, 1, 3, 3, 5, 9, 0][-p]; }
    return w - k;
  }
  function capturedBy() {
    const res = { 1: [], '-1': [] };
    for (let i = 0; i < G.moves.length; i++) { const s = G.states[i]; for (const v of G.A.victims(s, G.moves[i])) res[s.turn].push(v); }
    return res;
  }
  function playerName(side) {
    if (G.mode === 'ai') return side === G.human ? 'You' : 'Mind Board AI';
    return SIDE[G.game][side];
  }
  function playerSub(side) {
    if (G.mode === 'ai') return side === G.human ? SIDE[G.game][side] : `Level ${G.level} · ${LEVEL_NAMES[G.level - 1]}`;
    return side === 1 ? 'Player 1' : 'Player 2';
  }
  function fillPanel(node, side, caps, adv) {
    const s = cur(), active = !G.over && s.turn === side;
    const list = caps[side].slice();
    let capsHTML = '';
    if (G.game === 'chess') {
      list.sort((a, b) => Math.abs(b) - Math.abs(a));
      capsHTML = list.map((p) => `<span class="cap">${chessSVG(p)}</span>`).join('');
    } else if (list.length) {
      capsHTML = list.slice(0, 6).map((p) => `<span class="cap">${checkerSVG(p)}</span>`).join('') + (list.length ? `<span class="cap-n">×${list.length}</span>` : '');
    }
    const advTxt = G.game === 'chess' && adv * side > 0 ? `+${Math.abs(adv)}` : '';
    const thinking = active && G.thinking && G.mode === 'ai' && side !== G.human;
    node.className = 'player' + (active ? ' active' : '') + (thinking ? ' thinking' : '');
    node.innerHTML = `<div class="avatar ${side === 1 ? 'w' : 'b'}">${G.game === 'chess' ? chessSVG(6 * side) : checkerSVG(side)}</div>
      <div class="pinfo"><div class="pname">${playerName(side)}<span class="psub">${playerSub(side)}</span></div>
      <div class="caps" aria-label="Captured pieces">${capsHTML || '<span class="none">No captures yet</span>'}${advTxt ? `<span class="adv">${advTxt}</span>` : ''}</div></div>
      <div class="turn-tag">${thinking ? 'Thinking' : active ? 'To move' : ''}</div>`;
  }
  const REASONS = {
    checkmate: 'by checkmate', stalemate: 'Stalemate', fifty: '50-move rule', material: 'Insufficient material', repetition: 'Threefold repetition',
    blocked: 'opponent has no legal moves', wipeout: 'all opponent pieces captured', kings: 'one king each',
    endgame16: 'endgame rule — 16 moves each against a lone king', endgame5: 'endgame rule — 5 moves each against a lone king'
  };
  function reasonOf(r) {
    if (r === 'quiet') return G.game === 'dama' ? '25 king moves each without a capture' : '40 moves each without a capture or man move';
    return REASONS[r];
  }
  function resultText() {
    const o = G.over, sideName = SIDE[G.game];
    if (o.winner === 0) return 'Draw — ' + reasonOf(o.reason);
    const who = G.mode === 'ai' ? (o.winner === G.human ? 'You win' : 'AI wins') : sideName[o.winner] + ' wins';
    return who + ' — ' + reasonOf(o.reason);
  }
  function renderChrome() {
    if (!G) return;
    const s = cur();
    const st = $('#status');
    let txt, cls = 'status';
    if (G.over) { txt = resultText(); cls += ' over'; }
    else if (G.paused) txt = 'Paused';
    else {
      txt = G.mode === 'ai' ? (s.turn === G.human ? 'Your move' : 'AI is thinking') : SIDE[G.game][s.turn] + ' to move';
      if (G.game === 'chess' && Chess.inCheck(s)) { txt += ' · Check!'; cls += ' check'; }
      else if (G.game !== 'chess' && G.legal.length && G.legal[0].caps.length && (G.mode === 'friend' || s.turn === G.human)) {
        const n = G.legal[0].caps.length;
        txt += G.game === 'dama' && n > 1 ? ` · Must capture ${n}` : ' · Capture is mandatory';
      }
      if (G.thinking) cls += ' thinking';
    }
    st.className = cls;
    st.innerHTML = `<span class="sdot ${s.turn === 1 ? 'w' : 'b'}"></span><span class="stxt">${txt}</span>${G.thinking && !G.over ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}`;
    const caps = capturedBy(), adv = G.game === 'chess' ? materialOf(s.b) : 0;
    const bottom = G.flip ? -1 : 1;
    fillPanel($('#panel-bottom'), bottom, caps, adv);
    fillPanel($('#panel-top'), -bottom, caps, adv);
    // move list
    const ml = $('#movelist');
    let html = '';
    for (let i = 0; i < G.notes.length; i += 2) {
      const lastI = G.notes.length - 1;
      html += `<li><span class="mn">${i / 2 + 1}.</span><span class="mv${i === lastI ? ' now' : ''}">${G.notes[i]}</span><span class="mv${i + 1 === lastI ? ' now' : ''}">${G.notes[i + 1] || ''}</span></li>`;
    }
    if (ml._html !== html) {
      ml._html = html;
      ml.innerHTML = html || '<li class="empty">No moves yet</li>';
      ml.scrollTop = ml.scrollHeight; ml.scrollLeft = ml.scrollWidth;
    }
    const ub = $('#btn-undo');
    ub.disabled = !canUndo();
    ub.title = G.mode === 'ai' ? 'Take back your move (only before the AI replies) — U' : 'Undo last move — U';
    $('#tb-game').textContent = G.A.title;
    $('#tb-sub').textContent = (G.game !== 'chess' ? G.A.size + ' · ' : '') + (G.mode === 'ai' ? `vs AI · ${LEVEL_NAMES[G.level - 1]}` : 'Pass & play');
    $('#veil').hidden = !G.paused;
    boardEl.classList.toggle('locked', !canInteract());
  }

  /* ------------------------------ input ------------------------------ */
  function select(sq) {
    G.selected = sq;
    G.partial = G.game !== 'chess' ? [sq] : null;
    G.cursor = sq;
    sfx('select');
    render();
  }
  function deselect() { if (!G) return; G.selected = -1; G.partial = null; render(); }
  function chooseTarget(sq, opt) {
    opt = opt || {};
    if (G.game === 'chess') {
      const ms = G.legal.filter((m) => m.from === G.selected && m.to === sq);
      if (!ms.length) return;
      if (ms.length > 1 && ms[0].promo) {
        const from = G.selected;
        askPromotion(cur().turn, (pr) => {
          if (!G || G.selected !== from) return;
          const m = ms.find((x) => x.promo === pr);
          if (m) commitMove(m, { noAnim: opt.drag }); else deselect();
        });
        return;
      }
      commitMove(ms[0], { noAnim: opt.drag });
      return;
    }
    const cands = checkerCands(), k = G.partial.length;
    if (cands.some((m) => m.path[k] === sq)) {
      const at = G.partial[k - 1];
      G.partial.push(sq);
      const rem = checkerCands();
      if (rem.length === 1 && rem[0].path.length === G.partial.length) { commitMove(rem[0], { startIdx: k - 1, noAnim: opt.drag }); return; }
      G.cursor = sq;
      sfx('move');
      render();
      if (!opt.drag) animateStep(at, sq);
      return;
    }
    const fin = cands.filter((m) => m.path[m.path.length - 1] === sq);
    if (fin.length === 1) commitMove(fin[0], { startIdx: k - 1, noAnim: opt.drag });
    else if (fin.length > 1) toast('Several routes end there — tap each jump in turn.');
  }
  function handleOther(sq) {
    if (G.partial && G.partial.length > 1) {
      G.partial = [G.partial[0]];
      toast('Finish the whole capture sequence — tap each landing square.');
      render(); return;
    }
    const s = cur();
    if (s.b[sq] && Math.sign(s.b[sq]) === s.turn) {
      sfx('error');
      if (G.game !== 'chess' && G.legal.length && G.legal[0].caps.length) toast('A capture is available — you must take it.');
      else if (G.game === 'chess' && Chess.inCheck(s)) toast('Your king is in check — that piece can’t help.');
      else toast('That piece has no legal moves.');
    }
    deselect();
  }
  function tap(sq) {
    if (!canInteract()) { nudgeWhy(); return; }
    if (G.selected >= 0 && targets().has(sq)) { chooseTarget(sq); return; }
    const mid = G.partial && G.partial.length > 1;
    if (mid) { if (sq !== G.partial[G.partial.length - 1]) handleOther(sq); return; }
    if (G.legal.some((m) => m.from === sq)) { if (G.selected === sq) deselect(); else select(sq); return; }
    handleOther(sq);
  }
  function nudgeWhy() {
    if (!G || G.over || G.paused || modals.length) return;
    if (G.mode === 'ai' && cur().turn !== G.human) toast('The AI is thinking…');
  }
  let drag = null;
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    boardEl.classList.remove('kbd');
    ensureAudio();
    const sq = sqFromPoint(e.clientX, e.clientY);
    if (sq < 0 || !G) return;
    if (!canInteract()) { nudgeWhy(); return; }
    e.preventDefault();
    if (G.selected >= 0 && targets().has(sq)) { chooseTarget(sq); return; }
    const mid = G.partial && G.partial.length > 1;
    const movable = mid ? sq === G.partial[G.partial.length - 1] : G.legal.some((m) => m.from === sq);
    if (!movable) { handleOther(sq); return; }
    const was = !mid && G.selected === sq;
    if (!mid && !was) select(sq);
    drag = { sq, x: e.clientX, y: e.clientY, moved: false, was, id: e.pointerId, ghost: null };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 7) {
      const node = nodeOf(drag.sq), pc = node.querySelector('.pc');
      if (!pc) return;
      drag.moved = true;
      const size = node.getBoundingClientRect().width * 1.18;
      const gh = el('div', { class: 'drag-ghost' }, pc.outerHTML);
      gh.style.width = gh.style.height = size + 'px';
      document.body.appendChild(gh);
      drag.ghost = gh; drag.size = size;
      node.classList.add('lift');
    }
    if (drag.moved && drag.ghost) {
      drag.ghost.style.transform = `translate(${e.clientX - drag.size / 2}px,${e.clientY - drag.size * 0.62}px)`;
      const over = sqFromPoint(e.clientX, e.clientY);
      squares.forEach((n) => n.classList.remove('hover'));
      if (over >= 0 && targets().has(over)) nodeOf(over).classList.add('hover');
    }
  });
  function endDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    squares.forEach((n) => n.classList.remove('lift', 'hover'));
  }
  boardEl.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; endDrag(); drag = null;
    if (!G) return;
    if (d.moved) {
      const sq = sqFromPoint(e.clientX, e.clientY);
      if (sq >= 0 && sq !== d.sq && targets().has(sq)) chooseTarget(sq, { drag: true });
      else render();
    } else if (d.was) deselect();
  });
  boardEl.addEventListener('pointercancel', () => { if (drag) { endDrag(); drag = null; render(); } });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  boardEl.addEventListener('keydown', (e) => {
    if (!G) return;
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
      boardEl.classList.add('kbd');
      const n = G.n, NN = G.NN;
      if (G.cursor < 0) G.cursor = 0;
      let v = G.flip ? NN - 1 - G.cursor : G.cursor;
      let r = (v / n) | 0, c = v % n;
      if (k === 'ArrowUp') r = Math.max(0, r - 1); if (k === 'ArrowDown') r = Math.min(n - 1, r + 1);
      if (k === 'ArrowLeft') c = Math.max(0, c - 1); if (k === 'ArrowRight') c = Math.min(n - 1, c + 1);
      v = r * n + c; G.cursor = G.flip ? NN - 1 - v : v;
      render();
      announce(sqName(G.cursor) + ', ' + pieceLabel(displayBoard().b[G.cursor]));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault(); boardEl.classList.add('kbd'); ensureAudio();
      if (G.cursor >= 0) tap(G.cursor);
    }
  });
  boardEl.addEventListener('focus', () => { if (G && G.cursor < 0) G.cursor = 0; });
  function announce(t) { const a = $('#sr'); if (a) a.textContent = t; }

  document.addEventListener('keydown', (e) => {
    if (modals.length) {
      const top = modals[modals.length - 1];
      if (e.key === 'Escape') { e.preventDefault(); if (top.dismissible) top.close(); }
      else if (e.key === 'Tab') trapFocus(e, top.box);
      return;
    }
    if ($('#play').hidden || !G) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); if (G.selected >= 0) deselect(); else openPause(); }
    else if (k === 'u' || ((e.ctrlKey || e.metaKey) && k === 'z')) { e.preventDefault(); undo(); }
    else if (k === 'p') { e.preventDefault(); openPause(); }
    else if (k.startsWith('arrow') && document.activeElement !== boardEl) { e.preventDefault(); boardEl.focus(); boardEl.classList.add('kbd'); render(); }
  });
  function trapFocus(e, box) {
    const f = [...box.querySelectorAll('button:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------ modals & toast ------------------------------ */
  const layer = $('#layer');
  const modals = [];
  function openModal(o) {
    const back = el('div', { class: 'backdrop' });
    const box = el('div', { class: 'modal ' + (o.cls || ''), role: 'dialog', 'aria-modal': 'true' });
    const dismissible = o.dismissible !== false;
    if (o.title) { const id = 'mt' + (++thinkSeq); box.setAttribute('aria-labelledby', id); box.appendChild(el('h2', { id }, o.title)); }
    if (dismissible) { const x = el('button', { class: 'icon-btn modal-x', 'aria-label': 'Close' }, icon('close')); x.onclick = () => close(); box.appendChild(x); }
    const content = el('div', { class: 'modal-body' });
    if (typeof o.body === 'string') content.innerHTML = o.body; else if (o.body) content.appendChild(o.body);
    box.appendChild(content);
    if (o.actions && o.actions.length) {
      const f = el('div', { class: 'modal-actions' });
      for (const a of o.actions) {
        const b = el('button', { class: 'btn ' + (a.primary ? 'primary' : 'ghost') }, a.label);
        b.onclick = () => { close(true); if (a.onClick) a.onClick(); };
        f.appendChild(b);
      }
      box.appendChild(f);
    }
    back.appendChild(box); layer.appendChild(back);
    const prevFocus = document.activeElement;
    const m = { back, box, dismissible, close };
    modals.push(m);
    requestAnimationFrame(() => back.classList.add('in'));
    const first = box.querySelector('.autofocus') || box.querySelector('.modal-actions .btn.primary') || box.querySelector('.modal-body button') || box.querySelector('button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    if (dismissible) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    function close(fromAction) {
      const i = modals.indexOf(m); if (i < 0) return;
      modals.splice(i, 1);
      back.classList.remove('in'); back.classList.add('out');
      setTimeout(() => back.remove(), 200);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      if (!fromAction && o.onClose) o.onClose();
      if (G) renderChrome();
    }
    if (G) renderChrome();
    return m;
  }
  function confirmBox(title, text, okLabel, onOk, onCancel) {
    openModal({ title, body: `<p>${text}</p>`, cls: 'small', onClose: onCancel, actions: [{ label: 'Cancel', onClick: onCancel }, { label: okLabel, primary: true, onClick: onOk }] });
  }
  let toastTimer = null;
  function toast(t) {
    const n = $('#toast'); n.textContent = t; n.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('show'), 2400);
  }
  function askPromotion(side, cb) {
    const wrap = el('div', { class: 'promo' });
    let chosen = false;
    for (const pr of [5, 4, 3, 2]) {
      const b = el('button', { class: 'promo-btn', 'aria-label': 'Promote to ' + PIECE_NAME[pr] }, chessSVG(pr * side) + `<span>${PIECE_NAME[pr]}</span>`);
      b.onclick = () => { chosen = true; m.close(true); cb(pr); };
      wrap.appendChild(b);
    }
    const m = openModal({ title: 'Promote pawn', body: wrap, cls: 'small', onClose: () => { if (!chosen) cb(0); } });
    wrap.firstChild.classList.add('autofocus');
  }

  /* ------------------------------ screens ------------------------------ */
  function showScreen(id) {
    $('#home').hidden = id !== 'home';
    $('#play').hidden = id !== 'play';
    window.scrollTo(0, 0);
  }
  /* ---------- rules content (draughts) ---------- */
  const RULES = {
    checkers: {
      name: 'Classic Checkers', size: '8×8',
      intro: 'The quick, familiar game: 12 pieces each on an 8×8 board. Pieces never fly and men only go forward.',
      steps: [
        { t: 'The board', d: '12 pieces each start on the dark squares of an 8×8 board. <b>Dark moves first</b>, then players alternate.', dg: { n: 5, p: { 1: -1, 3: -1, 5: -1, 7: -1, 9: -1, 15: 1, 17: 1, 19: 1, 21: 1, 23: 1 } } },
        { t: 'Moving', d: 'Men move <b>one square diagonally forward</b> onto an empty dark square.', dg: { n: 5, p: { 17: 1 }, dots: [11, 13] } },
        { t: 'Capturing is mandatory', d: 'Jump over an adjacent enemy piece to the empty square just beyond. If any capture is possible you <b>must</b> capture — but you may choose which one. Men capture <b>forward only</b>.', dg: { n: 5, p: { 21: 1, 17: -1 }, caps: [17], path: [21, 13] } },
        { t: 'Multi-jumps', d: 'If the same piece can jump again after landing, it <b>must keep jumping</b> until no capture is left. Tap each landing square in turn.', dg: { n: 5, p: { 21: 1, 17: -1, 7: -1 }, caps: [17, 7], path: [21, 13, 1] } },
        { t: 'Kings', d: 'A man reaching the far row is <b>crowned</b>. Kings move and capture <b>one square in any diagonal direction</b>, forward or backward.', dg: { n: 5, p: { 11: 2 }, dots: [5, 7, 15, 17] } },
        { t: 'Crowning ends the move', d: 'If a man reaches the far row during a capture, it is crowned and the move <b>stops there</b>, even if more jumps were possible.', dg: { n: 6, p: { 13: 1, 8: -1, 10: -1 }, caps: [8], path: [13, 3], crown: 3 } },
        { t: 'Winning & draws', d: 'You win by capturing every enemy piece or leaving your opponent <b>without a legal move</b>. It is a draw after <b>40 moves each</b> without a capture or a man moving, after <b>threefold repetition</b>, or when only <b>one king each</b> remains.', icon: 'check' }
      ]
    },
    dama: {
      name: 'International Dama', size: '10×10',
      intro: 'The international draughts game: 20 pieces each on a 10×10 board, with flying kings and the maximum-capture rule.',
      steps: [
        { t: 'A bigger board', d: '20 pieces each start on the dark squares of a <b>10×10</b> board (four rows each). <b>Light moves first</b>.', dg: { n: 6, p: { 1: -1, 3: -1, 5: -1, 6: -1, 8: -1, 10: -1, 25: 1, 27: 1, 29: 1, 30: 1, 32: 1, 34: 1 } } },
        { t: 'Men capture backwards too', d: 'Men move one square diagonally forward, but they <b>capture forward and backward</b>.', dg: { n: 5, p: { 7: 1, 13: -1 }, caps: [13], path: [7, 19] } },
        { t: 'Maximum capture', d: 'Capturing is mandatory and you <b>must take the sequence that captures the most pieces</b>. Here the two-piece route (gold) is required; the one-piece route (grey) is not allowed. Captured pieces are removed after the move and cannot be jumped twice.', dg: { n: 6, p: { 30: 1, 25: -1, 15: -1, 32: 1, 27: -1 }, caps: [25, 15], path: [30, 20, 10], alt: [32, 22] } },
        { t: 'Flying kings', d: 'Kings move <b>any distance</b> along a diagonal. They capture a piece from a distance and may land on <b>any empty square beyond it</b>.', dg: { n: 6, p: { 30: 2, 15: -1 }, caps: [15], path: [30, 10], dots: [10, 5] } },
        { t: 'Promotion', d: 'A man is crowned only if it <b>ends its move</b> on the far row. Passing through the far row in the middle of a capture does not count.', dg: { n: 6, p: { 13: 1, 8: -1, 10: -1 }, caps: [8, 10], path: [13, 3, 17] } },
        { t: 'Winning & draws', d: 'You win when your opponent has <b>no pieces or no legal move</b>. Draws: <b>threefold repetition</b>; <b>25 moves each</b> with only kings moving and no capture; and against a <b>lone king</b>: 16 moves each with three pieces (including a king), or 5 moves each with two pieces or fewer.', icon: 'check' }
      ]
    }
  };
  function miniBoard(dg, cls) {
    const n = dg.n;
    let cells = '';
    for (let i = 0; i < n * n; i++) {
      const r = (i / n) | 0, c = i % n, d = (r + c) % 2 === 1, p = dg.p && dg.p[i];
      const x = dg.caps && dg.caps.includes(i), dot = dg.dots && dg.dots.includes(i);
      cells += `<i class="${d ? 'd' : 'l'}${x ? ' x' : ''}${dot ? ' dot' : ''}">${p ? checkerSVG(dg.crown === i ? 2 : p) : ''}</i>`;
    }
    const pt = (i) => `${(i % n) + 0.5},${((i / n) | 0) + 0.5}`;
    let svg = '';
    if (dg.alt) svg += `<polyline class="alt" points="${dg.alt.map(pt).join(' ')}"/>`;
    if (dg.path) {
      const e = dg.path[dg.path.length - 1];
      svg += `<polyline class="route" points="${dg.path.map(pt).join(' ')}"/><circle class="route-end" cx="${(e % n) + 0.5}" cy="${((e / n) | 0) + 0.5}" r=".16"/>`;
      if (dg.crown != null) svg += `<path class="mini-crown" transform="translate(${(dg.crown % n) + 0.12},${((dg.crown / n) | 0) + 0.12}) scale(.0076)" d="M31 62l-4.5-23 12.5 9.5 11-15.5 11 15.5 12.5-9.5-4.5 23z"/>`;
    }
    return `<div class="mini ${cls || ''}" style="--mn:${n}">${cells}<svg viewBox="0 0 ${n} ${n}" aria-hidden="true">${svg}</svg></div>`;
  }
  const stepArt = (s, cls) => (s.dg ? miniBoard(s.dg, cls) : `<div class="mini-icon ${cls || ''}">${icon(s.icon)}</div>`);
  const sizeBadge = (g) => `<span class="size-badge">${A[g].size}</span>`;
  function openRules(game, after) {
    const R = RULES[game];
    const body = el('div', { class: 'rules' });
    body.innerHTML = `<p class="rules-intro">${R.intro}</p>` + R.steps.map((s, i) =>
      `<section class="rule"><div class="rule-art">${stepArt(s, 'sm')}</div><div><h3><span class="rule-n">${i + 1}</span>${s.t}</h3><p>${s.d}</p></div></section>`).join('');
    openModal({ title: `${R.name} ${sizeBadge(game)}`, body, cls: 'rules-modal rules-' + game, onClose: after, actions: [{ label: 'Got it', primary: true, onClick: after }] });
  }
  function openGameTutorial(game, after) {
    const R = RULES[game];
    let i = 0;
    const body = el('div', { class: 'tut game-tut tut-' + game });
    const done = () => { data.seen[game] = true; persist(); if (after) after(); };
    const draw = () => {
      const s = R.steps[i], lastStep = i === R.steps.length - 1;
      body.innerHTML = `<div class="tut-chip">${R.name} · ${R.size}</div>${stepArt(s, 'lg')}<h3>${s.t}</h3><p>${s.d}</p>
        <div class="tut-dots">${R.steps.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="modal-actions"><button class="btn ghost" data-a="back">${i === 0 ? 'Skip' : 'Back'}</button><button class="btn primary autofocus" data-a="next">${lastStep ? 'Start playing' : 'Next'}</button></div>`;
      body.querySelector('[data-a="next"]').onclick = () => { if (!lastStep) { i++; draw(); body.querySelector('[data-a="next"]').focus(); } else { m.close(true); done(); } };
      body.querySelector('[data-a="back"]').onclick = () => { if (i === 0) { m.close(true); done(); } else { i--; draw(); } };
    };
    draw();
    const m = openModal({ body, cls: 'tut-modal', onClose: done });
  }

  /* ---------- home ---------- */
  const CARD = {
    chess: { desc: 'The classic game of kings. Full rules: castling, en passant, promotion.', art: () => `<div class="card-art">${chessSVG(-6)}${chessSVG(5)}${chessSVG(2)}</div>` },
    checkers: { desc: '12 pieces each. Men move forward, kings step one square. Quick and familiar.', art: () => `<div class="card-art ck-art">${checkerSVG(-1)}${checkerSVG(1)}${checkerSVG(-2)}</div>` },
    dama: { desc: '20 pieces each. Flying kings, backward captures, maximum-capture rule.', art: () => `<div class="card-art ck-art dama-art">${checkerSVG(-1)}${checkerSVG(-1)}${checkerSVG(2)}${checkerSVG(1)}${checkerSVG(1)}</div>` }
  };
  const modeLabel = (sv) => (sv.mode === 'ai' ? 'vs AI · ' + LEVEL_NAMES[clampInt(sv.level, 1, 5, 1) - 1] : 'Pass & play');
  function renderHome() {
    const wrap = $('#game-cards');
    wrap.innerHTML = '';
    for (const g of GAMES) {
      const prog = data.progress[g], saves = MODES.map((m) => data.saves[g][m]).filter(Boolean);
      const pips = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= prog ? 'on' : ''}" title="Level ${i}"></i>`).join('');
      const resume = saves.map((sv) => `<button class="btn resume" data-act="resume" data-mode="${sv.mode}">${icon('play')}<span class="rs-main">Resume ${modeLabel(sv)}</span><span class="rs-meta">${sv.moves.length} moves</span></button>`).join('');
      const card = el('article', { class: 'card card-' + g }, `${CARD[g].art()}<span class="art-badge">${A[g].size}</span>
        <div class="card-body">
          <h2>${A[g].title}</h2>
          <p class="card-desc">${CARD[g].desc}</p>
          <div class="levels"><span>AI levels</span><span class="pips">${pips}</span><span class="lv-txt">${prog}/5 unlocked</span></div>
          ${resume ? `<div class="resume-list">${resume}</div>` : ''}
          <div class="card-actions">
            <button class="btn ${saves.length ? 'ghost' : 'primary'}" data-act="new">${saves.length ? 'New game' : icon('play') + 'Play'}</button>
            ${g !== 'chess' ? `<button class="btn ghost rules-btn" data-act="rules">${icon('help')}Rules</button>` : ''}
          </div>
        </div>`);
      card.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', () => {
          ensureAudio();
          const act = b.dataset.act;
          if (act === 'resume') { if (restore(g, b.dataset.mode)) enterGame(); else renderHome(); }
          else if (act === 'rules') openRules(g);
          else openSetup(g);
        });
      });
      wrap.appendChild(card);
    }
  }
  function seg(name, options, value, onChange) {
    const w = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': name });
    const btns = options.map((o) => {
      const b = el('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(o.value === value) }, o.label);
      b.onclick = () => { btns.forEach((x) => x.setAttribute('aria-checked', 'false')); b.setAttribute('aria-checked', 'true'); onChange(o.value); };
      return b;
    });
    btns.forEach((b) => w.appendChild(b));
    return w;
  }
  const SETUP_NOTE = {
    checkers: 'Classic rules: men move and capture forward only, kings step one square, any available capture may be chosen. Dark moves first.',
    dama: 'International rules: men capture backwards, kings fly, and you must take the maximum number of pieces. Light moves first.'
  };
  function openSetup(game) {
    const last = data.last[game];
    const st = { mode: last.mode, level: Math.min(last.level, data.progress[game]), side: last.side };
    const body = el('div', { class: 'setup' });
    const sideNames = game === 'chess' ? ['White', 'Black'] : ['Light', 'Dark'];
    const warn = el('p', { class: 'warn-note' });
    const updWarn = () => { warn.hidden = !data.saves[game][st.mode]; warn.textContent = `Starting a new game replaces your saved ${st.mode === 'ai' ? 'vs AI' : 'pass & play'} game.`; };
    body.appendChild(el('div', { class: 'field-label' }, 'Opponent'));
    body.appendChild(seg('Opponent', [{ label: 'Versus AI', value: 'ai' }, { label: 'With a friend', value: 'friend' }], st.mode, (v) => { st.mode = v; aiBox.hidden = v !== 'ai'; updWarn(); }));
    const aiBox = el('div', { class: 'ai-box' });
    aiBox.hidden = st.mode !== 'ai';
    aiBox.appendChild(el('div', { class: 'field-label' }, 'Difficulty'));
    const lv = el('div', { class: 'level-grid' });
    const lvBtns = [];
    for (let i = 1; i <= 5; i++) {
      const locked = i > data.progress[game];
      const b = el('button', { class: 'level' + (locked ? ' locked' : ''), 'aria-pressed': String(i === st.level), 'aria-label': `Level ${i}, ${LEVEL_NAMES[i - 1]}${locked ? ', locked' : ''}` },
        `<span class="lv-n">${locked ? icon('lock') : i}</span><span class="lv-name">${LEVEL_NAMES[i - 1]}</span>`);
      b.onclick = () => {
        if (locked) { toast(`Win at level ${i - 1} to unlock ${LEVEL_NAMES[i - 1]}.`); sfx('error'); return; }
        st.level = i; lvBtns.forEach((x, j) => x.setAttribute('aria-pressed', String(j + 1 === i))); desc.textContent = LEVEL_DESC[i - 1];
      };
      lvBtns.push(b); lv.appendChild(b);
    }
    aiBox.appendChild(lv);
    const desc = el('p', { class: 'level-desc' }, LEVEL_DESC[st.level - 1]);
    aiBox.appendChild(desc);
    aiBox.appendChild(el('div', { class: 'field-label' }, 'You play'));
    aiBox.appendChild(seg('Your side', [{ label: sideNames[0], value: 'w' }, { label: 'Random', value: 'r' }, { label: sideNames[1], value: 'b' }], st.side, (v) => { st.side = v; }));
    body.appendChild(aiBox);
    if (game !== 'chess') {
      const note = el('div', { class: 'rules-note' }, `<span>${SETUP_NOTE[game]}</span>`);
      const rb = el('button', { class: 'link-btn' }, 'Full rules');
      rb.onclick = () => openRules(game);
      note.appendChild(rb);
      body.appendChild(note);
    }
    body.appendChild(warn); updWarn();
    openModal({
      title: `New ${A[game].title} game${game !== 'chess' ? ' ' + sizeBadge(game) : ''}`, body, cls: 'setup-modal setup-' + game,
      actions: [{ label: 'Cancel' }, {
        label: 'Start game', primary: true, onClick: () => {
          data.last[game] = { mode: st.mode, level: st.level, side: st.side };
          const human = st.side === 'r' ? (Math.random() < 0.5 ? 1 : -1) : st.side === 'b' ? -1 : 1;
          newSession(game, { mode: st.mode, level: st.level, human });
          saveSession();
          enterGame({ tutorial: game !== 'chess' && !data.seen[game] });
        }
      }]
    });
  }
  function enterGame(opts) {
    opts = opts || {};
    showScreen('play');
    buildBoard(G.n);
    boardEl.classList.remove('kbd');
    $('#play').dataset.game = G.game;
    $('#movelist')._html = null;
    render();
    if (opts.tutorial) {
      const g = G;
      openGameTutorial(G.game, () => { if (G === g) { render(); scheduleAI(400); } });
    } else scheduleAI(G.moves.length === 0 ? 500 : AI_DELAY);
  }
  function leaveGame() {
    if (G) { cancelAI(); if (!G.over) saveSession(); }
    G = null;
    renderHome();
    showScreen('home');
  }
  function restartGame() {
    if (!G) return;
    const o = { mode: G.mode, level: G.level, human: G.human }, g = G.game;
    cancelAI();
    newSession(g, o); saveSession(); enterGame();
  }
  function askRestart() {
    if (!G) return;
    if (!G.moves.length) { restartGame(); return; }
    confirmBox('Restart game?', 'The current position will be lost and a new game will begin with the same settings.', 'Restart', restartGame);
  }
  function openPause() {
    if (!G || modals.length) return;
    G.paused = true; cancelAI(); G.selected = -1; G.partial = null;
    saveSession(); render();
    const resume = () => { if (!G) return; G.paused = false; render(); scheduleAI(); };
    const reopen = () => { if (G) { G.paused = false; openPause(); } };
    const actions = [
      { label: 'Main menu', onClick: () => { G.paused = false; leaveGame(); } },
      { label: 'Settings', onClick: () => openSettings(reopen) }
    ];
    if (G.game !== 'chess') actions.push({ label: 'Rules', onClick: () => openRules(G.game, reopen) });
    actions.push({ label: 'Restart', onClick: () => { G.paused = false; render(); askRestart(); } }, { label: 'Resume', primary: true, onClick: resume });
    openModal({
      title: 'Paused', cls: 'small pause-modal',
      body: `<p class="muted">${G.A.title}${G.game !== 'chess' ? ' (' + G.A.size + ')' : ''} · ${G.mode === 'ai' ? 'vs AI, level ' + G.level + ' (' + LEVEL_NAMES[G.level - 1] + ')' : 'pass & play'} · ${G.moves.length} moves played. Your game is saved.</p>`,
      onClose: resume, actions
    });
  }
  function openSettings(after) {
    const body = el('div', { class: 'settings' });
    const rows = [
      ['sound', 'Sound effects', 'Soft clicks for moves and captures'],
      ['hints', 'Show legal moves', 'Highlight where the selected piece can go'],
      ['anim', 'Animations', 'Slide pieces between squares'],
      ['coords', 'Board coordinates', 'Chess files & ranks, draughts square numbers'],
      ['flip', 'Rotate for pass & play', 'Turn the board toward whoever is to move']
    ];
    for (const [k, label, hint] of rows) {
      const b = el('button', { class: 'switch-row', role: 'switch', 'aria-checked': String(data.settings[k]) },
        `<span class="sw-text"><span class="sw-label">${label}</span><span class="sw-hint">${hint}</span></span><span class="sw" aria-hidden="true"><i></i></span>`);
      b.onclick = () => {
        data.settings[k] = !data.settings[k];
        b.setAttribute('aria-checked', String(data.settings[k]));
        persist();
        if (k === 'sound' && data.settings.sound) sfx('select');
        if (G) { for (const n of squares) n._sig = ''; render(); }
      };
      body.appendChild(b);
    }
    const tools = el('div', { class: 'settings-tools' });
    const tut = el('button', { class: 'btn ghost' }, icon('help') + 'Show tutorial');
    tut.onclick = () => { m.close(true); if (G && G.game !== 'chess') openGameTutorial(G.game, after); else openTutorial(after); };
    const reset = el('button', { class: 'btn ghost danger' }, 'Reset progress');
    reset.onclick = () => {
      m.close(true);
      confirmBox('Reset all progress?', 'This locks AI levels 2–5 again in all three games and deletes every saved game on this device. Settings are kept.', 'Reset', () => {
        const fresh = defaults();
        data.progress = fresh.progress; data.saves = fresh.saves;
        persist(); renderHome(); toast('Progress reset.');
        if (after) after();
      }, after);
    };
    tools.appendChild(tut); tools.appendChild(reset);
    body.appendChild(tools);
    body.appendChild(el('p', { class: 'fineprint' }, 'Everything is stored only in this browser. Nothing is sent anywhere.'));
    const m = openModal({ title: 'Settings', body, onClose: after, actions: [{ label: 'Done', primary: true, onClick: after }] });
  }
  const TUT = [
    { t: 'Welcome to Mind Board', d: 'Chess, Classic Checkers and International Dama — completely offline. No account, no sign-in, nothing leaves this device.', art: 'board' },
    { t: 'Two ways to play', d: 'Pass the device to a friend, or challenge the AI. Win at a level to unlock the next — five per game.', art: 'levels' },
    { t: 'Tap, drag or use keys', d: 'Tap a piece to see its legal moves, then tap a glowing square. You can also drag pieces, or use the arrow keys and Enter.', art: 'tap' },
    { t: 'Your games wait for you', d: 'Leave anytime — each game keeps its own vs-AI and pass-and-play save. Against the AI you can take back a move until it replies.', art: 'save' }
  ];
  function tutArt(kind) {
    if (kind === 'board') return `<div class="tut-art tut-board">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<i class="${(i % 2) ? 'd' : 'l'}">${i === 4 ? chessSVG(2) : i === 0 ? checkerSVG(-1) : i === 8 ? checkerSVG(1) : ''}</i>`).join('')}</div>`;
    if (kind === 'levels') return `<div class="tut-art tut-levels">${[1, 2, 3, 4, 5].map((i) => `<span class="${i === 1 ? 'on' : ''}">${i === 1 ? '1' : icon('lock')}</span>`).join('')}</div>`;
    if (kind === 'tap') return `<div class="tut-art tut-tap"><i class="l"></i><i class="d t"></i><i class="l"></i><i class="d"></i><i class="l sel">${chessSVG(3)}</i><i class="d"></i><i class="l"></i><i class="d t"></i><i class="l"></i></div>`;
    return `<div class="tut-art tut-save">${icon('check')}</div>`;
  }
  function openTutorial(after) {
    let i = 0;
    const body = el('div', { class: 'tut' });
    const draw = () => {
      const s = TUT[i];
      body.innerHTML = `${tutArt(s.art)}<h3>${s.t}</h3><p>${s.d}</p><div class="tut-dots">${TUT.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="modal-actions"><button class="btn ghost" data-a="skip">${i === TUT.length - 1 ? 'Back' : 'Skip'}</button><button class="btn primary autofocus" data-a="next">${i === TUT.length - 1 ? 'Start playing' : 'Next'}</button></div>`;
      body.querySelector('[data-a="next"]').onclick = () => { if (i < TUT.length - 1) { i++; draw(); body.querySelector('[data-a="next"]').focus(); } else finish(); };
      body.querySelector('[data-a="skip"]').onclick = () => { if (i === TUT.length - 1) { i--; draw(); } else finish(); };
    };
    const finish = () => { m.close(true); done(); };
    const done = () => { data.tutorial = true; persist(); if (after) after(); };
    draw();
    const m = openModal({ body, cls: 'tut-modal', onClose: done });
  }
  function showResult(unlocked) {
    const o = G.over, won = G.mode === 'ai' && o.winner === G.human, lost = G.mode === 'ai' && o.winner === -G.human;
    let title, msg;
    if (o.winner === 0) { title = 'Draw'; msg = reasonOf(o.reason) + '.'; }
    else {
      const how = o.reason === 'checkmate' ? ' by checkmate' : ' — ' + reasonOf(o.reason);
      if (G.mode === 'friend') { title = SIDE[G.game][o.winner] + ' wins'; msg = reasonOf(o.reason) + '.'; }
      else if (won) { title = 'Victory'; msg = `You beat ${LEVEL_NAMES[G.level - 1]}${how}.`; }
      else { title = 'Defeat'; msg = `${LEVEL_NAMES[G.level - 1]} won${how}. Try again — every game teaches something.`; }
    }
    msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    let extra = '';
    if (unlocked) extra = `<div class="unlock">${icon('check')}<span>Level ${unlocked} · <b>${LEVEL_NAMES[unlocked - 1]}</b> unlocked</span></div>`;
    else if (won && G.level === 5) extra = `<div class="unlock">${icon('check')}<span>You beat the strongest level. Superb.</span></div>`;
    const actions = [{ label: 'Main menu', onClick: leaveGame }, { label: 'Review board' }];
    if (won && G.level < 5) actions.push({ label: 'Next level', primary: true, onClick: () => { G.level = G.level + 1; data.last[G.game].level = G.level; restartGame(); } });
    else actions.push({ label: 'Play again', primary: true, onClick: restartGame });
    openModal({ title, body: `<div class="result ${won ? 'win' : lost ? 'loss' : 'neutral'}"><p>${msg}</p>${extra}<p class="muted">${G.moves.length} moves played.</p></div>`, cls: 'small result-modal', actions });
  }

  /* ------------------------------ wiring ------------------------------ */
  $('#btn-menu').innerHTML = icon('back');
  $('#btn-pause').innerHTML = icon('pause');
  $('#btn-settings').innerHTML = icon('settings');
  $('#btn-undo').innerHTML = icon('undo') + '<span>Undo</span>';
  $('#btn-restart').innerHTML = icon('restart') + '<span>Restart</span>';
  $('#btn-pause2').innerHTML = icon('pause') + '<span>Pause</span>';
  $('#home-help').innerHTML = icon('help') + 'How to play';
  $('#home-settings').innerHTML = icon('settings') + 'Settings';
  $('#btn-menu').onclick = leaveGame;
  $('#btn-pause').onclick = openPause;
  $('#btn-pause2').onclick = openPause;
  $('#btn-settings').onclick = () => openSettings();
  $('#btn-undo').onclick = undo;
  $('#btn-restart').onclick = askRestart;
  $('#home-help').onclick = () => openTutorial();
  $('#home-settings').onclick = () => openSettings();
  document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.over) saveSession(); });
  window.addEventListener('pagehide', () => { if (G && !G.over) saveSession(); });

  renderHome();
  showScreen('home');
  if (!data.tutorial) setTimeout(() => openTutorial(), 250);

  // Small hook for automated testing and debugging (read-only state access).
  window.MindBoard = { get session() { return G; }, data, Engines, commitMove: (m) => commitMove(m), tap };
})();
