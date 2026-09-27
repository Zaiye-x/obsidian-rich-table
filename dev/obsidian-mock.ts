// Development-only browser harness. Never included in the plugin bundle.
export class Modal {
  modalEl = document.createElement("section");
  contentEl = document.createElement("div");
  titleEl = document.createElement("h2");
  app: unknown;
  scope = { register() {} };
  constructor(app: unknown) {
    this.app = app; this.modalEl.className = "modal";
    this.titleEl.className = "modal-title"; this.contentEl.className = "modal-content";
    const close = document.createElement("button"); close.textContent = "关闭"; close.className = "mock-close";
    close.onclick = () => this.close();
    this.modalEl.append(this.titleEl, close, this.contentEl);
  }
  setTitle(title: string) { this.titleEl.textContent = title; }
  open() { document.body.append(this.modalEl); this.onOpen(); }
  close() { this.onClose(); this.modalEl.remove(); }
  onOpen() {}
  onClose() {}
}
export class Menu {
  items: { title: string; action: () => void }[] = [];
  addItem(fn: (item: any) => void) {
    const v = { title: "", action: () => {} };
    const builder = { setTitle: (title: string) => { v.title = title; return builder; }, onClick: (action: () => void) => { v.action = action; return builder; } };
    fn(builder); this.items.push(v); return this;
  }
  showAtPosition(p: { x: number; y: number }) {
    document.querySelector(".mock-menu")?.remove();
    const menu = document.createElement("div"); menu.className = "mock-menu";
    menu.style.left = `${p.x}px`; menu.style.top = `${Math.min(p.y, innerHeight - this.items.length * 33)}px`;
    for (const i of this.items) { const b = document.createElement("button"); b.textContent = i.title; b.onclick = () => { menu.remove(); i.action(); }; menu.append(b); }
    document.body.append(menu);
  }
  showAtMouseEvent(e: MouseEvent) { this.showAtPosition({ x: e.clientX, y: e.clientY }); }
}
export class Notice {
  constructor(text: string) {
    const node = document.querySelector("#notice"); if (node) node.textContent = text;
  }
}
export function setIcon(parent: HTMLElement, name: string): void {
  const icon = document.createElement("span");
  icon.className = "mock-icon"; icon.dataset.icon = name;
  icon.textContent = {
    download: "↓", save: "✓", "undo-2": "↶", "redo-2": "↷",
    "rows-3": "≡", "columns-3": "▥", ellipsis: "···",
    merge: "⤢", split: "↔", "image-plus": "+"
  }[name] || "•";
  parent.replaceChildren(icon);
}
export class TFile {}
export class MarkdownView {}
export const normalizePath = (s: string) => s;
