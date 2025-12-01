// convert_to_sheet_allinone.js
// Tool thô: chọn file -> AI sinh câu hỏi -> tạo Google Sheet A–I

const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const XLSX = require("xlsx");
const OpenAI = require("openai");
const { google } = require("googleapis");
const fileDialog = require("node-file-dialog");
const readline = require("readline");

// ================== CONFIG – CHỈ CẦN SỬA CHỖ NÀY ==================
const CONFIG = {
  // === OpenAI key của bạn ===
  OPENAI_API_KEY:
    "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",

  // ID thư mục đích trên Google Drive (folder 'hochanh')
  TARGET_FOLDER_ID: "1hcQUIXpkY6B0qZi6qGEb7dec89LmuOQi",

  // Đường dẫn file OAuth client JSON (desktop app) bạn đã tải về
  OAUTH_CLIENT_PATH:
    "client_secret_684163753894-cl1i7to7fjcfaanq7o2pjlfhm1qvabs7.apps.googleusercontent.com.json",
};
// ======================================================================

if (!CONFIG.OPENAI_API_KEY) {
  console.error("❌ Chưa điền OPENAI_API_KEY trong CONFIG");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY });

// ================== PHẦN AUTH GOOGLE (OAUTH2) ==================
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const TOKEN_PATH = path.join(__dirname, "token.json");

/**
 * Tạo OAuth2 client từ file client_secret_....json
 */
function loadOAuthClient() {
  const fullPath = path.join(__dirname, CONFIG.OAUTH_CLIENT_PATH);
  if (!fs.existsSync(fullPath)) {
    console.error(
      "❌ Không tìm thấy file OAuth client JSON:",
      fullPath,
      "\n   Hãy đảm bảo đã tải file 'client_secret_...json' và đặt cạnh convert.js."
    );
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const credentials = JSON.parse(content);

  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  return oAuth2Client;
}

/**
 * Mở URL auth, yêu cầu user dán mã code vào console
 */
function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });

    console.log("\n🔑 Lần đầu dùng tool, cần cấp quyền Google:");
    console.log("1️⃣ Copy URL sau, mở trên trình duyệt và đăng nhập Gmail của bạn:\n");
    console.log(authUrl);
    console.log(
      "\n2️⃣ Sau khi Google trả về mã 'code', copy và dán vào đây rồi Enter.\n"
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Nhập code: ", (code) => {
      rl.close();
      oAuth2Client.getToken(code.trim(), (err, token) => {
        if (err) {
          console.error("❌ Lấy token thất bại:", err.message || err);
          return reject(err);
        }
        oAuth2Client.setCredentials(token);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf8");
        console.log("✅ Đã lưu token vào", TOKEN_PATH);
        resolve(oAuth2Client);
      });
    });
  });
}

/**
 * Lấy OAuth2 client đã có token (nếu chưa có sẽ hỏi lần đầu)
 */
async function getAuthClient() {
  const oAuth2Client = loadOAuthClient();

  if (fs.existsSync(TOKEN_PATH)) {
    // Đã có token, dùng luôn
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  // Chưa có token => xin mới
  return await getNewToken(oAuth2Client);
}

// ========== HÀM CHỌN FILE BẰNG CỬA SỔ WINDOWS ==========
async function pickFile() {
  const result = await fileDialog({
    type: "open-file",
    multiple: false,
    // filter: [{ name: "Documents", extensions: ["pdf", "docx", "xlsx", "xls", "txt", "csv"] }]
  });

  if (Array.isArray(result)) return result[0];
  return result;
}

// ========== 1. TRÍCH NỘI DUNG FILE ==========
async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === ".txt" || ext === ".csv") {
    return { text: buffer.toString("utf8") };
  }

  if (ext === ".docx") {
    console.log("🔵 DOCX -> mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value || "" };
  }

  if (ext === ".xlsx" || ext === ".xls") {
    console.log("🔵 Excel -> xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let parts = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      rows.forEach((row) => {
        const line = row
          .map((c) => (c !== null && c !== undefined ? String(c) : ""))
          .join(" | ");
        if (line.trim()) parts.push(line);
      });
    });
    return { text: parts.join("\n") };
  }

  // 🔁 NEW: xử lý PDF cả TEXT + IMAGE (dùng PDFParse v2)
  if (ext === ".pdf") {
    console.log("🔵 PDF -> PDFParse (v2 Class)");

    // 1. Khởi tạo parser với buffer PDF
    const parser = new PDFParse({ data: buffer });

    // 2. Lấy TEXT
    const textResult = await parser.getText();

    // 3. Thử lấy IMAGE (nếu lỗi vẫn bỏ qua, không làm tool hỏng)
    let imageResult = null;
    try {
      imageResult = await parser.getImage();
    } catch (e) {
      console.warn("⚠️ Không lấy được image từ PDF:", e.message || e);
    }

    // 4. Giải phóng bộ nhớ
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }

    const text = textResult.text || "";

    // 5. Build danh sách ID ảnh theo trang: IMG_P{page}_{index}
    const images = [];
    if (imageResult && Array.isArray(imageResult.pages)) {
      imageResult.pages.forEach((page, pageIndex) => {
        const pageImages = page.images || [];
        pageImages.forEach((img, imgIndex) => {
          images.push({
            id: `IMG_P${pageIndex + 1}_${imgIndex + 1}`,
            page: pageIndex + 1,
          });
        });
      });
    }

    console.log(
      "   text length:",
      text.length,
      "| total images:",
      images.length
    );

    // 🔁 NEW: PDF trả về cả text + images
    return { text, images };
  }

  throw new Error("Chưa hỗ trợ loại file: " + ext);
}

// ========== 2A. CHIA NHỎ TEXT THÀNH CHUNK ==========
function splitIntoChunks(text, maxLen = 10000) {
  // 10.000 ký tự / chunk để giảm số lần gọi GPT
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLen));
    start += maxLen;
  }

  return chunks;
}

// ========== 2B. GỌI OPENAI CHO MỖI CHUNK ==========
async function generateQuestionsForChunk(
  chunkText,
  fileType,
  chunkIndex,
  totalChunks,
  imagesMeta = [] // 🔁 NEW: danh sách ảnh [{id, page}] – có thể []
) {
  console.log(
    `🔵 Gọi OpenAI cho chunk ${chunkIndex + 1}/${totalChunks} (len=${
      chunkText.length
    })`
  );

  const basePrompt = `
Bạn là trợ lý AI chuyên TRÍCH XUẤT VÀ CHUẨN HÓA CÂU HỎI THI.

Nhiệm vụ:
1. Dùng toàn bộ nội dung dưới đây (trích từ file ${fileType}, phần ${
    chunkIndex + 1
  }/${totalChunks}) để hiểu đề.
2. Tách TẤT CẢ câu hỏi (trắc nghiệm hoặc tự luận) có thể nhận diện trong ĐOẠN NÀY.
3. Nếu đoạn này không có câu hỏi rõ ràng thì TỰ TẠO MỘT SỐ CÂU HỎI hợp lý từ nội dung ĐOẠN NÀY.
4. Chuẩn hóa mỗi câu hỏi thành object:

{
  "question_text": "...",
  "option_A": "...",
  "option_B": "...",
  "option_C": "...",
  "option_D": "...",
  "correct_answer": "A" | "B" | "C" | "D" | "",
  "skill": "...",
  "difficulty": "easy" | "medium" | "hard",
  "note": "...",
  "image_ids": ["IMG_P1_1", "IMG_P2_1"] // hoặc [] nếu không dùng hình
}

5. Nếu muốn sử dụng hình ảnh trong câu hỏi, hãy chọn các ID hình phù hợp
   từ danh sách image_ids được cung cấp (mỗi phần tử có "id" và "page")
   và điền vào trường "image_ids".
   KHÔNG được tự bịa ID ngoài danh sách này.

Chỉ trả về JSON hợp lệ dạng:
{ "questions": [ { ... }, ... ] }.
Nếu không tạo được câu hỏi nào cho đoạn này thì trả về:
{ "questions": [] }.
`;

  // 🔁 NEW: gom messages để có thể đẩy thêm danh sách ảnh
  const messages = [
    { role: "system", content: "Bạn là trợ lý chuyên phân tích đề thi." },
    { role: "user", content: basePrompt },
    {
      role: "user",
      content: `Đây là nội dung đã trích xuất từ file (chunk ${
        chunkIndex + 1
      }/${totalChunks}):\n\n"""${chunkText}"""`,
    },
  ];

  // 🔁 NEW: nếu có ảnh (PDF) thì gửi thêm metadata ảnh cho GPT
  if (Array.isArray(imagesMeta) && imagesMeta.length > 0) {
    messages.push({
      role: "user",
      content:
        "Danh sách ID hình ảnh có thể sử dụng cho các câu hỏi (theo toàn bộ file, mỗi phần tử có 'id' và 'page'). " +
        "Khi tạo câu hỏi, nếu cần dùng hình thì hãy chọn các id phù hợp và gán vào trường 'image_ids':\n" +
        JSON.stringify(imagesMeta, null, 2),
    });
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.25,
    max_tokens: 4000,
  });

  const content = completion.choices[0]?.message?.content;
  console.log(
    "🔍 GPT raw output preview (chunk):\n",
    (content || "").slice(0, 300),
    "\n---"
  );

  if (!content) return [];

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const jsonString = jsonMatch ? jsonMatch[0] : content;

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    console.error(
      "❌ JSON.parse error ở chunk",
      chunkIndex + 1,
      ":",
      e.message
    );
    return [];
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    console.error(
      "⚠️ Chunk",
      chunkIndex + 1,
      "không có mảng 'questions' hợp lệ."
    );
    return [];
  }

  return parsed.questions;
}

// ========== 2C. GỌI GPT CHO TOÀN BỘ TEXT (NHIỀU CHUNK) ==========
async function generateQuestionsForWholeText(fullText, fileType, imagesMeta = []) { // 🔁 NEW: thêm imagesMeta
  const chunks = splitIntoChunks(fullText, 3000); // dùng 3k ký tự / chunk
  console.log("🔢 Tổng số chunk:", chunks.length);

  let allQuestions = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].trim();
    if (!chunkText) continue;

    const qs = await generateQuestionsForChunk(
      chunkText,
      fileType,
      i,
      chunks.length,
      imagesMeta // 🔁 NEW: truyền danh sách ảnh xuống từng chunk
    );
    console.log(
      `✅ Chunk ${i + 1}/${chunks.length} trả về ${qs.length} câu hỏi.`
    );
    allQuestions = allQuestions.concat(qs);
  }

  console.log(
    "🔢 Tổng số câu hỏi sau khi gộp tất cả chunk:",
    allQuestions.length
  );
  return allQuestions;
}

// ========== 3. TẠO GOOGLE SHEET VÀ ĐƯA VÀO FOLDER ==========
async function createSheetFromQuestions(questions, teacherId) {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    const title = `Exam_${teacherId}_${Date.now()}`;
    console.log("🔵 Tạo spreadsheet:", title);

    // 1) Tạo Google Sheet
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [{ properties: { title: "Sheet1" } }],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;

    // 2) Move / add vào folder đích
    if (CONFIG.TARGET_FOLDER_ID) {
      try {
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: CONFIG.TARGET_FOLDER_ID,
          fields: "id, parents",
        });
        console.log("📁 Đã gắn file vào folder:", CONFIG.TARGET_FOLDER_ID);
      } catch (err) {
        console.error(
          "⚠️ Lỗi move file vào folder:",
          err.message || err
        );
        if (err.response && err.response.data) {
          console.error(
            "🔎 Chi tiết move file:",
            JSON.stringify(err.response.data, null, 2)
          );
        }
      }
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;

    // 3) Ghi dữ liệu vào Sheet
    const values = [];

    // 🔁 NEW: thêm cột "image_ids" để map câu hỏi ↔ ID hình
    values.push([
      "question_text",
      "option_A",
      "option_B",
      "option_C",
      "option_D",
      "correct_answer",
      "skill",
      "difficulty",
      "note",
      "image_ids",
    ]);

    for (const q of questions) {
      values.push([
        q.question_text || "",
        q.option_A || "",
        q.option_B || "",
        q.option_C || "",
        q.option_D || "",
        q.correct_answer || "",
        q.skill || "",
        q.difficulty || "medium",
        q.note || "",
        Array.isArray(q.image_ids)
          ? q.image_ids.join(",")
          : q.image_ids || "", // 🔁 NEW: lưu danh sách ID hình (nếu có)
      ]);
    }

    console.log("🔵 Ghi dữ liệu vào Sheet...");
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A1:J${values.length}`, // 🔁 NEW: tới cột J
      valueInputOption: "RAW",
      requestBody: { values },
    });

    return sheetUrl;
  } catch (err) {
    console.error("❌ Lỗi khi tạo/ghi Google Sheet:", err.message || err);
    if (err.response && err.response.data) {
      console.error(
        "🔎 Chi tiết Google API:",
        JSON.stringify(err.response.data, null, 2)
      );
    }
    throw err;
  }
}

// ========== 4. MAIN ==========
async function main() {
  try {
    console.log("📂 Vui lòng chọn file input…");
    const filePath = await pickFile();

    if (!filePath) {
      console.error("❌ Không chọn file, dừng.");
      process.exit(1);
    }

    console.log("📁 File đã chọn:", filePath);

    const teacherId = "LOCAL_TEST"; // sau này nếu muốn truyền từ ngoài thì sửa tiếp

    const absPath = filePath;

    if (!fs.existsSync(absPath)) {
      console.error("❌ Không tìm thấy file:", absPath);
      process.exit(1);
    }

    const ext = path.extname(absPath).toLowerCase().replace(".", "");

    console.log("🔵 Đang trích nội dung từ file:", absPath);

    // 🔁 NEW: nhận thêm images (PDF thì có, loại khác thì undefined)
    const { text, images = [] } = await extractContent(absPath);

    // 🔁 NEW: bước CHECK FILE – text vs ảnh
    const hasText = !!(text && text.trim());
    const hasImages = Array.isArray(images) && images.length > 0;

    if (!hasText && hasImages) {
      console.warn("⚠️ File chỉ có hình ảnh, không có text – chưa xử lý OCR.");
      throw new Error(
        "File chỉ có hình ảnh, hiện tool chưa hỗ trợ sinh câu hỏi từ ảnh thuần."
      );
    } else if (hasText && !hasImages) {
      console.log("📎 File chỉ có text, không có hình ảnh đính kèm.");
    } else if (hasText && hasImages) {
      console.log(
        "📎 File có CẢ text lẫn hình:",
        "textLength =",
        text.length,
        "| totalImages =",
        images.length
      );
    }

    if (!hasText) {
      throw new Error("File không trích được text.");
    }

    console.log("🔵 Gọi OpenAI để sinh câu hỏi trên TOÀN BỘ TEXT (chunk)…");
    // 🔁 NEW: truyền images xuống để GPT map câu hỏi ↔ image_ids
    const questions = await generateQuestionsForWholeText(text, ext, images);

    console.log("✅ Tổng số câu hỏi AI trả về sau khi gộp:", questions.length);

    console.log("🔵 Tạo Google Sheet...");
    const sheetUrl = await createSheetFromQuestions(questions, teacherId);

    console.log("🎉 HOÀN THÀNH!");
    console.log("👉 Link Google Sheet:", sheetUrl);
  } catch (err) {
    console.error("❌ Lỗi:", err.message || err);
    if (err.response && err.response.data) {
      console.error(
        "🔎 Chi tiết API:",
        JSON.stringify(err.response.data, null, 2)
      );
    }
    process.exit(1);
  }
}

main();
