import {
  listConversations,
  deleteConversationDB,
  getImagesOfConversation,
  removeImagesByPaths,
  touchConversation,
  listMessages,
  // ↓↓↓ THÊM 2 HÀM MỚI
  getImagesBySessionPrefix,
  deleteMessagesBySessionPrefix,
} from "../api/supabase.js";

import { setActiveConversationId, store } from "../state/store.js";
import { clearChatUI, addBubble, addImageBubble } from "../ui/chatUI.js";
import { showToast } from "../ui/toast.js";

/**
 * CHÚ Ý:
 * - File này KHÔNG tự tạo conversation khi danh sách rỗng.
 * - Chỉ render danh sách, mở hội thoại có sẵn, hoặc xoá.
 */

const convListEl = document.getElementById("convList");

/** Không tạo mới; chỉ trả về id hiện có (nếu có) */
export async function ensureConversation() {
  return store.activeConversationId || null;
}

export async function refreshConversations(onOpen) {
  const rows = await listConversations(store.student.id);

  convListEl.innerHTML = "";
  rows.forEach((c) => {
    const row = document.createElement("div");
    row.className = "flex items-start gap-2 mb-1";

    const btn = document.createElement("button");
    btn.className =
      "w-full text-left px-2 py-2 rounded hover:bg-gray-700 " +
      (c.id === store.activeConversationId ? "bg-gray-800" : "");
    btn.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="truncate">${c.title || "(Không tên)"}</div>
        <button class="row-btn text-red-400 hover:text-red-300" title="Xoá" data-del="${c.id}">🗑</button>
      </div>
      <div class="text-xs text-gray-400">${new Date(
        c.updated_at || c.created_at
      ).toLocaleString()}</div>
    `;

    btn.onclick = async (e) => {
      const delId = e.target?.dataset?.del;
      if (delId) {
        if (store.isWaiting) return;
        if (confirm("Xoá toàn bộ cuộc trò chuyện này?")) {
          try {
            // Xoá ảnh trong Storage
            const urls = await getImagesOfConversation(delId);
            const marker = "/" + "chat-images" + "/";
            const paths = Array.from(
              new Set(
                urls
                  .map((u) => {
                    try {
                      const x = new URL(u);
                      const path = decodeURIComponent(x.pathname || "");
                      const i = path.indexOf(marker);
                      if (i === -1) return null;
                      return path.substring(i + marker.length);
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean)
              )
            );
            if (paths.length) await removeImagesByPaths(paths);
            // ===== THÊM: xoá phần do n8n ghi theo session_id `${studentId}:${conversationId}` =====
const sessionPrefix = `${store.student.id}:${delId}`;

// Lấy URL ảnh của các message n8n (lọc theo session_id)
const urlsN8N = await getImagesBySessionPrefix(sessionPrefix);

// Gộp thêm ảnh từ n8n vào danh sách cần xoá
for (const u of urlsN8N) {
  try {
    const x = new URL(u);
    const path = decodeURIComponent(x.pathname || "");
    const i = path.indexOf(marker); // dùng lại biến marker ở trên: "/chat-images/"
    if (i !== -1) paths.push(path.substring(i + marker.length));
  } catch {}
}

// Xoá ảnh (gồm ảnh theo conversation_id + ảnh theo session_id)
if (paths.length) await removeImagesByPaths(Array.from(new Set(paths)));

// Xoá messages do n8n ghi (lọc theo session_id prefix)
await deleteMessagesBySessionPrefix(sessionPrefix);
// ===== HẾT PHẦN THÊM =====

            await deleteConversationDB(delId);
            if (store.activeConversationId === delId) {
              setActiveConversationId(null);
              clearChatUI();
            }
            await refreshConversations(onOpen);
          } catch (err) {
            showToast("Không xoá được.", 3000, "error");
          }
        }
        return;
      }

      if (store.isWaiting) return;
      setActiveConversationId(c.id);
      await openConversation(c.id);
      await refreshConversations(onOpen);
    };

    row.appendChild(btn);
    convListEl.appendChild(row);
  });

  // Chỉ auto-open nếu đã có hội thoại tồn tại
  if (!store.activeConversationId && rows[0]) {
    setActiveConversationId(rows[0].id);
    await openConversation(rows[0].id);
  }
  // KHÔNG tạo mới nếu rows rỗng
}
// helper giải nén JSONB -> { role, text }
function unpackMessage(row) {
  const payload = row?.message;
  if (payload && typeof payload === "object") {
    const role = payload.type === "human" ? "user" : "ai";
    const text = payload.content ?? payload.message ?? "";
    return { role, text };
  }
  // fallback dữ liệu cũ (string)
  return { role: "user", text: row?.message ?? "" };
}

// ... trong openConversation(convId)
export async function openConversation(convId) {
  clearChatUI();

  const list = await listMessages(convId);
  list.forEach((m) => {
    if (m.image_url) addImageBubble(m.role, m.image_url);
    if (m.message) addBubble(m.role, m.message);
  });

  await touchConversation(convId);
}



