const fs = require("fs");
const { app, session } = require("electron");

const META = "__COLORTXT_SYNC_HTTP_META__";
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

function readFrameSync() {
  const lenBuf = Buffer.alloc(4);
  let n = 0;
  while (n < 4) {
    const r = fs.readSync(0, lenBuf, n, 4 - n, null);
    if (r <= 0) throw new Error("sync HTTP helper: stdin closed before frame length");
    n += r;
  }
  const len = lenBuf.readUInt32BE(0);
  if (len <= 0 || len > MAX_BYTES + 65536) {
    throw new Error(`sync HTTP helper: invalid frame length ${len}`);
  }
  const payload = Buffer.alloc(len);
  n = 0;
  while (n < len) {
    const r = fs.readSync(0, payload, n, len - n, null);
    if (r <= 0) throw new Error("sync HTTP helper: stdin closed before frame body");
    n += r;
  }
  return payload;
}

function writeResponse(body, setCookie = []) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
  if (setCookie.length) {
    process.stderr.write(`${META}${JSON.stringify({ setCookie })}\n`);
  }
}

async function handleRequest(raw) {
  const req = JSON.parse(raw.toString("utf8"));
  const ses = session.fromPartition("persist:colortxt-binary-fetch");
  ses.setCertificateVerifyProc((_request, callback) => {
    callback(0);
  });
  const method = (req.method || "GET").toUpperCase();
  const init = {
    method,
    headers: req.headers || {},
    redirect: "follow",
    credentials: "omit",
    referrerPolicy: "unsafe-url",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
  if (req.body != null && method !== "GET" && method !== "HEAD") {
    init.body = req.body;
  }
  const res = await ses.fetch(req.url, init);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) {
    throw new Error("response too large");
  }
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (() => {
          const sc = res.headers.get("set-cookie");
          return sc ? [sc] : [];
        })();
  writeResponse(body, setCookie);
}

let requestRaw;
try {
  requestRaw = readFrameSync();
} catch (e) {
  process.stderr.write(String((e && e.stack) || e));
  process.exit(1);
}

app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await handleRequest(requestRaw);
    app.exit(0);
  } catch (e) {
    process.stderr.write(String((e && e.stack) || e));
    app.exit(1);
  }
});
