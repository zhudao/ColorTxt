import darkIcon from "./assets/dark.svg?raw";
import lightIcon from "./assets/light.svg?raw";
import sidebarIcon from "./assets/sidebar.svg?raw";
import enterFullscreenIcon from "./assets/enter_fullscreen.svg?raw";
import leaveFullscreenIcon from "./assets/leave_fullscreen.svg?raw";
import paletteIcon from "./assets/palette.svg?raw";
import moreIcon from "./assets/more.svg?raw";
import mindmapIcon from "./assets/mindmap.svg?raw";
import findIcon from "./assets/find.svg?raw";
import regExpIcon from "./assets/RegExp.svg?raw";
import githubIcon from "./assets/GitHub.svg?raw";
import shortcutIcon from "./assets/shortcut.svg?raw";
import newWindowIcon from "./assets/new_window.svg?raw";
import infoIcon from "./assets/info.svg?raw";
import quitIcon from "./assets/quit.svg?raw";
import fontFamilyIcon from "./assets/font_family.svg?raw";
import editIcon from "./assets/edit.svg?raw";
import saveIcon from "./assets/save.svg?raw";
import removeIcon from "./assets/remove.svg?raw";
import upIcon from "./assets/up.svg?raw";
import downIcon from "./assets/down.svg?raw";
import lineHeightDownIcon from "./assets/line_height_down.svg?raw";
import lineHeightUpIcon from "./assets/line_height_up.svg?raw";
import fontSizeDownIcon from "./assets/font_size_down.svg?raw";
import fontSizeUpIcon from "./assets/font_size_up.svg?raw";
import compressIcon from "./assets/compress.svg?raw";
import indentIcon from "./assets/indent.svg?raw";
import updateIcon from "./assets/update.svg?raw";
import devToolsIcon from "./assets/DevTools.svg?raw";
import settingIcon from "./assets/setting.svg?raw";
import advancedWrappingIcon from "./assets/advanced_wrapping.svg?raw";
import pinIcon from "./assets/pin.svg?raw";
import pinActiveIcon from "./assets/pin_active.svg?raw";
import backIcon from "./assets/back.svg?raw";
import bookmarkIcon from "./assets/bookmark.svg?raw";
import bookmarkActiveIcon from "./assets/bookmark_active.svg?raw";
import ebookIcon from "./assets/ebook.svg?raw";
import chapterListIcon from "./assets/chapter_list.svg?raw";
import highlightMarkIcon from "./assets/highlight.svg?raw";
import clearIcon from "./assets/clear.svg?raw";
import addIcon from "./assets/add.svg?raw";
import closeIcon from "./assets/close.svg?raw";
import ascIcon from "./assets/asc.svg?raw";
import descIcon from "./assets/desc.svg?raw";
import folderOpenIcon from "./assets/folder_open.svg?raw";
import aiChatIcon from "./assets/AI_chat.svg?raw";
import brainIcon from "./assets/brain.svg?raw";
import copyIcon from "./assets/copy.svg?raw";
import downloadIcon from "./assets/download.svg?raw";
import historyIcon from "./assets/history.svg?raw";
import newChatIcon from "./assets/new_chat.svg?raw";
import sendIcon from "./assets/send.svg?raw";
import successIcon from "./assets/success.svg?raw";
import viewIcon from "./assets/view.svg?raw";
import viewOffIcon from "./assets/view_off.svg?raw";
import refreshIcon from "./assets/refresh.svg?raw";
import resetIcon from "./assets/reset.svg?raw";
import unknowIcon from "./assets/unknow.svg?raw";
import failIcon from "./assets/fail.svg?raw";
import stopIcon from "./assets/stop.svg?raw";
import thinkingPulseIcon from "./assets/thinking_pulse.svg?raw";
import foldChevronIcon from "./assets/fold_chevron.svg?raw";
import jumpBottomIcon from "./assets/jump_bottom.svg?raw";
import characterIcon from "./assets/character.svg?raw";
import genderMaleIcon from "./assets/male.svg?raw";
import genderFemaleIcon from "./assets/female.svg?raw";
import genderUnknownIcon from "./assets/unknown.svg?raw";
import warningIcon from "./assets/warning.svg?raw";
import favoriteIcon from "./assets/favorite.svg?raw";
import favoriteFillIcon from "./assets/favorite_fill.svg?raw";

export const icons = {
  dark: darkIcon,
  light: lightIcon,
  sidebar: sidebarIcon,
  enterFullscreen: enterFullscreenIcon,
  leaveFullscreen: leaveFullscreenIcon,
  palette: paletteIcon,
  more: moreIcon,
  /** 思维导图面板标题 */
  mindmap: mindmapIcon,
  find: findIcon,
  regExp: regExpIcon,
  github: githubIcon,
  shortcut: shortcutIcon,
  newWindow: newWindowIcon,
  info: infoIcon,
  quit: quitIcon,
  fontFamily: fontFamilyIcon,
  edit: editIcon,
  save: saveIcon,
  remove: removeIcon,
  up: upIcon,
  down: downIcon,
  lineHeightDown: lineHeightDownIcon,
  lineHeightUp: lineHeightUpIcon,
  fontSizeDown: fontSizeDownIcon,
  fontSizeUp: fontSizeUpIcon,
  compress: compressIcon,
  indent: indentIcon,
  update: updateIcon,
  devTools: devToolsIcon,
  setting: settingIcon,
  advancedWrapping: advancedWrappingIcon,
  pin: pinIcon,
  pinActive: pinActiveIcon,
  back: backIcon,
  bookmark: bookmarkIcon,
  bookmarkActive: bookmarkActiveIcon,
  ebook: ebookIcon,
  chapterList: chapterListIcon,
  highlightMark: highlightMarkIcon,
  clear: clearIcon,
  add: addIcon,
  close: closeIcon,
  asc: ascIcon,
  desc: descIcon,
  folderOpen: folderOpenIcon,
  aiChat: aiChatIcon,
  brain: brainIcon,
  copy: copyIcon,
  download: downloadIcon,
  history: historyIcon,
  newChat: newChatIcon,
  send: sendIcon,
  success: successIcon,
  view: viewIcon,
  viewOff: viewOffIcon,
  refresh: refreshIcon,
  /** 思维导图「复原视图」 */
  reset: resetIcon,
  unknow: unknowIcon,
  fail: failIcon,
  stop: stopIcon,
  /** 阅读助手「正在思考…」/ 工具进行中的脉动圆点 */
  thinkingPulse: thinkingPulseIcon,
  /** 折叠面板标题右侧 chevron（默认向下，展开时旋转为向上） */
  foldChevron: foldChevronIcon,
  jumpBottom: jumpBottomIcon,
  character: characterIcon,
  genderMale: genderMaleIcon,
  genderFemale: genderFemaleIcon,
  genderUnknown: genderUnknownIcon,
  /** 阅读助手「用户取消」、角色卡检索提示等 */
  warning: warningIcon,
  /** 高亮词：收藏（未收藏项 hover 显示） */
  favorite: favoriteIcon,
  /** 高亮词：已收藏（常驻） */
  favoriteFill: favoriteFillIcon,
} as const;
