/** 侧栏「角色」：按书持久化在 file.meta 中的结构（渲染进程为主，类型供共享） */

export type CharacterGender = "male" | "female" | "unknown";

/** 本书推断画风（书籍级，非单角色） */
export type CharacterBookStylePersisted = {
  stylePrefixZh: string;
  styleNoteZh?: string;
  updatedAt?: number;
};

/** 侧栏角色卡片一条记录 */
export type CharacterRosterEntry = {
  id: string;
  displayName: string;
  /** 别名，持久化为中文逗号拼接；空字符串表示无 */
  aliases: string;
  gender: CharacterGender;
  /** 年龄或「少年」等描述；空表示背面不展示年龄 */
  ageText: string;
  /** 身份/职业；空表示背面不展示该行 */
  identity: string;
  bio: string;
  relations: string;
  /** 角色形象描述（自然语言；历史字段名 promptZh） */
  promptZh: string;
  /** SD 系高级：负面描述；云端自然语言接口可留空 */
  negativeZh: string;
  /** 检索折叠区持久化正文 */
  retrieveThinkingText: string;
  /** 朗读语音（当前引擎 voiceId；空=使用全局对白默认音色） */
  voiceReadVoiceId?: string;
  /** 火山引擎专属音色的语种（`explicit_language`；空=中英混） */
  voiceReadLanguage?: string;
  /** 火山引擎专属音色的方言（`explicit_dialect`；空=默认） */
  voiceReadDialect?: string;
  /** 音色试听：当前展示的台词（与检索列表独立，可手改） */
  voiceReadSampleLine?: string;
  /** AI 检索到的经典台词列表（只读缓存，供「换一句」覆盖当前台词） */
  voiceReadSampleQuotes?: string[];
  /** 「换一句」轮换进度（指向 voiceReadSampleQuotes） */
  voiceReadSampleQuoteIndex?: number;
};
