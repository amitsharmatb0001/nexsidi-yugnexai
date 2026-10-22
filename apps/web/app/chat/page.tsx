import { redirect } from "next/navigation";

// 2026-10-22: /chat was an older second copy of the planner chat. It used class names for a CSS library this app does not
// have, so it rendered unstyled; nothing linked to it; and it lacked the research and question widgets of the real chat on
// the build page. New builds start from Projects → New project, which opens that chat.
export default function ChatPage() {
  redirect("/projects");
}
