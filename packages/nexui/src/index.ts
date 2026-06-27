// @yugnex/nexui — Main Entry Point v2.0

export * from "./tokens/colors";
export * from "./tokens/spacing";
export * from "./tokens/motion";
export * from "./tokens/shadows";
export * from "./tokens/type";
export * from "./core/matrix";
export * from "./core/compiler";
export * from "./core/cx";
export * from "./assets/typography";
export * from "./assets/geometry";

export { NexPanel }      from "./primitives/panel";
export { NexStatusRing } from "./primitives/status-ring";
export { NexTextStream } from "./primitives/text-stream";
export { NexButton }     from "./primitives/button";
export { NexBadge }      from "./primitives/badge";
export { NexInput }      from "./primitives/input";
export { NexAvatar }     from "./primitives/avatar";
export { NexProgress }   from "./primitives/progress";
export { NexSwitch }     from "./primitives/switch";
export { NexCheckbox }   from "./primitives/checkbox";
export { NexSkeleton }   from "./primitives/skeleton";
export { NexSeparator }  from "./primitives/separator";
export { NexSpinner }    from "./primitives/spinner";

import { nexui_compiler } from "./core/compiler";
import { NexuiTypographySheet } from "./assets/typography";
import { NexPanel }      from "./primitives/panel";
import { NexStatusRing } from "./primitives/status-ring";
import { NexTextStream } from "./primitives/text-stream";
import { NexButton }     from "./primitives/button";
import { NexBadge }      from "./primitives/badge";
import { NexInput }      from "./primitives/input";
import { NexAvatar }     from "./primitives/avatar";
import { NexProgress }   from "./primitives/progress";
import { NexSwitch }     from "./primitives/switch";
import { NexCheckbox }   from "./primitives/checkbox";
import { NexSkeleton }   from "./primitives/skeleton";
import { NexSeparator }  from "./primitives/separator";
import { NexSpinner }    from "./primitives/spinner";
import type { NexuiTheme } from "./core/matrix";

const ELEMENTS: Array<[string, CustomElementConstructor]> = [
  ["nex-panel",       NexPanel],
  ["nex-status-ring", NexStatusRing],
  ["nex-text-stream", NexTextStream],
  ["nex-button",      NexButton],
  ["nex-badge",       NexBadge],
  ["nex-input",       NexInput],
  ["nex-avatar",      NexAvatar],
  ["nex-progress",    NexProgress],
  ["nex-switch",      NexSwitch],
  ["nex-checkbox",    NexCheckbox],
  ["nex-skeleton",    NexSkeleton],
  ["nex-separator",   NexSeparator],
  ["nex-spinner",     NexSpinner],
];

export async function initializeNexuiEngine(defaultTheme: NexuiTheme = "void"): Promise<void> {
  if (typeof window === "undefined") return;
  if (!document.getElementById("yugnex-nexui-typography")) {
    const s = document.createElement("style");
    s.id = "yugnex-nexui-typography";
    s.textContent = NexuiTypographySheet;
    document.head.appendChild(s);
  }
  nexui_compiler.mountGlobalTheme(defaultTheme);
  for (const [tag, ctor] of ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, ctor);
  }
}

export function setNexuiTheme(theme: NexuiTheme): void {
  nexui_compiler.switchTheme(theme);
  window.dispatchEvent(new CustomEvent("nexui:theme-change", { detail: { theme } }));
}
