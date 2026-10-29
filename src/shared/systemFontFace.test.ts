import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildListedSystemFonts,
  buildSystemFontFaceCss,
  buildSystemFontFamilyNames,
  familyNamesToRawFaces,
  mergeLegacyFamilyNames,
  type RawSystemFontFace,
} from "./systemFontFace.ts";

function face(
  partial: Partial<RawSystemFontFace> & Pick<RawSystemFontFace, "family">,
): RawSystemFontFace {
  return {
    family: partial.family,
    style: partial.style ?? "",
    postscriptName: partial.postscriptName ?? "",
    localNames: partial.localNames ?? [],
    weight: partial.weight ?? 0,
    italic: partial.italic ?? false,
    fileUrl: partial.fileUrl,
  };
}

describe("buildListedSystemFonts", () => {
  it("labels a single-face family but selects the real family name", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "Arial Black",
        style: "Regular",
        postscriptName: "Arial-Black",
        weight: 400,
      }),
    ]);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.label, "Arial Black 常规");
    assert.equal(listed[0]?.family, "Arial Black");
    assert.equal(listed[0]?.previewFamily, "Arial Black");
    assert.equal(listed[0]?.previewWeight, 400);
    assert.equal(listed[0]?.previewItalic, false);
    assert.equal(listed[0]?.cssFamily, "Arial Black");
    assert.deepEqual(listed[0]?.locals, []);
  });

  it("keeps stable family across collapsed and weight-split rows", () => {
    const raw = [
      face({
        family: "Arial",
        style: "Regular",
        postscriptName: "ArialMT",
        weight: 400,
      }),
      face({
        family: "Arial",
        style: "Bold",
        postscriptName: "Arial-BoldMT",
        weight: 700,
      }),
      face({
        family: "Arial Nova",
        style: "Regular",
        postscriptName: "ArialNova",
        weight: 400,
      }),
    ];
    const byWeight = buildListedSystemFonts(raw);
    const collapsed = buildSystemFontFamilyNames(raw);
    assert.ok(collapsed.includes("Arial"));
    assert.ok(collapsed.includes("Arial Nova"));
    const arialBold = byWeight.find((f) => f.label.includes("粗体"));
    assert.equal(arialBold?.family, "Arial");
    assert.notEqual(arialBold?.family, "Arial Nova");
  });

  it("labels Jun Pro families from OpenType weight despite Regular/Bold Win32 faces", () => {
    const raw = [
      face({
        family: "A-OTF Jun Pro 101",
        style: "Regular",
        localNames: ["A-OTF Jun Pro 101 Regular"],
        weight: 300,
      }),
      face({
        family: "A-OTF Jun Pro 101",
        style: "Regular",
        localNames: ["A-OTF Jun Pro 101 Regular"],
        weight: 300,
        italic: true,
      }),
      face({
        family: "A-OTF Jun Pro 201",
        style: "Regular",
        localNames: ["A-OTF Jun Pro 201 Regular"],
        weight: 400,
      }),
      face({
        family: "A-OTF Jun Pro 201",
        style: "Regular",
        localNames: ["A-OTF Jun Pro 201 Regular"],
        weight: 700,
      }),
      face({
        family: "A-OTF Jun Pro 34",
        style: "Bold",
        localNames: ["A-OTF Jun Pro 34 Bold"],
        weight: 505,
      }),
      face({
        family: "A-OTF Jun Pro 34",
        style: "Bold",
        localNames: ["A-OTF Jun Pro 34 Bold"],
        weight: 700,
      }),
      face({
        family: "A-OTF Jun Pro 501",
        style: "Bold",
        localNames: ["A-OTF Jun Pro 501 Bold"],
        weight: 600,
      }),
    ];
    const expected = [
      "A-OTF Jun Pro 101 细体",
      "A-OTF Jun Pro 201 常规",
      "A-OTF Jun Pro 34 中等",
      "A-OTF Jun Pro 501 半粗体",
    ];
    const listed = buildListedSystemFonts(raw);
    assert.deepEqual(
      listed.map((item) => item.label),
      expected,
    );
    assert.deepEqual(
      listed.map((item) => item.cssFamily),
      [
        "A-OTF Jun Pro 101",
        "A-OTF Jun Pro 201",
        "A-OTF Jun Pro 34",
        "A-OTF Jun Pro 501",
      ],
    );
    assert.deepEqual(buildSystemFontFamilyNames(raw), [
      "A-OTF Jun Pro 101",
      "A-OTF Jun Pro 201",
      "A-OTF Jun Pro 34",
      "A-OTF Jun Pro 501",
    ]);
  });

  it("maps OpenType weight when single-face style is a product code", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "A-OTF Jun Pro 101",
        style: "101",
        localNames: ["A-OTF Jun Pro 101"],
        weight: 300,
      }),
    ]);
    assert.equal(listed[0]?.label, "A-OTF Jun Pro 101 细体");
    assert.equal(listed[0]?.cssFamily, "A-OTF Jun Pro 101");
    assert.equal(listed[0]?.previewWeight, 300);
  });

  it("splits weights and orders them from thin to bold", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "PingFang SC",
        style: "Semibold",
        postscriptName: "PingFangSC-Semibold",
        weight: 8,
      }),
      face({
        family: "PingFang SC",
        style: "Regular",
        postscriptName: "PingFangSC-Regular",
        weight: 5,
      }),
      face({
        family: "PingFang SC",
        style: "Light",
        postscriptName: "PingFangSC-Light",
        weight: 3,
      }),
      face({
        family: "PingFang SC",
        style: "Thin",
        postscriptName: "PingFangSC-Thin",
        weight: 3,
      }),
      face({
        family: "PingFang SC",
        style: "Ultralight",
        postscriptName: "PingFangSC-Ultralight",
        weight: 2,
      }),
      face({
        family: "PingFang SC",
        style: "Medium",
        postscriptName: "PingFangSC-Medium",
        weight: 6,
      }),
    ]);
    assert.deepEqual(
      listed.map((item) => item.label),
      [
        "PingFang SC 极细",
        "PingFang SC 纤细",
        "PingFang SC 细体",
        "PingFang SC 常规",
        "PingFang SC 中黑",
        "PingFang SC 中粗",
      ],
    );
    const light = listed.find((item) => item.label === "PingFang SC 细体");
    assert.equal(light?.previewFamily, "PingFang SC");
    assert.equal(light?.cssFamily, "PingFang SC 细体");
    assert.equal(light?.previewWeight, 300);
    assert.deepEqual(light?.locals, ["PingFangSC-Light", "PingFang SC"]);
  });

  it("keeps an already localized style name", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "思源黑体",
        style: "常规",
        postscriptName: "SourceHanSansSC-Regular",
        weight: 400,
      }),
      face({
        family: "思源黑体",
        style: "粗体",
        postscriptName: "SourceHanSansSC-Bold",
        weight: 700,
      }),
      face({
        family: "思源黑体",
        style: "细体",
        postscriptName: "SourceHanSansSC-Light",
        weight: 300,
      }),
    ]);
    assert.deepEqual(
      listed.map((item) => item.label),
      ["思源黑体 细体", "思源黑体 常规", "思源黑体 粗体"],
    );
  });

  it("labels bold italic separately and after the upright face", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "Arial",
        style: "Bold Italic",
        postscriptName: "Arial-BoldItalic",
        italic: true,
        weight: 700,
      }),
      face({
        family: "Arial",
        style: "Bold",
        postscriptName: "Arial-Bold",
        weight: 700,
      }),
      face({
        family: "Arial",
        style: "Regular",
        postscriptName: "Arial-Regular",
        weight: 400,
      }),
    ]);
    assert.deepEqual(
      listed.map((item) => item.label),
      ["Arial 常规", "Arial 粗体", "Arial 粗体 斜体"],
    );
    assert.deepEqual(
      listed.map((item) => item.previewItalic),
      [false, false, true],
    );
  });

  it("sorts unknown style names such as W3/W6 by numeric weight", () => {
    const listed = buildListedSystemFonts([
      face({
        family: "Hiragino Sans GB",
        style: "W6",
        postscriptName: "HiraginoSansGB-W6",
        weight: 8,
      }),
      face({
        family: "Hiragino Sans GB",
        style: "W3",
        postscriptName: "HiraginoSansGB-W3",
        weight: 4,
      }),
    ]);
    assert.deepEqual(
      listed.map((item) => item.label),
      ["Hiragino Sans GB W3", "Hiragino Sans GB W6"],
    );
  });

  it("falls back to one family when faces cannot be pinned", () => {
    const listed = buildListedSystemFonts(
      familyNamesToRawFaces(["PingFang SC", "Songti SC", "PingFang SC"]),
    );
    assert.deepEqual(
      listed.map((item) => ({
        label: item.label,
        cssFamily: item.cssFamily,
        locals: item.locals,
      })),
      [
        { label: "PingFang SC", cssFamily: "PingFang SC", locals: [] },
        { label: "Songti SC", cssFamily: "Songti SC", locals: [] },
      ],
    );
  });

  it("collapses to bare family names when not distinguishing weights", () => {
    const names = buildSystemFontFamilyNames([
      face({
        family: "PingFang SC",
        style: "Regular",
        postscriptName: "PingFangSC-Regular",
        weight: 400,
      }),
      face({
        family: "PingFang SC",
        style: "Bold",
        postscriptName: "PingFangSC-Bold",
        weight: 700,
      }),
      face({
        family: "Songti SC",
        style: "Regular",
        postscriptName: "STSongti-SC-Regular",
        weight: 400,
      }),
      face({
        family: "A-OTF Jun Pro 101",
        style: "Regular",
        weight: 300,
      }),
    ]);
    assert.deepEqual(names, [
      "A-OTF Jun Pro 101",
      "PingFang SC",
      "Songti SC",
    ]);
  });

  it("does not override the family name when a face has no distinct label", () => {
    const listed = buildListedSystemFonts([
      face({ family: "Demo", style: "", postscriptName: "Demo-A", weight: 1 }),
      face({ family: "Demo", style: "", postscriptName: "Demo-B", weight: 2 }),
    ]);
    assert.equal(listed[0]?.label, "Demo");
    assert.equal(listed[0]?.cssFamily, "Demo");
    assert.deepEqual(listed[0]?.locals, []);
  });
});

describe("mergeLegacyFamilyNames", () => {
  it("keeps detailed faces and appends missing GDI family names", () => {
    const merged = mergeLegacyFamilyNames(
      [
        face({
          family: "A-OTF Jun Pro 101",
          style: "Regular",
          weight: 300,
          localNames: ["A-OTF Jun Pro 101 Regular"],
        }),
      ],
      ["A-OTF Jun Pro 101", "方正彩云_GBK", "等线", "爱奇艺黑体"],
    );
    assert.deepEqual(
      merged.map((item) => item.family),
      ["A-OTF Jun Pro 101", "方正彩云_GBK", "等线", "爱奇艺黑体"],
    );
    assert.equal(merged[0]?.weight, 300);
    assert.equal(merged[1]?.style, "");
  });
});

describe("buildSystemFontFaceCss", () => {
  it("pins only alias families that differ from preview family", () => {
    const css = buildSystemFontFaceCss([
      {
        label: "PingFang SC",
        family: "PingFang SC",
        previewFamily: "PingFang SC",
        previewWeight: 400,
        previewItalic: false,
        cssFamily: "PingFang SC",
        locals: [],
      },
      {
        label: "PingFang SC 细体",
        family: "PingFang SC",
        previewFamily: "PingFang SC",
        previewWeight: 300,
        previewItalic: false,
        cssFamily: "PingFang SC 细体",
        locals: ["PingFangSC-Light", 'PingFang SC "Light"'],
      },
    ]);
    assert.equal(css.includes('font-family:"PingFang SC";'), false);
    assert.match(css, /font-family:"PingFang SC 细体"/);
    assert.match(css, /local\("PingFangSC-Light"\)/);
    assert.match(css, /local\("PingFang SC \\"Light\\""\)/);
    assert.match(css, /font-weight:normal/);
  });

  it("prefers file url over local names for Windows faces", () => {
    const css = buildSystemFontFaceCss([
      {
        label: "A-OTF Kaimin Sora Std 中等",
        family: "A-OTF Kaimin Sora Std",
        previewFamily: "A-OTF Kaimin Sora Std",
        previewWeight: 500,
        previewItalic: false,
        cssFamily: "A-OTF Kaimin Sora Std 中等",
        locals: ["A-OTF Kaimin Sora Std M"],
        fileUrl:
          "file:///C:/Users/NG/AppData/Local/Microsoft/Windows/Fonts/A-OTF KAIMIN SORA STD M_0.OTF",
      },
    ]);
    assert.match(css, /font-family:"A-OTF Kaimin Sora Std 中等"/);
    assert.match(
      css,
      /src:url\("file:\/\/\/C:\/Users\/NG\/.*KAIMIN.*M_0\.OTF"\)/,
    );
    assert.match(css, /local\("A-OTF Kaimin Sora Std M"\)/);
  });

  it("skips cosmetic single-face labels that select the real family", () => {
    const css = buildSystemFontFaceCss([
      {
        label: "A-OTF Jun Pro 101 细体",
        family: "A-OTF Jun Pro 101",
        previewFamily: "A-OTF Jun Pro 101",
        previewWeight: 300,
        previewItalic: false,
        cssFamily: "A-OTF Jun Pro 101",
        locals: [],
        fileUrl: "file:///C:/Fonts/jun101.otf",
      },
    ]);
    assert.equal(css, "");
  });
});
