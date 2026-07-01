// @yugnex/nexui-react — Main Entry Point
// Full React component library powered by @yugnex/nexui Web Components.
// Zero external dependencies beyond React itself.

// ── Provider & Hooks ─────────────────────────────────────────────────────────
export { NexuiProvider, useNexui, type NexuiTheme } from "./provider";
export { ToastProvider, Toaster, useToast }         from "./toast";

// ── Web Component Wrappers ───────────────────────────────────────────────────
export {
  Panel,
  Button,
  Badge,
  Input,
  Avatar,
  StatusRing,
  TextStream,
  Progress,
  Switch,
  Checkbox,
  Skeleton,
  Separator,
  Spinner,
  type TextStreamHandle,
} from "./primitives";

// ── React-Native Components ──────────────────────────────────────────────────
export { Modal }                                          from "./modal";
export { Tabs, TabsList, TabsTrigger, TabsContent }       from "./tabs";
export { Select, SelectItem, SelectGroup }                from "./select";
export { Tooltip }                                        from "./tooltip";
export { Card, CardHeader, CardBody, CardFooter }         from "./card";

// ── Re-export token types for consumers ─────────────────────────────────────
export type { NexuiSemanticToken } from "@yugnex/nexui";
