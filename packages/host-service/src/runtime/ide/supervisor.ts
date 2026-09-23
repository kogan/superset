// The source travels in the host bundle; it also runs on Node without a TS loader.
export const IDE_SUPERVISOR_SOURCE = String.raw`
const { spawn } = require("node:child_process");
const { rmSync } = require("node:fs");
let child;
let socketDirectory;
let stopping = false;
function signalGroup(signal) {
  if (!child || !child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") process.stderr.write(error.message + "\n"); }
}
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  signalGroup("SIGTERM");
  setTimeout(() => {
    signalGroup("SIGKILL");
    if (socketDirectory) rmSync(socketDirectory, { recursive: true, force: true });
    process.exit(exitCode);
  }, 1500);
}
process.on("disconnect", () => stop());
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
process.once("message", ({ executable, args, cwd, socketDirectory: sockets }) => {
  if (stopping) return;
  socketDirectory = sockets;
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, args, { cwd, env: childEnv, detached: true, stdio: ["ignore", "inherit", "inherit"] });
  child.once("error", (error) => {
    process.stderr.write(error.message + "\n");
    stop(1);
  });
  child.once("exit", (code) => stop(code || 0));
});
`;
