import { computed, ref } from "vue";
import type { SearchBookItem } from "@shared/bookSource/types";
import type { CategoryEditorRow } from "../../constants/fileCategories";
import {
  addToFindBookBookshelf,
  applyBookshelfCategoryCatalogEdit,
  bookshelfBookKey,
  loadFindBookBookshelf,
  removeFromFindBookBookshelf,
  saveFindBookBookshelf,
  setFindBookBookshelfCanUpdate,
  setFindBookBookshelfCategories,
  setFindBookBookshelfCategory,
  updateFindBookBookshelfReadProgress,
  type BookshelfAddOptions,
  type BookshelfBook,
} from "../findBookBookshelf";

const STORAGE_KEY = "colortxt:findBookBookshelf";

const booksRef = ref<BookshelfBook[]>(loadFindBookBookshelf());

function syncFromStorage() {
  booksRef.value = loadFindBookBookshelf();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key === STORAGE_KEY) syncFromStorage();
  });
}

export function useFindBookBookshelf() {
  const books = computed(() => booksRef.value);

  function refresh() {
    syncFromStorage();
  }

  function findBookshelfBook(
    bookUrl: string,
    origin: string,
  ): BookshelfBook | undefined {
    const key = bookshelfBookKey(bookUrl, origin);
    return booksRef.value.find(
      (b) => bookshelfBookKey(b.bookUrl, b.origin) === key,
    );
  }

  function isInBookshelf(bookUrl: string, origin: string): boolean {
    return Boolean(findBookshelfBook(bookUrl, origin));
  }

  function add(item: SearchBookItem, options?: BookshelfAddOptions) {
    booksRef.value = addToFindBookBookshelf(item, options);
  }

  function remove(bookUrl: string, origin: string) {
    booksRef.value = removeFromFindBookBookshelf(bookUrl, origin);
  }

  function toggle(item: SearchBookItem, options?: BookshelfAddOptions): boolean {
    if (isInBookshelf(item.bookUrl, item.origin)) {
      remove(item.bookUrl, item.origin);
      return false;
    }
    add(item, options);
    return true;
  }

  function updateReadProgress(
    bookUrl: string,
    origin: string,
    chapterIndex: number,
    chapterTitle?: string,
  ): boolean {
    const next = updateFindBookBookshelfReadProgress(
      bookUrl,
      origin,
      chapterIndex,
      chapterTitle,
    );
    if (!next) return false;
    booksRef.value = next;
    return true;
  }

  function setOrder(items: BookshelfBook[]) {
    saveFindBookBookshelf(items);
    booksRef.value = items;
  }

  function setCanUpdate(bookUrl: string, origin: string, canUpdate: boolean) {
    const next = setFindBookBookshelfCanUpdate(bookUrl, origin, canUpdate);
    if (!next) return false;
    booksRef.value = next;
    return true;
  }

  function setCategory(bookUrl: string, origin: string, category: string) {
    const next = setFindBookBookshelfCategory(bookUrl, origin, category);
    if (!next) return false;
    booksRef.value = next;
    return true;
  }

  function setCategories(
    keys: readonly { bookUrl: string; origin: string }[],
    category: string,
  ) {
    const next = setFindBookBookshelfCategories(keys, category);
    if (!next) return false;
    booksRef.value = next;
    return true;
  }

  function applyCategoryCatalogEdit(
    initial: CategoryEditorRow[],
    draft: CategoryEditorRow[],
  ) {
    booksRef.value = applyBookshelfCategoryCatalogEdit(initial, draft);
  }

  function applyBooks(next: BookshelfBook[]) {
    booksRef.value = next;
  }

  return {
    books,
    refresh,
    findBookshelfBook,
    isInBookshelf,
    add,
    remove,
    toggle,
    updateReadProgress,
    setOrder,
    setCanUpdate,
    setCategory,
    setCategories,
    applyCategoryCatalogEdit,
    applyBooks,
  };
}
