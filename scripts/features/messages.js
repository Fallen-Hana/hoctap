import { MOCK_ENABLED, N8N_WEBHOOK, BOT_TIMEOUT_MS } from "../env.js";
import { store, setActiveConversationId } from "../state/store.js";
import {
  addBubble,
  addImageBubble,
  addTypingBubble,
  removeTypingBubble,
  lockInput,
} from "../ui/chatUI.js";
import { showToast } from "../ui/toast.js";
import { mockReply } from "../utils/helpers.js";
import { uploadPendingImage } from "./attachments.js";
import {
  addMessage,
  touchConversation,
  listConversations,
  createConversation,
} from "../api/supabase.js";
import { openConversation, refreshConversations } from "./conversations.js";

/**
 * CHÚ Ý:
 * - KHÔNG tạo conversation lúc load trang.
 * - CHỈ tạo conversation khi user thực sự gửi tin nhắn đầu tiên.
 */

const txt = document.getElementById("txt");
const btnSend = document.getElementById("btnSend");
const btnSendAttach = document.getElementById("btnSendAttach");
const msgEl = document.getElementById("msg");

// Chuẩn hoá role và text từ nhiều schema khác nhau trong cột `message`
function pickRole(row) {
  // row.role (nếu có) đã đúng "user"/"ai"
  if (row?.role === "user" || row?.role === "ai") return row.role;

  const p = row?.message;
  if (p && typeof p === "object") {
    if ("type" in p) return p.type === "human" ? "user" : "ai";        // kiểu mới
    if ("role" in p) return p.role === "assistant" ? "ai" : "user";    // kiểu cũ
  }
  return "user";
}

function pickText(row) {
  const p = row?.message;
  if (typeof p === "string") return p;                     // chuỗi cũ
  if (p && typeof p === "object") return p.content ?? p.message ?? "";
  return "";
}


function setMsg(t) {
  msgEl.textContent = t || "";
}

export function bindSendEvents() {
  btnSend.onclick = sendMessage;
  txt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  if (btnSendAttach) btnSendAttach.onclick = () => sendMessage();
}

/** Tạo conversation CHỈ khi thực sự gửi tin và chưa có id */
// TẠO/BẢO HIỂM CUỘC TRÒ CHUYỆN HIỆN HÀNH
export async function ensureConvExists() {
  const sid = store?.student?.id;
  if (!sid) throw new Error("MISSING_STUDENT_ID");

  // Nếu đang có activeConversationId ⇒ kiểm tra còn tồn tại thật trong DB không
  if (store.activeConversationId) {
    const rows = await listConversations(sid, 200); // có thể bỏ tham số 200 nếu hàm không cần
    if (Array.isArray(rows) && rows.some(r => r.id === store.activeConversationId)) {
      return store.activeConversationId; // vẫn còn, dùng tiếp
    }
    // ID đang chọn là "mồ côi" ⇒ xoá khỏi state để tạo mới
    setActiveConversationId(null);
  }

  // Không có cuộc trò chuyện nào đang chọn ⇒ tạo mới
  const newId = await createConversation(sid, "Cuộc trò chuyện mới");
  setActiveConversationId(newId);

  // Mở và làm tươi UI
  await openConversation(newId);
  await refreshConversations();
  return newId;
}

export async function sendMessage() {
  const text = (txt.value || "").trim();
  if (!text && !store.pendingImageFile) return;

  store.isWaiting = true;
  lockInput(true);
  setMsg("");

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new Error("BOT_TIMEOUT")),
    BOT_TIMEOUT_MS
  );

  try {
    const convId = await ensureConvExists();

    // Ảnh: đổi base64 (cho webhook) + upload Supabase (hiển thị/lưu DB)
    let uploadedImageUrl = null;
    let uploadedImageMeta = null;
    if (store.pendingImageFile) {
      const { url, meta } = await uploadPendingImage();
      uploadedImageUrl = url;
      uploadedImageMeta = meta;
      addImageBubble("user", url);
      await addMessage({
        convId,
        studentId: store.student.id,
        role: "user",
        content: "[Ảnh đã gửi]",
        imageUrl: url,
      });
    }

    if (text) {
      addBubble("user", text);
      await addMessage({
        convId,
        studentId: store.student.id,
        role: "user",
        content: text,
      });
    }

    await touchConversation(convId);

    // gọi bot nếu có text/ảnh
    if (text || uploadedImageUrl || uploadedImageMeta) {
      addTypingBubble();
      let reply = "(Không có phản hồi)";

      if (MOCK_ENABLED) {
        await new Promise((r) => setTimeout(r, 500));
        reply = mockReply(text || "[ảnh]");
      } else {
        const payload = {
          conversation_id: convId,
          message: text || "",
          student_meta: store.student,
          attachments:
            uploadedImageUrl || uploadedImageMeta
              ? [
                  {
                    type: "image",
                    url: uploadedImageUrl || null,
                    base64: uploadedImageMeta?.base64 || null,
                    mime: uploadedImageMeta?.mime || null,
                    name: uploadedImageMeta?.name || null,
                    size: uploadedImageMeta?.size || null,
                  },
                ]
              : [],
        };

        const res = await fetch(N8N_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        const raw = await res.text();
        if (!res.ok)
          throw new Error("n8n " + res.status + " " + res.statusText + " " + raw);
        try {
          reply = JSON.parse(raw).reply || raw || reply;
        } catch {
          reply = raw || reply;
        }
      }

      removeTypingBubble();
      addBubble("ai", reply);
      await addMessage({
        convId,
        studentId: store.student.id,
        role: "ai",
        content: reply,
      });
      await touchConversation(convId);
    }
  } catch (err) {
    console.error(err);
    removeTypingBubble();
    setMsg("Mất kết nối hoặc bot không phản hồi.");
    showToast("⚠️ Mất kết nối n8n, chuyển sang mock.", 3500, "error");

    const text = (txt.value || "").trim();
    const reply = mockReply(text || "[ảnh]");
    addBubble("ai", reply);
    try {
      await addMessage({
        convId: store.activeConversationId,
        studentId: store.student.id,
        role: "ai",
        content: reply,
      });
      await touchConversation(store.activeConversationId);
    } catch (e) {
      console.warn("Không lưu được mock reply:", e);
    }
  } finally {
    clearTimeout(timer);
    store.isWaiting = false;
    lockInput(false);
    txt.value = "";
    await refreshConversations();
  }
}
