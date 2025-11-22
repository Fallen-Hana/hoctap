import { store } from "../state/store.js";
import { humanSize } from "../utils/helpers.js";
import { uploadImage } from "../api/supabase.js";

const imgInput = document.getElementById("imgInput");
const bar = document.getElementById("attachBar");
const img = document.getElementById("attachImg");
const nameEl = document.getElementById("attachName");
const sizeEl = document.getElementById("attachSize");
const btnRemove = document.getElementById("btnRemoveAttach");

// Chuẩn hoá tên file: bỏ dấu, bỏ ký tự lạ, giữ lại đuôi mở rộng
function sanitizeFilename(name = "image") {
  // Tách đuôi
  const m = String(name).match(/\.([A-Za-z0-9]+)$/);
  const ext = m ? m[1].toLowerCase() : "";
  // Bỏ dấu tiếng Việt + ký tự không an toàn
  let base = String(name).replace(/\.[A-Za-z0-9]+$/, ""); // bỏ phần .ext cũ
  base = base
    .normalize("NFD")                // tách dấu
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/[^\w.-]+/g, "_")       // chỉ giữ [A-Za-z0-9_ . -]
    .replace(/^[_\.]+/, "")          // bỏ đầu chuỗi là _ hoặc .
    .slice(0, 80)                    // tránh tên quá dài
    || "image";
  return ext ? `${base}.${ext}` : base;
}

export function bindAttachmentInputs(){
  imgInput.addEventListener("change", () => {
    const file = imgInput.files[0]; imgInput.value = "";
    if (!file) return;
    showAttachPreview(file);
  });

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const it of items){
      if (it.kind === "file" && it.type.startsWith("image/")){
        const file = it.getAsFile(); if (!file) continue;
        showAttachPreview(file); break;
      }
    }
  });

  btnRemove.onclick = () => clearAttachPreview();
}

export function showAttachPreview(file){
  if (store.pendingImageObjectUrl) URL.revokeObjectURL(store.pendingImageObjectUrl);
  store.pendingImageFile = file;
  store.pendingImageObjectUrl = URL.createObjectURL(file);
  img.src = store.pendingImageObjectUrl;
  nameEl.textContent = file.name || "Ảnh từ clipboard";
  sizeEl.textContent = humanSize(file.size);
  bar.classList.remove("hidden");
}

export function clearAttachPreview(){
  if (store.pendingImageObjectUrl) URL.revokeObjectURL(store.pendingImageObjectUrl);
  store.pendingImageFile = null;
  store.pendingImageObjectUrl = null;
  bar.classList.add("hidden");
}

// export function fileToBase64AndMeta(file){
//   return new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.onload = () => {
//       const dataUrl = reader.result; // "data:image/png;base64,AAAA..."
//       const [header, b64] = String(dataUrl).split(",");
//       const mime = (header.match(/data:(.*?);base64/)||[])[1] || file.type || "application/octet-stream";
//       resolve({
//         base64: b64,
//         mime,
//         name: file.name || "image.png",
//         size: file.size || (b64 ? Math.floor(b64.length * 0.75) : 0)
//       });
//     };
//     reader.onerror = reject;
//     reader.readAsDataURL(file);
//   });
// }

export async function uploadPendingImage(){
  if (!store.pendingImageFile) return { url: null };

  // Tạo 1 File mới cùng nội dung nhưng tên đã sạch
  const src = store.pendingImageFile;
  const cleanName = sanitizeFilename(src.name || "image");
  const safeFile = new File([src], cleanName, { type: src.type });

  const url = await uploadImage(safeFile, store.student.id);
  clearAttachPreview();
  return { url };
}
