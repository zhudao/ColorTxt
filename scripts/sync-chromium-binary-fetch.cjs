/**
 * jsLib OkHttp getBytes 同步二进制拉取（须在 Electron 子进程运行，勿 ELECTRON_RUN_AS_NODE）。
 */
const electron = require("electron");

const META = "__COLORTXT_SYNC_HTTP_META__";
const MAX_BYTES = 8 * 1024 * 1024;

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
  });
}

async function main(raw) {
  const app = electron.app;
  if (!app) {
    throw new Error("sync-chromium-binary-fetch requires Electron main process");
  }
  app.commandLine.appendSwitch("disable-gpu");
  app.disableHardwareAcceleration();
  await app.whenReady();

  const { url, headers, method, body } = JSON.parse(raw);
  const ses = electron.session.fromPartition("persist:colortxt-sync-binary-fetch");
  ses.setCertificateVerifyProc((_request, callback) => {
    callback(0);
  });
  const init = {
    method: method || "GET",
    headers: headers || {},
    redirect: "follow",
    credentials: "omit",
    referrerPolicy: "unsafe-url",
  };
  if (body != null && init.method !== "GET" && init.method !== "HEAD") {
    init.body = body;
  }
  const res = await ses.fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    process.stderr.write("response too large");
    app.exit(2);
    return;
  }
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (() => {
          const sc = res.headers.get("set-cookie");
          return sc ? [sc] : [];
        })();
  if (setCookie.length) {
    process.stderr.write(`${META}${JSON.stringify({ setCookie })}\n`);
  }
  process.stdout.write(buf);
  app.exit(0);
}

readStdin()
  .then((raw) => main(raw))
  .catch((e) => {
    process.stderr.write(String((e && e.stack) || e));
    if (electron.app) electron.app.exit(1);
    else process.exit(1);
  });

