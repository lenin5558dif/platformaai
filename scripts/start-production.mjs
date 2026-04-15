import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();
const standaloneServer = path.join(cwd, ".next", "standalone", "server.js");
const command = existsSync(standaloneServer)
  ? { bin: "node", args: [standaloneServer] }
  : { bin: "npx", args: ["next", "start"] };

const child = spawn(command.bin, command.args, {
  cwd,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
