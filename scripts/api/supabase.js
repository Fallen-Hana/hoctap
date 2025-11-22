import { SB_URL, SB_ANON, IMAGE_BUCKET } from "../env.js";

export const sb = window.supabase.createClient(SB_URL, SB_ANON);

// Conversations
export async function createConversation(studentId, title="Cuộc trò chuyện mới") {
  const { data, error } = await sb.from("conversations")
    .insert({ student_id: studentId, title })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function listConversations(studentId, limit=200) {
  const { data, error } = await sb.from("conversations")
    .select("id,title,created_at,updated_at")
    .eq("student_id", studentId)
    .order("updated_at", { ascending:false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function touchConversation(convId) {
  await sb.from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", convId);
}

export async function deleteConversationDB(convId) {
  await sb.from("messages").delete().eq("conversation_id", convId);
  await sb.from("conversations").delete().eq("id", convId);
}

// Messages
// ĐỌC tin nhắn: chuyển JSONB -> { role, message, image_url } cho UI
// ĐỌC: trả về { role: "user"|"ai", message: string, image_url?: string }
export async function listMessages(convId) {
  const { data, error } = await sb
    .from("messages")
    .select("message,image_url")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => {
    const payload = row?.message;

    // MẶC ĐỊNH
    let role = "user";
    let text = "";

    if (payload && typeof payload === "object") {
      // ===== KIỂU MỚI: {type, content} =====
      if (payload.type) {
        role = payload.type === "human" ? "user" : "ai";
        text = payload.content ?? "";
      }
      // ===== KIỂU CŨ: {role, message} =====
      else if (payload.role || payload.message) {
        role = payload.role === "assistant" ? "ai" : "user";
        text = payload.message ?? "";
      }
      // ===== Dự phòng: object lạ =====
      else {
        text = String(payload ?? "");
      }
    } else {
      // Chuỗi cũ thuần text
      text = payload ?? "";
      role = "user";
    }

    return { role, message: text, image_url: row.image_url };
  });
}



// GHI tin nhắn: luôn lưu JSONB {type, content}
export async function addMessage({
  convId,
  studentId,
  role,        // "user" | "ai"
  content,
  message,
  imageUrl = null,
}) {
  const text = content ?? message ?? "";
  const row = {
    conversation_id: convId,
    student_id:      studentId,
    message: { type: role === "user" ? "human" : "ai", content: text },
  };
  if (imageUrl) row.image_url = imageUrl;

  const { error } = await sb.from("messages").insert(row);
  if (error) throw error;
  return true; // hoặc trả về id nếu bạn muốn:
  // const { data, error } = await sb.from("messages").insert(row).select("id").single();
  // if (error) throw error; return data.id;
}



export async function getImagesOfConversation(convId) {
  const { data, error } = await sb.from("messages")
    .select("image_url").eq("conversation_id", convId);
  if (error) throw error;
  return (data || []).map(m => m.image_url).filter(Boolean);
}

// Storage
export async function uploadImage(file, studentId) {
  const fileName = `${studentId}_${Date.now()}_${file.name || "paste.png"}`;
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(fileName, file, { upsert:true });
  if (error) throw error;
  return `${SB_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${fileName}`;
}

export async function removeImagesByPaths(paths) {
  if (!paths.length) return;
  const { error } = await sb.storage.from(IMAGE_BUCKET).remove(paths);
  if (error) throw error;
}
// Lấy URL ảnh của các message có session_id bắt đầu bằng `${studentId}:${convId}`
export async function getImagesBySessionPrefix(sessionPrefix) {
  const { data, error } = await sb
    .from("messages")
    .select("image_url")
    .like("session_id", `${sessionPrefix}%`);
  if (error) throw error;
  return (data || []).map(r => r.image_url).filter(Boolean);
}

// Xoá các message có session_id bắt đầu bằng `${studentId}:${convId}`
export async function deleteMessagesBySessionPrefix(sessionPrefix) {
  const { error } = await sb
    .from("messages")
    .delete()
    .like("session_id", `${sessionPrefix}%`);
  if (error) throw error;
  return true;
}
