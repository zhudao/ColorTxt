/** 对齐 Legado StringUtils / JsExtensions.toNumChapter */

const CHN_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  const cn1 = "零一二三四五六七八九十";
  for (let i = 0; i <= 10; i++) map[cn1[i]!] = i;
  const cn2 = "〇壹贰叁肆伍陆柒捌玖拾";
  for (let i = 0; i <= 10; i++) map[cn2[i]!] = i;
  map["两"] = 2;
  map["百"] = 100;
  map["佰"] = 100;
  map["千"] = 1000;
  map["仟"] = 1000;
  map["万"] = 10000;
  map["亿"] = 100000000;
  return map;
})();

const TITLE_NUM_PATTERN = /(第)(.+?)(章)/;

export function fullToHalf(input: string): string {
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i]!.codePointAt(0)!;
    if (code === 0x3000) {
      chars[i] = " ";
      continue;
    }
    if (code >= 0xff01 && code <= 0xff5e) {
      chars[i] = String.fromCodePoint(code - 0xfee0);
    }
  }
  return chars.join("");
}

export function chineseNumToInt(chNum: string): number {
  const cn = [...chNum];
  if (
    cn.length >= 1 &&
    /^[〇零一二三四五六七八九壹贰叁肆伍陆柒捌玖]+$/.test(chNum)
  ) {
    return Number.parseInt(
      cn.map((c) => String(48 + (CHN_MAP[c] ?? 0))).join(""),
      10,
    );
  }
  try {
    let result = 0;
    let tmp = 0;
    let billion = 0;
    for (let i = 0; i < cn.length; i++) {
      const tmpNum = CHN_MAP[cn[i]!];
      if (tmpNum == null) return -1;
      if (tmpNum === 100000000) {
        result += tmp;
        result *= tmpNum;
        billion = billion * 100000000 + result;
        result = 0;
        tmp = 0;
      } else if (tmpNum === 10000) {
        result += tmp;
        result *= tmpNum;
        tmp = 0;
      } else if (tmpNum >= 10) {
        if (tmp === 0) tmp = 1;
        result += tmpNum * tmp;
        tmp = 0;
      } else {
        const prev = i >= 1 ? CHN_MAP[cn[i - 1]!] : undefined;
        tmp =
          i >= 2 && i === cn.length - 1 && prev != null && prev > 10
            ? tmpNum * (prev / 10)
            : tmp * 10 + tmpNum;
      }
    }
    return result + tmp + billion;
  } catch {
    return -1;
  }
}

export function stringToInt(str: string | null | undefined): number {
  if (str == null) return -1;
  const num = fullToHalf(str).replace(/\s+/g, "");
  const parsed = Number.parseInt(num, 10);
  if (!Number.isNaN(parsed)) return parsed;
  return chineseNumToInt(num);
}

/** Legado JsExtensions.toNumChapter：第X章中的 X 转为阿拉伯数字 */
export function toNumChapter(s: string | null | undefined): string | null {
  if (s == null) return null;
  const matcher = TITLE_NUM_PATTERN.exec(s);
  if (!matcher) return s;
  const intStr = stringToInt(matcher[2]);
  if (intStr < 0) return s;
  return `${matcher[1]}${intStr}${matcher[3]}`;
}
