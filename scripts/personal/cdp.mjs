import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function connect() {
  const runtime = JSON.parse(await readFile(resolve(root, ".personal-data/runtime.json"), "utf8"));
  if (runtime.workspace !== root.replace(/\/$/, "")) throw new Error("Wrong workspace runtime");
  const targets = await fetch(`http://127.0.0.1:${runtime.debugPort}/json/list`).then(r => r.json());
  const target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl &&
    item.url.startsWith(`http://localhost:${runtime.rendererPort}/`));
  if (!target) throw new Error("This workspace's desktop renderer is not ready");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Renderer expression failed");
    return result.result.value;
  }
  async function click(selector, text) {
    const point = await evaluate(`(() => {
      const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const element = elements.find(el => el.getClientRects().length &&
        (${JSON.stringify(text ?? null)} === null ||
         el.textContent.trim() === ${JSON.stringify(text)} ||
         el.getAttribute('aria-label') === ${JSON.stringify(text)}));
      if (!element) throw new Error('Visible control not found');
      element.scrollIntoView({ block: 'nearest' });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  }
  async function screenshot(name) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid screenshot name");
    const directory = resolve(root, ".personal-data/evidence");
    await mkdir(directory, { recursive: true });
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = resolve(directory, `${name}.png`);
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  }
  return { send, evaluate, click, screenshot, runtime, target, close: () => ws.close() };
}

if (import.meta.main) {
  const client = await connect();
  try {
    const [action = "snapshot", argument, text] = process.argv.slice(2);
    let result;
    if (action === "snapshot") result = await client.evaluate(`({
      url: location.href,
      text: document.body.innerText.slice(0, 16000),
      controls: [...document.querySelectorAll('button, a, input, select')]
        .filter(el => el.getClientRects().length)
        .map(el => ({tag:el.tagName,id:el.id,text:el.tagName==='INPUT'?'':el.textContent.trim().slice(0,100),
          label:el.getAttribute('aria-label'),placeholder:el.getAttribute('placeholder'),type:el.getAttribute('type')}))
    })`);
    else if (action === "click") result = await client.click(argument, text);
    else if (action === "type") result = await client.send("Input.insertText", { text: argument });
    else if (action === "evaluate") result = await client.evaluate(argument);
    else if (action === "screenshot") result = await client.screenshot(argument);
    else throw new Error("Unknown CDP action");
    console.log(JSON.stringify(result ?? { ok: true }, null, 2));
  } finally {
    client.close();
  }
}
