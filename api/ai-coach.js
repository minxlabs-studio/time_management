export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, context } = req.body || {};

  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.2-mini',
        input: [
          {
            role: 'system',
            content:
              'Bạn là AI Coach chuyên về Lý Thuyết Quản Lý Thời Gian Chủ Đích (Đá Trước, Cát Sau). Nguyên lý: Ma trận Eisenhower (Ô 1-4), Tam Giác Hiệu Suất (Thời gian + Tập trung + Năng lượng), Đầu tư Ô 2 để giảm Ô 1. Trả lời tiếng Việt, súc tích, thực tiễn, dưới 300 từ, đề xuất hành động cụ thể.'
          },
          {
            role: 'user',
            content: `${context || ''}\n\nCâu hỏi: ${question}`
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'OpenAI API error'
      });
    }

    const text =
      data.output_text ||
      data.output
        ?.flatMap(item => item.content || [])
        ?.filter(item => item.type === 'output_text')
        ?.map(item => item.text)
        ?.join('') ||
      'Không có phản hồi.';

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
