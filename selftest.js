/* selftest.js — сверка rules.js с примерами, созданными кодом бота (selftest/fixtures.js).
 * Итог — в заголовке страницы: «SELFTEST OK N/N» или «SELFTEST FAIL …». */
(function () {
  'use strict';
  var R = window.LevelRules, FX = window.FIXTURES;
  var out = document.getElementById('out');
  var payloadsBox = document.getElementById('payloads');

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
  function close(a, b) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); }
  function nn(x) { return x === null || x === undefined ? null : R.dec(x); }

  var groups = {
    sizing: function (c) {
      var i = c.in, e = c.exp;
      var inst = { tk: R.dec(i.tk), qs: R.dec(i.qs), mq: R.dec(i.mq), mn: R.dec(i.mn),
        xq: nn(i.xq), rk: R.dec(i.rk), cap: R.dec(i.cap), tol: R.dec(i.tol) };
      var p = R.planForEdit(i.d, R.levelsOf(i.lv), inst);
      if (!e.ok) {
        var got = { ok: p.ok, code: p.code };
        if (e.code === 'E_MIN_LOT') got.risk_need = s(p.riskNeed);
        return [canon(got) === canon(e), got];
      }
      if (!p.ok) return [false, { ok: false, code: p.code, reason: p.reason }];
      var names = {};
      p.legs.forEach(function (x) { names[x[0]] = x[1]; });
      var got2 = { ok: true, code: '', qty: s(p.qty), risk: s(p.risk), notional: s(p.notional),
        bumped: p.bumped ? 1 : 0, legs: ['L1', 'L2', 'L3'].map(function (k) { return s(names[k]); }),
        stop: s(p.stop), tp: s(p.tp), tp_first: p.rp.tp_first, tp_all: p.rp.tp_all,
        sl_first: p.rp.sl_first };
      var same = ['ok', 'code', 'qty', 'risk', 'notional', 'bumped', 'stop', 'tp'].every(function (k) {
        return got2[k] === e[k];
      }) && canon(got2.legs) === canon(e.legs) && close(got2.tp_first, e.tp_first) &&
        close(got2.tp_all, e.tp_all) && close(got2.sl_first, e.sl_first);
      return [same, got2];
    },
    order: function (c) {
      var i = c.in;
      var lv = R.levelsOf(i.lv);
      var got = { errs: R.checkOrder(i.d, lv, R.dec(i.tk), nn(i.ref)),
        warn: R.lateLegs(i.d, lv, nn(i.last)) };
      return [canon(got) === canon(c.exp), got];
    },
    position: function (c) {
      var i = c.in, d = i.d;
      var q = R.dec(i.q), wp = i.w.map(function (x) { return R.dec(x[1]); });
      var wq = wp.map(function (p) { return [q, p]; });
      var stop = R.dec(i.stop), tp = R.dec(i.tp), pq = R.dec(i.pq), pa = R.dec(i.pa);
      var got = { errs: R.checkPosition(d, stop, tp, nn(i.last), pa, pq, wp, R.dec(i.tk),
          R.dec(i.old_stop), R.dec(i.old_tp)),
        risk: s(R.positionRisk(d, pq, pa, wq, stop)),
        risk_old: s(R.positionRisk(d, pq, pa, wq, R.dec(i.old_stop))),
        profit_tp: s(R.positionProfit(d, pq, pa, wq, tp)) };
      return [canon(got) === canon(c.exp), got];
    },
    m5: function (c) {
      var i = c.in;
      var got = { levels: R.m5Levels(i.bars, R.dec(i.tk), i.d, i.extra.map(nn)).map(s) };
      return [canon(got) === canon(c.exp), got];
    },
    step: function (c) {
      var i = c.in;
      var got = { r: s(R.stepLevel(i.levels.map(R.dec), R.dec(i.cur), i.up)) };
      return [canon(got) === canon(c.exp), got];
    },
    url: function (c) {    // in.q — адрес бота без основы: «?…» и, может быть, «#…»
      var got = R.parseQuery(c.in.q.split('#')[0]);
      return [canon(got) === canon(c.exp), got];
    },
    payload_in: function (c, sink) {
      var i = c.in;
      var p = R.parseQuery(i.q.split('#')[0]);
      var got = p && R.buildPayload(p, i.lv, nn(i.last), i.pl, i.t);
      if (got) {
        var data = JSON.stringify(got);
        if (R.payloadBytes(data) > R.PAYLOAD_MAX_BYTES) return [false, 'больше 4096 байт'];
        sink.push({ data: data, expect: c.exp });
      }
      return [canon(got || null) === canon(c.exp), got];
    }
  };

  var total = 0, okAll = 0, lines = [], payloads = [];
  var t0 = Date.now();
  Object.keys(groups).forEach(function (name) {
    var cases = FX[name] || [], ok = 0, bad = [];
    cases.forEach(function (c, idx) {
      var r;
      try { r = groups[name](c, payloads); } catch (err) { r = [false, 'исключение: ' + err.message]; }
      if (r[0]) ok++;
      else if (bad.length < 10) bad.push('  [' + idx + '] вход ' + JSON.stringify(c.in).slice(0, 600) +
        '\n       ждали ' + JSON.stringify(c.exp).slice(0, 600) + '\n       вышло ' +
        (typeof r[1] === 'string' ? r[1] : canon(r[1])).slice(0, 600));
    });
    total += cases.length;
    okAll += ok;
    lines.push((ok === cases.length ? 'OK   ' : 'FAIL ') + name + ': совпало ' + ok + ' из ' + cases.length);
    bad.forEach(function (b) { lines.push(b); });
  });
  var pass = total > 0 && okAll === total;
  lines.unshift('Версия страницы ' + R.PAGE_VERSION + ' · примеры: ' + (FX.meta && FX.meta.generator) +
    ', зерно ' + (FX.meta && FX.meta.seed) + ' · ' + (Date.now() - t0) + ' мс', '');
  lines.push('', 'Итог: ' + (pass ? 'всё совпало' : 'есть расхождения') + ' — ' + okAll + ' из ' + total);
  out.textContent = lines.join('\n');
  out.className = pass ? 'ok' : 'fail';
  document.title = pass ? 'SELFTEST OK ' + okAll + '/' + total
    : 'SELFTEST FAIL ' + (total - okAll) + ' из ' + total;
  payloadsBox.textContent = JSON.stringify({
    source: 'miniapp/selftest.html (rules.js ' + R.PAGE_VERSION + ')',
    note: 'полезные нагрузки, собранные страницей из примеров payload_in; ' +
      'для обратной сверки parse_payload (bot_next18/tests/fixtures/miniapp_payloads_js.json)',
    cases: payloads
  }, null, 1);
})();
