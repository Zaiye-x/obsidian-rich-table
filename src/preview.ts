import { setIcon } from "obsidian";
import { TableData } from "./model";
import { element, renderTable } from "./renderer";
import { button } from "./ui";

export function renderPreview(parent: HTMLElement, data: TableData, resolveImage: (path: string) => string | null, onEdit: () => void): void {
  const doc = parent.ownerDocument;
  parent.classList.add("rt-root", "rt-preview");
  const heading = element(doc, "div", "rt-preview-heading");
  heading.append(element(doc, "span", "rt-caption", data.title));
  const editButton = button(heading, "编辑表格", onEdit, "rt-edit-button");
  editButton.title = "打开富表格编辑器"; editButton.setAttribute("aria-label", "编辑表格");
  const icon = element(doc, "span", "rt-button-icon"); icon.setAttribute("aria-hidden", "true"); setIcon(icon, "pencil");
  editButton.prepend(icon);
  for (const type of ["pointerdown", "mousedown", "click"]) editButton.addEventListener(type, event => event.stopPropagation());
  const scroll = element(doc, "div", "rt-preview-scroll");
  scroll.append(renderTable(doc, data, { resolveImage }));
  parent.replaceChildren(heading, scroll);
}
