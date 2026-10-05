// 2026-10-04 (Ledgerly run 4): the design evaluator ran on a text-only NIM model. Its
// browser_screenshot calls saved a file and returned only the words "Screenshot saved";
// the model was never shown a picture, yet its review said what "landing.png shows" and
// scored originality 5 from it. A judge of how a page looks must be shown the page: a run
// can require that at least one screenshot was actually sent to the model before it may
// finish.
export function imagesSeenRejection(required: boolean | undefined, seen: number): string | null {
  if (!required || seen > 0) return null;
  return "You have not been shown any screenshot yet. A screenshot call attaches the picture to your next turn — take the screenshots of the pages you are judging, look at them, and only then call task_complete again. Describe only what you can see in them.";
}

// Only the Gemini and Claude loops attach screenshot images (gemini-loop.ts, claude-loop.ts);
// the NIM and Ollama tool loops send text only.
export function modelCanSeeImages(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gemini-") || m.startsWith("google/") || m.includes("claude");
}
