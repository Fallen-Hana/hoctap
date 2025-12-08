import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { teacherId, examTitle, subject, grade } = await req.json();

    if (!teacherId || !examTitle) {
      throw new Error('Missing required parameters: teacherId or examTitle');
    }

    console.log('🔵 [CREATE-EMPTY-SHEET] Start', {
      teacherId,
      examTitle,
      subject,
      grade,
    });

    // ===== 1. GOOGLE CREDENTIALS =====
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
    const targetFolderId = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID') || '';

    if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
      throw new Error('Google OAuth credentials missing');
    }

    // ===== 2. Refresh access token =====
    console.log('🔵 Refreshing Google access token...');
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
      const t = await tokenRes.text();
      throw new Error('Failed to refresh Google token: ' + t);
    }

    const { access_token } = await tokenRes.json();
    if (!access_token) throw new Error('No access token received');

    // ===== 3. Create Google Sheet =====
    const titleParts = [examTitle];
    if (subject) titleParts.push(subject);
    if (grade) titleParts.push(grade);
    const sheetTitle = titleParts.join(' - ');

    console.log('🔵 Creating spreadsheet:', sheetTitle);

    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: sheetTitle },
        sheets: [
          {
            properties: {
              title: 'Câu hỏi',
              gridProperties: { frozenRowCount: 1 },
            },
          },
        ],
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error('Failed to create Google Sheet: ' + errText);
    }

    const createJson = await createRes.json();
    const spreadsheetId = createJson.spreadsheetId;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;

    console.log('✅ Created spreadsheet:', spreadsheetId);

    // ===== 4. Insert header row =====
    const headerValues = [
      [
        'STT',
        'Loại (TN/TL)',
        'Phương án A',
        'Phương án B',
        'Phương án C',
        'Phương án D',
        'Đáp án đúng',
        'Question_text',
      ],
    ];

    const headerRange = `${encodeURIComponent('Câu hỏi')}!A1:H1`;

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${headerRange}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: headerValues }),
      }
    );

    console.log('✅ Header row added');

    // ===== 5. Format header row =====
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.6, blue: 0.86 },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      bold: true,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 8,
                },
              },
            },
          ],
        }),
      }
    );

    console.log('✅ Header formatted');

    // ===== 6. Move file to folder =====
    if (targetFolderId) {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${targetFolderId}&fields=id,parents`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('✅ File moved into folder:', targetFolderId);
    }

    // ===================================================================================
    // ===== 7. TẠO BẢN GHI EXAM TRONG SUPABASE =========================================
    // ===================================================================================
    console.log('🔵 Creating EXAM record in Supabase...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: exam, error: examError } = await supabase
      .from('exams')
      .insert({
        teacher_id: teacherId,
        title: examTitle,
        subject,
        grade,
        exam_type: 'mixed',
        total_questions: 0,
        status: 'draft',
        visibility: 'private',
        google_sheet_url: sheetUrl,
        google_sheet_id: spreadsheetId, // ✅ CHỈ THÊM DÒNG NÀY
      })
      .select()
      .single();

    if (examError) {
      console.error('❌ EXAM INSERT ERROR:', examError);
      throw new Error('Failed to create exam record');
    }

    console.log('✅ Exam created with ID:', exam.id);

    // ===== 8. Return to frontend =====
    const responseBody = {
      success: true,
      sheetUrl,
      spreadsheetId,
      examId: exam.id,
    };

    console.log('✅ ALL DONE:', responseBody);

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('❌ [CREATE-EMPTY-SHEET] ERROR:', err);

    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
