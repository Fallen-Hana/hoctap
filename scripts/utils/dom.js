export const $ = (sel, root=document) => root.querySelector(sel);
export function el(tag, className="", text=""){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
