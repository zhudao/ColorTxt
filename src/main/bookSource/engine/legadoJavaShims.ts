import { createHash, createHmac, randomUUID as nodeRandomUUID } from "node:crypto";
import { createOrgPackage } from "./legadoJsoupShim";
import { syncBookSourceHttpBinary } from "./syncBookSourceFetch";
import { getBookSourceJsHost } from "./bookSourceJsContext";
import { createSymmetricCrypto } from "./legadoCrypto";

export { createOrgPackage } from "./legadoJsoupShim";

function isByteLike(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    (Array.isArray(value) && value.length > 0 && typeof value[0] === "number")
  );
}

function coerceJavaString(input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as { toString?: () => string };
    if (typeof obj.toString === "function") {
      return obj.toString();
    }
  }
  return String(input ?? "");
}

export { coerceJavaString };

function toBuffer(value: unknown): Buffer {
  return Buffer.from(value as Uint8Array);
}

/** Java UUID 风格对象：`String(uuid)` / 拼接不会抛 Cannot convert object to primitive value */
function createJavaUuid(): {
  toString(): string;
  valueOf(): string;
  [Symbol.toPrimitive](): string;
} {
  const id = nodeRandomUUID();
  return {
    toString: () => id,
    valueOf: () => id,
    [Symbol.toPrimitive]: () => id,
  };
}

/**
 * Packages.* 未实现路径的深代理。
 * 必须实现 @@toPrimitive / toString / valueOf，否则 `String(Packages.xxx)` 会抛
 * TypeError: Cannot convert object to primitive value（Rhino 上 Java 对象可 toString）。
 */
function createSafeDeepProxy(): object {
  const proxy = (): object =>
    new Proxy(
      function () {
        /* noop ctor / callable */
      },
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          if (prop === Symbol.toPrimitive) return () => "";
          if (prop === "toString" || prop === "valueOf") return () => "";
          return proxy();
        },
        apply: () => proxy(),
        construct: () => proxy(),
      },
    );
  return proxy();
}

function coerceBytes(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  return Buffer.from(String(data ?? ""), "utf8");
}

function createDigestUtilShim(): Record<string, unknown> {
  return {
    md5Hex: (str: unknown) =>
      createHash("md5").update(coerceBytes(str)).digest("hex"),
    /** Hutool DigestUtil.md5(ByteArray) → MD5 摘要字节 */
    md5: (data: unknown) =>
      Array.from(createHash("md5").update(coerceBytes(data)).digest()),
  };
}

const ANDROID_BASE64 = {
  NO_WRAP: 2,
  DEFAULT: 0,
  encodeToString(data: unknown, _flags?: number) {
    return coerceBytes(data).toString("base64");
  },
  decode(str: unknown, _flags?: number) {
    return Array.from(Buffer.from(String(str ?? ""), "base64"));
  },
};

/** java.util.Base64 — 部分 API 书源：`Base64.getDecoder().decode(...)` */
const JAVA_UTIL_BASE64 = {
  getDecoder() {
    return {
      decode(input: unknown) {
        return Buffer.from(coerceJavaString(input), "base64");
      },
    };
  },
  getEncoder() {
    return {
      encode(input: unknown) {
        return Buffer.from(toBuffer(input)).toString("base64");
      },
      encodeToString(input: unknown) {
        return Buffer.from(toBuffer(input)).toString("base64");
      },
    };
  },
};

/**
 * JavaImporter 扁平命名空间里的 Base64：同时支持
 * android.util（encodeToString）与 java.util（getDecoder）。
 * 勿只用 ANDROID_BASE64 覆盖，否则部分 API 书源正文 AES 解密报 getDecoder is not a function。
 */
const IMPORTER_BASE64 = {
  ...ANDROID_BASE64,
  ...JAVA_UTIL_BASE64,
};
/** 常见 Android Build 字段桩（部分登录脚本用来拼设备指纹） */
const ANDROID_BUILD_STUB: Record<string, string> = {
  MODEL: "ColorTxt",
  MANUFACTURER: "ColorTxt",
  BRAND: "ColorTxt",
  DEVICE: "colortxt",
  PRODUCT: "colortxt",
  HARDWARE: "colortxt",
  FINGERPRINT: "colortxt/colortxt/colortxt:1/release/0",
};

function createNamespaceProxy(
  known: Record<string, unknown>,
): Record<string, unknown> {
  return new Proxy(known, {
    get(target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop];
      }
      return createSafeDeepProxy();
    },
  });
}

/** Legado Packages.* — 深代理；Packages.org 提供 jsoup；补齐 UUID / Build 等常用桩 */
export function createPackagesStub(): Record<string, unknown> {
  const org = createOrgPackage();
  const javaUtil = createNamespaceProxy({
    UUID: {
      randomUUID: () => createJavaUuid(),
    },
    Base64: JAVA_UTIL_BASE64,
  });
  const java = createNamespaceProxy({
    util: javaUtil,
  });
  const androidOs = createNamespaceProxy({
    Build: ANDROID_BUILD_STUB,
  });
  const androidText = createNamespaceProxy({
    TextUtils: {
      isEmpty: (value: unknown) => !String(value ?? "").trim(),
    },
  });
  const androidUtil = createNamespaceProxy({
    Base64: ANDROID_BASE64,
  });
  const android = createNamespaceProxy({
    os: androidOs,
    text: androidText,
    util: androidUtil,
  });
  const cn = createNamespaceProxy({
    hutool: createNamespaceProxy({
      crypto: createNamespaceProxy({
        digest: createNamespaceProxy({
          DigestUtil: createDigestUtilShim(),
        }),
      }),
    }),
  });

  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        if (prop === "org") return org;
        if (prop === "java") return java;
        if (prop === "android") return android;
        if (prop === "cn") return cn;
        return createSafeDeepProxy();
      },
    },
  );
}

function createJavaLikeString(str: string): unknown {
  const boxed = Object(str);
  return new Proxy(boxed, {
    get(target, prop, receiver) {
      if (prop === "getBytes") {
        return (_charset?: string) => Buffer.from(str, "utf8");
      }
      if (prop === "toJSON") {
        return () => str;
      }
      if (prop === Symbol.toPrimitive) {
        return (hint: string) => (hint === "number" ? Number(str) : str);
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === "function") {
        return (val as (...args: unknown[]) => unknown).bind(target);
      }
      return val;
    },
  });
}

function createJavaLangShims(): Record<string, unknown> {
  function stringValue(value?: unknown): string {
    if (isByteLike(value)) {
      return toBuffer(value).toString("utf8");
    }
    return value === undefined ? "" : String(value);
  }

  function javaString(value?: unknown): unknown {
    return createJavaLikeString(stringValue(value));
  }
  return { String: javaString };
}

function createJavaUtilShims(): Record<string, unknown> {
  return {
    UUID: {
      randomUUID: () => createJavaUuid(),
    },
    Base64: IMPORTER_BASE64,
    Arrays: {
      copyOfRange(arr: unknown, from: number, to: number) {
        return toBuffer(arr).subarray(from, to);
      },
    },
  };
}

function normalizeMacAlgorithm(algorithm: string): string {
  const u = algorithm.trim();
  const hyphen = u.match(/^HMAC[-_](MD5|SHA-?1|SHA-?256|SHA-?384|SHA-?512)$/i);
  if (hyphen) {
    return hyphen[1]!.replace(/-/g, "").toLowerCase();
  }
  const compact = u.match(/^Hmac?(MD5|SHA1|SHA256|SHA384|SHA512)$/i);
  if (compact) {
    const inner = compact[1]!.toUpperCase();
    if (inner === "MD5") return "md5";
    return inner.toLowerCase();
  }
  const stripped = u.toLowerCase().replace(/^hmac[-_]?/, "");
  if (stripped === "md5") return "md5";
  if (/^sha\d+$/.test(stripped)) return stripped;
  return stripped;
}

function createJavaxCryptoShims(): Record<string, unknown> {
  const ENCRYPT_MODE = 1;
  const DECRYPT_MODE = 2;

  /** javax.crypto.spec.DESKeySpec — DES 密钥取前 8 字节 */
  function DESKeySpec(key: unknown) {
    const buf = isByteLike(key)
      ? toBuffer(key)
      : Buffer.from(String(key ?? ""), "utf8");
    const key8 =
      buf.length >= 8
        ? Buffer.from(buf.subarray(0, 8))
        : Buffer.concat([buf, Buffer.alloc(8 - buf.length)]);
    return { key: key8 };
  }

  return {
    Mac: {
      getInstance(algorithm: string) {
        const nodeAlgo = normalizeMacAlgorithm(algorithm);
        let keyBuf = Buffer.alloc(0);
        return {
          init(keySpec: { key?: Buffer } | unknown) {
            if (keySpec && typeof keySpec === "object" && "key" in keySpec) {
              keyBuf = Buffer.from((keySpec as { key: Buffer }).key);
            } else {
              keyBuf = Buffer.from(String(keySpec ?? ""));
            }
          },
          doFinal(data: unknown) {
            const input = isByteLike(data)
              ? toBuffer(data)
              : Buffer.from(String(data ?? ""), "utf8");
            return createHmac(nodeAlgo, keyBuf).update(input).digest();
          },
        };
      },
    },
    SecretKeySpec(key: unknown, _algo: string) {
      const buf = isByteLike(key)
        ? toBuffer(key)
        : Buffer.from(String(key ?? ""), "utf8");
      return { key: buf };
    },
    DESKeySpec,
    SecretKeyFactory: {
      getInstance(_algorithm: string) {
        return {
          generateSecret(keySpec: { key?: Buffer } | unknown) {
            if (keySpec && typeof keySpec === "object" && "key" in keySpec) {
              return { key: Buffer.from((keySpec as { key: Buffer }).key) };
            }
            return { key: Buffer.alloc(0) };
          },
        };
      },
    },
    IvParameterSpec(iv: Buffer) {
      return { iv: Buffer.from(iv) };
    },
    Cipher: {
      ENCRYPT_MODE,
      DECRYPT_MODE,
      getInstance(transformation: string) {
        let trans = String(transformation ?? "AES/CBC/PKCS5Padding").trim();
        // Java：Cipher.getInstance("DES") ≡ DES/ECB/PKCS5Padding（部分书源 encryptByDES）
        if (!trans.includes("/")) {
          trans = `${trans}/ECB/PKCS5Padding`;
        }
        let opmode = DECRYPT_MODE;
        let keyObj: { key: Buffer } | null = null;
        let ivObj: { iv: Buffer } | null = null;
        return {
          init(
            op: number,
            key: { key: Buffer },
            iv?: { iv: Buffer },
          ) {
            opmode = op;
            keyObj = key;
            ivObj = iv ?? null;
          },
          doFinal(data: unknown) {
            if (!keyObj?.key) throw new Error("Cipher not initialized");
            const crypto = createSymmetricCrypto(
              trans,
              keyObj.key,
              ivObj?.iv,
            );
            if (opmode === ENCRYPT_MODE) {
              const input = isByteLike(data)
                ? toBuffer(data)
                : Buffer.from(String(data ?? ""), "utf8");
              return crypto.encrypt(input);
            }
            return crypto.decrypt(data);
          },
        };
      },
    },
  };
}

/** Rhino JavaImporter — 注入 Hutool/OkHttp 与 java.lang / javax.crypto 兼容层 */
export function createJavaImporter(log: (msg: string) => void): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  bag.importPackage = (..._pkg: unknown[]) => {
    Object.assign(
      bag,
      createHutoolShims(),
      createOkHttpShims(log),
      createJavaLangShims(),
      createJavaUtilShims(),
      createJavaxCryptoShims(),
      // 保留 android encodeToString，同时勿丢掉 java.util getDecoder（见 IMPORTER_BASE64）
      { Base64: IMPORTER_BASE64 },
    );
  };
  return bag;
}

function createHutoolShims(): Record<string, unknown> {
  return {
    DigestUtil: createDigestUtilShim(),
    StrUtil: {
      reverse: (str: unknown) => [...String(str)].reverse().join(""),
    },
    Base64: {
      decode: (str: unknown) => Buffer.from(String(str), "base64").toString("utf8"),
    },
    ZipUtil: {
      gzip: (data: unknown) => String(data),
    },
  };
}

function createOkHttpResponse(buf: Buffer): Record<string, unknown> {
  return {
    code: () => 200,
    body: () => ({
      bytes: () => Array.from(buf),
      string: () => buf.toString("utf8"),
    }),
    close: () => undefined,
  };
}

function createOkHttpShims(log: (msg: string) => void): Record<string, unknown> {
  class Builder {
    private requestUrl = "";
    private headers: Record<string, string> = {};
    private body: string | null = null;
    url(u: string) {
      this.requestUrl = u;
      return this;
    }
    post(b: unknown) {
      this.body = String(b ?? "");
      return this;
    }
    get() {
      return this;
    }
    addHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    }
    build() {
      return { url: this.requestUrl, headers: this.headers, body: this.body };
    }
  }
  return {
    MediaType: { parse: () => "application/json" },
    RequestBody: { create: (body: unknown) => String(body ?? "") },
    Request: { Builder },
    OkHttpClient: class {
      newCall(req: {
        url: string;
        headers: Record<string, string>;
        body: string | null;
      }) {
        return {
          execute: () => {
            const method = req.body != null && req.body !== "" ? "POST" : "GET";
            try {
              const buf = syncBookSourceHttpBinary(
                {
                  url: req.url,
                  headers: req.headers,
                  method,
                  body: req.body,
                },
                getBookSourceJsHost()?.source,
              );
              return createOkHttpResponse(buf);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log(`jsLib okhttp ${method} ${req.url}: ${msg}`);
              throw e instanceof Error ? e : new Error(msg);
            }
          },
        };
      }
    },
  };
}
