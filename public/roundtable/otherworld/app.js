const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const api = async (url, opts) => { const r = await fetch(url, opts); return r.json(); };
const PLAYERS = ['A', 'B', 'C'];
const PLAYER_LABELS = { A: '你', B: 'Codex', C: 'Claude' };
const initialParams = new URLSearchParams(location.search);

// ---- Markdown渲染 ----
function md(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined' && marked.parse) {
    return marked.parse(String(text), { breaks: true });
  }
  // 降级：基本换行处理
  return escapeHtml(String(text)).replace(/\n/g, '<br>');
}

// ---- 状态 ----
let currentTab = 'overview';
let currentSessionId = initialParams.get('session') || null;
let isHiddenMode = false;
let publicDraft = '';
let hiddenDraft = '';
let selectedTheme = null;
let currentPromptFile = null;
let chatMessages = []; // 本地聊天记录 [{type, name, text}]
let currentPlayer = normalizePlayer(initialParams.get('player')) || 'A';

function normalizePlayer(value) {
  const player = String(value || '').trim().toUpperCase();
  return PLAYERS.includes(player) ? player : null;
}

function setCurrentPlayer(player, { reload = true } = {}) {
  const next = normalizePlayer(player);
  if (!next) return;
  currentPlayer = next;
  $$('.seat-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.player === currentPlayer));
  const params = new URLSearchParams(location.search);
  params.set('player', currentPlayer);
  if (currentSessionId) params.set('session', currentSessionId);
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  publicDraft = '';
  hiddenDraft = '';
  const input = $('#chat-input');
  if (input) input.value = '';
  if (reload) loadPlayView();
}

function setCurrentSession(sessionId) {
  currentSessionId = sessionId || null;
  const params = new URLSearchParams(location.search);
  params.set('player', currentPlayer);
  if (currentSessionId) params.set('session', currentSessionId);
  else params.delete('session');
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
}

function showPlayTab() {
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$('.tab-btn[data-tab="play"]').forEach(b => b.classList.add('active'));
  currentTab = 'play';
  $$('.tab-page').forEach(p => p.classList.remove('active'));
  $('#page-play').classList.add('active');
}

function fetchCurrentView() {
  if (!currentSessionId) return null;
  return api(`/api/rp/session/${currentSessionId}/view/${currentPlayer}`);
}

function chatTypeForPlayer(player) {
  return player === currentPlayer ? 'player-a' : (player === 'C' ? 'player-c' : 'player-b');
}

// ---- 时钟 ----
function updateClock() {
  const d = new Date();
  const s = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if ($('#clock')) $('#clock').textContent = s;
  if ($('#clock2')) $('#clock2').textContent = s;
}
setInterval(updateClock, 30000);
updateClock();

// ---- Tab 切换 ----
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    $$('.tab-page').forEach(p => p.classList.remove('active'));
    const page = $(`#page-${currentTab}`);
    if (page) page.classList.add('active');
    onTabSwitch();
  });
});

$$('.seat-btn').forEach(btn => {
  btn.addEventListener('click', () => setCurrentPlayer(btn.dataset.player));
});
setCurrentPlayer(currentPlayer, { reload: false });
if (currentSessionId) {
  showPlayTab();
  loadPlayView();
}

function onTabSwitch() {
  if (currentTab === 'overview') loadOverview();
  if (currentTab === 'play') loadPlayView();
  if (currentTab === 'prompts') loadPromptsList();
  if (currentTab === 'logs') loadLogs();
  if (currentTab === 'history') loadHistory();
}

// ---- Overview ----
async function loadOverview() {
  try {
    // 尝试从 API 加载主题
    const themes = await api('/api/rp/themes');
    renderThemes(themes);
  } catch (err) {
    console.warn("API 加载失败，使用默认主题列表", err);
    // 降级方案：如果后端没启动，使用默认主题列表，保证前端能正常显示
    const defaultThemes = ['搞怪', '刺激', '恐怖', '梦幻', '休闲', '风格化'];
    renderThemes(defaultThemes);
  }

  try {
    // 加载进行中的游戏
    const sessions = await api('/api/rp/sessions');
    renderSessions(sessions);
  } catch (err) {
    console.warn("API 加载失败，显示空游戏列表", err);
    renderSessions([]);
  }
}

function renderThemes(themes) {
  const grid = $('#theme-grid');
  grid.innerHTML = '';
  const allThemes = [...themes];
  if (!allThemes.includes('自定义')) allThemes.push('自定义');
  const themeDescMap = {
    '搞怪': '荒诞自洽的反差喜剧',
    '刺激': '时间压迫与感官放大',
    '恐怖': '认知的不可靠',
    '梦幻': '现实规则的温柔失效',
    '休闲': '重复中的随机温暖',
    '风格化': '原作灵魂的移植',
    '自定义': '自由描述你的偏好'
  };
  let idx = 0;
  for (const t of allThemes) {
    idx++;
    const card = document.createElement('div');
    card.className = 'theme-card' + (selectedTheme === t ? ' selected' : '');
    const num = String(idx).padStart(2, '0');
    const desc = themeDescMap[t] || '';
    card.innerHTML = `<span class="theme-num">${num}</span><span class="theme-name">${t}</span><span class="theme-desc">${desc}</span>`;
    card.addEventListener('click', () => {
      selectedTheme = t;
      $$('.theme-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      $('#btn-start').disabled = false;
    });
    grid.appendChild(card);
  }
}

function renderSessions(sessions) {
  const list = $('#session-list');
  list.innerHTML = '';
  if (sessions.length === 0) {
    list.innerHTML = '<div class="empty-hint">还没有游戏</div>';
  } else {
    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.innerHTML = `
        <span>${s.主题} · ${s.状态}</span>
        <span style="font-size:10px;color:var(--chrome-dark)">轮次${s.轮次}</span>
      `;
      item.addEventListener('click', () => {
        setCurrentSession(s.id);
        showPlayTab();
        loadPlayView();
      });
      list.appendChild(item);
    }
  }
}

// 开始新游戏
$('#btn-start').addEventListener('click', async () => {
  if (!selectedTheme) return;
  $('#btn-start').disabled = true;
  $('#btn-start').textContent = '正在生成世界...';
  try {
    const result = await api('/api/rp/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 主题: selectedTheme })
    });
    setCurrentSession(result.id);
    // 轮询等待生成完成
    pollSession(result.id);
  } catch (err) {
    alert('生成失败：' + err.message);
    $('#btn-start').disabled = false;
    $('#btn-start').textContent = '开始生成世界';
  }
});

async function pollSession(id) {
  const check = async () => {
    const session = await api(`/api/rp/session/${id}`);
    if (session.状态 === '进行中') {
      $('#btn-start').textContent = '开始生成世界';
      $('#btn-start').disabled = false;
      showPlayTab();
      loadPlayView();
      return;
    }
    if (session.状态 === '生成失败') {
      alert('世界生成失败：' + (session.错误 || '未知错误'));
      $('#btn-start').textContent = '开始生成世界';
      $('#btn-start').disabled = false;
      return;
    }
    setTimeout(check, 3000);
  };
  check();
}

// ---- Play View ----
async function loadPlayView() {
  if (!currentSessionId) return;
  try {
    const view = await fetchCurrentView();
    updatePlayUI(view);
  } catch (err) {
    console.error('加载游戏失败', err);
  }
}

function updatePlayUI(view) {
  if (!view) return;
  $$('.seat-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.player === currentPlayer));
  // 轮次和时间
  $('#turn-display').textContent = `轮次 ${view.轮次}`;
  $('#time-display').textContent = view.游戏时间 || '—';
  $('#env-time').textContent = view.游戏时间 || '—';
  $('#env-turns').textContent = view.轮次;
  $('#env-next-event').textContent = view.状态 === '度假中' ? '度假中' : `${view.事件?.距下次骰子 || '—'}轮`;

  // 我的状态
  if (view.我的公屏状态) {
    $('#stat-look').textContent = view.我的公屏状态.外貌 || '—';
    $('#stat-outfit').textContent = view.我的公屏状态.着装 || '—';
    $('#stat-held').textContent = view.我的公屏状态.手持物 || '—';
    $('#stat-body').textContent = view.我的公屏状态.身体状态 || '—';
  }

  // 我的角色名
  if (view.我的设定?.我的设定?.['名字']) {
    $('#my-name').textContent = view.我的设定.我的设定['名字'];
    $('#my-role').textContent = `${PLAYER_LABELS[currentPlayer] || view.当前玩家名 || currentPlayer} · 角色已分配`;
  }
  updateOtherRoster(view.其他玩家);

  // 对话历史——从服务器完整加载（包含玩家消息和世界消息）
  chatMessages = [];
  const history = view.对话历史 || [];
  const viewHistory = view.我的视角历史 || [];
  let viewIdx = 0;
  for (const h of history) {
    if (h.玩家 === '世界') {
      // 开场世界消息
      if (h.公开输入) chatMessages.push({ type: 'world', name: '', text: h.公开输入 });
    } else {
      // 玩家消息
      if (h.公开输入) {
        chatMessages.push({ type: chatTypeForPlayer(h.玩家), name: h.玩家名, text: h.公开输入 });
      }
      // 该轮的世界回复（从视角历史里取，跳过开场那条）
      viewIdx++;
      if (viewIdx < viewHistory.length && viewHistory[viewIdx]?.公屏内容) {
        chatMessages.push({ type: 'world', name: '', text: viewHistory[viewIdx].公屏内容 });
        if (viewHistory[viewIdx]?.隐藏内容) {
          appendTerminalLine(viewHistory[viewIdx].隐藏内容);
        }
      }
    }
  }
  renderChat();

  // 背包
  updateInventory(view.我的背包);
  updateOtherInventory(view.其他玩家);

  // 任务
  updateQuests(view.我的设定);

  // dock状态
  $('#dock-status').innerHTML = `${view.状态}<br><span>轮次 ${view.轮次}</span>`;

  // 启用输入
  $('#btn-send').disabled = false;
  $('#chat-input').disabled = false;
}

function updateOtherRoster(others) {
  const body = $('#other-roster');
  if (!body) return;
  if (!others || others.length === 0) {
    body.innerHTML = '<div class="empty-hint">等待旁席信息</div>';
    return;
  }
  body.innerHTML = '';
  for (const other of others) {
    const status = other.公屏状态 || {};
    const div = document.createElement('div');
    const slotClass = String(other.玩家 || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    div.className = `other-seat other-seat-${slotClass}`;
    div.innerHTML = `
      <div class="other-seat-head">
        <span class="seat-code">${escapeHtml(other.玩家 || '?')}</span>
        <div class="seat-names">
          <strong>${escapeHtml(other.玩家名 || other.玩家 || '旁席')}</strong>
          <span>${escapeHtml(other.角色名 || '角色未明')}</span>
        </div>
      </div>
      <div class="other-seat-status">
        <span>外貌：${escapeHtml(status.外貌 || '—')}</span>
        <span>服装：${escapeHtml(status.着装 || '—')}</span>
        <span>手持：${escapeHtml(status.手持物 || '—')}</span>
        <span>状态：${escapeHtml(status.身体状态 || '—')}</span>
      </div>
    `;
    body.appendChild(div);
  }
}

function updateInventory(inv) {
  const body = $('#inv-body');
  if (!inv || (inv.公屏背包?.length === 0 && inv.隐藏背包?.length === 0)) {
    body.innerHTML = '<div class="empty-hint">背包是空的</div>';
    return;
  }
  body.innerHTML = '';
  for (const item of (inv.公屏背包 || [])) {
    const div = document.createElement('div');
    div.style.cssText = 'padding:4px 0;font-size:13px;border-bottom:1px dashed var(--mid);line-height:1.6';
    div.innerHTML = `<div style="font-weight:500">${escapeHtml(item.名称)}</div><div style="font-size:11px;color:var(--muted)">${escapeHtml(item.来源 || '')}</div>`;
    body.appendChild(div);
  }
  for (const item of (inv.隐藏背包 || [])) {
    const div = document.createElement('div');
    div.style.cssText = 'padding:4px 0;font-size:13px;border-bottom:1px dashed var(--tab-active);line-height:1.6;color:var(--tab-active)';
    div.innerHTML = `<div style="font-weight:500">🔒 ${escapeHtml(item.名称)}</div><div style="font-size:11px">${escapeHtml(item.伪装 || '隐藏')}</div>`;
    body.appendChild(div);
  }
}

function updateOtherInventory(others) {
  const body = $('#other-inv');
  if (!others || others.length === 0) {
    body.innerHTML = '<div class="empty-hint">不知道旁席有什么</div>';
    return;
  }
  body.innerHTML = '';
  for (const other of others) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:5px 0;font-size:13px;border-bottom:1px dashed var(--mid);line-height:1.6';
    const items = other.公屏背包 || [];
    wrap.innerHTML = `<div style="font-weight:600">${escapeHtml(other.玩家名 || other.玩家)}</div>${
      items.length
        ? items.map(item => `<div>${escapeHtml(item.名称)} <span style="font-size:11px;color:var(--muted)">${escapeHtml(item.来源 || '')}</span></div>`).join('')
        : '<div class="empty-hint">公屏背包为空</div>'
    }`;
    body.appendChild(wrap);
  }
}

function updateQuests(setting) {
  const body = $('#quest-body');
  if (!setting) {
    body.innerHTML = '<div class="empty-hint">还没有任务</div>';
    return;
  }
  body.innerHTML = '';
  if (setting.我的任务) {
    // 只提取主线任务名称，不显示任务目标和主线走向
    let taskText = setting.我的任务;
    const taskMatch = taskText.match(/【主线任务[：:]】([\s\S]*?)(?=【|$)/);
    const displayText = taskMatch ? taskMatch[1].trim().substring(0, 120) : taskText.substring(0, 120);
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px;font-size:13px;margin-bottom:6px;border:1px solid var(--mid);background:var(--memo-w);line-height:1.6;';
    div.innerHTML = `<div style="font-family:JetBrains Mono,monospace;font-size:10px;color:var(--star);margin-bottom:4px">主线任务</div>${escapeHtml(displayText)}`;
    body.appendChild(div);
  }
  if (setting.我的隐藏任务 && setting.我的隐藏任务 !== '无') {
    const div = document.createElement('div');
    div.style.cssText = 'padding:4px;font-size:12px;border:1px solid var(--tab-active);background:rgba(132,152,194,.15);';
    div.innerHTML = `<div style="font-family:JetBrains Mono,monospace;font-size:10px;color:var(--tab-active);margin-bottom:3px">🔒 隐藏任务</div>${escapeHtml(setting.我的隐藏任务).substring(0, 200)}`;
    body.appendChild(div);
  }
}

// ---- 消息发送 ----
$('#btn-mode').addEventListener('click', () => {
  // 保存当前草稿
  if (isHiddenMode) {
    hiddenDraft = $('#chat-input').value;
  } else {
    publicDraft = $('#chat-input').value;
  }
  // 切换
  isHiddenMode = !isHiddenMode;
  // 恢复另一个草稿
  $('#chat-input').value = isHiddenMode ? hiddenDraft : publicDraft;
  // 更新UI
  if (isHiddenMode) {
    $('#chat-input').classList.add('hidden-mode');
    $('#chat-input').placeholder = '隐藏消息... (仅你和世界可见)';
    $('#btn-mode').querySelector('.mode-icon').textContent = '🔒';
    $('#btn-mode').querySelector('.mode-label').textContent = '隐藏';
    $('#mode-indicator').textContent = '🔒';
  } else {
    $('#chat-input').classList.remove('hidden-mode');
    $('#chat-input').placeholder = '输入消息... (Shift+Enter换行)';
    $('#btn-mode').querySelector('.mode-icon').textContent = '🌍';
    $('#btn-mode').querySelector('.mode-label').textContent = '公开';
    $('#mode-indicator').textContent = '🌍';
  }
});

$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // 不发送，只有点Send才发送
  }
});

$('#btn-send').addEventListener('click', async () => {
  if (!currentSessionId) return;

  // 收集两个模式的消息
  if (isHiddenMode) {
    hiddenDraft = $('#chat-input').value;
  } else {
    publicDraft = $('#chat-input').value;
  }

  if (!publicDraft.trim() && !hiddenDraft.trim()) return;

  $('#btn-send').disabled = true;
  $('#btn-send').textContent = '...';

  // 在聊天区显示自己发的消息
  if (publicDraft.trim()) {
    appendChatMsg('player-a', PLAYER_LABELS[currentPlayer] || currentPlayer, publicDraft.trim());
  }

  try {
    const result = await api(`/api/rp/session/${currentSessionId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player: currentPlayer,
        publicInput: publicDraft.trim(),
        hiddenInput: hiddenDraft.trim()
      })
    });

    // 显示世界回复
    if (result.view?.公屏内容) {
      appendChatMsg('world', '', result.view.公屏内容);
    }
    if (result.view?.隐藏内容) {
      appendTerminalLine(result.view.隐藏内容);
    }

    // 更新状态
    $('#turn-display').textContent = `轮次 ${result.轮次}`;
    $('#time-display').textContent = result.游戏时间 || '—';

    // 清空草稿和输入框
    publicDraft = '';
    hiddenDraft = '';
    $('#chat-input').value = '';
    // 切回公开模式
    if (isHiddenMode) {
      isHiddenMode = false;
      $('#chat-input').classList.remove('hidden-mode');
      $('#chat-input').placeholder = '输入消息... (Shift+Enter换行)';
      $('#btn-mode').querySelector('.mode-icon').textContent = '🌍';
      $('#btn-mode').querySelector('.mode-label').textContent = '公开';
      $('#mode-indicator').textContent = '🌍';
    }

  } catch (err) {
    console.error('发送失败', err);
    appendTerminalLine(`[错误] ${err.message}`);
  }

  $('#btn-send').disabled = false;
  $('#btn-send').textContent = 'Send';
});

function renderChat() {
  const chatArea = $('#chat-area');
  chatArea.innerHTML = '';
  if (chatMessages.length === 0) {
    chatArea.innerHTML = '<div class="chat-system-msg">世界正在生成中...</div>';
    return;
  }
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  for (const msg of chatMessages) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.type}`;
    let cleanText = msg.text.replace(/\*\*第\d+天[^*]*\*\*/g, '').trim();
    if (msg.type === 'world') {
      div.innerHTML = highlightQuoted(cleanText);
    } else {
      // 玩家消息带头像
      let html = '<div class="chat-avatar"></div><div class="chat-bubble">';
      if (msg.name) html += `<div class="msg-name">${escapeHtml(msg.name)}</div>`;
      html += highlightQuoted(cleanText);
      html += `<span class="msg-ts">${ts}</span>`;
      html += '</div>';
      div.innerHTML = html;
    }
    chatArea.appendChild(div);
  }
  // 自动滚到底部
  chatArea.scrollTop = chatArea.scrollHeight;
  // 备用：滚动父容器
  const scrollParent = chatArea.closest('.ml-window-body');
  if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
}

/** 把引号内的文字加粗重色 */
function highlightQuoted(rawText) {
  // 先把非引号部分escape，引号内部分单独处理
  // 简单方案：先全部escape，然后用unicode引号做替换
  let t = escapeHtml(rawText);
  // 中文双引号 \u201c \u201d
  t = t.replace(/\u201c([^\u201d]*?)\u201d/g, '<span class="msg-quoted">\u201c$1\u201d</span>');
  // 中文单引号 \u2018 \u2019
  t = t.replace(/\u2018([^\u2019]*?)\u2019/g, '<span class="msg-quoted">\u2018$1\u2019</span>');
  // 英文双引号不处理——避免和HTML属性冲突，DS中文输出基本只用中文引号
  return t;
}

function appendChatMsg(type, name, text) {
  chatMessages.push({ type, name, text });
  renderChat();
}

function appendTerminalLine(text) {
  const body = $('#terminal-body');
  const line = document.createElement('div');
  line.className = 'term-line';
  line.innerHTML = `<span class="term-hidden">${escapeHtml(text)}</span>`;
  // 在cursor前插入
  const cursor = body.querySelector('.term-cursor')?.parentElement;
  if (cursor) body.insertBefore(line, cursor);
  else body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

// ---- Prompts 管理 ----
async function loadPromptsList() {
  const files = await api('/api/rp/prompts');
  const list = $('#prompt-list');
  list.innerHTML = '';
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'prompt-item' + (currentPromptFile === f ? ' active' : '');
    item.textContent = f;
    item.addEventListener('click', () => loadPromptFile(f));
    list.appendChild(item);
  }
}

async function loadPromptFile(filename) {
  currentPromptFile = filename;
  $$('.prompt-item').forEach(i => i.classList.remove('active'));
  $$('.prompt-item').forEach(i => { if (i.textContent === filename) i.classList.add('active'); });
  const data = await api(`/api/rp/prompts/${filename}`);
  $('#prompt-filename').textContent = filename;
  $('#prompt-content').value = data.content;
  $('#prompt-content').disabled = false;
  $('#btn-save-prompt').disabled = false;
}

$('#btn-save-prompt').addEventListener('click', async () => {
  if (!currentPromptFile) return;
  await api(`/api/rp/prompts/${currentPromptFile}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: $('#prompt-content').value })
  });
  toast('已保存');
});

// ---- Logs ----
async function loadLogs() {
  if (!currentSessionId) {
    $('#page-logs').innerHTML = '<div class="empty-hint">先选择一个游戏</div>';
    return;
  }
  const logs = await api(`/api/rp/session/${currentSessionId}/logs`);
  const page = $('#page-logs');
  page.innerHTML = '';
  if (logs.length === 0) {
    page.innerHTML = '<div class="empty-hint">还没有日志</div>';
    return;
  }
  for (const log of logs) {
    const entry = document.createElement('div');
    entry.style.cssText = 'margin:6px 0;border:1px solid var(--line);padding:8px;font-size:12px;';
    entry.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">轮次 ${log.轮次} · ${log.游戏时间} · ${log.发言玩家}</div>
      <details><summary style="cursor:pointer;color:var(--blue-ink)">上下文</summary><pre style="white-space:pre-wrap;font-size:11px;background:var(--panel-warm);padding:6px;margin:4px 0">${escapeHtml(JSON.stringify(log.折叠一_上下文, null, 2))}</pre></details>
      <details><summary style="cursor:pointer;color:var(--blue-ink)">提示词</summary><pre style="white-space:pre-wrap;font-size:11px;background:var(--panel-warm);padding:6px;margin:4px 0">${escapeHtml(JSON.stringify(log.折叠二_提示词, null, 2))}</pre></details>
      <details><summary style="cursor:pointer;color:var(--blue-ink)">分发</summary><pre style="white-space:pre-wrap;font-size:11px;background:var(--panel-warm);padding:6px;margin:4px 0">${escapeHtml(JSON.stringify(log.折叠三_分发, null, 2))}</pre></details>
    `;
    page.appendChild(entry);
  }
}

// ---- History ----
async function loadHistory() {
  const archives = await api('/api/rp/archive');
  const page = $('#page-history');
  page.innerHTML = '';
  if (archives.length === 0) {
    page.innerHTML = '<div class="empty-hint">还没有历史记录</div>';
    return;
  }
  for (const a of archives) {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.innerHTML = `<span>${a.主题} · ${a.总轮次}轮</span><span style="font-size:10px">${a.结算时间?.slice(0,10) || ''}</span>`;
    item.addEventListener('click', async () => {
      const detail = await api(`/api/rp/archive/${a.id}`);
      const vacationBtn = `<div style="text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--mid)"><button class="ml-btn" onclick="enterVacation('${a.id}')">🏖️ 进入度假模式</button></div>`;
      showModal('结算详情', renderSettlement(detail) + vacationBtn);
    });
    page.appendChild(item);
  }
}

// ---- 度假模式 ----
window.enterVacation = async function(archiveId) {
  const r = await api(`/api/rp/archive/${archiveId}/vacation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (r.error) { alert('恢复失败：' + r.error); return; }
  setCurrentSession(r.id);
  showPlayTab();
  closeModal();
  loadPlayView();
};

// ---- Dock 弹窗 ----
$('#dock-world').addEventListener('click', async () => {
  if (!currentSessionId) return showModal('世界设定', '还没有开始游戏');
  const view = await fetchCurrentView();
  showModal('世界设定', renderWorldSetting(view.世界观 || '暂无'));
});

$('#dock-my-setting').addEventListener('click', async () => {
  if (!currentSessionId) return showModal('个人设定', '还没有开始游戏');
  const view = await fetchCurrentView();
  showModal('个人设定', renderSettingCards(view.我的设定?.我的设定 || {}));
});

$('#dock-quest').addEventListener('click', async () => {
  if (!currentSessionId) return showModal('任务详情', '还没有开始游戏');
  const view = await fetchCurrentView();
  const taskRaw = view.我的设定?.我的任务 || '无';
  const taskMatch = taskRaw.match(/【主线任务[：:]】([\s\S]*?)(?=【|$)/);
  const taskText = taskMatch ? taskMatch[1].trim() : cleanSettingText(taskRaw);
  let html = `<div class="setting-clean-list">`;
  html += `<section class="setting-clean-item"><h3>主线任务</h3><p>${escapeHtml(taskText)}</p></section>`;
  if (view.我的设定?.我的隐藏任务 && view.我的设定.我的隐藏任务 !== '无') {
    html += `<section class="setting-clean-item"><h3>🔒 隐藏任务</h3><p>${escapeHtml(view.我的设定.我的隐藏任务)}</p></section>`;
  }
  html += `</div>`;
  showModal('任务详情', html);
});

$('#dock-info').addEventListener('click', async () => {
  if (!currentSessionId) return showModal('补充信息', '还没有开始游戏');
  const view = await fetchCurrentView();
  showModal('补充信息', renderWorldSetting(view.我的设定?.已知对方信息 || '暂无'));
});

$('#dock-npc').addEventListener('click', () => {
  showModal('NPC', '<div class="empty-hint">暂时没有NPC出场</div>');
});

$('#dock-rules').addEventListener('click', () => {
  showModal('游戏规则', `
    <div style="font-size:12px;line-height:1.8">
      <h3 style="font-size:14px">消息发送</h3>
      <p>左按钮切换公开/隐藏模式。隐藏模式输入框变深色。</p>
      <p>两个模式的消息独立保存，切换不清空。</p>
      <p>点Send一起发送，至少一个模式有内容才能发。</p>
      <p>Shift+Enter换行。</p>
      <p>不在同一场景时消息必须发隐藏。</p>

      <h3 style="font-size:14px">信息可见性</h3>
      <p>公屏消息：三席和世界都看得到。</p>
      <p>隐藏消息：只有你和世界看得到。</p>
      <p>世界对隐藏行为的回复只有你看得到（带【隐藏】标签）。</p>
      <p>第二层判定时，渗透信息会混入其他席位的公屏内容，他们分不清来源。</p>

      <h3 style="font-size:14px">背包</h3>
      <p>背包不是实时更新的。被偷了东西你不翻背包不知道。</p>
      <p>只有发消息后世界回复了，才能看到变动。</p>

      <h3 style="font-size:14px">事件</h3>
      <p>每15轮掷一次事件骰子。30%大事件/70%小事件。</p>
      <p>事件叠加不等待，上一个没解决下一个照来。</p>

      <h3 style="font-size:14px">结算</h3>
      <p>两天时间到或三席同意提前结束。</p>
      <p>结算后全部解密，可以回看所有人的隐藏内容。</p>
      <p>可以进入度假模式继续闲逛。</p>
    </div>
  `);
});

// 设置
$('#dock-settings').addEventListener('click', async () => {
  const config = await api('/api/rp/config');
  $('#set-model').value = config.api?.flash?.model || config.api?.model || '';
  $('#set-key').value = '';
  $('#set-key').placeholder = config.api?.flash?.keyConfigured ? '已配置，留空不修改' : 'sk-... 或使用环境变量';
  $('#set-base-url').value = config.api?.flash?.baseUrl || config.api?.baseUrl || '';
  renderDiceDisplay(config.骰子);
  $('#settings-overlay').style.display = '';
});

$('#settings-close').addEventListener('click', () => { $('#settings-overlay').style.display = 'none'; });
$('#settings-overlay').addEventListener('click', e => { if (e.target === $('#settings-overlay')) $('#settings-overlay').style.display = 'none'; });

$('#btn-save-api').addEventListener('click', async () => {
  const config = await api('/api/rp/config');
  const newKey = $('#set-key').value.trim();
  if (config.api.flash) {
    config.api.flash.model = $('#set-model').value;
    config.api.flash.key = newKey;
    config.api.flash.baseUrl = $('#set-base-url').value;
  }
  if (config.api.pro && newKey && !config.api.pro.keyConfigured) {
    config.api.pro.key = newKey;
  }
  await api('/api/rp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  toast('API配置已保存');
});

function renderDiceDisplay(dice) {
  const div = $('#dice-display');
  div.innerHTML = `
    <div class="dice-row"><span class="dice-label">陌生人概率</span><span class="dice-val">${dice.关系.陌生人}%</span></div>
    <div class="dice-row"><span class="dice-label">合作概率</span><span class="dice-val">${dice.关系.合作}%</span></div>
    <div class="dice-row"><span class="dice-label">敌对概率</span><span class="dice-val">${dice.关系.敌对}%</span></div>
    <div class="dice-row"><span class="dice-label">隐藏任务(单人)</span><span class="dice-val">${dice.隐藏任务.单人概率}%</span></div>
    <div class="dice-row"><span class="dice-label">隐藏任务(多人)</span><span class="dice-val">${dice.隐藏任务.双方概率}%</span></div>
    <div class="dice-row"><span class="dice-label">掷骰间隔</span><span class="dice-val">${dice.事件.掷骰间隔轮数}轮</span></div>
    <div class="dice-row"><span class="dice-label">大事件概率</span><span class="dice-val">${dice.事件.大事件概率}%</span></div>
    <div class="dice-row"><span class="dice-label">小事件概率</span><span class="dice-val">${dice.事件.小事件概率}%</span></div>
    <div class="dice-row"><span class="dice-label">大事件保底</span><span class="dice-val">${dice.事件.大事件硬保底轮数}轮</span></div>
    <div class="dice-row"><span class="dice-label">小事件保底</span><span class="dice-val">${dice.事件.小事件硬保底轮数}轮</span></div>
  `;
}

// ---- 弹窗 ----
function showModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-overlay').style.display = '';
}
$('#modal-close').addEventListener('click', () => { $('#modal-overlay').style.display = 'none'; });
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) $('#modal-overlay').style.display = 'none'; });

// ---- Toast ----
function toast(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:32px;right:20px;padding:6px 16px;background:var(--panel-warm);border:1px solid var(--success);color:var(--success);font-family:JetBrains Mono,monospace;font-size:12px;z-index:200;';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ---- 工具 ----
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderSettlement(detail) {
  const players = detail.players || {};
  const scenario = detail.scenario || {};

  let html = '<div style="padding:8px">';

  // 世界观——用renderWorldSetting解析【】标签
  html += '<div style="margin-bottom:16px;border-bottom:2px solid var(--mid);padding-bottom:12px">';
  html += '<h2 style="font-size:16px;color:var(--star);margin-bottom:8px">世界观</h2>';
  html += renderWorldSetting(scenario.worldSetting || detail.世界观 || '暂无');
  html += '</div>';

  for (const slot of PLAYERS) {
    const playerData = players[`player${slot}`] || players[slot] || {};
    const setting = playerData.fullSetting || {};
    const task = playerData.visiblePackage || {};
    html += '<div style="margin-bottom:16px;border-bottom:2px solid var(--mid);padding-bottom:12px">';
    html += `<h2 style="font-size:16px;color:var(--star);margin-bottom:8px">${escapeHtml(PLAYER_LABELS[slot] || `玩家${slot}`)} · ${escapeHtml(setting['名字'] || '未知')}</h2>`;
    html += renderSettingCards(setting);
    const taskText = task.我的任务 || '无';
    const taskMatch = taskText.match(/【主线任务[：:]】([\s\S]*?)(?=【|$)/);
    const taskClean = taskMatch ? taskMatch[1].trim() : cleanSettingText(taskText);
    html += `<div class="setting-clean-item" style="margin-top:8px"><h3>主线任务</h3><div>${md(taskClean)}</div></div>`;
    if (task.我的隐藏任务 && task.我的隐藏任务 !== '无') {
      html += `<div class="setting-clean-item"><h3>🔒 隐藏任务</h3><div>${md(task.我的隐藏任务)}</div></div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderWorldSetting(raw) {
  if (!raw || raw === '暂无') return '<div class="empty-hint">暂无世界设定</div>';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  // 把【标签名：】格式转成干净的分段标题
  const sections = text.split(/【([^】]+)[：:]】/).filter(s => s.trim());
  if (sections.length < 2) {
    // 没有【】标签，直接用干净格式展示
    return `<div class="setting-clean-text">${escapeHtml(cleanSettingText(text))}</div>`;
  }
  let html = '<div class="setting-clean-list">';
  for (let i = 0; i < sections.length - 1; i += 2) {
    const title = sections[i].trim();
    const content = sections[i + 1].trim();
    if (!content) continue;
    html += `<section class="setting-clean-item"><h3>${escapeHtml(title)}</h3><div>${md(cleanSettingText(content))}</div></section>`;
  }
  html += '</div>';
  return html;
}

function renderSettingCards(raw) {
  const data = normalizeSettingData(raw);
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return '<div class="empty-hint">暂无个人设定</div>';
  }
  if (typeof data === 'string') {
    return `<div class="setting-clean-text">${escapeHtml(cleanSettingText(data))}</div>`;
  }

  const preferred = ['名字', '外貌', '着装', '经历', '能力', '性格特征', '内在矛盾', '隐藏设定', '隐藏道具'];
  const keys = [
    ...preferred.filter(key => Object.prototype.hasOwnProperty.call(data, key)),
    ...Object.keys(data).filter(key => !preferred.includes(key))
  ];

  return `<div class="setting-clean-list">${keys.map(key => {
    const value = data[key];
    if (value === null || value === undefined || value === '') return '';
    return `
      <section class="setting-clean-item">
        <h3>${escapeHtml(key)}</h3>
        <div>${md(cleanSettingText(value))}</div>
      </section>
    `;
  }).join('')}</div>`;
}

function normalizeSettingData(raw) {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    return cleanSettingText(text);
  }
}

function cleanSettingText(value) {
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value)
    .replace(/^[\s,{[]+|[\s,}\]]+$/g, '')
    .replace(/^\s*"([^"]+)"\s*:\s*/gm, '$1：')
    .replace(/[",]\s*$/gm, '')
    .trim();
}

// ---- 轮询——每5秒检查旁席是否发了新消息或状态更新 ----
let lastKnownTurn = 0;
let lastStatusHash = '';
setInterval(async () => {
  if (!currentSessionId || currentTab !== 'play') return;
  try {
    const view = await fetchCurrentView();
    // 检查轮次变化（旁席发了新消息）
    if (view.轮次 > lastKnownTurn) {
      lastKnownTurn = view.轮次;
      updatePlayUI(view);
      return;
    }
    // 检查状态变化（异步追踪更新了背包或状态）
    const statusHash = JSON.stringify(view.我的公屏状态) + JSON.stringify(view.我的背包) + JSON.stringify(view.其他玩家);
    if (statusHash !== lastStatusHash) {
      lastStatusHash = statusHash;
      // 只更新状态相关的UI不重新渲染聊天
      if (view.我的公屏状态) {
        $('#stat-look').textContent = view.我的公屏状态.外貌 || '—';
        $('#stat-outfit').textContent = view.我的公屏状态.着装 || '—';
        $('#stat-held').textContent = view.我的公屏状态.手持物 || '—';
        $('#stat-body').textContent = view.我的公屏状态.身体状态 || '—';
      }
      updateOtherRoster(view.其他玩家);
      updateInventory(view.我的背包);
      updateOtherInventory(view.其他玩家);
    }
  } catch {}
}, 5000);

// ---- stats标签切换 ----
const statsLabels = ['外貌', '服装', '手持物', '身体状态'];
const statsKeys = ['look', 'outfit', 'held', 'body'];
let statsIdx = 0;

function updateStatsTab() {
  $('#stats-tab-label').textContent = statsLabels[statsIdx];
  $$('.stats-page').forEach(p => p.classList.remove('active'));
  const target = $(`.stats-page[data-stat="${statsKeys[statsIdx]}"]`);
  if (target) target.classList.add('active');
}

$('#stats-prev').addEventListener('click', () => {
  statsIdx = (statsIdx - 1 + statsLabels.length) % statsLabels.length;
  updateStatsTab();
});
$('#stats-next').addEventListener('click', () => {
  statsIdx = (statsIdx + 1) % statsLabels.length;
  updateStatsTab();
});

// ---- 初始化 ----
loadOverview();

// ---- 移动端 Play Tabs 切换 ----
$$('.m-play-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.m-play-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.target;
    const layout = $('.play-layout');
    if (layout) {
      layout.dataset.mobileTab = target;
    }
  });
});
