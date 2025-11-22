export function humanSize(bytes){
  if (!bytes && bytes !== 0) return "";
  const u = ["B","KB","MB","GB"]; let i=0; let v=bytes;
  while(v>=1024 && i<u.length-1){ v/=1024; i++; }
  return `${v.toFixed(v>=10||i===0?0:1)} ${u[i]}`;
}
export function isoDaysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString(); }

export function mockReply(text){
  if (/xin chào|hello/i.test(text)) return "Chào em 👋 Đây là phản hồi giả lập.";
  if (/2\s*\+\s*2/.test(text)) return "2 + 2 = 4 (mock).";
  return "Lỗi, đây chỉ là trả lời tự động cố định";
}
