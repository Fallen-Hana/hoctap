const toast = document.getElementById("toast");

export function showToast(text, ms=3000, type="info"){
  const el = document.createElement("div");
  el.className = "toast-item" + (type==='error'?' error':'');
  el.textContent = text;
  toast.style.display = "block";
  toast.appendChild(el);
  setTimeout(()=>{ el.remove(); if (!toast.children.length) toast.style.display='none'; }, ms);
}
