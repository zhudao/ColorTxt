/** 各格式 parser 产出、由 `writeEbookConversionArtifacts` 写入 `{basename}.md` 与 `{basename}.Images/` */
export type EbookMarkdownArtifacts = {
  utf8: string;
  /** 相对 `{basename}.md` 所在目录的路径，如 `abc.epub.Images/cover.jpg` */
  imageWrites?: Array<{ relativePath: string; data: ArrayBuffer }>;
};
