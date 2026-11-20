// 注入到微信读书页面里运行：窄边距排版 + 自动翻页/滚动
// 由 main.js 读取后通过 executeJavaScript 执行，边距占位符会被替换为像素值（-1 表示保持原版）
(() => {
  const M0 = __MARGIN__;
  if (window.__wrm) { window.__wrm.setMargin(M0); return; }

  let M = M0;          // 目标左右边距（像素）
  let pad = 70;        // 微信读书翻页模式内置的左右留白，会自动校准
  let tries = 0;
  let pt = 84, pb = 70;  // 翻页模式正文上下内置留白（顶部书名/章节名行、底部翻页按钮），会自动读取
  let BTN = 26;          // 右下角 ☰ / 左下角书架按钮的边长，随窗口大小在 20~30px 之间变化
  const T = 12;          // 正文离窗口上边缘的距离（按钮叠在文字上方，不再单独占一行）
  const B = 10;          // 正文离窗口下边缘的距离
  const st = document.createElement('style');
  st.id = '__wrm_css';
  (document.head || document.documentElement).appendChild(st);

  const isHor = () => !!document.querySelector('.wr_horizontalReader');

  // 右侧功能栏改为收纳式：平时隐藏，点右上角“☰”按钮展开
  // 播报条模式：书页继续在后台排版画字（播报条要读取文字），但完全不显示，避免透明背景下透出原文
  // 注意：网页的整页背景色会画在“画布底层”，不受 opacity 影响，所以背景也要一起设成透明，否则会露出一块色块
  const TICKER_CSS = `html.wrm-ticker, html.wrm-ticker body { opacity: 0 !important; background: transparent !important; background-image: none !important; }`;
  const CTRL_CSS = `
.readerControls{display:flex!important;flex-direction:column!important;position:fixed!important;left:auto!important;right:6px!important;
  top:auto!important;bottom:calc(var(--wrm-b,26px) + 14px)!important;transform:scale(var(--wrm-s,1))!important;transform-origin:bottom right!important;margin:0!important;
  z-index:1000!important;padding:4px!important;border-radius:14px!important;background:rgba(128,128,128,.16)!important;
  backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.25)!important;
  visibility:hidden!important;opacity:0!important;pointer-events:none!important;transition:opacity .12s!important}
html.wrm-open .readerControls{visibility:visible!important;opacity:1!important;pointer-events:auto!important}
/* 功能说明气泡：显示在按钮左侧，深色底白字 */
.readerControls .wr_tooltip_item{left:auto!important;right:calc(100% + 8px)!important;top:50%!important;transform:translateY(-50%) scale(calc(1 / var(--wrm-s,1)))!important;transform-origin:right center!important;
  background:rgba(32,33,36,.95)!important;color:#fff!important;padding:5px 10px!important;border-radius:6px!important;
  font-size:13px!important;line-height:1.4!important;white-space:nowrap!important;box-shadow:0 2px 8px rgba(0,0,0,.35)!important;pointer-events:none!important}
/* 右下角 ☰ 菜单按钮、左下角返回书架按钮：大小随窗口变化（20~30px） */
#__wrm_tg,#__wrm_shelf{position:fixed;top:auto;bottom:7px;width:var(--wrm-b,26px);height:var(--wrm-b,26px);z-index:1001;border:0;
  border-radius:calc(var(--wrm-b,26px) * .27);padding:0;margin:0;display:grid;place-items:center;cursor:pointer;
  background:transparent;color:#8a8c90;opacity:.2;transition:opacity .12s,background .12s}
#__wrm_tg{right:7px}
#__wrm_shelf{left:7px}
#__wrm_tg:hover,#__wrm_shelf:hover,html.wrm-open #__wrm_tg{opacity:1;background:rgba(40,40,44,.85);color:#e8e8e8;box-shadow:0 1px 6px rgba(0,0,0,.3)}
#__wrm_tg svg,#__wrm_shelf svg{width:64%;height:64%;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
html:not(.wrm-has-ctrl) #__wrm_shelf,html:not(.wrm-has-ctrl) #__wrm_tg{display:none}
/* 划线/想法/书友想法等弹窗：固定在窗口内，宽度随窗口，过高时内部滚动，底部留出可点击关闭的空白 */
.reader_float_panel_container{position:fixed!important;left:8px!important;right:8px!important;top:8px!important;bottom:auto!important;
  width:auto!important;min-width:0!important;max-width:none!important;max-height:calc(100vh - 16px)!important;overflow:auto!important;
  transform:none!important;margin:0!important;box-sizing:border-box!important}
.reader_floatReviewsPanel_content_arrow{display:none!important}`;
  function css() {
    if (M < 0) { st.textContent = CTRL_CSS; return; }
    st.textContent = `
/* 翻页模式：把内容区加宽，让内置留白落到窗口外 */
.wr_horizontalReader .readerTopBar{display:none!important}
.wr_horizontalReader .readerChapterContent{flex-shrink:0!important;max-width:none!important;width:calc(100vw + ${2 * pad - 2 * M}px)!important;
  margin:${T - pt}px 0 0 0!important;height:calc(100vh + ${pt - T + pb - B}px)!important;max-height:none!important;min-height:0!important}
/* 翻页模式：隐藏顶部书名/章节名行和底部“上一页/下一页”按钮（改为点击左右两侧翻页） */
.wr_horizontalReader .renderTargetPageInfo_header{visibility:hidden!important}
.wr_horizontalReader .renderTarget_pager{visibility:hidden!important;pointer-events:none!important}
/* 滚动模式 */
.readerContent .app_content{max-width:none!important;width:auto!important;margin:0!important;padding:0!important}
.readerContent .readerTopBar{display:none!important}
.readerContent .navBarOffset{padding-top:${T}px!important;height:auto!important}
.readerContent .readerContentHeader{display:none!important}
.readerContent .readerChapterContent{margin-left:${M}px!important;margin-right:${M}px!important;width:auto!important;max-width:none!important}
.readerContent .readerFooter{padding-left:${M}px!important;padding-right:${M}px!important}
${CTRL_CSS}
`;
  }
  const relayout = () => window.dispatchEvent(new Event('resize'));

  // 右侧功能栏按窗口高度自动缩放，窗口再矮也能看到全部按钮
  function fitControls() {
    const c = document.querySelector('.readerControls');
    if (!c) return;
    const h = c.offsetHeight;                 // 未缩放时的高度
    if (!h) return;
    const s = Math.max(0.35, Math.min(1, (innerHeight - BTN - 20) / h));
    const v = s.toFixed(3);
    if (document.documentElement.style.getPropertyValue('--wrm-s') !== v) document.documentElement.style.setProperty('--wrm-s', v);
  }
  function fitButtons() {
    // 主要按窗口宽度计算：22~34 像素（窗口越宽按钮越大）；窗口很矮时最大 26；
    // 页面放大/缩小（字体大小）时反向抵消，按钮在屏幕上的大小只跟窗口有关
    const z = window.__wrmZoom || 1;
    const w = innerWidth * z, h = innerHeight * z;
    const phys = Math.max(22, Math.min(h < 160 ? 26 : 34, w * 0.045));
    const b = Math.round(phys / z);
    document.documentElement.style.setProperty('--wrm-b', b + 'px');
    BTN = b;
  }
  window.addEventListener('resize', fitButtons);
  window.addEventListener('resize', fitControls);
  setInterval(fitControls, 800);

  // 校准：让翻页模式正文左边缘正好落在 M 处
  setInterval(() => {
    if (M < 0 || !isHor()) return;
    const c = document.querySelector('.wr_horizontalReader .wr_canvasContainer canvas');
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;          // 正在重新排版（容器隐藏中），跳过
    const pre = document.querySelector('.wr_horizontalReader .preRenderContent');
    if (pre) {
      const npt = parseFloat(pre.style.paddingTop), npb = parseFloat(pre.style.paddingBottom);
      if (npt >= 0 && npb >= 0 && (Math.abs(npt - pt) > 0.5 || Math.abs(npb - pb) > 0.5) && tries < 5) {
        tries++; pt = npt; pb = npb; css(); relayout(); return;
      }
    }
    const err = Math.round(r.x - M);
    if (Math.abs(err) <= 1) { tries = 0; return; }
    if (tries >= 5 || Math.abs(err) >= 400) return;     // 防止反复重排
    tries++; pad += err; css(); relayout();
  }, 600);
  window.addEventListener('resize', (e) => { if (e.isTrusted) tries = 0; });

  // ---------- 自动翻页 / 滚动 ----------
  let speed = 0, acc = 0, bottomSince = 0, scrollTimer = null;
  function nextPage() {
    const b = document.querySelector('.renderTarget_pager_button_right');
    if (!b) return 'none';
    if (!b.getClientRects().length) return 'busy';      // 正在排版，稍后再试
    b.click(); return 'ok';
  }
  function prevPage() {
    const b = [...document.querySelectorAll('.renderTarget_pager_button')].find(x => !x.classList.contains('renderTarget_pager_button_right'));
    if (b && b.style.display !== 'none') { b.click(); return true; }
    return false;
  }
  // 翻页模式：点击窗口左侧 35% 翻上一页，右侧 35% 翻下一页（拖动选字、点按钮/链接/菜单时不触发）
  // ---------- 收纳按钮 ----------
  const root = document.documentElement;
  function ensureToggle() {
    root.classList.toggle('wrm-has-ctrl', !!document.querySelector('.readerControls'));
    if (!document.body) return;
    if (!document.getElementById('__wrm_shelf')) {
      const sb = document.createElement('button');
      sb.id = '__wrm_shelf';
      sb.title = '返回书架';
      sb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20V5a1 1 0 0 1 1-1h3v16M8 4h3v16M14 7l3-1 4 13-3 1z"/><path d="M3 20h18"/></svg>';
      sb.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); location.href = 'https://weread.qq.com/web/shelf'; }, true);
      document.body.appendChild(sb);
    }
    if (document.getElementById('__wrm_tg')) return;
    const tg = document.createElement('button');
    tg.id = '__wrm_tg';
    tg.title = '功能菜单（目录 / 笔记 / 切换阅读方式 / 字号 / 主题）';
    tg.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    tg.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      root.classList.toggle('wrm-open');
      fitControls();
    }, true);
    document.body.appendChild(tg);
  }
  ensureToggle();
  setInterval(ensureToggle, 700);

  // 是否有弹窗（遮罩）处于打开状态
  function maskOpen() {
    return [...document.querySelectorAll('.wr_mask')].some((m) => {
      const r = m.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || r.right <= 0 || r.left >= innerWidth) return false;
      const cs = getComputedStyle(m);
      return cs.pointerEvents !== 'none' && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
  }
  // 阅读进度（当前页 / 本章总页数），显示在工具栏书名后面
  let progText = '';
  function updateProgress() {
    document.getElementById('__wrm_prog')?.remove();       // 清理旧版本放在页面上的进度
    let txt = '';
    if (isHor()) {
      const t = totalPages();
      if (t) {
        if (landOnLast) { pIdx = t - 1; landOnLast = false; }
        txt = `${Math.min(pIdx + 1, t)} / ${t}`;
      }
    } else if (document.querySelector('.readerContent')) {
      const se = document.scrollingElement, max = se.scrollHeight - innerHeight;
      if (max > 0) txt = Math.round(Math.min(1, se.scrollTop / max) * 100) + '%';
    }
    progText = txt;
  }
  setInterval(updateProgress, 300);

  function ensureExtras() {
    root.classList.toggle('wrm-panel', maskOpen());
    root.classList.toggle('wrm-dark', /wr_theme=dark/.test(document.cookie));   // 透明背景时按主题选择文字描边颜色
    document.querySelectorAll('.__wrm_item, #__wrm_close').forEach((e) => e.remove());   // 清理旧版本留下的元素
  }
  ensureExtras();
  setInterval(ensureExtras, 300);
  // 展开状态下：点功能项后自动收起；点其它地方只收起菜单，不翻页
  window.addEventListener('click', (e) => {
    if (!root.classList.contains('wrm-open')) return;
    if (e.target.closest('#__wrm_tg, #__wrm_shelf')) return;
    if (e.target.closest('.readerControls')) { setTimeout(() => root.classList.remove('wrm-open'), 0); return; }
    root.classList.remove('wrm-open');
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.classList.remove('wrm-open'); }, true);

  let downX = 0, downY = 0, downT = 0;
  window.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; downT = Date.now(); }, true);
  window.addEventListener('click', (e) => {
    if (!isHor() || e.button !== 0 || e.altKey || e.ctrlKey || e.shiftKey) return;
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5 || Date.now() - downT > 600) return;
    if (e.target.closest('#__wrm_tg, #__wrm_shelf, button, a, input, textarea, [role=button], .readerControls, [class*=panel], [class*=dialog], [class*=popup], [class*=toolbar], [class*=Toolbar], [class*=menu]')) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return;
    // 点在遮罩上（关闭弹窗）或弹窗开着时不翻页
    if (e.target.closest('.wr_mask, .reader_float_panel_container') || maskOpen()) return;
    const w = innerWidth, x = e.clientX;
    if (x >= w * 0.35 && x <= w * 0.65) return;
    // 稍等一下再翻：如果这次点击打开了划线/想法弹窗，就不翻页
    setTimeout(() => {
      if (maskOpen()) return;
      if (x < w * 0.35) prevPage(); else nextPage();
    }, 120);
  }, true);
  function nextChapter() {
    const b = [...document.querySelectorAll('.readerFooter_button, .readerFooter button')]
      .find(e => /下一章/.test(e.textContent));
    if (b) { b.click(); return true; }
    return false;
  }
  function startScroll(s) {
    speed = s; acc = 0; bottomSince = 0;
    clearInterval(scrollTimer);
    if (!s) return;
    let last = performance.now();
    scrollTimer = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (isHor()) return;
      const el = document.scrollingElement;
      if (el.scrollTop + innerHeight >= el.scrollHeight - 4) {
        bottomSince ||= now;
        if (now - bottomSince > 2000) { bottomSince = 0; nextChapter(); }
        return;
      }
      bottomSince = 0;
      acc += speed * Math.min(dt, 0.2);
      const d = Math.floor(acc);
      if (d >= 1) { acc -= d; el.scrollTop += d; }
    }, 30);
  }

  // ---------- 记住每章读到的页（返回书架再进来时回到原来的页） ----------
  // 网页版重新进入时只记得章节，不记得页码。这里按章节记录：第几页、该页画面指纹、当时的窗口大小。
  const POS_KEY = 'wrm_pos';
  const loadPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch { return {}; } };
  const savePosMap = (m) => {
    try {
      const ks = Object.keys(m);
      if (ks.length > 80) ks.sort((a, b) => m[a].ts - m[b].ts).slice(0, ks.length - 80).forEach((k) => delete m[k]);
      localStorage.setItem(POS_KEY, JSON.stringify(m));
    } catch {}
  };
  const inReaderPath = () => /\/web\/reader\//.test(location.pathname);
  // 章节标识 = 网址 + 章节名。有些书换章时网址不变，只按网址区分会把整本书当成一章（导致恢复时连续翻很多页）
  function chapKey() {
    if (!inReaderPath()) return null;
    const h = document.querySelector(isHor() ? '.wr_horizontalReader .renderTargetPageInfo_header' : '.readerContent .readerContentHeader');
    const t = h ? h.textContent.trim() : '';
    return t ? location.pathname + '#' + t : '';          // '' = 页面还没排好，稍后再判断
  }
  const canvasEl = () => document.querySelector('.wr_horizontalReader .wr_canvasContainer canvas');
  function pageHash() {
    const c = canvasEl();
    if (!c || !c.width || !c.height) return null;
    try {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let x = 0, ink = 0;
      for (let i = 0; i < d.length; i += 97) { x = (x * 31 + d[i]) >>> 0; }
      return x;
    } catch { return null; }
  }
  function totalPages() {
    const c = canvasEl(); if (!c) return 0;
    const w = c.getBoundingClientRect().width; if (w < 50) return 0;
    let m = 0;
    document.querySelectorAll('.wr_horizontalReader .wr_decoration').forEach((d) => { m = Math.max(m, parseFloat(d.style.width) || 0); });
    return m ? Math.max(1, Math.round(m / w)) : 0;
  }
  const pageReady = () => { const ct = document.querySelector('.wr_horizontalReader .renderTargetContainer'); const c = canvasEl(); return !!(ct && ct.getClientRects().length && c && c.getBoundingClientRect().width > 50); };
  let pIdx = 0, restoring = false, lastPath = null, saveTimer2 = null;
  function rememberNow() {
    const k = chapKey(); if (!k || restoring) return;
    const m = loadPos();
    if (isHor()) {
      if (!pageReady()) return;
      m[k] = { mode: 'page', i: pIdx, t: totalPages(), h: pageHash(), w: innerWidth, hh: innerHeight, ts: Date.now() };
    } else {
      const el = document.scrollingElement;
      m[k] = { mode: 'scroll', f: el.scrollHeight ? el.scrollTop / el.scrollHeight : 0, ts: Date.now() };
    }
    savePosMap(m);
  }
  function rememberSoon() {
    clearTimeout(saveTimer2);
    saveTimer2 = setTimeout(() => {
      const k = chapKey(); if (!k || restoring) return;
      const m = loadPos();
      if (isHor()) {
        if (!pageReady()) return;
        m[k] = { mode: 'page', i: pIdx, t: totalPages(), h: pageHash(), w: innerWidth, hh: innerHeight, ts: Date.now() };
      } else {
        const el = document.scrollingElement;
        m[k] = { mode: 'scroll', f: el.scrollHeight ? el.scrollTop / el.scrollHeight : 0, ts: Date.now() };
      }
      savePosMap(m);
    }, 500);
  }
  // 统计翻页：点翻页按钮（包括点击左右区域、自动翻页、快捷键）和网页自带的方向键
  let lastKeyTurn = 0, lastTurnDir = 0, landOnLast = false;
  window.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.renderTarget_pager_button');
    if (!b || restoring) return;
    if (Date.now() - lastKeyTurn < 400) return;            // 这次点击是方向键引起的，已经计过
    lastTurnDir = b.classList.contains('renderTarget_pager_button_right') ? 1 : -1;
    pIdx = Math.max(0, pIdx + lastTurnDir);
    rememberSoon();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (restoring || !isHor() || e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { lastTurnDir = 1; pIdx++; lastKeyTurn = Date.now(); rememberSoon(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { lastTurnDir = -1; pIdx = Math.max(0, pIdx - 1); lastKeyTurn = Date.now(); rememberSoon(); }
  }, true);
  window.addEventListener('scroll', () => { if (!isHor() && !restoring) rememberSoon(); }, { passive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitReady(maxMs) {
    for (let t = 0; t < maxMs; t += 100) { if (pageReady()) return true; await wait(100); }
    return false;
  }
  let abortRestore = false;
  for (const t of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(t, (e) => { if (restoring && e.isTrusted) abortRestore = true; }, true);   // 用户一操作就停止自动恢复
  }
  async function restorePos(k) {
    const saved = loadPos()[k];
    if (!saved) return;
    if (saved.mode === 'page' && (!(saved.i > 0) || saved.i > 60 || (saved.t && saved.i >= saved.t))) return;   // 第一页或记录异常：不恢复
    restoring = true; abortRestore = false;
    try {
      if (saved.mode === 'scroll') {
        for (let t = 0; t < 6000 && isHor() === false; t += 200) {
          const el = document.scrollingElement;
          if (el.scrollHeight > innerHeight * 2) { await wait(300); el.scrollTop = saved.f * el.scrollHeight; break; }
          await wait(200);
        }
        return;
      }
      if (!isHor() || !(await waitReady(8000))) return;
      await wait(700);                                        // 等网页排版完成
      const sameSize = saved.w === innerWidth && saved.hh === innerHeight && saved.h != null;
      if (sameSize && pageHash() === saved.h) { pIdx = saved.i; return; }   // 网页已经在原来的页
      const t = totalPages();
      const target = sameSize || !saved.t || !t ? saved.i : Math.min(t - 1, Math.round(saved.i / saved.t * t));
      const btn = () => document.querySelector('.renderTarget_pager_button_right');
      const limit = Math.min(60, target);
      for (let n = 0; n < limit; n++) {
        if (sameSize && pageHash() === saved.h) break;
        if (!sameSize && n >= target) break;
        const before = pageHash();
        const b = btn(); if (!b) break;
        b.click();
        for (let w = 0; w < 30; w++) { await wait(50); if (pageReady() && pageHash() !== before) break; }
        if (abortRestore || chapKey() !== k) break;            // 用户操作了，或翻到了别的章节：停止
      }
      pIdx = target;
    } finally { restoring = false; }
  }
  // 窗口大小变化后网页会重新分页：按总页数比例换算当前页码
  let rsT0 = 0, rsTimer = null;
  window.addEventListener('resize', (e) => {
    if (!e.isTrusted || !isHor()) return;
    if (!rsTimer) rsT0 = totalPages();
    clearTimeout(rsTimer);
    rsTimer = setTimeout(async () => {
      rsTimer = null;
      await waitReady(4000); await wait(600);
      const t1 = totalPages();
      if (rsT0 && t1 && t1 !== rsT0) pIdx = Math.min(t1 - 1, Math.round(pIdx * t1 / rsT0));
      rememberSoon();
    }, 500);
  });
  // ---------- 缩放比例变化后重新加载（修复划线/选字对不上行） ----------
  // 微信读书只在页面启动时读取一次屏幕缩放比例（devicePixelRatio）。之后比例一变（调字体大小、
  // 把窗口拖到缩放不同的显示器），画出来的字和它记录的文字位置就对不上，划线会落到别的行。
  // 这里在比例稳定 0.9 秒后，先记住当前读到的页，再重新加载页面，加载后自动翻回这一页。
  let dprSince = 0;
  setInterval(() => {
    const init = window.__wrmInitDpr;
    if (!init || restoring || !inReaderPath()) { dprSince = 0; return; }
    if (Math.abs(window.devicePixelRatio - init) < 0.01) { dprSince = 0; return; }
    if (!dprSince) { dprSince = Date.now(); return; }
    if (Date.now() - dprSince < 900) return;
    window.__wrmInitDpr = window.devicePixelRatio;          // 防止重复触发
    rememberNow();
    location.reload();
  }, 300);

  // 监测章节变化：从书架/首次打开进入某章时恢复位置；章节内前后翻到别的章节时从头计数
  let readingSession = false;
  setInterval(() => {
    if (!inReaderPath()) { readingSession = false; lastPath = null; return; }
    const k = chapKey();
    if (!k || k === lastPath || restoring) return;          // 还没排好 / 没变化
    lastPath = k; pIdx = 0;
    landOnLast = readingSession && lastTurnDir < 0;      // 往前翻进上一章：网页停在上一章最后一页
    if (!readingSession) { readingSession = true; restorePos(k); }   // 从书架进入或刚打开：恢复位置；书内换章：从头计数
  }, 300);

  window.__wrm = {
    setMargin(m) { M = m; css(); relayout(); },
    mode: () => (isHor() ? 'page' : 'scroll'),
    next: () => nextPage(),
    prev: () => prevPage(),
    scroll: (s) => startScroll(s),
    // “切换阅读方式”按钮的位置（网页要求真实点击，由主进程模拟鼠标点击）
    panelOpen: () => maskOpen(),
    progress: () => progText,
    tickerHide: (on) => { root.classList.toggle('wrm-ticker', !!on); return true; },
    // 播报条：当前页的文字（按行排好，段落之间用全角空格隔开）
    pageText: () => {
      const c = document.querySelector('.wr_horizontalReader .wr_canvasContainer canvas');
      if (!c || !window.__wrmCanvasText) return '';
      const glyphs = window.__wrmCanvasText(c);
      if (!glyphs.length) return '';
      const rows = new Map();
      for (const [t, x, y] of glyphs) {
        const ky = Math.round(y / 3) * 3;
        if (!rows.has(ky)) rows.set(ky, []);
        rows.get(ky).push([x, t]);
      }
      const ys = [...rows.keys()].sort((a, b) => a - b);
      const lines = ys.map((y) => rows.get(y).sort((a, b) => a[0] - b[0]));
      const minX = Math.min(...lines.map((l) => l[0][0]));
      const gaps = ys.slice(1).map((y, i) => y - ys[i]).sort((a, b) => a - b);
      const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 9999;   // 正常行距（中位数）
      const charW = (() => { const l = lines.find((x) => x.length > 3); return l ? (l[l.length - 1][0] - l[0][0]) / (l.length - 1) : 20; })();
      let out = '';
      lines.forEach((l, i) => {
        const str = l.map((g) => g[1]).join('');
        const indented = l[0][0] - minX > charW * 1.2;      // 段首缩进 → 新段落
        const gap = i > 0 && ys[i] - ys[i - 1] > lineGap * 1.3;   // 行距明显变大 → 新段落/标题
        out += (i > 0 && (indented || gap) ? '　　' : '') + str;
      });
      return out.replace(/\s+/g, ' ').trim();
    },
    // 当前页还没被记录到时：往后翻一页再翻回来，让网页重画当前页
    redraw: async () => {
      if (nextPage() !== 'ok') return false;
      await new Promise((r) => setTimeout(r, 700));
      prevPage();
      await new Promise((r) => setTimeout(r, 700));
      return true;
    },
    setUiZoom: (z) => { window.__wrmZoom = z || 1; fitButtons(); },
    toggleRect: () => {
      const b = document.querySelector('.readerControls_item.isHorizontalReader, .readerControls_item.isNormalReader');
      if (!b) return null;
      root.classList.add('wrm-open');           // 临时展开，便于点击；点击后会自动收起
      const r = b.getBoundingClientRect();
      if (!r.width) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, to: b.classList.contains('isHorizontalReader') ? 'scroll' : 'page' };
    },
  };
  const tst = document.createElement('style'); tst.id = '__wrm_ticker_css'; tst.textContent = TICKER_CSS;
  (document.head || document.documentElement).appendChild(tst);
  css();
  setTimeout(relayout, 300);
  setTimeout(fitControls, 500);
  fitButtons();
})();
