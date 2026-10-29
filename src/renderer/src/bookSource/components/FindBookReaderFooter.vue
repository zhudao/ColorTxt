<script setup lang="ts">
import PomodoroFooterControl from "../../components/PomodoroFooterControl.vue";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";
import type {
  PomodoroDisplayMode,
  PomodoroPhase,
} from "../../composables/usePomodoroTimer";

withDefaults(
  defineProps<{
    loading?: boolean;
    /** 是否已有可读章节内容（用于占位与统计展示） */
    hasContent?: boolean;
    readingProgressPercentPart: string;
    readingProgressDetailPart: string;
    readingProgressPlaceholder: boolean;
    readingProgressComplete: boolean;
    chapterCharCountText: string;
    /** 自动暂停开启且正在朗读：底栏「阅读进度」左侧倒计时 */
    voiceReadFooterStatus?: string;
    pomodoroEnabled?: boolean;
    pomodoroPhase?: PomodoroPhase;
    pomodoroDisplayMode?: PomodoroDisplayMode;
    pomodoroProgress?: number;
    pomodoroCountdownText?: string;
    pomodoroPauseResumeLabel?: string;
    pomodoroPaused?: boolean;
  }>(),
  {
    loading: false,
    hasContent: false,
    voiceReadFooterStatus: "",
    pomodoroEnabled: false,
    pomodoroPhase: "idle",
    pomodoroDisplayMode: "pie",
    pomodoroProgress: 0,
    pomodoroCountdownText: "0:00",
    pomodoroPauseResumeLabel: "暂停",
    pomodoroPaused: false,
  },
);

defineEmits<{
  pomodoroStart: [];
  pomodoroToggleDisplayMode: [];
  pomodoroTogglePause: [];
  pomodoroStop: [];
}>();
</script>

<template>
  <footer class="findBookReaderFooter">
    <div class="findBookReaderFooterLeft">
      <PomodoroFooterControl
        v-if="pomodoroEnabled"
        :phase="pomodoroPhase"
        :display-mode="pomodoroDisplayMode"
        :progress="pomodoroProgress"
        :countdown-text="pomodoroCountdownText"
        :pause-resume-label="pomodoroPauseResumeLabel"
        :paused="pomodoroPaused"
        @start="$emit('pomodoroStart')"
        @toggle-display-mode="$emit('pomodoroToggleDisplayMode')"
        @toggle-pause="$emit('pomodoroTogglePause')"
        @stop="$emit('pomodoroStop')"
      />
    </div>
    <div class="findBookReaderFooterRight">
      <span v-if="loading" class="findBookReaderFooterLoading">
        加载中<LoadingDotsBounce />
      </span>
      <template v-else-if="hasContent">
        <span v-if="voiceReadFooterStatus">{{ voiceReadFooterStatus }}</span>
        <span>
          阅读进度：<span
            class="findBookReaderFooterProgressPct"
            :class="{
              'findBookReaderFooterProgressPct--placeholder':
                readingProgressPlaceholder,
              'findBookReaderFooterProgressPct--complete':
                readingProgressComplete,
            }"
            >{{ readingProgressPercentPart }}</span
          >{{ readingProgressDetailPart }}
        </span>
        <span>当前章节字数：{{ chapterCharCountText }}</span>
      </template>
    </div>
  </footer>
</template>

<style scoped>
.findBookReaderFooter {
  height: 28px;
  flex-shrink: 0;
  min-width: 0;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 5px;
  gap: 16px;
  background: var(--bg);
  user-select: none;
}

.findBookReaderFooterLeft {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.findBookReaderFooterRight {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  display: inline-flex;
  min-width: 0;
  flex-shrink: 0;
  gap: 20px;
}

.findBookReaderFooterLoading {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}

.findBookReaderFooterProgressPct {
  color: var(--warning);
}

.findBookReaderFooterProgressPct--placeholder {
  color: var(--muted);
}

.findBookReaderFooterProgressPct--complete {
  color: var(--success);
}
</style>
