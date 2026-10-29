import { APP_DISPLAY_NAME } from "./packageDerived";

/** 找书独立窗口默认标题（与 find-book.html 一致） */
export const FIND_BOOK_WINDOW_TITLE = `${APP_DISPLAY_NAME}找书`;

export function formatFindBookWindowTitle(bookName?: string | null): string {
  const name = bookName?.trim();
  if (name) return `${name} - ${FIND_BOOK_WINDOW_TITLE}`;
  return FIND_BOOK_WINDOW_TITLE;
}
