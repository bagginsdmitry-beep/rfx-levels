/* selftest.js — сверка rules.js с примерами, созданными кодом бота (selftest/fixtures.js).
 * Итог — в заголовке страницы: «SELFTEST OK N/N» или «SELFTEST FAIL …». Без страницы (Deno:
 * bot_next19/tools/selftest_deno.js) итог кладётся в SELFTEST_RESULT, DOM не трогается.
 * 18.2: группы move, url_p3, payload_in_p3, move_excl (SPEC_191 §2, §7) и version_guard
 * (проверка версии файлов из app.js — AppGuard, SPEC_191 §15.1); move_step — ⤒⤓ при сдвиге
 * заявок: «половина пути» до соседней ноги (аудит 1.9.1, замечание 4; = стрелки бота). */
(function (root) {
  'use strict';
  var R = root.LevelRules, FX = root.FIXTURES, AG = root.AppGuard;

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
  function hintOut(h) { return h ? [h.leg, s(h.price)] : null; }

  function sizing(c) {
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
  }
  function order(c) {
    var i = c.in;
    var lv = R.levelsOf(i.lv);
    var got = { errs: R.checkOrder(i.d, lv, R.dec(i.tk), nn(i.ref)),
      warn: R.lateLegs(i.d, lv, nn(i.last)) };
    return [canon(got) === canon(c.exp), got];
  }
  function url(c) {    // in.q — адрес бота без основы: «?…» и, может быть, «#…»
    var got = R.parseQuery(c.in.q.split('#')[0]);
    return [canon(got) === canon(c.exp), got];
  }
  function payloadIn(c, sink) {
    var i = c.in;
    var p = R.parseQuery(i.q.split('#')[0]);
    var got = p && R.buildPayload(p, i.lv, nn(i.last), i.pl, i.t, i.mark || null);
    if (got) {
      var data = JSON.stringify(got);
      if (R.payloadBytes(data) > R.PAYLOAD_MAX_BYTES) return [false, 'больше 4096 байт'];
      sink.push({ data: data, expect: c.exp });
    }
    return [canon(got || null) === canon(c.exp), got];
  }

  var groups = {
    sizing: sizing,
    order: order,
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
    url: url,
    payload_in: payloadIn,
    // ---- 18.1 (SPEC_19)
    sizing_sets: sizing,          // объём и риск на любом наборе ног, в том числе без L2
    order_sets: order,            // порядок на любом наборе ног: E_ORDER_L1_L3, E_NO_LEGS
    legset: function (c) {
      var i = c.in;
      var bot = R.levelsOf(i.b), own = R.levelsOf(i.own);
      var got = { diff: R.legsDiff(bot, own), errs: R.checkLegset2(bot, own, i.lx) };
      return [canon(got) === canon(c.exp), got];
    },
    add_start: function (c) {
      var i = c.in, tk = R.dec(i.tk);
      var bot = R.levelsOf(i.b), own = R.levelsOf(i.own);
      var r = R.addStart(i.d, i.leg, own, bot, nn(i.im), tk);
      var got = { price: s(r[0]), reason: r[1], errs: [], hint: null };
      if (r[0] !== null) {
        own[i.leg] = r[0];
        got.errs = R.checkAddedL1(i.d, own, bot, nn(i.im), nn(i.last), tk);
        got.hint = hintOut(R.stopRuleHint(i.d, own, bot, nn(i.pp), tk));
      }
      return [canon(got) === canon(c.exp), got];
    },
    added_l1: function (c) {
      var i = c.in;
      var got = { errs: R.checkAddedL1(i.d, R.levelsOf(i.own), R.levelsOf(i.b), nn(i.im), nn(i.last),
        R.dec(i.tk)) };
      return [canon(got) === canon(c.exp), got];
    },
    stop_hint: function (c) {
      var i = c.in;
      var got = { hint: hintOut(R.stopRuleHint(i.d, R.levelsOf(i.own), R.levelsOf(i.b), nn(i.pp),
        R.dec(i.tk))) };
      return [canon(got) === canon(c.exp), got];
    },
    url_g2: url,
    payload_in_g2: payloadIn,
    leg_cancel: function (c) {
      var i = c.in;
      var p = R.parseQuery(i.q.split('#')[0]);
      if (!p) return [false, 'адрес не разобран'];
      var r = R.posCheck(p, R.dec(i.stop), R.dec(i.tp), i.mark, nn(i.last));
      var got = { errs: r.errs, moved: r.moved, risk: s(r.risk), risk_old: s(r.riskOld),
        profit: s(r.profit), hint: hintOut(r.hint) };
      return [canon(got) === canon(c.exp), got];
    },
    url_p2: url,
    payload_in_p2: payloadIn,
    // ---- 18.2 (SPEC_191)
    move: function (c) {          // check_orders_move п. 1–6, план (п. 8), только цель — объём прежний
      var i = c.in;
      var p = R.parseQuery(i.q.split('#')[0]);
      if (!p) return [false, 'адрес не разобран'];
      var r = R.checkMove(p, R.levelsOf(i.lv), nn(i.last));
      var errs = r.errs.map(function (x) {      // ошибка плана — только код (текст E_MIN_LOT округляет float)
        return R.PLAN_CODES.indexOf(x[0]) >= 0 && r.plan && !r.plan.ok && x[1] === r.plan.reason ? [x[0]] : x;
      });
      var got = { errs: errs, moved: r.moved, sized: r.sized, qty: s(r.qty), risk_old: s(r.riskOld),
        risk_new: s(r.riskNew), bumped: r.bumped ? 1 : 0,
        bot: R.checkOrdersMove(p.d, R.levelsOf(p.b), R.levelsOf(i.lv), nn(i.last), R.dec(p.tk), true) };
      return [canon(got) === canon(c.exp), got];
    },
    url_p3: url,
    payload_in_p3: payloadIn,
    move_excl: function (c) {     // сдвиг или снятие — что-то одно
      var i = c.in;
      var p = R.parseQuery(i.q.split('#')[0]);
      if (!p) return [false, 'адрес не разобран'];
      var got = { errs: R.moveExcl(p, R.levelsOf(i.lv), i.mark || null, i.act) };
      return [canon(got) === canon(c.exp), got];
    },
    version_guard: function (c) { // смесь файлов разных версий → «Страница обновляется»
      if (!AG) return [false, 'app.js не загружен (AppGuard нет)'];
      var i = c.in, got;
      if (i.kind === 'consts') {
        got = { app: AG.APP_PAGE_VERSION, rules: R.PAGE_VERSION, ids: AG.REQUIRED_IDS, text: AG.GUARD_TEXT };
      } else {
        var rules = i.rules === 'none' ? undefined : (i.rules === 'nover' ? {} : { PAGE_VERSION: i.rules });
        got = { text: AG.guardText(rules, i.meta, function (id) { return i.missing.indexOf(id) < 0; }) };
      }
      return [canon(got) === canon(c.exp), got];
    },
    move_step: function (c) {     // ⤒⤓ при сдвиге: уровень упирается в соседнюю ногу — «половина пути»
      var i = c.in, lv = R.levelsOf(i.lv), tk = R.dec(i.tk), lvls = i.levels.map(R.dec);
      var r = R.stepMoveLevel(i.d, lv, i.k, lvls, i.up, tk);
      var plain = R.stepLevel(lvls, lv[i.k], i.up);
      var got = { r: s(r), nb: R.moveNeighborLeg(i.d, lv, i.k, i.up), half: s(r) !== s(plain) };
      return [canon(got) === canon(c.exp), got];
    }
  };

  function run() {
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
      lines.push((ok === cases.length && cases.length ? 'OK   ' : 'FAIL ') + name + ': совпало ' + ok + ' из ' + cases.length);
      bad.forEach(function (b) { lines.push(b); });
    });
    var known = Object.keys(groups);
    Object.keys(FX).forEach(function (name) {   // группа примеров без проверки — тоже ошибка
      if (name !== 'meta' && known.indexOf(name) < 0) { lines.push('FAIL ' + name + ': нет проверки'); total++; }
    });
    var pass = total > 0 && okAll === total;
    lines.unshift('Версия страницы ' + R.PAGE_VERSION + ' · примеры: ' + (FX.meta && FX.meta.generator) +
      ', зерно ' + (FX.meta && FX.meta.seed) + ' · ' + (Date.now() - t0) + ' мс', '');
    lines.push('', 'Итог: ' + (pass ? 'всё совпало' : 'есть расхождения') + ' — ' + okAll + ' из ' + total);
    return { pass: pass, ok: okAll, total: total, lines: lines,
      title: pass ? 'SELFTEST OK ' + okAll + '/' + total : 'SELFTEST FAIL ' + (total - okAll) + ' из ' + total,
      payloads: {
        source: 'miniapp/selftest.html (rules.js ' + R.PAGE_VERSION + ')',
        note: 'полезные нагрузки, собранные страницей из примеров payload_in, payload_in_g2, payload_in_p2, ' +
          'payload_in_p3; для обратной сверки parse_payload (bot_next19/tests/fixtures/miniapp_payloads_js191.json)',
        cases: payloads
      } };
  }

  var res = run();
  root.SELFTEST_RESULT = res;
  if (typeof document !== 'undefined' && document.getElementById('out')) {
    var out = document.getElementById('out');
    out.textContent = res.lines.join('\n');
    out.className = res.pass ? 'ok' : 'fail';
    document.title = res.title;
    document.getElementById('payloads').textContent = JSON.stringify(res.payloads, null, 1);
  }
})(typeof window !== 'undefined' ? window : globalThis);
