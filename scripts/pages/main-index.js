import { sb } from "../api/supabase.js";

const msgEl = document.getElementById("msg");
const input = document.getElementById("login_code");
const btn = document.getElementById("btnLogin");

function setMsg(t){ msgEl.textContent = t || ""; }

// Chặn click trước khi SDK sẵn sàng
btn.disabled = true;

document.addEventListener("DOMContentLoaded", async () => {
  // Kiểm tra SDK
  if (!window.supabase) {
    setMsg("Không tải được SDK Supabase.");
    console.error("⚠️ Supabase SDK chưa sẵn sàng.");
    return;
  }

  btn.disabled = false;

  btn.onclick = async () => {
    const code = (input.value || "").trim();
    if (!code) { setMsg("⚠️ Vui lòng nhập mã học sinh."); return; }

    try {
      btn.disabled = true;
      btn.textContent = "Đang kiểm tra...";

      // Kiểm tra học sinh theo mã
      const { data, error } = await sb
        .from("students")
        .select("id, name, login_code")
        .eq("login_code", code)
        .maybeSingle();

      if (error) {
        console.error(error);
        setMsg("Lỗi Supabase: " + error.message);
        return;
      }
      if (!data) {
        setMsg("❌ Mã học sinh không đúng.");
        return;
      }

      // Lưu student và chuyển trang
      localStorage.setItem("student", JSON.stringify(data));
      window.location.href = "chat.html";

    } catch (err) {
      console.error("Đăng nhập lỗi:", err);
      setMsg("Không kết nối được đến Supabase.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Vào lớp";
    }
  };
});
