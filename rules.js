/* rules.js — правила расчёта мини-приложения (SPEC_18 §1.4, §2.2, §3; SPEC_19 §1, §3.2, §4,
 * §8–§10). Без DOM и сети.
 *
 * Точный счёт: все цены, шаги и объёмы — дроби {n, d} из BigInt (n/d, d > 0, несократимые).
 * Число Number — только для показа. Python-копия этих правил — bot_next19/miniapp_rules.py и эталон
 * генератора bot_next19/tools/make_miniapp_fixtures.py; совпадение проверяет selftest.html на
 * примерах, созданных кодом бота.
 *
 * Версия 18.1: набор ног до «Беру» (убрать / добавить / вернуть ногу; адрес и нагрузка версии 2,
 * m = g) и снятие одной ждущей заявки после «Беру» (адрес и нагрузка версии 2, m = p). Адрес
 * версии 1 — режим совместимости: поведение и нагрузки ровно как у 18.0.
 *
 * Версия 18.2 (SPEC_191 §2, §3, §7): адрес версии 3 (только m = p) — поставленная сетка без
 * исполнений: ждущие заявки L1–L3, стоп и цель двигаются, объём пересчитывается на 1 R (нагрузка
 * версии 3); снятие одной заявки — как 18.1 (нагрузка версии 2). Сдвиг и снятие в одной правке
 * нельзя. Python-копия правил сдвига — miniapp_rules.check_orders_move.
 */
(function (root) {
  'use strict';

  var PAGE_VERSION = '18.2';
  var KNOWN_PAGE_VERSIONS = ['18.0', '18.1', '18.2'];   // pv адреса, при котором не нужна полоса «Страница обновилась»
  var PAYLOAD_MAX_BYTES = 4096;
  var STOP_BUF_PIPS = 5;                         // common.RFX_STOP_BUF_PIPS: стоп = нижняя нога ∓ 5 пипсов
  var LINES = ['L1', 'L2', 'L3', 'SL', 'TP'];
  var LEGS = ['L1', 'L2', 'L3'];
  var URL_KEYS = ['v', 'pv', 'm', 'c', 'e', 's', 'd', 'tk', 'qs', 'mq', 'mn', 'xq', 'rk', 'rb',
    'cap', 'tol', 'fm', 'ft', 'a', 'rv', 'ex', 'b', 'im', 'pp', 'o', 'pq', 'pa', 'q', 'w', 'cx', 'mv'];
  var G_KEYS = ['v', 'pv', 'm', 'c', 'e', 's', 'd', 'tk', 'qs', 'mq', 'mn', 'xq', 'rk', 'rb', 'cap',
    'tol', 'fm', 'ft', 'a', 'rv', 'ex', 'b'];
  var P_KEYS = ['pq', 'pa', 'q', 'w'];
  var G2_KEYS = ['im', 'pp'];          // только v=2, m=g
  var P2_KEYS = ['cx', 'mv', 'pp'];    // только m=p версий 2 и 3
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
  function has(x) { return x !== null && x !== undefined; }

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
  /** Ровно DemoExecutor._plan: plan_grid_size + цель дальше каждой ноги. Любой набор ног
   *  (SPEC_19 §2: риск 1 R поровну на оставшиеся ноги).
   *  lv: {L1, L2, L3, SL, TP} — дроби или null; inst: {tk, qs, mq, mn, xq|null, rk, cap, tol}. */
  function planForEdit(d, lv, inst) {
    var tick = inst.tk;
    var stop = priceForDirection(lv.SL, tick, d);
    var legs = [];
    for (var i = 0; i < LEGS.length; i++) {
      var k = LEGS[i];
      if (!has(lv[k])) continue;
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
    if (has(inst.xq) && cmp(qty, inst.xq) > 0) {
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
  var TXT_NO_LEGS = 'нужна хотя бы одна нога';
  function far(v, ref) { return cmp(muli(v, 2), ref) < 0 || cmp(v, muli(ref, 2)) > 0; }
  function atLeastTick(a, b, d, tick) { return cmp(muli(sub(a, b), d), tick) >= 0; }
  /** Ноги, что есть, по порядку L1, L2, L3. */
  function legsOf(lv) { return LEGS.filter(function (k) { return has(lv[k]); }); }
  function deepestLeg(lv) { var l = legsOf(lv); return l.length ? l[l.length - 1] : null; }

  /** [(код, текст)]; пусто — порядок верен. Любой набор ног (SPEC_19 §1 п. 1–3): цель дальше самой
   *  мелкой ноги, соседние ноги по порядку (E_ORDER_L1_L2, E_ORDER_L2_L3, без L2 — E_ORDER_L1_L3),
   *  стоп за самой глубокой; ног нет — E_NO_LEGS. Каждый код — не больше раза, порядок кодов задан. */
  function checkOrder(d, lv, tick, ref) {
    var errs = [];
    var present = LINES.filter(function (k) { return has(lv[k]); }).map(function (k) { return lv[k]; });
    if (present.some(function (v) { return !onStep(v, tick); })) errs.push(['E_TICK', TXT_TICK]);
    var legs = legsOf(lv);
    if (!legs.length) {
      errs.push(['E_NO_LEGS', TXT_NO_LEGS]);
    } else {
      var top = legs[0], deep = legs[legs.length - 1];
      if (!atLeastTick(lv.TP, lv[top], d, tick)) {
        errs.push(['E_ORDER_TP_L1', 'цель должна быть ' + word(d, true) + ' ' + top]);
      }
      for (var i = 0; i + 1 < legs.length; i++) {
        var a = legs[i], b = legs[i + 1];
        if (!atLeastTick(lv[a], lv[b], d, tick)) {
          errs.push(['E_ORDER_' + a + '_' + b, a + ' должна быть ' + word(d, true) + ' ' + b]);
        }
      }
      if (!atLeastTick(lv[deep], lv.SL, d, tick)) {
        errs.push(['E_ORDER_LEG_STOP', 'стоп должен быть ' + word(d, false) + ' самой глубокой ноги']);
      }
    }
    if (has(ref) && cmp(ref, ZERO) > 0 && present.some(function (v) { return far(v, ref); })) {
      errs.push(['E_FAR', TXT_FAR]);
    }
    return errs;
  }

  /** Предупреждение: нога уже за последней ценой (лонг: нога ≥ цена). */
  function lateLegs(d, lv, last) {
    if (!has(last)) return [];
    return LEGS.filter(function (k) {
      return has(lv[k]) && cmp(muli(sub(lv[k], last), d), ZERO) >= 0;
    }).map(function (k) { return [k, k + ' уже за ценой — эта заявка опоздает']; });
  }

  // ------------------------------------------------------------------ SPEC_19 §1: набор ног
  /** Разница наборов (lx): «-Lk» — у бота есть, у владельца нет; «+Lk» — у бота нет, у владельца
   *  есть; порядок L1, L2, L3. */
  function legsDiff(bot, own) {
    var out = [];
    LEGS.forEach(function (k) {
      var b = has(bot[k]), o = has(own[k]);
      if (b && !o) out.push('-' + k);
      else if (!b && o) out.push('+' + k);
    });
    return out;
  }
  /** Проверка набора версии 2 (SPEC_19 §4.3 п. 3), первая неудача: lx ≠ разнице наборов —
   *  E_LEGSET; ног нет — E_NO_LEGS (как miniapp_rules.check_legset_v2). */
  function checkLegset2(bot, own, lx) {
    var diff = legsDiff(bot, own);
    if (lx.length !== diff.length || lx.some(function (x, i) { return x !== diff[i]; })) {
      return [['E_LEGSET', TXT_LEGSET]];
    }
    if (!legsOf(own).length) return [['E_NO_LEGS', TXT_NO_LEGS]];
    return [];
  }
  /** Линия ниже L1 (лонг; у шорта — выше), от которой меряется зона добавленной L1: L2, без неё —
   *  L3, без обеих — стоп. */
  function nextBelowL1(own) { return has(own.L2) ? 'L2' : (has(own.L3) ? 'L3' : 'SL'); }
  function lineWord(k) { return k === 'SL' ? 'стопом' : (k === 'TP' ? 'целью' : k); }
  /** Добавленная L1 (у бота в rv её нет): E_L1_ZONE — между следующей линией и вершиной импульса
   *  (на шаге), каждое — хотя бы на 1 шаг; E_L1_PRICE — не за последней ценой (PostOnly там не
   *  встанет; нет цены — проверки нет). Нога, которая у бота была, — пусто (правила 1.8). */
  function checkAddedL1(d, own, bot, imp, last, tick) {
    var errs = [];
    if (has(bot.L1) || !has(own.L1)) return errs;
    var l1 = own.L1, nx = nextBelowL1(own);
    if (!has(imp)) {
      errs.push(['E_L1_ZONE', 'добавленная L1: нет вершины импульса']);
    } else {
      var impT = priceForDirection(imp, tick, d);
      if (!atLeastTick(l1, own[nx], d, tick) || !atLeastTick(impT, l1, d, tick)) {
        errs.push(['E_L1_ZONE', 'добавленная L1 должна быть между ' + lineWord(nx) + ' и вершиной импульса (' +
          fmtPrice(impT, tick) + ')']);
      }
    }
    if (has(last) && cmp(muli(sub(l1, last), d), ZERO) >= 0) {
      errs.push(['E_L1_PRICE', 'добавленная L1 ' + word(d, true) + ' текущей цены (' + fmtPrice(last, tick) +
        '): лимитная заявка PostOnly там не встанет — ' +
        (d === 1 ? 'опустите L1 ниже цены' : 'поднимите L1 выше цены')]);
    }
    return errs;
  }
  function inZone(x, lo, hi, d) {
    return cmp(muli(sub(x, lo), d), ZERO) >= 0 && cmp(muli(sub(hi, x), d), ZERO) >= 0;
  }
  /** SPEC_19 §1.1: стартовая цена ноги при «Добавить» / «Вернуть» → [цена | null, причина]
   *  (как miniapp_rules.add_start). own — текущие линии владельца (ноги leg нет), bot — уровни
   *  бота в rv, imp — вершина импульса (адрес im). Соседи — ближайшая нога выше (иначе цель) и ниже
   *  (иначе стоп); зона — между ними, не ближе 1 шага к каждому; середина — на шаге по стороне.
   *  Вернуть — цена бота, если с ней проходит весь порядок линий (check_order без E_TICK), иначе
   *  середина зоны. Добавить L1 — 50 % импульса (вершина на шаге + L2 бота) / 2, если в зоне
   *  «следующая линия … ближняя из вершины и цели» (границы на шаге), иначе середина этой зоны.
   *  Добавить L3 — середина между самой глубокой ногой выше и стопом. Зоны нет — отказ с причиной. */
  function addStart(d, leg, own, bot, imp, tick) {
    var idx = LEGS.indexOf(leg);
    if (idx < 0) return [null, 'неизвестная нога'];
    if (has(own[leg])) return [null, leg + ' уже есть'];
    var up = 'TP', down = 'SL', i;
    for (i = idx - 1; i >= 0; i--) if (has(own[LEGS[i]])) { up = LEGS[i]; break; }
    for (i = idx + 1; i < LEGS.length; i++) if (has(own[LEGS[i]])) { down = LEGS[i]; break; }
    var t = muli(tick, d);
    var lo, hi, cand;
    function short(a, b) { return cmp(muli(sub(b, a), d), ZERO) < 0; }   // верх зоны ниже низа (лонг)
    if (has(bot[leg])) {                                    // вернуть ногу бота
      var trial = {};
      LINES.forEach(function (k) { trial[k] = k === leg ? bot[leg] : own[k]; });
      if (!checkOrder(d, trial, tick, null).some(function (x) { return x[0] !== 'E_TICK'; })) return [bot[leg], ''];
      lo = add(own[down], t);
      hi = sub(own[up], t);
      if (short(lo, hi)) return [null, 'нет места для ' + leg + ' между ' + lineWord(up) + ' и ' + lineWord(down)];
      return [priceForDirection(div(add(lo, hi), TWO), tick, d), ''];
    }
    if (leg === 'L1') {                                     // добавить L1: старт — 50 % импульса
      var nx = nextBelowL1(own);
      if (!has(imp)) return [null, 'нет вершины импульса'];
      var impT = priceForDirection(imp, tick, d);
      lo = add(own[nx], t);
      hi = sub(impT, t);
      var hiTp = sub(own.TP, t);
      if (short(hi, hiTp)) hi = hiTp;
      if (short(lo, hi)) return [null, 'нет места для L1 между ' + lineWord(nx) + ' и вершиной импульса'];
      lo = priceForDirection(lo, tick, d);
      hi = priceForDirection(hi, tick, d);
      if (has(bot.L2)) {
        cand = priceForDirection(div(add(impT, bot.L2), TWO), tick, d);
        if (inZone(cand, lo, hi, d)) return [cand, ''];
      }
      return [priceForDirection(div(add(lo, hi), TWO), tick, d), ''];
    }
    if (leg === 'L3') {                                     // добавить L3
      if (up === 'TP') return [null, 'нет ноги выше L3'];
      lo = add(own.SL, t);
      hi = sub(own[up], t);
      if (short(lo, hi)) return [null, 'нет места для L3 — сначала ' + (d === 1 ? 'опустите' : 'поднимите') + ' стоп'];
      cand = priceForDirection(div(add(own[up], own.SL), TWO), tick, d);
      if (!inZone(cand, lo, hi, d)) cand = priceForDirection(div(add(lo, hi), TWO), tick, d);
      return [cand, ''];
    }
    return [null, 'L2 у бота есть всегда — её можно только вернуть'];
  }
  /** Строка о стопе (SPEC_19 §1 п. 6, §8): самая глубокая нога владельца мельче самой глубокой
   *  ноги бота (или сетки) → {leg, price}: новая самая глубокая нога ∓ 5 пипсов, на шаге по
   *  стороне. Иначе null. Стоп сам не двигается — это только подсказка. */
  function stopRuleHint(d, own, bot, pip, tick) {
    var od = deepestLeg(own), bd = deepestLeg(bot);
    if (!od || !bd || !has(pip) || LEGS.indexOf(od) >= LEGS.indexOf(bd)) return null;
    var price = priceForDirection(sub(own[od], muli(mul(Q(BigInt(STOP_BUF_PIPS)), pip), d)), tick, d);
    if (cmp(price, ZERO) <= 0) return null;
    return { leg: od, price: price };
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
    if (has(last)) {
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
    var ref = has(last) ? last : avg;
    if (has(ref) && cmp(ref, ZERO) > 0 && (far(stop, ref) || far(tp, ref))) {
      errs.push(['E_FAR', TXT_FAR]);
    }
    return errs;
  }
  /** R_pos = pq × (pa − стоп) × d + Σ q × (нога − стоп) × d; waitingQP — [[объём, цена, …]]. */
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

  // ------------------------------------------------------------------ SPEC_19 §8–§11: снять заявку
  /** Можно ли отметить ногу mark для снятия (страница; бот проверяет заново по журналу и бирже). */
  function checkLegCancel(p, mark) {
    var inW = (p.w || []).some(function (x) { return x[0] === mark; });
    if ((p.cx || []).indexOf(mark) < 0) {
      return [['E_LEG_STATE', inW ? mark + ' частично исполнена или ещё не подтверждена биржей — снять нельзя'
        : mark + ' не ждёт — снимать нечего']];
    }
    if (cmp(dec(p.pq), ZERO) === 0 && p.w.length < 2) {
      return [['E_LAST_LEG', 'это последняя заявка, позиции нет — снимите всё кнопкой «Снять неисполненные»']];
    }
    return [];
  }
  /** Режим позиции: проверки и числа для стопа stop, цели tp и отметки mark (нога или null).
   *  Без отметки — правила 18.0 (перенос стопа и цели, E_NO_CHANGE); с отметкой — снятие, стоп и
   *  цель проверяются, только если сдвинуты (по ждущим без отмеченной). Адрес v=2 без права
   *  переноса (mv = 0): сдвинутые стоп или цель — E_STOP_LOCKED. */
  function posCheck(p, stop, tp, mark, last) {
    var d = p.d, tick = dec(p.tk);
    var b = levelsOf(p.b);
    var pq = dec(p.pq), pa = decOrNull(p.pa);
    var avg = pa === null ? ZERO : pa;
    var wq = waitingQP(p);
    var rest = mark ? wq.filter(function (x) { return x[2] !== mark; }) : wq;
    var px = function (x) { return x[1]; };
    var moved = !(eq(stop, b.SL) && eq(tp, b.TP));
    var locked = p.v === 2 && p.mv !== 1;
    var lockTxt = cmp(pq, ZERO) > 0 ? 'перенос стопа и цели выключен' : 'без позиции стоп и цель переносятся на сайте';
    var errs;
    if (!mark) {
      if (locked) errs = moved ? [['E_STOP_LOCKED', lockTxt]] : [['E_NO_CHANGE', 'стоп и цель не изменились']];
      else errs = checkPosition(d, stop, tp, last, pa, pq, wq.map(px), tick, b.SL, b.TP);
    } else {
      errs = checkLegCancel(p, mark);
      if (moved) {
        if (locked) errs.push(['E_STOP_LOCKED', lockTxt]);
        else errs = errs.concat(checkPosition(d, stop, tp, last, pa, pq, rest.map(px), tick));
      }
    }
    var hint = null;
    if (mark && has(p.pp)) {
      var own = {};
      LEGS.forEach(function (k) { own[k] = k === mark ? null : b[k]; });
      hint = stopRuleHint(d, own, b, dec(p.pp), tick);
    }
    return { errs: errs, moved: moved, risk: positionRisk(d, pq, avg, rest, stop),
      riskOld: positionRisk(d, pq, avg, wq, b.SL), profit: positionProfit(d, pq, avg, rest, tp),
      hint: hint };
  }

  // ------------------------------------------------------------------ SPEC_191 §2, §3, §7: сдвиг заявок
  var TXT_GRID_CHANGED = 'набор ждущих заявок изменился (бот переставил или снял заявку) — откройте заново';
  var TXT_NO_MOVE = 'ничего не сдвинуто';
  var TXT_NO_PRICE = 'нет текущей цены — заявки не двигаю';
  var TXT_EXCL_MOVED = 'сначала верните линии («Вернуть как было») — сдвиг и снятие в одной правке нельзя';
  function txtExclMarked(leg) {
    return 'отмечена ' + leg + ' к снятию — линии не двигаются; снимите отметку, чтобы сдвигать';
  }
  var PLAN_CODES = ['E_LEG_NOT_BEYOND_STOP', 'E_NO_LEGS', 'E_MIN_LOT', 'E_ZERO_QTY', 'E_TP_NOT_BEYOND'];

  /** Сдвинутые линии (L1, L2, L3, SL, TP по порядку): есть и «до», и «после», цены разные
   *  (как miniapp_rules.moved_lines). */
  function movedLines(before, cur) {
    return LINES.filter(function (k) { return has(before[k]) && has(cur[k]) && !eq(before[k], cur[k]); });
  }
  /** Риск ждущих заявок «до» для показа: q × Σ (Lk − стоп) × d по ногам b (один объём и один стоп у
   *  всех заявок; точный риск по каждой заявке считает бот — miniapp_rules.orders_risk). */
  function moveRiskBefore(p) {
    var b = levelsOf(p.b), q = dec(p.q), sum = ZERO;
    legsOf(b).forEach(function (k) { sum = add(sum, muli(sub(b[k], b.SL), p.d)); });
    return mul(q, sum);
  }
  /** П. 5–6 SPEC_191 §2 (только при известной цене): сдвинутая нога — хотя бы на шаг за ценой
   *  (лонг: ниже), иначе PostOnly не встанет; сдвинутая цель — хотя бы на шаг перед ценой. */
  function movePriceErrs(d, before, cur, last, tick) {
    var errs = [];
    if (!has(last)) return errs;
    var lp = fmtPrice(last, tick);
    legsOf(cur).forEach(function (k) {
      if (has(before[k]) && !eq(before[k], cur[k]) && !atLeastTick(last, cur[k], d, tick)) {
        errs.push(['E_MOVE_PRICE', k + ' должна быть ' + word(d, false) + ' текущей цены (' + lp +
          ') хотя бы на шаг: лимитная заявка PostOnly иначе не встанет']);
      }
    });
    if (!eq(before.TP, cur.TP) && !atLeastTick(cur.TP, last, d, tick)) {
      errs.push(['E_MOVE_TP_PRICE', 'цель должна быть ' + word(d, true) + ' текущей цены (' + lp + ')']);
    }
    return errs;
  }
  /** Ровно miniapp_rules.check_orders_move (SPEC_191 §2 п. 1–7) → [[код, текст]]; пусто — можно.
   *  before — ждущие заявки (ноги — только ждущие) со стопом и целью сетки, cur — новые уровни.
   *  1. набор ног тот же (E_GRID_CHANGED, только он); 2. что-то сдвинуто (E_NO_CHANGE, только он);
   *  3–4. checkOrder с опорой E_FAR — последней ценой; 5–6. movePriceErrs; 7. цены нет — E_NO_PRICE
   *  (только бот: bot = true; страница пишет «по цене проверит бот»), п. 5–6 тогда пропускаются. */
  function checkOrdersMove(d, before, cur, last, tick, bot) {
    if (legsOf(before).join(',') !== legsOf(cur).join(',')) return [['E_GRID_CHANGED', TXT_GRID_CHANGED]];
    if (!movedLines(before, cur).length) return [['E_NO_CHANGE', TXT_NO_MOVE]];
    var errs = checkOrder(d, cur, tick, has(last) ? last : null);
    if (!has(last)) {
      if (bot) errs.push(['E_NO_PRICE', TXT_NO_PRICE]);
      return errs;
    }
    return errs.concat(movePriceErrs(d, before, cur, last, tick));
  }
  /** Сдвиг на странице (адрес v=3): проверки п. 1–6, затем объём (п. 8): сдвинута нога или стоп —
   *  planForEdit на 1 R по новым уровням; только цель — объём прежний (q), риск прежний. Ошибка
   *  плана — в errs, только если других ошибок нет. → {errs, moved, sized, plan, qty, riskOld,
   *  riskNew, bumped, view}; view — числа для показа (план или прежний объём на новых уровнях). */
  function checkMove(p, cur, last) {
    var d = p.d, inst = instOf(p), tick = inst.tk;
    var before = levelsOf(p.b);
    var errs = checkOrdersMove(d, before, cur, has(last) ? last : null, tick, false);
    var moved = movedLines(before, cur);
    var sized = moved.some(function (k) { return k !== 'TP'; });
    var q = dec(p.q), riskOld = moveRiskBefore(p);
    var res = { errs: errs, moved: moved, sized: sized, plan: null, qty: q, riskOld: riskOld,
      riskNew: riskOld, bumped: false, view: null };
    if (sized) {
      var plan = planForEdit(d, cur, inst);
      res.plan = plan;
      if (plan.ok) {
        res.qty = plan.qty;
        res.riskNew = plan.risk;
        res.bumped = plan.bumped;
        res.view = plan;
      } else {
        res.qty = null;
        res.riskNew = null;
        if (!errs.length) errs.push([plan.code, plan.reason]);
      }
    } else if (errs.length === 0 || errs[0][0] !== 'E_GRID_CHANGED') {
      var legs = legsOf(cur).map(function (k) { return [k, cur[k]]; });
      if (legs.length && cmp(riskOld, ZERO) > 0) {
        var notional = ZERO;
        legs.forEach(function (x) { notional = add(notional, mul(q, x[1])); });
        res.view = { ok: true, qty: q, legs: legs, stop: cur.SL, tp: cur.TP, risk: riskOld,
          notional: notional, bumped: false, rp: rProjection(d, legs, cur.SL, cur.TP, q) };
      }
    }
    return res;
  }
  /** SPEC_191 §7.3: сдвиг или снятие — в одной правке что-то одно. act — ['move', линия] (сдвинуть)
   *  или ['mark', нога] (отметить к снятию или снять отметку). → [] — можно, иначе [[код, текст]].
   *  Отметку снять можно всегда; отметить — если ничего не сдвинуто и нога снимается (checkLegCancel;
   *  у сетки с двумя ждущими при отметке другой — «последняя заявка», как 18.1). */
  function moveExcl(p, cur, mark, act) {
    var kind = act[0], k = act[1];
    if (kind === 'move') return mark ? [['E_EXCL_MARKED', txtExclMarked(mark)]] : [];
    if (kind !== 'mark') return [['E_ACT', 'неизвестное действие']];
    if (mark === k) return [];
    if (movedLines(levelsOf(p.b), cur).length) return [['E_EXCL_MOVED', TXT_EXCL_MOVED]];
    if (mark && cmp(dec(p.pq), ZERO) === 0 && (p.w || []).length <= 2) {
      return [['E_LAST_LEG', 'это последняя заявка, позиции нет']];
    }
    return checkLegCancel(p, k);
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
      if (has(x)) out.push(dec(x));
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
  /** Соседняя линия k в сторону стрелки (up — выше по цене), если это нога (L1, L2, L3); сосед —
   *  стоп, цель или никого — null. Порядок по стороне: цель, L1, L2, L3, стоп (как
   *  miniapp_rules.move_neighbor_leg). */
  function moveNeighborLeg(d, lv, k, up) {
    var order = ['TP', 'L1', 'L2', 'L3', 'SL'].filter(function (x) { return has(lv[x]); });
    var i = order.indexOf(k);
    if (i < 0) return null;
    var j = (!!up === (d === 1)) ? i - 1 : i + 1;
    return j >= 0 && j < order.length && LEGS.indexOf(order[j]) >= 0 ? order[j] : null;
  }
  /** Шаг ⤒⤓ линии при сдвиге ждущих заявок (адрес v=3; SPEC_191 §8, аудит 1.9.1 замечание 4) — ровно
   *  miniapp_rules.step_move_level: ближайший уровень (stepLevel); если в сторону шага соседняя
   *  линия — нога, а уровня хотя бы на шаг до неё нет, — «половина пути»: середина между линией и
   *  соседом на шаге по стороне, если она хотя бы на шаг от обоих; иначе — как stepLevel. */
  function stepMoveLevel(d, lv, k, levels, up, tick) {
    var cur = lv[k];
    if (!has(cur)) return null;
    var nv = stepLevel(levels, cur, up);
    var nb = moveNeighborLeg(d, lv, k, up);
    if (nb === null) return nv;
    var s = up ? 1 : -1, p = lv[nb];
    if (nv !== null && cmp(muli(sub(p, nv), s), tick) >= 0) return nv;
    var mid = priceForDirection(div(add(cur, p), TWO), tick, d);
    if (cmp(muli(sub(mid, cur), s), tick) >= 0 && cmp(muli(sub(p, mid), s), tick) >= 0) return mid;
    return nv;
  }

  // ------------------------------------------------------------------ §2.2 / SPEC_19 §4.2, §10.2 адрес
  var RX_NUM = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;
  var RX_INT = /^(0|[1-9][0-9]{0,15})$/;
  var RX_POSINT = /^[1-9][0-9]{0,15}$/;
  var RX_CX = /^L[123](,L[123]){0,2}$/;

  /** Разбор адреса (строка запроса без «?» или целый адрес). Неверно или неполно — null.
   *  v=1 — ровно как 18.0 (новые ключи — отказ); v=2, m=g — плюс im, pp, черновик o с любым
   *  набором; v=2, m=p — плюс cx, mv, pp, позиция может быть нулевой (сетка без исполнений).
   *  v=3 (только m=p, SPEC_191 §7.1) — ключи как у v=2, m=p; pq = 0, pa = «-», mv = 1, w не пуст,
   *  ноги b = ноги w с теми же ценами, cx ⊆ w или «-» (cx = []); o — либо черновик сдвига (тот же
   *  набор ног, цены любые), либо «-» на месте одной ноги из cx при остальных ценах как в b. */
  function parseQuery(search) {
    var sp = new URLSearchParams(search);
    var got = {}, bad = false;
    function hasKey(k) { return Object.prototype.hasOwnProperty.call(got, k); }
    sp.forEach(function (v, k) {
      if (k.indexOf('tgWebApp') === 0) return;
      if (Object.prototype.hasOwnProperty.call(got, k) || URL_KEYS.indexOf(k) < 0) bad = true;
      got[k] = v;
    });
    if (bad) return null;
    var m = got.m, ver = got.v;
    if (m !== 'g' && m !== 'p') return null;
    if (ver !== '1' && ver !== '2' && ver !== '3') return null;
    var v3 = ver === '3';
    if (v3 && m !== 'p') return null;
    var v2 = ver !== '1';               // ключи версии 2 — и у версии 3
    var need = G_KEYS.concat(m === 'p' ? P_KEYS : []).concat(v2 ? (m === 'g' ? G2_KEYS : P2_KEYS) : []);
    for (var i = 0; i < need.length; i++) if (!hasKey(need[i])) return null;
    var allowed = need.concat(['o']);
    if (Object.keys(got).some(function (k) { return allowed.indexOf(k) < 0; })) return null;

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
    function levels(v, dashAt) {      // dashAt — места ног, где допустим «-»
      var parts = v.split(',');
      if (parts.length !== 5) fail();
      return parts.map(function (x, j) {
        if (x === '-' && dashAt.indexOf(j) >= 0) return null;
        if (RX_NUM.test(x) && cmp(dec(x), ZERO) > 0) return x;
        return fail();
      });
    }
    function legsIn(arr) { return arr.slice(0, 3).some(function (x) { return x !== null; }); }
    function sameNum(a, b) { return eq(dec(a), dec(b)); }
    /** v=3: w не пуст; ноги b = ноги w с теми же ценами; o — черновик сдвига (тот же набор, цены
     *  любые) или снятия («-» на месте одной ноги из cx, остальные цены, стоп и цель — как b). */
    function checkV3(out) {
      if (!out.w.length) return false;
      for (var k = 0; k < 3; k++) {
        var wi = out.w.filter(function (x) { return x[0] === LEGS[k]; })[0];
        if ((out.b[k] === null) !== !wi) return false;
        if (wi && !sameNum(wi[1], out.b[k])) return false;
      }
      var dashes = [], movedAny = false;
      for (var j = 0; j < 5; j++) {
        var o = out.o[j], b = out.b[j];
        if (o === null && b !== null) dashes.push(LEGS[j]);
        else if ((o === null) !== (b === null)) return false;          // ноги, которой нет, не добавить
        else if (o !== null && !sameNum(o, b)) movedAny = true;
      }
      if (dashes.length > 1) return false;
      if (dashes.length === 1 && (out.cx.indexOf(dashes[0]) < 0 || movedAny)) return false;
      return true;
    }
    try {
      if (!/^[0-9A-Za-z._-]{1,16}$/.test(got.pv)) return null;
      if (!/^[A-Z0-9]{2,30}$/.test(got.s) || (got.d !== '1' && got.d !== '-1')) return null;
      var anyLeg = [0, 1, 2], v1Legs = [0, 2];
      var out = { v: Number(ver), pv: got.pv, m: m, c: intv('c', RX_POSINT), e: intv('e', RX_INT), s: got.s,
        d: Number(got.d), tk: num('tk', true), qs: num('qs', true), mq: num('mq', false),
        mn: num('mn', false), xq: num('xq', true, true), rk: num('rk', true), rb: num('rb', true),
        cap: num('cap', true), tol: num('tol', false), fm: num('fm', false), ft: num('ft', false),
        a: intv('a', RX_INT), rv: intv('rv', RX_INT), ex: intv('ex', RX_INT),
        b: levels(got.b, v2 && m === 'p' ? anyLeg : v1Legs),
        im: null, pp: null, pq: null, pa: null, q: null, w: null, cx: null, mv: null };
      if (v2 && m === 'g') {
        out.im = num('im', true);
        out.pp = num('pp', true);
        out.o = hasKey('o') ? levels(got.o, anyLeg) : out.b.slice();
        if (!legsIn(out.o)) return null;
      } else if (!v2) {
        out.o = hasKey('o') ? levels(got.o, v1Legs) : out.b.slice();
        for (var j = 0; j < 5; j++) if ((out.o[j] === null) !== (out.b[j] === null)) return null;
      }
      if (m === 'p') {
        out.pq = num('pq', !v2);
        var pqZero = cmp(dec(out.pq), ZERO) === 0;
        if (v3 && !pqZero) return null;                                              // исполнений нет
        out.pa = num('pa', true, v2 && pqZero);
        if (v3 && out.pa !== null) return null;
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
        if (v2) {
          var cx = [];
          if (!(v3 && got.cx === '-')) {                                               // v=3: «-» — снимать нечего
            if (!RX_CX.test(got.cx)) return null;
            cx = got.cx.split(',');
          }
          for (var u = 0; u < cx.length; u++) {
            if (u > 0 && LEGS.indexOf(cx[u]) <= LEGS.indexOf(cx[u - 1])) return null;   // порядок, без повторов
            if (!out.w.some(function (x) { return x[0] === cx[u]; })) return null;      // cx ⊆ w
          }
          out.cx = cx;
          if (got.mv !== '0' && got.mv !== '1') return null;
          out.mv = Number(got.mv);
          if (v3 && out.mv !== 1) return null;
          out.pp = num('pp', true);
          if (!legsIn(out.b) && pqZero) return null;
          out.o = hasKey('o') ? levels(got.o, anyLeg) : out.b.slice();
          if (v3) return checkV3(out) ? out : null;
          var dashes = 0;
          for (var k = 0; k < 3; k++) {
            if (out.o[k] === null && out.b[k] !== null) {
              if (cx.indexOf(LEGS[k]) < 0) return null;
              dashes++;
            } else if ((out.o[k] === null) !== (out.b[k] === null) ||
                (out.o[k] !== null && !eq(dec(out.o[k]), dec(out.b[k])))) {
              return null;
            }
          }
          if (dashes > 1) return null;
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
  /** Ждущие ноги позиции: [[объём, цена, нога]]. */
  function waitingQP(p) {
    var q = dec(p.q);
    return (p.w || []).map(function (x) { return [q, dec(x[1]), x[0]]; });
  }

  // ------------------------------------------------------------------ §1.4 / SPEC_19 §4.1, §10.1 нагрузка
  /** Состояние страницы → объект для sendData; null — «Готово» неактивна.
   *  final — 5 уровней [L1, L2, L3, стоп, цель] (дроби, строки или null — ноги нет); last —
   *  последняя цена или null; mark — нога, отмеченная к снятию (только m = p, адрес v=2).
   *  m = g: набор ног = набору b → версия 1 (ровно 18.0), иначе — версия 2 с lx (только адрес v=2).
   *  m = p: без отметки — версия 1 (стоп и цель), с отметкой — версия 2 (lv «=»/«-», lx ["-Lk"]).
   *  m = p, адрес v=3: без отметки — версия 3 (сдвиг заявок, movePayload; final — все пять линий),
   *  с отметкой — версия 2, как 18.1, если ни одна линия не сдвинута. */
  function buildPayload(p, final, last, platform, tMs, mark) {
    var d = p.d, inst = instOf(p), tick = inst.tk;
    var lvOut, pq, pr, pb, risk, lx = null;
    var fin = final.map(function (x) { return decOrNull(x); });
    if (p.m === 'g') {
      var bot = levelsOf(p.b);
      var lv = {};
      LINES.forEach(function (k, i) { lv[k] = fin[i]; });
      if (!has(lv.SL) || !has(lv.TP)) return null;
      var diff = legsDiff(bot, lv);
      if (diff.length && p.v !== 2) return null;            // режим совместимости: набор как у бота
      if (!legsOf(lv).length) return null;
      var ref = has(last) ? last : bot.L2;
      if (checkOrder(d, lv, tick, ref).length) return null;
      if (checkAddedL1(d, lv, bot, decOrNull(p.im), last, tick).length) return null;
      var plan = planForEdit(d, lv, inst);
      if (!plan.ok) return null;
      risk = plan.risk;
      lvOut = LINES.map(function (k) { return lv[k] === null ? '-' : fmtPrice(lv[k], tick); });
      pq = fmtQty(plan.qty, inst.qs);
      pb = plan.bumped ? 1 : 0;
      if (diff.length) lx = diff;
    } else {
      if (mark && (p.v < 2 || LEGS.indexOf(mark) < 0)) return null;
      var stop = fin[3], tp = fin[4];
      if (!has(stop) || !has(tp)) return null;
      if (p.v === 3) {
        var cur = {};
        LINES.forEach(function (k, i) { cur[k] = fin[i]; });
        if (!mark) return movePayload(p, cur, last, platform, tMs);
        if (movedLines(levelsOf(p.b), cur).length) return null;   // сдвиг и снятие в одной правке нельзя
      }
      var pc = posCheck(p, stop, tp, mark || null, has(last) ? last : null);
      if (pc.errs.length) return null;                     // в том числе E_NO_CHANGE без отметки
      risk = pc.risk;
      lvOut = LEGS.map(function (k) { return k === mark ? '-' : '='; })
        .concat([fmtPrice(stop, tick), fmtPrice(tp, tick)]);
      pq = p.pq;
      pb = 0;
      if (mark) lx = ['-' + mark];
    }
    pr = toFixedHE(risk, 2);
    var out = { v: lx ? 2 : 1, m: p.m, c: p.c, e: p.e, rv: p.rv, lv: lvOut };
    if (lx) out.lx = lx;
    out.pq = pq;
    out.pr = pr;
    out.pb = pb;
    out.pv = PAGE_VERSION;
    out.pl = platformTag(platform);
    out.t = tMs;
    return out;
  }
  /** SPEC_191 §7.2: нагрузка версии 3 — сдвиг ждущих заявок (адрес v=3, без отметки). Ключи — как у
   *  версии 1; lv — цены ждущих ног («-» — ноги без заявки), стоп и цель; pq, pr, pb — план страницы
   *  (только цель — прежний объём и риск). Ошибки checkMove (в том числе «ничего не сдвинуто») —
   *  null. */
  function movePayload(p, cur, last, platform, tMs) {
    var inst = instOf(p), tick = inst.tk;
    var cm = checkMove(p, cur, has(last) ? last : null);
    if (cm.errs.length) return null;
    return { v: 3, m: 'p', c: p.c, e: p.e, rv: p.rv,
      lv: LINES.map(function (k) { return has(cur[k]) ? fmtPrice(cur[k], tick) : '-'; }),
      pq: fmtQty(cm.qty, inst.qs), pr: toFixedHE(cm.riskNew, 2), pb: cm.bumped ? 1 : 0,
      pv: PAGE_VERSION, pl: platformTag(platform), t: tMs };
  }
  /** Telegram.WebApp.platform → 1–16 знаков [0-9A-Za-z._-] (как проверяет бот). */
  function platformTag(platform) {
    var t = String(platform || '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 16);
    return t || 'unknown';
  }
  function payloadBytes(s) { return new TextEncoder().encode(s).length; }

  root.LevelRules = {
    PAGE_VERSION: PAGE_VERSION, KNOWN_PAGE_VERSIONS: KNOWN_PAGE_VERSIONS,
    PAYLOAD_MAX_BYTES: PAYLOAD_MAX_BYTES, STOP_BUF_PIPS: STOP_BUF_PIPS, LINES: LINES, LEGS: LEGS,
    TXT_LEGSET: TXT_LEGSET, TXT_NO_LEGS: TXT_NO_LEGS,
    Q: Q, dec: dec, decOrNull: decOrNull, add: add, sub: sub, mul: mul, div: div, muli: muli,
    cmp: cmp, eq: eq, has: has, ZERO: ZERO, ONE: ONE, TWO: TWO,
    roundStep: roundStep, priceForDirection: priceForDirection, onStep: onStep,
    toApiStr: toApiStr, toFixedHE: toFixedHE, fmtPrice: fmtPrice, fmtQty: fmtQty,
    stepDecimals: stepDecimals, toNum: toNum, fromNum: fromNum,
    planForEdit: planForEdit, rProjection: rProjection, feesR: feesR,
    checkOrder: checkOrder, lateLegs: lateLegs, checkPosition: checkPosition,
    legsOf: legsOf, deepestLeg: deepestLeg, legsDiff: legsDiff, checkLegset2: checkLegset2,
    checkAddedL1: checkAddedL1, addStart: addStart, stopRuleHint: stopRuleHint,
    checkLegCancel: checkLegCancel, posCheck: posCheck,
    positionRisk: positionRisk, positionProfit: positionProfit,
    movedLines: movedLines, moveRiskBefore: moveRiskBefore, movePriceErrs: movePriceErrs,
    checkOrdersMove: checkOrdersMove, checkMove: checkMove, moveExcl: moveExcl,
    movePayload: movePayload, PLAN_CODES: PLAN_CODES, TXT_NO_PRICE: TXT_NO_PRICE,
    m5Levels: m5Levels, stepLevel: stepLevel, moveNeighborLeg: moveNeighborLeg, stepMoveLevel: stepMoveLevel,
    parseQuery: parseQuery, parsePageUrl: parsePageUrl, instOf: instOf, levelsOf: levelsOf,
    waitingQP: waitingQP, buildPayload: buildPayload, payloadBytes: payloadBytes,
    platformTag: platformTag
  };
})(typeof window !== 'undefined' ? window : globalThis);
