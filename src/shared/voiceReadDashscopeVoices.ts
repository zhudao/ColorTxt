/** DashScope Qwen3-TTS（qwen3-tts-instruct-flash / qwen3-tts-flash）音色列表 */

export type DashscopeTtsVoiceGroup = "mandarin" | "dialect" | "multilingual";
export type DashscopeTtsVoiceGender = "male" | "female";

export type DashscopeTtsVoice = {
  id: string;
  nameZh: string;
  label: string;
  description: string;
  gender: DashscopeTtsVoiceGender;
  group: DashscopeTtsVoiceGroup;
};

const GROUP_LABELS: Record<DashscopeTtsVoiceGroup, string> = {
  mandarin: "普通话",
  dialect: "方言",
  multilingual: "多语种角色",
};

function dashVoice(
  id: string,
  nameZh: string,
  description: string,
  gender: DashscopeTtsVoiceGender,
  group: DashscopeTtsVoiceGroup,
): DashscopeTtsVoice {
  return {
    id,
    nameZh,
    label: `${nameZh} (${id})`,
    description,
    gender,
    group,
  };
}

/** 描述与性别来源：阿里云百炼 Qwen-TTS 音色列表 */
export const DASHSCOPE_TTS_VOICES: readonly DashscopeTtsVoice[] = [
  dashVoice(
    "Cherry",
    "芊悦",
    "阳光积极、亲切自然小姐姐",
    "female",
    "mandarin",
  ),
  dashVoice("Serena", "苏瑶", "温柔小姐姐", "female", "mandarin"),
  dashVoice(
    "Ethan",
    "晨煦",
    "标准普通话，带部分北方口音。阳光、温暖、活力、朝气",
    "male",
    "mandarin",
  ),
  dashVoice("Chelsie", "千雪", "二次元虚拟女友", "female", "mandarin"),
  dashVoice("Momo", "茉兔", "撒娇搞怪，逗你开心", "female", "mandarin"),
  dashVoice("Vivian", "十三", "拽拽的、可爱的小暴躁", "female", "mandarin"),
  dashVoice("Moon", "月白", "率性帅气的月白", "male", "mandarin"),
  dashVoice("Maia", "四月", "知性与温柔的碰撞", "female", "mandarin"),
  dashVoice("Kai", "凯", "耳朵的一场 SPA", "male", "mandarin"),
  dashVoice("Nofish", "不吃鱼", "不会翘舌音的设计师", "male", "mandarin"),
  dashVoice("Bella", "萌宝", "喝酒不打醉拳的小萝莉", "female", "mandarin"),
  dashVoice(
    "Jennifer",
    "詹妮弗",
    "品牌级、电影质感般美语女声",
    "female",
    "mandarin",
  ),
  dashVoice(
    "Ryan",
    "甜茶",
    "节奏拉满，戏感炸裂，真实与张力共舞",
    "male",
    "mandarin",
  ),
  dashVoice(
    "Katerina",
    "卡捷琳娜",
    "御姐音色，韵律回味十足",
    "female",
    "mandarin",
  ),
  dashVoice("Aiden", "艾登", "精通厨艺的美语大男孩", "male", "mandarin"),
  dashVoice(
    "Eldric Sage",
    "沧明子",
    "沉稳睿智的老者，沧桑如松却心明如镜",
    "male",
    "mandarin",
  ),
  dashVoice("Mia", "乖小妹", "温顺如春水，乖巧如初雪", "female", "mandarin"),
  dashVoice(
    "Mochi",
    "沙小弥",
    "聪明伶俐的小大人，童真未泯却早慧如禅",
    "male",
    "mandarin",
  ),
  dashVoice(
    "Bellona",
    "燕铮莺",
    "声音洪亮，吐字清晰，人物鲜活，听得人热血沸腾",
    "female",
    "mandarin",
  ),
  dashVoice(
    "Vincent",
    "田叔",
    "一口独特的沙哑烟嗓，一开口便道尽了千军万马与江湖豪情",
    "male",
    "mandarin",
  ),
  dashVoice("Bunny", "萌小姬", "「萌属性」爆棚的小萝莉", "female", "mandarin"),
  dashVoice(
    "Neil",
    "阿闻",
    "平直的基线语调，字正腔圆的咬字发音，专业的新闻主持人",
    "male",
    "mandarin",
  ),
  dashVoice(
    "Elias",
    "墨讲师",
    "既保持学科严谨性，又通过叙事技巧将复杂知识转化为可消化的认知模块",
    "female",
    "mandarin",
  ),
  dashVoice(
    "Arthur",
    "徐大爷",
    "被岁月和旱烟浸泡过的质朴嗓音，不疾不徐地摇开了满村的奇闻异事",
    "male",
    "mandarin",
  ),
  dashVoice(
    "Nini",
    "邻家妹妹",
    "糯米糍一样又软又黏的嗓音，甜得能把人的骨头都叫酥了",
    "female",
    "mandarin",
  ),
  dashVoice(
    "Seren",
    "小婉",
    "温和舒缓的声线，助你更快地进入睡眠，晚安，好梦",
    "female",
    "mandarin",
  ),
  dashVoice(
    "Pip",
    "顽屁小孩",
    "调皮捣蛋却充满童真，这是你记忆中的小新吗",
    "male",
    "mandarin",
  ),
  dashVoice(
    "Stella",
    "少女阿月",
    "甜到发腻的迷糊少女音，喊出「代表月亮消灭你」时充满不容置疑的爱与正义",
    "female",
    "mandarin",
  ),
  dashVoice("Jada", "上海-阿珍", "风风火火的沪上阿姐", "female", "dialect"),
  dashVoice("Dylan", "北京-晓东", "北京胡同里长大的少年", "male", "dialect"),
  dashVoice("Li", "南京-老李", "耐心的瑜伽老师", "male", "dialect"),
  dashVoice(
    "Marcus",
    "陕西-秦川",
    "面宽话短，心实声沉——老陕的味道",
    "male",
    "dialect",
  ),
  dashVoice(
    "Roy",
    "闽南-阿杰",
    "诙谐直爽、市井活泼的台湾哥仔形象",
    "male",
    "dialect",
  ),
  dashVoice("Peter", "天津-李彼得", "天津相声，专业捧哏", "male", "dialect"),
  dashVoice("Sunny", "四川-晴儿", "甜到你心里的川妹子", "female", "dialect"),
  dashVoice(
    "Eric",
    "四川-程川",
    "一个跳脱市井的四川成都男子",
    "male",
    "dialect",
  ),
  dashVoice("Rocky", "粤语-阿强", "幽默风趣的阿强，在线陪聊", "male", "dialect"),
  dashVoice("Kiki", "粤语-阿清", "甜美的港妹闺蜜", "female", "dialect"),
  dashVoice("Bodega", "博德加", "热情的西班牙大叔", "male", "multilingual"),
  dashVoice(
    "Sonrisa",
    "索尼莎",
    "热情开朗的拉美大姐",
    "female",
    "multilingual",
  ),
  dashVoice(
    "Alek",
    "阿列克",
    "一开口，是战斗民族的冷，也是毛呢大衣下的暖",
    "male",
    "multilingual",
  ),
  dashVoice("Dolce", "多尔切", "慵懒的意大利大叔", "male", "multilingual"),
  dashVoice(
    "Sohee",
    "素熙",
    "温柔开朗，情绪丰富的韩国欧尼",
    "female",
    "multilingual",
  ),
  dashVoice(
    "Ono Anna",
    "小野杏",
    "鬼灵精怪的青梅竹马",
    "female",
    "multilingual",
  ),
  dashVoice(
    "Lenn",
    "莱恩",
    "理性是底色，叛逆藏在细节里——穿西装也听后朋克的德国青年",
    "male",
    "multilingual",
  ),
  dashVoice(
    "Emilien",
    "埃米尔安",
    "浪漫的法国大哥哥",
    "male",
    "multilingual",
  ),
  dashVoice(
    "Andre",
    "安德雷",
    "声音磁性，自然舒服、沉稳男生",
    "male",
    "multilingual",
  ),
  dashVoice(
    "Radio Gol",
    "拉迪奥·戈尔",
    "足球诗人 Rádio Gol，用名字为你们解说足球",
    "male",
    "multilingual",
  ),
];

const DASHSCOPE_TTS_VOICE_BY_ID = new Map(
  DASHSCOPE_TTS_VOICES.map((v) => [v.id, v] as const),
);

export function findDashscopeTtsVoice(id: string): DashscopeTtsVoice | undefined {
  return DASHSCOPE_TTS_VOICE_BY_ID.get(id.trim());
}

export function groupDashscopeTtsVoices(
  voices: readonly DashscopeTtsVoice[] = DASHSCOPE_TTS_VOICES,
): [string, readonly DashscopeTtsVoice[]][] {
  const order: DashscopeTtsVoiceGroup[] = [
    "mandarin",
    "dialect",
    "multilingual",
  ];
  const grouped = new Map<string, DashscopeTtsVoice[]>();
  for (const voice of voices) {
    const key = GROUP_LABELS[voice.group];
    const bucket = grouped.get(key) ?? [];
    bucket.push(voice);
    grouped.set(key, bucket);
  }
  return order
    .map((g) => GROUP_LABELS[g])
    .filter((label) => grouped.has(label))
    .map((label) => [label, grouped.get(label)!] as const);
}
