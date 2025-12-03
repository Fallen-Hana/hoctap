import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

import XLSX from 'npm:xlsx@0.18.5';
import { PDFParse } from 'npm:pdf-parse@2.0.1';
import { Buffer } from 'node:buffer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔵 [CONVERT] Nhận request convert-file-to-sheet');

    const url = new URL(req.url);
    const path = url.pathname;
    if (path !== '/functions/v1/convert-file-to-sheet') {
      console.log('❌ [CONVERT] Sai path:', path);
      return new Response('Not found', {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { extractedText: clientExtractedText, teacherId, subject, grade, fileName, fileType, fileBase64 } =
      await req.json();

    console.log('📊 [CONVERT] Request:', {
      textLength: clientExtractedText?.length,
      teacherId,
      subject,
      grade,
      fileName,
      fileType,
      hasFileBase64: !!fileBase64,
    });

    let extractedText: string = clientExtractedText || '';

    // Nếu text đã có đủ (client gửi lên) thì giữ nguyên.
    // Chỉ khi text trống / quá ngắn mà vẫn có fileBase64 + fileType (thường là PDF/XLSX)
    if ((!extractedText || extractedText.trim().length < 10) && fileBase64 && fileType) {
      console.log(
        '🔵 [CONVERT] Text trống/ít. Thử TRÍCH LẠI từ fileBase64 trên server. Loại file:',
        fileType,
      );

      const binaryString = atob(fileBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      if (fileType === 'xlsx' || fileType === 'xls') {
        console.log('🔵 [CONVERT] Excel -> xlsx (server-side bằng xlsx giống convert.js)');
        const workbook = XLSX.read(bytes, { type: 'array' });
        const parts: string[] = [];

        workbook.SheetNames.forEach((sheetName: string) => {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) return;

          const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          parts.push(`=== Sheet: ${sheetName} ===`);
          for (const row of rows) {
            const rowText = row.map((cell) => (cell != null ? String(cell) : '')).join(',');
            if (rowText.trim()) {
              parts.push(rowText);
            }
          }
        });

        extractedText = parts.join('\n');
        console.log(
          '✅ [CONVERT] Excel extract (server) thành công, length:',
          extractedText.length,
        );
      } else if (fileType === 'pdf') {
        console.log('🔵 [CONVERT] PDF -> pdf-parse (server-side)');

        const buffer = Buffer.from(bytes);
        const pdfParse = new PDFParse();
        const parsed = await pdfParse.parse(buffer);
        extractedText = parsed.text || '';

        console.log(
          '✅ [CONVERT] PDF extract (server) thành công, length:',
          extractedText.length,
        );
      } else {
        console.log(
          'ℹ️ [CONVERT] fileType không phải xlsx/xls/pdf, không trích thêm ở server.',
        );
      }
    }

    if (!extractedText || extractedText.trim().length < 10) {
      console.log('❌ [CONVERT] Text rỗng hoặc quá ngắn, không thể tạo câu hỏi.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Nội dung quá ít, không thể tạo câu hỏi',
          details: 'Text trống hoặc ít hơn 10 ký tự.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.error('❌ [CONVERT] Thiếu OPENAI_API_KEY trong Supabase Secrets.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Thiếu cấu hình OpenAI',
          details: 'OPENAI_API_KEY không được thiết lập trong Supabase Secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    console.log('✅ [CONVERT] OpenAI key found');

    const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
    if (!googleRefreshToken) {
      console.error('❌ [CONVERT] Thiếu GOOGLE_REFRESH_TOKEN trong Supabase Secrets.');
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

    // Vòng lặp xử lý từng chunk text
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(
        `🔵 [CONVERT] Xử lý chunk ${i + 1}/${chunks.length} (len=${chunk.length})...`,
      );

      const prompt = `
Bạn là trợ lý AI chuyên TRÍCH XUẤT VÀ CHUẨN HÓA CÂU HỎI THI.

Nhiệm vụ:
1. Đọc kỹ toàn bộ nội dung dưới đây (trích từ file loại ${fileType}, phần ${
        i + 1
      }/${chunks.length}).
2. Nếu trong đoạn có sẵn câu hỏi (vd: "Câu 1:", "Question 1", câu hỏi có dấu ? ở cuối, ...), hãy TRÍCH XUẤT toàn bộ những câu hỏi đó.
3. Nếu đoạn này KHÔNG có câu hỏi rõ ràng, hãy TỰ TẠO MỘT SỐ CÂU HỎI phù hợp dựa trên nội dung đoạn (có thể là câu hỏi đọc hiểu, nhận biết thông tin trong bảng, danh sách, đề bài viết, ...).
4. Chuẩn hóa mỗi câu hỏi thành object:

{
  "question_text": "...",
  "option_A": "...",
  "option_B": "...",
  "option_C": "...",
  "option_D": "...",
  "correct_answer": "A" | "B" | "C" | "D" | "",
  "skill": "...",
  "difficulty": "easy" | "medium" | "hard",
  "note": "..."
}

YÊU CẦU QUAN TRỌNG:
- Luôn TRẢ VỀ ÍT NHẤT 1 CÂU HỎI cho mỗi lần gọi.
- Nếu thật sự không trích được câu hỏi nào từ nội dung, hãy tạo câu hỏi đọc hiểu / tổng quát về nội dung.
- Không bịa dữ kiện sai lệch hoàn toàn với text; nếu phải suy diễn, hãy ghi chú trong "note".
- Chỉ trả về JSON hợp lệ với cấu trúc:

{ "questions": [ { ... }, ... ] }

KHÔNG ĐƯỢC trả về văn bản giải thích bên ngoài JSON.

ĐOẠN NỘI DUNG:
""" 
${chunk}
""" 
`;

      try {
        const generateResponse = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content:
                    'Bạn là trợ lý chuyên phân tích đề thi và tạo câu hỏi. Bạn PHẢI bám sát nội dung, không bịa hoàn toàn và luôn trả về JSON hợp lệ, không bao giờ trả về mảng questions rỗng.',
                },
                { role: 'user', content: prompt },
              ],
              temperature: 0.2,
              max_tokens: 3000,
            }),
          },
        );

        console.log(
          `📊 [CONVERT] GPT response status cho chunk ${i + 1}:`,
          generateResponse.status,
        );

        if (!generateResponse.ok) {
          const errorText = await generateResponse.text();
          console.error(
            `❌ [CONVERT] Lỗi GPT API cho chunk ${i + 1}:`,
            errorText,
          );
          continue;
        }

        const gptResult = await generateResponse.json();
        const gptMessage = gptResult.choices?.[0]?.message?.content as
          | string
          | undefined;
        console.log(
          `📝 [CONVERT] GPT raw output preview (chunk ${i + 1}):`,
          gptMessage?.slice?.(0, 500),
        );

        if (!gptMessage || !gptMessage.trim()) {
          console.warn(
            `⚠️ [CONVERT] GPT không trả nội dung cho chunk ${i + 1}`,
          );
          continue;
        }

        // Cắt phần JSON từ nội dung trả về (phòng trường hợp GPT có thêm text)
        let jsonText = gptMessage.trim();
        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonText = jsonText.slice(firstBrace, lastBrace + 1);
        }

        let parsed: any;
        try {
          parsed = JSON.parse(jsonText);
        } catch (e) {
          console.error(
            `❌ [CONVERT] JSON.parse lỗi ở chunk ${i + 1}:`,
            e,
          );
          continue;
        }

        const questions = parsed?.questions;
        if (!Array.isArray(questions)) {
          console.warn(
            `⚠️ [CONVERT] Không có mảng questions hợp lệ trong chunk ${i + 1}`,
          );
          continue;
        }

        if (questions.length === 0) {
          console.warn(
            `⚠️ [CONVERT] Chunk ${i + 1} trả về mảng questions rỗng.`,
          );
          continue;
        }

        console.log(
          `✅ [CONVERT] Chunk ${i + 1} trả về ${questions.length} câu hỏi.`,
        );
        allQuestions = allQuestions.concat(questions);
      } catch (err) {
        console.error(`❌ [CONVERT] Lỗi xử lý chunk ${i + 1}:`, err);
      }
    }

    console.log(
      '📊 [CONVERT] Tổng số câu hỏi sau khi gộp tất cả chunk:',
      allQuestions.length,
    );

    // Nếu sau vòng lặp chunk vẫn không có câu hỏi nào -> fallback trên toàn bộ text
    if (allQuestions.length === 0) {
      console.warn(
        '⚠️ [CONVERT] Không có câu hỏi nào sau khi xử lý từng chunk, tiến hành fallback trên toàn bộ text...',
      );

      const fallbackPrompt = `
Bạn là trợ lý AI chuyên TẠO CÂU HỎI từ tài liệu bất kỳ.

Bất kể nội dung file là gì (danh sách, bảng Excel, bài luận, đề bài mô tả, dữ liệu thống kê, ...),
hãy tạo RA ÍT NHẤT 3 CÂU HỎI TRẮC NGHIỆM 4 LỰA CHỌN (A,B,C,D) cho học sinh dựa trên nội dung dưới đây.

YÊU CẦU:
- Câu hỏi bám sát nội dung thật có trong text (nếu có).
- Nếu nội dung chỉ là bảng danh sách (ví dụ: danh sách sinh viên, MSSV, email, ...),
  hãy đặt câu hỏi dạng đọc hiểu / xử lý thông tin từ bảng (ví dụ: "MSSV của Lê Việt Cường là gì?", ...).
- Nếu nội dung vẫn quá nghèo nàn, hãy đặt câu hỏi đọc hiểu/nhận diện nội dung tổng quát.
- Mỗi câu hỏi có 4 phương án A,B,C,D; trường "correct_answer" là một trong "A","B","C","D" hoặc "" nếu không chắc.
- Các field chuẩn cho mỗi câu hỏi:

{
  "question_text": "...",
  "option_A": "...",
  "option_B": "...",
  "option_C": "...",
  "option_D": "...",
  "correct_answer": "A" | "B" | "C" | "D" | "",
  "skill": "...",
  "difficulty": "easy" | "medium" | "hard",
  "note": "..."
}

Chỉ trả về JSON hợp lệ:
{ "questions": [ { ... }, ... ] }

KHÔNG ĐƯỢC TRẢ VỀ MẢNG questions RỖNG.

Nội dung toàn bộ file (có thể đã được rút gọn nếu quá dài):
""" 
${extractedText.slice(0, 8000)}
""" 
`;

      try {
        const fallbackResponse = await fetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content:
                    'Bạn là trợ lý chuyên tạo câu hỏi thi. Bạn PHẢI bám sát nội dung và trả về JSON hợp lệ, không bao giờ trả về mảng questions rỗng.',
                },
                { role: 'user', content: fallbackPrompt },
              ],
              temperature: 0.2,
              max_tokens: 3000,
            }),
          },
        );

        console.log(
          '📊 [CONVERT] Fallback GPT response status:',
          fallbackResponse.status,
        );

        if (fallbackResponse.ok) {
          const fallbackResult = await fallbackResponse.json();
          const fbContent = fallbackResult.choices?.[0]?.message?.content as
            | string
            | undefined;
          console.log(
            '📝 [CONVERT] Fallback GPT raw output preview:',
            fbContent?.slice?.(0, 500),
          );

          if (fbContent && fbContent.trim()) {
            let fbJsonText = fbContent.trim();
            const fbFirst = fbJsonText.indexOf('{');
            const fbLast = fbJsonText.lastIndexOf('}');
            if (fbFirst !== -1 && fbLast !== -1 && fbLast > fbFirst) {
              fbJsonText = fbJsonText.slice(fbFirst, fbLast + 1);
            }

            try {
              const fbParsed = JSON.parse(fbJsonText);
              const fbQuestions = Array.isArray(fbParsed?.questions)
                ? fbParsed.questions
                : [];
              console.log(
                '📊 [CONVERT] Fallback số câu hỏi:',
                fbQuestions.length,
              );

              if (fbQuestions.length > 0) {
                allQuestions = fbQuestions;
              }
            } catch (e) {
              console.error(
                '❌ [CONVERT] Fallback JSON.parse error:',
                e,
              );
            }
          }
        } else {
          const errorText = await fallbackResponse.text();
          console.error(
            '❌ [CONVERT] Fallback GPT API error:',
            errorText,
          );
        }
      } catch (fbErr) {
        console.error('❌ [CONVERT] Lỗi khi gọi fallback GPT:', fbErr);
      }

      // Nếu fallback vẫn không tạo được câu hỏi nào -> tạo ít nhất 1 câu hỏi placeholder để tránh lỗi
      if (allQuestions.length === 0) {
        console.warn(
          '⚠️ [CONVERT] Fallback GPT vẫn không có câu hỏi. Tạo câu hỏi placeholder mặc định...',
        );
        const preview = extractedText
          .slice(0, 120)
          .replace(/\s+/g, ' ')
          .trim();

        allQuestions = [
          {
            question_text: 'Nội dung chính của tài liệu này là gì?',
            option_A:
              'Danh sách thông tin / dữ liệu (ví dụ danh sách sinh viên, bảng điểm, ...)',
            option_B:
              'Bài kiểm tra hoặc đề thi có nhiều câu hỏi rõ ràng',
            option_C:
              'Một bài văn / đoạn văn miêu tả hoặc nghị luận',
            option_D: 'Khác',
            correct_answer: '',
            skill: 'reading',
            difficulty: 'easy',
            note: `Câu hỏi placeholder do hệ thống tạo khi AI không sinh được câu hỏi phù hợp. Xem trước nội dung: "${preview}"`,
          },
        ];
      }
    }

    // ========== TẠO GOOGLE SHEET ==========
    console.log('🔵 [CONVERT] ===== TẠO GOOGLE SHEET =====');

    // Hàm lấy access token (dùng refresh token nếu cần)
    async function getGoogleAccessToken() {
      const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
      const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');

      if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
        console.error('❌ [CONVERT] Thiếu GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN');
        throw new Error('Thiếu cấu hình Google API (CLIENT_ID/SECRET/REFRESH_TOKEN).');
      }

      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const body = new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: googleRefreshToken,
        grant_type: 'refresh_token',
      });

      const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      const json = await resp.json();
      console.log('🔑 [CONVERT] Kết quả refresh token:', json);

      if (!resp.ok) {
        throw new Error('Không thể refresh Google access token');
      }

      if (!json.access_token) {
        throw new Error('Phản hồi refresh token không có access_token');
      }

      return json.access_token as string;
    }

    // Hàm tạo sheet + ghi dữ liệu
    async function createGoogleSheetFromQuestions(questions: any[]): Promise<string> {
      // Lấy access token mới từ refresh token
      const accessToken = await getGoogleAccessToken();
      console.log('✅ [CONVERT] Đã lấy Google access token mới');

      // 1) Tạo Google Sheet rỗng
      const createSheetResp = await fetch(
        'https://sheets.googleapis.com/v4/spreadsheets',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              title:
                fileName ||
                `Đề kiểm tra ${subject || ''} lớp ${grade || ''}`.trim(),
            },
          }),
        },
      );

      const createSheetJson = await createSheetResp.json();
      console.log('📄 [CONVERT] Kết quả tạo Sheet:', createSheetJson);
      if (!createSheetResp.ok) {
        throw new Error(
          'Không thể tạo Google Sheet: ' + JSON.stringify(createSheetJson),
        );
      }

      const spreadsheetId = createSheetJson.spreadsheetId as string;
      const sheetUrl = createSheetJson.spreadsheetUrl as string;

      // 2) Ghi header + data
      const header = [
        'question_text',
        'option_A',
        'option_B',
        'option_C',
        'option_D',
        'correct_answer',
        'skill',
        'difficulty',
        'note',
      ];

      const dataRows = allQuestions.map((q) => [
        q.question_text || '',
        q.option_A || '',
        q.option_B || '',
        q.option_C || '',
        q.option_D || '',
        q.correct_answer || '',
        q.skill || '',
        q.difficulty || '',
        q.note || '',
      ]);

      const body = {
        range: 'Sheet1!A1:I' + (dataRows.length + 1),
        majorDimension: 'ROWS',
        values: [header, ...dataRows],
      };

      const updateResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      const updateJson = await updateResp.json();
      console.log('✏️ [CONVERT] Kết quả ghi dữ liệu vào Sheet:', updateJson);
      if (!updateResp.ok) {
        throw new Error(
          'Không thể ghi dữ liệu vào Google Sheet: ' + JSON.stringify(updateJson),
        );
      }

      return sheetUrl;
    }

    const sheetUrl = await createGoogleSheetFromQuestions(allQuestions);

    console.log('✅ [CONVERT] TẠO SHEET HOÀN TẤT. URL:', sheetUrl);

    return new Response(
      JSON.stringify({
        success: true,
        sheetUrl,
        totalQuestions: allQuestions.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('❌ [CONVERT] Lỗi tổng:', error);

    let message = 'Có lỗi xảy ra khi xử lý file.';
    if (error instanceof Error && error.message) {
      message = error.message;
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        details: String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
