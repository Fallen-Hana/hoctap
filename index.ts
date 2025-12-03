import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔵 [CONVERT] ===== BẮT ĐẦU XỬ LÝ =====');
    
    const { extractedText, teacherId, subject, grade, fileName } = await req.json();
    console.log('📊 [CONVERT] Request:', { textLength: extractedText?.length, teacherId, subject, grade, fileName });

    if (!extractedText || extractedText.trim().length < 10) {
      throw new Error('Text trống hoặc quá ngắn');
    }

    // Check OpenAI API key
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OpenAI API key not configured');
    }
    console.log('✅ [CONVERT] OpenAI API key found');

    // Check Google credentials
    const googleAccessToken = Deno.env.get('GOOGLE_ACCESS_TOKEN');
    const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const targetFolderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID') || '';

    console.log('📊 [CONVERT] Google credentials check:', {
      hasAccessToken: !!googleAccessToken,
      hasRefreshToken: !!googleRefreshToken,
      hasClientId: !!googleClientId,
      hasClientSecret: !!googleClientSecret
    });

    if (!googleAccessToken && !googleRefreshToken) {
      throw new Error('Google API credentials not configured. Cần cấu hình GOOGLE_ACCESS_TOKEN hoặc GOOGLE_REFRESH_TOKEN trong Supabase Secrets.');
    }
    console.log('✅ [CONVERT] Google credentials found');

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

      const prompt = `
Bạn là trợ lý AI chuyên TRÍCH XUẤT VÀ TẠO CÂU HỎI từ nội dung bên dưới, bao gồm:
- Văn bản (docx/pdf),
- Bảng dữ liệu (xlsx),
- Danh sách,
- Đoạn mô tả bất kỳ.

NHIỆM VỤ CHÍNH:
1. Nếu đoạn có các câu hỏi sẵn (trắc nghiệm hoặc tự luận) → hãy TÁCH tất cả những câu hỏi đó ra.
2. Nếu đoạn là VĂN BẢN MÔ TẢ → hãy TỰ TẠO 3–5 câu hỏi phù hợp với nội dung.
3. Nếu đoạn là BẢNG DỮ LIỆU (ví dụ: danh sách học sinh gồm STT, tên, MSSV, lớp, điểm danh…) → PHẢI TẠO CÂU HỎI LOẠI “ĐỌC HIỂU BẢNG”, ví dụ:
   - “Có bao nhiêu học sinh thuộc lớp PC2111?”
   - “Ai là GVCN của lớp PC2112?”
   - “Sinh viên nào có MSSV TH09066?”
   - “Số điện thoại của học sinh Phạm Minh Khang là gì?”
   - “Trong bảng có bao nhiêu người có mail gmail.com?”
   → Luôn tạo ít nhất 3–5 câu hỏi dựa trên bảng.

YÊU CẦU QUAN TRỌNG:
- KHÔNG được bịa thông tin ngoài dữ liệu đã có.
- Được phép tổng hợp (tính số lượng, đếm số dòng, lọc tên…).
- KHÔNG được trả về { "questions": [] } trừ khi dữ liệu rỗng (< 20 ký tự).
- Nhất định phải có câu hỏi trắc nghiệm (4 đáp án) nếu dữ liệu cho phép.

FORMAT TRẢ VỀ PHẢI LÀ JSON THUẦN:
{
  "questions": [
    {
      "question_text": "...",
      "option_A": "...",
      "option_B": "...",
      "option_C": "...",
      "option_D": "...",
      "correct_answer": "A" | "B" | "C" | "D" | "",
      "skill": "",
      "difficulty": "easy" | "medium" | "hard",
      "note": ""
    }
  ]
}

DỮ LIỆU CẦN XỬ LÝ (chunk ${i + 1}/${chunks.length}, file ${fileName}):
"""
${chunk}
"""
`;

      try {
        const generateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o',
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
          
          // Retry với exponential backoff nếu gặp rate limit
          if (generateResponse.status === 429) {
            const waitTime = Math.pow(2, i) * 1000; // 1s, 2s, 4s, 8s...
            console.log(`⏳ [CONVERT] Rate limit, đợi ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw new Error(`GPT_ERROR: ${errorText}`);

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
        if (parsed.questions && Array.isArray(parsed.questions)) {
          allQuestions = allQuestions.concat(parsed.questions);
          console.log(`✅ [CONVERT] Chunk ${i + 1} trả về ${parsed.questions.length} câu hỏi`);
        }
      } catch (e) {
        console.error(`❌ [CONVERT] Error chunk ${i + 1}:`, e);
      }
    }

    console.log('📊 [CONVERT] Tổng số câu hỏi:', allQuestions.length);

    if (allQuestions.length === 0) {
      throw new Error('Không tạo được câu hỏi nào từ nội dung này');
    }

    // ========== TẠO GOOGLE SHEET ==========
    console.log('🔵 [CONVERT] ===== TẠO GOOGLE SHEET =====');

    // Get access token (refresh if needed)
    let token = googleAccessToken;
    if (!token && googleRefreshToken) {
      console.log('🔵 [CONVERT] Refreshing Google token...');
      
      if (!googleClientId || !googleClientSecret) {
        throw new Error('Thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET để refresh token');
      }
      
      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          refresh_token: googleRefreshToken,
          grant_type: 'refresh_token'
        })
      });

      console.log('📊 [CONVERT] Refresh token response status:', refreshResponse.status);

      if (!refreshResponse.ok) {
        const errorText = await refreshResponse.text();
        console.error('❌ [CONVERT] Refresh token error:', errorText);
        throw new Error(`Failed to refresh Google token (Status: ${refreshResponse.status})`);
      }

      const refreshData = await refreshResponse.json();
      token = refreshData.access_token;
      console.log('✅ [CONVERT] Token refreshed successfully');
    }

    if (!token) {
      throw new Error('Không có Google Access Token. Vui lòng cấu hình GOOGLE_ACCESS_TOKEN hoặc GOOGLE_REFRESH_TOKEN.');
    }

    // Create spreadsheet
    const title = `Exam_${subject}_${grade}_${Date.now()}`;
    console.log('🔵 [CONVERT] Tạo spreadsheet:', title);

    const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [{ properties: { title: 'Sheet1' } }]
      })
    });

    console.log('📊 [CONVERT] Create response status:', createResponse.status);
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ [CONVERT] Create sheet error status:', createResponse.status);
      console.error('❌ [CONVERT] Create sheet error body:', errorText);
      
      // Parse error để hiển thị chi tiết hơn
      let errorMessage = 'Failed to create Google Sheet';
      let errorDetails = '';
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorMessage;
          errorDetails = JSON.stringify(errorJson.error, null, 2);
          console.error('❌ [CONVERT] Google API error:', errorJson.error);
          
          // Kiểm tra các lỗi phổ biến
          if (errorJson.error.code === 401) {
            errorMessage = 'Google Access Token không hợp lệ hoặc đã hết hạn. Vui lòng cấu hình lại GOOGLE_ACCESS_TOKEN hoặc GOOGLE_REFRESH_TOKEN.';
          } else if (errorJson.error.code === 403) {
            errorMessage = 'Không có quyền truy cập Google Sheets API. Vui lòng kiểm tra:\n1. Google Sheets API đã được enable chưa?\n2. Token có đúng scope không?\n3. Service Account có quyền tạo file không?';
          }
        }
      } catch (e) {
        // Không parse được JSON, dùng text gốc
        errorDetails = errorText;
      }
      
      throw new Error(`${errorMessage}\n\nChi tiết: ${errorDetails}\n\nStatus: ${createResponse.status}`);
    }

    const createData = await createResponse.json();
    const spreadsheetId = createData.spreadsheetId;
    console.log('✅ [CONVERT] Spreadsheet created:', spreadsheetId);

    // Move to folder (if configured)
    if (targetFolderId) {
      try {
        console.log('🔵 [CONVERT] Moving to folder:', targetFolderId);
        const moveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${targetFolderId}&fields=id,parents`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (moveResponse.ok) {
          console.log('✅ [CONVERT] Moved to folder successfully');
        } else {
          const errorText = await moveResponse.text();
          console.warn('⚠️ [CONVERT] Could not move to folder:', errorText);
        }
      } catch (e) {
        console.warn('⚠️ [CONVERT] Could not move to folder:', e);
      }
    }

    // Write data to sheet
    const values = [
      ['question_text', 'option_A', 'option_B', 'option_C', 'option_D', 'correct_answer', 'skill', 'difficulty', 'note']
    ];

    for (const q of allQuestions) {
      values.push([
        q.question_text || '',
        q.option_A || '',
        q.option_B || '',
        q.option_C || '',
        q.option_D || '',
        q.correct_answer || '',
        q.skill || '',
        q.difficulty || 'medium',
        q.note || ''
      ]);
    }

    console.log('🔵 [CONVERT] Ghi dữ liệu vào sheet...');
    const updateResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:I${values.length}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    console.log('📊 [CONVERT] Update response status:', updateResponse.status);

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ [CONVERT] Update sheet error status:', updateResponse.status);
      console.error('❌ [CONVERT] Update sheet error body:', errorText);
      throw new Error(`Failed to write data to Google Sheet (Status: ${updateResponse.status})`);
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;
    console.log('✅ [CONVERT] ===== HOÀN TẤT =====');
    console.log('📊 [CONVERT] Sheet URL:', sheetUrl);
    console.log('📊 [CONVERT] Tổng số câu hỏi:', allQuestions.length);

    return new Response(
      JSON.stringify({
        success: true,
        sheetUrl,
        spreadsheetId,
        totalQuestions: allQuestions.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
