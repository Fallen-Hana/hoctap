import { useState, useEffect } from 'react';
import Header from '../../components/feature/Header';
import Footer from '../../components/feature/Footer';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, generateCode } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import ContactsList from './components/ContactsList';

interface TeacherCode {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  status: string;
  used_by: string | null;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

interface Exam {
  id: string;
  title: string;
  subject: string;
  grade: string;
  exam_type: string;
  visibility: string;
  status: string;
  total_questions: number;
  duration_minutes: number;
  google_sheet_url: string | null;
  google_form_url: string | null;
  created_at: string;
  assigned_to: string;
}

export default function TeacherDashboard() {
  const [students, setStudents] = useState<Student[]>([]);
  const [teacherCodes, setTeacherCodes] = useState<TeacherCode[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [showDeleteCodeModal, setShowDeleteCodeModal] = useState(false);
  const [showEditCodeModal, setShowEditCodeModal] = useState(false);
  const [newCode, setNewCode] = useState<string>('');
  const [codeToDelete, setCodeToDelete] = useState<string | null>(null);
  const [codeToEdit, setCodeToEdit] = useState<TeacherCode | null>(null);
  const [codeExpiryDays, setCodeExpiryDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'students' | 'exams' | 'contacts'>('students');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [examToDelete, setExamToDelete] = useState<string | null>(null);
  const [creatingExam, setCreatingExam] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || !profile) {
      navigate('/login');
      return;
    }

    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      navigate('/');
      return;
    }

    loadData();
  }, [user, profile]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStudents(),
        loadTeacherCodes(),
        loadExams()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

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
            email,
            avatar_url
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

  const loadTeacherCodes = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('teacher_codes')
        .select('*')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTeacherCodes(data || []);
    } catch (error) {
      console.error('Error loading teacher codes:', error);
    }
  };

  const loadExams = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('exams')
        .select('*')
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExams(data || []);
    } catch (error) {
      console.error('Error loading exams:', error);
    }
  };

  const generateTeacherCode = async () => {
    if (!user) return;

    try {
      const code = generateCode(6);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + codeExpiryDays);

      const { data, error } = await supabase
        .from('teacher_codes')
        .insert({
          teacher_id: user.id,
          code: code,
          expires_at: expiresAt.toISOString(),
          status: 'active'
        })
        .select()
        .single();

      if (error) throw error;

      setNewCode(code);
      setShowCodeModal(true);
      loadTeacherCodes();
    } catch (error) {
      console.error('Error generating code:', error);
      alert('Không thể tạo mã. Vui lòng thử lại!');
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    alert('Đã sao chép mã!');
  };

  const confirmDeleteCode = (codeId: string) => {
    setCodeToDelete(codeId);
    setShowDeleteCodeModal(true);
  };

  const deleteCode = async () => {
    if (!codeToDelete) return;

    console.log('🔵 [TEACHER-DASHBOARD] Bắt đầu xóa mã mời:', codeToDelete);

    try {
      const { error } = await supabase
        .from('teacher_codes')
        .delete()
        .eq('id', codeToDelete);

      if (error) {
        console.error('❌ [TEACHER-DASHBOARD] Lỗi xóa mã:', error);
        throw error;
      }

      console.log('✅ [TEACHER-DASHBOARD] Đã xóa mã mời thành công');
      alert('✅ Đã xóa mã mời!');
      setShowDeleteCodeModal(false);
      setCodeToDelete(null);
      
      // Reload data ngay lập tức
      await loadTeacherCodes();
    } catch (error) {
      console.error('❌ [TEACHER-DASHBOARD] Lỗi tổng thể:', error);
      alert('❌ Không thể xóa mã mời!');
    }
  };

  const openEditCodeModal = (code: TeacherCode) => {
    setCodeToEdit(code);
    setShowEditCodeModal(true);
  };

  const updateCodeExpiry = async () => {
    if (!codeToEdit) return;

    console.log('🔵 [TEACHER-DASHBOARD] Bắt đầu cập nhật mã mời:', codeToEdit.id);

    try {
      const newExpiresAt = new Date(codeToEdit.expires_at);
      
      const { error } = await supabase
        .from('teacher_codes')
        .update({ 
          expires_at: newExpiresAt.toISOString(),
          status: new Date() > newExpiresAt ? 'expired' : 'active'
        })
        .eq('id', codeToEdit.id);

      if (error) {
        console.error('❌ [TEACHER-DASHBOARD] Lỗi cập nhật mã:', error);
        throw error;
      }

      console.log('✅ [TEACHER-DASHBOARD] Đã cập nhật thời hạn mã mời thành công');
      alert('✅ Đã cập nhật thời hạn mã mời!');
      setShowEditCodeModal(false);
      setCodeToEdit(null);
      
      // Reload data ngay lập tức
      await loadTeacherCodes();
    } catch (error) {
      console.error('❌ [TEACHER-DASHBOARD] Lỗi tổng thể:', error);
      alert('❌ Không thể cập nhật mã mời!');
    }
  };

  const toggleExamVisibility = async (examId: string, currentVisibility: string) => {
    try {
      const newVisibility = currentVisibility === 'public' ? 'private' : 'public';
      
      const { error } = await supabase
        .from('exams')
        .update({ visibility: newVisibility })
        .eq('id', examId);

      if (error) throw error;

      alert(newVisibility === 'public' 
        ? '✅ Đã đưa bài kiểm tra lên trang Khám học lực miễn phí!' 
        : '✅ Đã ẩn bài kiểm tra khỏi trang công khai!');
      
      loadExams();
    } catch (error) {
      console.error('Error toggling visibility:', error);
      alert('❌ Không thể thay đổi trạng thái!');
    }
  };

  const confirmDeleteExam = (examId: string) => {
    setExamToDelete(examId);
    setShowDeleteModal(true);
  };

  const deleteExam = async () => {
  if (!examToDelete) return;

  try {
    // Tìm exam trong state để lấy google_sheet_url (nếu có)
    const exam = exams.find((e) => e.id === examToDelete);

    // 🔵 THỬ XOÁ FILE GOOGLE SHEET TRƯỚC (nếu có link)
    if (exam?.google_sheet_url) {
      try {
        console.log('🔵 [DELETE-EXAM] Thử xoá file Google Sheet:', exam.google_sheet_url);

        const res = await fetch(
          `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/delete-exam-sheet`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              googleSheetUrl: exam.google_sheet_url,
            }),
          }
        );

        console.log('📊 [DELETE-EXAM] delete-exam-sheet status:', res.status);

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('❌ [DELETE-EXAM] Lỗi xoá file Google Sheet:', data);
          // Không throw để vẫn tiếp tục xoá DB
        } else {
          console.log('✅ [DELETE-EXAM] Đã xoá file Google Sheet (hoặc không tồn tại):', data);
        }
      } catch (sheetErr) {
        console.error('❌ [DELETE-EXAM] Exception khi gọi delete-exam-sheet:', sheetErr);
        // Không throw – vẫn xoá DB cho chắc
      }
    } else {
      console.log(
        'ℹ️ [DELETE-EXAM] Không có google_sheet_url cho exam này, bỏ qua bước xoá file.',
      );
    }

    // 🔴 PHẦN DƯỚI GIỮ NGUYÊN LOGIC CŨ: XOÁ TRONG DATABASE

    // Xóa assignments trước
    await supabase
      .from('exam_assignments')
      .delete()
      .eq('exam_id', examToDelete);

    // Xóa exam files
    await supabase
      .from('exam_files')
      .delete()
      .eq('exam_id', examToDelete);

    // Xóa exam
    const { error } = await supabase
      .from('exams')
      .delete()
      .eq('id', examToDelete);

    if (error) throw error;

    alert('✅ Đã xóa bài kiểm tra!');
    setShowDeleteModal(false);
    setExamToDelete(null);
    loadExams();
  } catch (error) {
    console.error('Error deleting exam:', error);
    alert('❌ Không thể xóa bài kiểm tra!');
  }
};

  const handleCreateExam = async () => {
    if (!user) return;

    setCreatingExam(true);
    try {
      console.log('🔵 [CREATE-EXAM] Bắt đầu tạo bài kiểm tra...');

      // 1. Gọi Edge Function để tạo Google Sheet rỗng
      const response = await fetch(
        `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/create-empty-sheet`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            teacherId: user.id,
            examTitle: 'Bài kiểm tra mới',
            subject: 'Toán học',
            grade: 'Lớp 6'
          })
        }
      );

      console.log('📊 [CREATE-EXAM] Response status:', response.status);

      if (!response.ok) {
        let errorMessage = 'Không thể tạo Google Sheet!\n\n';
        
        try {
          const errorData = await response.json();
          console.error('❌ [CREATE-EXAM] Error data:', errorData);
          errorMessage += `Lỗi: ${errorData.error || 'Unknown error'}\n\n`;
        } catch {
          const errorText = await response.text();
          console.error('❌ [CREATE-EXAM] Error text:', errorText);
          errorMessage += `HTTP ${response.status}: ${errorText}\n\n`;
        }
        
        errorMessage += 'Vui lòng kiểm tra:\n';
        errorMessage += '1. Google API credentials đã được cấu hình trong Supabase chưa?\n';
        errorMessage += '2. Token còn hiệu lực không?\n';
        errorMessage += '3. Google Sheets API đã được enable chưa?';
        
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('📊 [CREATE-EXAM] Result:', result);

      if (!result.success) {
        throw new Error(result.error || 'Không thể tạo Google Sheet!');
      }

      if (!result.spreadsheetId || !result.sheetUrl || !result.examId) {
        console.error('❌ [CREATE-EXAM] Missing data:', result);
        throw new Error('Dữ liệu trả về không đầy đủ! Vui lòng thử lại.');
      }

      console.log('✅ [CREATE-EXAM] Đã tạo Google Sheet:', result.spreadsheetId);
      console.log('✅ [CREATE-EXAM] Exam ID:', result.examId);

      // 2. Chuyển đến trang create-exam với sheetId và examId
      navigate(`/teacher-dashboard/create-exam/${result.spreadsheetId}?examId=${result.examId}`);

    } catch (error: any) {
      console.error('❌ [CREATE-EXAM] Lỗi:', error);
      alert(error.message || '❌ Không thể tạo bài kiểm tra! Vui lòng thử lại.');
    } finally {
      setCreatingExam(false);
    }
  };

  const getExamTypeLabel = (type: string) => {
    switch (type) {
      case 'general': return 'Tổng quát';
      case 'weakness': return 'Điểm yếu';
      case 'chapter': return 'Chương/Bài';
      default: return type;
    }
  };

  const getSubjectColor = (subject: string) => {
    const colors: { [key: string]: string } = {
      'Toán học': 'bg-blue-100 text-blue-700',
      'Ngữ văn': 'bg-red-100 text-red-700',
      'Tiếng Anh': 'bg-green-100 text-green-700',
      'Vật lý': 'bg-purple-100 text-purple-700',
      'Hóa học': 'bg-yellow-100 text-yellow-700',
      'Sinh học': 'bg-teal-100 text-teal-700',
      'Lịch sử': 'bg-orange-100 text-orange-700',
      'Địa lý': 'bg-indigo-100 text-indigo-700',
      'Tổng hợp': 'bg-gray-100 text-gray-700'
    };
    return colors[subject] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Trang tổng quan Giáo viên</h1>
          <p className="text-gray-600">Quản lý và theo dõi tiến trình học sinh</p>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <i className="ri-user-star-line text-3xl text-white"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Chào mừng, {profile?.full_name}!</h2>
                <p className="text-sm text-gray-600">
                  {students.length} học sinh đang liên kết
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={generateTeacherCode}
                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-key-line mr-2"></i>
                Tạo mã mời
              </button>
              <button 
                onClick={handleCreateExam}
                disabled={creatingExam}
                className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingExam ? (
                  <>
                    <i className="ri-loader-4-line mr-2 animate-spin"></i>
                    Đang tạo...
                  </>
                ) : (
                  <>
                    <i className="ri-file-add-line mr-2"></i>
                    Tạo bài kiểm tra
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Teacher Codes Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Mã mời giáo viên</h2>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600">Thời hạn:</label>
              <select
                value={codeExpiryDays}
                onChange={(e) => setCodeExpiryDays(parseInt(e.target.value))}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer pr-8"
              >
                <option value={7}>7 ngày</option>
                <option value={14}>14 ngày</option>
                <option value={30}>30 ngày</option>
                <option value={60}>60 ngày</option>
                <option value={90}>90 ngày</option>
              </select>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Chia sẻ mã này với phụ huynh hoặc học sinh để họ có thể liên kết với bạn
          </p>
          
          {teacherCodes.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {teacherCodes.map(code => {
                const isExpired = new Date() > new Date(code.expires_at);
                return (
                  <div key={code.id} className="p-4 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl font-bold text-purple-600">{code.code}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => copyCode(code.code)}
                          className="p-2 hover:bg-white/50 rounded-lg cursor-pointer"
                          title="Sao chép"
                        >
                          <i className="ri-file-copy-line text-purple-600"></i>
                        </button>
                        <button
                          onClick={() => openEditCodeModal(code)}
                          className="p-2 hover:bg-white/50 rounded-lg cursor-pointer"
                          title="Chỉnh sửa thời hạn"
                        >
                          <i className="ri-edit-line text-blue-600"></i>
                        </button>
                        <button
                          onClick={() => confirmDeleteCode(code.id)}
                          className="p-2 hover:bg-white/50 rounded-lg cursor-pointer"
                          title="Xóa mã"
                        >
                          <i className="ri-delete-bin-line text-red-600"></i>
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600">
                      <p>Tạo: {new Date(code.created_at).toLocaleDateString('vi-VN')}</p>
                      <p>Hết hạn: {new Date(code.expires_at).toLocaleDateString('vi-VN')}</p>
                      <p className="mt-1">
                        <span className={`px-2 py-0.5 rounded-full ${
                          isExpired ? 'bg-red-100 text-red-700' :
                          code.status === 'active' ? 'bg-green-100 text-green-700' : 
                          code.status === 'used' ? 'bg-blue-100 text-blue-700' : 
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {isExpired ? 'Hết hạn' :
                           code.status === 'active' ? 'Đang hoạt động' : 
                           code.status === 'used' ? 'Đã sử dụng' : 'Hết hạn'}
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <i className="ri-key-line text-4xl mb-2"></i>
              <p className="text-sm">Chưa có mã mời nào</p>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <i className="ri-user-line text-2xl text-blue-600"></i>
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{students.length}</div>
            <div className="text-sm text-gray-600">Học sinh liên kết</div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <i className="ri-file-list-3-line text-2xl text-green-600"></i>
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{exams.length}</div>
            <div className="text-sm text-gray-600">Bài kiểm tra</div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <i className="ri-global-line text-2xl text-purple-600"></i>
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {exams.filter(e => e.visibility === 'public').length}
            </div>
            <div className="text-sm text-gray-600">Bài công khai</div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <i className="ri-key-line text-2xl text-orange-600"></i>
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {teacherCodes.filter(c => c.status === 'active' && new Date() <= new Date(c.expires_at)).length}
            </div>
            <div className="text-sm text-gray-600">Mã mời hoạt động</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Tab Switcher */}
            <div className="bg-white rounded-xl shadow-sm p-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('exams')}
                  className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'exams'
                      ? 'bg-teal-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <i className="ri-file-list-3-line mr-2"></i>
                  Bài kiểm tra ({exams.length})
                </button>
                <button
                  onClick={() => setActiveTab('contacts')}
                  className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'contacts'
                      ? 'bg-teal-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <i className="ri-contacts-line mr-2"></i>
                  Danh sách liên hệ
                </button>
              </div>
            </div>

            {/* Exams List */}
            {activeTab === 'exams' && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Bài kiểm tra đã tạo</h2>
                  <button
                    onClick={handleCreateExam}
                    disabled={creatingExam}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creatingExam ? (
                      <>
                        <i className="ri-loader-4-line mr-2 animate-spin"></i>
                        Đang tạo...
                      </>
                    ) : (
                      <>
                        <i className="ri-add-line mr-2"></i>
                        Tạo mới
                      </>
                    )}
                  </button>
                </div>

                {exams.length > 0 ? (
                  <div className="space-y-4">
                    {exams.map((exam) => (
                      <div key={exam.id} className="p-5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-bold text-gray-900 text-lg">{exam.title}</h3>
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getSubjectColor(exam.subject)}`}>
                                {exam.subject}
                              </span>
                              {exam.status === 'draft' && (
                                <span className="px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
                                  Bản nháp
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                              <span><i className="ri-bookmark-line mr-1"></i>{exam.grade}</span>
                              <span><i className="ri-file-list-line mr-1"></i>{getExamTypeLabel(exam.exam_type)}</span>
                              <span><i className="ri-question-line mr-1"></i>{exam.total_questions} câu</span>
                              {exam.duration_minutes > 0 && (
                                <span><i className="ri-time-line mr-1"></i>{exam.duration_minutes} phút</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                exam.visibility === 'public' 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-gray-200 text-gray-700'
                              }`}>
                                {exam.visibility === 'public' ? 'Công khai' : 'Riêng tư'}
                              </span>
                              <span className="text-xs text-gray-500">
                                Tạo: {new Date(exam.created_at).toLocaleDateString('vi-VN')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
                          {exam.google_sheet_url && (
                            <a
                              href={exam.google_sheet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-all cursor-pointer whitespace-nowrap"
                            >
                              <i className="ri-external-link-line mr-1"></i>
                              Mở Google Sheet
                            </a>
                          )}
                          {exam.status === 'published' && (
                            <button
                              onClick={() => toggleExamVisibility(exam.id, exam.visibility)}
                              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                                exam.visibility === 'public'
                                  ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                  : 'bg-green-600 text-white hover:bg-green-700'
                              }`}
                            >
                              <i className={`${exam.visibility === 'public' ? 'ri-eye-off-line' : 'ri-global-line'} mr-1`}></i>
                              {exam.visibility === 'public' ? 'Ẩn khỏi công khai' : 'Đưa lên công khai'}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const sheetId = exam.google_sheet_url?.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
                              if (sheetId) {
                                navigate(`/teacher-dashboard/create-exam/${sheetId}?examId=${exam.id}`);
                              } else {
                                alert('❌ Không tìm thấy Google Sheet ID!');
                              }
                            }}
                            className="px-3 py-1.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 transition-all cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-edit-line mr-1"></i>
                            Chỉnh sửa
                          </button>
                          <button
                            onClick={() => confirmDeleteExam(exam.id)}
                            className="px-3 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-all cursor-pointer whitespace-nowrap"
                          >
                            <i className="ri-delete-bin-line mr-1"></i>
                            Xóa
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <i className="ri-file-list-3-line text-5xl mb-3"></i>
                    <p className="text-lg font-medium">Chưa có bài kiểm tra</p>
                    <p className="text-sm mt-2 mb-4">Tạo bài kiểm tra đầu tiên để bắt đầu</p>
                    <button
                      onClick={handleCreateExam}
                      disabled={creatingExam}
                      className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {creatingExam ? (
                        <>
                          <i className="ri-loader-4-line mr-2 animate-spin"></i>
                          Đang tạo...
                        </>
                      ) : (
                        <>
                          <i className="ri-add-line mr-2"></i>
                          Tạo bài kiểm tra
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Contacts List */}
            {activeTab === 'contacts' && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Danh sách liên hệ</h2>
                  <p className="text-sm text-gray-600">Phụ huynh và học sinh đã nhập mã</p>
                </div>

                <ContactsList teacherId={user?.id || ''} />
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* AI Assistant */}
            <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl shadow-sm p-6 text-white">
              <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mb-4">
                <i className="ri-robot-2-line text-2xl"></i>
              </div>
              <h3 className="text-lg font-bold mb-2">AI Hỗ trợ giáo viên</h3>
              <p className="text-sm text-blue-100 mb-4">Tự động tạo lộ trình học tập cho học sinh dựa trên kết quả đánh giá</p>
              <button 
                onClick={() => navigate('/services/lo-trinh-hoc-tap')}
                className="w-full px-4 py-2.5 bg-white text-blue-600 font-semibold rounded-lg hover:bg-blue-50 transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-magic-line mr-2"></i>
                Tạo lộ trình học tập
              </button>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Thao tác nhanh</h3>
              <div className="space-y-3">
                <button 
                  onClick={handleCreateExam}
                  disabled={creatingExam}
                  className="w-full px-4 py-3 bg-green-50 text-green-700 font-semibold rounded-lg hover:bg-green-100 transition-all text-left cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingExam ? (
                    <>
                      <i className="ri-loader-4-line mr-2 animate-spin"></i>
                      Đang tạo...
                    </>
                  ) : (
                    <>
                      <i className="ri-file-add-line mr-2"></i>
                      Tạo bài kiểm tra
                    </>
                  )}
                </button>
                <button 
                  onClick={generateTeacherCode}
                  className="w-full px-4 py-3 bg-purple-50 text-purple-700 font-semibold rounded-lg hover:bg-purple-100 transition-all text-left cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-key-line mr-2"></i>
                  Tạo mã mời mới
                </button>
                <button 
                  onClick={() => navigate('/ai-chat')}
                  className="w-full px-4 py-3 bg-blue-50 text-blue-700 font-semibold rounded-lg hover:bg-blue-100 transition-all text-left cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-chat-3-line mr-2"></i>
                  Chat với AI
                </button>
                <button className="w-full px-4 py-3 bg-orange-50 text-orange-700 font-semibold rounded-lg hover:bg-orange-100 transition-all text-left cursor-pointer whitespace-nowrap">
                  <i className="ri-file-chart-line mr-2"></i>
                  Xem báo cáo
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Code Modal */}
      {showCodeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-check-line text-3xl text-green-600"></i>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Mã mời đã được tạo!</h3>
              <p className="text-gray-600 mb-6">Chia sẻ mã này với phụ huynh hoặc học sinh</p>
              
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-6 mb-6">
                <div className="text-4xl font-bold text-purple-600 mb-2">{newCode}</div>
                <button
                  onClick={() => copyCode(newCode)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer"
                >
                  <i className="ri-file-copy-line mr-2"></i>
                  Sao chép mã
                </button>
              </div>

              <button
                onClick={() => setShowCodeModal(false)}
                className="w-full px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Code Confirmation Modal */}
      {showDeleteCodeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-alert-line text-3xl text-red-600"></i>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Xác nhận xóa mã mời</h3>
              <p className="text-gray-600 mb-6">
                Bạn có chắc chắn muốn xóa mã mời này? Hành động này không thể hoàn tác.
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteCodeModal(false);
                    setCodeToDelete(null);
                  }}
                  className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  onClick={deleteCode}
                  className="flex-1 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 cursor-pointer"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Code Expiry Modal */}
      {showEditCodeModal && codeToEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-edit-line text-3xl text-blue-600"></i>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Chỉnh sửa thời hạn</h3>
              <p className="text-gray-600 mb-6">Mã: <span className="font-bold text-purple-600">{codeToEdit.code}</span></p>
              
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2 text-left">
                  Ngày hết hạn
                </label>
                <input
                  type="date"
                  value={codeToEdit.expires_at.split('T')[0]}
                  onChange={(e) => setCodeToEdit({
                    ...codeToEdit,
                    expires_at: new Date(e.target.value).toISOString()
                  })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowEditCodeModal(false);
                    setCodeToEdit(null);
                  }}
                  className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  onClick={updateCodeExpiry}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Exam Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-alert-line text-3xl text-red-600"></i>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Xác nhận xóa</h3>
              <p className="text-gray-600 mb-6">
                Bạn có chắc chắn muốn xóa bài kiểm tra này? Hành động này không thể hoàn tác.
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setExamToDelete(null);
                  }}
                  className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  onClick={deleteExam}
                  className="flex-1 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 cursor-pointer"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}