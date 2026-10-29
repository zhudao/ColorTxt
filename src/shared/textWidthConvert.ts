import type { TextConvertWidthMode } from "./textConvertTypes";

const FULLWIDTH_LATIN_UPPER = /[\uFF21-\uFF3A]/g;
const FULLWIDTH_LATIN_LOWER = /[\uFF41-\uFF5A]/g;
const HALFWIDTH_LATIN = /[A-Za-z]/g;
const FULLWIDTH_DIGIT = /[\uFF10-\uFF19]/g;
const HALFWIDTH_DIGIT = /[0-9]/g;

function fullToHalfLatin(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0xff21 && code <= 0xff3a) {
    return String.fromCharCode(code - 0xfee0);
  }
  if (code >= 0xff41 && code <= 0xff5a) {
    return String.fromCharCode(code - 0xfee0);
  }
  return ch;
}

function halfToFullLatin(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x41 && code <= 0x5a) {
    return String.fromCharCode(code + 0xfee0);
  }
  if (code >= 0x61 && code <= 0x7a) {
    return String.fromCharCode(code + 0xfee0);
  }
  return ch;
}

function fullToHalfDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0xff10 && code <= 0xff19) {
    return String.fromCharCode(code - 0xfee0);
  }
  return ch;
}

function halfToFullDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) {
    return String.fromCharCode(code + 0xfee0);
  }
  return ch;
}

export function convertLettersWidth(
  text: string,
  mode: TextConvertWidthMode,
): string {
  if (mode === "off") return text;
  if (mode === "full-to-half") {
    return text
      .replace(FULLWIDTH_LATIN_UPPER, fullToHalfLatin)
      .replace(FULLWIDTH_LATIN_LOWER, fullToHalfLatin);
  }
  return text.replace(HALFWIDTH_LATIN, halfToFullLatin);
}

export function convertDigitsWidth(
  text: string,
  mode: TextConvertWidthMode,
): string {
  if (mode === "off") return text;
  if (mode === "full-to-half") {
    return text.replace(FULLWIDTH_DIGIT, fullToHalfDigit);
  }
  return text.replace(HALFWIDTH_DIGIT, halfToFullDigit);
}
