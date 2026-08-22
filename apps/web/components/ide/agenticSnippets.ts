/**
 * Ambient code fragments for AgenticField's drifting text layer.
 *
 * The prototype this field is adapted from (apps/prototype-ui/app/
 * background/codeSnippets.ts) streamed real internal mechanism names as
 * decoration — verifyHashChain, calculateTaskDAG, evaluateAdversarialQA,
 * temporalWorker.listen('project-build-workflow'). Those are Patent Claim
 * 1/4/6 terms and a real workflow id, on screen as ambient wallpaper. This
 * list keeps the same visual effect with only the kind of code an ordinary
 * generated app actually contains — nothing that names how the platform
 * itself works.
 */
export function generateAmbientSnippet(): string {
  const snippets = [
    "export async function getUser(id: string) {",
    "const rows = await db.select().from(users);",
    "app.get('/api/health', (req, res) => {",
    "return NextResponse.json({ ok: true });",
    "const [items, setItems] = useState([]);",
    "await queryClient.invalidateQueries();",
    "CREATE INDEX idx_created_at ON orders;",
    "export interface Product { id: string; }",
    "const total = items.reduce((a, b) => a + b, 0);",
    "docker compose up -d --build",
    "npm run build && npm run test",
    "await fetch('/api/projects', { method: 'POST' });",
  ];
  return snippets[Math.floor(Math.random() * snippets.length)] as string;
}
