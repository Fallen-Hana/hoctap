import { el } from "../utils/dom.js";

const chatBox = document.getElementById("chatBox");

export function addBubble(role, text){
  const div = el("div", "msg " + (role === "user" ? "u" : "a"));
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

export function addImageBubble(role, imageUrl){
  const div = el("div", "msg " + (role === "user" ? "u" : "a"));
  const img = el("img", "img-chat");
  img.src = imageUrl;
  img.onclick = () => window.open(imageUrl, "_blank");
  div.appendChild(img);
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

export function addTypingBubble(){
  const div = el("div", "msg a");
  div.id = "typingBubble";
  div.innerHTML = '<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

export function removeTypingBubble(){
  const t = document.getElementById("typingBubble");
  if (t) t.remove();
}

export function clearChatUI(){ chatBox.innerHTML = ""; }

export function lockInput(lock){
  const btnSend = document.getElementById("btnSend");
  const txt = document.getElementById("txt");
  if (lock){
    btnSend.disabled = true;
    btnSend.classList.add("disabled");
    btnSend.textContent = "Đang gửi...";
    txt.disabled = true;
  } else {
    btnSend.disabled = false;
    btnSend.classList.remove("disabled");
    btnSend.textContent = "Gửi";
    txt.disabled = false;
    txt.focus();
  }
}
