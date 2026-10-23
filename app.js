/* app.js — мини-приложение «Уровни» (SPEC_18 §4; SPEC_19 §3, §9): график, перетаскивание линий,
 * кнопки, расчёт объёма и риска по правилу бота (rules.js), отправка боту через
 * Telegram.WebApp.sendData.
 *
 * Версия 18.1: адрес v=2, режим сетки — полоса «Набор ног» (убрать / добавить / вернуть ногу);
 * адрес v=2, режим позиции — «Снять» у ждущих заявок (одна за раз). Адрес v=1 — как 18.0.
 *
 * Версия 18.2 (SPEC_191 §7, §15.1): адрес v=3 — поставленная сетка без исполнений: ждущие заявки,
 * стоп и цель двигаются, объём — на 1 R; снятие одной заявки — полосой «Снять Lk»; сдвиг и снятие
 * в одной правке нельзя. В начале init() — проверка версии файлов (смесь 18.1 и 18.2 из кэша →
 * «Страница обновляется»), боту в этом случае ничего не уходит.
 *
 * Версия 18.3: в текстах для владельца «заявка» вместо «нога» (решение владельца 2026-10-23);
 * поведение, адреса и нагрузки те же.
 *
 * Версия 18.4 (SPEC_192 §22): риск на сделку. Адрес режима g с rc — блок «Риск на сделку» под
 * расчётом: кнопки 0.5 / 1 / 2 % базы (в пределах rc), отмеченная — риск по умолчанию (rk); поле
 * суммы в USDT; объём считается на выбранный риск, в данные для бота уходит rq. Вне пределов —
 * ошибка, «Готово» неактивна. Адрес без rc — всё как 18.3.
 *
 * Сеть: только свечи с api.bybit.com (запасной — fapi.binance.com). Ничего не хранит в браузере
 * (ни хранилища, ни куки), никуда ничего не отправляет, кроме sendData в чат бота.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ SPEC_191 §15.1: версия файлов
  var APP_PAGE_VERSION = '18.4';
  var GUARD_TEXT = 'Страница обновляется — закройте и откройте её через минуту.';
  var REQUIRED_IDS = ['app', 'title', 'subtitle', 'banners', 'fatal', 'main', 'chartWrap', 'chart',
    'chartMsg', 'src', 'refresh', 'tv', 'tvTicker', 'lines', 'legset', 'status', 'reset', 'calc',
    'risk', 'infos', 'errs', 'warns', 'pageButtons', 'cancelBtn', 'doneBtn', 'sendErr', 'tvAttr'];
  /** Пусто — файлы одной версии; иначе текст для владельца. rules — window.LevelRules (или нет),
   *  metaVer — <meta name="page-version"> (или null), hasId(id) — есть ли элемент страницы. */
  function guardText(rules, metaVer, hasId) {
    if (!rules || rules.PAGE_VERSION !== APP_PAGE_VERSION) return GUARD_TEXT;
    if (metaVer !== APP_PAGE_VERSION) return GUARD_TEXT;
    for (var i = 0; i < REQUIRED_IDS.length; i++) if (!hasId(REQUIRED_IDS[i])) return GUARD_TEXT;
    return '';
  }
  root.AppGuard = { APP_PAGE_VERSION: APP_PAGE_VERSION, GUARD_TEXT: GUARD_TEXT,
    REQUIRED_IDS: REQUIRED_IDS.slice(), guardText: guardText };
  // Самопроверка (selftest.html с <meta name="selftest">, Deno без DOM) берёт только проверку версии.
  if (typeof document === 'undefined' || document.querySelector('meta[name="selftest"]')) return;

  var R = window.LevelRules;
  var TG = (window.Telegram && window.Telegram.WebApp) || null;
  var LWC = window.LightweightCharts || null;
  var IN_TG = !!(TG && TG.platform && TG.platform !== 'unknown');

  var BAR_MS = 300000, MSK_MS = 3 * 3600 * 1000, MSK_S = 10800;
  var POLL_MS = 15000, FETCH_TIMEOUT_MS = 6000, M5_BARS = 96, VISIBLE_BARS = 120, KLINES = 300;
  var HIT_PX = 16;
  var NAMES = { L1: 'L1', L2: 'L2', L3: 'L3', SL: 'Стоп', TP: 'Цель' };
  var SHORT = { L1: 'L1', L2: 'L2', L3: 'L3', SL: 'стоп', TP: 'цель' };
  var MINUS = '−', NBSP = ' ';
  var RX_PX = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;

  var S = {
    p: null, d: 1, inst: null, tick: null, coin: '',
    legset: false,       // режим сетки, адрес v=2: набор ног меняется
    posV2: false,        // режим позиции, адрес v=2 или 3: снятие одной ждущей заявки
    move: false,         // режим позиции, адрес v=3: ждущие заявки, стоп и цель двигаются (18.2)
    cxBar: false,        // адрес v=3 и есть что снять: полоса «Снять Lk» под списком
    cur: {}, start: {}, bot: {}, imp: null, pip: null,
    mark: null, startMark: null,
    pq: null, pa: null, wq: [],
    // 18.4: риск на сделку (адрес режима g с rc). risk — выбранная сумма (дробь) или null (неверно);
    // riskPct — подпись процента; riskBtn — последняя кнопка {usdt, pct}; riskText — текст поля.
    rc: null, riskDef: null, risk: null, riskPct: '', riskBtn: null, riskText: '', riskUi: null,
    sel: null,
    bars: [], src: null, last: null, m5: [], firstLoadDone: false, loading: false, loadFailed: false,
    chart: null, series: null, plines: {}, markersSet: false,
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
  function has(x) { return x !== null && x !== undefined; }
  function sameQ(a, b) { return has(a) ? (has(b) && R.eq(a, b)) : !has(b); }

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
  function px(v) { return has(v) ? R.fmtPrice(v, S.tick) : '-'; }
  function num(q) { return R.toNum(q); }
  function pqZero() { return !!S.pq && R.cmp(S.pq, R.ZERO) === 0; }

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
  /** Надпись кнопки нижней клавиатуры, которой открыта страница. */
  function buttonLabel() {
    var w = S.p.m === 'g' ? 'Уровни №' : (S.posV2 && pqZero() ? 'Заявки №' : 'Стоп/цель №');
    return w + S.p.c + ' ' + S.coin;
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
    var f = $('fatal'), m = $('main');
    if (f) { f.textContent = text; f.hidden = false; } else if (document.body) { document.body.textContent = text; }
    if (m) m.hidden = true;
    if (IN_TG) {
      try { TG.MainButton.hide(); } catch (e) { /* нет */ }
      try { if (TG.SecondaryButton) TG.SecondaryButton.hide(); } catch (e) { /* нет */ }
    }
  }
  function banner(text, kind) {
    var b = el('div', 'banner' + (kind ? ' ' + kind : ''), text);
    $('banners').appendChild(b);
    return b;
  }

  function init() {
    tgInit();
    document.documentElement.setAttribute('data-scheme', isDark() ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="page-version"]');
    var guard = guardText(R, meta ? meta.getAttribute('content') : null, function (id) { return !!$(id); });
    if (guard) { fatal(guard); return; }               // смесь файлов разных версий — боту ничего
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
    S.pip = R.decOrNull(p.pp);

    var lvB = R.levelsOf(p.b), lvO = R.levelsOf(p.o);
    S.bot = lvB;
    if (p.m === 'g') {
      S.legset = p.v === 2;
      S.imp = R.decOrNull(p.im);
      R.LINES.forEach(function (k) { S.cur[k] = lvO[k]; });
      S.sel = R.legsOf(S.cur)[0] || 'SL';               // первая нога, что есть
      if (p.rc) {                                       // 18.4: выбор риска; по умолчанию — rk
        S.rc = p.rc;
        S.riskDef = R.riskFloor(p.rk);
        S.riskBtn = { usdt: S.riskDef, pct: riskLabelOf(S.riskDef) };
        S.risk = S.riskDef;
        S.riskPct = S.riskBtn.pct;
      }
    } else {
      S.posV2 = p.v >= 2;
      S.move = p.v === 3;
      S.cxBar = S.move && p.cx.length > 0;
      S.pq = R.dec(p.pq);
      S.pa = R.decOrNull(p.pa);
      S.wq = R.waitingQP(p);
      if (S.posV2) {
        R.LEGS.forEach(function (k, j) { if (p.o[j] === null && p.b[j] !== null) S.mark = k; });
      }
      if (S.move) {      // ждущие ноги — линии; o — черновик сдвига (или «-» у отмеченной ноги)
        R.LINES.forEach(function (k) { S.cur[k] = has(lvO[k]) ? lvO[k] : lvB[k]; });
      } else {
        S.cur = { L1: null, L2: null, L3: null, SL: lvO.SL, TP: lvO.TP };   // o — черновик «Ещё изменить»
      }
      S.startMark = S.mark;
      S.sel = S.move ? (movable()[0] || null) : (movable().length ? 'SL' : null);
    }
    R.LINES.forEach(function (k) { S.start[k] = S.cur[k]; });

    var side = p.d === 1 ? 'ЛОНГ' : 'ШОРТ';
    $('title').textContent = '№' + p.c + ' ' + p.s + ' ' + side;
    $('subtitle').textContent = p.m === 'g' ? 'правка уровней до «Беру»'
      : (!S.posV2 ? 'стоп и цель открытой позиции'
        : (S.move ? 'ждущие заявки — исполнений нет'
          : (pqZero() ? 'ждущие заявки — позиции нет' : 'стоп, цель и ждущие заявки')));
    document.title = buttonLabel();
    $('reset').textContent = p.m === 'g' ? 'Вернуть уровни бота' : 'Вернуть как было';

    // rv — уже момент, на который посчитаны уровни бота (закрытие бара; CHANGES_18.md, отклонение 1);
    // +5 минут давали «на 17:45» при «17:40» у бота (аудит 1.8, замечание 2).
    var revAt = p.rv;
    banner('Уровни бота на ' + hhmm(revAt) + ' МСК');
    if (S.move) banner('Цены заявок — на момент кнопки; бот сверит с биржей.');
    if (p.e > 0) banner('Стартовые уровни — ваша правка №' + p.e + '.');
    if (R.KNOWN_PAGE_VERSIONS.indexOf(p.pv) < 0) banner('Страница обновилась, закройте и откройте снова.', 'warn');
    if (!IN_TG) banner('Откройте из Telegram — здесь можно только посмотреть.', 'warn');
    S.expiredBanner = banner(S.move ? 'Заявки после 23:00 сняты — правку бот не примет.'
      : 'Подсказка уже неактуальна (после 23:00) — правку бот не примет.', 'err');
    S.expiredBanner.hidden = true;
    if (!LWC) banner('График не загрузился — двигайте линии кнопками.', 'warn');
    S.dyn = {};                                        // полосы, зависящие от правки
    ['set', 'noL2', 'move', 'mark', 'lock', 'hint'].forEach(function (id) {
      S.dyn[id] = banner('', id === 'hint' ? '' : 'note');
      S.dyn[id].hidden = true;
    });

    $('main').hidden = false;
    setupButtons();
    setupChart();
    buildList();
    buildRisk();
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

  /** Линии, которые двигает владелец. */
  function movable() {
    if (!S.p) return [];
    if (S.p.m === 'g') return R.LINES.filter(function (k) { return has(S.cur[k]); });
    if (S.move) return S.mark ? [] : R.LINES.filter(function (k) { return has(S.cur[k]); });  // отметка — линии стоят
    return (S.p.v === 1 || S.p.mv === 1) ? ['SL', 'TP'] : [];
  }
  /** Адрес v=3: сдвинутые линии (против цен заявок b). */
  function movedNow() { return S.move ? R.movedLines(S.bot, S.cur) : []; }
  function isAdded(k) { return R.LEGS.indexOf(k) >= 0 && has(S.cur[k]) && !has(S.bot[k]); }

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
    $('reset').addEventListener('click', reset);
    $('tv').addEventListener('click', openTradingView);
  }
  function reset() {
    if (S.p.m === 'g') {
      var setChanged = R.legsDiff(S.bot, S.cur).length > 0;
      R.LINES.forEach(function (k) { S.cur[k] = S.bot[k]; });
      if (!has(S.cur[S.sel])) S.sel = R.legsOf(S.cur)[0];
      if (setChanged) buildList();
      setStatus('Уровни бота возвращены.');
    } else if (S.move) {
      R.LINES.forEach(function (k) { S.cur[k] = S.bot[k]; });
      S.mark = null;
      if (!S.sel) S.sel = movable()[0] || null;
      setStatus('Всё как было: заявки, стоп и цель.');
    } else {
      S.cur.SL = S.bot.SL;
      S.cur.TP = S.bot.TP;
      S.mark = null;
      setStatus('Всё как было: стоп, цель и заявки.');
    }
    changed();
  }

  function canSend(res) {
    return IN_TG && !S.sent && S.firstLoadDone && !expired() && !!res.payload;
  }
  function expired() { return (S.p.m === 'g' || S.move) && Date.now() > S.p.ex; }

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
  function finalLevels() { return R.LINES.map(function (k) { return has(S.cur[k]) ? S.cur[k] : null; }); }

  // ------------------------------------------------------------------ 18.4: риск на сделку (SPEC_192 §22)
  /** Подпись процента суммы: «0.5», «1.25» (до двух знаков). */
  function riskLabelOf(usdt) { return R.riskPctLabel(R.riskPctExact(usdt, S.p.rb)); }
  /** Сумма для показа: «300», «12.35», «1 234.50» (целая — без «.00»). */
  function usdtShort(q) {
    var t = R.toFixedHE(q, 2);
    if (/\.00$/.test(t)) t = t.slice(0, -3);
    var parts = t.split('.');
    return groupInt(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }
  /** База из адреса: «10 000», «12 345.67». */
  function baseText() {
    var parts = S.p.rb.split('.');
    return groupInt(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }
  function riskLimitsText() {
    var lim = R.riskLimitsUsdt(S.p.rb, S.rc);
    return R.riskPctLabel(S.rc[0]) + '–' + R.riskPctLabel(S.rc[1]) + ' % базы ' + baseText() + ' = ' +
      usdtShort(lim[0]) + '–' + usdtShort(lim[1]) + ' USDT';
  }
  /** Ошибка выбора риска для строки ошибок; пусто — выбор верен. */
  function riskError() {
    if (!S.rc) return '';
    if (S.risk === null && S.riskText.trim() !== '' && !R.parseRiskInput(S.riskText)) {
      return 'Сумма риска — цифры и точка, не больше двух знаков после точки (например, 150 или 49.5).';
    }
    if (S.risk === null || !R.riskInLimits(S.risk, S.p.rb, S.rc)) {
      var lim = R.riskLimitsUsdt(S.p.rb, S.rc);
      return 'Риск ' + R.riskPctLabel(S.rc[0]) + '–' + R.riskPctLabel(S.rc[1]) + ' % базы: ' +
        usdtShort(lim[0]) + '–' + usdtShort(lim[1]) + ' USDT';
    }
    return '';
  }
  /** Параметры расчёта с выбранным риском вместо rk (адрес с rc и верный выбор). */
  function instNow() {
    if (!S.rc || riskError()) return S.inst;
    var inst = {};
    Object.keys(S.inst).forEach(function (k) { inst[k] = S.inst[k]; });
    inst.rk = S.risk;
    return inst;
  }
  function riskDirty() { return !!S.rc && !(S.risk !== null && R.eq(S.risk, S.riskDef)); }

  /** Блок «Риск на сделку» (только режим g с rc): кнопки в пределах, отдельная кнопка риска по
   *  умолчанию, если его нет среди кнопок, поле суммы, подпись пределов. */
  function buildRisk() {
    var box = $('risk');
    box.textContent = '';
    box.hidden = !S.rc;
    if (!S.rc) return;
    box.appendChild(el('div', 'risk-title', 'Риск на сделку'));
    var row = el('div', 'risk-btns');
    var btns = [];
    var addBtn = function (usdt, pct) {
      var b = el('button', 'btn', '');
      b.type = 'button';
      b.addEventListener('click', function () { pickRisk(usdt, pct); });
      row.appendChild(b);
      btns.push({ b: b, usdt: usdt, pct: pct });
    };
    var quick = R.riskQuick(S.p.rb, S.rc);
    quick.forEach(function (x) { addBtn(R.riskFromPct(x, S.p.rb), R.riskPctLabel(x)); });
    var defIn = quick.some(function (x) { return R.eq(R.riskFromPct(x, S.p.rb), S.riskDef); });
    if (!defIn && R.riskInLimits(S.riskDef, S.p.rb, S.rc)) addBtn(S.riskDef, riskLabelOf(S.riskDef));
    box.appendChild(row);
    var field = el('label', 'risk-field');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.setAttribute('inputmode', 'decimal');
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('enterkeyhint', 'done');
    inp.setAttribute('maxlength', '12');
    inp.setAttribute('aria-label', 'Риск на сделку, сумма в USDT');
    inp.placeholder = 'сумма';
    inp.className = 'mono';
    inp.addEventListener('input', function () { typeRisk(inp.value); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
    field.appendChild(inp);
    field.appendChild(document.createTextNode(' USDT'));
    box.appendChild(field);
    box.appendChild(el('div', 'risk-note', riskLimitsText()));
    S.riskUi = { btns: btns, inp: inp };
    renderRisk();
  }
  function renderRisk() {
    if (!S.riskUi) return;
    S.riskUi.btns.forEach(function (x) {
      var on = S.risk !== null && R.eq(S.risk, x.usdt);
      x.b.textContent = x.pct + ' %' + (on ? ' ✓' : '');
      x.b.classList.toggle('on', on);
      x.b.setAttribute('aria-pressed', on ? 'true' : 'false');
      x.b.setAttribute('aria-label', 'Риск ' + x.pct + ' % — ' + usdtShort(x.usdt) + ' USDT');
    });
  }
  function pickRisk(usdt, pct) {
    S.riskBtn = { usdt: usdt, pct: pct };
    S.riskText = '';
    if (S.riskUi) S.riskUi.inp.value = '';
    S.risk = usdt;
    S.riskPct = pct;
    haptic();
    changed();
    setStatus('Риск на сделку: ' + pct + ' % (' + fmtFixed(num(usdt), 2) + ' USDT) — объём пересчитан.');
  }
  function typeRisk(text) {
    S.riskText = String(text || '');
    if (S.riskText.trim() === '') {                  // поле очищено — снова последняя кнопка
      S.risk = S.riskBtn.usdt;
      S.riskPct = S.riskBtn.pct;
    } else {
      S.risk = R.parseRiskInput(S.riskText);
      S.riskPct = S.risk === null ? '' : riskLabelOf(S.risk);
    }
    changed();
  }

  function compute() {
    var p = S.p, d = S.d, tick = S.tick;
    var res = { errs: [], warns: [], infos: [], plan: null, pos: null, move: null, payload: null, set: null };
    if (p.m === 'g') {
      var ref = S.last || S.bot.L2;
      res.errs = R.checkOrder(d, S.cur, tick, ref).map(function (x) { return x[1]; });
      if (S.legset) {
        R.checkAddedL1(d, S.cur, S.bot, S.imp, S.last, tick).forEach(function (x) { res.errs.push(x[1]); });
      }
      R.lateLegs(d, S.cur, S.last).forEach(function (x) {
        if (!(S.legset && isAdded(x[0]))) res.warns.push(x[1]);   // у добавленной L1 — ошибка E_L1_PRICE
      });
      var rErr = riskError();
      if (rErr) res.errs.push(rErr);
      res.plan = R.planForEdit(d, S.cur, instNow());
      if (!res.plan.ok && !res.errs.length) res.errs.push(res.plan.reason);
      if (S.legset) {
        res.set = { diff: R.legsDiff(S.bot, S.cur), hint: R.stopRuleHint(d, S.cur, S.bot, S.pip, tick) };
      }
    } else if (S.move && !S.mark) {                      // адрес v=3: сдвиг заявок
      var cm = R.checkMove(p, S.cur, S.last);
      cm.errs.forEach(function (x) {
        if (x[0] !== 'E_NO_CHANGE') { res.errs.push(x[1]); return; }
        res.infos.push(p.cx.length ? 'Сдвиньте линию или отметьте заявку для снятия.' : 'Сдвиньте линию.');
      });
      res.move = cm;
    } else {
      var pc = R.posCheck(p, S.cur.SL, S.cur.TP, S.mark, S.last);
      if (S.move && movedNow().length) res.errs.push('сдвиг и снятие в одной правке нельзя — верните линии или снимите отметку');
      pc.errs.forEach(function (x) {
        if (x[0] !== 'E_NO_CHANGE') { res.errs.push(x[1]); return; }
        if (!S.posV2) res.infos.push('Сдвиньте стоп или цель — пока всё как сейчас.');
        else res.infos.push(p.mv === 1 ? 'Сдвиньте стоп или цель или отметьте заявку для снятия.'
          : 'Отметьте заявку для снятия.');
      });
      res.pos = pc;
    }
    if (!S.last && S.firstLoadDone) res.warns.push('Нет текущей цены — по цене проверит бот.');
    res.payload = (S.rc && riskError()) ? null      // 18.4: риск неверен — «Готово» неактивна
      : R.buildPayload(p, finalLevels(), S.last, IN_TG ? TG.platform : 'unknown', Date.now(), S.mark,
        S.rc ? S.risk : null);
    return res;
  }

  function recalc() {
    var res = compute();
    S.res = res;
    renderCalc(res);
    renderDyn(res);
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
  function hintText(h) {
    return 'Стоп ваш; по правилу бота для ' + h.leg + ' (' + (S.d === 1 ? MINUS : '+') + R.STOP_BUF_PIPS +
      ' пипсов) он был бы ' + px(h.price) + '.';
  }
  /** Полосы сверху, зависящие от правки: набор ног, «без L2», отметка снятия, строка о стопе. */
  function renderDyn(res) {
    if (!S.dyn) return;
    var t = { set: '', noL2: '', move: '', mark: '', lock: '', hint: '' };
    if (res.move && res.move.moved.length) {
      t.move = 'Сдвиг заявок: ' + res.move.moved.map(function (k) {
        return (R.LEGS.indexOf(k) >= 0 ? k : SHORT[k]) + ' ' + px(S.bot[k]) + '→' + px(S.cur[k]);
      }).join(', ') + (res.move.sized ? ' — объём пересчитан на риск сетки (' +
        R.riskPctLabel(R.riskPctExact(S.inst.rk, S.inst.rb)) + ' % = ' + usdtShort(S.inst.rk) + ' USDT)'
        : ' — объём прежний') + '; после сдвига заявки за уровнями бота не следят.';
    }
    if (S.move && S.mark) t.lock = 'Отмечена ' + S.mark + ' к снятию — линии не двигаются; снимите отметку, чтобы сдвигать.';
    if (res.set) {
      if (res.set.diff.length) {
        t.set = 'Набор заявок изменён: ' + res.set.diff.map(function (x) {
          return (x[0] === '-' ? 'убрана ' : 'добавлена ') + x.slice(1);
        }).join(', ') + ' — риск сетки делится на оставшиеся заявки.';
      }
      if (!has(S.cur.L2) && has(S.bot.L2)) {
        t.noL2 = 'Без L2 сетка снимется при закрытии M5 ' + (S.d === 1 ? 'ниже' : 'выше') + ' 100 % (' +
          px(S.bot.L2) + '), если входа ещё не было.';
      }
      if (res.set.hint) t.hint = hintText(res.set.hint);
    }
    if (res.pos && S.mark) {
      var w = S.wq.filter(function (x) { return x[2] === S.mark; })[0];
      t.mark = 'Будет снята ' + S.mark + (w ? ' ' + px(w[1]) + ' × ' + S.p.q : '') + ' — ' +
        (pqZero() ? 'остальные заявки, стоп и цель остаются.' : 'исполненная часть, стоп и цель остаются.');
      if (res.pos.hint) t.hint = hintText(res.pos.hint);
    }
    Object.keys(t).forEach(function (id) {
      S.dyn[id].textContent = t[id];
      S.dyn[id].hidden = !t[id];
    });
  }

  function renderCalc(res) {
    var box = $('calc');
    box.textContent = '';
    var rk = num(S.inst.rk);
    if (res.errs.length) return;                      // при ошибках расчёт не показывается
    if (S.p.m === 'g' || res.move) {
      var pl = S.p.m === 'g' ? res.plan : res.move.view;
      if (!pl || !pl.ok) return;
      var qty = R.fmtQty(pl.qty, S.inst.qs);
      if (res.move) {           // v=3: «По 45.4 SOL на заявку (было 38.3) · риск … (1.00 R; было 1.00 R)»
        var was = res.move.sized ? ' (было ' + R.fmtQty(R.dec(S.p.q), S.inst.qs) + ')' : '';
        box.appendChild(el('div', 'main', 'По ' + qty + ' ' + S.coin + ' на заявку' + was + ' · риск ' +
          fmtFixed(num(pl.risk), 2) + ' USDT (' + fmtFixed(num(pl.risk) / rk, 2) + ' R; было ' +
          fmtFixed(num(res.move.riskOld) / rk, 2) + ' R) · номинал ' + fmtFixed(num(pl.notional), 0) + ' USDT'));
      } else if (S.rc) {        // 18.4: «риск 49.94 USDT (0.5 % от 10 000)» — выбранный риск, % базы
        box.appendChild(el('div', 'main', 'По ' + qty + ' ' + S.coin + ' на заявку · риск ' + fmtFixed(num(pl.risk), 2) +
          ' USDT (' + S.riskPct + ' % от ' + baseText() + ') · номинал ' + fmtFixed(num(pl.notional), 0) + ' USDT'));
      } else {
        box.appendChild(el('div', 'main', 'По ' + qty + ' ' + S.coin + ' на заявку · риск ' + fmtFixed(num(pl.risk), 2) +
          ' USDT (' + fmtFixed(num(pl.risk) / rk, 2) + ' R) · номинал ' + fmtFixed(num(pl.notional), 0) + ' USDT'));
      }
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
      var rest = S.wq.filter(function (x) { return x[2] !== S.mark; });
      var waits = rest.map(function (x) { return x[2] + ' ' + px(x[1]); }).join(', ');
      var head = pqZero() ? 'Позиции нет' : 'Позиция ' + S.p.pq + ' ' + S.coin + ', средняя ' + S.p.pa;
      var tail = S.mark ? (waits ? ' · после снятия ждут: ' + waits : ' · после снятия заявок нет')
        : (waits ? ' · ждут: ' + waits : '');
      box.appendChild(el('div', '', head + tail));
      box.appendChild(el('div', 'main', r > 0
        ? 'Риск до стопа ' + fmtFixed(r, 2) + ' R (было ' + fmtFixed(r0, 2) + ' R)'
        : 'Стоп в плюсе: ' + fmtSigned(-r, 2) + ' R (было риск ' + fmtFixed(r0, 2) + ' R)'));
      box.appendChild(el('div', '', 'При цели ' + fmtSigned(num(ps.profit) / rk, 2) + ' R'));
    }
  }

  // ------------------------------------------------------------------ список линий
  /** Строки строятся заново только при смене набора ног (кнопки не пересоздаются при каждом шаге —
   *  удержание ▲▼ не обрывается); renderList обновляет текст, выделение и доступность кнопок. */
  function buildList() {
    var box = $('lines');
    box.textContent = '';
    S.rows = {};
    var mv = movable();
    var order = S.p.m === 'g' ? (S.legset ? R.LINES : R.LINES.filter(function (k) { return has(S.start[k]); }))
      : (S.move ? R.LINES : ['SL', 'TP']);
    order.forEach(function (k) {
      if (S.move ? has(S.bot[k]) : mv.indexOf(k) >= 0) lineRow(box, k);   // v=3: при отметке строки есть, кнопки неактивны
      else S.rows[k] = offRow(box, k);
    });
    if (S.p.m === 'p' && !S.move) {
      S.p.w.forEach(function (x) {
        S.rows['wait:' + x[0]] = S.posV2 ? waitRow(box, x[0], R.dec(x[1])) : staticRow(box, x[0] + ' ждёт', px(R.dec(x[1])), 'blue');
      });
      if (S.pa && !pqZero()) S.rows.avg = staticRow(box, 'Средняя', S.p.pa, 'gray');
    }
    buildLegset();
  }
  function lineRow(box, k) {
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
    var dn = stepBtn('▼', NAMES[k] + ' на шаг ниже', function () { nudge(k, -1); }, true);
    var up = stepBtn('▲', NAMES[k] + ' на шаг выше', function () { nudge(k, 1); }, true);
    btns.appendChild(dn);
    btns.appendChild(up);
    btns.appendChild(m5dn);
    btns.appendChild(m5up);
    row.appendChild(name);
    row.appendChild(val);
    row.appendChild(btns);
    box.appendChild(row);
    S.rows[k] = { kind: 'line', row: row, dot: dot, price: price, bot: bot, m5: [m5dn, m5up], steps: [dn, up] };
  }
  /** Серая строка без кнопок шага: нога, которой нет (режим сетки v2), или стоп/цель позиции,
   *  которые нельзя двигать (режим позиции v2, mv = 0). */
  function offRow(box, k) {
    var r = staticRow(box, NAMES[k], '', k === 'SL' ? 'red' : (k === 'TP' ? 'green' : 'gray'));
    r.row.className = 'row static off';
    r.kind = 'off';
    r.key = k;
    return r;
  }
  function staticRow(box, name, value, colorKey) {
    var row = el('div', 'row static');
    var n = el('div', 'name');
    var dot = el('span', 'dot');
    n.appendChild(dot);
    n.appendChild(document.createTextNode(name));
    var v = el('div', 'val');
    var price = el('span', 'price mono', value);
    var note = el('span', 'bot');
    v.appendChild(price);
    v.appendChild(note);
    row.appendChild(n);
    row.appendChild(v);
    box.appendChild(row);
    return { kind: 'static', row: row, dot: dot, price: price, bot: note, colorKey: colorKey };
  }
  /** Ждущая заявка позиции (адрес v=2): «Снять» / «Не снимать» у ног из cx. */
  function waitRow(box, leg, price) {
    var r = staticRow(box, leg, px(price), 'blue');
    r.kind = 'wait';
    r.leg = leg;
    r.row.className = 'row static wait';
    if (S.p.cx.indexOf(leg) >= 0) {
      var b = el('button', 'btn cancel', 'Снять');
      b.type = 'button';
      b.addEventListener('click', function () { markAction(leg); });
      r.row.appendChild(b);
      r.btn = b;
    }
    return r;
  }
  function renderList() {
    if (!S.p || !S.rows) return;
    var c = colors();
    Object.keys(S.rows).forEach(function (id) {
      var r = S.rows[id];
      if (r.kind === 'line') {
        var k = id;
        var canMove = movable().indexOf(k) >= 0;
        var marked = S.move && S.mark === k;
        r.row.className = 'row' + (k === S.sel ? ' sel' : '') + (marked ? ' off' : '');
        r.row.style.setProperty('--sel', lineColor(k, c));
        r.dot.style.background = marked ? c.gray : lineColor(k, c);
        r.price.textContent = px(S.cur[k]);
        r.bot.textContent = marked ? 'снимется' : botNote(k);
        r.steps.forEach(function (b) { b.disabled = !canMove; });
        r.m5.forEach(function (b) { b.disabled = !canMove || !S.m5.length; });
      } else if (r.kind === 'off') {
        r.dot.style.background = c[r.colorKey];
        if (R.LEGS.indexOf(r.key) >= 0) {
          r.price.textContent = '—';
          r.bot.textContent = S.move ? 'нет заявки' : (has(S.bot[r.key]) ? 'убрана · бот ' + px(S.bot[r.key]) : 'нет');
        } else {
          r.price.textContent = px(S.cur[r.key]);
          r.bot.textContent = pqZero() ? 'без позиции не переносятся' : 'перенос стопа и цели выключен';
        }
      } else if (r.kind === 'wait') {
        var marked = S.mark === r.leg;
        r.row.className = 'row static wait' + (marked ? ' off' : '');
        r.dot.style.background = marked ? c.gray : c.blue;
        r.bot.textContent = marked ? 'снимется' : (r.btn ? 'ждёт' : 'снять нельзя: частично исполнена или не подтверждена');
        if (r.btn) {
          r.btn.textContent = marked ? 'Не снимать' : 'Снять';
          r.btn.classList.toggle('dim', !marked && lastLegLock(r.leg));
          r.btn.setAttribute('aria-label', (marked ? 'Не снимать заявку ' : 'Снять заявку ') + r.leg);
        }
      } else if (r.colorKey) {
        r.dot.style.background = c[r.colorKey];
      }
    });
    renderLegset();
  }
  function botNote(k) {
    var b = S.bot[k], v = S.cur[k];
    if (!has(b)) return (S.legset && R.LEGS.indexOf(k) >= 0) ? 'добавлена — у бота не было' : '';
    if (S.p.m === 'p') return R.eq(b, v) ? 'как сейчас' : 'сейчас ' + px(b) + ', ' + stepsTxt(v, b);
    if (R.eq(b, v)) return 'как у бота';
    return 'бот ' + px(b) + ', ' + stepsTxt(v, b);
  }
  function stepsTxt(v, b) {
    var st = Math.round(num(R.div(R.sub(v, b), S.tick)));
    return (st > 0 ? '+' : MINUS) + Math.abs(st) + ' ' + plural(Math.abs(st), 'шаг', 'шага', 'шагов');
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

  // ------------------------------------------------------------------ набор ног (режим сетки, v=2)
  function buildLegset() {
    var box = $('legset');
    box.textContent = '';
    S.setBtns = {};
    box.hidden = !S.legset && !S.cxBar;
    if (S.cxBar) {                 // адрес v=3: «Снять Lk» у ног из cx — полосой под списком
      S.p.cx.forEach(function (k) {
        var b = el('button', 'btn', '');
        b.type = 'button';
        b.addEventListener('click', function () { markAction(k); });
        box.appendChild(b);
        S.setBtns[k] = b;
      });
      return;
    }
    if (!S.legset) return;
    R.LEGS.forEach(function (k) {
      var b = el('button', 'btn', '');
      b.type = 'button';
      b.addEventListener('click', function () { legAction(k); });
      box.appendChild(b);
      S.setBtns[k] = b;
    });
  }
  function renderLegset() {
    if (S.cxBar && S.setBtns) {
      var moved = movedNow().length > 0;
      S.p.cx.forEach(function (k) {
        var b = S.setBtns[k], marked = S.mark === k;
        var t = marked ? 'Оставить ' + k : 'Снять ' + k;
        b.textContent = t;
        b.setAttribute('aria-label', marked ? 'Не снимать заявку ' + k : 'Снять заявку ' + k);
        b.classList.toggle('dim', !marked && (moved || lastLegLock(k)));
      });
      return;
    }
    if (!S.legset || !S.setBtns) return;
    var n = R.legsOf(S.cur).length;
    R.LEGS.forEach(function (k) {
      var b = S.setBtns[k];
      var t = has(S.cur[k]) ? 'Убрать ' + k : (has(S.bot[k]) ? 'Вернуть ' + k : 'Добавить ' + k);
      b.textContent = t;
      b.setAttribute('aria-label', t);
      b.classList.toggle('dim', has(S.cur[k]) && n <= 1);       // последнюю ногу не убрать
    });
  }
  function legAction(k) {
    stopRepeat();
    if (has(S.cur[k])) {
      var legs = R.legsOf(S.cur);
      if (legs.length <= 1) { setStatus('Нужна хотя бы одна заявка.'); return; }
      S.cur[k] = null;
      if (S.sel === k) {
        var i = legs.indexOf(k);
        S.sel = legs[i + 1] || legs[i - 1];                  // соседняя нога
      }
      haptic();
      buildList();
      changed();
      setStatus(k + ' убрана — риск сетки делится на оставшиеся заявки.');
      return;
    }
    var r = R.addStart(S.d, k, S.cur, S.bot, S.imp, S.tick);
    if (r[0] === null) { setStatus(r[1].charAt(0).toUpperCase() + r[1].slice(1) + '.'); return; }
    S.cur[k] = r[0];
    S.sel = k;
    haptic();
    buildList();
    changed();
    setStatus(k + (has(S.bot[k]) ? ' возвращена: ' : ' добавлена: ') + px(r[0]) + ' — двигайте ▲▼.');
  }

  // ------------------------------------------------------------------ снять заявку (режим позиции, v=2)
  /** У сетки без позиции с двумя ждущими заявками после отметки одной вторая — последняя. */
  function lastLegLock(k) {
    return !!S.mark && S.mark !== k && pqZero() && S.p.w.length <= 2;
  }
  function markAction(k) {
    if (S.move) {                  // адрес v=3: сдвиг или снятие — что-то одно (rules.moveExcl)
      var ex = R.moveExcl(S.p, S.cur, S.mark, ['mark', k]);
      if (ex.length) {
        var t = ex[0][1];
        setStatus(ex[0][0] === 'E_EXCL_MOVED' ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : 'Нельзя: ' + t + '.');
        return;
      }
    }
    if (S.mark === k) {
      S.mark = null;
      setStatus(k + ' не снимается.');
      if (S.move && !S.sel) S.sel = movable()[0] || null;
    } else {
      if (lastLegLock(k)) { setStatus('Нельзя: это последняя заявка, позиции нет.'); return; }
      var errs = R.checkLegCancel(S.p, k);
      if (errs.length) { setStatus('Нельзя: ' + errs[0][1] + '.'); return; }
      var prev = S.mark;
      S.mark = k;
      setStatus(prev ? 'Снимется ' + k + ' — отметка с ' + prev + ' снята.' : 'Снимется ' + k + '.');
    }
    haptic();
    changed();
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
  /** Адрес v=3 и отмечена нога: линии не двигаются (кнопки неактивны; это — для клавиатуры). */
  function lineLocked() {
    if (!S.move || !S.mark) return false;
    setStatus('Отмечена ' + S.mark + ' к снятию — линии не двигаются; снимите отметку, чтобы сдвигать.');
    return true;
  }
  function nudge(k, dir) {
    if (!has(S.cur[k]) || lineLocked()) return;
    S.sel = k;
    var v = R.add(S.cur[k], R.muli(S.tick, dir));
    if (R.cmp(v, R.ZERO) <= 0) return;
    S.cur[k] = v;
    haptic();
    changed();
  }
  function jump(k, up) {
    if (!has(S.cur[k]) || lineLocked()) return;
    S.sel = k;
    // v=3 (сдвиг заявок): уровень упирается в соседнюю ногу — «половина пути» до неё, как стрелки бота
    var v = S.move ? R.stepMoveLevel(S.d, S.cur, k, S.m5, up, S.tick) : R.stepLevel(S.m5, S.cur[k], up);
    if (v === null) { setStatus(up ? 'Выше уровней M5 нет.' : 'Ниже уровней M5 нет.'); renderList(); return; }
    S.cur[k] = v;
    haptic();
    changed();
  }
  function changed() {
    var dirty = R.LINES.some(function (k) { return !sameQ(S.cur[k], S.start[k]); }) || S.mark !== S.startMark ||
      riskDirty();
    if (dirty !== S.dirty && IN_TG && ver('6.2')) {
      try { if (dirty) TG.enableClosingConfirmation(); else TG.disableClosingConfirmation(); } catch (e) { /* нет */ }
    }
    S.dirty = dirty;
    $('sendErr').hidden = true;
    renderList();
    renderRisk();
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
    R.LINES.forEach(function (k) { if (has(S.cur[k])) out.push(num(S.cur[k])); });
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
    var own = S.p.m === 'g' ? R.LINES.filter(function (k) { return has(S.cur[k]); })
      : (S.move ? R.LINES.filter(function (k) { return has(S.cur[k]) && k !== S.mark; }) : ['SL', 'TP']);
    own.forEach(function (k) {
      want['own:' + k] = { price: num(S.cur[k]), color: lineColor(k, c), lineWidth: k === S.sel ? 3 : 2,
        lineStyle: k === 'TP' ? LS.Dashed : LS.Solid, axisLabelVisible: true,
        title: isAdded(k) && S.legset ? k + '+' : SHORT[k] };
    });
    R.LINES.forEach(function (k) {
      var b = S.bot[k];
      if (!b) return;
      if (S.move) {                // v=3: прежнее место сдвинутой линии и отмеченная к снятию нога
        if (k === S.mark) {
          want['bot:' + k] = { price: num(b), color: c.gray, lineWidth: 1, lineStyle: LS.Dotted,
            axisLabelVisible: false, title: k + ' снимется' };
        } else if (has(S.cur[k]) && !R.eq(b, S.cur[k])) {
          want['bot:' + k] = { price: num(b), color: c.gray, lineWidth: 1, lineStyle: LS.Dotted,
            axisLabelVisible: false, title: (R.LEGS.indexOf(k) >= 0 ? '' : SHORT[k] + ' ') + 'было ' + px(b) };
        }
        return;
      }
      if (has(S.cur[k]) && R.eq(b, S.cur[k])) return;
      if (S.p.m === 'p' && R.LEGS.indexOf(k) >= 0) return;          // ноги позиции — ниже
      var gone = S.p.m === 'g' && !has(S.cur[k]);
      want['bot:' + k] = { price: num(b), color: c.gray, lineWidth: 1, lineStyle: LS.Dotted,
        axisLabelVisible: false, title: 'бот ' + SHORT[k] + (gone ? ' (убрана)' : '') };
    });
    if (S.p.m === 'p' && !S.move) {
      S.wq.forEach(function (x) {
        var marked = S.mark === x[2];
        want['wait:' + x[2]] = { price: num(x[1]), color: marked ? c.gray : c.blue, lineWidth: 1, lineStyle: LS.Dotted,
          axisLabelVisible: false, title: x[2] + (marked ? ' снимется' : ' ждёт') };
      });
      if (S.pa && !pqZero()) {
        want.avg = { price: num(S.pa), color: c.gray, lineWidth: 1, lineStyle: LS.Solid,
          axisLabelVisible: false, title: 'средняя' };
      }
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
    movable().forEach(function (k) {
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
    if (R.cmp(v, R.ZERO) <= 0 || !has(S.cur[dr.k]) || R.eq(v, S.cur[dr.k])) return;
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
})(typeof window !== 'undefined' ? window : globalThis);
