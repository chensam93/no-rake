import { spawn } from "node:child_process";

const NPM_CMD = "npm";
const HEALTH_URL = "http://127.0.0.1:3000/health";
const HEALTH_TIMEOUT_MS = 20000;
const HEALTH_POLL_MS = 400;

function parseArgs(argv) {
  return {
    quick: argv.includes("--quick"),
    serverOnly: argv.includes("--server-only"),
    clientOnly: argv.includes("--client-only"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerHealthy() {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServerHealthy(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy()) {
      return true;
    }
    await sleep(HEALTH_POLL_MS);
  }
  return false;
}

function pipeWithPrefix(stream, prefix) {
  if (!stream) return;
  stream.on("data", (chunk) => {
    const lines = String(chunk)
      .split(/\r?\n/)
      .filter(Boolean);
    for (const line of lines) {
      console.log(`[${prefix}] ${line}`);
    }
  });
}

async function runCommand(label, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPM_CMD, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    pipeWithPrefix(child.stdout, label);
    pipeWithPrefix(child.stderr, label);

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function startServerProcess() {
  const child = spawn(NPM_CMD, ["run", "start", "-w", "server"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  pipeWithPrefix(child.stdout, "server");
  pipeWithPrefix(child.stderr, "server");
  return child;
}

async function stopServerProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    sleep(2500),
  ]);
  if (!child.killed) {
    child.kill("SIGKILL");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.serverOnly && options.clientOnly) {
    throw new Error("Choose either --server-only or --client-only, not both.");
  }

  const shouldRunServerChecks = !options.clientOnly;
  const shouldRunClientChecks = !options.serverOnly;

  let startedServer = null;
  let usingExistingServer = false;

  try {
    if (shouldRunServerChecks) {
      usingExistingServer = await isServerHealthy();
      if (!usingExistingServer) {
        console.log("[suite] Starting local server for integration checks...");
        startedServer = startServerProcess();
        const healthy = await waitForServerHealthy(HEALTH_TIMEOUT_MS);
        if (!healthy) {
          throw new Error("Server did not become healthy in time.");
        }
      } else {
        console.log("[suite] Reusing existing server on :3000.");
      }

      await runCommand("lifecycle", ["run", "verify:lifecycle-guards", "-w", "server"]);
      await runCommand("host-admin", ["run", "verify:host-admin", "-w", "server"]);
      await runCommand("simulate", ["run", "simulate:round", "-w", "server"]);
      await runCommand("smoke", ["run", "smoke:two-player", "-w", "server"]);
    }

    if (shouldRunClientChecks) {
      if (!options.quick) {
        await runCommand("lint", ["run", "lint", "-w", "client"]);
      }
      await runCommand("bot", ["run", "test:bot-decision", "-w", "client"]);
    }

    console.log("[suite] All requested checks passed.");
  } finally {
    if (startedServer) {
      console.log("[suite] Stopping test server...");
      await stopServerProcess(startedServer);
    } else if (usingExistingServer) {
      console.log("[suite] Left existing server running.");
    }
  }
}

main().catch((error) => {
  console.error(`[suite] ${error.message}`);
  process.exit(1);
});
