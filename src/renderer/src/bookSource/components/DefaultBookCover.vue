<script setup lang="ts">
import { computed } from "vue";
import { formatCoverAuthor } from "../bookSourceDisplay";

const props = defineProps<{
  title: string;
  author?: string;
}>();

defineOptions({ inheritAttrs: false });

const authorLabel = computed(() => formatCoverAuthor(props.author));
</script>

<template>
  <div
    class="defaultBookCover"
    role="img"
    :aria-label="`${title || '未知'} 封面`"
    v-bind="$attrs"
  >
    <div class="defaultBookCover__binding" aria-hidden="true" />
    <div class="defaultBookCover__content">
      <div class="defaultBookCover__labels">
        <div class="defaultBookCover__author">
          <span class="defaultBookCover__authorText">{{ authorLabel }}</span>
        </div>
        <div class="defaultBookCover__titleWrap">
          <div class="defaultBookCover__titleShell">
            <div class="defaultBookCover__titlePlate">
              <div class="defaultBookCover__titleBorderThick">
                <div class="defaultBookCover__titleBorderThin">
                  <span class="defaultBookCover__title">{{ title || "未知" }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.defaultBookCover {
  display: flex;
  align-items: stretch;
  overflow: hidden;
  background: #1c3359;
  flex-shrink: 0;
}

.defaultBookCover__binding {
  width: 11px;
  flex-shrink: 0;
  border-right: 1.5px solid rgba(255, 255, 255, 0.92);
  background: repeating-linear-gradient(
    180deg,
    transparent 0 6px,
    rgba(255, 255, 255, 0.88) 6px 7px,
    transparent 7px 17px
  );
}

.defaultBookCover__content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 4px;
}

.defaultBookCover__labels {
  display: flex;
  flex-direction: row;
  gap: 4px;
  height: 100%;
  width: fit-content;
  margin-left: auto;
  /* width: 100%;
  justify-content: space-between; */
}

.defaultBookCover__titleWrap {
  align-self: flex-start;
  min-width: 0;
}

.defaultBookCover__author {
  align-self: flex-end;
  display: flex;
  max-height: calc(100% - 4px);
  background: #b42318;
  color: #fff;
  padding: 4px 2px;
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.defaultBookCover__authorText {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 8px;
  line-height: 1.15;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 100%;
  font-family: "KingHwa OldSong", "Songti SC", SimSun, serif;
}

.defaultBookCover__titleShell {
  /* 8px：最外层 8px padding */
  max-height: calc(var(--book-cover-height) - 8px);
  overflow: hidden;
  flex-shrink: 0;
}

.defaultBookCover__titlePlate {
  background: #fff;
  padding: 2px;
  border-radius: 1px;
}

.defaultBookCover__titleBorderThick {
  border: 1.5px solid #111;
  padding: 1px;
}

.defaultBookCover__titleBorderThin {
  border: 0.5px solid #111;
  padding: 4px 2px;
  overflow: hidden;
}

.defaultBookCover__title {
  display: block;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 11px;
  line-height: 1.15;
  color: #111;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 26px：最外层 8px padding + 白边 4px padding + 粗黑框 3px border + 粗黑框 2px padding + 细黑框 1px border + 细黑框 8px padding */
  max-height: calc(var(--book-cover-height) - 26px);
  font-family: "KingHwa OldSong", "Songti SC", SimSun, serif;
  font-weight: bold;
}
</style>
