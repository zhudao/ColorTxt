export type SmartFormatReviewScope = "full" | "selection";

export type SmartFormatReviewSession = {
  /** 排版范围起始行（1-based，相对主文档） */
  startLine: number;
  /** 排版范围结束行（原始，写回前） */
  endLine: number;
  originalText: string;
  proposedText: string;
  scope: SmartFormatReviewScope;
};
