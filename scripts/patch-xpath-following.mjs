/**
 * xpath@0.0.34：`following::` 轴在上下文节点有子节点时误从 firstChild 起步，
 * 会把后代当成 following，且永远扫不到 nextSibling。
 * XPath 语义：following 不含后代，应从 nextSibling 起。
 * 书源例：`//div[@id='list']/dl/dt[2]/following::dd`（dt 内有 b/a 时原先取空）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "node_modules", "xpath", "xpath.js");
const marker = "colortxt-xpath-following-next-sibling";

const brokenLf = `            case Step.FOLLOWING:
                if (xpc.contextNode === xpc.virtualRoot) {
                    break;
                }
                var st = [];
                if (xpc.contextNode.firstChild != null) {
                    st.unshift(xpc.contextNode.firstChild);
                } else {
                    st.unshift(xpc.contextNode.nextSibling);
                }
                for (var m = xpc.contextNode.parentNode; m != null && m.nodeType != NodeTypes.DOCUMENT_NODE && m !== xpc.virtualRoot; m = m.parentNode) {
                    st.unshift(m.nextSibling);
                }`;

const fixedLf = `            case Step.FOLLOWING:
                if (xpc.contextNode === xpc.virtualRoot) {
                    break;
                }
                var st = [];
                // ${marker}: following excludes descendants; start at nextSibling
                st.unshift(xpc.contextNode.nextSibling);
                for (var m = xpc.contextNode.parentNode; m != null && m.nodeType != NodeTypes.DOCUMENT_NODE && m !== xpc.virtualRoot; m = m.parentNode) {
                    st.unshift(m.nextSibling);
                }`;

if (!fs.existsSync(target)) {
  console.warn(`[patch-xpath-following] skip: missing ${target}`);
  process.exit(0);
}

const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const src = raw.replace(/\r\n/g, "\n");
if (src.includes(marker)) {
  console.log("[patch-xpath-following] already applied");
  process.exit(0);
}
if (!src.includes(brokenLf)) {
  console.warn(
    "[patch-xpath-following] unexpected xpath.js content; skip (package may have changed)",
  );
  process.exit(0);
}

const out = src.replace(brokenLf, fixedLf).replace(/\n/g, eol);
fs.writeFileSync(target, out, "utf8");
console.log("[patch-xpath-following] applied");
