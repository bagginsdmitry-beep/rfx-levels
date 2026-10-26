/* trade.js — страница «Сделка» мини-приложения (SPEC_C2 §2, §4, §8; бот 2.1, страница 19.0; 19.1 — бот 2.3).
 *
 * Режим n («Сделка SOL»): график M5 (кнопка H1), лонг или шорт, по рынку или лимитной заявкой; линии «Вход» (у
 * лимитки), «Стоп», «Цель» — пальцем, ▼▲ — на шаг, ⤓⤒ — к уровню по правилу стрелок бота; риск 0.5 / 1 / 2 % и
 * сумма; объём, риск, R цели, комиссии, фандинг и остаток дня — тем же правилом, что manual_rules бота
 * (trade_rules.js). «Отправить» → Telegram.WebApp.sendData (данные версии 4); бот отвечает обычным
 * подтверждением, вход — только кнопкой «Подтвердить» в чате.
 *
 * Режим q («Ручная 12 SOL», открытая и частично исполненная сделка): стоп и цель позиции пальцем, «Без цели»,
 * «Поставить цель»; риск до стопа, R при цели от средней, безубыток; проверки «Перенести» бота. «Отправить» → бот
 * присылает панель «стоп и цель» с кнопкой «Перенести». Ждущая лимитка (Ч3) — позже.
 *
 * Страница ничего не делает на бирже. Сеть: только публичные свечи и тикер api.bybit.com. Ничего не хранит в
 * браузере (ни хранилища, ни куки), никуда ничего не отправляет, кроме sendData в чат бота.
 *
 * В начале — проверка версии файлов (TradeGuard): смесь trade.html, trade_rules.js и trade.js разных версий из
 * кэша → «Страница обновляется», боту ничего не уходит. Самопроверка (trade_selftest.html, Deno) берёт только её
 * и надписи (TradeGuard.labels).
 *
 * 19.1 (бот 2.3, решение владельца 2026-10-25): метка ручной сделки — заголовок режима q «Ручная сделка 12 · ЛОНГ
 * SOLUSDT», надпись кнопки внизу экрана «Ручная 12 SOL» (было «Р12 · …», «Р12 SOL»), как у бота
 * (manual_messages.trade_head, kb_trade_label). Расчёты, адрес и данные для бота — те же, что в 19.0.
 * Доводка 2.3 (тот же номер 19.1): надпись длиннее 30 знаков укорачивается по словам, без «…» (как fit_label бота).
 *
 * 19.2 (бот 2.4, SPEC_C3 §3–§4 — решения владельца «со всеми рекомендациями согласен… работа в полном объёме»):
 * режим n — вход «Пробой» (кнопка вида входа, если адрес говорит, что он включён: em с «b»): линии «Уровень» (пальцем,
 * ▼▲, ⤓⤒ — уровни M5 за ценой не ближе bg шагов) и «предел» (предел цены от уровня), стоп и цель; бот отвечает
 * подтверждением пробоя с кнопкой «Поставить». Режим q — вторая цель (линия «Цель 2» и доля; адрес: w2, wd, t2) и
 * трейлинг Bybit (линии «Включение» и «Трейлинг» — цена включения и расстояние, кнопки R; адрес: ya…ym, yt, yp) открытой
 * сделки; одна правка за раз — стоп и цель, цель 2 или трейлинг; бот отвечает панелью чата с «Поставить» / «Включить».
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ версия файлов (как AppGuard 18.2+)
  var APP_PAGE_VERSION = '19.2';
  var GUARD_TEXT = 'Страница обновляется — закройте и откройте её через минуту.';
  var REQUIRED_IDS = ['app', 'title', 'subtitle', 'banners', 'fatal', 'main', 'errs', 'modeBar', 'sideBar',
    'kindBar', 'chartWrap', 'chart', 'chartMsg', 'summary', 'tfBar', 'src', 'refresh', 'lines', 'tpBar', 'ruleBtn',
    'status', 'risk', 'calc', 'infos', 'warns', 'pageButtons', 'cancelBtn', 'sendBtn', 'sendErr', 'tvAttr',
    'c3Bar'];
  /** Пусто — файлы одной версии; иначе текст для владельца. rules — window.TradeRules (или нет), metaVer —
   *  <meta name="page-version"> (или null), hasId(id) — есть ли элемент страницы. */
  function guardText(rules, metaVer, hasId) {
    if (!rules || rules.PAGE_VERSION !== APP_PAGE_VERSION) return GUARD_TEXT;
    if (metaVer !== APP_PAGE_VERSION) return GUARD_TEXT;
    for (var i = 0; i < REQUIRED_IDS.length; i++) if (!hasId(REQUIRED_IDS[i])) return GUARD_TEXT;
    return '';
  }
  function baseCoin(sym) { return sym.length > 4 && /USDT$/.test(sym) ? sym.slice(0, -4) : sym; }
  /** Как manual_messages.fit_label бота (доводка 2.3: многоточия на кнопках нет): надпись длиннее 30 знаков —
   *  по словам: лишние слова с конца; число, разбитое пробелами на группы разрядов, уходит целиком; хвостовые
   *  « :·,—-» убираются; одно слово длиннее 30 — первые 30 знаков. AUDIT_231 П-3: числом считаются только группы
   *  разрядов (1–3 цифры, затем группы по 3: слово из цифр после номера сделки номер не уносит); надпись, которая с
   *  такого числа начинается и без него пуста, посимвольно не режется — ''. */
  var GROUP_HEAD = /^[+\-−]?[0-9]{1,3}$/, GROUP = /^[0-9]{3}$/, GROUP_LAST = /^[0-9]{3}(?:[.,][0-9]+)?$/;
  function fitLabel(t) {
    if (t.length <= 30) return t;
    var words = t.split(' '), out = [];
    for (var i = 0; i < words.length; i++) {
      if (out.concat([words[i]]).join(' ').length > 30) break;
      out.push(words[i]);
    }
    var grouped = out.length > 0 && out.length < words.length && GROUP_LAST.test(words[out.length]) &&
      GROUP_HEAD.test(out[out.length - 1]);
    if (grouped) {
      while (out.length && GROUP.test(out[out.length - 1])) out.pop();
      if (out.length && GROUP_HEAD.test(out[out.length - 1])) out.pop();
    }
    var s = out.join(' ').replace(/[ :·,—\-]+$/, '');
    return s || grouped ? s : t.slice(0, 30);
  }
  /** Надписи страницы (19.1): title — заголовок режима q «Ручная сделка 12 · ЛОНГ SOLUSDT» (режим n — null: там
   *  «SOLUSDT · сделка»), button — надпись кнопки внизу экрана, которой открыта страница: «Сделка SOL» (n) или
   *  «Ручная 12 SOL» (q). Как у бота: manual_messages.trade_head, kb_n_label, kb_trade_label. */
  function labels(m, k, s, d) {
    var coin = baseCoin(s);
    return { title: m === 'q' ? 'Ручная сделка ' + k + ' · ' + (d === 1 ? 'ЛОНГ' : 'ШОРТ') + ' ' + s : null,
      button: fitLabel(m === 'n' ? 'Сделка ' + coin : 'Ручная ' + k + ' ' + coin) };
  }
  root.TradeGuard = { APP_PAGE_VERSION: APP_PAGE_VERSION, GUARD_TEXT: GUARD_TEXT,
    REQUIRED_IDS: REQUIRED_IDS.slice(), guardText: guardText, labels: labels };
  if (typeof document === 'undefined' || document.querySelector('meta[name="selftest"]')) return;

  var R = window.TradeRules;
  var TG = (window.Telegram && window.Telegram.WebApp) || null;
  var LWC = window.LightweightCharts || null;
  var IN_TG = !!(TG && TG.platform && TG.platform !== 'unknown');

  var MSK_MS = 3 * 3600 * 1000, MSK_S = 10800;
  var BARS_POLL_MS = 15000, H1_POLL_MS = 60000, TICK_POLL_MS = 5000, FETCH_TIMEOUT_MS = 6000, KLINES = 300;
  var VISIBLE_BARS = 80, HIT_PX = 16, TICK_MAX_AGE_MS = 30000;
  var MINUS = '−', NBSP = ' ';
  var RX_PX = /^[0-9]{1,15}(\.[0-9]{1,20})?$/;
  var BAD_LINK = 'Ссылка повреждена — откройте заново кнопкой внизу чата бота.';
  var NO_BYBIT = 'Нет данных Bybit — правьте в чате (кнопки под карточкой).';
  var NO_PRICE = 'Нет цены Bybit — подождите или правьте в чате';
  var LINES = ['E', 'SL', 'TP'];
  var MULTI = 'Сразу отправляется одно: стоп и цель, цель 2 или трейлинг — ';
  /** Правок сразу несколько (аудит 2.4, B-7): «Как сейчас» вернёт всё, а лишнее убирают кнопки «Без цели 2» и «Без
   *  трейлинга» (если они сейчас на экране — цели 2 и трейлинга ещё нет на бирже). */
  function multiText(ch) {
    var off = [];
    if (ch.t2 && S.t2 && S.t2.avail && !has(S.t2.start)) off.push('«Без цели 2»');
    if (ch.tr && S.tr && S.tr.avail && !S.tr.live) off.push('«Без трейлинга»');
    return MULTI + (off.length ? 'уберите лишнее (' + off.join(', ') + ') или верните всё кнопкой «Как сейчас».'
      : 'верните всё кнопкой «Как сейчас» или сдвиньте линии обратно.');
  }
  /** Надпись линии: у пробоя «Уровень», у двух целей «Цель 1» (19.2). */
  function lineName(k) {
    if (k === 'E') return S.et === 'b' ? 'Уровень' : 'Вход';
    if (k === 'TP') return S.t2 && S.t2.on ? 'Цель 1' : 'Цель';
    return { SL: 'Стоп', T2: 'Цель 2', TA: 'Включение', TD: 'Трейлинг' }[k];
  }

  var S = {
    p: null, mode: null, d: 1, et: 'm', tick: null, coin: '',
    cur: { E: null, SL: null, TP: null }, start: { E: null, SL: null, TP: null }, startKind: 'none',
    rule: null, tpRule: null, tpKind: 'none', sel: 'SL', noTp: false,
    rc: null, riskDef: null, riskStr: null, riskText: '', riskBtn: null, riskUi: null,
    tf: '5', bars: { '5': [], '60': [] }, srv: { '5': 0, '60': 0 }, sw: { '5': null, '60': null },
    loaded: { '5': false, '60': false }, failed: { '5': false, '60': false }, loading: {},
    tk: null, tkFailed: false, tkLoading: false, ruleDone: false,
    chart: null, series: null, plines: {}, markers: null, shownTf: null, rows: {},
    drag: null, sent: false, dirty: false, lastHaptic: 0, statusTimer: 0, res: null,
    t2: null, tr: null                     // 19.2: вторая цель и трейлинг открытой сделки (режим q)
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
  function has(x) { return x !== null && x !== undefined; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mskDate(ms) { return new Date(ms + MSK_MS); }
  function hhmm(ms) { var t = mskDate(ms); return pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()); }
  function hhmmss(ms) { var t = mskDate(ms); return hhmm(ms) + ':' + pad(t.getUTCSeconds()); }
  function ddmm(ms) { var t = mskDate(ms); return pad(t.getUTCDate()) + '.' + pad(t.getUTCMonth() + 1); }
  function dayKey(ms) { var t = mskDate(ms); return t.getUTCFullYear() + '-' + t.getUTCMonth() + '-' + t.getUTCDate(); }
  function nowMs() { return S.tk ? S.tk.ms : Date.now(); }

  // ------------------------------------------------------------------ числа и слова для показа
  function px(q) { return has(q) ? R.fmtPx(q, S.tick) : '—'; }
  function qtyTxt(q) { return R.fmtQty(q, R.dec(S.p.qs)) + ' ' + S.coin; }
  function usdt(q) { return R.fmtUsdt(q); }
  function two(q) { return R.pyFixed(R.dec(q), 2); }                 // «0.14», «1.54» (как :.2f бота)
  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function usdtShort(q) {
    var t = R.toFixedHE(q, 2);
    if (/\.00$/.test(t)) t = t.slice(0, -3);
    var parts = t.split('.');
    return groupInt(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }
  function fmtSigned(x, k) {
    var s = Math.abs(x).toFixed(k);
    if (Number(s) === 0) return s;
    return (x > 0 ? '+' : MINUS) + s;
  }
  function rWords(q10s) { return fmtSigned(Number(q10s), 2) + ' R'; }
  function plural(n, a, b, c) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  }
  function stepsWord(n) { return n + ' ' + plural(n, 'шаг', 'шага', 'шагов'); }
  function stepsTxt(v, ref) {
    var st = Number(R.floorQ(R.div(R.sub(v, ref), S.tick)));
    return (st > 0 ? '+' : MINUS) + stepsWord(Math.abs(st));
  }
  function who(d) { return d === 1 ? 'лонга' : 'шорта'; }
  /** manual_messages._swing_src: «впадина M5 15:10», «вершина H1 24.10 18:00». */
  function swingWords(kind, tf, t) {
    var word = kind === 'h' ? 'вершина' : 'впадина';
    if (tf === 'H1' || dayKey(t) !== dayKey(nowMs())) return word + ' ' + tf + ' ' + ddmm(t) + ' ' + hhmm(t);
    return word + ' ' + tf + ' ' + hhmm(t);
  }
  function bufWords(d, n) { return n > 0 ? ' ' + (d === 1 ? MINUS : '+') + ' ' + stepsWord(n) : ''; }
  /** common.fmt_duration_ru. */
  function durationRu(s) {
    if (s < 60) return s + ' с';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' мин';
    var h = Math.floor(m / 60);
    m %= 60;
    if (h < 48) return m ? h + ' ч ' + m + ' мин' : h + ' ч';
    return Math.floor(h / 24) + ' дн ' + (h % 24) + ' ч';
  }
  function pctOfBase(q) { return R.pyFixed(R.div(R.mul(q, R.HUNDRED), R.dec(S.p.rb)), 2) + ' %'; }
  function pu(q) {   // common.fmt_pu(…, signed=False): «2.10 % (210.00 USDT)»
    var v = R.qmax(R.ZERO, q);
    return pctOfBase(v) + ' (' + usdt(v) + ')';
  }

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
  function buttonLabel() { return labels(S.mode, S.p.k, S.p.s, S.d).button; }

  // ------------------------------------------------------------------ тема
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function isDark() {
    if (IN_TG && TG.colorScheme) return TG.colorScheme === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function colors() {
    return { bg: cssVar('--bg') || '#ffffff', fg: cssVar('--fg') || '#1e2126', grid: cssVar('--grid'),
      blue: cssVar('--line-blue'), red: cssVar('--line-red'), green: cssVar('--line-green'),
      gray: cssVar('--line-gray'), btn: cssVar('--btn'), hint: cssVar('--hint') };
  }
  function lineColor(k, c) {
    return k === 'SL' || k === 'TD' ? c.red : (k === 'TP' || k === 'T2' ? c.green : c.blue);
  }
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
    if (S.p) changed(true);
  }

  // ------------------------------------------------------------------ старт
  function fatal(text, neutral) {
    var f = $('fatal'), m = $('main');
    if (f) {
      f.textContent = text;
      f.hidden = false;
      if (neutral) f.className = 'fatal banner';
    } else if (document.body) {
      document.body.textContent = text;
    }
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
    if (p.err) { fatal(p.err === 'update' ? GUARD_TEXT : BAD_LINK); return; }
    S.p = p;
    S.mode = p.m;
    S.d = p.d;
    S.tick = R.dec(p.tk);
    S.coin = baseCoin(p.s);
    if (p.m === 'q') {
      $('title').textContent = labels(p.m, p.k, p.s, p.d).title;
      if (p.st === 'w') {                              // Ч3 — позже: у ждущей лимитки страница ничего не двигает
        $('subtitle').textContent = 'лимитная заявка ждёт';
        document.title = buttonLabel();
        fatal('Правка лимитки со страницы будет позже — «Сдвинуть» в чате.', true);
        return;
      }
      $('subtitle').textContent = p.st === 'p' ? 'исполнена частично — стоп и цель' : 'стоп и цель позиции';
      S.et = p.et;
      S.cur = { E: null, SL: R.dec(p.sl), TP: R.decOrNull(p.tp) };
      S.start = { E: null, SL: S.cur.SL, TP: S.cur.TP };
      S.sel = 'SL';
      // 19.2: цель 2 и трейлинг (адрес 19.0 / 19.1 — ключей нет: только стоп и цель)
      S.t2 = { avail: R.has(p.w2), start: R.decOrNull(p.t2), on: R.has(p.t2), px: R.decOrNull(p.t2),
        pct: R.has(p.wd) ? p.wd : null, rule: null };
      S.tr = { avail: R.has(p.ya), live: R.has(p.yt), on: R.has(p.yt), dist: R.decOrNull(p.yt),
        act: R.decOrNull(p.yp), startDist: R.decOrNull(p.yt), startAct: R.decOrNull(p.yp) };
    } else {
      $('title').textContent = p.s + ' · сделка';
      $('subtitle').textContent = 'только демо';
      S.et = p.em.charAt(0);                          // m, l или b (19.2: пробой)
      S.rc = p.rc;
      S.riskDef = R.riskFloor(p.rk);
      S.riskBtn = { usdt: S.riskDef, str: null };
    }
    document.title = buttonLabel();
    if (!IN_TG) banner('Откройте из Telegram — здесь можно только посмотреть.', 'warn');
    if (!LWC) banner('График не загрузился — двигайте линии кнопками.', 'warn');

    $('main').hidden = false;
    setupButtons();
    setupChart();
    buildModeBar();
    buildTfBar();
    buildLines();
    buildTpBar();
    buildRisk();
    ['pointerup', 'pointercancel', 'blur'].forEach(function (t) { window.addEventListener(t, stopRepeat); });
    document.addEventListener('visibilitychange', stopRepeat);
    applyTheme();
    loadTicker();
    loadBars('5', true);
    loadBars('60', true);
    setInterval(function () { if (document.visibilityState === 'visible') loadTicker(); }, TICK_POLL_MS);
    setInterval(function () { if (document.visibilityState === 'visible') loadBars('5'); }, BARS_POLL_MS);
    setInterval(function () { if (document.visibilityState === 'visible') loadBars('60'); }, H1_POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { loadTicker(); loadBars('5'); }
    });
  }

  // ------------------------------------------------------------------ кнопки Telegram и страницы
  function setupButtons() {
    if (IN_TG) {
      TG.MainButton.setText('Отправить');
      TG.MainButton.onClick(send);
      TG.MainButton.show();
      if (ver('7.10') && TG.SecondaryButton) {
        TG.SecondaryButton.setText('Отмена');
        TG.SecondaryButton.onClick(closeApp);
        TG.SecondaryButton.show();
        $('pageButtons').hidden = true;
      } else {
        $('sendBtn').hidden = true;
      }
    }
    $('sendBtn').addEventListener('click', send);
    $('cancelBtn').addEventListener('click', closeApp);
    $('refresh').addEventListener('click', function () { loadTicker(true); loadBars('5', false, true); loadBars('60'); });
    $('ruleBtn').textContent = S.mode === 'n' ? 'По правилу бота' : 'Как сейчас';
    $('ruleBtn').addEventListener('click', function () {
      stopRepeat();
      if (S.mode === 'n') {
        if (!applyRule()) { setStatus('Правило ждёт цену и свечи Bybit.'); return; }
        setStatus((S.et === 'b' ? 'Уровень, стоп и цель' : 'Стоп, цель' + (S.et === 'l' ? ' и цена заявки' : '')) +
          ' — по правилу бота.');
      } else {
        S.cur.SL = S.start.SL;
        S.cur.TP = S.start.TP;
        S.noTp = false;
        if (S.t2) { S.t2.on = R.has(S.t2.start); S.t2.px = S.t2.start; S.t2.pct = R.has(S.p.wd) ? S.p.wd : null; }
        if (S.tr) { S.tr.on = S.tr.live; S.tr.dist = S.tr.startDist; S.tr.act = S.tr.startAct; }
        buildLines();
        setStatus('Стоп, цель' + (S.t2 && (S.t2.avail || R.has(S.t2.start)) ? ', цель 2' : '') +
          (S.tr && (S.tr.avail || S.tr.live) ? ' и трейлинг' : '') + ' — как сейчас.');
      }
      changed();
    });
  }
  function dataReady() { return !!S.tk && S.loaded['5']; }
  function canSend(payload) { return IN_TG && !S.sent && dataReady() && !!payload; }
  function updateButtons(payload) {
    var ok = canSend(payload);
    $('sendBtn').disabled = !ok;
    if (IN_TG) {
      var tp = TG.themeParams || {};
      try {
        TG.MainButton.setParams({ is_active: ok, color: ok ? (tp.button_color || colors().btn) : (tp.hint_color || '#9aa1ab'),
          text_color: tp.button_text_color || '#ffffff' });
      } catch (e) { /* старый клиент */ }
    }
  }
  function send() {
    var res = compute(true);
    S.res = res;
    if (!canSend(res.payload)) { updateButtons(res.payload); return; }
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
    updateButtons(res.payload);
  }
  function showSendErr(text) { $('sendErr').textContent = text; $('sendErr').hidden = false; }
  function setStatus(text) {
    $('status').textContent = text;
    clearTimeout(S.statusTimer);
    S.statusTimer = setTimeout(function () { $('status').textContent = ''; }, 3500);
  }

  // ------------------------------------------------------------------ переключатели
  function segButton(box, text, on, fn, aria) {
    var b = el('button', 'btn' + (on ? ' on' : ''), text);
    b.type = 'button';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', fn);
    box.appendChild(b);
    return b;
  }
  function buildModeBar() {
    var side = $('sideBar'), kind = $('kindBar');
    side.textContent = '';
    kind.textContent = '';
    if (S.mode !== 'n') { $('modeBar').hidden = true; return; }
    segButton(side, 'Лонг' + (S.d === 1 ? ' ✓' : ''), S.d === 1, function () { setSide(1); }, 'Лонг');
    segButton(side, 'Шорт' + (S.d === -1 ? ' ✓' : ''), S.d === -1, function () { setSide(-1); }, 'Шорт');
    var em = S.p.em;
    var KIND = { m: ['Рынок', 'Вход по рынку'], l: ['Лимит', 'Лимитная заявка'], b: ['Пробой', 'Вход при пробое'] };
    var ONE = { m: 'По рынку', l: 'Лимитная заявка', b: 'Вход при пробое' };
    kind.classList.toggle('three', em.length >= 3);
    if (em.length >= 2) {
      em.split('').forEach(function (x) {
        segButton(kind, KIND[x][0] + (S.et === x ? ' ✓' : ''), S.et === x, function () { setKind(x); }, KIND[x][1]);
      });
    } else {
      segButton(kind, ONE[em], true, function () { /* один вид */ });
    }
  }
  function setSide(d) {
    if (S.d === d) return;
    S.d = d;
    buildModeBar();
    applyRule();
    buildLines();
    changed();
    setStatus((d === 1 ? 'Лонг' : 'Шорт') + ': стоп и цель — по правилу бота.');
  }
  function setKind(et) {
    if (S.et === et) return;
    S.et = et;
    buildModeBar();
    applyRule();
    buildLines();
    changed();
    setStatus(et === 'l' ? 'Лимитная заявка: цена, стоп и цель — по правилу бота.'
      : (et === 'b' ? 'Вход при пробое: уровень, стоп и цель — по правилу бота.' : 'По рынку: стоп и цель — по правилу бота.'));
  }
  function buildTfBar() {
    var box = $('tfBar');
    box.textContent = '';
    segButton(box, 'M5' + (S.tf === '5' ? ' ✓' : ''), S.tf === '5', function () { setTf('5'); }, 'Свечи M5');
    segButton(box, 'H1' + (S.tf === '60' ? ' ✓' : ''), S.tf === '60', function () { setTf('60'); }, 'Свечи H1');
  }
  function setTf(tf) {
    if (S.tf === tf) return;
    S.tf = tf;
    buildTfBar();
    showBars(true);
    renderSrc();
  }

  // ------------------------------------------------------------------ правило бота (стоп, цель, цена лимитки)
  function levelsM5() { return R.levelsOf([S.sw['5']]); }
  function levelsAll() { return R.levelsOf([S.sw['5'], S.sw['60']]); }
  function ruleReady() { return !!S.tk && (S.loaded['5'] || S.failed['5']) && (S.loaded['60'] || S.failed['60']); }
  /** Цель «Вершина» (у шорта «Впадина») по правилу бота от стопа S и цены расчёта (C1 §12.3, beyond — рынок). */
  function swingTarget(stop, E) {
    if (!S.tk || !has(stop)) return null;
    var p = S.p, d = S.d, limit = S.et === 'l', bk = S.et === 'b';
    var ref = R.refPrice(d, S.tk.bid, S.tk.ask);
    if (bk && !has(E)) return null;
    var P = limit ? E : R.priceLimit(d, bk ? E : ref, stop, S.tick, p.sm, R.dec(p.sf));
    if (!has(P)) return null;
    return R.defaultTarget(d, P, stop, { tick: S.tick, m5: S.sw['5'], h1: S.sw['60'], tb: p.tb, minR: R.dec(p.t1),
      beyond: ref });
  }
  /** Стоп, цель и цена лимитки по правилу на текущих свечах и цене — один раз: при открытии, смене стороны и
   *  вида входа и по кнопке «По правилу бота»; со сменой цены сами не прыгают. */
  function applyRule() {
    if (S.mode !== 'n' || !ruleReady()) return false;
    var p = S.p, d = S.d, limit = S.et === 'l', bk = S.et === 'b';
    var bid = S.tk.bid, ask = S.tk.ask;
    var E = limit ? R.defaultEntry(d, levelsM5(), bid, ask, S.tick)
      : (bk ? R.defaultBreakout(d, S.sw['5'], lastPrice(), S.tick, p.bg) : null);
    var ins = R.instN(p, limit);
    var sp = R.defaultStop(d, { et: limit ? 'limit' : (bk ? 'breakout' : 'market'), bid: bid, ask: ask, tick: S.tick,
      fin: ins.fin, fout: ins.fout, m5: S.sw['5'], h1: S.sw['60'], E: E, rule: R.ruleN(p) });
    var tp = null, kind = 'none';
    if (p.td === 'swing' && sp.stop) {
      tp = swingTarget(sp.stop, E);
      kind = tp && tp.target ? 'swing' : 'none';
    } else if (p.td === '2r' || p.td === '3r') {
      kind = 'r' + p.td.charAt(0);
    }
    S.rule = { E: E, stop: sp, entryLevel: E !== null && (bk ? (S.sw['5'] ? (d === 1 ? S.sw['5'].highs : S.sw['5'].lows) : [])
      .some(function (x) { return R.eq(R.breakoutLevel(x.px, d, S.tick), E); })
      : levelsM5().some(function (x) { return R.eq(R.priceForDirection(x, S.tick, d), E); })) };
    S.tpRule = tp;
    S.cur = { E: E, SL: sp.stop, TP: tp && tp.target ? tp.target : null };
    S.tpKind = kind;
    S.start = { E: S.cur.E, SL: S.cur.SL, TP: S.cur.TP };
    S.startKind = kind;
    S.ruleDone = true;
    return true;
  }

  // ------------------------------------------------------------------ расчёт
  function tickerFresh() { return !!S.tk && Date.now() - S.tk.at <= TICK_MAX_AGE_MS; }
  /** Последняя цена (по ней срабатывает пробой и идёт трейлинг); нет — опорная. */
  function lastPrice() {
    if (!S.tk) return null;
    if (S.tk.last && R.cmp(S.tk.last, R.ZERO) > 0) return S.tk.last;
    var d = S.mode === 'n' ? S.d : S.p.d;
    return R.refPrice(d, S.tk.bid, S.tk.ask);
  }
  function tpMode() {
    if (S.tpKind === 'r2' || S.tpKind === 'r3') return S.tpKind;
    if (S.tpKind === 'none' || !has(S.cur.TP)) return 'none';
    return 'fixed';
  }
  function stateN() {
    var fresh = tickerFresh();
    return { d: S.d, et: S.et, E: S.cur.E, S: S.cur.SL, T: tpMode() === 'fixed' ? S.cur.TP : null, tp: tpMode(),
      risk: S.riskStr, bid: fresh ? S.tk.bid : null, ask: fresh ? S.tk.ask : null,
      last: fresh && S.tk.last ? S.tk.last : null, tms: S.tk ? S.tk.ms : null,
      fr: S.tk ? S.tk.fr : null, fn: S.tk ? S.tk.fn : null };
  }
  /** Откуда стоп и цель (ks, kt данных): стоп по правилу — пока цена совпадает с правилом; цель — так же. */
  function ksKt() {
    var sp = S.rule ? S.rule.stop : null, k0 = 'p', t0 = 0;
    if (sp && sp.stop && has(S.cur.SL) && R.eq(S.cur.SL, sp.stop)) {
      k0 = sp.src === 'swing_h1' ? 'h1' : 'm5';
      t0 = sp.level.t;
    }
    var k1, t1 = 0;
    if (S.tpKind === 'r2' || S.tpKind === 'r3') k1 = S.tpKind;
    else if (tpMode() === 'none') k1 = '0';
    else if (S.tpRule && S.tpRule.target && R.eq(S.cur.TP, S.tpRule.target)) {
      k1 = S.tpRule.src === 'swing_h1' ? 'h1' : 'm5';
      t1 = S.tpRule.level.t;
    } else k1 = 'p';
    return { ks: [k0, k1], kt: [t0, t1] };
  }
  function platform() { return IN_TG ? TG.platform : 'unknown'; }
  function compute() {
    var res = { mode: S.mode, c: null, payload: null };
    if (S.mode === 'n') {
      var st = stateN();
      res.c = R.calcN(S.p, st);
      if (res.c.refusal === null && S.ruleDone && dataReady()) {
        var k = ksKt();
        var pst = {};
        Object.keys(st).forEach(function (key) { pst[key] = st[key]; });
        pst.ks = k.ks;
        pst.kt = k.kt;
        pst.tf = S.tf;
        pst.pl = platform();
        pst.t = Date.now();
        res.payload = R.buildPayloadN(S.p, pst);
      }
    } else {
      var fresh = tickerFresh();
      var stq = { S: S.cur.SL, T: S.noTp ? null : S.cur.TP, bid: fresh ? S.tk.bid : null, ask: fresh ? S.tk.ask : null,
        last: fresh && S.tk.last ? S.tk.last : null, tf: S.tf, pl: platform(), t: Date.now() };
      res.c = R.calcQ(S.p, stq);
      res.ch = qChanges();
      if (S.t2 && S.t2.on && has(S.t2.px)) {
        res.t2 = R.calcT2(S.p, { T2: S.t2.px, pct: S.t2.pct, bid: stq.bid, ask: stq.ask });
      }
      if (S.tr && S.tr.on && has(S.tr.dist)) {
        res.tr = R.calcTrail(S.p, { dist: S.tr.dist, act: S.tr.act, bid: stq.bid, ask: stq.ask, last: stq.last });
      }
      if (dataReady() && res.ch.n === 1) {
        if (res.ch.t2) stq.t2 = { T2: S.t2.px, pct: S.t2.pct };
        if (res.ch.tr) stq.tr = { dist: S.tr.dist, act: S.tr.act };
        res.payload = R.buildPayloadQ(S.p, stq);
      }
    }
    return res;
  }
  /** Что сдвинуто в режиме q (19.2: стоп и цель, цель 2, трейлинг — отправляется одно). */
  function qChanges() {
    var tpsl = !R.sameQ(S.cur.SL, S.start.SL) || !R.sameQ(S.cur.TP, S.start.TP) || S.noTp;
    var t2 = !!(S.t2 && S.t2.avail && S.t2.on && has(S.t2.px) && (!has(S.t2.start) || !R.eq(S.t2.px, S.t2.start)));
    var tr = !!(S.tr && S.tr.avail && S.tr.on && has(S.tr.dist) && (!S.tr.live || !R.sameQ(S.tr.dist, S.tr.startDist) ||
      !R.sameQ(S.tr.act, S.tr.startAct)));
    return { tpsl: tpsl, t2: t2, tr: tr, n: (tpsl ? 1 : 0) + (t2 ? 1 : 0) + (tr ? 1 : 0) };
  }
  /** Цель, которая сейчас на графике и в строке: у 2R/3R — посчитанная планом. */
  function shownTP(res) {
    if (S.mode === 'q') return S.noTp ? null : S.cur.TP;
    if ((S.tpKind === 'r2' || S.tpKind === 'r3') && res && res.c && res.c.plan) return res.c.plan.target;
    return tpMode() === 'none' ? null : S.cur.TP;
  }
  function changed(soft) {
    var dirty;
    if (S.mode === 'n') {
      dirty = LINES.some(function (k) { return !R.sameQ(S.cur[k], S.start[k]); }) || S.tpKind !== S.startKind ||
        S.riskStr !== null;
    } else {
      dirty = qChanges().n > 0 || !!(S.t2 && S.t2.on && !has(S.t2.start)) || !!(S.tr && S.tr.on && !S.tr.live);
    }
    if (dirty !== S.dirty && IN_TG && ver('6.2')) {
      try { if (dirty) TG.enableClosingConfirmation(); else TG.disableClosingConfirmation(); } catch (e) { /* нет */ }
    }
    S.dirty = dirty;
    if (!soft) $('sendErr').hidden = true;
    recalc();
  }
  function recalc() {
    var res = compute();
    S.res = res;
    var view = S.mode === 'n' ? viewN(res) : viewQ(res);
    fill('errs', view.errs);
    fill('warns', view.warns);
    fill('infos', view.infos);
    var calc = $('calc');
    calc.textContent = '';
    view.calc.forEach(function (x) { calc.appendChild(el('div', x[1] || '', x[0])); });
    var sm = $('summary');
    sm.textContent = view.summary[0];
    sm.className = 'summary' + (view.summary[1] ? ' muted' : '');
    renderLines(res);
    renderTpBar(res);
    renderC3Bar();
    renderRisk();
    syncLines(res);
    updateButtons(res.payload);
  }
  function fill(id, items) {
    var ul = $(id);
    ul.textContent = '';
    items.forEach(function (t) { ul.appendChild(el('li', '', t)); });
  }

  // ------------------------------------------------------------------ тексты режима n (слова — по образцу бота)
  function refusalText(r) {
    var code = r[0], n = r[1], d = S.d;
    switch (code) {
      case 'et_off': return S.et === 'm' ? 'Вход по рынку выключен ([manual] market = false).'
        : (S.et === 'b' ? 'Вход при пробое выключен ([manual] stop_entry = false).'
          : 'Вход лимитной заявкой выключен ([manual] limit = false).');
      case 'no_price': return S.tkFailed && !S.tk ? NO_BYBIT : NO_PRICE;
      case 'risk_input': return 'Сумма риска — цифры и точка, не больше двух знаков после точки (например, 150 или 49.5).';
      case 'no_entry': return S.et === 'b' ? 'Поставьте уровень пробоя' : 'Поставьте цену заявки';
      case 'no_stop': return 'Поставьте стоп';
      case 'stop_side':
        if (n.bk) return 'Стоп ' + who(d) + ' должен быть ' + (d === 1 ? 'ниже' : 'выше') + ' уровня пробоя ' + px(R.dec(n.at));
        return 'Стоп ' + who(d) + ' должен быть ' + (d === 1 ? 'ниже' : 'выше') + ' цены ' +
          (n.limit ? 'заявки ' : '') + px(R.dec(n.at));
      case 'level':                 // 19.2 (C3c1 §4.2): уровень пробоя за последней ценой
        if (n.gap === 'side') return 'Уровень пробоя ' + who(d) + ' — ' + (d === 1 ? 'выше' : 'ниже') + ' текущей цены ' +
          px(R.dec(n.at));
        return 'Цена уже у уровня ' + px(S.cur.E) + ' (сейчас ' + px(R.dec(n.at)) + ') — это вход по рынку';
      case 'stop_close':
        if (n.kind === 'fee') return 'Стоп слишком близко: комиссии ' + n.pct + ' % риска';
        return 'Стоп слишком близко: ' + stepsWord(n.n) + ' до цены (нужно не меньше ' + n.need + ')';
      case 'stop_far': return 'Стоп дальше ' + R.fmtPlain(R.dec(n.lim)) + ' % (' + two(n.pct) + ' %) — проверьте цену';
      case 'tp_side':
        if (n.zero) return (n.src === 'r2' ? 'Цель 2R' : n.src === 'r3' ? 'Цель 3R' : 'Цель') +
          ' не выше нуля — выберите другую цель';
        return 'Цель ' + who(d) + ' должна быть ' + (d === 1 ? 'выше' : 'ниже') + ' ' + px(R.dec(n.at));
      case 'min_lot':
        if (n.size === 'min_lot') return 'Объём меньше минимального лота: риск стал бы ' + usdt(R.dec(n.risk_need));
        if (n.size === 'zero') return 'Объём получился нулевым';
        if (n.size === 'bad_stop') return 'Стоп не с той стороны цены';
        return 'Объём не сложился';
      case 'entry_side':
        if (n.beyond) {
          var bkOn = S.p.em.indexOf('b') >= 0;     // 19.2: пробой — своя кнопка вида входа
          var how = bkOn ? ': кнопка «Пробой» выше' : ' (выключен)';
          return d === 1 ? 'Выше цены — это вход при пробое' + how + '. Лимитная заявка лонга — ниже текущей цены.'
            : 'Ниже цены — это вход при пробое' + how + '. Лимитная заявка шорта — выше текущей цены.';
        }
        return 'Цена заявки уже за рынком — PostOnly не встанет: для ' + who(d) + ' ' + (d === 1 ? 'ниже' : 'выше') + ' ' +
          px(R.dec(n.at));
      case 'risk_limits': return riskLimitsErr();
      default: return 'Не отправлю: ' + code;
    }
  }
  function warnText(w) {
    var n = w[1];
    switch (w[0]) {
      case 'fee_share': return 'Стоп близко: комиссии ' + n.pct + ' % риска (' + two(n.r) + ' R)';
      case 'stop_far_warn': return 'Далёкий стоп ' + two(n.pct) + ' %: объём маленький';
      case 'spread': return 'Тонкий рынок: спред ' + two(n.pct) + ' %';
      case 'notional': return 'Номинал ' + R.fmtPlain(R.dec(n.bases), 1) + ' базы (' + R.fmtInt(R.intQ(n.whole)) + ' USDT)';
      default: return w[0];
    }
  }
  function basesTxt(notional) {
    var v = R.div(notional, R.dec(S.p.rb));
    return R.cmp(v, R.Q(1n, 20n)) < 0 ? 'меньше 0.1 базы' : R.fmtPlain(v, 1) + ' базы';
  }
  function riskPctLabel(q) { return R.riskPctLabel(R.riskPctExact(q, S.p.rb)); }
  function viewN(res) {
    var c = res.c, p = S.p, d = S.d, v = { errs: [], warns: [], infos: [], calc: [], summary: ['', true] };
    if (!dataReady()) {
      if (S.tkFailed && !S.tk || S.failed['5'] && !S.loaded['5']) v.errs.push(NO_BYBIT);
      v.summary = [S.tkFailed || S.failed['5'] ? 'Нет данных Bybit' : 'Загружаю цену и свечи Bybit…', true];
      return v;
    }
    if (c.refusal) v.errs.push(refusalText(c.refusal));
    c.warns.forEach(function (w) { v.warns.push(warnText(w)); });
    var pl = c.plan;
    // правила цели нет (вершины волны дальше 1 R нет) — «Без цели» и строка C1 §12.3
    if (S.tpKind === 'none' && p.td === 'swing' && S.tpRule && !S.tpRule.target) v.infos.push(noTargetLine(d));
    if (!pl || !R.okSize(pl) || c.refusal) {
      v.summary = [c.refusal ? 'Расчёт — после исправления строки выше' : '—', true];
      if (pl && pl.stop === null && S.ruleDone) v.infos.push(noStopHint());
      return v;
    }
    var sz = pl.size, ex = c.extra, risk = c.risk;
    var rT = pl.rTarget !== null ? R.q10(pl.rTarget) : null;
    v.summary = [qtyTxt(sz.qty) + ' · риск ' + R.toFixedHE(sz.riskPlan, 2) + ' · ' +
      (pl.target !== null ? 'цель ' + (rT !== null ? rWords(rT) : px(pl.target)) : 'без цели'), false];
    v.calc.push(['Объём ' + qtyTxt(sz.qty) + ' · номинал ' + R.fmtInt(sz.notional) + ' USDT (' + basesTxt(sz.notional) + ')', 'main']);
    var want = R.pyFixed(risk, 2);
    if (sz.bumped) v.calc.push(['Объём поднят до минимального лота: риск ' + usdt(sz.riskPlan) + ' вместо ' + want]);
    else if (sz.capped === 'notional') {
      var cap = R.dec(p.cap);
      v.calc.push(['Объём урезан пределом номинала ' + R.fmtPlain(R.div(cap, R.dec(p.rb))) + ' баз (' + R.fmtPlain(cap) +
        ' USDT): риск ' + usdt(sz.riskPlan) + ' вместо ' + want]);
    } else if (sz.capped === 'max_qty') {
      v.calc.push(['Объём урезан пределом объёма заявки биржи (' + qtyTxt(R.dec(pl.limit ? p.xl : p.xm)) + '): риск ' +
        usdt(sz.riskPlan) + ' вместо ' + want]);
    }
    v.calc.push(['Риск ' + usdt(sz.riskPlan) + ' = ' + riskPctLabel(risk) + ' % от ' + R.fmtPlain(R.dec(p.rb)) +
      ' — до стопа с комиссиями' + (pl.limit ? '' : (pl.breakout ? ' от предела ' : ' при цене ') + px(pl.price)), 'main']);
    var feesR = R.cmp(sz.riskPlan, R.ZERO) > 0 ? R.q10(R.div(pl.fees, sz.riskPlan)) : '0';
    var feeWord = pl.limit ? 'комиссии: вход мейкер и выход по стопу ' : 'комиссии входа и выхода по стопу ';
    v.calc.push([(pl.target !== null ? 'При цели ' + (rT !== null ? rWords(rT) : '—') : 'Без цели: на бирже только стоп') +
      ' · ' + feeWord + usdt(pl.fees) + ' = ' + two(feesR) + ' R']);
    if (pl.limit) {
      var diff = R.qabs(R.sub(pl.ref, pl.price));
      v.calc.push(['Заявка ' + (d === 1 ? 'ниже' : 'выше') + ' цены на ' + px(diff) + ' (' +
        two(R.q10(R.mul(R.div(diff, pl.ref), R.HUNDRED))) + ' %) · PostOnly: только мейкер · живёт до ' + p.ex]);
    } else if (pl.breakout) {          // 19.2: как подтверждение пробоя бота (SPEC_C3 §4.1)
      var now = lastPrice() || pl.ref, lv = pl.trigger;
      var pctBk = R.cmp(now, R.ZERO) > 0 ? R.q10(R.mul(R.div(R.sub(lv, now), now), R.HUNDRED)) : '0';
      v.calc.push(['Пробой: сработает, когда цена дойдёт до ' + px(lv) + ' (сейчас ' + px(now) + ', ' +
        fmtSigned(Number(pctBk), 2) + ' %), и ' + (d === 1 ? 'купит не дороже ' : 'продаст не дешевле ') + px(pl.price) +
        ' (предел); ' + (d === 1 ? 'дороже — не купит' : 'дешевле — не продаст')]);
      v.calc.push(['Заявка ждёт на бирже до ' + p.ex + '; в ' + p.ex + ' бот спросит: оставить или снять (без ответа — снимет в ' +
        p.ea + ')']);
    } else {
      v.calc.push(['По рынку: предел цены ' + px(pl.price) + ' — ' + (d === 1 ? 'дороже' : 'дешевле') +
        ' не исполнится, остаток не догоняю']);
    }
    if (ex.funding) {
      v.calc.push(['Фандинг через ' + durationRu(ex.funding.due_s) + ': ' + (d === 1 ? 'лонг' : 'шорт') + ' ' +
        (ex.funding.pays ? 'платит' : 'получает') + ' ≈ ' + usdt(R.dec(ex.funding.amount)) + ' (' + two(ex.funding.r) + ' R)']);
    }
    var at = hhmm(p.a);
    if (ex.stale) {
      v.infos.push('Остаток дня и пределы ручных проверит бот (данные кнопки — ' + at + ')');
    } else {
      var manual = 'ручных ' + p.no + ' → ' + ex.manual.n_after + ' из ' + p.nx;
      if (ex.room) {
        v.calc.push(['Остаток дня на ' + at + ': ' + pu(R.dec(ex.room.left)) + ' → ' + pctOfBase(R.qmax(R.ZERO, R.dec(ex.room.after))) +
          ' · ' + manual]);
      } else {
        v.calc.push([manual.charAt(0).toUpperCase() + manual.slice(1)]);
      }
      var head = 'По данным на ' + at + ' бот, скорее всего, откажет: ';
      if (ex.room && ex.room.short) {
        v.warns.push(head + 'остаток дня ' + usdt(R.dec(ex.room.left)) + ' меньше риска ' + R.toFixedHE(sz.riskPlan, 2));
      }
      if (ex.manual.short) {
        v.warns.push(head + 'риск открытых ручных станет ' + usdt(R.dec(ex.manual.after)) + ' — больше предела ' +
          usdt(R.dec(p.mx)));
      }
      if (ex.manual.full) v.warns.push(head + 'открыто ручных ' + p.no + ' из ' + p.nx);
    }
    if (ex.big) {
      v.warns.push(sz.bumped ? 'Объём поднят до минимального лота — в чате кнопка будет «Да, риск ' + usdt(sz.riskPlan) + '…»'
        : 'Риск ' + usdt(sz.riskPlan) + ' больше ' + R.fmtPlain(R.dec(p.ra)) + ' % — в чате кнопка будет «Да, риск ' +
          usdt(sz.riskPlan) + '…»');
    }
    v.calc.push(['Плечо и ликвидацию проверит бот в подтверждении', 'muted']);
    return v;
  }
  function noTargetLine(d) {
    return d === 1 ? 'Цель лонга: вершины волны дальше 1 R нет (M5 и H1) — без цели'
      : 'Цель шорта: впадины волны дальше 1 R нет (M5 и H1) — без цели';
  }
  function noStopHint() {
    var sp = S.rule && S.rule.stop;
    var where = sp && sp.searched && sp.searched.length ? sp.searched.join(' и ') : 'M5 и H1';
    var why = sp && sp.far ? 'уровня ближе ' + R.fmtPlain(sp.farPct) + ' % нет' : 'нет уровня';
    return 'Стоп по правилу: ' + why + ' (' + where + ') — поставьте его кнопками ⤓⤒ (ближайший уровень).';
  }

  // ------------------------------------------------------------------ тексты режима q
  function checkTextQ(r) {
    var n = r[1], d = S.p.d;
    switch (r[0]) {
      case 'stop_side': return 'Стоп ' + who(d) + ' должен быть ' + (d === 1 ? 'ниже' : 'выше') + ' цены ' + px(R.dec(n.at));
      case 'stop_close': return 'Стоп слишком близко к цене — стоп сработал бы сразу';
      case 'stop_far': return 'Стоп дальше ' + R.fmtPlain(R.dec(n.lim)) + ' % — проверьте цену';
      case 'tp_side': return 'Цель ' + who(d) + ' должна быть ' + (d === 1 ? 'выше' : 'ниже') + ' ' + px(R.dec(n.at));
      case 'tick': return 'Цена не на шаге цены';
      case 'no_price': return S.tkFailed && !S.tk ? NO_BYBIT : NO_PRICE;
      case 't1_beyond': return 'Цель 1 — ближе цели 2 (' + px(R.dec(n.t2)) + '); цель 2 двигайте её линией';
      default: return r[0];
    }
  }
  /** Проверки цели 2 со страницы (TradeRules.calcT2 = ManualDesk.page_t2) — слова бота. */
  function t2Text(r) {
    var n = r[1], d = S.p.d;
    switch (r[0]) {
      case 'tick': return 'Цель 2 не на шаге цены';
      case 't2_pct': return 'Доля цели 2 — одна из кнопок ниже';
      case 't2_small': return 'Две цели — позиция мала: каждая часть — не меньше лота ' + R.fmtQty(R.dec(n.lot), R.dec(S.p.qs));
      case 'no_price': return S.tkFailed && !S.tk ? NO_BYBIT : NO_PRICE;
      case 't2_side': return 'Цель 2 — дальше цели 1 (' + (d === 1 ? 'выше ' : 'ниже ') + px(R.dec(n.t1)) + ')';
      case 'tp_side': return 'Цель 2 ' + who(d) + ' должна быть ' + (d === 1 ? 'выше' : 'ниже') + ' цены ' + px(R.dec(n.at));
      case 't2_off': return 'Вторая цель со страницы сейчас недоступна — в чате «Вторая цель»';
      default: return r[0];
    }
  }
  /** Цена включения не за рынком на 2 шага (код tr_behind) — слова бота (manual_messages.trail_behind_px_text). Аудит
   *  2.4, B-3: впереди рынка, но ближе 2 шагов — «слишком близко к рынку … от 182.43», а не «уже позади». */
  function trBehindText(ac, ed) {
    var d = S.p.d, now = S.p.ya.indexOf(0) >= 0;
    if (R.cmp(R.muli(R.sub(ac, ed), d), R.ZERO) > 0) {
      return 'Цена включения ' + px(ac) + ' слишком близко к рынку (сейчас ' + px(ed) + ') — нужна ' +
        (d === 1 ? 'выше' : 'ниже') + ' хотя бы на 2 шага: от ' + px(R.add(ed, R.muli(S.tick, 2 * d))) +
        (now ? ' или «Сразу»' : '');
    }
    return 'Цена включения ' + px(ac) + ' уже позади (сейчас ' + px(ed) + ') — выберите ' +
      (now ? '«Сразу» или ' : '') + 'цену дальше от рынка';
  }
  /** Проверки трейлинга со страницы (TradeRules.calcTrail = ManualDesk.page_trail) — слова бота. */
  function trText(r) {
    var n = r[1];
    switch (r[0]) {
      case 'tick': return 'Цена включения или расстояние не на шаге цены';
      case 'tr_now_off': return '«Сразу» нет среди кнопок трейлинга — поставьте цену включения';
      case 'no_price': return S.tkFailed && !S.tk ? NO_BYBIT : NO_PRICE;
      case 'tr_far': return 'Трейлинг шире ' + R.fmtPlain(R.dec(n.lim)) + ' % цены — выберите меньшее расстояние';
      case 'tr_behind': return trBehindText(R.dec(n.active), R.dec(n.edge));
      case 'tr_zero': return 'Расстояние трейлинга не больше нуля';
      case 'tr_off': return 'Трейлинг со страницы сейчас недоступен — в чате «Трейлинг»';
      default: return r[0];
    }
  }
  function rUnits(q) { var t = R.toFixedHE(q, 2); return t.replace(/\.?0+$/, '') + ' R'; }
  function riskWords(q) { return R.cmp(q, R.Q(1n, 200n)) < 0 ? '0' : usdt(q); }
  function viewQ(res) {
    var c = res.c, p = S.p, v = { errs: [], warns: [], infos: [], calc: [], summary: ['', true] };
    if (!dataReady()) {
      if (S.tkFailed && !S.tk || S.failed['5'] && !S.loaded['5']) v.errs.push(NO_BYBIT);
      v.summary = [S.tkFailed || S.failed['5'] ? 'Нет данных Bybit' : 'Загружаю цену и свечи Bybit…', true];
    }
    var ch = res.ch || { tpsl: false, t2: false, tr: false, n: 0 };
    var c3t2 = S.t2 && (S.t2.avail || has(S.t2.start)), c3tr = S.tr && (S.tr.avail || S.tr.live);
    if (ch.n > 1) v.errs.push(multiText(ch));
    else if (ch.n === 0) {
      v.infos.push('Сдвиньте стоп' + (S.t2 && S.t2.avail ? ', цель, цель 2' : ' или цель') +
        (S.tr && S.tr.avail ? ' или трейлинг' : '') + ' — пока всё как сейчас.');
    } else if (ch.tpsl && c.check && c.check[0] !== 'no_change' && dataReady()) v.errs.push(checkTextQ(c.check));
    if (ch.t2 && res.t2 && res.t2.check && dataReady()) v.errs.push(t2Text(res.t2.check));
    if (ch.tr && res.tr && res.tr.check && dataReady() && res.tr.check[0] !== 'no_change') v.errs.push(trText(res.tr.check));
    var rNew = R.dec(c.risk_new), rOld = R.dec(c.risk_old);
    if (c.grows) v.warns.push('Стоп дальше: риск растёт на ' + usdt(R.dec(c.grow_by)) + ' — бот проверит остаток дня и предел ручных');
    if (p.lk > nowMs()) v.warns.push('Замок дня до ' + hhmm(p.lk) + ': отодвинуть стоп бот не даст; придвинуть можно');
    var T = S.noTp ? null : S.cur.TP;
    var last = S.tk ? S.tk.last : null;
    v.calc.push(['Позиция ' + qtyTxt(R.dec(p.pq)) + ', средняя ' + px(R.dec(p.pa)) + (last ? ' · сейчас ' + px(last) : '')]);
    var sl0 = R.dec(p.sl);
    v.calc.push([(c.stop_changed ? 'Стоп ' + px(sl0) + ' → ' + px(S.cur.SL) : 'Стоп ' + px(sl0) + ' как сейчас') +
      ' · риск до стопа ' + riskWords(rNew) + ' (' + pctOfBase(rNew) + '; было ' + R.toFixedHE(rOld, 2) + ')', 'main']);
    v.calc.push([(T !== null ? 'При цели ' + px(T) + ': позиция ' + rWords(c.r_tp) : (p.tp && S.noTp ? 'Цель снимется' : 'Без цели')) +
      ' · безубыток с комиссиями ' + px(R.dec(c.be))]);
    if (p.st === 'p') {
      v.calc.push(['Остаток заявки ждёт ' + qtyTxt(R.dec(p.ql)) + ' по ' + px(R.dec(p.ep)) +
        ' — цену остатка не двигаю: «Снять остаток заявки» в чате', 'muted']);
    }
    if (c3t2) t2Lines(v, res);
    if (c3tr) trLines(v, res);
    if (dataReady()) {
      v.summary = ['Стоп ' + px(S.cur.SL) + ' · риск ' + R.toFixedHE(rNew, 2) + ' · ' +
        (T !== null ? 'цель ' + rWords(c.r_tp) : 'без цели'), !!(c.check && c.check[0] !== 'no_change')];
      if (ch.n === 1 && ch.t2 && res.t2) {
        v.summary = ['Цель 2 ' + px(S.t2.px) + (res.t2.r2 !== null ? ' · ' + rWords(res.t2.r2) : '') +
          (res.t2.r1 !== null && res.t2.r2 !== null ? ' · обе ' + rWords(String(Number(res.t2.r1) + Number(res.t2.r2))) : ''),
          !!res.t2.check];
      } else if (ch.n === 1 && ch.tr && res.tr && res.tr.plan) {
        v.summary = ['Трейлинг ' + px(R.dec(res.tr.plan.dist)) + ' от лучшей цены · ' +
          (has(S.tr.act) ? 'включится при ' + px(S.tr.act) : 'сразу'), !!res.tr.check];
      }
    }
    return v;
  }
  /** Строки цели 2 (как панель «Вторая цель» бота, SPEC_C3 §3.2). */
  function t2Lines(v, res) {
    var p = S.p, t = res.t2;
    if (!S.t2.on || !t) {
      if (has(S.t2.start)) v.calc.push(['Цель 2 ' + px(S.t2.start) + ' на ' + qtyTxt(R.dec(p.q2)) + ' — на бирже' +
        (S.t2.avail ? '' : ' (двигать — в чате: [manual] target2 выключен)'), 'muted']);
      return;
    }
    var q1 = t.q1 !== null ? qtyTxt(R.dec(t.q1)) : '—', q2 = t.q2 !== null ? qtyTxt(R.dec(t.q2)) : '—';
    var r1 = t.r1 !== null ? rWords(t.r1) : 'R н/д', r2 = t.r2 !== null ? rWords(t.r2) : 'R н/д';
    if (t.mode === 'edit') {
      var same = R.eq(S.t2.px, S.t2.start);
      v.calc.push(['Сейчас: цель 1 — ' + q1 + ' на ' + px(R.dec(p.tp)) + ' (' + r1 + '), цель 2 — ' + q2 + ' на ' +
        px(S.t2.start) + ' (' + (t.r2_old !== null ? rWords(t.r2_old) : 'R н/д') + ')', same ? '' : 'muted']);
      if (!same) v.calc.push(['Будет: цель 2 на ' + px(S.t2.px) + ' (' + r2 + ')', 'main']);
      if (t.r1 !== null && t.r2_old !== null && same) {
        v.calc.push(['Если исполнятся обе: ' + rWords(String(Number(t.r1) + Number(t.r2_old))) + '.']);
        return;
      }
    } else {
      v.calc.push(['Будет: цель 1 — ' + (100 - S.t2.pct) + ' % (' + q1 + ') на ' + px(R.dec(p.tp)) + ' (' + r1 + '), цель 2 — ' +
        S.t2.pct + ' % (' + q2 + ') на ' + px(S.t2.px) + ' (' + r2 + ')', 'main']);
    }
    if (t.r1 !== null && t.r2 !== null) {
      v.calc.push(['Если исполнятся обе: ' + rWords(String(Number(t.r1) + Number(t.r2))) + '. Стоп — общий, на всю позицию.']);
    }
  }
  /** Строки трейлинга (как панель «Трейлинг» бота, SPEC_C3 §3.3). */
  function trLines(v, res) {
    var p = S.p, t = res.tr, st = px(R.dec(p.sl));
    if (S.tr.live) {
      v.calc.push(['Сейчас на бирже: трейлинг ' + px(S.tr.startDist) + ' от лучшей цены' +
        (has(S.tr.startAct) ? ', включится при ' + px(S.tr.startAct) : '') +
        (S.tr.avail ? '' : ' (заменить — в чате: [manual] trailing выключен)'), 'muted']);
    }
    if (!S.tr.on || !t || !t.plan) return;
    var dist = px(R.dec(t.plan.dist)), dr = t.dist_r !== null ? rUnits(R.dec(t.dist_r)) : '';
    var raised = t.plan.raised ? ' — не ближе ' + p.ym + ' шагов и двух спредов' : '';
    var pre = S.tr.avail ? p.ya.filter(function (x) { return x !== 0 && actIs(x); })[0] : undefined;
    if (has(t.plan.active)) {
      v.calc.push(['Будет: включится при ' + px(R.dec(t.plan.active)) + ' (' + (pre !== undefined ? '+' + pre + ' R'
        : rWords(t.act_r)) + '), затем держит стоп в ' +
        dist + ' (' + dr + raised + ') от лучшей цены; при откате на ' + dist + ' — закроет всю позицию рыночной заявкой',
        'main']);
      v.calc.push(['Риск не растёт: до включения позицию защищает стоп ' + st + '. Работает и при выключенном компьютере.']);
    } else {
      v.calc.push(['Будет: сразу держит стоп в ' + dist + ' (' + dr + raised + ') от лучшей цены; при откате на ' + dist +
        ' — закроет всю позицию рыночной заявкой', 'main']);
      v.calc.push(['Риск не растёт: стоп ' + st + ' остаётся на бирже. Работает и при выключенном компьютере.']);
    }
  }

  // ------------------------------------------------------------------ строки линий
  function movable(res) {
    if (S.mode === 'q') {
      var q = ['SL'].concat(has(shownTP(res)) ? ['TP'] : []);
      if (S.t2 && S.t2.avail && S.t2.on && has(S.t2.px)) q.push('T2');
      if (S.tr && S.tr.avail && S.tr.on && has(S.tr.dist)) {
        if (has(S.tr.act)) q.push('TA');
        if (has(trLinePx())) q.push('TD');
      }
      return q;
    }
    var out = [];
    if ((S.et === 'l' || S.et === 'b') && has(S.cur.E)) out.push('E');
    if (has(S.cur.SL)) out.push('SL');
    if (has(shownTP(res))) out.push('TP');
    return out;
  }
  function buildLines() {
    var box = $('lines');
    box.textContent = '';
    S.rows = {};
    var order = S.mode === 'n' && (S.et === 'l' || S.et === 'b') ? ['E', 'SL', 'TP'] : ['SL', 'TP'];
    if (S.mode === 'q') {                         // 19.2: цель 2 и трейлинг открытой сделки
      if (S.t2 && (S.t2.avail || has(S.t2.start))) order.push('T2');
      if (S.tr && (S.tr.avail || S.tr.live)) order.push('TA', 'TD');
    }
    order.forEach(function (k) { lineRow(box, k); });
    if (S.mode === 'q') {
      S.rows.avg = staticRow(box, 'Средняя', px(R.dec(S.p.pa)), 'gray');
      if (S.p.st === 'p') S.rows.wait = staticRow(box, 'Остаток заявки', qtyTxt(R.dec(S.p.ql)) + ' по ' + px(R.dec(S.p.ep)), 'gray');
    }
  }
  function lineRow(box, k) {
    var row = el('div', 'row');
    var name = el('button', 'name');
    name.type = 'button';
    var dot = el('span', 'dot');
    var nm = lineName(k);
    var label = el('span', 'label', nm);
    var price = el('span', 'price mono');
    name.appendChild(dot);
    name.appendChild(label);
    name.appendChild(price);
    name.setAttribute('aria-label', 'Выбрать линию ' + nm);
    name.addEventListener('click', function () { select(k); });
    var btns = el('div', 'btns');
    var preset = k === 'TA' || k === 'TD';          // 19.2: у трейлинга ⤓⤒ — к соседней кнопке R
    var dn = stepBtn('▼', nm + ' на шаг ниже', function () { nudge(k, -1); }, true);
    var up = stepBtn('▲', nm + ' на шаг выше', function () { nudge(k, 1); }, true);
    var lvDn = stepBtn('⤓', nm + (preset ? ' к кнопке R ниже' : ' к уровню ниже'), function () { jump(k, false); }, false);
    var lvUp = stepBtn('⤒', nm + (preset ? ' к кнопке R выше' : ' к уровню выше'), function () { jump(k, true); }, false);
    [dn, up, lvDn, lvUp].forEach(function (b) { btns.appendChild(b); });
    var note = el('div', 'note');
    row.appendChild(name);
    row.appendChild(btns);
    row.appendChild(note);
    box.appendChild(row);
    S.rows[k] = { kind: 'line', row: row, dot: dot, label: label, price: price, note: note, btns: [dn, up, lvDn, lvUp] };
  }
  function staticRow(box, name, value, colorKey) {
    var row = el('div', 'row static');
    var n = el('div', 'name');
    var dot = el('span', 'dot');
    n.appendChild(dot);
    n.appendChild(el('span', 'label', name));
    n.appendChild(el('span', 'price mono', value));
    row.appendChild(n);
    box.appendChild(row);
    return { kind: 'static', row: row, dot: dot, colorKey: colorKey };
  }
  function lineNote(k, res) {
    var p = S.p, d = S.d;
    if (S.mode === 'q') {
      if (k === 'SL') return R.eq(S.cur.SL, S.start.SL) ? 'как сейчас' : 'сейчас ' + px(S.start.SL) + ', ' + stepsTxt(S.cur.SL, S.start.SL);
      if (k === 'T2') return t2Note();
      if (k === 'TA') return taNote();
      if (k === 'TD') return tdNote(res);
      if (S.noTp) return S.t2 && has(S.t2.start) ? 'снимутся обе цели — на бирже останется только стоп'
        : 'снимется — на бирже останется только стоп';
      if (!has(S.cur.TP)) return 'цели нет — ⤓⤒ поставят цель на ближайший уровень';
      if (!has(S.start.TP)) return 'новая — сейчас без цели';
      return R.eq(S.cur.TP, S.start.TP) ? 'как сейчас' : 'сейчас ' + px(S.start.TP) + ', ' + stepsTxt(S.cur.TP, S.start.TP);
    }
    if (!S.ruleDone) return 'жду цену и свечи Bybit';
    if (k === 'E' && S.et === 'b') {               // 19.2: уровень пробоя
      var b0 = S.rule.E, lp = lastPrice();
      if (!has(S.cur.E)) return 'поставьте уровень пробоя';
      var gapTxt = lp ? ' · сейчас ' + px(lp) + ', ' + stepsTxt(S.cur.E, lp) : '';
      if (has(b0) && R.eq(S.cur.E, b0)) {
        return (S.rule.entryLevel ? 'по правилу: ближайшая ' + (d === 1 ? 'вершина M5 выше' : 'впадина M5 ниже') + ' цены'
          : 'по правилу: ' + (d === 1 ? 'вершины M5 выше' : 'впадины M5 ниже') + ' цены нет — цена ' +
            (d === 1 ? '+ ' : MINUS + ' ') + stepsWord(Math.max(10, p.bg))) + gapTxt;
      }
      return 'ваш' + (has(b0) ? ' · правило ' + px(b0) + ', ' + stepsTxt(S.cur.E, b0) : '') + gapTxt;
    }
    if (k === 'E') {
      var e0 = S.rule.E;
      if (!has(S.cur.E)) return 'поставьте цену заявки';
      if (has(e0) && R.eq(S.cur.E, e0)) return S.rule.entryLevel ? 'по правилу бота: ближайший уровень M5 за рынком'
        : 'по правилу бота: уровня M5 нет — ' + (d === 1 ? 'bid − 10 шагов' : 'ask + 10 шагов');
      return 'ваша' + (has(e0) ? ' · правило ' + px(e0) + ', ' + stepsTxt(S.cur.E, e0) : '');
    }
    if (k === 'SL') {
      var sp = S.rule.stop;
      if (!has(S.cur.SL)) return 'стопа нет — поставьте: ⤓⤒ к уровню';
      if (sp.stop && R.eq(S.cur.SL, sp.stop)) {
        return swingWords(d === 1 ? 'l' : 'h', sp.src === 'swing_h1' ? 'H1' : 'M5', sp.level.t) + bufWords(d, p.sb);
      }
      return 'ваш' + (sp.stop ? ' · правило ' + px(sp.stop) + ', ' + stepsTxt(S.cur.SL, sp.stop) : '');
    }
    if (S.tpKind === 'r2' || S.tpKind === 'r3') return S.tpKind.charAt(1) + 'R — R после комиссий = ' + S.tpKind.charAt(1);
    if (tpMode() === 'none') return 'без цели — на бирже только стоп';
    var tr = S.tpRule;
    if (tr && tr.target && R.eq(S.cur.TP, tr.target)) {
      return swingWords(d === 1 ? 'h' : 'l', tr.src === 'swing_h1' ? 'H1' : 'M5', tr.level.t) + bufWords(d, p.tb);
    }
    return 'ваша' + (tr && tr.target ? ' · правило ' + px(tr.target) + ', ' + stepsTxt(S.cur.TP, tr.target) : '');
  }
  /** Значение линии k (цена; у «Трейлинг» — расстояние). */
  function rowValue(k, res) {
    if (k === 'TP') return shownTP(res);
    if (k === 'T2') return S.t2.on ? S.t2.px : S.t2.start;
    if (k === 'TA') return S.tr.on ? S.tr.act : null;
    if (k === 'TD') return S.tr.on ? S.tr.dist : (S.tr.live ? S.tr.startDist : null);
    return S.cur[k];
  }
  /** Цена линии k на графике (у «Трейлинг» — стоп трейлинга при включении или сейчас). */
  function linePx(k, res) { return k === 'TD' ? trLinePx() : rowValue(k, res); }
  function renderLines(res) {
    var c = colors(), mv = movable(res);
    Object.keys(S.rows).forEach(function (k) {
      var r = S.rows[k];
      if (r.kind === 'static') { r.dot.style.background = c[r.colorKey]; return; }
      var val = rowValue(k, res);
      var c3 = k === 'T2' || k === 'TA' || k === 'TD';
      var off = (k === 'TP' && !has(val)) || (k === 'T2' && !S.t2.on) || ((k === 'TA' || k === 'TD') && !S.tr.on) ||
        (k === 'TA' && S.tr.on && !has(S.tr.act));
      r.label.textContent = lineName(k);
      r.row.className = 'row' + (k === S.sel ? ' sel' : '') + (off ? ' off' : '');
      r.row.style.setProperty('--sel', lineColor(k, c));
      r.dot.style.background = off ? c.gray : lineColor(k, c);
      var shown = has(val) ? px(val) : (k === 'TP' && S.mode === 'q' && S.noTp ? px(S.start.TP)
        : (k === 'TA' && S.tr.on ? 'сразу' : '—'));
      r.price.textContent = shown;
      r.note.textContent = lineNote(k, res);
      var ready = S.mode === 'q' || S.ruleDone;
      var canStep = ready && mv.indexOf(k) >= 0 && !(k === 'TP' && S.mode === 'q' && S.noTp);
      if (k === 'TD') canStep = ready && S.tr.avail && S.tr.on && has(S.tr.dist);
      r.btns[0].disabled = r.btns[1].disabled = !canStep;
      var canJump = ready && !(k === 'TP' && S.mode === 'q' && S.noTp) && !!S.tk;
      if (c3) canJump = canJump && (k === 'T2' ? S.t2.avail && S.t2.on : S.tr.avail && S.tr.on);
      r.btns[2].disabled = r.btns[3].disabled = !canJump;
    });
  }
  // ---- 19.2: вторая цель и трейлинг (режим q)
  function t2Note() {
    var t = S.t2, d = S.p.d;
    if (!t.on) return t.avail ? 'цели 2 нет — кнопка «Цель 2» ниже' : 'цели 2 нет';
    var share = t.pct !== null ? ' · ' + t.pct + ' % позиции' : '';
    if (has(t.start)) {
      if (!t.avail) return 'на бирже; двигать — в чате («Цель 2 ▲▼»)';
      return (R.eq(t.px, t.start) ? 'как сейчас' : 'сейчас ' + px(t.start) + ', ' + stepsTxt(t.px, t.start)) + share;
    }
    var ru = t.rule;
    if (ru && R.eq(t.px, ru.px)) {
      return 'по правилу бота: ' + (ru.src === 'r1' ? 'цель 1 + 1 R — ' + (d === 1 ? 'вершины выше нет' : 'впадины ниже нет')
        : swingWords(d === 1 ? 'h' : 'l', ru.src === 'swing_h1' ? 'H1' : 'M5', ru.level.t) + bufWords(d, S.p.tb)) + share;
    }
    return 'ваша' + (ru ? ' · правило ' + px(ru.px) + ', ' + stepsTxt(t.px, ru.px) : '') + share;
  }
  function trPreset(actR, distR) {
    return R.trailPreset(S.p.d, R.dec(S.p.pa), R.dec(S.p.y1), String(actR), String(distR), S.tick);
  }
  function actIs(x) { return R.sameQ(trPreset(x, '1').active, S.tr.act); }
  function distIs(x) { return has(S.tr.dist) && R.eq(trPreset(0, x).dist, S.tr.dist); }
  function taNote() {
    var t = S.tr;
    if (!t.on) return t.avail ? 'трейлинга нет — кнопка «Трейлинг» ниже' : (t.live ? '' : 'трейлинга нет');
    var now = t.live ? (R.sameQ(t.act, t.startAct) ? ' · как сейчас' : ' · сейчас ' + (has(t.startAct) ? px(t.startAct) : 'без цены')) : '';
    if (!has(t.act)) return (t.live && !has(t.startAct) ? 'включён — стоп трейлинга идёт за ценой' : 'сразу — без цены включения') + now;
    var pr = t.avail ? S.p.ya.filter(function (x) { return x !== 0 && actIs(x); })[0] : undefined;
    var r = R.div(R.muli(R.sub(t.act, R.dec(S.p.pa)), S.p.d), R.dec(S.p.y1));
    return (pr !== undefined ? '+' + pr + ' R' : rWords(R.q10(r))) + ' от средней ' + px(R.dec(S.p.pa)) + now;
  }
  function tdNote(res) {
    var t = S.tr;
    if (!t.on || !has(t.dist)) return t.live ? 'стоит на бирже' : '';
    var pr = t.avail ? S.p.yd.filter(function (x) { return distIs(x); })[0] : undefined;
    var txt = 'от лучшей цены (' + (pr !== undefined ? pr + ' R' : rUnits(R.div(t.dist, R.dec(S.p.y1)))) + ')';
    var line = trLinePx();
    if (line) txt += ' · стоп трейлинга ' + (has(t.act) ? 'при включении ' : 'сейчас около ') + px(line);
    if (res && res.tr && res.tr.plan && res.tr.plan.raised) txt += ' · поднято до ' + px(R.dec(res.tr.plan.dist));
    if (t.live) txt += R.sameQ(t.dist, t.startDist) ? ' · как сейчас' : ' · сейчас ' + px(t.startDist);
    return txt;
  }
  /** Стоп трейлинга на графике: цена включения (сразу — последняя цена) ∓ расстояние. */
  function trLinePx() {
    if (!S.tr || !S.tr.on || !has(S.tr.dist)) return null;
    var ref = has(S.tr.act) ? S.tr.act : lastPrice();
    if (!has(ref)) return null;
    var v = R.sub(ref, R.muli(S.tr.dist, S.p.d));
    return R.cmp(v, R.ZERO) > 0 ? v : null;
  }
  function toggleT2() {
    var t = S.t2;
    if (t.on) {
      t.on = false;
      t.px = null;
      setStatus('Цель 2 не ставлю.');
    } else {
      if (!has(S.p.tp)) { setStatus('Сначала цель: вторая цель — только при цели 1.'); return; }
      t.rule = R.target2Default(S.p.d, R.dec(S.p.tp), R.dec(S.p.y1), S.tick, S.sw['5'], S.sw['60'], S.p.tb);
      t.px = t.rule.px;
      t.on = true;
      t.pct = S.p.wd;
      S.sel = 'T2';
      setStatus('Цель 2 — по правилу бота; долю выберите кнопками, линию — пальцем.');
    }
    buildLines();
    changed();
  }
  function toggleTr() {
    var t = S.tr;
    if (t.on) {
      t.on = false;
      t.dist = t.act = null;
      setStatus('Трейлинг не ставлю.');
    } else {
      var pr = trPreset(S.p.yb, S.p.ye);
      t.on = true;
      t.dist = pr.dist;
      t.act = pr.active;
      S.sel = has(t.act) ? 'TA' : 'TD';
      setStatus('Трейлинг Bybit — по кнопкам ' + (S.p.yb === 0 ? '«Сразу»' : '«+' + S.p.yb + ' R»') + ' и «' + S.p.ye +
        ' R»; линии — пальцем.');
    }
    buildLines();
    changed();
  }
  function renderC3Bar() {
    var box = $('c3Bar');
    box.textContent = '';
    if (S.mode !== 'q' || !S.t2 || !S.tr) return;
    var p = S.p;
    if (S.t2.avail) {
      var g1 = el('div', 'c3-row');
      if (!has(S.t2.start)) segButton(g1, S.t2.on ? 'Без цели 2' : 'Цель 2', false, toggleT2);
      if (S.t2.on && !has(S.t2.start)) {
        p.w2.forEach(function (x) {
          segButton(g1, x + ' %' + (S.t2.pct === x ? ' ✓' : ''), S.t2.pct === x, function () {
            S.t2.pct = x;
            setStatus('Цель 2 — ' + x + ' % позиции.');
            changed();
          }, 'Доля цели 2 ' + x + ' %');
        });
      }
      if (g1.childNodes.length) box.appendChild(g1);
    }
    if (S.tr.avail) {
      var g2 = el('div', 'c3-row');
      if (!S.tr.live) segButton(g2, S.tr.on ? 'Без трейлинга' : 'Трейлинг', false, toggleTr);
      if (S.tr.on) {
        p.ya.forEach(function (x) {
          var on = actIs(x);
          segButton(g2, (x === 0 ? 'Сразу' : '+' + x + ' R') + (on ? ' ✓' : ''), on, function () {
            S.tr.act = trPreset(x, '1').active;
            S.sel = has(S.tr.act) ? 'TA' : 'TD';
            changed();
          }, x === 0 ? 'Трейлинг сразу' : 'Включение с +' + x + ' R');
        });
        box.appendChild(g2);
        g2 = el('div', 'c3-row');
        p.yd.forEach(function (x) {
          var on = distIs(x);
          segButton(g2, x + ' R' + (on ? ' ✓' : ''), on, function () {
            S.tr.dist = trPreset(0, x).dist;
            S.sel = 'TD';
            changed();
          }, 'Расстояние трейлинга ' + x + ' R');
        });
      }
      if (g2.childNodes.length) box.appendChild(g2);
    }
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
    renderLines(S.res);
    syncLines(S.res);
  }
  /** Новая цена линии k владельцем (стрелки, ▼▲, палец). */
  function setLine(k, v) {
    if (!has(v) || R.cmp(v, R.ZERO) <= 0) return false;
    if (k === 'T2' || k === 'TA' || k === 'TD') {   // 19.2: цель 2, цена включения, расстояние трейлинга
      var cur = k === 'T2' ? S.t2.px : (k === 'TA' ? S.tr.act : S.tr.dist);
      if (has(cur) && R.eq(cur, v)) return false;
      if (k === 'T2') S.t2.px = v; else if (k === 'TA') S.tr.act = v; else S.tr.dist = v;
      S.sel = k;
      return true;
    }
    if (k === 'TP') {
      if (S.mode === 'n') S.tpKind = 'p';
      else S.noTp = false;
    }
    if (has(S.cur[k]) && R.eq(S.cur[k], v) && !(k === 'TP' && S.mode === 'n')) return false;
    S.cur[k] = v;
    S.sel = k;
    return true;
  }
  function nudge(k, dir) {
    if (k === 'TD') {                              // линия вверх — у лонга расстояние меньше, у шорта больше
      if (!has(S.tr.dist)) return;
      if (setLine('TD', R.sub(S.tr.dist, R.muli(S.tick, dir * S.p.d)))) { haptic(); changed(); }
      return;
    }
    var base = rowValue(k, S.res);
    if (!has(base)) return;
    if (setLine(k, R.add(base, R.muli(S.tick, dir)))) { haptic(); changed(); }
  }
  /** ⤓⤒ — к соседнему уровню вниз / вверх ровно по правилу стрелок бота (C1 §12.4). */
  function jump(k, up) {
    if (!S.tk) return;
    var d = S.mode === 'n' ? S.d : S.p.d, bid = S.tk.bid, ask = S.tk.ask, p = S.p, v = null;
    var limit = S.mode === 'n' && (S.et === 'l' || S.et === 'b');   // у пробоя стоп и цель — от уровня
    var lv = levelsAll();
    if (k === 'T2' || k === 'TA' || k === 'TD') { jumpC3(k, up); return; }
    if (k === 'E' && S.et === 'b') {
      if (!has(S.cur.E)) return;
      v = R.stepBreakout(d, S.cur.E, levelsM5(), lastPrice(), up !== (d === 1), S.tick, p.bg);
    } else if (k === 'E') {
      if (!has(S.cur.E)) return;
      v = R.stepEntry(d, S.cur.E, levelsM5(), bid, ask, up === (d === 1), S.tick);
    } else if (k === 'SL') {
      var refS = limit ? S.cur.E : (d === 1 ? bid : ask);
      if (!has(refS)) return;
      v = has(S.cur.SL) ? R.stepStop(d, S.cur.SL, lv, refS, up === (d === 1), S.tick, p.sb)
        : R.stopFirst(d, lv, refS, S.tick, p.sb);
    } else {
      var refT = limit ? S.cur.E : (d === 1 ? ask : bid);
      if (!has(refT)) return;
      var cur = shownTP(S.res);
      v = has(cur) ? R.stepTarget(d, cur, lv, refT, up !== (d === 1), S.tick, p.tb) : R.targetFirst(d, lv, refT, S.tick, p.tb);
    }
    var placed = false;
    if (v === null && k !== 'E' && !has(k === 'SL' ? S.cur.SL : shownTP(S.res))) {
      // линии нет, и уровней с её стороны нет — ставлю на 1 % (стоп) или 2 % (цель) от цены, дальше — ▼▲ или пальцем
      var ref = k === 'SL' ? (limit ? S.cur.E : (d === 1 ? bid : ask)) : (limit ? S.cur.E : (d === 1 ? ask : bid));
      var off = R.mul(ref, R.Q(k === 'SL' ? 1n : 2n, 100n));
      v = k === 'SL' ? R.roundStop(R.sub(ref, R.muli(off, d)), d, S.tick, 0) : R.roundTarget(R.add(ref, R.muli(off, d)), d, S.tick, 0);
      placed = true;
    }
    if (v === null) {
      setStatus((up ? 'Выше' : 'Ниже') + ' уровней нет — двигайте ' + (up ? '▲' : '▼') + ' или пальцем');
      return;
    }
    if (setLine(k, v)) {
      haptic();
      changed();
      if (placed) setStatus('Уровней нет — ' + (k === 'SL' ? 'стоп поставлен в 1 %' : 'цель поставлена в 2 %') +
        ' от цены; двигайте ▼▲ или пальцем');
    }
  }

  /** ⤓⤒ цели 2 (уровни M5 и H1 за целью 1, как «Цель 2 ближе / дальше» чата) и трейлинга (соседняя кнопка R). */
  function jumpC3(k, up) {
    var d = S.p.d, p = S.p, v = null;
    if (k === 'T2') {
      if (!has(S.t2.px) || !has(p.tp)) return;
      var t1 = R.dec(p.tp);
      v = R.stepTarget(d, S.t2.px, levelsAll(), t1, up !== (d === 1), S.tick, p.tb);
      if (v !== null && !R.target2Ok(d, t1, v, S.tick)) v = null;
    } else if (k === 'TA') {
      if (!has(S.tr.act)) return;
      var acts = p.ya.filter(function (x) { return x !== 0; }).map(function (x) { return trPreset(x, '1').active; });
      v = R.stepLevel(acts, S.tr.act, up);
    } else {
      var ref = has(S.tr.act) ? S.tr.act : lastPrice();
      if (!has(ref) || !has(S.tr.dist)) return;
      var lines = p.yd.map(function (x) { return R.sub(ref, R.muli(trPreset(0, x).dist, d)); });
      var nxt = R.stepLevel(lines, R.sub(ref, R.muli(S.tr.dist, d)), up);
      if (nxt !== null) v = R.muli(R.sub(ref, nxt), d);
    }
    if (v === null) { setStatus((up ? 'Выше' : 'Ниже') + (k === 'T2' ? ' уровней нет' : ' кнопок R нет') + ' — двигайте ' +
      (up ? '▲' : '▼') + ' или пальцем'); return; }
    if (setLine(k, v)) { haptic(); changed(); }
  }

  // ------------------------------------------------------------------ цель (кнопки под линиями)
  function buildTpBar() { renderTpBar(null); }
  function renderTpBar(res) {
    var box = $('tpBar');
    box.textContent = '';
    if (S.mode === 'q') {
      if (has(S.start.TP) || has(S.cur.TP)) {
        segButton(box, S.noTp ? 'Вернуть цель' : 'Без цели', S.noTp, function () {
          S.noTp = !S.noTp;
          setStatus(S.noTp ? 'Цель снимется — на бирже останется только стоп.' : 'Цель на месте.');
          changed();
        });
      }
      if (!has(S.cur.TP) || S.noTp && !has(S.start.TP)) {
        segButton(box, 'Поставить цель', false, function () { S.noTp = false; jump('TP', S.p.d === 1); });
      }
      return;
    }
    if (!S.ruleDone) return;
    var swing = has(S.cur.SL) ? swingTarget(S.cur.SL, S.cur.E) : null;
    var kind = S.tpKind;
    var isSwing = kind !== 'r2' && kind !== 'r3' && kind !== 'none' && S.tpRule && S.tpRule.target &&
      has(S.cur.TP) && R.eq(S.cur.TP, S.tpRule.target);
    if (swing && swing.target) {
      segButton(box, (S.d === 1 ? 'Вершина' : 'Впадина') + (isSwing ? ' ✓' : ''), isSwing, function () {
        var t = swingTarget(S.cur.SL, S.cur.E);
        if (!t || !t.target) { setStatus(noTargetLine(S.d)); return; }
        S.tpRule = t;
        S.cur.TP = t.target;
        S.tpKind = 'swing';
        changed();
      });
    }
    [['r2', '2R'], ['r3', '3R']].forEach(function (x) {
      segButton(box, x[1] + (kind === x[0] ? ' ✓' : ''), kind === x[0], function () { S.tpKind = x[0]; changed(); });
    });
    segButton(box, 'Без цели' + (kind === 'none' ? ' ✓' : ''), kind === 'none', function () { S.tpKind = 'none'; changed(); });
    void res;
  }

  // ------------------------------------------------------------------ риск (режим n; как 18.4)
  function riskLimitsErr() {
    var lim = R.riskLimitsUsdt(S.p.rb, S.rc);
    return 'Риск ' + R.riskPctLabel(S.rc[0]) + '–' + R.riskPctLabel(S.rc[1]) + ' % базы: ' + usdtShort(lim[0]) + '–' +
      usdtShort(lim[1]) + ' USDT';
  }
  function riskNow() { return S.riskStr === null ? S.riskDef : R.parseRiskInput(S.riskStr); }
  function buildRisk() {
    var box = $('risk');
    box.textContent = '';
    box.hidden = S.mode !== 'n';
    if (S.mode !== 'n') return;
    box.appendChild(el('div', 'risk-title', 'Риск на сделку'));
    var row = el('div', 'risk-btns');
    var btns = [];
    var addBtn = function (q, pct) {
      var b = el('button', 'btn', '');
      b.type = 'button';
      b.addEventListener('click', function () { pickRisk(q); });
      row.appendChild(b);
      btns.push({ b: b, usdt: q, pct: pct });
    };
    var quick = R.riskQuick(S.p.rb, S.rc);
    quick.forEach(function (x) { addBtn(R.riskFromPct(x, S.p.rb), R.riskPctLabel(x)); });
    var defIn = quick.some(function (x) { return R.eq(R.riskFromPct(x, S.p.rb), S.riskDef); });
    if (!defIn && R.riskInLimits(S.riskDef, S.p.rb, S.rc)) addBtn(S.riskDef, riskPctLabel(S.riskDef));
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
    var lim = R.riskLimitsUsdt(S.p.rb, S.rc);
    box.appendChild(el('div', 'risk-note', R.riskPctLabel(S.rc[0]) + '–' + R.riskPctLabel(S.rc[1]) + ' % базы ' +
      usdtShort(R.dec(S.p.rb)) + ' = ' + usdtShort(lim[0]) + '–' + usdtShort(lim[1]) + ' USDT · по умолчанию ваш /риск ' +
      usdtShort(S.riskDef) + ' USDT'));
    S.riskUi = { btns: btns, inp: inp };
  }
  function renderRisk() {
    if (!S.riskUi) return;
    var cur = riskNow();
    S.riskUi.btns.forEach(function (x) {
      var on = cur !== null && R.eq(cur, x.usdt);
      x.b.textContent = x.pct + ' %' + (on ? ' ✓' : '');
      x.b.classList.toggle('on', on);
      x.b.setAttribute('aria-pressed', on ? 'true' : 'false');
      x.b.setAttribute('aria-label', 'Риск ' + x.pct + ' % — ' + usdtShort(x.usdt) + ' USDT');
    });
  }
  function pickRisk(q) {
    S.riskBtn = { usdt: q, str: R.eq(q, S.riskDef) ? null : R.toApiStr(q) };
    S.riskStr = S.riskBtn.str;
    S.riskText = '';
    if (S.riskUi) S.riskUi.inp.value = '';
    haptic();
    changed();
    setStatus('Риск на сделку: ' + riskPctLabel(q) + ' % (' + usdt(q) + ') — объём пересчитан.');
  }
  function typeRisk(text) {
    S.riskText = String(text || '');
    var t = S.riskText.trim().replace(',', '.');
    S.riskStr = t === '' ? S.riskBtn.str : t;          // поле очищено — снова последняя кнопка
    changed();
  }

  // ------------------------------------------------------------------ график
  function sizeChart() {
    if (S.drag) return;
    var h = Math.max(240, Math.round(window.innerHeight * 0.46));
    $('chart').style.height = h + 'px';
  }
  function setupChart() {
    if (!LWC) { $('chartWrap').hidden = true; return; }
    sizeChart();
    var c = colors();
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
        priceFormat: { type: 'price', precision: R.stepDecimals(S.tick), minMove: R.toNum(S.tick) },
        autoscaleInfoProvider: autoscale
      });
      if (LWC.createSeriesMarkers) S.markers = LWC.createSeriesMarkers(S.series, []);
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
    var out = [], res = S.res;
    LINES.forEach(function (k) {
      var v = k === 'TP' ? shownTP(res) : S.cur[k];
      if (has(v)) out.push(R.toNum(v));
    });
    if (S.mode === 'q') {
      out.push(R.toNum(R.dec(S.p.pa)));
      if (S.p.ep) out.push(R.toNum(R.dec(S.p.ep)));
      if (S.noTp && S.p.tp) out.push(R.toNum(R.dec(S.p.tp)));
      ['T2', 'TA', 'TD'].forEach(function (k) {     // 19.2: цель 2 и трейлинг
        if (!S.rows[k]) return;
        var v = linePx(k, res);
        if (has(v)) out.push(R.toNum(v));
      });
      if (S.t2 && has(S.t2.start)) out.push(R.toNum(S.t2.start));
    }
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
  function syncLines(res) {
    if (!S.series || !S.p) return;
    var c = colors();
    var LS = LWC.LineStyle || { Solid: 0, Dotted: 1, Dashed: 2 };
    var want = {};
    function line(id, price, color, style, width, title, axis) {
      if (!has(price)) return;
      want[id] = { price: R.toNum(price), color: color, lineStyle: style, lineWidth: width, title: title,
        axisLabelVisible: axis };
    }
    var tp = shownTP(res);
    line('SL', S.cur.SL, c.red, LS.Solid, S.sel === 'SL' ? 3 : 2, 'Стоп', true);
    line('TP', tp, c.green, LS.Dashed, S.sel === 'TP' ? 3 : 2, lineName('TP'), true);   // B-8: «Цель 1» при цели 2
    if (S.mode === 'n') {
      if (S.et === 'l' || S.et === 'b') line('E', S.cur.E, c.blue, LS.Solid, S.sel === 'E' ? 3 : 2,
        S.et === 'b' ? 'Уровень' : 'Вход', true);
      var pl = res && res.c ? res.c.plan : null;
      if (pl && !pl.limit && R.okSize(pl)) line('lim', pl.price, c.gray, LS.Dotted, 1, 'предел', S.et === 'b');
    } else {
      // 19.2: цель 2 (зелёная точками), цена включения трейлинга (синяя штрихами), стоп трейлинга (красная штрихами)
      if (S.t2 && S.t2.on && has(S.t2.px)) line('T2', S.t2.px, c.green, LS.Dotted, S.sel === 'T2' ? 3 : 2, 'Цель 2', true);
      if (S.t2 && has(S.t2.start) && S.t2.on && has(S.t2.px) && !R.eq(S.t2.px, S.t2.start)) {
        line('t20', S.t2.start, c.gray, LS.Dotted, 1, 'цель 2 было', false);
      }
      if (S.tr && S.tr.on) {
        if (has(S.tr.act)) line('TA', S.tr.act, c.blue, LS.Dashed, S.sel === 'TA' ? 3 : 2, 'включение', true);
        var tdp = trLinePx();
        if (has(tdp)) line('TD', tdp, c.red, LS.Dashed, S.sel === 'TD' ? 2 : 1, 'трейлинг', true);
      }
      line('avg', R.dec(S.p.pa), c.gray, LS.Solid, 1, 'средняя', false);
      if (res && res.c && res.c.be) line('be', R.dec(res.c.be), c.gray, LS.Dotted, 1, 'безубыток', false);
      if (S.p.st === 'p') {
        line('wait', R.dec(S.p.ep), c.gray, LS.Dotted, 1, 'ждёт ' + R.fmtQty(R.dec(S.p.ql), R.dec(S.p.qs)) + ' по ' +
          px(R.dec(S.p.ep)), false);
      }
      if (!R.eq(S.cur.SL, S.start.SL)) line('sl0', S.start.SL, c.gray, LS.Dotted, 1, 'стоп было', false);
      if (S.noTp && has(S.start.TP)) line('tp0', S.start.TP, c.gray, LS.Dotted, 1, 'цель снимется', false);
      else if (has(S.start.TP) && has(tp) && !R.eq(tp, S.start.TP)) line('tp0', S.start.TP, c.gray, LS.Dotted, 1, 'цель было', false);
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
    if (!S.series || !S.bars[S.tf].length) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    if (S.mode === 'n' && !S.ruleDone) return;
    var y = yOf(ev), best = null, dist = HIT_PX + 0.01;
    movable(S.res).forEach(function (k) {
      var v = linePx(k, S.res);
      if (!has(v)) return;
      var yy = S.series.priceToCoordinate(R.toNum(v));
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
    var raw = R.fromNum(price), d = S.mode === 'n' ? S.d : S.p.d;
    // то же правило, что ввод цены в чате: стоп — round_stop(v, 0), цель — round_target(v, 0), вход — на шаг по стороне;
    // 19.2: уровень пробоя — на шаг в сторону пробоя, цель 2 — как цель, цена включения — к ближайшему шагу, «Трейлинг»
    // — расстояние от цены включения (сразу — от последней цены) до линии, к ближайшему шагу
    var v;
    if (dr.k === 'TD') {
      var ref = has(S.tr.act) ? S.tr.act : lastPrice();
      if (!has(ref)) return;
      var dd = R.muli(R.sub(ref, raw), d);
      if (R.cmp(dd, R.ZERO) <= 0) return;
      v = R.roundStep(dd, S.tick, 'nearest');
      if (R.cmp(v, R.ZERO) <= 0) v = S.tick;
    } else if (dr.k === 'TA') v = R.roundStep(raw, S.tick, 'nearest');
    else if (dr.k === 'T2') v = R.dragTarget(raw, d, S.tick);
    else if (dr.k === 'E' && S.et === 'b') v = R.dragBreakout(raw, d, S.tick);
    else v = dr.k === 'SL' ? R.dragStop(raw, d, S.tick) : (dr.k === 'TP' ? R.dragTarget(raw, d, S.tick) : R.dragEntry(raw, d, S.tick));
    var cur = rowValue(dr.k, S.res);
    if (has(cur) && R.eq(v, cur)) return;
    if (setLine(dr.k, v)) { haptic(); changed(); }
  }
  function onUp(ev) {
    var dr = S.drag;
    if (!dr || ev.pointerId !== dr.id) return;
    ev.stopPropagation();
    try { $('chart').releasePointerCapture(ev.pointerId); } catch (e) { /* уже отпущен */ }
    S.drag = null;
    S.chart.applyOptions({ handleScroll: true, handleScale: true });
  }

  // ------------------------------------------------------------------ данные Bybit (публичные)
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
  function okBar(b) { return b.t > 0 && RX_PX.test(b.o) && RX_PX.test(b.h) && RX_PX.test(b.l) && RX_PX.test(b.c); }
  function fetchKlines(iv) {
    var u = 'https://api.bybit.com/v5/market/kline?category=linear&symbol=' + encodeURIComponent(S.p.s) +
      '&interval=' + iv + '&limit=' + KLINES;
    return fetchJson(u).then(function (j) {
      if (!j || j.retCode !== 0 || !j.result || !Array.isArray(j.result.list) || !j.result.list.length) {
        throw new Error('Bybit: пустой ответ');
      }
      var bars = j.result.list.map(function (x) {
        return { t: Number(x[0]), o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]) };
      }).filter(okBar);
      bars.sort(function (a, b) { return a.t - b.t; });        // новые первыми → старые первыми
      var time = Number(j.time);
      if (!(time > 0)) throw new Error('Bybit: нет времени сервера');
      return { bars: bars, time: time };
    });
  }
  function loadBars(iv, first, manual) {
    if (S.loading[iv] || !S.p) return;
    S.loading[iv] = true;
    fetchKlines(iv).then(function (res) {
      if (!res.bars.length) throw new Error('нет свечей');
      S.bars[iv] = res.bars;
      S.srv[iv] = res.time;
      // закрытые свечи — по времени сервера Bybit (open + длина ≤ time ответа), как closed_bars бота
      var closed = R.closedBars(res.bars, res.time, R.STOP_BARS, iv === '60' ? R.H1_MS : R.BAR_MS);
      S.sw[iv] = R.swingPoints(closed, iv === '60' ? 'H1' : 'M5');
      S.loaded[iv] = true;
      S.failed[iv] = false;
      if (manual) setStatus('Свечи обновлены.');
    }).catch(function () {
      if (!S.loaded[iv]) S.failed[iv] = true;
      else if (manual) setStatus('Обновить не удалось — показаны прежние свечи.');
    }).then(function () {
      S.loading[iv] = false;
      afterData();
      if (iv === S.tf) showBars(false);
      renderSrc();
    });
    void first;
  }
  function loadTicker(manual) {
    if (S.tkLoading || !S.p) return;
    S.tkLoading = true;
    var u = 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + encodeURIComponent(S.p.s);
    fetchJson(u).then(function (j) {
      var t = j && j.retCode === 0 && j.result && Array.isArray(j.result.list) ? j.result.list[0] : null;
      if (!t || t.symbol !== S.p.s || !RX_PX.test(String(t.bid1Price)) || !RX_PX.test(String(t.ask1Price))) {
        throw new Error('Bybit: нет тикера');
      }
      var bid = R.dec(String(t.bid1Price)), ask = R.dec(String(t.ask1Price));
      if (R.cmp(bid, R.ZERO) <= 0 || R.cmp(ask, bid) < 0) throw new Error('Bybit: нет цены');
      var fr = /^-?[0-9]{1,3}(\.[0-9]{1,12})?$/.test(String(t.fundingRate)) ? String(t.fundingRate) : null;
      var fn = /^[0-9]{10,16}$/.test(String(t.nextFundingTime)) ? Number(t.nextFundingTime) : null;
      var ms = Number(j.time) > 0 ? Number(j.time) : Date.now();
      S.tk = { bid: bid, ask: ask, last: RX_PX.test(String(t.lastPrice)) ? R.dec(String(t.lastPrice)) : null, fr: fr,
        fn: fn, ms: ms, at: Date.now() };
      S.tkFailed = false;
    }).catch(function () {
      S.tkFailed = true;
      if (manual) setStatus('Цена Bybit не обновилась.');
    }).then(function () {
      S.tkLoading = false;
      afterData();
      renderSrc();
    });
  }
  function afterData() {
    if (S.mode === 'n' && !S.ruleDone && applyRule()) buildLines();
    recalc();
  }
  function chartBar(b) {
    return { time: b.t / 1000 + MSK_S, open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c) };
  }
  function showBars(force) {
    if (!S.series) return;
    var bars = S.bars[S.tf];
    if (!bars.length) {
      $('chartMsg').textContent = S.failed[S.tf] ? 'Свечи не загрузились. Линии двигаются кнопками ниже; проверки по цене сделает бот.'
        : 'Загружаю свечи…';
      $('chartMsg').hidden = false;
      return;
    }
    $('chartMsg').hidden = true;
    var fresh = force || S.shownTf !== S.tf;
    S.series.setData(bars.map(chartBar));
    if (fresh) {
      var n = bars.length;
      S.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE_BARS), to: n + 2 });
      S.shownTf = S.tf;
    }
    setMarkers();
    syncLines(S.res);
  }
  /** Серые отметки вершин и впадин показанного таймфрейма (уровни для ⤓⤒ — M5 и H1 вместе). */
  function setMarkers() {
    if (!S.markers) return;
    var sw = S.sw[S.tf];
    if (!sw) { try { S.markers.setMarkers([]); } catch (e) { /* нет */ } return; }
    var c = colors(), out = [];
    sw.highs.forEach(function (x) { out.push({ time: x.t / 1000 + MSK_S, position: 'aboveBar', color: c.gray, shape: 'arrowDown', size: 0.6 }); });
    sw.lows.forEach(function (x) { out.push({ time: x.t / 1000 + MSK_S, position: 'belowBar', color: c.gray, shape: 'arrowUp', size: 0.6 }); });
    out.sort(function (a, b) { return a.time - b.time; });
    try { S.markers.setMarkers(out); } catch (e) { /* без отметок */ }
  }
  function renderSrc() {
    var t = S.srv[S.tf];
    var txt = t ? 'Bybit ' + hhmm(t) + ' МСК' : (S.failed[S.tf] ? 'Свечи Bybit не загрузились' : 'Bybit…');
    if (S.tk) txt += ' · цена ' + hhmmss(S.tk.ms) + (tickerFresh() ? '' : ' (старая)');
    else if (S.tkFailed) txt += ' · цены нет';
    $('src').textContent = txt;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
