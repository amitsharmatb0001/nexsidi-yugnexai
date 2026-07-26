async function test() {
  const wsUrl = "ws://localhost:8080/ws/pipeline/d60863541d7b0";
  console.log("Connecting to:", wsUrl);
  try {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log("CONNECTED SUCCESSFULLY!");
      ws.close();
    };
    ws.onmessage = (e) => {
      console.log("MSG:", e.data);
    };
    ws.onerror = (e) => {
      console.error("WS ERROR:", e);
    };
    ws.onclose = (e) => {
      console.log("WS CLOSED:", e.code, e.reason);
    };
  } catch (err) {
    console.error("CATCH ERROR:", err);
  }
}

test();
