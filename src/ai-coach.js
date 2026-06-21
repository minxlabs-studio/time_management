// ── AI COACH ─────────────────────────
// This file is prepared for the split-file refactor.
// For now, keep these functions global because index.html uses inline onclick handlers.

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

  try {
    const weekData = await getWeek(weekOffset);
    const goalsSnap = await col('goals').limit(10).get();
    const goals = goalsSnap.docs.map(d => d.data());

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

    const r = await fetch('/api/ai-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: ctx
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

    res.textContent = data.text || 'Không có phản hồi.';
  } catch (e) {
    console.error('AI fetch failed:', e);
    res.textContent = 'Lỗi kết nối AI: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Hỏi ↗';
  }
}
