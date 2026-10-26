/* trade_selftest.js — сверка trade_rules.js с примерами, созданными кодом бота (trade_selftest/fixtures.js,
 * генератор bot_next21/tools/make_trade_fixtures.py; SPEC_C2 §14). Итог — в заголовке страницы: «SELFTEST OK N/N»
 * или «SELFTEST FAIL …». Без страницы (Deno: bot_next21/tools/selftest_trade_deno.js) итог кладётся в
 * TRADE_SELFTEST_RESULT, DOM не трогается. Группа version_guard проверяет и TradeGuard из trade.js; группа labels
 * (19.1, бот 2.3) — надписи страницы TradeGuard.labels против надписей бота (manual_messages); группы breakout, t2,
 * trail (19.2, бот 2.4) — вход при пробое, вторая цель и трейлинг Bybit против manual_rules и проверок ManualDesk. */
(function (root) {
  'use strict';
  var R = root.TradeRules, FX = root.TRADE_FIXTURES, TG = root.TradeGuard;

  function canon(x) {  // JSON с упорядоченными ключами — для сравнения объектов
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') {
      return '{' + Object.keys(x).sort().map(function (k) {
        return JSON.stringify(k) + ':' + canon(x[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
  }
  function s(q) { return q === null || q === undefined ? null : R.toApiStr(q); }
  function nn(x) { return x === null || x === undefined ? null : R.dec(x); }
  function same(got, exp) { return [canon(got) === canon(exp), got]; }
  function sizeOut(sz) {
    if (!sz) return null;
    return { ok: sz.ok, code: sz.code, qty: s(sz.qty), u: s(sz.u), risk_plan: s(sz.riskPlan), notional: s(sz.notional),
      bumped: sz.bumped, capped: sz.capped, risk_need: s(sz.riskNeed) };
  }
  function swingsIn(sw) {
    if (!sw) return null;
    var pt = function (x) { return { px: R.dec(x[0]), t: x[1] }; };
    return { tf: sw.tf, highs: sw.highs.map(pt), lows: sw.lows.map(pt) };
  }
  function lvOut(lv) { return lv ? [s(lv.px), lv.t] : null; }
  function stopOut(sp) {
    return { stop: s(sp.stop), src: sp.src, level: lvOut(sp.level), price: s(sp.price),
      skipped: sp.skipped.map(function (x) { return [s(x[0].px), x[0].t, x[1], x[2]]; }), far: sp.far,
      far_pct: s(sp.farPct), searched: sp.searched };
  }
  function parsed(q) {
    var p = R.parseQuery(q);
    if (!p || p.err) throw new Error('адрес не разобран: ' + (p && p.err));
    return p;
  }

  var groups = {
    size: function (c) {
      var i = c.in;
      var sz = R.planSize(i.d, R.dec(i.p), R.dec(i.s), { fin: R.dec(i.fi), fout: R.dec(i.fo), risk: R.dec(i.risk),
        qs: R.dec(i.qs), mq: R.dec(i.mq), mn: R.dec(i.mn), maxQ: nn(i.maxq), cap: R.dec(i.cap), tol: R.dec(i.tol) });
      return same(sizeOut(sz), c.exp);
    },
    plim: function (c) {
      var i = c.in;
      return same({ p: s(R.priceLimit(i.d, R.dec(i.ref), R.dec(i.stop), R.dec(i.tick), i.sm, R.dec(i.sf))) }, c.exp);
    },
    swings: function (c) {    // закрытые по времени сервера свечи и фрактал 2/2
      var i = c.in, tf = i.tf === '60' ? R.H1_MS : R.BAR_MS;
      var bars = i.bars.map(function (b) { return { t: b[0], h: b[1], l: b[2] }; });
      var closed = R.closedBars(bars, i.now, i.n, tf);
      var sw = R.swingPoints(closed, i.tf === '60' ? 'H1' : 'M5');
      var pts = function (a) { return a.map(function (x) { return [s(x.px), x.t]; }); };
      return same({ closed: closed.map(function (b) { return b.t; }), highs: pts(sw.highs), lows: pts(sw.lows) }, c.exp);
    },
    stop_default: function (c) {
      var i = c.in, r = i.rule;
      var sp = R.defaultStop(i.d, { et: i.et, bid: R.dec(i.bid), ask: R.dec(i.ask), tick: R.dec(i.tick),
        fin: R.dec(i.fi), fout: R.dec(i.fo), m5: swingsIn(i.m5), h1: swingsIn(i.h1), E: nn(i.E),
        rule: { sb: Number(r.sb), ns: Number(r.ns), np: Number(r.np), fw: R.dec(r.fw), xr: R.dec(r.xr),
          sm: Number(r.sm), sf: R.dec(r.sf) } });
      return same(stopOut(sp), c.exp);
    },
    target_default: function (c) {
      var i = c.in;
      var tp = R.defaultTarget(i.d, R.dec(i.p), R.dec(i.s), { tick: R.dec(i.tick), m5: swingsIn(i.m5),
        h1: swingsIn(i.h1), tb: i.tb, minR: R.dec(i.min_r), beyond: nn(i.beyond) });
      return same({ target: s(tp.target), src: tp.src, level: lvOut(tp.level) }, c.exp);
    },
    r: function (c) {         // R после комиссий; T_n: R(T_n) ≤ n < R(T_n + шаг)
      var i = c.in, d = i.d, P = R.dec(i.p), qty = R.dec(i.qty), fi = R.dec(i.fi), ftp = R.dec(i.ftp),
        rp = R.dec(i.rp), tick = R.dec(i.tick);
      var tn = R.targetForR(i.n, d, P, R.dec(i.u), fi, ftp, tick);
      return same({ r: R.q10(R.rAt(d, R.dec(i.t), P, qty, fi, ftp, rp)), tn: s(tn),
        r_tn: R.q10(R.rAt(d, tn, P, qty, fi, ftp, rp)),
        r_next: R.q10(R.rAt(d, R.add(tn, R.muli(tick, d)), P, qty, fi, ftp, rp)) }, c.exp);
    },
    checks: function (c) {    // всё, что показывает страница режима n: план, отказ, предупреждения, строки
      return same(R.calcNOut(R.calcN(parsed(c.in.q), c.in.st)), c.exp);
    },
    steps: function (c) {     // ⤓⤒ и линия пальцем
      var i = c.in, d = i.d, tick = R.dec(i.tick), lv = i.levels.map(R.dec), r;
      switch (i.kind) {
        case 'stop': r = R.stepStop(d, R.dec(i.cur), lv, R.dec(i.ref), i.closer, tick, i.buf); break;
        case 'stop0': r = R.stopFirst(d, lv, R.dec(i.ref), tick, i.buf); break;
        case 'target': r = R.stepTarget(d, R.dec(i.cur), lv, R.dec(i.ref), i.closer, tick, i.buf); break;
        case 'target0': r = R.targetFirst(d, lv, R.dec(i.ref), tick, i.buf); break;
        case 'entry': r = R.stepEntry(d, R.dec(i.cur), lv, R.dec(i.bid), R.dec(i.ask), i.closer, tick); break;
        case 'entry0': r = R.defaultEntry(d, lv, R.dec(i.bid), R.dec(i.ask), tick); break;
        case 'drag_stop': r = R.dragStop(R.dec(i.v), d, tick); break;
        case 'drag_target': r = R.dragTarget(R.dec(i.v), d, tick); break;
        case 'drag_entry': r = R.dragEntry(R.dec(i.v), d, tick); break;
        default: return [false, 'неизвестный вид ' + i.kind];
      }
      return same({ r: s(r) }, c.exp);
    },
    pos: function (c) {       // режим q: риск до стопа, R цели, безубыток, проверки «Перенести»; Ч3 — расчёт
      var i = c.in;
      if (i.kind === 'q') return same(R.calcQ(parsed(i.q), i.st), c.exp);
      if (i.kind === 'risk') {
        var d = i.d, pos = R.dec(i.pos), avg = R.dec(i.avg), st = R.dec(i.s);
        return same({ open: s(R.openRisk(d, pos, avg, st, R.dec(i.fi), R.dec(i.ft))),
          work: s(R.workingRisk(d, pos, avg, st, R.dec(i.fm), R.dec(i.ft))),
          be: s(R.bePrice(d, avg, R.dec(i.fi), R.dec(i.ft), R.dec(i.tick))) }, c.exp);
      }
      if (i.kind === 'wsize') {
        var o = { fin: R.dec(i.fm), fout: R.dec(i.ft), risk: R.dec(i.rt), qs: R.dec(i.qs), mq: R.dec(i.mq),
          mn: R.dec(i.mn), maxQ: nn(i.maxq), cap: R.dec(i.cap), tol: R.dec(i.tol) };
        var S = R.dec(i.s), eo = R.dec(i.e_old), en = R.dec(i.e_new);
        var a = R.planSize(i.d, eo, S, o), b = R.planSize(i.d, en, S, o);
        return same({ old: sizeOut(a), new: sizeOut(b), w_old: s(R.workingRisk(i.d, a.qty, eo, S, o.fin, o.fout)),
          w_new: s(R.workingRisk(i.d, b.qty, en, S, o.fin, o.fout)) }, c.exp);
      }
      return [false, 'неизвестный вид ' + i.kind];
    },
    fmt: function (c) {
      var i = c.in, v = R.dec(i.v), r;
      switch (i.kind) {
        case 'px': r = R.fmtPx(v, R.dec(i.step)); break;
        case 'qty': r = R.fmtQty(v, R.dec(i.step)); break;
        case 'usdt': r = R.fmtUsdt(v); break;
        case 'plain': r = R.fmtPlain(v, i.k); break;
        case 'int': r = R.fmtInt(v); break;
        default: return [false, 'неизвестный вид ' + i.kind];
      }
      return same({ s: r }, c.exp);
    },
    url_n: function (c) { return same(R.parseQuery(c.in.q), c.exp); },
    url_q: function (c) { return same(R.parseQuery(c.in.q), c.exp); },
    payload_n: function (c, sink) {
      var p = R.parseQuery(c.in.q);
      var got = p && !p.err ? R.buildPayloadN(p, c.in.st) : null;
      if (got) sink.push({ data: JSON.stringify(got), expect: c.exp });
      return same(got, c.exp);
    },
    payload_q: function (c, sink) {
      var p = R.parseQuery(c.in.q);
      var got = p && !p.err ? R.buildPayloadQ(p, c.in.st) : null;
      if (got) sink.push({ data: JSON.stringify(got), expect: c.exp });
      return same(got, c.exp);
    },
    version_guard: function (c) {   // смесь файлов, сравнение версий, pv адреса новее / старше
      if (!TG) return [false, 'trade.js не загружен (TradeGuard нет)'];
      var i = c.in;
      if (i.kind === 'consts') {
        return same({ app: TG.APP_PAGE_VERSION, rules: R.PAGE_VERSION, known: R.KNOWN_PAGE_VERSIONS,
          ids: TG.REQUIRED_IDS, text: TG.GUARD_TEXT }, c.exp);
      }
      if (i.kind === 'guard') {
        var rules = i.rules === 'none' ? undefined : (i.rules === 'nover' ? {} : { PAGE_VERSION: i.rules });
        return same({ text: TG.guardText(rules, i.meta, function (id) { return i.missing.indexOf(id) < 0; }) }, c.exp);
      }
      if (i.kind === 'cmp') return same({ c: R.cmpVersion(i.a, i.b) }, c.exp);
      if (i.kind === 'url') { var p = R.parseQuery(i.q); return same({ err: p.err || null }, c.exp); }
      return [false, 'неизвестный вид ' + i.kind];
    },
    labels: function (c) {          // 19.1: «Ручная сделка 12 · ЛОНГ SOLUSDT», «Ручная 12 SOL», «Сделка SOL»
      if (!TG || !TG.labels) return [false, 'trade.js не загружен (TradeGuard.labels нет)'];
      var i = c.in;
      return same(TG.labels(i.m, i.k, i.s, i.d), c.exp);
    },
    breakout: function (c) {        // 19.2: уровень пробоя, «у уровня», ближайшие, ⤓⤒, по умолчанию, пальцем
      var i = c.in, d = i.d, tick = R.dec(i.tick), last = R.dec(i.last), r;
      switch (i.kind) {
        case 'level': r = s(R.breakoutLevel(R.dec(i.v), d, tick)); break;
        case 'drag': r = s(R.dragBreakout(R.dec(i.v), d, tick)); break;
        case 'gap': r = R.breakoutGap(d, R.dec(i.lv), last, tick, i.gap); break;
        case 'levels': r = R.breakoutLevels(d, i.levels.map(R.dec), last, tick, i.gap, i.n).map(s); break;
        case 'step': r = s(R.stepBreakout(d, R.dec(i.cur), i.levels.map(R.dec), last, i.closer, tick, i.gap)); break;
        case 'default': r = s(R.defaultBreakout(d, swingsIn(i.m5), last, tick, i.gap)); break;
        default: return [false, 'неизвестный вид ' + i.kind];
      }
      return same({ r: r }, c.exp);
    },
    t2: function (c) {              // 19.2: доли двух целей, цель 2 по умолчанию, проверки цели 2 со страницы
      var i = c.in;
      if (i.kind === 'split') {
        var sp = R.splitTarget2(R.dec(i.pos), i.pct, R.dec(i.step), R.dec(i.mq));
        return same({ r: sp ? [s(sp[0]), s(sp[1])] : null }, c.exp);
      }
      if (i.kind === 'ok') return same({ r: R.target2Ok(i.d, R.dec(i.t1), R.dec(i.t2), R.dec(i.tick)) }, c.exp);
      if (i.kind === 'default') {
        var t = R.target2Default(i.d, R.dec(i.t1), R.dec(i.r), R.dec(i.tick), swingsIn(i.m5), swingsIn(i.h1), i.tb);
        return same({ px: s(t.px), src: t.src, level: lvOut(t.level) }, c.exp);
      }
      if (i.kind === 'calc') return same(R.calcT2(parsed(i.q), i.st), c.exp);
      return [false, 'неизвестный вид ' + i.kind];
    },
    trail: function (c) {           // 19.2: кнопки R в ценах, проверки трейлинга, трейлинг со страницы
      var i = c.in;
      if (i.kind === 'preset') {
        var t = R.trailPreset(i.d, R.dec(i.avg), R.dec(i.r), i.act_r, i.dist_r, R.dec(i.tick));
        return same({ dist: s(t.dist), active: s(t.active) }, c.exp);
      }
      if (i.kind === 'check') {
        return same(R.trailOut(R.trailCheck(i.d, R.dec(i.dist), nn(i.active), R.dec(i.r), R.dec(i.tick), R.dec(i.bid),
          R.dec(i.ask), R.dec(i.last), i.min_ticks, R.dec(i.far))), c.exp);
      }
      if (i.kind === 'calc') return same(R.calcTrail(parsed(i.q), i.st), c.exp);
      return [false, 'неизвестный вид ' + i.kind];
    }
  };

  function run() {
    var total = 0, okAll = 0, lines = [], payloads = [];
    var t0 = Date.now();
    if (!R || !FX) {
      return { pass: false, ok: 0, total: 0, lines: ['нет trade_rules.js или примеров'], title: 'SELFTEST FAIL нет файлов',
        payloads: { cases: [] } };
    }
    Object.keys(groups).forEach(function (name) {
      var cases = FX[name] || [], ok = 0, bad = [];
      cases.forEach(function (c, idx) {
        var r;
        try { r = groups[name](c, payloads); } catch (err) { r = [false, 'исключение: ' + err.message]; }
        if (r[0]) ok++;
        else if (bad.length < 10) bad.push('  [' + idx + '] вход ' + JSON.stringify(c.in).slice(0, 700) +
          '\n       ждали ' + JSON.stringify(c.exp).slice(0, 900) + '\n       вышло ' +
          (typeof r[1] === 'string' ? r[1] : canon(r[1])).slice(0, 900));
      });
      total += cases.length;
      okAll += ok;
      lines.push((ok === cases.length && cases.length ? 'OK   ' : 'FAIL ') + name + ': совпало ' + ok + ' из ' + cases.length);
      bad.forEach(function (b) { lines.push(b); });
    });
    var known = Object.keys(groups);
    Object.keys(FX).forEach(function (name) {   // группа примеров без проверки — тоже ошибка
      if (name !== 'meta' && known.indexOf(name) < 0) { lines.push('FAIL ' + name + ': нет проверки'); total++; }
    });
    var pass = total > 0 && okAll === total;
    lines.unshift('Страница «Сделка» ' + R.PAGE_VERSION + ' · примеры: ' + (FX.meta && FX.meta.generator) +
      ', зерно ' + (FX.meta && FX.meta.seed) + ' · ' + (Date.now() - t0) + ' мс', '');
    lines.push('', 'Итог: ' + (pass ? 'всё совпало' : 'есть расхождения') + ' — ' + okAll + ' из ' + total);
    return { pass: pass, ok: okAll, total: total, lines: lines,
      title: pass ? 'SELFTEST OK ' + okAll + '/' + total : 'SELFTEST FAIL ' + (total - okAll) + ' из ' + total,
      payloads: {
        source: 'trade_selftest (trade_rules.js ' + R.PAGE_VERSION + ')',
        note: 'данные для бота, собранные страницей из примеров payload_n и payload_q; для обратной сверки ' +
          '(bot_next24/tools/make_trade_fixtures.py --check-js, tests/fixtures/trade_payloads_js24.json)',
        cases: payloads
      } };
  }

  var res = run();
  root.TRADE_SELFTEST_RESULT = res;
  if (typeof document !== 'undefined' && document.getElementById('out')) {
    var out = document.getElementById('out');
    out.textContent = res.lines.join('\n');
    out.className = res.pass ? 'ok' : 'fail';
    document.title = res.title;
    document.getElementById('payloads').textContent = JSON.stringify(res.payloads, null, 1);
  }
})(typeof window !== 'undefined' ? window : globalThis);
