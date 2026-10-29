/* trade_rules.js — правила страницы «Сделка» (SPEC_C2 §9–§13; бот 2.1, страница 19.0; 19.1 — бот 2.3, правила те
 * же, новая только метка ручной сделки в trade.js; 19.2 — бот 2.4: вход при пробое в режиме n, вторая цель и
 * трейлинг Bybit открытой сделки в режиме q — правила SPEC_C3 §3.4, §4.2 той же копией manual_rules; 19.3 — бот 2.6:
 * ждущая ручная лимитка в режиме q (st = w, SPEC_C2 §4.2, §12.4, §17.2 — calcW: цена, стоп и цель заявки, объём на тот
 * же риск, проверки «Сдвинуть» и подтверждения бота). Без DOM и сети.
 *
 * Копия правил ручной сделки бота (manual_rules.py — эталон; miniapp_rules.swing_points, closed_bars) на
 * точных дробях {n, d} из BigInt: опорная цена и предел цены «по рынку», стоп за уровнем и цель на уровне,
 * объём от риска до стопа с комиссиями входа и выхода (подъём до лота ≤ +tol, урезание номиналом и
 * наибольшим объёмом заявки), R после комиссий, цели 2R и 3R, безубыток, риск открытой позиции и ждущей
 * лимитки, вершины и впадины (фрактал 2/2 по свечам, закрытым по времени сервера Bybit), стоп и цель по
 * умолчанию, стрелки ⤓⤒, округление линии пальцем, числовые проверки подтверждения (numeric_checks),
 * проверка цены лимитки (entry_side), пределы риска, проверки «Перенести» для стопа и цели позиции, остаток
 * дня и пределы ручных по данным кнопки, фандинг. Разбор адреса версии 4 (режимы n и q) и сборка данных для
 * бота версии 4 (sendData).
 *
 * Число Number — только для показа. Совпадение с ботом проверяют trade_selftest.html и Deno
 * (bot_next21/tools/selftest_trade_deno.js) на примерах tools/make_trade_fixtures.py: эталон — функции
 * manual_rules (Decimal) и копия формул на дробях (fractions.Fraction); генератор падает при расхождении.
 * Сравниваются коды и числа (десятичными строками), а не тексты.
 *
 * Не зависит от rules.js страницы уровней: дроби — своя копия (версии двух страниц живут отдельно).
 */
(function (root) {
  'use strict';

  var PAGE_VERSION = '19.3';                 // 19.3 (бот 2.6): ждущая лимитка (st = w); 19.2 (бот 2.4): пробой, цель 2, трейлинг
  var KNOWN_PAGE_VERSIONS = ['19.0', '19.1', '19.2', '19.3'];   // pv адреса, который страница принимает (бот 2.2 — 19.0, 2.3 — 19.1, 2.4 — 19.2)
  var C3_VERSION = '19.2';                   // с этой pv адрес несёт ключи пробоя, цели 2 и трейлинга
  var URL_VERSION = '4';
  var DATA_VERSION = 4;
  var PAYLOAD_MAX_BYTES = 4096;
  var STOP_BARS = 96;                      // [manual] stop_bars: закрытых свечей для уровней
  var BAR_MS = 300000, H1_MS = 3600000;
  var STALE_MS = 600000;                   // данные кнопки старше 10 минут — строк остатка дня нет
  var MAX_SAFE = 9007199254740991;

  // Порядок ключей адреса — строго по таблицам SPEC_C2 §9.1, §9.2 (страница порядок не проверяет). Адрес 19.0 и 19.1
  // (кнопки ботов 2.1–2.3) — прежний набор; адрес 19.2 (бот 2.4) — ещё ключи пробоя (n) и цели 2 и трейлинга (q).
  var URL_N_KEYS_191 = ['v', 'pv', 'm', 'k', 's', 'd', 'em', 'tk', 'qs', 'mq', 'mn', 'xm', 'xl', 'fm', 'ft',
    'rk', 'rb', 'rc', 'ra', 'cap', 'cw', 'tol', 'sb', 'sm', 'sf', 'ns', 'np', 'fr', 'fw', 'xr', 'xw', 'wp', 'wf',
    'td', 'tb', 't1', 'ex', 'ea', 'dr', 'mo', 'mx', 'no', 'nx', 'a', 'le', 'mm', 'mr', 'fa', 'mg', 'lb', 'lm', 'at'];
  var URL_Q_KEYS_191 = ['v', 'pv', 'm', 'k', 's', 'd', 'st', 'et', 'tk', 'qs', 'mq', 'mn', 'xl', 'fi', 'fo', 'fp',
    'rt', 'rp', 'rb', 'cap', 'tol', 'sb', 'tb', 'ns', 'np', 'xr', 'xw', 'fr', 'fw', 'wp', 'wf', 'ep', 'ql', 'pq',
    'pa', 'sl', 'tp', 'lk', 'a', 'le', 'mm', 'mr', 'fa', 'mg', 'lb', 'lm', 'at'];
  var URL_N_KEYS = ['v', 'pv', 'm', 'k', 's', 'd', 'em', 'tk', 'qs', 'mq', 'mn', 'xm', 'xl', 'fm', 'ft',
    'rk', 'rb', 'rc', 'ra', 'cap', 'cw', 'tol', 'sb', 'sm', 'sf', 'ns', 'np', 'fr', 'fw', 'xr', 'xw', 'wp', 'wf',
    'td', 'tb', 't1', 'ex', 'ea', 'dr', 'mo', 'mx', 'no', 'nx', 'a', 'bg', 'le', 'mm', 'mr', 'fa', 'mg', 'lb', 'lm',
    'at'];
  var URL_Q_KEYS = ['v', 'pv', 'm', 'k', 's', 'd', 'st', 'et', 'tk', 'qs', 'mq', 'mn', 'xl', 'fi', 'fo', 'fp',
    'rt', 'rp', 'rb', 'cap', 'tol', 'sb', 'tb', 'ns', 'np', 'xr', 'xw', 'fr', 'fw', 'wp', 'wf', 'ep', 'ql', 'pq',
    'pa', 'sl', 'tp', 'lk', 'a', 't2', 'q1', 'q2', 'w2', 'wd', 'y1', 'ya', 'yb', 'yd', 'ye', 'ym', 'yt', 'yp', 'le',
    'mm', 'mr', 'fa', 'mg', 'lb', 'lm', 'at'];
  var C3_Q_KEYS = ['t2', 'q1', 'q2', 'w2', 'wd', 'y1', 'ya', 'yb', 'yd', 'ye', 'ym', 'yt', 'yp'];
  var EM_191 = ['ml', 'm', 'l'], EM_192 = ['m', 'l', 'b', 'ml', 'mb', 'lb', 'mlb'];
  var CH4_KEYS = ['le', 'mm', 'mr', 'fa', 'mg', 'lb', 'lm', 'at'];   // Ч4 (плечо, маржа) — в 19.0 только «-»
  // Порядок ключей данных — SPEC_C2 §10.1, §10.3 (JSON.stringify и build_trade_payload — одна строка).
  var PAYLOAD_N_KEYS = ['v', 'm', 'k', 's', 'd', 'et', 'lv', 'ks', 'kt', 'tg', 'tr', 'al', 'tf', 'rq', 'rk',
    'pq', 'pr', 'pb', 'pp', 'pt', 'pv', 'pl', 't'];
  var PAYLOAD_Q_KEYS = ['v', 'm', 'k', 's', 'd', 'st', 'lv', 'o', 'tg', 'tr', 'al', 'tf', 'pq', 'pr', 'pb',
    'pv', 'pl', 't'];
  var KS_STOP = ['m5', 'h1', 'p'];
  var KS_TP = ['m5', 'h1', 'r2', 'r3', 'p', '0'];

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
  function intQ(k) { return Q(BigInt(k)); }
  function add(a, b) { return Q(a.n * b.d + b.n * a.d, a.d * b.d); }
  function sub(a, b) { return Q(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { return Q(a.n * b.n, a.d * b.d); }
  function div(a, b) { return Q(a.n * b.d, a.d * b.n); }
  function muli(a, k) { return Q(a.n * BigInt(k), a.d); }
  function cmp(a, b) { var x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : (x > 0n ? 1 : 0); }
  function eq(a, b) { return a.n === b.n && a.d === b.d; }
  function qmin(a, b) { return cmp(a, b) <= 0 ? a : b; }
  function qmax(a, b) { return cmp(a, b) >= 0 ? a : b; }
  function qabs(a) { return a.n < 0n ? Q(-a.n, a.d) : a; }
  var ZERO = Q(0n), ONE = Q(1n), TWO = Q(2n), HUNDRED = Q(100n), CENT = Q(1n, 100n);
  function has(x) { return x !== null && x !== undefined; }
  function sameQ(a, b) { return has(a) ? (has(b) && eq(a, b)) : !has(b); }

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
  /** miniapp_rules.on_tick: цена на шаге цены. */
  function onStep(v, step) { return div(v, step).d === 1n; }

  // ------------------------------------------------------------------ строки чисел
  function pow10(k) { return 10n ** BigInt(k); }
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
    if (q === null || q === undefined) return null;
    var k = decimalsOf(q);
    if (k < 0) throw new Error('не десятичная дробь');
    return fixedStr(q.n * (pow10(k) / q.d), k);
  }
  /** Ровно k знаков, округление к чётному (как format(Decimal, '.kf')); −0 → 0. */
  function toFixedHE(q, k) {
    var sc = mul(q, Q(pow10(k)));
    var neg = sc.n < 0n;
    var fl = roundHalfEvenQ(neg ? Q(-sc.n, sc.d) : sc);
    return fixedStr(neg && fl !== 0n ? -fl : fl, k);
  }
  /** Доли и проценты в примерах: 10 знаков к чётному (точная дробь — у страницы и у генератора). */
  function q10(q) { return q === null || q === undefined ? null : toFixedHE(q, 10); }
  function stepDecimals(step) { return decimalsOf(step); }
  /** common.fmt_price (messages.fmt_px): цена с точностью шага. */
  function fmtPrice(v, tick) { return toFixedHE(roundStep(v, tick, 'nearest'), stepDecimals(tick)); }
  /** Дробь → Number (для показа). */
  function toNum(q) {
    var neg = q.n < 0n;
    var v = (neg ? -q.n : q.n) * pow10(30) / q.d;
    var x = Number(v.toString() + 'e-30');
    return neg ? -x : x;
  }
  /** Number → дробь (координата графика): 12 знаков после точки. */
  function fromNum(x) {
    if (!isFinite(x)) return null;
    return dec(x.toFixed(12));
  }
  /** Точное значение двоичного числа Number (как Fraction(float) в Python). */
  function dblToQ(x) {
    if (x === 0 || !isFinite(x)) return ZERO;
    var dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    var hi = dv.getUint32(0), lo = dv.getUint32(4);
    var sign = hi >>> 31, ex = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (ex === 0) ex = 1; else mant |= 1n << 52n;
    var e = ex - 1075;
    var n = mant, dd = 1n;
    if (e >= 0) n = mant << BigInt(e); else dd = 1n << BigInt(-e);
    return Q(sign ? -n : n, dd);
  }
  /** float(q) — ближайшее двоичное (как float(Decimal) в Python: преобразование с верным округлением). */
  function toFloatQ(q) {
    var k = decimalsOf(q);
    return k >= 0 ? Number(toApiStr(q)) : Number(toFixedHE(q, 40));
  }
  /** Python f"{float(q):.kf}" и round(float(q), k): точное значение двоичного числа, к чётному. */
  function pyFixed(q, k) { return toFixedHE(dblToQ(toFloatQ(q)), k); }
  /** Python int(round(float(q))). */
  function pyRoundInt(q) { return Number(roundHalfEvenQ(dblToQ(toFloatQ(q)))); }
  var NBSP = ' ', MINUS = '−';
  function groupDigits(s, sep) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep); }
  /** messages.fmt_int: «12 317» (обычный пробел между тысячами). */
  function fmtInt(q) { var n = pyRoundInt(q); return (n < 0 ? '-' : '') + groupDigits(String(Math.abs(n)), ' '); }
  /** manual_messages.fmt_qty: объём вниз на шаг, знаков — как у шага; от 10 000 — пробелы между разрядами. */
  function fmtQty(q, step) {
    var s = toFixedHE(roundStep(q, step, 'floor'), stepDecimals(step));
    var parts = s.split('.');
    if (parts[0].length < 5 || !/^[0-9]+$/.test(parts[0])) return s;
    return groupDigits(parts[0], ' ') + (parts.length > 1 ? '.' + parts[1] : '');
  }
  /** common.fmt_usdt(float(q)): «1 234.56 USDT» (неразрывный пробел), минус — U+2212. */
  function fmtUsdt(q) {
    var x = dblToQ(toFloatQ(q));
    var neg = x.n < 0n;
    var body = toFixedHE(qabs(x), 2);
    var parts = body.split('.');
    var out = groupDigits(parts[0], NBSP) + '.' + parts[1];
    var zero = /^0\.00$/.test(body);
    return (neg && !zero ? MINUS : '') + out + ' USDT';
  }
  /** common.fmt_plain(float(q), k): без лишних нулей, разряды — неразрывный пробел. */
  function fmtPlain(q, k) {
    if (k === undefined) k = 2;
    var t = pyFixed(q, k);
    var neg = t.charAt(0) === '-';
    if (neg) t = t.slice(1);
    if (/^0(\.0+)?$/.test(t)) neg = false;
    var parts = t.split('.');
    var body = groupDigits(parts[0], NBSP) + (parts.length > 1 ? '.' + parts[1] : '');
    if (body.indexOf('.') >= 0) body = body.replace(/0+$/, '').replace(/\.$/, '');
    return (neg ? MINUS : '') + body;
  }

  // ------------------------------------------------------------------ §12.1 цены, объём, риск
  /** manual_rules.ref_price: лонг — ask1, шорт — bid1. */
  function refPrice(d, bid, ask) { return d === 1 ? ask : bid; }
  /** manual_rules.price_limit: ref + d × max(sm × tick, sf × |ref − S|), на шаг в худшую сторону. */
  function priceLimit(d, ref, stop, tick, sm, sf) {
    var a = qmax(muli(tick, sm), mul(sf, qabs(sub(ref, stop))));
    return roundStep(add(ref, muli(a, d)), tick, d === 1 ? 'ceil' : 'floor');
  }
  /** manual_rules.round_stop: лонг — уровень − буфер, на шаг вниз; шорт — + буфер, вверх. */
  function roundStop(level, d, tick, buf) {
    return roundStep(sub(level, muli(muli(tick, buf), d)), tick, d === 1 ? 'floor' : 'ceil');
  }
  /** manual_rules.round_target: лонг — вершина − буфер, на шаг вниз; шорт — впадина + буфер, вверх. */
  function roundTarget(level, d, tick, buf) {
    return roundStep(sub(level, muli(muli(tick, buf), d)), tick, d === 1 ? 'floor' : 'ceil');
  }
  /** u = (P − S)·d + P·f_in + S·f_out. */
  function unitLoss(d, P, S, fin, fout) { return add(add(muli(sub(P, S), d), mul(P, fin)), mul(S, fout)); }
  /** (P·f_in + S·f_out) / u; u ≤ 0 — 1. */
  function feeShare(P, S, fin, fout, u) {
    if (cmp(u, ZERO) <= 0) return ONE;
    return div(add(mul(P, fin), mul(S, fout)), u);
  }
  function sizeFail(code, u, riskNeed) {
    return { ok: false, code: code, qty: ZERO, u: u, riskPlan: ZERO, notional: ZERO, bumped: false, capped: null,
      riskNeed: riskNeed };
  }
  /** manual_rules.plan_size. o: {fin, fout, risk, qs, mq, mn, maxQ (null — нет), cap, tol}. */
  function planSize(d, P, S, o) {
    var u = unitLoss(d, P, S, o.fin, o.fout);
    var step = o.qs;
    if (cmp(muli(sub(P, S), d), ZERO) <= 0 || cmp(u, ZERO) <= 0 || cmp(P, ZERO) <= 0) return sizeFail('bad_stop', u, null);
    var r = o.risk;
    var qty0 = roundStep(div(r, u), step, 'floor');
    var capQ = roundStep(div(o.cap, P), step, 'floor');
    var limits = [capQ], mq = null;
    if (has(o.maxQ) && cmp(o.maxQ, ZERO) > 0) { mq = roundStep(o.maxQ, step, 'floor'); limits.push(mq); }
    var qty = qty0, capped = null;
    if (cmp(capQ, qty) < 0) { qty = capQ; capped = 'notional'; }
    if (mq !== null && cmp(mq, qty) < 0) { qty = mq; capped = 'max_qty'; }
    var need = o.mq;
    if (cmp(o.mn, ZERO) > 0) need = qmax(need, roundStep(div(o.mn, P), step, 'ceil'));
    var bumped = false;
    if (cmp(qty, need) < 0) {
      var riskNeed = mul(need, u);
      if (cmp(riskNeed, mul(r, add(ONE, o.tol))) <= 0 && limits.every(function (x) { return cmp(need, x) <= 0; })) {
        qty = need;
        bumped = true;
        capped = null;
      } else {
        return sizeFail('min_lot', u, riskNeed);
      }
    }
    if (cmp(qty, ZERO) <= 0) return sizeFail('zero', u, null);
    return { ok: true, code: '', qty: qty, u: u, riskPlan: mul(qty, u), notional: mul(qty, P), bumped: bumped,
      capped: capped, riskNeed: null };
  }
  /** manual_rules.open_risk: max(0, pos × u(avg, S)). */
  function openRisk(d, pos, avg, S, fin, fout) { return qmax(ZERO, mul(pos, unitLoss(d, avg, S, fin, fout))); }
  /** manual_rules.working_risk: max(0, q_left × u(E, S, мейкер, тейкер)). */
  function workingRisk(d, qLeft, E, S, fm, ft) { return qmax(ZERO, mul(qLeft, unitLoss(d, E, S, fm, ft))); }
  /** manual_rules.r_at: qty × ((T − P)·d − P·f_in − T·f_tp) / risk_plan. */
  function rAt(d, T, P, qty, fin, ftp, rp) {
    if (cmp(rp, ZERO) <= 0) throw new Error('риск плана должен быть > 0');
    return div(mul(qty, sub(sub(muli(sub(T, P), d), mul(P, fin)), mul(T, ftp))), rp);
  }
  /** manual_rules.target_for_r: R(T_n) = n, на шаг к входу. */
  function targetForR(n, d, P, u, fin, ftp, tick) {
    var nn = intQ(n);
    var raw = d === 1 ? div(add(mul(P, add(ONE, fin)), mul(nn, u)), sub(ONE, ftp))
      : div(sub(mul(P, sub(ONE, fin)), mul(nn, u)), add(ONE, ftp));
    return roundStep(raw, tick, d === 1 ? 'floor' : 'ceil');
  }
  /** manual_rules.be_price: стоп с чистым итогом 0, на шаг в сторону прибыли. */
  function bePrice(d, avg, fin, fout, tick) {
    var raw = d === 1 ? div(mul(avg, add(ONE, fin)), sub(ONE, fout)) : div(mul(avg, sub(ONE, fin)), add(ONE, fout));
    return roundStep(raw, tick, d === 1 ? 'ceil' : 'floor');
  }

  // ------------------------------------------------------------------ §12.2 свечи, вершины и впадины
  /** Закрытые свечи по времени сервера: открытие + длина ≤ T (miniapp_rules.closed_bars; у H1 — + 60 мин);
   *  последние n, старые первыми. bars — [{t, h, l, ...}]. */
  function closedBars(bars, nowMs, n, tfMs) {
    var out = bars.filter(function (b) { return b.t + tfMs <= nowMs; });
    out.sort(function (a, b) { return a.t - b.t; });
    return n > 0 ? out.slice(-n) : out;
  }
  /** miniapp_rules.swing_points: свеча i (2 ≤ i ≤ n − 3) — вершина: H[i] > H[i−1], H[i] > H[i−2], H[i] ≥ H[i+1],
   *  H[i] ≥ H[i+2]; впадина — зеркально. Цена без округления и открытие свечи. */
  function swingPoints(bars, tf) {
    var hs = bars.map(function (b) { return dec(b.h); });
    var ls = bars.map(function (b) { return dec(b.l); });
    var n = bars.length, highs = [], lows = [];
    for (var i = 2; i < n - 2; i++) {
      if (cmp(hs[i], hs[i - 1]) > 0 && cmp(hs[i], hs[i - 2]) > 0 && cmp(hs[i], hs[i + 1]) >= 0 &&
          cmp(hs[i], hs[i + 2]) >= 0) highs.push({ px: hs[i], t: bars[i].t });
      if (cmp(ls[i], ls[i - 1]) < 0 && cmp(ls[i], ls[i - 2]) < 0 && cmp(ls[i], ls[i + 1]) <= 0 &&
          cmp(ls[i], ls[i + 2]) <= 0) lows.push({ px: ls[i], t: bars[i].t });
    }
    return { tf: tf || 'M5', highs: highs, lows: lows };
  }
  /** Все цены уровней таймфреймов (стрелки стопа и цели — M5 и H1, цены лимитки — только M5). */
  function levelsOf(swings) {
    var out = [];
    (swings || []).forEach(function (sw) {
      if (!sw) return;
      sw.highs.forEach(function (x) { out.push(x.px); });
      sw.lows.forEach(function (x) { out.push(x.px); });
    });
    return out;
  }
  function byDistThenNewer(edgeDist) {
    return function (a, b) {
      var c = cmp(edgeDist(a), edgeDist(b));
      return c !== 0 ? c : (b.t - a.t);
    };
  }
  /** manual_rules.default_stop. o: {et: 'market'|'limit'|'breakout', bid, ask, tick, fin, fout, m5, h1, E,
   *  rule: {sb, ns, np, fw, xr, sm, sf}} → {stop, src, level, price, skipped [[уровень, tf, close|fee]], far,
   *  farPct, searched}. 19.2: у пробоя E — уровень: кандидаты за уровнем, цена расчёта — предел от уровня. */
  function defaultStop(d, o) {
    var t = o.tick, b = o.bid, a = o.ask, rule = o.rule;
    var spread = qmax(ZERO, sub(a, b));
    var ref = refPrice(d, b, a);
    var limit = o.et === 'limit', bk = o.et === 'breakout';
    var edge = limit || bk ? o.E : (d === 1 ? b : a);
    var kind = d === 1 ? 'lows' : 'highs';
    var minDist = qmax(muli(t, rule.ns), muli(spread, rule.np));
    var skipped = [], searched = [], far = false;
    var tfs = [[o.m5, 'swing_m5'], [o.h1, 'swing_h1']];
    for (var i = 0; i < tfs.length; i++) {
      var sw = tfs[i][0];
      if (!sw) continue;
      searched.push(sw.tf);
      var cands = sw[kind].filter(function (x) { return cmp(muli(sub(edge, x.px), d), ZERO) > 0; });
      cands.sort(byDistThenNewer(function (x) { return muli(sub(edge, x.px), d); }));
      for (var j = 0; j < cands.length; j++) {
        var lv = cands[j];
        var s = roundStop(lv.px, d, t, rule.sb);
        var p = limit ? o.E : priceLimit(d, bk ? o.E : ref, s, t, rule.sm, rule.sf);
        var dist = muli(sub(p, s), d);
        if (cmp(dist, ZERO) <= 0) { skipped.push([lv, sw.tf, 'close']); continue; }
        if (cmp(mul(div(dist, p), HUNDRED), rule.xr) > 0) { far = true; break; }
        var u = unitLoss(d, p, s, o.fin, o.fout);
        if (cmp(dist, minDist) < 0) { skipped.push([lv, sw.tf, 'close']); continue; }
        if (cmp(feeShare(p, s, o.fin, o.fout, u), rule.fw) > 0) { skipped.push([lv, sw.tf, 'fee']); continue; }
        return { stop: s, src: tfs[i][1], level: lv, price: p, skipped: skipped, far: false, farPct: null, searched: [] };
      }
    }
    return { stop: null, src: 'none', level: null, price: null, skipped: skipped, far: far, farPct: rule.xr,
      searched: searched };
  }
  /** manual_rules.default_target(…, beyond=). o: {tick, m5, h1, tb, minR, beyond (null — нет)}. */
  function defaultTarget(d, P, S, o) {
    var t = o.tick;
    var need = mul(o.minR, qabs(sub(P, S)));
    var edge = !has(o.beyond) ? P : (d === 1 ? qmax(P, o.beyond) : qmin(P, o.beyond));
    var kind = d === 1 ? 'highs' : 'lows';
    var tfs = [[o.m5, 'swing_m5'], [o.h1, 'swing_h1']];
    for (var i = 0; i < tfs.length; i++) {
      var sw = tfs[i][0];
      if (!sw) continue;
      var cands = sw[kind].filter(function (x) { return cmp(muli(sub(x.px, edge), d), ZERO) > 0; });
      cands.sort(byDistThenNewer(function (x) { return muli(sub(x.px, P), d); }));
      for (var j = 0; j < cands.length; j++) {
        var lv = cands[j];
        var tt = roundTarget(lv.px, d, t, o.tb);
        if (cmp(muli(sub(tt, P), d), ZERO) <= 0 || cmp(qabs(sub(tt, P)), need) < 0 ||
            cmp(muli(sub(tt, edge), d), t) < 0) continue;
        return { target: tt, src: tfs[i][1], level: lv };
      }
    }
    return { target: null, src: 'none', level: null };
  }

  // ------------------------------------------------------------------ §12.4 стрелки, линии пальцем
  /** manual_rules.side_levels: строго ниже (below) или выше ref. */
  function sideLevels(levels, ref, below) {
    return levels.filter(function (x) { return below ? cmp(x, ref) < 0 : cmp(x, ref) > 0; });
  }
  /** miniapp_rules.step_level: ▲ — наименьший строго выше, ▼ — наибольший строго ниже; нет — null. */
  function stepLevel(levels, cur, up) {
    var r = null;
    levels.forEach(function (x) {
      var c = cmp(x, cur);
      if (up && c > 0 && (r === null || cmp(x, r) < 0)) r = x;
      if (!up && c < 0 && (r === null || cmp(x, r) > 0)) r = x;
    });
    return r;
  }
  /** manual_rules.step_stop: closer — к цене (лонг: вверх). */
  function stepStop(d, cur, levels, ref, closer, tick, buf) {
    var lvNow = add(cur, muli(muli(tick, buf), d));
    var side = sideLevels(levels, ref, d === 1);
    var nxt = stepLevel(side, lvNow, closer === (d === 1));
    if (nxt === null) return null;
    var s = roundStop(nxt, d, tick, buf);
    return cmp(muli(sub(ref, s), d), ZERO) > 0 ? s : null;
  }
  /** manual_rules.step_target: closer — к цене (лонг: вниз). */
  function stepTarget(d, cur, levels, ref, closer, tick, buf) {
    var lvNow = add(cur, muli(muli(tick, buf), d));
    var side = sideLevels(levels, ref, d !== 1);
    var nxt = stepLevel(side, lvNow, closer !== (d === 1));
    if (nxt === null) return null;
    var tt = roundTarget(nxt, d, tick, buf);
    return cmp(muli(sub(tt, ref), d), ZERO) > 0 ? tt : null;
  }
  /** manual_rules.step_entry: уровни M5 со стороны заявки, не за рынок; closer — к рынку. */
  function stepEntry(d, cur, levels, bid, ask, closer, tick) {
    var edge = d === 1 ? bid : ask;
    var side = sideLevels(levels, edge, d === 1);
    var nxt = stepLevel(side, cur, closer === (d === 1));
    if (nxt === null) return null;
    return priceForDirection(nxt, tick, d);
  }
  /** Стрелка стопа без стопа (ManualDesk._btn_arrow): ближайший уровень со стороны стопа ∓ буфер. */
  function stopFirst(d, levels, ref, tick, buf) {
    var side = sideLevels(levels, ref, d === 1);
    if (!side.length) return null;
    var lv = side.reduce(function (m, x) { return d === 1 ? qmax(m, x) : qmin(m, x); });
    return roundStop(lv, d, tick, buf);
  }
  /** Стрелка цели без цели (_btn_arrow, «Поставить цель» панели): ближайший уровень со стороны цели. */
  function targetFirst(d, levels, ref, tick, buf) {
    var side = sideLevels(levels, ref, d !== 1);
    if (!side.length) return null;
    var lv = side.reduce(function (m, x) { return d === 1 ? qmin(m, x) : qmax(m, x); });
    return roundTarget(lv, d, tick, buf);
  }
  /** Цена лимитки по умолчанию (как кнопки «Лонг 181.57» ManualDesk._limit_ask): ближайший уровень M5 ниже
   *  bid (шорт — выше ask), на шаг по стороне; уровня нет — bid − 10 шагов (ask + 10). Не больше 0 — null. */
  function defaultEntry(d, m5Levels, bid, ask, tick) {
    var side = d === 1 ? m5Levels.filter(function (x) { return cmp(x, bid) < 0; })
      : m5Levels.filter(function (x) { return cmp(x, ask) > 0; });
    var v;
    if (side.length) {
      v = side.reduce(function (m, x) { return d === 1 ? qmax(m, x) : qmin(m, x); });
    } else {
      v = d === 1 ? sub(bid, muli(tick, 10)) : add(ask, muli(tick, 10));
    }
    var px = priceForDirection(v, tick, d);
    return cmp(px, ZERO) > 0 ? px : null;
  }
  /** Линия пальцем — тем же правилом, что ввод цены в чате (ManualDesk._ask_move, _ask_move_entry). */
  function dragStop(v, d, tick) { return roundStop(v, d, tick, 0); }
  function dragTarget(v, d, tick) { return roundTarget(v, d, tick, 0); }
  function dragEntry(v, d, tick) { return priceForDirection(v, tick, d); }

  // ------------------------------------------------------------------ 19.2: вход при пробое (SPEC_C3 §4.1–§4.2)
  /** manual_rules.breakout_level: уровень на шаге цены в сторону пробоя (лонг — вверх, шорт — вниз). */
  function breakoutLevel(px, d, tick) { return roundStep(px, tick, d === 1 ? 'ceil' : 'floor'); }
  /** manual_rules.breakout_gap: null — годится; 'side' — не с той стороны цены; 'near' — ближе gap шагов (вход по
   *  рынку). */
  function breakoutGap(d, level, last, tick, gap) {
    var dist = muli(sub(level, last), d);
    if (cmp(dist, ZERO) <= 0) return 'side';
    if (cmp(dist, muli(tick, gap)) < 0) return 'near';
    return null;
  }
  function uniqQ(list) {
    var out = [];
    list.forEach(function (v) { if (!out.some(function (u) { return eq(u, v); })) out.push(v); });
    return out;
  }
  /** manual_rules.breakout_levels: n ближайших уровней за ценой (по расстоянию со знаком) не ближе gap шагов. */
  function breakoutLevels(d, levels, last, tick, gap, n) {
    var cands = uniqQ(levels);
    cands.sort(function (a, b) { return cmp(muli(sub(a, last), d), muli(sub(b, last), d)); });
    var out = [];
    for (var i = 0; i < cands.length && out.length < n; i++) {
      var lv = breakoutLevel(cands[i], d, tick);
      if (breakoutGap(d, lv, last, tick, gap) === null && !out.some(function (u) { return eq(u, lv); })) out.push(lv);
    }
    return out;
  }
  /** manual_rules.step_breakout: уровень «ближе» (к цене) / «дальше» — уровни M5 за ценой не ближе gap шагов. */
  function stepBreakout(d, cur, levels, last, closer, tick, gap) {
    var side = [];
    levels.forEach(function (x) {
      var lv = breakoutLevel(x, d, tick);
      if (breakoutGap(d, lv, last, tick, gap) === null) side.push(lv);
    });
    return stepLevel(side, cur, closer !== (d === 1));
  }
  /** Уровень пробоя по умолчанию (страница 19.2; как первая кнопка ожидания «Пробой» C3c1 §4.1): ближайшая вершина
   *  M5 выше цены (шорт — впадина ниже) не ближе gap шагов; нет — цена ± max(10, gap) шагов, на шаг в сторону
   *  пробоя. */
  function defaultBreakout(d, m5, last, tick, gap) {
    var lv = m5 ? (d === 1 ? m5.highs : m5.lows).map(function (x) { return x.px; }) : [];
    var c = breakoutLevels(d, lv, last, tick, gap, 1);
    if (c.length) return c[0];
    return breakoutLevel(add(last, muli(muli(tick, Math.max(10, gap)), d)), d, tick);
  }
  function dragBreakout(v, d, tick) { return breakoutLevel(v, d, tick); }

  // ------------------------------------------------------------------ §12.3 план и проверки (режим n)
  /** manual_rules.confirm_plan со стопом ценой (страница держит цену) или без стопа. o: {bid, ask, tick, fin,
   *  fout, ftp, S|null, tpMode: fixed|r2|r3|none, T, E, risk, qs, mq, mn, maxQ, cap, tol, sm, sf}. 19.2: et
   *  'breakout' — E — уровень пробоя, цена расчёта — предел цены от уровня (тейкер на входе, как по рынку). */
  function confirmPlan(d, et, o) {
    var limit = et === 'limit', bk = et === 'breakout';
    var tick = o.tick;
    var ref = refPrice(d, o.bid, o.ask);
    var stop = has(o.S) ? o.S : null;
    var base = bk ? o.E : ref;
    var price = limit ? o.E : priceLimit(d, base, stop !== null ? stop : base, tick, o.sm, o.sf);
    var size = null;
    if (stop !== null && cmp(muli(sub(price, stop), d), ZERO) > 0) {
      size = planSize(d, price, stop, { fin: o.fin, fout: o.fout, risk: o.risk, qs: o.qs, mq: o.mq, mn: o.mn,
        maxQ: o.maxQ, cap: o.cap, tol: o.tol });
    }
    var target = null, tsrc = 'none';
    if ((o.tpMode === 'r2' || o.tpMode === 'r3') && size && size.ok) {
      target = targetForR(o.tpMode === 'r2' ? 2 : 3, d, price, size.u, o.fin, o.ftp, tick);
      tsrc = o.tpMode;
    } else if (o.tpMode === 'fixed' && has(o.T)) {
      target = o.T;
      tsrc = 'fixed';
    }
    var rT = null, fees = null, share = null;
    if (size && size.ok) {
      fees = mul(size.qty, add(mul(price, o.fin), mul(stop, o.fout)));
      share = feeShare(price, stop, o.fin, o.fout, size.u);
      if (target !== null && cmp(muli(sub(target, price), d), ZERO) > 0) {
        rT = rAt(d, target, price, size.qty, o.fin, o.ftp, size.riskPlan);
      }
    }
    return { d: d, limit: limit, breakout: bk, trigger: bk ? o.E : null, bid: o.bid, ask: o.ask, ref: ref,
      spread: qmax(ZERO, sub(o.ask, o.bid)), price: price, stop: stop, target: target, tpSrc: tsrc, size: size,
      rTarget: rT, fees: fees, share: share, fin: o.fin, fout: o.fout, ftp: o.ftp };
  }
  function okSize(pl) { return !!(pl.size && pl.size.ok); }
  /** manual_rules.numeric_checks: {refuse: [код, числа] | null, warns: [[код, числа]]}. th: {tick, ns, np, fr, fw,
   *  xr, xw, wp, wf, cw}; base — B_now. Границы: доля комиссий ровно fr — можно; стоп ровно xr % — можно. */
  function numericChecks(pl, th, base) {
    var t = th.tick, warns = [];
    function no(code, nums) { return { refuse: [code, nums], warns: [] }; }
    if (pl.stop === null) return no('no_stop', {});
    var d = pl.d;
    var edge = d === 1 ? pl.bid : pl.ask;
    if (pl.limit) {
      if (cmp(muli(sub(pl.price, pl.stop), d), ZERO) <= 0) return no('stop_side', { at: toApiStr(pl.price), limit: true });
    } else if (pl.breakout) {        // 19.2 (C3c1 §4.2): от уровня и предела, не от текущей цены
      if (cmp(muli(sub(pl.trigger, pl.stop), d), ZERO) <= 0 || cmp(muli(sub(pl.price, pl.stop), d), ZERO) <= 0) {
        return no('stop_side', { at: toApiStr(pl.trigger), limit: false, bk: true });
      }
    } else if (cmp(muli(sub(edge, pl.stop), d), ZERO) <= 0 || cmp(muli(sub(pl.price, pl.stop), d), ZERO) <= 0) {
      return no('stop_side', { at: toApiStr(edge), limit: false });
    }
    var dist = qabs(sub(pl.price, pl.stop));
    var minDist = qmax(muli(t, th.ns), muli(pl.spread, th.np));
    if (cmp(dist, minDist) < 0) {
      return no('stop_close', { kind: 'dist', n: Number(floorQ(div(dist, t))), need: Number(roundHalfEvenQ(div(minDist, t))) });
    }
    if (okSize(pl) && pl.share !== null && cmp(pl.share, th.fr) > 0) {
      return no('stop_close', { kind: 'fee', pct: Number(floorQ(mul(pl.share, HUNDRED))) });
    }
    var farBase = pl.limit || pl.breakout ? pl.price : pl.ref;
    var farPct = cmp(farBase, ZERO) > 0 ? mul(div(qabs(sub(farBase, pl.stop)), farBase), HUNDRED)
      : mul(div(dist, pl.price), HUNDRED);
    if (cmp(farPct, th.xr) > 0) return no('stop_far', { pct: q10(farPct), lim: toApiStr(th.xr) });
    if (pl.target !== null) {
      // цель не выше нуля (2R/3R шорта при крупном шаге цены) — отказ, как manual_rules.numeric_checks 2.1
      if (cmp(pl.target, ZERO) <= 0) return no('tp_side', { zero: true, src: pl.tpSrc });
      if (cmp(muli(sub(pl.target, pl.price), d), t) < 0 || cmp(muli(sub(pl.target, pl.ref), d), t) < 0) {
        var refEdge = d === 1 ? qmax(pl.price, pl.ref) : qmin(pl.price, pl.ref);
        return no('tp_side', { at: toApiStr(refEdge) });
      }
    }
    if (!okSize(pl)) {
      return no('min_lot', { size: pl.size ? pl.size.code : null,
        risk_need: pl.size && pl.size.riskNeed ? toApiStr(pl.size.riskNeed) : null });
    }
    var sz = pl.size;
    if (pl.share !== null && cmp(pl.share, th.fw) > 0) {
      var r = cmp(sz.riskPlan, ZERO) > 0 ? div(pl.fees, sz.riskPlan) : ZERO;
      warns.push(['fee_share', { pct: Number(floorQ(mul(pl.share, HUNDRED))), r: q10(r) }]);
    }
    if (cmp(farPct, th.xw) > 0) warns.push(['stop_far_warn', { pct: q10(farPct) }]);
    var spPct = cmp(pl.ref, ZERO) > 0 ? mul(div(pl.spread, pl.ref), HUNDRED) : ZERO;
    if (cmp(spPct, th.wp) > 0 || cmp(pl.spread, mul(th.wf, dist)) > 0) warns.push(['spread', { pct: q10(spPct) }]);
    if (cmp(base, ZERO) > 0 && cmp(sz.notional, mul(th.cw, base)) > 0) {
      warns.push(['notional', { bases: q10(div(sz.notional, base)), whole: pyRoundInt(sz.notional) }]);
    }
    return { refuse: null, warns: warns };
  }

  // ------------------------------------------------------------------ риск (как 18.4, SPEC_C2 §2.4)
  var RISK_QUICK_PCT = ['0.5', '1', '2'];        // common.RISK_QUICK_PCT
  var RX_RC = /^[0-9]{1,2}(\.[0-9]{1,2})?,[0-9]{1,2}(\.[0-9]{1,2})?$/;
  var RX_RQ = /^[0-9]{1,9}(\.[0-9]{1,2})?$/;      // rq данных и сумма в поле страницы
  /** miniapp_rules.risk_from_pct: % базы → USDT, вниз до 0.01. */
  function riskFromPct(pct, base) { return roundStep(div(mul(dec(pct), dec(base)), HUNDRED), CENT, 'floor'); }
  function riskFloor(usdt) { return roundStep(dec(usdt), CENT, 'floor'); }
  function riskPctExact(usdt, base) { return div(mul(dec(usdt), HUNDRED), dec(base)); }
  /** TradeRisk.from_usdt(…).in_limits: сумма > 0 и min ≤ usdt × 100 / база ≤ max. */
  function riskInLimits(usdt, base, rc) {
    var u = dec(usdt), b = dec(base);
    if (cmp(u, ZERO) <= 0) return false;
    var x = mul(u, HUNDRED);
    return cmp(mul(dec(rc[0]), b), x) <= 0 && cmp(x, mul(dec(rc[1]), b)) <= 0;
  }
  function riskLimitsUsdt(base, rc) {
    var b = dec(base);
    return [roundStep(div(mul(dec(rc[0]), b), HUNDRED), CENT, 'ceil'),
      roundStep(div(mul(dec(rc[1]), b), HUNDRED), CENT, 'floor')];
  }
  function riskQuick(base, rc) {
    return RISK_QUICK_PCT.filter(function (x) { return riskInLimits(riskFromPct(x, base), base, rc); });
  }
  /** trade_risk.pct_text: не больше двух знаков (к чётному), без лишних нулей. */
  function riskPctLabel(pct) {
    var t = toFixedHE(dec(pct), 2);
    return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
  }
  /** Сумма из поля: цифры и точка (запятая = точка), до 2 знаков; иначе null. */
  function parseRiskInput(text) {
    var t = String(text === null || text === undefined ? '' : text).trim().replace(',', '.');
    return RX_RQ.test(t) ? dec(t) : null;
  }
  /** Выбранный риск: null/undefined — риск по умолчанию rk (до 0.01 вниз); строка по образцу rq — она;
   *  иначе null («Сумма риска — цифры и точка…»). */
  function riskOf(p, risk) {
    if (risk === null || risk === undefined) return riskFloor(p.rk);
    if (isQ(risk)) return riskFloor(risk);
    if (typeof risk === 'string' && RX_RQ.test(risk)) return dec(risk);
    return null;
  }

  // ------------------------------------------------------------------ режим n: всё, что показывает страница
  function instN(p, limit) {
    return { tick: dec(p.tk), qs: dec(p.qs), mq: dec(p.mq), mn: dec(p.mn), maxQ: decOrNull(limit ? p.xl : p.xm),
      fin: dec(limit ? p.fm : p.ft), fout: dec(p.ft), ftp: dec(p.fm), cap: dec(p.cap), tol: dec(p.tol),
      sm: p.sm, sf: dec(p.sf) };
  }
  function ruleN(p) {
    return { sb: p.sb, ns: p.ns, np: p.np, fw: dec(p.fw), xr: dec(p.xr), sm: p.sm, sf: dec(p.sf) };
  }
  function thresholds(p) {
    return { tick: dec(p.tk), ns: p.ns, np: p.np, fr: dec(p.fr), fw: dec(p.fw), xr: dec(p.xr), xw: dec(p.xw),
      wp: dec(p.wp), wf: dec(p.wf), cw: has(p.cw) ? dec(p.cw) : ZERO };
  }
  /** Сериализация плана (общая с генератором примеров). */
  function planOut(pl) {
    if (!pl) return null;
    var sz = pl.size;
    return { price: toApiStr(pl.price), ref: toApiStr(pl.ref), spread: toApiStr(pl.spread), stop: toApiStr(pl.stop),
      target: toApiStr(pl.target), tp_src: pl.tpSrc, trigger: toApiStr(pl.trigger),
      size: sz ? { ok: sz.ok, code: sz.code, qty: toApiStr(sz.qty), u: toApiStr(sz.u), risk_plan: toApiStr(sz.riskPlan),
        notional: toApiStr(sz.notional), bumped: sz.bumped, capped: sz.capped, risk_need: toApiStr(sz.riskNeed) } : null,
      r_target: q10(pl.rTarget), fees: toApiStr(pl.fees), share: q10(pl.share) };
  }
  /** Строки под расчётом: крупный риск, остаток дня и ручные по данным кнопки, свежесть данных, фандинг. */
  function extrasN(p, st, pl) {
    var out = { big: false, room: null, manual: null, stale: has(st.tms) ? (st.tms - p.a > STALE_MS) : true, funding: null };
    if (!okSize(pl)) return out;
    var sz = pl.size, rb = dec(p.rb), rp = sz.riskPlan;
    out.big = sz.bumped || cmp(mul(rp, HUNDRED), mul(dec(p.ra), rb)) > 0;
    if (has(p.dr)) {
      var dr = dec(p.dr);
      out.room = { left: toApiStr(dr), after: toApiStr(sub(dr, rp)), short: cmp(rp, dr) > 0 };
    }
    var mo = dec(p.mo), after = add(mo, rp);
    out.manual = { after: toApiStr(after), short: cmp(after, dec(p.mx)) > 0, n_after: p.no + 1, full: p.no >= p.nx };
    if (!pl.limit && !pl.breakout && has(st.fr) && has(st.fn) && has(st.tms) && st.fn > st.tms) {
      var rate = dec(st.fr);
      if (cmp(rate, ZERO) !== 0) {
        var amount = mul(sz.notional, qabs(rate));
        out.funding = { amount: toApiStr(amount), pays: pl.d === 1 ? cmp(rate, ZERO) > 0 : cmp(rate, ZERO) < 0,
          r: q10(cmp(rp, ZERO) > 0 ? div(amount, rp) : ZERO), due_s: Math.round((st.fn - st.tms) / 1000) };
      }
    }
    return out;
  }
  /** Расчёт режима n. st: {d, et: m|l|b, E, S, T, tp: fixed|r2|r3|none, risk: null|строка, bid, ask, last, tms, fr,
   *  fn} (цены — дроби или строки; E — цена лимитки или уровень пробоя; last — последняя цена, по ней срабатывает
   *  пробой; нет — опорная). → {refusal: [код, числа] | null, warns, plan, planOut, risk, extra}. Отказ — первый
   *  по порядку бота (ManualDesk._checks): вид входа, цена лимитки, уровень пробоя, пределы риска, числовые §13;
   *  страничные: et_off, no_price, risk_input, no_entry. */
  function calcN(p, st) {
    var out = { refusal: null, warns: [], plan: null, risk: null, extra: null };
    var d = st.d, limit = st.et === 'l', bk = st.et === 'b';
    if (p.em.indexOf(st.et) < 0 || (st.et !== 'm' && st.et !== 'l' && st.et !== 'b')) {
      out.refusal = ['et_off', {}];
      return out;
    }
    var bid = decOrNull(st.bid), ask = decOrNull(st.ask);
    if (bid === null || ask === null) { out.refusal = ['no_price', {}]; return out; }
    var risk = riskOf(p, st.risk);
    if (risk === null) { out.refusal = ['risk_input', {}]; return out; }
    out.risk = risk;
    var E = limit || bk ? decOrNull(st.E) : null;
    if ((limit || bk) && E === null) { out.refusal = ['no_entry', {}]; return out; }
    var ins = instN(p, limit);
    var pl = confirmPlan(d, limit ? 'limit' : (bk ? 'breakout' : 'market'), { bid: bid, ask: ask, tick: ins.tick,
      fin: ins.fin, fout: ins.fout, ftp: ins.ftp, S: decOrNull(st.S), tpMode: st.tp || 'none', T: decOrNull(st.T),
      E: E, risk: risk, qs: ins.qs, mq: ins.mq, mn: ins.mn, maxQ: ins.maxQ, cap: ins.cap, tol: ins.tol, sm: ins.sm,
      sf: ins.sf });
    out.plan = pl;
    var found = [];
    if (limit) {
      var edge = d === 1 ? bid : ask;
      if (cmp(muli(sub(edge, E), d), ZERO) <= 0) {
        found.push(['entry_side', { at: toApiStr(edge), beyond: d === 1 ? cmp(E, ask) > 0 : cmp(E, bid) < 0 }]);
      }
    }
    if (bk) {                         // 19.2 (C3c1 §4.2): уровень за последней ценой не ближе bg шагов
      var last = decOrNull(st.last);
      if (last === null || cmp(last, ZERO) === 0) last = refPrice(d, bid, ask);   // как «lastPrice or ref» бота
      var gap = breakoutGap(d, E, last, ins.tick, p.bg);
      if (gap) found.push(['level', { gap: gap, at: toApiStr(last) }]);
    }
    if (!riskInLimits(risk, p.rb, p.rc)) {
      found.push(['risk_limits', { usdt: toApiStr(risk), pct: q10(riskPctExact(risk, p.rb)), lo: p.rc[0], hi: p.rc[1] }]);
    }
    var nc = numericChecks(pl, thresholds(p), dec(p.rb));
    if (nc.refuse) found.push(nc.refuse);
    out.refusal = found.length ? found[0] : null;
    out.warns = nc.warns;
    out.extra = extrasN(p, st, pl);
    return out;
  }
  /** Сериализация расчёта n (общая с генератором). */
  function calcNOut(c) {
    return { refusal: c.refusal, warns: c.warns, plan: planOut(c.plan), risk: toApiStr(c.risk), extra: c.extra };
  }

  // ------------------------------------------------------------------ режим q: стоп и цель позиции (Ч2)
  /** Проверки «Перенести» (ManualDesk._apply_tpsl_move → _tpsl_checks): стоп с той стороны от bid (лонг) /
   *  ask (шорт), не ближе max(ns шагов, np спредов), не дальше xr %; цель за ценой не ближе шага; 19.2 — при двух
   *  целях (t2) цель 1 ближе цели 2 хотя бы на шаг. → null | [код, числа]. Проверяются только изменённые значения. */
  function tpslChecks(d, stopOld, stopNew, tpOld, tpNew, bid, ask, tick, ns, np, xr, t2) {
    var edge = d === 1 ? bid : ask;
    var spread = qmax(ZERO, sub(ask, bid));
    if (!eq(stopNew, stopOld)) {
      var dist = muli(sub(edge, stopNew), d);
      var minDist = qmax(muli(tick, ns), muli(spread, np));
      if (cmp(dist, ZERO) <= 0) return ['stop_side', { at: toApiStr(edge) }];
      if (cmp(dist, minDist) < 0) return ['stop_close', {}];
      if (cmp(mul(div(dist, edge), HUNDRED), xr) > 0) return ['stop_far', { lim: toApiStr(xr) }];
    }
    if (has(tpNew) && !sameQ(tpNew, tpOld)) {
      var far = d === 1 ? ask : bid;
      if (cmp(muli(sub(tpNew, far), d), tick) < 0) return ['tp_side', { at: toApiStr(far) }];
      if (has(t2) && !target2Ok(d, tpNew, t2, tick)) return ['t1_beyond', { t2: toApiStr(t2) }];
    }
    return null;
  }
  /** Расчёт режима q (открытая и частично исполненная). st: {S, T|null, bid, ask}. Ждущая (w, Ч3) — calcW (19.3; до
   *  19.3 — {unsupported: true}). */
  function calcQ(p, st) {
    if (p.st === 'w') return calcW(p, st);
    var d = p.d, tick = dec(p.tk);
    var pq = dec(p.pq), pa = dec(p.pa), fi = dec(p.fi), fo = dec(p.fo), fp = dec(p.fp), rp = dec(p.rp);
    var sl = dec(p.sl), tpOld = decOrNull(p.tp);
    var S = dec(st.S), T = decOrNull(st.T);
    var stopCh = !eq(S, sl), tpCh = !sameQ(T, tpOld);
    var riskOld = openRisk(d, pq, pa, sl, fi, fo), riskNew = openRisk(d, pq, pa, S, fi, fo);
    var check;
    if (!onStep(S, tick) || (T !== null && !onStep(T, tick))) check = ['tick', {}];
    else if (!stopCh && !tpCh) check = ['no_change', {}];
    else if (!has(st.bid) || !has(st.ask)) check = ['no_price', {}];
    else check = tpslChecks(d, sl, S, tpOld, T, dec(st.bid), dec(st.ask), tick, p.ns, p.np, dec(p.xr),
      decOrNull(p.t2));
    var grows = cmp(riskNew, riskOld) > 0;
    return { unsupported: false, stop_changed: stopCh, tp_changed: tpCh, check: check,
      risk_old: toApiStr(riskOld), risk_new: toApiStr(riskNew), grows: grows,
      grow_by: toApiStr(grows ? sub(riskNew, riskOld) : ZERO),
      r_tp: T !== null ? q10(rAt(d, T, pa, pq, fi, fp, rp)) : null,
      r_tp_old: tpOld !== null ? q10(rAt(d, tpOld, pa, pq, fi, fp, rp)) : null,
      be: toApiStr(bePrice(d, pa, fi, fo, tick)) };
  }

  // ------------------------------------------------------------------ 19.3: ждущая лимитка (Ч3, SPEC_C2 §4.2, §12.4, §17.2)
  /** Расчёт ждущей ручной лимитки (адрес q, st = w): новые цена заявки E, стоп S и цель T на тот же риск сделки (rt).
   *  План — confirmPlan лимитки: объём plan_size(E, S; вход мейкер fp, выход по стопу fo, risk_target rt, max_qty xl,
   *  предел номинала cap, допуск tol) — правило «Сдвинуть» бота (_entry_size) от новых цены и стопа; R цели — от E
   *  (цель мейкер fp). Риск ожидания до — working_risk(ql, ep, sl; fp, fo), после — риск плана нового объёма; рост
   *  больше 0.01 USDT — grows (бот проверит остаток дня, паузу и предел ручных; страница не отказывает).
   *  Проверки — по порядку «Сдвинуть» бота (_apply_entry_move, _entry_move_checks): шаг цены (tick); цель у ждущей
   *  только двигается — снять или поставить нельзя (tp_keep); ничего не сдвинуто (no_change); нет цены (no_price);
   *  цена за рынком — PostOnly не встанет (entry_side); стоп не дальше цены (stop_side); объём не сложился (min_lot);
   *  подъём до лота — риск стал бы больше выбранного (bumped); числовые §13 (numericChecks: stop_close, stop_far,
   *  tp_side; предупреждения — без номинала: порога cw в адресе q нет). Маржу и ликвидацию проверяет только бот.
   *  st: {E (нет — прежняя ep), S, T (null — без цели), bid, ask}. → {check: null | [код, числа], e_changed,
   *  s_changed, t_changed, plan (planOut | null — нет цены), warns, risk_old, risk_new (null — объём не сложился),
   *  grows, grow_by}. */
  function calcW(p, st) {
    var out = { check: null, e_changed: false, s_changed: false, t_changed: false, plan: null, warns: [],
      risk_old: null, risk_new: null, grows: false, grow_by: '0' };
    if (!p || p.m !== 'q' || p.st !== 'w') { out.check = ['w_off', {}]; return out; }
    var d = p.d, tick = dec(p.tk), fp = dec(p.fp), fo = dec(p.fo);
    var ep = dec(p.ep), ql = dec(p.ql), sl = dec(p.sl), tpOld = decOrNull(p.tp);
    var E = has(st.E) ? dec(st.E) : ep, S = dec(st.S), T = decOrNull(st.T);
    out.e_changed = !eq(E, ep);
    out.s_changed = !eq(S, sl);
    out.t_changed = !sameQ(T, tpOld);
    var rOld = workingRisk(d, ql, ep, sl, fp, fo);
    out.risk_old = toApiStr(rOld);
    var bid = decOrNull(st.bid), ask = decOrNull(st.ask), pl = null;
    if (bid !== null && ask !== null) {
      pl = confirmPlan(d, 'limit', { bid: bid, ask: ask, tick: tick, fin: fp, fout: fo, ftp: fp, S: S,
        tpMode: T !== null ? 'fixed' : 'none', T: T, E: E, risk: dec(p.rt), qs: dec(p.qs), mq: dec(p.mq),
        mn: dec(p.mn), maxQ: decOrNull(p.xl), cap: dec(p.cap), tol: dec(p.tol), sm: 0, sf: ZERO });
      out.plan = planOut(pl);
    }
    var found = null;
    if (!onStep(E, tick) || !onStep(S, tick) || (T !== null && !onStep(T, tick))) found = ['tick', {}];
    else if ((T === null) !== (tpOld === null)) found = ['tp_keep', { had: tpOld !== null }];
    else if (!out.e_changed && !out.s_changed && !out.t_changed) found = ['no_change', {}];
    else if (pl === null) found = ['no_price', {}];
    else {
      var edge = d === 1 ? bid : ask;
      if (cmp(muli(sub(edge, E), d), ZERO) <= 0) {
        found = ['entry_side', { at: toApiStr(edge), beyond: d === 1 ? cmp(E, ask) > 0 : cmp(E, bid) < 0 }];
      } else if (cmp(muli(sub(E, S), d), ZERO) <= 0) {
        found = ['stop_side', { at: toApiStr(E), limit: true }];
      } else if (!okSize(pl)) {
        found = ['min_lot', { size: pl.size ? pl.size.code : null,
          risk_need: pl.size && pl.size.riskNeed ? toApiStr(pl.size.riskNeed) : null }];
      } else if (pl.size.bumped) {
        found = ['bumped', { risk: toApiStr(pl.size.riskPlan) }];
      } else {
        var nc = numericChecks(pl, thresholds(p), ZERO);
        found = nc.refuse;
        out.warns = nc.warns;
      }
    }
    if (pl !== null && okSize(pl)) {
      var rNew = pl.size.riskPlan;
      out.risk_new = toApiStr(rNew);
      out.grows = cmp(sub(rNew, rOld), CENT) > 0;
      out.grow_by = toApiStr(out.grows ? sub(rNew, rOld) : ZERO);
    }
    out.check = found;
    return out;
  }

  // ------------------------------------------------------------------ 19.2: вторая цель (SPEC_C3 §3.2, §3.4)
  /** manual_rules.split_target2: q2 = pct % позиции вниз до шага объёма, q1 — остаток; обе ≥ лота и шага;
   *  нельзя — null. */
  function splitTarget2(pos, pct, step, minQty) {
    var q2 = roundStep(div(mul(pos, intQ(pct)), HUNDRED), step, 'floor');
    var q1 = sub(pos, q2);
    var lot = qmax(minQty, step);
    if (cmp(q2, lot) < 0 || cmp(q1, lot) < 0) return null;
    return [q1, q2];
  }
  /** manual_rules.target2_ok: цель 2 дальше цели 1 хотя бы на шаг цены. */
  function target2Ok(d, t1, t2, tick) { return cmp(muli(sub(t2, t1), d), tick) >= 0; }
  var T2_MIN_GAP_R = Q(1n, 2n);
  /** manual_rules.target2_default: следующая вершина волны за целью 1 (шорт — впадина; M5, затем H1) не ближе 0.5 R
   *  от цели 1; нет — цель 1 + 1 R (на шаг цены к входу). → {px, src: swing_m5|swing_h1|r1, level}. */
  function target2Default(d, t1, r, tick, m5, h1, tb) {
    var need = qmax(mul(T2_MIN_GAP_R, r), tick);
    var kind = d === 1 ? 'highs' : 'lows';
    var tfs = [[m5, 'swing_m5'], [h1, 'swing_h1']];
    for (var i = 0; i < tfs.length; i++) {
      var sw = tfs[i][0];
      if (!sw) continue;
      var cands = sw[kind].filter(function (x) { return cmp(muli(sub(x.px, t1), d), ZERO) > 0; });
      cands.sort(byDistThenNewer(function (x) { return muli(sub(x.px, t1), d); }));
      for (var j = 0; j < cands.length; j++) {
        var tt = roundTarget(cands[j].px, d, tick, tb);
        if (cmp(muli(sub(tt, t1), d), need) < 0) continue;
        return { px: tt, src: tfs[i][1], level: cands[j] };
      }
    }
    return { px: roundTarget(add(t1, muli(r, d)), d, tick, 0), src: 'r1', level: null };
  }
  /** Цель 2 со страницы — проверки бота (ManualDesk.page_t2 = кнопки «Вторая цель» / «Цель 2 ▲▼», «Поставить» /
   *  «Перенести» чата). st: {T2, pct, bid, ask}. → {check: null | [код, числа], mode: new|edit, q1, q2, r1, r2,
   *  r_all, r2_old}. Коды: t2_off (адрес: цель 2 со страницы нельзя), tick, t2_pct, no_change, t2_small, no_price,
   *  t2_side (не дальше цели 1), tp_side (за рынком не на шаг). */
  function calcT2(p, st) {
    var out = { check: null, mode: has(p.t2) ? 'edit' : 'new', q1: null, q2: null, r1: null, r2: null, r_all: null,
      r2_old: null };
    if (p.m !== 'q' || p.st !== 'o' || !has(p.w2) || !has(p.tp)) { out.check = ['t2_off', {}]; return out; }
    var d = p.d, tick = dec(p.tk), qs = dec(p.qs), mq = dec(p.mq);
    var pq = dec(p.pq), pa = dec(p.pa), fi = dec(p.fi), fp = dec(p.fp), rp = dec(p.rp), t1 = dec(p.tp);
    var T2 = dec(st.T2), pct = st.pct;
    var edit = out.mode === 'edit';
    var r = function (t, q) { return q10(rAt(d, t, pa, q, fi, fp, rp)); };
    if (edit) {
      out.q1 = toApiStr(dec(p.q1));
      out.q2 = toApiStr(dec(p.q2));
      out.r2_old = r(dec(p.t2), dec(p.q2));
    } else {
      var sp = splitTarget2(pq, typeof pct === 'number' ? pct : 0, qs, mq);
      if (sp) { out.q1 = toApiStr(sp[0]); out.q2 = toApiStr(sp[1]); }
    }
    if (out.q1 !== null) {
      out.r1 = r(t1, dec(out.q1));
      out.r2 = r(T2, dec(out.q2));
    }
    out.r_all = r(t1, pq);
    if (!onStep(T2, tick)) out.check = ['tick', {}];
    else if (edit && pct !== p.wd) out.check = ['t2_pct', {}];
    else if (edit && eq(T2, dec(p.t2))) out.check = ['no_change', {}];
    else if (!edit && p.w2.indexOf(pct) < 0) out.check = ['t2_pct', {}];
    else if (!edit && out.q1 === null) out.check = ['t2_small', { lot: toApiStr(qmax(mq, qs)) }];
    else if (!has(st.bid) || !has(st.ask)) out.check = ['no_price', {}];
    else if (!target2Ok(d, t1, T2, tick)) out.check = ['t2_side', { t1: toApiStr(t1) }];
    else {
      var far = d === 1 ? dec(st.ask) : dec(st.bid);
      if (cmp(muli(sub(T2, far), d), tick) < 0) out.check = ['tp_side', { at: toApiStr(far) }];
    }
    return out;
  }

  // ------------------------------------------------------------------ 19.2: трейлинг Bybit (SPEC_C3 §3.3, §3.4)
  /** manual_rules.trail_preset: кнопки R в ценах — расстояние dist_r × 1 R (к ближайшему шагу), цена включения
   *  средняя ± act_r × 1 R (0 — сразу, null). */
  function trailPreset(d, avg, r, actR, distR, tick) {
    var dist = roundStep(mul(dec(distR), r), tick, 'nearest');
    var a = dec(actR);
    return { dist: dist, active: cmp(a, ZERO) === 0 ? null : roundStep(add(avg, muli(mul(a, r), d)), tick, 'nearest') };
  }
  /** manual_rules.trail_check: расстояние не меньше minTicks шагов и двух спредов (иначе поднимается), не дальше
   *  farPct % цены; цена включения (null — сразу) за рынком хотя бы на 2 шага в сторону прибыли, иначе behind. */
  function trailCheck(d, dist, active, r, tick, bid, ask, last, minTicks, farPct) {
    var spread = qmax(ZERO, sub(ask, bid));
    var low = qmax(muli(tick, minTicks), muli(spread, 2));
    var raised = false;
    if (cmp(dist, low) < 0) { dist = roundStep(low, tick, 'ceil'); raised = true; }
    var res = function (ok, act, code, edge) {
      return { ok: ok, dist: dist, active: act, raised: raised, code: code || '', edge: edge || null };
    };
    if (cmp(dist, ZERO) <= 0 || cmp(r, ZERO) <= 0) return res(false, null, 'zero');
    if (cmp(last, ZERO) <= 0 || cmp(mul(div(dist, last), HUNDRED), farPct) > 0) return res(false, null, 'far');
    if (!has(active)) return res(true, null, '');
    var edge = d === 1 ? qmax(last, ask) : qmin(last, bid);
    if (cmp(muli(sub(active, edge), d), muli(tick, 2)) < 0) return res(false, active, 'behind', edge);
    return res(true, active, '', edge);
  }
  function trailOut(t) {
    return { ok: t.ok, dist: toApiStr(t.dist), active: toApiStr(t.active), raised: t.raised, code: t.code,
      edge: toApiStr(t.edge) };
  }
  /** Трейлинг со страницы — проверки бота (ManualDesk.page_trail = панель «Трейлинг» и «Включить» / «Заменить»
   *  чата). st: {dist, act (null — сразу), bid, ask, last}. → {check, plan, dist_r, act_r}. Коды: tr_off (адрес:
   *  трейлинг со страницы нельзя), tick, tr_now_off («Сразу» нет среди кнопок), no_change, no_price, tr_far, tr_behind,
   *  tr_zero. */
  function calcTrail(p, st) {
    var out = { check: null, plan: null, dist_r: null, act_r: null };
    if (p.m !== 'q' || (p.st !== 'o' && p.st !== 'p') || !has(p.ya)) { out.check = ['tr_off', {}]; return out; }
    var d = p.d, tick = dec(p.tk), r = dec(p.y1), avg = dec(p.pa);
    var dist = dec(st.dist), act = decOrNull(st.act);
    if (!onStep(dist, tick) || (act !== null && !onStep(act, tick))) { out.check = ['tick', {}]; return out; }
    if (act === null && p.ya.indexOf(0) < 0) { out.check = ['tr_now_off', {}]; return out; }
    if (has(p.yt) && eq(dist, dec(p.yt)) && sameQ(act, decOrNull(p.yp))) { out.check = ['no_change', {}]; return out; }
    if (!has(st.bid) || !has(st.ask)) { out.check = ['no_price', {}]; return out; }
    var bid = dec(st.bid), ask = dec(st.ask);
    var last = has(st.last) ? dec(st.last) : refPrice(d, bid, ask);
    var t = trailCheck(d, dist, act, r, tick, bid, ask, last, p.ym, dec(p.xr));
    out.plan = trailOut(t);
    out.dist_r = q10(div(t.dist, r));
    if (t.active !== null) out.act_r = q10(div(muli(sub(t.active, avg), d), r));
    if (!t.ok) {
      out.check = t.code === 'far' ? ['tr_far', { lim: toApiStr(dec(p.xr)) }]
        : (t.code === 'behind' ? ['tr_behind', { active: toApiStr(t.active), edge: toApiStr(t.edge) }]
          : ['tr_zero', {}]);
    }
    return out;
  }

  // ------------------------------------------------------------------ §9 адрес (версия 4)
  var RX_NUM = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;
  var RX_INT = /^(0|[1-9][0-9]{0,15})$/;
  var RX_POSINT = /^[1-9][0-9]{0,15}$/;
  var RX_HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  var RX_SYM = /^[A-Z0-9]{2,30}$/;
  var RX_VER = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;
  var RX_TAG = /^[0-9A-Za-z._-]{1,16}$/;
  /** Сравнение версий по числам: «19.1» > «19.0», «19.10» > «19.9»; не версия — null. */
  function cmpVersion(a, b) {
    if (!RX_VER.test(a) || !RX_VER.test(b)) return null;
    var x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var u = x[i] || 0, w = y[i] || 0;
      if (u !== w) return u < w ? -1 : 1;
    }
    return 0;
  }
  function isNewerVersion(pv) { var c = cmpVersion(String(pv), PAGE_VERSION); return c !== null && c > 0; }
  function bad() { return { err: 'bad' }; }

  /** Разбор адреса (строка запроса с «?» или без). → разобранные параметры или {err: 'bad'} («Ссылка
   *  повреждена») / {err: 'update'} («Страница обновляется»: pv новее версии страницы — в том числе при
   *  незнакомом режиме или ключах). Каждый ключ ровно один раз; лишний, неизвестный, недостающий — bad;
   *  ключи tgWebApp* пропускаются; числа — RX_NUM, целые ≤ 2^53 − 1. */
  function parseQuery(search) {
    var s = String(search === null || search === undefined ? '' : search);
    if (s.charAt(0) === '?') s = s.slice(1);
    var sp;
    try { sp = new URLSearchParams(s); } catch (e) { return bad(); }
    var got = Object.create(null), dup = false, pvs = [];
    sp.forEach(function (v, k) {
      if (k.indexOf('tgWebApp') === 0) return;
      if (k === 'pv') pvs.push(v);
      if (k in got) dup = true;
      got[k] = v;
    });
    if (pvs.length === 1 && isNewerVersion(pvs[0])) return { err: 'update' };
    if (dup) return bad();
    if (got.v !== URL_VERSION) return bad();
    var m = got.m;
    if (m !== 'n' && m !== 'q') return bad();
    if (KNOWN_PAGE_VERSIONS.indexOf(got.pv) < 0) return bad();
    var c3 = isC3Version(got.pv);          // 19.2: ключи пробоя (n), цели 2 и трейлинга (q); 19.0, 19.1 — прежние
    var keys = m === 'n' ? (c3 ? URL_N_KEYS : URL_N_KEYS_191) : (c3 ? URL_Q_KEYS : URL_Q_KEYS_191);
    var k;
    for (k in got) if (keys.indexOf(k) < 0) return bad();
    for (var i = 0; i < keys.length; i++) if (!(keys[i] in got)) return bad();
    function fail() { throw new Error('bad'); }
    /** Число по образцу; pos — > 0; dash — «-» → null; lt1 — меньше 1 (ставки комиссий). */
    function num(key, o) {
      var v = got[key];
      o = o || {};
      if (o.dash && v === '-') return null;
      if (!RX_NUM.test(v)) fail();
      var q = dec(v);
      if (o.pos && cmp(q, ZERO) <= 0) fail();
      if (o.lt1 && cmp(q, ONE) >= 0) fail();
      return v;
    }
    function intv(key, pos) {
      var v = got[key];
      if (!(pos ? RX_POSINT : RX_INT).test(v) || Number(v) > MAX_SAFE) fail();
      return Number(v);
    }
    function oneOf(key, list) { if (list.indexOf(got[key]) < 0) fail(); return got[key]; }
    /** Ключи группы — все «-» (true) или все не «-» (false); смесь — повреждено. */
    function dashAll(ks) {
      var n = ks.filter(function (x) { return got[x] === '-'; }).length;
      if (n && n !== ks.length) fail();
      return n === ks.length;
    }
    try {
      var out = { v: 4, pv: got.pv, m: m, k: intv('k', true) };
      if (!RX_SYM.test(got.s)) fail();
      out.s = got.s;
      out.d = Number(oneOf('d', ['1', '-1']));
      if (m === 'n') {
        out.em = oneOf('em', c3 ? EM_192 : EM_191);
        out.tk = num('tk', { pos: true }); out.qs = num('qs', { pos: true });
        out.mq = num('mq'); out.mn = num('mn');
        out.xm = num('xm', { pos: true, dash: true }); out.xl = num('xl', { pos: true, dash: true });
        out.fm = num('fm', { lt1: true }); out.ft = num('ft', { lt1: true });
        if (!RX_RQ.test(got.rk) || cmp(dec(got.rk), ZERO) <= 0) fail();
        out.rk = got.rk;
        out.rb = num('rb', { pos: true });
        if (!RX_RC.test(got.rc)) fail();
        var rc = got.rc.split(',');
        if (cmp(dec(rc[0]), ZERO) <= 0 || cmp(dec(rc[0]), dec(rc[1])) > 0) fail();
        out.rc = rc;
        out.ra = num('ra');
        out.cap = num('cap', { pos: true }); out.cw = num('cw'); out.tol = num('tol');
        out.sb = intv('sb'); out.sm = intv('sm'); out.sf = num('sf');
        out.ns = intv('ns'); out.np = intv('np');
        out.fr = num('fr'); out.fw = num('fw'); out.xr = num('xr'); out.xw = num('xw');
        out.wp = num('wp'); out.wf = num('wf');
        out.td = oneOf('td', ['swing', 'none', '2r', '3r']);
        out.tb = intv('tb'); out.t1 = num('t1');
        if (!RX_HHMM.test(got.ex) || !RX_HHMM.test(got.ea)) fail();
        out.ex = got.ex; out.ea = got.ea;
        out.dr = num('dr', { dash: true }); out.mo = num('mo'); out.mx = num('mx');
        out.no = intv('no'); out.nx = intv('nx');
        out.a = intv('a');
        out.bg = null;
        if (c3) {
          if (out.em.indexOf('b') >= 0) out.bg = intv('bg', true);
          else if (got.bg !== '-') fail();
        }
      } else {
        out.st = oneOf('st', ['o', 'p', 'w']);
        out.et = oneOf('et', c3 ? ['m', 'l', 'b'] : ['m', 'l']);
        out.tk = num('tk', { pos: true }); out.qs = num('qs', { pos: true });
        out.mq = num('mq'); out.mn = num('mn');
        out.xl = num('xl', { pos: true, dash: true });
        out.fi = num('fi', { lt1: true }); out.fo = num('fo', { lt1: true }); out.fp = num('fp', { lt1: true });
        out.rt = num('rt', { pos: true }); out.rp = num('rp', { pos: true }); out.rb = num('rb', { pos: true });
        out.cap = num('cap', { pos: true }); out.tol = num('tol');
        out.sb = intv('sb'); out.tb = intv('tb'); out.ns = intv('ns'); out.np = intv('np');
        out.xr = num('xr'); out.xw = num('xw'); out.fr = num('fr'); out.fw = num('fw');
        out.wp = num('wp'); out.wf = num('wf');
        out.ep = num('ep', { pos: true, dash: true }); out.ql = num('ql', { pos: true, dash: true });
        out.pq = num('pq'); out.pa = num('pa', { pos: true, dash: true });
        out.sl = num('sl', { pos: true }); out.tp = num('tp', { pos: true, dash: true });
        out.lk = intv('lk'); out.a = intv('a');
        var pqZero = cmp(dec(out.pq), ZERO) === 0;
        if (out.st === 'o') {
          if (out.ep !== null || out.ql !== null || pqZero || out.pa === null) fail();
        } else if (out.st === 'p') {
          if (out.ep === null || out.ql === null || pqZero || out.pa === null || out.et !== 'l') fail();
        } else if (out.ep === null || out.ql === null || !pqZero || out.pa !== null || out.et !== 'l') {
          fail();
        }
        C3_Q_KEYS.forEach(function (key) { out[key] = null; });
        if (c3) parseQC3(got, out, num, intv, dashAll, fail);
      }
      CH4_KEYS.forEach(function (key) { if (got[key] !== '-') fail(); out[key] = null; });
      return out;
    } catch (e) {
      return bad();
    }
  }
  var RX_W2 = /^[1-9][0-9](,[1-9][0-9]){0,2}$/;
  var RX_YA = /^[0-2](,[0-2]){0,2}$/;
  var RX_YD = /^[0-9](\.[0-9])?(,[0-9](\.[0-9])?){0,2}$/;
  /** Ключи адреса q 19.2 (manual_page._parse_q_c3): цель 2 сейчас (t2, q1, q2 — все «-» или все числа; только у
   *  открытой с целью), доли цели 2 (w2, wd), 1 R в цене (y1), трейлинг (ya, yb, yd, ye, ym — все «-» или все заданы),
   *  трейлинг сейчас (yt, yp; yp — только при yt). */
  function parseQC3(got, out, num, intv, dashAll, fail) {
    var st = out.st;
    out.y1 = num('y1', { pos: true });
    if (!dashAll(['t2', 'q1', 'q2'])) {
      out.t2 = num('t2', { pos: true }); out.q1 = num('q1', { pos: true }); out.q2 = num('q2', { pos: true });
      if (st !== 'o' || out.tp === null) fail();
    }
    if (!dashAll(['w2', 'wd'])) {
      if (!RX_W2.test(got.w2)) fail();
      var fr = got.w2.split(',').map(Number);
      if (uniqNum(fr) !== fr.length || !fr.every(function (x) { return x >= 10 && x <= 90; })) fail();
      var wd = intv('wd', true);
      if ((out.t2 === null && fr.indexOf(wd) < 0) || wd < 1 || wd > 99) fail();
      if (st !== 'o' || out.tp === null) fail();
      out.w2 = fr; out.wd = wd;
    }
    if (!dashAll(['ya', 'yb', 'yd', 'ye', 'ym'])) {
      if (!RX_YA.test(got.ya) || !RX_YD.test(got.yd)) fail();
      var ya = got.ya.split(',').map(Number), yd = got.yd.split(',');
      var ydq = yd.map(dec);
      if (uniqNum(ya) !== ya.length || uniqQ(ydq).length !== yd.length ||
          !ydq.every(function (x) { return cmp(x, Q(1n, 10n)) >= 0 && cmp(x, Q(5n)) <= 0; })) fail();
      var yb = intv('yb');
      if (ya.indexOf(yb) < 0) fail();
      var ye = num('ye', { pos: true });
      if (!ydq.some(function (x) { return eq(x, dec(ye)); })) fail();
      var ym = intv('ym', true);
      if (ym > 100 || (st !== 'o' && st !== 'p')) fail();
      out.ya = ya; out.yb = yb; out.yd = yd; out.ye = ye; out.ym = ym;
    }
    out.yt = num('yt', { pos: true, dash: true });
    out.yp = num('yp', { pos: true, dash: true });
    if (out.yp !== null && out.yt === null) fail();
    if (out.yt !== null && st !== 'o' && st !== 'p') fail();
  }
  function uniqNum(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }).length; }
  function isC3Version(pv) { var c = cmpVersion(String(pv), C3_VERSION); return c !== null && c >= 0; }
  function parsePageUrl(url) { return parseQuery(new URL(url).search); }

  // ------------------------------------------------------------------ §10 данные для бота (версия 4)
  /** Telegram.WebApp.platform → 1–16 знаков [0-9A-Za-z._-]. */
  function platformTag(platform) {
    var t = String(platform || '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 16);
    return t || 'unknown';
  }
  function payloadBytes(s) { return new TextEncoder().encode(s).length; }
  function ordered(obj, keys) {
    var out = {};
    keys.forEach(function (k) { out[k] = obj[k]; });
    return out;
  }
  function okTime(x) { return typeof x === 'number' && Math.floor(x) === x && x >= 0 && x <= MAX_SAFE; }
  /** Данные режима n или null («Отправить» неактивна). st — как calcN, плюс ks [стоп, цель], kt [мс, мс],
   *  tf ('5' | '60'), pl (платформа), t (время отправки). Цель — из ks[1]: r2/r3 — по плану (как кнопка
   *  2R бота), «0» — без цели, иначе цена st.T. */
  function buildPayloadN(p, st) {
    if (!p || p.m !== 'n') return null;
    var ks = st.ks || [], kt = st.kt || [];
    if (ks.length !== 2 || kt.length !== 2 || KS_STOP.indexOf(ks[0]) < 0 || KS_TP.indexOf(ks[1]) < 0) return null;
    if (!okTime(kt[0]) || !okTime(kt[1])) return null;
    if ((kt[0] > 0) !== (ks[0] === 'm5' || ks[0] === 'h1')) return null;
    if ((kt[1] > 0) !== (ks[1] === 'm5' || ks[1] === 'h1')) return null;
    if (st.tf !== '5' && st.tf !== '60') return null;
    if (!okTime(st.tms) || !okTime(st.t)) return null;
    var tp = ks[1] === 'r2' || ks[1] === 'r3' ? ks[1] : (ks[1] === '0' ? 'none' : 'fixed');
    if (tp === 'fixed' && !has(st.T)) return null;
    var c = calcN(p, { d: st.d, et: st.et, E: st.E, S: st.S, T: tp === 'fixed' ? st.T : null, tp: tp, risk: st.risk,
      bid: st.bid, ask: st.ask, last: st.last, tms: st.tms, fr: st.fr, fn: st.fn });
    if (c.refusal) return null;
    var pl = c.plan;
    var rq = eq(c.risk, dec(p.rk)) ? p.rk : toApiStr(c.risk);
    if (!RX_RQ.test(rq)) return null;
    // 19.2: у пробоя lv[0] — уровень пробоя, pp — предел цены от уровня
    var e0 = pl.limit ? toApiStr(pl.price) : (pl.breakout ? toApiStr(pl.trigger) : '-');
    var obj = { v: DATA_VERSION, m: 'n', k: p.k, s: p.s, d: st.d, et: st.et,
      lv: [e0, toApiStr(pl.stop), pl.target !== null ? toApiStr(pl.target) : '-'],
      ks: [ks[0], ks[1]], kt: [kt[0], kt[1]], tg: '-', tr: '-', al: '-', tf: st.tf, rq: rq, rk: p.rk,
      pq: toApiStr(pl.size.qty), pr: toFixedHE(pl.size.riskPlan, 2), pb: pl.size.bumped ? 1 : 0,
      pp: toApiStr(pl.price), pt: st.tms, pv: PAGE_VERSION, pl: platformTag(st.pl), t: st.t };
    obj = ordered(obj, PAYLOAD_N_KEYS);
    if (payloadBytes(JSON.stringify(obj)) > PAYLOAD_MAX_BYTES) return null;
    return obj;
  }
  /** Данные режима q или null: ничего не сдвинуто, проверка «Перенести» не проходит, нет цены. Открытая и частично
   *  исполненная — st: {S, T|null, bid, ask, last, tf, pl, t}; 19.2 — одна правка за раз: st.t2 = {T2, pct} (цель 2,
   *  проверки calcT2) или st.tr = {dist, act | null} (трейлинг, проверки calcTrail) — тогда стоп и цель в данных как в
   *  адресе; o — восемь значений (ещё t2 и yt адреса). 19.3 — ждущая лимитка (st = w): st: {E, S, T|null, bid, ask,
   *  tf, pl, t}, проверки calcW; lv = [новая цена, стоп, цель | «-»], pq — новый объём, pr — его риск до стопа, pb —
   *  поднят до лота (всегда 0: подъём — отказ bumped); цели 2 и трейлинга у ждущей нет. */
  function buildPayloadQ(p, st) {
    if (!p || p.m !== 'q') return null;
    if (st.tf !== '5' && st.tf !== '60') return null;
    if (!okTime(st.t)) return null;
    var dash = function (x) { return x === null || x === undefined ? '-' : x; };
    if (has(st.t2) && has(st.tr)) return null;
    var tg = '-', tr = '-', lv, pr, pq = '=', pb = 0;
    if (p.st === 'w') {                     // 19.3 (Ч3): цена, стоп и цель ждущей лимитки
      if (has(st.t2) || has(st.tr)) return null;
      var cw = calcW(p, st);
      if (cw.check || !cw.plan || !cw.plan.size || !cw.plan.size.ok) return null;
      lv = [cw.plan.price, cw.plan.stop, cw.plan.target !== null ? cw.plan.target : '-'];
      pq = cw.plan.size.qty;
      pr = toFixedHE(dec(cw.plan.size.risk_plan), 2);
      pb = cw.plan.size.bumped ? 1 : 0;
    } else if (has(st.t2) || has(st.tr)) {
      if (has(st.t2)) {
        var c2 = calcT2(p, { T2: st.t2.T2, pct: st.t2.pct, bid: st.bid, ask: st.ask });
        if (c2.check) return null;
        tg = [toApiStr(dec(st.t2.T2)), String(st.t2.pct)];
      } else {
        var ct = calcTrail(p, { dist: st.tr.dist, act: has(st.tr.act) ? st.tr.act : null, bid: st.bid, ask: st.ask,
          last: st.last });
        if (ct.check) return null;
        tr = [toApiStr(dec(st.tr.dist)), has(st.tr.act) ? toApiStr(dec(st.tr.act)) : '-'];
      }
      lv = ['=', toApiStr(dec(p.sl)), p.tp !== null ? toApiStr(dec(p.tp)) : '-'];
      pr = toFixedHE(openRisk(p.d, dec(p.pq), dec(p.pa), dec(p.sl), dec(p.fi), dec(p.fo)), 2);
    } else {
      var c = calcQ(p, st);
      if (c.unsupported || c.check) return null;
      var T = decOrNull(st.T);
      lv = ['=', toApiStr(dec(st.S)), T !== null ? toApiStr(T) : '-'];
      pr = toFixedHE(dec(c.risk_new), 2);
    }
    var obj = { v: DATA_VERSION, m: 'q', k: p.k, s: p.s, d: p.d, st: p.st, lv: lv,
      o: [dash(p.ep), dash(p.ql), p.pq, dash(p.pa), p.sl, dash(p.tp), dash(p.t2), dash(p.yt)],
      tg: tg, tr: tr, al: '-', tf: st.tf, pq: pq, pr: pr, pb: pb,
      pv: PAGE_VERSION, pl: platformTag(st.pl), t: st.t };
    obj = ordered(obj, PAYLOAD_Q_KEYS);
    if (payloadBytes(JSON.stringify(obj)) > PAYLOAD_MAX_BYTES) return null;
    return obj;
  }

  root.TradeRules = {
    PAGE_VERSION: PAGE_VERSION, KNOWN_PAGE_VERSIONS: KNOWN_PAGE_VERSIONS, C3_VERSION: C3_VERSION,
    URL_VERSION: URL_VERSION, DATA_VERSION: DATA_VERSION, PAYLOAD_MAX_BYTES: PAYLOAD_MAX_BYTES, STOP_BARS: STOP_BARS,
    BAR_MS: BAR_MS, H1_MS: H1_MS, STALE_MS: STALE_MS, URL_N_KEYS: URL_N_KEYS, URL_Q_KEYS: URL_Q_KEYS,
    URL_N_KEYS_191: URL_N_KEYS_191, URL_Q_KEYS_191: URL_Q_KEYS_191, C3_Q_KEYS: C3_Q_KEYS, CH4_KEYS: CH4_KEYS,
    PAYLOAD_N_KEYS: PAYLOAD_N_KEYS, PAYLOAD_Q_KEYS: PAYLOAD_Q_KEYS, MINUS: MINUS, NBSP: NBSP,
    Q: Q, dec: dec, decOrNull: decOrNull, intQ: intQ, add: add, sub: sub, mul: mul, div: div, muli: muli,
    cmp: cmp, eq: eq, sameQ: sameQ, qmin: qmin, qmax: qmax, qabs: qabs, has: has, isQ: isQ,
    ZERO: ZERO, ONE: ONE, TWO: TWO, HUNDRED: HUNDRED, CENT: CENT,
    floorQ: floorQ, roundHalfEvenQ: roundHalfEvenQ, roundStep: roundStep, priceForDirection: priceForDirection,
    onStep: onStep, toApiStr: toApiStr, toFixedHE: toFixedHE, q10: q10, stepDecimals: stepDecimals,
    fmtPrice: fmtPrice, fmtPx: fmtPrice, fmtQty: fmtQty, fmtUsdt: fmtUsdt, fmtPlain: fmtPlain, fmtInt: fmtInt,
    pyFixed: pyFixed, pyRoundInt: pyRoundInt, dblToQ: dblToQ, toNum: toNum, fromNum: fromNum,
    refPrice: refPrice, priceLimit: priceLimit, roundStop: roundStop, roundTarget: roundTarget,
    unitLoss: unitLoss, feeShare: feeShare, planSize: planSize, openRisk: openRisk, workingRisk: workingRisk,
    rAt: rAt, targetForR: targetForR, bePrice: bePrice,
    closedBars: closedBars, swingPoints: swingPoints, levelsOf: levelsOf, defaultStop: defaultStop,
    defaultTarget: defaultTarget, sideLevels: sideLevels, stepLevel: stepLevel, stepStop: stepStop,
    stepTarget: stepTarget, stepEntry: stepEntry, stopFirst: stopFirst, targetFirst: targetFirst,
    defaultEntry: defaultEntry, dragStop: dragStop, dragTarget: dragTarget, dragEntry: dragEntry,
    confirmPlan: confirmPlan, numericChecks: numericChecks, okSize: okSize,
    RISK_QUICK_PCT: RISK_QUICK_PCT, riskFromPct: riskFromPct, riskFloor: riskFloor, riskPctExact: riskPctExact,
    riskInLimits: riskInLimits, riskLimitsUsdt: riskLimitsUsdt, riskQuick: riskQuick, riskPctLabel: riskPctLabel,
    parseRiskInput: parseRiskInput, riskOf: riskOf,
    instN: instN, ruleN: ruleN, thresholds: thresholds, planOut: planOut, extrasN: extrasN, calcN: calcN,
    calcNOut: calcNOut, tpslChecks: tpslChecks, calcQ: calcQ, calcW: calcW,
    breakoutLevel: breakoutLevel, breakoutGap: breakoutGap, breakoutLevels: breakoutLevels, stepBreakout: stepBreakout,
    defaultBreakout: defaultBreakout, dragBreakout: dragBreakout,
    splitTarget2: splitTarget2, target2Ok: target2Ok, target2Default: target2Default, calcT2: calcT2,
    trailPreset: trailPreset, trailCheck: trailCheck, trailOut: trailOut, calcTrail: calcTrail,
    cmpVersion: cmpVersion, isNewerVersion: isNewerVersion, isC3Version: isC3Version, parseQuery: parseQuery,
    parsePageUrl: parsePageUrl,
    platformTag: platformTag, payloadBytes: payloadBytes, buildPayloadN: buildPayloadN, buildPayloadQ: buildPayloadQ
  };
})(typeof window !== 'undefined' ? window : globalThis);
