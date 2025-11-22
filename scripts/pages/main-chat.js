import { MOCK_ENABLED, AUTO_DELETE_AFTER_DAYS } from "../env.js";
import { store } from "../state/store.js";
import { showToast } from "../ui/toast.js";
import { bindAttachmentInputs } from "../features/attachments.js";
import { bindSendEvents } from "../features/messages.js";
import { openModal, bindModalEvents } from "../ui/newConvModal.js";
import { refreshConversations, openConversation } from "../features/conversations.js";
import { isoDaysAgo } from "../utils/helpers.js";
import { sb, getImagesOfConversation, removeImagesByPaths } from "../api/supabase.js";

/**
 * CHÚ Ý:
 * - Không auto tạo conversation khi load.
 * - Chỉ mở hội thoại nếu đã tồn tại sẵn trong DB.
 */

const studentInfo = document.getElementById("studentInfo");
const mockBadge = document.getElementById("mockBadge");
const btnNew = document.getElementById("btnNew");
const btnLogout = document.getElementById("btnLogout");

// ===== boot student from localStorage
(function initStudent() {
  const student = JSON.parse(localStorage.getItem("student") || "null");
  if (!student) {
    alert("Không có thông tin học sinh, vui lòng đăng nhập lại!");
    location.href = "index.html";
    return;
  }
  store.student = student;
  studentInfo.innerHTML = `
    <div><b>${student.name}</b></div>
    <div class="text-gray-400">Mã: ${student.login_code}</div>
    <div class="text-gray-400">ID: ${student.id}</div>
  `;
  if (MOCK_ENABLED) mockBadge.classList.remove("hidden");
})();

// ===== bind UI
bindAttachmentInputs();
bindSendEvents();
bindModalEvents(async () => {
  await refreshConversations();
  if (store.activeConversationId) {
    await openConversation(store.activeConversationId);
  }
});

btnNew.onclick = () => {
  if (store.isWaiting) return;
  openModal();
};
btnLogout.onclick = () => {
  if (store.isWaiting) return;
  localStorage.clear();
  location.href = "index.html";
};

// ===== load conversations list (KHÔNG tạo mới khi rỗng)
await refreshConversations();
if (store.activeConversationId) {
  await openConversation(store.activeConversationId);
}

// ===== Auto cleanup > N ngày (xoá conv + ảnh)
async function autoCleanupOldConversations() {
  const cutoff = isoDaysAgo(AUTO_DELETE_AFTER_DAYS);
  const { data, error } = await sb
    .from("conversations")
    .select("id")
    .eq("student_id", store.student.id)
    .lt("updated_at", cutoff);
  if (error || !data || !data.length) return;

  try {
    for (const r of data) {
      const urls = await getImagesOfConversation(r.id);
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
    }
  } catch (e) {
    console.warn("Cleanup images error", e);
  }

  for (const r of data) {
    await sb.from("messages").delete().eq("conversation_id", r.id);
    await sb.from("conversations").delete().eq("id", r.id);
  }
  showToast(
    `Đã xoá ${data.length} cuộc trò chuyện cũ (> ${AUTO_DELETE_AFTER_DAYS} ngày).`
  );
}
await autoCleanupOldConversations();
