import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface IncomingQuestion {
  question_text: string;
  question_type: 'multiple_choice' | 'essay';
  options?: string[];
  correct_answer?: string;
  ai_note?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔵 [UPDATE-SHEET] ===== BẮT ĐẦU =====');

    const {
      spreadsheetId,
      questions,
      extractedText,
      subject,
      grade,
      fileName,
    } = await req.json();

    console.log('📥 [UPDATE-SHEET] Request body:', {
      spreadsheetId,
      hasQuestions: Array.isArray(questions) ? questions.length : 0,
      hasExtractedText: !!extractedText,
      subject,
      grade,
      fileName,
    });

    if (!spreadsheetId) {
      throw new Error('Thiếu spreadsheetId');
    }

    // ===== 1. Lấy Google access_token từ refresh_token =====
    const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!googleRefreshToken || !googleClientId || !googleClientSecret) {
      throw new Error('Chưa cấu hình GOOGLE_REFRESH_TOKEN / CLIENT_ID / CLIENT_SECRET');
    }

    console.log('🔑 [UPDATE-SHEET] Refresh Google access_token...');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: googleRefreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('❌ [UPDATE-SHEET] Failed to refresh token:', errText);
      throw new Error('Không thể refresh Google token: ' + errText);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token as string | undefined;

    if (!accessToken) {
      console.error(
        '❌ [UPDATE-SHEET] No access_token in token response:',
        tokenJson,
      );
      throw new Error('Không nhận được access_token từ Google');
    }

    console.log('✅ [UPDATE-SHEET] Got access_token.');

    // ===== 2. Chuẩn bị danh sách câu hỏi sẽ ghi lên Sheet =====
    let questionsToAdd: IncomingQuestion[] = [];

    if (Array.isArray(questions) && questions.length > 0) {
      // Trường hợp FE gửi full list câu hỏi (auto-save, chỉnh sửa / xoá trên UI)
      console.log(
        `📝 [UPDATE-SHEET] Sử dụng ${questions.length} câu hỏi từ frontend.`,
      );
      questionsToAdd = questions as IncomingQuestion[];
    } else if (typeof extractedText === 'string' && extractedText.trim()) {
      // Trường hợp convert từ file: dùng AI sinh câu hỏi
      console.log(
        '🧠 [UPDATE-SHEET] Không có questions, sử dụng extractedText để nhờ AI sinh câu hỏi...',
      );

      const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiApiKey) {
        throw new Error('Thiếu OPENAI_API_KEY trong ENV');
      }

      const prompt = `
Bạn là hệ thống tạo câu hỏi trắc nghiệm cho học sinh phổ thông.

Nhiệm vụ:
- Đọc nội dung đề bài / tài liệu dưới đây.
- Sinh ra danh sách câu hỏi trắc nghiệm và/hoặc tự luận.
- Trả về JSON với đúng cấu trúc:

{
  "questions": [
    {
      "question_text": "chuỗi",
      "question_type": "multiple_choice" | "essay",
      "options": ["A", "B", "C", "D"], // nếu là trắc nghiệm
      "correct_answer": "A",            // nếu là trắc nghiệm
      "ai_note": "ghi chú thêm nếu có"
    }
  ]
}

Lưu ý:
- Nếu là câu hỏi tự luận, đặt "question_type": "essay" và "options": [], "correct_answer": "".
- Không trả thêm key nào khác ngoài những key trên.
- Không trả lời giải thích dài dòng, chỉ trả JSON.

Dữ liệu gốc (tên file: ${fileName || 'N/A'}, môn: ${
        subject || 'Chưa rõ'
      }, khối: ${grade || 'Chưa rõ'}):
----------------
${extractedText}
----------------
`.trim();

      console.log('🧠 [UPDATE-SHEET] Gửi prompt đến OpenAI...');
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'Bạn là hệ thống tạo câu hỏi trắc nghiệm, chỉ trả về JSON hợp lệ.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error('❌ [UPDATE-SHEET] OpenAI error:', errText);
        throw new Error('Lỗi khi gọi OpenAI: ' + errText);
      }

      const aiJson = await aiRes.json();
      const rawContent =
        aiJson.choices?.[0]?.message?.content || aiJson.choices?.[0]?.message;

      console.log(
        '🧠 [UPDATE-SHEET] OpenAI raw response (preview):',
        rawContent,
      );

      let parsed: any = null;

      try {
        if (typeof rawContent === 'string') {
          parsed = JSON.parse(rawContent);
        } else if (typeof rawContent === 'object' && rawContent.content) {
          parsed = JSON.parse(rawContent.content);
        } else {
          throw new Error('Không xác định được content trong OpenAI response');
        }
      } catch (parseErr) {
        console.error('❌ [UPDATE-SHEET] Lỗi parse JSON từ OpenAI:', parseErr);
        throw new Error(
          'OpenAI trả về định dạng không phải JSON hợp lệ, không thể parse.',
        );
      }

      if (!parsed || !Array.isArray(parsed.questions)) {
        console.error(
          '❌ [UPDATE-SHEET] JSON từ OpenAI không có mảng questions:',
          parsed,
        );
        throw new Error(
          'Kết quả từ OpenAI không chứa mảng questions như mong đợi.',
        );
      }

      questionsToAdd = parsed.questions as IncomingQuestion[];
      console.log(
        `🧠 [UPDATE-SHEET] Đã sinh được ${questionsToAdd.length} câu hỏi từ AI.`,
      );
    } else {
      throw new Error(
        'Thiếu dữ liệu: cần truyền "questions" (từ frontend) hoặc "extractedText" (từ file).',
      );
    }

    if (!questionsToAdd.length) {
      throw new Error('Danh sách câu hỏi trống, không có gì để ghi lên Sheet.');
    }

    // =====================================================================
    // 3. Tách 2 MODE:
    //    - MODE A: FE auto-save → chỉ có questions (không có extractedText)
    //              ⇒ GHI ĐÈ TOÀN BỘ nội dung câu hỏi trong sheet (sync 1-1)
    //    - MODE B: Import từ file (có extractedText) ⇒ APPEND thêm câu hỏi mới
    // =====================================================================

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase =
      supabaseUrl && supabaseKey
        ? createClient(supabaseUrl, supabaseKey)
        : null;

    const isFullSyncFromFrontend =
      Array.isArray(questions) && questions.length > 0 && !extractedText;

    let totalQuestions = 0;

    if (isFullSyncFromFrontend) {
      // ==========================
      // MODE A: FULL SYNC (REPLACE)
      // ==========================
      console.log(
        '📝 [UPDATE-SHEET] MODE A: Full sync từ frontend, ghi đè toàn bộ câu hỏi.',
      );

      // Chuẩn bị dữ liệu mới (STT 1..n)
      const newRows = questionsToAdd.map((q, idx) => {
      const isMC = q.question_type === 'multiple_choice';

      return [
        (idx + 1).toString(),                 // A - STT
        isMC ? 'TN' : 'TL',                   // B - Loại (TN/TL)
        isMC ? (q.options?.[0] || '') : '',   // C - Phương án A
        isMC ? (q.options?.[1] || '') : '',   // D - Phương án B
        isMC ? (q.options?.[2] || '') : '',   // E - Phương án C
        isMC ? (q.options?.[3] || '') : '',   // F - Phương án D
        isMC ? (q.correct_answer || '') : '', // G - Đáp án đúng
        !isMC ? (q.question_text || '') : '', // H - Question_text (chỉ cho TL)
      ];
    });

      // 3A.1 Clear toàn bộ vùng câu hỏi cũ (A2:H1000)
      console.log('🧹 [UPDATE-SHEET] Clear vùng Câu hỏi!A2:H1000...');
      const clearRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Câu hỏi!A2:H1000:clear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!clearRes.ok) {
        const errText = await clearRes.text();
        console.warn(
          '⚠️ [UPDATE-SHEET] Clear range error (không fatal):',
          errText,
        );
      }

      // 3A.2 Ghi lại toàn bộ danh sách mới (bắt đầu từ A2)
      console.log(
        `✏️ [UPDATE-SHEET] Ghi ${newRows.length} dòng mới (ghi đè)...`,
      );
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Câu hỏi!A2:H?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: newRows }),
        },
      );

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        console.error('❌ [UPDATE-SHEET] Error khi ghi đè:', errText);
        throw new Error('Failed to overwrite Google Sheet');
      }

      totalQuestions = newRows.length;
      console.log(
        `✅ [UPDATE-SHEET] Full sync xong, tổng số câu hỏi: ${totalQuestions}`,
      );

      // 3A.3 Cập nhật exams.total_questions theo google_sheet_id
      if (supabase) {
        try {
          const { data: examRow, error: examErr } = await supabase
            .from('exams')
            .select('id, total_questions')
            .eq('google_sheet_id', spreadsheetId)
            .maybeSingle();

          if (!examErr && examRow) {
            await supabase
              .from('exams')
              .update({ total_questions: totalQuestions })
              .eq('id', examRow.id);

            console.log(
              '✅ [UPDATE-SHEET] Đã sync exams.total_questions (FULL SYNC)',
            );
          } else {
            console.log(
              'ℹ️ [UPDATE-SHEET] Không tìm thấy exam để sync total_questions (FULL SYNC).',
            );
          }
        } catch (e) {
          console.warn(
            '⚠️ [UPDATE-SHEET] Lỗi khi update exams.total_questions (FULL SYNC):',
            e,
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'full_sync',
          addedQuestions: newRows.length,
          totalQuestions,
          message: `Đã đồng bộ ${newRows.length} câu hỏi lên Google Sheet (ghi đè).`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // ==========================
    // MODE B: APPEND (IMPORT FILE)
    // ==========================
    console.log(
      '📝 [UPDATE-SHEET] MODE B: Import / append câu hỏi mới (từ file hoặc AI).',
    );

    console.log('📖 [UPDATE-SHEET] Đọc dữ liệu hiện tại từ sheet "Câu hỏi"...');
    const readResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Câu hỏi!A1:H1000`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    let existingRows: string[][] = [];
    if (readResponse.ok) {
      const readData = await readResponse.json();
      existingRows = (readData.values || []) as string[][];
      console.log(
        `✅ [UPDATE-SHEET] Đã đọc ${existingRows.length} dòng hiện tại`,
      );
    } else {
      console.warn(
        '⚠️ [UPDATE-SHEET] Không đọc được dữ liệu cũ, vẫn tiếp tục append.',
      );
    }

    // existingRows[0] là header → số câu hiện có = existingRows.length - 1 (nếu có header)
    const currentQuestionCount =
      existingRows.length > 0 ? existingRows.length - 1 : 0;

    const newRows = questionsToAdd.map((q: any, idx: number) => {
      const isMC = q.question_type === 'multiple_choice';

      return [
        (currentQuestionCount + idx + 1).toString(), // A - STT nối tiếp
        isMC ? 'TN' : 'TL',                           // B - Loại (TN/TL)
        isMC ? (q.options?.[0] || '') : '',           // C - A
        isMC ? (q.options?.[1] || '') : '',           // D - B
        isMC ? (q.options?.[2] || '') : '',           // E - C
        isMC ? (q.options?.[3] || '') : '',           // F - D
        isMC ? (q.correct_answer || '') : '',         // G - Đáp án đúng
        !isMC ? (q.question_text || '') : '',         // H - Question_text (chỉ TL)
      ];
    });

    console.log(
      `📝 [UPDATE-SHEET] Append thêm ${newRows.length} câu hỏi mới...`,
    );

    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Câu hỏi!A${
        existingRows.length + 1
      }:H${existingRows.length + newRows.length}:append?valueInputOption=RAW`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: newRows }),
      }
    );

    if (!appendResponse.ok) {
      const errorText = await appendResponse.text();
      console.error('❌ [UPDATE-SHEET] Error append:', errorText);
      throw new Error('Failed to update Google Sheet (append)');
    }

    totalQuestions = currentQuestionCount + newRows.length;
    console.log(
      `✅ [UPDATE-SHEET] Append xong. Tổng số câu hỏi mới: ${totalQuestions}`,
    );

    // Cập nhật exams.total_questions nếu có exam dùng sheet này
    if (supabase) {
      try {
        const { data: examRow, error: examErr } = await supabase
          .from('exams')
          .select('id, total_questions')
          .eq('google_sheet_id', spreadsheetId)
          .maybeSingle();

        if (!examErr && examRow) {
          await supabase
            .from('exams')
            .update({ total_questions: totalQuestions })
            .eq('id', examRow.id);

          console.log(
            '✅ [UPDATE-SHEET] Đã sync exams.total_questions (APPEND).',
          );
        } else {
          console.log(
            'ℹ️ [UPDATE-SHEET] Không tìm thấy exam để sync total_questions (APPEND).',
          );
        }
      } catch (e) {
        console.warn(
          '⚠️ [UPDATE-SHEET] Lỗi khi update exams.total_questions (APPEND):',
          e,
        );
      }
    }

    console.log('✅ [UPDATE-SHEET] ===== HOÀN TẤT =====');

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'append',
        addedQuestions: newRows.length,
        totalQuestions,
        message: `Đã thêm ${newRows.length} câu hỏi vào bài kiểm tra (tổng: ${totalQuestions}).`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    console.error('❌ [UPDATE-SHEET] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
