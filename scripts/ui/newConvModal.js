import { createConversation } from "../api/supabase.js";
import { setActiveConversationId, store } from "../state/store.js";

const modal = document.getElementById("newConvModal");
const convTitleInput = document.getElementById("convTitleInput");
const convTitleErr = document.getElementById("convTitleErr");
const btnCancelNew = document.getElementById("btnCancelNew");
const btnCreateNew = document.getElementById("btnCreateNew");

export function openModal(){
  convTitleErr.textContent = "";
  convTitleInput.value = "";
  modal.classList.remove("hidden"); modal.classList.add("flex");
  setTimeout(()=>convTitleInput.focus(),0);
}
export function closeModal(){
  modal.classList.add("hidden"); modal.classList.remove("flex");
}
export function bindModalEvents(onCreated){
  btnCancelNew.onclick = () => closeModal();
  btnCreateNew.onclick = () => createConversationWithTitle(onCreated);
  convTitleInput.addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){ e.preventDefault(); createConversationWithTitle(onCreated); }
    else if (e.key === "Escape"){ e.preventDefault(); closeModal(); }
  });
  modal.addEventListener("click", (e)=>{ if (e.target === modal) closeModal(); });
}
async function createConversationWithTitle(onCreated){
  const title = (convTitleInput.value || "").trim() || "Cuộc trò chuyện mới";
  btnCreateNew.disabled = true;
  try{
    const id = await createConversation(store.student.id, title);
    setActiveConversationId(id);
    if (typeof onCreated === "function") await onCreated();
    closeModal();
  }catch(e){
    convTitleErr.textContent = e?.message || "Không tạo được.";
  }finally{
    btnCreateNew.disabled = false;
  }
}
