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
    const { sheetUrl, teacherId } = await req.json();

    if (!sheetUrl || !teacherId) {
      throw new Error('Missing required parameters');
    }

    // Extract spreadsheet ID from URL
    const spreadsheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!spreadsheetIdMatch) {
      throw new Error('Invalid Google Sheet URL');
    }
    const spreadsheetId = spreadsheetIdMatch[1];

    // Get access token from secrets
    const accessToken = Deno.env.get('GOOGLE_ACCESS_TOKEN');
    const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');

    if (!accessToken && !refreshToken) {
      throw new Error('Google API credentials not configured');
    }

    let token = accessToken;

    // If access token expired, refresh it
    if (!token && refreshToken) {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      const refreshData = await refreshResponse.json();
      token = refreshData.access_token;
    }

    // First, get spreadsheet metadata to find the first sheet name
    const metadataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      throw new Error(`Failed to get spreadsheet metadata: ${errorText}`);
    }

    const metadata = await metadataResponse.json();
    const firstSheetName = metadata.sheets?.[0]?.properties?.title || 'Sheet1';

    console.log('📊 [READ-SHEET] First sheet name:', firstSheetName);

    // Read data from the first sheet
    const sheetResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetName)}!A2:H1000`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!sheetResponse.ok) {
      const errorText = await sheetResponse.text();
      throw new Error(`Failed to read Google Sheet: ${errorText}`);
    }

    const sheetData = await sheetResponse.json();
    const rows = sheetData.values || [];

    console.log('📊 [READ-SHEET] Found', rows.length, 'rows');

    // Parse rows into questions
    const questions = rows.map((row: string[]) => {
  // row[0] = STT (bỏ qua)
  // row[1] = Loại (TN/TL) – chỉ để tham khảo, không dùng quyết định
  const optionCells = [row[2], row[3], row[4], row[5]]; // C–F
  const hasOptions = optionCells.some(
    (v) => (v || '').toString().trim() !== ''
  );
  const hasQuestionText = (row[7] || '').toString().trim() !== ''; // H - Question_text

  // Ưu tiên đúng theo rule:
  // - Nếu có options -> TN
  // - Ngược lại -> TL
  const isMultipleChoice = hasOptions;

  const question_type = isMultipleChoice ? 'multiple_choice' : 'essay';

  const question_text = question_type === 'essay'
    ? (row[7] || '')
    : ''; // TN thì để trống Question_text theo rule

  const options = question_type === 'multiple_choice'
    ? optionCells.map((v) => v || '').filter((v) => v.trim() !== '')
    : [];

  const correct_answer = question_type === 'multiple_choice'
    ? (row[6] || '') // G - Đáp án đúng
    : '';

  return {
    question_text,
    options,
    correct_answer,
    question_type,
  };
});

    return new Response(
      JSON.stringify({ success: true, questions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});