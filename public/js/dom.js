// DOM 생성 헬퍼. 텍스트는 항상 textContent 로만 넣는다(innerHTML 금지).
export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
