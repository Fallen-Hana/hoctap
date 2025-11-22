// state & getters/setters tập trung
export const store = {
  student: null,
  activeConversationId: localStorage.getItem("activeConversationId") || null,
  isWaiting: false,

  // ảnh chờ gửi
  pendingImageFile: null,
  pendingImageObjectUrl: null,
};

export function setActiveConversationId(id) {
  store.activeConversationId = id;
  if (id) localStorage.setItem("activeConversationId", id);
  else localStorage.removeItem("activeConversationId");
}
