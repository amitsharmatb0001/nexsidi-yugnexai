// Test the live API endpoint and read the full SSE stream
const sessionId = `live-test-${Date.now()}`;
console.log("Session:", sessionId);

const res = await fetch("http://localhost:8080/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, message: "Build a simple todo app with task creation and completion" }),
});

console.log("Status:", res.status);
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let totalChunks = 0;
const start = Date.now();

while (true) {
  const { done, value } = await reader.read();
  if (done) { console.log("\nStream done"); break; }
  const text = decoder.decode(value);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    totalChunks++;
    const parsed = JSON.parse(data);
    if (parsed.type === "token") process.stdout.write(parsed.content ?? "");
    else console.log(`\n[${parsed.type}]`, JSON.stringify(parsed).substring(0, 100));
  }
}
console.log(`\nTotal chunks: ${totalChunks}, time: ${Date.now()-start}ms`);
