// ── AI COACH ─────────────────────────
// Keep these functions global because index.html still uses inline onclick handlers.
let goalTitleCache = {}; // goalId -> title, used to render AI action cards with the correct goal name
let pendingAiActions = [];

function aiPreset(question) {
  document.getElementById('ai-inp').value = question;
  askAI();
}

async function askAI() {
  const question = document.getElementById('ai-inp').value.trim();
  if (!question) return;

  const btn = document.getElementById('ai-btn');
  const res = document.getElementById('ai-resp');

  btn.disabled = true;
  btn.innerHTML = '<span class="ai-spinner"></span> Đang phân tích...';
  res.className = 'ai-response on';
  res.textContent = '';
  renderAiActionCards([]);

  try {
    const weekData = await getWeek(weekOffset);
    const goalsSnap = await col('goals').limit(10).get();
    const goals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    let ctx = 'CÔNG VIỆC TUẦN NÀY:\n';
    const qN = {
      q1: 'Ô1(Khẩn&QT)',
      q2: 'Ô2(QT chưa khẩn)',
      q3: 'Ô3(Khẩn)',
      q4: 'Ô4(Sao nhãng)'
    };

    ['q1', 'q2', 'q3', 'q4'].forEach(key => {
      const tasks = weekData[key] || [];
      if (tasks.length) {
        ctx += `${qN[key]}: ${tasks
          .map(t => `${t.text}(${t.hours || 0}h${t.done ? ',✓' : ''})`)
          .join(', ')}\n`;
      }
    });

    if (goals.length) {
      ctx += '\nGOALS:\n';
      goals.forEach(g => {
        ctx += `- ${g.title} [${g.category}] deadline:${g.deadline || 'chưa đặt'}${g.done ? ' (xong)' : ''}\n`;
      });
    }

    const goalsBrief = goals.length
      ? goals.map(g => `${g.id}="${g.title}"`).join('; ')
      : '';
    goals.forEach(g => { goalTitleCache[g.id] = g.title; });

    const r = await fetch('/api/ai-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: ctx,
        goalsBrief
      })
    });

    let data = {};
    try {
      data = await r.json();
    } catch (_) {
      data = {};
    }

    if (!r.ok) {
      throw new Error(data.error || `AI Coach API error ${r.status}`);
    }

    res.textContent = data.text || (data.actions?.length ? '' : 'Không có phản hồi.');
    renderAiActionCards(data.actions || []);
  } catch (e) {
    console.error('AI fetch failed:', e);
    res.textContent = 'Lỗi kết nối AI: ' + e.message;
    renderAiActionCards([]);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Hỏi ↗';
  }
}

function renderAiActionCards(actions) {
  pendingAiActions = actions;
  const wrap = document.getElementById('ai-actions-wrap');
  if (!actions.length) {
    wrap.innerHTML = '';
    wrap.classList.remove('on');
    return;
  }

  wrap.classList.add('on');
  wrap.innerHTML = actions.map((a, idx) => renderActionCard(a, idx)).join('');
}

function renderActionCard(a, idx) {
  if (a.tool === 'add_task') {
    const qLabel = Q_LABELS[a.args.quadrant] || a.args.quadrant;
    return `
      <div class="ai-action-card" id="ai-action-${idx}">
        <div class="ai-action-icon">➕</div>
        <div class="ai-action-body">
          <div class="ai-action-title">Thêm task vào ${esc(qLabel)}</div>
          <div class="ai-action-desc">${esc(a.args.text)}${a.args.hours ? ` · ${a.args.hours}h` : ''}</div>
        </div>
        <div class="ai-action-btns">
          <button class="ai-action-btn ai-action-accept" onclick="acceptAiAction(${idx})">✓ Thêm</button>
          <button class="ai-action-btn ai-action-reject" onclick="rejectAiAction(${idx})">✗</button>
        </div>
      </div>`;
  }

  if (a.tool === 'add_milestone') {
    const goalTitle = goalTitleCache[a.args.goalId] || 'Goal';
    return `
      <div class="ai-action-card" id="ai-action-${idx}">
        <div class="ai-action-icon">🎯</div>
        <div class="ai-action-body">
          <div class="ai-action-title">Thêm milestone vào "${esc(goalTitle)}"</div>
          <div class="ai-action-desc">${esc(a.args.text)}${a.args.date ? ` · ${fmtD(a.args.date)}` : ''}</div>
        </div>
        <div class="ai-action-btns">
          <button class="ai-action-btn ai-action-accept" onclick="acceptAiAction(${idx})">✓ Thêm</button>
          <button class="ai-action-btn ai-action-reject" onclick="rejectAiAction(${idx})">✗</button>
        </div>
      </div>`;
  }

  return '';
}

async function acceptAiAction(idx) {
  const a = pendingAiActions[idx];
  if (!a) return;

  try {
    if (a.tool === 'add_task') {
      const data = await getWeek(weekOffset);
      const q = a.args.quadrant;
      if (!data[q]) data[q] = [];

      data[q].push({
        text: a.args.text,
        hours: parseFloat(a.args.hours) || 0,
        date: '',
        done: false,
        gcal: false,
        goalId: a.args.goalId || null,
        created: Date.now()
      });

      await setWeek(weekOffset, data);
      invalidateWeeksCache();
      renderTasks();
      toast('✓ Đã thêm task: ' + a.args.text);
    } else if (a.tool === 'add_milestone') {
      const ref = col('goals').doc(a.args.goalId);
      const d = await ref.get();
      if (!d.exists) {
        toast('⚠️ Không tìm thấy Goal này');
        return;
      }

      const g = d.data();
      const ms = g.milestones || [];
      ms.push({ text: a.args.text, date: a.args.date || '', done: false });
      await ref.update({ milestones: ms });
      invalidateWeeksCache();
      renderGoals();
      toast('✓ Đã thêm milestone vào: ' + (g.title || 'Goal'));
    }
  } catch (e) {
    console.error('Lỗi thực thi AI action:', e);
    toast('⚠️ Có lỗi khi thêm: ' + e.message);
  }

  document.getElementById('ai-action-' + idx)?.remove();
}

function rejectAiAction(idx) {
  document.getElementById('ai-action-' + idx)?.remove();
}
