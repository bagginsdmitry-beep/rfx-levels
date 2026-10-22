/* app.js — мини-приложение «Уровни» (SPEC_18 §4): график, перетаскивание линий, кнопки,
 * расчёт объёма и риска по правилу бота (rules.js), отправка боту через Telegram.WebApp.sendData.
 *
 * Сеть: только свечи с api.bybit.com (запасной — fapi.binance.com). Ничего не хранит в браузере
 * (ни хранилища, ни куки), никуда ничего не отправляет, кроме sendData в чат бота.
 */
(function () {
  'use strict';

  var R = window.LevelRules;
  var TG = (window.Telegram && window.Telegram.WebApp) || null;
  var LWC = window.LightweightCharts || null;
  var IN_TG = !!(TG && TG.platform && TG.platform !== 'unknown');

  var BAR_MS = 300000, MSK_MS = 3 * 3600 * 1000, MSK_S = 10800;
  var POLL_MS = 15000, FETCH_TIMEOUT_MS = 6000, M5_BARS = 96, VISIBLE_BARS = 120, KLINES = 300;
  var HIT_PX = 16;
  var NAMES = { L1: 'L1', L2: 'L2', L3: 'L3', SL: 'Стоп', TP: 'Цель' };
  var SHORT = { L1: 'L1', L2: 'L2', L3: 'L3', SL: 'стоп', TP: 'цель' };
  var MINUS = '−', NBSP = ' ';
  var RX_PX = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;

  var S = {
    p: null, d: 1, inst: null, tick: null, coin: '',
    keys: [],            // линии, которые двигает владелец
    cur: {}, start: {}, bot: {},
    pq: null, pa: null, wq: [],
    sel: null,
    bars: [], src: null, last: null, m5: [], firstLoadDone: false, loading: false, loadFailed: false,
    chart: null, series: null, plines: {}, slines: [], markersSet: false,
    drag: null, sent: false, dirty: false, lastHaptic: 0, statusTimer: 0
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function ver(v) {
    try { return !!(TG && TG.isVersionAtLeast && TG.isVersionAtLeast(v)); } catch (e) { return false; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { var t = new Date(ms + MSK_MS); return pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); }

  // ------------------------------------------------------------------ числа для показа
  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function fmtFixed(x, k) {
    var s = Math.abs(x).toFixed(k);
    var parts = s.split('.');
    var out = groupInt(parts[0]) + (parts[1] ? '.' + parts[1] : '');
    return (x < 0 && Number(s) !== 0 ? MINUS : '') + out;
  }
  function fmtSigned(x, k) {
    var s = fmtFixed(x, k);
    return (x > 0 && Number(Math.abs(x).toFixed(k)) !== 0) ? '+' + s : s;
  }
  function px(v) { return v === null ? '-' : R.fmtPrice(v, S.tick); }
  function num(q) { return R.toNum(q); }

  // ------------------------------------------------------------------ Telegram
  function tgInit() {
    if (!TG) return;
    try { TG.ready(); } catch (e) { /* вне Telegram */ }
    try { TG.expand(); } catch (e) { /* старый клиент */ }
    if (ver('7.7')) { try { TG.disableVerticalSwipes(); } catch (e) { /* нет метода */ } }
    try {
      TG.onEvent('themeChanged', applyTheme);
      TG.onEvent('viewportChanged', function (ev) { if (!ev || ev.isStateStable) sizeChart(); });
    } catch (e) { /* нет событий */ }
  }
  function haptic() {
    if (!IN_TG || !ver('6.1') || !TG.HapticFeedback) return;
    var now = Date.now();
    if (now - S.lastHaptic < 50) return;          // не чаще 20 раз в секунду
    S.lastHaptic = now;
    try { TG.HapticFeedback.selectionChanged(); } catch (e) { /* нет вибро */ }
  }
  function openLink(url) {
    if (IN_TG) { try { TG.openLink(url); return; } catch (e) { /* ниже */ } }
    window.open(url, '_blank', 'noopener');
  }
  function closeApp() {
    if (TG && ver('6.2')) { try { TG.disableClosingConfirmation(); } catch (e) { /* нет */ } }
    if (IN_TG) TG.close(); else window.close();
  }
  function buttonLabel() {
    return (S.p.m === 'g' ? 'Уровни №' : 'Стоп/цель №') + S.p.c + ' ' + S.coin;
  }

  // ------------------------------------------------------------------ тема
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function isDark() {
    if (IN_TG && TG.colorScheme) return TG.colorScheme === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function colors() {
    return { bg: cssVar('--bg') || '#ffffff', fg: cssVar('--fg') || '#1e2126', grid: cssVar('--grid'),
      blue: cssVar('--line-blue'), red: cssVar('--line-red'), green: cssVar('--line-green'),
      gray: cssVar('--line-gray'), btn: cssVar('--btn'), btnFg: cssVar('--btn-fg'), hint: cssVar('--hint') };
  }
  function lineColor(k, c) { return k === 'SL' ? c.red : (k === 'TP' ? c.green : c.blue); }
  function applyTheme() {
    document.documentElement.setAttribute('data-scheme', isDark() ? 'dark' : 'light');
    if (IN_TG && ver('6.1')) {
      try { TG.setHeaderColor('bg_color'); TG.setBackgroundColor('bg_color'); } catch (e) { /* нет */ }
    }
    var c = colors();
    if (S.chart) {
      S.chart.applyOptions({ layout: { background: { type: 'solid', color: c.bg }, textColor: c.fg },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } } });
    }
    syncLines();
    renderList();
    updateButtons();
  }

  // ------------------------------------------------------------------ старт
  function fatal(text) {
    $('fatal').textContent = text;
    $('fatal').hidden = false;
    $('main').hidden = true;
    if (IN_TG) { try { TG.MainButton.hide(); } catch (e) { /* нет */ } }
  }
  function banner(text, kind) {
    var b = el('div', 'banner' + (kind ? ' ' + kind : ''), text);
    $('banners').appendChild(b);
    return b;
  }

  function init() {
    tgInit();
    document.documentElement.setAttribute('data-scheme', isDark() ? 'dark' : 'light');
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', function () { if (!IN_TG) applyTheme(); });
    }
    $('tvAttr').addEventListener('click', function (e) { e.preventDefault(); openLink(this.href); });

    var p = R.parseQuery(window.location.search);
    if (!p) { fatal('Ссылка повреждена — откройте заново кнопкой внизу чата бота.'); return; }
    S.p = p;
    S.d = p.d;
    S.inst = R.instOf(p);
    S.tick = S.inst.tk;
    S.coin = p.s.replace(/USDT$/, '') || p.s;

    var lvB = R.levelsOf(p.b), lvO = R.levelsOf(p.o);
    S.bot = lvB;
    if (p.m === 'g') {
      S.keys = R.LINES.filter(function (k) { return lvO[k] !== null; });
      S.keys.forEach(function (k) { S.cur[k] = lvO[k]; });
      S.sel = 'L2';
    } else {
      S.keys = ['SL', 'TP'];
      S.cur = { L1: null, L2: null, L3: null, SL: lvB.SL, TP: lvB.TP };
      S.pq = R.dec(p.pq);
      S.pa = R.dec(p.pa);
      S.wq = R.waitingQP(p);
      S.sel = 'SL';
    }
    S.keys.forEach(function (k) { S.start[k] = S.cur[k]; });

    var side = p.d === 1 ? 'ЛОНГ' : 'ШОРТ';
    $('title').textContent = '№' + p.c + ' ' + p.s + ' ' + side;
    $('subtitle').textContent = p.m === 'g' ? 'правка уровней до «Беру»' : 'стоп и цель открытой позиции';
    document.title = (p.m === 'g' ? 'Уровни №' : 'Стоп/цель №') + p.c + ' ' + S.coin;

    // rv — уже момент, на который посчитаны уровни бота (закрытие бара; CHANGES_18.md, отклонение 1);
    // +5 минут давали «на 17:45» при «17:40» у бота (аудит 1.8, замечание 2).
    var revAt = p.rv;
    banner('Уровни бота на ' + hhmm(revAt) + ' МСК');
    if (p.e > 0) banner('Стартовые уровни — ваша правка №' + p.e + '.');
    if (p.pv !== R.PAGE_VERSION) banner('Страница обновилась, закройте и откройте снова.', 'warn');
    if (!IN_TG) banner('Откройте из Telegram — здесь можно только посмотреть.', 'warn');
    S.expiredBanner = banner('Подсказка уже неактуальна (после 23:00) — правку бот не примет.', 'err');
    S.expiredBanner.hidden = true;
    if (!LWC) banner('График не загрузился — двигайте линии кнопками.', 'warn');

    $('main').hidden = false;
    setupButtons();
    setupChart();
    buildList();
    ['pointerup', 'pointercancel', 'blur'].forEach(function (t) { window.addEventListener(t, stopRepeat); });
    document.addEventListener('visibilitychange', stopRepeat);
    applyTheme();
    recalc();
    loadBars(true);
    setInterval(function () { if (document.visibilityState === 'visible') loadBars(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') loadBars(false);
    });
    setInterval(updateButtons, 30000);  // срок 23:00
  }

  // ------------------------------------------------------------------ кнопки внизу
  function setupButtons() {
    if (IN_TG) {
      TG.MainButton.setText('Готово');
      TG.MainButton.onClick(send);
      TG.MainButton.show();
      if (ver('7.10') && TG.SecondaryButton) {
        TG.SecondaryButton.setText('Отмена');
        TG.SecondaryButton.onClick(closeApp);
        TG.SecondaryButton.show();
        $('pageButtons').hidden = true;
      } else {
        $('doneBtn').hidden = true;
      }
    }
    $('doneBtn').addEventListener('click', send);
    $('cancelBtn').addEventListener('click', closeApp);
    $('refresh').addEventListener('click', function () { loadBars(false, true); });
    $('reset').addEventListener('click', function () {
      S.keys.forEach(function (k) { S.cur[k] = S.bot[k]; });
      setStatus('Уровни бота возвращены.');
      changed();
    });
    $('tv').addEventListener('click', openTradingView);
  }

  function canSend(res) {
    return IN_TG && !S.sent && S.firstLoadDone && !expired() && !!res.payload;
  }
  function expired() { return S.p.m === 'g' && Date.now() > S.p.ex; }

  function updateButtons(res) {
    if (!S.p) return;
    res = res || S.res;
    if (!res) return;
    var ok = canSend(res);
    if (S.expiredBanner) S.expiredBanner.hidden = !expired();
    $('doneBtn').disabled = !ok;
    if (IN_TG) {
      var tp = TG.themeParams || {};
      try {
        TG.MainButton.setParams({ is_active: ok, color: ok ? (tp.button_color || colors().btn) : (tp.hint_color || '#9aa1ab'),
          text_color: tp.button_text_color || '#ffffff' });
      } catch (e) { /* старый клиент */ }
    }
  }

  function send() {
    var res = compute();
    S.res = res;
    if (!canSend(res)) { updateButtons(res); return; }
    var data = JSON.stringify(res.payload);
    if (R.payloadBytes(data) > R.PAYLOAD_MAX_BYTES) { showSendErr('Отправка не удалась: данные больше 4096 байт.'); return; }
    var unsafe = TG.initDataUnsafe || {};
    if (unsafe.query_id) {      // открыто не кнопкой нижней клавиатуры — sendData не дойдёт
      showSendErr('Отправка не удалась: откройте кнопкой «' + buttonLabel() + '» внизу чата бота.');
      return;
    }
    try {
      S.sent = true;
      if (ver('6.2')) TG.disableClosingConfirmation();
      TG.sendData(data);       // Telegram закроет страницу сам
    } catch (e) {
      S.sent = false;
      showSendErr('Отправка не удалась: откройте кнопкой «' + buttonLabel() + '» внизу чата бота.');
    }
    updateButtons(res);
  }
  function showSendErr(text) { $('sendErr').textContent = text; $('sendErr').hidden = false; }

  function openTradingView() {
    var ticker = 'BYBIT:' + S.p.s + '.P';
    var box = $('tvTicker');
    box.textContent = '';
    box.appendChild(document.createTextNode('Тикер: '));
    box.appendChild(el('span', 'mono', ticker));
    box.hidden = false;
    var done = function (ok) {
      box.appendChild(document.createTextNode(ok ? ' — скопирован' : ' — выделите и скопируйте'));
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ticker).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    } catch (e) { done(false); }
    openLink('https://www.tradingview.com/chart/');
  }

  // ------------------------------------------------------------------ расчёт
  function finalLevels() { return R.LINES.map(function (k) { return S.cur[k] === undefined ? null : S.cur[k]; }); }

  function compute() {
    var p = S.p, d = S.d, tick = S.tick;
    var res = { errs: [], warns: [], infos: [], plan: null, pos: null, payload: null };
    if (p.m === 'g') {
      var ref = S.last || S.bot.L2;
      res.errs = R.checkOrder(d, S.cur, tick, ref).map(function (x) { return x[1]; });
      R.lateLegs(d, S.cur, S.last).forEach(function (x) { res.warns.push(x[1]); });
      res.plan = R.planForEdit(d, S.cur, S.inst);
      if (!res.plan.ok && !res.errs.length) res.errs.push(res.plan.reason);
    } else {
      var wp = S.wq.map(function (x) { return x[1]; });
      R.checkPosition(d, S.cur.SL, S.cur.TP, S.last, S.pa, S.pq, wp, tick, S.bot.SL, S.bot.TP)
        .forEach(function (x) {
          if (x[0] === 'E_NO_CHANGE') res.infos.push('Сдвиньте стоп или цель — пока всё как у бота.');
          else res.errs.push(x[1]);
        });
      res.pos = { risk: R.positionRisk(d, S.pq, S.pa, S.wq, S.cur.SL),
        riskOld: R.positionRisk(d, S.pq, S.pa, S.wq, S.bot.SL),
        profit: R.positionProfit(d, S.pq, S.pa, S.wq, S.cur.TP) };
    }
    if (!S.last && S.firstLoadDone) res.warns.push('Нет текущей цены — по цене проверит бот.');
    res.payload = R.buildPayload(p, finalLevels(), S.last, IN_TG ? TG.platform : 'unknown', Date.now());
    return res;
  }

  function recalc() {
    var res = compute();
    S.res = res;
    renderCalc(res);
    fill('errs', res.errs);
    fill('warns', res.warns);
    fill('infos', res.infos);
    updateButtons(res);
  }
  function fill(id, items) {
    var ul = $(id);
    ul.textContent = '';
    items.forEach(function (t) { ul.appendChild(el('li', '', t)); });
  }

  function renderCalc(res) {
    var box = $('calc');
    box.textContent = '';
    var rk = num(S.inst.rk);
    if (res.errs.length) return;                      // при ошибках расчёт не показывается
    if (S.p.m === 'g') {
      var pl = res.plan;
      if (!pl || !pl.ok) return;
      var qty = R.fmtQty(pl.qty, S.inst.qs);
      box.appendChild(el('div', 'main', 'По ' + qty + ' ' + S.coin + ' на заявку · риск ' + fmtFixed(num(pl.risk), 2) +
        ' USDT (' + fmtFixed(num(pl.risk) / rk, 2) + ' R) · номинал ' + fmtFixed(num(pl.notional), 0) + ' USDT'));
      var n = pl.legs.length, rp = pl.rp;
      var line;
      if (n === 1) {
        line = 'При цели ' + fmtSigned(rp.tp_first, 2) + ' R; при стопе ' + fmtSigned(-1, 2) + ' R';
      } else {
        line = 'При цели ' + fmtSigned(rp.tp_first, 2) + ' R (только ' + pl.legs[0][0] + ') … ' +
          fmtSigned(rp.tp_all, 2) + ' R (' + (n === 2 ? 'обе' : 'все три') + '); при стопе ' +
          fmtSigned(rp.sl_first, 2) + ' … ' + fmtSigned(-1, 2) + ' R';
      }
      box.appendChild(el('div', '', line));
      var f = R.feesR(pl, S.inst.fm, S.inst.ft);
      box.appendChild(el('div', '', 'Комиссии ≈ ' + fmtSigned(f.tp, 2) + ' R при цели, ' + fmtSigned(f.sl, 2) + ' R при стопе'));
      if (pl.bumped) box.appendChild(el('div', '', 'Объём поднят до минимального лота.'));
    } else {
      var ps = res.pos, r = num(ps.risk) / rk, r0 = num(ps.riskOld) / rk;
      var waits = S.p.w.map(function (x) { return x[0] + ' ' + R.fmtPrice(R.dec(x[1]), S.tick); }).join(', ');
      box.appendChild(el('div', '', 'Позиция ' + S.p.pq + ' ' + S.coin + ', средняя ' + S.p.pa +
        (waits ? ' · ждут: ' + waits : '')));
      box.appendChild(el('div', 'main', r > 0
        ? 'Риск до стопа ' + fmtFixed(r, 2) + ' R (было ' + fmtFixed(r0, 2) + ' R)'
        : 'Стоп в плюсе: ' + fmtSigned(-r, 2) + ' R (было риск ' + fmtFixed(r0, 2) + ' R)'));
      box.appendChild(el('div', '', 'При цели ' + fmtSigned(num(ps.profit) / rk, 2) + ' R'));
    }
  }

  // ------------------------------------------------------------------ список линий
  /** Строки строятся один раз (кнопки не пересоздаются — удержание ▲▼ не обрывается),
   *  дальше renderList только обновляет текст, выделение и доступность кнопок M5. */
  function buildList() {
    var box = $('lines');
    box.textContent = '';
    S.rows = {};
    S.keys.forEach(function (k) {
      var row = el('div', 'row');
      var name = el('button', 'name');
      name.type = 'button';
      var dot = el('span', 'dot');
      name.appendChild(dot);
      name.appendChild(document.createTextNode(NAMES[k]));
      name.setAttribute('aria-label', 'Выбрать линию ' + NAMES[k]);
      name.addEventListener('click', function () { select(k); });
      var val = el('div', 'val');
      var price = el('span', 'price mono');
      var bot = el('span', 'bot');
      val.appendChild(price);
      val.appendChild(bot);
      var btns = el('div', 'btns');
      var m5dn = stepBtn('⤓', NAMES[k] + ' к уровню M5 ниже', function () { jump(k, false); }, false);
      var m5up = stepBtn('⤒', NAMES[k] + ' к уровню M5 выше', function () { jump(k, true); }, false);
      btns.appendChild(stepBtn('▼', NAMES[k] + ' на шаг ниже', function () { nudge(k, -1); }, true));
      btns.appendChild(stepBtn('▲', NAMES[k] + ' на шаг выше', function () { nudge(k, 1); }, true));
      btns.appendChild(m5dn);
      btns.appendChild(m5up);
      row.appendChild(name);
      row.appendChild(val);
      row.appendChild(btns);
      box.appendChild(row);
      S.rows[k] = { row: row, dot: dot, price: price, bot: bot, m5: [m5dn, m5up] };
    });
    if (S.p.m === 'p') {
      S.p.w.forEach(function (x) {
        S.rows['wait:' + x[0]] = staticRow(box, x[0] + ' ждёт', R.fmtPrice(R.dec(x[1]), S.tick), 'blue');
      });
      S.rows.avg = staticRow(box, 'Средняя', S.p.pa, 'gray');
    }
  }
  function staticRow(box, name, value, colorKey) {
    var row = el('div', 'row static');
    var n = el('div', 'name');
    var dot = el('span', 'dot');
    n.appendChild(dot);
    n.appendChild(document.createTextNode(name));
    var v = el('div', 'val');
    v.appendChild(el('span', 'price mono', value));
    row.appendChild(n);
    row.appendChild(v);
    box.appendChild(row);
    return { row: row, dot: dot, colorKey: colorKey };
  }
  function renderList() {
    if (!S.p || !S.rows) return;
    var c = colors();
    S.keys.forEach(function (k) {
      var r = S.rows[k];
      r.row.className = 'row' + (k === S.sel ? ' sel' : '');
      r.row.style.setProperty('--sel', lineColor(k, c));
      r.dot.style.background = lineColor(k, c);
      r.price.textContent = px(S.cur[k]);
      r.bot.textContent = botNote(k);
      r.m5.forEach(function (b) { b.disabled = !S.m5.length; });
    });
    Object.keys(S.rows).forEach(function (id) {
      var r = S.rows[id];
      if (r.colorKey) r.dot.style.background = c[r.colorKey];
    });
  }
  function botNote(k) {
    var b = S.bot[k], v = S.cur[k];
    if (b === null || b === undefined) return '';
    if (R.eq(b, v)) return 'как у бота';
    var steps = num(R.div(R.sub(v, b), S.tick));
    var st = Math.round(steps);
    return 'бот ' + px(b) + ', ' + (st > 0 ? '+' : MINUS) + Math.abs(st) + ' ' + plural(Math.abs(st), 'шаг', 'шага', 'шагов');
  }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  }
  var holdTimer = 0, repTimer = 0;
  function stopRepeat() { clearTimeout(holdTimer); clearInterval(repTimer); holdTimer = repTimer = 0; }
  function stepBtn(label, aria, fn, repeat) {
    var b = el('button', 'btn', label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('pointerdown', function (e) {
      if ((e.button !== undefined && e.button !== 0) || b.disabled) return;
      e.preventDefault();
      stopRepeat();
      fn();
      if (repeat) holdTimer = setTimeout(function () { repTimer = setInterval(fn, 125); }, 400);  // 8 раз в секунду
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { b.addEventListener(t, stopRepeat); });
    b.addEventListener('click', function (e) { if (e.detail === 0) fn(); });     // клавиатура
    return b;
  }

  function select(k) {
    if (S.sel === k) return;
    S.sel = k;
    renderList();
    syncLines();
  }
  function setStatus(text) {
    $('status').textContent = text;
    clearTimeout(S.statusTimer);
    S.statusTimer = setTimeout(function () { $('status').textContent = ''; }, 3000);
  }
  function nudge(k, dir) {
    S.sel = k;
    var v = R.add(S.cur[k], R.muli(S.tick, dir));
    if (R.cmp(v, R.ZERO) <= 0) return;
    S.cur[k] = v;
    haptic();
    changed();
  }
  function jump(k, up) {
    S.sel = k;
    var v = R.stepLevel(S.m5, S.cur[k], up);
    if (v === null) { setStatus(up ? 'Выше уровней M5 нет.' : 'Ниже уровней M5 нет.'); renderList(); return; }
    S.cur[k] = v;
    haptic();
    changed();
  }
  function changed() {
    var dirty = S.keys.some(function (k) { return !R.eq(S.cur[k], S.start[k]); });
    if (dirty !== S.dirty && IN_TG && ver('6.2')) {
      try { if (dirty) TG.enableClosingConfirmation(); else TG.disableClosingConfirmation(); } catch (e) { /* нет */ }
    }
    S.dirty = dirty;
    $('sendErr').hidden = true;
    renderList();
    syncLines();
    recalc();
  }

  // ------------------------------------------------------------------ график
  function sizeChart() {
    if (S.drag) return;
    var h = Math.max(260, Math.round(window.innerHeight * 0.55));
    $('chart').style.height = h + 'px';
  }

  function setupChart() {
    if (!LWC) { $('chartWrap').hidden = true; return; }
    sizeChart();
    var c = colors();
    var k = R.stepDecimals(S.tick);
    try {
      S.chart = LWC.createChart($('chart'), {
        autoSize: true,
        layout: { background: { type: 'solid', color: c.bg }, textColor: c.fg, attributionLogo: true },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.06, bottom: 0.06 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3 },
        handleScroll: true, handleScale: true
      });
      S.series = S.chart.addSeries(LWC.CandlestickSeries, {
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        priceFormat: { type: 'price', precision: k, minMove: num(S.tick) },
        autoscaleInfoProvider: autoscale
      });
    } catch (e) {
      S.chart = S.series = null;
      $('chartWrap').hidden = true;
      banner('График не загрузился — двигайте линии кнопками.', 'warn');
      return;
    }
    $('chartMsg').textContent = 'Загружаю свечи…';
    $('chartMsg').hidden = false;
    var box = $('chart');
    box.addEventListener('pointerdown', onDown, { capture: true });
    box.addEventListener('pointermove', onMove, { capture: true });
    box.addEventListener('pointerup', onUp, { capture: true });
    box.addEventListener('pointercancel', onUp, { capture: true });
    ['touchstart', 'touchmove', 'mousedown', 'mousemove'].forEach(function (t) {
      box.addEventListener(t, function (e) {
        if (S.drag) { e.stopPropagation(); if (e.cancelable && t === 'touchmove') e.preventDefault(); }
      }, { capture: true, passive: false });
    });
    window.addEventListener('resize', sizeChart);
  }

  function linePrices() {
    var out = [];
    S.keys.forEach(function (k) { out.push(num(S.cur[k])); });
    R.LINES.forEach(function (k) { if (S.bot[k]) out.push(num(S.bot[k])); });
    if (S.p.m === 'p') S.wq.forEach(function (x) { out.push(num(x[1])); });
    if (S.last) out.push(num(S.last));
    return out;
  }
  function autoscale(orig) {
    var r = orig();
    if (!r || !r.priceRange) return r;
    var ps = linePrices();
    r.priceRange = { minValue: Math.min.apply(null, [r.priceRange.minValue].concat(ps)),
      maxValue: Math.max.apply(null, [r.priceRange.maxValue].concat(ps)) };
    return r;
  }

  function syncLines() {
    if (!S.series || !S.p) return;
    var c = colors();
    var LS = LWC.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2 };
    var want = {};
    S.keys.forEach(function (k) {
      want['own:' + k] = { price: num(S.cur[k]), color: lineColor(k, c), lineWidth: k === S.sel ? 3 : 2,
        lineStyle: k === 'TP' ? LS.Dashed : LS.Solid, axisLabelVisible: true, title: SHORT[k] };
    });
    R.LINES.forEach(function (k) {
      var b = S.bot[k];
      if (!b) return;
      if (S.keys.indexOf(k) >= 0 && R.eq(b, S.cur[k])) return;
      if (S.p.m === 'p' && S.keys.indexOf(k) < 0) return;          // ноги позиции — ниже
      want['bot:' + k] = { price: num(b), color: c.gray, lineWidth: 1, lineStyle: LS.Dotted,
        axisLabelVisible: false, title: 'бот ' + SHORT[k] };
    });
    if (S.p.m === 'p') {
      S.p.w.forEach(function (x) {
        want['wait:' + x[0]] = { price: num(R.dec(x[1])), color: c.blue, lineWidth: 1, lineStyle: LS.Dotted,
          axisLabelVisible: false, title: x[0] + ' ждёт' };
      });
      want.avg = { price: num(S.pa), color: c.gray, lineWidth: 1, lineStyle: LS.Solid,
        axisLabelVisible: false, title: 'средняя' };
    }
    Object.keys(S.plines).forEach(function (id) {
      if (!want[id]) { S.series.removePriceLine(S.plines[id]); delete S.plines[id]; }
    });
    Object.keys(want).forEach(function (id) {
      if (S.plines[id]) S.plines[id].applyOptions(want[id]);
      else S.plines[id] = S.series.createPriceLine(want[id]);
    });
  }

  function yOf(ev) { return ev.clientY - $('chart').getBoundingClientRect().top; }
  function onDown(ev) {
    if (!S.series || !S.bars.length) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    var y = yOf(ev), best = null, dist = HIT_PX + 0.01;
    S.keys.forEach(function (k) {
      var yy = S.series.priceToCoordinate(num(S.cur[k]));
      if (yy === null || yy === undefined) return;
      var dd = Math.abs(yy - y);
      if (dd < dist) { dist = dd; best = k; }
    });
    if (!best) return;
    ev.preventDefault();
    ev.stopPropagation();
    S.drag = { k: best, id: ev.pointerId, y0: y, moved: false };
    try { $('chart').setPointerCapture(ev.pointerId); } catch (e) { /* нет захвата */ }
    S.chart.applyOptions({ handleScroll: false, handleScale: false });
    select(best);
  }
  function onMove(ev) {
    var dr = S.drag;
    if (!dr || ev.pointerId !== dr.id) return;
    ev.preventDefault();
    ev.stopPropagation();
    var y = yOf(ev);
    if (!dr.moved && Math.abs(y - dr.y0) < 3) return;
    dr.moved = true;
    var price = S.series.coordinateToPrice(y);
    if (price === null || price === undefined || !(price > 0)) return;
    var v = R.priceForDirection(R.fromNum(price), S.tick, S.d);
    if (R.cmp(v, R.ZERO) <= 0 || R.eq(v, S.cur[dr.k])) return;
    S.cur[dr.k] = v;
    haptic();
    changed();
  }
  function onUp(ev) {
    var dr = S.drag;
    if (!dr || ev.pointerId !== dr.id) return;
    ev.stopPropagation();
    try { $('chart').releasePointerCapture(ev.pointerId); } catch (e) { /* уже отпущен */ }
    S.drag = null;
    S.chart.applyOptions({ handleScroll: true, handleScale: true });
  }

  // ------------------------------------------------------------------ свечи
  function fetchJson(url) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (e) { clearTimeout(timer); throw e; });
  }
  function okBar(b) {
    return b.t > 0 && RX_PX.test(b.o) && RX_PX.test(b.h) && RX_PX.test(b.l) && RX_PX.test(b.c);
  }
  function fetchBybit() {
    var u = 'https://api.bybit.com/v5/market/kline?category=linear&symbol=' + encodeURIComponent(S.p.s) +
      '&interval=5&limit=' + KLINES;
    return fetchJson(u).then(function (j) {
      if (!j || j.retCode !== 0 || !j.result || !Array.isArray(j.result.list) || !j.result.list.length) {
        throw new Error('Bybit: пустой ответ');
      }
      var bars = j.result.list.map(function (x) {
        return { t: Number(x[0]), o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]) };
      }).filter(okBar);
      bars.sort(function (a, b) { return a.t - b.t; });        // новые первыми → старые первыми
      return { src: 'bybit', bars: bars };
    });
  }
  function fetchBinance() {
    var u = 'https://fapi.binance.com/fapi/v1/klines?symbol=' + encodeURIComponent(S.p.s) + '&interval=5m&limit=' + KLINES;
    return fetchJson(u).then(function (j) {
      if (!Array.isArray(j) || !j.length) throw new Error('Binance: пустой ответ');
      var bars = j.map(function (x) {
        return { t: Number(x[0]), o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]) };
      }).filter(okBar);
      bars.sort(function (a, b) { return a.t - b.t; });
      return { src: 'binance', bars: bars };
    });
  }
  function loadBars(first, manual) {
    if (S.loading || !S.p) return;
    S.loading = true;
    var get = S.src === 'binance' ? fetchBinance : (S.src === 'bybit' ? fetchBybit
      : function () { return fetchBybit().catch(fetchBinance); });
    get().then(function (res) {
      if (!res.bars.length) throw new Error('нет свечей');
      applyBars(res);
      if (manual) setStatus('Свечи обновлены.');
    }).catch(function () {
      if (!S.bars.length) {
        S.loadFailed = true;
        $('src').textContent = 'Свечи не загрузились';
        if (S.series) {
          $('chartMsg').textContent = 'Свечи не загрузились. Линии двигаются кнопками ниже; проверки по цене сделает бот.';
          $('chartMsg').hidden = false;
        }
      } else if (manual) {
        setStatus('Обновить не удалось — показаны прежние свечи.');
      }
    }).then(function () {
      S.loading = false;
      if (!S.firstLoadDone) { S.firstLoadDone = true; recalc(); }
    });
  }
  function chartBar(b) {
    return { time: b.t / 1000 + MSK_S, open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c) };
  }
  function applyBars(res) {
    var bars = res.bars;
    var prevLastT = S.bars.length ? S.bars[S.bars.length - 1].t : null;
    S.src = res.src;
    S.bars = bars;
    S.loadFailed = false;
    var lastBar = bars[bars.length - 1];             // незакрытая свеча — последняя цена
    S.last = R.dec(lastBar.c);
    var closed = bars.slice(0, -1).slice(-M5_BARS);
    var extra = R.LINES.map(function (k) { return S.bot[k]; }).filter(function (x) { return !!x; });
    S.m5 = R.m5Levels(closed.map(function (b) { return [b.h, b.l]; }), S.tick, S.d, extra);
    $('src').textContent = (res.src === 'binance' ? 'Свечи Binance (запасной источник)' : 'Свечи Bybit M5') +
      ' · ' + hhmm(Date.now()) + ' МСК';
    if (S.series) {
      if (prevLastT === null) {
        S.series.setData(bars.map(chartBar));
        var n = bars.length;
        S.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE_BARS), to: n + 2 });
        setMarker();
      } else {
        bars.forEach(function (b) { if (b.t >= prevLastT) S.series.update(chartBar(b)); });
      }
      $('chartMsg').hidden = true;
    }
    syncLines();
    renderList();
    recalc();
  }
  function setMarker() {
    if (!S.series || S.markersSet || !LWC.createSeriesMarkers) return;
    var sigOpen = S.p.a - BAR_MS;
    if (!S.bars.some(function (b) { return b.t === sigOpen; })) return;
    var c = colors();
    try {
      LWC.createSeriesMarkers(S.series, [{ time: sigOpen / 1000 + MSK_S,
        position: S.d === 1 ? 'belowBar' : 'aboveBar', color: c.blue,
        shape: S.d === 1 ? 'arrowUp' : 'arrowDown', text: 'сигнал' }]);
      S.markersSet = true;
    } catch (e) { /* без метки */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
