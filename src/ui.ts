import { element } from "./renderer";
export function button(parent: HTMLElement, label: string, action: () => void, cls = ""): HTMLButtonElement {
  const el = element(parent.ownerDocument, "button", cls, label);
  el.type = "button"; el.addEventListener("click", action); parent.append(el); return el;
}
export function field(parent: HTMLElement, label: string): HTMLLabelElement {
  const el = element(parent.ownerDocument, "label", "rt-field");
  el.append(element(parent.ownerDocument, "span", "rt-field-label", label)); parent.append(el); return el;
}
export function select(parent: HTMLElement, label: string, values: Record<string, string>, value: string, onChange: (value: string) => void): HTMLSelectElement {
  const wrapper = field(parent, label), control = element(parent.ownerDocument, "select");
  for (const [key, name] of Object.entries(values)) { const option = element(parent.ownerDocument, "option", "", name); option.value = key; control.append(option); }
  control.value = value; control.addEventListener("change", () => onChange(control.value)); wrapper.append(control); return control;
}
export function numeric(parent: HTMLElement, label: string, value: number, min: number, max: number, onChange: (value: number) => void): HTMLInputElement {
  const wrapper = field(parent, label), control = element(parent.ownerDocument, "input");
  control.type = "number"; control.min = String(min); control.max = String(max); control.value = String(value);
  control.addEventListener("change", () => {
    if (!control.reportValidity() || !control.value) { control.value = String(value); return; }
    onChange(Number(control.value));
  });
  wrapper.append(control); return control;
}
export function download(doc: Document, name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = element(doc, "a"); a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
