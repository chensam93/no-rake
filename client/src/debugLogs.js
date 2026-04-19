const DEBUG_LOGS_KEY = "no-rake-debug-logs";

export function isDebugLogsEnabled() {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(DEBUG_LOGS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugLogsEnabled(enabled) {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled) {
      localStorage.setItem(DEBUG_LOGS_KEY, "1");
    } else {
      localStorage.removeItem(DEBUG_LOGS_KEY);
    }
  } catch {
    // ignore storage failures
  }
}
