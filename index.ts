import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { message, studentId, studentName, subject } = await req.json()

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Use the OpenAI API key directly
    const openaiApiKey = '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'
    
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Enhanced system prompt for Vietnamese teacher
    const systemPrompt = `Bạn là Cô Hương - giảng viên Việt Nam hỗ trợ người học ở các cấp cơ bản.
Nhiệm vụ của bạn là giúp người học hiểu bài, tự rèn luyện kỹ năng và duy trì hứng thú học tập bằng hình thức khuyến khích tích cực.

QUY TẮC TRẢ LỜI:

Khi người học hỏi bài hoặc bài tập, không đưa ra đáp án ngay.
→ Hướng dẫn từng bước, giải thích cách hiểu đề, cách tư duy, gợi ý chỗ cần chú ý.
→ Chỉ cho đáp án sau khi người học đã làm thử và yêu cầu kiểm tra kết quả.

Sau khi giải thích hoặc hướng dẫn xong một phần kiến thức, hãy:
→ Đưa ra 1–2 câu hỏi phụ hoặc ví dụ tương tự để người học tự luyện.
→ Chờ người học trả lời, sau đó nhận xét đúng/sai.

Nếu người học trả lời đúng, hãy:
→ Khen ngợi bằng lời thân thiện ("Tốt lắm", "Làm đúng rồi đó!").
→ Ghi nhận một điểm khuyến khích trong buổi học hiện tại.

Nếu người học trả lời sai, hãy:
→ Nhẹ nhàng gợi ý lại cách làm, không chê trách.
→ Không trừ điểm, chỉ động viên thử lại.

Chỉ hỗ trợ các môn trong chương trình học phổ thông: Toán, Tiếng Việt, Ngữ Văn, Tiếng Anh, Vật lý, Hóa học, Sinh học, Lịch sử, Địa lý. 

Nếu người học hỏi ngoài phạm vi, hãy nói:
"Câu hỏi này nằm ngoài nội dung học nhé, chúng ta quay lại bài học trong chương trình chính nha."

Trả lời ngắn gọn, dễ hiểu, có ví dụ thực tế, khuyến khích người học tự suy nghĩ.
Luôn giữ thái độ nhẹ nhàng, tích cực và truyền cảm hứng học tập.

Khi kết thúc câu trả lời, nếu có thể hãy đưa ra một câu hỏi nhỏ để học sinh luyện tập thêm.`

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('OpenAI API Error:', errorData)
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const aiResponse = data.choices[0].message.content

    // Store chat session in database
    try {
      const sessionData = {
        student_id: studentId || null,
        subject: subject || 'Tổng hợp',
        question: message,
        ai_response: aiResponse,
        session_points: 0,
        created_at: new Date().toISOString()
      }

      const { data: sessionResult, error: sessionError } = await supabase
        .from('student_chat_sessions')
        .insert(sessionData)
        .select()

      if (sessionError) {
        console.error('Error storing chat session:', sessionError)
      }

      // Update or create student progress record
      if (studentId && studentName) {
        const { data: existingProgress } = await supabase
          .from('student_learning_progress')
          .select('*')
          .eq('student_id', studentId)
          .eq('subject', subject || 'Tổng hợp')
          .single()

        if (existingProgress) {
          // Update existing progress
          const { error: updateError } = await supabase
            .from('student_learning_progress')
            .update({
              total_sessions: existingProgress.total_sessions + 1,
              last_session_date: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', existingProgress.id)

          if (updateError) {
            console.error('Error updating progress:', updateError)
          }
        } else {
          // Create new progress record
          const progressData = {
            student_id: studentId,
            student_name: studentName,
            subject: subject || 'Tổng hợp',
            total_sessions: 1,
            total_points: 0,
            correct_answers: 0,
            total_questions: 0,
            accuracy_rate: 0,
            last_session_date: new Date().toISOString()
          }

          const { error: insertError } = await supabase
            .from('student_learning_progress')
            .insert(progressData)

          if (insertError) {
            console.error('Error creating progress:', insertError)
          }
        }
      }
    } catch (dbError) {
      console.error('Database error:', dbError)
      // Continue even if database operations fail
    }

    return new Response(
      JSON.stringify({ 
        message: aiResponse,
        success: true
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )

  } catch (error) {
    console.error('Error in ai-chat function:', error)
    return new Response(
      JSON.stringify({ 
        message: 'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau ít phút nhé! 😅',
        error: error.message,
        success: false
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})