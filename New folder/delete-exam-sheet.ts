import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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
    const { googleSheetUrl, spreadsheetId: rawSpreadsheetId } = await req.json();

    console.log('🔵 [DELETE-EXAM-SHEET] Request body:', {
      googleSheetUrl,
      rawSpreadsheetId,
    });

    // ===== 1. Xác định spreadsheetId =====
    let spreadsheetId = rawSpreadsheetId as string | null;

    if (!spreadsheetId) {
      if (!googleSheetUrl || typeof googleSheetUrl !== 'string') {
        throw new Error(
          'Thiếu googleSheetUrl hoặc spreadsheetId trong request body',
        );
      }

      try {
        const url = new URL(googleSheetUrl);
        const match = url.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
        spreadsheetId = match ? match[1] : null;
      } catch (e) {
        console.error(
          '❌ [DELETE-EXAM-SHEET] Không parse được URL từ googleSheetUrl:',
          googleSheetUrl,
          e,
        );
        throw new Error('Link Google Sheet không hợp lệ');
      }
    }

    if (!spreadsheetId) {
      throw new Error(
        'Không trích được spreadsheetId từ googleSheetUrl / spreadsheetId',
      );
    }

    console.log(
      '🔵 [DELETE-EXAM-SHEET] spreadsheetId cần xoá:',
      spreadsheetId,
    );

    // ===== 2. Lấy Google OAuth credentials từ ENV =====
    const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');

    if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
      throw new Error(
        'Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN) chưa được cấu hình',
      );
    }

    // ===== 3. Refresh access_token =====
    console.log('🔐 [DELETE-EXAM-SHEET] Refreshing Google access token...');

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
      console.error('❌ [DELETE-EXAM-SHEET] Failed to refresh token:', errText);
      throw new Error('Không thể refresh Google token: ' + errText);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token as string | undefined;

    if (!accessToken) {
      console.error(
        '❌ [DELETE-EXAM-SHEET] No access_token in token response:',
        tokenJson,
      );
      throw new Error('Không nhận được access_token từ Google');
    }

    console.log('✅ [DELETE-EXAM-SHEET] Got access_token.');

    // ===== 4. Gọi Google Drive API để xoá file =====
    console.log(
      '🗑️ [DELETE-EXAM-SHEET] Đang xoá file trên Google Drive...',
      spreadsheetId,
    );

    const deleteRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!deleteRes.ok) {
      // Nếu file không tồn tại (404) thì coi như xoá xong
      if (deleteRes.status === 404) {
        console.warn(
          '⚠️ [DELETE-EXAM-SHEET] File không tồn tại (404), coi như đã xoá trước đó.',
        );
      } else {
        const errText = await deleteRes.text();
        console.error(
          '❌ [DELETE-EXAM-SHEET] Lỗi khi xoá file trên Drive:',
          errText,
        );
        throw new Error('Không thể xoá file Google Sheet: ' + errText);
      }
    } else {
      console.log('✅ [DELETE-EXAM-SHEET] Đã xoá file Google Sheet thành công.');
    }

    const responseBody = {
      success: true,
      spreadsheetId,
      message: 'Đã xoá file Google Sheet (hoặc file không còn tồn tại).',
    };

    console.log('🎉 [DELETE-EXAM-SHEET] Done:', responseBody);

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('❌ [DELETE-EXAM-SHEET] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
