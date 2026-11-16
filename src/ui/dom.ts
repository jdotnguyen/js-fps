export type Child = Node | string | null | undefined | false;
export type Attr = string | number | boolean | undefined;

/** Tiny DOM builder. `class` sets className, `text` sets textContent, `false`/`undefined` attrs are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, attrs: Record<string, Attr> = {}, ...children: Child[]): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'menu-btn', ...attrs }, label, ...children);
  b.addEventListener('click', onClick);
  return b;
}
