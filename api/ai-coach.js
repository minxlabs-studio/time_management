export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, context, goalsBrief } = req.body || {};

  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // ── Định nghĩa các "tools" mà AI có thể đề xuất gọi.
  // QUAN TRỌNG: backend KHÔNG tự thực thi các tool này — chỉ trích xuất lời gọi
  // và trả về cho frontend dưới dạng đề xuất. User phải bấm xác nhận từng cái
  // thì app mới thực sự ghi vào Firestore. AI không có quyền tự sửa dữ liệu.
  const tools = [
    {
      type: 'function',
      name: 'add_task',
      description: 'Đề xuất thêm một task mới vào 1 trong 4 ô của Ma trận Eisenhower trong tuần hiện tại.',
      parameters: {
        type: 'object',
        properties: {
          quadrant: { type: 'string', enum: ['q1', 'q2', 'q3', 'q4'], description: 'q1=Khẩn&QT, q2=QT chưa khẩn, q3=Khẩn không QT, q4=Sao nhãng' },
          text: { type: 'string', description: 'Nội dung task' },
          hours: { type: 'number', description: 'Số giờ ước tính, có thể để 0 nếu không rõ' },
          goalId: { type: 'string', description: 'ID của Goal liên quan nếu có, để trống nếu không' }
        },
        required: ['quadrant', 'text']
      }
    },
    {
      type: 'function',
      name: 'add_milestone',
      description: 'Đề xuất thêm một milestone (mốc tiến độ) vào một Big Goal đã có, dùng khi cần breakdown goal thành các bước nhỏ.',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string', description: 'ID của Goal cần thêm milestone' },
          text: { type: 'string', description: 'Nội dung milestone' },
          date: { type: 'string', description: 'Ngày dự kiến hoàn thành, format YYYY-MM-DD, để trống nếu chưa rõ' }
        },
        required: ['goalId', 'text']
      }
    }
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
        tools,
        input: [
          {
            role: 'system',
            content:
              'Bạn là AI Coach chuyên về Lý Thuyết Quản Lý Thời Gian Chủ Đích (Đá Trước, Cát Sau). Nguyên lý: Ma trận Eisenhower (Ô 1-4), Tam Giác Hiệu Suất (Thời gian + Tập trung + Năng lượng), Đầu tư Ô 2 để giảm Ô 1. Trả lời tiếng Việt, súc tích, thực tiễn, dưới 300 từ. ' +
              'Nếu phù hợp, bạn CÓ THỂ đề xuất hành động cụ thể bằng cách gọi các tool add_task hoặc add_milestone — nhưng đây chỉ là ĐỀ XUẤT, người dùng sẽ tự xác nhận trước khi thêm vào hệ thống. Chỉ đề xuất tool khi câu hỏi thực sự cần hành động (ví dụ: "giúp tôi chia nhỏ goal X", "tôi nên làm gì tuần này"), không đề xuất tool cho câu hỏi chỉ cần tư vấn/giải thích thông thường. Khi đề xuất add_milestone, dùng đúng goalId được cung cấp trong dữ liệu GOALS_META, không tự bịa ID.' +
              (goalsBrief ? `\n\nGOALS_META (id thật để dùng khi gọi add_milestone): ${goalsBrief}` : '')
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

    const outputItems = data.output || [];

    const text =
      data.output_text ||
      outputItems
        .flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text)
        .join('') ||
      '';

    // Trích xuất các lời gọi tool (function_call) mà AI đề xuất — KHÔNG thực thi ở đây.
    const actions = outputItems
      .filter(item => item.type === 'function_call')
      .map(item => {
        let args = {};
        try { args = JSON.parse(item.arguments || '{}'); } catch (_) { args = {}; }
        return { tool: item.name, args };
      });

    return res.status(200).json({
      text: text || (actions.length ? '' : 'Không có phản hồi.'),
      actions
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
