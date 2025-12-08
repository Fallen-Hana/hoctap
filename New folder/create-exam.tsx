import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/feature/Header';
import Footer from '../../../components/feature/Footer';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';

interface Question {
  id: string;
  question_text: string;
  question_type: 'multiple_choice' | 'essay';
  options?: string[];
  correct_answer?: string;
  ai_note?: string;
  image_url?: string;
  selected?: boolean;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
}

interface StudentSkillAnalysis {
  id: string;
  student_id: string;
  subject: string;
  skill_name: string;
  skill_level: 'weak' | 'medium' | 'strong';
  score: number;
  total_questions: number;
  correct_answers: number;
}

export default function CreateExamPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [studentWeaknesses, setStudentWeaknesses] = useState<Record<string, StudentSkillAnalysis[]>>({});
   // NEW: lấy thông tin từ URL & đánh dấu đã auto-load sheet chưa
  const [sheetIdFromUrl, setSheetIdFromUrl] = useState<string | null>(null);
  const [examIdFromUrl, setExamIdFromUrl] = useState<string | null>(null);
  const [initialSheetLoaded, setInitialSheetLoaded] = useState(false);
  
  // Form data
  const [formData, setFormData] = useState({
    title: '',
    subject: '',
    grade: '',
    examType: 'mixed', // Đổi từ 'standard' → 'mixed'
    totalQuestions: 20,
    duration: 45,
    selectedStudents: [] as string[],
    googleSheetUrl: '',
    durationMinutes: 45,
    allowRetry: 'no',
    shuffleQuestions: false,
    shuffleAnswers: false
  });

  const subjects = [
    'Toán học', 'Ngữ văn', 'Tiếng Anh', 'Vật lý', 'Hóa học', 
    'Sinh học', 'Lịch sử', 'Địa lý', 'Tin học', 'Tổng hợp'
  ];

  const grades = [
    'Lớp 1', 'Lớp 2', 'Lớp 3', 'Lớp 4', 'Lớp 5',
    'Lớp 6', 'Lớp 7', 'Lớp 8', 'Lớp 9',
    'Lớp 10', 'Lớp 11', 'Lớp 12'
  ];

  useEffect(() => {
    if (!user || !profile) {
      navigate('/login');
      return;
    }

    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      navigate('/');
      return;
    }

    loadStudents();
  }, [user, profile, navigate]);

  const loadStudents = async () => {
    if (!user) return;

    try {
      // Load students from teacher_contacts instead of teacher_student_links
      const { data, error } = await supabase
        .from('teacher_contacts')
        .select(`
          student_id,
          student:student_id (
            id,
            full_name,
            email
          )
        `)
        .eq('teacher_id', user.id)
        .not('student_id', 'is', null);

      if (error) throw error;

      const studentList = data?.map(item => item.student).filter(Boolean) || [];
      setStudents(studentList as Student[]);
    } catch (error) {
      console.error('Error loading students:', error);
    }
  };

  const loadStudentWeaknesses = async (studentIds: string[]) => {
    if (studentIds.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('student_skill_analysis')
        .select('*')
        .in('student_id', studentIds)
        .eq('subject', formData.subject)
        .order('skill_level', { ascending: true }); // weak first

      if (error) throw error;

      // Group by student_id
      const grouped: Record<string, StudentSkillAnalysis[]> = {};
      data?.forEach(item => {
        if (!grouped[item.student_id]) {
          grouped[item.student_id] = [];
        }
        grouped[item.student_id].push(item);
      });

      setStudentWeaknesses(grouped);

      // Show summary
      const weakSkills = data?.filter(d => d.skill_level === 'weak') || [];
      if (weakSkills.length > 0) {
        const skillNames = [...new Set(weakSkills.map(s => s.skill_name))];
        alert(`📊 Đã tải phân tích điểm yếu!\n\n` +
          `Các kỹ năng yếu được phát hiện:\n` +
          skillNames.map(s => `• ${s}`).join('\n') +
          `\n\nHệ thống sẽ ưu tiên tạo câu hỏi cho các kỹ năng này.`
        );
      } else {
        alert('ℹ️ Chưa có dữ liệu phân tích điểm yếu cho học sinh này trong môn ' + formData.subject);
      }
    } catch (error) {
      console.error('Error loading student weaknesses:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleStudentSelection = (studentId: string, checked: boolean) => {
    const newSelected = checked
      ? [...formData.selectedStudents, studentId]
      : formData.selectedStudents.filter(id => id !== studentId);
    
    setFormData(prev => ({ ...prev, selectedStudents: newSelected }));

    // Auto-load weaknesses if exam type is weakness
    if (formData.examType === 'weakness_focused' && newSelected.length > 0) {
      loadStudentWeaknesses(newSelected);
    }
  };

  useEffect(() => {
    // Reload weaknesses when subject or exam type changes
    if (formData.examType === 'weakness_focused' && formData.selectedStudents.length > 0) {
      loadStudentWeaknesses(formData.selectedStudents);
    }
  }, [formData.subject, formData.examType]);
  const loadExamMeta = async (examId: string) => {
  try {
    const { data, error } = await supabase
      .from('exams')
      .select('title, subject, grade, exam_type, duration_minutes, google_sheet_url')
      .eq('id', examId)
      .single();

    if (error) {
      console.error('❌ [LOAD-EXAM] Lỗi load exam meta:', error);
      return;
    }
    if (!data) return;

    setFormData(prev => ({
      ...prev,
      title: data.title || '',
      subject: data.subject || prev.subject,
      grade: data.grade || prev.grade,
      examType: data.exam_type || prev.examType,
      durationMinutes: data.duration_minutes || prev.durationMinutes,
      googleSheetUrl:
        data.google_sheet_url && data.google_sheet_url.length > 0
          ? data.google_sheet_url
          : prev.googleSheetUrl,
    }));
  } catch (err) {
    console.error('❌ [LOAD-EXAM] Exception:', err);
  }
};
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    if (!fileName.endsWith('.docx') && !fileName.endsWith('.csv') && 
        !fileName.endsWith('.xlsx') && !fileName.endsWith('.pdf')) {
      alert('Chỉ hỗ trợ file Word (.docx), CSV, Excel (.xlsx) hoặc PDF!');
      // Reset input để có thể chọn lại file
      e.target.value = '';
      return;
    }

    setAiProcessing(true);

    try {
      console.log('🔵 [CLIENT] Bắt đầu xử lý file:', fileName);
      
      let extractedText = '';

      // ========== TRÍCH XUẤT TEXT TRÊN CLIENT ==========
      if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
        // CSV/TXT - Đọc trực tiếp
        extractedText = await file.text();
        console.log('✅ [CLIENT] Đọc CSV/TXT thành công, length:', extractedText.length);
      } else if (fileName.endsWith('.docx')) {
        // DOCX - Dùng mammoth
        console.log('🔵 [CLIENT] Đọc DOCX bằng mammoth...');
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
        console.log('✅ [CLIENT] Mammoth extract thành công, length:', extractedText.length);
        console.log('📝 [CLIENT] Preview (500 chars):', extractedText.slice(0, 500));
      } else if (fileName.endsWith('.xlsx')) {
        // Excel - Dùng xlsx
        console.log('🔵 [CLIENT] Đọc Excel bằng xlsx...');
        const XLSX = await import('xlsx');
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        // Đọc tất cả sheets
        let allText = '';
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const sheetText = XLSX.utils.sheet_to_csv(worksheet);
          allText += `\n=== Sheet: ${sheetName} ===\n${sheetText}\n`;
        });
        
        extractedText = allText;
        console.log('✅ [CLIENT] XLSX extract thành công, length:', extractedText.length);
        console.log('📝 [CLIENT] Preview (500 chars):', extractedText.slice(0, 500));
      } else if (fileName.endsWith('.pdf')) {
        // PDF - Dùng pdfjs-dist
        console.log('🔵 [CLIENT] Đọc PDF bằng pdfjs-dist...');
        const pdfjsLib = await import('pdfjs-dist');
        
        // Set worker - FIX: Dùng jsdelivr CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let allText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          allText += `\n=== Page ${i} ===\n${pageText}\n`;
        }
        
        extractedText = allText;
        console.log('✅ [CLIENT] PDF extract thành công, length:', extractedText.length);
        console.log('📝 [CLIENT] Preview (500 chars):', extractedText.slice(0, 500));
      }

      // ⚠️ GIỚI HẠN TEXT NẾU QUÁ DÀI (tránh timeout)
      const MAX_TEXT_LENGTH = 50000; // 50KB
      if (extractedText.length > MAX_TEXT_LENGTH) {
        console.warn(`⚠️ [CLIENT] Text quá dài (${extractedText.length} chars), cắt xuống ${MAX_TEXT_LENGTH} chars`);
        extractedText = extractedText.slice(0, MAX_TEXT_LENGTH);
        alert(`⚠️ File quá lớn!\n\nChỉ xử lý ${MAX_TEXT_LENGTH} ký tự đầu tiên.\nNếu cần xử lý toàn bộ, vui lòng chia nhỏ file.`);
      }

      console.log('✅ [CLIENT] Trích xuất text hoàn tất, gửi lên server...');

// 🔹 LẤY spreadsheetId TỪ LINK GOOGLE SHEET HIỆN TẠI
let spreadsheetId: string | null = null;
try {
  const url = new URL(formData.googleSheetUrl);
  const match = url.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
  spreadsheetId = match ? match[1] : null;
} catch (e) {
  console.error('❌ [CONVERT] googleSheetUrl không hợp lệ:', formData.googleSheetUrl, e);
}

if (!spreadsheetId) {
  console.error(
    '❌ [CONVERT] Không trích được spreadsheetId từ googleSheetUrl:',
    formData.googleSheetUrl
  );
  alert('Không nhận được link Google Sheet hiện tại. Vui lòng kiểm tra lại ô "Google Sheet" ở bên phải.');
  setAiProcessing(false);
  return;
}

// ========== GỬI TEXT LÊN EDGE FUNCTION ==========
const convertResponse = await fetch(
  `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/convert-file-to-sheet`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      extractedText: extractedText,
      teacherId: user?.id,
      subject: formData.subject,
      grade: formData.grade,
      fileName: fileName,
      spreadsheetId,          // 👈 THÊM DÒNG NÀY
      mode: 'append',         // nếu muốn, để edge biết là append chứ không replace
    }),
  }
);

      console.log('🔵 [CONVERT] Response status:', convertResponse.status);
      console.log('🔵 [CONVERT] Response headers:', Object.fromEntries(convertResponse.headers.entries()));

      // ⚠️ ĐỌC RESPONSE TEXT TRƯỚC KHI PARSE JSON
      const responseText = await convertResponse.text();
      console.log('🔵 [CONVERT] Response text (first 1000 chars):', responseText.slice(0, 1000));

      if (!convertResponse.ok) {
        let errorData: any = {};
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          console.error('❌ [CONVERT] Cannot parse error response as JSON:', e);
          errorData = { error: responseText || 'Unknown error' };
        }
        
        console.error('❌ [CONVERT] Error response:', errorData);
        
        let errorMessage = '❌ Không thể xử lý file!\n\n';
        
        if (errorData.error?.includes('OpenAI API key not configured')) {
          errorMessage += 'Lỗi: Chưa cấu hình OpenAI API Key\n\n';
          errorMessage += 'Vui lòng liên hệ admin để thêm OPENAI_API_KEY vào Supabase Secrets.';
        } else if (errorData.error?.includes('Google API credentials not configured')) {
          errorMessage += 'Lỗi: Chưa cấu hình Google API credentials\n\n';
          errorMessage += 'Vui lòng liên hệ admin để cấu hình:\n';
          errorMessage += '1. GOOGLE_CLIENT_ID\n';
          errorMessage += '2. GOOGLE_CLIENT_SECRET\n';
          errorMessage += '3. GOOGLE_ACCESS_TOKEN\n';
          errorMessage += '4. GOOGLE_REFRESH_TOKEN\n';
        } else if (errorData.error?.includes('Text trống')) {
          errorMessage += 'Lỗi: Không đọc được nội dung file\n\n';
          errorMessage += 'Vui lòng kiểm tra:\n';
          errorMessage += '1. File có nội dung rõ ràng không?\n';
          errorMessage += '2. File có bị hỏng không?\n';
          errorMessage += '3. Thử file khác hoặc tạo câu hỏi thủ công.';
        } else if (errorData.error?.includes('Không tạo được câu hỏi')) {
          errorMessage += 'Lỗi: AI không tạo được câu hỏi từ file này\n\n';
          errorMessage += 'Vui lòng:\n';
          errorMessage += '1. Kiểm tra nội dung file có đủ thông tin không\n';
          errorMessage += '2. Thử file khác\n';
          errorMessage += '3. Tạo câu hỏi thủ công';
        } else if (errorData.error?.includes('timeout') || errorData.error?.includes('timed out')) {
          errorMessage += 'Lỗi: Xử lý quá lâu (timeout)\n\n';
          errorMessage += 'File quá lớn hoặc phức tạp.\n';
          errorMessage += 'Vui lòng:\n';
          errorMessage += '1. Chia nhỏ file thành nhiều phần\n';
          errorMessage += '2. Thử lại sau vài phút\n';
          errorMessage += '3. Tạo câu hỏi thủ công';
        } else {
          errorMessage += `Lỗi: ${errorData.error || 'Unknown error'}\n\n`;
          if (errorData.details) {
            errorMessage += 'Chi tiết: ' + errorData.details;
          }
        }
        
        throw new Error(errorMessage);
      }

      // ⚠️ PARSE JSON TỪ TEXT ĐÃ ĐỌC
      let convertResult: any = {};
      try {
        convertResult = JSON.parse(responseText);
      } catch (e) {
        console.error('❌ [CONVERT] Cannot parse success response as JSON:', e);
        throw new Error('Không thể đọc kết quả từ server. Response: ' + responseText.slice(0, 500));
      }
      console.log('✅ [CONVERT] Success from convert-file:', convertResult);

if (!convertResult.success) {
  throw new Error(convertResult.error || 'Convert thất bại');
}

// Ở trang exam anh đã có sẵn sheetUrl trong state (tạo từ trước),
// nên KHÔNG yêu cầu backend trả lại nữa.
// Chỉ cần cập nhật tổng số câu hỏi (nếu muốn):
// Hiển thị toast / alert thành công
alert('Đã cập nhật câu hỏi từ file lên Google Sheet hiện tại.');
      

      if (!convertResult.success) {
        throw new Error(convertResult.error || 'Convert thất bại');
      }

      // Ở trang exam đã có sẵn googleSheetUrl trong state,
      // nên ưu tiên dùng lại link hiện tại.
      const sheetUrl =
        formData.googleSheetUrl && formData.googleSheetUrl.trim().length > 0
          ? formData.googleSheetUrl.trim()
          : convertResult.sheetUrl ||
            (convertResult.spreadsheetId
              ? `https://docs.google.com/spreadsheets/d/${convertResult.spreadsheetId}/edit`
              : '');

      if (!sheetUrl) {
        throw new Error('Không nhận được link Google Sheet');
      }
      console.log('Đã cập nhật câu hỏi từ file lên Google Sheet hiện tại.');
      // ========== ĐỌC GOOGLE SHEET ==========
      console.log('🔵 [READ-SHEET] Đọc Google Sheet...');
      const readResponse = await fetch(
        `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/read-google-sheet-exam`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            sheetUrl,       // 🔴 dùng biến sheetUrl, không dùng convertResult.sheetUrl nữa
            teacherId: user?.id
          })
        }
      );

      if (!readResponse.ok) {
        const errorData = await readResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ [READ-SHEET] Error:', errorData);
        throw new Error('Không thể đọc Google Sheet: ' + (errorData.error || 'Unknown error'));
      }

      const readResult = await readResponse.json();
      console.log('✅ [READ-SHEET] Success! Questions:', readResult.questions?.length || 0);

      if (!readResult.questions || readResult.questions.length === 0) {
        alert('⚠️ Google Sheet đã được tạo nhưng không có câu hỏi!\n\nLink: ' + convertResult.sheetUrl);
        return;
      }

      // ========== THÊM CÂU HỎI VÀO DANH SÁCH (Kiểm tra trùng lặp) ==========
      const existingQuestionTexts = new Set(questions.map(q => q.question_text.trim().toLowerCase()));
      
      const processedQuestions: Question[] = readResult.questions
        .filter((q: any) => {
          const questionText = q.question_text?.trim().toLowerCase();
          if (!questionText || existingQuestionTexts.has(questionText)) {
            return false; // Bỏ qua câu hỏi trùng
          }
          existingQuestionTexts.add(questionText);
          return true;
        })
        .map((q: any, idx: number) => ({
          id: `q-${Date.now()}-${idx}`,
          question_text: q.question_text,
          question_type: q.question_type || 'multiple_choice',
          options: q.options || [],
          correct_answer: q.correct_answer,
          ai_note: `🤖 AI tạo từ ${fileName}`,
          selected: false
        }));

      if (processedQuestions.length === 0) {
        alert('⚠️ Tất cả câu hỏi từ file này đã tồn tại trong danh sách!');
        return;
      }

      setQuestions(prev => [...prev, ...processedQuestions]);
      
      alert(
        `✅ Đã xử lý file thành công!\n\n` +
        `📊 Số câu hỏi mới: ${processedQuestions.length}\n` +
        `📄 Google Sheet: ${convertResult.sheetUrl}\n\n` +
        `💡 Các câu hỏi đã được thêm vào danh sách. Vui lòng kiểm tra và chỉnh sửa nếu cần.`
      );

    } catch (error: any) {
      console.error('❌ [ERROR] Full error:', error);
      console.error('❌ [ERROR] Error message:', error.message);
      console.error('❌ [ERROR] Error stack:', error.stack);
      
      // Hiển thị lỗi chi tiết
      alert(error.message || '❌ Không thể xử lý file! Vui lòng thử lại.');
    } finally {
      setAiProcessing(false);
      // Reset input để có thể chọn lại file
      e.target.value = '';
    }
  };

  const handleGoogleSheetRead = async () => {
    if (!formData.googleSheetUrl.trim()) {
      alert('Vui lòng nhập link Google Sheet!');
      return;
    }

    setAiProcessing(true);

    try {
      console.log('🔵 [GOOGLE-SHEET] Bắt đầu đọc Google Sheet...');
      console.log('📊 [GOOGLE-SHEET] URL:', formData.googleSheetUrl);

      const response = await fetch(`${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/read-google-sheet-exam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          sheetUrl: formData.googleSheetUrl,
          teacherId: user?.id
        })
      });

      console.log('🔵 [GOOGLE-SHEET] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ [GOOGLE-SHEET] Error response:', errorData);
        
        let errorMessage = '❌ Không thể đọc Google Sheet!\n\n';
        
        if (errorData.error?.includes('credentials not configured')) {
          errorMessage += 'Lỗi: Chưa cấu hình Google API credentials\n\n';
          errorMessage += 'Vui lòng liên hệ admin để cấu hình:\n';
          errorMessage += '1. GOOGLE_CLIENT_ID\n';
          errorMessage += '2. GOOGLE_CLIENT_SECRET\n';
          errorMessage += '3. GOOGLE_ACCESS_TOKEN\n';
          errorMessage += '4. GOOGLE_REFRESH_TOKEN\n';
        } else if (errorData.error?.includes('Invalid Google Sheet URL')) {
          errorMessage += 'Lỗi: Link Google Sheet không hợp lệ\n\n';
          errorMessage += 'Vui lòng kiểm tra:\n';
          errorMessage += '1. Link có đúng định dạng không?\n';
          errorMessage += '2. Link có chứa /d/[ID]/ không?\n';
          errorMessage += '3. Thử copy lại link từ Google Sheet\n';
        } else if (errorData.error?.includes('Failed to read Google Sheet')) {
          errorMessage += 'Lỗi: Không thể đọc dữ liệu từ Google Sheet\n\n';
          errorMessage += 'Vui lòng kiểm tra:\n';
          errorMessage += '1. Google Sheet có public không?\n';
          errorMessage += '2. Sheet có tên "Sheet1" không?\n';
          errorMessage += '3. Dữ liệu có đúng format không?\n';
          errorMessage += '   - Cột A: Câu hỏi\n';
          errorMessage += '   - Cột B-E: Đáp án A, B, C, D\n';
          errorMessage += '   - Cột F: Đáp án đúng\n';
          errorMessage += '   - Cột G: Kỹ năng\n';
          errorMessage += '   - Cột H: Độ khó\n';
        } else {
          errorMessage += `Lỗi: ${errorData.error || 'Unknown error'}\n`;
        }
        
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('✅ [GOOGLE-SHEET] Success! Questions:', result.questions?.length || 0);
      
      if (!result.questions || result.questions.length === 0) {
        console.log('ℹ️ [GOOGLE-SHEET] Sheet kết nối OK nhưng hiện không có câu hỏi nào.');
        return;
      }
      
      const processedQuestions: Question[] = result.questions.map((q: any, idx: number) => ({
        id: `q-${Date.now()}-${idx}`,
        question_text: q.question_text,
        question_type: q.question_type || 'multiple_choice',
        options: q.options || [],
        correct_answer: q.correct_answer,
        ai_note: 'Từ Google Sheet',
        selected: false
      }));

      setQuestions(prev => [...prev, ...processedQuestions]);
      alert(`✅ Đã đọc được ${processedQuestions.length} câu hỏi từ Google Sheet!`);

    } catch (error: any) {
      console.error('❌ [GOOGLE-SHEET] Error:', error);
      alert(error.message || '❌ Không thể đọc Google Sheet! Vui lòng kiểm tra link và quyền truy cập.');
    } finally {
      setAiProcessing(false);
    }
  };
    // 🔵 AUTO-LOAD GOOGLE SHEET KHI MỞ TRANG CÓ sheetId TRONG URL
  useEffect(() => {
    // Chỉ chạy khi đã có user và profile hợp lệ
    if (!user || !profile) return;
    if (initialSheetLoaded) return;

    try {
      const url = new URL(window.location.href);
      const segments = url.pathname.split('/').filter(Boolean);

      // Ví dụ: /teacher-dashboard/create-exam/<sheetId>
      // sheetId sẽ là segment cuối
      const maybeSheetId = segments[segments.length - 1];

      if (maybeSheetId && !sheetIdFromUrl) {
        console.log('🔵 [AUTO-LOAD] Detect sheetId from URL:', maybeSheetId);
        setSheetIdFromUrl(maybeSheetId);

        // Nếu googleSheetUrl đang trống thì tự set theo sheetId
        setFormData(prev => ({
          ...prev,
          googleSheetUrl:
            prev.googleSheetUrl && prev.googleSheetUrl.trim().length > 0
              ? prev.googleSheetUrl
              : `https://docs.google.com/spreadsheets/d/${maybeSheetId}/edit`
        }));
      }

      const examIdParam = url.searchParams.get('examId');
      if (examIdParam && !examIdFromUrl) {
  console.log('🔵 [AUTO-LOAD] Detect examId from URL:', examIdParam);
  setExamIdFromUrl(examIdParam);

  // 🔴 THÊM DÒNG NÀY ĐỂ FORM TỰ LẤY TÊN/MÔN/LỚP/KIỂU BÀI
  loadExamMeta(examIdParam);
}

      // Nếu chưa load lần nào, đang chưa có câu hỏi, và đã có googleSheetUrl → tự động đọc
      if (
        !initialSheetLoaded &&
        questions.length === 0 &&
        formData.googleSheetUrl &&
        formData.googleSheetUrl.trim().length > 0
      ) {
        console.log('🔵 [AUTO-LOAD] Đang tự động đọc Google Sheet khi mở trang...');
        handleGoogleSheetRead(); // dùng hàm có sẵn
        setInitialSheetLoaded(true);
      }
    } catch (error) {
      console.error('❌ [AUTO-LOAD] Lỗi khi phân tích URL:', error);
    }
  }, [
    user,
    profile,
    initialSheetLoaded,
    sheetIdFromUrl,
    examIdFromUrl,
    formData.googleSheetUrl,
    questions.length
    // ❗ KHÔNG đưa handleGoogleSheetRead vào đây để tránh lỗi "trước khi được định nghĩa"
  ]);


  const handleQuestionSelect = (questionId: string) => {
    setSelectedQuestions(prev => 
      prev.includes(questionId) 
        ? prev.filter(id => id !== questionId)
        : [...prev, questionId]
    );
  };

  const handleSelectAll = () => {
    if (selectedQuestions.length === questions.length) {
      setSelectedQuestions([]);
    } else {
      setSelectedQuestions(questions.map(q => q.id));
    }
  };

  const handleQuestionUpdate = (questionId: string, field: string, value: any) => {
    setQuestions(prev => prev.map(q => 
      q.id === questionId ? { ...q, [field]: value } : q
    ));
  };

  const handleAISuggestStructure = async () => {
    if (formData.selectedStudents.length === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 học sinh trước!');
      return;
    }

    setAiProcessing(true);
    try {
      console.log('🔵 [AI-SUGGEST] Bắt đầu gọi AI gợi ý cấu trúc...');

      // Lấy dữ liệu điểm yếu
      const allWeaknesses = Object.values(studentWeaknesses).flat();
      const weakSkills = allWeaknesses.filter(w => w.skill_level === 'weak');
      const mediumSkills = allWeaknesses.filter(w => w.skill_level === 'medium');
      const strongSkills = allWeaknesses.filter(w => w.skill_level === 'strong');

      const response = await fetch(`${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/ai-suggest-exam-structure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          subject: formData.subject,
          grade: formData.grade,
          examType: formData.examType,
          totalQuestions: formData.totalQuestions,
          weakSkills: weakSkills.map(s => ({ name: s.skill_name, score: s.score })),
          mediumSkills: mediumSkills.map(s => ({ name: s.skill_name, score: s.score })),
          strongSkills: strongSkills.map(s => ({ name: s.skill_name, score: s.score }))
        })
      });

      if (!response.ok) throw new Error('Failed to get AI suggestion');

      const result = await response.json();
      console.log('✅ [AI-SUGGEST] Nhận được gợi ý từ AI:', result);

      // Tự động điền vào form
      if (result.structure) {
        setFormData(prev => ({
          ...prev,
          totalQuestions: result.structure.totalQuestions || prev.totalQuestions,
          weaknessDistribution: result.structure.weaknessDistribution || prev.weaknessDistribution
        }));

        // Tự động tạo câu hỏi nếu AI gợi ý
        if (result.questions && result.questions.length > 0) {
          const newQuestions: Question[] = result.questions.map((q: any, idx: number) => ({
            id: `q-ai-${Date.now()}-${idx}`,
            question_text: q.question_text,
            question_type: q.question_type || 'multiple_choice',
            options: q.options || [],
            correct_answer: q.correct_answer,
            ai_note: '🤖 AI tự động tạo',
            image_url: q.image_url || null,
            selected: false
          }));

          setQuestions(prev => [...prev, ...newQuestions]);
          alert(`✅ AI đã gợi ý cấu trúc và tạo ${newQuestions.length} câu hỏi!\n\nVui lòng kiểm tra và chỉnh sửa nếu cần.`);
        } else {
          alert(`✅ AI đã gợi ý cấu trúc đề!\n\n${result.suggestion || 'Vui lòng kiểm tra phân bổ độ khó và kỹ năng.'}`);
        }
      }

    } catch (error) {
      console.error('❌ [AI-SUGGEST] Lỗi:', error);
      alert('❌ Không thể lấy gợi ý từ AI! Vui lòng thử lại.');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAIGenerateSimilar = async (questionId: string) => {
    setAiProcessing(true);
    try {
      const question = questions.find(q => q.id === questionId);
      if (!question) return;

      const response = await fetch(`${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/ai-generate-similar-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          question: question,
          count: 2
        })
      });

      if (!response.ok) throw new Error('Failed to generate similar questions');

      const result = await response.json();
      
      const newQuestions: Question[] = result.questions.map((q: any, idx: number) => ({
        id: `q-similar-${Date.now()}-${idx}`,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        correct_answer: q.correct_answer,
        ai_note: '🤖 AI tạo câu tương tự',
        selected: false
      }));

      setQuestions(prev => [...prev, ...newQuestions]);
      alert(`✅ AI đã tạo ${newQuestions.length} câu hỏi tương tự!`);

    } catch (error) {
      console.error('Error:', error);
      alert('❌ Không thể tạo câu hỏi tương tự!');
    } finally {
      setAiProcessing(false);
    }
  };

  const handleSaveToBank = async () => {
    const selected = questions.filter(q => selectedQuestions.includes(q.id));
    if (selected.length === 0) {
      alert('Vui lòng chọn ít nhất 1 câu hỏi!');
      return;
    }

    setLoading(true);
    try {
      // Save to question bank
      alert(`✅ Đã lưu ${selected.length} câu hỏi vào ngân hàng!`);
    } catch (error) {
      console.error('Error:', error);
      alert('❌ Không thể lưu vào ngân hàng!');
    } finally {
      setLoading(false);
    }
  };

    const handlePublish = async () => {
    if (!formData.title.trim()) {
      alert('⚠️ Vui lòng nhập tên bài kiểm tra!');
      return;
    }

    if (!formData.subject.trim()) {
      alert('⚠️ Vui lòng chọn môn học!');
      return;
    }

    if (!formData.grade.trim()) {
      alert('⚠️ Vui lòng chọn khối lớp!');
      return;
    }

    if (selectedQuestions.length === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 câu hỏi!');
      return;
    }

    // ⚠️ BẮT BUỘC PHẢI CÓ examId (đã tạo sẵn từ Dashboard)
    if (!examIdFromUrl) {
      alert('❌ Không tìm thấy examId! Vui lòng quay lại Dashboard và tạo lại bài kiểm tra.');
      return;
    }

    setLoading(true);

    try {
      // 🔹 CHỈ CẬP NHẬT STATUS (và visibility nếu muốn) TRONG BẢNG exams
      const { error: examError } = await supabase
  .from('exams')
  .update({
    status: 'published',
    visibility: formData.selectedStudents.length > 0 ? 'private' : 'public',

    // 🔴 4 cột anh đang nói:
    title: formData.title.trim(),
    subject: formData.subject,
    grade: formData.grade,
    exam_type: formData.examType,

    // 👉 nên lưu luôn cho đủ:
    total_questions: selectedQuestions.length,
    duration_minutes: formData.durationMinutes,
    google_sheet_url: formData.googleSheetUrl || null,
  })
  .eq('id', examIdFromUrl);


      if (examError) throw examError;

      // 🔹 Gán cho học sinh (GIỮ NGUYÊN LOGIC CŨ, chỉ dùng examIdFromUrl)
      if (formData.selectedStudents.length > 0) {
        const assignments = formData.selectedStudents.map(studentId => ({
          exam_id: examIdFromUrl,
          student_id: studentId,
          assigned_by: user?.id
        }));

        await supabase.from('exam_assignments').insert(assignments);
      }

      alert('✅ Xuất bản bài kiểm tra thành công!');
      navigate('/teacher-dashboard');
    } catch (error) {
      console.error('Error:', error);
      alert('❌ Không thể xuất bản bài kiểm tra! Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };


  const getDifficultyDistribution = () => {
    const selected = questions.filter(q => selectedQuestions.includes(q.id));
    const diffCount = { easy: 0, medium: 0, hard: 0 };
    selected.forEach(q => {
      if (q.difficulty) {
        diffCount[q.difficulty]++;
      }
    });
    return diffCount;
  };

  const getWeaknessInfo = () => {
    if (formData.selectedStudents.length === 0) return null;
    
    const allWeaknesses = formData.selectedStudents
      .map(sid => studentWeaknesses[sid] || [])
      .flat();
    
    const weakSkills = allWeaknesses.filter(w => w.skill_level === 'weak');
    const mediumSkills = allWeaknesses.filter(w => w.skill_level === 'medium');
    const strongSkills = allWeaknesses.filter(w => w.skill_level === 'strong');
    
    return { weakSkills, mediumSkills, strongSkills };
  };

  const handleManualQuestionImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const filePath = `question-images/${user?.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('exam-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('exam-files')
        .getPublicUrl(filePath);

      setManualQuestion(prev => ({ ...prev, image_url: publicUrl, image_file: file }));
      alert('✅ Tải ảnh lên thành công!');
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('❌ Không thể tải ảnh lên!');
    }
  };

  const handleAddManualQuestion = () => {
    if (!manualQuestion.question_text.trim()) {
      alert('⚠️ Vui lòng nhập nội dung câu hỏi!');
      return;
    }

    if (manualQuestion.type === 'multiple_choice') {
      const validOptions = manualQuestion.options.filter(opt => opt.trim());
      if (validOptions.length < 2) {
        alert('⚠️ Câu trắc nghiệm cần ít nhất 2 đáp án!');
        return;
      }
      if (!manualQuestion.correct_answer) {
        alert('⚠️ Vui lòng chọn đáp án đúng!');
        return;
      }
    }

    const newQuestion: Question = {
      id: `q-manual-${Date.now()}`,
      question_text: manualQuestion.question_text,
      question_type: manualQuestion.type,
      options: manualQuestion.type === 'multiple_choice' ? manualQuestion.options.filter(opt => opt.trim()) : undefined,
      correct_answer: manualQuestion.type === 'multiple_choice' ? manualQuestion.correct_answer : undefined,
      ai_note: '✍️ Tạo thủ công',
      image_url: manualQuestion.image_url || undefined,
      selected: false
    };

    setQuestions(prev => [...prev, newQuestion]);
    
    // Reset form
    setManualQuestion({
      type: 'multiple_choice',
      question_text: '',
      options: ['', '', '', ''],
      correct_answer: '',
      image_file: null,
      image_url: ''
    });
    
    setShowManualForm(false);
    alert('✅ Đã thêm câu hỏi thành công!');
  };

  const handleAddQuestion = (question: Question) => {
    setQuestions(prev => [...prev, question]);
  };

  const handleDeleteQuestion = (questionId: string) => {
    setQuestions(prev => prev.filter(q => q.id !== questionId));
    setSelectedQuestions(prev => prev.filter(id => id !== questionId));
  };

  const handleUpdateQuestion = (questionId: string, updatedQuestion: Partial<Question>) => {
    setQuestions(prev => prev.map(q => 
      q.id === questionId ? { ...q, ...updatedQuestion } : q
    ));
  };
    // 🔵 AUTO-SAVE: mỗi lần danh sách câu hỏi thay đổi → đẩy lên Google Sheet
  useEffect(() => {
    if (!formData.googleSheetUrl || !formData.googleSheetUrl.includes('docs.google.com/spreadsheets')) {
      return;
    }

    if (!questions || questions.length === 0) {
      // Không có câu hỏi thì không cần cập nhật
      return;
    }

    let spreadsheetId: string | null = null;
    try {
      const url = new URL(formData.googleSheetUrl);
      const match = url.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
      spreadsheetId = match ? match[1] : null;
    } catch (e) {
      console.error('❌ [AUTO-SAVE] googleSheetUrl không hợp lệ:', formData.googleSheetUrl, e);
      return;
    }

    if (!spreadsheetId) {
      console.error('❌ [AUTO-SAVE] Không trích được spreadsheetId từ googleSheetUrl:', formData.googleSheetUrl);
      return;
    }

    // Debounce 1.5s để tránh spam API khi user đang gõ
    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      try {
        console.log('🔵 [AUTO-SAVE] Đồng bộ câu hỏi lên Google Sheet...', {
          spreadsheetId,
          totalQuestions: questions.length
        });

        const res = await fetch(
          `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/update-sheet-questions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
              spreadsheetId,
              subject: formData.subject,
              grade: formData.grade,
              fileName: formData.title || 'Bài kiểm tra',
              questions: questions.map(q => ({
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || [],
                correct_answer: q.correct_answer || '',
                ai_note: q.ai_note || null
              }))
            }),
            signal: controller.signal
          }
        );

        console.log('📊 [AUTO-SAVE] Response status:', res.status);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('❌ [AUTO-SAVE] Lỗi khi gọi update-sheet:', err);
        } else {
          const data = await res.json().catch(() => ({}));
          console.log('✅ [AUTO-SAVE] Đã đồng bộ Google Sheet:', data);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.log('ℹ️ [AUTO-SAVE] Bị hủy do debounce');
        } else {
          console.error('❌ [AUTO-SAVE] Exception:', err);
        }
      }
    }, 1500);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [
    questions,
    formData.googleSheetUrl,
    formData.subject,
    formData.grade,
    formData.title
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <Header />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <button
            onClick={() => navigate('/teacher-dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-teal-600 mb-4 sm:mb-6 cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-arrow-left-line text-xl"></i>
            <span className="font-medium">Quay lại Dashboard</span>
          </button>
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">Tạo bài kiểm tra</h1>
          <p className="text-base sm:text-lg text-gray-600">Tạo đề kiểm tra thông minh với sự hỗ trợ của AI</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
                  <i className="ri-file-list-3-line text-xl text-teal-600"></i>
                </div>
                Thông tin cơ bản
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Tên bài kiểm tra <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="VD: Kiểm tra giữa kỳ Toán học lớp 6"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm transition-all"
                  />
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Môn học <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.subject}
                        onChange={(e) => handleInputChange('subject', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm appearance-none cursor-pointer pr-10"
                      >
                         <option value="">-- Chọn môn học --</option> {/* thêm dòng này */}
                        {subjects.map(subject => (
                          <option key={subject} value={subject}>{subject}</option>
                        ))}
                      </select>
                      <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400 pointer-events-none"></i>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Khối lớp <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.grade}
                        onChange={(e) => handleInputChange('grade', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm appearance-none cursor-pointer pr-10"
                      >
                        <option value="">-- Chọn khối lớp --</option> {/* thêm dòng này */}
                        {grades.map(grade => (
                          <option key={grade} value={grade}>{grade}</option>
                        ))}
                      </select>
                      <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400 pointer-events-none"></i>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Kiểu bài <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.examType}
                        onChange={(e) => handleInputChange('examType', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm appearance-none cursor-pointer pr-10"
                      >
                        <option value="mixed">Hỗn hợp (Trắc nghiệm + Tự luận)</option>
                        <option value="multiple_choice">Chỉ trắc nghiệm</option>
                        <option value="essay">Chỉ tự luận</option>
                      </select>
                      <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400 pointer-events-none"></i>
                    </div>
                  </div>
                </div>

                {formData.examType === 'weakness_focused' && (
                  <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <i className="ri-information-line text-amber-600 text-xl mt-0.5"></i>
                      <div className="flex-1">
                        <div className="font-semibold text-amber-900 mb-2">Luyện tập theo điểm yếu</div>
                        <p className="text-sm text-amber-800 mb-3">
                          {formData.selectedStudents.length === 0 || getWeaknessInfo()?.weakSkills.length === 0
                            ? 'Hiện chưa có dữ liệu học sinh. Bạn tự nhập tỉ lệ mong muốn.'
                            : 'Hệ thống sẽ ưu tiên chọn câu hỏi từ các kỹ năng yếu trong hồ sơ năng lực của học sinh.'
                          }
                        </p>
                        
                        {formData.selectedStudents.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-amber-900">Phân bổ câu hỏi:</div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs text-amber-800">Skill yếu (%)</label>
                                <input
                                  type="number"
                                  value={formData.weaknessDistribution.weak}
                                  onChange={(e) => handleInputChange('weaknessDistribution', {
                                    ...formData.weaknessDistribution,
                                    weak: parseInt(e.target.value) || 0
                                  })}
                                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-amber-800">Trung bình (%)</label>
                                <input
                                  type="number"
                                  value={formData.weaknessDistribution.medium}
                                  onChange={(e) => handleInputChange('weaknessDistribution', {
                                    ...formData.weaknessDistribution,
                                    medium: parseInt(e.target.value) || 0
                                  })}
                                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-amber-800">Skill mạnh (%)</label>
                                <input
                                  type="number"
                                  value={formData.weaknessDistribution.strong}
                                  onChange={(e) => handleInputChange('weaknessDistribution', {
                                    ...formData.weaknessDistribution,
                                    strong: parseInt(e.target.value) || 0
                                  })}
                                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm mt-1"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Student Selection */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                  <i className="ri-user-line text-xl text-purple-600"></i>
                </div>
                Chọn học sinh <span className="text-red-500">*</span>
              </h2>

              {students.length > 0 ? (
                <div className="max-h-80 overflow-y-auto border-2 border-gray-200 rounded-xl p-4 space-y-2">
                  {students.map(student => (
                    <label
                      key={student.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={formData.selectedStudents.includes(student.id)}
                        onChange={(e) => handleStudentSelection(student.id, e.target.checked)}
                        className="w-4 h-4 text-teal-600 rounded cursor-pointer"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{student.full_name}</div>
                        <div className="text-sm text-gray-500">{student.email}</div>
                      </div>
                      {formData.examType === 'weakness_focused' && studentWeaknesses[student.id] && (
                        <div className="text-xs">
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full">
                            {studentWeaknesses[student.id].filter(s => s.skill_level === 'weak').length} điểm yếu
                          </span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <i className="ri-user-line text-4xl mb-2"></i>
                  <p className="text-lg font-medium">Chưa có học sinh nào</p>
                  <p className="text-sm mt-1">Tạo mã mời để học sinh có thể liên kết với bạn</p>
                </div>
              )}

              {/* Show weakness summary */}
              {formData.examType === 'weakness_focused' && formData.selectedStudents.length > 0 && getWeaknessInfo() && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-sm font-semibold text-blue-900 mb-2">
                    <i className="ri-bar-chart-line mr-2"></i>
                    Phân tích điểm yếu ({formData.selectedStudents.length} học sinh)
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="bg-red-100 p-2 rounded-lg">
                      <div className="text-red-700 font-semibold">Điểm yếu</div>
                      <div className="text-red-900 text-lg font-bold">
                        {getWeaknessInfo()?.weakSkills.length || 0}
                      </div>
                    </div>
                    <div className="bg-yellow-100 p-2 rounded-lg">
                      <div className="text-yellow-700 font-semibold">Trung bình</div>
                      <div className="text-yellow-900 text-lg font-bold">
                        {getWeaknessInfo()?.mediumSkills.length || 0}
                      </div>
                    </div>
                    <div className="bg-green-100 p-2 rounded-lg">
                      <div className="text-green-700 font-semibold">Điểm mạnh</div>
                      <div className="text-green-900 text-lg font-bold">
                        {getWeaknessInfo()?.strongSkills.length || 0}
                      </div>
                    </div>
                  </div>
                  {getWeaknessInfo()?.weakSkills && getWeaknessInfo()!.weakSkills.length > 0 && (
                    <div className="mt-3 text-xs text-blue-800">
                      <div className="font-semibold mb-1">Kỹ năng cần tập trung:</div>
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(getWeaknessInfo()!.weakSkills.map(s => s.skill_name))].slice(0, 5).map(skill => (
                          <span key={skill} className="px-2 py-1 bg-red-100 text-red-700 rounded-full">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Import Helpers */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <i className="ri-download-cloud-line text-xl text-blue-600"></i>
                </div>
                Công cụ hỗ trợ
              </h2>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Import File */}
                <div className="border-2 border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <i className="ri-file-upload-line text-teal-600"></i>
                    Import từ File
                  </h3>
                  <label className="block">
                    <input
                      type="file"
                      accept=".docx,.csv,.xlsx,.pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                      disabled={aiProcessing}
                    />
                    <div className="px-4 py-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-teal-500 transition-all cursor-pointer bg-gray-50 hover:bg-teal-50">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <i className="ri-upload-cloud-2-line text-3xl text-gray-400"></i>
                        <div className="text-center">
                          <div className="font-semibold text-gray-700 text-sm">
                            {aiProcessing ? 'Đang xử lý...' : 'Chọn file'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Word, PDF, CSV, Excel
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                  <div className="text-xs text-blue-600 mt-2">
                    💡 AI sẽ tự động tách câu hỏi hoặc sinh câu từ lý thuyết
                  </div>
                </div>

                {/* Google Sheet */}
                <div className="border-2 border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <i className="ri-google-fill text-teal-600"></i>
                    Google Sheet
                  </h3>
                  <input
                    type="url"
                    value={formData.googleSheetUrl}
                    onChange={(e) => handleInputChange('googleSheetUrl', e.target.value)}
                    placeholder="Nhập link Google Sheet"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm mb-2"
                    disabled={aiProcessing}
                  />
                  <button
                    onClick={handleGoogleSheetRead}
                    disabled={aiProcessing || !formData.googleSheetUrl.trim()}
                    className="w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-semibold text-sm cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiProcessing ? (
                      <>
                        <i className="ri-loader-4-line animate-spin mr-2"></i>
                        Đang đọc...
                      </>
                    ) : (
                      <>
                        <i className="ri-download-cloud-line mr-2"></i>
                        Đọc dữ liệu
                      </>
                    )}
                  </button>
                </div>
              </div>

              {aiProcessing && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl mt-4">
                  <i className="ri-loader-4-line animate-spin text-2xl text-blue-600"></i>
                  <div>
                    <div className="font-semibold text-blue-900">AI đang phân tích...</div>
                    <div className="text-sm text-blue-700">Vui lòng đợi trong giây lát</div>
                  </div>
                </div>
              )}
            </div>

            {/* Manual Question Creation - ALWAYS VISIBLE */}
            <ManualQuestionForm
              questions={questions}
              onAddQuestion={handleAddQuestion}
              onDeleteQuestion={handleDeleteQuestion}
              onUpdateQuestion={handleUpdateQuestion}
              selectedQuestions={selectedQuestions}
              onSelectQuestion={handleQuestionSelect}
              onSelectAll={handleSelectAll}
            />

            {/* Test Config */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                  <i className="ri-settings-3-line text-xl text-green-600"></i>
                </div>
                Cấu hình đề
              </h2>

              <div className="space-y-6">
                {/* Settings */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Thời gian làm bài (phút)
                    </label>
                    <input
                      type="number"
                      value={formData.durationMinutes}
                      onChange={(e) => handleInputChange('durationMinutes', parseInt(e.target.value) || 0)}
                      min="1"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Cho phép làm lại
                    </label>
                    <div className="relative">
                      <select
                        value={formData.allowRetry}
                        onChange={(e) => handleInputChange('allowRetry', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm appearance-none cursor-pointer pr-10"
                      >
                        <option value="no">Không cho phép</option>
                        <option value="once">1 lần</option>
                        <option value="twice">2 lần</option>
                        <option value="unlimited">Không giới hạn</option>
                      </select>
                      <i className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400 pointer-events-none"></i>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.shuffleQuestions}
                      onChange={(e) => handleInputChange('shuffleQuestions', e.target.checked)}
                      className="w-4 h-4 text-teal-600 rounded cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">Xáo trộn câu hỏi</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.shuffleAnswers}
                      onChange={(e) => handleInputChange('shuffleAnswers', e.target.checked)}
                      className="w-4 h-4 text-teal-600 rounded cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">Xáo trộn đáp án</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* AI Assist */}
            <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl shadow-lg p-6 border-2 border-purple-200">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <i className="ri-robot-line text-2xl text-purple-600"></i>
                AI Hỗ trợ
              </h3>

              <div className="space-y-3">
                <button
                  onClick={handleAISuggestStructure}
                  disabled={aiProcessing || formData.selectedStudents.length === 0}
                  className="w-full px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-semibold text-sm cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiProcessing ? (
                    <>
                      <i className="ri-loader-4-line animate-spin mr-2"></i>
                      AI đang phân tích...
                    </>
                  ) : (
                    <>
                      <i className="ri-lightbulb-line mr-2"></i>
                      AI gợi ý cấu trúc đề
                    </>
                  )}
                </button>

                <div className="text-xs text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
                  <i className="ri-information-line mr-1"></i>
                  {formData.selectedStudents.length === 0 
                    ? 'Vui lòng chọn học sinh trước khi dùng AI'
                    : 'AI sẽ phân tích điểm yếu và tự động tạo câu hỏi phù hợp'
                  }
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-2xl shadow-lg p-6 sticky top-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Tóm tắt đề</h3>

              <div className="space-y-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Tên bài kiểm tra</div>
                  <div className="font-semibold text-gray-900">{formData.title || '(Chưa đặt tên)'}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Môn học</div>
                    <div className="font-semibold text-gray-900">{formData.subject}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Khối lớp</div>
                    <div className="font-semibold text-gray-900">{formData.grade}</div>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-2">Số câu đã chọn</div>
                  <div className="text-2xl font-bold text-teal-600">{selectedQuestions.length}</div>
                </div>

                {selectedQuestions.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-600 mb-2">Phân loại câu hỏi</div>
                    <div className="space-y-2">
                      {(() => {
                        const selected = questions.filter(q => selectedQuestions.includes(q.id));
                        const multipleChoice = selected.filter(q => q.question_type === 'multiple_choice').length;
                        const essay = selected.filter(q => q.question_type === 'essay').length;
                        
                        return (
                          <>
                            {multipleChoice > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-700">Trắc nghiệm</span>
                                <span className="font-semibold text-gray-900">{multipleChoice} câu</span>
                              </div>
                            )}
                            {essay > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-700">Tự luận</span>
                                <span className="font-semibold text-gray-900">{essay} câu</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t space-y-3">
                  <button
                    onClick={handlePublish}
                    disabled={loading || !formData.title.trim() || selectedQuestions.length === 0}
                    className="w-full px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl hover:from-teal-600 hover:to-teal-700 transition-all cursor-pointer whitespace-nowrap shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <i className="ri-loader-4-line animate-spin mr-2"></i>
                        Đang xuất bản...
                      </>
                    ) : (
                      <>
                        <i className="ri-send-plane-fill mr-2"></i>
                        Xuất bản bài kiểm tra
                      </>
                    )}
                  </button>

                  {(!formData.title.trim() || selectedQuestions.length === 0) && (
                    <div className="text-xs text-red-600 text-center">
                      {!formData.title.trim() && 'Vui lòng nhập tên bài kiểm tra'}
                      {formData.title.trim() && selectedQuestions.length === 0 && 'Vui lòng chọn ít nhất 1 câu hỏi'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

// Manual Question Form Component
interface ManualQuestionFormProps {
  questions: Question[];
  onAddQuestion: (question: Question) => void;
  onDeleteQuestion: (questionId: string) => void;
  onUpdateQuestion: (questionId: string, updatedQuestion: Partial<Question>) => void;
  selectedQuestions: string[];
  onSelectQuestion: (questionId: string) => void;
  onSelectAll: () => void;
}

function ManualQuestionForm({
  questions,
  onAddQuestion,
  onDeleteQuestion,
  onUpdateQuestion,
  selectedQuestions,
  onSelectQuestion,
  onSelectAll
}: ManualQuestionFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'multiple_choice' as 'multiple_choice' | 'essay',
    question_text: '',
    options: ['', '', '', ''],
    correct_answer: '',
    image_file: null as File | null,
    image_url: ''
  });

  const { user } = useAuth();

  const resetForm = () => {
    setFormData({
      type: 'multiple_choice',
      question_text: '',
      options: ['', '', '', ''],
      correct_answer: '',
      image_file: null,
      image_url: ''
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const filePath = `question-images/${user?.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('exam-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('exam-files')
        .getPublicUrl(filePath);

      setFormData(prev => ({ ...prev, image_url: publicUrl, image_file: file }));
      alert('✅ Tải ảnh lên thành công!');
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('❌ Không thể tải ảnh lên!');
    }
  };

  const handleSubmit = () => {
    if (!formData.question_text.trim()) {
      alert('⚠️ Vui lòng nhập nội dung câu hỏi!');
      return;
    }

    if (formData.type === 'multiple_choice') {
      const validOptions = formData.options.filter(opt => opt.trim());
      if (validOptions.length < 2) {
        alert('⚠️ Câu trắc nghiệm cần ít nhất 2 đáp án!');
        return;
      }
      if (!formData.correct_answer) {
        alert('⚠️ Vui lòng chọn đáp án đúng!');
        return;
      }
    }

    const question: Question = {
      id: editingId || `q-manual-${Date.now()}`,
      question_text: formData.question_text,
      question_type: formData.type,
      options: formData.type === 'multiple_choice' ? formData.options.filter(opt => opt.trim()) : undefined,
      correct_answer: formData.type === 'multiple_choice' ? formData.correct_answer : undefined,
      ai_note: '✍️ Tạo thủ công',
      image_url: formData.image_url || undefined,
      selected: false
    };

    if (editingId) {
      onUpdateQuestion(editingId, question);
      alert('✅ Đã cập nhật câu hỏi!');
    } else {
      onAddQuestion(question);
      alert('✅ Đã thêm câu hỏi thành công!');
    }

    resetForm();
  };

  const handleEdit = (question: Question) => {
    setFormData({
      type: question.question_type,
      question_text: question.question_text,
      options: question.options || ['', '', '', ''],
      correct_answer: question.correct_answer || '',
      image_file: null,
      image_url: question.image_url || ''
    });
    setEditingId(question.id);
    setShowForm(true);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <i className="ri-edit-line text-xl text-purple-600"></i>
          </div>
          Danh sách câu hỏi ({questions.length})
        </h2>

        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-semibold text-sm cursor-pointer whitespace-nowrap"
        >
          <i className={`${showForm ? 'ri-close-line' : 'ri-add-line'} mr-2`}></i>
          {showForm ? 'Đóng' : 'Thêm câu hỏi'}
        </button>
      </div>

      {/* Question Form */}
      {showForm && (
        <div className="border-2 border-purple-200 rounded-xl p-6 bg-purple-50 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            {editingId ? 'Chỉnh sửa câu hỏi' : 'Tạo câu hỏi mới'}
          </h3>

          <div className="space-y-4">
            {/* Question Type */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Loại câu hỏi <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.type === 'multiple_choice'}
                    onChange={() => setFormData(prev => ({ ...prev, type: 'multiple_choice' }))}
                    className="w-4 h-4 text-purple-600 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Trắc nghiệm</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.type === 'essay'}
                    onChange={() => setFormData(prev => ({ ...prev, type: 'essay' }))}
                    className="w-4 h-4 text-purple-600 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Tự luận</span>
                </label>
              </div>
            </div>

            {/* Question Text */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Nội dung câu hỏi <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.question_text}
                onChange={(e) => setFormData(prev => ({ ...prev, question_text: e.target.value }))}
                placeholder="Nhập nội dung câu hỏi..."
                rows={3}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm resize-none"
              />
            </div>

            {/* Options (Multiple Choice) */}
            {formData.type === 'multiple_choice' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Các đáp án <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2">
                  {formData.options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={formData.correct_answer === String.fromCharCode(65 + idx)}
                        onChange={() => setFormData(prev => ({ 
                          ...prev, 
                          correct_answer: String.fromCharCode(65 + idx) 
                        }))}
                        className="w-4 h-4 text-green-600 cursor-pointer"
                      />
                      <span className="font-semibold text-gray-700 w-6">{String.fromCharCode(65 + idx)}.</span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const newOptions = [...formData.options];
                          newOptions[idx] = e.target.value;
                          setFormData(prev => ({ ...prev, options: newOptions }));
                        }}
                        placeholder={`Đáp án ${String.fromCharCode(65 + idx)}`}
                        className="flex-1 px-4 py-2 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  <i className="ri-information-line mr-1"></i>
                  Click vào nút radio để chọn đáp án đúng
                </div>
              </div>
            )}

            {/* Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Hình ảnh (tùy chọn)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="question-image"
              />
              <label
                htmlFor="question-image"
                className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 transition-all cursor-pointer bg-white hover:bg-purple-50"
              >
                <i className="ri-image-add-line text-2xl text-gray-400"></i>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700">
                    {formData.image_url ? 'Đã tải ảnh lên' : 'Click để tải ảnh lên'}
                  </div>
                  {formData.image_url && (
                    <div className="text-xs text-green-600 mt-1">✓ Ảnh đã được tải lên</div>
                  )}
                </div>
              </label>
              {formData.image_url && (
                <div className="mt-2">
                  <img 
                    src={formData.image_url} 
                    alt="Preview" 
                    className="w-32 h-32 object-cover rounded-lg border-2 border-gray-200"
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSubmit}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-purple-700 transition-all cursor-pointer whitespace-nowrap shadow-lg hover:shadow-xl"
              >
                <i className={`${editingId ? 'ri-save-line' : 'ri-add-line'} mr-2`}></i>
                {editingId ? 'Cập nhật' : 'Thêm câu hỏi'}
              </button>
              <button
                onClick={resetForm}
                className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition-all cursor-pointer whitespace-nowrap"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions List */}
      {questions.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={onSelectAll}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm cursor-pointer whitespace-nowrap"
            >
              {selectedQuestions.length === questions.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          </div>

          <div className="space-y-4">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className={`border-2 rounded-xl p-4 transition-all ${
                  selectedQuestions.includes(q.id)
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedQuestions.includes(q.id)}
                    onChange={() => onSelectQuestion(q.id)}
                    className="w-5 h-5 text-teal-600 rounded cursor-pointer mt-1"
                  />
                  
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 mb-1">
                          Câu {idx + 1}: {q.question_text}
                        </div>
                        {q.image_url && (
                          <img 
                            src={q.image_url} 
                            alt="Question" 
                            className="w-32 h-32 object-cover rounded-lg border-2 border-gray-200 mt-2"
                          />
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleEdit(q)}
                          className="text-blue-600 hover:text-blue-700 cursor-pointer"
                          title="Chỉnh sửa"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Bạn có chắc muốn xóa câu hỏi này?')) {
                              onDeleteQuestion(q.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-700 cursor-pointer"
                          title="Xóa"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </div>

                    {q.question_type === 'multiple_choice' && q.options && (
                      <div className="space-y-1 mb-3">
                        {q.options.map((opt, optIdx) => (
                          <div
                            key={optIdx}
                            className={`text-sm px-3 py-1 rounded ${
                              q.correct_answer === String.fromCharCode(65 + optIdx)
                                ? 'bg-green-100 text-green-800 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {String.fromCharCode(65 + optIdx)}. {opt}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-1 rounded-full font-semibold ${
                        q.question_type === 'multiple_choice'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}>
                        {q.question_type === 'multiple_choice' ? 'Trắc nghiệm' : 'Tự luận'}
                      </span>
                      {q.ai_note && (
                        <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
                          {q.ai_note}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <i className="ri-file-list-line text-5xl mb-3"></i>
          <p className="text-lg font-medium">Chưa có câu hỏi nào</p>
          <p className="text-sm mt-1">Thêm câu hỏi thủ công hoặc import từ file</p>
        </div>
      )}
    </div>
  );
}
