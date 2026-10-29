/**
 * 火山引擎豆包语音合成模型 2.0 在线音色。
 *
 * 来源：https://docs.volcengine.com/docs/6561/1257544?lang=zh
 * 范围：文档第 7 行“豆包语音合成模型2.0 音色列表”起，至第 470 行
 * “端到端实时语音大模型”标题前；包含主表 293 个、多语种表 151 个音色。
 */

export type VolcengineTtsVoiceGender = "male" | "female";

export type VolcengineTtsVoiceGroup =
  | "chinese"
  | "english"
  | "arabic"
  | "german"
  | "spanish"
  | "indonesian"
  | "portuguese"
  | "japanese"
  | "korean"
  | "french"
  | "malay"
  | "russian"
  | "thai"
  | "filipino"
  | "vietnamese"
  | "italian";

export type VolcengineTtsVoiceTagTone =
  | "language"
  | "dialect"
  | "scene"
  | "capability"
  | "note";

export type VolcengineTtsVoiceTag = {
  label: string;
  tone: VolcengineTtsVoiceTagTone;
};

export type VolcengineTtsVoice = {
  id: string;
  name: string;
  label: string;
  description: string;
  tags: readonly VolcengineTtsVoiceTag[];
  languages: readonly string[];
  dialects: readonly string[];
  gender: VolcengineTtsVoiceGender;
  locale: string;
  group: VolcengineTtsVoiceGroup;
};

type VolcengineTtsVoiceTuple = readonly [
  id: string,
  name: string,
  language: string,
  scene: string,
  inferenceMode: string,
  capabilities: string,
  note: string,
];

export const VOLCENGINE_TTS_VOICE_GROUP_LABELS: Readonly<
  Record<VolcengineTtsVoiceGroup, string>
> = {
  chinese: "中文",
  english: "英文",
  arabic: "阿拉伯语",
  german: "德语",
  spanish: "西班牙语",
  indonesian: "印尼语",
  portuguese: "葡萄牙语",
  japanese: "日语",
  korean: "韩语",
  french: "法语",
  malay: "马来语",
  russian: "俄语",
  thai: "泰语",
  filipino: "菲律宾语",
  vietnamese: "越南语",
  italian: "意大利语",
};

const VOLCENGINE_TTS_VOICE_ROWS = [
  ["zh_female_vv_uranus_bigtts", "Vivi 2.0", "语种：中文、日文、印尼、墨西哥西班牙语；方言：粤语、上海、河南、北京、天津、四川、陕西、东北", "通用场景", "", "指令遵循", ""],
  ["zh_female_xiaohe_uranus_bigtts", "小何 2.0", "语种：中文；方言：粤语、上海、河南、北京、天津、四川、陕西、东北", "通用场景", "", "指令遵循", ""],
  ["zh_male_m191_uranus_bigtts", "云舟 2.0", "语种：中文；方言：粤语、上海、河南、北京、天津、四川、陕西、东北", "通用场景", "", "指令遵循", ""],
  ["zh_male_taocheng_uranus_bigtts", "小天 2.0", "语种：中文；方言：粤语、上海、河南、北京、天津、四川、陕西、东北", "通用场景", "", "指令遵循", ""],
  ["zh_male_liufei_uranus_bigtts", "刘飞 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_sophie_uranus_bigtts", "魅力苏菲 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_qingxinnvsheng_uranus_bigtts", "清新女声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_cancan_uranus_bigtts", "知性灿灿 2.0", "中文", "角色扮演", "", "指令遵循", ""],
  ["zh_female_sajiaoxuemei_uranus_bigtts", "撒娇学妹 2.0", "中文", "角色扮演", "", "指令遵循", ""],
  ["zh_female_tianmeixiaoyuan_uranus_bigtts", "甜美小源 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_tianmeitaozi_uranus_bigtts", "甜美桃子 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_shuangkuaisisi_uranus_bigtts", "爽快思思 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_peiqi_uranus_bigtts", "佩奇猪 2.0", "中文", "视频配音", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_linjianvhai_uranus_bigtts", "邻家女孩 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_shaonianzixin_uranus_bigtts", "少年梓辛 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_sunwukong_uranus_bigtts", "猴哥 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["zh_female_yingyujiaoxue_uranus_bigtts", "Tina老师 2.0", "中文、英式英语", "教育场景", "", "指令遵循", ""],
  ["zh_female_kefunvsheng_uranus_bigtts", "暖阳女声 2.0", "中文", "客服场景", "", "指令遵循", ""],
  ["zh_female_xiaoxue_uranus_bigtts", "儿童绘本 2.0", "中文", "有声阅读", "", "指令遵循", ""],
  ["zh_male_dayi_uranus_bigtts", "大壹 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["zh_female_mizai_uranus_bigtts", "黑猫侦探社咪仔 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["zh_female_jitangnv_uranus_bigtts", "鸡汤女 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["zh_female_meilinvyou_uranus_bigtts", "魅力女友 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_liuchangnv_uranus_bigtts", "流畅女声 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["zh_male_ruyayichen_uranus_bigtts", "儒雅逸辰 2.0", "中文", "视频配音", "", "指令遵循", ""],
  ["en_male_tim_uranus_bigtts", "Tim", "美式英语", "多语种", "", "指令遵循", ""],
  ["en_female_dacey_uranus_bigtts", "Dacey", "美式英语", "多语种", "", "指令遵循", ""],
  ["en_female_stokie_uranus_bigtts", "Stokie", "美式英语", "多语种", "", "指令遵循", ""],
  ["zh_female_wenroumama_uranus_bigtts", "温柔妈妈 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_jieshuoxiaoming_uranus_bigtts", "解说小明 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_tvbnv_uranus_bigtts", "TVB女声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_yizhipiannan_uranus_bigtts", "译制片男 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_qiaopinv_uranus_bigtts", "俏皮女声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_zhishuaiyingzi_uranus_bigtts", "直率英子 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_male_linjiananhai_uranus_bigtts", "邻家男孩 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_silang_uranus_bigtts", "四郎 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_male_ruyaqingnian_uranus_bigtts", "儒雅青年 2.0", "中文", "通用场景", "", "指令遵循", "标签：番茄小说同款,豆包同款,剪映同款"],
  ["zh_male_qingcang_uranus_bigtts", "擎苍 2.0", "中文", "角色扮演", "", "指令遵循", "标签：番茄小说同款,豆包同款,抖音同款,剪映同款"],
  ["zh_male_xionger_uranus_bigtts", "熊二 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_yingtaowanzi_uranus_bigtts", "樱桃丸子 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_male_wennuanahu_uranus_bigtts", "温暖阿虎 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_naiqimengwa_uranus_bigtts", "奶气萌娃 2.0", "中文", "通用场景", "", "指令遵循", "标签：剪映同款,豆包同款"],
  ["zh_female_popo_uranus_bigtts", "婆婆 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_gaolengyujie_uranus_bigtts", "高冷御姐 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_aojiaobazong_uranus_bigtts", "傲娇霸总 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_lanyinmianbao_uranus_bigtts", "懒音绵宝 2.0", "中文", "角色扮演", "", "指令遵循", ""],
  ["zh_male_fanjuanqingnian_uranus_bigtts", "反卷青年 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_wenroushunv_uranus_bigtts", "温柔淑女 2.0", "中文", "通用场景", "", "指令遵循", "标签：番茄小说同款,豆包同款,剪映同款"],
  ["zh_female_gufengshaoyu_uranus_bigtts", "古风少御 2.0", "中文", "角色扮演", "", "指令遵循", ""],
  ["zh_male_huolixiaoge_uranus_bigtts", "活力小哥 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_baqiqingshu_uranus_bigtts", "霸气青叔 2.0", "中文", "有声阅读", "", "指令遵循", "标签：番茄小说同款,豆包同款,剪映同款"],
  ["zh_male_xuanyijieshuo_uranus_bigtts", "悬疑解说 2.0", "中文", "有声阅读", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_mengyatou_uranus_bigtts", "萌丫头 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_tiexinnvsheng_uranus_bigtts", "贴心女声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_jitangmei_uranus_bigtts", "鸡汤妹妹 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,豆包同款"],
  ["zh_male_cixingjieshuonan_uranus_bigtts", "磁性解说男声 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_male_liangsangmengzai_uranus_bigtts", "亮嗓萌仔 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_kailangjiejie_uranus_bigtts", "开朗姐姐 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_gaolengchenwen_uranus_bigtts", "高冷沉稳 2.0", "中文", "通用场景", "", "指令遵循", "标签：猫箱同款"],
  ["zh_male_shenyeboke_uranus_bigtts", "深夜播客 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_lubanqihao_uranus_bigtts", "鲁班七号 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_jiaochuannv_uranus_bigtts", "娇喘女声 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_female_linxiao_uranus_bigtts", "林潇 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_lingling_uranus_bigtts", "玲玲姐姐 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_female_chunribu_uranus_bigtts", "春日部姐姐 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款,剪映同款"],
  ["zh_male_tangseng_uranus_bigtts", "唐僧 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,豆包同款"],
  ["zh_male_zhuangzhou_uranus_bigtts", "庄周 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_male_kailangdidi_uranus_bigtts", "开朗弟弟 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_male_zhubajie_uranus_bigtts", "猪八戒 2.0", "中文", "角色扮演", "", "指令遵循", "标签：豆包同款,剪映同款"],
  ["zh_female_ganmaodianyin_uranus_bigtts", "感冒电音姐姐 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_female_chanmeinv_uranus_bigtts", "谄媚女声 2.0", "中文", "通用场景", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_female_nvleishen_uranus_bigtts", "女雷神 2.0", "中文", "角色扮演", "", "指令遵循", "标签：剪映同款,豆包同款"],
  ["zh_female_qinqienv_uranus_bigtts", "亲切女声 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_male_kuailexiaodong_uranus_bigtts", "快乐小东 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_male_kailangxuezhang_uranus_bigtts", "开朗学长 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_male_youyoujunzi_uranus_bigtts", "悠悠君子 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_female_wenjingmaomao_uranus_bigtts", "文静毛毛 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_female_zhixingnv_uranus_bigtts", "知性女声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_qingshuangnanda_uranus_bigtts", "清爽男大 2.0", "中文", "通用场景", "", "指令遵循", "标签：豆包同款"],
  ["zh_male_yuanboxiaoshu_uranus_bigtts", "渊博小叔 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_yangguangqingnian_uranus_bigtts", "阳光青年 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_qingchezizi_uranus_bigtts", "清澈梓梓 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_tianmeiyueyue_uranus_bigtts", "甜美悦悦 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_xinlingjitang_uranus_bigtts", "心灵鸡汤 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_wenrouxiaoge_uranus_bigtts", "温柔小哥 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_roumeinvyou_uranus_bigtts", "柔美女友 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_dongfanghaoran_uranus_bigtts", "东方浩然 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_wenrouxiaoya_uranus_bigtts", "温柔小雅 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_male_tiancaitongsheng_uranus_bigtts", "天才童声 2.0", "中文", "通用场景", "", "指令遵循", ""],
  ["zh_female_wuzetian_uranus_bigtts", "武则天 2.0", "中文", "角色扮演", "", "指令遵循", "标签：剪映同款"],
  ["zh_female_gujie_uranus_bigtts", "顾姐 2.0", "中文", "角色扮演", "", "指令遵循", "标签：抖音同款,剪映同款"],
  ["zh_male_guanggaojieshuo_uranus_bigtts", "广告解说 2.0", "中文", "通用场景", "", "指令遵循", "标签：剪映同款"],
  ["zh_female_shaoergushi_uranus_bigtts", "少儿故事 2.0", "中文", "有声阅读", "", "指令遵循", ""],
  ["ICL_uranus_en_female_charlie_tob", "Charlie 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_ethan_tob", "Ethan 2.0", "澳洲英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_alastor_tob", "Alastor 2.0", "英式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_chucky_tob", "Chucky 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_noah_tob", "Noah 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_jigsaw_tob", "Jigsaw 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_clown_man_tob", "Clown Man 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_cartoon_chef_tob", "Cartoon Chef 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_frosty_man_tob", "Frosty Man 2.0", "美式英语", "多语种", "", "", "标签：豆包同款"],
  ["ICL_uranus_en_male_the_grinch_tob", "The Grinch 2.0", "美式英语", "多语种", "", "", "标签：豆包同款"],
  ["ICL_uranus_en_male_kevin_mccallister_tob", "Kevin McCallister 2.0", "美式英语", "多语种", "", "", "标签：豆包同款"],
  ["ICL_uranus_en_male_michael_tob", "Michael 2.0", "美式英语", "多语种", "", "", "标签：豆包同款"],
  ["ICL_uranus_en_male_big_boogie_tob", "Big Boogie 2.0", "美式英语", "多语种", "", "", "标签：豆包同款"],
  ["ICL_uranus_en_male_xavier_tob", "Xavier 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_en_male_zayne_tob", "Zayne 2.0", "美式英语", "多语种", "", "", ""],
  ["ICL_uranus_zh_female_kefuwanjun_tob", "客服婉君 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_yingxiaokefu_v2_tob", "营销小楠 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_aojiaonvyou_tob", "傲娇女友 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_aomanjiaosheng_tob", "傲慢娇声 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_xiemeinvwang_tob", "邪魅女王 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_bingjiaojiejie_tob", "病娇姐姐 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_bingjiaomengmei_tob", "病娇萌妹 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_bingruoshaonv_tob", "病弱少女 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_chengshuwenrou_tob", "成熟温柔 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_chengshujiejie_tob", "成熟姐姐 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_chunzhenshaonv_tob", "纯真少女 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_female_chunchenvsheng_tob", "纯澈女生 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_wumeikeren_tob", "妩媚可人 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_guaiqiaokeer_tob", "乖巧可儿 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_heainainai_tob", "和蔼奶奶 2.0", "中文", "视频配音", "", "", ""],
  ["ICL_uranus_zh_female_huopodiaoman_tob", "活泼刁蛮 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_huoponvhai_tob", "活泼女孩 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_jiaohannvwang_tob", "娇憨女王 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_jiaoruoluoli_tob", "娇弱萝莉 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_jiaxiaozi_tob", "假小子 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_jinglingxiangdao_tob", "精灵向导 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_female_kailangtingting_tob", "开朗婷婷 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_kaixinxiaohong_tob", "开心小鸿 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_keainvsheng_tob", "可爱女生 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_lingdongxinxin_tob", "灵动欣欣 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_linjuayi_tob", "邻居阿姨 2.0", "中文", "视频配音", "", "", ""],
  ["ICL_uranus_zh_female_tianmeijiaoqiao_tob", "甜美娇俏 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_qinglenggaoya_tob", "清冷高雅 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_lixingyuanzi_tob", "理性圆子 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_xingganmeihuo_tob", "性感魅惑 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_nuanxinqianqian_tob", "暖心茜茜 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_nuanxinxuejie_tob", "暖心学姐 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_qingtianmeimei_tob", "清甜莓莓 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_qingtiantaotao_tob", "清甜桃桃 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_qingxixiaoxue_tob", "清晰小雪 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_qingxinshaonv_tob", "倾心少女 2.0", "中文", "视频配音", "", "", ""],
  ["ICL_uranus_zh_female_rouguhunshi_tob", "柔骨魂师 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_ruanmengtangtang_tob", "软萌糖糖 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_ruanmengtuanzi_tob", "软萌团子 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_tianmeihuopo_tob", "甜美活泼 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_tianmeixiaoju_tob", "甜美小橘 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_tianmeixiaoyu_tob", "甜美小雨 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_tiaopigongzhu_tob", "调皮公主 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_tiexinnvyou_tob", "贴心女友 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_wenrounvshen_tob", "温柔女神 2.0", "中文", "通用场景", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_female_wenrouwenya_tob", "温柔文雅 2.0", "中文", "通用场景,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_female_zhixinjiejie_tob", "知心姐姐 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_wumeiyujie_tob", "妩媚御姐 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_female_yuanqitianmei_tob", "元气甜妹 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_xiemeiyujie_tob", "邪魅御姐 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_xingganyujie_tob", "性感御姐 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_female_xiuliqianqian_tob", "秀丽倩倩 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_tiexinguimi_tob", "贴心闺蜜 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_tiexinmeimei_tob", "贴心妹妹 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_wenroubaiyueguang_tob", "温柔白月光 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_chuliannvyou_tob", "初恋女友 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_female_zhixingwenwan_tob", "知性温婉 2.0", "中文", "通用场景", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_aoqilingren_tob", "傲气凌人 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_anrenqinzhu_tob", "黯刃秦主 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_aojiaogongzi_tob", "傲娇公子 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_aojiaojingying_tob", "傲娇精英 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_aomanqingnian_tob", "傲慢青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_aomanshaoye_tob", "傲慢少爷 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_zhenbiandiyu_tob", "枕边低语 2.0", "中文", "角色扮演", "", "", "标签：抖音同款"],
  ["ICL_uranus_zh_male_badaoshaoye_tob", "霸道少爷 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_badaozongcai_tob", "霸道总裁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_bingjiaobailian_tob", "病娇白莲 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_bingjiaodidi_tob", "病娇弟弟 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_bingjiaogege_tob", "病娇哥哥 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_bingjiaonanyou_tob", "病娇男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_bingjiaoshaonian_tob", "病娇少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_bingruogongzi_tob", "病弱公子 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_bingruoshaonian_tob", "病弱少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_bujiqingnian_tob", "不羁青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_chunhoudiyin_tob", "醇厚低音 2.0", "中文", "视频配音", "", "", ""],
  ["ICL_uranus_zh_male_paoxiaoxiaoge_tob", "咆哮小哥 2.0", "中文", "视频配音", "", "", ""],
  ["ICL_uranus_zh_male_yangyang_tob", "炀炀 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_male_chanruoshaoye_tob", "孱弱少爷 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_chengshuzongcai_tob", "成熟总裁 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_chenwenmingzai_tob", "沉稳明仔 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_qingyisugan_tob", "清逸苏感 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_chunzhenxuedi_tob", "纯真学弟 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_cixingnansang_tob", "磁性男嗓 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_cujingnansheng_tob", "醋精男生 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_cujingnanyou_tob", "醋精男友 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_diyinchenyu_tob", "低音沉郁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_fengfashaonian_tob", "风发少年 2.0", "中文", "角色扮演,S2S-SC", "", "", ""],
  ["ICL_uranus_zh_male_ruyagongzi_tob", "儒雅公子 2.0", "中文", "有声阅读", "", "", ""],
  ["ICL_uranus_zh_male_fuheigongzi_tob", "腹黑公子 2.0", "中文", "角色扮演,S2S-SC", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_ganjingshaonian_tob", "干净少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_gaolengzongcai_tob", "高冷总裁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_guaogongzi_tob", "孤傲公子 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_gugaogongzi_tob", "孤高公子 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_guiyishenmi_tob", "诡异神秘 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_guzhibingjiao_tob", "固执病娇 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_hanhoudunshi_tob", "憨厚敦实 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_huoliqingnian_tob", "活力青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_huoponanyou_tob", "活泼男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_huoposhuanglang_tob", "活泼爽朗 2.0", "中文", "通用场景", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_huzishushu_tob", "胡子叔叔 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_jijiazhineng_tob", "机甲智能 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_jingyingqingnian_tob", "精英青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_junyigongzi_tob", "俊逸公子 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_kailangqingkuai_tob", "开朗轻快 2.0", "中文", "通用场景", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_kailangqingnian_tob", "开朗青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lanyincaohunshi_tob", "蓝银草魂师 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_lengaozongcai_tob", "冷傲总裁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lengdanshuli_tob", "冷淡疏离 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_lengjungaozhi_tob", "冷峻高智 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lengjunshangsi_tob", "冷峻上司 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_lengkugege_tob", "冷酷哥哥 2.0", "中文", "通用场景", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_lenglianxiongzhang_tob", "冷脸兄长 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lenglianxueba_tob", "冷脸学霸 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lengmonanyou_tob", "冷漠男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lengmoxiongzhang_tob", "冷漠兄长 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_lingyunqingnian_tob", "凌云青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_qinglengjingui_tob", "清冷矜贵 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_lvchaxiaoge_tob", "绿茶小哥 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_mengdongqingnian_tob", "懵懂青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_menyoupingxiaoge_tob", "闷油瓶小哥 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_xiaozhangxiaoge_tob", "嚣张小哥 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_nianrennanyou_tob", "粘人男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_neiliancaijun_tob", "内敛才俊 2.0", "中文", "有声阅读", "", "", ""],
  ["ICL_uranus_zh_male_nuanxintitie_tob", "暖心体贴 2.0", "中文", "通用场景", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_pianpiangongzi_tob", "翩翩公子 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_chenwenyouya_tob", "沉稳优雅 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_qingsexiaosheng_tob", "青涩小生 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_qingseqingnian_tob", "青涩青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_qingshuangshaonian_tob", "清爽少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_qingxinbobo_tob", "清新波波 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_qinqieqingnian_tob", "亲切青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_qinqiexiaozhuo_tob", "亲切小卓 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_qinglangwenrun_tob", "清朗温润 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_rexueshaonian_tob", "热血少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_ruyacaijun_tob", "儒雅才俊 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_ruyajunzi_tob", "儒雅君子 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_ruyazongcai_tob", "儒雅总裁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_sajiaonansheng_tob", "撒娇男生 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_sajiaonanyou_tob", "撒娇男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_sajiaonianren_tob", "撒娇粘人 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_satuoqingnian_tob", "洒脱青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_shaonianjiangjun_tob", "少年将军 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_shenchenzongcai_tob", "深沉总裁 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_jilingxiaohuo_tob", "机灵小伙 2.0", "中文", "通用场景", "", "", ""],
  ["ICL_uranus_zh_male_shenmifashi_tob", "神秘法师 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_shuaizhenxiaohuo_tob", "率真小伙 2.0", "中文", "通用场景", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_shuanglangxiaoyang_tob", "爽朗小阳 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_dichenqianquan_tob", "低沉缱绻 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_siwenqingnian_tob", "斯文青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_tianxinanyou_tob", "甜系男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_tiexinnanyou_tob", "贴心男友 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_wenrounantongzhuo_tob", "温柔男同桌 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_wenrounanyou_tob", "温柔男友 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_wenrouxuezhang_tob", "温柔学长 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_wenrunxuezhe_tob", "温润学者 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_wenshunshaonian_tob", "温顺少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_guayanxiaoge_tob", "寡言小哥 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_xiaohouye_tob", "小侯爷 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_naiqixiaosheng_tob", "奶气小生 2.0", "中文", "角色扮演", "", "", "标签：豆包同款"],
  ["ICL_uranus_zh_male_xiaosasuixing_tob", "潇洒随性 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_wenrouneilian_tob", "温柔内敛 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_xuebanantongzhuo_tob", "学霸男同桌 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_xuebatongzhuo_tob", "学霸同桌 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_yangguangyangyang_tob", "阳光洋洋 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_wennuanshaonian_tob", "温暖少年 2.0", "中文", "有声阅读", "", "", ""],
  ["ICL_uranus_zh_male_yiqishaonian_tob", "意气少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_younidashu_tob", "油腻大叔 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_youmodaye_tob", "幽默大爷 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_youmoshushu_tob", "幽默叔叔 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_youroubangzhu_tob", "优柔帮主 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_yourougongzi_tob", "优柔公子 2.0", "中文", "角色扮演", "", "", "标签：豆包同款,猫箱同款"],
  ["ICL_uranus_zh_male_yuanqishaonian_tob", "元气少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zhangjianjunzi_tob", "仗剑君子 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zhangjianxiake_tob", "仗剑侠客 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zhengzhiqingnian_tob", "正直青年 2.0", "中文", "角色扮演", "", "", "标签：猫箱同款"],
  ["ICL_uranus_zh_male_zhishuaiqingnian_tob", "直率青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zhongerqingnian_tob", "中二青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zifuqingnian_tob", "自负青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_zixinqingnian_tob", "自信青年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_tiancaitongzhuo_tob", "天才同桌 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_male_qingxinmumu_tob", "清新沐沐 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_wenwanshanshan_tob", "温婉珊珊 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_female_reqingaina_tob", "热情艾娜 2.0", "中文", "客服场景", "", "", ""],
  ["ICL_uranus_zh_male_shuanglangshaonian_tob", "爽朗少年 2.0", "中文", "角色扮演", "", "", ""],
  ["ICL_uranus_zh_female_qingyingduoduo_tob", "轻盈朵朵 2.0", "中文", "客服场景", "", "", ""],
  ["ar_female_dina_uranus_bigtts", "Dina", "阿拉伯语", "通用场景, 视频配音,多语种,阿拉伯语", "QA", "情感变化、指令遵循", ""],
  ["ar_female_fatma_uranus_bigtts", "Fatma", "阿拉伯语", "趣味口音,多语种,阿拉伯语", "QA", "情感变化、指令遵循", ""],
  ["ar_male_youssef_uranus_bigtts", "Youssef", "阿拉伯语", "通用场景,有声阅读,多语种,阿拉伯语", "QA", "情感变化、指令遵循", ""],
  ["de_female_bv081_uranus_bigtts", "Stella", "德语", "教学场景, 客服场景,多语种,德语", "QA", "情感变化、指令遵循", ""],
  ["de_male_sven_uranus_bigtts", "Sven", "德语", "通用场景, 教学场景,多语种,德语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_adam-imitation_uranus_bigtts", "Rowan", "美式英语", "通用场景,有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_alberto_uranus_bigtts", "Alberto", "美式英语", "通用场景, 教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_alex_uranus_bigtts", "Alex", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_allison_uranus_bigtts", "Allison", "美式英语", "视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_authoritative-british_uranus_bigtts", "Charlotte", "美式英语", "教学场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_authoritative-informative_uranus_bigtts", "Margaret", "美式英语", "通用场景,有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_bill-jones_uranus_bigtts", "Jones", "美式英语", "趣味口音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_bill_jones_corey_uranus_bigtts", "Bill", "美式英语", "通用场景, 视频配音,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_brad_pitt_p1_uranus_bigtts", "Brad_Pitt", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_brittney_uranus_bigtts", "Brittney", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_brittney_pimintel_uranus_bigtts", "Zoe", "美式英语", "有声阅读, 客服场景,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_bruce_uranus_bigtts", "Adrian", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_chandler_p1_uranus_bigtts", "Leo", "美式英语", "趣味口音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_cowboy-bob_uranus_bigtts", "Bob", "美式英语", "通用场景, 教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_cowboy_john_b_uranus_bigtts", "John", "美式英语", "趣味口音, 角色扮演,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_david_uranus_bigtts", "David", "美式英语", "通用场景,有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_deep-voice_uranus_bigtts", "Orion", "美式英语", "趣味口音, 角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_diyuwenrounan_uranus_bigtts", "Julian", "美式英语", "有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_evil-guy-oxley_uranus_bigtts", "Harrison", "美式英语", "视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_excited-male-voice_uranus_bigtts", "Jasper", "美式英语", "趣味口音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_father-christmas_uranus_bigtts", "Alfred", "美式英语", "通用场景,有声阅读, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_female_tutor_ms-jenny_uranus_bigtts", "Holly", "美式英语", "教学场景, 视频配音,美式英语,多语种", "Context", "情感变化、上下文遵循", ""],
  ["en_male_fernando-martinez_uranus_bigtts", "Felix", "美式英语", "通用场景, 教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_godfather_uranus_bigtts", "Godfather", "美式英语", "有声阅读, 角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_gollum_uranus_bigtts", "Gollum", "美式英语", "角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_hades_uranus_bigtts", "Beau", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_hayley_uranus_bigtts", "Hayley", "美式英语", "教学场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_jamie_uranus_bigtts", "Jamie", "美式英语", "通用场景, 教学场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_jane_uranus_bigtts", "Jane", "美式英语", "视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_jenny_uranus_bigtts", "Jenny", "美式英语", "通用场景, 客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_jidongchuanjiaoshi_uranus_bigtts", "Blaze", "美式英语", "趣味口音, 角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_jimmy_uranus_bigtts", "Jimmy", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_joanne_uranus_bigtts", "Joanne", "美式英语", "通用场景,有声阅读, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_joker_uranus_bigtts", "Joker", "美式英语", "趣味口音, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_josh_uranus_bigtts", "Josh", "美式英语", "视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_josh_coery_uranus_bigtts", "Josiah", "美式英语", "教学场景, 视频配音,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_kevin_uranus_bigtts", "Kevin", "美式英语", "教学场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_knightley_uranus_bigtts", "Knightley", "美式英语", "有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_lana_del_rey_kelley_d_p1_uranus_bigtts", "Lynn", "美式英语", "角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_lana_del_rey_parky_s_p1_uranus_bigtts", "Ivy", "美式英语", "客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_marcus_uranus_bigtts", "Marcus", "美式英语", "通用场景,有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_mel_uranus_bigtts", "Mel", "美式英语", "教学场景, 客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_michael_uranus_bigtts", "Hank", "美式英语", "通用场景, 教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_michael-mouse_uranus_bigtts", "Chip", "美式英语", "趣味口音, 角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_michael_kevin_uranus_bigtts", "Michael_Kevin", "美式英语", "通用场景, 教学场景,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_male_motivational-coach_uranus_bigtts", "Rory", "美式英语", "趣味口音, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_myra_uranus_bigtts", "Myra", "美式英语", "教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_myra_cmb_uranus_bigtts", "Sunny", "美式英语", "教学场景, 客服场景,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_female_nadia_uranus_bigtts", "Blair", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_natasha_uranus_bigtts", "Natasha", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_female_pleasant-female_uranus_bigtts", "Elaine", "美式英语", "有声阅读,视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_rachel_p1_uranus_bigtts", "Rachel", "美式英语", "趣味口音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_ronald_uranus_bigtts", "Ronald", "美式英语", "有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_russell_uranus_bigtts", "Russell", "美式英语", "通用场景, 教学场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_scarlet_p1_uranus_bigtts", "Scarlet", "美式英语", "客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_sharron_uranus_bigtts", "Sharron", "美式英语", "趣味口音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_simba_p1_uranus_bigtts", "Simba", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_skye_uranus_bigtts", "Skye", "美式英语", "通用场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_tom_hiddleston_p1_uranus_bigtts", "Tom", "美式英语", "通用场景,有声阅读,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_valentino_uranus_bigtts", "Valentino", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_valentino_corey_uranus_bigtts", "Clark", "美式英语", "视频配音,美式英语,多语种", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["en_female_wenrouzhishijieshuonv_uranus_bigtts", "Megan", "美式英语", "客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_xinwenjieshuonv_uranus_bigtts", "Kayla", "美式英语", "角色扮演,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_male_yangguangjieshuonan_uranus_bigtts", "Dylan", "美式英语", "通用场景, 视频配音,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["en_female_zendaya_p1_uranus_bigtts", "Zendaya", "美式英语", "教学场景, 客服场景,美式英语,多语种", "QA", "情感变化、指令遵循", ""],
  ["es_female_bv084_uranus_bigtts", "Gracie", "西班牙语", "通用场景, 客服场景,多语种,西班牙语", "QA", "情感变化、指令遵循", ""],
  ["es_male_dani_uranus_bigtts", "Dani", "西班牙语", "有声阅读,视频配音,多语种,西班牙语", "QA", "情感变化、指令遵循", ""],
  ["es_male_guillem_uranus_bigtts", "Guillem", "西班牙语", "有声阅读,多语种,西班牙语", "QA", "情感变化、指令遵循", ""],
  ["es_female_ht_mx_f6_uranus_bigtts", "Marisol", "西班牙语", "通用场景, 视频配音,多语种,西班牙语", "QA", "情感变化、指令遵循", ""],
  ["fr_female_fr_bv078_uranus_bigtts", "Simone", "法语", "通用场景, 视频配音,多语种,法语", "QA", "情感变化、指令遵循", ""],
  ["fr_female_fr_f47_uranus_bigtts", "Camille", "法语", "教学场景, 客服场景,多语种,法语", "QA", "情感变化、指令遵循", ""],
  ["fr_male_fr_m29_uranus_bigtts", "Maurice", "法语", "有声阅读,视频配音,多语种,法语", "QA", "情感变化、指令遵循", ""],
  ["fr_male_usseau_uranus_bigtts", "Usseau", "法语", "通用场景, 客服场景,多语种,法语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["id_male_bv160_uranus_bigtts", "Rocco", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_male_bv160dialogue_uranus_bigtts", "Jude", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_male_bv160narration_uranus_bigtts", "Hugo", "印尼语", "有声阅读,视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_bv161_uranus_bigtts", "Clara", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_bv161dialogue_uranus_bigtts", "Sylvia", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_bv161narration_uranus_bigtts", "Celeste", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_bv164_uranus_bigtts", "Crew", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_male_bv164dialogue_uranus_bigtts", "Elian", "印尼语", "视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_male_bv164narration_uranus_bigtts", "Ronan", "印尼语", "有声阅读,视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_f20_uranus_bigtts", "Chloe", "印尼语", "视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_male_han_uranus_bigtts", "Han", "印尼语", "通用场景,多语种,印尼语", "Context", "情感变化、指令遵循、上下文遵循", ""],
  ["id_male_m08_uranus_bigtts", "Kyle", "印尼语", "通用场景, 教学场景,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["id_female_phulia_uranus_bigtts", "Phulia", "印尼语", "通用场景, 视频配音,多语种,印尼语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_bv024_uranus_bigtts", "Bonnie", "日语", "通用场景, 教学场景,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_bv520_uranus_bigtts", "Poppy", "日语", "视频配音, 角色扮演,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_bv521_uranus_bigtts", "Aoi", "日语", "趣味口音, 角色扮演,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_bv522_uranus_bigtts", "Hana", "日语", "通用场景, 教学场景, 客服场景,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_bv523_uranus_bigtts", "Lily", "日语", "趣味口音, 角色扮演,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_male_bv524_uranus_bigtts", "Ken", "日语", "通用场景, 视频配音,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ja_female_minimi_uranus_bigtts", "Minimi", "日语", "通用场景, 视频配音,多语种,日语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["ja_female_shirou_uranus_bigtts", "Shirou", "日语", "视频配音, 角色扮演,多语种,日语", "QA", "情感变化、指令遵循", ""],
  ["ko_male_bv545_uranus_bigtts", "Jay", "韩语", "通用场景, 视频配音,多语种,韩语", "QA", "情感变化、指令遵循", ""],
  ["ko_female_bv546_uranus_bigtts", "Momo", "韩语", "视频配音, 角色扮演,多语种,韩语", "QA", "情感变化、指令遵循", ""],
  ["ko_male_m03_uranus_bigtts", "Minho", "韩语", "通用场景, 客服场景,多语种,韩语", "QA", "情感变化、指令遵循", ""],
  ["ko_male_shane_uranus_bigtts", "Shane", "韩语", "有声阅读, 教学场景, 视频配音,多语种,韩语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["ms_male_ham_uranus_bigtts", "Ham", "马来语", "通用场景, 教学场景,多语种,马来语", "QA", "情感变化、指令遵循", ""],
  ["ms_male_naim_uranus_bigtts", "Naim", "马来语", "通用场景, 客服场景,多语种,马来语", "QA", "情感变化、指令遵循", ""],
  ["mx_female_bv065_uranus_bigtts", "Irene", "墨西哥西语", "教学场景, 视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_male_bv165dialogue_uranus_bigtts", "Diego", "墨西哥西语", "有声阅读,视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_male_bv165narrator_uranus_bigtts", "Marcos", "墨西哥西语", "有声阅读,视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_female_bv166dialogue_uranus_bigtts", "Lucy", "墨西哥西语", "通用场景, 视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_female_bv166emotion_uranus_bigtts", "Rosa", "墨西哥西语", "通用场景, 视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_female_bv166narrator_uranus_bigtts", "Freya", "墨西哥西语", "有声阅读, 视频配音, 客服场景,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_male_felipe_uranus_bigtts", "Felipe", "墨西哥西语", "通用场景,有声阅读,多语种,墨西哥西语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["mx_male_ht_mx_m012_uranus_bigtts", "Derek", "墨西哥西语", "教学场景, 视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_female_leslie_uranus_bigtts", "Leslie", "墨西哥西语", "通用场景, 客服场景,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["mx_male_marcelo_uranus_bigtts", "Marcelo", "墨西哥西语", "通用场景, 视频配音,多语种,墨西哥西语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_bv172_uranus_bigtts", "Sam", "巴西葡萄牙语", "通用场景, 客服场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_bv172dialogue_uranus_bigtts", "Walter", "巴西葡萄牙语", "视频配音,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_bv172emotion_uranus_bigtts", "Vincent", "巴西葡萄牙语", "教学场景, 视频配音,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_bv172narrator_uranus_bigtts", "Miles", "巴西葡萄牙语", "有声阅读, 角色扮演,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_bv173_uranus_bigtts", "Diana", "巴西葡萄牙语", "通用场景, 教学场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_bv173dialogue_uranus_bigtts", "Elena", "巴西葡萄牙语", "视频配音, 客服场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_bv173emotion_uranus_bigtts", "Lola", "巴西葡萄牙语", "通用场景, 教学场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_bv173narrator_uranus_bigtts", "Emma", "巴西葡萄牙语", "视频配音, 客服场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_bv530_uranus_bigtts", "Sofia", "巴西葡萄牙语", "通用场景, 视频配音,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_bv531_uranus_bigtts", "Arthur", "巴西葡萄牙语", "通用场景, 教学场景,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_female_mari_uranus_bigtts", "Mari", "巴西葡萄牙语", "教学场景, 视频配音,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["pt_male_martins_uranus_bigtts", "Toby", "巴西葡萄牙语", "通用场景, 教学场景,多语种,巴西葡萄牙语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
  ["pt_male_rael_uranus_bigtts", "Rael", "巴西葡萄牙语", "教学场景, 视频配音,多语种,巴西葡萄牙语", "QA", "情感变化、指令遵循", ""],
  ["ru_female_af07_uranus_bigtts", "Amelia", "俄语", "有声阅读,视频配音,多语种,俄语", "QA", "情感变化、指令遵循", ""],
  ["ru_female_irinae_uranus_bigtts", "Irinae", "俄语", "有声阅读,视频配音,多语种,俄语", "QA", "情感变化、指令遵循", ""],
  ["ru_male_pavel_uranus_bigtts", "Pavel", "俄语", "通用场景, 视频配音,多语种,俄语", "QA", "情感变化、指令遵循", ""],
  ["ru_female_sophie_uranus_bigtts", "Ksenia", "俄语", "通用场景,多语种,俄语", "QA", "情感变化、指令遵循", ""],
  ["ru_male_vlad_uranus_bigtts", "Silas", "俄语", "趣味口音,多语种,俄语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_angry_uranus_bigtts", "Valeria", "泰语", "教学场景, 视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_fear_uranus_bigtts", "Iris", "泰语", "有声阅读,视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_happy_uranus_bigtts", "Zara", "泰语", "通用场景, 视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_hate_uranus_bigtts", "Valentina", "泰语", "通用场景, 视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_neutral_uranus_bigtts", "Mildred", "泰语", "通用场景, 视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_sad_uranus_bigtts", "Lydia", "泰语", "视频配音, 客服场景,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["th_female_bv568_suprise_uranus_bigtts", "Phoebe", "泰语", "有声阅读,视频配音,多语种,泰语", "QA", "情感变化、指令遵循", ""],
  ["tl_female_annika_uranus_bigtts", "Annika", "菲律宾语", "通用场景, 视频配音,多语种,菲律宾语", "QA", "情感变化、指令遵循", ""],
  ["tl_male_ed_uranus_bigtts", "Ed", "菲律宾语", "通用场景, 视频配音,多语种,菲律宾语", "QA", "情感变化、指令遵循", ""],
  ["tl_female_hervie_uranus_bigtts", "Hervie", "菲律宾语", "有声阅读, 视频配音, 客服场景,多语种,菲律宾语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_hong_uranus_bigtts", "Hong", "越南语", "通用场景, 客服场景,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_ling_uranus_bigtts", "Ling", "越南语", "通用场景, 视频配音,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_linh_uranus_bigtts", "Linh", "越南语", "视频配音,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_partner_uranus_bigtts", "Partner", "越南语", "视频配音, 客服场景,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_ruan_uranus_bigtts", "Ruan", "越南语", "通用场景,有声阅读, 角色扮演,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_female_wu_uranus_bigtts", "Wu", "越南语", "通用场景, 视频配音,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["vi_male_wumg_uranus_bigtts", "Wumg", "越南语", "通用场景, 客服场景,多语种,越南语", "QA", "情感变化、指令遵循", ""],
  ["it_male_enzo_uranus_bigtts", "Enzo", "意大利语", "通用场景, 教学场景,多语种,意大利语", "Context", "情感变化、上下文遵循", "仅限单向流使用，不支持双向流，双向流调用会直接报错；"],
] as const satisfies readonly VolcengineTtsVoiceTuple[];

const LANGUAGE_LOCALES: Readonly<Record<string, string>> = {
  中文: "zh-CN",
  "中文、英式英语": "zh-CN",
  美式英语: "en-US",
  英式英语: "en-GB",
  澳洲英语: "en-AU",
  阿拉伯语: "ar",
  德语: "de-DE",
  墨西哥西语: "es-MX",
  西班牙语: "es-ES",
  印尼语: "id-ID",
  巴西葡萄牙语: "pt-BR",
  日语: "ja-JP",
  韩语: "ko-KR",
  法语: "fr-FR",
  马来语: "ms-MY",
  俄语: "ru-RU",
  泰语: "th-TH",
  菲律宾语: "fil-PH",
  越南语: "vi-VN",
  意大利语: "it-IT",
  日文: "ja-JP",
  印尼: "id-ID",
  墨西哥西班牙语: "es-MX",
};

function inferLocale(id: string, language: string): string {
  const parsed = parseVoiceLanguageField(language);
  const firstLang = parsed.languages[0];
  if (firstLang) {
    const fromFirst = LANGUAGE_LOCALES[firstLang];
    if (fromFirst) return fromFirst;
  }
  const direct = LANGUAGE_LOCALES[language];
  if (direct) return direct;

  const normalizedId = id.toLowerCase();
  if (/^(?:icl_uranus_)?zh_/.test(normalizedId)) return "zh-CN";
  if (/^(?:icl_uranus_)?en_/.test(normalizedId)) return "en-US";
  if (normalizedId.startsWith("ar_")) return "ar";
  if (normalizedId.startsWith("de_")) return "de-DE";
  if (normalizedId.startsWith("es_")) return "es-MX";
  if (normalizedId.startsWith("id_")) return "id-ID";
  if (normalizedId.startsWith("pt_")) return "pt-BR";
  if (normalizedId.startsWith("ja_")) return "ja-JP";
  if (normalizedId.startsWith("ko_")) return "ko-KR";
  if (normalizedId.startsWith("fr_")) return "fr-FR";
  if (normalizedId.startsWith("ms_")) return "ms-MY";
  if (normalizedId.startsWith("ru_")) return "ru-RU";
  if (normalizedId.startsWith("th_")) return "th-TH";
  if (normalizedId.startsWith("tl_")) return "fil-PH";
  if (normalizedId.startsWith("vi_")) return "vi-VN";
  if (normalizedId.startsWith("it_")) return "it-IT";
  throw new Error(`无法识别火山引擎音色语种：${id}`);
}

function groupFromLocale(locale: string): VolcengineTtsVoiceGroup {
  if (locale.startsWith("zh")) return "chinese";
  if (locale.startsWith("en")) return "english";
  if (locale.startsWith("ar")) return "arabic";
  if (locale.startsWith("de")) return "german";
  if (locale.startsWith("es")) return "spanish";
  if (locale.startsWith("id")) return "indonesian";
  if (locale.startsWith("pt")) return "portuguese";
  if (locale.startsWith("ja")) return "japanese";
  if (locale.startsWith("ko")) return "korean";
  if (locale.startsWith("fr")) return "french";
  if (locale.startsWith("ms")) return "malay";
  if (locale.startsWith("ru")) return "russian";
  if (locale.startsWith("th")) return "thai";
  if (locale.startsWith("fil")) return "filipino";
  if (locale.startsWith("vi")) return "vietnamese";
  if (locale.startsWith("it")) return "italian";
  throw new Error(`无法分组火山引擎音色语种：${locale}`);
}

function inferGender(id: string): VolcengineTtsVoiceGender {
  if (/(?:^|_)female(?:_|$)/i.test(id)) return "female";
  if (/(?:^|_)male(?:_|$)/i.test(id)) return "male";
  throw new Error(`火山引擎音色 ID 未包含明确性别：${id}`);
}

function splitVoiceList(raw: string): string[] {
  return raw
    .split(/[、,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseVoiceLanguageField(language: string): {
  languages: string[];
  dialects: string[];
} {
  const trimmed = language.trim();
  if (!trimmed) return { languages: [], dialects: [] };

  const dialectMatch = trimmed.match(/方言[：:]([^；;]*)/);
  const langMatch = trimmed.match(/语种[：:]([^；;]*)/);
  const dialects = dialectMatch ? splitVoiceList(dialectMatch[1] ?? "") : [];
  if (langMatch) {
    return { languages: splitVoiceList(langMatch[1] ?? ""), dialects };
  }

  const withoutDialect = trimmed.replace(/[；;]?\s*方言[：:].*$/, "").trim();
  return { languages: splitVoiceList(withoutDialect), dialects };
}

function parseVoiceNote(note: string): {
  blurb: string;
  tags: string[];
} {
  const trimmed = note.trim().replace(/[；;]+$/, "");
  if (!trimmed) return { blurb: "", tags: [] };
  const tagMatch = trimmed.match(/^标签[：:]\s*(.*)$/);
  if (tagMatch) return { blurb: "", tags: splitVoiceList(tagMatch[1] ?? "") };
  return { blurb: trimmed, tags: [] };
}

function buildVoiceTags(options: {
  languages: readonly string[];
  dialects: readonly string[];
  scene: string;
  capabilities: string;
  noteTags: readonly string[];
}): VolcengineTtsVoiceTag[] {
  const seen = new Set<string>();
  const tags: VolcengineTtsVoiceTag[] = [];
  const push = (label: string, tone: VolcengineTtsVoiceTagTone): void => {
    const key = `${tone}:${label}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    tags.push({ label, tone });
  };

  for (const language of options.languages) push(language, "language");
  for (const dialect of options.dialects) push(dialect, "dialect");
  for (const scene of splitVoiceList(options.scene)) {
    if (options.languages.includes(scene)) continue;
    push(scene, "scene");
  }
  for (const capability of splitVoiceList(options.capabilities)) {
    push(capability, "capability");
  }
  for (const note of options.noteTags) push(note, "note");
  return tags;
}

function createVoice(
  row: VolcengineTtsVoiceTuple,
): VolcengineTtsVoice {
  const [id, name, language, scene, _inferenceMode, capabilities, note] = row;
  const { languages, dialects } = parseVoiceLanguageField(language);
  const { blurb, tags: noteTags } = parseVoiceNote(note);
  const tags = buildVoiceTags({
    languages,
    dialects,
    scene,
    capabilities,
    noteTags,
  });
  const locale = inferLocale(id, language);
  const extra = blurb;

  return {
    id,
    name,
    label: name,
    description: extra,
    tags,
    languages,
    dialects,
    gender: inferGender(id),
    locale,
    group: groupFromLocale(locale),
  };
}

/** 按官方文档顺序排列，共 444 个唯一音色。 */
export const VOLCENGINE_TTS_VOICES: readonly VolcengineTtsVoice[] =
  VOLCENGINE_TTS_VOICE_ROWS.map(createVoice);

const VOLCENGINE_TTS_VOICE_BY_ID = new Map(
  VOLCENGINE_TTS_VOICES.map((voice) => [voice.id, voice] as const),
);

export function findVolcengineTtsVoice(
  id: string,
): VolcengineTtsVoice | undefined {
  return VOLCENGINE_TTS_VOICE_BY_ID.get(id.trim());
}

let cachedDefaultVoiceGroups:
  | [string, readonly VolcengineTtsVoice[]][]
  | undefined;

export function groupVolcengineTtsVoices(
  voices: readonly VolcengineTtsVoice[] = VOLCENGINE_TTS_VOICES,
): [string, readonly VolcengineTtsVoice[]][] {
  if (voices === VOLCENGINE_TTS_VOICES && cachedDefaultVoiceGroups) {
    return cachedDefaultVoiceGroups;
  }

  const grouped = new Map<VolcengineTtsVoiceGroup, VolcengineTtsVoice[]>();

  for (const voice of voices) {
    const bucket = grouped.get(voice.group) ?? [];
    bucket.push(voice);
    grouped.set(voice.group, bucket);
  }

  const groups = [...grouped].map(([group, groupVoices]) => [
    VOLCENGINE_TTS_VOICE_GROUP_LABELS[group],
    groupVoices,
  ] as [string, readonly VolcengineTtsVoice[]]);

  if (voices === VOLCENGINE_TTS_VOICES) cachedDefaultVoiceGroups = groups;
  return groups;
}

/** 官方主表分组一次缓存，避免设置页每次下拉重建 */
export const VOLCENGINE_TTS_VOICE_GROUPS: readonly [
  string,
  readonly VolcengineTtsVoice[],
][] = groupVolcengineTtsVoices();
