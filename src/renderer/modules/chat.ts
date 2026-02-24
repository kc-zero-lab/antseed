export function initChatModule({
  bridge,
  elements,
  uiState,
  setBadgeTone,
  appendSystemLog,
}: any) {
  const toolIcons: Record<string, string> = {
    bash: '⚡',
    read_file: '📄',
    write_file: '✏️',
    list_directory: '📁',
    search_files: '🔍',
    grep: '🔎',
  };
  const myrmecochoryPhrases = [
    'Myrmecochory scouting for the right peer',
    'Myrmecochory optimizing route and cost',
    'Myrmecochory validating marketplace path',
    'Myrmecochory checking tool and context trail',
    'Myrmecochory preparing the next inference hop',
  ];

  let activeConversation: any = null;
  let activeStreamTurn: number | null = null;
  let activeStreamStartedAt = 0;

  function formatChatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatChatDateTime(timestamp) {
    if (!timestamp || Number(timestamp) <= 0) {
      return 'n/a';
    }
    const d = new Date(timestamp);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function shortModelName(model) {
    const raw = String(model || '').trim();
    if (!raw) return 'unknown-model';
    return raw.replace(/^claude-/, '').replace(/-20\d{6,}/, '');
  }

  function formatCompactNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '0';
    return Math.floor(num).toLocaleString();
  }

  function formatUsd(value, maxFractionDigits = 6) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '0';
    return num.toLocaleString([], {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  }

  function normalizeAssistantMeta(msg) {
    if (!msg || msg.role !== 'assistant' || !msg.meta || typeof msg.meta !== 'object') {
      return null;
    }
    const meta = msg.meta;
    const peerId = typeof meta.peerId === 'string' && meta.peerId.trim().length > 0 ? meta.peerId.trim() : null;
    const peerAddress = typeof meta.peerAddress === 'string' && meta.peerAddress.trim().length > 0 ? meta.peerAddress.trim() : null;
    const peerProviders = Array.isArray(meta.peerProviders)
      ? meta.peerProviders.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
      : [];
    const provider = typeof meta.provider === 'string' && meta.provider.trim().length > 0 ? meta.provider.trim() : null;
    const model = typeof meta.model === 'string' && meta.model.trim().length > 0 ? meta.model.trim() : null;
    const inputTokens = Math.max(0, Math.floor(Number(meta.inputTokens) || 0));
    const outputTokens = Math.max(0, Math.floor(Number(meta.outputTokens) || 0));
    const explicitTotalTokens = Math.max(0, Math.floor(Number(meta.totalTokens) || 0));
    const totalTokens = explicitTotalTokens > 0 ? explicitTotalTokens : inputTokens + outputTokens;
    const tokenSourceRaw = String(meta.tokenSource || '').trim().toLowerCase();
    const tokenSource = tokenSourceRaw === 'estimated'
      ? 'estimated'
      : (tokenSourceRaw === 'usage' ? 'usage' : 'unknown');
    const costUsd = Number.isFinite(Number(meta.estimatedCostUsd)) ? Number(meta.estimatedCostUsd) : 0;
    const latencyMs = Number.isFinite(Number(meta.latencyMs)) ? Number(meta.latencyMs) : 0;
    const peerReputation = Number.isFinite(Number(meta.peerReputation)) ? Number(meta.peerReputation) : null;
    const peerTrustScore = Number.isFinite(Number(meta.peerTrustScore)) ? Number(meta.peerTrustScore) : null;
    const peerCurrentLoad = Number.isFinite(Number(meta.peerCurrentLoad)) ? Number(meta.peerCurrentLoad) : null;
    const peerMaxConcurrency = Number.isFinite(Number(meta.peerMaxConcurrency)) ? Number(meta.peerMaxConcurrency) : null;
    const routeRequestId = typeof meta.routeRequestId === 'string' && meta.routeRequestId.trim().length > 0
      ? meta.routeRequestId.trim()
      : null;
    return {
      peerId,
      peerAddress,
      peerProviders,
      peerReputation,
      peerTrustScore,
      peerCurrentLoad,
      peerMaxConcurrency,
      routeRequestId,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      tokenSource,
      costUsd: costUsd > 0 ? costUsd : 0,
      latencyMs: latencyMs > 0 ? latencyMs : 0,
    };
  }

  function getConversationTokenCounts(conv) {
    const usage = conv?.usage || {};
    const inputTokens = Math.max(0, Math.floor(Number(usage.inputTokens) || 0));
    const outputTokens = Math.max(0, Math.floor(Number(usage.outputTokens) || 0));
    const totalFromUsage = inputTokens + outputTokens;
    const totalFromSummary = Math.max(0, Math.floor(Number(conv?.totalTokens) || 0));
    const totalTokens = totalFromSummary > 0 ? totalFromSummary : totalFromUsage;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
    };
  }

  function getMyrmecochoryLabel(seed = 0) {
    const index = Math.abs(Math.floor(Number(seed) || 0)) % myrmecochoryPhrases.length;
    return myrmecochoryPhrases[index];
  }

  function isToolResultOnlyMessage(msg) {
    return msg.role === 'user'
      && Array.isArray(msg.content)
      && msg.content.length > 0
      && msg.content.every((b) => b.type === 'tool_result');
  }

  function countBlocks(blocks) {
    const summary = { text: 0, toolUse: 0, toolResult: 0, thinking: 0 };
    if (!Array.isArray(blocks)) return summary;
    for (const block of blocks) {
      if (block.type === 'text') summary.text += 1;
      if (block.type === 'tool_use') summary.toolUse += 1;
      if (block.type === 'tool_result') summary.toolResult += 1;
      if (block.type === 'thinking') summary.thinking += 1;
    }
    return summary;
  }

  function visibleMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.filter((msg) => !isToolResultOnlyMessage(msg));
  }

  function updateStreamingIndicator() {
    if (!elements.chatStreamingIndicator) return;
    if (activeStreamTurn !== null && uiState.chatSending) {
      const label = getMyrmecochoryLabel(activeStreamTurn);
      elements.chatStreamingIndicator.innerHTML = `<span class="chat-streaming-dot"></span> Turn ${activeStreamTurn} · ${label}`;
      return;
    }
    elements.chatStreamingIndicator.innerHTML = '<span class="chat-streaming-dot"></span> Generating response...';
  }

  function updateThreadMeta(conv) {
    const metaEl = elements.chatThreadMeta;
    if (!metaEl) return;

    if (!conv) {
      metaEl.textContent = 'No conversation selected';
      return;
    }

    const messages = visibleMessages(conv.messages || []);
    let toolCalls = 0;
    let reasoningBlocks = 0;
    let totalEstimatedCostUsd = 0;
    const servingPeers = new Set();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const counts = countBlocks(msg.content);
        toolCalls += counts.toolUse;
        reasoningBlocks += counts.thinking;
      }
      const meta = normalizeAssistantMeta(msg);
      if (meta) {
        if (meta.peerId) servingPeers.add(meta.peerId);
        if (meta.costUsd > 0) totalEstimatedCostUsd += meta.costUsd;
      }
    }

    const parts = [
      `session ${String(conv.id || '').slice(0, 8) || 'n/a'}`,
      shortModelName(conv.model),
      `${messages.length} msg${messages.length === 1 ? '' : 's'}`,
    ];
    if (toolCalls > 0) parts.push(`${toolCalls} tool${toolCalls === 1 ? '' : 's'}`);
    if (reasoningBlocks > 0) parts.push(`${reasoningBlocks} reasoning`);

    const tokenCounts = getConversationTokenCounts(conv);
    parts.push(
      `tokens ${formatCompactNumber(tokenCounts.totalTokens)} (${formatCompactNumber(tokenCounts.inputTokens)} in / ${formatCompactNumber(tokenCounts.outputTokens)} out)`,
    );
    if (totalEstimatedCostUsd > 0) {
      parts.push(`cost $${formatUsd(totalEstimatedCostUsd)}`);
    } else if (tokenCounts.totalTokens > 0) {
      parts.push('cost n/a');
    }
    if (servingPeers.size > 0) {
      parts.push(`${servingPeers.size} serving peer${servingPeers.size === 1 ? '' : 's'}`);
    }

    if (conv.createdAt) {
      parts.push(`started ${formatChatDateTime(conv.createdAt)}`);
    }
    parts.push(`updated ${formatChatDateTime(conv.updatedAt)}`);

    metaEl.textContent = parts.join(' · ');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function toErrorMessage(err, fallback = 'Unexpected error') {
    if (typeof err === 'string' && err.trim().length > 0) {
      return err;
    }
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message.trim().length > 0) {
      return err.message;
    }
    return fallback;
  }

  function showChatError(message) {
    const text = toErrorMessage(message, 'Unexpected chat error');
    if (elements.chatError) {
      elements.chatError.textContent = text;
      elements.chatError.style.display = '';
    }
  }

  function clearChatError() {
    if (elements.chatError) {
      elements.chatError.textContent = '';
      elements.chatError.style.display = 'none';
    }
  }

  function scrollChatToBottom() {
    const container = elements.chatMessages;
    if (!container) return;
    const threshold = 100;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < threshold) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const langLabel = lang || 'code';
      const codeId = 'code-' + Math.random().toString(36).slice(2, 8);
      return `<div class="chat-code-container"><div class="chat-code-header"><span class="code-lang">${langLabel}</span><button class="chat-code-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('${codeId}').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button></div><pre><code id="${codeId}">${code}</code></pre></div>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;margin:12px 0 6px;color:var(--text-primary)">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:600;margin:14px 0 8px;color:var(--text-primary)">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:700;margin:16px 0 8px;color:var(--text-primary)">$1</h1>');
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:12px 0">');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent-blue);text-decoration:underline" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^\s*[\-*•] (.+)$/gm, '<li class="chat-md-li chat-md-li-ul">$1</li>');
    html = html.replace(/^\s*\d+\. (.+)$/gm, '<li class="chat-md-li chat-md-li-ol">$1</li>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br>\s*(<li class="chat-md-li[^"]*">)/g, '$1');
    html = html.replace(/(<\/li>)\s*(?:<br>\s*)+(?=<li class="chat-md-li)/g, '$1');
    html = html.replace(/((?:<li class="chat-md-li[^"]*">[\s\S]*?<\/li>(?:\s*<br>\s*)*)+)/g, (listBlock) => {
      const ordered = listBlock.includes('chat-md-li-ol');
      const tag = ordered ? 'ol' : 'ul';
      const cleaned = listBlock
        .replace(/^\s*(?:<br>\s*)+/, '')
        .replace(/(?:<br>\s*)+\s*$/, '');
      return `<${tag} class="chat-md-list">${cleaned}</${tag}>`;
    });
    html = html.replace(/<(ul|ol) class="chat-md-list">\s*(?:<br>\s*)+/g, '<$1 class="chat-md-list">');
    html = html.replace(/(?:<br>\s*)+\s*<\/(ul|ol)>/g, '</$1>');

    return html;
  }

  function renderContentBlocks(blocks) {
    if (!Array.isArray(blocks)) return renderMarkdown(String(blocks));

    let html = '';

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          html += `<div class="chat-bubble-content">${renderMarkdown(block.text)}</div>`;
          break;
        case 'thinking':
          {
            const thinkingLabel = getMyrmecochoryLabel(block.thinking?.length);
          html += '<div class="thinking-block">';
          html += '<div class="thinking-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="thinking-block-triangle">▶</span>';
          html += `<span>${escapeHtml(thinkingLabel)}</span>`;
          html += '</div>';
          html += `<div class="thinking-block-body">${escapeHtml(block.thinking)}</div>`;
          html += '</div>';
          break;
          }
        case 'tool_use': {
          const icon = (toolIcons as Record<string, string>)[String(block.name)] || '🔧';
          const inputJson = JSON.stringify(block.input, null, 2);
          html += `<div class="tool-block" data-tool-id="${escapeHtml(block.id)}">`;
          html += '<div class="tool-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="tool-block-triangle">▶</span>';
          html += `<span class="tool-block-icon">${icon}</span>`;
          html += `<span class="tool-block-name">${escapeHtml(block.name)}</span>`;
          html += '<span class="tool-block-status success">Done</span>';
          html += '</div>';
          html += '<div class="tool-block-body">';
          html += `<div class="tool-block-input">${escapeHtml(inputJson)}</div>`;
          html += '</div></div>';
          break;
        }
        case 'tool_result': {
          const outputText = block.content || '';
          const truncated = outputText.length > 2000 ? outputText.slice(0, 2000) + '\n... (truncated)' : outputText;
          html += '<div class="tool-block">';
          html += '<div class="tool-block-header" onclick="this.parentElement.classList.toggle(\'open\')">';
          html += '<span class="tool-block-triangle">▶</span>';
          html += '<span class="tool-block-icon">📋</span>';
          html += '<span class="tool-block-name">Result</span>';
          html += `<span class="tool-block-status ${block.is_error ? 'error' : 'success'}">${block.is_error ? 'Error' : 'Success'}</span>`;
          html += '</div>';
          html += '<div class="tool-block-body">';
          html += `<div class="tool-block-output${block.is_error ? ' error' : ''}">${escapeHtml(truncated)}</div>`;
          html += '</div></div>';
          break;
        }
      }
    }

    return html;
  }

  async function refreshChatProxyStatus() {
    if (!bridge || !bridge.chatAiGetProxyStatus) return;

    try {
      const result = await bridge.chatAiGetProxyStatus();
      if (result.ok && result.data) {
        const { running, port } = result.data;
        if (running) {
          setBadgeTone(elements.chatProxyStatus, 'active', `Proxy :${port}`);
        } else {
          setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
        }
      }
    } catch {
      setBadgeTone(elements.chatProxyStatus, 'idle', 'Proxy offline');
    }
  }

  async function refreshChatConversations() {
    if (!bridge || !bridge.chatAiListConversations) return;

    try {
      const result = await bridge.chatAiListConversations();
      if (result.ok) {
        uiState.chatConversations = result.data || [];
        const activeSummary = uiState.chatConversations.find((conv) => conv.id === uiState.chatActiveConversation);
        if (activeSummary) {
          activeConversation = {
            ...(activeConversation || {}),
            ...activeSummary,
            messages: activeConversation?.messages || [],
          };
          updateThreadMeta(activeConversation);
        }
        renderChatConversations();
      }
    } catch {
      // Chat unavailable
    }
  }

  function renderChatConversations() {
    const container = elements.chatConversations;
    if (!container) return;

    const convs = uiState.chatConversations;
    if (convs.length === 0) {
      container.innerHTML = '<div class="chat-empty">No conversations yet</div>';
      return;
    }

    container.innerHTML = '';
    for (const conv of convs) {
      const item = document.createElement('div');
      item.className = `chat-conv-item${conv.id === uiState.chatActiveConversation ? ' active' : ''}`;
      item.dataset.convId = conv.id;

      const modelName = shortModelName(conv.model);
      const messageCount = Number(conv.messageCount) || 0;
      const tokenCounts = getConversationTokenCounts(conv);
      const totalCostUsd = Number(conv.totalEstimatedCostUsd) || 0;
      const updatedLabel = conv.updatedAt > 0 ? formatChatTime(conv.updatedAt) : 'n/a';
      const createdLabel = conv.createdAt > 0 ? formatChatTime(conv.createdAt) : null;

      let html = '<div class="chat-conv-top">';
      html += `<div class="chat-conv-peer">${escapeHtml(conv.title)}</div>`;
      html += `<span class="chat-conv-time">${escapeHtml(updatedLabel)}</span>`;
      html += '</div>';
      html += `<div class="chat-conv-preview">${escapeHtml(modelName)}</div>`;
      html += '<div class="chat-conv-meta">';
      html += `<span>${messageCount} msg${messageCount === 1 ? '' : 's'}</span>`;
      html += `<span>${formatCompactNumber(tokenCounts.totalTokens)} tok</span>`;
      if (totalCostUsd > 0) {
        html += `<span>$${formatUsd(totalCostUsd, 4)}</span>`;
      } else if (tokenCounts.totalTokens > 0) {
        html += '<span>$n/a</span>';
      }
      if (createdLabel) {
        html += `<span>created ${escapeHtml(createdLabel)}</span>`;
      }
      html += '</div>';

      item.innerHTML = html;
      item.addEventListener('click', () => {
        void openConversation(conv.id);
      });
      container.appendChild(item);
    }
  }

  async function openConversation(convId) {
    if (!bridge || !bridge.chatAiGetConversation) return;

    uiState.chatActiveConversation = convId;

    try {
      const result = await bridge.chatAiGetConversation(convId);
      if (result.ok && result.data) {
        const conv = result.data;
        activeConversation = conv;
        uiState.chatMessages = conv.messages || [];

        const header = elements.chatHeader;
        if (header) {
          const peerSpan = header.querySelector('.chat-thread-peer');
          if (peerSpan) peerSpan.textContent = conv.title;
        }

        if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = '';
        if (elements.chatModelSelect) elements.chatModelSelect.value = conv.model;
        if (elements.chatInput) elements.chatInput.disabled = false;
        if (elements.chatSendBtn) elements.chatSendBtn.disabled = false;

        updateThreadMeta(conv);
        renderChatMessages();
        renderChatConversations();
        clearChatError();
      } else {
        const message = toErrorMessage(result.error, 'Failed to open conversation');
        showChatError(message);
        appendSystemLog(`Chat error: ${message}`);
      }
    } catch (err) {
      const message = toErrorMessage(err, 'Failed to open conversation');
      showChatError(message);
      appendSystemLog(`Chat error: ${message}`);
    }
  }

  function renderChatMessages() {
    const container = elements.chatMessages;
    if (!container) return;

    const msgs = visibleMessages(uiState.chatMessages);
    if (msgs.length === 0) {
      container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-title">AntSeed AI Chat</div>
        <div class="chat-welcome-subtitle">Send messages through the P2P marketplace to inference providers.</div>
        <div class="chat-welcome-subtitle">Start the Buyer runtime and create a new conversation to begin.</div>
      </div>`;
      return;
    }

    container.innerHTML = '';
    for (const msg of msgs) {
      const stats = Array.isArray(msg.content) ? countBlocks(msg.content) : null;
      const assistantMeta = normalizeAssistantMeta(msg);
      const metaParts: string[] = [];
      if (msg.createdAt && Number(msg.createdAt) > 0) {
        metaParts.push(formatChatTime(msg.createdAt));
      }
      if (stats && msg.role === 'assistant') {
        if (stats.toolUse > 0) metaParts.push(`${stats.toolUse} tool${stats.toolUse === 1 ? '' : 's'}`);
        if (stats.thinking > 0) metaParts.push(`${stats.thinking} reasoning`);
        if (stats.text > 0) metaParts.push(`${stats.text} text block${stats.text === 1 ? '' : 's'}`);
      }
      if (assistantMeta) {
        if (assistantMeta.peerId) {
          metaParts.push(`peer ${assistantMeta.peerId.slice(0, 8)}`);
        } else {
          metaParts.push('peer n/a');
        }
        if (assistantMeta.peerAddress) metaParts.push(assistantMeta.peerAddress);
        if (assistantMeta.provider) metaParts.push(assistantMeta.provider);
        if (assistantMeta.model) metaParts.push(shortModelName(assistantMeta.model));
        if (assistantMeta.peerProviders.length > 0 && !assistantMeta.provider) {
          metaParts.push(assistantMeta.peerProviders.join(','));
        }
        if (assistantMeta.totalTokens > 0) {
          const tokenParts: string[] = [];
          tokenParts.push(`${formatCompactNumber(assistantMeta.totalTokens)} tok`);
          if (assistantMeta.inputTokens > 0 || assistantMeta.outputTokens > 0) {
            tokenParts.push(`(${formatCompactNumber(assistantMeta.inputTokens)} in / ${formatCompactNumber(assistantMeta.outputTokens)} out)`);
          }
          metaParts.push(tokenParts.join(' '));
        } else {
          metaParts.push('tok n/a');
        }
        if (assistantMeta.tokenSource === 'estimated') {
          metaParts.push('est.');
        }
        if (assistantMeta.costUsd > 0) {
          metaParts.push(`$${formatUsd(assistantMeta.costUsd)}`);
        } else if (assistantMeta.totalTokens > 0) {
          metaParts.push('$n/a');
        }
        if (assistantMeta.latencyMs > 0) metaParts.push(`${Math.round(assistantMeta.latencyMs)}ms`);
        if (assistantMeta.peerReputation !== null) metaParts.push(`rep ${Math.round(assistantMeta.peerReputation)}`);
        if (assistantMeta.peerTrustScore !== null) metaParts.push(`trust ${Math.round(assistantMeta.peerTrustScore)}`);
        if (assistantMeta.peerCurrentLoad !== null && assistantMeta.peerMaxConcurrency !== null && assistantMeta.peerMaxConcurrency > 0) {
          metaParts.push(`load ${Math.round(assistantMeta.peerCurrentLoad)}/${Math.round(assistantMeta.peerMaxConcurrency)}`);
        }
        if (assistantMeta.routeRequestId) metaParts.push(`route ${assistantMeta.routeRequestId.slice(0, 8)}`);
      }

      const bubbleMeta = metaParts.length > 0
        ? `<div class="chat-bubble-meta"><span class="chat-bubble-stats">${escapeHtml(metaParts.join(' · '))}</span></div>`
        : '';

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${msg.role === 'user' ? 'own' : 'other'}`;

      if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          bubble.innerHTML = `${bubbleMeta}${renderContentBlocks(msg.content)}`;
        } else {
          bubble.innerHTML = `${bubbleMeta}<div class="chat-bubble-content">${renderMarkdown(msg.content)}</div>`;
        }
      } else if (typeof msg.content === 'string') {
        bubble.innerHTML = `${bubbleMeta}<div class="chat-bubble-content">${escapeHtml(msg.content)}</div>`;
      } else {
        bubble.innerHTML = `${bubbleMeta}<div class="chat-bubble-content">${escapeHtml(JSON.stringify(msg.content))}</div>`;
      }

      container.appendChild(bubble);
    }

    container.scrollTop = container.scrollHeight;
  }

  async function createNewConversation() {
    if (!bridge || !bridge.chatAiCreateConversation) return;

    const model = elements.chatModelSelect?.value || 'claude-sonnet-4-20250514';
    try {
      const result = await bridge.chatAiCreateConversation(model);
      if (result.ok && result.data) {
        await refreshChatConversations();
        await openConversation(result.data.id);
        clearChatError();
      } else {
        const message = toErrorMessage(result.error, 'Failed to create conversation');
        showChatError(message);
        appendSystemLog(`Chat error: ${message}`);
      }
    } catch (err) {
      const message = toErrorMessage(err, 'Failed to create conversation');
      showChatError(message);
      appendSystemLog(`Chat error: ${message}`);
    }
  }

  async function deleteConversation() {
    const convId = uiState.chatActiveConversation;
    if (!convId || !bridge || !bridge.chatAiDeleteConversation) return;

    try {
      await bridge.chatAiDeleteConversation(convId);
      uiState.chatActiveConversation = null;
      uiState.chatMessages = [];
      activeConversation = null;

      if (elements.chatDeleteBtn) elements.chatDeleteBtn.style.display = 'none';
      if (elements.chatInput) elements.chatInput.disabled = true;
      if (elements.chatSendBtn) elements.chatSendBtn.disabled = true;

      const header = elements.chatHeader;
      if (header) {
        const peerSpan = header.querySelector('.chat-thread-peer');
        if (peerSpan) peerSpan.textContent = 'Conversation';
      }

      updateThreadMeta(null);
      renderChatMessages();
      await refreshChatConversations();
      clearChatError();
    } catch (err) {
      const message = toErrorMessage(err, 'Failed to delete conversation');
      showChatError(message);
      appendSystemLog(`Chat error: ${message}`);
    }
  }

  function setChatSending(sending) {
    uiState.chatSending = sending;
    if (elements.chatInput) elements.chatInput.disabled = sending;
    if (elements.chatSendBtn) {
      elements.chatSendBtn.disabled = sending;
      elements.chatSendBtn.style.display = sending ? 'none' : '';
    }
    if (elements.chatAbortBtn) elements.chatAbortBtn.style.display = sending ? '' : 'none';
    if (elements.chatStreamingIndicator) elements.chatStreamingIndicator.style.display = sending ? '' : 'none';
    if (!sending) {
      activeStreamTurn = null;
      activeStreamStartedAt = 0;
    }
    updateStreamingIndicator();
  }

  async function sendChatMessage() {
    const convId = uiState.chatActiveConversation;
    const input = elements.chatInput;
    if (!convId || !input || !bridge) return;

    const content = input.value.trim();
    if (content.length === 0) return;

    input.value = '';
    autoGrowTextarea(input);

    uiState.chatMessages.push({ role: 'user', content, createdAt: Date.now() });
    if (activeConversation) {
      activeConversation.messages = uiState.chatMessages;
      activeConversation.updatedAt = Date.now();
      updateThreadMeta(activeConversation);
    }
    renderChatMessages();

    clearChatError();
    setChatSending(true);

    try {
      const model = elements.chatModelSelect?.value;
      if (bridge.chatAiSendStream) {
        const result = await bridge.chatAiSendStream(convId, content, model);
        if (!result.ok) {
          const message = toErrorMessage(result.error, 'Request failed');
          showChatError(message);
          appendSystemLog(`Chat error: ${message}`);
          setChatSending(false);
        }
      } else if (bridge.chatAiSend) {
        const result = await bridge.chatAiSend(convId, content, model);
        if (!result.ok) {
          const message = toErrorMessage(result.error, 'Request failed');
          showChatError(message);
          appendSystemLog(`Chat error: ${message}`);
        }
        setChatSending(false);
      }
    } catch (err) {
      const message = toErrorMessage(err, 'Chat send failed');
      showChatError(message);
      appendSystemLog(`Chat error: ${message}`);
      setChatSending(false);
    }
  }

  function autoGrowTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }

  if (elements.chatSendBtn) {
    elements.chatSendBtn.addEventListener('click', () => {
      void sendChatMessage();
    });
  }

  if (elements.chatAbortBtn) {
    elements.chatAbortBtn.addEventListener('click', async () => {
      if (bridge && bridge.chatAiAbort) {
        await bridge.chatAiAbort();
      }
      setChatSending(false);
    });
  }

  if (elements.chatInput) {
    elements.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendChatMessage();
      }
    });
    elements.chatInput.addEventListener('input', () => {
      autoGrowTextarea(elements.chatInput);
    });
  }

  if (elements.chatNewBtn) {
    elements.chatNewBtn.addEventListener('click', () => {
      void createNewConversation();
    });
  }

  if (elements.chatDeleteBtn) {
    elements.chatDeleteBtn.addEventListener('click', () => {
      void deleteConversation();
    });
  }

  if (bridge) {
    if (bridge.onChatAiDone) {
      bridge.onChatAiDone((data) => {
        if (data.conversationId === uiState.chatActiveConversation) {
          const assistantMessage = {
            ...data.message,
            createdAt: data.message?.createdAt || Date.now(),
          };
          uiState.chatMessages.push(assistantMessage);
          if (activeConversation) {
            activeConversation.messages = uiState.chatMessages;
            activeConversation.updatedAt = Date.now();
            updateThreadMeta(activeConversation);
          }
          renderChatMessages();
          setChatSending(false);
          clearChatError();
        }
        void refreshChatConversations();
      });
    }

    if (bridge.onChatAiError) {
      bridge.onChatAiError((data) => {
        if (data.conversationId === uiState.chatActiveConversation) {
          setChatSending(false);
          if (data.error !== 'Request aborted') {
            showChatError(data.error);
            appendSystemLog(`AI Chat error: ${data.error}`);
          }
        }
      });
    }

    if (bridge.onChatAiUserPersisted) {
      bridge.onChatAiUserPersisted((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;
        const last = uiState.chatMessages[uiState.chatMessages.length - 1];
        if (last && last.role === 'user' && !last.createdAt) {
          last.createdAt = data.message?.createdAt || Date.now();
          renderChatMessages();
        }
      });
    }

    let streamingBubble: any = null;
    let streamingTextBuffer = '';
    let streamingThinkingBuffer = '';

    if (bridge.onChatAiStreamStart) {
      bridge.onChatAiStreamStart((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;
        clearChatError();
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';
        activeStreamTurn = Number(data.turn) + 1;
        activeStreamStartedAt = Date.now();
        updateStreamingIndicator();

        const container = elements.chatMessages;
        if (!container) return;
        streamingBubble = document.createElement('div');
        streamingBubble.className = 'chat-bubble other';
        const streamMeta = activeStreamTurn
          ? `turn ${activeStreamTurn} · ${getMyrmecochoryLabel(activeStreamTurn)}`
          : 'streaming';
        streamingBubble.innerHTML = `
          <div class="chat-bubble-meta">
            <span class="chat-bubble-stats">${escapeHtml(streamMeta)}</span>
          </div>
          <div class="chat-bubble-content streaming-cursor"></div>
        `;
        container.appendChild(streamingBubble);
        scrollChatToBottom();
      });
    }

    if (bridge.onChatAiStreamBlockStart) {
      bridge.onChatAiStreamBlockStart((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          streamingTextBuffer = '';
        } else if (data.blockType === 'thinking') {
          streamingThinkingBuffer = '';
          const thinkingLabel = getMyrmecochoryLabel((activeStreamTurn || 0) + Number(data.index || 0));
          const thinkDiv = document.createElement('div');
          thinkDiv.className = 'thinking-block open';
          thinkDiv.id = `stream-think-${data.index}`;
          thinkDiv.innerHTML = `<div class="thinking-block-header" onclick="this.parentElement.classList.toggle('open')"><span class="thinking-block-triangle">▶</span><span>${escapeHtml(thinkingLabel)}</span></div><div class="thinking-block-body"></div>`;
          streamingBubble.appendChild(thinkDiv);
          scrollChatToBottom();
        } else if (data.blockType === 'tool_use') {
          const icon = (toolIcons as Record<string, string>)[String(data.toolName)] || '🔧';
          const toolDiv = document.createElement('div');
          toolDiv.className = 'tool-block';
          toolDiv.id = `stream-tool-${data.toolId}`;
          toolDiv.innerHTML = `<div class="tool-block-header" onclick="this.parentElement.classList.toggle('open')"><span class="tool-block-triangle">▶</span><span class="tool-block-icon">${icon}</span><span class="tool-block-name">${escapeHtml(data.toolName || '')}</span><span class="tool-block-status running"><span class="tool-spinner"></span></span></div><div class="tool-block-body"><div class="tool-block-input">Preparing...</div></div>`;
          streamingBubble.appendChild(toolDiv);
          scrollChatToBottom();
        }
      });
    }

    if (bridge.onChatAiStreamDelta) {
      bridge.onChatAiStreamDelta((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          streamingTextBuffer += data.text;
          const contentEl = streamingBubble.querySelector('.chat-bubble-content');
          if (contentEl) {
            contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
            contentEl.classList.add('streaming-cursor');
          }
          scrollChatToBottom();
        } else if (data.blockType === 'thinking') {
          streamingThinkingBuffer += data.text;
          const thinkBody = streamingBubble.querySelector(`#stream-think-${data.index} .thinking-block-body`);
          if (thinkBody) {
            thinkBody.textContent = streamingThinkingBuffer;
          }
          scrollChatToBottom();
        }
      });
    }

    if (bridge.onChatAiStreamBlockStop) {
      bridge.onChatAiStreamBlockStop((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        if (data.blockType === 'text') {
          const contentEl = streamingBubble.querySelector('.chat-bubble-content');
          if (contentEl) {
            contentEl.classList.remove('streaming-cursor');
            contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
          }
        } else if (data.blockType === 'thinking') {
          const thinkHeader = streamingBubble.querySelector(`#stream-think-${data.index} .thinking-block-header span:last-child`);
          if (thinkHeader) thinkHeader.textContent = 'Myrmecochory trail notes';
          const thinkBlock = streamingBubble.querySelector(`#stream-think-${data.index}`);
          if (thinkBlock) thinkBlock.classList.remove('open');
        } else if (data.blockType === 'tool_use' && data.input) {
          const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolId}`);
          if (toolBlock) {
            const inputDiv = toolBlock.querySelector('.tool-block-input');
            if (inputDiv) inputDiv.textContent = JSON.stringify(data.input, null, 2);
          }
        }
      });
    }

    if (bridge.onChatAiToolExecuting) {
      bridge.onChatAiToolExecuting((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolUseId}`);
        if (toolBlock) {
          const statusEl = toolBlock.querySelector('.tool-block-status');
          if (statusEl) {
            statusEl.className = 'tool-block-status running';
            statusEl.innerHTML = '<span class="tool-spinner"></span> Running';
          }
          const inputDiv = toolBlock.querySelector('.tool-block-input');
          if (inputDiv) inputDiv.textContent = JSON.stringify(data.input, null, 2);
        }
      });
    }

    if (bridge.onChatAiToolResult) {
      bridge.onChatAiToolResult((data) => {
        if (data.conversationId !== uiState.chatActiveConversation || !streamingBubble) return;

        const toolBlock = streamingBubble.querySelector(`#stream-tool-${data.toolUseId}`);
        if (toolBlock) {
          const statusEl = toolBlock.querySelector('.tool-block-status');
          if (statusEl) {
            statusEl.className = `tool-block-status ${data.isError ? 'error' : 'success'}`;
            statusEl.textContent = data.isError ? 'Error' : 'Done';
          }
          const bodyEl = toolBlock.querySelector('.tool-block-body');
          if (bodyEl) {
            const truncated = data.output.length > 2000 ? data.output.slice(0, 2000) + '\n... (truncated)' : data.output;
            const outputDiv = document.createElement('div');
            outputDiv.className = `tool-block-output${data.isError ? ' error' : ''}`;
            outputDiv.textContent = truncated;
            bodyEl.appendChild(outputDiv);
          }
        }
        scrollChatToBottom();
      });
    }

    if (bridge.onChatAiStreamDone) {
      bridge.onChatAiStreamDone((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;

        const elapsedMs = activeStreamStartedAt > 0 ? Date.now() - activeStreamStartedAt : 0;
        streamingBubble = null;
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';
        setChatSending(false);
        clearChatError();
        if (elapsedMs > 0) {
          appendSystemLog(`AI stream completed in ${(elapsedMs / 1000).toFixed(1)}s.`);
        }

        void openConversation(data.conversationId);
        void refreshChatConversations();
      });
    }

    if (bridge.onChatAiStreamError) {
      bridge.onChatAiStreamError((data) => {
        if (data.conversationId !== uiState.chatActiveConversation) return;

        streamingBubble = null;
        streamingTextBuffer = '';
        streamingThinkingBuffer = '';
        setChatSending(false);

        if (data.error !== 'Request aborted') {
          showChatError(data.error);
          appendSystemLog(`AI Chat error: ${data.error}`);
        }
      });
    }
  }

  updateThreadMeta(null);

  return {
    refreshChatProxyStatus,
    refreshChatConversations,
  };
}
