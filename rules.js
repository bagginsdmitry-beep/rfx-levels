/* rules.js — правила расчёта мини-приложения (SPEC_18 §1.4, §2.2, §3). Без DOM и сети.
 *
 * Точный счёт: все цены, шаги и объёмы — дроби {n, d} из BigInt (n/d, d > 0, несократимые).
 * Число Number — только для показа. Python-копия этих правил — bot_next18/miniapp_rules.py;
 * совпадение проверяет selftest.html на примерах, созданных кодом бота.
 */
(function (root) {
  'use strict';

  var PAGE_VERSION = '18.0';
  var PAYLOAD_MAX_BYTES = 4096;
  var LINES = ['L1', 'L2', 'L3', 'SL', 'TP'];
  var LEGS = ['L1', 'L2', 'L3'];
  var URL_KEYS = ['v', 'pv', 'm', 'c', 'e', 's', 'd', 'tk', 'qs', 'mq', 'mn', 'xq', 'rk', 'rb',
    'cap', 'tol', 'fm', 'ft', 'a', 'rv', 'ex', 'b', 'o', 'pq', 'pa', 'q', 'w'];
  var G_KEYS = ['v', 'pv', 'm', 'c', 'e', 's', 'd', 'tk', 'qs', 'mq', 'mn', 'xq', 'rk', 'rb', 'cap',
    'tol', 'fm', 'ft', 'a', 'rv', 'ex', 'b'];
  var P_KEYS = ['pq', 'pa', 'q', 'w'];
  var MAX_SAFE = 9007199254740991;

  // ------------------------------------------------------------------ дроби
  function gcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  function Q(n, d) {
    if (d === undefined) d = 1n;
    if (d === 0n) throw new Error('деление на ноль');
    if (d < 0n) { n = -n; d = -d; }
    var g = gcd(n, d);
    if (g > 1n) { n /= g; d /= g; }
    return { n: n, d: d };
  }
  var RX_DEC = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
  function isQ(x) { return x !== null && typeof x === 'object' && typeof x.n === 'bigint'; }
  /** Десятичная строка (или дробь) → дробь. Экспонента, пробелы, «+» — ошибка. */
  function dec(x) {
    if (isQ(x)) return x;
    var m = RX_DEC.exec(String(x));
    if (!m) throw new Error('не число: ' + x);
    var fr = m[3] || '';
    var n = BigInt(m[2] + fr);
    if (m[1]) n = -n;
    return Q(n, 10n ** BigInt(fr.length));
  }
  function decOrNull(x) { return x === null || x === undefined || x === '-' ? null : dec(x); }
  function add(a, b) { return Q(a.n * b.d + b.n * a.d, a.d * b.d); }
  function sub(a, b) { return Q(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { return Q(a.n * b.n, a.d * b.d); }
  function div(a, b) { return Q(a.n * b.d, a.d * b.n); }
  function muli(a, k) { return Q(a.n * BigInt(k), a.d); }
  function cmp(a, b) { var x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : (x > 0n ? 1 : 0); }
  function eq(a, b) { return a.n === b.n && a.d === b.d; }
  function qmin(a, b) { return cmp(a, b) <= 0 ? a : b; }
  function qmax(a, b) { return cmp(a, b) >= 0 ? a : b; }
  var ZERO = Q(0n), ONE = Q(1n), TWO = Q(2n);

  function floorQ(a) { return a.n >= 0n ? a.n / a.d : -((-a.n + a.d - 1n) / a.d); }
  function ceilQ(a) { return -floorQ(Q(-a.n, a.d)); }
  function roundHalfEvenQ(a) {
    var fl = floorQ(a);
    var rem2 = (a.n - fl * a.d) * 2n;
    if (rem2 > a.d || (rem2 === a.d && (fl % 2n !== 0n))) fl += 1n;
    return fl;
  }
  /** common.round_step: floor | ceil | nearest (к чётному). */
  function roundStep(v, step, mode) {
    if (cmp(step, ZERO) <= 0) throw new Error('шаг должен быть > 0');
    var r = div(v, step);
    var k = mode === 'floor' ? floorQ(r) : (mode === 'ceil' ? ceilQ(r) : roundHalfEvenQ(r));
    return mul(Q(k), step);
  }
  /** common.price_for_direction: лонг — вниз, шорт — вверх. */
  function priceForDirection(v, tick, d) { return roundStep(v, tick, d === 1 ? 'floor' : 'ceil'); }
  function onStep(v, step) { return div(v, step).d === 1n; }

  // ------------------------------------------------------------------ строки
  function pow10(k) { return 10n ** BigInt(k); }
  /** Наименьшее k, при котором q × 10^k — целое; −1, если дробь бесконечная. */
  function decimalsOf(q) {
    for (var k = 0; k <= 60; k++) if (pow10(k) % q.d === 0n) return k;
    return -1;
  }
  function fixedStr(scaled, k) {
    var neg = scaled < 0n;
    var s = (neg ? -scaled : scaled).toString();
    if (k > 0) {
      while (s.length < k + 1) s = '0' + s;
      s = s.slice(0, s.length - k) + '.' + s.slice(s.length - k);
    }
    return (neg ? '-' : '') + s;
  }
  /** common.to_api_str: десятичная строка без экспоненты и лишних нулей. */
  function toApiStr(q) {
    if (q === null) return null;
    var k = decimalsOf(q);
    if (k < 0) throw new Error('не десятичная дробь');
    var s = fixedStr(q.n * (pow10(k) / q.d), k);
    return s;  // минимальное k — лишних нулей нет
  }
  /** Ровно k знаков, округление к чётному (как format(Decimal, '.kf') в Python); −0 → 0. */
  function toFixedHE(q, k) {
    var sc = mul(q, Q(pow10(k)));
    var neg = sc.n < 0n;
    var fl = roundHalfEvenQ(neg ? Q(-sc.n, sc.d) : sc);
    return fixedStr(neg && fl !== 0n ? -fl : fl, k);
  }
  function stepDecimals(step) { return decimalsOf(step); }
  /** common.fmt_price: цена с точностью шага. */
  function fmtPrice(v, tick) { return toFixedHE(roundStep(v, tick, 'nearest'), stepDecimals(tick)); }
  /** common.fmt_qty: объём вниз на шаг, знаков — как у шага. */
  function fmtQty(q, step) { return toFixedHE(roundStep(q, step, 'floor'), stepDecimals(step)); }
  /** Дробь → Number (для показа и R). */
  function toNum(q) {
    var neg = q.n < 0n;
    var v = (neg ? -q.n : q.n) * pow10(30) / q.d;
    var x = Number(v.toString() + 'e-30');
    return neg ? -x : x;
  }
  /** Number → дробь (из координаты графика): 12 знаков после точки хватает с запасом. */
  function fromNum(x) {
    if (!isFinite(x)) return null;
    return dec(x.toFixed(12));
  }

  // ------------------------------------------------------------------ §3.1 объём и риск
  function planFail(code, reason, extra) {
    var r = { ok: false, code: code, reason: reason };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  /** Ровно DemoExecutor._plan: plan_grid_size + цель дальше каждой ноги.
   *  lv: {L1, L2, L3, SL, TP} — дроби или null; inst: {tk, qs, mq, mn, xq|null, rk, cap, tol}. */
  function planForEdit(d, lv, inst) {
    var tick = inst.tk;
    var stop = priceForDirection(lv.SL, tick, d);
    var legs = [];
    for (var i = 0; i < LEGS.length; i++) {
      var k = LEGS[i];
      if (lv[k] === null || lv[k] === undefined) continue;
      var p = priceForDirection(lv[k], tick, d);
      if (cmp(p, ZERO) <= 0 || cmp(muli(sub(p, stop), d), ZERO) <= 0) {
        return planFail('E_LEG_NOT_BEYOND_STOP', k + ' не дальше стопа — сетка неверна');
      }
      legs.push([k, p]);
    }
    if (!legs.length) return planFail('E_NO_LEGS', 'нет ни одной заявки');
    var sumD = ZERO, maxPx = legs[0][1], minPx = legs[0][1];
    legs.forEach(function (x) {
      sumD = add(sumD, muli(sub(x[1], stop), d));
      maxPx = qmax(maxPx, x[1]);
      minPx = qmin(minPx, x[1]);
    });
    var capQty = div(inst.cap, maxPx);
    var qty = roundStep(qmin(div(inst.rk, sumD), capQty), inst.qs, 'floor');
    var need = inst.mq;
    if (cmp(inst.mn, ZERO) > 0) need = qmax(need, roundStep(div(inst.mn, minPx), inst.qs, 'ceil'));
    var bumped = false;
    if (cmp(qty, need) < 0) {
      var riskNeed = mul(need, sumD);
      if (cmp(riskNeed, mul(inst.rk, add(ONE, inst.tol))) <= 0 && cmp(need, capQty) <= 0) {
        qty = need;
        bumped = true;
      } else {
        return planFail('E_MIN_LOT', 'объём меньше минимального лота: риск стал бы ' +
          toNum(riskNeed).toFixed(2) + ' USDT', { riskNeed: riskNeed });
      }
    }
    if (inst.xq !== null && inst.xq !== undefined && cmp(qty, inst.xq) > 0) {
      qty = roundStep(inst.xq, inst.qs, 'floor');
    }
    if (cmp(qty, ZERO) <= 0) return planFail('E_ZERO_QTY', 'объём получился нулевым');
    var tp = priceForDirection(lv.TP, tick, d);
    for (var j = 0; j < legs.length; j++) {
      if (cmp(muli(sub(tp, legs[j][1]), d), ZERO) <= 0) {
        return planFail('E_TP_NOT_BEYOND', 'цель не дальше входа — сетка неверна');
      }
    }
    var risk = mul(qty, sumD);
    var notional = ZERO;
    legs.forEach(function (x) { notional = add(notional, mul(qty, x[1])); });
    return { ok: true, code: '', reason: '', qty: qty, legs: legs, stop: stop, tp: tp, risk: risk,
      notional: notional, bumped: bumped, rp: rProjection(d, legs, stop, tp, qty) };
  }

  /** common.r_projection: R до комиссий (R — риск всей сетки до стопа). */
  function rProjection(d, legs, stop, tp, qty) {
    var risk = ZERO, tpAll = ZERO;
    legs.forEach(function (x) {
      risk = add(risk, muli(sub(x[1], stop), d));
      tpAll = add(tpAll, muli(sub(tp, x[1]), d));
    });
    risk = mul(qty, risk);
    var first = legs[0][1];
    return {
      tp_first: toNum(div(mul(qty, muli(sub(tp, first), d)), risk)),
      tp_all: toNum(div(mul(qty, tpAll), risk)),
      sl_first: -toNum(div(mul(qty, muli(sub(first, stop), d)), risk)),
      sl_all: -1
    };
  }

  /** Комиссии для показа, в R: вход — мейкер по каждой ноге, цель — мейкер, стоп — тейкер
   *  (все ноги исполнены). */
  function feesR(plan, fm, ft) {
    var entry = mul(plan.notional, fm);
    var n = plan.legs.length;
    var atTp = add(entry, mul(mul(muli(plan.qty, n), plan.tp), fm));
    var atSl = add(entry, mul(mul(muli(plan.qty, n), plan.stop), ft));
    return { tp: -toNum(div(atTp, plan.risk)), sl: -toNum(div(atSl, plan.risk)) };
  }

  // ------------------------------------------------------------------ §3.2 порядок уровней
  function word(d, up) { return (up === (d === 1)) ? 'выше' : 'ниже'; }
  var TXT_TICK = 'цена не на шаге цены';
  var TXT_FAR = 'уровень слишком далеко от цены';
  var TXT_LEGSET = 'набор ног не совпадает с подсказкой';
  function far(v, ref) { return cmp(muli(v, 2), ref) < 0 || cmp(v, muli(ref, 2)) > 0; }
  function atLeastTick(a, b, d, tick) { return cmp(muli(sub(a, b), d), tick) >= 0; }

  /** [(код, текст)]; пусто — порядок верен. Каждый код — не больше раза, порядок кодов задан. */
  function checkOrder(d, lv, tick, ref) {
    var errs = [];
    var present = LINES.filter(function (k) { return lv[k] !== null && lv[k] !== undefined; })
      .map(function (k) { return lv[k]; });
    if (present.some(function (v) { return !onStep(v, tick); })) errs.push(['E_TICK', TXT_TICK]);
    var legs = LEGS.filter(function (k) { return lv[k] !== null && lv[k] !== undefined; });
    var top = legs[0], deep = legs[legs.length - 1];
    if (!atLeastTick(lv.TP, lv[top], d, tick)) {
      errs.push(['E_ORDER_TP_L1', 'цель должна быть ' + word(d, true) + ' ' + top]);
    }
    if (lv.L1 !== null && lv.L1 !== undefined && !atLeastTick(lv.L1, lv.L2, d, tick)) {
      errs.push(['E_ORDER_L1_L2', 'L1 должна быть ' + word(d, true) + ' L2']);
    }
    if (lv.L3 !== null && lv.L3 !== undefined && !atLeastTick(lv.L2, lv.L3, d, tick)) {
      errs.push(['E_ORDER_L2_L3', 'L2 должна быть ' + word(d, true) + ' L3']);
    }
    if (!atLeastTick(lv[deep], lv.SL, d, tick)) {
      errs.push(['E_ORDER_LEG_STOP', 'стоп должен быть ' + word(d, false) + ' самой глубокой ноги']);
    }
    if (ref !== null && ref !== undefined && cmp(ref, ZERO) > 0 &&
        present.some(function (v) { return far(v, ref); })) errs.push(['E_FAR', TXT_FAR]);
    return errs;
  }

  /** Предупреждение: нога уже за последней ценой (лонг: нога ≥ цена). */
  function lateLegs(d, lv, last) {
    if (last === null || last === undefined) return [];
    return LEGS.filter(function (k) {
      return lv[k] !== null && lv[k] !== undefined && cmp(muli(sub(lv[k], last), d), ZERO) >= 0;
    }).map(function (k) { return [k, k + ' уже за ценой — эта заявка опоздает']; });
  }

  // ------------------------------------------------------------------ §3.3 позиция
  /** waiting — цены ждущих ног. Опора «далеко» — последняя цена, без неё — средняя входа.
   *  oldStop/oldTp (необязательны) — стоп и цель сетки: не изменились оба — E_NO_CHANGE. */
  function checkPosition(d, stop, tp, last, avg, posQty, waiting, tick, oldStop, oldTp) {
    var errs = [];
    if (!onStep(stop, tick) || !onStep(tp, tick)) errs.push(['E_TICK', TXT_TICK]);
    if (oldStop && oldTp && eq(stop, oldStop) && eq(tp, oldTp)) {
      errs.push(['E_NO_CHANGE', 'стоп и цель не изменились']);
    }
    if (last !== null && last !== undefined) {
      if (!atLeastTick(last, stop, d, tick)) {
        errs.push(['E_POS_STOP_SIDE', 'стоп должен быть ' + word(d, false) + ' текущей цены']);
      }
      if (!atLeastTick(tp, last, d, tick)) {
        errs.push(['E_POS_TP_SIDE', 'цель должна быть ' + word(d, true) + ' текущей цены']);
      }
    }
    if (waiting.some(function (p) { return !atLeastTick(p, stop, d, tick); })) {
      errs.push(['E_POS_STOP_WAITING', 'стоп должен быть ' + word(d, false) + ' ждущих ног']);
    }
    if (waiting.some(function (p) { return !atLeastTick(tp, p, d, tick); })) {
      errs.push(['E_POS_TP_WAITING', 'цель должна быть ' + word(d, true) + ' ждущих ног']);
    }
    var ref = (last !== null && last !== undefined) ? last : avg;
    if (ref !== null && ref !== undefined && cmp(ref, ZERO) > 0 && (far(stop, ref) || far(tp, ref))) {
      errs.push(['E_FAR', TXT_FAR]);
    }
    return errs;
  }
  /** R_pos = pq × (pa − стоп) × d + Σ q × (нога − стоп) × d; waitingQP — [[объём, цена]]. */
  function positionRisk(d, posQty, avg, waitingQP, stop) {
    var r = muli(mul(posQty, sub(avg, stop)), d);
    waitingQP.forEach(function (x) { r = add(r, muli(mul(x[0], sub(x[1], stop)), d)); });
    return r;
  }
  function positionProfit(d, posQty, avg, waitingQP, tp) {
    var r = muli(mul(posQty, sub(tp, avg)), d);
    waitingQP.forEach(function (x) { r = add(r, muli(mul(x[0], sub(tp, x[1])), d)); });
    return r;
  }

  // ------------------------------------------------------------------ §3.4 уровни M5
  /** bars — [[high, low], ...] (строки или дроби), старые первыми; extra — уровни бота. */
  function m5Levels(bars, tick, d, extra) {
    var n = bars.length;
    var hs = bars.map(function (b) { return dec(b[0]); });
    var ls = bars.map(function (b) { return dec(b[1]); });
    var out = [];
    for (var i = 2; i <= n - 3; i++) {
      if (cmp(hs[i], hs[i - 1]) > 0 && cmp(hs[i], hs[i - 2]) > 0 && cmp(hs[i], hs[i + 1]) >= 0 &&
          cmp(hs[i], hs[i + 2]) >= 0) out.push(priceForDirection(hs[i], tick, d));
      if (cmp(ls[i], ls[i - 1]) < 0 && cmp(ls[i], ls[i - 2]) < 0 && cmp(ls[i], ls[i + 1]) <= 0 &&
          cmp(ls[i], ls[i + 2]) <= 0) out.push(priceForDirection(ls[i], tick, d));
    }
    (extra || []).forEach(function (x) {  // уровни бота — как есть (они уже на шаге цены)
      if (x !== null && x !== undefined) out.push(dec(x));
    });
    out.sort(cmp);
    return out.filter(function (x, j) { return j === 0 || !eq(x, out[j - 1]); });
  }
  /** ▲ — наименьший уровень строго выше; ▼ — наибольший строго ниже; нет — null. */
  function stepLevel(levels, cur, up) {
    var r = null;
    levels.forEach(function (x) {
      var c = cmp(x, cur);
      if (up && c > 0 && (r === null || cmp(x, r) < 0)) r = x;
      if (!up && c < 0 && (r === null || cmp(x, r) > 0)) r = x;
    });
    return r;
  }

  // ------------------------------------------------------------------ §2.2 адрес страницы
  var RX_NUM = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;
  var RX_INT = /^(0|[1-9][0-9]{0,15})$/;
  var RX_POSINT = /^[1-9][0-9]{0,15}$/;

  /** Разбор адреса (строка запроса без «?» или целый адрес). Неверно или неполно — null. */
  function parseQuery(search) {
    var sp = new URLSearchParams(search);
    var got = {}, bad = false;
    sp.forEach(function (v, k) {
      if (k.indexOf('tgWebApp') === 0) return;
      if (Object.prototype.hasOwnProperty.call(got, k) || URL_KEYS.indexOf(k) < 0) bad = true;
      got[k] = v;
    });
    if (bad) return null;
    var m = got.m;
    if (m !== 'g' && m !== 'p') return null;
    var need = G_KEYS.concat(m === 'p' ? P_KEYS : []);
    for (var i = 0; i < need.length; i++) if (!Object.prototype.hasOwnProperty.call(got, need[i])) return null;
    if (m === 'g' && P_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(got, k); })) return null;

    function fail() { throw new Error('bad'); }
    function num(k, positive, dash) {
      var v = got[k];
      if (dash && v === '-') return null;
      if (!RX_NUM.test(v) || (positive && cmp(dec(v), ZERO) <= 0)) fail();
      return v;
    }
    function intv(k, rx) {
      var v = got[k];
      if (!rx.test(v) || Number(v) > MAX_SAFE) fail();
      return Number(v);
    }
    function levels(v) {
      var parts = v.split(',');
      if (parts.length !== 5) fail();
      return parts.map(function (x, j) {
        if (x === '-' && (j === 0 || j === 2)) return null;
        if (RX_NUM.test(x) && cmp(dec(x), ZERO) > 0) return x;
        return fail();
      });
    }
    try {
      if (got.v !== '1' || !/^[0-9A-Za-z._-]{1,16}$/.test(got.pv)) return null;
      if (!/^[A-Z0-9]{2,30}$/.test(got.s) || (got.d !== '1' && got.d !== '-1')) return null;
      var out = { v: 1, pv: got.pv, m: m, c: intv('c', RX_POSINT), e: intv('e', RX_INT), s: got.s,
        d: Number(got.d), tk: num('tk', true), qs: num('qs', true), mq: num('mq', false),
        mn: num('mn', false), xq: num('xq', true, true), rk: num('rk', true), rb: num('rb', true),
        cap: num('cap', true), tol: num('tol', false), fm: num('fm', false), ft: num('ft', false),
        a: intv('a', RX_INT), rv: intv('rv', RX_INT), ex: intv('ex', RX_INT), b: levels(got.b) };
      out.o = Object.prototype.hasOwnProperty.call(got, 'o') ? levels(got.o) : out.b.slice();
      for (var j = 0; j < 5; j++) if ((out.o[j] === null) !== (out.b[j] === null)) return null;
      out.pq = out.pa = out.q = out.w = null;
      if (m === 'p') {
        out.pq = num('pq', true);
        out.pa = num('pa', true);
        out.q = num('q', true);
        if (got.w === '-') {
          out.w = [];
        } else {
          var items = [];
          var parts = got.w.split(';');
          for (var t = 0; t < parts.length; t++) {
            var mm = /^(L1|L2|L3):(.+)$/.exec(parts[t]);
            if (!mm || !RX_NUM.test(mm[2]) || cmp(dec(mm[2]), ZERO) <= 0) return null;
            if (items.some(function (x) { return x[0] === mm[1]; })) return null;
            items.push([mm[1], mm[2]]);
          }
          out.w = items;
        }
      }
      return out;
    } catch (e) {
      return null;
    }
  }
  function parsePageUrl(url) {
    var u = new URL(url);
    return parseQuery(u.search);
  }

  /** Параметры адреса → числа для расчёта. */
  function instOf(p) {
    return { tk: dec(p.tk), qs: dec(p.qs), mq: dec(p.mq), mn: dec(p.mn), xq: decOrNull(p.xq),
      rk: dec(p.rk), rb: dec(p.rb), cap: dec(p.cap), tol: dec(p.tol), fm: dec(p.fm), ft: dec(p.ft) };
  }
  function levelsOf(arr) {
    var lv = {};
    LINES.forEach(function (k, j) { lv[k] = decOrNull(arr[j]); });
    return lv;
  }
  function waitingQP(p) {
    var q = dec(p.q);
    return (p.w || []).map(function (x) { return [q, dec(x[1])]; });
  }

  // ------------------------------------------------------------------ §1.4 полезная нагрузка
  /** Состояние страницы → объект для sendData; null — «Готово» неактивна.
   *  final — 5 уровней [L1, L2, L3, стоп, цель] (дроби, строки или null); last — последняя цена
   *  или null; режим p берёт только стоп и цель. */
  function buildPayload(p, final, last, platform, tMs) {
    var d = p.d, inst = instOf(p), tick = inst.tk;
    var lvOut, pq, pr, pb, risk;
    var fin = final.map(function (x) { return decOrNull(x); });
    if (p.m === 'g') {
      for (var j = 0; j < 3; j++) if ((fin[j] === null) !== (p.b[j] === null)) return null;
      var lv = {};
      LINES.forEach(function (k, i) { lv[k] = fin[i]; });
      var ref = last !== null && last !== undefined ? last : dec(p.b[1]);
      if (checkOrder(d, lv, tick, ref).length) return null;
      var plan = planForEdit(d, lv, inst);
      if (!plan.ok) return null;
      risk = plan.risk;
      lvOut = LINES.map(function (k) { return lv[k] === null ? '-' : fmtPrice(lv[k], tick); });
      pq = fmtQty(plan.qty, inst.qs);
      pb = plan.bumped ? 1 : 0;
    } else {
      var stop = fin[3], tp = fin[4];
      var wq = waitingQP(p);
      if (checkPosition(d, stop, tp, last, dec(p.pa), dec(p.pq), wq.map(function (x) { return x[1]; }),
          tick, dec(p.b[3]), dec(p.b[4])).length) return null;  // в том числе E_NO_CHANGE
      risk = positionRisk(d, dec(p.pq), dec(p.pa), wq, stop);
      lvOut = ['=', '=', '=', fmtPrice(stop, tick), fmtPrice(tp, tick)];
      pq = p.pq;
      pb = 0;
    }
    pr = toFixedHE(risk, 2);
    return { v: 1, m: p.m, c: p.c, e: p.e, rv: p.rv, lv: lvOut, pq: pq, pr: pr, pb: pb,
      pv: PAGE_VERSION, pl: platformTag(platform), t: tMs };
  }
  /** Telegram.WebApp.platform → 1–16 знаков [0-9A-Za-z._-] (как проверяет бот). */
  function platformTag(platform) {
    var t = String(platform || '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 16);
    return t || 'unknown';
  }
  function payloadBytes(s) { return new TextEncoder().encode(s).length; }

  root.LevelRules = {
    PAGE_VERSION: PAGE_VERSION, PAYLOAD_MAX_BYTES: PAYLOAD_MAX_BYTES, LINES: LINES, LEGS: LEGS,
    TXT_LEGSET: TXT_LEGSET,
    Q: Q, dec: dec, decOrNull: decOrNull, add: add, sub: sub, mul: mul, div: div, muli: muli,
    cmp: cmp, eq: eq, ZERO: ZERO, ONE: ONE, TWO: TWO,
    roundStep: roundStep, priceForDirection: priceForDirection, onStep: onStep,
    toApiStr: toApiStr, toFixedHE: toFixedHE, fmtPrice: fmtPrice, fmtQty: fmtQty,
    stepDecimals: stepDecimals, toNum: toNum, fromNum: fromNum,
    planForEdit: planForEdit, rProjection: rProjection, feesR: feesR,
    checkOrder: checkOrder, lateLegs: lateLegs, checkPosition: checkPosition,
    positionRisk: positionRisk, positionProfit: positionProfit,
    m5Levels: m5Levels, stepLevel: stepLevel,
    parseQuery: parseQuery, parsePageUrl: parsePageUrl, instOf: instOf, levelsOf: levelsOf,
    waitingQP: waitingQP, buildPayload: buildPayload, payloadBytes: payloadBytes,
    platformTag: platformTag
  };
})(window);
