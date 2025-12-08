import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔵 [CONVERT] ===== BẮT ĐẦU XỬ LÝ =====');
    
    const {
  extractedText,
  teacherId,
  subject,
  grade,
  fileName,
  spreadsheetId,   // ➜ thêm dòng này
  mode,            // tùy, nếu muốn chọn append/replace
} = await req.json();

if (!spreadsheetId) {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Missing spreadsheetId – cần ID của sheet hiện tại để update',
    }),
    { status: 400, headers: corsHeaders }
  );
}

    console.log('📊 [CONVERT] Request:', { textLength: extractedText?.length, teacherId, subject, grade, fileName });

    if (!extractedText || extractedText.trim().length < 10) {
      throw new Error('Text trống hoặc quá ngắn');
    }

    // Get prompt from database based on subject
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: promptData } = await supabase
      .from('system_prompts')
      .select('prompt_content')
      .eq('prompt_type', 'code_function')
      .eq('function_name', 'convert-file-to-sheet')
      .eq('is_active', true)
      .ilike('name', `%${subject}%`)
      .single();

    const systemPrompt = promptData?.prompt_content || `Bạn là trợ lý AI chuyên TRÍCH XUẤT VÀ TẠO CÂU HỎI THI cho môn ${subject}.

Nhiệm vụ:
1. Đọc nội dung tài liệu được cung cấp
2. Kiểm tra xem nội dung có phù hợp với môn ${subject} không
3. Nếu KHÔNG phù hợp, trả về: {"error": "Tài liệu không phù hợp với môn ${subject}"}
4. Nếu phù hợp, tách các câu hỏi có sẵn hoặc tự tạo 3-5 câu hỏi CHẤT LƯỢNG CAO

YÊU CẦU:
- Câu hỏi phải BÁM SÁT nội dung thật trong text
- KHÔNG được tự bịa hoặc thêm thông tin không có
- Câu hỏi phải logic và phù hợp với ${subject}
- 70% trắc nghiệm, 30% tự luận
- Đáp án phải chính xác

Format trả về:
{
  "questions": [
    {
      "question_text": "...",
      "question_type": "multiple_choice" hoặc "essay",
      "option_A": "...",
      "option_B": "...",
      "option_C": "...",
      "option_D": "...",
      "correct_answer": "A|B|C|D" hoặc "",
      "note": "Gợi ý đáp án cho câu tự luận"
    }
  ]
}`;

    // Check OpenAI API key
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('📝 [CONVERT] Text preview (500 chars):', extractedText.slice(0, 500));

    // ========== SINH CÂU HỎI BẰNG GPT ==========
    console.log('🔵 [CONVERT] ===== SINH CÂU HỎI =====');

    // Chia text thành chunks (3000 ký tự)
    const chunkSize = 3000;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += chunkSize) {
      chunks.push(extractedText.slice(i, i + chunkSize));
    }
    console.log('📊 [CONVERT] Số chunks:', chunks.length);

    let allQuestions: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`🔵 [CONVERT] Xử lý chunk ${i + 1}/${chunks.length}...`);

      const prompt = `${systemPrompt}

Nội dung chunk ${i + 1}/${chunks.length} từ file "${fileName}":
"""
${chunk}
"""

Chỉ trả về JSON hợp lệ dạng:
{ "questions": [ { ... }, ... ] }

Nếu tài liệu không phù hợp với môn ${subject}, trả về:
{ "error": "Tài liệu không phù hợp với môn ${subject}" }`;

      try {
        const generateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Bạn là trợ lý chuyên phân tích đề thi. Bạn PHẢI bám sát nội dung được cung cấp, KHÔNG được tự bịa thông tin.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 2500
          })
        });

        if (!generateResponse.ok) {
          const errorText = await generateResponse.text();
          console.error(`❌ [CONVERT] GPT error chunk ${i + 1}:`, errorText);
          
          if (generateResponse.status === 429) {
            const waitTime = Math.pow(2, i) * 1000;
            console.log(`⏳ [CONVERT] Rate limit, đợi ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          continue;
        }

        const generateResult = await generateResponse.json();
        const content = generateResult.choices[0]?.message?.content || '';
        
        // Parse JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.warn(`⚠️ [CONVERT] Chunk ${i + 1} không trả về JSON hợp lệ`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        
        // Kiểm tra lỗi môn học không phù hợp
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        
        if (parsed.questions && Array.isArray(parsed.questions)) {
          allQuestions = allQuestions.concat(parsed.questions);
          console.log(`✅ [CONVERT] Chunk ${i + 1} trả về ${parsed.questions.length} câu hỏi`);
        }
      } catch (e: any) {
        // Nếu là lỗi môn học không phù hợp, throw ngay
        if (e.message && e.message.includes('không phù hợp')) {
          throw e;
        }
        console.error(`❌ [CONVERT] Error chunk ${i + 1}:`, e);
      }
    }

    console.log('📊 [CONVERT] Tổng số câu hỏi:', allQuestions.length);

    if (allQuestions.length === 0) {
  throw new Error('Không tạo được câu hỏi nào từ nội dung này');
}

// 🔧 CHUẨN HOÁ CÂU HỎI: option_A/B/C/D ➜ options[], MC/TL ➜ question_type
const normalizedQuestions = allQuestions.map((q: any) => {
  const rawType = (q.question_type || '').toString().trim().toLowerCase();
  const isEssay =
    rawType.includes('essay') || rawType.includes('tự luận');

  const question_type: 'multiple_choice' | 'essay' =
    isEssay ? 'essay' : 'multiple_choice';

  const question_text = (q.question_text || '').toString().trim();

  const options =
    question_type === 'multiple_choice'
      ? [
          q.option_A || q.option_a || '',
          q.option_B || q.option_b || '',
          q.option_C || q.option_c || '',
          q.option_D || q.option_d || '',
        ].filter((opt: string) => opt && opt.trim() !== '')
      : [];

  const correct_answer =
    question_type === 'multiple_choice'
      ? (q.correct_answer || '').toString().trim()
      : '';

  return {
    question_text,
    question_type,
    options,
    correct_answer,
  };
});

console.log(
  '📊 [CONVERT] Sau chuẩn hóa còn',
  normalizedQuestions.length,
  'câu hỏi hợp lệ'
);
if (!supabaseUrl) {
  throw new Error('SUPABASE_URL env missing');
}

console.log(
  '🔵 [CONVERT] Gọi update-sheet-questions để ghi vào sheet hiện tại...',
  spreadsheetId
);

const updateRes = await fetch(
  `${supabaseUrl}/functions/v1/update-sheet-questions`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      spreadsheetId,
      questions: normalizedQuestions,
      subject,
      grade,
      fileName,
      mode: mode || 'append', // hoặc 'replace' tuỳ anh thiết kế trong update-sheet-questions.ts
    }),
  }
);

const updateText = await updateRes.text();
let updateJson: any;
try {
  updateJson = JSON.parse(updateText);
} catch {
  throw new Error(
    'update-sheet-questions trả về dữ liệu không phải JSON: ' +
      updateText.slice(0, 500)
  );
}

if (!updateRes.ok || !updateJson.success) {
  throw new Error(
    'Không thể ghi câu hỏi lên Google Sheet: ' +
      (updateJson.error || updateText.slice(0, 500))
  );
}

const totalQuestions =
  updateJson.totalQuestions ?? normalizedQuestions.length;

console.log(
  '✅ [CONVERT] Đã update lên sheet hiện tại. Tổng số câu hỏi:',
  totalQuestions
);

    console.log('✅ [CONVERT] ===== HOÀN TẤT =====');

    return new Response(
  JSON.stringify({
    success: true,
    spreadsheetId,
    totalQuestions,
  }),
  {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  }
);

  } catch (error: any) {
    console.error('❌ [CONVERT] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
        details: error.stack || ''
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});