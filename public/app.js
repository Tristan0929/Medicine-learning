/* ==========================================================================
   医学复习助手 —— 前端主逻辑
   所有用户数据（服务商配置、Key、闪卡、术语）均存于本机 localStorage。
   ========================================================================== */

(() => {
  'use strict';

  // ------------------ 通用工具 ------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    del(key) { localStorage.removeItem(key); },
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function renderMarkdown(el, text) {
    el.classList.add('md');
    el.innerHTML = marked.parse(text || '');
  }

  // ------------------ 服务商预设 ------------------
  const PROVIDERS = {
    deepseek: { label: 'DeepSeek',        baseUrl: 'https://api.deepseek.com',                model: 'deepseek-v4-flash' },
    openai:   { label: 'OpenAI',          baseUrl: 'https://api.openai.com/v1',               model: 'gpt-4o-mini' },
    moonshot: { label: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1',              model: 'moonshot-v1-8k' },
    zhipu:    { label: '智谱 GLM',        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',    model: 'glm-4-flash' },
    custom:   { label: '自定义',          baseUrl: '',                                        model: '' },
  };

  function getConfig() {
    return store.get('cfg', { provider: 'deepseek', baseUrl: PROVIDERS.deepseek.baseUrl, apiKey: '', model: PROVIDERS.deepseek.model });
  }
  function setConfig(cfg) { store.set('cfg', cfg); refreshModelChip(); }

  function refreshModelChip() {
    const cfg = getConfig();
    const chip = $('#modelChip');
    if (cfg.apiKey && cfg.model) {
      chip.textContent = `${PROVIDERS[cfg.provider]?.label || cfg.provider} · ${cfg.model}`;
    } else {
      chip.textContent = '未配置';
    }
  }

  // ------------------ 与模型通信（流式） ------------------
  // messages: [{role, content}]；onToken(deltaText) 逐块回调；返回完整文本
  async function chat(messages, { onToken, temperature } = {}) {
    const cfg = getConfig();
    if (!cfg.apiKey) throw new Error('尚未配置 API Key，请到「设置」填写。');
    if (!cfg.model) throw new Error('尚未选择模型，请到「设置」读取并选择模型。');

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages, temperature }),
    });

    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = j.detail?.error?.message || JSON.stringify(j.detail || j.error || j); }
      catch { detail = await resp.text(); }
      throw new Error(`请求失败（${resp.status}）：${detail}`);
    }

    // 解析 SSE 流
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 最后一行可能不完整，留到下次
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onToken && onToken(delta, full); }
        } catch { /* 忽略非 JSON 行（心跳等） */ }
      }
    }
    return full;
  }

  // 简单封装：把结果流式渲染到某个元素
  async function chatToElement(el, messages, opts = {}) {
    el.classList.remove('md');
    el.innerHTML = '';
    el.classList.add('typing-cursor');
    let text = '';
    try {
      text = await chat(messages, {
        ...opts,
        onToken: (_, full) => { el.textContent = full; },
      });
    } finally {
      el.classList.remove('typing-cursor');
    }
    renderMarkdown(el, text);
    return text;
  }

  // 让模型返回 JSON，做健壮解析
  function extractJson(text) {
    if (!text) return null;
    let t = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
    const start = t.search(/[\[{]/);
    const endArr = t.lastIndexOf(']');
    const endObj = t.lastIndexOf('}');
    const end = Math.max(endArr, endObj);
    if (start === -1 || end === -1) return null;
    try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
  }

  /* ======================================================================
     标签切换
     ====================================================================== */
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach((b) => b.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ======================================================================
     设置页
     ====================================================================== */
  function initSettings() {
    const cfg = getConfig();
    $('#provider').value = cfg.provider;
    $('#baseUrl').value = cfg.baseUrl;
    $('#apiKey').value = cfg.apiKey;
    $('#model').value = cfg.model || '';

    $('#provider').addEventListener('change', (e) => {
      const p = PROVIDERS[e.target.value];
      $('#baseUrl').value = p.baseUrl;
      $('#baseUrl').readOnly = e.target.value !== 'custom';
      if (p.model) $('#model').value = p.model; // 自动带出默认模型，可自行修改
    });
    $('#baseUrl').readOnly = cfg.provider !== 'custom';

    $('#saveSettings').addEventListener('click', saveSettings);
    $('#testSettings').addEventListener('click', testConnection);
    $('#clearAll').addEventListener('click', () => {
      if (confirm('确定清空本机保存的所有数据？包括 Key、闪卡、术语表。此操作不可撤销。')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  function readSettingsForm() {
    return {
      provider: $('#provider').value,
      baseUrl: $('#baseUrl').value.trim(),
      apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim(),
    };
  }

  function saveSettings() {
    const form = readSettingsForm();
    if (!form.apiKey) return setSettingsStatus('请填写 API Key', false);
    if (!form.model) return setSettingsStatus('请填写模型名', false);
    setConfig(form);
    setSettingsStatus('已保存 ✓', true);
    toast('设置已保存');
  }

  async function testConnection() {
    const form = readSettingsForm();
    if (!form.apiKey || !form.model) return setSettingsStatus('请先填 Key 并选模型', false);
    setConfig(form);
    setSettingsStatus('测试中…', true);
    try {
      const r = await chat([{ role: 'user', content: '请只回复两个字：正常' }], { temperature: 0 });
      setSettingsStatus('连接正常 ✓ 模型回复：' + r.slice(0, 20), true);
    } catch (err) {
      setSettingsStatus('连接失败：' + err.message, false);
    }
  }

  function setSettingsStatus(msg, ok) {
    const el = $('#settingsStatus');
    el.textContent = msg;
    el.className = 'settings-status ' + (ok ? 'ok' : 'err');
  }

  function ensureConfigured() {
    const cfg = getConfig();
    if (!cfg.apiKey || !cfg.model) {
      toast('请先到「设置」配置服务商与模型');
      $$('.tab').forEach((b) => b.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      $('.tab[data-tab="settings"]').classList.add('active');
      $('#tab-settings').classList.add('active');
      return false;
    }
    return true;
  }

  /* ======================================================================
     教材梳理
     ====================================================================== */
  function initNotes() {
    $('#notesRun').addEventListener('click', async () => {
      if (!ensureConfigured()) return;
      const src = $('#notesInput').value.trim();
      if (!src) return toast('请先粘贴教材内容');
      const withEn = $('#notesEnglish').checked;

      let sys = '你是一位资深医学教师，擅长帮学生梳理重点、辅助记忆。请用简体中文、Markdown 格式输出，结构清晰。';
      let prompt =
        '请阅读下面的医学教材内容，帮我做复习笔记，包含：\n' +
        '1. 【重点提炼】分层级列出核心知识点；如整段都重要就如实说明并保留全部要点。\n' +
        '2. 【易混/易错点】提醒容易混淆或考点陷阱。\n' +
        '3. 【记忆方法】针对难记的点，给出口诀、联想、对比表格等具体记忆技巧。\n';
      if (withEn) {
        prompt +=
          '4. 【英文名词归纳与分析】在笔记最后单独一节，标题写作「## 英文名词」，' +
          '用 Markdown 表格列出，表头为 |英文|中文|说明/记忆点|，覆盖文中出现的重要英文/拉丁术语、缩写。\n';
      }
      prompt += '\n教材内容如下：\n"""\n' + src + '\n"""';

      const btn = $('#notesRun'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        await chatToElement($('#notesOutput'), [
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ]);
        $('#notesExport').disabled = false;
        $('#notesActions').style.display = 'flex';
        $('#notesToGlossary').style.display = withEn ? 'inline-block' : 'none';
      } catch (err) {
        $('#notesOutput').innerHTML = `<p style="color:#d05a55">出错：${err.message}</p>`;
      } finally {
        btn.disabled = false; btn.textContent = '生成笔记';
      }
    });

    $('#notesExport').addEventListener('click', () =>
      exportPDF($('#notesOutput'), '教材复习笔记'));

    $('#notesToCards').addEventListener('click', () =>
      generateCardsFrom($('#notesInput').value.trim()));

    $('#notesToGlossary').addEventListener('click', () =>
      importGlossaryFromNotes($('#notesOutput').innerText));
  }

  /* ======================================================================
     真题模拟
     ====================================================================== */
  function initExam() {
    $('#examRun').addEventListener('click', async () => {
      if (!ensureConfigured()) return;
      const src = $('#examInput').value.trim();
      if (!src) return toast('请先粘贴历年真题');
      const count = $('#examCount').value;
      const level = $('#examLevel').value;
      const type = $('#examType').value;

      const prompt =
        `你是一位命题专家。下面是历年真题，请：\n` +
        `1. 【出题规律分析】总结高频考点、题型分布、常见陷阱与命题趋势。\n` +
        `2. 【预测模拟题】据此出 ${count} 道${type === '综合' ? '题型综合搭配' : '「' + type + '」'}的预测模拟题，难度「${level}」。\n` +
        `   每题给出题干；选择题给出选项。所有题目的【参考答案】与【解析】统一放到最后，避免边看题边看到答案。\n` +
        `请用简体中文、Markdown 输出。\n\n历年真题：\n"""\n${src}\n"""`;

      const btn = $('#examRun'); btn.disabled = true; btn.textContent = '生成中…';
      try {
        await chatToElement($('#examOutput'), [
          { role: 'system', content: '你是经验丰富的医学考试命题与辅导专家。' },
          { role: 'user', content: prompt },
        ]);
        $('#examExport').disabled = false;
      } catch (err) {
        $('#examOutput').innerHTML = `<p style="color:#d05a55">出错：${err.message}</p>`;
      } finally {
        btn.disabled = false; btn.textContent = '分析并生成模拟题';
      }
    });

    $('#examExport').addEventListener('click', () =>
      exportPDF($('#examOutput'), '真题分析与模拟题'));
  }

  /* ======================================================================
     AI 问答
     ====================================================================== */
  function initQA() {
    // 排版整理
    $('#qaFormat').addEventListener('click', async () => {
      if (!ensureConfigured()) return;
      const src = $('#qaInput').value.trim();
      if (!src) return toast('请先粘贴内容');
      const btn = $('#qaFormat'); btn.disabled = true; btn.textContent = '整理中…';
      try {
        await chatToElement($('#qaContent'), [
          { role: 'system', content: '你是排版助手，只对内容做结构化整理，不增删知识、不做点评。' },
          { role: 'user', content: '请把下面的内容重新排版成清晰易读的 Markdown（合理分段、加小标题、要点用列表、保留原意），直接输出整理后的正文：\n\n"""\n' + src + '\n"""' },
        ]);
        $('#qaExport').disabled = false;
      } catch (err) {
        $('#qaContent').innerHTML = `<p style="color:#d05a55">出错：${err.message}</p>`;
      } finally {
        btn.disabled = false; btn.textContent = '排版整理';
      }
    });

    // 自由提问
    $('#qaAsk').addEventListener('click', () => askQuestion($('#qaAskInput').value.trim(), ''));
    $('#qaAskInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') askQuestion($('#qaAskInput').value.trim(), '');
    });

    $('#qaExport').addEventListener('click', () => {
      // 导出整理内容 + 问答记录
      const wrap = document.createElement('div');
      wrap.className = 'md';
      wrap.innerHTML = '<h1>整理内容</h1>' + $('#qaContent').innerHTML +
        '<h1>问答记录</h1>' + $('#qaLog').innerHTML;
      exportPDF(wrap, 'AI问答记录');
    });

    initSelectionAsk();
  }

  async function askQuestion(question, context) {
    if (!question) return toast('请输入问题');
    if (!ensureConfigured()) return;
    $('#qaAskInput').value = '';

    const item = document.createElement('div');
    item.className = 'qa-item';
    const q = document.createElement('div');
    q.className = 'qa-q';
    q.innerHTML = escapeHtml(question) + (context ? `<span class="ctx">针对选中：“${escapeHtml(context.slice(0, 80))}${context.length > 80 ? '…' : ''}”</span>` : '');
    const a = document.createElement('div');
    a.className = 'qa-a';
    item.appendChild(q); item.appendChild(a);
    $('#qaLog').prepend(item);
    $('#qaExport').disabled = false;

    const messages = [
      { role: 'system', content: '你是严谨的医学学习助手，回答准确、条理清晰，用简体中文和 Markdown。' },
    ];
    if (context) messages.push({ role: 'user', content: '以下是我正在看的一段内容，供你参考：\n"""\n' + context + '\n"""' });
    messages.push({ role: 'user', content: question });

    try {
      await chatToElement(a, messages);
    } catch (err) {
      a.innerHTML = `<span style="color:#d05a55">出错：${err.message}</span>`;
    }
  }

  // 选中文字 → 浮动提问按钮
  function initSelectionAsk() {
    const askBtn = $('#selectionAskBtn');
    let selectedText = '';

    document.addEventListener('mouseup', (e) => {
      if (e.target === askBtn) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      const container = $('#qaContent');
      if (text && sel.rangeCount && container.contains(sel.anchorNode)) {
        selectedText = text;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        askBtn.style.display = 'block';
        askBtn.style.top = (window.scrollY + rect.top - 40) + 'px';
        askBtn.style.left = (window.scrollX + rect.left) + 'px';
      } else if (e.target !== askBtn) {
        askBtn.style.display = 'none';
      }
    });

    askBtn.addEventListener('click', () => {
      askBtn.style.display = 'none';
      const ctx = selectedText;
      openModal('针对选中内容提问', `<p style="font-size:13px;color:#6b7a8d;margin:0 0 8px">选中：“${escapeHtml(ctx.slice(0, 120))}${ctx.length > 120 ? '…' : ''}”</p>
        <textarea id="modalAsk" rows="3" placeholder="想问什么？留空则默认为「请解释这段内容」"></textarea>`,
        () => {
          const question = ($('#modalAsk').value.trim()) || '请详细解释这段内容。';
          askQuestion(question, ctx);
        });
      setTimeout(() => $('#modalAsk')?.focus(), 50);
    });
  }

  /* ======================================================================
     闪卡（间隔重复，简化版 SM-2）
     ====================================================================== */
  function getCards() { return store.get('cards', []); }
  function saveCards(c) { store.set('cards', c); }

  function initCards() {
    renderCardList();
    $('#cardsStart').addEventListener('click', startReview);
    $('#cardsAdd').addEventListener('click', () => {
      openModal('添加闪卡', `<textarea id="mFront" rows="2" placeholder="正面（问题 / 英文）"></textarea>
        <textarea id="mBack" rows="2" placeholder="背面（答案 / 中文）"></textarea>`,
        () => {
          const front = $('#mFront').value.trim(), back = $('#mBack').value.trim();
          if (!front || !back) return toast('正反面都要填');
          addCards([{ front, back }]);
        });
    });
    $('#cardsExport').addEventListener('click', exportCardsPDF);
    $('#cardFlip').addEventListener('click', flipCard);
    $('#flashcard').addEventListener('click', flipCard);
    $$('#gradeControls .btn').forEach((b) =>
      b.addEventListener('click', () => gradeCard(parseInt(b.dataset.grade, 10))));
  }

  function addCards(arr) {
    const cards = getCards();
    const now = Date.now();
    arr.forEach((c) => cards.push({
      id: 'c' + now + Math.random().toString(36).slice(2, 7),
      front: c.front, back: c.back,
      ef: 2.5, interval: 0, reps: 0, due: now,
    }));
    saveCards(cards);
    renderCardList();
    toast(`已添加 ${arr.length} 张闪卡`);
  }

  function renderCardList() {
    const cards = getCards();
    $('#cardsTotal').textContent = cards.length;
    const due = cards.filter((c) => c.due <= Date.now()).length;
    $('#cardsDue').textContent = '待复习 ' + due;
    $('#cardsExport').disabled = cards.length === 0;

    const wrap = $('#cardList');
    if (!cards.length) {
      wrap.innerHTML = '<p class="placeholder">还没有闪卡。可在「教材梳理」里一键生成，或手动添加。</p>';
      return;
    }
    wrap.innerHTML = '';
    cards.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'card-row';
      row.innerHTML = `<span class="front">${escapeHtml(c.front)}</span>
        <span class="back">${escapeHtml(c.back)}</span>
        <button class="del" data-id="${c.id}">删除</button>`;
      wrap.appendChild(row);
    });
    $$('#cardList .del').forEach((b) => b.addEventListener('click', () => {
      saveCards(getCards().filter((c) => c.id !== b.dataset.id));
      renderCardList();
    }));
  }

  let reviewQueue = [], currentCard = null;
  function startReview() {
    const cards = getCards();
    reviewQueue = cards.filter((c) => c.due <= Date.now());
    if (!reviewQueue.length) {
      // 没有到期的，就复习全部
      reviewQueue = cards.slice();
    }
    if (!reviewQueue.length) return toast('还没有闪卡');
    $('#reviewArea').style.display = 'block';
    nextCard();
  }

  function nextCard() {
    if (!reviewQueue.length) {
      $('#reviewArea').style.display = 'none';
      renderCardList();
      return toast('本轮复习完成 🎉');
    }
    currentCard = reviewQueue.shift();
    $('#cardFront').textContent = currentCard.front;
    $('#cardBack').textContent = currentCard.back;
    $('#flashcard').classList.remove('flipped');
    $('#reviewControls').style.display = 'flex';
    $('#gradeControls').style.display = 'none';
  }

  function flipCard() {
    $('#flashcard').classList.toggle('flipped');
    if ($('#flashcard').classList.contains('flipped')) {
      $('#reviewControls').style.display = 'none';
      $('#gradeControls').style.display = 'flex';
    }
  }

  // SM-2 简化：q>=3 正确
  function gradeCard(q) {
    const cards = getCards();
    const card = cards.find((c) => c.id === currentCard.id);
    if (card) {
      if (q < 3) { card.reps = 0; card.interval = 0; }
      else {
        card.reps += 1;
        if (card.reps === 1) card.interval = 1;
        else if (card.reps === 2) card.interval = 3;
        else card.interval = Math.round(card.interval * card.ef);
        card.ef = Math.max(1.3, card.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      }
      // interval 用「分钟」更适合当场复习；忘记则约 1 分钟后再来，认识则按天
      const ms = q < 3 ? 60 * 1000 : card.interval * 24 * 60 * 60 * 1000;
      card.due = Date.now() + ms;
      saveCards(cards);
      if (q < 3) reviewQueue.push(card); // 忘记的本轮末尾再来
    }
    nextCard();
  }

  async function generateCardsFrom(src) {
    if (!src) return toast('没有可用内容');
    if (!ensureConfigured()) return;
    toast('正在生成闪卡…');
    try {
      const txt = await chat([
        { role: 'system', content: '你输出严格的 JSON，不要多余文字。' },
        { role: 'user', content: '从下面医学内容里提炼 8-15 个关键知识点，做成问答式闪卡。只输出 JSON 数组，每项形如 {"front":"问题","back":"答案"}。\n\n"""\n' + src + '\n"""' },
      ], { temperature: 0.3 });
      const arr = extractJson(txt);
      if (Array.isArray(arr) && arr.length) {
        addCards(arr.filter((x) => x.front && x.back));
      } else {
        toast('未能解析闪卡，请重试');
      }
    } catch (err) { toast('生成失败：' + err.message); }
  }

  function exportCardsPDF() {
    const cards = getCards();
    const wrap = document.createElement('div');
    wrap.className = 'md';
    let html = '<h1>闪卡列表</h1><table><thead><tr><th>正面</th><th>背面</th></tr></thead><tbody>';
    cards.forEach((c) => { html += `<tr><td>${escapeHtml(c.front)}</td><td>${escapeHtml(c.back)}</td></tr>`; });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    exportPDF(wrap, '闪卡列表');
  }

  /* ======================================================================
     术语表
     ====================================================================== */
  function getGlossary() { return store.get('glossary', []); }
  function saveGlossary(g) { store.set('glossary', g); }

  function initGlossary() {
    renderGlossary();
    $('#glossarySearch').addEventListener('input', () => renderGlossary($('#glossarySearch').value.trim()));
    $('#glossaryAdd').addEventListener('click', () => {
      openModal('添加术语', `<input id="mEn" placeholder="英文" />
        <input id="mZh" placeholder="中文" />
        <input id="mNote" placeholder="说明 / 记忆点（可选）" />`,
        () => {
          const en = $('#mEn').value.trim(), zh = $('#mZh').value.trim();
          if (!en || !zh) return toast('英文和中文必填');
          addGlossary([{ en, zh, note: $('#mNote').value.trim() }]);
        });
    });
    $('#glossaryExport').addEventListener('click', () => {
      const wrap = document.createElement('div');
      wrap.className = 'md';
      wrap.innerHTML = '<h1>术语表</h1>' + $('#glossaryTableWrap').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, '');
      exportPDF(wrap, '术语表');
    });
  }

  function addGlossary(arr) {
    const g = getGlossary();
    const existing = new Set(g.map((x) => x.en.toLowerCase()));
    let added = 0;
    arr.forEach((x) => {
      if (x.en && !existing.has(x.en.toLowerCase())) {
        g.push({ en: x.en, zh: x.zh || '', note: x.note || '' });
        existing.add(x.en.toLowerCase()); added++;
      }
    });
    saveGlossary(g);
    renderGlossary();
    toast(`术语表新增 ${added} 条`);
  }

  function renderGlossary(filter = '') {
    const g = getGlossary();
    $('#glossaryExport').disabled = g.length === 0;
    const wrap = $('#glossaryTableWrap');
    const f = filter.toLowerCase();
    const rows = g.filter((x) =>
      !f || x.en.toLowerCase().includes(f) || x.zh.toLowerCase().includes(f));
    if (!g.length) {
      wrap.innerHTML = '<p class="placeholder">还没有术语。可在「教材梳理」勾选英文分析后一键导入。</p>';
      return;
    }
    let html = '<table class="glossary-table"><thead><tr><th>英文</th><th>中文</th><th>说明 / 记忆点</th><th></th></tr></thead><tbody>';
    rows.forEach((x) => {
      html += `<tr><td>${escapeHtml(x.en)}</td><td>${escapeHtml(x.zh)}</td><td>${escapeHtml(x.note)}</td>
        <td><button class="del" data-en="${escapeAttr(x.en)}">删</button></td></tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    $$('#glossaryTableWrap .del').forEach((b) => b.addEventListener('click', () => {
      saveGlossary(getGlossary().filter((x) => x.en !== b.dataset.en));
      renderGlossary($('#glossarySearch').value.trim());
    }));
  }

  // 从笔记正文里解析「英文名词」表格
  function importGlossaryFromNotes(text) {
    // 优先解析表格行： |英文|中文|说明|
    const lines = (text || '').split('\n');
    const items = [];
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map((s) => s.trim()).filter((s, i, a) => !(i === 0 && s === '') && !(i === a.length - 1 && s === ''));
      if (cells.length < 2) continue;
      const en = cells[0];
      // 跳过表头与分隔行
      if (/^[-:\s]+$/.test(en)) continue;
      if (/^英文$/i.test(en) || /english/i.test(en)) continue;
      // 英文列应含拉丁字母
      if (!/[a-zA-Z]/.test(en)) continue;
      items.push({ en, zh: cells[1] || '', note: cells[2] || '' });
    }
    if (!items.length) return toast('没找到英文名词表格，请确认已勾选英文分析并生成');
    addGlossary(items);
    // 切到术语表
    $('.tab[data-tab="glossary"]').click();
  }

  /* ======================================================================
     PDF 导出（html2pdf）
     ====================================================================== */
  function exportPDF(sourceEl, filename) {
    const clone = sourceEl.cloneNode(true);
    // 去掉导出中不需要的按钮
    clone.querySelectorAll('button').forEach((b) => b.remove());
    const container = document.createElement('div');
    container.style.padding = '24px';
    container.style.fontFamily = 'PingFang SC, Microsoft YaHei, sans-serif';
    container.style.color = '#1f2a37';
    const title = document.createElement('h1');
    title.textContent = filename;
    title.style.color = '#135a91';
    container.appendChild(title);
    const date = document.createElement('p');
    date.textContent = '导出时间：' + new Date().toLocaleString('zh-CN');
    date.style.color = '#6b7a8d'; date.style.fontSize = '12px';
    container.appendChild(date);
    container.appendChild(clone);

    // 让表格边框在 PDF 里显示
    const style = document.createElement('style');
    style.textContent = 'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px}th{background:#e8f2fb}h1,h2,h3{color:#135a91}';
    container.appendChild(style);

    html2pdf().set({
      margin: 12,
      filename: filename + '.pdf',
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container).save();
    toast('正在生成 PDF…');
  }

  /* ======================================================================
     弹窗 / 转义
     ====================================================================== */
  let modalOnOk = null;
  function openModal(title, bodyHtml, onOk) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    modalOnOk = onOk;
    $('#modalMask').style.display = 'flex';
  }
  function closeModal() { $('#modalMask').style.display = 'none'; modalOnOk = null; }
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => { const f = modalOnOk; closeModal(); f && f(); });
  $('#modalMask').addEventListener('click', (e) => { if (e.target === $('#modalMask')) closeModal(); });

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  /* ======================================================================
     启动
     ====================================================================== */
  marked.setOptions({ breaks: true, gfm: true });
  initSettings();
  initNotes();
  initExam();
  initQA();
  initCards();
  initGlossary();
  refreshModelChip();
})();
