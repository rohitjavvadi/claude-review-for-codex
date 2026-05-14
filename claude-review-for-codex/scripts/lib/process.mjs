import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeout,
  });

  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function runCommandChecked(command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw new Error(`${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

export function spawnDetached(command, args, options = {}) {
  const stdio = ["ignore", "ignore", "ignore"];
  const opened = [];
  if (options.stdoutFile) {
    fs.mkdirSync(path.dirname(options.stdoutFile), { recursive: true });
    const fd = fs.openSync(options.stdoutFile, "a");
    opened.push(fd);
    stdio[1] = fd;
  }
  if (options.stderrFile) {
    fs.mkdirSync(path.dirname(options.stderrFile), { recursive: true });
    const fd = fs.openSync(options.stderrFile, "a");
    opened.push(fd);
    stdio[2] = fd;
  }
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio,
  });
  child.on("error", (error) => {
    if (options.stderrFile) {
      try {
        fs.appendFileSync(options.stderrFile, `${new Date().toISOString()} spawn error: ${error.message}\n`);
      } catch {}
    }
  });
  child.unref();
  for (const fd of opened) {
    try {
      fs.closeSync(fd);
    } catch {}
  }
  return child.pid;
}

export function binaryAvailable(command, args = ["--version"], cwd = process.cwd()) {
  const result = runCommand(command, args, { cwd, timeout: 10_000 });
  return {
    available: !result.error && result.status === 0,
    detail: result.error ? result.error.message : (result.stdout || result.stderr).trim(),
  };
}
