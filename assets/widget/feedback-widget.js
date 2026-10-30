/* ==========================================================================
 * NTUST Feedback Widget · Phase 1 MVP
 * 客戶在頁面元素上戳一下、留評論 → POST /api/feedback
 *
 * 設計依據：/Users/kuoluntang/.claude/plans/image-1-icon-partitioned-hopper.md
 * Phase 0 spike 結論：docs/feedback-widget-phase0-spike.md
 *   - triage 反查靠 customClasses / visibleText / inlineStyle / parentClasses
 *     四個訊號（不能只丟 selector）
 *   - 完整 outerHTML 截到 1500 chars
 *
 * 注入條件：環境變數 FEEDBACK_ENABLED=1 才被 _Host.cshtml 載入
 *
 * 純 vanilla JS + Shadow DOM IIFE，無外部依賴。
 * ========================================================================== */
(function () {
  'use strict';

  // 路徑黑名單：登入 / gate / 自家 admin 不注入 widget
  var SKIP_PATHS = ['/Account/', '/gate', '/_blazor', '/_framework'];
  for (var i = 0; i < SKIP_PATHS.length; i++) {
    if (location.pathname.indexOf(SKIP_PATHS[i]) === 0) return;
  }

  // 已掛過就不重複（Blazor Server SignalR 重連可能讓 script 跑兩次）
  if (window.__ntustFeedbackMounted) return;
  window.__ntustFeedbackMounted = true;

  // ------------------------------------------------------------------------
  // Constants & tokens
  // ------------------------------------------------------------------------
  var COOKIE_NAME = 'feedback-session';
  var API_BASE = '/api/feedback';
  // AI 助理顯示名稱 — _Host.cshtml 從環境變數 FEEDBACK_AI_NAME 注入；
  // 預設「AI 助理」，可改成「小幫手」/「客服」/「設計師」等以符合場景
  var AI_NAME = (typeof window !== 'undefined' && typeof window.__feedbackAiName === 'string' && window.__feedbackAiName)
    ? window.__feedbackAiName
    : 'AI 助理';
  var COLOR = {
    primary: '#5e6ad2',
    primaryHover: '#4d57b8',
    primarySoft: '#eceeff',
    ink: '#18191c',
    inkSubtle: '#6b7280',
    inkTertiary: '#9aa0a8',
    bg: '#ffffff',
    surface2: '#f5f6f7',
    line: '#e7e8eb',
    success: '#1b8a3a',
    successSoft: '#e6f4ea',
    warn: '#b76e00',
    danger: '#c0392b'
  };

  // Flash 邊框配色（universal highlighter，預設琥珀+淡黃底）— host 可覆寫：
  //   window.__feedbackFlashColor = '#5e6ad2'              ← 單一 hex，自動推 fill/glow
  //   window.__feedbackFlashColor = { stroke, fill, glow0, glow40 }  ← 完全自訂
  var FLASH = (function () {
    var raw = (typeof window !== 'undefined') ? window.__feedbackFlashColor : null;
    if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) {
      var r = parseInt(raw.slice(1, 3), 16),
          g = parseInt(raw.slice(3, 5), 16),
          b = parseInt(raw.slice(5, 7), 16);
      return {
        stroke: raw,
        fill:   'rgba(' + r + ',' + g + ',' + b + ',.18)',
        glow0:  'rgba(' + r + ',' + g + ',' + b + ',0)',
        glow40: 'rgba(' + r + ',' + g + ',' + b + ',.55)'
      };
    }
    var o = (raw && typeof raw === 'object') ? raw : {};
    return {
      stroke: o.stroke || '#f59e0b',
      fill:   o.fill   || 'rgba(255,235,59,.18)',
      glow0:  o.glow0  || 'rgba(245,158,11,0)',
      glow40: o.glow40 || 'rgba(245,158,11,.55)'
    };
  })();

  // ------------------------------------------------------------------------
  // Cookie / UUID
  // ------------------------------------------------------------------------
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 86400000);
    document.cookie = name + '=' + encodeURIComponent(value)
      + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
  }
  function genUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // RFC4122 v4 fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  var sessionId = getCookie(COOKIE_NAME);
  if (!sessionId) {
    sessionId = genUuid();
    setCookie(COOKIE_NAME, sessionId, 7);
  }

  // ------------------------------------------------------------------------
  // CSS path generator — 只用對 triage 有意義的訊號（避開純 mud-* 類別）
  // ------------------------------------------------------------------------
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && path.length < 8) {
      var part = node.nodeName.toLowerCase();
      if (node.id) { part += '#' + node.id; path.unshift(part); break; }
      if (node.classList && node.classList.length) {
        var classes = [];
        for (var i = 0; i < node.classList.length; i++) {
          var c = node.classList[i];
          if (!/^mud-/.test(c)) classes.push(c);
        }
        classes = classes.slice(0, 3);
        if (classes.length) part += '.' + classes.join('.');
      }
      var parent = node.parentNode;
      if (parent && parent.children && parent.children.length > 1) {
        var sibs = [];
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].nodeName === node.nodeName) sibs.push(parent.children[j]);
        }
        if (sibs.length > 1) {
          part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
        }
      }
      path.unshift(part);
      node = parent;
    }
    return path.join(' > ');
  }

  // 給 triage 用的「強訊號」候選 — Phase 0 spike 證明這 4 個訊號夠
  function extractSignals(el) {
    function customClasses(node) {
      if (!node || !node.classList) return [];
      var arr = [];
      for (var i = 0; i < node.classList.length; i++) {
        var c = node.classList[i];
        if (!/^mud-/.test(c)) arr.push(c);
      }
      return arr;
    }
    return {
      customClasses: customClasses(el),
      parentCustomClasses: customClasses(el.parentElement),
      grandparentCustomClasses: el.parentElement ? customClasses(el.parentElement.parentElement) : [],
      visibleText: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      inlineStyle: el.getAttribute('style') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      dataTestId: el.getAttribute('data-testid') || '',
      tagName: el.tagName.toLowerCase(),
      // 把當下 document.title 一起送上來，inbox 顯示時用得到
      pageTitle: (document.title || '').trim()
    };
  }

  // 從 thread 拿顯示用標題。優先序：
  //   1. customTitle（客戶自己編的，最高優先）
  //   2. pageTitle（document.title 截掉 ` - 站名` suffix）
  //   3. route（舊資料、無 signals 時兜底）
  function pageTitleOf(t) {
    try {
      var s = JSON.parse(t.signalsJson || '{}');
      if (s.customTitle) return s.customTitle;
      if (s.pageTitle) return s.pageTitle.replace(/\s*[-—|·].*$/, '').trim();
    } catch (e) { /* ignore */ }
    return t.route || '/';
  }

  // ------------------------------------------------------------------------
  // Shadow DOM host
  // ------------------------------------------------------------------------
  var host = document.createElement('div');
  host.id = '__ntust-feedback-host';
  host.style.cssText = 'position:fixed;z-index:2147483640;top:0;left:0;width:0;height:0;';
  document.body.appendChild(host);
  var sr = host.attachShadow({ mode: 'open' });

  // ------------------------------------------------------------------------
  // Styles (注入 shadow root，不污染主頁；不繼承主頁字體所以自定義)
  // ------------------------------------------------------------------------
  var style = document.createElement('style');
  style.textContent = [
    '*{box-sizing:border-box;font-family:Inter,"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased;}',
    '.fab{position:fixed;right:24px;bottom:24px;width:52px;height:52px;border-radius:50%;background:' + COLOR.primary + ';color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 18px rgba(94,106,210,.35);transition:transform .15s,background .15s;border:0;font-size:0;pointer-events:auto;}',
    '.fab:hover{background:' + COLOR.primaryHover + ';transform:translateY(-2px) scale(1.04);}',
    '.fab.active{background:' + COLOR.danger + ';}',
    '.fab svg{width:22px;height:22px;}',
    '.hint{position:fixed;right:90px;bottom:34px;background:' + COLOR.ink + ';color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;letter-spacing:.2px;white-space:nowrap;pointer-events:none;animation:slideIn .25s;}',
    '.hint::after{content:"";position:absolute;right:-5px;top:50%;transform:translateY(-50%);border:5px solid transparent;border-left-color:' + COLOR.ink + ';}',
    '@keyframes slideIn{from{opacity:0;transform:translateX(8px);}to{opacity:1;transform:translateX(0);}}',
    '.outline{position:fixed;pointer-events:none;border:2px solid ' + COLOR.primary + ';background:rgba(94,106,210,.12);border-radius:4px;transition:all .08s;z-index:2147483641;}',
    '.popover{position:fixed;width:340px;background:' + COLOR.bg + ';border:1px solid ' + COLOR.line + ';border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12);padding:16px;z-index:2147483642;pointer-events:auto;}',
    '.popover .eyebrow{font-size:11px;font-weight:500;color:' + COLOR.inkSubtle + ';letter-spacing:.4px;text-transform:uppercase;margin-bottom:6px;}',
    '.popover .target{font-size:13px;color:' + COLOR.ink + ';background:' + COLOR.primarySoft + ';border-radius:6px;padding:6px 8px;margin-bottom:10px;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;word-break:break-all;}',
    '.popover input.title-input{width:100%;border:1px solid ' + COLOR.line + ';border-radius:8px;padding:8px 10px;font-size:13px;color:' + COLOR.ink + ';outline:none;font-family:inherit;margin-bottom:8px;}',
    '.popover input.title-input:focus{border-color:' + COLOR.primary + ';box-shadow:0 0 0 3px rgba(94,106,210,.18);}',
    '.popover textarea{width:100%;border:1px solid ' + COLOR.line + ';border-radius:8px;padding:10px;font-size:14px;color:' + COLOR.ink + ';resize:vertical;min-height:80px;outline:none;font-family:inherit;}',
    '.popover textarea:focus{border-color:' + COLOR.primary + ';box-shadow:0 0 0 3px rgba(94,106,210,.18);}',
    '.popover .row{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;}',
    '.popover .meta{font-size:11px;color:' + COLOR.inkTertiary + ';}',
    '.btn{height:30px;padding:0 12px;border-radius:6px;border:1px solid ' + COLOR.line + ';background:' + COLOR.bg + ';color:' + COLOR.ink + ';font-size:13px;font-weight:500;cursor:pointer;}',
    '.btn:hover{background:' + COLOR.primarySoft + ';}',
    '.btn-primary{background:' + COLOR.primary + ';color:#fff;border-color:' + COLOR.primary + ';}',
    '.btn-primary:hover{background:' + COLOR.primaryHover + ';}',
    '.btn-primary:disabled{opacity:.5;cursor:not-allowed;}',
    '.toast{position:fixed;left:50%;top:24px;transform:translateX(-50%);background:' + COLOR.success + ';color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;z-index:2147483643;animation:fadeIn .2s;box-shadow:0 6px 18px rgba(27,138,58,.35);}',
    '.toast.error{background:' + COLOR.danger + ';box-shadow:0 6px 18px rgba(192,57,43,.35);}',
    '@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(-6px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}',
    /* === Phase 3: Inbox FAB + sidebar drawer === */
    '.fab-inbox{position:fixed;right:24px;bottom:88px;width:44px;height:44px;border-radius:50%;background:' + COLOR.bg + ';color:' + COLOR.ink + ';border:1px solid ' + COLOR.line + ';display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.08);transition:transform .15s,background .15s,border-color .15s;pointer-events:auto;}',
    '.fab-inbox:hover{background:' + COLOR.primarySoft + ';border-color:' + COLOR.primary + ';transform:translateY(-2px);}',
    '.fab-inbox svg{width:18px;height:18px;}',
    '.fab-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:' + COLOR.danger + ';color:#fff;font-size:11px;font-weight:600;display:grid;place-items:center;border:2px solid #fff;}',
    '.drawer{position:fixed;right:0;top:0;height:100vh;width:380px;max-width:92vw;background:' + COLOR.bg + ';border-left:1px solid ' + COLOR.line + ';box-shadow:-12px 0 36px rgba(0,0,0,.10);z-index:2147483641;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s ease-out;pointer-events:auto;}',
    '.drawer.open{transform:translateX(0);}',
    '.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid ' + COLOR.line + ';flex-shrink:0;}',
    '.drawer-title{font-size:15px;font-weight:600;color:' + COLOR.ink + ';margin:0;letter-spacing:-0.2px;}',
    '.drawer-close{width:28px;height:28px;border-radius:6px;background:transparent;border:0;color:' + COLOR.inkSubtle + ';cursor:pointer;display:grid;place-items:center;}',
    '.drawer-close:hover{background:' + COLOR.primarySoft + ';color:' + COLOR.primary + ';}',
    '.filters{display:flex;gap:6px;padding:12px 18px 8px;border-bottom:1px solid ' + COLOR.line + ';flex-shrink:0;}',
    '.chip{padding:4px 10px;font-size:12px;border-radius:9999px;border:1px solid ' + COLOR.line + ';background:' + COLOR.bg + ';color:' + COLOR.inkSubtle + ';cursor:pointer;font-weight:500;}',
    '.chip.on{background:' + COLOR.primarySoft + ';color:' + COLOR.primary + ';border-color:' + COLOR.primary + ';}',
    '.list{flex:1;overflow-y:auto;padding:8px 12px 16px;}',
    '.empty{text-align:center;color:' + COLOR.inkTertiary + ';padding:48px 24px;font-size:13px;line-height:1.6;}',
    '.thread{padding:12px;border-radius:10px;margin:6px 0;border:1px solid transparent;cursor:pointer;background:transparent;}',
    '.thread:hover{background:' + COLOR.primarySoft + ';border-color:rgba(94,106,210,.2);}',
    '.thread .row1{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;}',
    '.thread .label{font-size:13px;font-weight:500;color:' + COLOR.ink + ';flex:1;line-height:1.4;}',
    '.thread .time{font-size:11px;color:' + COLOR.inkTertiary + ';flex-shrink:0;white-space:nowrap;}',
    '.thread .row2{display:flex;align-items:center;gap:8px;font-size:11px;color:' + COLOR.inkSubtle + ';}',
    '.thread .route{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;}',
    '.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;}',
    '.badge.open{background:#fff4e0;color:#b76e00;}',
    '.badge.clarification{background:#dbeafe;color:#1e40af;}',
    '.badge.done{background:' + COLOR.successSoft + ';color:#1b6e34;}',
    '.badge .dot{width:5px;height:5px;border-radius:9999px;background:currentColor;}',
    '.detail{display:flex;flex-direction:column;height:100%;}',
    '.detail-head{padding:12px 18px;border-bottom:1px solid ' + COLOR.line + ';flex-shrink:0;}',
    '.detail-back{display:inline-flex;align-items:center;gap:4px;color:' + COLOR.inkSubtle + ';font-size:12px;cursor:pointer;background:transparent;border:0;padding:4px 8px;border-radius:6px;margin-bottom:8px;font-weight:500;}',
    '.detail-back:hover{background:' + COLOR.primarySoft + ';color:' + COLOR.primary + ';}',
    '.detail-target{background:' + COLOR.primarySoft + ';border-radius:6px;padding:8px 10px;font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;color:' + COLOR.ink + ';margin-top:6px;word-break:break-all;line-height:1.5;}',
    '.detail-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}',
    '.detail-actions .btn{height:26px;font-size:11px;padding:0 10px;}',
    // 詳情頁可編輯主標題：h3 + 鉛筆 icon；點下去切換成 input
    '.detail-title-row{display:flex;align-items:center;gap:6px;margin:6px 0 4px;}',
    '.detail-title{font-size:15px;font-weight:600;color:' + COLOR.ink + ';margin:0;line-height:1.3;flex:1;word-break:break-word;}',
    '.detail-title-edit{flex:1;border:1px solid ' + COLOR.primary + ';border-radius:6px;padding:4px 8px;font-size:14px;font-weight:600;color:' + COLOR.ink + ';outline:none;font-family:inherit;}',
    '.pencil-btn{flex-shrink:0;width:24px;height:24px;border:none;background:transparent;border-radius:4px;color:' + COLOR.inkTertiary + ';cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;}',
    '.pencil-btn:hover{background:' + COLOR.surface2 + ';color:' + COLOR.primary + ';}',
    '.messages{flex:1;overflow-y:auto;padding:12px 18px;}',
    '.msg{margin-bottom:14px;}',
    '.msg .meta-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;color:' + COLOR.inkTertiary + ';}',
    '.msg .author{font-weight:600;color:' + COLOR.ink + ';}',
    '.msg .author.claude{color:' + COLOR.primary + ';}',
    '.msg .body{background:' + COLOR.surface2 + ';border-radius:8px;padding:10px 12px;font-size:13px;color:' + COLOR.ink + ';line-height:1.5;white-space:pre-wrap;word-break:break-word;}',
    '.msg.claude .body{background:' + COLOR.primarySoft + ';}',
    '.msg .kind-tag{font-size:10px;padding:1px 6px;border-radius:3px;background:' + COLOR.line + ';color:' + COLOR.inkSubtle + ';font-weight:500;}',
    '.reply{padding:12px 18px;border-top:1px solid ' + COLOR.line + ';flex-shrink:0;}',
    '.reply textarea{width:100%;border:1px solid ' + COLOR.line + ';border-radius:8px;padding:8px 10px;font-size:13px;color:' + COLOR.ink + ';resize:none;outline:none;font-family:inherit;min-height:60px;}',
    '.reply textarea:focus{border-color:' + COLOR.primary + ';box-shadow:0 0 0 3px rgba(94,106,210,.15);}',
    '.reply .row{display:flex;justify-content:space-between;align-items:center;margin-top:8px;}',
    '.reply .hint{font-size:11px;color:' + COLOR.inkTertiary + ';position:static;background:transparent;padding:0;animation:none;pointer-events:none;}',
    '.reply .hint::after{display:none;}',
    // Flash 配色：琥珀邊 + 淡黃底 + 黑色細 outline，universal portable，跟 brand 紫不混淆。
    // host 想覆寫可在 _Host.cshtml 注入 window.__feedbackFlashColor = { stroke, fill }
    '.target-flash{position:fixed;border:3px solid ' + FLASH.stroke + ';background:' + FLASH.fill + ';outline:1.5px solid rgba(0,0,0,.55);border-radius:6px;pointer-events:none;z-index:2147483641;animation:flashPulse 1.6s ease-out;}',
    '@keyframes flashPulse{0%{box-shadow:0 0 0 10px ' + FLASH.glow0 + ';}40%{box-shadow:0 0 0 0 ' + FLASH.glow40 + ';}100%{box-shadow:0 0 0 0 ' + FLASH.glow0 + ';}}'
  ].join('\n');
  sr.appendChild(style);

  // ------------------------------------------------------------------------
  // Render: floating action buttons (annotate + inbox)
  // ------------------------------------------------------------------------
  var fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = '對網頁留下註解';
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '<path d="M9 11h6M9 7h6"/>' +
    '</svg>';
  sr.appendChild(fab);

  // 第二顆 FAB：開啟我的註解清單（顯示未處理數量 badge）
  var fabInbox = document.createElement('button');
  fabInbox.className = 'fab-inbox';
  fabInbox.title = '我的註解';
  fabInbox.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/>' +
    '<path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' +
    '</svg>' +
    '<span class="fab-badge" style="display:none;">0</span>';
  sr.appendChild(fabInbox);

  // Drawer 容器（slide-in from right）
  var drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = '<div class="drawer-content"></div>';
  sr.appendChild(drawer);

  // ------------------------------------------------------------------------
  // State machine: idle | annotating | popover | submitting
  // ------------------------------------------------------------------------
  var state = 'idle';
  var hoverEl = null;
  var outline = null;
  var popover = null;
  var capturedMeta = null;

  function showToast(msg, isError) {
    var t = document.createElement('div');
    t.className = 'toast' + (isError ? ' error' : '');
    t.textContent = msg;
    sr.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  function showHint(text) {
    var h = document.createElement('div');
    h.className = 'hint';
    h.textContent = text;
    sr.appendChild(h);
    setTimeout(function () { h.remove(); }, 2200);
  }

  function makeOutline() {
    outline = document.createElement('div');
    outline.className = 'outline';
    sr.appendChild(outline);
  }

  function moveOutlineTo(el) {
    if (!outline) return;
    var r = el.getBoundingClientRect();
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
  }

  function clearOutline() {
    if (outline) { outline.remove(); outline = null; }
    hoverEl = null;
  }

  function clearPopover() {
    if (popover) { popover.remove(); popover = null; }
    capturedMeta = null;
  }

  // 只關掉指定的方塊；它若是目前的方塊才清掉全域狀態（避免舊方塊誤關新方塊）
  function closePopover(el) {
    el.remove();
    if (popover === el) { popover = null; capturedMeta = null; }
  }

  // ------------------------------------------------------------------------
  // Annotation mode
  // ------------------------------------------------------------------------
  function enterAnnotationMode() {
    clearPopover();   // 同一時間只留一個方塊
    state = 'annotating';
    fab.classList.add('active');
    fab.title = '取消註解模式';
    document.documentElement.style.cursor = 'crosshair';
    showHint('點任何元素留下註解 · ESC 取消');
    makeOutline();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onCapture, true);
    document.addEventListener('keydown', onKey, true);
  }

  function exitAnnotationMode() {
    state = 'idle';
    fab.classList.remove('active');
    fab.title = '對網頁留下註解';
    document.documentElement.style.cursor = '';
    clearOutline();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onCapture, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onMouseMove(e) {
    if (state !== 'annotating') return;
    // 不能 hover 到自己 widget 的東西
    if (host.contains(e.target)) return;
    if (hoverEl === e.target) return;
    hoverEl = e.target;
    moveOutlineTo(hoverEl);
  }

  function onKey(e) {
    if (state === 'submitting') return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (state === 'popover') { clearPopover(); }
      exitAnnotationMode();
    }
  }

  function onCapture(e) {
    if (state !== 'annotating') return;
    if (host.contains(e.target)) return;       // 點到自家 widget 不算
    e.preventDefault();
    e.stopPropagation();

    var el = e.target;
    var rect = el.getBoundingClientRect();
    clearPopover();
    capturedMeta = {
      session_id: sessionId,
      page_url: location.href,
      route: location.pathname,
      selector: cssPath(el),
      outer_html: (el.outerHTML || '').slice(0, 1500),
      bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      signals: extractSignals(el),
      deployment_sha: window.__DEPLOY_SHA__ || null,
      screenshot_b64: null      // Phase 1 暫不做截圖；Phase 2 再加 html2canvas
    };

    state = 'popover';
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onCapture, true);
    showPopover(rect, capturedMeta);
  }

  // ------------------------------------------------------------------------
  // Popover with comment input
  // ------------------------------------------------------------------------
  // 方塊的按鈕只作用在自己（el）與自己的註解資料（meta），不讀全域 popover / capturedMeta
  function showPopover(rect, meta) {
    var el = document.createElement('div');
    popover = el;
    el.className = 'popover';
    var label = meta.signals.visibleText || meta.signals.tagName + (meta.signals.customClasses[0] ? ('.' + meta.signals.customClasses[0]) : '');
    el.innerHTML =
      '<div class="eyebrow">註解此元素</div>' +
      '<div class="target">' + escapeHtml(label.slice(0, 80)) + '</div>' +
      '<input type="text" class="title-input" placeholder="標題（選填，例「字太小」）" maxlength="100" />' +
      '<textarea placeholder="想改什麼？例如：「這個按鈕字太小，看不清楚」" autofocus></textarea>' +
      '<div class="row">' +
      '<span class="meta">' + escapeHtml(meta.route) + ' · ' + meta.signals.tagName + '</span>' +
      '<div>' +
      '<button class="btn" data-action="cancel">取消</button>' +
      '<button class="btn btn-primary" data-action="submit" disabled style="margin-left:6px;">送出</button>' +
      '</div>' +
      '</div>';
    sr.appendChild(el);

    // 定位：嘗試放元素正下方，超出視窗邊界就往上 / 往左
    var left = rect.left;
    var top = rect.bottom + 8;
    if (left + 340 > window.innerWidth - 16) left = window.innerWidth - 340 - 16;
    if (left < 16) left = 16;
    if (top + 200 > window.innerHeight - 16) top = Math.max(16, rect.top - 220);
    el.style.left = left + 'px';
    el.style.top = top + 'px';

    var ta = el.querySelector('textarea');
    var submit = el.querySelector('[data-action=submit]');
    var cancel = el.querySelector('[data-action=cancel]');

    ta.focus();
    ta.addEventListener('input', function () {
      submit.disabled = ta.value.trim().length === 0;
    });
    cancel.addEventListener('click', function () {
      if (state === 'submitting' && popover === el) return;
      closePopover(el);
      if (!popover) exitAnnotationMode();
    });
    var titleInput = el.querySelector('input.title-input');
    submit.addEventListener('click', function () {
      if (state === 'submitting') return;
      meta.comment = ta.value.trim();
      if (!meta.comment) return;
      var customTitle = titleInput ? titleInput.value.trim() : '';
      if (customTitle) meta.signals.customTitle = customTitle;
      else delete meta.signals.customTitle;
      doSubmit(el, meta, submit);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }

  // ------------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------------
  function doSubmit(el, meta, btn) {
    state = 'submitting';
    btn.disabled = true;
    btn.textContent = '送出中…';

    fetch(API_BASE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
      })
      .then(function (data) {
        closePopover(el);
        if (!popover) exitAnnotationMode();   // 送出期間沒開新方塊才結束註解模式
        showToast('已送出註解' + (data && data.id ? '（#' + String(data.id).slice(0, 8) + '）' : ''));
      })
      .catch(function (err) {
        console.error('[feedback] submit failed', err, meta);
        window.__lastFeedbackMeta = meta;
        // 保留方塊與內容，讓使用者可以再送一次
        if (el.isConnected) {
          state = 'popover';
          btn.disabled = false;
          btn.textContent = '送出';
        }
        showToast('送出失敗：' + (err.message || '未知錯誤') + '，內容還在方塊裡，可以再送一次', true);
      });
  }

  // ========================================================================
  // Phase 3: Inbox sidebar drawer
  // ========================================================================

  var inbox = {
    threads: [],
    filter: 'all',           // all | open | clarification | done
    view: 'list',            // list | detail
    currentThreadId: null,
    currentThread: null,     // 含 messages 的完整詳情
    open: false,
    pollTimer: null
  };

  // ----- 相對時間（剛剛 / N 分鐘前 / N 小時前 / N 天前） -----
  function fmtRelativeTime(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return iso;
    var diff = Math.max(0, (Date.now() - t) / 1000);
    if (diff < 30) return '剛剛';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分鐘前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小時前';
    if (diff < 604800) return Math.floor(diff / 86400) + ' 天前';
    return new Date(iso).toLocaleDateString('zh-TW');
  }

  // ----- 取 thread 顯示的標題（visibleText 截斷，沒就用 selector 末段） -----
  function threadLabel(t) {
    try {
      var s = JSON.parse(t.signalsJson || '{}');
      if (s.visibleText) return s.visibleText.slice(0, 50);
    } catch (e) { /* ignore */ }
    var sel = (t.selector || '').split(' > ').slice(-1)[0] || '(unknown)';
    return sel;
  }

  // ----- 狀態 badge HTML -----
  function statusBadge(status) {
    var label = { open: '處理中', clarification: '待補充', done: '已完工' }[status] || status;
    return '<span class="badge ' + status + '"><span class="dot"></span>' + label + '</span>';
  }

  // ----- 計算未處理數量（給 fab badge） -----
  function unresolvedCount() {
    var n = 0;
    for (var i = 0; i < inbox.threads.length; i++) {
      if (inbox.threads[i].status !== 'done') n++;
    }
    return n;
  }

  function updateFabBadge() {
    var b = fabInbox.querySelector('.fab-badge');
    if (!b) return;
    var n = unresolvedCount();
    if (n > 0) {
      b.textContent = n > 99 ? '99+' : String(n);
      b.style.display = '';
    } else {
      b.style.display = 'none';
    }
  }

  // ----- Polling：抓自己的 thread 列表 -----
  function fetchInbox() {
    return fetch(API_BASE, { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        inbox.threads = Array.isArray(rows) ? rows : [];
        updateFabBadge();
        if (inbox.open && inbox.view === 'list') renderList();
      })
      .catch(function (err) { console.warn('[feedback] poll fail', err); });
  }

  function startPolling() {
    if (inbox.pollTimer) return;
    fetchInbox();
    inbox.pollTimer = setInterval(function () {
      // 只有頁面可見時才打（背景 tab 省電省 API）
      if (!document.hidden) fetchInbox();
    }, 30000);
  }

  // ----- 開 / 關 drawer -----
  function openDrawer() {
    inbox.open = true;
    inbox.view = 'list';
    drawer.classList.add('open');
    fetchInbox().then(renderList);
  }
  function closeDrawer() {
    inbox.open = false;
    drawer.classList.remove('open');
  }

  // ----- 渲染 list view -----
  function renderList() {
    var threads = inbox.threads;
    if (inbox.filter !== 'all') {
      threads = threads.filter(function (t) { return t.status === inbox.filter; });
    }

    var content = drawer.querySelector('.drawer-content');
    content.innerHTML =
      '<div class="drawer-head">' +
        '<h2 class="drawer-title">我的註解' + (inbox.threads.length ? ' (' + inbox.threads.length + ')' : '') + '</h2>' +
        '<button class="drawer-close" aria-label="關閉">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="filters">' +
        '<button class="chip ' + (inbox.filter === 'all' ? 'on' : '') + '" data-filter="all">全部</button>' +
        '<button class="chip ' + (inbox.filter === 'open' ? 'on' : '') + '" data-filter="open">處理中</button>' +
        '<button class="chip ' + (inbox.filter === 'clarification' ? 'on' : '') + '" data-filter="clarification">待補充</button>' +
        '<button class="chip ' + (inbox.filter === 'done' ? 'on' : '') + '" data-filter="done">已完工</button>' +
      '</div>' +
      '<div class="list"></div>';

    content.querySelector('.drawer-close').addEventListener('click', closeDrawer);
    var chips = content.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function (e) {
        inbox.filter = e.currentTarget.getAttribute('data-filter');
        renderList();
      });
    }

    var list = content.querySelector('.list');
    if (threads.length === 0) {
      list.innerHTML = '<div class="empty">' +
        (inbox.threads.length === 0
          ? '還沒留過註解<br>點下面那顆紫色泡泡按鈕開始'
          : '此狀態無註解') +
        '</div>';
      return;
    }

    var html = '';
    for (var k = 0; k < threads.length; k++) {
      var t = threads[k];
      // row1 主標 = 頁名（客戶最容易識別），row2 副資訊 = badge / 訊息數 / 元素摘要。
      // 多筆 thread 同一頁時靠 row2 元素摘要區分。route 放 tooltip 給工程師 debug。
      html += '<div class="thread" data-id="' + t.id + '">' +
        '<div class="row1">' +
          '<div class="label" title="' + escapeHtml(t.route || '/') + '">' + escapeHtml(pageTitleOf(t)) + '</div>' +
          '<div class="time">' + fmtRelativeTime(t.updatedAt) + '</div>' +
        '</div>' +
        '<div class="row2">' +
          statusBadge(t.status) +
          '<span>·</span>' +
          '<span>' + (t.messageCount || 1) + ' 則訊息</span>' +
          '<span>·</span>' +
          '<span class="route">' + escapeHtml(threadLabel(t)) + '</span>' +
        '</div>' +
      '</div>';
    }
    list.innerHTML = html;

    var threadEls = list.querySelectorAll('.thread');
    for (var j = 0; j < threadEls.length; j++) {
      threadEls[j].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-id');
        openThread(id);
      });
    }
  }

  // ----- 進入單一 thread detail view -----
  function openThread(id) {
    inbox.currentThreadId = id;
    inbox.view = 'detail';
    var content = drawer.querySelector('.drawer-content');
    content.innerHTML = '<div class="empty">載入中…</div>';

    fetch(API_BASE + '/' + id, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (thread) {
        inbox.currentThread = thread;
        renderDetail();
      })
      .catch(function (err) {
        content.innerHTML = '<div class="empty">載入失敗：' + escapeHtml(err.message) + '</div>';
      });
  }

  function backToList() {
    inbox.view = 'list';
    inbox.currentThreadId = null;
    inbox.currentThread = null;
    fetchInbox().then(renderList);
  }

  function renderDetail() {
    var t = inbox.currentThread;
    if (!t) return;
    var content = drawer.querySelector('.drawer-content');

    var msgsHtml = '';
    for (var i = 0; i < (t.messages || []).length; i++) {
      var m = t.messages[i];
      var isClaude = m.authorType === 'claude';
      var kindLabel = {
        comment: '評論', clarification: '追問', proposal: '修改方案', approval: '同意', 'done-note': '完工'
      }[m.kind] || m.kind;
      // 顯示用名稱：DB authorType 維持 'claude'（程式判斷用），UI 顯示「AI 助理」
      msgsHtml += '<div class="msg ' + (isClaude ? 'claude' : 'customer') + '">' +
        '<div class="meta-row">' +
          '<span class="author ' + (isClaude ? 'claude' : '') + '">' + escapeHtml(isClaude ? AI_NAME : '你') + '</span>' +
          '<span class="kind-tag">' + kindLabel + '</span>' +
          '<span>' + fmtRelativeTime(m.createdAt) + '</span>' +
        '</div>' +
        '<div class="body">' + escapeHtml(m.body || '') + '</div>' +
      '</div>';
    }

    var label = (function () {
      try {
        var s = JSON.parse(t.signalsJson || '{}');
        return s.visibleText || '(無可見文字)';
      } catch (e) { return '(訊號解析失敗)'; }
    })();

    content.innerHTML =
      '<div class="drawer-head">' +
        '<h2 class="drawer-title">註解詳情</h2>' +
        '<button class="drawer-close" aria-label="關閉">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="detail-head">' +
        '<button class="detail-back" data-action="back">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> 回列表' +
        '</button>' +
        '<div class="detail-title-row">' +
          '<h3 class="detail-title" data-action="title-display">' + escapeHtml(pageTitleOf(t)) + '</h3>' +
          '<button class="pencil-btn" data-action="edit-title" title="編輯標題" aria-label="編輯標題">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          statusBadge(t.status) +
          '<span style="font-size:11px;color:' + COLOR.inkTertiary + ';" title="' + escapeHtml(t.route || '') + '">' + escapeHtml(t.route || '') + '</span>' +
          (t.prUrl ? ' <a href="' + escapeHtml(t.prUrl) + '" target="_blank" style="font-size:11px;color:' + COLOR.primary + ';">PR ↗</a>' : '') +
        '</div>' +
        '<div class="detail-target">' + escapeHtml(label.slice(0, 200)) + '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn" data-action="goto">跳到該元素</button>' +
          // 客戶看完 PR 滿意才自己按；status=done 後就不再顯示
          (t.prUrl && t.status !== 'done'
            ? '<button class="btn btn-primary" data-action="mark-done">標記完工</button>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="messages">' + msgsHtml + '</div>' +
      '<div class="reply">' +
        '<textarea placeholder="' + escapeHtml('回覆 ' + AI_NAME + ' 或補充更多細節…') + '"></textarea>' +
        '<div class="row">' +
          '<span class="hint">' + (t.status === 'clarification' ? escapeHtml(AI_NAME + ' 在等你補充') : '') + '</span>' +
          '<button class="btn btn-primary" data-action="reply" disabled>送出</button>' +
        '</div>' +
      '</div>';

    content.querySelector('.drawer-close').addEventListener('click', closeDrawer);
    content.querySelector('[data-action=back]').addEventListener('click', backToList);
    content.querySelector('[data-action=goto]').addEventListener('click', function () { gotoElement(t); });
    var btnDone = content.querySelector('[data-action=mark-done]');
    if (btnDone) {
      btnDone.addEventListener('click', function () { markDone(t.id, btnDone); });
    }
    var btnEdit = content.querySelector('[data-action=edit-title]');
    if (btnEdit) {
      btnEdit.addEventListener('click', function () { startEditTitle(t); });
    }

    var ta = content.querySelector('.reply textarea');
    var btnReply = content.querySelector('[data-action=reply]');
    ta.addEventListener('input', function () {
      btnReply.disabled = ta.value.trim().length === 0;
    });
    btnReply.addEventListener('click', function () { sendReply(ta.value.trim(), btnReply); });

    // 自動滾到最新一則 message
    var msgsEl = content.querySelector('.messages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // 點鉛筆 → 把 .detail-title 換成 input；Enter 存、ESC 還原
  function startEditTitle(t) {
    var content = drawer.querySelector('.drawer-content');
    var titleEl = content.querySelector('.detail-title');
    if (!titleEl) return;
    var current = pageTitleOf(t);
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.className = 'detail-title-edit';
    input.value = current;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function commit() {
      if (done) return; done = true;
      var v = input.value.trim();
      if (v === current) { renderDetail(); return; }  // 沒改
      saveCustomTitle(t.id, v);
    }
    function cancel() {
      if (done) return; done = true;
      renderDetail();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  function saveCustomTitle(id, title) {
    fetch(API_BASE + '/' + id, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customTitle: title })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        showToast(title ? '標題已更新' : '已清除自訂標題');
        // 重抓 thread 以刷新 signalsJson
        return fetch(API_BASE + '/' + id, { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (t) {
            inbox.currentThread = t;
            // 同時更新 inbox cache 那筆
            var idx = (inbox.threads || []).findIndex(function (x) { return x.id === id; });
            if (idx >= 0) inbox.threads[idx].signalsJson = t.signalsJson;
            renderDetail();
          });
      })
      .catch(function (err) {
        showToast('更新失敗：' + err.message, true);
        renderDetail();
      });
  }

  function markDone(id, btn) {
    btn.disabled = true;
    btn.textContent = '標記中…';
    fetch(API_BASE + '/' + id, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () { showToast('已標記完工'); openThread(id); })
      .catch(function (err) {
        showToast('標記失敗：' + err.message, true);
        btn.disabled = false;
        btn.textContent = '標記完工';
      });
  }

  function sendReply(body, btn) {
    if (!body || !inbox.currentThreadId) return;
    btn.disabled = true;
    btn.textContent = '送出中…';
    fetch(API_BASE + '/' + inbox.currentThreadId + '/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'comment', body: body })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () {
        showToast('已送出回覆');
        // 重新拉一次 thread 詳情
        return fetch(API_BASE + '/' + inbox.currentThreadId, { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (t) { inbox.currentThread = t; renderDetail(); });
      })
      .catch(function (err) {
        showToast('回覆失敗：' + err.message, true);
        btn.disabled = false;
        btn.textContent = '送出';
      });
  }

  // ----- 跳到元素：selector 找不到時依序 fallback：
  //         1. visibleText + customClass 配對
  //         2. 純 customClass 第一個
  //         3. 都不行 → 提示路由不對 / 頁面改版
  function gotoElement(thread) {
    var target = null;
    try { target = document.querySelector(thread.selector); } catch (e) { /* invalid selector */ }

    if (!target) {
      try {
        var sig = JSON.parse(thread.signalsJson || '{}');
        var classes = (sig.customClasses || []).filter(function (c) { return c && !/^mud-/.test(c); });

        // 2.1 visibleText + 第一個 customClass：最精準的 fallback
        if (sig.visibleText && classes.length) {
          var nodes = document.querySelectorAll('.' + classes[0]);
          for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].textContent || '').trim().indexOf(sig.visibleText) >= 0) {
              target = nodes[i]; break;
            }
          }
        }
        // 2.2 純 customClass 第一個
        if (!target && classes.length) {
          target = document.querySelector('.' + classes[0]);
        }
        // 2.3 純 visibleText（最後手段，可能會撞到別的元素）
        if (!target && sig.visibleText && sig.visibleText.length >= 3) {
          var all = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,div');
          for (var j = 0; j < all.length; j++) {
            if ((all[j].textContent || '').trim() === sig.visibleText.trim()) {
              target = all[j]; break;
            }
          }
        }
      } catch (e) { /* signals parse fail */ }
    }

    if (!target) {
      // 跨頁：自動 full reload 切過去，URL 帶 hash，新頁 mount 後 consumePendingJump 會重跑 highlight
      if (thread.route && thread.route !== location.pathname) {
        closeDrawer();
        location.assign(thread.route + '#feedback-' + thread.id);
        return;
      }
      // 同路由還找不到：頁面真的改版了
      showToast('找不到該元素 — 頁面可能已改版或元素被刪除', true);
      return;
    }
    closeDrawer();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    placeFlashWhenStable(target);
  }

  // 用 rAF 等 bbox 連續穩定 ≥3 frame 再放 flash，避免 smooth scroll 還在進行時
  // 拿到中途座標。1.5s 兜底防無窮迴圈（極少見 — 目標元素是 sticky / 動畫
  // 永動的場合）。
  function placeFlashWhenStable(target) {
    var lastTop = null;
    var stableFrames = 0;
    var deadline = performance.now() + 1500;
    function tick() {
      var r = target.getBoundingClientRect();
      if (lastTop !== null && Math.abs(r.top - lastTop) < 0.5) {
        stableFrames++;
      } else {
        stableFrames = 0;
      }
      lastTop = r.top;
      if (stableFrames >= 3 || performance.now() >= deadline) {
        var flash = document.createElement('div');
        flash.className = 'target-flash';
        flash.style.left = r.left + 'px';
        flash.style.top = r.top + 'px';
        flash.style.width = r.width + 'px';
        flash.style.height = r.height + 'px';
        sr.appendChild(flash);
        setTimeout(function () { flash.remove(); }, 1700);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------------
  // Wire up FABs
  // ------------------------------------------------------------------------
  fab.addEventListener('click', function () {
    if (state === 'submitting') return;
    if (state === 'idle') enterAnnotationMode();
    else { clearPopover(); exitAnnotationMode(); }
  });
  fabInbox.addEventListener('click', function () {
    if (inbox.open) closeDrawer();
    else openDrawer();
  });

  // 開始 background polling（讓 fab badge 一上線就有正確數字）
  startPolling();

  // 跨頁跳到元素：URL 帶 #feedback-<uuid> 進來時，等渲染穩定後自動 highlight
  consumePendingJump();

  function consumePendingJump() {
    var m = (location.hash || '').match(/^#feedback-([0-9a-f-]{36})$/i);
    if (!m) return;
    var tid = m[1];
    // 立刻清掉 hash：避免 reload 又觸發、URL 也乾淨
    history.replaceState(null, '', location.pathname + location.search);
    fetchInbox().then(function () {
      var t = (inbox.threads || []).find(function (x) { return x.id === tid; });
      if (t) return scheduleJump(t);
      // inbox cache 沒有就直接 GET /api/feedback/{id}
      return fetch(API_BASE + '/' + tid, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t2) { if (t2) scheduleJump(t2); });
    });
  }
  function scheduleJump(thread) {
    // 等 Blazor Server SignalR 重連 + 目標頁渲染完
    setTimeout(function () { gotoElement(thread); }, 600);
  }

  // 露面 console banner，方便確認載入
  console.log('%c[NTUST Feedback Widget] mounted · session=' + sessionId.slice(0, 8) + '…',
    'color:#5e6ad2;font-weight:bold;');
})();
