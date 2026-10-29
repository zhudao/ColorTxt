import type * as monaco from "monaco-editor";
import {
  defaultReaderPaletteColorEnabled,
  type ReaderSurfaceColorEnabled,
} from "../constants/readerPalette";
import {
  buildTxtrCustomHighlightMonarchRules,
  type TxtrMonarchHighlightOptions,
} from "./txtrHighlightMonarch";

export type { TxtrMonarchHighlightOptions };

/**
 * 不含成对括号开符（由 root 中优先匹配并进入 string/bracket 状态）。
 * 保留闭符与独立标点，便于未配对时在 root 仍显示为标点。
 * 半角 < > 仅作标点（比较符）；全角 ＜ 为开符、未配对的 ＞ 作标点。
 * ‹› 〈〉 «» ﹝﹞ 〔〕 ［］ 与语音朗读过滤一致，按括号配对。
 */
const PUNCTUATION_CLASS =
  /[,，.。!！?？:：;；、）\]\}｝】〗》＞>〉›»﹞〕］<…—\-]/;

/**
 * BMP 拉丁字母：ASCII、全角拉丁、Latin-1 字母段（跳过 × U+00D7、÷ U+00F7）、Latin Extended-A/B（含拼音 ā/ō/ē/ǎ/ǖ 等）。
 * 不使用 `\p{Script=Latin}`：Monarch 分词所用正则引擎可能不支持 Unicode 属性类，会导致普通英文也无法匹配。
 */
const LATIN_LETTERS_BMP =
  "A-Za-z\\uFF21-\\uFF3A\\uFF41-\\uFF5A" +
  "\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF" +
  "\\u0100-\\u017F" +
  "\\u0180-\\u024F";

/** 结合用变音标记（NFD：`a`+U+0301）；跟在拉丁字母后算同一词 */
const COMBINING_DIACRITIC_BMP = "\\u0300-\\u036F";

const LATIN_WORD = new RegExp(
  `(?:[${LATIN_LETTERS_BMP}][${COMBINING_DIACRITIC_BMP}]*)+`,
);

/** ASCII / 全角数字，圈号/括注/罗马数字，以及上标、下标、分数 */
const NUMBER = new RegExp(
  "[0-9\\uFF10-\\uFF19" +
    "\\u00B2\\u00B3\\u00B9\\u00BA\\u00BC-\\u00BE" + // ²³¹º¼½¾
    "\\u2070\\u2074-\\u2079\\u207F" + // ⁰⁴⁻⁹ⁿ
    "\\u2080-\\u2089" + // ₀-₉
    "\\u2150-\\u215E" + // ⅐⅑⅒⅓⅔⅕…⅞
    "\\u2160-\\u216B" + // Ⅰ-Ⅻ
    "\\u2170-\\u2179" + // ⅰ-ⅹ
    "\\u2460-\\u249B" + // ①-⑳⑴-⒇⒈-⒛
    "\\u2776-\\u277F" + // ❶-❿
    "\\u3220-\\u3229" + // ㈠-㈩
    "]+",
);
/**
 * 网文分隔/装饰符号（几何、花色、星月、勾叉、花号、音符、圈字、箭头、斜线/竖线等），
 * 以及单位、货币、百分、比较/运算符号。
 * 不含成对引号/括号开闭符（走标点与子状态）。
 * `ml` / `mol` 仍走字母，避免 html / molecule 被切开。
 */
const SPECIAL_MARKERS = new RegExp(
  "[" +
    "·•▪‥∷*＊✲❈※✿❀" +
    "△▲▽▼○●◇◆□■☆★▷▶◁◀◎◈▣◐◑◮◪" +
    "♤♠♡♥❤❥ღ♢♦♧♣" +
    "☀☽☾♀♂☥☯" +
    "☑☒√×✔✘✖✚" +
    "♩♪♫♬♭♯♮§¶‖" +
    "®©™№㊤㊥㊦㊧㊨㊣✪㈱㏂㏘" +
    "↑↗→↘↓↙←↖↕↔➷➹✉" +
    "/|\\\\／｜＼" +
    "′″°℃℉%‰％$¥￥£€￠฿￡" +
    "㎎㎏㎜㎝㎞㎡㏄㏕㏒㏑μ" +
    "∶∵∴∑∏∅⊙≤≦≥≧≠≡≈≮≯＋－÷＝±" +
    "]",
);

function specialMarkerRules(
  token: string,
): monaco.languages.IMonarchLanguageRule[] {
  return [[/μm/, token], [/m\u00B3/, token], [SPECIAL_MARKERS, token]];
}

/** 在否定字符类中需要转义的闭括号字符 */
function escapeForNegatedClass(closeChar: string): string {
  if (closeChar === "]") return "\\]";
  if (closeChar === "\\") return "\\\\";
  if (closeChar === "-") return "\\-";
  if (closeChar === "^") return "\\^";
  return closeChar;
}

/**
 * 兜底：不含闭符、换行、数字、拉丁（含全角拉丁）。
 * 这里必须“单字符推进”而非 `+` 贪婪段匹配，否则会把「前缀+高亮词」整段吞掉，
 * 使高亮词规则（txtr.customHighlight.*）无法在中间位置命中。
 * 引号内额外排除括号开符，保证 `《…》` 能进入 bracket 子状态。
 */
function innerRestRe(
  closeChar: string,
  stopBeforeBracketOpeners: boolean,
): RegExp {
  const e = escapeForNegatedClass(closeChar);
  const noBracketOpen = stopBeforeBracketOpeners
    ? "《＜（【〖｛\\[\\(\\{‹〈«﹝〔［"
    : "";
  return new RegExp(`[^${e}\\r\\n0-9${LATIN_LETTERS_BMP}${noBracketOpen}]`);
}

/** 与 root 一致；在引号内须排在自定义高亮词之后，避免 `《` 抢在高亮词匹配之前进入括号状态 */
function bracketOpenerRules(): monaco.languages.IMonarchLanguageRule[] {
  return [
    [/《/, { token: "txtr.punctuation", next: "bracketBook" }],
    [/＜/, { token: "txtr.punctuation", next: "bracketAngleFull" }],
    [/〈/, { token: "txtr.punctuation", next: "bracketAngleCjk" }],
    [/«/, { token: "txtr.punctuation", next: "bracketGuillemet" }],
    [/‹/, { token: "txtr.punctuation", next: "bracketAngleQuoteSingle" }],
    [/\(/, { token: "txtr.punctuation", next: "bracketParenAscii" }],
    [/（/, { token: "txtr.punctuation", next: "bracketParenFull" }],
    [/〔/, { token: "txtr.punctuation", next: "bracketTortoise" }],
    [/﹝/, { token: "txtr.punctuation", next: "bracketOrnateParen" }],
    [/\[/, { token: "txtr.punctuation", next: "bracketSquareAscii" }],
    [/［/, { token: "txtr.punctuation", next: "bracketSquareFull" }],
    [/【/, { token: "txtr.punctuation", next: "bracketCjk" }],
    [/〖/, { token: "txtr.punctuation", next: "bracketFancy" }],
    [/\{/, { token: "txtr.punctuation", next: "bracketCurlyAscii" }],
    [/｛/, { token: "txtr.punctuation", next: "bracketCurlyFull" }],
  ];
}

function tokenInsideDelimited(
  innerToken: "txtr.quoteInner" | "txtr.bracketInner",
  specificToken: string,
  enabled: boolean,
): string {
  return enabled ? specificToken : innerToken;
}

/**
 * 引号/括号内侧：自定义高亮词优先于引号/括号内侧兜底；引号内再在高亮词之后尝试括号开符，以便「《书名》」仍为 bracketInner。
 * 数字、英文、标点等可独立上色；对应开关关闭时在引号/括号内回退为 quoteInner / bracketInner（而非 root 的 english 等）。
 */
function rulesInsideDelimited(
  closeMatch: RegExp,
  closeChar: string,
  innerToken: "txtr.quoteInner" | "txtr.bracketInner",
  highlightRules: monaco.languages.IMonarchLanguageRule[],
  colorEnabled: ReaderSurfaceColorEnabled,
  /** 仅 true：在引号内于高亮词之后匹配成对括号开符 */
  bracketOpenersInQuote = false,
): monaco.languages.IMonarchLanguageRule[] {
  return [
    [/[\r\n]/, { token: "", next: "@pop" }],
    ...highlightRules,
    ...(bracketOpenersInQuote ? bracketOpenerRules() : []),
    [closeMatch, { token: "txtr.punctuation", next: "@pop" }],
    ...specialMarkerRules(
      tokenInsideDelimited(
        innerToken,
        "txtr.specialMarker",
        colorEnabled.txtrSpecialMarker,
      ),
    ),
    [
      NUMBER,
      tokenInsideDelimited(innerToken, "txtr.number", colorEnabled.txtrNumber),
    ],
    [
      LATIN_WORD,
      tokenInsideDelimited(
        innerToken,
        "txtr.english",
        colorEnabled.txtrEnglish,
      ),
    ],
    [
      PUNCTUATION_CLASS,
      tokenInsideDelimited(
        innerToken,
        "txtr.punctuation",
        colorEnabled.txtrPunctuation,
      ),
    ],
    [innerRestRe(closeChar, bracketOpenersInQuote), innerToken],
  ];
}

/**
 * `includeLF: true` 时行尾 \\n 可匹配，未闭合的引号/括号在换行处 @pop（不跨行）。
 * `includeLF: false` 时成对符号可跨行（由设置「引号/括号匹配支持跨行」与「内容上色」共同决定）。
 * 标点 token 仅在 root 匹配；引号内为 txtr.quoteInner；成对括号内为 txtr.bracketInner。
 * root 先括号开符再高亮词；引号内先高亮词再括号开符，故高亮词优先于引号内侧、括号开符仍优先于纯引号内兜底。
 */
export function createTxtrTextMonarchLanguage(
  highlight?: TxtrMonarchHighlightOptions,
  /** 为 true 时成对引号/括号可跨行（Monarch includeLF: false） */
  delimitedMatchCrossLine = false,
  colorEnabled: ReaderSurfaceColorEnabled = defaultReaderPaletteColorEnabled,
): monaco.languages.IMonarchLanguage {
  const hl = highlight ?? {
    enabled: false,
    highlightColorsLength: 0,
    highlightWordsByIndex: undefined,
  };
  const hlRules = buildTxtrCustomHighlightMonarchRules(hl);
  const crossLineEffective = Boolean(hl.enabled) && delimitedMatchCrossLine;
  const insideColor = { ...defaultReaderPaletteColorEnabled, ...colorEnabled };

  return {
    defaultToken: "",
    /** 见文件头注释：仅「内容上色」且开启跨行时为 false */
    includeLF: !crossLineEffective,
    tokenizer: {
      root: [
        ...bracketOpenerRules(),
        [/"/, { token: "txtr.punctuation", next: "stringDouble" }],
        /** 全角双引号 ＂（U+FF02），开闭同形 */
        [/\uFF02/, { token: "txtr.punctuation", next: "stringDoubleFull" }],
        [/「/, { token: "txtr.punctuation", next: "stringCorner" }],
        [/『/, { token: "txtr.punctuation", next: "stringWhite" }],
        [/\u201C/, { token: "txtr.punctuation", next: "stringLdquo" }],
        [/\u2018/, { token: "txtr.punctuation", next: "stringLsquo" }],
        ...hlRules,
        ...specialMarkerRules("txtr.specialMarker"),
        [NUMBER, "txtr.number"],
        [LATIN_WORD, "txtr.english"],
        [PUNCTUATION_CLASS, "txtr.punctuation"],
        [/./, ""],
      ],

      stringDouble: rulesInsideDelimited(
        /"/,
        '"',
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      stringDoubleFull: rulesInsideDelimited(
        /\uFF02/,
        "\uFF02",
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      stringCorner: rulesInsideDelimited(
        /」/,
        "」",
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      stringWhite: rulesInsideDelimited(
        /』/,
        "』",
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      stringLdquo: rulesInsideDelimited(
        /\u201D/,
        "\u201D",
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      stringLsquo: rulesInsideDelimited(
        /\u2019/,
        "\u2019",
        "txtr.quoteInner",
        hlRules,
        insideColor,
        true,
      ),

      bracketBook: rulesInsideDelimited(
        /》/,
        "》",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketAngleFull: rulesInsideDelimited(
        /＞/,
        "＞",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketAngleCjk: rulesInsideDelimited(
        /〉/,
        "〉",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketGuillemet: rulesInsideDelimited(
        /»/,
        "»",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketAngleQuoteSingle: rulesInsideDelimited(
        /›/,
        "›",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketParenAscii: rulesInsideDelimited(
        /\)/,
        ")",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketParenFull: rulesInsideDelimited(
        /）/,
        "）",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketTortoise: rulesInsideDelimited(
        /〕/,
        "〕",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketOrnateParen: rulesInsideDelimited(
        /﹞/,
        "﹞",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketSquareAscii: rulesInsideDelimited(
        /\]/,
        "]",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketSquareFull: rulesInsideDelimited(
        /］/,
        "］",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketCjk: rulesInsideDelimited(
        /】/,
        "】",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketFancy: rulesInsideDelimited(
        /〗/,
        "〗",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketCurlyAscii: rulesInsideDelimited(
        /\}/,
        "}",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),

      bracketCurlyFull: rulesInsideDelimited(
        /｝/,
        "｝",
        "txtr.bracketInner",
        hlRules,
        insideColor,
      ),
    },
  };
}
