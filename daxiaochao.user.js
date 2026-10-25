// ==UserScript==
// @name         三国杀小抄 Lite
// @namespace    https://greasyfork.org/scripts/448004
// @version      0.19.1
// @author       三国杀小抄
// @description  三国杀记牌器
// @license      GPL-3.0-or-later
// @icon         https://i0.hdslb.com/bfs/new_dyn/17ec41a0ca79633b77399065ab80da3f2138912.png
// @homepage     https://github.com/llsccm/tracker#readme
// @homepageURL  https://github.com/llsccm/tracker#readme
// @source       https://github.com/llsccm/tracker.git
// @supportURL   https://github.com/llsccm/tracker/issues
// @match        *://game.4399iw2.com/yxsgs/*
// @match        *://my.4399.com/yxsgs/*
// @match        *://*.sanguosha.com/*
// @match        *://web.kuaiwan.com/kwsgsn/*
// @match        *://wan.baidu.com/microend?gameId=19793595/*
// @match        *://www.7k7k.com/special/sgs/?*
// @match        *://playgame.iqiyi.com/login/iframe_page_web/top?game_id=146
// @exclude      https://game.4399iw2.com/yxxsgs/*
// @exclude      *://*.sanguosha.com/10/*
// @exclude      *://*.sanguosha.com/10th/*
// @exclude      https://wan.baidu.com/*gameId=19793616*
// @exclude      *://h5.7k7k.com/web/H5GAMES.html?gid=960982bec2f555de44ea43ca8a7ef418/*
// @exclude      *://qqgame.qq.com/webappframe/?appid=10951
// @exclude      *://s118.app1107877410.qqopenapp.com/pc/qqLobby_index.php*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
	"use strict";
	var __defProp = Object.defineProperty;
	var __exportAll = (all, no_symbols) => {
		let target = {};
		for (var name in all) __defProp(target, name, {
			get: all[name],
			enumerable: true
		});
		if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
		return target;
	};
	function sleep(time, value) {
		return new Promise((resolve) => setTimeout(() => resolve(value), time));
	}
	async function wait(callback, times = 10, interval = 500, { immediate = false } = {}) {
		const total = Math.max(0, Math.floor(Number(times) || 0));
		let result;
		for (let i = 0; i < total; i++) {
			if (!immediate || i > 0) await sleep(interval);
			result = await Promise.resolve(callback());
			if (result) return result;
		}
		return result;
	}
	function n2N(n, A = true) {
		return [
			"",
			A ? "A" : 1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
			10,
			"J",
			"Q",
			"K"
		][n] ?? "";
	}
	function n2C(n) {
		return [
			"",
			"♥",
			"♦",
			"♠",
			"♣"
		][n] ?? "";
	}
	function getCardCnHtml(color, number) {
		const suit = n2C(color);
		const rank = n2N(number);
		const cnClass = (suit + rank).length >= 3 ? "card-cn card-cn-long" : "card-cn";
		const suitClass = getSuitClass(color);
		return `<span class="${suitClass ? `${cnClass} ${suitClass}` : cnClass}">${getSuitGlyphHtml(suit)}<span class="rank-glyph">${rank}</span></span>`;
	}
	function getCardFaceHtml(card = {}) {
		return `${card.number ? getCardCnHtml(card.color, card.number) : ""}<span class="card-name">${String(card.name || "").substring(0, 2)}</span>`;
	}
	function getSuitClass(color) {
		return SUIT_CLASS[color] || "";
	}
	function getSuitGlyphHtml(suit, suitClass = "") {
		if (!suit) return "";
		return `<span class="${suitClass ? `suit-glyph ${suitClass}` : "suit-glyph"}">${suit}</span>`;
	}
	function toSuitGlyphHtml(text = "") {
		return String(text || "").replace(/[♥♦♠♣]/g, (suit) => getSuitGlyphHtml(suit, SUIT_CLASS_BY_TEXT[suit] || ""));
	}
	var SUIT_CLASS = [
		"",
		"suit-heart",
		"suit-diamond",
		"suit-spade",
		"suit-club"
	];
	var SUIT_CLASS_BY_TEXT = {
		"♥": "suit-heart",
		"♦": "suit-diamond",
		"♠": "suit-spade",
		"♣": "suit-club"
	};
	function setSuitRecord(text = "", prefix = "") {
		if (typeof document === "undefined") return;
		const target = document.getElementById("suit");
		if (!target) return;
		target.innerHTML = prefix + toSuitGlyphHtml(text);
	}
	var ConfigBase = class {
		configName = "";
		FileName = "";
		constructor(configName) {
			this.configName = configName;
			this.longToShortObj = {};
			this.shortToLongObj = {};
		}
		parse(data) {
			if (!data) console.error("配置解析出错：" + this.configName);
			return data;
		}
		initAbbreviation(data) {
			this.abbreviationField = data;
			if (this.abbreviationField) for (let i = 0; i < this.abbreviationField.length; i++) {
				const obj = this.abbreviationField[i];
				this.longToShortObj[obj.Long] = obj.Short;
				this.shortToLongObj[obj.Short] = obj.Long;
			}
		}
		ClearData() {}
	};
	var shortName = {
		乐不思蜀: "乐",
		兵粮寸断: "兵",
		八卦阵: "八卦",
		爪黄飞电: "爪黄+1",
		的卢: "的卢+1",
		绝影: "绝影+1",
		骅骝: "骅骝+1",
		赤兔: "赤兔-1",
		大宛: "大宛-1",
		紫骍: "紫骍-1",
		紫騂: "紫骍-1",
		诸葛连弩: "连弩",
		木牛流马: "木马",
		顺手牵羊: "顺手",
		万箭齐发: "万箭",
		五谷丰登: "五谷",
		无中生有: "无中",
		过河拆桥: "过拆",
		桃园结义: "桃园",
		无懈可击: "无懈",
		南蛮入侵: "南蛮",
		借刀杀人: "借刀",
		铁索连环: "铁索",
		随机应变: "随机",
		远交近攻: "远交",
		以逸待劳: "逸劳",
		知己知彼: "知己",
		逐近弃远: "逐近",
		洞烛先机: "洞烛",
		出其不意: "出其",
		水淹七军: "水淹",
		"无懈可击·国": "国无",
		挟天子以令诸侯: "挟令",
		方天画戟: "方天戟",
		雌雄双股剑: "雌雄剑",
		青龙偃月刀: "青龙刀",
		丈八蛇矛: "丈八矛",
		朱雀羽扇: "朱雀扇",
		白银狮子: "白银",
		三尖两刃刀: "三尖刀",
		乌铁锁链: "乌铁链",
		五行鹤翎扇: "五行扇",
		太公阴符: "太公符",
		无双方天戟: "无双戟",
		束发紫金冠: "紫金冠",
		玲珑狮蛮带: "玲珑带",
		红棉百花袍: "百花袍",
		红锦百花袍: "百花袍",
		四乘粮舆: "四乘舆",
		铁蒺玄舆: "铁蒺舆",
		飞轮战舆: "飞轮舆",
		鬼龙斩月刀: "鬼龙刀",
		国风玉袍: "国风袍",
		赤炎镇魂琴: "赤炎琴",
		奇门八阵: "奇门阵",
		绝尘金戈: "绝尘+1",
		修罗炼狱戟: "修罗戟",
		虚妄之冕: "虚妄冕",
		赤血青峰: "赤青锋",
		赤血青锋: "赤青锋",
		鸾凤和鸣剑: "鸾凤剑",
		七彩神鹿: "神鹿-1",
		金乌落日弓: "金乌弓",
		刑天破军斧: "刑天斧",
		长安大舰: "长安-2",
		禅让诏书: "诏书",
		镔铁双戟: "镔铁戟",
		继往开来: "继往",
		攻守兼备: "攻守",
		进退自如: "进退",
		洪荒之力: "洪荒",
		同舟共济: "同舟",
		力争上游: "力争",
		逆水行舟: "逆水",
		撒豆成兵: "撒豆",
		移花接木: "移花",
		联军盛宴: "联军",
		调虎离山: "调虎",
		火烧连营: "火烧",
		勠力同心: "勠力",
		调剂盐梅: "调剂",
		声东击西: "声东",
		增兵减灶: "增兵",
		草木皆兵: "草木",
		唯我独尊: "独尊",
		弃甲曳兵: "弃甲",
		金蝉脱壳: "金蝉",
		故步自封: "自封",
		金鼓笙旗: "金鼓",
		党同伐异: "伐异",
		燎原之火: "燎原",
		"八卦阵(复制)": "八卦",
		"仁王盾(复制)": "仁王盾",
		"藤甲(复制)": "藤甲",
		"白银狮子(复制)": "白银狮",
		商鞅变法: "变法",
		真龙长剑: "真龙剑",
		传国玉玺: "玉玺",
		厚积形: "厚积",
		桎梏形: "桎梏",
		盈冲形: "盈冲",
		背水形: "背水",
		整肃形: "整肃",
		寸兵形: "寸兵",
		雄黄酒: "酒",
		生死与共: "生死",
		红运当头: "红运",
		有难同当: "同当",
		落井下石: "落井",
		雷公助我: "雷公",
		两肋插刀: "两肋",
		兄弟齐心: "齐心",
		无天无界: "无界",
		你死我活: "死活",
		浑天仪: "浑天仪"
	};
	var SUB_TYPE_NAMES = {
		6: "火杀",
		7: "雷杀",
		11: "冰杀",
		12: "闪闪"
	};
	var CardConfig = class CardConfig extends ConfigBase {
		cards = new Map();
		cardsByClassName = new Map();
		cardIDsOrder = [];
		constructor() {
			super("Cards_json");
			this.FileName = "sys_playcard";
		}
		static GetInstance() {
			if (this.instance == null) this.instance = new CardConfig();
			return this.instance;
		}
		parse(data) {
			if (!data) return;
			this.initAbbreviation(data.abbreviation?.field || data.abbreviation);
			this.gamePlayCards = data.GamePlayCards;
			this.initCardsByClassName();
			this.cardIDsOrder = data.GamePlayCards.card.sort((a, b) => a.c - b.c || a.d - b.d || a.h - b.h || a.m - b.m || a.g - b.g || a.f - b.f || a.a - b.a).map(({ a }) => a);
		}
		initCardsByClassName() {
			if (!this.gamePlayCards) return;
			this.addCards(this.gamePlayCards.card, true);
			this.addCards(this.gamePlayCards.card_H5);
		}
		addCards(cards, needDecode = false) {
			if (!cards || !cards.length) return;
			for (const cardData of cards) {
				if (!cardData) continue;
				const cardInfo = needDecode ? {} : cardData;
				if (needDecode) for (const [shortKey, value] of Object.entries(cardData)) {
					const longKey = this.shortToLongObj[shortKey] || shortKey;
					cardInfo[longKey] = value;
				}
				const { name, color, number, subType } = cardInfo;
				const suit = n2C(color);
				const num = n2N(number);
				cardInfo.name = SUB_TYPE_NAMES[subType] || shortName[name] || name;
				cardInfo.ncn = name + suit + num;
				cardInfo.cn = suit + num;
				cardInfo.c = suit;
				cardInfo.n = num;
				this.cards.set(cardInfo.id, cardInfo);
				if (cardInfo.res && !this.cardsByClassName.has(cardInfo.res)) this.cardsByClassName.set(cardInfo.res, cardInfo);
			}
			this.cards.set(0, {
				id: 0,
				name: "",
				color: 0,
				number: 0,
				ncn: "?",
				cn: "0",
				c: "",
				n: 0
			});
		}
		getCard(id) {
			return this.cards.get(id);
		}
		getCardName(id) {
			return this.getCard(id)?.name || "";
		}
		getCardNumber(id) {
			return this.getCard(id)?.number || 0;
		}
		getCardColor(id) {
			return this.getCard(id)?.color || 0;
		}
		getCardncn(id) {
			return this.getCard(id)?.ncn || "?";
		}
	};
	var SkillsConfig = class SkillsConfig extends ConfigBase {
		spellDict = new Map();
		markSpell = {
			290: "推锋",
			766: "匡弼",
			432: "醇醪"
		};
		constructor() {
			super("ChaSpell_json");
			this.FileName = "cha_spell";
		}
		static GetInstance() {
			if (this.instance == null) this.instance = new SkillsConfig();
			return this.instance;
		}
		parse(data) {
			if (!data) return;
			this.initAbbreviation(data.abbreviation?.field || data.abbreviation);
			this.initSpellDict(data.GameSpells?.spell);
		}
		initSpellDict(spells) {
			if (!spells?.length) return;
			for (const spell of spells) {
				const spellInfo = {};
				for (const [shortKey, value] of Object.entries(spell)) {
					const longKey = this.shortToLongObj[shortKey] || shortKey;
					spellInfo[longKey] = value;
				}
				const id = Number(spellInfo.id);
				this.spellDict.set(id, spellInfo);
				this.markSpell[id] = shortName[spellInfo.name] || spellInfo.name;
			}
		}
		getSpell(id) {
			return this.spellDict.get(Number(id));
		}
		getSpellName(id) {
			return this.getSpell(id)?.name || "无收录技能";
		}
	};
	var CharacterConfig = class CharacterConfig extends ConfigBase {
		generalDict = {};
		constructor() {
			super("Character_json");
			this.FileName = "character";
		}
		static GetInstance() {
			if (this.instance == null) this.instance = new CharacterConfig();
			return this.instance;
		}
		parse(data) {
			if (!data) return;
			this.initGeneralDict(data.GameCharacters?.character);
		}
		initGeneralDict(characters) {
			if (!characters?.length) return;
			for (const { a, ai, b } of characters) this.generalDict[a] = (ai || "") + b?.replaceAll("&", "");
		}
		getGeneral(id) {
			return this.generalDict[id];
		}
		getGeneralName(id) {
			return this.getGeneral(id) || "";
		}
	};
	var RoguelikeDifficultyVo = class {
		difID = 0;
		bdif = 0;
		sdif = 0;
		bdesc = "";
		preID = 0;
		bdifname = "";
		sdifname = "";
		diflv = 0;
		seasonID = 0;
		get DifID() {
			return this.difID || 0;
		}
		get Bdif() {
			return this.bdif || 0;
		}
		get Sdif() {
			return this.sdif || 0;
		}
		get BdescList() {
			return this.bdesc ? this.bdesc.split(",") : [];
		}
		get PreID() {
			return this.preID || 0;
		}
		get Bdifname() {
			return this.bdifname || "";
		}
		get Sdifname() {
			return this.sdifname || "";
		}
		get Diflv() {
			return this.diflv || 0;
		}
		get SeasonID() {
			return this.seasonID || 0;
		}
	};
	var ROGUE_LEVEL_KEYS = [
		"",
		"_ZD",
		"_KN",
		"_EM",
		"_LY"
	];
	var REWARD_QUALITY_NAMES = [
		"随机",
		"普通",
		"稀有",
		"史诗",
		"传说"
	];
	var CARD_SUBTYPE_NAMES = {
		6: "火杀",
		7: "雷杀",
		11: "冰杀",
		12: "闪闪"
	};
	var CHOICE_REWARD_TYPE_NAMES = {
		2: "战法",
		3: "技能",
		4: "手牌",
		5: "装备"
	};
	var RoguelikeConfig = class RoguelikeConfig extends ConfigBase {
		originData = null;
		difficultDict = new Map();
		bigDiffDic = new Map();
		shopDict = new Map();
		levelDict = new Map();
		adventureResultDict = new Map();
		fightDict = new Map();
		adventures = new Map();
		text = new Map();
		rewardGroupDict = new Map();
		chapterDict = new Map();
		generalDict = new Map();
		season = 0;
		constructor() {
			super("Roguelike_json");
			this.FileName = "hd_roguelike";
		}
		static GetInstance() {
			if (this.instance == null) this.instance = new RoguelikeConfig();
			return this.instance;
		}
		clearRuntimeMaps() {
			this.difficultDict.clear();
			this.bigDiffDic.clear();
			this.shopDict.clear();
			this.levelDict.clear();
			this.adventureResultDict.clear();
			this.fightDict.clear();
			this.adventures.clear();
			this.text.clear();
			this.rewardGroupDict.clear();
			this.chapterDict.clear();
			this.generalDict.clear();
			this.season = 0;
		}
		getPlot(id) {
			const plot = this.shopDict.get(String(id));
			return plot ? this.resolvePlot(plot) : plot;
		}
		getCity(id) {
			return this.levelDict.get(String(id));
		}
		getChoice(id) {
			const choice = this.adventureResultDict.get(String(id));
			return choice ? this.resolveChoice(choice) : choice;
		}
		getFight(id) {
			const fight = this.fightDict.get(String(id));
			if (fight) return this.normalizeFight(fight);
			const generals = this.getGeneralGroup(id);
			return generals ? this.normalizeFight({
				fightID: id,
				generals
			}) : void 0;
		}
		getAdventure(id) {
			return this.adventures.get(String(id));
		}
		getReward(id) {
			return this.rewardGroupDict.get(String(id));
		}
		getRewardText(id) {
			const reward = this.getReward(id);
			if (!reward) return "";
			if (reward.name) return reward.name;
			return this.formatRewardGroup(reward);
		}
		getGeneralGroup(id) {
			return this.generalDict.get(String(id));
		}
		parse(data) {
			if (!data) return;
			this.initAbbreviation(data.root?.abbreviation);
			this.decodeGenerals(data);
			this.data = data;
			const root = data.Root || {};
			this.originData = root;
			this.clearRuntimeMaps();
			this.season = root.Roundid?.[root.Roundid.length - 1]?.useSeason || 0;
			this.initDifficulties(root.DifficultySelection);
			this.initText(root.Text);
			this.initChapterPlaces(root.Chapter);
			this.initCities(root.Level);
			this.initRewards(root.RewardGroup, root.Other);
			this.initTactics(root.Tactics);
			this.initSpellPlots(root.Spell);
			this.initCardPlots(root.Card);
			this.initAdventures(root.Adventure);
			this.initGeneralGroups(root.General);
			this.initFights(root.Fight);
			this.initChoices(root.Choose);
		}
		initDifficulties(difficulties) {
			for (const data of difficulties || []) {
				if (!data) continue;
				const info = Object.assign(new RoguelikeDifficultyVo(), data);
				const sessionId = info.seasonID;
				if (sessionId != this.season) continue;
				this.difficultDict.set(String(info.difID), info);
				const bigKey = `${sessionId}_${info.bdif}`;
				if (!this.bigDiffDic.has(bigKey)) this.bigDiffDic.set(bigKey, []);
				this.bigDiffDic.get(bigKey).push(info);
			}
		}
		initText(texts) {
			for (const { ID, text } of texts || []) this.text.set(String(ID), text);
		}
		initChapterPlaces(chapters) {
			for (const { seasonID, chapter, cityName, bosslocation, location } of chapters || []) {
				const placeName = `${seasonID}-${chapter}${cityName}`;
				for (const locationId of location?.split(";") || []) this.chapterDict.set(String(locationId), placeName);
				this.chapterDict.set(String(bosslocation), `${placeName}BOSS`);
			}
		}
		initCities(levels) {
			for (const level of levels || []) {
				const city = this.parseCity(level);
				this.levelDict.set(String(city.cityID), city);
			}
		}
		parseCity(level) {
			const cityID = level.cityID || 0;
			const cityPos = this.parseCoordinate(level.citycoordinate);
			const [x, y] = cityPos;
			const eventFightKeys = this.splitIds(level.eventfight).map((fightKey) => String(fightKey).slice(-3));
			const eventfights = eventFightKeys.map(Number);
			const cityName = level.cityname || "";
			return {
				cityID,
				CityID: cityID,
				cityName,
				CityName: cityName,
				cityPos,
				CityPos: cityPos,
				citypic: level.citypic || "",
				eventfights,
				Eventfights: eventfights,
				eventFightKeys,
				eventfight: eventfights[0] || 0,
				Eventfight: eventfights[0] || 0,
				universalfight: level.universalfight || "",
				startShow: level.startshow == 1,
				StartShow: level.startshow == 1,
				scene: level.scene || "",
				spell: level.scenespell,
				desc: level.scenesDesc,
				cp: this.chapterDict.get(String(cityID)),
				x,
				y: -y,
				boss: level.startshow,
				name: cityName || this.getCityNameFromPic(level.citypic)
			};
		}
		parseCoordinate(coordinate) {
			return String(coordinate || "0,0").split(",").map(Number);
		}
		getCityNameFromPic(citypic) {
			return citypic?.replace(/^city_([0-9]+)_(.+?)(?:\.png)?$/, (_, number, name) => number + name);
		}
		initRewards(rewardGroups, others) {
			for (const otherReward of others || []) {
				const reward = this.parseOtherReward(otherReward);
				this.rewardGroupDict.set(String(reward.id), reward);
			}
			for (const rewardGroup of rewardGroups || []) {
				const reward = this.parseRewardGroup(rewardGroup);
				this.rewardGroupDict.set(String(reward.id), reward);
			}
		}
		parseOtherReward({ reward, rewardname }) {
			return {
				id: reward || 0,
				rewardID: reward || 0,
				name: rewardname || ""
			};
		}
		parseRewardGroup(rewardGroup) {
			return {
				id: rewardGroup.reward || 0,
				rewardID: rewardGroup.reward || 0,
				allreward: rewardGroup.allreward || "",
				rewardIcon: rewardGroup.rewardicon || "",
				toppic: rewardGroup.toppic || "",
				goodsId: rewardGroup.goods || 0,
				quality: rewardGroup.quality || 0,
				rewarddesc: rewardGroup.rewarddesc || "",
				rewarditem: rewardGroup.rewarditem || "",
				random: rewardGroup.random || 0,
				showpic: rewardGroup.showpic || "",
				pra1: rewardGroup.pra1 || 0,
				pra2: rewardGroup.pra2 || 0,
				type: rewardGroup.type || 0,
				abandonmoney: rewardGroup.abandonmoney || 0
			};
		}
		formatRewardGroup({ rewarddesc, allreward, abandonmoney }) {
			return (abandonmoney ? `${abandonmoney}铜币/` : "") + String(allreward || "").split(";").flatMap((reward) => reward.split(",")).map((quality) => REWARD_QUALITY_NAMES[quality]).join("/") + String(rewarddesc || "").replace("多选一", "自选");
		}
		initTactics(tactics) {
			for (const tactic of tactics || []) this.shopDict.set(String(tactic.plot), {
				source: "tactic",
				...tactic
			});
		}
		initSpellPlots(spells) {
			for (const spell of spells || []) this.shopDict.set(String(spell.id), {
				source: "spell",
				...spell
			});
		}
		initCardPlots(cards) {
			for (const card of cards || []) this.shopDict.set(String(card.id), {
				source: "card",
				...card
			});
		}
		decodeGenerals(roge) {
			if (!roge.Root?.General) return;
			roge.Root.General = roge.Root.General.map((general) => this.decodeAbbreviatedObject(general));
		}
		initAdventures(adventures) {
			for (const adventure of adventures || []) this.adventures.set(String(adventure.ID), this.parseAdventure(adventure));
		}
		parseAdventure(adventure) {
			const id = adventure.ID || 0;
			const textIds = this.splitIds(adventure.text);
			return {
				id,
				ID: id,
				chapname: adventure.chapname || "",
				duration: adventure.duration || 0,
				text: adventure.text || "",
				textIds,
				helptext: String(adventure.helptext || 0),
				showrole: adventure.showrole || "",
				mirror: adventure.mirror || 0,
				general: adventure.general,
				words: adventure.words,
				options: this.parseAdventureOptions(adventure)
			};
		}
		parseAdventureOptions(adventure) {
			const options = [];
			for (let index = 1; index < 10; index++) {
				const option = adventure["option" + index];
				const effect = adventure["effect" + index];
				if (!option || !effect) break;
				options.push({
					option,
					effect,
					effecttext: adventure["effecttext" + index] || 0,
					effectvalue: adventure["effectvalue" + index] || ""
				});
			}
			return options;
		}
		getText(textId) {
			if (textId == "9998") return "";
			return this.text.get(String(textId)) ?? textId;
		}
		initGeneralGroups(generals) {
			for (const generalData of generals || []) {
				const general = this.parseGeneral(generalData);
				const groupId = general.generalgroup;
				const groupKey = String(groupId);
				if (!this.generalDict.has(groupKey)) this.generalDict.set(groupKey, []);
				this.generalDict.get(groupKey).push(general);
			}
		}
		parseGeneral(general) {
			const generalgroup = general.generalgroup || 0;
			const generalID = general.generalID || 0;
			const generalname = String(general.generalname || "").replaceAll("&", "");
			const jumpStage = this.parseGeneralJumpStage(general.JumpStage);
			const growdouble = this.parseGeneralRatio(general.growdouble);
			const growshowdouble = this.parseGeneralRatio(general.growshowdouble);
			const diffdouble = this.parseGeneralRatio(general.diffdouble);
			const deleteSpell = this.splitIds(general.deletespell).map(Number);
			const inStage = general.inStage || 0;
			const hasNextStage = inStage > 0 && jumpStage.id > 0;
			const isboss = general.isboss == 1;
			return {
				generalgroup,
				generalID,
				generalname,
				generalskin: general.generalskin || 0,
				Generalskin: general.generalskin || 0,
				generalcounty: general.generalcounty || 0,
				Generalcounty: general.generalcounty || 0,
				growdouble,
				growshowdouble,
				diffdouble,
				hp: general.hp || 0,
				Hp: general.hp || 0,
				maxhp: general.maxhp || 0,
				MaxHp: general.maxhp || 0,
				armor: general.armor || 0,
				Armor: general.armor || 0,
				maxarmor: general.maxarmor || 0,
				Maxarmor: general.maxarmor || 0,
				getarmor: general.getarmor || 0,
				draw: general.draw || 0,
				DrawCnt: general.draw || 0,
				cardnum: general.cardnum || 0,
				CardNum: general.cardnum || 0,
				exshatimes: general.exshatimes || 0,
				ExShaTimes: general.exshatimes || 0,
				otherad: general.otherad || 0,
				Otherad: general.otherad || 0,
				isboss,
				deleteSpell,
				JumpStage: general.JumpStage || "",
				jumpStage,
				jumpStageId: jumpStage.id,
				JumpstageId: jumpStage.id,
				jumpStageIndex: jumpStage.index,
				JumpstageIndex: jumpStage.index,
				inStage,
				InStage: inStage,
				hasNextStage,
				HasNextStage: hasNextStage,
				hide: general.hide,
				Hide: general.hide,
				GeneralRank: general.GeneralRank || 0,
				...this.copyGeneralLevelFields(general)
			};
		}
		parseGeneralRatio(value) {
			return value != null ? value / 100 : 1;
		}
		parseGeneralJumpStage(jumpStage) {
			const [rawNextGroupId, rawIndex] = this.splitIds(jumpStage);
			if (!rawNextGroupId) return {
				raw: "",
				id: 0,
				index: 0
			};
			let nextGroupId = rawNextGroupId;
			if (String(nextGroupId).startsWith("2066")) nextGroupId -= 2e4;
			return {
				raw: jumpStage || "",
				id: Number(nextGroupId) || 0,
				index: Number(rawIndex) || 0
			};
		}
		copyGeneralLevelFields(general) {
			const fields = {};
			for (const levelKey of ROGUE_LEVEL_KEYS) {
				fields["getspell" + levelKey] = general["getspell" + levelKey] || "";
				fields["getzhanfa" + levelKey] = general["getzhanfa" + levelKey] || "";
				fields["carddesc" + levelKey] = general["carddesc" + levelKey] || "";
				fields["equip" + levelKey] = general["equip" + levelKey] || "";
			}
			return fields;
		}
		resolvePlot(plot) {
			if (plot.source == "tactic") return {
				name: plot.plotname.replaceAll("·", ""),
				desc: plot.plotdesc.replaceAll(" ", ""),
				school: plot.school,
				money: plot.money,
				level: plot.level,
				type: 2
			};
			if (plot.source == "spell") {
				const spell = SkillsConfig.GetInstance().getSpell(plot.spellid);
				return {
					name: spell?.name,
					desc: spell?.desc,
					spellid: plot.spellid,
					money: plot.money,
					level: plot.level,
					type: 3
				};
			}
			if (plot.source == "card") {
				const card = CardConfig.GetInstance().getCard(plot.cardid);
				if (!card) return void 0;
				return {
					name: CARD_SUBTYPE_NAMES[card.subType] ?? card.name,
					desc: card.desc,
					color: card.color,
					number: card.number,
					money: plot.money,
					level: plot.level,
					type: 4 + plot.isequip,
					rType: (card.type * 10 + card.subType) * 100 + plot.isequip
				};
			}
			return plot;
		}
		createGeneralInfo(general) {
			return {
				general: general.generalname,
				hp: general.hp,
				maxhp: general.maxhp,
				card: general.cardnum,
				draw: general.draw,
				sha: 1 + general.exshatimes,
				armor: general.armor,
				getarmor: general.getarmor,
				...general.next ? { next: general.next.generalname } : {}
			};
		}
		splitIds(value, separator = ";") {
			return value ? String(value).split(separator) : [];
		}
		initFights(fights) {
			for (const fight of fights || []) this.fightDict.set(String(fight.fightID), fight);
		}
		normalizeFight(fight) {
			const normalizedFight = {
				...fight,
				generals: (fight.generals ?? this.getGeneralGroup(fight.Ggroup) ?? []).map((general) => this.cloneFightGeneral(general)).filter(Boolean),
				fight: "",
				lost: ""
			};
			this.markStartGeneral(normalizedFight);
			this.linkFightGenerals(normalizedFight);
			normalizedFight.get = this.formatFightRewards(fight);
			normalizedFight.text = this.getText(fight.text);
			normalizedFight.name = this.getText(fight.name);
			return normalizedFight;
		}
		cloneFightGeneral(general, used = new Set()) {
			if (!general || used.has(general)) return void 0;
			used.add(general);
			const nextGroup = general.jumpStageId ? this.getGeneralGroup(general.jumpStageId) : void 0;
			const nextGeneral = nextGroup?.[general.jumpStageIndex - 1] ?? nextGroup?.[0];
			const clonedGeneral = { ...general };
			if (nextGeneral) clonedGeneral.next = this.cloneFightGeneral(nextGeneral, used);
			clonedGeneral.info = this.createGeneralInfo(clonedGeneral);
			return clonedGeneral;
		}
		markStartGeneral(fight) {
			if (!fight.startnum) return;
			const startGeneral = fight.generals.find((general) => general.generalID == fight.startnum);
			if (startGeneral) startGeneral.start = true;
		}
		linkFightGenerals(fight) {
			fight.generals.forEach((general, index, generals) => {
				this.linkFightGeneral(fight, general, 1, index == generals.length - 1);
			});
		}
		linkFightGeneral(fight, general, stage, isLastGeneral = false) {
			if (!general) return;
			fight.fight += this.infoStr(general.info);
			fight.lost += (general.start ? "[先手]" : "") + general.generalname;
			if (general.next) {
				fight.lost += ">";
				general.next.stage = stage;
				general.next.info.pre = general.generalname;
				fight.generals.push(general.next);
				this.linkFightGeneral(fight, general.next, stage + 1, isLastGeneral);
			} else if (!isLastGeneral) {
				fight.fight += "+";
				fight.lost += " ";
			}
		}
		formatFightRewards(fight) {
			if (!fight.itemgroup && !fight.rewarditem && !fight.reward) return "";
			return [
				...fight.itemgroup ? [`${fight.itemgroup}铜币`] : [],
				...this.splitIds(fight.rewarditem),
				...this.splitIds(fight.reward)
			].map((rewardId, index) => index === 0 && fight.itemgroup ? rewardId : this.getRewardText(rewardId)).join("\n");
		}
		initChoices(choices) {
			for (const choice of choices || []) this.adventureResultDict.set(String(choice.effectID), choice);
		}
		resolveChoice(choice) {
			if (choice.type == 7) return this.resolveFightChoice(choice);
			if (choice.type == 3 && choice.event1 == "2") return { get: "营地" };
			return {
				lost: this.formatLostItem(choice),
				get: this.formatGetItem(choice)
			};
		}
		resolveFightChoice(choice) {
			return this.getFight(choice.event1);
		}
		formatLostItem(choice) {
			const lost = this.item(choice.lostitem, choice.lostnum, choice.effectID);
			return lost ? "失去 " + lost : lost;
		}
		formatGetItem(choice) {
			const get = this.item(choice.getitem, choice.getnum, choice.effectID);
			return get && choice.showitem ? get.replace("随机", "特定") : get;
		}
		item(id, num) {
			if (!id) return "";
			if (String(id).includes(",")) return this.formatQualityReward(id);
			if (this.getReward(id)) return (num > 1 ? num : "") + this.getRewardText(id);
			const plot = this.getPlot(id);
			if (plot) return plot.name;
			if (this.getGeneralGroup(id)) return this.formatGeneralGroupReward(id);
			return (this.originData?.Card || []).find((card) => card.id == id)?.name;
		}
		formatQualityReward(id) {
			const [type, quality] = String(id).split(",");
			return REWARD_QUALITY_NAMES[quality] + CHOICE_REWARD_TYPE_NAMES[type];
		}
		formatGeneralGroupReward(groupId) {
			return this.getGeneralGroup(groupId).map((general) => general.generalname).join("\n");
		}
		infoStr({ general, hp, maxhp, card, draw, sha, next, pre }) {
			return (pre ? ">" : "") + general + hp + (maxhp !== hp ? "/" + maxhp : "") + "血" + card + "牌摸" + draw + "杀" + sha + (next ? ">" : "");
		}
		decodeAbbreviatedObject(obj) {
			if (typeof obj !== "object") return obj;
			const decoded = {};
			for (const [shortKey, value] of Object.entries(obj)) {
				const longKey = this.shortToLongObj[shortKey] || shortKey;
				decoded[longKey] = value;
			}
			return decoded;
		}
	};
	var SpellExtendConfig = class SpellExtendConfig extends ConfigBase {
		PeiXiuBonus = new Map();
		PeiXiuCellDic = new Map();
		PeiXiuPresetRoutes = new Map([
			[1, [[
				4,
				2,
				3,
				2,
				3
			]]],
			[2, [
				[
					3,
					2,
					1,
					2
				],
				[
					2,
					1,
					3,
					2,
					1
				],
				[
					4,
					1,
					2,
					3,
					2
				]
			]],
			[3, [[
				3,
				1,
				2,
				4,
				3,
				2
			], [
				3,
				3,
				2,
				1,
				4,
				2
			]]],
			[4, [[
				1,
				3,
				2,
				4,
				1
			], [
				3,
				2,
				4,
				1,
				1
			]]],
			[5, [[
				3,
				1,
				2,
				4,
				3
			]]],
			[6, [[
				1,
				3,
				2,
				4,
				2
			]]],
			[7, [
				[
					4,
					3,
					1,
					1,
					3,
					2
				],
				[
					3,
					2,
					4,
					3,
					1,
					1
				],
				[
					1,
					3,
					2,
					4,
					3,
					1
				]
			]],
			[8, [[
				1,
				4,
				3,
				2,
				1
			], [
				2,
				1,
				4,
				1,
				3
			]]],
			[9, [
				[
					1,
					3,
					4,
					1,
					4,
					1
				],
				[
					3,
					4,
					2,
					1,
					4,
					1
				],
				[
					4,
					1,
					3,
					2,
					1,
					4,
					3,
					4
				]
			]],
			[10, [[
				1,
				4,
				3,
				4,
				1,
				2
			], [
				4,
				1,
				2,
				1,
				4,
				3
			]]],
			[11, [[
				1,
				2,
				3,
				2,
				3
			]]],
			[12, [[
				3,
				2,
				3,
				1,
				4,
				2
			]]],
			[13, [[
				3,
				2,
				3,
				2,
				4,
				3,
				4
			]]],
			[14, [[
				2,
				1,
				4,
				3
			]]],
			[15, [[
				2,
				1,
				2,
				1,
				3,
				1,
				4
			], [
				2,
				1,
				2,
				1,
				1,
				4,
				2,
				3
			]]],
			[16, [[
				4,
				3,
				2,
				4,
				1
			]]]
		]);
		constructor() {
			super("SpellExtend_json");
			this.FileName = "cha_spellextend";
		}
		static GetInstance() {
			if (this.instance == null) this.instance = new SpellExtendConfig();
			return this.instance;
		}
		parse(data) {
			if (!data) return;
			this.originData = data;
			this.PeiXiuBonus.clear();
			this.PeiXiuCellDic.clear();
			this.PingJianDic.clear();
			this.initPeiXiuBonus();
			this.initPeiXiuCellData();
			this.initPingJianData();
		}
		initPeiXiuBonus() {
			const rewards = this.originData?.PXreward;
			if (!rewards?.length) return;
			for (const reward of rewards) this.PeiXiuBonus.set(Number(reward.ID), reward);
		}
		initPeiXiuCellData() {
			const cells = this.originData?.PXcell;
			if (!cells?.length) return;
			for (const cell of cells) this.PeiXiuCellDic.set(Number(cell.cellID), cell);
		}
		PingJianDic = new Map();
		initPingJianData() {
			const XSPJ = this.originData?.XSPJ;
			if (!XSPJ) return;
			for (const pj of XSPJ) this.PingJianDic.set(Number(pj.id), pj);
		}
	};
	var retainedLogicMessages = new Set([
		"ClientLoginRep",
		"ClientUserDataCounterNtf",
		"SmsgUpdateTaskListToClient",
		"ClientGuildMemberChangeNtf",
		"MsgReconnectGame",
		"MsgHeartAliveRep",
		"decodeGameRecordInitInfo",
		"ClientBindKeyRep",
		"decodeSyncGameDataEvent",
		"ClientUserbaseinfoRep",
		"ClientUserdetailRep",
		"decodeSSCChatmsgNtf",
		"decodeClientActSysBroadMsgListResp",
		"CClientGameRewardPointNTF",
		"ClientGeneralSkinRep",
		"ClientChestOpenReplaceInfoNtf",
		"decodeServerGeneralWishPoolDataResp",
		"decodeServerDrawGeneralWishResp",
		"decodeServerSkinWishPoolDataResp",
		"decodeRogueLikeDataSync",
		"ClientActivitysetDataRep",
		"decodeRougeBaseInfoRep",
		"ClientTableinfoRep",
		"MsgGameShowFigure",
		"decodeGsClientUserSeatFlagNtf",
		"GsCModifyUserseatNtf",
		"GsCUpdateRoleDataNtf",
		"MsgGameOver",
		"ClientLeavetableRep",
		"MsgGamePlayCardNtf",
		"SmsgGameSetCharacter",
		"GsCGuoZhanSetCharacter",
		"GsCFirstPhaseRole",
		"MsgGameTurnNtf",
		"GsCGamephaseNtf",
		"GsCUpdateRoleDataExNtf",
		"MsgGameRoundNtf",
		"ClientRecommendShopItemRep",
		"ClientModifyTblsetingNtf",
		"MsgGamePlayerShowStatusNtf",
		"GsCUpdateHpNtf",
		"GsCTriggerSpellNew",
		"ClientHappyGetFriendHandcardRep",
		"MsgNtfUseCardType",
		"PubGsCUseCard",
		"PubGsCUseSpell",
		"GsCRoleOptTargetNtf",
		"CGsRoleSpellOptRep",
		"PubGsCMoveCard",
		"decodeGameDealPileTopCardList"
	]);
	function isRetainedLogicMessage(className) {
		return retainedLogicMessages.has(className);
	}
	var POWER_SLOGAN_TEXTS = new Set([
		"中原人杰地灵，天下归心！",
		"一统中原，天下归心！",
		"赴此雄途，一统山河！",
		"对酒当歌，人生几何！",
		"周公吐哺，天下归心。",
		"雄踞北方，睥睨天下！",
		"兵锋四向，所向披靡！",
		"势贯长虹，锐不可当！",
		"魏武挥鞭，龙骧虎战！",
		"魏风烈烈，霸业千秋！",
		"枕山河之固，展霸业鸿图！",
		"执戟兴邦，志在八方！",
		"魏骑驰骋，踏破山河！",
		"枕山河之固，扬魏武雄风！",
		"魏德昭彰，恩威并施！",
		"志在魏邦，雄图万里！",
		"战合肥，破成都，胜者为王！",
		"外驱胡虏，内平吴蜀！",
		"魏武藏奇略，霸业定乾坤！",
		"诸公半虎狼，魏旗不留藏!",
		"长驱蹈匈奴，左顾凌鲜卑！",
		"扇挥白羽迥，甲锁黄金明！",
		"魏光璀璨耀星河",
		"魏恩广布润人心",
		"护魏山河，霸业千秋！",
		"舳舻千里，旌旗蔽空",
		"受禅汉庭，魏起征程！",
		"奇谋鬼才，算无遗策！",
		"魏威如岳，气吞山河！",
		"大魏雄师，势不可挡！",
		"匡扶汉室，入主中原",
		"忠义为先，蜀汉必兴！",
		"鞠躬尽瘁，死而后已！",
		"惟贤惟德，方能匡复汉室！",
		"能进能退，方能百战不殆！",
		"蜀风烈烈，其志昭昭！",
		"天地英雄气，千秋尚凛然",
		"蜀道崎岖，壮志不屈！",
		"蜀锦为裳，剑指北方！",
		"血染征袍，荡涤乱世！",
		"汉业兴亡惟我在！",
		"蜀汉精忠，义贯长虹！",
		"壮志盈怀，忠义为先！",
		"蜀汉英魂，壮志凌云！",
		"蜀汉兴邦，志在四方",
		"犯我大吴疆土，虽远必诛",
		"上有天堂，下有苏杭！",
		"羽扇纶巾，计定天下！",
		"何人敢犯大吴疆土",
		"赴汤蹈火，在所不辞！",
		"犯大吴疆土者，吾必击而破之！",
		"江东子弟，何惧于天下！",
		"天下英雄谁敌手？",
		"英雄何不带吴钩！",
		"东吴水师，横行江海！",
		"吴钩似霜，斩破千障！",
		"吴营谋深，弹指乾坤！",
		"天险固垒，欲攻则锐！",
		"智谋如渊，踏浪焚天！",
		"江东子弟多才俊，谁怕！"
	]);
	var HALL_CHAT_REPEAT_WINDOW = 15 * 1e3;
	var hallChatRepeatMap = new Map();
	var BLOCKED_CHAT_CONTENT_PATTERN = /((?:桃|烧)[bB8]|桃花|鲜花|菜篮子|0\.5(?:一|个)|女大(?:学生|妹妹)?|可[约玥]|福利|交友|进[群裙]|加[群裙]|群聊|裙聊|私聊|绿泡泡|[加嘉家].{0,2}[vV微薇].{0,2}[心芯新]|开放啪|代练|代打|陪玩|接单|带打|包上分|上分|(?:出|卖|收|回收).{0,3}号|成品号|收[^徒]*$|[帮代带].*[玩练打]|出.{0,3}的|[加家+＋十].{0,3}我)/;
	function normalizeHallChatMsg(text) {
		if (typeof text != "string" || !text) return "";
		return text.normalize("NFKC").toLowerCase().replace(/#[0-9]+/g, "").replace(/[0-9]+/g, "").replace(/[ \t\r\n\u00a0❤♥♡❥ⅤⅴvVⅠⅰiI丨|]/g, "").replace(/[.,，。!！?？:：;；'"“”‘’_\-+＋=~～*＊/\\()[\]（）【】<>《》]/g, "");
	}
	function isPurePlaceholderChatMsg(text) {
		if (typeof text != "string" || !text) return false;
		const cleaned = text.replace(/\s/g, "");
		if (!cleaned) return false;
		return /^[:：=＝\-—_·.。•＊*#■□▢▣▤▥▦▧▨▩▪▫◆◇◈◼◻◾◽█▌▐▓▒░]+$/.test(cleaned);
	}
	function shouldBlockHallChat({ ProtoObj, chatMsg, channel, hallChatRepeatBlocked }) {
		if (ProtoObj.Channel == 2 && chatMsg && POWER_SLOGAN_TEXTS.has(chatMsg)) return true;
		if (ProtoObj.chatMsg?.startsWith("oldback@") || ProtoObj.MsgType == 26 || ProtoObj.MsgKind == 2) return true;
		if (channel == 7 && (ProtoObj.officeLevel == null || ProtoObj.officeLevel <= 6 || isPurePlaceholderChatMsg(chatMsg)) || hallChatRepeatBlocked) return true;
		return BLOCKED_CHAT_CONTENT_PATTERN.test(ProtoObj.chatMsg || "");
	}
	function updateHallChatRepeatState(chatMsg, channel) {
		if (channel != 7 || !chatMsg) return false;
		const key = normalizeHallChatMsg(chatMsg);
		if (!key) return false;
		const now = Date.now();
		const prev = hallChatRepeatMap.get(key);
		let blocked = false;
		if (prev && now - prev.time <= HALL_CHAT_REPEAT_WINDOW) {
			prev.time = now;
			prev.count += 1;
			blocked = prev.count >= 3;
		} else hallChatRepeatMap.set(key, {
			time: now,
			count: 1
		});
		if (hallChatRepeatMap.size > 200) {
			for (const [name, item] of hallChatRepeatMap) if (now - item.time > HALL_CHAT_REPEAT_WINDOW) hallChatRepeatMap.delete(name);
		}
		return blocked;
	}
	function handleChatMessage(msg, ProtoObj) {
		if (!ProtoObj) return;
		if (ProtoObj.scene == 11) ProtoObj.scene = 2;
		const chatMsg = ProtoObj.chatMsg || ProtoObj.ChatMsg || "";
		const channel = ProtoObj.Channel || ProtoObj.channel;
		if (shouldBlockHallChat({
			ProtoObj,
			chatMsg,
			channel,
			hallChatRepeatBlocked: updateHallChatRepeatState(chatMsg, channel)
		})) {
			delete msg.data.protoObj;
			return;
		}
	}
	function handleBroadMsg(ProtoObj) {
		if (!ProtoObj) return;
		if (Array.isArray(ProtoObj.msgList)) ProtoObj.msgList.length = 0;
	}
	var ACTIVE_CONFIG_ENTRIES = [
		[
			"padding",
			"PADDING",
			0
		],
		[
			"seatUISwitch",
			"SEAT_UI_SWITCH",
			true
		],
		[
			"rogueCitySwitch",
			"ROGUE_CITY_SWITCH",
			true
		],
		[
			"cardLabelSwitch",
			"CARD_LABEL_SWITCH",
			false
		],
		[
			"showNameSwitch",
			"SHOW_NAME_SWITCH",
			false
		],
		[
			"debugLogSwitch",
			"DEBUG_LOG_SWITCH",
			false
		],
		[
			"peiXiuMapSwitch",
			"PEIXIU_MAP_SWITCH",
			false
		],
		[
			"effectBlockSwitch",
			"EFFECT_BLOCK_SWITCH",
			false
		],
		[
			"blockKillEffectSwitch",
			"BLOCK_KILL_EFFECT_SWITCH",
			false
		],
		[
			"blockSkinStateSwitch",
			"BLOCK_SKIN_STATE_SWITCH",
			false
		],
		[
			"skipAdWindowSwitch",
			"SKIP_AD_WINDOW_SWITCH",
			true
		],
		[
			"skipPackageWindowSwitch",
			"SKIP_PACKAGE_WINDOW_SWITCH",
			false
		],
		[
			"blockMvpSettlementSwitch",
			"BLOCK_MVP_SETTLEMENT_SWITCH",
			false
		]
	];
	function createMemoryStorageAdapter(seed = {}) {
		const data = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
		return {
			getItem(key) {
				return data.has(key) ? data.get(key) : null;
			},
			setItem(key, value) {
				data.set(key, value);
			},
			removeItem(key) {
				data.delete(key);
			}
		};
	}
	function readStoredValue(storage, id, defaultValue) {
		let rawValue;
		try {
			rawValue = storage.getItem(id);
		} catch {
			return defaultValue;
		}
		if (rawValue == null) {
			writeStoredValue(storage, id, defaultValue);
			return defaultValue;
		}
		try {
			return JSON.parse(rawValue);
		} catch {
			writeStoredValue(storage, id, defaultValue);
			return defaultValue;
		}
	}
	function writeStoredValue(storage, id, value) {
		try {
			storage.setItem(id, JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	}
	function createConfigStore({ entries = ACTIVE_CONFIG_ENTRIES, storage = null, eventTarget = null, effects = {} } = {}) {
		const resolvedStorage = storage ?? createMemoryStorageAdapter();
		const configMetaMap = new Map(entries.map(([key, id, defaultValue]) => [key, {
			id,
			defaultValue
		}]));
		const initialData = Object.fromEntries(Array.from(configMetaMap.entries()).map(([key, { id, defaultValue }]) => [key, readStoredValue(resolvedStorage, id, defaultValue)]));
		return new Proxy(initialData, {
			get(target, property) {
				if (typeof property !== "string") return target[property];
				const meta = configMetaMap.get(property);
				if (!meta) return target[property];
				const latestValue = readStoredValue(resolvedStorage, meta.id, target[property]);
				target[property] = latestValue;
				return latestValue;
			},
			set(target, property, value) {
				if (typeof property !== "string") return false;
				const meta = configMetaMap.get(property);
				if (!meta) return false;
				const oldValue = target[property];
				if (oldValue === value) return true;
				if (!writeStoredValue(resolvedStorage, meta.id, value)) return false;
				target[property] = value;
				effects[property]?.(value);
				if (eventTarget && typeof CustomEvent !== "undefined") eventTarget.dispatchEvent(new CustomEvent("xc:config-change", { detail: {
					property,
					value,
					oldValue
				} }));
				return true;
			}
		});
	}
	function getBrowserStorage() {
		try {
			return typeof localStorage === "undefined" ? null : localStorage;
		} catch {
			return null;
		}
	}
	function getBrowserEventTarget() {
		return typeof window === "undefined" ? null : window;
	}
	var globalConfig = createConfigStore({
		storage: getBrowserStorage(),
		eventTarget: getBrowserEventTarget(),
		effects: { padding: (value) => {
			if (typeof window !== "undefined") window.padding = value;
		} }
	});
	var globalState = {
		isFrameAdd: false,
		inviteName: "",
		goods: [],
		lotteries: [],
		closeIframe: false,
		recGoods: {}
	};
	var rogueMap = {
		difficulty: 0,
		itemId: [],
		res: [],
		general: 0
	};
	var UI = {
		seatWidthPercent: .3,
		firstUpdateSeatUI: false,
		scoreFrameTotal: 10,
		scoreFrameIndex: 0,
		paddingLeft: 10,
		paddingRight: 15,
		paddingTop: 30,
		paddingBottom: 0,
		paddingLeftTopExtra: 0,
		selectStarted: false,
		leftRightTop: 20,
		stackCardAreaHeight: 0,
		stackCardAreaY: 0,
		MAX_SEAT_WIDTH: 149,
		inPopFirstTarget: false,
		unscaledWidth: 146,
		unscaledHeight: 172,
		MAX_HEIGHT: 180,
		MAX_WIDTH: 150,
		scale: 1,
		selfSeatUiUnscaledHeight: 178,
		rightBarWidth: 221,
		nativeSeatRects: [],
		gameRoundRect: null,
		seatUIs: [],
		cities: [],
		friendGeneral: 0,
		ORDER_LABELS: [
			"",
			"一",
			"二",
			"三",
			"四",
			"五",
			"六",
			"七",
			"八"
		]
	};
	var DEFAULT_USER_DATA = {
		userID: 0,
		nickname: ""
	};
	function createUserModel(initialData = {}) {
		return {
			...DEFAULT_USER_DATA,
			...initialData
		};
	}
	var user = createUserModel();
	function readDebugLogSwitch() {
		let rawValue;
		try {
			if (typeof localStorage === "undefined") return false;
			rawValue = localStorage.getItem("DEBUG_LOG_SWITCH");
		} catch {
			return false;
		}
		if (rawValue === null) return false;
		try {
			return Boolean(JSON.parse(rawValue));
		} catch {
			return false;
		}
	}
	function isLoggerEnabled() {
		return Boolean(readDebugLogSwitch());
	}
	function createLogger(scope) {
		const prefix = `[DXC][${scope}]`;
		const print = (method, args) => {
			if (!isLoggerEnabled()) return;
			(console[method] || console.info).call(console, prefix, ...args);
		};
		return {
			get enabled() {
				return isLoggerEnabled();
			},
			debug(...args) {
				print("debug", args);
			},
			info(...args) {
				print("info", args);
			},
			warn(...args) {
				print("warn", args);
			},
			error(...args) {
				print("error", args);
			},
			group(label, ...args) {
				if (!isLoggerEnabled()) return;
				(console.groupCollapsed || console.group || console.info).call(console, `${prefix} ${label}`, ...args);
			},
			groupEnd() {
				if (!isLoggerEnabled()) return;
				console.groupEnd?.();
			}
		};
	}
	var trackerLogger = createLogger("tracker");
	var ORDER_LABELS = [
		"",
		"一",
		"二",
		"三",
		"四",
		"五",
		"六",
		"七",
		"八"
	];
	function getDisplayIdLabel(displayID, orderLabels = ORDER_LABELS) {
		return orderLabels[displayID] || String(displayID);
	}
	function formatPlayerSeatLabel(player, options = {}) {
		const orderLabel = `${getDisplayIdLabel(player.fixedViewId || 1, options.orderLabels)}号位`;
		const getGeneralName = options.getGeneralName ?? getConfiguredGeneralName;
		const generalNames = player.generals.map((generalID) => getGeneralName(generalID)).filter((name) => Boolean(name));
		return `${generalNames.length > 0 ? generalNames.join(" ") : orderLabel}|${orderLabel}`;
	}
	function getConfiguredGeneralName(generalID) {
		return CharacterConfig.GetInstance().getGeneralName(generalID);
	}
	var GameState = class {
		isRecord = false;
		isGameStart = false;
		isPassed = true;
		currentGameKey = null;
		recordMatchName = null;
		stateStore = new Map();
		needShowName = false;
		myGenerals = [];
		camps = [];
		zhanfaSet = new Set();
		generalChangeListener = null;
		constructor({ orderLabels = ORDER_LABELS } = {}) {
			this.orderLabels = orderLabels;
			this.room = null;
			this.reset();
		}
		resetSessionState() {
			this.turn = 0;
			this.round = 0;
			this.phase = 0;
			this.currentID = void 0;
			this.isRecord = false;
			this.isGameStart = false;
			this.isPassed = true;
			this.clearStateStore();
			this.resetConfigHandCards();
		}
		bindRoom(room) {
			const nextRoom = room ?? null;
			if (nextRoom !== this.room) this.clearStateStore();
			this.room = nextRoom;
			if (!nextRoom) {
				this.resetRoomState();
				return;
			}
			this.syncRoomSeats(nextRoom);
		}
		get myID() {
			return this.room?.mySeatID ?? void 0;
		}
		get myDisplayID() {
			return this.room?.getMyDisplayID();
		}
		getCurrentTimestamp() {
			return {
				turn: this.turn ?? 0,
				round: this.round ?? 0,
				phase: this.phase ?? 0
			};
		}
		resetRoomState() {
			this.seatIDs = [];
			this.orderIDs = [];
			this.myGenerals.length = 0;
			this.size = void 0;
			this.isDuanXian = false;
			this.zhanfaSet.clear();
		}
		resetGameInfo() {
			this.currentGameKey = null;
			this.recordMatchName = null;
			this.resetModeState();
		}
		resetModeState() {
			this.isShanHeTu = false;
			this.isGuoZhan = false;
			this.isDouDiZhu = false;
			this.isRoguelike1v1 = false;
			this.isSWJG = false;
			this.needShowName = false;
		}
		setGeneral(seatID, generalID, index = 0, _an = false) {
			if (generalID === void 0) return;
			const player = this.room?.getPlayer(seatID);
			if (!player) return;
			if (player.generals.length === 0) player.generals = Array(this.isGuoZhan ? 2 : 1).fill(0);
			player.generals[index] = generalID;
			if (seatID === this.myID) this.myGenerals[index] = generalID;
			this.generalChangeListener?.(player, this.orderLabels);
		}
		setGeneralChangeListener(listener) {
			this.generalChangeListener = listener;
		}
		hasState(scope, stateKey) {
			return this.stateStore.has(this.getStateStoreKey(scope, stateKey));
		}
		readState(scope, stateKey) {
			return this.stateStore.get(this.getStateStoreKey(scope, stateKey));
		}
		ensureState(scope, stateKey, createState) {
			const storeKey = this.getStateStoreKey(scope, stateKey);
			if (this.stateStore.has(storeKey)) return this.stateStore.get(storeKey);
			const state = createState();
			this.stateStore.set(storeKey, state);
			return state;
		}
		setState(scope, stateKey, state) {
			this.stateStore.set(this.getStateStoreKey(scope, stateKey), state);
		}
		deleteState(scope, stateKey) {
			this.stateStore.delete(this.getStateStoreKey(scope, stateKey));
		}
		getSpellState(spellID) {
			return this.readState("spell", spellID);
		}
		setSpellState(spellID, value) {
			this.setState("spell", spellID, value);
		}
		ensureSpellState(spellID, createState) {
			return this.ensureState("spell", spellID, createState);
		}
		deleteSpellState(spellID) {
			this.deleteState("spell", spellID);
		}
		getSpellStateSnapshot() {
			const spellPrefix = "spell:";
			const snapshot = {};
			for (const [key, value] of this.stateStore) if (key.startsWith(spellPrefix)) snapshot[key.slice(6)] = structuredClone(value);
			return snapshot;
		}
		syncRoomSeats(room = this.room) {
			if (!room) return;
			this.seatIDs = room.seatIDs.slice();
			this.size = room.size;
		}
		resetConfigHandCards() {
			this.configHandCards = [];
			this.configHandCardsMode = "all";
			this.configHandCardsRejected = false;
		}
		updateRecordInfo({ gameId, matchName }) {
			const gameKey = gameId ? `${gameId.high >>> 0}:${gameId.low >>> 0}` : null;
			if (gameKey && gameKey !== this.currentGameKey) {
				this.resetGameInfo();
				this.currentGameKey = gameKey;
			}
			if (!matchName || matchName === this.recordMatchName) return;
			this.recordMatchName = matchName;
			this.applyRecordMode();
		}
		applyRecordMode() {
			const matchName = this.recordMatchName;
			if (!matchName) return;
			this.isDouDiZhu = matchName === "斗地主";
			this.isRoguelike1v1 = matchName === "单骑无双";
			this.needShowName = this.isDouDiZhu || this.isRoguelike1v1 || matchName === "新欢乐排位" || matchName.includes("cmk");
			this.isShanHeTu = !this.needShowName && (/\[\d+\]$/.test(matchName) || matchName.includes("山河图"));
		}
		init() {
			this.resetGameInfo();
			this.beginPlayback();
		}
		beginPlayback() {
			this.resetSessionState();
			this.resetRoomState();
			this.resetModeState();
			this.applyRecordMode();
			this.isGameStart = true;
			this.isPassed = false;
			trackerLogger.info("GameState 游戏已重置并开始");
			UI.seatUIs = [];
			UI.friendGeneral = 0;
		}
		end() {
			this.clearStateStore();
			this.resetGameInfo();
			if (this.isGameStart && !this.isPassed) {
				this.isRecord = false;
				this.isGameStart = false;
				this.isPassed = true;
				this.resetRoomState();
				trackerLogger.info("GameState 游戏已结束");
			}
		}
		start() {
			const seatIDs = this.room?.seatIDs ?? [];
			const mySeatID = this.room?.mySeatID ?? void 0;
			trackerLogger.info("GameState 游戏开始", {
				seatIDs,
				mySeatID
			});
			if (this.isGameStart) return;
			this.isGameStart = true;
			this.isPassed = false;
		}
		enter(round, seat) {
			if (round === 0) {
				if (!this.turn) this.start();
				if (this.currentID === this.myID) {
					this.setSpellState("手到擒来", 0);
					this.setSpellState("多多益善", 0);
				}
				this.currentID = seat;
				this.round++;
				this.phase = 0;
				this.deleteSpellState(2143);
			} else this.phase++;
		}
		setTurn(turn) {
			this.turn = turn;
			this.round = 0;
			this.deleteSpellState(3090);
		}
		shaCounter() {
			const count = Number(this.getSpellState("三板斧")) || 0;
			this.setSpellState("三板斧", count + 1);
		}
		useCounter() {
			const count = Number(this.getSpellState("手到擒来")) || 0;
			this.setSpellState("手到擒来", count + 1);
		}
		drawCounter(count) {
			const drawCount = Number(this.getSpellState("神龙摆尾")) || 0;
			const drawTimes = Number(this.getSpellState("多多益善")) || 0;
			this.setSpellState("神龙摆尾", drawCount + count);
			this.setSpellState("多多益善", drawTimes + 1);
		}
		reset() {
			this.resetSessionState();
			this.resetRoomState();
			this.resetGameInfo();
		}
		getStateStoreKey(scope, stateKey) {
			const numericKey = Number(stateKey);
			return `${scope}:${Number.isNaN(numericKey) ? String(stateKey) : String(numericKey)}`;
		}
		clearStateStore() {
			this.stateStore.clear();
		}
	};
	var Game = new GameState({ orderLabels: UI.ORDER_LABELS });
	var POSITION_TOP = 65280;
	var POSITION_RANDOM = 65282;
	function getProtocolInsertionIndex(position, cardCount) {
		if (typeof position !== "number" && typeof position !== "string" || typeof position === "string" && position.trim() === "") return null;
		const normalizedCardCount = Math.max(0, Math.floor(Number(cardCount) || 0));
		const normalizedPosition = typeof position === "string" ? position.trim().toLowerCase() : position;
		if (normalizedPosition === 65280 || normalizedPosition === "top") return normalizedCardCount;
		if (normalizedPosition === 0 || normalizedPosition === "bottom") return 0;
		if (normalizedPosition === 65282 || normalizedPosition === "random" || normalizedPosition === "any") return null;
		const insertionIndex = Number(position);
		if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > normalizedCardCount) return null;
		return insertionIndex;
	}
	function insertCardsAtProtocolPosition(orderedCards, cards, position) {
		const normalizedPosition = typeof position === "string" ? position.trim().toLowerCase() : position;
		if (normalizedPosition === 65280 || normalizedPosition === "top") {
			orderedCards.push(...cards);
			return true;
		}
		const insertionIndex = getProtocolInsertionIndex(position, orderedCards.length);
		if (insertionIndex === null) return false;
		orderedCards.splice(insertionIndex, 0, ...[...cards].reverse());
		return true;
	}
	function normalizeCandidateSpellID(spellID) {
		if (spellID === null || spellID === void 0 || spellID === "") return null;
		const value = Number(spellID);
		return Number.isNaN(value) ? null : value;
	}
	function normalizeSubZoneCandidate(candidate = {}) {
		const seatID = Number(candidate.seatID);
		const subZone = candidate.subZone ?? "hand";
		if (Number.isNaN(seatID) || !subZone) return null;
		return {
			seatID,
			subZone,
			spellID: normalizeCandidateSpellID(candidate.spellID)
		};
	}
	function createSubZoneCandidateKey(candidate = {}) {
		const normalized = normalizeSubZoneCandidate(candidate);
		if (!normalized) return "";
		return [
			normalized.seatID,
			normalized.subZone,
			normalized.spellID === null ? "" : normalized.spellID
		].join(":");
	}
	function getSubZoneName(subZone) {
		if (subZone === "equip") return "装备";
		if (subZone === "judge") return "判定区";
		if (subZone === "mark") return "标记";
		return "手牌";
	}
	function isPlayerLocationCandidate(candidate) {
		return candidate?.type === "player";
	}
	function isPublicLocationCandidate(candidate) {
		return candidate?.type === "public";
	}
	function isContainerLocationCandidate(candidate) {
		return candidate?.type === "container";
	}
	function normalizeLocationCandidate(candidate = {}) {
		if (!candidate) return null;
		const type = candidate.type ?? (candidate.seatID !== void 0 ? "player" : "public");
		if (type === "popup") {
			const spaceID = normalizeCandidateSpellID(candidate.spaceID);
			return spaceID === null ? null : {
				type,
				spaceID
			};
		}
		if (type === "player") {
			const normalized = normalizeSubZoneCandidate(candidate);
			if (!normalized) return null;
			return {
				type: "player",
				seatID: normalized.seatID,
				subZone: normalized.subZone,
				spellID: normalized.spellID
			};
		}
		if (type === "public") {
			const zone = candidate.zone === null || candidate.zone === void 0 ? "" : String(candidate.zone);
			if (!zone) return null;
			const count = Number(candidate.count);
			return {
				type: "public",
				zone,
				position: candidate.position ?? "any",
				count: Number.isFinite(count) && count > 0 ? count : null,
				label: candidate.label ?? null
			};
		}
		if (type === "container") {
			const cardID = Number(candidate.cardID ?? candidate.containerCardID);
			const containerType = candidate.containerType ?? "equipment";
			if (!Number.isFinite(cardID) || cardID <= 0 || !containerType) return null;
			return {
				type: "container",
				containerType,
				cardID,
				spellID: normalizeCandidateSpellID(candidate.spellID)
			};
		}
		if (type === "outside") {
			const zone = candidate.zone ?? "outside";
			const batchID = candidate.batchID == null ? "" : String(candidate.batchID);
			if (batchID && zone !== "exchange") return null;
			return batchID ? {
				type: "outside",
				zone,
				batchID
			} : {
				type: "outside",
				zone
			};
		}
		return null;
	}
	function createLocationCandidateKey(candidate = {}) {
		const normalized = normalizeLocationCandidate(candidate);
		if (!normalized) return "";
		if (normalized.type === "popup") return `popup:${normalized.spaceID}`;
		if (normalized.type === "player") return [
			"player",
			normalized.seatID,
			normalized.subZone,
			normalized.spellID === null ? "none" : normalized.spellID
		].join(":");
		if (normalized.type === "public") return [
			"public",
			normalized.zone,
			normalized.position ?? "any",
			normalized.count === null ? "any" : normalized.count
		].join(":");
		if (normalized.type === "container") return [
			"container",
			normalized.containerType,
			normalized.cardID,
			normalized.spellID === null ? "none" : normalized.spellID
		].join(":");
		if (normalized.type === "outside") {
			const baseKey = ["outside", normalized.zone ?? "outside"];
			if (normalized.batchID) baseKey.push(normalized.batchID);
			return baseKey.join(":");
		}
		return "";
	}
	function parseLocationCandidateKey(key) {
		const parts = String(key).split(":");
		const type = parts[0];
		if (type === "popup") return normalizeLocationCandidate({
			type,
			spaceID: Number(parts[1])
		});
		if (type === "player") return normalizeLocationCandidate({
			type,
			seatID: Number(parts[1]),
			subZone: parts[2],
			spellID: parts[3] === "none" ? null : Number(parts[3])
		});
		if (type === "public") return normalizeLocationCandidate({
			type,
			zone: parts[1],
			position: parts[2] === "any" ? null : parts[2],
			count: parts[3] === "any" ? null : Number(parts[3])
		});
		if (type === "container") return normalizeLocationCandidate({
			type,
			containerType: parts[1],
			cardID: Number(parts[2]),
			spellID: parts[3] === "none" ? null : Number(parts[3])
		});
		if (type === "outside") return normalizeLocationCandidate({
			type,
			zone: parts[1],
			batchID: parts.length > 2 ? parts.slice(2).join(":") : null
		});
		return null;
	}
	function projectSeatsFromLocationCandidates(candidates = []) {
		const seats = new Set();
		candidates.forEach((candidate) => {
			if (candidate.type === "player") seats.add(candidate.seatID);
		});
		return seats;
	}
	function getPlayerLocationCandidates(candidates = []) {
		return candidates.filter(isPlayerLocationCandidate);
	}
	function getPublicLocationCandidates(candidates = []) {
		return candidates.filter(isPublicLocationCandidate);
	}
	function getContainerLocationCandidates(candidates = []) {
		return candidates.filter(isContainerLocationCandidate);
	}
	function fromSubZoneCandidate(candidate = {}) {
		return normalizeLocationCandidate({
			...candidate,
			type: "player"
		});
	}
	function toSubZoneCandidate(candidate = {}) {
		const normalized = normalizeLocationCandidate(candidate);
		if (normalized?.type !== "player") return null;
		return {
			seatID: normalized.seatID,
			subZone: normalized.subZone,
			spellID: normalizeCandidateSpellID(normalized.spellID)
		};
	}
	function fromPublicCandidate(candidate = {}) {
		return normalizeLocationCandidate({
			...candidate,
			type: "public"
		});
	}
	function toPublicCandidate(candidate = {}, getLabel = null) {
		const normalized = normalizeLocationCandidate(candidate);
		if (normalized?.type !== "public") return null;
		const label = normalized.label ?? (typeof getLabel === "function" ? getLabel(normalized.zone, normalized.position, normalized.count) ?? null : null);
		return {
			zone: normalized.zone,
			position: normalized.position,
			count: normalized.count,
			label
		};
	}
	function normalizePublicPosition(position) {
		if (position === 0 || position === "bottom") return "bottom";
		if (position === 65280 || position === "top") return "top";
		return "random";
	}
	function getPublicCandidateLabel(zone, position, count) {
		const zoneName = zone === "pile" ? "牌堆" : zone;
		const normalizedPosition = normalizePublicPosition(position);
		const countText = count ?? "未知";
		if (normalizedPosition === "top") return `${zoneName}顶前${countText}张`;
		if (normalizedPosition === "bottom") return `${zoneName}底${countText}张`;
		return `${zoneName}随机${countText}张`;
	}
	function createPublicCandidate(zone, position, count) {
		const normalizedPosition = normalizePublicPosition(position);
		return {
			zone,
			position: normalizedPosition,
			count,
			label: getPublicCandidateLabel(zone, normalizedPosition, count)
		};
	}
	function summarizeMoveEvent(event, options = {}) {
		const eventOptions = event.options;
		const moveType = event.moveType ?? eventOptions.moveType;
		const label = eventOptions.sourceEvent?.label;
		return {
			type: event.type,
			cardIDs: options.normalizeCardIDs ? [...event.cardIDs] : event.cardIDs,
			...moveType !== void 0 ? { moveType } : {},
			...label ? { label } : {},
			toZone: event.toZone,
			...options.includeEventCardCount ? { cardCount: event.cardCount } : {},
			options: {
				fromPopupSpaceID: eventOptions.fromPopupSpaceID,
				toPopupSpaceID: eventOptions.toPopupSpaceID,
				toSeatID: eventOptions.toSeatID,
				subZone: eventOptions.subZone,
				spellID: eventOptions.spellID,
				gainSpellID: eventOptions.gainSpellID ?? eventOptions.sourceEvent?.spellID,
				combinationID: eventOptions.combinationID,
				fromZone: eventOptions.fromZone,
				fromSeatID: eventOptions.fromSeatID,
				fromSubZone: eventOptions.fromSubZone,
				fromSpellID: eventOptions.fromSpellID,
				cardCount: eventOptions.cardCount,
				moveType: eventOptions.moveType,
				position: eventOptions.position,
				fromPosition: eventOptions.fromPosition,
				...options.includeSourceCards ? { sourceCards: eventOptions.sourceCards?.map((card) => card.id) } : {}
			}
		};
	}
	function summarizeMoveContext(context, options = {}) {
		return {
			fromPopupSpaceID: context.fromPopupSpaceID,
			toPopupSpaceID: context.toPopupSpaceID,
			cardIDs: context.cardIDs,
			toZone: context.toZone,
			toSeatID: context.toSeatID,
			subZone: context.subZone,
			spellID: context.spellID,
			gainSpellID: context.gainSpellID,
			combinationID: context.combinationID,
			fromZone: context.fromZone,
			fromSeat: context.fromSeat,
			fromSubZone: context.fromSubZone,
			fromSpellID: context.fromSpellID,
			cardCount: context.cardCount,
			position: context.position,
			fromPosition: context.fromPosition,
			targetSeats: context.targetSeats,
			handMoveCount: context.handMoveCount,
			sourceHandSeat: context.sourceHandSeat,
			targetHandSeat: context.targetHandSeat,
			knownIDs: context.knownIDs,
			...options.includeKnownCardIDs ? { knownCardIDs: context.knownCards?.map((card) => card.id) } : {},
			unknownCount: context.unknownCount,
			...options.includeSourceCardIDs ? { sourceCardIDs: context.sourceCards?.map((card) => card.id) } : {},
			sourceIsOutside: context.sourceIsOutside
		};
	}
	var PROTOCOL_ZONE = Object.freeze({
		OUTSIDE: 0,
		PILE: 1,
		DISCARD: 2,
		PROCESS: 3,
		MARK: 4,
		HAND: 5,
		EQUIP: 6,
		JUDGE: 7,
		POPUP: 8,
		SHUFFLE_PILE: 9,
		EXCHANGE: 10,
		DISCARD_TEMP: 11,
		EXILE: 12
	});
	var PROTOCOL_PUBLIC_ZONE_MAP = new Map([
		[PROTOCOL_ZONE.OUTSIDE, "outside"],
		[PROTOCOL_ZONE.PILE, "pile"],
		[PROTOCOL_ZONE.DISCARD, "discard"],
		[PROTOCOL_ZONE.PROCESS, "process"],
		[PROTOCOL_ZONE.POPUP, "popup"],
		[PROTOCOL_ZONE.SHUFFLE_PILE, "pile"],
		[PROTOCOL_ZONE.EXCHANGE, "exchange"],
		[PROTOCOL_ZONE.DISCARD_TEMP, "process"],
		[PROTOCOL_ZONE.EXILE, "exile"]
	]);
	var PROTOCOL_PLAYER_SUB_ZONE_MAP = new Map([
		[PROTOCOL_ZONE.MARK, "mark"],
		[PROTOCOL_ZONE.HAND, "hand"],
		[PROTOCOL_ZONE.EQUIP, "equip"],
		[PROTOCOL_ZONE.JUDGE, "judge"]
	]);
	function getProtocolPublicZone(zone, fallback = null) {
		return PROTOCOL_PUBLIC_ZONE_MAP.get(zone) ?? fallback;
	}
	function getProtocolPlayerSubZone(zone, fallback = "hand") {
		return zone == null ? fallback : PROTOCOL_PLAYER_SUB_ZONE_MAP.get(zone) ?? fallback;
	}
	function getProtocolMarkSpellID(zone, params = {}, fallback = null) {
		const paramID = params.param || params.toZoneParam || params.fromZoneParam || null;
		const spellID = params.spellID || null;
		if (zone === PROTOCOL_ZONE.MARK) return paramID ?? spellID ?? fallback;
		return params.spellID ?? fallback;
	}
	function isProtocolPlayerZone(zone) {
		return zone != null && PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zone);
	}
	function isKnownProtocolZone(zone) {
		return zone != null && (PROTOCOL_PUBLIC_ZONE_MAP.has(zone) || PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zone));
	}
	var MOVE_TYPE = {
		PRE_OPERATION: 0,
		DRAW: 1,
		USE: 2,
		PLAY: 3,
		DISCARD: 4,
		SELECT_GAIN: 5,
		JUDGE_GAIN: 6,
		POPUP_RETURN: 7,
		MARK_GAIN: 8,
		PUT_IN: 9,
		LIGHTNING_TRANSFER: 10,
		EXCHANGE: 11,
		RECAST: 12,
		PINDIAN: 13,
		AFTER_JUDGE: 14,
		MOVE: 15,
		AFTER_USE: 16,
		AFTER_PLAY: 17,
		GAIN: 18,
		GENERAL_MOVE: 19,
		CRAFT: 20,
		SHOW: 21,
		REPLACE_EQUIP: 22,
		GIVE: 27,
		SYSTEM: 255
	};
	MOVE_TYPE.PRE_OPERATION, MOVE_TYPE.DRAW, MOVE_TYPE.USE, MOVE_TYPE.PLAY, MOVE_TYPE.DISCARD, MOVE_TYPE.SELECT_GAIN, MOVE_TYPE.JUDGE_GAIN, MOVE_TYPE.POPUP_RETURN, MOVE_TYPE.MARK_GAIN, MOVE_TYPE.PUT_IN, MOVE_TYPE.LIGHTNING_TRANSFER, MOVE_TYPE.EXCHANGE, MOVE_TYPE.RECAST, MOVE_TYPE.PINDIAN, MOVE_TYPE.AFTER_JUDGE, MOVE_TYPE.MOVE, MOVE_TYPE.AFTER_USE, MOVE_TYPE.AFTER_PLAY, MOVE_TYPE.GAIN, MOVE_TYPE.GENERAL_MOVE, MOVE_TYPE.CRAFT, MOVE_TYPE.SHOW, MOVE_TYPE.REPLACE_EQUIP, MOVE_TYPE.GIVE, MOVE_TYPE.SYSTEM;
	var ZONE_FIELD = ["FromZone", "ToZone"];
	function validateMoveEvent(event, cardIDs = event.CardIDs) {
		const warnings = [];
		ZONE_FIELD.forEach((field) => {
			if (!isKnownProtocolZone(event[field])) warnings.push({
				code: "UNKNOWN_PROTOCOL_ZONE",
				field,
				value: event[field]
			});
		});
		if (cardIDs.length > 0 && event.CardCount !== cardIDs.length) warnings.push({
			code: "CARD_COUNT_MISMATCH",
			field: "CardIDs",
			expected: event.CardCount,
			actual: cardIDs.length
		});
		return warnings;
	}
	function logMoveEventValidationWarnings(warnings, event) {
		warnings.forEach((warning) => {
			trackerLogger.warn("移动协议字段异常，已按降级路径继续", {
				warning,
				raw: event
			});
		});
	}
	function isSameZoneShowEvent(event) {
		const { FromZone: fromZone, ToZone: toZone } = event;
		return event.FromID === event.ToID && fromZone === toZone && (toZone !== 1 || event.FromPosition === event.ToPosition) && (toZone !== 4 || event.FromZoneParam === event.ToZoneParam);
	}
	function isPileSingleCardShow(event) {
		return event.MoveType === MOVE_TYPE.SHOW && event.CardCount === 1 && event.FromID === 255 && event.FromZone === 1 && event.ToID === 255 && event.ToZone === 1;
	}
	function isTianhouAmbiguousPileShow(event) {
		return event.SpellID === 3903 && isPileSingleCardShow(event);
	}
	function shouldIgnoreSameZoneShow(event) {
		return event.SpellID === 7011 && event.MoveType === MOVE_TYPE.GENERAL_MOVE || event.SpellID === 3744 && event.MoveType === MOVE_TYPE.SHOW;
	}
	function inferEventType(event, cardIDs) {
		const { FromZone: fromZone, ToZone: toZone, MoveType: moveType } = event;
		const known = cardIDs.some((id) => id > 0);
		if (fromZone === 2 && toZone === 9) return "shuffleDiscardIntoPile";
		if (isTianhouAmbiguousPileShow(event)) return "noop";
		if (isSameZoneShowEvent(event)) {
			if (shouldIgnoreSameZoneShow(event) || !known) return "noop";
			return "showCards";
		}
		if (fromZone === 1 && toZone === 5) return known ? "drawKnown" : "drawUnknown";
		if (toZone === 2 && known) return "discardKnown";
		if (toZone === 1 && [
			2,
			5,
			10,
			11
		].includes(fromZone)) return "returnToPile";
		if (toZone === 4) return "moveToMark";
		if (toZone === 8) return known ? "moveKnown" : "moveUnknown";
		if (toZone === 6) return "moveToEquip";
		if (toZone === 7) return "moveToJudge";
		if (moveType === MOVE_TYPE.JUDGE_GAIN && known) return "showCards";
		return known ? "moveKnown" : "moveUnknown";
	}
	function getProtocolMoveSpecialLabel(event) {
		if (event.MoveType !== MOVE_TYPE.GAIN) return void 0;
		const fromZone = getProtocolPublicZone(event.FromZone);
		if (fromZone === "pile") return "从牌堆获取牌";
		if (fromZone === "discard") return "从弃牌堆获取牌";
	}
	function normalizeMoveEndpoints(move) {
		const fromPublicZone = getProtocolPublicZone(move.FromZone);
		const targetIsPlayerZone = isProtocolPlayerZone(move.ToZone);
		const sourceIsPlayerZone = isProtocolPlayerZone(move.FromZone);
		const targetSpellID = targetIsPlayerZone ? getProtocolMarkSpellID(move.ToZone, {
			param: move.ToZoneParam,
			toZoneParam: move.ToZoneParam,
			spellID: move.SpellID
		}, move.SpellID) : void 0;
		const fromSpellID = sourceIsPlayerZone ? getProtocolMarkSpellID(move.FromZone, {
			param: move.FromZoneParam,
			fromZoneParam: move.FromZoneParam,
			spellID: move.SpellID
		}, move.SpellID) : void 0;
		const spellID = targetIsPlayerZone ? targetSpellID : fromSpellID ?? move.SpellID;
		return {
			fromPopupSpaceID: move.FromZone === 8 ? move.FromID === 255 ? move.SpellID : move.FromID : void 0,
			toPopupSpaceID: move.ToZone === 8 ? move.SpellID : void 0,
			toSeatID: targetIsPlayerZone ? move.ToID : void 0,
			fromSeatID: sourceIsPlayerZone ? move.FromID : void 0,
			fromZone: fromPublicZone,
			subZone: targetIsPlayerZone ? getProtocolPlayerSubZone(move.ToZone) : sourceIsPlayerZone ? getProtocolPlayerSubZone(move.FromZone) : void 0,
			fromSubZone: sourceIsPlayerZone ? getProtocolPlayerSubZone(move.FromZone) : void 0,
			fromSpellID,
			spellID
		};
	}
	function normalizeMoveEvent(patched, raw = patched) {
		const cardIDs = patched.CardIDs;
		logMoveEventValidationWarnings(validateMoveEvent(patched, cardIDs), raw);
		const cardCount = patched.CardCount;
		const type = inferEventType(patched, cardIDs);
		const toPublicZoneName = getProtocolPublicZone(patched.ToZone);
		const targetIsPlayerZone = isProtocolPlayerZone(patched.ToZone);
		return {
			type,
			cardIDs,
			cardCount,
			protocol: patched,
			moveType: patched.MoveType,
			toZone: targetIsPlayerZone ? "player" : toPublicZoneName ?? "process",
			options: {
				...normalizeMoveEndpoints(patched),
				cardCount,
				moveType: patched.MoveType,
				position: patched.ToPosition,
				fromPosition: patched.FromPosition,
				sourceEvent: {
					type,
					spellID: patched.SpellID,
					label: getProtocolMoveSpecialLabel(patched) ?? patched.Label,
					moveType: patched.MoveType,
					raw
				}
			},
			raw
		};
	}
	var PAIDUI_POSITIONS = ["top", "bottom"];
	var HIDDEN_MARK_STATE_KEY = "hiddenMarkCandidates";
	var POPUP_SPACE_STATE_KEY = "popupSpaces";
	function getPopupSpaceState(room) {
		return room.ensureSkillState(POPUP_SPACE_STATE_KEY, () => {
			return { spaces: new Map() };
		});
	}
	function isLivePopupSpaceCard(card, spaceIDs = []) {
		if (card.hasLocationCandidates()) return card.locationCandidates.some((candidate) => candidate.type === "popup" && (spaceIDs.length === 0 || spaceIDs.includes(candidate.spaceID)));
		if (card.location !== "popup") return false;
		if (spaceIDs.length === 0) return true;
		return card.popupSpaceID !== null && spaceIDs.includes(card.popupSpaceID);
	}
	function getPopupSpaceCards(room, spaceID) {
		if (spaceID === void 0) return [];
		const state = room.readSkillState(POPUP_SPACE_STATE_KEY);
		if (!state) return [];
		const liveCards = (state.spaces.get(spaceID) ?? []).filter((card) => isLivePopupSpaceCard(card, [spaceID]));
		if (liveCards.length > 0) state.spaces.set(spaceID, liveCards);
		else state.spaces.delete(spaceID);
		return liveCards;
	}
	function registerPopupSpaceCards(room, spaceID, cards) {
		if (spaceID == null || cards.length === 0) return;
		const state = getPopupSpaceState(room);
		const liveCards = cards.filter((card) => isLivePopupSpaceCard(card, [spaceID]));
		if (liveCards.length === 0) return;
		const previousCards = state.spaces.get(spaceID) ?? [];
		const mergedCards = [];
		const seenCards = new Set();
		[...previousCards, ...liveCards].forEach((card) => {
			if (seenCards.has(card) || !isLivePopupSpaceCard(card, [spaceID])) return;
			seenCards.add(card);
			mergedCards.push(card);
		});
		state.spaces.set(spaceID, mergedCards);
	}
	function takePopupSpaceCards(room, count, spaceID) {
		if (!(count > 0) || spaceID === void 0) return [];
		const state = room.readSkillState(POPUP_SPACE_STATE_KEY);
		if (!state?.spaces?.size) return [];
		const spaceCards = getPopupSpaceCards(room, spaceID);
		const selectedCards = [];
		const remainingCards = [];
		const takeWholeSpace = spaceCards.length <= count && spaceCards.every((card) => !card.hasLocationCandidates());
		spaceCards.forEach((card) => {
			if (card.hasLocationCandidates() || card.isKnown && !takeWholeSpace || selectedCards.length >= count) {
				remainingCards.push(card);
				return;
			}
			selectedCards.push(card);
		});
		if (remainingCards.length > 0) state.spaces.set(spaceID, remainingCards);
		else state.spaces.delete(spaceID);
		return selectedCards;
	}
	function removePopupSpaceCards(room, cards) {
		if (cards.length === 0) return;
		const state = room.readSkillState(POPUP_SPACE_STATE_KEY);
		if (!state?.spaces?.size) return;
		const removedCards = new Set(cards);
		state.spaces.forEach((spaceCards, spaceKey) => {
			const remainingCards = spaceCards.filter((card) => !removedCards.has(card) && isLivePopupSpaceCard(card, [spaceKey]));
			if (remainingCards.length > 0) state.spaces.set(spaceKey, remainingCards);
			else state.spaces.delete(spaceKey);
		});
	}
	function replacePopupSpaceCard(room, previous, next) {
		const state = room.readSkillState(POPUP_SPACE_STATE_KEY);
		if (!state) return;
		state.spaces.forEach((cards, spaceID) => {
			if (cards.includes(previous)) state.spaces.set(spaceID, cards.map((card) => card === previous ? next : card));
		});
	}
	function reconcilePopupSpaces(room) {
		const state = room.readSkillState(POPUP_SPACE_STATE_KEY);
		if (!state) return;
		for (const spaceID of state.spaces.keys()) getPopupSpaceCards(room, spaceID);
		if (state.spaces.size === 0) room.deleteSkillState(POPUP_SPACE_STATE_KEY);
	}
	var BaseCard = class {
		constructor(id) {
			this.setCardInfo(id);
		}
		setCardInfo(id) {
			this.id = id;
			const cardInfo = CardConfig.GetInstance().getCard(id);
			this.name = cardInfo?.name ?? "";
			this.color = cardInfo?.color ?? 0;
			this.number = cardInfo?.number ?? 0;
			this.type = cardInfo?.type ?? 0;
			this.spellId = cardInfo?.spellId ?? 0;
			this.ncn = cardInfo?.ncn ?? this.name;
			return this;
		}
	};
	var Card = class extends BaseCard {
		popupSpaceID = null;
		_locationCandidates = Object.freeze([]);
		handGainSpellIDs = new Map();
		constructor(id, room) {
			super(id);
			this.room = room;
			this.entityID = id > 0 ? id : room.allocateAnonymousEntityID();
			if (this.isAnonymous) this.id = this.entityID;
			this.location = "pile";
			this.subZone = null;
			this.isKnown = false;
			this.spellID = null;
			this.turn = 0;
			this.round = 0;
			this.phase = 0;
			this.owner = null;
			this.suspended = false;
		}
		get hasRealIdentity() {
			return this.id > 0;
		}
		get gainSpellID() {
			if (this.location !== "player" || this.subZone !== "hand" || this.hasLocationCandidates()) return null;
			return this.owner === null ? null : this.getHandGainSpellID(this.owner);
		}
		getHandGainSpellID(seatID) {
			return this.handGainSpellIDs.get(seatID) ?? null;
		}
		recordHandGain(seatID, spellID) {
			const next = spellID !== null && spellID > 0 ? spellID : null;
			if (this.getHandGainSpellID(seatID) === next) return;
			if (next === null) this.handGainSpellIDs.delete(seatID);
			else this.handGainSpellIDs.set(seatID, next);
			this.room.notifyCardChanged(this, {
				type: "card-hand-gain-source",
				seatID,
				gainSpellID: next
			});
		}
		pruneHandGainSources() {
			if (this.handGainSpellIDs.size === 0) return;
			const seats = new Set(this.getPossibleLocations().flatMap((candidate) => candidate.type === "player" && candidate.subZone === "hand" ? [candidate.seatID] : []));
			for (const seatID of this.handGainSpellIDs.keys()) if (!seats.has(seatID)) this.handGainSpellIDs.delete(seatID);
		}
		get isAnonymous() {
			return !this.hasRealIdentity;
		}
		materializeIdentity(cardID) {
			if (this.hasRealIdentity || cardID <= 0) return;
			this.setCardInfo(cardID);
			this.entityID = cardID;
		}
		get resolvedSeat() {
			if (this.location !== "player") return null;
			const seats = this.seats;
			return seats.size === 1 ? seats.values().next().value ?? null : null;
		}
		get locationCandidates() {
			return this._locationCandidates;
		}
		storeLocationCandidates(candidates) {
			this._locationCandidates = Object.freeze(candidates.map((candidate) => Object.freeze(candidate)));
		}
		get seats() {
			const candidateSeats = projectSeatsFromLocationCandidates(this.locationCandidates);
			if (candidateSeats.size > 0) return candidateSeats;
			if (this.location === "player" && this.owner !== null) return new Set([this.owner]);
			return new Set();
		}
		get subZoneCandidates() {
			return getPlayerLocationCandidates(this.locationCandidates).map(({ seatID, subZone, spellID }) => ({
				seatID,
				subZone,
				spellID
			}));
		}
		get publicCandidates() {
			return getPublicLocationCandidates(this.locationCandidates).map((candidate) => toPublicCandidate(candidate, (zone, position, count) => getPublicCandidateLabel(zone, position, count) ?? null)).filter((candidate) => Boolean(candidate));
		}
		normalizeSeats(seats) {
			const rawSeats = seats instanceof Set || Array.isArray(seats) ? Array.from(seats) : [seats];
			return new Set(rawSeats.filter((seat) => seat !== null && seat !== void 0).map((seat) => Number(seat)).filter((seat) => !Number.isNaN(seat)));
		}
		hasSameSeats(nextSeats) {
			const seats = this.seats;
			if (seats.size !== nextSeats.size) return false;
			return Array.from(nextSeats).every((seat) => seats.has(seat));
		}
		syncTimestamp() {
			const timestamp = this.room.getCurrentTimestamp();
			this.turn = timestamp.turn ?? 0;
			this.round = timestamp.round ?? 0;
			this.phase = timestamp.phase ?? 0;
		}
		confirmKnown() {
			if (!this.isKnown) {
				this.isKnown = true;
				this.room.markCounterDirty(this);
				this.room.notifyCardChanged(this, { type: "card-known-confirmed" });
			}
			this.syncTimestamp();
		}
		syncOwnerFromSeats(reason = "syncOwnerFromSeats", change = {}) {
			const previousOwner = change.previousOwner ?? this.owner;
			const previousResolvedSeat = change.previousResolvedSeat !== void 0 ? change.previousResolvedSeat : previousOwner;
			const currentSeats = change.nextSeats ?? this.seats;
			const previousSeats = change.previousSeats ?? currentSeats;
			const previousSeatSize = change.previousSeatSize ?? previousSeats.size;
			const seatsChanged = change.seatsChanged === true;
			const nextResolvedSeat = change.nextResolvedSeat !== void 0 ? change.nextResolvedSeat : this.location === "player" && currentSeats.size === 1 ? currentSeats.values().next().value ?? null : null;
			const nextOwner = nextResolvedSeat;
			const ownerChanged = previousOwner !== nextOwner;
			const resolvedSeatChanged = previousResolvedSeat !== nextResolvedSeat;
			this.owner = nextOwner;
			if (seatsChanged || ownerChanged || resolvedSeatChanged) {
				this.room.notifyCardChanged(this, {
					type: "card-seats-changed",
					reason,
					previousResolvedSeat,
					nextResolvedSeat,
					previousSeatSize,
					nextSeatSize: currentSeats.size,
					previousSeats: Array.from(previousSeats),
					previousOwner,
					nextOwner
				});
				return true;
			}
			return false;
		}
		setSeats(nextSeats, reason = "setSeats") {
			const normalizedSeats = this.normalizeSeats(nextSeats);
			const previousSeats = this.seats;
			const seatsChanged = previousSeats.size !== normalizedSeats.size || Array.from(normalizedSeats).some((seat) => !previousSeats.has(seat));
			if (getPlayerLocationCandidates(this.locationCandidates).length > 0) {
				const filteredCandidates = this.locationCandidates.filter((candidate) => candidate.type !== "player" || normalizedSeats.has(candidate.seatID));
				return this.setLocationCandidates(filteredCandidates, reason);
			}
			if (this.location === "player" && normalizedSeats.size > 1) {
				const subZone = this.subZone ?? "hand";
				const spellID = subZone === "mark" ? this.spellID : null;
				const nextLocationCandidates = Array.from(normalizedSeats).map((seatID) => fromSubZoneCandidate({
					seatID,
					subZone,
					spellID
				})).filter((candidate) => Boolean(candidate));
				return this.setLocationCandidates([...this.locationCandidates, ...nextLocationCandidates], reason);
			}
			return this.syncOwnerFromSeats(reason, {
				previousSeats,
				nextResolvedSeat: this.location === "player" && normalizedSeats.size === 1 ? normalizedSeats.values().next().value ?? null : null,
				nextSeats: normalizedSeats,
				seatsChanged
			});
		}
		addSeat(seat, reason = "addSeat") {
			const normalizedSeats = this.normalizeSeats(seat);
			if (normalizedSeats.size === 0) return false;
			if (this.hasLocationCandidates()) {
				const templates = this.getSeatExpansionTemplates(getPlayerLocationCandidates(this.locationCandidates));
				const nextCandidates = this.locationCandidates.slice();
				let changed = false;
				normalizedSeats.forEach((seatID) => {
					templates.forEach((template) => {
						const candidate = {
							type: "player",
							seatID,
							subZone: template.subZone,
							spellID: template.spellID
						};
						const key = createLocationCandidateKey(candidate);
						if (!key || this.hasLocationCandidate(key)) return;
						nextCandidates.push(candidate);
						changed = true;
					});
				});
				if (!changed) return false;
				return this.setLocationCandidates(nextCandidates, reason);
			}
			const nextSeats = new Set(this.seats);
			normalizedSeats.forEach((seatID) => nextSeats.add(seatID));
			return this.setSeats(nextSeats, reason);
		}
		getSeatExpansionTemplates(playerCandidates) {
			if (playerCandidates.length === 0) {
				const subZone = this.subZone ?? "hand";
				return [{
					subZone,
					spellID: subZone === "mark" ? this.spellID : null
				}];
			}
			const handCandidates = playerCandidates.filter((candidate) => candidate.subZone === "hand");
			const sourceCandidates = handCandidates.length > 0 ? handCandidates : playerCandidates;
			const templates = new Map();
			sourceCandidates.forEach((candidate) => {
				const spellID = candidate.subZone === "mark" ? candidate.spellID : null;
				const key = `${candidate.subZone}:${spellID ?? ""}`;
				if (!templates.has(key)) templates.set(key, {
					subZone: candidate.subZone,
					spellID
				});
			});
			return Array.from(templates.values());
		}
		deleteSeat(seat, reason = "deleteSeat") {
			const normalizedSeats = this.normalizeSeats(seat);
			if (normalizedSeats.size === 0) return false;
			const nextSeats = new Set(this.seats);
			normalizedSeats.forEach((seatID) => nextSeats.delete(seatID));
			return this.setSeats(nextSeats, reason);
		}
		clearSeats(reason = "clearSeats") {
			return this.setSeats([], reason);
		}
		hasLocationCandidates() {
			return this.locationCandidates.length > 0;
		}
		hasLocationCandidate(candidate) {
			const key = typeof candidate === "string" ? candidate : createLocationCandidateKey(candidate);
			if (!key) return false;
			return this.locationCandidates.some((item) => createLocationCandidateKey(item) === key);
		}
		reconcileLocationStateFromCandidates(reason, previousSeats) {
			const playerCandidates = getPlayerLocationCandidates(this.locationCandidates);
			const hasPublicCandidate = this.locationCandidates.some((candidate) => candidate.type === "public");
			const hasContainerCandidate = this.locationCandidates.some((candidate) => candidate.type === "container");
			const popupCandidate = this.locationCandidates.find((candidate) => candidate.type === "popup");
			const hasExchangeBatchCandidate = this.locationCandidates.some((candidate) => candidate.type === "outside" && candidate.zone === "exchange" && Boolean(candidate.batchID));
			const previousLocation = this.location;
			let changed = false;
			if ((playerCandidates.length > 0 || hasContainerCandidate || hasExchangeBatchCandidate || popupCandidate) && !hasPublicCandidate) this.room.clearCardsFromPublicZones([this]);
			if (playerCandidates.length > 0 || hasContainerCandidate) {
				this.location = "player";
				this.popupSpaceID = null;
				changed = previousLocation !== this.location;
				this.syncTimestamp();
			} else if (popupCandidate) {
				this.location = "popup";
				this.popupSpaceID = popupCandidate.spaceID;
				this.subZone = null;
				this.spellID = null;
				changed = previousLocation !== this.location;
				this.syncTimestamp();
			} else if (hasExchangeBatchCandidate) {
				this.location = "exchange";
				this.popupSpaceID = null;
				this.subZone = null;
				this.spellID = null;
				changed = previousLocation !== this.location;
				this.syncTimestamp();
			}
			const nextSeats = projectSeatsFromLocationCandidates(this.locationCandidates);
			changed = this.syncOwnerFromSeats(reason, {
				previousSeats,
				nextSeats,
				nextResolvedSeat: this.location === "player" && nextSeats.size === 1 ? nextSeats.values().next().value ?? null : null,
				seatsChanged: previousSeats.size !== nextSeats.size || Array.from(previousSeats).some((seat) => !nextSeats.has(seat))
			}) || changed;
			if (changed) this.room.markCounterDirty(this);
			return changed;
		}
		getPossibleLocations() {
			if (this.suspended || this.location === "suspended") return [];
			if (this.locationCandidates.length > 0) return this.locationCandidates;
			if (this.location === "player" || this.location === "popup") return this.getResolvedLocationCandidates();
			const candidate = normalizeLocationCandidate({
				type: "public",
				zone: this.location
			});
			return candidate ? [candidate] : [];
		}
		getResolvedLocationCandidates() {
			if (this.location === "popup" && this.popupSpaceID !== null) return [{
				type: "popup",
				spaceID: this.popupSpaceID
			}];
			if (this.location !== "player" || this.owner === null) return [];
			const candidate = fromSubZoneCandidate({
				seatID: this.owner,
				subZone: this.subZone ?? "hand",
				spellID: this.subZone === "mark" ? this.spellID : null
			});
			return candidate ? [candidate] : [];
		}
		setLocationCandidates(candidates = [], reason = "setLocationCandidates") {
			const uniqueCandidates = new Map();
			candidates.forEach((candidate) => {
				const normalized = normalizeLocationCandidate(candidate);
				if (!normalized) return;
				uniqueCandidates.set(createLocationCandidateKey(normalized), normalized);
			});
			const nextCandidates = Array.from(uniqueCandidates.values());
			if (nextCandidates.length === 1 && ["player", "popup"].includes(nextCandidates[0].type)) return this.resolveLocationCandidate(nextCandidates[0], reason);
			if (!(this.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort().join("|") !== nextCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort().join("|"))) return false;
			const previousSeats = this.seats;
			this.storeLocationCandidates(nextCandidates);
			this.reconcileLocationStateFromCandidates(reason, previousSeats);
			this.pruneHandGainSources();
			this.room.notifyCardChanged(this, {
				type: "card-location-candidates-changed",
				reason,
				candidates: this.locationCandidates,
				previousSeats: Array.from(previousSeats)
			});
			return true;
		}
		removeLocationCandidate(candidate, reason = "removeLocationCandidate") {
			const key = typeof candidate === "string" ? candidate : createLocationCandidateKey(candidate);
			if (!key || !this.hasLocationCandidate(key)) return false;
			const nextCandidates = this.locationCandidates.filter((item) => createLocationCandidateKey(item) !== key);
			const [remainingCandidate] = nextCandidates;
			if (nextCandidates.length === 1 && remainingCandidate.type === "player") return this.resolveLocationCandidate(remainingCandidate, `${reason}:singleRemaining`);
			return this.setLocationCandidates(nextCandidates, reason);
		}
		resolveLocationCandidate(candidate, reason = "resolveLocationCandidate") {
			const normalized = normalizeLocationCandidate(candidate);
			if (!normalized) return false;
			if (normalized.type === "public") {
				this.moveToPublicZone(normalized.zone);
				return true;
			}
			if (normalized.type !== "player" && normalized.type !== "popup") return false;
			const previousSubZone = this.subZone;
			const previousSpellID = this.spellID;
			const previousLocation = this.location;
			const hadCandidates = this.hasLocationCandidates();
			const previousPopupSpaceID = this.popupSpaceID;
			const previousSeats = this.seats;
			this.room.clearCardsFromPublicZones([this]);
			this.location = normalized.type === "popup" ? "popup" : "player";
			this.popupSpaceID = normalized.type === "popup" ? normalized.spaceID : null;
			this.subZone = normalized.type === "popup" ? null : normalized.subZone;
			this.spellID = normalized.type === "popup" ? null : normalized.spellID;
			this.storeLocationCandidates([]);
			this.suspended = false;
			this.syncTimestamp();
			const nextSeats = new Set(normalized.type === "player" ? [normalized.seatID] : []);
			const seatsChanged = this.syncOwnerFromSeats(`${reason}:seat`, {
				previousSeats,
				nextSeats,
				nextResolvedSeat: normalized.type === "player" ? normalized.seatID : null,
				seatsChanged: previousSeats.size !== nextSeats.size || Array.from(previousSeats).some((seat) => !nextSeats.has(seat))
			});
			this.room.markCounterDirty(this);
			const changed = hadCandidates || previousLocation !== this.location || previousSubZone !== this.subZone || previousSpellID !== this.spellID || previousPopupSpaceID !== this.popupSpaceID || seatsChanged;
			this.pruneHandGainSources();
			if (changed) this.room.notifyCardChanged(this, {
				type: "card-location-resolved",
				reason,
				candidate: normalized,
				previousSeats: Array.from(previousSeats)
			});
			return changed;
		}
		hasSubZoneCandidates() {
			return this.locationCandidates.some((candidate) => candidate.type === "player");
		}
		hasSubZoneCandidate(candidate) {
			const key = typeof candidate === "string" ? candidate : createSubZoneCandidateKey(candidate);
			if (!key) return false;
			return this.locationCandidates.some((item) => item.type === "player" && createSubZoneCandidateKey(item) === key);
		}
		clearSubZoneCandidates(reason = "clearSubZoneCandidates") {
			const nextCandidates = this.locationCandidates.filter((candidate) => candidate.type !== "player");
			if (nextCandidates.length === this.locationCandidates.length) return false;
			return this.setLocationCandidates(nextCandidates, reason);
		}
		resolveSubZoneCandidate(candidate, reason = "resolveSubZoneCandidate") {
			const normalized = fromSubZoneCandidate(candidate);
			return normalized ? this.resolveLocationCandidate(normalized, reason) : false;
		}
		bindCandidates(seats, subZone = "hand", spellID = null, options = {}) {
			const { known = false } = options;
			const previousSeats = this.seats;
			this.location = "player";
			this.subZone = subZone;
			this.popupSpaceID = null;
			this.spellID = spellID;
			this.syncTimestamp();
			this.storeLocationCandidates([]);
			this.suspended = false;
			if (known) this.confirmKnown();
			this.setSeats(seats, "bindCandidates");
			this.pruneHandGainSources();
			this.room.markCounterDirty(this);
			this.room.notifyCardChanged(this, {
				type: "card-bound",
				subZone,
				spellID,
				previousSeats: Array.from(previousSeats)
			});
		}
		bindTo(seats, subZone = "hand", spellID = null, options = {}) {
			this.bindCandidates(seats, subZone, spellID, {
				known: true,
				...options
			});
		}
		moveToPublicZone(destination) {
			const previous = this.capturePublicMigrationSnapshot();
			this.handGainSpellIDs.clear();
			const seatsChanged = this.clearSeats(`moveToPublicZone:${destination}`);
			this.location = destination;
			this.popupSpaceID = null;
			this.subZone = null;
			this.spellID = null;
			const candidatesChanged = this.clearSubZoneCandidates(`moveToPublicZone:${destination}`);
			this.storeLocationCandidates([]);
			this.suspended = false;
			this.syncTimestamp();
			if (destination === "exile" || destination === "outside") this.isKnown = false;
			this.room.markCounterDirty(this);
			this.notifyLeftPlayerZoneIfSilent(!seatsChanged && !candidatesChanged, previous, {
				type: "card-moved-to-public-zone",
				destination
			});
		}
		getLocationDescription() {
			if (this.suspended) return "位置发散，暂停追踪";
			const ambiguousDescription = this.room.ambiguousKnownIndex.describe(this.id);
			if (ambiguousDescription) return ambiguousDescription;
			if (this.location === "outside") return "游戏外";
			if (this.location === "pile") return "牌堆";
			if (this.location === "discard") return "弃牌堆";
			if (this.location === "exile") return "销毁";
			if (this.location === "exchange") return "交换临时区";
			if (this.location === "popup") return `弹窗区 ${this.popupSpaceID}`;
			if (this.location === "process") return "处理区";
			if (this.location === "player") {
				const parts = [];
				if (this.hasSubZoneCandidates()) {
					this.subZoneCandidates.forEach((candidate) => {
						const prefix = this.room.formatSeatPrefix(candidate.seatID);
						parts.push(`${prefix}${getSubZoneName(candidate.subZone)}`);
					});
					return parts.join("/");
				}
				const subZone = this.subZone;
				if (subZone === null) return "未知";
				const zoneName = getSubZoneName(subZone);
				this.seats.forEach((seatID) => {
					const prefix = this.room.formatSeatPrefix(seatID);
					parts.push(`${prefix}${zoneName}`);
				});
				return parts.join("/");
			}
			return "未知";
		}
		addPublicCandidate(candidate) {
			const normalized = {
				zone: candidate.zone,
				label: candidate.label,
				position: candidate.position,
				count: candidate.count
			};
			const baseCandidates = this.locationCandidates.length > 0 ? this.locationCandidates : this.getResolvedLocationCandidates();
			return this.setLocationCandidates([...baseCandidates, fromPublicCandidate(normalized)].filter((candidate) => candidate !== null), "addPublicCandidate");
		}
		removePublicCandidates(predicate) {
			if (!this.locationCandidates.some((candidate) => candidate.type === "public")) return false;
			const nextCandidates = this.locationCandidates.filter((candidate) => {
				if (candidate.type !== "public") return true;
				const publicCandidate = toPublicCandidate(candidate, (zone, position, count) => getPublicCandidateLabel(zone, position, count) ?? null);
				return publicCandidate === null || !predicate(publicCandidate);
			});
			return this.setLocationCandidates(nextCandidates, "removePublicCandidates");
		}
		reset() {
			const previous = this.capturePublicMigrationSnapshot();
			this.handGainSpellIDs.clear();
			const seatsChanged = this.clearSeats("reset");
			this.location = "pile";
			this.subZone = null;
			this.popupSpaceID = null;
			this.isKnown = false;
			this.spellID = null;
			this.storeLocationCandidates([]);
			this.suspended = false;
			this.turn = 0;
			this.round = 0;
			this.phase = 0;
			this.room.markCounterDirty(this);
			this.notifyLeftPlayerZoneIfSilent(!seatsChanged, previous, { type: "card-reset" });
		}
		capturePublicMigrationSnapshot() {
			return {
				location: this.location,
				subZone: this.subZone,
				spellID: this.spellID,
				candidateCount: this.locationCandidates.length,
				suspended: this.suspended
			};
		}
		notifyLeftPlayerZoneIfSilent(silent, previous, detail) {
			if (!silent) return;
			if (!(previous.location === "player" || previous.location === "popup" || previous.subZone !== null || previous.spellID !== null || previous.candidateCount > 0 || previous.suspended !== this.suspended)) return;
			this.room.notifyCardChanged(this, {
				...detail,
				previousLocation: previous.location,
				previousSubZone: previous.subZone,
				previousSpellID: previous.spellID
			});
		}
	};
	function getConstraintSlotState(cards, location, range) {
		const key = createLocationCandidateKey(location);
		const exactCards = [];
		const candidateCards = [];
		for (const card of cards) {
			if (card.suspended) continue;
			if (card.hasLocationCandidates()) {
				if (card.hasLocationCandidate(key)) if (card.locationCandidates.length === 1) exactCards.push(card);
				else candidateCards.push(card);
				continue;
			}
			if (card.getPossibleLocations().some((candidate) => createLocationCandidateKey(candidate) === key)) exactCards.push(card);
		}
		return {
			location,
			range,
			exactCards,
			candidateCards,
			remainingMin: Math.max(0, range.min - exactCards.length),
			remainingMax: Math.max(0, range.max - exactCards.length)
		};
	}
	function collectConstraintHandSlots(groups) {
		const slots = [];
		for (const group of groups) group.expectedSlotsByLocation.forEach((count, key) => {
			const location = parseLocationCandidateKey(key);
			if (location?.type !== "player" || location.subZone !== "hand") return;
			slots.push({
				...getConstraintSlotState(group.cards, location, count),
				group
			});
		});
		return slots;
	}
	var activeStats = null;
	function addTraversal(stats, site, visitedCount) {
		const entry = stats.sites.get(site);
		if (entry) {
			entry.calls += 1;
			entry.visited += visitedCount;
			return;
		}
		stats.sites.set(site, {
			calls: 1,
			visited: visitedCount
		});
	}
	function recordTraversal(site, visitedCount) {
		if (activeStats) addTraversal(activeStats, site, visitedCount);
	}
	function getHandSlotKindForSeat(card, seatID) {
		if (card.location !== "player" || card.isKnown !== true) return null;
		const locations = card.getPossibleLocations();
		if (!getPlayerLocationCandidates(locations).some((candidate) => candidate.seatID === seatID && candidate.subZone === "hand")) return null;
		return locations.length === 1 ? "known" : "candidate";
	}
	function collectHandSlotCardsBySeat(cards, seatIDs) {
		recordTraversal("handSlotCounts:collectBySeat", cards.length);
		const cardsBySeat = new Map();
		for (const seatID of seatIDs) cardsBySeat.set(Number(seatID), {
			knownCards: [],
			candidateCards: [],
			exactHiddenCards: []
		});
		for (const card of cards) {
			if (card.location !== "player" || card.suspended) continue;
			if (!card.isKnown) {
				if (!card.hasLocationCandidates() && card.subZone === "hand" && card.owner !== null) cardsBySeat.get(card.owner)?.exactHiddenCards.push(card);
				continue;
			}
			cardsBySeat.forEach((slotCards, seatID) => {
				const handSlotKind = getHandSlotKindForSeat(card, seatID);
				if (handSlotKind === "known") slotCards.knownCards.push(card);
				else if (handSlotKind === "candidate") slotCards.candidateCards.push(card);
			});
		}
		return cardsBySeat;
	}
	function computeHandSlotAllocation(room, seatIDs = room.players.keys(), playerCards) {
		const targetSeats = Array.from(seatIDs).filter((seatID) => room.players.has(seatID));
		const allocations = new Map();
		if (targetSeats.length === 0) return allocations;
		const cardsBySeat = collectHandSlotCardsBySeat(playerCards ?? room.refreshPlayerSnapshot(), targetSeats);
		const slots = collectConstraintHandSlots(room.constraintGroups.values());
		const candidateCounts = new Map();
		const countKnownSlots = (seatID, cards) => {
			if (cards.length === 0) return 0;
			const key = `${seatID}:${cards.map((card) => card.entityID).sort((a, b) => a - b).join(",")}`;
			const cached = candidateCounts.get(key);
			if (cached !== void 0) return cached;
			const count = countCandidateHandSlots(slots, seatID, cards);
			candidateCounts.set(key, count);
			return count;
		};
		const hiddenCoverage = collectHiddenHandCoverage(slots, countKnownSlots);
		for (const seatID of targetSeats) {
			const player = room.players.get(seatID);
			const cards = cardsBySeat.get(seatID);
			const exactKnownCount = cards.knownCards.length;
			const exactHiddenCount = cards.exactHiddenCards.length;
			const candidateKnownUpperBound = countKnownSlots(seatID, cards.candidateCards);
			const detachedKnownCards = cards.knownCards.filter((card) => room.detachedKnownCards.has(card));
			const physicalCandidateCards = cards.candidateCards.filter((card) => !room.detachedKnownCards.has(card));
			const physicalCandidateUpperBound = physicalCandidateCards.length === cards.candidateCards.length ? candidateKnownUpperBound : countKnownSlots(seatID, physicalCandidateCards);
			const ambiguousHiddenCoveredCount = hiddenCoverage.coveredBySeat.get(seatID) ?? 0;
			const unknownCardCount = player.hasObservedHandCount ? Math.max(0, player.observedHandCount - exactKnownCount - candidateKnownUpperBound) : null;
			const canReconcileAnonymous = unknownCardCount !== null && !hiddenCoverage.unresolvedSeats.has(seatID) && (cards.candidateCards.length === 0 || candidateKnownUpperBound > 0);
			const physicalUnknownCount = player.hasObservedHandCount ? Math.max(0, player.observedHandCount - (exactKnownCount - detachedKnownCards.length) - physicalCandidateUpperBound) : null;
			const anonymousBalance = !canReconcileAnonymous ? null : physicalUnknownCount - exactHiddenCount - ambiguousHiddenCoveredCount;
			allocations.set(seatID, {
				exactKnownCount,
				exactHiddenCount,
				candidateKnownUpperBound,
				ambiguousHiddenCoveredCount,
				candidateKnownCards: cards.candidateCards,
				exactHiddenCards: cards.exactHiddenCards,
				detachedKnownCards,
				unknownCardCount,
				anonymousMissingCount: anonymousBalance === null ? null : Math.max(0, anonymousBalance),
				anonymousExcessCount: anonymousBalance === null ? null : Math.max(0, -anonymousBalance),
				canReconcileAnonymous
			});
		}
		return allocations;
	}
	function countCandidateHandSlots(slots, seatID, candidateCards) {
		if (candidateCards.length === 0) return 0;
		const allowedCards = new Set(candidateCards);
		const budgets = [];
		for (const slot of slots) {
			if (slot.location.type !== "player" || slot.location.seatID !== seatID) continue;
			const cards = slot.candidateCards.filter((card) => allowedCards.has(card));
			if (cards.length === 0) continue;
			budgets.push({
				cards: new Set(cards),
				count: slot.remainingMax
			});
		}
		const remaining = new Set(budgets);
		let count = 0;
		while (remaining.size > 0) {
			const first = remaining.values().next().value;
			const component = [first];
			const cards = new Set(first.cards);
			remaining.delete(first);
			for (let index = 0; index < component.length; index += 1) for (const budget of remaining) {
				if (!Array.from(budget.cards).some((card) => cards.has(card))) continue;
				component.push(budget);
				budget.cards.forEach((card) => cards.add(card));
				remaining.delete(budget);
			}
			count += countBudgetComponent(component, cards);
		}
		return count;
	}
	function countBudgetComponent(budgets, cards) {
		const uniqueBudgets = new Map();
		for (const budget of budgets) {
			if (budget.count >= budget.cards.size) continue;
			const key = Array.from(budget.cards, (card) => card.entityID).sort((a, b) => a - b).join(",");
			const previous = uniqueBudgets.get(key);
			if (!previous || budget.count < previous.count) uniqueBudgets.set(key, budget);
		}
		const constraints = Array.from(uniqueBudgets.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([, budget]) => budget);
		if (constraints.length === 0) return cards.size;
		if (constraints.length === 1) return cards.size - constraints[0].cards.size + constraints[0].count;
		const buckets = new Map();
		for (const card of cards) {
			const indices = constraints.flatMap((budget, index) => budget.cards.has(card) ? [index] : []);
			const key = indices.join(",");
			const bucket = buckets.get(key);
			if (bucket) bucket.count += 1;
			else buckets.set(key, {
				indices,
				count: 1
			});
		}
		const patterns = Array.from(buckets.values()).sort((left, right) => right.indices.length - left.indices.length || left.indices.join(",").localeCompare(right.indices.join(",")));
		const suffixCounts = new Array(patterns.length + 1).fill(0);
		const suffixByConstraint = Array.from({ length: patterns.length + 1 }, () => new Array(constraints.length).fill(0));
		for (let index = patterns.length - 1; index >= 0; index -= 1) {
			suffixCounts[index] = suffixCounts[index + 1] + patterns[index].count;
			suffixByConstraint[index] = suffixByConstraint[index + 1].slice();
			patterns[index].indices.forEach((constraint) => {
				suffixByConstraint[index][constraint] += patterns[index].count;
			});
		}
		const memo = new Map();
		const solve = (index, capacities) => {
			if (index === patterns.length) return 0;
			const key = `${index}:${capacities.join(",")}`;
			const cached = memo.get(key);
			if (cached !== void 0) return cached;
			const upper = Math.min(suffixCounts[index], ...capacities.map((capacity, constraint) => capacity + suffixCounts[index] - suffixByConstraint[index][constraint]));
			const pattern = patterns[index];
			const maximum = Math.min(pattern.count, ...pattern.indices.map((constraint) => capacities[constraint]));
			let best = 0;
			for (let used = maximum; used >= 0; used -= 1) {
				if (used + suffixCounts[index + 1] <= best) break;
				const next = capacities.slice();
				pattern.indices.forEach((constraint) => {
					next[constraint] -= used;
				});
				best = Math.max(best, used + solve(index + 1, next));
				if (best === upper) break;
			}
			memo.set(key, best);
			return best;
		};
		return solve(0, constraints.map((budget) => budget.count));
	}
	function collectHiddenHandCoverage(slots, countKnownSlots) {
		const packagesByGroup = new Map();
		const unresolvedSeats = new Set();
		for (const slot of slots) {
			if (slot.location.type !== "player") continue;
			const seatID = slot.location.seatID;
			if (slot.remainingMin !== slot.remainingMax && slot.candidateCards.some((card) => !card.isKnown)) unresolvedSeats.add(seatID);
			if (slot.remainingMin === 0) continue;
			const knownCount = countKnownSlots(seatID, slot.candidateCards.filter((card) => card.isKnown));
			const hiddenCards = slot.candidateCards.filter((card) => !card.isKnown);
			const count = Math.min(hiddenCards.length, Math.max(0, slot.remainingMin - knownCount));
			if (count === 0) continue;
			const coverage = packagesByGroup.get(slot.group) ?? {
				coverageBySeat: new Map(),
				hiddenCards: new Set(),
				hiddenCardsBySeat: new Map()
			};
			coverage.coverageBySeat.set(seatID, (coverage.coverageBySeat.get(seatID) ?? 0) + count);
			const seatCards = coverage.hiddenCardsBySeat.get(seatID) ?? new Set();
			hiddenCards.forEach((card) => {
				seatCards.add(card);
				coverage.hiddenCards.add(card);
			});
			coverage.hiddenCardsBySeat.set(seatID, seatCards);
			packagesByGroup.set(slot.group, coverage);
		}
		const coverageBySeat = new Map();
		collectCoverageComponents(Array.from(packagesByGroup.values())).forEach((component) => {
			if (addCoverageComponent(component, coverageBySeat)) return;
			component.forEach((coverage) => coverage.coverageBySeat.forEach((_, seatID) => {
				unresolvedSeats.add(seatID);
			}));
		});
		return {
			coveredBySeat: coverageBySeat,
			unresolvedSeats
		};
	}
	function haveHiddenCardOverlap(left, right) {
		for (const card of left.hiddenCards) if (right.hiddenCards.has(card)) return true;
		return false;
	}
	function collectCoverageComponents(packages) {
		const remaining = new Set(packages);
		const components = [];
		while (remaining.size > 0) {
			const first = remaining.values().next().value;
			const component = [];
			const queue = [first];
			remaining.delete(first);
			while (queue.length > 0) {
				const current = queue.pop();
				if (!current) continue;
				component.push(current);
				for (const candidate of remaining) {
					if (!haveHiddenCardOverlap(current, candidate)) continue;
					remaining.delete(candidate);
					queue.push(candidate);
				}
			}
			components.push(component);
		}
		return components;
	}
	function addCoverageComponent(component, coverageBySeat) {
		const requiredBySeat = new Map();
		const eligibleCardsBySeat = new Map();
		component.forEach((coveragePackage) => {
			coveragePackage.coverageBySeat.forEach((count, seatID) => {
				requiredBySeat.set(seatID, Math.max(requiredBySeat.get(seatID) ?? 0, count));
				const eligibleCards = eligibleCardsBySeat.get(seatID) ?? new Set();
				coveragePackage.hiddenCardsBySeat.get(seatID)?.forEach((card) => eligibleCards.add(card));
				eligibleCardsBySeat.set(seatID, eligibleCards);
			});
		});
		const slots = Array.from(requiredBySeat.entries()).flatMap(([seatID, count]) => Array.from({ length: count }, () => ({
			seatID,
			eligibleCards: eligibleCardsBySeat.get(seatID) ?? new Set()
		}))).sort((left, right) => left.eligibleCards.size - right.eligibleCards.size);
		const matchedSlotByCard = new Map();
		const matchSlot = (slotIndex, visitedCards) => {
			for (const card of slots[slotIndex].eligibleCards) {
				if (visitedCards.has(card)) continue;
				visitedCards.add(card);
				const previousSlotIndex = matchedSlotByCard.get(card);
				if (previousSlotIndex === void 0 || matchSlot(previousSlotIndex, visitedCards)) {
					matchedSlotByCard.set(card, slotIndex);
					return true;
				}
			}
			return false;
		};
		slots.forEach((_, slotIndex) => {
			matchSlot(slotIndex, new Set());
		});
		if (matchedSlotByCard.size < slots.length) return false;
		matchedSlotByCard.forEach((slotIndex) => {
			const seatID = slots[slotIndex].seatID;
			coverageBySeat.set(seatID, (coverageBySeat.get(seatID) ?? 0) + 1);
		});
		return true;
	}
	var Player = class {
		isShown = true;
		generals = [];
		figure = 0;
		constructor(seatID, room) {
			this.seatID = seatID;
			this.room = room;
			this.fixedViewId = void 0;
			this.hasObservedHandCount = false;
			this.observedHandCount = 0;
			this.unknownCardCount = 0;
			this.knownHandCards = [];
			this.candidateHandCards = [];
			this.equipCards = [];
			this.judgeCards = [];
			this.markCards = new Map();
		}
		syncObservedHandCount(count) {
			this.hasObservedHandCount = true;
			this.observedHandCount = Math.max(0, Number(count) || 0);
			this.refreshUnknownCardCount();
		}
		applyObservedHandCountDelta(delta) {
			const nextCount = this.observedHandCount + delta;
			if (!this.hasObservedHandCount && nextCount < 0) return;
			this.syncObservedHandCount(nextCount);
		}
		refreshUnknownCardCount(allocation) {
			if (!this.hasObservedHandCount) return false;
			const nextUnknownCount = (allocation ?? this.getHandSlotAllocation()).unknownCardCount;
			const changed = this.unknownCardCount !== nextUnknownCount;
			this.unknownCardCount = nextUnknownCount;
			return changed;
		}
		getHandSlotAllocation() {
			return computeHandSlotAllocation(this.room, [this.seatID]).get(this.seatID);
		}
		getKnownHandSlotCount() {
			return this.getHandSlotAllocation().exactKnownCount;
		}
		getCandidateHandSlotCount() {
			return this.getHandSlotAllocation().candidateKnownUpperBound;
		}
		get cards() {
			return this.room.cards.filter((card) => card.location === "player" && card.seats.has(this.seatID));
		}
		getMarkCardsBySpell(spellID) {
			return this.markCards.get(spellID) ?? [];
		}
		reset() {
			this.isShown = true;
			this.hasObservedHandCount = false;
			this.observedHandCount = 0;
			this.unknownCardCount = 0;
			this.fixedViewId = void 0;
			this.knownHandCards = [];
			this.candidateHandCards = [];
			this.equipCards = [];
			this.judgeCards = [];
			this.markCards.clear();
			this.generals.length = 0;
		}
	};
	var ExchangeBatch = class {
		key;
		zone;
		members = [];
		pendingSnapshot = null;
		constructor(key, zone) {
			this.key = key;
			this.zone = zone;
		}
		get cards() {
			if (this.pendingSnapshot) {
				const candidates = this.candidateCards;
				const captured = this.zone.cards.filter((card) => !this.pendingSnapshot.has(card));
				this.members = [...new Set([...captured, ...candidates])];
				this.pendingSnapshot = null;
			}
			return this.members.filter((card) => card.location === "exchange" && this.zone.cards.includes(card));
		}
		get candidateCards() {
			return this.members.filter((card) => card.locationCandidates.some((candidate) => candidate.type === "outside" && candidate.zone === "exchange" && candidate.batchID === this.key));
		}
		stage(cards) {
			this.members = [...new Set(cards)];
			this.pendingSnapshot = null;
		}
		captureNextMove() {
			this.pendingSnapshot = new Set(this.zone.cards);
		}
		transferTo(target, cards, position = POSITION_TOP) {
			const selected = new Set(cards);
			this.members = [...new Set([...this.cards, ...this.candidateCards])].filter((card) => !selected.has(card));
			const targetCards = target.cards.filter((card) => !selected.has(card));
			const candidates = target.candidateCards.filter((card) => !selected.has(card));
			const inserted = insertCardsAtProtocolPosition(targetCards, cards, position);
			if (!inserted) targetCards.push(...cards);
			target.members = [...new Set([...targetCards, ...candidates])];
			return inserted;
		}
		replaceCard(previous, next) {
			this.members = this.members.map((card) => card === previous ? next : card);
		}
		completeMove() {
			this.members = [...new Set([...this.cards, ...this.candidateCards])];
		}
		clear() {
			this.members = [];
			this.pendingSnapshot = null;
		}
	};
	var Zone = class {
		exchangeBatches = new Map();
		getExchangeBatch(key) {
			if (this.zoneID !== "exchange") throw new Error("命名交换批次只能属于 exchange 区");
			let batch = this.exchangeBatches.get(key);
			if (!batch) {
				batch = new ExchangeBatch(key, this);
				this.exchangeBatches.set(key, batch);
			}
			return batch;
		}
		deleteExchangeBatch(key) {
			this.exchangeBatches.get(key)?.clear();
			this.exchangeBatches.delete(key);
		}
		completeExchangeMove() {
			this.exchangeBatches.forEach((batch) => batch.completeMove());
		}
		constructor(zoneID, room) {
			this.zoneID = zoneID;
			this.room = room;
			this._orderedCards = [];
		}
		get cards() {
			return this._orderedCards;
		}
		removeCard(card) {
			const idx = this._orderedCards.indexOf(card);
			if (idx === -1) return false;
			this._orderedCards.splice(idx, 1);
			this.room.markPublicZoneDirty(this.zoneID);
			return true;
		}
		replaceCard(oldCard, nextCard) {
			this.exchangeBatches.forEach((batch) => batch.replaceCard(oldCard, nextCard));
			this.room.zones.forEach((zone) => {
				if (zone !== this) zone.removeCard(nextCard);
			});
			if (nextCard !== oldCard) this.removeCard(nextCard);
			const idx = this._orderedCards.indexOf(oldCard);
			if (idx === -1) {
				this._orderedCards.push(nextCard);
				this.room.markPublicZoneDirty(this.zoneID);
				return false;
			}
			this._orderedCards[idx] = nextCard;
			this.room.markPublicZoneDirty(this.zoneID);
			return true;
		}
		add(nodes, position = POSITION_TOP) {
			const cardsToAdd = Array.isArray(nodes) ? nodes : [nodes];
			cardsToAdd.forEach((card) => {
				this.room.zones.forEach((zone) => {
					if (zone !== this) zone.removeCard(card);
				});
				card.moveToPublicZone(this.zoneID);
				this.removeCard(card);
			});
			if (!insertCardsAtProtocolPosition(this._orderedCards, cardsToAdd, position)) this._orderedCards.push(...cardsToAdd);
			if (cardsToAdd.length > 0) this.room.markPublicZoneDirty(this.zoneID);
		}
		replaceAll(cards, position = POSITION_TOP) {
			const orderedCards = position === 0 ? [...cards].reverse() : [...cards];
			const incomingCards = new Set(orderedCards);
			const currentCards = new Set(this._orderedCards);
			this.room.zones.forEach((zone) => {
				if (zone === this) return;
				zone._orderedCards = zone._orderedCards.filter((card) => !incomingCards.has(card));
			});
			this._orderedCards.forEach((card) => {
				if (!incomingCards.has(card)) card.moveToPublicZone("exile");
			});
			orderedCards.forEach((card) => {
				if (!currentCards.has(card) || card.location !== this.zoneID) card.moveToPublicZone(this.zoneID);
			});
			this._orderedCards = orderedCards;
			this.room.zones.forEach((_zone, zoneID) => this.room.markPublicZoneDirty(zoneID));
		}
		remove(count, position = POSITION_TOP) {
			const zoneCards = this._orderedCards;
			if (zoneCards.length === 0) return [];
			const toRemoveCount = Math.min(count, zoneCards.length);
			let popped;
			if (position === 0) popped = zoneCards.splice(0, toRemoveCount);
			else popped = zoneCards.splice(-toRemoveCount).reverse();
			if (toRemoveCount > 0) this.room.markPublicZoneDirty(this.zoneID);
			return popped;
		}
		clear() {
			this.exchangeBatches.forEach((batch) => batch.clear());
			this.exchangeBatches.clear();
			const hadCards = this._orderedCards.length > 0;
			this._orderedCards.forEach((card) => {
				card.moveToPublicZone("exile");
			});
			this._orderedCards = [];
			if (hadCards) this.room.markPublicZoneDirty(this.zoneID);
		}
	};
	function getPositiveIDs(cardIDs = []) {
		return Array.from(new Set(cardIDs.filter((id) => id > 0)));
	}
	function normalizeIDs(cardIDs) {
		return getPositiveIDs(cardIDs).sort((left, right) => left - right);
	}
	function normalizeCount(count) {
		const normalized = Math.floor(Number(count));
		return Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
	}
	function isInitialPileShuffle(discardCount, deckCardCount) {
		const normalizedDiscardCount = normalizeCount(discardCount);
		const normalizedDeckCardCount = normalizeCount(deckCardCount);
		return normalizedDiscardCount === 0 || normalizedDeckCardCount > 0 && normalizedDiscardCount === normalizedDeckCardCount;
	}
	function cloneCohort(cohort) {
		return {
			generation: cohort.generation,
			candidateIdentityIDs: new Set(cohort.candidateIdentityIDs),
			remainingPileCount: cohort.remainingPileCount
		};
	}
	var PileIdentityLedger = class {
		revision = 0;
		generation = 0;
		identityUniverse = new Set();
		locatedIdentityIDs = new Set();
		knownPileIdentityIDs = new Set();
		knownDiscardIdentityIDs = new Set();
		previousDiscardCount = 0;
		cohorts = [];
		initialize(cardIDs) {
			const identities = normalizeIDs(cardIDs);
			this.revision += 1;
			this.generation = 0;
			this.identityUniverse = new Set(identities);
			this.locatedIdentityIDs.clear();
			this.knownPileIdentityIDs.clear();
			this.knownDiscardIdentityIDs.clear();
			this.previousDiscardCount = 0;
			this.cohorts = identities.length === 0 ? [] : [{
				generation: 0,
				candidateIdentityIDs: new Set(identities),
				remainingPileCount: identities.length
			}];
			this.warnForIssues(this.collectConsistencyIssues(identities.length, "initialize"));
		}
		registerAmbiguousOutsideGroup(cardIDs) {
			const identities = normalizeIDs(cardIDs);
			if (identities.length === 0) return false;
			return this.commit("register:ambiguousOutsideGroup", () => {
				identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
				this.cohorts.push({
					generation: this.generation,
					candidateIdentityIDs: new Set(identities),
					remainingPileCount: 0
				});
			});
		}
		applyMove(move) {
			let shuffleTransition;
			const committed = this.commit(`move:${move.eventType}`, () => {
				const cardIDs = normalizeIDs(move.cardIDs);
				const knownCount = cardIDs.length;
				const protocolUnknownCount = Math.max(0, normalizeCount(move.cardCount) - knownCount);
				const knownPileIdentityIDsConsumed = move.fromZone === 1 && cardIDs.length === 0 ? normalizeIDs(move.knownPileIdentityIDsConsumed ?? []) : [];
				const maxAnonymousPileConsumptionCount = Math.max(0, protocolUnknownCount - knownPileIdentityIDsConsumed.length);
				const anonymousPileConsumptionCount = move.fromZone === 1 && cardIDs.length === 0 ? Math.min(maxAnonymousPileConsumptionCount, normalizeCount(move.anonymousPileConsumptionCount ?? maxAnonymousPileConsumptionCount)) : protocolUnknownCount;
				if (move.eventType === "noop") {
					this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter);
					this.previousDiscardCount = normalizeCount(move.discardCountAfter);
					return;
				}
				if (move.eventType === "shuffleDiscardIntoPile") {
					shuffleTransition = this.createShuffleTransition(move);
					this.applyShuffleInternal(move.pileCountAfter, shuffleTransition);
					this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter);
					this.reconcilePileCountInternal(move.pileCountAfter);
					this.previousDiscardCount = normalizeCount(move.discardCountAfter);
					return;
				}
				if (move.fromZone === 1 && move.toZone === 1) {
					if (move.toPosition === 65282 && (move.eventType === "moveKnown" || move.eventType === "moveUnknown")) {
						this.insertKnownInternal(cardIDs, cardIDs.length, POSITION_RANDOM);
						this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter);
						this.reconcilePileCountInternal(move.pileCountAfter);
						this.previousDiscardCount = normalizeCount(move.discardCountAfter);
						return;
					}
					cardIDs.forEach((cardID) => this.revealIdentityInPileInternal(cardID));
					this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter);
					this.reconcilePileCountInternal(move.pileCountAfter);
					this.previousDiscardCount = normalizeCount(move.discardCountAfter);
					return;
				}
				if (move.fromZone === 1) {
					cardIDs.forEach((cardID) => this.revealIdentityFromPileInternal(cardID));
					knownPileIdentityIDsConsumed.forEach((cardID) => this.revealIdentityFromPileInternal(cardID));
					if (anonymousPileConsumptionCount > 0) if (move.moveType === 18 && move.spellID === 7011 && move.fromPosition !== 65282) this.consumeAnonymousTopRangeInternal(anonymousPileConsumptionCount);
					else if (move.moveType === 18) this.consumeAnonymousInternal(anonymousPileConsumptionCount, POSITION_RANDOM);
					else this.consumeAnonymousInternal(anonymousPileConsumptionCount, move.fromPosition);
				} else if (move.toZone === 1) {
					if (cardIDs.length > 0) this.insertKnownInternal(cardIDs, cardIDs.length, move.toPosition);
					if (protocolUnknownCount > 0) this.degradeToSingleCohortInternal(move.pileCountAfter);
				} else cardIDs.forEach((cardID) => this.revealIdentityOutsidePileInternal(cardID));
				if (move.fromZone === 2) cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.delete(cardID));
				if (move.toZone === 2) cardIDs.forEach((cardID) => this.knownDiscardIdentityIDs.add(cardID));
				this.confirmVisiblePileIdentitiesInternal(move.visiblePileIdentityIDsAfter);
				this.reconcilePileCountInternal(move.pileCountAfter);
				this.previousDiscardCount = normalizeCount(move.discardCountAfter);
			});
			this.warnForIssues(this.collectConsistencyIssues(move.pileCountAfter, `move:${move.eventType}`));
			return committed && shuffleTransition ? {
				committed,
				shuffleTransition
			} : { committed };
		}
		applyReveal(reveal) {
			this.commit(`reveal:${reveal.location}`, () => {
				normalizeIDs(reveal.cardIDs).forEach((cardID) => {
					if (reveal.location === "pile") {
						this.revealIdentityInPileInternal(cardID);
						return;
					}
					this.revealIdentityOutsidePileInternal(cardID);
					if (reveal.location === "discard") {
						this.knownDiscardIdentityIDs.add(cardID);
						return;
					}
					this.knownDiscardIdentityIDs.delete(cardID);
				});
				this.reconcilePileCountInternal(reveal.pileCountAfter);
				this.previousDiscardCount = normalizeCount(reveal.discardCountAfter);
			});
			this.warnForIssues(this.collectConsistencyIssues(reveal.pileCountAfter, `reveal:${reveal.location}`));
		}
		consumeAnonymous(count, position, reason) {
			this.commit(reason, () => this.consumeAnonymousInternal(count, position));
		}
		revealIdentity(cardID, source, reason, staysInPile = false) {
			this.commit(reason, () => {
				if (source === "pile" && staysInPile) this.revealIdentityInPileInternal(cardID);
				else if (source === "pile") this.revealIdentityFromPileInternal(cardID);
				else this.revealIdentityOutsidePileInternal(cardID);
			});
		}
		insertKnown(cardIDs, count, position, reason) {
			this.commit(reason, () => this.insertKnownInternal(cardIDs, count, position));
		}
		anonymizeKnownPileIdentities(cardIDs, reason) {
			const identities = normalizeIDs(cardIDs).filter((cardID) => this.knownPileIdentityIDs.has(cardID));
			if (identities.length === 0) return;
			this.commit(reason, () => this.insertKnownInternal(identities, identities.length, POSITION_RANDOM));
		}
		insertAnonymous(count, position, reason) {
			this.commit(reason, () => this.insertAnonymousInternal(count, position));
		}
		mergeAll(reason) {
			this.commit(reason, () => {
				this.mergeAllCohortsInternal();
			});
		}
		rotateFromDiscard(cardIDs, reason) {
			this.commit(reason, () => this.rotateFromDiscardInternal(cardIDs));
		}
		assertConsistency(pileCount, context, roomPartition) {
			const issues = this.collectConsistencyIssues(pileCount, context, roomPartition);
			this.warnForIssues(issues);
			return issues;
		}
		getSnapshot() {
			const cohort = this.projectCohorts();
			return {
				revision: this.revision,
				identityUniverseIDs: normalizeIDs(Array.from(this.identityUniverse)),
				locatedIdentityIDs: normalizeIDs(Array.from(this.locatedIdentityIDs)),
				knownPileIdentityIDs: normalizeIDs(Array.from(this.knownPileIdentityIDs)),
				knownDiscardIdentityIDs: normalizeIDs(Array.from(this.knownDiscardIdentityIDs)),
				hiddenPileSlotCount: this.getHiddenPileSlotCount(),
				accountedPileCount: this.getAccountedPileCount(),
				cohort
			};
		}
		getUnresolvedIdentityIDs() {
			const identityIDs = new Set();
			this.cohorts.forEach((cohort) => {
				cohort.candidateIdentityIDs.forEach((cardID) => identityIDs.add(cardID));
			});
			return normalizeIDs(Array.from(identityIDs));
		}
		createShuffleTransition(move) {
			const discardCountBefore = normalizeCount(move.discardCountBefore ?? this.previousDiscardCount);
			const recycledIdentityIDs = normalizeIDs(move.knownDiscardIdentityIDsBefore ?? [...this.knownDiscardIdentityIDs]);
			const closesGeneration = !isInitialPileShuffle(discardCountBefore, this.identityUniverse.size);
			const ambiguousDiscardRecycleGroups = (move.ambiguousDiscardRecycleGroups ?? []).map((group) => ({
				candidateIdentityIDs: normalizeIDs(group.candidateIdentityIDs),
				recycledCount: Math.min(normalizeCount(group.recycledCount), normalizeIDs(group.candidateIdentityIDs).length)
			})).filter((group) => group.candidateIdentityIDs.length > 0 && group.recycledCount > 0);
			const ambiguousIdentityIDs = new Set(ambiguousDiscardRecycleGroups.flatMap((group) => group.candidateIdentityIDs));
			return {
				closesGeneration,
				discardCountBefore,
				expiringIdentityIDs: closesGeneration ? this.getUnresolvedIdentityIDs().filter((cardID) => !ambiguousIdentityIDs.has(cardID)) : [],
				recycledIdentityIDs,
				ambiguousDiscardRecycleGroups
			};
		}
		applyShuffleInternal(pileCountAfter, transition) {
			const discardCountBefore = transition.discardCountBefore;
			const recycledIdentityIDs = transition.recycledIdentityIDs;
			const ambiguousDiscardRecycleGroups = transition.ambiguousDiscardRecycleGroups;
			const ambiguousRecycledCount = ambiguousDiscardRecycleGroups.reduce((total, group) => total + normalizeCount(group.recycledCount), 0);
			const anonymousDiscardCount = Math.max(0, discardCountBefore - recycledIdentityIDs.length - ambiguousRecycledCount);
			if (!transition.closesGeneration) {
				if (discardCountBefore > 0 || recycledIdentityIDs.length > 0 || ambiguousRecycledCount > 0) {
					recycledIdentityIDs.forEach((cardID) => this.prepareIdentityForPile(cardID));
					if (recycledIdentityIDs.length > 0) this.cohorts.push({
						generation: this.generation,
						candidateIdentityIDs: new Set(recycledIdentityIDs),
						remainingPileCount: Math.min(discardCountBefore, recycledIdentityIDs.length)
					});
					ambiguousDiscardRecycleGroups.forEach((group) => {
						const identities = normalizeIDs(group.candidateIdentityIDs);
						identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
						if (identities.length === 0) return;
						this.cohorts.push({
							generation: this.generation,
							candidateIdentityIDs: new Set(identities),
							remainingPileCount: Math.min(normalizeCount(group.recycledCount), identities.length)
						});
					});
					this.knownDiscardIdentityIDs.clear();
				}
				this.reconcilePileCountInternal(pileCountAfter);
				return;
			}
			this.rotateFromDiscardInternal(recycledIdentityIDs);
			let recycledCohort = this.cohorts[0]?.generation === this.generation ? this.cohorts[0] : void 0;
			ambiguousDiscardRecycleGroups.forEach((group) => {
				const identities = normalizeIDs(group.candidateIdentityIDs);
				identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
				if (identities.length === 0) return;
				const recycledCount = Math.min(normalizeCount(group.recycledCount), identities.length);
				if (!recycledCohort) {
					recycledCohort = {
						generation: this.generation,
						candidateIdentityIDs: new Set(identities),
						remainingPileCount: recycledCount
					};
					this.cohorts.unshift(recycledCohort);
					return;
				}
				const targetCohort = recycledCohort;
				identities.forEach((cardID) => targetCohort.candidateIdentityIDs.add(cardID));
				const mergedRemainingPileCount = targetCohort.remainingPileCount + recycledCount;
				targetCohort.remainingPileCount = Math.min(mergedRemainingPileCount, targetCohort.candidateIdentityIDs.size);
			});
			this.knownDiscardIdentityIDs.clear();
			if (anonymousDiscardCount > 0) {
				this.degradeToSingleCohortInternal(pileCountAfter);
				return;
			}
			this.reconcilePileCountInternal(pileCountAfter);
		}
		consumeAnonymousInternal(count, position) {
			const normalizedCount = normalizeCount(count);
			if (normalizedCount === 0) return;
			if (position === 65282) {
				this.degradeToSingleCohortInternal(Math.max(0, this.getAccountedPileCount() - normalizedCount));
				return;
			}
			let remaining = normalizedCount;
			const indexes = position === 0 ? Array.from({ length: this.cohorts.length }, (_, index) => index) : Array.from({ length: this.cohorts.length }, (_, index) => this.cohorts.length - 1 - index);
			for (const index of indexes) {
				if (remaining === 0) break;
				const cohort = this.cohorts[index];
				const consumed = Math.min(cohort.remainingPileCount, remaining);
				cohort.remainingPileCount -= consumed;
				remaining -= consumed;
			}
			if (remaining > 0) {
				this.degradeToSingleCohortInternal(Math.max(0, this.getAccountedPileCount() - remaining));
				this.warn("unexplained-pile-consumption", {
					requestedCount: normalizedCount,
					unaccountedCount: remaining
				});
			}
		}
		consumeAnonymousTopRangeInternal(count) {
			if (this.cohorts.filter((cohort) => cohort.remainingPileCount > 0).length > 1) this.degradeToSingleCohortInternal(this.getAccountedPileCount());
			this.consumeAnonymousInternal(count, POSITION_TOP);
		}
		revealIdentityFromPileInternal(cardID) {
			if (!(cardID > 0)) return;
			this.identityUniverse.add(cardID);
			this.locatedIdentityIDs.add(cardID);
			if (this.knownPileIdentityIDs.delete(cardID)) return;
			const cohort = this.findIdentityCohort(cardID);
			if (!cohort) {
				this.warn("revealed-pile-identity-without-cohort", { cardID });
				return;
			}
			if (cohort.remainingPileCount <= 0) this.warn("revealed-pile-identity-from-empty-cohort", { cardID });
			else cohort.remainingPileCount -= 1;
			cohort.candidateIdentityIDs.delete(cardID);
			this.removeEmptyCohorts();
		}
		revealIdentityOutsidePileInternal(cardID) {
			if (!(cardID > 0)) return;
			this.identityUniverse.add(cardID);
			this.locatedIdentityIDs.add(cardID);
			if (this.knownPileIdentityIDs.delete(cardID)) return;
			const cohort = this.findIdentityCohort(cardID);
			if (!cohort) return;
			if (cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) {
				cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1);
				this.warn("outside-reveal-from-all-in-cohort", { cardID });
			}
			cohort.candidateIdentityIDs.delete(cardID);
			this.removeEmptyCohorts();
		}
		revealIdentityInPileInternal(cardID) {
			if (!(cardID > 0) || this.knownPileIdentityIDs.has(cardID)) return;
			this.identityUniverse.add(cardID);
			this.locatedIdentityIDs.add(cardID);
			const cohort = this.findIdentityCohort(cardID);
			if (cohort) {
				if (cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1;
				else this.warn("pile-reveal-from-empty-cohort", { cardID });
				cohort.candidateIdentityIDs.delete(cardID);
				this.removeEmptyCohorts();
			}
			this.knownPileIdentityIDs.add(cardID);
		}
		confirmVisiblePileIdentitiesInternal(cardIDs) {
			normalizeIDs(cardIDs ?? []).forEach((cardID) => this.revealIdentityInPileInternal(cardID));
		}
		insertKnownInternal(cardIDs, count, position) {
			const identities = normalizeIDs(cardIDs);
			if (identities.length === 0) {
				this.insertAnonymousInternal(count, position);
				return;
			}
			if (position === 65282) {
				identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
				const merged = this.mergeAllCohortsInternal();
				identities.forEach((cardID) => merged.candidateIdentityIDs.add(cardID));
				merged.remainingPileCount += identities.length;
			} else {
				identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
				identities.forEach((cardID) => this.revealIdentityInPileInternal(cardID));
			}
			const anonymousCount = Math.max(0, normalizeCount(count) - identities.length);
			if (anonymousCount > 0) this.insertAnonymousInternal(anonymousCount, position);
		}
		insertAnonymousInternal(count, _position) {
			const normalizedCount = normalizeCount(count);
			if (normalizedCount === 0) return;
			const merged = this.mergeAllCohortsInternal();
			this.addUnresolvedUniverseToCohort(merged);
			const targetCount = merged.remainingPileCount + normalizedCount;
			merged.remainingPileCount = Math.min(targetCount, merged.candidateIdentityIDs.size);
			if (targetCount > merged.candidateIdentityIDs.size) this.warn("anonymous-pile-insertion-capacity-shortage", {
				targetCount,
				candidateCount: merged.candidateIdentityIDs.size
			});
		}
		prepareIdentityForPile(cardID) {
			this.identityUniverse.add(cardID);
			this.locatedIdentityIDs.delete(cardID);
			this.knownDiscardIdentityIDs.delete(cardID);
			this.knownPileIdentityIDs.delete(cardID);
			this.removeIdentityFromCohorts(cardID, false);
		}
		rotateFromDiscardInternal(cardIDs) {
			const identities = normalizeIDs(cardIDs);
			identities.forEach((cardID) => this.prepareIdentityForPile(cardID));
			this.generation += 1;
			if (identities.length > 0) this.cohorts.unshift({
				generation: this.generation,
				candidateIdentityIDs: new Set(identities),
				remainingPileCount: identities.length
			});
		}
		reconcilePileCountInternal(pileCountAfter) {
			const targetPileCount = normalizeCount(pileCountAfter);
			if (Math.max(0, targetPileCount - this.knownPileIdentityIDs.size) === this.getHiddenPileSlotCount()) return;
			this.degradeToSingleCohortInternal(targetPileCount);
		}
		degradeToSingleCohortInternal(pileCountAfter) {
			const merged = this.mergeAllCohortsInternal();
			this.addUnresolvedUniverseToCohort(merged);
			const targetHiddenCount = Math.max(0, normalizeCount(pileCountAfter) - this.knownPileIdentityIDs.size);
			merged.remainingPileCount = Math.min(targetHiddenCount, merged.candidateIdentityIDs.size);
			if (targetHiddenCount > merged.candidateIdentityIDs.size) this.warn("pile-identity-capacity-shortage", {
				targetHiddenCount,
				candidateCount: merged.candidateIdentityIDs.size
			});
		}
		addUnresolvedUniverseToCohort(cohort) {
			this.identityUniverse.forEach((cardID) => {
				if (this.locatedIdentityIDs.has(cardID) || this.knownPileIdentityIDs.has(cardID)) return;
				cohort.candidateIdentityIDs.add(cardID);
			});
		}
		mergeAllCohortsInternal() {
			const merged = {
				generation: this.generation,
				candidateIdentityIDs: new Set(),
				remainingPileCount: 0
			};
			this.cohorts.forEach((cohort) => {
				cohort.candidateIdentityIDs.forEach((cardID) => merged.candidateIdentityIDs.add(cardID));
				merged.remainingPileCount += cohort.remainingPileCount;
			});
			this.cohorts = [merged];
			return merged;
		}
		removeIdentityFromCohorts(cardID, wasInPile) {
			const cohort = this.findIdentityCohort(cardID);
			if (!cohort) return;
			if (wasInPile && cohort.remainingPileCount > 0) cohort.remainingPileCount -= 1;
			if (!wasInPile && cohort.candidateIdentityIDs.size <= cohort.remainingPileCount) cohort.remainingPileCount = Math.max(0, cohort.remainingPileCount - 1);
			cohort.candidateIdentityIDs.delete(cardID);
			this.removeEmptyCohorts();
		}
		findIdentityCohort(cardID) {
			return this.cohorts.find((cohort) => cohort.candidateIdentityIDs.has(cardID));
		}
		removeEmptyCohorts() {
			this.cohorts = this.cohorts.filter((cohort) => cohort.candidateIdentityIDs.size > 0);
		}
		getHiddenPileSlotCount() {
			return this.cohorts.reduce((sum, cohort) => sum + cohort.remainingPileCount, 0);
		}
		getAccountedPileCount() {
			return this.knownPileIdentityIDs.size + this.getHiddenPileSlotCount();
		}
		projectCohorts() {
			const groups = [];
			const definitelyInPileIDs = new Set(this.knownPileIdentityIDs);
			const definitelyOutsidePileIDs = new Set();
			let flatCandidateWidth = 0;
			this.cohorts.forEach((cohort) => {
				const cardIDs = normalizeIDs(Array.from(cohort.candidateIdentityIDs));
				if (cardIDs.length === 0) return;
				const kind = cohort.remainingPileCount === 0 ? "none-in-pile" : cohort.remainingPileCount === cardIDs.length ? "all-in-pile" : "partial";
				groups.push({
					generation: cohort.generation,
					kind,
					cardIDs,
					remainingPileCount: cohort.remainingPileCount
				});
				if (kind === "all-in-pile") {
					cardIDs.forEach((cardID) => definitelyInPileIDs.add(cardID));
					return;
				}
				if (kind === "none-in-pile") {
					cardIDs.forEach((cardID) => definitelyOutsidePileIDs.add(cardID));
					return;
				}
				flatCandidateWidth += cardIDs.length;
			});
			return {
				generation: this.generation,
				groups,
				definitelyInPileIDs: normalizeIDs(Array.from(definitelyInPileIDs)),
				definitelyOutsidePileIDs: normalizeIDs(Array.from(definitelyOutsidePileIDs)),
				flatCandidateWidth
			};
		}
		collectConsistencyIssues(pileCount, context, roomPartition) {
			const issues = [];
			const seen = new Set();
			this.cohorts.forEach((cohort) => {
				if (cohort.remainingPileCount < 0 || cohort.remainingPileCount > cohort.candidateIdentityIDs.size) issues.push({
					context,
					reason: "cohort-cardinality-out-of-range",
					expected: cohort.candidateIdentityIDs.size,
					actual: cohort.remainingPileCount
				});
				cohort.candidateIdentityIDs.forEach((cardID) => {
					if (seen.has(cardID)) issues.push({
						context,
						reason: "duplicate-cohort-identity",
						cardID
					});
					if (!this.identityUniverse.has(cardID)) issues.push({
						context,
						reason: "cohort-identity-missing-from-universe",
						cardID
					});
					if (this.locatedIdentityIDs.has(cardID)) issues.push({
						context,
						reason: "located-identity-in-cohort",
						cardID
					});
					if (this.knownPileIdentityIDs.has(cardID)) issues.push({
						context,
						reason: "known-pile-identity-in-cohort",
						cardID
					});
					if (roomPartition && !roomPartition.deckIdentityIDs.has(cardID)) issues.push({
						context,
						reason: "cohort-identity-missing-from-room-universe",
						cardID
					});
					if (roomPartition) {
						const isUnlocated = roomPartition.unlocatedIdentityIDs.has(cardID);
						const isSuspended = roomPartition.suspendedIdentityIDs.has(cardID);
						if (!isUnlocated && !isSuspended) issues.push({
							context,
							reason: "cohort-identity-missing-from-room-partition",
							cardID
						});
						if (isUnlocated && isSuspended) issues.push({
							context,
							reason: "cohort-identity-duplicated-in-room-partition",
							cardID
						});
					}
					seen.add(cardID);
				});
			});
			if (roomPartition) this.locatedIdentityIDs.forEach((cardID) => {
				if (!roomPartition.unlocatedIdentityIDs.has(cardID)) return;
				issues.push({
					context,
					reason: "located-identity-still-unlocated",
					cardID
				});
			});
			const expectedPileCount = normalizeCount(pileCount);
			const actualPileCount = this.getAccountedPileCount();
			if (expectedPileCount !== actualPileCount) issues.push({
				context,
				reason: "pile-count-mismatch",
				expected: expectedPileCount,
				actual: actualPileCount
			});
			return issues;
		}
		commit(reason, update) {
			const previous = this.captureState();
			try {
				update();
				this.assertInternalState(reason);
				this.revision += 1;
				return true;
			} catch (error) {
				this.restoreState(previous);
				this.warn("transaction-rollback", {
					reason,
					error
				});
				return false;
			}
		}
		assertInternalState(context) {
			const issues = this.collectConsistencyIssues(this.getAccountedPileCount(), context).filter((issue) => issue.reason !== "pile-count-mismatch");
			if (issues.length > 0) throw new Error(JSON.stringify(issues));
		}
		captureState() {
			return {
				revision: this.revision,
				generation: this.generation,
				identityUniverse: new Set(this.identityUniverse),
				locatedIdentityIDs: new Set(this.locatedIdentityIDs),
				knownPileIdentityIDs: new Set(this.knownPileIdentityIDs),
				knownDiscardIdentityIDs: new Set(this.knownDiscardIdentityIDs),
				previousDiscardCount: this.previousDiscardCount,
				cohorts: this.cohorts.map(cloneCohort)
			};
		}
		restoreState(state) {
			this.revision = state.revision;
			this.generation = state.generation;
			this.identityUniverse = state.identityUniverse;
			this.locatedIdentityIDs = state.locatedIdentityIDs;
			this.knownPileIdentityIDs = state.knownPileIdentityIDs;
			this.knownDiscardIdentityIDs = state.knownDiscardIdentityIDs;
			this.previousDiscardCount = state.previousDiscardCount;
			this.cohorts = state.cohorts;
		}
		warnForIssues(issues) {
			issues.forEach((issue) => this.warn(issue.reason, { ...issue }));
		}
		warn(reason, detail) {
			trackerLogger.warn("牌堆身份账本异常", {
				reason,
				...detail
			});
		}
	};
	function isAmbiguousKnownCard(card) {
		return card.isKnown === true && card.hasLocationCandidates();
	}
	var AmbiguousKnownIndex = class {
		constructor(room) {
			this.room = room;
			this.items = new Map();
			this.lastConsumedSeq = 0;
			this.containerDependentCards = new Set();
		}
		rebuild(groups = [], options = {}) {
			const { record = true } = options;
			if (record) recordTraversal("ambiguousKnownIndex:rebuild", this.room.trackedCards.length);
			this.items.clear();
			this.containerDependentCards.clear();
			this.room.trackedCards.forEach((card) => {
				const item = this.buildItem(card, this.getRelatedGroups(card, groups));
				if (item) this.items.set(card.id, item);
				if (this.hasContainerLocationCandidates(card)) this.containerDependentCards.add(card);
			});
			this.lastConsumedSeq = this.room.dirtyCardSeq;
		}
		applyDirtyCardEvents(groups = []) {
			const events = this.room.dirtyCardEvents;
			if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) {
				this.rebuild(groups);
				return false;
			}
			const affectedCards = new Set();
			for (const event of events) if (event.seq > this.lastConsumedSeq) affectedCards.add(event.card);
			affectedCards.forEach((card) => this.applyCardChange(card, groups));
			if (this.containerDependentCards.size > 0) {
				for (const card of Array.from(this.containerDependentCards)) if (!affectedCards.has(card)) this.applyCardChange(card, groups);
			}
			recordTraversal("ambiguousKnownIndex:applyDirty", affectedCards.size);
			this.lastConsumedSeq = this.room.dirtyCardSeq;
			return true;
		}
		applyCardChange(card, groups = []) {
			this.items.delete(card.id);
			const item = this.buildItem(card, this.getRelatedGroups(card, groups));
			if (item) this.items.set(card.id, item);
			if (this.hasContainerLocationCandidates(card)) this.containerDependentCards.add(card);
			else this.containerDependentCards.delete(card);
		}
		toComparable(room = this.room) {
			const order = new Map();
			room.cards.forEach((card, index) => order.set(card, index));
			const token = (card) => order.get(card) ?? -card.id;
			return Array.from(this.items.entries()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([cardID, item]) => [
				cardID,
				token(item.card),
				item.candidateSeats.map(Number),
				item.groups.map((group) => String(group.id)).sort(),
				item.description
			]);
		}
		get(cardID) {
			return this.items.get(cardID) ?? null;
		}
		describe(cardID) {
			return this.get(cardID)?.description ?? "";
		}
		formatCardDescription(card, groups) {
			const locations = [];
			if (card.hasLocationCandidates()) {
				const playerCandidates = getPlayerLocationCandidates(card.locationCandidates);
				const containerCandidates = getContainerLocationCandidates(card.locationCandidates);
				const publicCandidates = getPublicLocationCandidates(card.locationCandidates);
				card.locationCandidates.forEach((candidate) => {
					if (candidate.type === "popup") locations.push(`弹窗区${candidate.spaceID}`);
				});
				[...playerCandidates, ...containerCandidates.flatMap((candidate) => this.room.resolveEquipmentContainerLocationCandidates(candidate))].forEach((candidate) => {
					const prefix = this.room.formatSeatPrefix(candidate.seatID);
					locations.push(`${prefix}${getSubZoneName(candidate.subZone)}`);
				});
				publicCandidates.forEach((candidate) => {
					const publicCandidate = toPublicCandidate(candidate, (zone, position, count) => getPublicCandidateLabel(zone, position, count));
					if (publicCandidate?.label) locations.push(publicCandidate.label);
				});
			} else if (card.location === "player" && card.subZone !== null) {
				const zoneName = getSubZoneName(card.subZone);
				Array.from(card.seats).forEach((seatID) => {
					const prefix = this.room.formatSeatPrefix(seatID);
					locations.push(`${prefix}${zoneName}`);
				});
			}
			const sourceLabels = groups.map((group) => {
				if (typeof group.sourceEvent === "string") return group.sourceEvent;
				return group.sourceEvent?.label ?? group.sourceEvent?.type;
			}).filter(Boolean);
			if (sourceLabels.length === 0) return locations.join("/");
			return `${locations.join("/")}（${Array.from(new Set(sourceLabels)).join("/")}）`;
		}
		getRelatedGroups(card, groups) {
			return groups.filter((group) => group.cards.has(card));
		}
		buildItem(card, relatedGroups) {
			if (!isAmbiguousKnownCard(card)) return null;
			return {
				card,
				candidateSeats: Array.from(card.seats, Number).sort((a, b) => a - b),
				groups: relatedGroups,
				description: this.formatCardDescription(card, relatedGroups)
			};
		}
		hasContainerLocationCandidates(card) {
			if (!card.hasLocationCandidates()) return false;
			return getContainerLocationCandidates(card.locationCandidates).length > 0;
		}
	};
	var CARD_INSTANCE_STATUS = {
		UNKNOWN: 0,
		APPEARED: 1,
		DISCARD: 2,
		REMOVED: 3
	};
	var CARD_INSTANCE_STATUSES = [
		CARD_INSTANCE_STATUS.UNKNOWN,
		CARD_INSTANCE_STATUS.APPEARED,
		CARD_INSTANCE_STATUS.DISCARD,
		CARD_INSTANCE_STATUS.REMOVED
	];
	var CardInstance = class extends BaseCard {
		constructor(id) {
			super(id);
			this.status = CARD_INSTANCE_STATUS.UNKNOWN;
		}
	};
	var CardCounter = class {
		statusIndexCache;
		cardsByStatusCache;
		cardInstancesCache;
		registeredCards;
		dirtyCards;
		roomCardCursor;
		constructor(room) {
			this.room = room;
			this.nameIndex = {};
			this.colorIndex = Array.from({ length: 7 }, () => new Set());
			this.numberIndex = Array.from({ length: 14 }, () => new Set());
			this.typeIndex = Array.from({ length: 4 }, () => new Set());
			this.statusIndexCache = this.createStatusIndex();
			this.cardsByStatusCache = this.createCardsByStatus();
			this.querySet = new Set();
			this.cardInstancesCache = [];
			this.registeredCards = new Set();
			this.dirtyCards = new Set();
			this.roomCardCursor = 0;
			this.initInstances();
			this.roomCardCursor = this.room.cards.length;
		}
		get statusIndex() {
			this.update();
			return this.statusIndexCache;
		}
		get cardsByStatus() {
			this.update();
			return this.cardsByStatusCache;
		}
		get cardInstances() {
			this.update();
			return this.cardInstancesCache;
		}
		initInstances() {
			this.room.unlocatedIdentities.forEach((cardID) => {
				this.registerIdentity(cardID);
			});
			this.room.trackedCards.forEach((card) => {
				this.addCard(card);
			});
		}
		addCard(card) {
			if (!card) return;
			this.registerCard(card);
			if (card.id > 0) this.registerIdentity(card.id);
			this.syncCardStatus(card);
			this.dirtyCards.delete(card);
			this.advanceRoomCardCursor();
		}
		markDirty(card) {
			if (!card) return;
			this.dirtyCards.add(card);
		}
		removeCard(card) {
			this.removeCardStatus(card);
			this.registeredCards.delete(card);
			this.dirtyCards.delete(card);
		}
		update() {
			const newRoomCards = this.collectNewRoomCards();
			const newRoomCardSet = new Set(newRoomCards);
			const dirtyCards = Array.from(this.dirtyCards).filter((card) => !newRoomCardSet.has(card));
			if (newRoomCards.length === 0 && dirtyCards.length === 0) return;
			recordTraversal("cardCounter:update", newRoomCards.length + dirtyCards.length);
			newRoomCards.forEach((card) => this.addCard(card));
			dirtyCards.forEach((card) => {
				if (this.registeredCards.has(card)) this.syncCardStatus(card);
				else this.addCard(card);
				this.dirtyCards.delete(card);
			});
		}
		registerCard(card) {
			if (this.registeredCards.has(card)) return false;
			this.registeredCards.add(card);
			return true;
		}
		registerIdentity(cardID) {
			const existing = this.cardInstancesCache[cardID];
			if (existing) return existing;
			const instance = new CardInstance(cardID);
			this.cardInstancesCache[cardID] = instance;
			if (!(instance.name in this.nameIndex)) this.nameIndex[instance.name] = new Set();
			this.nameIndex[instance.name].add(cardID);
			this.colorIndex[instance.color].add(cardID);
			this.numberIndex[instance.number].add(cardID);
			this.typeIndex[instance.type].add(cardID);
			if (instance.color === 3 && instance.number >= 2 && instance.number <= 9) this.numberIndex[0].add(cardID);
			if (instance.spellId === 1) this.colorIndex[Math.ceil(instance.color / 2) + 4].add(cardID);
			this.statusIndexCache[CARD_INSTANCE_STATUS.UNKNOWN].add(cardID);
			return instance;
		}
		collectNewRoomCards() {
			if (this.roomCardCursor > this.room.cards.length) this.roomCardCursor = 0;
			const appendedCards = this.room.cards.slice(this.roomCardCursor);
			if (appendedCards.length > 0) recordTraversal("cardCounter:collectNewRoomCards", appendedCards.length);
			const newCards = appendedCards.filter((card) => !this.registeredCards.has(card));
			this.roomCardCursor = this.room.cards.length;
			return newCards;
		}
		advanceRoomCardCursor() {
			if (this.roomCardCursor > this.room.cards.length) this.roomCardCursor = 0;
			while (this.roomCardCursor < this.room.cards.length && this.registeredCards.has(this.room.cards[this.roomCardCursor])) this.roomCardCursor += 1;
		}
		createStatusIndex() {
			return Array.from(CARD_INSTANCE_STATUSES, () => new Set());
		}
		createCardsByStatus() {
			return Array.from(CARD_INSTANCE_STATUSES, () => new Set());
		}
		getCardStatus(card) {
			if (card.location === "pile" || card.location === "player" && card.subZone === "hand" && card.isKnown !== true) return CARD_INSTANCE_STATUS.UNKNOWN;
			if (card.location === "player" || card.location === "process" || card.location === "exchange" || card.location === "popup" || card.location === "suspended") return CARD_INSTANCE_STATUS.APPEARED;
			if (card.location === "discard") return CARD_INSTANCE_STATUS.DISCARD;
			return CARD_INSTANCE_STATUS.REMOVED;
		}
		syncCardStatus(card) {
			this.removeCardStatus(card);
			this.addCardStatus(card);
		}
		addCardStatus(card) {
			const status = this.getCardStatus(card);
			const instance = card.id > 0 ? this.cardInstancesCache[card.id] ?? null : null;
			this.cardsByStatusCache[status].add(card);
			if (!instance) return;
			instance.status = status;
			if (card.id > 0) this.statusIndexCache[status].add(card.id);
		}
		removeCardStatus(card) {
			this.cardsByStatusCache.forEach((set) => set.delete(card));
			if (card.id > 0) this.statusIndexCache.forEach((set) => set.delete(card.id));
		}
		releaseLocatedIdentityToUnknown(card, previousCardID) {
			if (!(previousCardID > 0) || !card) return;
			this.cardsByStatusCache.forEach((set) => set.delete(card));
			this.statusIndexCache.forEach((set) => set.delete(previousCardID));
			const instance = this.cardInstancesCache[previousCardID];
			if (instance) instance.status = CARD_INSTANCE_STATUS.UNKNOWN;
			this.statusIndexCache[CARD_INSTANCE_STATUS.UNKNOWN].add(previousCardID);
			this.cardsByStatusCache[CARD_INSTANCE_STATUS.UNKNOWN].add(card);
			this.dirtyCards.delete(card);
		}
		query(dimension, key) {
			const index = this[dimension];
			if (index && index[key]) this.querySet = new Set(Array.from(index[key]));
			else this.querySet.clear();
		}
	};
	var CardLocationIndex = class {
		constructor() {
			this.knownHandBySeat = new Map();
			this.candidateHandBySeat = new Map();
			this.equipBySeat = new Map();
			this.judgeBySeat = new Map();
			this.markBySeatAndSpell = new Map();
			this.publicByZone = new Map();
			this.projections = new WeakMap();
			this.cardOrder = new Map();
			this.maxOrder = -1;
			this.lastConsumedSeq = 0;
			this.containerDependentCards = new Set();
		}
		rebuild(room, options = {}) {
			const { record = true } = options;
			if (record) recordTraversal("locationIndex:rebuild", room.trackedCards.length);
			this.knownHandBySeat.clear();
			this.candidateHandBySeat.clear();
			this.equipBySeat.clear();
			this.judgeBySeat.clear();
			this.markBySeatAndSpell.clear();
			this.publicByZone.clear();
			this.projections = new WeakMap();
			this.cardOrder = new Map();
			this.maxOrder = -1;
			this.containerDependentCards = new Set();
			room.zones.forEach((zone, zoneID) => {
				this.publicByZone.set(zoneID, [...zone.cards]);
			});
			room.players.forEach((player) => {
				this.knownHandBySeat.set(player.seatID, []);
				this.candidateHandBySeat.set(player.seatID, []);
				this.equipBySeat.set(player.seatID, []);
				this.judgeBySeat.set(player.seatID, []);
				this.markBySeatAndSpell.set(player.seatID, new Map());
			});
			room.trackedCards.forEach((card, index) => {
				this.cardOrder.set(card, room.getDetachedCardOrder(card) ?? index);
				this.maxOrder = index;
				const targets = this.projectCard(room, card);
				targets.forEach((target) => {
					const list = this.listForTarget(target, true);
					if (list) list.push(card);
				});
				this.projections.set(card, {
					location: card.location,
					targets
				});
				if (this.cardHasContainerCandidates(card)) this.containerDependentCards.add(card);
			});
			this.lastConsumedSeq = room.dirtyCardSeq;
		}
		registerCard(card, order) {
			if (this.cardOrder.has(card) && order === void 0) return;
			const nextOrder = order ?? this.maxOrder + 1;
			this.maxOrder = Math.max(this.maxOrder, nextOrder);
			this.cardOrder.set(card, nextOrder);
		}
		applyDirtyCardEvents(room, options = {}) {
			const events = room.dirtyCardEvents;
			if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) {
				this.rebuild(room);
				return false;
			}
			const affectedCards = new Set();
			for (const event of events) if (event.seq > this.lastConsumedSeq) affectedCards.add(event.card);
			const affectedZones = new Set();
			for (const zoneID of options.dirtyPublicZones ?? []) if (room.zones.has(zoneID)) affectedZones.add(zoneID);
			affectedCards.forEach((card) => {
				const previousLocation = this.projections.get(card)?.location;
				if (previousLocation && room.zones.has(previousLocation)) affectedZones.add(previousLocation);
				this.applyCardChange(room, card);
				if (room.zones.has(card.location)) affectedZones.add(card.location);
			});
			if (this.containerDependentCards.size > 0) {
				for (const card of Array.from(this.containerDependentCards)) if (!affectedCards.has(card)) this.applyCardChange(room, card);
			}
			if (affectedZones.size > 0) this.refreshPublicZones(room, affectedZones);
			recordTraversal("locationIndex:applyDirty", affectedCards.size);
			this.lastConsumedSeq = room.dirtyCardSeq;
			return true;
		}
		applyCardChange(room, card) {
			const previous = this.projections.get(card);
			if (previous) previous.targets.forEach((target) => this.removeProjection(card, target));
			const targets = this.projectCard(room, card);
			targets.forEach((target) => this.insertProjectionOrdered(card, target));
			this.projections.set(card, {
				location: card.location,
				targets
			});
			if (this.cardHasContainerCandidates(card)) this.containerDependentCards.add(card);
			else this.containerDependentCards.delete(card);
		}
		refreshPublicZones(room, zoneIDs) {
			for (const zoneID of zoneIDs) if (room.zones.has(zoneID)) this.publicByZone.set(zoneID, [...room.getZone(zoneID).cards]);
		}
		toComparable(room) {
			const order = new Map();
			room.cards.forEach((card, index) => order.set(card, index));
			const token = (card) => order.get(card) ?? -card.id;
			const bySeat = (map) => Array.from(map.entries()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([seat, cards]) => [Number(seat), cards.map(token)]);
			const mark = Array.from(this.markBySeatAndSpell.entries()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([seat, spellMap]) => [Number(seat), Array.from(spellMap.entries()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([spellID, cards]) => [spellID, cards.map(token)])]);
			const publicByZone = Array.from(this.publicByZone.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([zoneID, cards]) => [String(zoneID), cards.map(token)]);
			return {
				knownHand: bySeat(this.knownHandBySeat),
				candidateHand: bySeat(this.candidateHandBySeat),
				equip: bySeat(this.equipBySeat),
				judge: bySeat(this.judgeBySeat),
				mark,
				public: publicByZone
			};
		}
		cardHasContainerCandidates(card) {
			if (!card.hasLocationCandidates()) return false;
			return getContainerLocationCandidates(card.locationCandidates).length > 0;
		}
		projectCard(room, card) {
			if (card.location !== "player") return [];
			const targets = [];
			const locationCandidates = card.locationCandidates;
			const playerCandidates = getPlayerLocationCandidates(locationCandidates);
			const containerCandidates = getContainerLocationCandidates(locationCandidates).flatMap((candidate) => room.resolveEquipmentContainerLocationCandidates(candidate));
			if (playerCandidates.length > 0 || containerCandidates.length > 0) {
				if (card.isKnown !== true) return targets;
				[...playerCandidates, ...containerCandidates].forEach((candidate) => {
					if (candidate.subZone === "hand") {
						targets.push({
							bucket: "candidateHand",
							seat: Number(candidate.seatID)
						});
						return;
					}
					if (candidate.subZone === "equip" || candidate.subZone === "judge") {
						targets.push({
							bucket: candidate.subZone === "equip" ? "equip" : "judge",
							seat: Number(candidate.seatID)
						});
						return;
					}
					if (candidate.subZone === "mark" && candidate.spellID !== null) targets.push({
						bucket: "mark",
						seat: Number(candidate.seatID),
						spellID: candidate.spellID
					});
				});
				return targets;
			}
			const seats = card.seats;
			if (card.subZone === "hand") {
				if (card.isKnown !== true) return targets;
				if (seats.size === 1) {
					const [seatID] = seats;
					targets.push({
						bucket: "knownHand",
						seat: Number(seatID)
					});
				} else if (seats.size > 1) seats.forEach((seatID) => {
					targets.push({
						bucket: "candidateHand",
						seat: Number(seatID)
					});
				});
				return targets;
			}
			if (card.subZone === "equip" || card.subZone === "judge") {
				if (seats.size !== 1) return targets;
				const [seatID] = seats;
				targets.push({
					bucket: card.subZone === "equip" ? "equip" : "judge",
					seat: Number(seatID)
				});
				return targets;
			}
			if (card.subZone === "mark" && card.spellID !== null) {
				if (card.isKnown !== true) return targets;
				const spellID = card.spellID;
				seats.forEach((seatID) => {
					targets.push({
						bucket: "mark",
						seat: Number(seatID),
						spellID
					});
				});
			}
			return targets;
		}
		listForTarget(target, create) {
			if (target.bucket === "mark") {
				const spellMap = this.markBySeatAndSpell.get(Number(target.seat));
				if (!spellMap) return null;
				let list = spellMap.get(target.spellID);
				if (!list) {
					if (!create) return null;
					list = [];
					spellMap.set(target.spellID, list);
				}
				return list;
			}
			return (target.bucket === "knownHand" ? this.knownHandBySeat : target.bucket === "candidateHand" ? this.candidateHandBySeat : target.bucket === "equip" ? this.equipBySeat : this.judgeBySeat).get(Number(target.seat)) ?? null;
		}
		insertProjectionOrdered(card, target) {
			const list = this.listForTarget(target, true);
			if (list) this.spliceOrdered(list, card);
		}
		removeProjection(card, target) {
			const list = this.listForTarget(target, false);
			if (!list) return;
			const index = list.indexOf(card);
			if (index !== -1) list.splice(index, 1);
			if (target.bucket === "mark" && list.length === 0) this.markBySeatAndSpell.get(Number(target.seat))?.delete(target.spellID);
		}
		spliceOrdered(list, card) {
			const key = this.orderOf(card);
			let index = list.length;
			while (index > 0 && this.orderOf(list[index - 1]) > key) index -= 1;
			list.splice(index, 0, card);
		}
		orderOf(card) {
			const existing = this.cardOrder.get(card);
			if (existing !== void 0) return existing;
			this.registerCard(card);
			return this.cardOrder.get(card) ?? this.maxOrder;
		}
	};
	var PlayerSnapshot = class {
		room;
		snapshot = [];
		members = new Set();
		order = new Map();
		lastConsumedSeq = -1;
		constructor(room) {
			this.room = room;
		}
		get cards() {
			return this.snapshot;
		}
		reset() {
			this.snapshot = [];
			this.members.clear();
			this.order.clear();
			this.lastConsumedSeq = -1;
		}
		registerCard(card, index) {
			this.order.set(card, index);
			if (this.members.has(card)) {
				this.snapshot.splice(this.snapshot.indexOf(card), 1);
				this.insertOrdered(card);
			}
		}
		rebuild() {
			const room = this.room;
			recordTraversal("resolveConstraints:playerSnapshot", room.trackedCards.length);
			this.reset();
			room.trackedCards.forEach((card, index) => {
				this.registerCard(card, room.getDetachedCardOrder(card) ?? index);
				if (card.location === "player") {
					this.snapshot.push(card);
					this.members.add(card);
				}
			});
			this.lastConsumedSeq = room.dirtyCardSeq;
			return this.snapshot;
		}
		refresh() {
			const room = this.room;
			if (this.lastConsumedSeq < 0) return this.rebuild();
			const events = room.dirtyCardEvents;
			if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) return this.rebuild();
			const affectedCards = new Set();
			for (let index = events.length - 1; index >= 0; index -= 1) {
				if (events[index].seq <= this.lastConsumedSeq) break;
				affectedCards.add(events[index].card);
			}
			affectedCards.forEach((card) => {
				const isPlayer = card.location === "player";
				const inSnapshot = this.members.has(card);
				if (isPlayer && !inSnapshot) {
					this.members.add(card);
					this.insertOrdered(card);
				} else if (!isPlayer && inSnapshot) {
					this.members.delete(card);
					const index = this.snapshot.indexOf(card);
					if (index >= 0) this.snapshot.splice(index, 1);
				}
			});
			recordTraversal("resolveConstraints:playerSnapshotIncremental", affectedCards.size);
			this.lastConsumedSeq = room.dirtyCardSeq;
			return this.snapshot;
		}
		insertOrdered(card) {
			const key = this.order.get(card);
			let index = this.snapshot.length;
			while (index > 0 && this.order.get(this.snapshot[index - 1]) > key) index -= 1;
			this.snapshot.splice(index, 0, card);
		}
	};
	var RoomBase = class {
		seatIDs = [];
		size = 0;
		firstID = void 0;
		mySeatID = void 0;
		players = new Map();
		constructor(gameState) {
			this.game = gameState;
		}
		getCurrentTimestamp() {
			return {
				turn: this.game.turn ?? 0,
				round: this.game.round ?? 0,
				phase: this.game.phase ?? 0
			};
		}
		getPlayer(seatID) {
			return this.players.get(seatID);
		}
		setMySeatID(seatID) {
			this.mySeatID = seatID;
			trackerLogger.info("Room 设置主视角座位", { mySeatID: this.mySeatID });
		}
		getMyDisplayID() {
			return this.mySeatID === void 0 ? void 0 : this.getDisplayID(this.mySeatID);
		}
		getMyPlayer() {
			return this.mySeatID === void 0 ? void 0 : this.getPlayer(this.mySeatID);
		}
		setFirstHand(firstID) {
			this.firstID = firstID;
			this.updateFixedViewIds();
			trackerLogger.info("Room 设置先手", { firstID });
		}
		updateFixedViewIds() {
			this.players.forEach((player) => {
				const viewId = this.getFixedViewId(player.seatID);
				player.fixedViewId = viewId !== void 0 ? viewId + 1 : void 0;
			});
		}
		getDisplayID(seatID) {
			return this.getPlayer(seatID)?.fixedViewId;
		}
		formatSeatPrefix(seatID) {
			const displayID = this.getDisplayID(seatID);
			return displayID !== void 0 ? `${displayID}号位` : `座位${seatID}`;
		}
		getFixedViewId(seatID) {
			const shownSeatIDs = this.seatIDs.filter((id) => this.getPlayer(id)?.isShown);
			const targetIndex = shownSeatIDs.indexOf(seatID);
			if (targetIndex < 0) return void 0;
			const firstSeat = this.firstID ?? shownSeatIDs[0];
			const originIndex = shownSeatIDs.indexOf(firstSeat);
			if (originIndex < 0) return void 0;
			return (targetIndex - originIndex + shownSeatIDs.length) % shownSeatIDs.length;
		}
		readSkillState(stateKey) {
			if (!this.isCurrentGameRoom()) return void 0;
			return this.game.readState("tracker", stateKey);
		}
		hasSkillState(stateKey) {
			if (!this.isCurrentGameRoom()) return false;
			return this.game.hasState("tracker", stateKey);
		}
		ensureSkillState(stateKey, createState) {
			if (!this.isCurrentGameRoom()) return createState();
			return this.game.ensureState("tracker", stateKey, createState);
		}
		setSkillState(stateKey, state) {
			if (!this.isCurrentGameRoom()) return;
			this.game.setState("tracker", stateKey, state);
		}
		deleteSkillState(stateKey) {
			if (!this.isCurrentGameRoom()) return;
			this.game.deleteState("tracker", stateKey);
		}
		isCurrentGameRoom() {
			return Object.is(this.game.room, this);
		}
	};
	var ConstraintGroup = class {
		constructor(options = {}) {
			const { id, cards = [], candidateSeats = [], known = false, sourceEvent = null } = options;
			this.id = id;
			this.cards = new Set(cards);
			this.candidateSeats = new Set(candidateSeats.map((seat) => Number(seat)));
			this.expectedSlotsByLocation = this.normalizeExpectedLocationSlots(options.expectedSlotsByLocation ?? new Map());
			this.known = known;
			this.sourceEvent = sourceEvent;
		}
		normalizeExpectedLocationSlots(expectedSlotsByLocation) {
			const entries = expectedSlotsByLocation instanceof Map ? Array.from(expectedSlotsByLocation.entries()) : Object.entries(expectedSlotsByLocation ?? {});
			return new Map(entries.map(([candidate, count]) => {
				const key = typeof candidate === "string" ? createLocationCandidateKey(parseLocationCandidateKey(candidate)) : createLocationCandidateKey(candidate);
				const range = typeof count === "number" ? {
					min: count,
					max: count
				} : count;
				if (!Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max) || range.min < 0 || range.max < range.min) throw new RangeError("位置名额必须为安全整数且满足 0 <= min <= max");
				return [key, {
					min: range.min,
					max: range.max
				}];
			}).filter(([key]) => key));
		}
		addCards(cards) {
			(Array.isArray(cards) ? cards : [cards]).forEach((card) => {
				if (card) this.cards.add(card);
			});
		}
		apply() {
			let changed = false;
			this.cards.forEach((card) => {
				if (this.known && !card.isKnown) {
					card.confirmKnown();
					changed = true;
				}
			});
			return changed;
		}
		resolve() {
			let changed = this.apply();
			const ownerSyncedCards = new Set();
			const slotEntries = this.expectedSlotsByLocation;
			slotEntries.forEach((expectedCount, key) => {
				const location = parseLocationCandidateKey(key);
				if (!location) return;
				const { candidateCards, remainingMin, remainingMax } = getConstraintSlotState(this.cards, location, expectedCount);
				if (remainingMax === 0) {
					candidateCards.forEach((card) => {
						changed = card.removeLocationCandidate(key, "constraintGroup:expectedLocation") || changed;
						ownerSyncedCards.add(card);
					});
					return;
				}
				if (candidateCards.length > remainingMin) return;
				if (!candidateCards.every((card) => card.locationCandidates.every((candidate) => slotEntries.has(createLocationCandidateKey(candidate))))) return;
				candidateCards.forEach((card) => {
					changed = (location.type === "player" || location.type === "popup" ? card.resolveLocationCandidate(location, "constraintGroup:expectedLocation") : card.setLocationCandidates([location], "constraintGroup:expectedLocation")) || changed;
					ownerSyncedCards.add(card);
				});
			});
			this.cards.forEach((card) => {
				if (card.location === "player" && !ownerSyncedCards.has(card)) changed = card.syncOwnerFromSeats("constraintGroup:resolveOwner") || changed;
			});
			return changed;
		}
	};
	var MAX_TRACKED_CANDIDATE_SEATS = 4;
	function areNumberSetsEqual(left, right) {
		if (left.size !== right.size) return false;
		for (const value of left) if (!right.has(value)) return false;
		return true;
	}
	function areSlotMapsEqual(left, right) {
		if (left.size !== right.size) return false;
		for (const [key, value] of left) {
			const other = right.get(key);
			if (!other || other.min !== value.min || other.max !== value.max) return false;
		}
		return true;
	}
	function areSourceEventsEqual(left, right) {
		if (left === right) return true;
		if (left === null || left === void 0 || right === null || right === void 0) return left === right;
		if (typeof left === "string" || typeof right === "string") return left === right;
		return left.type === right.type && left.label === right.label;
	}
	var RoomConstraints = class {
		constructor(room) {
			this.room = room;
		}
		resolveConstraints(diagnostics) {
			const room = this.room;
			let changed = true;
			let limit = 100;
			let overbroadKnownCards = [];
			const handAllocations = new Map();
			let playerCards = room.refreshPlayerSnapshot();
			let playerSnapshotSeq = room.dirtyCardSeq;
			let previousTouchedSeats = null;
			let rounds = 0;
			try {
				while (changed && limit-- > 0) {
					changed = false;
					overbroadKnownCards = [];
					const touchedSeats = new Set();
					room.resolveTouchedSeats = touchedSeats;
					rounds += 1;
					recordTraversal("resolveConstraints:constraint1", playerCards.length);
					for (const card of playerCards) {
						changed = card.syncOwnerFromSeats("room:resolveOwner") || changed;
						if (this.isOverbroadKnownCard(card)) overbroadKnownCards.push(card);
					}
					for (const group of room.constraintGroups.values()) changed = group.resolve() || changed;
					const observedSeatIDs = Array.from(room.players.entries()).filter(([, player]) => player.hasObservedHandCount).map(([seatID]) => seatID);
					if (playerSnapshotSeq !== room.dirtyCardSeq) {
						playerCards = room.refreshPlayerSnapshot();
						playerSnapshotSeq = room.dirtyCardSeq;
					}
					const affectedSeatIDs = this.collectAffectedHandAllocationSeats(observedSeatIDs, previousTouchedSeats, touchedSeats);
					computeHandSlotAllocation(room, affectedSeatIDs, playerCards).forEach((allocation, seatID) => {
						handAllocations.set(seatID, allocation);
					});
					const allocationSeq = room.dirtyCardSeq;
					for (const [seatID, player] of room.players.entries()) {
						if (!affectedSeatIDs.includes(seatID)) continue;
						const allocation = handAllocations.get(seatID);
						changed = player.refreshUnknownCardCount(allocation) || changed;
						const lockedKnownCount = allocation.exactKnownCount;
						if (player.hasObservedHandCount && player.observedHandCount - lockedKnownCount <= 0) {
							recordTraversal("resolveConstraints:constraint3:exclusion", playerCards.length);
							for (const card of playerCards) {
								if (card.location === "player" && card.hasLocationCandidates() && getHandSlotKindForSeat(card, seatID) === "candidate") {
									card.locationCandidates.filter((candidate) => candidate.type === "player" && candidate.seatID === seatID && candidate.subZone === "hand").forEach((candidate) => {
										changed = card.removeLocationCandidate(candidate, "room:unknownQuotaExclusion") || changed;
									});
									continue;
								}
								if (card.location === "player" && card.subZone === "hand" && !card.hasSubZoneCandidates() && card.seats.size > 1 && card.seats.has(seatID)) changed = card.deleteSeat(seatID, "room:unknownQuotaExclusion") || changed;
							}
						}
					}
					const anonymousHandChanges = room.dirtyCardSeq === allocationSeq ? this.reconcileAnonymousHandCards(handAllocations) : {
						created: [],
						released: []
					};
					if (anonymousHandChanges.created.length > 0 || anonymousHandChanges.released.length > 0) changed = true;
					previousTouchedSeats = touchedSeats;
					if (changed && playerSnapshotSeq !== room.dirtyCardSeq) {
						playerCards = room.refreshPlayerSnapshot();
						playerSnapshotSeq = room.dirtyCardSeq;
					}
				}
			} finally {
				room.resolveTouchedSeats = null;
			}
			room.lastResolveRounds = rounds;
			if (rounds > room.maxResolveRounds) room.maxResolveRounds = rounds;
			room.assertPlayerSnapshotConsistency(playerCards);
			if (changed) this.suspendOverbroadKnownCards();
			else this.suspendOverbroadKnownCards(overbroadKnownCards);
			room.locationIndex.applyDirtyCardEvents(room, { dirtyPublicZones: room.dirtyPublicZones });
			room.dirtyPublicZones.clear();
			this.syncViewGroups();
			const constraintGroups = Array.from(room.constraintGroups.values());
			if (room.constraintGroupsDirty) {
				room.ambiguousKnownIndex.rebuild(constraintGroups);
				room.constraintGroupsDirty = false;
			} else room.ambiguousKnownIndex.applyDirtyCardEvents(constraintGroups);
			room.counter.update();
			room.assertConservation("resolveConstraints");
		}
		collectAffectedHandAllocationSeats(observedSeatIDs, previousTouchedSeats, touchedSeats) {
			if (previousTouchedSeats === null) return observedSeatIDs;
			const affectedSeats = new Set([...previousTouchedSeats, ...touchedSeats]);
			if (affectedSeats.size === 0) return [];
			const pendingGroups = new Set(Array.from(this.room.constraintGroups.values(), (group) => {
				const seats = new Set(Array.from(group.cards).flatMap((card) => Array.from(card.seats)));
				group.expectedSlotsByLocation.forEach((_, key) => {
					const location = parseLocationCandidateKey(key);
					if (location?.type === "player" && location.subZone === "hand") seats.add(location.seatID);
				});
				return seats;
			}));
			let expanded = true;
			while (expanded) {
				expanded = false;
				for (const seats of pendingGroups) {
					if (!Array.from(seats).some((seatID) => affectedSeats.has(seatID))) continue;
					pendingGroups.delete(seats);
					seats.forEach((seatID) => affectedSeats.add(seatID));
					expanded = true;
				}
			}
			return observedSeatIDs.filter((seatID) => affectedSeats.has(seatID));
		}
		reconcileAnonymousHandCards(allocations) {
			const room = this.room;
			const created = [];
			const released = [];
			room.players.forEach((player, seatID) => {
				if (!player.hasObservedHandCount) return;
				const allocation = allocations.get(seatID);
				if (!allocation?.canReconcileAnonymous) return;
				const materializationTargets = allocation.exactHiddenCards.filter((card) => card.isAnonymous);
				let materialized = false;
				for (const identity of allocation.detachedKnownCards) {
					const target = materializationTargets.shift();
					if (!target) break;
					room.materialize(identity.id, target);
					room.applyPileIdentityReveal([identity.id]);
					created.push(target);
					materialized = true;
				}
				if (materialized) return;
				const missingCount = allocation.anonymousMissingCount;
				if (missingCount > 0) {
					const placeholders = room.createExternalCards([], missingCount);
					placeholders.forEach((card) => {
						card.bindCandidates([seatID], "hand", null, { known: false });
					});
					created.push(...placeholders);
				}
				let excessCount = allocation.anonymousExcessCount;
				for (const card of allocation.exactHiddenCards) {
					if (excessCount <= 0) break;
					if (card.hasRealIdentity) continue;
					room.removeCardsFromConstraintGroups([card]);
					card.moveToPublicZone("outside");
					released.push(card);
					excessCount -= 1;
				}
			});
			if (created.length > 0 || released.length > 0) trackerLogger.info("匿名手牌实体对账", {
				created: created.map((card) => ({
					entityID: card.entityID,
					seatID: card.resolvedSeat
				})),
				released: released.map((card) => ({ entityID: card.entityID }))
			});
			return {
				created,
				released
			};
		}
		getResolvedExpectedLocationCandidate(card) {
			const possibleLocations = card.getPossibleLocations();
			if (possibleLocations.length === 1 && possibleLocations[0].type === "popup") return possibleLocations[0];
			if (card.hasLocationCandidates()) {
				const locationCandidates = card.locationCandidates;
				return locationCandidates.length === 1 ? locationCandidates[0] : null;
			}
			if (card.location !== "player" || card.owner === null || card.subZone === null) return null;
			return {
				type: "player",
				seatID: card.owner,
				subZone: card.subZone,
				spellID: card.spellID
			};
		}
		replaceCardInConstraintGroups(previousCard, nextCard) {
			if (previousCard === nextCard) return false;
			let changed = false;
			this.room.constraintGroups.forEach((group) => {
				if (!group.cards.has(previousCard)) return;
				group.cards.delete(previousCard);
				group.cards.add(nextCard);
				changed = true;
			});
			if (changed) this.room.markConstraintGroupsDirty("replaceCardInConstraintGroups");
			return changed;
		}
		removeCardsFromConstraintGroups(cards = []) {
			const cardSet = new Set(cards);
			let changed = false;
			let affectsAmbiguousKnownIndex = false;
			for (const [groupID, group] of this.room.constraintGroups.entries()) {
				cardSet.forEach((card) => {
					if (group.cards.has(card)) {
						affectsAmbiguousKnownIndex = affectsAmbiguousKnownIndex || this.affectsAmbiguousKnownIndex(card);
						const locationKey = createLocationCandidateKey(this.getResolvedExpectedLocationCandidate(card));
						const currentExpected = group.expectedSlotsByLocation.get(locationKey);
						if (locationKey && currentExpected) group.expectedSlotsByLocation.set(locationKey, {
							min: Math.max(0, currentExpected.min - 1),
							max: Math.max(0, currentExpected.max - 1)
						});
						group.cards.delete(card);
						changed = true;
					}
				});
				if (group.cards.size === 0) {
					this.room.deleteConstraintGroup(groupID);
					changed = true;
				}
			}
			if (changed && affectsAmbiguousKnownIndex) this.room.markConstraintGroupsDirty("removeCardsFromConstraintGroups");
			return changed;
		}
		syncStableCardList(existingCards = [], currentCards = []) {
			const currentSet = new Set(currentCards);
			const existingSet = new Set(existingCards);
			const nextCards = existingCards.filter((card) => currentSet.has(card));
			currentCards.forEach((card) => {
				if (!existingSet.has(card)) nextCards.push(card);
			});
			return nextCards;
		}
		syncViewGroups(seatIDs) {
			const idx = this.room.locationIndex;
			(seatIDs === void 0 ? Array.from(this.room.players.values()) : Array.from(seatIDs, (seatID) => this.room.getPlayer(Number(seatID))).filter((player) => Boolean(player))).forEach((player) => {
				const seat = player.seatID;
				const knownHand = idx.knownHandBySeat.get(seat) ?? [];
				const candidateHand = idx.candidateHandBySeat.get(seat) ?? [];
				const equip = idx.equipBySeat.get(seat) ?? [];
				const judge = idx.judgeBySeat.get(seat) ?? [];
				const mark = idx.markBySeatAndSpell.get(seat) ?? new Map();
				player.knownHandCards = this.syncStableCardList(player.knownHandCards, knownHand);
				player.candidateHandCards = this.syncStableCardList(player.candidateHandCards, candidateHand);
				player.equipCards = this.syncStableCardList(player.equipCards, equip);
				player.judgeCards = this.syncStableCardList(player.judgeCards, judge);
				for (const spellID of player.markCards.keys()) if (!mark.has(spellID)) player.markCards.delete(spellID);
				mark.forEach((spellCards, spellID) => {
					player.markCards.set(spellID, this.syncStableCardList(player.markCards.get(spellID) ?? [], spellCards));
				});
			});
		}
		createConstraintGroup(options = {}) {
			const groupID = options.id ?? `group_${++this.room.constraintGroupSeq}`;
			const targetSeats = this.room.normalizeSeats(options.candidateSeats ?? []);
			const cards = Array.from(new Set(options.cards ?? []));
			let group = this.room.constraintGroups.get(groupID);
			let structureChanged = false;
			let affectsAmbiguousKnownIndex = cards.some((card) => this.affectsAmbiguousKnownIndex(card));
			if (!group) {
				group = new ConstraintGroup({
					...options,
					id: groupID,
					candidateSeats: targetSeats,
					cards
				});
				this.room.constraintGroups.set(groupID, group);
				structureChanged = true;
			} else {
				affectsAmbiguousKnownIndex = affectsAmbiguousKnownIndex || Array.from(group.cards).some((card) => this.affectsAmbiguousKnownIndex(card));
				const previousCardCount = group.cards.size;
				group.addCards(cards);
				if (group.cards.size !== previousCardCount) structureChanged = true;
				if (targetSeats.length > 0) {
					const nextCandidateSeats = this.room.mergeCandidateSeats(group.candidateSeats, targetSeats);
					if (!areNumberSetsEqual(group.candidateSeats, nextCandidateSeats)) {
						group.candidateSeats = nextCandidateSeats;
						structureChanged = true;
					}
				}
				if (options.expectedSlotsByLocation !== void 0) {
					const nextExpectedSlotsByLocation = group.normalizeExpectedLocationSlots(options.expectedSlotsByLocation);
					if (!areSlotMapsEqual(group.expectedSlotsByLocation, nextExpectedSlotsByLocation)) {
						group.expectedSlotsByLocation = nextExpectedSlotsByLocation;
						structureChanged = true;
					}
				}
				const nextKnown = group.known || options.known === true;
				if (nextKnown !== group.known) {
					group.known = nextKnown;
					structureChanged = true;
				}
				if (options.sourceEvent !== null && options.sourceEvent !== void 0) {
					if (!areSourceEventsEqual(options.sourceEvent, group.sourceEvent)) structureChanged = true;
					group.sourceEvent = options.sourceEvent;
				}
			}
			group.apply();
			if (structureChanged && affectsAmbiguousKnownIndex) this.room.markConstraintGroupsDirty("createConstraintGroup");
			return group;
		}
		affectsAmbiguousKnownIndex(card) {
			if (this.room.ambiguousKnownIndex.items.has(card.id)) return true;
			return isAmbiguousKnownCard(card);
		}
		isOverbroadKnownCard(card) {
			return card.isKnown === true && card.suspended !== true && card.location === "player" && card.seats.size >= MAX_TRACKED_CANDIDATE_SEATS;
		}
		suspendOverbroadKnownCards(cards = this.room.trackedCards) {
			for (const card of cards) if (this.isOverbroadKnownCard(card)) this.suspendKnownCard(card, "candidateSeats>=4");
		}
		suspendKnownCard(card, reason) {
			if (!card || card.suspended) return;
			this.removeCardsFromConstraintGroups([card]);
			card.clearSeats(`suspendKnownCard:${reason}`);
			card.setLocationCandidates([], `suspendKnownCard:${reason}:candidates`);
			card.location = "suspended";
			card.subZone = null;
			card.suspended = true;
			this.room.markCounterDirty(card);
			this.room.suspendedKnownCards.add(card);
			trackerLogger.info("卡牌身份位置发散，暂停追踪", {
				id: card.id,
				name: card.name,
				reason,
				suspendedCount: this.room.suspendedKnownCards.size
			});
		}
		resumeSuspendedKnownCard(card) {
			if (!card || card.suspended !== true && !this.room.suspendedKnownCards.has(card)) return;
			card.suspended = false;
			this.room.suspendedKnownCards.delete(card);
			trackerLogger.info("卡牌身份再次出现，恢复追踪", {
				id: card.id,
				name: card.name
			});
		}
	};
	var RoomIdentity = class {
		room;
		constructor(room) {
			this.room = room;
		}
		capturePileMoveSnapshot(context) {
			const pileCards = this.room.getZone("pile").cards;
			const pileCountBefore = pileCards.length;
			const cardIDs = context.pileIdentityEvent?.protocol.CardIDs ?? context.knownIDs;
			if (context.fromZone !== "pile" || cardIDs.some((id) => id > 0) || context.moveType !== MOVE_TYPE.DRAW) return {
				pileCountBefore,
				knownPileDrawCards: []
			};
			const count = Math.min(Math.max(0, context.cardCount), pileCountBefore);
			return {
				pileCountBefore,
				knownPileDrawCards: (count === 0 ? [] : context.fromPosition === 0 ? pileCards.slice(0, count) : pileCards.slice(-count)).filter((card) => card.id > 0 && card.isKnown)
			};
		}
		commitPileIdentityForMove(context, snapshot) {
			const event = context.pileIdentityEvent;
			const pileCountAfter = this.room.getZone("pile").cards.length;
			const cardIDs = (context.pileIdentityCardIDs ?? event?.protocol.CardIDs ?? context.knownIDs).filter((id) => id > 0);
			const knownPileIdentityIDsConsumed = snapshot.knownPileDrawCards.filter((card) => card.location !== "pile" && card.id > 0).map((card) => card.id);
			const fromZone = event?.protocol.FromZone ?? this.getIdentityZone(context.fromZone);
			this.room.applyPileIdentityMove({
				eventType: event?.type ?? (context.knownIDs.length > 0 ? "moveKnown" : "moveUnknown"),
				fromZone,
				toZone: event?.protocol.ToZone ?? this.getIdentityZone(context.toZone),
				cardIDs,
				cardCount: event?.cardCount ?? context.cardCount,
				pileCountBefore: snapshot.pileCountBefore,
				anonymousPileConsumptionCount: fromZone === 1 && cardIDs.length === 0 ? Math.max(0, snapshot.pileCountBefore - pileCountAfter - knownPileIdentityIDsConsumed.length) : void 0,
				knownPileIdentityIDsConsumed,
				visiblePileIdentityIDsAfter: this.collectVisiblePileTopIdentityIDs(),
				fromPosition: context.fromPosition,
				toPosition: context.position,
				moveType: context.moveType,
				spellID: event?.protocol.SpellID ?? context.spellID
			});
		}
		getIdentityZone(zone) {
			if (zone === "pile") return 1;
			if (zone === "discard") return 2;
			return null;
		}
		collectVisiblePileTopIdentityIDs() {
			const pileCards = this.room.getZone("pile").cards;
			const cardIDs = [];
			for (let index = pileCards.length - 1; index >= 0; index -= 1) {
				const card = pileCards[index];
				if (!card.isKnown || card.id <= 0) break;
				cardIDs.push(card.id);
			}
			return cardIDs;
		}
		anonymizeMoveSourceCards(cards, requireSuccess) {
			const room = this.room;
			if (requireSuccess) {
				const invalidCards = cards.filter((card) => card.isAnonymous || room.cardIndex.get(card.id) !== card);
				if (invalidCards.length > 0) {
					invalidCards.forEach((card) => {
						trackerLogger.warn("模糊来源实体匿名化失败，身份仍被视为已定位", {
							reason: "moveCards:ambiguousSource:preflight",
							cardID: card.id,
							entityID: card.entityID,
							location: card.location,
							isKnown: card.isKnown
						});
					});
					return {
						success: false,
						pileIdentityIDs: []
					};
				}
			}
			const pileIdentityIDs = [];
			for (const card of cards) {
				const releasedIdentityID = room.anonymizeLocatedIdentity(card, "moveCards:ambiguousSource", { preservePlacement: true });
				if (releasedIdentityID !== null) {
					if (card.location === "pile") pileIdentityIDs.push(releasedIdentityID);
					continue;
				}
				trackerLogger.warn("模糊来源实体匿名化失败，身份仍被视为已定位", {
					reason: "moveCards:ambiguousSource",
					cardID: card.id,
					entityID: card.entityID,
					location: card.location,
					isKnown: card.isKnown
				});
				if (requireSuccess) return {
					success: false,
					pileIdentityIDs: []
				};
			}
			return {
				success: true,
				pileIdentityIDs
			};
		}
		anonymizeRandomPileReturn(context) {
			if (context.toZone !== "pile" || context.position !== 65282 && context.position !== "random") return [];
			const inferredIdentityIDs = [];
			context.publicMovedCards.forEach((card) => {
				if (card.id <= 0) return;
				const previousCardID = this.room.anonymizeLocatedIdentity(card, "moveCards:randomPileReturn");
				if (previousCardID === null) {
					trackerLogger.warn("随机入堆匿名化失败：card/index 不一致", {
						cardID: card.id,
						entityID: card.entityID,
						sourceEvent: context.sourceEvent
					});
					return;
				}
				card.reset();
				if (!context.knownIDs.includes(previousCardID)) inferredIdentityIDs.push(previousCardID);
			});
			return inferredIdentityIDs;
		}
		anonymizeLocatedIdentity(card, reason = "anonymizeLocatedIdentity", options = {}) {
			const room = this.room;
			if (!card || card.isAnonymous) return null;
			if (room.cardIndex.get(card.id) !== card) return null;
			const { preservePlacement = false } = options;
			const previousCardID = card.id;
			const previousEntityID = card.entityID;
			room.cardIndex.delete(previousCardID);
			room.unlocatedIdentities.add(previousCardID);
			room.deckIdentities.add(previousCardID);
			const nextEntityID = room.allocateAnonymousEntityID();
			card.entityID = nextEntityID;
			card.setCardInfo(nextEntityID);
			card.isKnown = false;
			card.suspended = false;
			if (!preservePlacement) {
				card.spellID = null;
				card.setLocationCandidates([], `${reason}:candidates`);
				card.clearSeats(`${reason}:seats`);
				card.subZone = null;
			}
			room.suspendedKnownCards.delete(card);
			room.notifyCardChanged(card, {
				type: "card-identity-anonymized",
				previousCardID,
				previousEntityID,
				entityID: nextEntityID,
				reason,
				preservePlacement
			});
			if (room.counter) {
				room.counter.releaseLocatedIdentityToUnknown(card, previousCardID);
				if (preservePlacement) room.counter.markDirty(card);
			} else room.markCounterDirty(card);
			return previousCardID;
		}
		releaseUnknownPlaceholderToOutside(card, reason) {
			const room = this.room;
			const previousCardID = card.id;
			if (previousCardID > 0 && card.isKnown === true) {
				trackerLogger.warn("拒绝将已知正 ID 卡牌按暗占位移出追踪区", {
					reason,
					cardID: previousCardID,
					entityID: card.entityID,
					location: card.location
				});
				return null;
			}
			const shouldReleaseIdentity = previousCardID > 0 && card.isKnown !== true;
			const releasedIdentityID = shouldReleaseIdentity ? room.anonymizeLocatedIdentity(card, `${reason}:releaseIdentity`) : null;
			if (shouldReleaseIdentity && releasedIdentityID === null) {
				trackerLogger.warn("正 ID 暗占位移出追踪区前释放身份失败，改为暂停身份", {
					reason,
					cardID: previousCardID,
					entityID: card.entityID,
					indexedCardID: room.cardIndex.get(previousCardID)?.id ?? null
				});
				card.confirmKnown();
				room.constraints.suspendKnownCard(card, `${reason}:releaseIdentityFailed`);
				return null;
			}
			card.moveToPublicZone("outside");
			if (releasedIdentityID !== null) trackerLogger.info("正 ID 暗占位移出追踪区前已释放身份", {
				reason,
				releasedIdentityID,
				replacementEntityID: card.entityID
			});
			return releasedIdentityID;
		}
		findPublicZoneEntry(card) {
			const room = this.room;
			const zoneID = card.location;
			const zone = room.zones.get(zoneID);
			if (!zone || !zone.cards.includes(card)) return null;
			return [zoneID, zone];
		}
		probeMaterialize(cardID, target = null) {
			const room = this.room;
			const normalizedCardID = Number(cardID);
			if (!(normalizedCardID > 0)) return null;
			const existing = room.cardIndex.get(normalizedCardID);
			if (existing) {
				if (room.detachedKnownCards.has(existing) && !target?.isAnonymous) return null;
				return existing;
			}
			if (!target || target.hasRealIdentity) return null;
			if (room.deckIdentities.has(normalizedCardID) && !room.unlocatedIdentities.has(normalizedCardID)) return null;
			return target;
		}
		materialize(cardID, target = null) {
			const room = this.room;
			const probedCard = room.probeMaterialize(cardID, target);
			if (!probedCard) return null;
			const existing = room.cardIndex.get(cardID);
			if (existing) {
				if (room.detachedKnownCards.has(existing) && target?.isAnonymous) {
					room.constraints.replaceCardInConstraintGroups(existing, target);
					existing.isKnown = false;
					existing.moveToPublicZone("outside");
					room.notifyCardChanged(existing, { type: "detached-identity-materialized" });
					room.counter?.removeCard(existing);
					room.detachedKnownCards.delete(existing);
					room.suspendedKnownCards.delete(existing);
					room.cardIndex.delete(cardID);
					room.unlocatedIdentities.add(cardID);
					return this.materialize(cardID, target);
				}
				if (target && target !== existing && target.isAnonymous) this.materializeExistingIdentityAtTarget(existing, target);
				existing.confirmKnown();
				room.resumeSuspendedKnownCard(existing);
				return existing;
			}
			if (!room.deckIdentities.has(cardID)) {
				room.deckIdentities.add(cardID);
				room.unlocatedIdentities.add(cardID);
			}
			probedCard.materializeIdentity(cardID);
			probedCard.confirmKnown();
			room.cardIndex.set(cardID, probedCard);
			room.unlocatedIdentities.delete(cardID);
			room.counter?.addCard(probedCard);
			room.notifyCardChanged(probedCard, {
				type: "card-identity-materialized",
				cardID
			});
			return probedCard;
		}
		materializeAtPublicEndpoint(cardIDs, zoneID, position) {
			const room = this.room;
			const targets = room.getPublicEndpointCards(zoneID, cardIDs.length, position);
			const availableTargets = targets.filter((card) => card.isAnonymous);
			return cardIDs.map((cardID) => {
				const existing = room.cardIndex.get(cardID);
				const target = existing && targets.includes(existing) ? existing : availableTargets.shift();
				return room.materialize(cardID, target ?? null);
			}).filter((card) => Boolean(card));
		}
		resolvePublicKnownCards(ids, target = null, logger = trackerLogger) {
			const room = this.room;
			if (target) room.materializeAtPublicEndpoint(ids, target.zoneName, target.position);
			const existingCards = room.findCardsByIDs(ids).filter((card) => !room.detachedKnownCards.has(card));
			const existingIDs = new Set(existingCards.map((card) => card.id));
			const missingIDs = ids.filter((id) => !existingIDs.has(id) && !room.unlocatedIdentities.has(id) && !room.cardIndex.has(id));
			const createdCards = missingIDs.length > 0 ? room.createExternalCards(missingIDs, missingIDs.length) : [];
			const cardMap = new Map();
			existingCards.forEach((card) => cardMap.set(card.id, card));
			createdCards.forEach((card) => cardMap.set(card.id, card));
			const unresolvedIdentityIDs = ids.filter((id) => !cardMap.has(id) && room.unlocatedIdentities.has(id));
			if (unresolvedIdentityIDs.length > 0) logger.warn("揭示身份未能物化到匿名槽，已从已知牌集合中略过", {
				reason: "resolveKnownCards:unresolvedUnlocatedIdentity",
				unresolvedIdentityIDs,
				target
			});
			return ids.map((id) => cardMap.get(id)).filter((card) => Boolean(card));
		}
		materializeExistingIdentityAtTarget(existing, target) {
			const room = this.room;
			if (target.hasRealIdentity) return;
			if ((existing.location === "player" || existing.location === "popup") && existing.isKnown !== true) {
				const oldSubZone = existing.subZone ?? "hand";
				const oldSeats = Array.from(existing.seats, Number);
				const oldSpellID = existing.spellID;
				const oldPopupSpaceID = existing.popupSpaceID;
				const oldLocationCandidates = existing.locationCandidates;
				const targetZoneEntry = this.findPublicZoneEntry(target);
				if (!targetZoneEntry) return;
				const [targetZoneID, targetZone] = targetZoneEntry;
				room.removeCardsFromConstraintGroups([target]);
				room.constraints.replaceCardInConstraintGroups(existing, target);
				existing.moveToPublicZone(targetZoneID);
				targetZone.replaceCard(target, existing);
				target.bindCandidates(oldSeats, oldSubZone, oldSpellID, { known: false });
				if (oldPopupSpaceID !== null) target.resolveLocationCandidate({
					type: "popup",
					spaceID: oldPopupSpaceID
				});
				if (oldLocationCandidates.length > 0) target.setLocationCandidates(oldLocationCandidates, "materialize:interop:placeholder");
				room.movement.hiddenMarks.replaceHiddenMarkPlaceholder(existing, target);
				replacePopupSpaceCard(room, existing, target);
				return;
			}
			if (existing.location !== "outside" && existing.location !== "suspended") return;
			const targetZoneEntry = this.findPublicZoneEntry(target);
			if (!targetZoneEntry) return;
			const [targetZoneID, targetZone] = targetZoneEntry;
			existing.moveToPublicZone(targetZoneID);
			targetZone.replaceCard(target, existing);
			target.moveToPublicZone("outside");
		}
		createExternalCards(cardIDs = [], count = cardIDs.length) {
			const room = this.room;
			const ids = cardIDs.filter((id) => id > 0);
			const unknownCount = Math.max(0, Number(count) || 0, cardIDs.length) - ids.length;
			const cards = [...ids.map((id) => {
				const card = new Card(id, room);
				room.registerCardEntity(card);
				room.deckIdentities.add(card.id);
				room.cardIndex.set(card.id, card);
				room.unlocatedIdentities.delete(card.id);
				return card;
			}), ...Array.from({ length: unknownCount }, () => {
				const card = new Card(0, room);
				room.registerCardEntity(card);
				return card;
			})];
			cards.forEach((card) => card.moveToPublicZone("outside"));
			cards.forEach((card) => room.counter?.addCard(card));
			return cards;
		}
		anonymizePileCohortIdentityEntities(context) {
			const room = this.room;
			const pile = room.getZone("pile");
			const cohortIdentityIDs = new Set(room.pileIdentityLedger.getUnresolvedIdentityIDs());
			if (cohortIdentityIDs.size === 0) return [];
			const anonymizedIdentityIDs = [];
			pile.cards.slice().forEach((card) => {
				const cardID = card.id;
				if (!(cardID > 0) || !cohortIdentityIDs.has(cardID)) return;
				const releasedIdentityID = room.anonymizeLocatedIdentity(card, `${context}:cohortPileProjection`);
				if (releasedIdentityID === null) {
					trackerLogger.warn("牌堆 cohort 身份投影匿名化失败", {
						context,
						cardID,
						entityID: card.entityID,
						location: card.location
					});
					return;
				}
				anonymizedIdentityIDs.push(releasedIdentityID);
			});
			if (anonymizedIdentityIDs.length > 0) trackerLogger.debug("牌堆 cohort 身份已投影为匿名槽", {
				context,
				cardIDs: anonymizedIdentityIDs
			});
			return anonymizedIdentityIDs;
		}
		suspendUnresolvedPileIdentitiesForShuffle(identityIDs, recycledIdentityIDs) {
			const room = this.room;
			const suspendedIdentityIDs = [];
			const anonymizedIdentityIDs = [];
			identityIDs.forEach((cardID) => {
				if (!(cardID > 0) || recycledIdentityIDs.has(cardID)) return;
				const existing = room.cardIndex.get(cardID);
				if (existing && (existing.suspended === true || room.suspendedKnownCards.has(existing))) return;
				if (existing) {
					const releasedIdentityID = room.anonymizeLocatedIdentity(existing, "shufflePile:expiredCohortIdentity", { preservePlacement: true });
					if (releasedIdentityID === null) {
						trackerLogger.warn("洗牌关闭旧牌堆世代时释放暗实体身份失败", {
							cardID,
							entityID: existing.entityID,
							location: existing.location
						});
						return;
					}
					anonymizedIdentityIDs.push(releasedIdentityID);
				} else if (!room.unlocatedIdentities.has(cardID)) {
					trackerLogger.warn("洗牌关闭旧牌堆世代时身份不在 Room 分区中", { cardID });
					return;
				}
				if (!this.createDetachedSuspendedIdentity(cardID)) {
					trackerLogger.warn("洗牌关闭旧牌堆世代时创建 suspended 展示实体失败", { cardID });
					return;
				}
				suspendedIdentityIDs.push(cardID);
			});
			if (suspendedIdentityIDs.length > 0) room.markViewDirty("pile-generation-suspended");
			return {
				suspendedIdentityIDs,
				anonymizedIdentityIDs
			};
		}
		createDetachedSuspendedIdentity(cardID) {
			const room = this.room;
			if (!(cardID > 0) || room.cardIndex.has(cardID)) return null;
			if (!room.unlocatedIdentities.has(cardID)) return null;
			const card = this.createKnownIdentity(cardID, true);
			room.registerCardEntity(card);
			room.deckIdentities.add(cardID);
			room.cardIndex.set(cardID, card);
			room.unlocatedIdentities.delete(cardID);
			room.suspendedKnownCards.add(card);
			room.counter?.addCard(card);
			return card;
		}
		ensureDetachedKnownIdentity(cardID) {
			const room = this.room;
			if (!(cardID > 0)) return null;
			const existing = room.cardIndex.get(cardID);
			if (existing) {
				existing.confirmKnown();
				room.resumeSuspendedKnownCard(existing);
				return existing;
			}
			const card = this.createKnownIdentity(cardID, false);
			room.registerDetachedKnownCard(card);
			room.deckIdentities.add(cardID);
			room.cardIndex.set(cardID, card);
			room.unlocatedIdentities.delete(cardID);
			room.counter?.addCard(card);
			return card;
		}
		createKnownIdentity(cardID, suspended) {
			const card = new Card(cardID, this.room);
			card.location = suspended ? "suspended" : "outside";
			card.isKnown = true;
			card.suspended = suspended;
			card.syncTimestamp();
			return card;
		}
	};
	var RoomMoveEvents = class {
		room;
		skills = new Map();
		handlers = new Map();
		plugins = new Map();
		legacySequence = 0;
		constructor(room) {
			this.room = room;
		}
		get skillHandlers() {
			return this.skills;
		}
		get moveEventHandlers() {
			return this.handlers;
		}
		registerSkillHandler(spellID, handler) {
			this.skills.set(spellID, handler);
		}
		registerMoveEventHandler(spellID, handler) {
			const key = spellID === "*" ? "*" : Number(spellID);
			if (key !== "*" && !Number.isFinite(key)) return;
			const handlers = this.handlers.get(key);
			if (handlers) handlers.push(handler);
			else this.handlers.set(key, [handler]);
			this.registerSkillPlugin({
				id: `legacy:${++this.legacySequence}`,
				spellIDs: [key],
				decorateMove: handler
			});
		}
		registerSkillPlugin(plugin) {
			if (this.plugins.has(plugin.id)) throw new Error(`技能插件重复注册: ${plugin.id}`);
			this.plugins.set(plugin.id, plugin);
		}
		selectPlugins(spellIDs) {
			const plugins = [...this.plugins.values()];
			const wildcard = plugins.filter((plugin) => !plugin.spellIDs || plugin.spellIDs.includes("*"));
			const selected = new Set(wildcard);
			for (const spellID of spellIDs) for (const plugin of plugins) if (plugin.spellIDs?.includes(spellID)) selected.add(plugin);
			return [...selected];
		}
		beforeNormalizeMove(patched, raw) {
			for (const plugin of this.selectPlugins([patched.SpellID])) if (plugin.beforeNormalizeMove?.(patched, raw, this.room) === "defer") return "defer";
		}
		decorateMoveEvent(event) {
			const spellIDs = Array.from(new Set([event.protocol.SpellID, event.options.spellID])).filter((spellID) => spellID != null);
			return this.selectPlugins(spellIDs).reduce((nextEvent, plugin) => {
				try {
					const decorated = plugin.decorateMove?.(nextEvent, this.room);
					return decorated ? decorated : nextEvent;
				} catch (error) {
					trackerLogger.warn("移动事件装饰失败", {
						pluginID: plugin.id,
						spellIDs,
						event: summarizeMoveEvent(nextEvent)
					});
					console.error("[Refactor] 移动事件装饰失败:", error, nextEvent);
					return nextEvent;
				}
			}, event);
		}
		afterMoveCommitted(event) {
			this.notifyPlugins(this.selectPlugins([event.protocol.SpellID, event.options.spellID].filter((id) => id != null)), "afterMoveCommitted", (plugin) => plugin.afterMoveCommitted?.(event, this.room));
		}
		notifyCardsRevealed(cardIDs) {
			const ids = Object.freeze([...new Set(cardIDs.filter((id) => id > 0))]);
			if (ids.length === 0) return;
			this.notifyPlugins(this.plugins.values(), "onCardsRevealed", (plugin) => plugin.onCardsRevealed?.(ids, this.room));
		}
		dispatchSkillProtocolEvent(event) {
			const moves = [];
			for (const plugin of this.plugins.values()) {
				const move = plugin.onProtocolEvent?.(event, this.room);
				if (move) moves.push(move);
			}
			return moves;
		}
		onDeckInitialized() {
			this.notifyPlugins(this.plugins.values(), "onDeckInitialized", (plugin) => plugin.onDeckInitialized?.(this.room));
		}
		notifyPlugins(plugins, phase, notify) {
			for (const plugin of plugins) try {
				notify(plugin);
			} catch (error) {
				trackerLogger.warn("技能生命周期通知失败", {
					pluginID: plugin.id,
					phase,
					error
				});
			}
		}
		clear() {
			this.skills.clear();
			this.handlers.clear();
			this.plugins.clear();
			this.legacySequence = 0;
		}
	};
	var ORDERED_PUBLIC_ZONE_IDS = new Set([
		"pile",
		"discard",
		"process",
		"exchange"
	]);
	var PLAYER_HAND_CARD_STATUSES = [CARD_INSTANCE_STATUS.UNKNOWN, CARD_INSTANCE_STATUS.APPEARED];
	function hasCardsAtPublicPosition(zoneCards, cards, position) {
		if (cards.length === 0 || zoneCards.length < cards.length) return false;
		if (position === 65280) {
			const offset = zoneCards.length - cards.length;
			return cards.every((card, index) => zoneCards[offset + index] === card);
		}
		if (position === 0) {
			const len = cards.length;
			return cards.every((_, index) => zoneCards[index] === cards[len - 1 - index]);
		}
		return false;
	}
	var RoomPublicZones = class {
		constructor(room) {
			this.room = room;
		}
		getExchangeBatch(batchKey) {
			return this.room.getZone("exchange").getExchangeBatch(batchKey);
		}
		deleteExchangeBatch(batchKey) {
			this.room.getZone("exchange").deleteExchangeBatch(batchKey);
		}
		placePublicRevealCards(knownCards, zoneName, options = {}, logger = trackerLogger) {
			const room = this.room;
			const position = options.position ?? 65280;
			const targetZone = room.zones.get(zoneName);
			const placeableCards = [];
			const skippedCards = [];
			knownCards.forEach((card) => {
				if (card.location === "player") {
					skippedCards.push(card);
					return;
				}
				if (targetZone?.cards.includes(card) || card.location === zoneName) {
					placeableCards.push(card);
					return;
				}
				if (card.location === "outside" || card.location === "suspended") {
					placeableCards.push(card);
					return;
				}
				if (!room.zones.has(card.location)) {
					placeableCards.push(card);
					return;
				}
				skippedCards.push(card);
			});
			if (skippedCards.length > 0) logger.info("公共区展示跳过无法回收的实体", {
				zoneName,
				skippedIDs: skippedCards.map((card) => card.id),
				skippedLocations: skippedCards.map((card) => card.location)
			});
			placeableCards.forEach((card) => {
				room.removeCardsFromConstraintGroups([card]);
				card.confirmKnown();
			});
			const missingCards = placeableCards.filter((card) => !targetZone?.cards.includes(card));
			const repositionCards = options.cardIDsTopFirst === true && position === 65280 ? [...placeableCards].reverse() : placeableCards;
			const cardsToPlace = options.reposition === true && targetZone !== void 0 && placeableCards.length > 0 && !hasCardsAtPublicPosition(targetZone.cards, repositionCards, position) ? repositionCards : missingCards;
			if (cardsToPlace.length > 0) targetZone?.add(cardsToPlace, position);
			room.resolveConstraints();
		}
		resizeShuffledPile(cards, cardCount) {
			const missingCount = cardCount - cards.length;
			if (missingCount >= 0) return missingCount === 0 ? cards : [...this.room.createExternalCards([], missingCount), ...cards];
			const retiredCards = [];
			let excessCount = -missingCount;
			const retainedCards = cards.filter((card) => {
				if (excessCount === 0 || card.isKnown === true) return true;
				retiredCards.push(card);
				excessCount -= 1;
				return false;
			});
			this.clearCardsFromPublicZones(retiredCards);
			retiredCards.forEach((card) => {
				this.room.releaseUnknownPlaceholderToOutside(card, "shufflePile:protocolCount");
			});
			return retainedCards;
		}
		clearCardsFromPublicZones(cards = []) {
			cards.forEach((card) => {
				this.room.zones.forEach((zone) => zone.removeCard(card));
			});
		}
		getPublicZoneConsistencyIssues() {
			const issues = [];
			const orderedZoneByCard = new Map();
			this.room.zones.forEach((zone, zoneID) => {
				zone.cards.forEach((card, index) => {
					if (!card) {
						issues.push({
							type: "empty-zone-slot",
							zoneID,
							index
						});
						return;
					}
					const previous = orderedZoneByCard.get(card);
					if (previous) issues.push({
						type: "duplicated-public-zone-card",
						cardID: card.id,
						cardName: card.name,
						zoneID,
						previousZoneID: previous.zoneID,
						index,
						previousIndex: previous.index
					});
					else orderedZoneByCard.set(card, {
						zoneID,
						index
					});
					if (card.location !== zoneID) issues.push({
						type: "zone-card-location-mismatch",
						cardID: card.id,
						cardName: card.name,
						zoneID,
						index,
						location: card.location
					});
				});
			});
			this.room.cards.forEach((card) => {
				if (!ORDERED_PUBLIC_ZONE_IDS.has(card.location)) return;
				if (!this.room.getZone(card.location).cards.includes(card)) issues.push({
					type: "missing-public-zone-order",
					cardID: card.id,
					cardName: card.name,
					location: card.location
				});
			});
			return issues;
		}
		assertPublicZoneConsistency(context = "") {
			return [];
		}
		getPlayerHandCardIDs(seatID, options = {}) {
			const { includeCandidates = false, knownOnly = true } = options;
			const normalizedSeat = Number(seatID);
			const cardsByStatus = this.room.counter?.cardsByStatus;
			const appearedCards = cardsByStatus?.[CARD_INSTANCE_STATUS.APPEARED];
			return (knownOnly ? appearedCards ? Array.from(appearedCards) : this.room.cards : cardsByStatus ? PLAYER_HAND_CARD_STATUSES.flatMap((status) => Array.from(cardsByStatus[status] ?? [])) : this.room.cards).filter((card) => card.location === "player" && card.subZone === "hand" && (includeCandidates || !card.hasSubZoneCandidates()) && card.seats.has(normalizedSeat) && (!knownOnly || card.isKnown === true)).map((card) => card.id).filter((id) => id > 0);
		}
	};
	function getCardPlayerLocationCandidates(card) {
		return getPlayerLocationCandidates(card.getPossibleLocations());
	}
	function getUnknownPlayerSourceCards(room, seatID, subZone = "hand", spellID = null, excludedCards = []) {
		const exactCards = [];
		const candidateCards = [];
		const excluded = new Set(excludedCards);
		for (const card of room.cards) {
			if (excluded.has(card)) continue;
			if (card.isKnown === true || card.suspended === true) continue;
			if (!getCardPlayerLocationCandidates(card).some((candidate) => candidate.seatID === seatID && candidate.subZone === subZone && (subZone !== "mark" || spellID === null || candidate.spellID === spellID))) continue;
			if (isExactUnknownPlayerSourceCard(card, seatID)) exactCards.push(card);
			else candidateCards.push(card);
		}
		return [...exactCards, ...candidateCards];
	}
	function isExactUnknownPlayerSourceCard(card, seatID) {
		return seatID !== null && card.location === "player" && card.isKnown !== true && card.suspended !== true && card.owner === seatID && !card.hasLocationCandidates();
	}
	function getUnknownStoredSourceCards(room, context, excludedCards = []) {
		if (context.fromZone === "popup") {
			const excluded = new Set(excludedCards);
			return getPopupSpaceCards(room, context.fromPopupSpaceID).filter((card) => !card.isKnown && !card.hasLocationCandidates() && !excluded.has(card));
		}
		if (context.fromSeat === null) return [];
		return getUnknownPlayerSourceCards(room, context.fromSeat, context.fromSubZone, context.fromSpellID ?? context.spellID, excludedCards);
	}
	function takeUnknownCardsFromPlayer(room, seatID, count, subZone = "hand", spellID = null) {
		if (!(count > 0)) return [];
		return getUnknownPlayerSourceCards(room, seatID, subZone, spellID).slice(0, count);
	}
	function getPlayerHandCardsBySeat(room, seatID) {
		return room.refreshPlayerSnapshot().filter((card) => card.subZone === "hand" && card.seats.has(seatID));
	}
	function getKnownHandCardsBySeat(room, seatID) {
		return getPlayerHandCardsBySeat(room, seatID).filter((card) => card.isKnown === true);
	}
	var RoomMovementCandidates = class {
		room;
		constructor(room) {
			this.room = room;
		}
		shouldPropagateRandomHandTransferCandidates({ sourceSeat, targetSeat, count, unknownCount, sourceHandTotalObserved = false, sourceHandTotalBefore = 0, sourceHandUnknownCount = 0, sourceEvent }) {
			if (!(count > 0) || sourceSeat === null || targetSeat === null || sourceSeat === targetSeat) return false;
			if (sourceEvent?.type === "showCards") return false;
			if (!(unknownCount > 0)) return false;
			if (sourceHandTotalObserved) return sourceHandTotalBefore > sourceHandUnknownCount;
			return true;
		}
		markRandomHandTransferCandidates({ fromSeat, targetSeat, count, sourceTotalBefore, sourceHandTotalObserved = false, sourceUnknownCount, sourceEvent, force = false }) {
			if (!(count > 0) || fromSeat === null || targetSeat === null || fromSeat === targetSeat) return [];
			const sourcePlayer = this.room.getPlayer(fromSeat);
			const observedSourceTotal = sourceTotalBefore ?? (sourcePlayer?.hasObservedHandCount ? sourcePlayer.observedHandCount : void 0);
			const observedUnknownCount = sourceUnknownCount ?? (sourcePlayer?.hasObservedHandCount ? sourcePlayer.unknownCardCount : void 0);
			if (!force && (sourceHandTotalObserved || sourcePlayer?.hasObservedHandCount) && typeof observedSourceTotal === "number" && typeof observedUnknownCount === "number" && observedSourceTotal <= observedUnknownCount) return [];
			const existingSourceCards = getPlayerHandCardsBySeat(this.room, fromSeat);
			if (!force && !(sourceHandTotalObserved || sourcePlayer?.hasObservedHandCount) && !existingSourceCards.some((card) => card.isKnown === true)) return [];
			const exclusiveSourceCards = existingSourceCards.filter((card) => card.seats.size === 1);
			const ambiguousSourceCards = existingSourceCards.filter((card) => card.seats.size > 1);
			const sourceTotal = sourceTotalBefore ?? (sourcePlayer?.hasObservedHandCount ? sourcePlayer.observedHandCount : exclusiveSourceCards.length > 0 ? exclusiveSourceCards.length : existingSourceCards.length);
			if (sourceTotal < count || sourceTotal <= 0) {
				trackerLogger.warn("随机手牌转移无法建立完整实体候选覆盖", {
					fromSeat,
					targetSeat,
					count,
					sourceTotal,
					existingEntityCount: existingSourceCards.length,
					exclusiveEntityCount: exclusiveSourceCards.length,
					ambiguousEntityCount: ambiguousSourceCards.length,
					reason: "insufficientSource"
				});
				return [];
			}
			if (exclusiveSourceCards.length > sourceTotal) {
				trackerLogger.warn("随机手牌转移无法建立完整实体候选覆盖", {
					fromSeat,
					targetSeat,
					count,
					sourceTotal,
					existingEntityCount: existingSourceCards.length,
					exclusiveEntityCount: exclusiveSourceCards.length,
					ambiguousEntityCount: ambiguousSourceCards.length,
					reason: "entityOverflow"
				});
				return [];
			}
			const seedSourceCards = exclusiveSourceCards.length === sourceTotal ? exclusiveSourceCards : existingSourceCards;
			const missingEntityCount = Math.max(0, sourceTotal - seedSourceCards.length);
			const fallbackCards = missingEntityCount > 0 ? this.room.createExternalCards([], missingEntityCount) : [];
			fallbackCards.forEach((card) => {
				card.bindCandidates([fromSeat], "hand", null, { known: false });
			});
			const sourceCandidateCards = seedSourceCards.concat(fallbackCards);
			if (exclusiveSourceCards.length === sourceTotal ? sourceCandidateCards.length !== sourceTotal : sourceCandidateCards.length < sourceTotal) return [];
			const candidateSeats = Array.from(new Set(sourceCandidateCards.flatMap((card) => Array.from(card.seats)).concat(targetSeat)));
			sourceCandidateCards.forEach((card) => {
				card.addSeat(targetSeat, "randomHandTransferCandidates");
			});
			this.invalidateHandTransferConstraintsForCards(sourceCandidateCards, fromSeat, targetSeat);
			const fromHandKey = createLocationCandidateKey({
				type: "player",
				seatID: fromSeat,
				subZone: "hand",
				spellID: null
			});
			const targetHandKey = createLocationCandidateKey({
				type: "player",
				seatID: targetSeat,
				subZone: "hand",
				spellID: null
			});
			this.room.createConstraintGroup({
				cards: sourceCandidateCards,
				candidateSeats,
				expectedSlotsByLocation: new Map([[fromHandKey, sourceTotal - count], [targetHandKey, count]]),
				known: false,
				sourceEvent: sourceEvent ?? { type: "randomHandTransferCandidates" }
			});
			trackerLogger.info("手牌候选传播", {
				fromSeat,
				targetSeat,
				count,
				sourceTotal,
				expectedSourceSlots: sourceTotal - count,
				expectedTargetSlots: count,
				createdAnonymousCount: fallbackCards.length,
				cards: sourceCandidateCards.filter((card) => card.isKnown === true).map((card) => ({
					id: card.id,
					name: card.name,
					seats: Array.from(card.seats)
				})),
				hiddenEntityCount: sourceCandidateCards.filter((card) => card.isKnown !== true).length
			});
			return sourceCandidateCards;
		}
		markStoredToHandCandidates({ fromPopupSpaceID, gainSpellID, fromSeat, fromSpellID, toSeat, count, sourceEvent }) {
			if (!(count > 0) || toSeat === null) return false;
			const markCandidate = fromPopupSpaceID !== void 0 ? {
				type: "popup",
				spaceID: fromPopupSpaceID
			} : fromSeat !== null && fromSpellID !== null ? {
				type: "player",
				seatID: fromSeat,
				subZone: "mark",
				spellID: fromSpellID
			} : null;
			if (!markCandidate) return false;
			const isPopup = markCandidate.type === "popup";
			const spaceCards = markCandidate.type === "popup" ? getPopupSpaceCards(this.room, markCandidate.spaceID) : [];
			if (isPopup && spaceCards.some((card) => !card.isKnown)) return false;
			const markCards = markCandidate.type === "popup" ? spaceCards : getVisibleMarkSpaceCards(this.room, markCandidate.seatID, markCandidate.spellID);
			if (markCards.length === 0) return false;
			const handCandidate = {
				type: "player",
				seatID: toSeat,
				subZone: "hand",
				spellID: null
			};
			const markKey = createLocationCandidateKey(markCandidate);
			const handKey = createLocationCandidateKey(handCandidate);
			const hasStoredCandidates = markCards.some((card) => card.hasLocationCandidates());
			const previousGroup = hasStoredCandidates ? Array.from(this.room.constraintGroups.values()).find((group) => {
				const slots = group.expectedSlotsByLocation.get(markKey);
				return slots !== void 0 && slots.min === slots.max && markCards.every((card) => group.cards.has(card));
			}) : void 0;
			const sourceCount = previousGroup?.expectedSlotsByLocation.get(markKey)?.min ?? markCards.length;
			if (previousGroup ? sourceCount < count : !hasStoredCandidates && sourceCount <= count) return false;
			const slots = new Map(previousGroup?.expectedSlotsByLocation);
			const handState = previousGroup ? getConstraintSlotState(previousGroup.cards, handCandidate, {
				min: 0,
				max: 0
			}) : null;
			const previousHandSlots = slots.get(handKey) ?? {
				min: handState?.exactCards.length ?? 0,
				max: handState ? handState.exactCards.length + handState.candidateCards.length : 0
			};
			if (previousGroup || !hasStoredCandidates) {
				slots.set(markKey, {
					min: sourceCount - count,
					max: sourceCount - count
				});
				slots.set(handKey, {
					min: previousHandSlots.min + count,
					max: previousHandSlots.max + count
				});
			}
			if (!previousGroup) this.room.removeCardsFromConstraintGroups(markCards);
			markCards.forEach((card) => {
				const otherCandidates = card.locationCandidates.filter((candidate) => {
					const key = createLocationCandidateKey(candidate);
					return key !== markKey && key !== handKey;
				});
				card.setLocationCandidates([
					...otherCandidates,
					markCandidate,
					handCandidate
				], "markStoredToHandCandidates");
				if (gainSpellID !== void 0) card.recordHandGain(toSeat, gainSpellID);
			});
			this.room.createConstraintGroup({
				id: previousGroup?.id,
				cards: markCards,
				candidateSeats: markCandidate.type === "popup" ? [toSeat] : Array.from(new Set([markCandidate.seatID, toSeat])),
				expectedSlotsByLocation: slots,
				known: previousGroup?.known ?? true,
				sourceEvent: sourceEvent ?? { type: "markStoredToHandCandidates" }
			});
			trackerLogger.info("标记或弹窗空间暗取，建立位置候选", {
				fromSeat,
				fromSpellID,
				toSeat,
				count,
				cardIDs: markCards.map((card) => card.id),
				markSlots: slots.get(markKey)?.min,
				handSlots: slots.get(handKey),
				locationCandidates: markCards.map((card) => card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)))
			});
			return true;
		}
		shouldMarkRandomHandToPublicCandidates(sourceSeat, targetSeat, toZone, unknownCount) {
			return sourceSeat !== null && targetSeat === null && toZone === "pile" && unknownCount > 0;
		}
		markRandomHandToPublicCandidates({ fromSeat, toZone, position, unknownCount, candidateSource }) {
			if (fromSeat === null) return [];
			const sourceCandidateCards = candidateSource ? candidateSource.cards.filter((card) => card.isKnown === true && card.location === "player" && card.subZone === "hand" && card.seats.has(fromSeat)) : getKnownHandCardsBySeat(this.room, fromSeat);
			if (candidateSource) this.invalidateHandTransferConstraintsForCards(candidateSource.cards, candidateSource.fromSeat, fromSeat);
			if (sourceCandidateCards.length === 0) return [];
			const candidate = createPublicCandidate(toZone, position, unknownCount);
			sourceCandidateCards.forEach((card) => card.addPublicCandidate(candidate));
			trackerLogger.info("手牌候选进入公共区", {
				fromSeat,
				toZone,
				position,
				unknownCount,
				cards: sourceCandidateCards.map((card) => ({
					id: card.id,
					name: card.name,
					seats: Array.from(card.seats),
					publicCandidates: card.publicCandidates
				}))
			});
			return sourceCandidateCards;
		}
		updatePublicCandidatesAfterUnknownPileReturn({ toZone, position, count }) {
			if (toZone !== "pile" || !(count > 0)) return;
			const candidate = createPublicCandidate(toZone, position, count);
			this.room.trackedCards.filter((card) => card.publicCandidates?.some((item) => item.zone === "pile" && item.position === "top")).forEach((card) => {
				if (candidate.position === "top") card.removePublicCandidates((item) => item.zone === "pile" && item.position === "top");
				card.addPublicCandidate(candidate);
			});
		}
		propagatePublicCandidatesToHand({ fromZone, fromPosition, toZone, targetSeat, subZone, count, sourceEvent }) {
			const position = normalizePublicPosition(fromPosition);
			if (fromZone !== "pile" || toZone !== "player" || subZone !== "hand" || targetSeat === null || !(count > 0) || !PAIDUI_POSITIONS.includes(position)) return [];
			const affectedCards = this.room.trackedCards.filter((card) => card.publicCandidates?.some((candidate) => candidate.zone === fromZone && candidate.position === position));
			if (affectedCards.length === 0) return [];
			const targetHandCandidate = {
				type: "player",
				seatID: Number(targetSeat),
				subZone: "hand",
				spellID: null
			};
			affectedCards.forEach((card) => {
				const nextPublicLocationCandidates = card.publicCandidates.flatMap((candidate) => {
					if (candidate.zone !== fromZone || candidate.position !== position) return [candidate];
					const candidateCount = candidate.count;
					if (typeof candidateCount !== "number") return [candidate];
					if (count >= candidateCount) return [];
					return [createPublicCandidate(candidate.zone, fromPosition, candidateCount - count)];
				}).map((candidate) => fromPublicCandidate(candidate)).filter((candidate) => Boolean(candidate));
				const retainedLocationCandidates = card.locationCandidates.filter((candidate) => candidate.type !== "public" || candidate.zone !== fromZone || candidate.position !== position);
				card.setLocationCandidates([
					...retainedLocationCandidates,
					...nextPublicLocationCandidates,
					targetHandCandidate
				], "publicCandidatesToHand");
			});
			this.room.createConstraintGroup({
				cards: affectedCards,
				candidateSeats: Array.from(new Set(affectedCards.flatMap((card) => Array.from(card.seats)))),
				expectedSlotsByLocation: new Map([[createLocationCandidateKey(targetHandCandidate), Math.min(count, affectedCards.length)]]),
				known: true,
				sourceEvent: sourceEvent ?? { type: "publicCandidatesToHand" }
			});
			trackerLogger.info("公共候选进入手牌", {
				fromZone,
				position,
				targetSeat,
				count,
				cards: affectedCards.map((card) => ({
					id: card.id,
					name: card.name,
					seats: Array.from(card.seats),
					publicCandidates: card.publicCandidates
				}))
			});
			return affectedCards;
		}
		invalidateHandTransferConstraintsForCards(cards, fromSeat, targetSeat) {
			const cardSet = new Set(cards);
			const affectedSeats = new Set([Number(fromSeat), Number(targetSeat)]);
			let changed = false;
			this.room.constraintGroups.forEach((group, groupID) => {
				let hasMatchingCard = false;
				for (const card of group.cards) {
					if (!cardSet.has(card)) continue;
					hasMatchingCard = true;
					break;
				}
				if (!hasMatchingCard) return;
				let groupChanged = false;
				affectedSeats.forEach((seatID) => {
					const locationPrefix = `${createLocationCandidateKey({
						type: "player",
						seatID,
						subZone: "hand",
						spellID: null
					}).split(":").slice(0, -1).join(":")}:`;
					Array.from(group.expectedSlotsByLocation.keys()).filter((key) => key.startsWith(locationPrefix)).forEach((key) => {
						if (group.expectedSlotsByLocation.delete(key)) groupChanged = true;
					});
				});
				if (!groupChanged) return;
				if (group.expectedSlotsByLocation.size === 0) this.room.deleteConstraintGroup(groupID);
				changed = true;
			});
			if (changed) this.room.markConstraintGroupsDirty("invalidateHandTransferConstraintsForCards");
		}
	};
	function getVisibleMarkSpaceCards(room, seatID, spellID) {
		const markKey = createLocationCandidateKey({
			type: "player",
			seatID,
			subZone: "mark",
			spellID
		});
		return room.refreshPlayerSnapshot().filter((card) => card.location === "player" && card.isKnown === true && card.suspended !== true && card.getPossibleLocations().some((candidate) => createLocationCandidateKey(candidate) === markKey));
	}
	var EQUIPMENT_MARK_CONTAINER_BY_MARK_SPELL_ID = new Map([{
		equipmentCardID: 161,
		markSpellID: 700
	}].map((container) => [container.markSpellID, container]));
	function getEquipmentMarkContainerByMarkSpellID(spellID) {
		return EQUIPMENT_MARK_CONTAINER_BY_MARK_SPELL_ID.get(spellID) ?? null;
	}
	function createEquipmentContainerLocationCandidate(spellID) {
		const container = getEquipmentMarkContainerByMarkSpellID(spellID);
		if (!container) return null;
		return {
			type: "container",
			containerType: "equipment",
			cardID: container.equipmentCardID,
			spellID: container.markSpellID
		};
	}
	function isHiddenMarkMove(context) {
		return context.toZone === "player" && context.subZone === "mark" && context.fromSubZone === "hand" && context.knownIDs.length === 0 && context.unknownCount > 0 && context.sourceHandSeat !== null && context.targetSeats.length === 1;
	}
	function resolveEquipmentContainerLocationCandidates(candidate, cardIndex, observedMarkSeat) {
		const normalized = normalizeLocationCandidate(candidate);
		if (normalized?.type !== "container" || normalized.containerType !== "equipment") return [];
		const equipment = cardIndex.get(normalized.cardID);
		if (equipment?.location !== "player" || equipment.subZone !== "equip") return [];
		const markSeat = (normalized.spellID === null ? null : getEquipmentMarkContainerByMarkSpellID(normalized.spellID))?.equipmentCardID === normalized.cardID ? observedMarkSeat : null;
		return (markSeat !== null && markSeat !== void 0 ? [markSeat] : Array.from(equipment.seats)).map((seatID) => ({
			type: "player",
			seatID,
			subZone: "mark",
			spellID: normalized.spellID
		}));
	}
	function getEquipmentMarkSeatChange(context, markSpellID = context.spellID) {
		if (markSpellID == null || context.toZone !== "player" || context.subZone !== "mark" || context.targetSeats.length !== 1 || context.spellID !== markSpellID) return null;
		const container = getEquipmentMarkContainerByMarkSpellID(markSpellID);
		if (!container) return null;
		const targetSeat = context.targetSeats[0];
		const sourceSpellID = context.fromSpellID ?? context.spellID;
		const transferFromSeat = context.fromSubZone === "mark" && sourceSpellID === context.spellID && context.fromSeat !== null && context.fromSeat !== targetSeat ? context.fromSeat : null;
		return {
			markSpellID: container.markSpellID,
			targetSeat,
			transferFromSeat
		};
	}
	function getEquipmentMarkRecordKey(sourceSeat, spellID) {
		if (spellID === null) return null;
		const container = getEquipmentMarkContainerByMarkSpellID(spellID);
		return container ? `${sourceSeat}:muniu:${container.equipmentCardID}` : null;
	}
	function getObservedEquipmentMarkSnapshot(context) {
		if (context.toZone !== "player" || context.fromSubZone !== "mark" || context.subZone !== "mark" || context.targetSeats.length !== 1 || context.unknownCount !== 0 || context.knownIDs.length !== context.cardCount) return null;
		const markSpellID = context.fromSpellID !== void 0 ? context.fromSpellID : context.spellID;
		if (markSpellID == null) return null;
		const container = getEquipmentMarkContainerByMarkSpellID(markSpellID);
		if (!container) return null;
		const observedSeat = Number(context.targetSeats[0]);
		if (!Number.isFinite(observedSeat)) return null;
		return {
			markSpellID: container.markSpellID,
			observedSeat
		};
	}
	var RoomMovementHiddenMarks = class {
		room;
		constructor(room) {
			this.room = room;
		}
		resolveEquipmentContainerLocationCandidates(candidate) {
			return resolveEquipmentContainerLocationCandidates(candidate, this.room.cardIndex, this.room.readSkillState(HIDDEN_MARK_STATE_KEY)?.muniuMarkSeat);
		}
		createHiddenMarkTargetLocationCandidate({ spellID, targetSeat }) {
			const containerCandidate = spellID === null ? null : createEquipmentContainerLocationCandidate(spellID);
			if (containerCandidate) return containerCandidate;
			return {
				type: "player",
				seatID: targetSeat,
				subZone: "mark",
				spellID
			};
		}
		handleMuniuMarkMove(context) {
			if (context.cardCount <= 0) return false;
			const seatChange = getEquipmentMarkSeatChange(context);
			if (!seatChange) return false;
			const { markSpellID, targetSeat, transferFromSeat } = seatChange;
			const state = this.getHiddenMarkState();
			if (state.muniuMarkSeat !== targetSeat) {
				state.muniuMarkSeat = targetSeat;
				this.room.markConstraintGroupsDirty("muniu:markSeat");
			}
			if (transferFromSeat === null) return false;
			this.moveMuniuMarkSpace(markSpellID, transferFromSeat, targetSeat);
			context.skipUnknownMovement = true;
			return true;
		}
		moveMuniuMarkSpace(spellID, fromSeat, targetSeat) {
			const records = Array.from(this.getHiddenMarkState().records.values()).filter((record) => record.spellID === spellID && record.targetSeat === fromSeat);
			records.forEach((record) => this.retargetMuniuRecord(record, targetSeat));
			const movedMarkCardIDs = [];
			this.room.refreshPlayerSnapshot().forEach((card) => {
				if (card.subZone !== "mark" || card.spellID !== spellID || !card.seats.has(fromSeat) || card.hasLocationCandidates() || card.hasSubZoneCandidates()) return;
				card.setSeats([targetSeat], "moveMuniuMarkSpace");
				movedMarkCardIDs.push(card.id);
			});
			if (records.length > 0 || movedMarkCardIDs.length > 0) trackerLogger.info("木牛流马内部牌按标记空间协议迁移", {
				spellID,
				fromSeat,
				targetSeat,
				movedMarkCardIDs,
				retargetedRecordIDs: records.map((record) => record.id)
			});
		}
		retargetMuniuRecord(record, targetSeat) {
			if (record.spellID === null) return false;
			if (!getEquipmentMarkContainerByMarkSpellID(record.spellID)) return false;
			if (targetSeat === record.targetSeat) return false;
			const previousTargetSeat = record.targetSeat;
			record.targetSeat = targetSeat;
			record.placeholderCards.forEach((card) => {
				if (card.location === "player" && card.subZone === "mark" && card.spellID === record.spellID) card.bindCandidates([targetSeat], "mark", record.spellID, { known: false });
			});
			this.removeHiddenMarkConstraint(record);
			this.applyHiddenMarkProjection(record);
			trackerLogger.info("木牛流马暗标记账本更新承载座位", {
				recordID: record.id,
				sourceSeat: record.sourceSeat,
				previousTargetSeat,
				targetSeat,
				candidateCardIDs: Array.from(record.cards, (card) => card.id)
			});
			return true;
		}
		getHiddenMarkState() {
			return this.room.ensureSkillState(HIDDEN_MARK_STATE_KEY, () => {
				return {
					records: new Map(),
					muniuMarkSeat: null
				};
			});
		}
		getKnownHandCandidatesForHiddenMark(sourceSeat) {
			return this.room.refreshPlayerSnapshot().filter((card) => card.isKnown === true && card.suspended !== true && card.seats.has(sourceSeat) && (card.subZone === "hand" && !card.hasSubZoneCandidates() || card.hasSubZoneCandidate({
				seatID: sourceSeat,
				subZone: "hand",
				spellID: null
			})));
		}
		getHiddenMarkLocationCandidates(card, record) {
			const targetCandidate = this.createHiddenMarkTargetLocationCandidate(record);
			const targetCandidateKey = createLocationCandidateKey(targetCandidate);
			const locationCandidates = [];
			const locationCandidateKeys = new Set();
			const appendCandidate = (candidate) => {
				const key = createLocationCandidateKey(candidate);
				if (!key || key === targetCandidateKey || locationCandidateKeys.has(key)) return;
				locationCandidateKeys.add(key);
				locationCandidates.push(candidate);
			};
			getCardPlayerLocationCandidates(card).filter((candidate) => !(candidate.subZone === "mark" && candidate.spellID === record.spellID && (targetCandidate.type === "container" || candidate.seatID !== record.targetSeat))).forEach((candidate) => appendCandidate(candidate));
			card.locationCandidates.filter((candidate) => candidate.type !== "player").forEach((candidate) => appendCandidate(candidate));
			return [...locationCandidates, targetCandidate];
		}
		canCreateHiddenMarkConstraint(record, candidateLists) {
			const targetCandidateKey = createLocationCandidateKey(this.createHiddenMarkTargetLocationCandidate(record));
			return candidateLists.every((candidates) => candidates.every((candidate) => candidate.type === "player" && candidate.seatID === record.sourceSeat && candidate.subZone === "hand" && candidate.spellID === null || createLocationCandidateKey(candidate) === targetCandidateKey));
		}
		handleHiddenMarkMove(context) {
			if (!isHiddenMarkMove(context)) return false;
			const sourceSeat = context.sourceHandSeat;
			const targetSeat = context.targetSeats[0];
			const candidateCards = this.getKnownHandCandidatesForHiddenMark(sourceSeat);
			if (candidateCards.length === 0) return false;
			const state = this.getHiddenMarkState();
			const spellID = context.spellID ?? null;
			const recordKey = getEquipmentMarkRecordKey(sourceSeat, spellID) ?? [
				sourceSeat,
				targetSeat,
				spellID ?? "none"
			].join(":");
			let record = state.records.get(recordKey);
			if (!record) {
				record = {
					id: recordKey,
					groupID: `hidden_mark_${recordKey}`,
					sourceSeat,
					targetSeat,
					spellID,
					cards: new Set(),
					placeholderCards: new Set(),
					hiddenCount: 0,
					knownMarkMin: 0,
					knownMarkMax: 0,
					confirmedHandCards: new Set(),
					confirmedMarkCards: new Set(),
					sourceEvent: context.sourceEvent ?? { type: "hiddenMarkCandidates" }
				};
				state.records.set(recordKey, record);
			}
			this.retargetMuniuRecord(record, targetSeat);
			candidateCards.forEach((card) => {
				record.cards.add(card);
				record.confirmedHandCards.delete(card);
			});
			const knownMarkMin = Math.max(0, context.unknownCount - context.sourceHandUnknownCount);
			const knownMarkMax = Math.min(context.unknownCount, candidateCards.length);
			record.hiddenCount += context.unknownCount;
			record.knownMarkMin += knownMarkMin;
			record.knownMarkMax += knownMarkMax;
			record.sourceEvent = context.sourceEvent ?? record.sourceEvent;
			context.skipUnknownMovement = true;
			this.applyHiddenMarkProjection(record);
			this.moveHiddenMarkPlaceholders(context, record);
			trackerLogger.info("手牌暗置标记区候选记录", {
				sourceSeat,
				targetSeat,
				spellID,
				hiddenCount: context.unknownCount,
				candidateCardIDs: candidateCards.map((card) => card.id),
				knownMarkMin,
				knownMarkMax,
				exact: record.knownMarkMin === record.knownMarkMax
			});
			return true;
		}
		moveHiddenMarkPlaceholders(context, record) {
			const count = Math.max(0, Number(context.unknownCount) || 0);
			if (count <= 0) return [];
			const placeholderCards = takeUnknownCardsFromPlayer(this.room, record.sourceSeat, count, "hand");
			if (placeholderCards.length === 0) return [];
			this.room.removeCardsFromConstraintGroups(placeholderCards);
			placeholderCards.forEach((card) => {
				card.bindCandidates([record.targetSeat], "mark", record.spellID, { known: false });
				record.placeholderCards.add(card);
			});
			context.movedUnknownCards.push(...placeholderCards);
			trackerLogger.debug("手牌暗置标记区占位移动", {
				sourceSeat: record.sourceSeat,
				targetSeat: record.targetSeat,
				spellID: record.spellID,
				requestedCount: count,
				placeholderCardIDs: placeholderCards.map((card) => card.id)
			});
			return placeholderCards;
		}
		findHiddenMarkSourcePlaceholder(card, sourceCards) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state) return null;
			for (const record of state.records.values()) {
				if (!record.cards.has(card)) continue;
				const placeholder = sourceCards.find((sourceCard) => record.placeholderCards.has(sourceCard));
				if (placeholder) return placeholder;
			}
			return null;
		}
		removeHiddenMarkPlaceholder(card) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state?.records?.size) return;
			state.records.forEach((record) => {
				record.placeholderCards?.delete(card);
			});
		}
		clearHiddenMarkPlaceholdersForObservedSnapshot(record, observedCards) {
			const clearedPlaceholderIDs = [];
			const placeholderCards = Array.from(record.placeholderCards ?? []);
			if (placeholderCards.length === 0) return clearedPlaceholderIDs;
			placeholderCards.forEach((card) => {
				record.placeholderCards.delete(card);
				this.removeHiddenMarkPlaceholder(card);
				if (observedCards.has(card)) return;
				if (!(card.location === "player" && card.subZone === "mark" && Number(card.spellID) === Number(record.spellID))) return;
				this.room.removeCardsFromConstraintGroups([card]);
				const placeholderCardID = card.id;
				this.room.releaseUnknownPlaceholderToOutside(card, "clearHiddenMarkPlaceholdersForObservedSnapshot");
				clearedPlaceholderIDs.push(placeholderCardID);
			});
			return clearedPlaceholderIDs;
		}
		materializeUnlocatedIdentitiesOntoMarkPlaceholders(record, identityIDs, reason) {
			const materialized = [];
			const pendingIDs = identityIDs.map((id) => Number(id)).filter((id) => id > 0 && !this.room.cardIndex.has(id) && this.room.unlocatedIdentities.has(id));
			if (pendingIDs.length === 0) return materialized;
			const placeholders = Array.from(record.placeholderCards ?? []).filter((card) => card.isAnonymous && card.location === "player" && card.subZone === "mark" && Number(card.spellID) === Number(record.spellID));
			pendingIDs.forEach((cardID) => {
				const placeholder = placeholders.shift();
				if (!placeholder) return;
				const previousEntityID = Number(placeholder.entityID);
				const resolved = this.room.materialize(cardID, placeholder);
				if (!resolved) return;
				record.placeholderCards.delete(placeholder);
				this.removeHiddenMarkPlaceholder(placeholder);
				record.cards.add(resolved);
				record.confirmedHandCards.delete(resolved);
				materialized.push({
					cardID,
					placeholderEntityID: previousEntityID
				});
			});
			if (materialized.length > 0) trackerLogger.info("暗置标记占位物化未定位身份", {
				reason,
				spellID: record.spellID,
				sourceSeat: record.sourceSeat,
				targetSeat: record.targetSeat,
				materialized,
				remainingPlaceholderCount: record.placeholderCards.size,
				remainingPendingIDs: pendingIDs.filter((id) => !this.room.cardIndex.has(id))
			});
			return materialized;
		}
		bindConfirmedMarkCardToMarkSpace(record, card, reason) {
			if (!(card.id > 0)) return false;
			const candidate = this.createHiddenMarkTargetLocationCandidate(record);
			let changed = false;
			card.confirmKnown();
			if (candidate.type === "container") {
				if (card.location === "player" && !card.hasLocationCandidate(candidate)) {
					const next = [...card.locationCandidates, candidate];
					changed = card.setLocationCandidates(next, reason) || changed;
				}
			} else if (candidate.type === "player") {
				if (card.subZone !== "mark" || Number(card.spellID) !== Number(record.spellID)) changed = card.resolveLocationCandidate(candidate, reason) || changed;
			}
			changed = this.reconcileMarkSpace(record, reason) || changed;
			return changed;
		}
		isLiveHiddenMarkPlaceholder(card, record) {
			return card.isAnonymous && card.location === "player" && card.subZone === "mark" && Number(card.spellID) === Number(record.spellID);
		}
		reconcileMarkSpace(record, reason) {
			const livePlaceholders = Array.from(record.placeholderCards ?? []).filter((card) => this.isLiveHiddenMarkPlaceholder(card, record));
			const confirmedMarkSlotUsers = Array.from(record.confirmedMarkCards).filter((card) => this.occupiesHiddenMarkSlot(card, record)).length;
			const overflow = livePlaceholders.length + confirmedMarkSlotUsers - record.hiddenCount;
			if (overflow <= 0) return false;
			const recycledPlaceholderEntityIDs = [];
			const evictCount = Math.min(overflow, livePlaceholders.length);
			if (evictCount <= 0) {
				trackerLogger.warn("mark 空间守恒溢出但无可回收占位", {
					reason,
					spellID: record.spellID,
					sourceSeat: record.sourceSeat,
					targetSeat: record.targetSeat,
					hiddenCount: record.hiddenCount,
					confirmedMarkSlotUsers,
					overflow
				});
				return false;
			}
			for (let index = 0; index < evictCount; index += 1) {
				const placeholder = livePlaceholders[index];
				record.placeholderCards.delete(placeholder);
				this.removeHiddenMarkPlaceholder(placeholder);
				this.room.removeCardsFromConstraintGroups([placeholder]);
				placeholder.bindCandidates([record.sourceSeat], "hand", null, { known: false });
				recycledPlaceholderEntityIDs.push(placeholder.entityID);
			}
			trackerLogger.debug("mark 空间守恒回收溢出匿名占位", {
				reason,
				spellID: record.spellID,
				sourceSeat: record.sourceSeat,
				targetSeat: record.targetSeat,
				hiddenCount: record.hiddenCount,
				confirmedMarkSlotUsers,
				overflow,
				recycledPlaceholderEntityIDs,
				remainingPlaceholderCount: record.placeholderCards.size
			});
			return true;
		}
		occupiesHiddenMarkSlot(card, record) {
			if (!(card.id > 0)) return false;
			if (card.location === "player" && card.subZone === "mark" && Number(card.spellID) === Number(record.spellID)) return true;
			const candidate = this.createHiddenMarkTargetLocationCandidate(record);
			return candidate.type === "container" && card.hasLocationCandidate(candidate);
		}
		replaceHiddenMarkPlaceholder(previousCard, nextCard) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state?.records?.size) return;
			state.records.forEach((record) => {
				if (record.placeholderCards?.delete(previousCard)) record.placeholderCards.add(nextCard);
			});
		}
		removeHiddenMarkConstraint(record) {
			if (this.room.deleteConstraintGroup(record.groupID)) this.room.markConstraintGroupsDirty("hiddenMark:removeConstraint");
		}
		applyHiddenMarkProjection(record) {
			const activeCards = Array.from(record.cards).filter((card) => card.location === "player" && card.isKnown === true && !record.confirmedHandCards.has(card) && !record.confirmedMarkCards.has(card));
			if (activeCards.length === 0) return false;
			let changed = false;
			const candidateLists = activeCards.map((card) => this.getHiddenMarkLocationCandidates(card, record));
			const canCreateConstraint = this.canCreateHiddenMarkConstraint(record, candidateLists);
			activeCards.forEach((card, index) => {
				card.confirmKnown();
				changed = card.setLocationCandidates(candidateLists[index], "hiddenMark:projection") || changed;
			});
			return this.syncHiddenMarkConstraint(record, activeCards, canCreateConstraint) || changed;
		}
		syncHiddenMarkConstraint(record, activeCards, canCreateConstraint) {
			if (!canCreateConstraint) {
				this.removeHiddenMarkConstraint(record);
				return false;
			}
			const remainingMarkMin = Math.max(0, Math.min(activeCards.length, record.knownMarkMin - record.confirmedMarkCards.size));
			const remainingMarkMax = Math.max(0, Math.min(activeCards.length, record.knownMarkMax - record.confirmedMarkCards.size));
			const handCandidate = {
				type: "player",
				seatID: record.sourceSeat,
				subZone: "hand",
				spellID: null
			};
			const markCandidate = this.createHiddenMarkTargetLocationCandidate(record);
			this.room.createConstraintGroup({
				id: record.groupID,
				cards: activeCards,
				candidateSeats: Array.from(new Set([record.sourceSeat, record.targetSeat])),
				expectedSlotsByLocation: new Map([[createLocationCandidateKey(handCandidate), {
					min: activeCards.length - remainingMarkMax,
					max: activeCards.length - remainingMarkMin
				}], [createLocationCandidateKey(markCandidate), {
					min: remainingMarkMin,
					max: remainingMarkMax
				}]]),
				known: true,
				sourceEvent: record.sourceEvent
			});
			return true;
		}
		resolveHiddenMarkCandidatesFromFullHandReveal(context) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state?.records?.size) return false;
			const seat = context.sourceHandSeat;
			if (seat === null || context.fromSubZone !== "hand") return false;
			if (!(context.sourceHandTotalObserved && context.unknownCount === 0 && context.knownIDs.length > 0 && context.knownIDs.length === context.cardCount && context.cardCount === context.sourceHandTotalBefore)) return false;
			const revealedIDs = new Set(context.knownIDs.map((id) => Number(id)));
			let changed = false;
			const records = [];
			state.records.forEach((record) => records.push(record));
			records.forEach((record) => {
				if (state.records.get(record.id) !== record) return;
				if (Number(record.sourceSeat) !== Number(seat)) return;
				if (record.confirmedMarkCards.size >= record.knownMarkMax) return;
				const strandedCandidates = Array.from(record.cards).filter((card) => {
					if (!(card.id > 0)) return false;
					if (revealedIDs.has(Number(card.id))) return false;
					if (record.confirmedMarkCards.has(card)) return false;
					if (card.location !== "player" || !card.seats.has(Number(seat))) return false;
					const handCandidates = getCardPlayerLocationCandidates(card);
					return card.subZone === "hand" || handCandidates.some((candidate) => Number(candidate.seatID) === Number(seat) && candidate.subZone === "hand");
				});
				strandedCandidates.forEach((card) => {
					if (record.confirmedMarkCards.size >= record.knownMarkMax) return;
					const candidate = this.createHiddenMarkTargetLocationCandidate(record);
					card.confirmKnown();
					if (candidate.type === "container") card.setLocationCandidates([candidate], "hiddenMark:fullHandReveal");
					else card.resolveLocationCandidate(candidate, "hiddenMark:fullHandReveal");
					this.setHiddenMarkConfirmation(record, card, "mark");
					changed = true;
					trackerLogger.info("整手完整揭示反向收敛木马候选", {
						spellID: record.spellID,
						sourceSeat: record.sourceSeat,
						targetSeat: record.targetSeat,
						cardID: card.id,
						revealedIDs: context.knownIDs,
						confirmedMarkCount: record.confirmedMarkCards.size,
						placeholderCount: record.placeholderCards.size
					});
				});
				if (strandedCandidates.length > 0) changed = this.reconcileMarkSpace(record, "hiddenMark:fullHandReveal") || changed;
				this.settleHiddenMarkRecord(record, "fullHandReveal");
			});
			return changed;
		}
		resolveHiddenMarkCandidateFromMove(card, context) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state?.records?.size) return false;
			let changed = false;
			const records = [];
			state.records.forEach((record) => records.push(record));
			records.forEach((record) => {
				if (state.records.get(record.id) !== record) return;
				if (!record.cards.has(card)) return;
				if (context.fromSubZone === "mark") {
					const moveSpellID = context.fromSpellID !== void 0 ? context.fromSpellID : context.spellID ?? null;
					const seatChange = getEquipmentMarkSeatChange(context, moveSpellID);
					const moveMarkSeat = seatChange ? seatChange.targetSeat : context.fromSeat !== null ? context.fromSeat : record.targetSeat;
					if (moveSpellID !== record.spellID) return;
					if (moveMarkSeat !== record.targetSeat) {
						if (record.spellID === null) return;
						if (!getEquipmentMarkContainerByMarkSpellID(record.spellID)) return;
						this.retargetMuniuRecord(record, moveMarkSeat);
					}
					const candidate = this.createHiddenMarkTargetLocationCandidate(record);
					this.setHiddenMarkConfirmation(record, card, "mark");
					changed = this.bindConfirmedMarkCardToMarkSpace(record, card, "hiddenMark:confirmedMark") || changed;
					if (candidate.type === "container" && card.hasLocationCandidate(candidate)) changed = card.setLocationCandidates([candidate], "hiddenMark:confirmedMark") || changed;
					else if (card.hasLocationCandidate(candidate)) changed = card.resolveLocationCandidate(candidate, "hiddenMark:confirmedMark") || changed;
					else {
						const subZoneCandidate = toSubZoneCandidate(candidate);
						if (subZoneCandidate && card.hasSubZoneCandidate(subZoneCandidate)) changed = card.resolveSubZoneCandidate(subZoneCandidate, "hiddenMark:confirmedMark") || changed;
					}
					trackerLogger.info("手牌暗置标记区候选确认进标记", {
						spellID: record.spellID,
						sourceSeat: record.sourceSeat,
						targetSeat: record.targetSeat,
						cardID: card.id,
						fromSubZone: context.fromSubZone,
						fromSpellID: context.fromSpellID ?? context.spellID ?? null,
						confirmedMarkCount: record.confirmedMarkCards.size,
						confirmedHandCount: record.confirmedHandCards.size,
						placeholderCount: record.placeholderCards.size
					});
				} else if (context.fromSubZone === "hand") {
					const moveHandSeat = context.fromSeat !== null ? context.fromSeat : record.sourceSeat;
					if (moveHandSeat !== record.sourceSeat) return;
					const candidate = {
						type: "player",
						seatID: moveHandSeat,
						subZone: "hand",
						spellID: null
					};
					this.setHiddenMarkConfirmation(record, card, "hand");
					if (card.hasLocationCandidate(candidate)) changed = card.resolveLocationCandidate(candidate, "hiddenMark:confirmedHand") || changed;
					else if (card.hasSubZoneCandidate(candidate)) changed = card.resolveSubZoneCandidate(candidate, "hiddenMark:confirmedHand") || changed;
					trackerLogger.info("手牌暗置标记区候选确认回手牌", {
						spellID: record.spellID,
						sourceSeat: record.sourceSeat,
						targetSeat: record.targetSeat,
						cardID: card.id,
						fromSubZone: context.fromSubZone,
						confirmedMarkCount: record.confirmedMarkCards.size,
						confirmedHandCount: record.confirmedHandCards.size,
						placeholderCount: record.placeholderCards.size
					});
				}
				this.settleHiddenMarkRecord(record, "move");
			});
			return changed;
		}
		getObservedEquipmentMarkSnapshot(context) {
			return getObservedEquipmentMarkSnapshot(context);
		}
		resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context) {
			const state = this.room.readSkillState(HIDDEN_MARK_STATE_KEY);
			if (!state?.records?.size) return false;
			const snapshot = getObservedEquipmentMarkSnapshot(context);
			if (!snapshot || context.cardCount <= 0) return false;
			const { markSpellID, observedSeat } = snapshot;
			let changed = false;
			const observedCards = new Set(context.knownCards);
			const observedCardIDs = new Set(context.knownIDs.map(Number));
			const resolvedHandCardIDs = [];
			const clearedPlaceholderIDs = [];
			Array.from(state.records.values()).forEach((record) => {
				if (state.records.get(record.id) !== record) return;
				if (Number(record.spellID) !== markSpellID) return;
				const targetCandidate = this.createHiddenMarkTargetLocationCandidate(record);
				if (targetCandidate.type !== "container") return;
				if (record.targetSeat !== observedSeat) changed = this.retargetMuniuRecord(record, observedSeat) || changed;
				const materialized = this.materializeUnlocatedIdentitiesOntoMarkPlaceholders(record, context.knownIDs, "hiddenMark:observedContainerSnapshot");
				if (materialized.length > 0) {
					materialized.forEach(({ cardID }) => {
						const card = this.room.cardIndex.get(cardID);
						if (card) {
							observedCards.add(card);
							record.cards.add(card);
						}
					});
					changed = true;
				}
				const clearedRecordPlaceholderIDs = this.clearHiddenMarkPlaceholdersForObservedSnapshot(record, observedCards);
				if (clearedRecordPlaceholderIDs.length > 0) {
					clearedPlaceholderIDs.push(...clearedRecordPlaceholderIDs);
					changed = true;
				}
				context.knownIDs.forEach((cardID) => {
					const card = this.room.cardIndex.get(Number(cardID));
					if (!card) return;
					if (!record.cards.has(card) && !materialized.some((item) => item.cardID === Number(cardID))) return;
					record.cards.add(card);
					if (record.confirmedMarkCards.has(card)) return;
					this.setHiddenMarkConfirmation(record, card, "mark");
					changed = this.bindConfirmedMarkCardToMarkSpace(record, card, "hiddenMark:observedContainerSnapshot:mark") || changed;
				});
				record.cards.forEach((card) => {
					if (observedCards.has(card) || observedCardIDs.has(Number(card.id)) || record.confirmedMarkCards.has(card)) return;
					this.setHiddenMarkConfirmation(record, card, "hand");
					if (card.hasLocationCandidate(targetCandidate)) {
						changed = card.removeLocationCandidate(targetCandidate, "hiddenMark:observedContainerSnapshot") || changed;
						resolvedHandCardIDs.push(card.id);
					}
				});
				this.removeHiddenMarkConstraint(record);
				changed = this.applyHiddenMarkProjection(record) || changed;
				this.settleHiddenMarkRecord(record, "observedContainerSnapshot");
			});
			trackerLogger.info("手牌暗置标记区候选按可见装备容器快照收敛", {
				spellID: markSpellID,
				targetSeat: observedSeat,
				visibleCardIDs: context.knownIDs,
				resolvedHandCardIDs,
				clearedPlaceholderIDs,
				knownCardCount: context.knownCards.length,
				knownIDs: context.knownIDs
			});
			return changed;
		}
		setHiddenMarkConfirmation(record, card, subZone) {
			const confirmed = subZone === "hand" ? record.confirmedHandCards : record.confirmedMarkCards;
			(subZone === "hand" ? record.confirmedMarkCards : record.confirmedHandCards).delete(card);
			confirmed.add(card);
		}
		settleHiddenMarkRecord(record, reason) {
			if (record.confirmedHandCards.size + record.confirmedMarkCards.size < record.cards.size) return;
			trackerLogger.info("手牌暗置标记区候选账本结清", {
				spellID: record.spellID,
				sourceSeat: record.sourceSeat,
				targetSeat: record.targetSeat,
				reason,
				confirmedMarkCardIDs: Array.from(record.confirmedMarkCards, (card) => card.id),
				confirmedHandCardIDs: Array.from(record.confirmedHandCards, (card) => card.id),
				remainingPlaceholderCount: record.placeholderCards.size
			});
			this.getHiddenMarkState().records.delete(record.id);
		}
	};
	var RoomMovementSources = class {
		room;
		hiddenMarks;
		constructor(room, hiddenMarks) {
			this.room = room;
			this.hiddenMarks = hiddenMarks;
		}
		takeCardsFromPublicZone(count, zoneID = "pile", position = POSITION_TOP) {
			return this.room.getPublicZone(zoneID)?.remove(count, position) ?? [];
		}
		takeUnknownCardsFromPublicZone(count, zoneID = "pile", position = POSITION_TOP) {
			const sourceZone = this.room.getPublicZone(zoneID);
			if (!sourceZone || count <= 0) return [];
			const hiddenCards = sourceZone.cards.filter((card) => card.isKnown !== true);
			const selected = position === 0 ? hiddenCards.slice(0, count) : hiddenCards.slice(-count).reverse();
			selected.forEach((card) => sourceZone.removeCard(card));
			return selected;
		}
		takeSpecificSourceCards(cards = [], count, fallback = {}) {
			const uniqueCards = Array.from(new Set(cards)).filter(Boolean).slice(0, count);
			uniqueCards.forEach((card) => {
				this.room.zones.forEach((zone) => zone.removeCard(card));
			});
			removePopupSpaceCards(this.room, uniqueCards);
			if (uniqueCards.length >= count) return uniqueCards;
			const selected = new Set(uniqueCards);
			const fallbackCards = fallback.anonymousFallback ? this.room.createExternalCards([], count - uniqueCards.length) : this.takeCardsFromPublicZone(count - uniqueCards.length, fallback.fromZone, fallback.fromPosition);
			return [...uniqueCards, ...fallbackCards.filter((card) => !selected.has(card))];
		}
		takeKnownCardsFromPlayerSubZone(seatID, count, subZone = "hand", spellID) {
			const playerCards = [];
			if (!(count > 0)) return playerCards;
			const markSpellIDs = subZone === "mark" && spellID != null ? [spellID] : [];
			for (const card of this.room.refreshPlayerSnapshot()) {
				if (card.subZone !== subZone || card.seats.has(seatID) !== true || card.isKnown !== true || card.suspended === true || card.hasSubZoneCandidates()) continue;
				if (subZone === "mark" && markSpellIDs.length > 0) {
					if (card.spellID === null || !markSpellIDs.includes(card.spellID)) continue;
				}
				playerCards.push(card);
				if (playerCards.length >= count) break;
			}
			return playerCards;
		}
		getSourceSpellID(context) {
			return context.fromSpellID ?? context.spellID ?? null;
		}
		resolveStoredSourceCandidate(card, context) {
			const { fromSeat, fromSubZone } = context;
			const sourceSpellID = this.getSourceSpellID(context);
			if (context.fromZone === "popup") {
				const candidate = {
					type: "popup",
					spaceID: context.fromPopupSpaceID
				};
				if (card.hasLocationCandidate(candidate)) return card.resolveLocationCandidate(candidate, "move:sourcePopup");
				return false;
			}
			if (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat) || !fromSubZone) return false;
			const candidate = {
				type: "player",
				seatID: fromSeat,
				subZone: fromSubZone,
				spellID: fromSubZone === "mark" ? sourceSpellID : null
			};
			if (card.hasLocationCandidate(candidate)) return card.resolveLocationCandidate(candidate, "move:sourcePlayerCandidate");
			return false;
		}
		isCardInStoredSource(card, context) {
			const { fromSeat, fromSubZone } = context;
			const sourceSpellID = this.getSourceSpellID(context);
			if (context.fromZone === "popup") return card.getPossibleLocations().some((candidate) => candidate.type === "popup" && candidate.spaceID === context.fromPopupSpaceID);
			if (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat) || !fromSubZone) return false;
			return card.location === "player" && getCardPlayerLocationCandidates(card).some((candidate) => candidate.seatID === fromSeat && candidate.subZone === fromSubZone && (fromSubZone !== "mark" || sourceSpellID === null || sourceSpellID === void 0 || candidate.spellID === sourceSpellID));
		}
		isCardInPublicSource(card, context) {
			const { fromZone } = context;
			return (typeof fromZone === "string" ? this.room.zones.get(fromZone) : void 0)?.cards.includes(card) === true;
		}
		findUnknownStoredSourcePlaceholder(context, excludeCard = null) {
			const { fromSeat, fromSubZone } = context;
			if (context.fromZone !== "popup" && (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat) || !fromSubZone)) return null;
			const excludedCards = [excludeCard, ...context.knownCards].filter((card) => Boolean(card));
			const sourceCards = getUnknownStoredSourceCards(this.room, context, excludedCards);
			if (fromSubZone === "mark" && excludeCard) {
				const placeholder = this.hiddenMarks.findHiddenMarkSourcePlaceholder(excludeCard, sourceCards);
				if (placeholder) return placeholder;
			}
			return sourceCards[0] ?? null;
		}
		findExactUnknownStoredSourcePlaceholder(context, excludeCard = null) {
			const { fromSeat, fromSubZone } = context;
			if (context.fromZone !== "popup" && (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat) || !fromSubZone)) return null;
			const excludedCards = [excludeCard, ...context.knownCards].filter((card) => Boolean(card));
			return getUnknownStoredSourceCards(this.room, context, excludedCards).find((card) => context.fromZone === "popup" ? !card.hasLocationCandidates() : isExactUnknownPlayerSourceCard(card, fromSeat)) ?? null;
		}
		getSourcePlaceholderReplacementCandidate(card, context) {
			const { fromSeat, fromSubZone } = context;
			const sourceSpellID = this.getSourceSpellID(context);
			return getCardPlayerLocationCandidates(card).find((candidate) => {
				return !(Number(candidate.seatID) === Number(fromSeat) && candidate.subZone === fromSubZone && (fromSubZone !== "mark" || candidate.spellID === sourceSpellID));
			}) ?? null;
		}
		createPlayerSourcePlaceholderForKnownCard(card, context) {
			const { fromSeat, fromSubZone, sourceEvent } = context;
			if (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat)) return null;
			if (fromSubZone !== "hand") return null;
			if (card.id <= 0) return null;
			const placeholder = this.room.createExternalCards([], 1)[0];
			if (!placeholder) return null;
			placeholder.bindCandidates([fromSeat], "hand", null, { known: false });
			trackerLogger.info("玩家来源明牌缺少可置换实体，已创建瞬时匿名占位", {
				reason: "moveKnownCardsForContext:knownSourcePlaceholderFallback",
				knownCardID: card.id,
				placeholderCardID: placeholder.id,
				placeholderEntityID: placeholder.entityID,
				knownCardLocation: card.location,
				fromSeat,
				fromSubZone,
				sourceEvent
			});
			return placeholder;
		}
		alignVisibleSubZoneTransfer(card, context) {
			const { fromSeat, fromSubZone } = context;
			if (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat) || !fromSubZone) return false;
			const sourceSubZone = card.subZone;
			if (card.location !== "player" || card.isKnown !== true || card.seats.size !== 1 || sourceSubZone === null || sourceSubZone === "hand" || card.hasLocationCandidates()) return false;
			if (card.seats.has(fromSeat) && sourceSubZone === fromSubZone) return false;
			card.subZone = fromSubZone;
			card.spellID = fromSubZone === "mark" ? this.getSourceSpellID(context) : null;
			card.setSeats([fromSeat], "alignVisibleSubZoneTransfer");
			this.room.markCounterDirty(card);
			this.room.notifyCardChanged(card, {
				type: "card-bound",
				subZone: fromSubZone,
				spellID: card.spellID
			});
			trackerLogger.info("可见子区明牌已就地对齐到协议来源", {
				reason: "alignVisibleSubZoneTransfer",
				cardID: card.id,
				entityID: card.entityID,
				fromSubZone: sourceSubZone,
				toSeat: fromSeat,
				toSubZone: fromSubZone,
				spellID: card.spellID,
				sourceEvent: context.sourceEvent
			});
			return true;
		}
		swapKnownCardWithPlayerSourcePlaceholder(card, context) {
			const placeholder = this.findUnknownStoredSourcePlaceholder(context, card);
			if (!placeholder) return null;
			const { fromSeat, fromSubZone } = context;
			const sourceSpellID = this.getSourceSpellID(context);
			const replacementCandidate = this.getSourcePlaceholderReplacementCandidate(card, context);
			const oldLocation = card.location;
			const oldSubZone = card.subZone;
			const oldSeats = new Set(Array.from(card.seats, Number));
			const oldSpellID = card.spellID;
			const oldPopupSpaceID = card.popupSpaceID;
			const oldLocationCandidates = card.locationCandidates;
			const keepPlaceholderAtPreviousPublicPosition = this.hasPublicCandidateAt(card, oldLocation);
			const preserveAmbiguousIdentity = card.isKnown !== true && oldLocationCandidates.length > 1 && isExactUnknownPlayerSourceCard(placeholder, fromSeat);
			this.resolveStoredSourceCandidate(placeholder, context);
			this.room.removeCardsFromConstraintGroups([placeholder]);
			if (preserveAmbiguousIdentity) this.room.constraints.replaceCardInConstraintGroups(card, placeholder);
			if (context.fromZone === "popup") {
				card.resolveLocationCandidate({
					type: "popup",
					spaceID: context.fromPopupSpaceID
				});
				card.confirmKnown();
			} else card.bindCandidates([fromSeat], fromSubZone, fromSubZone === "mark" ? sourceSpellID : null, { known: true });
			if (preserveAmbiguousIdentity) {
				placeholder.bindCandidates(oldSeats, oldSubZone, oldSpellID);
				placeholder.setLocationCandidates(oldLocationCandidates, "swapKnownCardWithPlayerSourcePlaceholder:preserveAmbiguousIdentity");
			} else if (replacementCandidate) {
				const oldPublicZone = this.room.zones.get(oldLocation);
				if (oldPublicZone) trackerLogger.warn("来源占位置换跳过公共区回补，占位改为继承其它候选", {
					knownCardID: card.id,
					placeholderCardID: placeholder.id,
					oldLocation,
					oldPublicZoneCardCount: oldPublicZone.cards.length,
					oldPublicZoneHasKnownCard: oldPublicZone.cards.includes(card),
					fromSeat,
					fromSubZone,
					spellID: sourceSpellID,
					replacementCandidate,
					sourceEvent: context.sourceEvent
				});
				placeholder.bindCandidates([replacementCandidate.seatID], replacementCandidate.subZone, replacementCandidate.spellID, { known: false });
			} else if (oldLocation === "popup") placeholder.resolveLocationCandidate({
				type: "popup",
				spaceID: oldPopupSpaceID
			});
			else if (oldLocation === "player") placeholder.bindCandidates(oldSeats, oldSubZone, oldSpellID);
			else this.restoreUnknownPlaceholderToPreviousPublicLocation(card, placeholder, oldLocation, keepPlaceholderAtPreviousPublicPosition);
			this.hiddenMarks.removeHiddenMarkPlaceholder(placeholder);
			return placeholder;
		}
		restoreUnknownPlaceholderToPreviousPublicLocation(card, placeholder, oldLocation, keepPreviousPosition = false) {
			const zone = this.room.zones.get(oldLocation);
			const oldZoneCardCount = zone?.cards.length ?? null;
			const oldZoneHasKnownCard = zone?.cards.includes(card) ?? false;
			if (oldLocation === "suspended") {
				const placeholderCardID = placeholder.id;
				const releasedIdentityID = this.room.releaseUnknownPlaceholderToOutside(placeholder, "restoreUnknownPlaceholderToPreviousPublicLocation:suspended");
				trackerLogger.debug("暂停追踪来源占位置换后移出占位", {
					knownCardID: card.id,
					placeholderCardID,
					releasedIdentityID,
					oldLocation,
					keepPreviousPosition
				});
				return;
			}
			if (zone) {
				if (keepPreviousPosition) {
					placeholder.moveToPublicZone(oldLocation);
					zone.replaceCard(card, placeholder);
					return;
				}
				zone.removeCard(card);
				if (oldLocation === "pile") this.insertUnknownPlaceholderIntoPile(zone, placeholder);
				else zone.add(placeholder, POSITION_TOP);
				return;
			}
			const placeholderCardID = placeholder.id;
			const releasedIdentityID = this.room.releaseUnknownPlaceholderToOutside(placeholder, "restoreUnknownPlaceholderToPreviousPublicLocation:missingZone");
			trackerLogger.warn("占位置换未回补公共区，已将占位移出追踪区", {
				knownCardID: card.id,
				placeholderCardID,
				releasedIdentityID,
				oldLocation,
				keepPreviousPosition,
				oldZoneCardCount,
				oldZoneCardCountAfter: null,
				oldZoneHasKnownCard
			});
		}
		hasPublicCandidateAt(card, zoneID) {
			if (!this.room.zones.has(zoneID)) return false;
			return card.locationCandidates.some((candidate) => candidate.type === "public" && candidate.zone === zoneID);
		}
		insertUnknownPlaceholderIntoPile(zone, placeholder) {
			const pileCards = zone.cards;
			let knownTopCount = 0;
			for (let i = pileCards.length - 1; i >= 0; i -= 1) if (pileCards[i]?.isKnown === true) knownTopCount += 1;
			else break;
			if (knownTopCount === 0 || knownTopCount === pileCards.length) {
				zone.add(placeholder, POSITION_TOP);
				return;
			}
			const knownTopCards = zone.remove(knownTopCount, POSITION_TOP);
			zone.add(placeholder, POSITION_TOP);
			zone.add([...knownTopCards].reverse(), POSITION_TOP);
		}
		swapKnownCardWithPublicSourcePlaceholder(card, context) {
			const { fromZone, fromPosition } = context;
			const sourceZone = typeof fromZone === "string" ? this.room.zones.get(fromZone) : void 0;
			if (!sourceZone || sourceZone.cards.includes(card) || card.suspended === true) return null;
			const previousPublicZoneEntry = Array.from(this.room.zones.entries()).find(([, zone]) => {
				return zone.cards.includes(card);
			});
			if (!(card.location === "player" || card.location === "popup") && !previousPublicZoneEntry) return null;
			const replacement = this.takeCardsFromPublicZone(1, fromZone, fromPosition)[0];
			if (!replacement) return null;
			this.room.removeCardsFromConstraintGroups([replacement]);
			if (previousPublicZoneEntry) {
				const [previousZoneID, previousZone] = previousPublicZoneEntry;
				replacement.setLocationCandidates([], "swapKnownCardWithPublicSourcePlaceholder:publicCandidates");
				replacement.suspended = false;
				replacement.moveToPublicZone(previousZoneID);
				previousZone.replaceCard(card, replacement);
				trackerLogger.debug("公共区已知牌命中其它公共区实体，使用来源占位回填旧槽位", {
					cardID: card.id,
					replacementCardID: replacement.id,
					fromZone,
					fromPosition,
					previousZoneID
				});
				return replacement;
			}
			const oldSubZone = card.subZone;
			const oldSeats = new Set(Array.from(card.seats, Number));
			const oldSpellID = card.spellID;
			replacement.isKnown = false;
			replacement.bindCandidates(Array.from(oldSeats), oldSubZone, oldSpellID, { known: false });
			if (card.popupSpaceID !== null) replacement.resolveLocationCandidate({
				type: "popup",
				spaceID: card.popupSpaceID
			});
			this.hiddenMarks.replaceHiddenMarkPlaceholder(card, replacement);
			trackerLogger.debug("公共区已知牌命中本地玩家实体，使用公共来源实体替回", {
				cardID: card.id,
				replacementCardID: replacement.id,
				fromZone,
				fromPosition,
				oldSubZone,
				oldSeats: Array.from(oldSeats)
			});
			return replacement;
		}
		takeSourceCards(count, options = {}) {
			const { sourceIsOutside, fromSeat, fromSubZone, subZone, spellID, fromZone, fromPosition, fromSpellID, sourceCards, sourceEvent } = options;
			const moveType = Number(sourceEvent?.moveType ?? sourceEvent?.raw?.MoveType ?? options.moveType);
			const isDiscardGain = (fromZone === "discard" || Number(fromZone) === 2) && (moveType === MOVE_TYPE.GAIN || moveType === MOVE_TYPE.MOVE && options.toZone === "player");
			if (sourceCards?.length) {
				if (fromSeat != null) {
					const explicitCards = Array.from(new Set(sourceCards)).filter(Boolean).slice(0, count);
					removePopupSpaceCards(this.room, explicitCards);
					if (isDiscardGain && explicitCards.length < count) explicitCards.push(...this.room.createExternalCards([], count - explicitCards.length));
					return explicitCards;
				}
				return this.takeSpecificSourceCards(sourceCards, count, {
					fromZone,
					fromPosition,
					anonymousFallback: isDiscardGain
				});
			}
			if (sourceIsOutside) {
				const externalCards = this.room.createExternalCards([], count);
				const placeholderCards = externalCards.filter((card) => card.isAnonymous);
				if (placeholderCards.length > 0) trackerLogger.warn("游戏外来源创建匿名暗占位", {
					reason: "takeSourceCards:sourceOutside",
					requestedCount: count,
					createdPlaceholderCount: placeholderCards.length,
					placeholderCardIDs: placeholderCards.map((card) => card.id),
					fromSeat,
					fromSubZone,
					subZone,
					spellID,
					fromSpellID,
					fromZone,
					fromPosition,
					sourceEvent
				});
				return externalCards;
			}
			if (isDiscardGain) return this.room.createExternalCards([], count);
			if (fromZone === "popup") return takePopupSpaceCards(this.room, count, options.fromPopupSpaceID);
			if (fromSeat != null) {
				const sourceSubZone = fromSubZone ?? subZone ?? "hand";
				const sourceSpellID = sourceSubZone === "mark" ? fromSpellID ?? spellID : spellID;
				const unknownCards = takeUnknownCardsFromPlayer(this.room, fromSeat, count, sourceSubZone, sourceSpellID);
				removePopupSpaceCards(this.room, unknownCards);
				const selectedUnknownCards = unknownCards;
				if (selectedUnknownCards.length >= count || sourceSubZone === "hand") return selectedUnknownCards.slice(0, count);
				const selected = new Set(selectedUnknownCards);
				const knownCards = this.takeKnownCardsFromPlayerSubZone(fromSeat, count - selectedUnknownCards.length, sourceSubZone, sourceSpellID).filter((card) => !selected.has(card));
				return [...selectedUnknownCards, ...knownCards];
			}
			const isPileSource = fromZone === "pile" || Number(fromZone) === 1;
			const isRegularPileDraw = isPileSource && moveType === MOVE_TYPE.DRAW;
			if (!isPileSource || isRegularPileDraw) return this.takeCardsFromPublicZone(count, fromZone, fromPosition);
			return this.takeUnknownCardsFromPublicZone(count, fromZone, fromPosition);
		}
		applyHandTotalDelta(sourceSeat, targetSeat, count) {
			if (!(count > 0) || sourceSeat === targetSeat) return;
			if (sourceSeat !== null && sourceSeat !== void 0) this.room.getPlayer(sourceSeat)?.applyObservedHandCountDelta(-count);
			if (targetSeat !== null && targetSeat !== void 0) this.room.getPlayer(targetSeat)?.applyObservedHandCountDelta(count);
		}
	};
	var RoomMovementKnownSources = class {
		room;
		sources;
		constructor(room, sources) {
			this.room = room;
			this.sources = sources;
		}
		resolve(context) {
			const { fromSeat, fromSubZone, fromZone, knownIDs, sourceIsOutside } = context;
			const isExternalSource = sourceIsOutside || fromZone === "exile";
			if (sourceIsOutside) return this.resolveOutsideSource(context, isExternalSource);
			if (typeof fromZone === "string" && this.room.zones.has(fromZone)) return this.resolvePublicSource(context, fromZone, isExternalSource);
			if (fromZone === "popup" || fromSeat !== null && !Number.isNaN(fromSeat) && fromSubZone) return this.resolvePlayerSource(context, fromSeat, isExternalSource);
			context.knownCards = this.room.findCardsByIDs(knownIDs);
			return {
				missingIDs: knownIDs.filter((id) => !this.room.cardIndex.has(id)),
				createdCards: [],
				knownCardCreationReason: isExternalSource ? "external-source" : null,
				isExternalSource
			};
		}
		confirm(context, resolution) {
			const { knownIDs, fromZone, fromSeat, sourceIsOutside } = context;
			const { missingIDs, createdCards, knownCardCreationReason, isExternalSource } = resolution;
			const createdCardSet = new Set(createdCards);
			const resumedCardIDs = [];
			const confirmedFromUnknownIDs = [];
			context.knownCards.forEach((card) => {
				if (this.room.detachedKnownCards.delete(card)) {
					this.room.registerCardEntity(card);
					trackerLogger.warn("已知移动缺少匿名来源槽，范围身份转为物理实体", { cardID: card.id });
				}
				const wasSuspended = card.suspended === true || this.room.suspendedKnownCards.has(card);
				this.room.resumeSuspendedKnownCard(card);
				if (wasSuspended) resumedCardIDs.push(card.id);
				const isExpectedExternalCreation = knownCardCreationReason === "external-source" && createdCardSet.has(card);
				if (card.id > 0 && card.isKnown !== true && !isExpectedExternalCreation) confirmedFromUnknownIDs.push(card.id);
				if (card.id > 0) card.confirmKnown();
			});
			if (confirmedFromUnknownIDs.length > 0) trackerLogger.info("已知牌解析后补确认明牌", {
				knownIDs,
				confirmedFromUnknownIDs,
				createdCardIDs: createdCards.map((card) => card.id),
				missingIDs,
				fromZone,
				fromSeat,
				sourceIsOutside,
				isExternalSource,
				knownCardCreationReason
			});
			trackerLogger.debug("已知牌解析完成", {
				knownIDs,
				resolvedCardIDs: context.knownCards.map((card) => card.id),
				knownCardStates: context.knownCards.map((card) => ({
					id: card.id,
					entityID: card.entityID,
					isKnown: card.isKnown === true,
					location: card.location
				})),
				missingIDs,
				createdCardIDs: createdCards.map((card) => card.id),
				resumedCardIDs,
				confirmedFromUnknownIDs,
				sourceIsOutside,
				isExternalSource,
				knownCardCreationReason
			});
		}
		resolveOutsideSource(context, isExternalSource) {
			const { knownIDs } = context;
			let createdCards = [];
			const knownCardCreationReason = isExternalSource ? "external-source" : null;
			const existingCards = this.room.findCardsByIDs(knownIDs);
			const existingIDs = new Set(existingCards.map((card) => card.id));
			const missingIDs = knownIDs.filter((id) => !existingIDs.has(id));
			if (missingIDs.length > 0) createdCards = this.room.createExternalCards(missingIDs, missingIDs.length);
			const cardMap = new Map();
			existingCards.forEach((card) => cardMap.set(card.id, card));
			createdCards.forEach((card) => cardMap.set(card.id, card));
			context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter((card) => card !== void 0);
			return {
				missingIDs,
				createdCards,
				knownCardCreationReason,
				isExternalSource
			};
		}
		resolvePublicSource(context, fromZone, isExternalSource) {
			const { fromPosition, knownIDs } = context;
			let missingIDs;
			let createdCards = [];
			let knownCardCreationReason = isExternalSource ? "external-source" : null;
			const sourceZone = this.room.zones.get(fromZone);
			const endpointCount = Math.max(knownIDs.length, Math.max(0, Math.floor(Number(context.cardCount) || 0)));
			const endpointCards = fromZone === "pile" && normalizePublicPosition(fromPosition) === "random" ? (sourceZone?.cards ?? []).filter((card) => card.isAnonymous).slice(-endpointCount).reverse() : this.room.getPublicEndpointCards(fromZone, endpointCount, fromPosition);
			const availableTargets = endpointCards.filter((card) => card.isAnonymous);
			const anonymousTargetCountBefore = availableTargets.length;
			const resolveAttempts = [];
			context.knownCards = knownIDs.map((cardID) => {
				const existing = this.room.cardIndex.get(cardID);
				const existingInSource = Boolean(existing && sourceZone?.cards.includes(existing));
				const hadAnonymousTarget = !existingInSource && availableTargets.length > 0;
				const target = existingInSource ? existing : availableTargets.shift();
				const ledgerBefore = {
					inCardIndex: this.room.cardIndex.has(cardID),
					inUnlocated: this.room.unlocatedIdentities.has(cardID),
					inDeckIdentities: this.room.deckIdentities.has(cardID),
					existingLocation: existing?.location ?? null,
					existingIsKnown: existing?.isKnown === true,
					existingInSource,
					tookAnonymousTarget: Boolean(target && target !== existing && target.isAnonymous),
					targetEntityID: target?.entityID ?? null,
					remainingAnonymousTargets: availableTargets.length
				};
				const resolved = (isExternalSource && existingInSource ? existing : this.room.materialize(cardID, target ?? null)) ?? existing;
				resolveAttempts.push({
					cardID,
					...ledgerBefore,
					hadAnonymousTarget,
					materializeOk: Boolean(resolved),
					afterInCardIndex: this.room.cardIndex.has(cardID)
				});
				return resolved;
			}).filter((card) => Boolean(card));
			missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id));
			if (missingIDs.length > 0) {
				trackerLogger.info("known 路径实体缺口，将 createExternal", {
					knownIDs,
					missingIDs,
					fromZone,
					fromPosition,
					anonymousTargetCountBefore,
					anonymousTargetCountAfter: availableTargets.length,
					sourceZoneCards: (sourceZone?.cards ?? []).map((card) => ({
						id: card.id,
						entityID: card.entityID,
						isKnown: card.isKnown === true,
						isAnonymous: card.isAnonymous
					})),
					endpointCards: endpointCards.map((card) => ({
						id: card.id,
						entityID: card.entityID,
						isKnown: card.isKnown === true,
						isAnonymous: card.isAnonymous
					})),
					resolveAttempts,
					knownIDLedgers: knownIDs.map((cardID) => ({
						cardID,
						inCardIndex: this.room.cardIndex.has(cardID),
						inUnlocated: this.room.unlocatedIdentities.has(cardID),
						inDeckIdentities: this.room.deckIdentities.has(cardID)
					}))
				});
				knownCardCreationReason = isExternalSource ? "external-source" : "known-fallback";
				createdCards = this.room.createExternalCards(missingIDs, missingIDs.length);
				const cardMap = new Map(context.knownCards.map((card) => [card.id, card]));
				createdCards.forEach((card) => cardMap.set(card.id, card));
				context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter((card) => Boolean(card));
				missingIDs = knownIDs.filter((id) => !cardMap.has(id));
			}
			return {
				missingIDs,
				createdCards,
				knownCardCreationReason,
				isExternalSource
			};
		}
		resolvePlayerSource(context, fromSeat, isExternalSource) {
			const { fromSubZone, knownIDs, sourceCards } = context;
			let missingIDs;
			let createdCards = [];
			let knownCardCreationReason = isExternalSource ? "external-source" : null;
			const markSpellID = context.fromSpellID ?? context.spellID;
			const explicitTargets = sourceCards?.filter((card) => card.isAnonymous) ?? [];
			let sourceTargets = explicitTargets.length > 0 ? explicitTargets : getUnknownStoredSourceCards(this.room, context).filter((card) => card.isAnonymous).slice(0, knownIDs.length);
			if (context.fromZone !== "popup" && fromSubZone === "hand") sourceTargets = sourceTargets.filter((card) => card.subZone === "hand");
			const availableTargets = [...sourceTargets];
			const sourceAnonymousCountBefore = availableTargets.length;
			if (fromSubZone === "mark" && context.subZone === "mark" && context.toZone === "player" && context.unknownCount === 0 && knownIDs.length === context.cardCount && knownIDs.length > 0 && availableTargets.length < knownIDs.length) {
				const usedTargets = new Set(availableTargets);
				context.targetSeats.forEach((targetSeat) => {
					if (Number(targetSeat) === Number(fromSeat)) return;
					getUnknownPlayerSourceCards(this.room, targetSeat, fromSubZone, markSpellID).filter((card) => card.isAnonymous).forEach((card) => {
						if (usedTargets.has(card) || availableTargets.length >= knownIDs.length) return;
						usedTargets.add(card);
						availableTargets.push(card);
					});
				});
			}
			const resolveAttempts = [];
			context.knownCards = knownIDs.map((cardID) => {
				const existing = this.room.cardIndex.get(cardID);
				const existingInSource = Boolean(existing && !this.room.detachedKnownCards.has(existing) && this.sources.isCardInStoredSource(existing, context));
				const target = existingInSource ? existing : availableTargets.shift();
				const ledgerBefore = {
					inCardIndex: this.room.cardIndex.has(cardID),
					inUnlocated: this.room.unlocatedIdentities.has(cardID),
					inDeckIdentities: this.room.deckIdentities.has(cardID),
					existingLocation: existing?.location ?? null,
					existingSubZone: existing?.subZone ?? null,
					existingIsKnown: existing?.isKnown === true,
					existingInSource,
					tookAnonymousTarget: Boolean(target && target.isAnonymous),
					targetSubZone: target?.subZone ?? null,
					remainingAnonymousTargets: availableTargets.length
				};
				const resolved = this.room.materialize(cardID, target ?? null) ?? existing;
				resolveAttempts.push({
					cardID,
					...ledgerBefore,
					materializeOk: Boolean(resolved),
					afterInCardIndex: this.room.cardIndex.has(cardID)
				});
				return resolved;
			}).filter((card) => Boolean(card));
			missingIDs = knownIDs.filter((id) => !this.room.cardIndex.has(id));
			if (missingIDs.length > 0) {
				trackerLogger.warn("玩家来源 known 路径实体缺口，将 createExternal", {
					knownIDs,
					missingIDs,
					fromSeat,
					fromSubZone,
					markSpellID,
					sourceAnonymousCountBefore,
					remainingAnonymousTargets: availableTargets.length,
					resolveAttempts,
					knownIDLedgers: knownIDs.map((cardID) => ({
						cardID,
						inCardIndex: this.room.cardIndex.has(cardID),
						inUnlocated: this.room.unlocatedIdentities.has(cardID),
						inDeckIdentities: this.room.deckIdentities.has(cardID)
					}))
				});
				knownCardCreationReason = "known-fallback";
				createdCards = this.room.createExternalCards(missingIDs, missingIDs.length);
				const cardMap = new Map(context.knownCards.map((card) => [card.id, card]));
				createdCards.forEach((card) => cardMap.set(card.id, card));
				context.knownCards = knownIDs.map((id) => cardMap.get(id)).filter((card) => Boolean(card));
				missingIDs = knownIDs.filter((id) => !cardMap.has(id));
			}
			return {
				missingIDs,
				createdCards,
				knownCardCreationReason,
				isExternalSource
			};
		}
	};
	var RoomMovementKnownPlacement = class {
		room;
		sources;
		hiddenMarks;
		constructor(room, sources, hiddenMarks) {
			this.room = room;
			this.sources = sources;
			this.hiddenMarks = hiddenMarks;
		}
		prepare(context) {
			const { knownCards, toZone } = context;
			if (knownCards.length === 0) {
				if (toZone === "player") this.hiddenMarks.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context);
				return null;
			}
			removePopupSpaceCards(this.room, knownCards);
			const swappedCardIDs = [];
			const handledSpellCardIDs = [];
			const resolvedSourceCardIDs = [];
			const playerSourceSwapAttempts = [];
			const observedEquipmentMarkSnapshot = getObservedEquipmentMarkSnapshot(context);
			return {
				swappedCardIDs,
				handledSpellCardIDs,
				resolvedSourceCardIDs,
				playerSourceSwapAttempts,
				playerSourceContext: observedEquipmentMarkSnapshot ? {
					...context,
					fromSeat: observedEquipmentMarkSnapshot.observedSeat
				} : context
			};
		}
		moveEachCard(context, placement) {
			const { fromSubZone, knownCards, sourceEvent, spellID, subZone, targetSeats, toZone, toSeatID } = context;
			const { swappedCardIDs, handledSpellCardIDs, resolvedSourceCardIDs, playerSourceContext } = placement;
			const effectiveFromSeat = playerSourceContext.fromSeat;
			knownCards.forEach((card) => {
				const isFromPlayerSource = context.fromZone === "popup" || effectiveFromSeat !== null && effectiveFromSeat !== void 0 && !Number.isNaN(effectiveFromSeat) && Boolean(fromSubZone);
				const shouldSwapSpeculativePlayerIdentity = isFromPlayerSource && card.isKnown !== true && card.locationCandidates.length > 1 && Boolean(this.sources.findExactUnknownStoredSourcePlaceholder(playerSourceContext, card));
				if (isFromPlayerSource && (!this.sources.isCardInStoredSource(card, playerSourceContext) || shouldSwapSpeculativePlayerIdentity)) this.swapPlayerSourceCard(card, context, placement);
				if (!isFromPlayerSource && typeof context.fromZone === "string" && this.room.zones.has(context.fromZone) && !this.sources.isCardInPublicSource(card, context)) {
					const placeholder = this.sources.swapKnownCardWithPublicSourcePlaceholder(card, context);
					if (placeholder) {
						swappedCardIDs.push(card.id);
						this.registerPopupReplacement(placeholder);
					}
				}
				this.hiddenMarks.resolveHiddenMarkCandidateFromMove(card, context);
				if (this.sources.resolveStoredSourceCandidate(card, context)) resolvedSourceCardIDs.push(card.id);
				this.room.removeCardsFromConstraintGroups([card]);
				if (spellID && this.room.skillHandlers.has(spellID)) {
					this.room.skillHandlers.get(spellID)?.(card, {
						toZone,
						toSeatID,
						subZone,
						sourceEvent
					});
					handledSpellCardIDs.push(card.id);
				}
				if (toZone === "player") {
					this.room.clearCardsFromPublicZones([card]);
					card.bindCandidates(targetSeats, subZone, subZone === "hand" && fromSubZone === "mark" ? null : spellID, { known: true });
					if (context.targetHandSeat !== null && context.gainSpellID !== void 0) card.recordHandGain(context.targetHandSeat, context.gainSpellID);
				}
			});
		}
		swapPlayerSourceCard(card, context, placement) {
			const { fromSeat, fromSubZone, sourceEvent, toZone } = context;
			const { swappedCardIDs, playerSourceSwapAttempts, playerSourceContext } = placement;
			if (this.sources.alignVisibleSubZoneTransfer(card, playerSourceContext)) return;
			const locationBeforeSwap = card.location;
			const placeholder = this.sources.swapKnownCardWithPlayerSourcePlaceholder(card, playerSourceContext);
			let fallbackPlaceholder = null;
			if (!placeholder && context.fromZone !== "popup" && fromSubZone === "hand") {
				const createdSourcePlaceholder = !(context.sourceHandTotalObserved && context.sourceHandTotalBefore <= context.handMoveCount && toZone !== "player") ? this.sources.createPlayerSourcePlaceholderForKnownCard(card, playerSourceContext) : null;
				if (createdSourcePlaceholder) fallbackPlaceholder = this.sources.swapKnownCardWithPlayerSourcePlaceholder(card, playerSourceContext);
				if (!fallbackPlaceholder && createdSourcePlaceholder) trackerLogger.warn("已创建来源瞬时匿名占位但仍未完成置换", {
					knownCardID: card.id,
					placeholderCardID: createdSourcePlaceholder.id,
					placeholderEntityID: createdSourcePlaceholder.entityID,
					fromSeat,
					fromSubZone,
					toZone,
					sourceEvent
				});
				if (!fallbackPlaceholder) trackerLogger.warn("玩家来源明牌未找到可立即置换的手牌占位", {
					knownCardID: card.id,
					fromSeat,
					fromSubZone,
					toZone,
					sourceHandCards: (fromSeat === null ? [] : getPlayerHandCardsBySeat(this.room, fromSeat)).map((sourceCard) => ({
						cardID: sourceCard.id,
						isKnown: sourceCard.isKnown,
						suspended: sourceCard.suspended,
						seats: Array.from(sourceCard.seats, Number),
						hasLocationCandidates: sourceCard.hasLocationCandidates(),
						hasSubZoneCandidates: sourceCard.hasSubZoneCandidates()
					})),
					sourceEvent
				});
			}
			this.registerPopupReplacement(placeholder);
			this.registerPopupReplacement(fallbackPlaceholder);
			playerSourceSwapAttempts.push({
				knownCardID: card.id,
				locationBeforeSwap,
				locationAfterSwap: card.location,
				primaryPlaceholderID: placeholder?.id ?? null,
				fallbackPlaceholderID: fallbackPlaceholder?.id ?? null,
				stillInPublicZones: Array.from(this.room.zones.entries()).filter(([, zone]) => zone.cards.includes(card)).map(([zoneID, zone]) => ({
					zoneID,
					index: zone.cards.indexOf(card),
					zoneCardCount: zone.cards.length
				}))
			});
			swappedCardIDs.push(card.id);
		}
		registerPopupReplacement(placeholder) {
			if (placeholder?.popupSpaceID !== null && placeholder?.popupSpaceID !== void 0) registerPopupSpaceCards(this.room, placeholder.popupSpaceID, [placeholder]);
		}
		finishMove(context, placement) {
			const { combinationID, expectedSlotsByLocation, knownCards, position, sourceEvent, spellID, subZone, targetSeats, toZone } = context;
			const { swappedCardIDs, handledSpellCardIDs, resolvedSourceCardIDs } = placement;
			if (toZone === "popup") {
				knownCards.forEach((card) => card.resolveLocationCandidate({
					type: "popup",
					spaceID: context.toPopupSpaceID
				}));
				registerPopupSpaceCards(this.room, context.toPopupSpaceID, knownCards);
				return;
			}
			if (toZone === "player") {
				this.hiddenMarks.resolveHiddenMarkCandidatesFromObservedMarkSnapshot(context);
				this.room.createConstraintGroup({
					id: combinationID ?? void 0,
					cards: knownCards,
					candidateSeats: targetSeats,
					expectedSlotsByLocation,
					known: true,
					sourceEvent: sourceEvent ?? { type: "moveCards" }
				});
				trackerLogger.debug("已知牌进入玩家区", {
					cardIDs: knownCards.map((card) => card.id),
					targetSeats,
					subZone,
					spellID,
					combinationID,
					swappedCardIDs,
					handledSpellCardIDs,
					resolvedSourceCardIDs
				});
				return;
			}
			this.repairPublicResidues(context, placement);
			const targetZone = this.room.zones.get(toZone);
			if (targetZone) targetZone.add(knownCards, position);
			else knownCards.forEach((card) => card.moveToPublicZone(toZone));
			context.publicMovedCards.push(...knownCards);
			trackerLogger.debug("已知牌进入公共区", {
				cardIDs: knownCards.map((card) => card.id),
				toZone,
				position,
				spellID,
				swappedCardIDs,
				handledSpellCardIDs,
				resolvedSourceCardIDs,
				targetZoneExists: Boolean(targetZone)
			});
		}
		collectPublicResidues(knownCards) {
			return knownCards.flatMap((card) => {
				const residues = [];
				this.room.zones.forEach((zone, zoneID) => {
					const index = zone.cards.indexOf(card);
					if (index === -1) return;
					residues.push({
						card,
						cardID: card.id,
						zoneID,
						index,
						zoneCardCount: zone.cards.length,
						cardLocation: card.location,
						cardSubZone: card.subZone,
						cardSeats: Array.from(card.seats, Number),
						hasLocationCandidates: card.hasLocationCandidates(),
						hasSubZoneCandidates: card.hasSubZoneCandidates()
					});
				});
				return residues;
			});
		}
		repairPublicResidues(context, placement) {
			const { fromSeat, fromSubZone, knownCards, position, sourceEvent, toZone } = context;
			if (fromSeat === null || fromSeat === void 0 || Number.isNaN(fromSeat)) return;
			const { playerSourceSwapAttempts } = placement;
			const knownCardSet = new Set(knownCards);
			const sourceHandCards = fromSubZone === "hand" ? getPlayerHandCardsBySeat(this.room, fromSeat).filter((sourceCard) => !knownCardSet.has(sourceCard) && !sourceCard.suspended) : [];
			const usedPublicResiduePlaceholders = new Set();
			const canUseKnownSourcePlaceholder = context.sourceHandTotalObserved && fromSubZone === "hand" && context.sourceHandTotalBefore <= context.handMoveCount;
			const publicResidues = this.collectPublicResidues(knownCards);
			if (publicResidues.length > 0) {
				const repairedResidues = [];
				const unrepairedResidues = [];
				publicResidues.forEach(({ card, ...residue }) => {
					const zone = this.room.zones.get(residue.zoneID);
					if (fromSubZone !== "hand" || !zone?.cards.includes(card)) {
						unrepairedResidues.push(residue);
						return;
					}
					let placeholder = sourceHandCards.find((sourceCard) => {
						if (sourceCard === card || usedPublicResiduePlaceholders.has(sourceCard)) return false;
						if (sourceCard.isKnown !== true) return true;
						return canUseKnownSourcePlaceholder;
					}) ?? null;
					const createdFallback = !placeholder;
					if (!placeholder) {
						placeholder = this.room.createExternalCards([], 1)[0] ?? null;
						if (placeholder) trackerLogger.warn("公共区残留修复创建匿名回补占位", {
							reason: "moveKnownCardsForContext:publicResidueFallback",
							knownCardID: card.id,
							placeholderCardID: placeholder.id,
							residue,
							fromSeat,
							fromSubZone,
							toZone,
							position,
							sourceHandTotalObserved: context.sourceHandTotalObserved,
							sourceHandTotalBefore: context.sourceHandTotalBefore,
							handMoveCount: context.handMoveCount,
							canUseKnownSourcePlaceholder,
							sourceEvent
						});
					}
					if (!placeholder) {
						unrepairedResidues.push(residue);
						return;
					}
					usedPublicResiduePlaceholders.add(placeholder);
					this.room.removeCardsFromConstraintGroups([placeholder]);
					const placeholderWasKnown = placeholder.isKnown === true;
					if (this.sources.hasPublicCandidateAt(card, residue.zoneID)) {
						placeholder.moveToPublicZone(residue.zoneID);
						zone.replaceCard(card, placeholder);
					} else if (residue.zoneID === "pile") {
						zone.removeCard(card);
						this.sources.insertUnknownPlaceholderIntoPile(zone, placeholder);
					} else {
						zone.removeCard(card);
						zone.add(placeholder, POSITION_TOP);
					}
					this.hiddenMarks.removeHiddenMarkPlaceholder(placeholder);
					repairedResidues.push({
						...residue,
						placeholderCardID: placeholder.id,
						placeholderWasKnown,
						createdFallback,
						zoneCardCountAfter: zone.cards.length
					});
				});
				trackerLogger.warn("玩家来源明牌残留公共区，已尝试用来源占位回补旧公共区槽位", {
					fromSeat,
					fromSubZone,
					toZone,
					position,
					cardIDs: knownCards.map((card) => card.id),
					repairedResidues,
					unrepairedResidues,
					playerSourceSwapAttempts,
					sourceEvent
				});
			}
		}
	};
	function createMoveContext(room, cardIDs, toZone, opt = {}) {
		const { toSeatID, subZone = "hand", spellID, combinationID, fromZone: requestedFromZone, fromSeatID, fromSpellID, cardCount = cardIDs.length, handMoveCount: requestedHandMoveCount, moveType, position = POSITION_TOP, fromPosition = position, expectedSlotsByLocation, anonymizeCards = [], requireAnonymizeSuccess = false, sourceCards, publicCandidateSource, forceRandomHandTransferCandidates = false, postMovePublicCandidates, sourceEvent } = opt;
		const targetSeats = room.normalizeSeats(toSeatID ?? []);
		const hasExplicitFromSeat = fromSeatID !== void 0 && fromSeatID !== null;
		const fromZone = requestedFromZone !== void 0 ? requestedFromZone : hasExplicitFromSeat ? null : "pile";
		const fromZoneNumber = Number(fromZone);
		const fromSeat = hasExplicitFromSeat ? fromSeatID : fromZone !== null && fromZone !== void 0 && fromZone !== "" && Number.isFinite(fromZoneNumber) ? parseInt(String(fromZone)) : null;
		const fromSubZone = opt.fromSubZone ?? subZone ?? "hand";
		const handMoveCount = Math.max(0, Number(requestedHandMoveCount ?? cardCount ?? cardIDs.length));
		const sourceHandSeat = fromSeat !== null && !Number.isNaN(fromSeat) && fromSubZone === "hand" ? fromSeat : null;
		const targetHandSeat = toZone === "player" && subZone === "hand" && targetSeats.length === 1 ? targetSeats[0] : null;
		const knownIDs = cardIDs.filter((id) => id > 0);
		const sourcePlayer = fromSeat !== null && !Number.isNaN(fromSeat) ? room.getPlayer(fromSeat) : null;
		const context = {
			fromPopupSpaceID: opt.fromPopupSpaceID,
			toPopupSpaceID: opt.toPopupSpaceID,
			gainSpellID: opt.gainSpellID !== void 0 ? opt.gainSpellID : targetHandSeat !== null && targetHandSeat !== sourceHandSeat ? opt.pileIdentityEvent?.protocol.SpellID ?? sourceEvent?.spellID ?? spellID ?? null : void 0,
			pileIdentityCardIDs: opt.pileIdentityCardIDs,
			pileIdentityEvent: opt.pileIdentityEvent,
			cardIDs,
			toZone,
			toSeatID,
			subZone,
			spellID,
			combinationID,
			fromZone,
			fromSeat,
			fromSubZone,
			fromSpellID,
			cardCount: Number(cardCount),
			moveType,
			position,
			fromPosition,
			expectedSlotsByLocation,
			anonymizeCards: Array.from(new Set(anonymizeCards)).filter(Boolean),
			requireAnonymizeSuccess,
			sourceCards,
			publicCandidateSource,
			forceRandomHandTransferCandidates,
			postMovePublicCandidates,
			sourceEvent,
			targetSeats,
			handMoveCount,
			sourceHandSeat,
			targetHandSeat,
			sourceHandTotalObserved: sourcePlayer?.hasObservedHandCount === true,
			sourceHandTotalBefore: sourcePlayer?.observedHandCount ?? 0,
			sourceHandUnknownCount: sourcePlayer?.unknownCardCount ?? 0,
			knownIDs,
			sourceIsOutside: fromZone === "outside",
			unknownCount: Math.max(0, Number(cardCount) || 0, cardIDs.length) - knownIDs.length,
			knownCards: [],
			movedUnknownCards: [],
			publicMovedCards: [],
			skipUnknownMovement: false
		};
		trackerLogger.debug("移动上下文创建", summarizeMoveContext({
			...context,
			toSeatID: targetSeats.length === 1 ? targetSeats[0] : null
		}, { includeSourceCardIDs: true }));
		return context;
	}
	var RoomMovementUnknownPlacement = class {
		room;
		sources;
		candidates;
		constructor(room, sources, candidates) {
			this.room = room;
			this.sources = sources;
			this.candidates = candidates;
		}
		move(context) {
			const { combinationID, expectedSlotsByLocation, fromSeat, fromSubZone, fromSpellID, fromPosition, fromZone, position, sourceCards, sourceEvent, sourceIsOutside, spellID, subZone, targetSeats, toZone, unknownCount, moveType } = context;
			if (unknownCount <= 0) return;
			if (context.skipUnknownMovement) {
				trackerLogger.debug("未知牌移动已由特殊候选逻辑接管", {
					requestedCount: unknownCount,
					fromSeat,
					fromSubZone,
					targetSeats,
					subZone,
					spellID
				});
				return;
			}
			if (toZone === "player") {
				const movedUnknownCards = this.sources.takeSourceCards(unknownCount, {
					fromPopupSpaceID: context.fromPopupSpaceID,
					toZone,
					sourceIsOutside,
					fromSeat,
					fromSubZone,
					subZone,
					spellID,
					fromSpellID,
					fromZone,
					fromPosition,
					sourceCards,
					sourceEvent,
					moveType
				});
				context.movedUnknownCards = movedUnknownCards;
				movedUnknownCards.forEach((card) => {
					this.sources.resolveStoredSourceCandidate(card, context);
				});
				this.room.removeCardsFromConstraintGroups(movedUnknownCards);
				movedUnknownCards.forEach((card) => {
					card.bindCandidates(targetSeats, subZone, subZone === "hand" && fromSubZone === "mark" ? null : spellID, { known: card.isKnown });
					if (context.targetHandSeat !== null && context.gainSpellID !== void 0) card.recordHandGain(context.targetHandSeat, context.gainSpellID);
				});
				if (movedUnknownCards.length > 0 && targetSeats.length > 0) this.room.createConstraintGroup({
					id: combinationID ?? void 0,
					cards: movedUnknownCards,
					candidateSeats: targetSeats,
					expectedSlotsByLocation,
					known: false,
					sourceEvent: sourceEvent ?? { type: "moveCards:unknown" }
				});
				trackerLogger.debug("未知牌进入玩家区", {
					requestedCount: unknownCount,
					movedCardIDs: movedUnknownCards.map((card) => card.id),
					fromSeat,
					fromSubZone,
					fromZone,
					targetSeats,
					subZone,
					spellID,
					knownSourceCardIDs: movedUnknownCards.filter((card) => card.isKnown === true).map((card) => card.id),
					constraintCreated: movedUnknownCards.length > 0 && targetSeats.length > 0
				});
				return;
			}
			const movedUnknownCards = this.sources.takeSourceCards(unknownCount, {
				fromPopupSpaceID: context.fromPopupSpaceID,
				toZone,
				sourceIsOutside,
				fromSeat,
				fromSubZone,
				subZone,
				spellID,
				fromSpellID,
				fromZone,
				fromPosition,
				sourceCards,
				sourceEvent,
				moveType
			});
			const takenCount = movedUnknownCards.length;
			if (takenCount < unknownCount) {
				const fallbackCount = unknownCount - takenCount;
				const fallbackCards = this.room.createExternalCards([], fallbackCount);
				if (fallbackCards.length > 0) trackerLogger.warn("来源实体不足，创建匿名暗占位补足公共区移动", {
					reason: "moveUnknownCardsForContext:publicFallback",
					requestedCount: unknownCount,
					takenCount,
					createdPlaceholderCount: fallbackCards.length,
					placeholderCardIDs: fallbackCards.map((card) => card.id),
					fromSeat,
					fromSubZone,
					fromZone,
					fromPosition,
					toZone,
					position,
					spellID,
					sourceEvent
				});
				movedUnknownCards.push(...fallbackCards);
			}
			context.movedUnknownCards = movedUnknownCards;
			movedUnknownCards.forEach((card) => {
				this.sources.resolveStoredSourceCandidate(card, context);
			});
			this.room.removeCardsFromConstraintGroups(movedUnknownCards);
			const targetZone = this.room.zones.get(toZone);
			if (toZone === "popup") {
				movedUnknownCards.forEach((card) => card.resolveLocationCandidate({
					type: "popup",
					spaceID: context.toPopupSpaceID
				}));
				registerPopupSpaceCards(this.room, context.toPopupSpaceID, movedUnknownCards);
				return;
			}
			if (targetZone) targetZone.add(movedUnknownCards, position);
			else movedUnknownCards.forEach((card) => card.moveToPublicZone(toZone));
			context.publicMovedCards.push(...movedUnknownCards);
			this.candidates.updatePublicCandidatesAfterUnknownPileReturn({
				toZone,
				position,
				count: unknownCount
			});
			trackerLogger.debug("未知牌进入公共区", {
				requestedCount: unknownCount,
				takenCount,
				createdFallbackCount: Math.max(0, unknownCount - takenCount),
				movedCardIDs: movedUnknownCards.map((card) => card.id),
				fromSeat,
				fromSubZone,
				fromZone,
				toZone,
				position,
				knownSourceCardIDs: movedUnknownCards.filter((card) => card.isKnown === true).map((card) => card.id),
				targetZoneExists: Boolean(targetZone)
			});
		}
	};
	var RoomMovement = class {
		room;
		sources;
		candidates;
		hiddenMarks;
		knownSources;
		knownPlacement;
		unknownPlacement;
		constructor(room) {
			this.room = room;
			this.hiddenMarks = new RoomMovementHiddenMarks(room);
			this.sources = new RoomMovementSources(room, this.hiddenMarks);
			this.candidates = new RoomMovementCandidates(room);
			this.knownSources = new RoomMovementKnownSources(room, this.sources);
			this.knownPlacement = new RoomMovementKnownPlacement(room, this.sources, this.hiddenMarks);
			this.unknownPlacement = new RoomMovementUnknownPlacement(room, this.sources, this.candidates);
		}
		createMoveContext(cardIDs, toZone, opt = {}) {
			return createMoveContext(this.room, cardIDs, toZone, opt);
		}
		resolveKnownMoveCards(context) {
			const resolution = this.knownSources.resolve(context);
			this.knownSources.confirm(context, resolution);
		}
		applyMoveCandidatePropagation(context) {
			const { fromZone, fromPosition, handMoveCount, position, sourceEvent, sourceHandSeat, subZone, targetHandSeat, toZone, unknownCount, forceRandomHandTransferCandidates } = context;
			if (this.hiddenMarks.handleMuniuMarkMove(context)) return;
			if (this.hiddenMarks.handleHiddenMarkMove(context)) return;
			if (this.candidates.markStoredToHandCandidates({
				fromPopupSpaceID: context.knownIDs.length === 0 ? context.fromPopupSpaceID : void 0,
				fromSeat: context.fromSubZone === "mark" && context.knownIDs.length === 0 ? context.fromSeat : null,
				fromSpellID: context.fromSpellID ?? context.spellID ?? null,
				toSeat: context.targetHandSeat,
				count: context.unknownCount,
				gainSpellID: context.gainSpellID,
				sourceEvent: context.sourceEvent
			})) context.skipUnknownMovement = true;
			if (forceRandomHandTransferCandidates || this.candidates.shouldPropagateRandomHandTransferCandidates({
				sourceSeat: sourceHandSeat,
				targetSeat: targetHandSeat,
				count: handMoveCount,
				unknownCount,
				sourceHandTotalObserved: context.sourceHandTotalObserved,
				sourceHandTotalBefore: context.sourceHandTotalBefore,
				sourceHandUnknownCount: context.sourceHandUnknownCount,
				sourceEvent
			})) {
				const propagatedCards = this.candidates.markRandomHandTransferCandidates({
					fromSeat: sourceHandSeat,
					targetSeat: targetHandSeat,
					count: handMoveCount,
					sourceTotalBefore: context.sourceHandTotalObserved ? context.sourceHandTotalBefore : void 0,
					sourceHandTotalObserved: context.sourceHandTotalObserved,
					sourceUnknownCount: context.sourceHandTotalObserved ? context.sourceHandUnknownCount : void 0,
					sourceEvent,
					force: forceRandomHandTransferCandidates
				});
				context.skipUnknownMovement = propagatedCards.length > 0;
				const gainSpellID = context.gainSpellID;
				if (gainSpellID !== void 0 && targetHandSeat !== null) propagatedCards.forEach((card) => card.recordHandGain(targetHandSeat, gainSpellID));
			}
			if (this.candidates.shouldMarkRandomHandToPublicCandidates(sourceHandSeat, targetHandSeat, toZone, unknownCount)) this.candidates.markRandomHandToPublicCandidates({
				fromSeat: sourceHandSeat,
				toZone,
				position,
				unknownCount,
				candidateSource: context.publicCandidateSource
			});
			const publicHandCandidates = this.candidates.propagatePublicCandidatesToHand({
				fromZone,
				fromPosition,
				toZone,
				targetSeat: targetHandSeat,
				subZone,
				count: handMoveCount,
				sourceEvent
			});
			const gainSpellID = context.gainSpellID;
			if (gainSpellID !== void 0 && targetHandSeat !== null) publicHandCandidates.forEach((card) => card.recordHandGain(targetHandSeat, gainSpellID));
		}
		moveUnknownCardsForContext(context) {
			this.unknownPlacement.move(context);
		}
		moveKnownCardsForContext(context) {
			const placement = this.knownPlacement.prepare(context);
			if (!placement) return;
			this.knownPlacement.moveEachCard(context, placement);
			this.knownPlacement.finishMove(context, placement);
		}
		createPublicMoveConstraintGroup(context) {
			const { combinationID, publicMovedCards, sourceEvent, toZone } = context;
			if (toZone === "player" || !combinationID || publicMovedCards.length === 0) return;
			this.room.createConstraintGroup({
				id: combinationID,
				cards: publicMovedCards,
				sourceEvent: sourceEvent ?? { type: "moveCards:publicGroup" }
			});
		}
	};
	var GUI_FU_ROLE_DATA_ID = 3709;
	var FULL_HAND_ROLE_OPT_SPELL_IDS = new Set([
		4,
		5,
		357,
		372,
		501,
		811,
		921,
		3119,
		3437,
		3876,
		4025
	]);
	var PARTIAL_HAND_ROLE_OPT_SPELL_IDS = new Set([
		774,
		851,
		3310
	]);
	function shouldIgnoreTrackerMove({ CardCount, MoveType, ToZone, isSend }) {
		return CardCount === 0 || MoveType === 0 || ToZone === 11 || !!isSend;
	}
	function hasMixedTrackerMoveVisibility({ CardIDs, CardCount }) {
		const knownCount = CardIDs.filter((cardID) => cardID > 0).length;
		return knownCount !== CardCount && knownCount !== 0;
	}
	function normalizeTrackerMovePosition({ CardIDs, CardCount, FromZone, FromPosition, ToID, ToZone, ToPosition, MoveType, SpellID }) {
		let fromPosition = FromPosition;
		let toPosition = ToPosition;
		if (FromZone === 1 && FromPosition === 65282 && SpellID === 3208) fromPosition = POSITION_TOP;
		if (FromZone === 1 && FromPosition === 65282 && MoveType === 13 && CardCount === 1) fromPosition = POSITION_TOP;
		if (FromZone === 1 && FromPosition === 65282 && ToZone === 4 && MoveType === 8 && SpellID === 795 && CardCount === 1) fromPosition = POSITION_TOP;
		if (FromZone === 1 && FromPosition === 65282 && ToZone === 5 && SpellID === 3101 && CardCount === 1) fromPosition = 0;
		if (FromZone === 1 && FromPosition === 65281 && ToZone === 5 && SpellID === 0 && MoveType === 1 && CardCount === 4 && CardIDs.length === CardCount && CardIDs.every((id) => CardConfig.GetInstance().getCard(id)?.type == 8)) fromPosition = POSITION_RANDOM;
		if (SpellID === 3694 && FromZone === 0 && ToZone === 1 && ToPosition === 65281 && MoveType === 19) toPosition = POSITION_RANDOM;
		if (ToZone === 1 && ToID === 255 && ToPosition === 65280 && CardIDs.some((cardID) => cardID === 4400 || cardID === 4401)) toPosition = POSITION_RANDOM;
		if (FromZone === 5 && ToZone === 1 && SpellID === 0 && MoveType === 19) toPosition = POSITION_RANDOM;
		return {
			FromPosition: fromPosition,
			ToPosition: toPosition
		};
	}
	function shouldRevealAsFullHand({ handCount, observedHandCount, localHandCount }) {
		const count = Number(handCount) || 0;
		if (count <= 0) return false;
		if (observedHandCount !== void 0 && observedHandCount !== null) return count === Number(observedHandCount);
		const fallbackCount = Number(localHandCount) || 0;
		return fallbackCount > 0 && count === fallbackCount;
	}
	var DIRTY_CARD_EVENT_LIMIT = 500;
	var Room = class extends RoomBase {
		isDeckReady = false;
		cards = [];
		detachedKnownCards = new Set();
		detachedIdentitySeq = 0;
		detachedCardOrder = new WeakMap();
		get trackedCards() {
			return this.detachedKnownCards.size === 0 ? this.cards : [...this.cards, ...this.detachedKnownCards];
		}
		cardIndex = new Map();
		unlocatedIdentities = new Set();
		deckIdentities = new Set();
		anonymousEntitySeq = -1;
		playerSnapshot = new PlayerSnapshot(this);
		identity = new RoomIdentity(this);
		moveEvents = new RoomMoveEvents(this);
		get skillHandlers() {
			return this.moveEvents.skillHandlers;
		}
		get moveEventHandlers() {
			return this.moveEvents.moveEventHandlers;
		}
		get playerCardsSnapshot() {
			return this.playerSnapshot.cards;
		}
		constructor({ gameState = new GameState() } = {}) {
			super(gameState);
			this.zones = new Map([
				["outside", new Zone("outside", this)],
				["pile", new Zone("pile", this)],
				["discard", new Zone("discard", this)],
				["exile", new Zone("exile", this)],
				["process", new Zone("process", this)],
				["exchange", new Zone("exchange", this)]
			]);
			this.constraintGroups = new Map();
			this.constraintGroupSeq = 0;
			this.constraintGroupsDirty = false;
			this.lastResolveRounds = 0;
			this.maxResolveRounds = 0;
			this.ambiguousKnownIndex = new AmbiguousKnownIndex(this);
			this.locationIndex = new CardLocationIndex();
			this.suspendedKnownCards = new Set();
			this.resolveTouchedSeats = null;
			this.viewDirty = false;
			this.dirtyCards = new Set();
			this.dirtyCardEvents = [];
			this.dirtyCardSeq = 0;
			this.dirtyPublicZones = new Set();
			this.cardChangeEvents = [];
			this.publicZones = new RoomPublicZones(this);
			this.constraints = new RoomConstraints(this);
			this.movement = new RoomMovement(this);
			this.pileIdentityLedger = new PileIdentityLedger();
			this.game.bindRoom(this);
		}
		initDeck(cardIDs) {
			this.isDeckReady = false;
			this.cards.length = 0;
			this.detachedKnownCards.clear();
			this.detachedIdentitySeq = 0;
			this.detachedCardOrder = new WeakMap();
			this.playerSnapshot.reset();
			this.cardIndex.clear();
			this.unlocatedIdentities = new Set(cardIDs.filter((id) => id > 0));
			this.deckIdentities = new Set(this.unlocatedIdentities);
			this.anonymousEntitySeq = -1;
			const pile = this.getZone("pile");
			this.zones.forEach((zone) => zone.clear());
			const deckCards = [];
			for (let i = 0; i < cardIDs.length; i += 1) {
				const card = new Card(0, this);
				this.registerCardEntity(card);
				deckCards.push(card);
			}
			pile.replaceAll(deckCards);
			this.pileIdentityLedger.initialize(cardIDs);
			this.assertPileIdentityLedgerConsistency("initDeck");
			this.locationIndex.rebuild(this);
			this.ambiguousKnownIndex.rebuild(Array.from(this.constraintGroups.values()));
			this.rebuildPlayerSnapshot();
			this.constraintGroupsDirty = false;
			this.dirtyPublicZones.clear();
			this.counter = new CardCounter(this);
			this.isDeckReady = true;
			this.publicZones.assertPublicZoneConsistency("initDeck");
			this.moveEvents.onDeckInitialized();
		}
		applyPileIdentityMove(move) {
			try {
				const context = `move:${move.eventType}`;
				this.pileIdentityLedger.applyMove({
					...move,
					pileCountAfter: this.getZone("pile").cards.length,
					discardCountAfter: this.getZone("discard").cards.length
				});
				this.identity.anonymizePileCohortIdentityEntities(context);
				this.assertPileIdentityLedgerConsistency(context);
			} catch (error) {
				trackerLogger.warn("牌堆身份账本移动更新失败", {
					error,
					move
				});
			}
		}
		applyPileIdentityReveal(cardIDs, location) {
			try {
				const normalizedCardIDs = cardIDs.map(Number).filter((cardID) => cardID > 0);
				const revealGroups = [
					["pile", []],
					["discard", []],
					["outside", []]
				];
				const groupByLocation = new Map(revealGroups);
				normalizedCardIDs.forEach((cardID) => {
					const card = this.cardIndex.get(cardID);
					if (card && this.detachedKnownCards.has(card)) return;
					const actualLocation = card?.location;
					const revealLocation = actualLocation === "pile" ? "pile" : actualLocation === "discard" ? "discard" : actualLocation ? "outside" : location;
					if (!revealLocation) return;
					groupByLocation.get(revealLocation).push(cardID);
				});
				for (const [revealLocation, groupedCardIDs] of revealGroups) {
					if (groupedCardIDs.length === 0) continue;
					this.pileIdentityLedger.applyReveal({
						cardIDs: groupedCardIDs,
						location: revealLocation,
						pileCountAfter: this.getZone("pile").cards.length,
						discardCountAfter: this.getZone("discard").cards.length
					});
					this.assertPileIdentityLedgerConsistency(`reveal:${revealLocation}`);
				}
			} catch (error) {
				trackerLogger.warn("牌堆身份账本揭示更新失败", {
					error,
					cardIDs,
					location
				});
			}
		}
		assertPileIdentityLedgerConsistency(context = "") {
			return [];
		}
		registerPlayers(infos, currentUserID) {
			this.seatIDs = [];
			this.players.clear();
			this.mySeatID = void 0;
			infos.forEach((info) => {
				const seatNum = info.seat_id ?? info.SeatID ?? 0;
				if (!this.seatIDs.includes(seatNum)) this.seatIDs.push(seatNum);
				const player = new Player(seatNum, this);
				this.players.set(seatNum, player);
				const uuid = info.user_temp_id ?? info.ClientID ?? void 0;
				if (currentUserID !== void 0 && uuid === currentUserID) this.setMySeatID(seatNum);
			});
			this.seatIDs.sort((a, b) => a - b);
			this.size = this.seatIDs.length;
			this.game.syncRoomSeats(this);
			this.game.isRecord = this.mySeatID === void 0;
			trackerLogger.info("Room 注册玩家", {
				seatIDs: this.seatIDs,
				currentUserID,
				mySeatID: this.mySeatID
			});
		}
		setPlayerShowStatuses(statuses) {
			let changed = false;
			for (const [seatID, status] of statuses) {
				const player = this.getPlayer(seatID);
				if (!player || player.isShown === (status === 1)) continue;
				player.isShown = status === 1;
				changed = true;
			}
			if (changed) {
				this.updateFixedViewIds();
				this.markViewDirty("player-show-status");
			}
			return changed;
		}
		registerSkillHandler(spellID, handler) {
			this.moveEvents.registerSkillHandler(spellID, handler);
		}
		registerMoveEventHandler(spellID, handler) {
			this.moveEvents.registerMoveEventHandler(spellID, handler);
		}
		registerSkillPlugin(plugin) {
			this.moveEvents.registerSkillPlugin(plugin);
		}
		beforeNormalizeMove(patched, raw) {
			return this.moveEvents.beforeNormalizeMove(patched, raw);
		}
		afterMoveCommitted(event) {
			this.moveEvents.afterMoveCommitted(event);
		}
		notifyCardsRevealed(cardIDs) {
			this.moveEvents.notifyCardsRevealed(cardIDs);
		}
		dispatchSkillProtocolEvent(event) {
			return this.moveEvents.dispatchSkillProtocolEvent(event);
		}
		decorateMoveEvent(event) {
			return this.moveEvents.decorateMoveEvent(event);
		}
		normalizeSeats(seatID) {
			return (Array.isArray(seatID) ? seatID : [seatID]).map((seat) => Number(seat)).filter((seat) => Number.isInteger(seat) && seat >= 0 && seat < 8 && (this.seatIDs.length === 0 || this.seatIDs.includes(seat)));
		}
		mergeCandidateSeats(currentSeats, nextSeats = []) {
			const normalizedNextSeats = this.normalizeSeats(nextSeats);
			if (normalizedNextSeats.length === 0) return new Set(Array.from(currentSeats ?? []).map((seat) => Number(seat)));
			if (!currentSeats || currentSeats.size === 0) return new Set(normalizedNextSeats);
			const nextSeatSet = new Set(normalizedNextSeats);
			const intersection = Array.from(currentSeats).map((seat) => Number(seat)).filter((seat) => nextSeatSet.has(seat));
			return new Set(intersection.length > 0 ? intersection : normalizedNextSeats);
		}
		findCardsByIDs(cardIDs = []) {
			return cardIDs.filter((id) => id > 0).map((id) => this.cardIndex.get(id)).filter((card) => card !== void 0);
		}
		getPublicEndpointCards(zoneID, count, position) {
			const cards = this.zones.get(zoneID)?.cards ?? [];
			if (!(count > 0)) return [];
			if (normalizePublicPosition(position) === "bottom") return cards.slice(0, count);
			return cards.slice(-count).reverse();
		}
		anonymizeLocatedIdentity(card, reason = "anonymizeLocatedIdentity", options = {}) {
			const releasedIdentityID = this.identity.anonymizeLocatedIdentity(card, reason, options);
			if (releasedIdentityID !== null) this.assertIdentityReleased(releasedIdentityID, reason);
			return releasedIdentityID;
		}
		assertIdentityReleased(cardID, reason) {}
		releaseUnknownPlaceholderToOutside(card, reason) {
			return this.identity.releaseUnknownPlaceholderToOutside(card, reason);
		}
		probeMaterialize(cardID, target = null) {
			return this.identity.probeMaterialize(cardID, target);
		}
		materialize(cardID, target = null) {
			return this.identity.materialize(cardID, target);
		}
		materializeAtPublicEndpoint(cardIDs, zoneID, position) {
			return this.identity.materializeAtPublicEndpoint(cardIDs, zoneID, position);
		}
		resolvePublicKnownCards(ids, target = null, logger) {
			return this.identity.resolvePublicKnownCards(ids, target, logger);
		}
		placePublicRevealCards(knownCards, zoneName, options = {}, logger) {
			this.publicZones.placePublicRevealCards(knownCards, zoneName, options, logger);
		}
		registerCardEntity(card) {
			this.cards.push(card);
			this.playerSnapshot.registerCard(card, this.cards.length - 1);
			this.locationIndex.registerCard(card, this.cards.length - 1);
		}
		registerDetachedKnownCard(card) {
			this.detachedKnownCards.add(card);
			const order = 2 ** 32 + this.detachedIdentitySeq++;
			this.detachedCardOrder.set(card, order);
			this.playerSnapshot.registerCard(card, order);
			this.locationIndex.registerCard(card, order);
		}
		getDetachedCardOrder(card) {
			return this.detachedKnownCards.has(card) ? this.detachedCardOrder.get(card) : void 0;
		}
		allocateAnonymousEntityID() {
			return this.anonymousEntitySeq--;
		}
		createExternalCards(cardIDs = [], count = cardIDs.length) {
			return this.identity.createExternalCards(cardIDs, count);
		}
		clearCardsFromPublicZones(cards = []) {
			return this.publicZones.clearCardsFromPublicZones(cards);
		}
		getZone(zoneID) {
			return this.zones.get(zoneID);
		}
		getPublicZone(zoneID) {
			return zoneID && this.zones.has(zoneID) ? this.getZone(zoneID) : this.getZone("pile");
		}
		resolveEquipmentContainerLocationCandidates(candidate) {
			return this.movement.hiddenMarks.resolveEquipmentContainerLocationCandidates(candidate);
		}
		getPlayerHandCardIDs(seatID, options = {}) {
			return this.publicZones.getPlayerHandCardIDs(seatID, options);
		}
		shouldRevealPlayerHandAsFullHand(seatID, handCount) {
			const player = this.getPlayer(seatID);
			if (player?.hasObservedHandCount) return shouldRevealAsFullHand({
				handCount,
				observedHandCount: player.observedHandCount
			});
			const normalizedSeat = Number(seatID);
			const localHandCount = this.refreshPlayerSnapshot().filter((card) => card.subZone === "hand" && card.seats.has(normalizedSeat)).length;
			return shouldRevealAsFullHand({
				handCount,
				localHandCount
			});
		}
		removeCardsFromConstraintGroups(cards = []) {
			return this.constraints.removeCardsFromConstraintGroups(cards);
		}
		notifyCardChanged(card, event = {}) {
			if (!card) return;
			const touchedSeats = this.resolveTouchedSeats;
			if (touchedSeats) {
				card.seats.forEach((seatID) => touchedSeats.add(seatID));
				if (Array.isArray(event.previousSeats)) {
					for (const seatID of event.previousSeats) if (typeof seatID === "number") touchedSeats.add(seatID);
				}
				for (const key of [
					"previousOwner",
					"nextOwner",
					"previousResolvedSeat",
					"nextResolvedSeat"
				]) {
					const seatID = event[key];
					if (typeof seatID === "number") touchedSeats.add(seatID);
				}
			}
			this.markCounterDirty(card);
			this.markViewDirty("card-changed");
			this.dirtyCards.add(card);
			this.dirtyCardSeq += 1;
			this.dirtyCardEvents.push({
				seq: this.dirtyCardSeq,
				card,
				detail: event
			});
			if (this.dirtyCardEvents.length > DIRTY_CARD_EVENT_LIMIT) this.dirtyCardEvents.splice(0, this.dirtyCardEvents.length - DIRTY_CARD_EVENT_LIMIT);
			this.cardChangeEvents.push({
				cardID: card.id,
				...event
			});
			if (this.cardChangeEvents.length > 100) this.cardChangeEvents.splice(0, this.cardChangeEvents.length - 100);
		}
		markCounterDirty(card) {
			this.counter?.markDirty(card);
		}
		ensureDetachedKnownIdentity(cardID) {
			return this.identity.ensureDetachedKnownIdentity(cardID);
		}
		revealPublicCandidates(cardIDs, candidate) {
			const cards = cardIDs.map((cardID) => this.ensureDetachedKnownIdentity(cardID)).filter((card) => Boolean(card));
			cards.forEach((card) => card.setLocationCandidates([candidate], "revealPublicCandidate"));
			this.pileIdentityLedger.applyReveal({
				cardIDs: cards.map((card) => card.id),
				location: candidate.zone === "pile" ? "pile" : candidate.zone === "discard" ? "discard" : "outside",
				pileCountAfter: this.getZone("pile").cards.length,
				discardCountAfter: this.getZone("discard").cards.length
			});
			this.resolveConstraints();
			this.assertPileIdentityLedgerConsistency("revealPublicCandidate");
			return cards;
		}
		markViewDirty(_reason = "view-dirty") {
			this.viewDirty = true;
		}
		markPublicZoneDirty(zoneID) {
			if (zoneID === null || zoneID === void 0) return;
			this.dirtyPublicZones.add(zoneID);
			this.markViewDirty(`public-zone:${zoneID}`);
		}
		markConstraintGroupsDirty(_reason = "constraint-groups-dirty") {
			this.constraintGroupsDirty = true;
		}
		deleteConstraintGroup(groupID) {
			return this.constraintGroups.delete(groupID);
		}
		shufflePile(options = {}) {
			const pile = this.getZone("pile");
			const discard = this.getZone("discard");
			const normalizedCardCount = options.cardCount !== null && options.cardCount !== void 0 ? Math.floor(Number(options.cardCount)) : NaN;
			const hasProtocolPileCount = Number.isFinite(normalizedCardCount) && normalizedCardCount >= 0;
			const remainingPileCards = [...pile.cards];
			const recycledCards = [...discard.cards];
			const projectedPileCount = remainingPileCards.length + recycledCards.length;
			const targetPileCount = hasProtocolPileCount ? normalizedCardCount : projectedPileCount;
			const knownRemainingPileCards = remainingPileCards.filter((card) => card.id > 0 && card.isKnown === true);
			const ambiguousRemainingPileCards = knownRemainingPileCards.length > targetPileCount ? knownRemainingPileCards : [];
			const shuffleIdentityCards = [...recycledCards, ...ambiguousRemainingPileCards];
			const knownDiscardIdentityIDsBefore = shuffleIdentityCards.map((card) => card.id).filter((cardID) => cardID > 0);
			const identityMove = {
				eventType: "shuffleDiscardIntoPile",
				fromZone: 2,
				toZone: 9,
				cardIDs: [],
				cardCount: targetPileCount,
				pileCountBefore: remainingPileCards.length,
				visiblePileIdentityIDsAfter: ambiguousRemainingPileCards.length > 0 ? [] : this.identity.collectVisiblePileTopIdentityIDs(),
				ambiguousDiscardRecycleGroups: options.ambiguousDiscardRecycleGroups
			};
			const shuffleTransition = this.applyPileIdentityShuffleBeforePhysicalMove(identityMove, targetPileCount, Math.max(0, targetPileCount - remainingPileCards.length), knownDiscardIdentityIDsBefore);
			const closesPileGeneration = shuffleTransition?.closesGeneration === true;
			const recycledIdentityIDs = new Set(shuffleTransition?.recycledIdentityIDs ?? knownDiscardIdentityIDsBefore);
			const expiringIdentityIDs = shuffleTransition?.expiringIdentityIDs ?? [];
			const identityContext = `move:${identityMove.eventType}`;
			const newlySuspendedCardIDs = [];
			const rebuildPileAfterShuffle = () => {
				for (let i = recycledCards.length - 1; i > 0; i -= 1) {
					const randomIndex = Math.floor(Math.random() * (i + 1));
					const recycledCard = recycledCards[randomIndex];
					recycledCards[randomIndex] = recycledCards[i];
					recycledCards[i] = recycledCard;
				}
				const rebuiltPileCards = this.publicZones.resizeShuffledPile([...recycledCards, ...remainingPileCards], targetPileCount);
				pile.replaceAll(rebuiltPileCards);
				return rebuiltPileCards;
			};
			if (closesPileGeneration) {
				const suspensionResult = this.identity.suspendUnresolvedPileIdentitiesForShuffle(expiringIdentityIDs, recycledIdentityIDs);
				newlySuspendedCardIDs.push(...suspensionResult.suspendedIdentityIDs);
			}
			if (shuffleIdentityCards.length > 0) shuffleIdentityCards.forEach((card) => {
				if (card.id <= 0) return;
				this.anonymizeLocatedIdentity(card, "shufflePile:recycledIdentity");
			});
			recycledCards.forEach((card) => card.reset());
			this.removeCardsFromConstraintGroups(remainingPileCards);
			this.removeCardsFromConstraintGroups(recycledCards);
			const rebuiltPileCards = rebuildPileAfterShuffle();
			const actualPileCount = pile.cards.length;
			const rebuiltPileCount = rebuiltPileCards.length;
			const discardCountAfterShuffle = discard.cards.length;
			if (actualPileCount !== targetPileCount || actualPileCount !== rebuiltPileCount || discardCountAfterShuffle !== 0) trackerLogger.warn("洗牌后实际牌堆实体数量不一致", {
				reason: "shufflePile:actualPileConsistency",
				targetPileCount,
				actualPileCount,
				rebuiltPileCount,
				discardCountAfterShuffle,
				rebuiltPileCardIDs: rebuiltPileCards.map((card) => card.id),
				actualPileCardIDs: pile.cards.map((card) => card.id)
			});
			if (newlySuspendedCardIDs.length > 0) trackerLogger.info("洗牌后暂停追踪旧牌堆世代中尚未出现的身份", {
				suspendedCardIDs: newlySuspendedCardIDs,
				activeSuspendedCardIDs: Array.from(this.suspendedKnownCards, (card) => card.id).filter((cardID) => cardID > 0)
			});
			this.identity.anonymizePileCohortIdentityEntities(identityContext);
			this.detachedKnownCards.forEach((card) => {
				card.removePublicCandidates((candidate) => candidate.zone === "pile" || candidate.zone === "discard");
			});
			this.resolveConstraints();
			this.assertPileIdentityLedgerConsistency(identityContext);
		}
		applyPileIdentityShuffleBeforePhysicalMove(move, pileCountAfter, discardCountBefore, knownDiscardIdentityIDsBefore) {
			try {
				const result = this.pileIdentityLedger.applyMove({
					...move,
					discardCountBefore,
					knownDiscardIdentityIDsBefore,
					pileCountAfter,
					discardCountAfter: 0
				});
				if (result.committed && result.shuffleTransition) return result.shuffleTransition;
				trackerLogger.warn("洗牌前牌堆身份账本事务未提交，已跳过旧世代身份暂停", {
					move,
					pileCountAfter,
					discardCountBefore,
					knownDiscardIdentityIDsBefore
				});
			} catch (error) {
				trackerLogger.warn("洗牌前牌堆身份账本更新失败，已跳过旧世代身份暂停", {
					error,
					move,
					pileCountAfter,
					discardCountBefore,
					knownDiscardIdentityIDsBefore
				});
			}
			return null;
		}
		createConstraintGroup(options = {}) {
			return this.constraints.createConstraintGroup(options);
		}
		resolveConstraints() {
			this.constraints.resolveConstraints(void 0);
			reconcilePopupSpaces(this);
		}
		rebuildPlayerSnapshot() {
			return this.playerSnapshot.rebuild();
		}
		refreshPlayerSnapshot() {
			return this.playerSnapshot.refresh();
		}
		assertConservation(context = "") {}
		assertPlayerSnapshotConsistency(playerCards) {}
		assertLocationIndexConsistency() {}
		assertAmbiguousKnownIndexConsistency() {}
		resumeSuspendedKnownCard(card) {
			return this.constraints.resumeSuspendedKnownCard(card);
		}
		syncObservedPlayerHandCount(seatID, count, options = {}) {
			const player = this.getPlayer(seatID);
			if (!player) return;
			player.syncObservedHandCount(count);
			if (options.resolve !== false) this.resolveConstraints();
		}
		moveCards(cardIDs, toZone, opt = {}) {
			const context = this.movement.createMoveContext(cardIDs, toZone, opt);
			const pileSnapshot = this.identity.capturePileMoveSnapshot(context);
			const anonymization = this.identity.anonymizeMoveSourceCards(context.anonymizeCards, context.requireAnonymizeSuccess);
			if (!anonymization.success) return false;
			if (anonymization.pileIdentityIDs.length > 0) this.pileIdentityLedger.anonymizeKnownPileIdentities(anonymization.pileIdentityIDs, "moveCards:ambiguousSource");
			this.movement.sources.applyHandTotalDelta(context.sourceHandSeat, context.targetHandSeat, context.handMoveCount);
			this.movement.hiddenMarks.resolveHiddenMarkCandidatesFromFullHandReveal(context);
			this.movement.resolveKnownMoveCards(context);
			this.movement.applyMoveCandidatePropagation(context);
			this.movement.moveUnknownCardsForContext(context);
			this.movement.moveKnownCardsForContext(context);
			const inferredIdentityIDs = this.identity.anonymizeRandomPileReturn(context);
			if (inferredIdentityIDs.length > 0) this.pileIdentityLedger.insertKnown(inferredIdentityIDs, inferredIdentityIDs.length, POSITION_RANDOM, "moveCards:inferredRandomPileReturn");
			context.postMovePublicCandidates?.forEach(({ card, candidate }) => {
				if (!context.publicMovedCards.includes(card) || card.location !== candidate.zone) return;
				card.addPublicCandidate(candidate);
			});
			this.movement.createPublicMoveConstraintGroup(context);
			this.getZone("exchange").completeExchangeMove();
			this.identity.commitPileIdentityForMove(context, pileSnapshot);
			this.resolveConstraints();
			this.assertPileIdentityLedgerConsistency("moveCards");
			trackerLogger.info("moveCards 完成", {
				...summarizeMoveContext(context, { includeKnownCardIDs: true }),
				publicMovedCardIDs: context.publicMovedCards.map((card) => card.id),
				movedUnknownCardIDs: context.movedUnknownCards.map((card) => card.id),
				dirtyCardCount: this.dirtyCards.size,
				constraintGroupCount: this.constraintGroups.size
			});
			return true;
		}
		destroy() {
			if (this.game.room === this) this.game.bindRoom(null);
			trackerLogger.info("Room destroy 开始", {
				cardCount: this.cards.length,
				playerCount: this.players.size,
				constraintGroupCount: this.constraintGroups.size,
				suspendedCount: this.suspendedKnownCards.size
			});
			this.players.forEach((player) => player.reset());
			this.players.clear();
			this.zones.forEach((zone) => zone.clear());
			this.trackedCards.forEach((card) => card.reset());
			this.detachedKnownCards.clear();
			this.detachedIdentitySeq = 0;
			this.detachedCardOrder = new WeakMap();
			this.constraintGroups.clear();
			this.constraintGroupsDirty = false;
			this.maxResolveRounds = 0;
			this.lastResolveRounds = 0;
			this.moveEvents.clear();
			this.ambiguousKnownIndex.items.clear();
			this.ambiguousKnownIndex.containerDependentCards.clear();
			this.ambiguousKnownIndex.lastConsumedSeq = 0;
			this.suspendedKnownCards.clear();
			this.dirtyCards.clear();
			this.dirtyCardEvents = [];
			this.dirtyCardSeq = 0;
			this.dirtyPublicZones.clear();
			this.playerSnapshot.reset();
			this.cardChangeEvents = [];
			this.viewDirty = false;
			this.cards = [];
			this.cardIndex.clear();
			this.unlocatedIdentities.clear();
			this.deckIdentities.clear();
			this.anonymousEntitySeq = -1;
			this.isDeckReady = false;
			this.seatIDs = [];
			this.size = 0;
			this.firstID = void 0;
			this.mySeatID = void 0;
			trackerLogger.info("Room destroy 完成");
		}
	};
	function getCount(event) {
		return event.cardCount;
	}
	function hasPositiveID(cardIDs = []) {
		return cardIDs.some((id) => id > 0);
	}
	function nextGroupID(room, spellID, label) {
		return `${label}_${spellID}_${++room.constraintGroupSeq}`;
	}
	function patchEvent(event, patch = {}) {
		return {
			...event,
			type: patch.type ?? event.type,
			cardIDs: patch.cardIDs ?? event.cardIDs,
			cardCount: patch.cardCount ?? event.cardCount,
			options: {
				...event.options,
				...patch.options ?? {}
			}
		};
	}
	function getSourceZoneCards(event, room) {
		const zoneID = event.options?.fromZone;
		if (typeof zoneID !== "string") return [];
		return room.zones.get(zoneID)?.cards ?? [];
	}
	function getEventSourceCards(event, room) {
		const count = getCount(event);
		const knownCards = room.findCardsByIDs(event.cardIDs);
		if (knownCards.length > 0) return knownCards.slice(0, count);
		const fromSeat = event.options?.fromSeatID;
		if (fromSeat !== void 0 && fromSeat !== null) return getUnknownPlayerCards(room, fromSeat, count, event.options?.fromSubZone ?? "hand");
		return getTopFirstCards(getSourceZoneCards(event, room)).slice(0, count);
	}
	function getUnknownPlayerCards(room, seatID, count, subZone = "hand") {
		if (seatID === void 0) return [];
		const playerCards = [];
		if (!(count > 0)) return playerCards;
		const unknownCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? room.cards;
		for (const card of unknownCards) if (card.location === "player" && card.subZone === subZone && card.seats.has(seatID) && card.isKnown !== true) {
			playerCards.push(card);
			if (playerCards.length >= count) break;
		}
		return playerCards;
	}
	function getTopFirstCards(cards = []) {
		return cards.slice().reverse();
	}
	var CHENG_LIE_DISCARD_QUEUE = "chengLieDiscardQueue";
	function decorateChengLieMove(event, room) {
		const move = event.protocol;
		if (event.type === "noop" || move.SpellID !== 3208) return event;
		const fromZone = move.FromZone;
		const toZone = move.ToZone;
		const fromZoneParam = move.FromZoneParam;
		const moveType = move.MoveType;
		const pendingIDs = room.readSkillState(CHENG_LIE_DISCARD_QUEUE);
		if (hasPositiveID(event.cardIDs)) {
			if (pendingIDs) {
				const ids = new Set(getPositiveIDs(event.cardIDs));
				room.setSkillState(CHENG_LIE_DISCARD_QUEUE, pendingIDs.filter((id) => !ids.has(id)));
			}
			return event;
		}
		if (fromZone === 4 && fromZoneParam === 3208 && toZone === 2 && moveType === 15 && pendingIDs) {
			const availableIDs = pendingIDs.filter((id) => room.cardIndex.get(id)?.location === "outside");
			const cardIDs = availableIDs.slice(0, getCount(event));
			const remainingIDs = availableIDs.slice(cardIDs.length);
			if (remainingIDs.length > 0) room.setSkillState(CHENG_LIE_DISCARD_QUEUE, remainingIDs);
			else room.deleteSkillState(CHENG_LIE_DISCARD_QUEUE);
			return patchEvent(event, {
				cardIDs,
				options: { pileIdentityCardIDs: cardIDs }
			});
		}
		if (fromZone === 10) {
			if (toZone === 10) return event;
			const exchange = room.getZone("exchange");
			const knownCards = exchange.cards.filter((card) => card.id > 0);
			const placeholders = room.createExternalCards([], knownCards.length);
			knownCards.forEach((card, index) => {
				const placeholder = placeholders[index];
				placeholder.moveToPublicZone("exchange");
				exchange.replaceCard(card, placeholder);
				if (pendingIDs?.includes(card.id)) {
					room.removeCardsFromConstraintGroups([card]);
					card.moveToPublicZone("outside");
				} else room.constraints.suspendKnownCard(card, "chengLie:hiddenExchange");
			});
			return event;
		}
		if (moveType !== MOVE_TYPE.EXCHANGE || fromZone !== 1 || toZone !== 10) return event;
		const cards = room.getPublicEndpointCards("pile", getCount(event), POSITION_TOP);
		const knownCards = new Set(cards.filter((card) => card.id > 0 && card.isKnown === true));
		const cardIDs = Array.from(knownCards, (card) => card.id);
		room.setSkillState(CHENG_LIE_DISCARD_QUEUE, [...new Set([...pendingIDs ?? [], ...cardIDs])]);
		return patchEvent(event, {
			cardIDs,
			options: {
				fromPosition: POSITION_TOP,
				sourceCards: cards.filter((card) => !knownCards.has(card)),
				pileIdentityCardIDs: cardIDs
			}
		});
	}
	var FEN_CHAO_SPELL_ID = 3752;
	var FEN_CHAO_CARD_SPELL_IDS = new Set([
		1,
		8,
		9,
		10,
		83
	]);
	function decorateFenChao(event, room) {
		const move = event.protocol;
		if (hasPositiveID(event.cardIDs) || move.FromZone !== PROTOCOL_ZONE.DISCARD || move.ToZone !== PROTOCOL_ZONE.HAND || move.MoveType !== MOVE_TYPE.GAIN || move.FromPosition !== 65282) return event;
		const cardCount = getCount(event);
		if (cardCount === 0) return event;
		const sourceCards = [];
		for (const card of room.getZone("discard").cards) {
			if (!FEN_CHAO_CARD_SPELL_IDS.has(card.spellId)) continue;
			sourceCards.push(card);
			if (sourceCards.length === cardCount) break;
		}
		if (sourceCards.length === 0) return event;
		return patchEvent(event, { options: {
			sourceCards,
			combinationID: nextGroupID(room, FEN_CHAO_SPELL_ID, "fenchao_discard_candidate")
		} });
	}
	var GUAN_XU_STATE_KEY = "guanXuExchange";
	var GUAN_XU_SPELL_IDS = new Set([987, 988]);
	function ensureGuanXuState(room) {
		return room.ensureSkillState(GUAN_XU_STATE_KEY, () => ({ bySpell: {} }));
	}
	function getGuanXuState(room) {
		return room.readSkillState(GUAN_XU_STATE_KEY);
	}
	function getBatch$1(room, spellID) {
		return getGuanXuState(room)?.bySpell[String(spellID)];
	}
	function clearBatch$2(room, spellID) {
		const state = getGuanXuState(room);
		if (!state) return;
		Object.values(state.bySpell[String(spellID)]?.buckets ?? {}).forEach((bucket) => room.publicZones.deleteExchangeBatch(bucket.batchKey));
		delete state.bySpell[String(spellID)];
		if (Object.keys(state.bySpell).length === 0) room.deleteSkillState(GUAN_XU_STATE_KEY);
	}
	function clearBatchIfEmpty(room, spellID, batch) {
		if (Object.keys(batch.buckets).length === 0) clearBatch$2(room, spellID);
	}
	function getHandCards$1(room, seatID) {
		return room.refreshPlayerSnapshot().filter((card) => card.subZone === "hand" && card.seats.has(seatID));
	}
	function resolveProtocolKnownCards(event, room, candidates) {
		const selected = [];
		const selectedSet = new Set();
		const anonymousTargets = candidates.filter((card) => card.isAnonymous);
		const plannedCardsByID = new Map();
		const commits = [];
		getPositiveIDs(event.cardIDs ?? []).forEach((cardID) => {
			let card = candidates.find((candidate) => candidate.id === cardID) ?? plannedCardsByID.get(cardID) ?? null;
			let commit = null;
			if (!card) {
				const target = anonymousTargets[0] ?? null;
				const probedCard = room.probeMaterialize(cardID, target);
				if (probedCard && candidates.includes(probedCard)) {
					card = probedCard;
					if (probedCard === target) {
						anonymousTargets.shift();
						plannedCardsByID.set(cardID, probedCard);
						commit = {
							type: "materialize",
							cardID,
							target: probedCard
						};
					} else commit = {
						type: "confirm",
						cardID,
						card: probedCard
					};
				}
			} else if (!(plannedCardsByID.get(cardID) === card)) commit = {
				type: "confirm",
				cardID,
				card
			};
			if (!card || selectedSet.has(card)) return;
			selectedSet.add(card);
			selected.push(card);
			if (commit) commits.push(commit);
		});
		return {
			cards: selected,
			commits
		};
	}
	function commitProtocolKnownCards(room, resolution) {
		if (!resolution.commits.every((commit) => {
			if (commit.type === "confirm") return commit.card.id === commit.cardID;
			return room.probeMaterialize(commit.cardID, commit.target) === commit.target;
		})) return false;
		resolution.commits.forEach((commit) => {
			if (commit.type === "confirm") {
				commit.card.confirmKnown();
				return;
			}
			room.materialize(commit.cardID, commit.target);
		});
		return true;
	}
	function selectCardsForKnownMove(event, room, candidates) {
		const count = getCount(event);
		const protocolKnownCount = getPositiveIDs(event.cardIDs ?? []).length;
		const knownResolution = resolveProtocolKnownCards(event, room, candidates);
		const selected = [...knownResolution.cards];
		if (selected.length !== protocolKnownCount) return {
			cards: [],
			knownResolution
		};
		const selectedSet = new Set(selected);
		candidates.forEach((card) => {
			if (selected.length >= count || selectedSet.has(card) || card.isKnown === true) return;
			selectedSet.add(card);
			selected.push(card);
		});
		return {
			cards: selected.slice(0, count),
			knownResolution
		};
	}
	function splitProtocolKnownAndUnknown(event, cards) {
		const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs));
		return cards.filter((card) => !protocolKnownIDs.has(card.id));
	}
	function stagePileToExchange$1(event, room, spellID) {
		const move = event.protocol;
		const count = getCount(event);
		const pileBucketID = move.ToID;
		const selectedCards = room.getZone("pile").cards.slice(-count);
		if (!(count > 0) || !Number.isFinite(pileBucketID) || selectedCards.length !== count) {
			clearBatch$2(room, spellID);
			return event;
		}
		const knownResolution = resolveProtocolKnownCards(event, room, selectedCards);
		if (knownResolution.cards.length !== getPositiveIDs(event.cardIDs).length || !commitProtocolKnownCards(room, knownResolution)) {
			clearBatch$2(room, spellID);
			return event;
		}
		clearBatch$2(room, spellID);
		const batchKey = `${spellID}:pile:${pileBucketID}`;
		room.publicZones.getExchangeBatch(batchKey).stage(selectedCards);
		ensureGuanXuState(room).bySpell[String(spellID)] = {
			buckets: { [String(pileBucketID)]: {
				batchKey,
				expectedCount: count
			} },
			pileRangeCards: new Set(),
			pileBucketID,
			spellID
		};
		return patchEvent(event, { options: {
			fromPosition: POSITION_TOP,
			sourceCards: splitProtocolKnownAndUnknown(event, selectedCards)
		} });
	}
	function stageHandToExchange$1(event, room, spellID) {
		const move = event.protocol;
		const batch = getBatch$1(room, spellID);
		const fromSeat = move.FromID;
		const bucketID = move.ToID;
		if (!batch || !Number.isFinite(fromSeat) || !Number.isFinite(bucketID)) return event;
		const selection = selectCardsForKnownMove(event, room, getHandCards$1(room, fromSeat));
		if (selection.cards.length !== getCount(event) || !commitProtocolKnownCards(room, selection.knownResolution)) {
			clearBatch$2(room, spellID);
			return event;
		}
		const selectedCards = selection.cards;
		const batchKey = `${spellID}:seat:${bucketID}`;
		room.publicZones.getExchangeBatch(batchKey).stage(selectedCards);
		batch.buckets[String(bucketID)] = {
			batchKey,
			expectedCount: getCount(event)
		};
		const sourceCards = splitProtocolKnownAndUnknown(event, selectedCards);
		return patchEvent(event, { options: { ...sourceCards.length > 0 ? { sourceCards } : {} } });
	}
	function transferExchangeBucket(event, room, spellID) {
		const move = event.protocol;
		const batch = getBatch$1(room, spellID);
		const fromKey = String(move.FromID);
		const toKey = String(move.ToID);
		const sourceBucket = batch?.buckets[fromKey];
		const targetBucket = batch?.buckets[toKey];
		if (!batch || !sourceBucket || !targetBucket || fromKey === toKey) return event;
		const sourceBatch = room.publicZones.getExchangeBatch(sourceBucket.batchKey);
		const targetBatch = room.publicZones.getExchangeBatch(targetBucket.batchKey);
		const exchangeCards = sourceBatch.cards;
		const selection = selectCardsForKnownMove(event, room, exchangeCards);
		if (selection.cards.length !== getCount(event) || !commitProtocolKnownCards(room, selection.knownResolution)) return event;
		const selectedCards = selection.cards;
		const targetIsPileBucket = move.ToID === batch.pileBucketID;
		const insertedAtExactPosition = sourceBatch.transferTo(targetBatch, selectedCards, targetIsPileBucket ? move.ToPosition : POSITION_RANDOM);
		if (move.FromID === batch.pileBucketID) selectedCards.forEach((card) => batch.pileRangeCards.delete(card));
		if (targetIsPileBucket) selectedCards.forEach((card) => {
			if (insertedAtExactPosition) {
				batch.pileRangeCards.delete(card);
				return;
			}
			batch.pileRangeCards.add(card);
		});
		const sourceCards = splitProtocolKnownAndUnknown(event, selectedCards);
		return patchEvent(event, { options: { ...sourceCards.length > 0 ? { sourceCards } : {} } });
	}
	function returnBucketToPile(event, room, spellID) {
		const move = event.protocol;
		const batch = getBatch$1(room, spellID);
		const bucketKey = String(move.FromID);
		const bucket = batch?.buckets[bucketKey];
		if (!batch || !bucket || move.FromID !== batch.pileBucketID) return event;
		const cardsBottomFirst = room.publicZones.getExchangeBatch(bucket.batchKey).cards;
		if (cardsBottomFirst.length !== getCount(event) || cardsBottomFirst.length !== bucket.expectedCount) return event;
		const protocolKnownIDs = getPositiveIDs(event.cardIDs ?? []);
		const protocolKnownIDSet = new Set(protocolKnownIDs);
		const hasCompletePileOrder = protocolKnownIDs.length === cardsBottomFirst.length && protocolKnownIDSet.size === cardsBottomFirst.length && cardsBottomFirst.every((card) => protocolKnownIDSet.has(card.id));
		const pileCandidate = createPublicCandidate("pile", POSITION_TOP, bucket.expectedCount);
		const postMovePublicCandidates = hasCompletePileOrder ? [] : cardsBottomFirst.filter((card) => batch.pileRangeCards.has(card) && card.id > 0 && card.isKnown === true).map((card) => ({
			card,
			candidate: pileCandidate
		}));
		room.publicZones.deleteExchangeBatch(bucket.batchKey);
		delete batch.buckets[bucketKey];
		clearBatchIfEmpty(room, spellID, batch);
		return patchEvent(event, { options: {
			position: POSITION_TOP,
			sourceCards: splitProtocolKnownAndUnknown(event, cardsBottomFirst),
			...postMovePublicCandidates.length > 0 ? { postMovePublicCandidates } : {}
		} });
	}
	function returnBucketToHand(event, room, spellID) {
		const move = event.protocol;
		const batch = getBatch$1(room, spellID);
		const bucketKey = String(move.FromID);
		const bucket = batch?.buckets[bucketKey];
		if (!batch || !bucket || move.FromID === batch.pileBucketID) return event;
		const cards = room.publicZones.getExchangeBatch(bucket.batchKey).cards;
		if (cards.length !== getCount(event) || cards.length !== bucket.expectedCount) return event;
		const knownIDSet = new Set([...getPositiveIDs(event.cardIDs ?? []), ...cards.filter((card) => card.isKnown === true && card.id > 0).map((card) => card.id)]);
		const sourceCards = cards.filter((card) => !knownIDSet.has(card.id));
		room.publicZones.deleteExchangeBatch(bucket.batchKey);
		delete batch.buckets[bucketKey];
		clearBatchIfEmpty(room, spellID, batch);
		return patchEvent(event, { options: { ...sourceCards.length > 0 ? { sourceCards } : {} } });
	}
	function isGuanXuSpellID(spellID) {
		return GUAN_XU_SPELL_IDS.has(spellID);
	}
	function decorateGuanXu(event, room) {
		const move = event.protocol;
		const spellID = move.SpellID;
		if (!isGuanXuSpellID(spellID)) return event;
		if (event.moveType !== MOVE_TYPE.EXCHANGE) return event;
		const fromZone = move.FromZone;
		const toZone = move.ToZone;
		if (fromZone === 1 && toZone === 10) return stagePileToExchange$1(event, room, spellID);
		if (fromZone === 5 && toZone === 10) return stageHandToExchange$1(event, room, spellID);
		if (fromZone === 10 && toZone === 10) return transferExchangeBucket(event, room, spellID);
		if (fromZone === 10 && toZone === 1) return returnBucketToPile(event, room, spellID);
		if (fromZone === 10 && toZone === 5) return returnBucketToHand(event, room, spellID);
		return event;
	}
	var HAND_EXCHANGE_STATE_KEY = "handExchangeBatches";
	function resolveSpellID(event) {
		const spellID = event.protocol.SpellID;
		return Number.isFinite(spellID) ? spellID : 0;
	}
	function ensureRoomExchangeState(room) {
		return room.ensureSkillState(HAND_EXCHANGE_STATE_KEY, () => ({
			bySpell: {},
			nextBatchSeq: 0
		}));
	}
	function readRoomExchangeState(room) {
		return room.readSkillState(HAND_EXCHANGE_STATE_KEY);
	}
	function ensureSpellExchangeState(room, spellID) {
		const roomState = ensureRoomExchangeState(room);
		const key = String(spellID);
		if (!roomState.bySpell[key]) roomState.bySpell[key] = {
			batches: {},
			candidateRecords: new Map()
		};
		return roomState.bySpell[key];
	}
	function readSpellExchangeState(room, spellID) {
		return readRoomExchangeState(room)?.bySpell[String(spellID)];
	}
	function clearSpellExchangeStateIfEmpty(room, spellID) {
		const roomState = readRoomExchangeState(room);
		if (!roomState) return;
		const state = roomState.bySpell[String(spellID)];
		if (state && Object.keys(state.batches).length === 0 && state.candidateRecords.size === 0) delete roomState.bySpell[String(spellID)];
		if (Object.keys(roomState.bySpell).length === 0) room.deleteSkillState(HAND_EXCHANGE_STATE_KEY);
	}
	function getPlayerHandCards(room, seatID) {
		const playerCards = room.refreshPlayerSnapshot();
		recordTraversal("handExchange:playerHand", playerCards.length);
		return playerCards.filter((card) => card.subZone === "hand" && card.seats.has(seatID));
	}
	function isHandCandidate(candidate, seatID) {
		return candidate.type === "player" && candidate.subZone === "hand" && candidate.seatID === seatID;
	}
	function isBatchCandidate(candidate) {
		return candidate.type === "outside" && candidate.zone === "exchange" && Boolean(candidate.batchID);
	}
	function createCandidateRecord(card) {
		if (card.locationCandidates.length <= 1) return null;
		return {
			card,
			spellID: card.spellID,
			subZone: card.subZone
		};
	}
	function projectCandidateRecord(room, record) {
		const candidates = record.card.locationCandidates;
		const hasPlayerCandidate = candidates.some((candidate) => candidate.type === "player");
		const hasBatchCandidate = candidates.some(isBatchCandidate);
		if (hasPlayerCandidate || hasBatchCandidate) room.clearCardsFromPublicZones([record.card]);
		if (hasPlayerCandidate) {
			record.card.subZone = record.subZone;
			record.card.spellID = record.spellID;
		} else if (hasBatchCandidate) {
			record.card.location = "exchange";
			record.card.subZone = null;
			record.card.spellID = null;
		}
		room.notifyCardChanged(record.card, { type: "hand-exchange-candidate-projected" });
	}
	function stageCandidateAlternatives(room, state, handCards, fromSeat, batchID, protocolKnownIDs) {
		handCards.forEach((card) => {
			if (protocolKnownIDs.has(card.id) || state.candidateRecords.has(card)) return;
			if (!(card.isKnown === true && card.id > 0)) return;
			const record = createCandidateRecord(card);
			if (record && card.locationCandidates.some((candidate) => isHandCandidate(candidate, fromSeat))) state.candidateRecords.set(card, record);
		});
		const stagedCandidates = new Set();
		state.candidateRecords.forEach((record) => {
			let staged = false;
			const nextCandidates = record.card.locationCandidates.map((candidate) => {
				if (!isHandCandidate(candidate, fromSeat)) return candidate;
				staged = true;
				return {
					type: "outside",
					zone: "exchange",
					batchID
				};
			});
			if (!staged) return;
			stagedCandidates.add(record.card);
			record.card.setLocationCandidates(nextCandidates, "handExchange:candidateStage");
			projectCandidateRecord(room, record);
		});
		return stagedCandidates;
	}
	function returnCandidateAlternatives(room, state, batchID, toSeat, protocolKnownIDs, revealsWholeBatch) {
		const logicallyResolvedKnownIDs = new Set();
		state.candidateRecords.forEach((record, card) => {
			const currentCandidates = card.locationCandidates;
			const belongsToBatch = currentCandidates.some((candidate) => isBatchCandidate(candidate) && candidate.batchID === batchID);
			if (protocolKnownIDs.has(card.id) && belongsToBatch) {
				card.setLocationCandidates([{
					type: "player",
					seatID: toSeat,
					subZone: "hand",
					spellID: null
				}], "handExchange:candidateKnownReturn");
				projectCandidateRecord(room, record);
				state.candidateRecords.delete(card);
				logicallyResolvedKnownIDs.add(card.id);
				return;
			}
			let returned = false;
			const nextCandidates = currentCandidates.map((candidate) => {
				if (!isBatchCandidate(candidate) || candidate.batchID !== batchID) return candidate;
				returned = true;
				if (revealsWholeBatch) return null;
				return {
					type: "player",
					seatID: toSeat,
					subZone: "hand",
					spellID: null
				};
			}).filter((candidate) => candidate !== null);
			if (!returned) return;
			card.setLocationCandidates(nextCandidates, "handExchange:candidateReturn");
			projectCandidateRecord(room, record);
			if (nextCandidates.length === 0 || !nextCandidates.some(isBatchCandidate)) state.candidateRecords.delete(card);
		});
		return logicallyResolvedKnownIDs;
	}
	function nextBatchID(roomState, spellID, fromSeat) {
		return `${spellID}:${fromSeat}:${++roomState.nextBatchSeq}`;
	}
	function isWholeHandExchangeStage(event, room, fromSeat, handCards) {
		const cardCount = getCount(event);
		const player = room.getPlayer(fromSeat);
		if (cardCount === 0) return handCards.length === 0 && player?.hasObservedHandCount === true && player.observedHandCount === 0;
		if (handCards.length === 0) return false;
		if (player?.hasObservedHandCount === true) return cardCount === player.observedHandCount;
		return cardCount === handCards.length;
	}
	function alignProtocolKnownCards(event, cards) {
		const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []));
		if (protocolKnownIDs.size > 0) cards.forEach((card) => {
			if (protocolKnownIDs.has(card.id) && card.isKnown !== true) card.confirmKnown();
		});
	}
	function splitKnownAndUnknownCards(cards) {
		const knownIDs = [];
		const unknownCards = [];
		cards.forEach((card) => {
			if (card.isKnown === true && card.id > 0) {
				knownIDs.push(card.id);
				return;
			}
			unknownCards.push(card);
		});
		return {
			knownIDs,
			unknownCards
		};
	}
	function buildExchangePatch(event, room, cards, spellID, label, hasCandidateAlternatives = false, logicallyResolvedKnownIDs = new Set(), moveOnlyStagedCards = false) {
		const { knownIDs: stagedKnownIDs, unknownCards } = splitKnownAndUnknownCards(cards);
		const protocolKnownIDs = getPositiveIDs(event.cardIDs ?? []).filter((id) => !logicallyResolvedKnownIDs.has(id));
		const knownIDs = Array.from(new Set([...stagedKnownIDs, ...protocolKnownIDs]));
		const protocolCardCount = getCount(event);
		const separatesEntityMovement = hasCandidateAlternatives || moveOnlyStagedCards;
		const cardCount = separatesEntityMovement ? cards.length : Math.max(protocolCardCount, cards.length);
		const isPureBatch = cards.length > 0 && (knownIDs.length === 0 || unknownCards.length === 0);
		return patchEvent(event, {
			cardIDs: knownIDs,
			options: {
				...unknownCards.length > 0 ? { sourceCards: unknownCards } : {},
				cardCount,
				...separatesEntityMovement ? { handMoveCount: protocolCardCount } : {},
				...isPureBatch ? { combinationID: nextGroupID(room, spellID, label) } : {}
			}
		});
	}
	function stageHandToExchange(event, room, spellID) {
		const fromSeat = event.protocol.FromID;
		if (!Number.isFinite(fromSeat)) return event;
		const handCards = getPlayerHandCards(room, fromSeat);
		if (!isWholeHandExchangeStage(event, room, fromSeat, handCards)) return event;
		alignProtocolKnownCards(event, handCards);
		const roomState = ensureRoomExchangeState(room);
		const state = ensureSpellExchangeState(room, spellID);
		const batchKey = String(fromSeat);
		const batchStack = state.batches[batchKey] ?? [];
		const batchID = nextBatchID(roomState, spellID, fromSeat);
		const stagedCandidates = stageCandidateAlternatives(room, state, handCards, fromSeat, batchID, new Set(getPositiveIDs(event.cardIDs ?? [])));
		const batchCards = handCards.filter((card) => !stagedCandidates.has(card));
		room.publicZones.getExchangeBatch(batchID).stage([...batchCards, ...stagedCandidates]);
		batchStack.push({
			batchID,
			hasCandidateAlternatives: stagedCandidates.size > 0,
			fromSeat,
			spellID
		});
		state.batches[batchKey] = batchStack;
		if (handCards.length === 0 && stagedCandidates.size === 0) return event;
		return buildExchangePatch(event, room, batchCards, spellID, "hand_exchange_stage", stagedCandidates.size > 0);
	}
	function returnExchangeBatchToHand(event, room, spellID) {
		const move = event.protocol;
		const batchKey = String(move.FromID);
		const state = readSpellExchangeState(room, spellID);
		const batchStack = state?.batches[batchKey];
		const batch = batchStack?.pop();
		if (!batch || !state || !batchStack) return event;
		const stagedCards = room.publicZones.getExchangeBatch(batch.batchID).cards;
		if (batchStack.length === 0) delete state.batches[batchKey];
		const protocolKnownIDs = new Set(getPositiveIDs(event.cardIDs ?? []));
		const protocolCardCount = getCount(event);
		const revealsWholeBatch = protocolCardCount > 0 && protocolKnownIDs.size >= protocolCardCount;
		const logicallyResolvedKnownIDs = returnCandidateAlternatives(room, state, batch.batchID, move.ToID, protocolKnownIDs, revealsWholeBatch);
		clearSpellExchangeStateIfEmpty(room, spellID);
		room.publicZones.deleteExchangeBatch(batch.batchID);
		alignProtocolKnownCards(event, stagedCards);
		return buildExchangePatch(event, room, stagedCards, spellID, "hand_exchange_return", batch.hasCandidateAlternatives, logicallyResolvedKnownIDs, true);
	}
	function decorateHandExchange(event, room) {
		const move = event.protocol;
		if (event.moveType !== MOVE_TYPE.EXCHANGE) return event;
		const fromZone = move.FromZone;
		const toZone = move.ToZone;
		const spellID = resolveSpellID(event);
		if (fromZone === 5 && toZone === 10) return stageHandToExchange(event, room, spellID);
		if (fromZone === 10 && toZone === 5) return returnExchangeBatchToHand(event, room, spellID);
		return event;
	}
	var JIE_LI_SPELL_ID = 3483;
	function ensureJieLiState(room) {
		return room.ensureSkillState(JIE_LI_SPELL_ID, () => ({}));
	}
	function getJieLiState(room) {
		return room.readSkillState(JIE_LI_SPELL_ID);
	}
	function getBatch(room) {
		return getJieLiState(room)?.batch;
	}
	function clearJieLiState(room) {
		room.deleteSkillState(JIE_LI_SPELL_ID);
	}
	function recordJieLiContext(room, data) {
		const state = ensureJieLiState(room);
		state.context = data;
		delete state.batch;
		delete state.observerBatch;
	}
	function recordJieLiSelection(room, data) {
		const batch = getBatch(room);
		if (!batch || batch.actorSeat !== data.actorSeat || batch.targetSeat !== data.targetSeat || batch.handCards.length !== data.handCardIDs.length || data.handCardIDs.length !== data.pileCardIDs.length) return false;
		const handCardByID = new Map(batch.handCards.map((card) => [card.id, card]));
		const pileSlotByProtocolID = new Map(batch.pileProtocolCardIDs.map((cardID, index) => [cardID, batch.pileSlots[index]]));
		const handToPileCards = data.handCardIDs.map((cardID) => handCardByID.get(cardID)).filter((card) => Boolean(card));
		const pileToHandSlots = data.pileCardIDs.map((cardID) => pileSlotByProtocolID.get(cardID)).filter((card) => Boolean(card));
		if (handToPileCards.length !== data.handCardIDs.length || pileToHandSlots.length !== data.pileCardIDs.length || new Set(handToPileCards).size !== handToPileCards.length || new Set(pileToHandSlots).size !== pileToHandSlots.length) return false;
		batch.selection = {
			handToPileCards,
			pileToHandCardIDs: data.pileCardIDs.slice(),
			pileToHandSlots
		};
		return true;
	}
	function parseJieLiNotice(msg) {
		const { Params, SeatID, SrcSeatID, targetSeatID } = msg;
		if (targetSeatID === void 0 || !Array.isArray(Params) || Params.length === 0) return null;
		const actorSeat = SrcSeatID ?? SeatID;
		const targetSeat = targetSeatID;
		const [pileCount, handCount] = Params;
		if (!Number.isInteger(pileCount) || pileCount <= 0) return null;
		if (Params.length === 1) return {
			actorSeat,
			targetSeat,
			pileCount,
			pileCardIDs: null,
			handCardIDs: null
		};
		if (!Number.isInteger(handCount) || handCount < 0 || Params.length !== 2 + pileCount + handCount) return null;
		return {
			actorSeat,
			targetSeat,
			pileCount,
			pileCardIDs: Params.slice(2, 2 + pileCount),
			handCardIDs: Params.slice(2 + pileCount)
		};
	}
	function handleJieLiChoice(room, msg) {
		const { Datas, Type } = msg;
		if (Type !== 53 || !Array.isArray(Datas) || room.mySeatID !== Datas[1]) return false;
		const [actorSeat, targetSeat, handCount] = Datas;
		const handEnd = 3 + handCount;
		const pileStart = handEnd + 1;
		const pileCount = Datas[handEnd];
		if (!Number.isInteger(handCount) || !Number.isInteger(pileCount) || handCount <= 0 || pileCount <= 0 || handCount !== pileCount || Datas.length !== pileStart + pileCount) return false;
		return recordJieLiSelection(room, {
			actorSeat,
			targetSeat,
			handCardIDs: Datas.slice(3, handEnd),
			pileCardIDs: Datas.slice(pileStart, pileStart + pileCount)
		});
	}
	function resolveViewMode(room, eventActorSeat) {
		const context = getJieLiState(room)?.context;
		const actorSeat = eventActorSeat != null && eventActorSeat !== 255 ? eventActorSeat : context?.actorSeat ?? null;
		if (actorSeat !== null && room.mySeatID === actorSeat) return "default";
		if (context && actorSeat === context.actorSeat && room.mySeatID === context.targetSeat) return "target-limited";
		if (context && actorSeat === context.actorSeat && room.mySeatID !== void 0 && room.mySeatID !== context.actorSeat && room.mySeatID !== context.targetSeat) return "observer-limited";
		return "skip";
	}
	function noOp(event) {
		return patchEvent(event, { type: "noop" });
	}
	function resolveOnlyMove(event) {
		return patchEvent(event, {
			cardIDs: [],
			cardCount: 0,
			options: {
				cardCount: 0,
				handMoveCount: 0,
				pileIdentityCardIDs: [],
				sourceCards: []
			}
		});
	}
	function failObserverInference(event, room) {
		clearJieLiState(room);
		return noOp(event);
	}
	function collectObserverTargetHandCards(room, targetSeat) {
		const knownHandCards = room.locationIndex.knownHandBySeat.get(targetSeat) ?? [];
		const candidateHandCards = room.locationIndex.candidateHandBySeat.get(targetSeat) ?? [];
		return Array.from(new Set([...knownHandCards, ...candidateHandCards])).filter((card) => card.id > 0 && card.isKnown === true);
	}
	function hasTargetHandBranch(card, targetSeat) {
		const locationCandidates = card.locationCandidates;
		if (locationCandidates.length > 0) return locationCandidates.some((candidate) => candidate.type === "player" && candidate.seatID === targetSeat && candidate.subZone === "hand");
		return card.location === "player" && card.subZone === "hand" && card.seats.has(targetSeat);
	}
	function stageObserverPile(event, room) {
		const move = event.protocol;
		const context = getJieLiState(room)?.context;
		const count = getCount(event);
		const actorSeat = move.ToID;
		if (!context || context.actorSeat !== actorSeat || context.pileCount !== count || !(count > 0)) return failObserverInference(event, room);
		ensureJieLiState(room).observerBatch = {
			actorSeat,
			targetSeat: context.targetSeat,
			pileCount: count,
			exchangeCount: 0,
			targetHandCards: [],
			phase: "pile-staged"
		};
		return noOp(event);
	}
	function stageObserverTargetHand(event, room) {
		const move = event.protocol;
		const batch = getJieLiState(room)?.observerBatch;
		const count = getCount(event);
		if (!batch || batch.phase !== "pile-staged" || move.ToID !== batch.actorSeat || move.FromID !== batch.targetSeat || !(count > 0) || count > batch.pileCount) return failObserverInference(event, room);
		batch.exchangeCount = count;
		batch.targetHandCards = collectObserverTargetHandCards(room, batch.targetSeat);
		batch.phase = "hand-staged";
		return noOp(event);
	}
	function returnObserverCardsToPile(event, room) {
		const move = event.protocol;
		const batch = getJieLiState(room)?.observerBatch;
		if (!batch || batch.phase !== "hand-staged" || move.FromID !== batch.actorSeat || move.ToID !== 255 || getCount(event) !== batch.pileCount) return failObserverInference(event, room);
		batch.phase = "pile-returned";
		return noOp(event);
	}
	function returnObserverCardsToTargetHand(event, room) {
		const move = event.protocol;
		const batch = getJieLiState(room)?.observerBatch;
		if (!batch || batch.phase !== "pile-returned" || move.FromID !== batch.actorSeat || move.ToID !== batch.targetSeat || getCount(event) !== batch.exchangeCount) return failObserverInference(event, room);
		const pileCandidate = createPublicCandidate("pile", POSITION_TOP, batch.pileCount);
		let changed = false;
		batch.targetHandCards.forEach((card) => {
			if (!hasTargetHandBranch(card, batch.targetSeat)) return;
			changed = card.addPublicCandidate(pileCandidate) || changed;
		});
		clearJieLiState(room);
		return changed ? resolveOnlyMove(event) : noOp(event);
	}
	function failTargetInference(event, room, informationMode) {
		clearJieLiState(room);
		return informationMode === "full" ? event : noOp(event);
	}
	function getKnownPileIdentityIDs(cards) {
		return cards.filter((card) => card.id > 0 && card.isKnown === true).map((card) => card.id);
	}
	function stagePileToExchange(event, room, informationMode) {
		const move = event.protocol;
		const context = getJieLiState(room)?.context;
		const count = getCount(event);
		const pileProtocolCardIDs = getPositiveIDs(event.cardIDs);
		const actorSeat = move.ToID;
		const physicalPileSlots = room.getZone("pile").cards.slice(-count);
		if (!context || context.actorSeat !== actorSeat || context.targetSeat !== room.mySeatID || context.pileCount !== count || !(count > 0) || pileProtocolCardIDs.length !== count || physicalPileSlots.length !== count) return failTargetInference(event, room, informationMode);
		let pileSlots = physicalPileSlots;
		if (informationMode === "full") {
			const existingCards = getEventSourceCards(event, room);
			if (existingCards.length === count && existingCards.every((card, index) => card.id === pileProtocolCardIDs[index])) pileSlots = existingCards;
			else {
				const probedCards = pileProtocolCardIDs.map((cardID, index) => room.probeMaterialize(cardID, physicalPileSlots[index]));
				if (probedCards.some((card) => !card) || new Set(probedCards).size !== probedCards.length) return failTargetInference(event, room, informationMode);
				pileSlots = pileProtocolCardIDs.map((cardID, index) => room.materialize(cardID, physicalPileSlots[index])).filter((card) => Boolean(card));
				if (pileSlots.length !== count) return failTargetInference(event, room, informationMode);
			}
		}
		ensureJieLiState(room).batch = {
			actorSeat,
			targetSeat: context.targetSeat,
			informationMode,
			pileProtocolCardIDs,
			pileSlots,
			handCards: [],
			selection: null,
			returnedToPile: false
		};
		if (informationMode === "full") return event;
		return patchEvent(event, {
			cardIDs: [],
			options: {
				sourceCards: pileSlots,
				pileIdentityCardIDs: getKnownPileIdentityIDs(pileSlots)
			}
		});
	}
	function stageTargetHandToExchange(event, room, informationMode) {
		const move = event.protocol;
		const batch = getBatch(room);
		const count = getCount(event);
		const cardIDs = getPositiveIDs(event.cardIDs);
		const actorSeat = move.ToID;
		const targetSeat = move.FromID;
		const handCards = getEventSourceCards(event, room);
		if (!batch || batch.informationMode !== informationMode || actorSeat !== batch.actorSeat || targetSeat !== batch.targetSeat || targetSeat !== room.mySeatID || !(count > 0) || cardIDs.length !== count || handCards.length !== count) return failTargetInference(event, room, informationMode);
		batch.handCards = handCards;
		return event;
	}
	function buildFinalPileOrder(batch) {
		const selection = batch.selection;
		if (!selection) return null;
		const replacementByPileSlot = new Map(selection.pileToHandSlots.map((pileSlot, index) => [pileSlot, selection.handToPileCards[index]]));
		return batch.pileSlots.map((card) => replacementByPileSlot.get(card) ?? card);
	}
	function returnTargetViewCardsToPile(event, room, informationMode) {
		const move = event.protocol;
		const batch = getBatch(room);
		if (!batch || batch.informationMode !== informationMode || move.FromID !== batch.actorSeat) return failTargetInference(event, room, informationMode);
		if (informationMode === "full" && getPositiveIDs(event.cardIDs).length > 0) {
			clearJieLiState(room);
			return event;
		}
		const pileSlots = batch.pileSlots.filter((card) => card.location === "exchange");
		const handCards = batch.handCards.filter((card) => card.location === "exchange");
		const finalPileCards = buildFinalPileOrder(batch);
		if (getCount(event) !== batch.pileSlots.length || pileSlots.length !== batch.pileSlots.length || handCards.length !== batch.handCards.length || event.options.position !== 65280 || !finalPileCards || finalPileCards.some((card) => card.location !== "exchange")) return failTargetInference(event, room, informationMode);
		batch.returnedToPile = true;
		return patchEvent(event, {
			...informationMode === "limited" ? { cardIDs: [] } : {},
			options: {
				sourceCards: finalPileCards,
				pileIdentityCardIDs: getKnownPileIdentityIDs(finalPileCards)
			}
		});
	}
	function returnCardsToTargetHand(event, room, informationMode) {
		const move = event.protocol;
		const batch = getBatch(room);
		const selection = batch?.selection;
		if (!batch || !selection || batch.informationMode !== informationMode || !batch.returnedToPile || move.FromID !== batch.actorSeat || move.ToID !== batch.targetSeat) return failTargetInference(event, room, informationMode);
		const cardIDs = getPositiveIDs(event.cardIDs);
		const pileSlotByResultID = new Map(selection.pileToHandCardIDs.map((cardID, index) => [cardID, selection.pileToHandSlots[index]]));
		const handResultSlots = cardIDs.map((cardID) => pileSlotByResultID.get(cardID)).filter((card) => Boolean(card));
		clearJieLiState(room);
		if (cardIDs.length !== getCount(event) || handResultSlots.length !== selection.pileToHandSlots.length || handResultSlots.length !== cardIDs.length || handResultSlots.some((card) => card.location !== "exchange")) return informationMode === "full" ? event : noOp(event);
		return patchEvent(event, { options: {
			sourceCards: handResultSlots,
			fromPosition: POSITION_TOP
		} });
	}
	function decorateJieLi(event, room) {
		const move = event.protocol;
		if (move.SpellID !== 3483) return event;
		const moveType = event.moveType;
		const fromZone = move.FromZone;
		const toZone = move.ToZone;
		const viewMode = resolveViewMode(room, fromZone === 1 || fromZone === 5 ? move.ToID : move.FromID);
		if (moveType === MOVE_TYPE.SHOW) return viewMode === "target-limited" || viewMode === "observer-limited" || viewMode === "skip" ? noOp(event) : event;
		if (moveType !== MOVE_TYPE.EXCHANGE) return event;
		const isFinalReturn = fromZone === 10 && toZone === 5;
		if (viewMode === "default") {
			if (isFinalReturn) clearJieLiState(room);
			return event;
		}
		if (viewMode === "skip") {
			if (isFinalReturn) clearJieLiState(room);
			return noOp(event);
		}
		if (viewMode === "observer-limited") {
			if (fromZone === 1 && toZone === 10) return stageObserverPile(event, room);
			if (fromZone === 5 && toZone === 10) return stageObserverTargetHand(event, room);
			if (fromZone === 10 && toZone === 1) return returnObserverCardsToPile(event, room);
			if (fromZone === 10 && toZone === 5) return returnObserverCardsToTargetHand(event, room);
			return noOp(event);
		}
		const informationMode = viewMode === "target-full" ? "full" : "limited";
		if (fromZone === 1 && toZone === 10) return stagePileToExchange(event, room, informationMode);
		if (fromZone === 5 && toZone === 10) return stageTargetHandToExchange(event, room, informationMode);
		if (fromZone === 10 && toZone === 1) return returnTargetViewCardsToPile(event, room, informationMode);
		if (fromZone === 10 && toZone === 5) return returnCardsToTargetHand(event, room, informationMode);
		return noOp(event);
	}
	var jieLiPlugin = {
		id: "jieLi",
		spellIDs: [JIE_LI_SPELL_ID],
		decorateMove: decorateJieLi,
		onProtocolEvent(event, room) {
			const msg = event.message;
			if (!("SpellID" in msg) || msg.SpellID !== 3483) return;
			if (event.type === "targetNotice") {
				const noticeMsg = event.message;
				if (noticeMsg.targetSeatID !== void 0 && noticeMsg.Param == 1 && noticeMsg.Params && noticeMsg.Params.length > 0) {
					const notice = parseJieLiNotice(noticeMsg);
					if (!notice) {
						clearJieLiState(room);
						return;
					}
					recordJieLiContext(room, {
						actorSeat: notice.actorSeat,
						targetSeat: notice.targetSeat,
						pileCount: notice.pileCount
					});
				}
				return;
			}
			if (event.type === "choice") handleJieLiChoice(room, event.message);
		}
	};
	var XING_ZUO_SPELL_ID = 3776;
	function decorateXingZuo(event, room) {
		const move = event.protocol;
		if (move.SpellID !== XING_ZUO_SPELL_ID || move.MoveType !== MOVE_TYPE.EXCHANGE) return event;
		if (move.FromZone === 1 && move.ToZone === 10) {
			const pileCards = room.getPublicEndpointCards("pile", getCount(event), 0);
			clearBatch$1(room);
			const pileBatchKey = `${XING_ZUO_SPELL_ID}:pile:${move.ToID}`;
			room.publicZones.getExchangeBatch(pileBatchKey).stage(pileCards);
			room.setSkillState(XING_ZUO_SPELL_ID, {
				actorSeat: move.ToID,
				pileBatchKey,
				pileCount: pileCards.length,
				handSeat: null,
				handCount: 0,
				handBatchKey: null,
				returnedToHand: false
			});
			return patchEvent(patchBatchCards(event, room, pileCards), { options: { fromPosition: 0 } });
		}
		const batch = room.readSkillState(XING_ZUO_SPELL_ID);
		if (!batch) return event;
		if (move.FromZone === 5 && move.ToZone === 10 && move.ToID === batch.actorSeat) {
			batch.handSeat = move.FromID;
			batch.handCount = getCount(event);
			batch.handBatchKey = `${XING_ZUO_SPELL_ID}:seat:${move.FromID}`;
			room.publicZones.getExchangeBatch(batch.handBatchKey).captureNextMove();
			const player = room.getPlayer(move.FromID);
			if (!hasPositiveID(event.cardIDs) && player) return patchEvent(event, { cardIDs: player.knownHandCards.map((card) => card.id) });
			return event;
		}
		if (move.FromZone !== 10 || move.FromID !== batch.actorSeat) return event;
		if (!batch.handBatchKey) return event;
		const handCards = room.publicZones.getExchangeBatch(batch.handBatchKey).cards;
		if (move.ToZone === 10 && move.ToID === batch.actorSeat) return patchEvent(event, { type: "noop" });
		if (move.ToZone === 5 && move.ToID === batch.handSeat && getCount(event) === batch.pileCount && !batch.returnedToHand) {
			batch.returnedToHand = true;
			return patchBatchCards(event, room, room.publicZones.getExchangeBatch(batch.pileBatchKey).cards);
		}
		if (move.ToZone === 1 && getCount(event) === batch.handCount && batch.returnedToHand) {
			clearBatch$1(room);
			const candidate = createPublicCandidate("pile", 0, batch.handCount);
			const hasCompleteOrder = getPositiveIDs(event.cardIDs).length === batch.handCount;
			return patchEvent(patchBatchCards(event, room, handCards), { options: { postMovePublicCandidates: hasCompleteOrder ? [] : handCards.filter((card) => card.isKnown === true).map((card) => ({
				card,
				candidate
			})) } });
		}
		return event;
	}
	function clearBatch$1(room) {
		const batch = room.readSkillState(XING_ZUO_SPELL_ID);
		if (batch) {
			room.publicZones.deleteExchangeBatch(batch.pileBatchKey);
			if (batch.handBatchKey) room.publicZones.deleteExchangeBatch(batch.handBatchKey);
		}
		room.deleteSkillState(XING_ZUO_SPELL_ID);
	}
	function patchBatchCards(event, room, cards) {
		const protocolIDs = getPositiveIDs(event.cardIDs);
		const anonymousCards = cards.filter((card) => card.isAnonymous);
		const targets = protocolIDs.map((id) => cards.find((card) => card.id === id) ?? anonymousCards.shift());
		if (targets.some((target, index) => !target || room.probeMaterialize(protocolIDs[index], target) !== target)) {
			clearBatch$1(room);
			return event;
		}
		targets.forEach((target, index) => room.materialize(protocolIDs[index], target));
		const knownCards = cards.filter((card) => card.id > 0 && card.isKnown === true);
		const cardIDs = [...new Set([...protocolIDs, ...knownCards.map((card) => card.id)])];
		const knownSet = new Set(knownCards);
		return patchEvent(event, {
			cardIDs,
			options: {
				sourceCards: cards.filter((card) => !knownSet.has(card)),
				pileIdentityCardIDs: cardIDs
			}
		});
	}
	var SI_QI_SPELL_ID = 3543;
	function decorateSiQi(event, room) {
		const move = event.protocol;
		if (move.FromZone !== 2 || move.ToZone !== 1 || move.MoveType !== 15 || move.FromPosition !== 65282 || hasPositiveID(event.cardIDs)) return event;
		const cardCount = getCount(event);
		const sourceCards = getSourceZoneCards(event, room);
		const selectedCards = [];
		for (let index = sourceCards.length - 1; index >= 0 && selectedCards.length < cardCount; index--) {
			const card = sourceCards[index];
			if (card.color === 1 || card.color === 2) selectedCards.push(card);
		}
		if (selectedCards.length === 0) return event;
		const decorated = patchEvent(event, { options: {
			sourceCards: selectedCards,
			combinationID: nextGroupID(room, SI_QI_SPELL_ID, "siqi_candidate")
		} });
		trackerLogger.debug("思泣来源牌推断", {
			cardCount,
			selectedCardIDs: selectedCards.map((card) => card.id),
			fallbackCount: Math.max(0, cardCount - selectedCards.length)
		});
		return decorated;
	}
	var TIAN_HOU_SPELL_ID = 3903;
	var TIAN_HOU_STATE_KEY = "tianHouExchange";
	var TIAN_HOU_VIEW_COUNT = 3;
	function getTianHouState(room) {
		return room.readSkillState("tianHouExchange") ?? null;
	}
	function ensureTianHouState(room) {
		return room.ensureSkillState(TIAN_HOU_STATE_KEY, () => ({ batch: null }));
	}
	function clearBatch(room, cleanupTemporaryCandidates = false) {
		const batch = getTianHouState(room)?.batch;
		if (batch) {
			room.publicZones.deleteExchangeBatch(batch.pileBatchKey);
			room.publicZones.deleteExchangeBatch(batch.handBatchKey);
		}
		if (cleanupTemporaryCandidates && batch && batch.phase !== "awaiting-reveal") batch.knownHandCards.forEach((card) => {
			card.removePublicCandidates((candidate) => candidate?.zone === "exchange");
		});
		room.deleteSkillState(TIAN_HOU_STATE_KEY);
	}
	function isOtherView(room, actorSeat) {
		return room.mySeatID === void 0 || room.mySeatID !== actorSeat;
	}
	function getActorHandCards(room, actorSeat) {
		const playerCards = room.refreshPlayerSnapshot();
		recordTraversal("tianHou:playerHand", playerCards.length);
		return playerCards.filter((card) => card.location === "player" && card.subZone === "hand" && card.seats.size === 1 && card.seats.has(actorSeat) && !card.hasLocationCandidates() && !card.hasSubZoneCandidates());
	}
	function createKnownOutConstraint(room, batch, cards, knownOut, label) {
		if (cards.length === 0) return null;
		const handCandidate = {
			type: "player",
			seatID: batch.actorSeat,
			subZone: "hand",
			spellID: null
		};
		const pileCandidate = {
			type: "public",
			...createPublicCandidate("pile", POSITION_TOP, batch.count)
		};
		const groupID = `tianhou_${label}_${++room.constraintGroupSeq}`;
		room.createConstraintGroup({
			id: groupID,
			cards,
			expectedSlotsByLocation: new Map([[createLocationCandidateKey(handCandidate), {
				min: cards.length - knownOut.max,
				max: cards.length - knownOut.min
			}], [createLocationCandidateKey(pileCandidate), knownOut]]),
			known: true,
			sourceEvent: {
				type: `tianHou:${label}`,
				raw: {
					actorSeat: batch.actorSeat,
					count: batch.count,
					knownOut
				}
			}
		});
		return groupID;
	}
	function decoratePileStage(event, room, actorSeat) {
		const count = getCount(event);
		if (!(count > 0) || count > TIAN_HOU_VIEW_COUNT || !isOtherView(room, actorSeat)) return event;
		const selectedPileCards = room.getZone("pile").cards.slice(-count).reverse();
		if (selectedPileCards.length !== count) return event;
		clearBatch(room, true);
		const pileBatchKey = `${TIAN_HOU_SPELL_ID}:pile:${actorSeat}`;
		const handBatchKey = `${TIAN_HOU_SPELL_ID}:seat:${actorSeat}`;
		room.publicZones.getExchangeBatch(pileBatchKey).stage(selectedPileCards);
		ensureTianHouState(room).batch = {
			actorSeat,
			count,
			pileBatchKey,
			handBatchKey,
			knownHandCards: [],
			minKnownOut: 0,
			maxKnownOut: 0,
			phase: "pile-staged"
		};
		return patchEvent(event, { options: { sourceCards: selectedPileCards } });
	}
	function decorateHandStage(event, room, actorSeat) {
		const batch = getTianHouState(room)?.batch;
		const count = getCount(event);
		if (!batch || batch.phase !== "pile-staged" || batch.actorSeat !== actorSeat || batch.count !== count) {
			clearBatch(room, true);
			return event;
		}
		const player = room.getPlayer(actorSeat);
		const handCards = getActorHandCards(room, actorSeat);
		const knownHandCards = handCards.filter((card) => card.isKnown === true);
		const hiddenHandCards = handCards.filter((card) => card.isKnown !== true);
		const fallbackCards = room.createExternalCards([], Math.max(0, count - hiddenHandCards.length));
		const outgoingCards = [...hiddenHandCards.slice(0, count), ...fallbackCards].slice(0, count);
		const handCount = player?.hasObservedHandCount === true ? player.observedHandCount : handCards.length;
		const hiddenCapacity = Math.max(0, handCount - knownHandCards.length);
		const exchangeCandidate = createPublicCandidate("exchange", POSITION_RANDOM, count);
		knownHandCards.forEach((card) => card.addPublicCandidate(exchangeCandidate));
		room.publicZones.getExchangeBatch(batch.handBatchKey).stage(outgoingCards);
		batch.knownHandCards = knownHandCards;
		batch.maxKnownOut = Math.min(count, knownHandCards.length);
		batch.minKnownOut = player?.hasObservedHandCount === true ? Math.min(Math.max(0, count - hiddenCapacity), batch.maxKnownOut) : 0;
		batch.phase = "hand-staged";
		trackerLogger.info("天候记录其他视角换牌候选", {
			actorSeat,
			count,
			knownHandCardIDs: knownHandCards.map((card) => card.id),
			minKnownOut: batch.minKnownOut,
			maxKnownOut: batch.maxKnownOut
		});
		return patchEvent(event, { options: { sourceCards: outgoingCards } });
	}
	function decorateExchangeReorder(event, room, actorSeat) {
		const batch = getTianHouState(room)?.batch;
		if (!batch || batch.phase !== "hand-staged" || batch.actorSeat !== actorSeat || batch.count !== getCount(event)) return event;
		return patchEvent(event, { type: "noop" });
	}
	function decorateReturnToHand(event, room, actorSeat) {
		const batch = getTianHouState(room)?.batch;
		if (!batch || batch.phase !== "hand-staged" || batch.actorSeat !== actorSeat || batch.count !== getCount(event)) return event;
		const selectedPileCards = room.publicZones.getExchangeBatch(batch.pileBatchKey).cards;
		if (selectedPileCards.length !== batch.count) {
			clearBatch(room, true);
			return event;
		}
		const knownIDs = selectedPileCards.filter((card) => card.isKnown === true && card.id > 0).map((card) => card.id);
		const sourceCards = selectedPileCards.filter((card) => !knownIDs.includes(card.id));
		batch.phase = "hand-returned";
		return patchEvent(event, {
			cardIDs: knownIDs,
			options: { sourceCards }
		});
	}
	function decorateReturnToPile(event, room, actorSeat) {
		const batch = getTianHouState(room)?.batch;
		if (!batch || batch.phase !== "hand-returned" || batch.actorSeat !== actorSeat || batch.count !== getCount(event)) return event;
		const outgoingCards = room.publicZones.getExchangeBatch(batch.handBatchKey).cards;
		if (outgoingCards.length !== batch.count) {
			clearBatch(room, true);
			return event;
		}
		const pileCandidate = createPublicCandidate("pile", POSITION_TOP, batch.count);
		batch.knownHandCards.forEach((card) => {
			card.removePublicCandidates((candidate) => candidate?.zone === "exchange");
			card.addPublicCandidate(pileCandidate);
		});
		createKnownOutConstraint(room, batch, batch.knownHandCards, {
			min: batch.minKnownOut,
			max: batch.maxKnownOut
		}, "exchange");
		batch.phase = "awaiting-reveal";
		return patchEvent(event, {
			cardIDs: [],
			options: { sourceCards: outgoingCards }
		});
	}
	function isKnownExactPileTopThree(room, cardID) {
		const card = room.cardIndex.get(cardID);
		if (!card || card.isKnown !== true || card.hasLocationCandidates()) return false;
		return room.getPublicEndpointCards("pile", TIAN_HOU_VIEW_COUNT, POSITION_TOP).includes(card);
	}
	function decorateFinalReveal(event, room) {
		const cardID = event.cardIDs[0];
		if (!(cardID > 0)) return event;
		const state = getTianHouState(room);
		const batch = state?.batch?.phase === "awaiting-reveal" ? state.batch : null;
		if (!batch && isKnownExactPileTopThree(room, cardID)) return event;
		const candidateCount = (batch?.knownHandCards.find((card) => card.id === cardID) ?? null) && batch ? batch.count : TIAN_HOU_VIEW_COUNT;
		clearBatch(room);
		return patchEvent(event, {
			type: "revealPublicCandidate",
			options: { publicCandidateReveal: {
				zone: "pile",
				position: POSITION_TOP,
				count: candidateCount
			} }
		});
	}
	function decorateTianHou(event, room) {
		const move = event.protocol;
		if (move.SpellID !== 3903) return event;
		if (isPileSingleCardShow(move)) return decorateFinalReveal(event, room);
		if (event.moveType !== MOVE_TYPE.EXCHANGE) return event;
		if (hasPositiveID(event.cardIDs ?? [])) return event;
		const fromZone = move.FromZone;
		const toZone = move.ToZone;
		if (fromZone === 1 && toZone === 10) return decoratePileStage(event, room, move.ToID);
		if (fromZone === 5 && toZone === 10) return decorateHandStage(event, room, move.FromID);
		if (fromZone === 10 && toZone === 10) return decorateExchangeReorder(event, room, move.FromID);
		if (fromZone === 10 && toZone === 5) return decorateReturnToHand(event, room, move.ToID);
		if (fromZone === 10 && toZone === 1) return decorateReturnToPile(event, room, move.FromID);
		return event;
	}
	var ZUO_LIAN_SPELL_ID = 3488;
	function prepareZuoLianMove(patched, room) {
		if (patched.FromZone === 5 && patched.ToZone === 5 && patched.MoveType === 21) {
			const positiveIDs = patched.CardIDs.filter((id) => id > 0);
			if (positiveIDs.length === 1) {
				const state = room.ensureSkillState(ZUO_LIAN_SPELL_ID, () => ({}));
				state[patched.FromID] = positiveIDs[0];
			}
			return;
		}
		if (patched.FromZone === 5 && patched.ToZone === 10 && patched.MoveType === 11) {
			const state = room.ensureSkillState(ZUO_LIAN_SPELL_ID, () => ({}));
			const knownCardID = patched.CardIDs.find((id) => id > 0);
			const cardID = knownCardID || state[patched.FromID];
			delete state[patched.FromID];
			if (!(cardID > 0)) {
				delete state.stack;
				return;
			}
			if (!knownCardID) patched.CardIDs[0] = cardID;
			state.stack = cardID;
			return;
		}
		if (patched.FromZone === 10 && [1, 2].includes(patched.ToZone) && patched.MoveType === 11) {
			const state = room.readSkillState(ZUO_LIAN_SPELL_ID);
			const cardID = state?.stack;
			if (!patched.CardIDs.some((id) => id > 0) && cardID !== void 0 && cardID > 0) patched.CardIDs[0] = cardID;
			if (state) delete state.stack;
		}
	}
	function decorateZuoLian(event, room) {
		const move = event.protocol;
		if (hasPositiveID(event.cardIDs) || move.FromZone !== PROTOCOL_ZONE.DISCARD || move.ToZone !== PROTOCOL_ZONE.EXCHANGE || move.MoveType !== MOVE_TYPE.EXCHANGE || move.FromPosition !== 65282 || getCount(event) !== 1) return event;
		const discardCards = room.getZone("discard").cards;
		const selectedCard = findLastCardByName(discardCards, "火杀") ?? findLastCardByName(discardCards, "雷杀");
		if (!selectedCard) return event;
		return patchEvent(event, { options: {
			sourceCards: [selectedCard],
			combinationID: nextGroupID(room, ZUO_LIAN_SPELL_ID, "zuolian_discard_candidate")
		} });
	}
	function findLastCardByName(cards, name) {
		for (let index = cards.length - 1; index >= 0; index--) if (cards[index]?.name === name) return cards[index];
	}
	var YAN_XI_SPELL_ID = 7017;
	function decorateYanXi(event, room) {
		if (room.game.isGuoZhan) return event;
		const move = event.protocol;
		const batch = room.readSkillState(YAN_XI_SPELL_ID);
		if (move.MoveType === 8 && move.ToZone === 5 && event.cardCount === 1 && move.FromZone === 5 && move.FromID !== move.ToID) {
			room.setSkillState(YAN_XI_SPELL_ID, {
				toSeatID: move.ToID,
				remainingPileCards: 2
			});
			return event;
		}
		if (batch?.toSeatID === move.ToID) {
			batch.remainingPileCards--;
			if (batch.remainingPileCards === 0) room.deleteSkillState(YAN_XI_SPELL_ID);
			return decorateTopGain(event, room);
		}
		if (batch) room.deleteSkillState(YAN_XI_SPELL_ID);
		if (hasPositiveID(event.cardIDs) || move.FromPosition !== 65282) return event;
		const anonymizeCards = room.getPublicEndpointCards("pile", 2, POSITION_TOP).filter((card) => card.id > 0 && card.isKnown);
		if (anonymizeCards.length === 0) return event;
		return patchEvent(event, { options: {
			anonymizeCards,
			requireAnonymizeSuccess: true
		} });
	}
	function decorateTopGain(event, room) {
		if (hasPositiveID(event.cardIDs)) return patchEvent(event, { options: { fromPosition: POSITION_TOP } });
		const sourceCards = room.getPublicEndpointCards("pile", 1, POSITION_TOP);
		const cardIDs = sourceCards.filter((card) => card.id > 0 && card.isKnown).map((card) => card.id);
		return patchEvent(event, {
			cardIDs,
			options: {
				fromPosition: POSITION_TOP,
				sourceCards: cardIDs.length > 0 ? [] : sourceCards,
				pileIdentityCardIDs: cardIDs
			}
		});
	}
	var WEN_GUA_SPELL_ID = 780;
	function decorateWenGuaCandidateSource(event, room) {
		const pending = room.readSkillState(WEN_GUA_SPELL_ID);
		if (pending) room.deleteSkillState(WEN_GUA_SPELL_ID);
		const move = event.protocol;
		if (move.SpellID !== WEN_GUA_SPELL_ID || move.FromZone !== 5 || event.cardCount !== 1 || hasPositiveID(event.cardIDs)) return event;
		if (move.MoveType === MOVE_TYPE.GIVE && move.ToZone === 5 && move.FromID !== move.ToID) {
			room.setSkillState(WEN_GUA_SPELL_ID, {
				fromSeat: move.FromID,
				toSeat: move.ToID,
				cardIDs: room.getPlayerHandCardIDs(move.FromID, { includeCandidates: true })
			});
			return event;
		}
		if (!pending || move.MoveType !== MOVE_TYPE.MOVE || move.ToZone !== 1 || move.FromID !== pending.toSeat || event.options.position !== 65280 && event.options.position !== 0) return event;
		return patchEvent(event, { options: { publicCandidateSource: {
			fromSeat: pending.fromSeat,
			cards: room.findCardsByIDs(pending.cardIDs)
		} } });
	}
	var DUO_QI_GAIN_ALL_SPELL_ID = 3730;
	var DUO_QI_RANDOM_GAIN_SPELL_ID = 3731;
	var DUO_QI_STATE_KEY = "duoQi";
	function getDuoQiState(room) {
		const state = room.readSkillState(DUO_QI_STATE_KEY);
		return state?.active === true ? state : void 0;
	}
	function getHandCards(room, seatID) {
		return room.cards.filter((card) => card.location === "player" && card.subZone === "hand" && card.seats.has(seatID));
	}
	function getKnownInitialCardsForSeat(state, seatID) {
		let cardIDs = state.initialCardIDsBySeat.get(seatID);
		if (!cardIDs) {
			cardIDs = new Set();
			state.initialCardIDsBySeat.set(seatID, cardIDs);
		}
		return cardIDs;
	}
	function bindInitialCardID(state, cardID, seatID) {
		if (!state.allCardIDs.has(cardID)) return false;
		if (state.initialSeatByCardID.get(cardID) !== void 0) return false;
		state.initialSeatByCardID.set(cardID, seatID);
		getKnownInitialCardsForSeat(state, seatID).add(cardID);
		state.unresolvedCardIDs.delete(cardID);
		return true;
	}
	function convergeInitialSeats(state) {
		let changed = true;
		while (changed && state.unresolvedCardIDs.size > 0) {
			changed = false;
			const seatsWithCapacity = Array.from(state.initialHandCountsBySeat, ([seatID, count]) => {
				const knownCount = state.initialCardIDsBySeat.get(seatID)?.size ?? 0;
				return {
					seatID,
					remaining: Math.max(0, count - knownCount)
				};
			}).filter(({ remaining }) => remaining > 0);
			if (seatsWithCapacity.length !== 1) return;
			const [{ seatID, remaining }] = seatsWithCapacity;
			if (remaining !== state.unresolvedCardIDs.size) return;
			Array.from(state.unresolvedCardIDs).forEach((cardID) => {
				changed = bindInitialCardID(state, cardID, seatID) || changed;
			});
		}
	}
	function initializeDuoQiState(game, cardIDs) {
		const room = game.room;
		const normalizedCardIDs = getPositiveIDs(cardIDs);
		if (!room || normalizedCardIDs.length === 0) return void 0;
		const state = {
			active: true,
			initialized: true,
			allCardIDs: new Set(normalizedCardIDs),
			initialHandCountsBySeat: new Map(),
			initialCardIDsBySeat: new Map(),
			initialSeatByCardID: new Map(),
			initialSeatByEntity: new Map(),
			unresolvedCardIDs: new Set(normalizedCardIDs),
			activations: new Map(),
			pendingRandomHandGroups: [],
			sequence: 0
		};
		room.seatIDs.forEach((seatID) => {
			const handCards = getHandCards(room, seatID);
			state.initialHandCountsBySeat.set(seatID, handCards.length);
			state.initialCardIDsBySeat.set(seatID, new Set());
			handCards.forEach((card) => {
				state.initialSeatByEntity.set(card, seatID);
				if (card.id > 0 && card.isKnown === true && state.allCardIDs.has(card.id)) bindInitialCardID(state, card.id, seatID);
			});
		});
		convergeInitialSeats(state);
		room.setSkillState(DUO_QI_STATE_KEY, state);
		return state;
	}
	function recordDuoQiActivation(game, msg) {
		if (msg.SpellID !== 3731) return void 0;
		const room = game.room;
		if (!room) return void 0;
		const state = getDuoQiState(room);
		if (!state) return void 0;
		const effectIndex = Number(msg.EffectIndex);
		if (effectIndex !== 2) return void 0;
		const ownerSeatID = msg.SkillOwerSeatID ?? msg.SeatID ?? msg.SrcSeatID;
		const targetSeatID = msg.DestSeatIDs?.[0];
		if (ownerSeatID === void 0 || targetSeatID === void 0 || ownerSeatID === targetSeatID) return;
		const activation = {
			ownerSeatID,
			targetSeatID,
			effectIndex,
			sequence: ++state.sequence,
			skipInference: ownerSeatID === room.mySeatID
		};
		state.activations.set(msg.SpellID, activation);
		return activation;
	}
	function recordDuoQiRoleDataTarget(game, msg) {
		const room = game.room;
		if (!room) return void 0;
		if (msg.Datas?.length < 2) return void 0;
		const state = getDuoQiState(room);
		if (!state) return void 0;
		const targetSeatID = msg.SeatID;
		const ownerSeatID = msg.Datas[1];
		if (targetSeatID === ownerSeatID) return;
		const activation = {
			ownerSeatID,
			targetSeatID,
			effectIndex: 1,
			sequence: ++state.sequence,
			skipInference: ownerSeatID === room.mySeatID
		};
		state.activations.set(DUO_QI_GAIN_ALL_SPELL_ID, activation);
		return activation;
	}
	function activationMatchesMove(activation, event) {
		if (event.toZone !== "player" || event.options.subZone !== "hand" || event.options.toSeatID !== activation.ownerSeatID) return false;
		if (event.options.fromZone === "discard") return true;
		return event.options.fromZone == null && event.options.fromSubZone === "hand" && event.options.fromSeatID === activation.targetSeatID;
	}
	function getInitialCardIDsForSeat(state, seatID) {
		return Array.from(state.initialCardIDsBySeat.get(seatID) ?? []);
	}
	function getInitialEntitiesForSeat(state, seatID) {
		return Array.from(state.initialSeatByEntity).filter(([, initialSeatID]) => initialSeatID === seatID).map(([card]) => card);
	}
	function isCardInOwnerHand(card, ownerSeatID) {
		return card.location === "player" && card.subZone === "hand" && card.seats.size === 1 && card.seats.has(ownerSeatID);
	}
	function decorateGainAll(event, room, state) {
		const activation = state.activations.get(DUO_QI_GAIN_ALL_SPELL_ID);
		if (!activation || activation.skipInference || !activationMatchesMove(activation, event)) return event;
		if (event.cardIDs.some((cardID) => cardID > 0)) return event;
		const sourceZone = event.options.fromZone === "discard" ? 2 : 5;
		resolveRandomHandCandidatesForGainAll(event, room, state, activation, sourceZone);
		const sourceCards = collectGainAllSourceCards(room, state, activation.targetSeatID, activation.ownerSeatID, sourceZone);
		const cardCount = getCount(event);
		if (sourceCards.length !== cardCount) return event;
		return patchEvent(event, { options: {
			sourceCards,
			pileIdentityCardIDs: sourceCards.filter((card) => card.id > 0).map((card) => card.id)
		} });
	}
	function resolveRandomHandCandidatesForGainAll(event, room, state, activation, sourceZone) {
		const cardCount = getCount(event);
		if (cardCount <= 0) return;
		const definiteSourceCards = collectGainAllSourceCards(room, state, activation.targetSeatID, activation.ownerSeatID, sourceZone);
		const groups = state.pendingRandomHandGroups.filter((group) => group.ownerSeatID === activation.ownerSeatID && group.targetSeatID === activation.targetSeatID && group.gainedCount > 0);
		if (groups.length !== 1) return;
		const [group] = groups;
		const candidateCards = Array.from(group.candidateCardIDs).map((cardID) => room.cardIndex.get(cardID)).filter((card) => Boolean(card)).filter((card) => isCardInGainAllSource(card, activation.targetSeatID, sourceZone));
		const alreadyTargetCards = candidateCards.filter((card) => state.initialSeatByEntity.get(card) === activation.targetSeatID);
		const unresolvedCandidateCards = candidateCards.filter((card) => !alreadyTargetCards.includes(card)).filter((card) => !definiteSourceCards.includes(card));
		const missingCount = cardCount - definiteSourceCards.length;
		if (missingCount < 0 || unresolvedCandidateCards.length !== missingCount) return;
		const confirmedCards = [...alreadyTargetCards, ...unresolvedCandidateCards];
		if (confirmedCards.length === 0 || confirmedCards.length > group.gainedCount) return;
		const reassignments = planInitialEntitySeatReassignments(state, group, unresolvedCandidateCards, activation.targetSeatID);
		if (!reassignments) return;
		applyInitialEntitySeatReassignments(state, reassignments, activation.targetSeatID);
		confirmedCards.forEach((card) => {
			bindInitialCardID(state, card.id, activation.targetSeatID);
			group.candidateCardIDs.delete(card.id);
		});
		group.gainedCount -= confirmedCards.length;
		if (group.gainedCount <= 0) state.pendingRandomHandGroups = state.pendingRandomHandGroups.filter((candidate) => candidate !== group);
	}
	function planInitialEntitySeatReassignments(state, group, cards, targetSeatID) {
		const replacements = Array.from(group.candidateEntities).filter((candidate) => candidate.id <= 0 && !cards.includes(candidate) && state.initialSeatByEntity.get(candidate) === targetSeatID);
		const reassignments = [];
		for (const card of cards) {
			const previousSeatID = state.initialSeatByEntity.get(card);
			if (previousSeatID === targetSeatID) continue;
			const replacement = replacements.shift();
			if (!replacement) return null;
			reassignments.push({
				card,
				replacement,
				previousSeatID
			});
		}
		return reassignments;
	}
	function applyInitialEntitySeatReassignments(state, reassignments, targetSeatID) {
		reassignments.forEach(({ card, replacement, previousSeatID }) => {
			if (previousSeatID === void 0) state.initialSeatByEntity.delete(replacement);
			else state.initialSeatByEntity.set(replacement, previousSeatID);
			state.initialSeatByEntity.set(card, targetSeatID);
		});
	}
	function collectGainAllSourceCards(room, state, targetSeatID, ownerSeatID, sourceZone) {
		const targetCards = new Set(getInitialEntitiesForSeat(state, targetSeatID));
		getInitialCardIDsForSeat(state, targetSeatID).map((cardID) => room.cardIndex.get(cardID)).filter((card) => Boolean(card)).forEach((card) => targetCards.add(card));
		return Array.from(targetCards).filter((card) => !isCardInOwnerHand(card, ownerSeatID)).filter((card) => isCardInGainAllSource(card, targetSeatID, sourceZone));
	}
	function isCardInGainAllSource(card, targetSeatID, sourceZone) {
		if (sourceZone === 2) return card.location === "discard";
		return card.location === "player" && card.subZone === "hand" && card.seats.has(targetSeatID);
	}
	function collectRecentDiscardSourceCards(event, room, state, activation) {
		const targetInitialCardIDs = getInitialCardIDsForSeat(state, activation.targetSeatID);
		const targetInitialCardIDsInDiscard = new Set(targetInitialCardIDs.filter((cardID) => room.cardIndex.get(cardID)?.location === "discard"));
		const sourceCandidates = room.getZone("discard").cards.filter((card) => targetInitialCardIDsInDiscard.has(card.id));
		const gainedCount = getCount(event);
		if (gainedCount <= 0 || sourceCandidates.length < gainedCount) return [];
		return sourceCandidates.slice(-gainedCount).reverse();
	}
	function decorateRandomDiscardGain(event, room, state) {
		const activation = state.activations.get(DUO_QI_RANDOM_GAIN_SPELL_ID);
		if (!activation || activation.skipInference || !activationMatchesMove(activation, event)) return event;
		if (event.options.fromZone !== "discard" || event.cardIDs.some((cardID) => cardID > 0)) return event;
		const gainedCount = getCount(event);
		const sourceCards = collectRecentDiscardSourceCards(event, room, state, activation);
		if (gainedCount <= 0 || sourceCards.length !== gainedCount) return event;
		return patchEvent(event, { options: {
			sourceCards,
			pileIdentityCardIDs: sourceCards.filter((card) => card.id > 0).map((card) => card.id)
		} });
	}
	function decorateDuoQiMove(event, room) {
		const state = getDuoQiState(room);
		if (!state) return event;
		const spellID = event.protocol.SpellID;
		if (spellID === 3730) return decorateGainAll(event, room, state);
		if (spellID === 3731) return decorateRandomHandGain(decorateRandomDiscardGain(event, room, state), state);
		return event;
	}
	function decorateRandomHandGain(event, state) {
		const activation = state.activations.get(DUO_QI_RANDOM_GAIN_SPELL_ID);
		if (!activation || activation.skipInference || !activationMatchesMove(activation, event)) return event;
		if (event.options.fromZone != null || event.options.fromSubZone !== "hand" || event.cardIDs.some((cardID) => cardID > 0) || event.options.sourceCards?.length) return event;
		const count = getCount(event);
		const candidateEntities = new Set(getInitialEntitiesForSeat(state, activation.targetSeatID).filter((card) => card.location === "player" && card.subZone === "hand" && card.seats.has(activation.targetSeatID)));
		if (count <= 0 || candidateEntities.size < count) return event;
		const group = {
			ownerSeatID: activation.ownerSeatID,
			targetSeatID: activation.targetSeatID,
			candidateEntities,
			candidateCardIDs: new Set(),
			gainedCount: count,
			sequence: activation.sequence
		};
		state.pendingRandomHandGroups.push(group);
		return patchEvent(event, { options: {
			forceRandomHandTransferCandidates: true,
			duoQiRandomHandGroupSequence: group.sequence
		} });
	}
	function decorateDuoQiKnownMove(event, room) {
		const state = getDuoQiState(room);
		if (!state || state.pendingRandomHandGroups.length === 0) return event;
		const fromSeatID = event.options.fromSeatID;
		if (event.options.fromSubZone !== "hand" || !Number.isFinite(fromSeatID) || !event.cardIDs.some((cardID) => cardID > 0)) return event;
		const group = state.pendingRandomHandGroups.slice().reverse().find((candidate) => candidate.ownerSeatID === fromSeatID && candidate.gainedCount > 0);
		if (!group) return event;
		const candidateIDs = event.cardIDs.filter((cardID) => cardID > 0).filter((cardID) => state.allCardIDs.has(cardID) && !state.initialSeatByCardID.has(cardID));
		if (candidateIDs.length === 0) return event;
		return patchEvent(event, { options: {
			duoQiRandomHandCandidateIDs: candidateIDs,
			duoQiRandomHandGroupSequence: group.sequence
		} });
	}
	function decorateDuoQiEntitySafety(event, room) {
		const state = getDuoQiState(room);
		if (!state) return event;
		const move = event.protocol;
		const spellID = move.SpellID;
		const fromSeatID = move.FromID;
		if (!(move.FromZone === 5 && !event.cardIDs.some((cardID) => cardID > 0)) || spellID === 3730) return event;
		if (spellID === 3731) return event;
		const selectionCount = getCount(event);
		const sourcePlayer = room.getPlayer(fromSeatID);
		const physicalHandCards = getHandCards(room, fromSeatID);
		const sourceHandCount = sourcePlayer?.hasObservedHandCount ? sourcePlayer.observedHandCount : physicalHandCards.length;
		if (sourceHandCount <= 0 || selectionCount >= sourceHandCount) return event;
		physicalHandCards.forEach((card) => {
			if (card.id > 0 && state.initialSeatByCardID.has(card.id)) return;
			state.initialSeatByEntity.delete(card);
		});
		return event;
	}
	function findInitialSeatByCard(state, room, cardID) {
		const existingSeatID = state.initialSeatByCardID.get(cardID);
		if (existingSeatID !== void 0) return existingSeatID;
		const card = room.cardIndex.get(cardID);
		if (!card) return void 0;
		if (state.pendingRandomHandGroups.some((group) => group.candidateCardIDs.has(cardID))) return;
		const entitySeatID = state.initialSeatByEntity.get(card);
		if (entitySeatID !== void 0) return entitySeatID;
	}
	function observeDuoQiKnownCardIDs(room, cardIDs) {
		const state = getDuoQiState(room);
		if (!state) return;
		getPositiveIDs(cardIDs).forEach((cardID) => {
			if (!state.allCardIDs.has(cardID)) return;
			const initialSeatID = findInitialSeatByCard(state, room, cardID);
			if (initialSeatID !== void 0) bindInitialCardID(state, cardID, initialSeatID);
		});
		convergeInitialSeats(state);
	}
	function commitDuoQiMove(room, event) {
		const state = getDuoQiState(room);
		commitRandomHandCandidates(state, event);
		finishRandomHandGroupsAfterGainAll(state, event);
	}
	function finishRandomHandGroupsAfterGainAll(state, event) {
		if (!state || state.pendingRandomHandGroups.length === 0) return;
		if (event.protocol.SpellID !== 3730 || event.options.fromSubZone !== "hand" || !Number.isFinite(event.options.fromSeatID)) return;
		const activation = state.activations.get(DUO_QI_GAIN_ALL_SPELL_ID);
		if (!activation || !activationMatchesMove(activation, event)) return;
		state.pendingRandomHandGroups = state.pendingRandomHandGroups.filter((group) => group.ownerSeatID !== activation.ownerSeatID || group.targetSeatID !== activation.targetSeatID);
	}
	function commitRandomHandCandidates(state, event) {
		if (!state || state.pendingRandomHandGroups.length === 0) return;
		const sequence = event.options.duoQiRandomHandGroupSequence;
		const group = state.pendingRandomHandGroups.find((candidate) => candidate.sequence === sequence);
		if (!group) return;
		const candidateIDs = event.options?.duoQiRandomHandCandidateIDs;
		if (!Array.isArray(candidateIDs)) return;
		getPositiveIDs(candidateIDs).forEach((cardID) => {
			if (state.allCardIDs.has(cardID) && !state.initialSeatByCardID.has(cardID)) group.candidateCardIDs.add(cardID);
		});
	}
	function deferGuiFuMove(room, raw, move) {
		const previous = room.readSkillState(GUI_FU_ROLE_DATA_ID);
		if (previous) {
			room.deleteSkillState(GUI_FU_ROLE_DATA_ID);
			trackerLogger.warn("诡伏移动未收到相邻角色数据，已丢弃待补全移动", {
				previous,
				next: move
			});
		}
		const fromZone = move.FromZone;
		const cardIDs = move.CardIDs;
		if (move.SpellID !== 3709 || move.MoveType !== MOVE_TYPE.GAIN || fromZone !== 1 && fromZone !== 2 || move.ToZone !== 5 || move.ToID == null || move.ToID === 255 || move.CardCount <= 0 || cardIDs.some((cardID) => cardID > 0)) return false;
		room.setSkillState(GUI_FU_ROLE_DATA_ID, {
			raw,
			patched: move
		});
		return true;
	}
	function completeGuiFuMove(room, seatID, cardIDs) {
		const pending = room.readSkillState(GUI_FU_ROLE_DATA_ID);
		if (!pending) return null;
		room.deleteSkillState(GUI_FU_ROLE_DATA_ID);
		const { raw, patched } = pending;
		const count = patched.CardCount;
		const gainedIDs = cardIDs.filter((cardID) => !isHeldGuiFuCard(room, seatID, cardID));
		if (patched.ToID !== seatID || gainedIDs.length !== count || new Set(gainedIDs).size !== count || patched.FromZone === 2 && !hasDiscardSourceCards(room, gainedIDs)) {
			trackerLogger.warn("诡伏相邻角色数据与待补全移动不匹配，已取消移动", {
				pending,
				seatID,
				cardIDs
			});
			return null;
		}
		return {
			raw,
			patched: {
				...patched,
				CardIDs: gainedIDs
			}
		};
	}
	function isHeldGuiFuCard(room, seatID, cardID) {
		const locations = room.cardIndex.get(cardID)?.getPossibleLocations() ?? [];
		const location = locations[0];
		return locations.length === 1 && location.type === "player" && location.seatID === seatID && location.subZone === "hand";
	}
	function hasDiscardSourceCards(room, cardIDs) {
		const discard = room.getZone("discard");
		return cardIDs.every((cardID) => {
			const card = room.cardIndex.get(cardID);
			return card?.location === "discard" && card.isKnown && discard.cards.includes(card);
		});
	}
	function parseGuiFuCardIDs(datas) {
		if (!Array.isArray(datas)) return [];
		const count = datas[0];
		const cardIDs = datas.slice(1, count + 1);
		return cardIDs.length === count && cardIDs.every((cardID) => cardID > 0) ? cardIDs : [];
	}
	var guiFuPlugin = {
		id: "guiFu",
		beforeNormalizeMove(patched, raw, room) {
			if (deferGuiFuMove(room, raw, patched)) return "defer";
		},
		onProtocolEvent(event, room) {
			if (event.type !== "roleData" || event.message.DataID !== 3709) return;
			const { SeatID, Datas } = event.message;
			if (SeatID == null || SeatID === 255 || room.mySeatID == null || SeatID === room.mySeatID) return;
			return completeGuiFuMove(room, SeatID, parseGuiFuCardIDs(Datas)) ?? void 0;
		},
		onDeckInitialized: (room) => room.deleteSkillState(GUI_FU_ROLE_DATA_ID)
	};
	var XIA_SHU_SPELL_ID = 361;
	function handleXiaShuTargetNotice(room, msg) {
		const shownCardIDs = msg.Params.filter((id) => id > 0);
		const targetSeatID = msg.targetSeatID;
		if (!shownCardIDs.length || targetSeatID == null || targetSeatID === 255) return false;
		room.setSkillState(XIA_SHU_SPELL_ID, {
			shownCardIDs,
			targetSeatID
		});
		return true;
	}
	function handleXiaShuChoice(room, msg) {
		const choice = msg.Datas[0];
		if (choice !== 1 && choice !== 2) return false;
		const state = room.readSkillState(XIA_SHU_SPELL_ID);
		if (!state) return false;
		state.choice = choice;
		if (msg.SeatID != null && msg.SeatID !== 255) state.actorSeatID = msg.SeatID;
		return true;
	}
	function settleXiaShuAfterMove(event, room) {
		const state = room.readSkillState(XIA_SHU_SPELL_ID);
		if (!state || state.choice !== 1 && state.choice !== 2) return;
		const { fromSeatID, toSeatID, fromSubZone, subZone } = event.options;
		if (event.type === "showCards" || event.type === "noop" || event.toZone !== "player" || fromSubZone !== "hand" || subZone !== "hand" || event.cardCount <= 0 || fromSeatID !== state.targetSeatID || toSeatID == null || toSeatID === 255 || state.actorSeatID != null && state.actorSeatID !== toSeatID) return;
		if (state.choice === 2) {
			if (!room.moveCards(state.shownCardIDs, "player", {
				fromSeatID: state.targetSeatID,
				toSeatID: state.targetSeatID,
				fromSubZone: "hand",
				subZone: "hand",
				cardCount: state.shownCardIDs.length,
				handMoveCount: 0,
				sourceEvent: {
					type: "xiaShu:hidden-choice",
					label: "下书选择暗牌，展示牌留在原目标手牌"
				}
			})) return;
			room.applyPileIdentityReveal(state.shownCardIDs);
			room.notifyCardsRevealed(state.shownCardIDs);
		}
		room.deleteSkillState(XIA_SHU_SPELL_ID);
	}
	var xiaShuPlugin = {
		id: "xiaShu",
		spellIDs: [XIA_SHU_SPELL_ID],
		afterMoveCommitted: settleXiaShuAfterMove,
		onProtocolEvent(event, room) {
			const msg = event.message;
			if (!("SpellID" in msg) || msg.SpellID !== XIA_SHU_SPELL_ID) return;
			if (event.type === "targetNotice") {
				const notice = event.message;
				if (notice.Param === 0 && notice.Type === 29 && notice.Params?.length) handleXiaShuTargetNotice(room, notice);
			}
			if (event.type === "choice" && event.message.Type === 22 && event.message.data_count === 2 && event.message.Datas) handleXiaShuChoice(room, event.message);
		},
		onDeckInitialized: (room) => room.deleteSkillState(XIA_SHU_SPELL_ID)
	};
	function defineStoredCardsPlugin({ id, spellIDs, prepare, record }) {
		return {
			id,
			spellIDs,
			beforeNormalizeMove: (patched, raw, room) => prepare(patched, room),
			onProtocolEvent(event, room) {
				if (event.type === "useSpell" && spellIDs.includes(event.message.SpellID)) record(room, event.message);
			},
			onDeckInitialized: (room) => spellIDs.forEach((spellID) => room.deleteSkillState(spellID))
		};
	}
	function recordSharedCardIDs(room, msg) {
		if (room.mySeatID === void 0 || msg.SeatID === room.mySeatID) return;
		if (msg.dest_Count === 1 && msg.DestSeatIDs?.[0] === room.mySeatID) return;
		if (msg.CardIDs && msg.CardIDs.length === msg.card_count) room.setSkillState(msg.SpellID, [...msg.CardIDs]);
	}
	var qingYiLianJuPlugin = defineStoredCardsPlugin({
		id: "qingYiLianJu",
		spellIDs: [3157, 3511],
		prepare: handleQingYiLianJu,
		record: recordSharedCardIDs
	});
	function handleQingYiLianJu(patched, room) {
		const spellCards = room.readSkillState(patched.SpellID);
		if (patched.FromZone == 2 && patched.ToZone == 5 && patched.CardCount == spellCards?.length && patched.CardIDs.filter((id) => id > 0).length == 0) {
			spellCards.forEach((id, i) => {
				patched.CardIDs[i] = id;
			});
			room.deleteSkillState(patched.SpellID);
		}
	}
	var qianFuPlugin = defineStoredCardsPlugin({
		id: "qianFu",
		spellIDs: [3750],
		prepare: handleQianFu,
		record: recordQianFu
	});
	function recordQianFu(room, msg) {
		if (msg.EffectIndex === 2 && !msg.DestSeatIDs?.length) room.setSkillState(msg.SpellID, [...msg.CardIDs ?? []]);
	}
	function handleQianFu(patched, room) {
		const spellCards = room.readSkillState(patched.SpellID);
		if (patched.FromZone == 2 && patched.ToZone == 1 && patched.MoveType == 15 && patched.CardCount == spellCards?.length && patched.CardIDs.filter((id) => id > 0).length == 0) {
			patched.CardIDs = [...spellCards];
			room.deleteSkillState(patched.SpellID);
		}
	}
	var shengMoPlugin = defineStoredCardsPlugin({
		id: "shengMo",
		spellIDs: [3434],
		prepare: handleShengMo,
		record: recordShengMo
	});
	function recordShengMo(room, msg) {
		if (room.mySeatID === void 0 || msg.SeatID === room.mySeatID) return;
		room.setSkillState(msg.SpellID, [...msg.CardIDs ?? []]);
	}
	function handleShengMo(patched, room) {
		const spellCards = room.readSkillState(patched.SpellID);
		if (patched.FromZone == 2 && patched.ToZone == 5 && patched.MoveType == 15 && patched.CardCount == spellCards?.length && patched.CardIDs.filter((id) => id > 0).length == 0) {
			patched.CardIDs = [...spellCards];
			room.deleteSkillState(patched.SpellID);
		}
	}
	var zeXingPlugin = defineStoredCardsPlugin({
		id: "zeXing",
		spellIDs: [3854],
		prepare: handleZeXing,
		record: recordSharedCardIDs
	});
	function handleZeXing(patched, room) {
		const spellCards = room.readSkillState(patched.SpellID);
		if (patched.FromZone == 5 && patched.ToZone == 5 && patched.CardCount == spellCards?.length && patched.CardIDs.filter((id) => id > 0).length == 0) {
			patched.CardIDs = [...spellCards];
			room.deleteSkillState(patched.SpellID);
		}
	}
	var HAND_EXCHANGE_EXCLUDED_SPELL_IDS = new Set([
		3208,
		3483,
		3903,
		3776,
		987,
		988
	]);
	function decorateGenericMove(event, room) {
		const spellID = event.protocol.SpellID;
		if (HAND_EXCHANGE_EXCLUDED_SPELL_IDS.has(spellID)) return event;
		return decorateHandExchange(event, room);
	}
	function registerDefaultMoveEventHandlers(room) {
		room.registerSkillPlugin(guiFuPlugin);
		room.registerSkillPlugin({
			id: "genericMove",
			decorateMove: decorateGenericMove
		});
		room.registerSkillPlugin({
			id: "duoQiEntitySafety",
			decorateMove: decorateDuoQiEntitySafety
		});
		room.registerSkillPlugin({
			id: "duoQi",
			decorateMove: decorateDuoQiKnownMove,
			afterMoveCommitted(event, currentRoom) {
				if (![
					"showCards",
					"revealPublicCandidate",
					"shuffleDiscardIntoPile",
					"noop"
				].includes(event.type)) commitDuoQiMove(currentRoom, event);
			},
			onCardsRevealed: (ids, currentRoom) => observeDuoQiKnownCardIDs(currentRoom, ids),
			onProtocolEvent(event, currentRoom) {
				if (event.type === "useSpell") recordDuoQiActivation(currentRoom.game, event.message);
				if (event.type === "roleData" && event.message.DataID === 8 && event.message.Datas?.[0] === 3730) recordDuoQiRoleDataTarget(currentRoom.game, event.message);
				if (event.type === "choice" && event.message.Type === 72 && event.message.Datas?.length) {
					const game = currentRoom.game;
					if (game.isGameStart && !game.round && !game.phase) initializeDuoQiState(game, event.message.Datas);
				}
			},
			onDeckInitialized: (currentRoom) => currentRoom.deleteSkillState("duoQi")
		});
		room.registerSkillPlugin({
			id: "guanXu",
			spellIDs: [987, 988],
			decorateMove: decorateGuanXu
		});
		room.registerSkillPlugin({
			id: "tianHou",
			spellIDs: [3903],
			decorateMove: decorateTianHou
		});
		room.registerSkillPlugin({
			id: "xingZuo",
			spellIDs: [3776],
			decorateMove: decorateXingZuo
		});
		room.registerSkillPlugin({
			id: "siQi",
			spellIDs: [3543],
			decorateMove: decorateSiQi
		});
		room.registerSkillPlugin({
			id: "fenChao",
			spellIDs: [3752],
			decorateMove: decorateFenChao
		});
		room.registerSkillPlugin({
			id: "duoQiMove",
			spellIDs: [3730, 3731],
			decorateMove: decorateDuoQiMove
		});
		room.registerSkillPlugin({
			id: "chengLie",
			spellIDs: [3208],
			decorateMove: decorateChengLieMove
		});
		room.registerSkillPlugin(jieLiPlugin);
		room.registerSkillPlugin({
			id: "wenGua",
			spellIDs: [780],
			decorateMove: decorateWenGuaCandidateSource
		});
		room.registerSkillPlugin({
			id: "zuoLian",
			spellIDs: [3488],
			beforeNormalizeMove: (patched, raw, currentRoom) => prepareZuoLianMove(patched, currentRoom),
			decorateMove: decorateZuoLian,
			onDeckInitialized: (currentRoom) => currentRoom.deleteSkillState(3488)
		});
		room.registerSkillPlugin({
			id: "yanXi",
			spellIDs: [7017],
			decorateMove: decorateYanXi
		});
		room.registerSkillPlugin(qingYiLianJuPlugin);
		room.registerSkillPlugin(qianFuPlugin);
		room.registerSkillPlugin(shengMoPlugin);
		room.registerSkillPlugin(zeXingPlugin);
		room.registerSkillPlugin(xiaShuPlugin);
	}
	var MOVE_EVENT_SUMMARY_OPTIONS = {
		normalizeCardIDs: true,
		includeEventCardCount: true,
		includeSourceCards: true
	};
	var noopView = {
		mount(_room) {},
		unmount() {},
		scheduleRender() {}
	};
	var noopLogger = {
		debug() {},
		info() {},
		warn() {}
	};
	var TrackerController = class {
		controllerView;
		controllerLogger;
		gameState;
		getSeatUIs;
		registerMoveEventHandlers;
		trackerRoom = null;
		constructor({ view = noopView, gameState = Game, getSeatUIs = () => {}, logger = noopLogger, registerMoveEventHandlers = registerDefaultMoveEventHandlers } = {}) {
			this.controllerView = {
				...noopView,
				...view
			};
			this.controllerLogger = {
				...noopLogger,
				...logger
			};
			this.gameState = gameState;
			this.getSeatUIs = getSeatUIs;
			this.registerMoveEventHandlers = registerMoveEventHandlers;
		}
		getTrackerRoom() {
			return this.trackerRoom;
		}
		isTrackerReady() {
			return Boolean(this.trackerRoom?.isDeckReady && !this.gameState.isDuanXian);
		}
		getReadyTrackerRoom() {
			return this.isTrackerReady() ? this.trackerRoom : null;
		}
		getTrackedPlayerHandCardIDs(seatID) {
			return this.getReadyTrackerRoom()?.getPlayerHandCardIDs(seatID) ?? [];
		}
		initTrackerRoom() {
			try {
				this.trackerRoom?.destroy();
				this.gameState.beginPlayback();
				const room = new Room({ gameState: this.gameState });
				this.trackerRoom = room;
				this.controllerLogger.info("Room 初始化");
				this.registerMoveEventHandlers(room);
			} catch (e) {
				trackerLogger.error("Room 初始化失败", e);
				this.controllerView.unmount();
				if (this.trackerRoom) {
					this.trackerRoom.destroy();
					this.trackerRoom = null;
				} else this.gameState.bindRoom(null);
			}
		}
		initTrackerDeck(cardIDs) {
			if (!this.trackerRoom) return;
			if (this.gameState.isDuanXian) {
				this.controllerLogger.warn("断线重连状态，跳过 Room 牌堆初始化");
				this.controllerView.unmount();
				return;
			}
			this.trackerRoom.initDeck(cardIDs);
			this.controllerView.mount(this.trackerRoom);
			this.controllerLogger.info("Room 牌堆初始化完成", { cardIDs });
		}
		registerTrackerPlayers(infos, currentUserID) {
			if (!this.trackerRoom) return;
			this.trackerRoom.registerPlayers(infos, currentUserID);
			this.controllerView.mount(this.trackerRoom);
			this.controllerView.scheduleRender();
		}
		setTrackerMySeatID(seatID) {
			if (!this.trackerRoom || this.trackerRoom.mySeatID !== void 0) return;
			const normalizedSeatID = Number(seatID);
			if (!this.trackerRoom.players.has(normalizedSeatID)) return;
			this.trackerRoom.setMySeatID(normalizedSeatID);
			this.trackerRoom.updateFixedViewIds();
			this.getSeatUIs();
			this.controllerView.scheduleRender();
		}
		setTrackerPlayerShowStatuses(statuses) {
			if (!this.trackerRoom?.setPlayerShowStatuses(statuses)) return;
			this.getSeatUIs();
			this.controllerView.scheduleRender();
		}
		setTrackerFirstHand(seatID) {
			if (!this.trackerRoom) return;
			try {
				const firstID = this.trackerRoom.firstID;
				if (firstID !== void 0) {
					if (firstID !== seatID) this.controllerLogger.warn("先手座位重复设置且不一致，已忽略", {
						currentSeatID: firstID,
						receivedSeatID: seatID
					});
					return;
				}
				this.trackerRoom.setFirstHand(seatID);
				this.getSeatUIs();
				this.controllerView.scheduleRender();
			} catch (e) {
				trackerLogger.error("先手同步失败", e);
			}
		}
		scheduleTrackerRender() {
			const readyRoom = this.getReadyTrackerRoom();
			if (!readyRoom) return;
			readyRoom.markViewDirty("tracker-controller-render");
			this.controllerView.scheduleRender();
		}
		syncTrackerMove(input, source = input) {
			const readyRoom = this.getReadyTrackerRoom();
			if (!readyRoom) return;
			const raw = Object.freeze({
				...source,
				CardIDs: Object.freeze([...source.CardIDs])
			});
			const patched = {
				...input,
				CardIDs: [...input.CardIDs]
			};
			try {
				Object.assign(patched, normalizeTrackerMovePosition(patched));
				this.controllerLogger.info(getProtocolMoveSpecialLabel(patched) ?? "移动协议输入", {
					raw: this.summarizeProtocolMove(raw),
					patched: this.summarizeProtocolMove(patched)
				});
				if (readyRoom.beforeNormalizeMove(patched, raw) === "defer") return;
				if (hasMixedTrackerMoveVisibility(patched)) {
					this.controllerLogger.warn("移动协议明暗牌混合，按暗牌处理", {
						raw,
						patched
					});
					patched.CardIDs = [];
				}
				const normalizedEvent = normalizeMoveEvent(patched, raw);
				if (normalizedEvent.options.fromSubZone === "hand") normalizedEvent.cardIDs.forEach((cardID) => {
					const card = readyRoom.cardIndex.get(cardID);
					if (!card || card.suspended || card.hasLocationCandidates() || card.resolvedSeat !== normalizedEvent.options.fromSeatID || card.subZone !== "equip" && card.subZone !== "judge" && card.subZone !== "mark") return;
					this.controllerLogger.warn("协议手牌来源与本地确定子区冲突，仍按协议处理", {
						cardID,
						fromSeatID: normalizedEvent.options.fromSeatID,
						fromSubZone: normalizedEvent.options.fromSubZone,
						localSubZone: card.subZone,
						localSpellID: card.spellID,
						raw: this.summarizeProtocolMove(raw),
						patched: this.summarizeProtocolMove(patched)
					});
				});
				this.controllerLogger.debug("移动事件归一化", summarizeMoveEvent(normalizedEvent, MOVE_EVENT_SUMMARY_OPTIONS));
				const event = readyRoom.decorateMoveEvent(normalizedEvent);
				this.controllerLogger.debug("移动事件装饰完成", {
					before: summarizeMoveEvent(normalizedEvent, MOVE_EVENT_SUMMARY_OPTIONS),
					after: summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
				});
				if (normalizedEvent.options.fromSubZone !== event.options.fromSubZone) this.controllerLogger.info("移动事件来源修正", {
					cardIDs: event.cardIDs,
					fromSubZone: normalizedEvent.options.fromSubZone,
					correctedFromSubZone: event.options.fromSubZone
				});
				if (event.type === "revealPublicCandidate") {
					this.controllerLogger.info("移动事件分支: revealPublicCandidate", summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS));
					if (!this.revealPublicCandidateCards(readyRoom, event)) return;
				} else if (event.type === "noop") {
					this.controllerLogger.info("移动事件跳过", summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS));
					return;
				} else if (event.type === "showCards") {
					this.controllerLogger.info("移动事件分支: showCards", summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS));
					if (!this.showTrackerCards(readyRoom, event)) return;
				} else if (event.type === "shuffleDiscardIntoPile") {
					this.controllerLogger.info("移动事件分支: shuffleDiscardIntoPile", summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS));
					readyRoom.shufflePile({ cardCount: event.cardCount });
				} else {
					this.controllerLogger.info("移动事件分支: moveCards", summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS));
					if (!readyRoom.moveCards(event.cardIDs, event.toZone, {
						...event.options,
						pileIdentityEvent: event
					})) {
						this.controllerLogger.warn("移动来源解析失败，已取消本次 tracker 移动", { cardIDs: event.cardIDs });
						return;
					}
				}
				readyRoom.afterMoveCommitted(event);
				readyRoom.notifyCardsRevealed(event.cardIDs);
				this.controllerView.scheduleRender();
			} catch (e) {
				trackerLogger.error("移动同步异常，已跳过本次 tracker 更新", e, this.summarizeProtocolMove(raw));
			}
		}
		revealPublicCandidateCards(room, event) {
			const reveal = event.options.publicCandidateReveal;
			if (!reveal || !(Number(reveal.count) > 0)) return false;
			const ids = event.cardIDs.filter((id) => id > 0);
			const locationCandidate = fromPublicCandidate(createPublicCandidate(reveal.zone, reveal.position, Number(reveal.count)));
			if (ids.length === 0 || !locationCandidate) return false;
			const cards = room.revealPublicCandidates(ids, locationCandidate);
			this.controllerLogger.info("公共区范围揭示完成", {
				ids,
				zone: reveal.zone,
				position: locationCandidate.position,
				count: reveal.count,
				resolvedCount: cards.length
			});
			return cards.length > 0;
		}
		showTrackerCards(room, event) {
			const ids = event.cardIDs.filter((id) => id > 0);
			if (ids.length === 0) return false;
			const raw = event.raw ?? event.options.sourceEvent?.raw ?? {};
			const move = event.protocol;
			const zone = move.ToZone ?? move.FromZone;
			const seatID = move.ToID ?? move.FromID;
			const subZone = getProtocolPlayerSubZone(zone, null);
			const spellID = getProtocolMarkSpellID(zone, {
				toZoneParam: move.ToZoneParam,
				fromZoneParam: move.FromZoneParam,
				spellID: move.SpellID
			}, move.SpellID);
			if (zone === 8) return room.moveCards(ids, "popup", {
				fromZone: "popup",
				fromPopupSpaceID: event.options.toPopupSpaceID,
				toPopupSpaceID: event.options.toPopupSpaceID,
				handMoveCount: 0,
				sourceEvent: event.options.sourceEvent
			});
			if (subZone && seatID != null && seatID !== 255) {
				this.controllerLogger.info("展示明牌进入玩家区", {
					ids,
					seatID,
					subZone,
					spellID
				});
				return room.moveCards(ids, "player", {
					toSeatID: seatID,
					fromSeatID: seatID,
					fromZone: null,
					fromSubZone: subZone,
					subZone,
					spellID,
					cardCount: ids.length,
					sourceEvent: event.options.sourceEvent ?? {
						type: "showCards",
						raw
					}
				});
			}
			const zoneName = getProtocolPublicZone(zone, event.toZone ?? "process");
			const position = event.options.position ?? event.options.fromPosition ?? 65280;
			const sourceZoneName = getProtocolPublicZone(move.FromZone);
			const materializationZone = sourceZoneName && sourceZoneName !== zoneName ? sourceZoneName : zoneName;
			const knownCards = room.resolvePublicKnownCards(ids, {
				zoneName: materializationZone,
				position: event.options.fromPosition ?? position
			}, this.controllerLogger);
			this.controllerLogger.info("展示明牌进入公共区", {
				ids,
				zoneName,
				position,
				resolvedCount: knownCards.length
			});
			if (sourceZoneName && sourceZoneName !== zoneName) {
				knownCards.forEach((card) => card.confirmKnown());
				return room.moveCards(ids, zoneName, {
					...event.options,
					fromZone: sourceZoneName,
					fromSeatID: null,
					fromSubZone: null,
					cardCount: ids.length
				});
			}
			const shouldRepositionPile = zoneName === "pile" && (position === 65280 || position === 0);
			room.placePublicRevealCards(knownCards, zoneName, {
				position,
				reposition: shouldRepositionPile,
				cardIDsTopFirst: shouldRepositionPile && position === 65280
			}, this.controllerLogger);
			room.applyPileIdentityReveal(ids);
			return true;
		}
		revealTrackerCards(target = {}, cardIDs = []) {
			const readyRoom = this.getReadyTrackerRoom();
			if (!readyRoom) return;
			const ids = this.normalizeIDs(cardIDs).filter((id) => id > 0);
			if (ids.length === 0) return;
			try {
				this.controllerLogger.info("明牌同步输入", {
					target,
					cardIDs: ids
				});
				if (target.type === "player") {
					const seatID = Number(target.seatID);
					if (Number.isNaN(seatID) || seatID === 255) return;
					const subZone = target.subZone ?? "hand";
					if ((target.fullHand === true || target.inferFullHand === true && subZone === "hand" && readyRoom.shouldRevealPlayerHandAsFullHand(seatID, ids.length)) && subZone === "hand") {
						const handCount = Number(target.handCount ?? ids.length);
						readyRoom.syncObservedPlayerHandCount(seatID, handCount, { resolve: false });
					}
					if (!readyRoom.moveCards(ids, "player", {
						toSeatID: seatID,
						fromSeatID: target.fromSeatID ?? (target.fromZone == null ? seatID : void 0),
						fromZone: target.fromZone ?? null,
						fromSubZone: target.fromSubZone ?? subZone,
						subZone,
						spellID: target.spellID ?? null,
						cardCount: ids.length,
						handMoveCount: target.handMoveCount,
						sourceEvent: target.sourceEvent ?? {
							type: "revealCards",
							raw: {
								target,
								cardIDs: ids
							}
						}
					})) return;
				} else if (target.type === "popup") {
					if (!readyRoom.moveCards(ids, "popup", {
						fromZone: "popup",
						fromPopupSpaceID: target.popupSpaceID,
						toPopupSpaceID: target.popupSpaceID,
						handMoveCount: 0,
						sourceEvent: target.sourceEvent
					})) return;
				} else if (target.type === "public") {
					const zoneName = target.zoneName ?? "pile";
					const position = target.position ?? 65280;
					const knownCards = readyRoom.resolvePublicKnownCards(ids, {
						zoneName,
						position
					}, this.controllerLogger);
					readyRoom.placePublicRevealCards(knownCards, zoneName, {
						position,
						reposition: target.reposition === true,
						cardIDsTopFirst: target.cardIDsTopFirst === true
					}, this.controllerLogger);
				} else return;
				readyRoom.applyPileIdentityReveal(ids);
				readyRoom.notifyCardsRevealed(ids);
				this.controllerView.scheduleRender();
			} catch (e) {
				trackerLogger.error("明牌同步失败", e, {
					target,
					cardIDs: ids
				});
			}
		}
		dispatchSkillProtocolEvent(event) {
			const readyRoom = this.getReadyTrackerRoom();
			if (!readyRoom) return;
			try {
				const previousCardSeq = readyRoom.dirtyCardSeq;
				const moves = readyRoom.dispatchSkillProtocolEvent(event);
				for (const move of moves) this.syncTrackerMove(move.patched, move.raw);
				if (moves.length === 0 && readyRoom.dirtyCardSeq !== previousCardSeq) this.controllerView.scheduleRender();
			} catch (error) {
				trackerLogger.error("技能协议处理失败", error, event);
			}
		}
		revealTrackerCardsInZone(protocolZone, cardIDs = []) {
			const ids = this.normalizeIDs(cardIDs).filter((id) => id > 0);
			const { zone, id, spellID = null, pos } = protocolZone;
			if (zone === 8) {
				this.revealTrackerCards({
					type: "popup",
					popupSpaceID: spellID ?? id,
					sourceEvent: {
						type: "revealCards",
						label: "protocolZone.reveal",
						raw: {
							protocolZone,
							cardIDs: ids
						}
					}
				}, ids);
				return;
			}
			if (isProtocolPlayerZone(zone) && id !== 255) {
				const subZone = getProtocolPlayerSubZone(zone);
				this.revealTrackerCards({
					type: "player",
					seatID: id,
					fromSeatID: id,
					fromZone: null,
					fromSubZone: subZone,
					subZone,
					spellID,
					sourceEvent: {
						type: "revealCards",
						label: "protocolZone.reveal",
						raw: {
							protocolZone,
							cardIDs: ids
						}
					}
				}, ids);
				return;
			}
			this.revealTrackerCards({
				type: "public",
				zoneName: getProtocolPublicZone(zone, "process"),
				position: pos ?? 65280,
				reposition: zone === 1,
				cardIDsTopFirst: zone === 1 && pos == null,
				sourceEvent: {
					type: "revealCards",
					label: "protocolZone.reveal",
					raw: {
						protocolZone,
						cardIDs: ids
					}
				}
			}, ids);
		}
		normalizeIDs(cardIDs = []) {
			return typeof cardIDs === "number" ? [cardIDs] : [...cardIDs];
		}
		summarizeProtocolMove(msg) {
			return {
				CardIDs: this.normalizeIDs(msg.CardIDs),
				CardCount: msg.CardCount,
				FromZone: msg.FromZone,
				FromID: msg.FromID,
				FromZoneParam: msg.FromZoneParam,
				FromPosition: msg.FromPosition,
				ToZone: msg.ToZone,
				ToID: msg.ToID,
				ToZoneParam: msg.ToZoneParam,
				ToPosition: msg.ToPosition,
				MoveType: msg.MoveType,
				SpellID: msg.SpellID
			};
		}
		destroyTrackerRoom() {
			try {
				this.controllerView.unmount();
				if (this.trackerRoom) {
					this.trackerRoom.destroy();
					this.trackerRoom = null;
				} else this.gameState.bindRoom(null);
				this.controllerLogger.info("Room 销毁");
			} catch (e) {
				trackerLogger.error("Room 销毁失败", e);
			}
		}
	};
	var notificationQueue = [];
	var isNotificationShowing = false;
	var currentTimeout = null;
	var TOOLTIP_BG = "url('https://web.sanguosha.com/220/h5_2/res/assets/bigPng/propGet.png')";
	var TOOLTIP_STYLE = {
		position: "fixed",
		top: "20px",
		left: "50%",
		zIndex: "2147483647",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "12px 24px",
		borderRadius: "4px",
		backgroundColor: "transparent",
		backgroundImage: TOOLTIP_BG,
		backgroundSize: "100% 100%",
		fontSize: "16px",
		fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Tahoma, Arial, sans-serif",
		whiteSpace: "nowrap",
		overflow: "hidden",
		pointerEvents: "auto",
		transform: "translateX(-50%)",
		textShadow: "0 0 4px rgba(0,0,0,0.6)",
		transition: "opacity 0.3s ease, visibility 0.3s ease"
	};
	function applyTooltipStyle(el, className, visible = false) {
		Object.assign(el.style, TOOLTIP_STYLE, {
			color: "#f2de9c",
			opacity: visible ? "1" : "0",
			visibility: visible ? "visible" : "hidden"
		});
	}
	function addTooltip(text, id = "acTooltip", duration = 1e4, className = "", clickCallback = null, shouldUpdate = false) {
		if (shouldUpdate) updateOrCreateTooltip(text, id, duration, className);
		else {
			notificationQueue.push({
				text,
				id,
				duration,
				className,
				clickCallback
			});
			if (!isNotificationShowing) showNextNotification();
		}
	}
	function updateOrCreateTooltip(text, id, duration, className) {
		let element = document.getElementById(id);
		if (!element) {
			element = document.createElement("div");
			element.id = id;
			element.className = "ac-tooltip " + className;
			document.body.appendChild(element);
		}
		element.innerHTML = text;
		element.className = "ac-tooltip " + className;
		applyTooltipStyle(element, className);
		element.onclick = () => {
			removeTooltip(id);
		};
		setTimeout(() => {
			element.classList.remove("hide");
			element.classList.add("show");
			applyTooltipStyle(element, className, true);
		}, 50);
		if (currentTimeout) clearTimeout(currentTimeout);
		currentTimeout = setTimeout(() => removeTooltip(id), duration);
	}
	function showNextNotification() {
		if (notificationQueue.length === 0) {
			isNotificationShowing = false;
			return;
		}
		isNotificationShowing = true;
		const { text, id, duration, className, clickCallback } = notificationQueue.shift();
		const ele = document.getElementById(id);
		ele && ele.remove();
		const uniqueId = id + "-" + new Date().getTime();
		const div = document.createElement("div");
		div.id = uniqueId;
		div.className = "ac-tooltip " + className;
		div.innerHTML = text;
		applyTooltipStyle(div, className);
		document.body.appendChild(div);
		if (clickCallback && typeof clickCallback === "function") div.addEventListener("click", clickCallback);
		div.addEventListener("click", () => {
			removeTooltip(uniqueId);
			showNextNotification();
		});
		setTimeout(() => {
			div.classList.remove("hide");
			div.classList.add("show");
			applyTooltipStyle(div, className, true);
		}, 50);
		if (duration) setTimeout(() => {
			removeTooltip(uniqueId);
			showNextNotification();
		}, duration);
		else isNotificationShowing = false;
	}
	function removeTooltip(id) {
		const ele = document.getElementById(id);
		if (ele) {
			ele.classList.remove("show");
			ele.classList.add("hide");
			applyTooltipStyle(ele, ele.classList.contains("green") ? "green" : "", false);
			setTimeout(() => {
				ele && ele.remove();
			}, 300);
		}
	}
	var correction = [
		["10", "⒑"],
		["1", "⒈"],
		["2", "⒉"],
		["3", "⒊"],
		["4", "⒋"],
		["5", "⒌"],
		["6", "⒍"],
		["7", "⒎"],
		["8", "⒏"],
		["9", "⒐"],
		["J", "Ⓙ"],
		["Q", "Ⓠ"],
		["K", "Ⓚ"],
		["+", " "]
	];
	async function toClipboard(text, filter) {
		if (filter) correction.forEach(([from, to]) => {
			text = text.replaceAll(from, to);
		});
		try {
			await navigator.clipboard.writeText(text);
			addTooltip("复制成功！");
			return true;
		} catch (error) {
			console.info("Copy to clipboard failed.", error);
			return false;
		}
	}
	var USER_INFO_SELECTORS = ["#uuid", "#nickName"];
	function getUserInfoCopyValue(element) {
		const text = element.textContent ?? "";
		const separatorIndex = text.indexOf("：");
		return separatorIndex === -1 ? text : text.slice(separatorIndex + 1);
	}
	function copyUserInfo(value) {
		return toClipboard(value, false);
	}
	function getDefaultRoot() {
		return typeof document === "undefined" ? null : document;
	}
	function executeEmbeddedScripts(container) {
		container.querySelectorAll("script").forEach((oldScript) => {
			const newScript = document.createElement("script");
			if (oldScript.src) {
				newScript.src = oldScript.src;
				newScript.async = oldScript.async;
			} else newScript.textContent = oldScript.textContent;
			document.body.appendChild(newScript);
			oldScript.remove();
		});
	}
	function getPanelContentInner(panelContent) {
		if (!panelContent) return null;
		let inner = panelContent.querySelector(":scope > .panel-content-inner");
		if (!inner) {
			inner = panelContent.ownerDocument.createElement("div");
			inner.className = "panel-content-inner";
			while (panelContent.firstChild) inner.appendChild(panelContent.firstChild);
			panelContent.appendChild(inner);
		}
		return inner;
	}
	function bindPanelHeaders() {
		document.querySelectorAll(".panel-header").forEach((header) => {
			const panelContent = header.nextElementSibling;
			if (!panelContent?.classList?.contains("panel-content")) return;
			getPanelContentInner(panelContent);
			header.addEventListener("click", function() {
				this.classList.toggle("active");
			});
		});
	}
	function bindTabBar({ root = getDefaultRoot() } = {}) {
		if (!root) return;
		const tabBtns = root.querySelectorAll(".tab-btn");
		const tabPanels = root.querySelectorAll(".tab-panel");
		tabBtns.forEach((btn) => {
			btn.addEventListener("click", () => {
				tabBtns.forEach((b) => b.classList.remove("active"));
				tabPanels.forEach((p) => p.classList.remove("active"));
				btn.classList.add("active");
				const targetId = btn.dataset.tab;
				const target = targetId ? root.querySelector(`#${targetId}`) : null;
				if (target) target.classList.add("active");
			});
		});
	}
	function bindUserInfoCopyActions({ root = getDefaultRoot(), copy = copyUserInfo } = {}) {
		if (!root) return;
		USER_INFO_SELECTORS.forEach((selector) => {
			const element = root.querySelector(selector);
			if (!element) return;
			const handleCopy = () => {
				copy(getUserInfoCopyValue(element));
			};
			element.onclick = handleCopy;
			element.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleCopy();
				}
			};
		});
	}
	function initInjectedInterface({ container, expandJiePanel, bindDelegatedTooltips }) {
		executeEmbeddedScripts(container);
		bindPanelHeaders();
		bindTabBar({ root: container });
		bindUserInfoCopyActions({ root: container });
		expandJiePanel();
		bindDelegatedTooltips();
	}
	var TRACKER_ROOT_ID = "tracker-shell";
	var TRACKER_OVERLAY_SELECTOR = "#seatUI .shoupai, #seatUI .markedCard";
	var trackerHidden = false;
	var shortcutBound = false;
	function applyTrackerVisibility(targetDoc = document) {
		const trackerRoot = targetDoc.getElementById(TRACKER_ROOT_ID);
		if (trackerRoot) trackerRoot.style.display = trackerHidden ? "none" : "";
		targetDoc.querySelectorAll(TRACKER_OVERLAY_SELECTOR).forEach((element) => {
			if (trackerHidden) element.style.display = "none";
			else element.style.removeProperty("display");
		});
	}
	function reapplyHiddenTrackerVisibility(targetDoc = document) {
		if (!trackerHidden) return;
		applyTrackerVisibility(targetDoc);
	}
	function bindTrackerVisibilityShortcut() {
		if (shortcutBound) return;
		window.addEventListener("keydown", handleTrackerVisibilityShortcut, true);
		shortcutBound = true;
		applyTrackerVisibility();
	}
	function unbindTrackerVisibilityShortcut() {
		if (!shortcutBound) return;
		window.removeEventListener("keydown", handleTrackerVisibilityShortcut, true);
		shortcutBound = false;
		trackerHidden = false;
	}
	function handleTrackerVisibilityShortcut(event) {
		if (!(event.code === "KeyH" || event.key?.toLowerCase() === "h") || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat || event.isComposing || isEditableTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		trackerHidden = !trackerHidden;
		applyTrackerVisibility();
	}
	function isEditableTarget(target) {
		if (!(target instanceof Element)) return false;
		return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])"));
	}
	var COLOR_MAP = [
		"",
		"heart",
		"diamond",
		"spade",
		"club",
		"hongsha",
		"heisha"
	];
	function buildCardTypeButtons(room, doc, onQuery) {
		const counter = room.counter;
		const instance = CardConfig.GetInstance();
		for (const id of [
			1,
			2,
			3,
			4
		]) doc.getElementById("type" + id)?.replaceChildren();
		for (const name of Object.keys(counter.nameIndex)) {
			const ids = counter.nameIndex[name];
			if (!ids || !ids.size) continue;
			const sampleId = [...ids][0];
			const type = instance.getCard(sampleId)?.type ?? 1;
			const container = doc.getElementById("type" + type);
			if (!container) continue;
			const button = doc.createElement("button");
			button.id = name;
			button.className = "cardType";
			button.textContent = name;
			button.onclick = () => onQuery("nameIndex", name);
			container.appendChild(button);
		}
		const numberContainer = doc.getElementById("type4");
		for (let number = 0; number < counter.numberIndex.length; number++) {
			const set = counter.numberIndex[number];
			if (!set || !set.size) continue;
			if (!numberContainer) break;
			const button = doc.createElement("button");
			button.id = "number" + number;
			button.className = "cardType";
			button.textContent = number === 0 ? "闪电牌" : String(n2N(number));
			button.onclick = () => onQuery("numberIndex", number);
			numberContainer.appendChild(button);
		}
	}
	function renderStatistics(room, doc) {
		const counter = room.counter;
		const pileSet = counter.statusIndex[CARD_INSTANCE_STATUS.UNKNOWN];
		for (const name of Object.keys(counter.nameIndex)) {
			const n = countInSet(counter.nameIndex[name], pileSet);
			const lb = doc.getElementById(name);
			if (!lb) continue;
			lb.textContent = n > 1 ? n + name : name;
			lb.className = n > 0 ? "cardType active" : "cardType inactive";
		}
		for (let number = 0; number < counter.numberIndex.length; number++) {
			const set = counter.numberIndex[number];
			if (!set || !set.size) continue;
			const n = countInSet(set, pileSet);
			const lb = doc.getElementById("number" + number);
			if (!lb) continue;
			const numText = number === 0 ? "电" : String(n2N(number));
			lb.textContent = n > 1 ? `${numText}*${n}` : numText;
			lb.className = n > 0 ? "cardType active" : "cardType inactive";
		}
		for (let c = 1; c <= 6; c++) {
			const set = counter.colorIndex[c];
			if (!set) continue;
			const n = countInSet(set, pileSet);
			const lb = doc.getElementById(COLOR_MAP[c]);
			if (!lb) continue;
			lb.innerHTML = lb.innerHTML.replace(/-?\d+/, String(n));
		}
	}
	function countInSet(set, target) {
		let n = 0;
		for (const id of set) if (target.has(id)) n++;
		return n;
	}
	var STATUS_COLORS = [
		"",
		"cyan",
		"#23201d",
		"green"
	];
	var STATUS_LABELS = [
		"牌堆",
		"",
		"弃牌堆",
		"销毁"
	];
	var CARD_BUTTON_CLASS = "shoupai";
	var RED_CARD_CLASS = "red-card";
	var UNKNOWN_CARD_CLASS = "unknown-card";
	function createCardButton(doc, card, options = {}) {
		const button = doc.createElement("button");
		button.classList.add(CARD_BUTTON_CLASS);
		button.id = "card" + card.id;
		button.classList.toggle(RED_CARD_CLASS, card.color > 0 && card.color <= 2);
		button.innerHTML = getCardFaceHtml(card);
		button.title = card.getLocationDescription();
		if (options.ambiguous) {
			button.classList.add("candidate-card");
			button.setAttribute("aria-disabled", "true");
		}
		return button;
	}
	function createUnknownButton(doc, count) {
		const button = doc.createElement("button");
		button.classList.add(CARD_BUTTON_CLASS, UNKNOWN_CARD_CLASS);
		button.disabled = true;
		button.innerHTML = count > 1 ? `${count}` : "暗";
		button.title = `${count} 张暗牌`;
		return button;
	}
	function createQueryButton(doc, inst, key, room) {
		const button = doc.createElement("button");
		button.classList.add(CARD_BUTTON_CLASS);
		button.classList.toggle(RED_CARD_CLASS, inst.color > 0 && inst.color <= 2);
		button.id = "Qcard" + inst.id;
		button.innerHTML = getCardFaceHtml(inst);
		button.style.backgroundColor = STATUS_COLORS[key] ?? "";
		if (key === 1) button.title = (room?.cardIndex.get(inst.id))?.getLocationDescription() ?? "";
		else button.title = STATUS_LABELS[key] ?? "";
		return button;
	}
	function renderQueryPanel(room, doc) {
		const div = doc.getElementById("cardTypeDetail");
		if (!div) return;
		div.replaceChildren();
		const counter = room.counter;
		if (!counter.querySet || counter.querySet.size === 0) return;
		const instance = CardConfig.GetInstance();
		const grouped = CARD_INSTANCE_STATUSES.map(() => []);
		const cardInstances = counter.cardInstances;
		instance.cardIDsOrder.filter((id) => counter.querySet.has(id)).forEach((id) => {
			const inst = cardInstances[id];
			if (!inst) return;
			grouped[inst.status]?.push(inst);
		});
		grouped.forEach((insts, index) => {
			const status = CARD_INSTANCE_STATUSES[index];
			insts.forEach((inst) => {
				div.appendChild(createQueryButton(doc, inst, status, room));
			});
		});
	}
	var OVERFLOW_TOLERANCE_PX = 4;
	var tokens = new WeakMap();
	function isEllipsisHost(el) {
		if (!el || typeof el !== "object") return false;
		const obj = el;
		const cl = obj.classList;
		return typeof cl?.add === "function" && typeof cl?.remove === "function" && typeof obj.clientHeight === "number" && typeof obj.scrollHeight === "number";
	}
	function nextToken(el) {
		const t = (tokens.get(el) ?? 0) + 1;
		tokens.set(el, t);
		return t;
	}
	function checkEllipsisOverflow(el, threshold) {
		if (!isEllipsisHost(el)) return;
		const token = nextToken(el);
		requestAnimationFrame(() => {
			if (tokens.get(el) !== token) return;
			const limit = threshold ?? el.clientHeight;
			if (el.clientHeight > 0 && el.scrollHeight > limit + OVERFLOW_TOLERANCE_PX) el.classList.add("show-ellipsis");
			else el.classList.remove("show-ellipsis");
		});
	}
	function invalidateEllipsisOverflow(el) {
		if (!isEllipsisHost(el)) return;
		nextToken(el);
		el.classList.remove("show-ellipsis");
	}
	function getPileDisplayCards(cards) {
		return [...cards].reverse();
	}
	var dirtyCardCursors$1 = new WeakMap();
	var supplementalCandidateCards = new WeakMap();
	function getPublicFieldCandidateCards(room) {
		const cardsByID = new Map();
		const indexedItems = room.ambiguousKnownIndex.items;
		const indexedCards = Array.from(indexedItems.values(), ({ card }) => card).filter((card) => isAmbiguousKnownCard(card));
		const scannedCards = collectSupplementalCandidateCards(room, indexedItems);
		[...indexedCards, ...scannedCards].forEach((card) => {
			if (card.id > 0) cardsByID.set(card.id, card);
		});
		room.suspendedKnownCards.forEach((card) => {
			if (card.id > 0 && card.isKnown) cardsByID.set(card.id, card);
		});
		return Array.from(cardsByID.values());
	}
	function collectSupplementalCandidateCards(room, indexedItems) {
		const supplementalCards = getSupplementalCandidateSet(room);
		const { cards, overflowed } = consumeDirtyCardsSinceLastRender(room);
		if (overflowed) supplementalCards.clear();
		Array.from(new Set(cards)).forEach((card) => {
			if (isMissingPublicFieldCandidate(card, indexedItems)) supplementalCards.add(card);
			else supplementalCards.delete(card);
		});
		return Array.from(supplementalCards).filter((card) => {
			const active = isMissingPublicFieldCandidate(card, indexedItems);
			if (!active) supplementalCards.delete(card);
			return active;
		});
	}
	function getSupplementalCandidateSet(room) {
		let cards = supplementalCandidateCards.get(room);
		if (!cards) {
			cards = new Set();
			supplementalCandidateCards.set(room, cards);
		}
		return cards;
	}
	function consumeDirtyCardsSinceLastRender(room) {
		const lastSeq = dirtyCardCursors$1.get(room) ?? 0;
		const latestSeq = room.dirtyCardSeq;
		if (latestSeq <= lastSeq) return {
			cards: [],
			overflowed: false
		};
		dirtyCardCursors$1.set(room, latestSeq);
		const events = room.dirtyCardEvents;
		const firstEventSeq = events[0]?.seq;
		if (events.length === 0 || firstEventSeq > lastSeq + 1) return {
			cards: Array.from(room.dirtyCards),
			overflowed: true
		};
		return {
			cards: events.filter((event) => event.seq > lastSeq).map((event) => event.card),
			overflowed: false
		};
	}
	function isMissingPublicFieldCandidate(card, indexedItems) {
		return isPublicFieldCandidateCard(card) && indexedItems.get(card.id)?.card !== card;
	}
	function isPublicFieldCandidateCard(card) {
		return card.location === "player" && card.subZone === "hand" && card.isKnown && card.seats.size > 1;
	}
	var renderedMainHandCardIDs = null;
	var renderedMainHandListeners = new Set();
	function getRenderedMainHandCardIDs() {
		return renderedMainHandCardIDs?.slice() ?? null;
	}
	function subscribeRenderedMainHandCardIDs(listener) {
		renderedMainHandListeners.add(listener);
		return () => renderedMainHandListeners.delete(listener);
	}
	function clearRenderedMainHandCardIDs() {
		renderedMainHandCardIDs = null;
	}
	function updateRenderedMainHandCardIDs(cardIDs) {
		if (renderedMainHandCardIDs !== null && renderedMainHandCardIDs.length === cardIDs.length && renderedMainHandCardIDs.every((id, index) => id === cardIDs[index])) return;
		renderedMainHandCardIDs = cardIDs;
		renderedMainHandListeners.forEach((listener) => listener());
	}
	var RENDER_NODE_CLASS_NAMES = ["shoupai", "markedCard"];
	var RENDER_NODE_SELECTOR = RENDER_NODE_CLASS_NAMES.map((className) => `:scope > .${className}`).join(", ");
	var RENDER_KEY_ATTRIBUTE = "data-tracker-render-key";
	function initPlayerHandContainers(doc, room) {
		const panel = getPlayerHandPanel(doc);
		if (!panel) return;
		panel.replaceChildren();
		const playerCount = Math.max(room.size, room.players.size);
		for (let displayID = 1; displayID <= playerCount; displayID++) panel.appendChild(createPlayerHandContainer(doc, displayID));
	}
	function createPlayerHandContainer(doc, displayID) {
		const body = doc.createElement("div");
		body.className = "order-body No" + displayID;
		body.id = String(displayID);
		body.style.setProperty("--No-content", `'${getDisplayIdLabel(displayID)}号位'`);
		return body;
	}
	function syncPlayerHandContainers(doc, room) {
		const panel = getPlayerHandPanel(doc);
		if (!panel) return false;
		const playersByDisplayID = new Map();
		for (const player of room.players.values()) {
			const viewID = room.getFixedViewId(player.seatID);
			if (viewID !== void 0) playersByDisplayID.set(viewID + 1, player);
		}
		let changed = false;
		for (const container of panel.querySelectorAll(":scope > .order-body")) {
			const displayID = Number(container.id);
			const player = playersByDisplayID.get(displayID);
			const seatID = player ? String(player.seatID) : "";
			const display = player ? "" : "none";
			if (player) updateSeatLabel(doc, {
				fixedViewId: displayID,
				generals: player.generals
			}, room.game.orderLabels);
			if (container.dataset.seatId === seatID && container.style.display === display) continue;
			container.dataset.seatId = seatID;
			container.style.display = display;
			container.replaceChildren();
			changed = true;
		}
		return changed;
	}
	function updateSeatLabel(doc, player, orderLabels) {
		const fixedViewId = player.fixedViewId;
		if (fixedViewId === void 0) return;
		const container = doc.getElementById(String(fixedViewId));
		if (!container) return;
		const label = `"${formatPlayerSeatLabel(player, { orderLabels })}"`;
		if (container.style.getPropertyValue("--No-content") !== label) container.style.setProperty("--No-content", label);
	}
	function renderPlayerHand(doc, player) {
		const displayID = Number(player.fixedViewId);
		if (!Number.isFinite(displayID)) return;
		const body = getPlayerHandPanel(doc)?.querySelector(":scope > .order-body.No" + displayID);
		if (!body) return;
		const renderedNodes = [];
		for (const card of player.knownHandCards) renderedNodes.push(createHandCardNode(doc, card, "known"));
		for (const card of player.candidateHandCards) renderedNodes.push(createHandCardNode(doc, card, "candidate", true));
		const markSpell = SkillsConfig.GetInstance().markSpell;
		player.markCards.forEach((cards, spellID) => {
			if (!cards || !cards.length) return;
			renderedNodes.push(createMarkedCardNode(doc, spellID, cards, markSpell[spellID]));
		});
		reconcileRenderedNodes(body, renderedNodes);
		syncSeatOverlayHand(doc, displayID, body);
		if (Number(player.seatID) === Number(player.room.mySeatID)) updateRenderedMainHandCardIDs(player.knownHandCards.map((card) => Number(card.id)).filter((id) => id > 0));
	}
	function createHandCardNode(doc, card, kind, ambiguous = false) {
		return setRenderedNodeKey(createCardButton(doc, card, { ambiguous }), `hand:${kind}:${card.id}`);
	}
	function createMarkedCardNode(doc, spellID, cards, configuredLabel) {
		const markedCard = doc.createElement("div");
		markedCard.className = "markedCard";
		const label = configuredLabel ?? String(spellID);
		const mark = doc.createElement("span");
		mark.className = "mark";
		mark.textContent = label;
		markedCard.appendChild(mark);
		cards.forEach((card) => {
			const button = createCardButton(doc, card, { ambiguous: card.hasSubZoneCandidates() });
			markedCard.appendChild(button);
		});
		return setRenderedNodeKey(markedCard, `mark:${spellID}`);
	}
	function setRenderedNodeKey(node, key) {
		node.setAttribute(RENDER_KEY_ATTRIBUTE, key);
		return node;
	}
	function reconcileRenderedNodes(container, desiredNodes) {
		const currentNodes = getDirectRenderedNodes(container);
		const currentByKey = new Map();
		currentNodes.forEach((node) => {
			const key = node.getAttribute(RENDER_KEY_ATTRIBUTE);
			if (key && !currentByKey.has(key)) currentByKey.set(key, node);
		});
		const retainedNodes = new Set();
		const nextNodes = desiredNodes.map((desiredNode) => {
			const key = desiredNode.getAttribute(RENDER_KEY_ATTRIBUTE);
			const currentNode = key ? currentByKey.get(key) : void 0;
			if (key) currentByKey.delete(key);
			if (currentNode && hasSameRenderedContent(currentNode, desiredNode)) {
				retainedNodes.add(currentNode);
				return currentNode;
			}
			return desiredNode;
		});
		currentNodes.forEach((node) => {
			if (!retainedNodes.has(node)) node.remove();
		});
		let cursor = getDirectRenderedNodes(container)[0] ?? null;
		nextNodes.forEach((node) => {
			if (node === cursor) {
				cursor = getNextRenderedSibling(cursor);
				return;
			}
			container.insertBefore(node, cursor);
		});
	}
	function hasSameRenderedContent(current, desired) {
		if (current.tagName !== desired.tagName) return false;
		if (current.className !== desired.className) return false;
		if (current.getAttribute("id") !== desired.getAttribute("id")) return false;
		if (current.getAttribute("title") !== desired.getAttribute("title")) return false;
		if (current.getAttribute("aria-disabled") !== desired.getAttribute("aria-disabled")) return false;
		const currentChildren = Array.from(current.children);
		const desiredChildren = Array.from(desired.children);
		if (currentChildren.length !== desiredChildren.length) return false;
		if (currentChildren.length === 0) return current.innerHTML === desired.innerHTML && current.textContent === desired.textContent;
		return currentChildren.every((child, index) => hasSameRenderedContent(child, desiredChildren[index]));
	}
	function getDirectRenderedNodes(container) {
		return Array.from(container.querySelectorAll(RENDER_NODE_SELECTOR));
	}
	function getNextRenderedSibling(node) {
		let sibling = node.nextElementSibling;
		while (sibling && !isRenderedNode(sibling)) sibling = sibling.nextElementSibling;
		return sibling;
	}
	function isRenderedNode(node) {
		return RENDER_NODE_CLASS_NAMES.some((className) => node.classList.contains(className));
	}
	function getPlayerHandPanel(doc) {
		return getPanelContentInner(doc.getElementById("button"));
	}
	function renderPublicZones(room, doc) {
		const publicByZone = room.locationIndex.publicByZone;
		renderCardList(doc, "paiduiCards", getPileDisplayCards(publicByZone.get("pile") ?? room.getZone("pile").cards));
		renderCardList(doc, "qipaiCards", (publicByZone.get("discard") ?? room.getZone("discard").cards).filter((card) => card.turn === Game.turn && card.round === Game.round));
		renderCardList(doc, "knownCards", getPublicFieldCandidateCards(room), { ambiguous: true });
	}
	function renderCardList(doc, containerId, cards, options = { ambiguous: false }) {
		const container = doc.getElementById(containerId);
		if (!container) return;
		container.querySelectorAll(RENDER_NODE_SELECTOR).forEach((e) => e.remove());
		let i = 0;
		while (i < cards.length) {
			const card = cards[i];
			if (card.isKnown) {
				container.appendChild(createCardButton(doc, card, { ambiguous: options.ambiguous }));
				i++;
			} else {
				let run = 1;
				while (i + run < cards.length && !cards[i + run].isKnown) run++;
				container.appendChild(createUnknownButton(doc, run));
				i += run;
			}
		}
	}
	function syncSeatOverlayHand(doc, displayID, body) {
		const target = doc.querySelector("#seatUI #s" + displayID);
		if (!target) return;
		reconcileRenderedNodes(target, getDirectRenderedNodes(body).map((node) => cloneRenderedNode(node)));
		checkSeatOverlayOverflow(target);
	}
	function clearSeatOverlayCards(orderBody) {
		invalidateEllipsisOverflow(orderBody);
		orderBody.querySelectorAll(RENDER_NODE_SELECTOR).forEach((e) => e.remove());
	}
	function cloneRenderedNode(node) {
		const clone = node.cloneNode(true);
		clone.removeAttribute("id");
		clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
		return clone;
	}
	function checkSeatOverlayOverflow(orderBody) {
		checkEllipsisOverflow(orderBody);
	}
	var dirtyCardCursors = new WeakMap();
	var forceFullPlayerRenderRooms = new WeakSet();
	function markFullPlayerRender(room) {
		forceFullPlayerRenderRooms.add(room);
	}
	function collectDirtyRenderState(room) {
		const lastSeq = dirtyCardCursors.get(room) ?? 0;
		const latestSeq = room.dirtyCardSeq;
		const forcedFullRender = forceFullPlayerRenderRooms.has(room);
		let events = [];
		let overflowed = false;
		if (latestSeq > lastSeq) {
			const firstEventSeq = room.dirtyCardEvents[0]?.seq;
			if (room.dirtyCardEvents.length === 0 || firstEventSeq > lastSeq + 1) overflowed = true;
			else events = room.dirtyCardEvents.filter((event) => event.seq > lastSeq);
		}
		const affectedSeatIDs = new Set();
		events.forEach((event) => {
			collectAffectedSeatsFromDetail(event.detail, affectedSeatIDs);
			collectAffectedSeatsFromCard(event.card, affectedSeatIDs);
		});
		const hasCardChanges = latestSeq > lastSeq;
		return {
			shouldRenderPanels: room.viewDirty || hasCardChanges,
			shouldRenderAllPlayers: forcedFullRender || overflowed,
			affectedSeatIDs,
			consumedEventCount: events.length,
			overflowed,
			latestSeq
		};
	}
	function finishDirtyRender(room, renderState) {
		dirtyCardCursors.set(room, renderState?.latestSeq ?? room.dirtyCardSeq);
		forceFullPlayerRenderRooms.delete(room);
		room.viewDirty = false;
	}
	var keys = [
		"previousResolvedSeat",
		"nextResolvedSeat",
		"previousOwner",
		"nextOwner",
		"seatID",
		"fromSeatID"
	];
	function collectAffectedSeatsFromDetail(detail, affectedSeatIDs) {
		if (!detail) return;
		keys.forEach((key) => addSeat(detail[key], affectedSeatIDs));
		if (Array.isArray(detail.previousSeats)) detail.previousSeats.forEach((seatID) => addSeat(seatID, affectedSeatIDs));
	}
	function collectAffectedSeatsFromCard(card, affectedSeatIDs) {
		addSeat(card.owner, affectedSeatIDs);
		addSeat(card.resolvedSeat, affectedSeatIDs);
		card.seats.forEach((seatID) => addSeat(seatID, affectedSeatIDs));
		card.subZoneCandidates.forEach((candidate) => addSeat(candidate.seatID, affectedSeatIDs));
		card.locationCandidates.forEach((candidate) => {
			if (candidate.type === "player") addSeat(candidate.seatID, affectedSeatIDs);
		});
	}
	function addSeat(value, affectedSeatIDs) {
		if (typeof value !== "number" || !Number.isFinite(value) || value === 255) return;
		affectedSeatIDs.add(value);
	}
	var view_exports = __exportAll({
		mount: () => mount,
		reset: () => reset,
		scheduleRender: () => scheduleRender,
		setQuery: () => setQuery,
		unmount: () => unmount
	});
	var currentRoom = null;
	var doc = null;
	var rafScheduled$1 = false;
	var seatOverlayLayoutBound = false;
	function mount(room) {
		if (!room) {
			doUnmount();
			return;
		}
		const isNewRoom = currentRoom !== room || !doc;
		if (isNewRoom) {
			doUnmount();
			currentRoom = room;
			doc = document;
			clearRenderedContent(doc);
		}
		if (!currentRoom || !doc) return;
		if (isNewRoom || !currentRoom.isDeckReady) initPlayerHandContainers(doc, currentRoom);
		syncPlayerHandContainers(doc, currentRoom);
		syncTrackerVisibility(doc);
		if (!currentRoom.isDeckReady) return;
		buildCardTypeButtons(currentRoom, doc, setQuery);
		currentRoom.markViewDirty("tracker-view-mount");
		markFullPlayerRender(currentRoom);
		bindSeatOverlayLayout();
		scheduleRender();
	}
	function unmount() {
		doUnmount();
	}
	function doUnmount() {
		if (doc) clearRenderedContent(doc);
		clearRenderedMainHandCardIDs();
		doc = null;
		currentRoom = null;
		rafScheduled$1 = false;
	}
	function scheduleRender() {
		if (!currentRoom || !doc) return;
		if (rafScheduled$1) return;
		rafScheduled$1 = true;
		requestAnimationFrame(() => {
			rafScheduled$1 = false;
			flushRender();
		});
	}
	function flushRender() {
		if (!currentRoom || !doc) return;
		if (syncPlayerHandContainers(doc, currentRoom)) markFullPlayerRender(currentRoom);
		if (!currentRoom.isDeckReady) return;
		const renderState = collectDirtyRenderState(currentRoom);
		if (!renderState.shouldRenderPanels && !renderState.shouldRenderAllPlayers && renderState.affectedSeatIDs.size === 0) return;
		if (renderState.shouldRenderPanels) {
			renderStatistics(currentRoom, doc);
			renderPublicZones(currentRoom, doc);
		}
		const shouldRenderPlayerHands = renderState.shouldRenderAllPlayers || renderState.affectedSeatIDs.size > 0;
		const playerOrderResolved = hasResolvedPlayerOrder(currentRoom);
		const players = getPlayersForRender(currentRoom, renderState);
		for (const player of players) renderPlayerHand(doc, player);
		if (renderState.shouldRenderPanels) renderQueryPanel(currentRoom, doc);
		syncTrackerVisibility(doc);
		if (shouldRenderPlayerHands && !playerOrderResolved) return;
		finishDirtyRender(currentRoom, renderState);
	}
	function setQuery(dimension, key) {
		if (!currentRoom?.isDeckReady || !doc) return;
		currentRoom.counter.query(dimension, key);
		renderQueryPanel(currentRoom, doc);
	}
	function reset() {
		if (!doc || !currentRoom) return;
		clearRenderedContent(doc);
		initPlayerHandContainers(doc, currentRoom);
		syncPlayerHandContainers(doc, currentRoom);
		if (!currentRoom.isDeckReady) return;
		buildCardTypeButtons(currentRoom, doc, setQuery);
		currentRoom.markViewDirty("tracker-view-reset");
		markFullPlayerRender(currentRoom);
		scheduleRender();
	}
	function clearRenderedContent(targetDoc) {
		for (const id of [
			"type1",
			"type2",
			"type3",
			"type4"
		]) targetDoc.getElementById(id)?.replaceChildren();
		getPanelContentInner(targetDoc.getElementById("button"))?.replaceChildren();
		for (const id of [
			"paiduiCards",
			"qipaiCards",
			"knownCards",
			"cardTypeDetail"
		]) targetDoc.getElementById(id)?.replaceChildren();
		targetDoc.querySelectorAll("#seatUI .sorder-body").forEach((element) => {
			if (element instanceof HTMLElement) clearSeatOverlayCards(element);
		});
	}
	function bindSeatOverlayLayout() {
		if (seatOverlayLayoutBound) return;
		seatOverlayLayoutBound = true;
		window.addEventListener("dxc-seat-overlay-layout", () => {
			if (currentRoom) {
				currentRoom.markViewDirty("seat-overlay-layout");
				markFullPlayerRender(currentRoom);
			}
			scheduleRender();
		});
	}
	function getPlayersForRender(room, renderState) {
		if (!hasResolvedPlayerOrder(room)) return [];
		if (renderState.shouldRenderAllPlayers) return getOrderedPlayers(room);
		return getOrderedPlayers(room).filter((player) => renderState.affectedSeatIDs.has(player.seatID));
	}
	function getOrderedPlayers(room) {
		return Array.from(room.players.values()).filter((player) => player.isShown).sort((a, b) => {
			return (a.fixedViewId ?? Number.MAX_SAFE_INTEGER) - (b.fixedViewId ?? Number.MAX_SAFE_INTEGER);
		});
	}
	function hasResolvedPlayerOrder(room) {
		if (room.firstID === void 0 || room.firstID === null) return false;
		return Array.from(room.players.values()).every((player) => !player.isShown || Number.isFinite(player.fixedViewId));
	}
	function syncTrackerVisibility(targetDoc) {
		reapplyHiddenTrackerVisibility(targetDoc);
		const content = targetDoc.getElementById("button");
		getPanelContentInner(content);
		content?.style.removeProperty("max-height");
	}
	var readSeatUIs = () => {};
	function setTrackerSeatUIReader(reader) {
		readSeatUIs = reader;
	}
	Game.setGeneralChangeListener((player, orderLabels) => {
		if (typeof document === "undefined") return;
		updateSeatLabel(document, player, orderLabels);
	});
	var tracker = new TrackerController({
		view: view_exports,
		gameState: Game,
		getSeatUIs: () => readSeatUIs(),
		logger: trackerLogger
	});
	function addDragHint() {
		var sidebarHint = document.createElement("div");
		sidebarHint.id = "sidebarHint";
		sidebarHint.innerText = "拖到这里变为变为侧边栏，再次拖动取消侧边栏";
		document.body.appendChild(sidebarHint);
	}
	function getLayoutViewportWidth() {
		return document.documentElement.clientWidth || window.innerWidth;
	}
	function initDragElement(globalConfig, globalState, refreshSidebarViewport) {
		let mousePressed = false;
		document.addEventListener("mousedown", function(e) {
			if (!mousePressed) {
				mousePressed = true;
				const clickedSorderBody = e.target.closest(".sorder-body");
				if (clickedSorderBody) {
					document.body.classList.add("mouse-pressed");
					e.preventDefault();
					e.stopImmediatePropagation();
					setTimeout(() => {
						const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
						if (elementBelow && elementBelow !== clickedSorderBody) elementBelow.dispatchEvent(new MouseEvent("mousedown", {
							bubbles: true,
							cancelable: true,
							clientX: e.clientX,
							clientY: e.clientY,
							button: e.button,
							buttons: e.buttons
						}));
					}, 0);
				} else document.body.classList.add("mouse-pressed");
			}
		}, true);
		document.addEventListener("mouseup", () => {
			if (mousePressed) {
				mousePressed = false;
				document.body.classList.remove("mouse-pressed");
			}
		});
		const draggable = document.getElementById("header");
		const container = document.getElementById("tracker-shell");
		const sidebarHint = document.getElementById("sidebarHint");
		let isDragging = false;
		let startX = 0, startY = 0;
		let translateX = 0, translateY = 0;
		let pendingFrame = false;
		const startDrag = (e) => {
			draggable.style.cursor = "grabbing";
			isDragging = true;
			startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
			startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
			container.style.userSelect = "none";
			container.style.willChange = "transform";
			document.addEventListener("mousemove", onDrag);
			document.addEventListener("mouseup", stopDrag);
			document.addEventListener("touchmove", onDrag);
			document.addEventListener("touchend", stopDrag);
		};
		draggable.addEventListener("mousedown", startDrag);
		draggable.addEventListener("touchstart", startDrag);
		function onDrag(e) {
			if (!isDragging) return;
			sidebarHint.style.display = "flex";
			const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? startX;
			const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? startY;
			const deltaX = clientX - startX;
			const deltaY = clientY - startY;
			const rect = container.getBoundingClientRect();
			const left0 = rect.left - translateX;
			const top0 = rect.top - translateY;
			const width = rect.width || 230;
			const viewportWidth = getLayoutViewportWidth();
			translateX += deltaX;
			translateY += deltaY;
			const minX = -left0;
			const maxX = viewportWidth - width - left0;
			const minY = -top0;
			const maxY = window.innerHeight - 30 - top0;
			translateX = Math.max(minX, Math.min(maxX, translateX));
			translateY = Math.max(minY, Math.min(maxY, translateY));
			if (globalConfig.padding) {
				globalConfig.padding = 0;
				container.style.height = "500px";
				refreshSidebarViewport();
			}
			if (!pendingFrame) {
				pendingFrame = true;
				requestAnimationFrame(() => {
					container.style.transform = `translate(${translateX}px, ${translateY}px)`;
					pendingFrame = false;
				});
			}
			if (viewportWidth - clientX < 25) sidebarHint.style.backgroundColor = "rgba(55, 40, 32, 1)";
			else sidebarHint.style.backgroundColor = "rgba(55, 40, 32, 0.8)";
			startX = clientX;
			startY = clientY;
		}
		function stopDrag(e) {
			sidebarHint.style.display = "none";
			draggable.style.cursor = "grab";
			isDragging = false;
			document.removeEventListener("mousemove", onDrag);
			document.removeEventListener("mouseup", stopDrag);
			document.removeEventListener("touchmove", onDrag);
			document.removeEventListener("touchend", stopDrag);
			container.style.willChange = "auto";
			const finalClientX = e.clientX ?? e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? startX;
			if (getLayoutViewportWidth() - finalClientX < 25 && draggable.id === "header") {
				if (!globalConfig.padding) {
					if (globalState.closeIframe) document.getElementById("toggle-me").click();
					globalConfig.padding = 232;
					refreshSidebarViewport();
					translateX = 0;
					translateY = 0;
					container.style.transform = `translate(${translateX}px, ${translateY}px)`;
				}
			}
		}
	}
	var windowStates = new Map();
	function createDraggableWindow({ id, styleId, styleText, markup, handleSelector }) {
		ensureStyle$1(styleId, `${getShellStyle(id)}${styleText}`);
		const element = document.createElement("section");
		element.id = id;
		element.innerHTML = markup;
		document.body.appendChild(element);
		const state = windowStates.get(id) || {
			lastPosition: null,
			cleanupDrag: null,
			cleanupPosition: null
		};
		windowStates.set(id, state);
		restorePosition(element, state);
		bindDrag(element, element.querySelector(handleSelector), state);
		bindPositionCorrection(element, state);
		return element;
	}
	function destroyDraggableWindow(id) {
		const state = windowStates.get(id);
		state?.cleanupDrag?.();
		state?.cleanupPosition?.();
		document.getElementById(id)?.remove();
	}
	function setDraggableWindowVisible(id, visible) {
		const element = document.getElementById(id);
		if (!element) return;
		element.style.display = visible ? "" : "none";
		const state = windowStates.get(id);
		if (visible && state) correctPosition(element, state);
	}
	function ensureStyle$1(styleId, styleText) {
		if (document.getElementById(styleId)) return;
		const style = document.createElement("style");
		style.id = styleId;
		style.textContent = styleText;
		document.head.appendChild(style);
	}
	function getShellStyle(id) {
		return `
    #${id} {
      position: fixed;
      right: 20px;
      z-index: 10000000020;
      box-sizing: border-box;
      padding: 0 6px 6px;
      color: #f4ead8;
      background: #292724;
      border: 1px solid #7b292d;
      box-shadow: 0 7px 18px rgba(0, 0, 0, 0.42);
      font-family: "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    #${id} * { box-sizing: border-box; }
    #${id} .draggable-window-header {
      height: 22px;
      margin: 0 -6px;
      padding: 0 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #7b292d;
      cursor: grab;
    }
    #${id}.is-dragging .draggable-window-header { cursor: grabbing; }
    #${id} .draggable-window-title {
      overflow: hidden;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
	}
	function bindDrag(element, handle, state) {
		state.cleanupDrag?.();
		let pointerId = null;
		let offsetX = 0;
		let offsetY = 0;
		const move = (event) => {
			if (event.pointerId !== pointerId) return;
			state.lastPosition = setPosition(element, event.clientX - offsetX, event.clientY - offsetY);
		};
		const stop = (event) => {
			if (event.pointerId !== pointerId) return;
			pointerId = null;
			element.classList.remove("is-dragging");
			handle.releasePointerCapture?.(event.pointerId);
		};
		const start = (event) => {
			if (event.button !== 0) return;
			const rect = element.getBoundingClientRect();
			pointerId = event.pointerId;
			offsetX = event.clientX - rect.left;
			offsetY = event.clientY - rect.top;
			element.classList.add("is-dragging");
			handle.setPointerCapture?.(pointerId);
		};
		handle.addEventListener("pointerdown", start);
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", stop);
		handle.addEventListener("pointercancel", stop);
		state.cleanupDrag = () => {
			handle.removeEventListener("pointerdown", start);
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", stop);
			handle.removeEventListener("pointercancel", stop);
			state.cleanupDrag = null;
		};
	}
	function bindPositionCorrection(element, state) {
		state.cleanupPosition?.();
		const correct = () => correctPosition(element, state);
		const observer = new ResizeObserver(correct);
		observer.observe(element, { box: "border-box" });
		window.addEventListener("resize", correct);
		correct();
		state.cleanupPosition = () => {
			observer.disconnect();
			window.removeEventListener("resize", correct);
			state.cleanupPosition = null;
		};
	}
	function correctPosition(element, state) {
		if (!element.getClientRects().length) return;
		const { left, top } = element.getBoundingClientRect();
		const position = clampPosition(element, left, top);
		if (position.left === left && position.top === top) return;
		state.lastPosition = setPosition(element, position.left, position.top);
	}
	function restorePosition(element, state) {
		if (!state.lastPosition) return;
		state.lastPosition = setPosition(element, state.lastPosition.left, state.lastPosition.top);
	}
	function setPosition(element, left, top) {
		const position = clampPosition(element, left, top);
		element.style.left = `${position.left}px`;
		element.style.top = `${position.top}px`;
		element.style.right = "auto";
		return position;
	}
	function clampPosition(element, left, top) {
		return {
			left: Math.min(Math.max(0, getLayoutViewportWidth() - element.offsetWidth), Math.max(0, left)),
			top: Math.min(Math.max(0, window.innerHeight - element.offsetHeight), Math.max(0, top))
		};
	}
	var WINDOW_ID$1 = "pingjian-window";
	var STYLE_ID$2 = "pingjian-style";
	function createWindow$1() {
		return createDraggableWindow({
			id: WINDOW_ID$1,
			styleId: STYLE_ID$2,
			styleText: `
    #${WINDOW_ID$1} {
      top: 60px;
      min-width: 140px;
    }
    #${WINDOW_ID$1} .pingjian-title {
      font-size: 16px;
    }
    #${WINDOW_ID$1} .pingjian-list {
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${WINDOW_ID$1} .pingjian-item {
      padding: 3px 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(242, 208, 107, 0.2);
      border-radius: 2px;
      font-size: 16px;
      color: #f2d06b;
      white-space: nowrap;
      text-align: center;
    }
  `,
			markup: `
    <header class="draggable-window-header pingjian-header">
      <div class="draggable-window-title pingjian-title">评鉴</div>
    </header>
    <ul class="pingjian-list"></ul>
  `,
			handleSelector: ".pingjian-header"
		});
	}
	function renderPingJianWindow(names) {
		if (!Array.isArray(names) || !names.length) return false;
		const list = (document.getElementById(WINDOW_ID$1) || createWindow$1()).querySelector(".pingjian-list");
		if (!list) return false;
		const items = names.map((name) => {
			const li = document.createElement("li");
			li.className = "pingjian-item";
			li.textContent = name;
			return li;
		});
		list.replaceChildren(...items);
		return true;
	}
	function destroyPingJianWindow() {
		destroyDraggableWindow(WINDOW_ID$1);
	}
	var PROTOCOL_PILE_ZONE = 1;
	var PROTOCOL_HAND_ZONE = 5;
	function revealCardsInProtocolZone(id, cardIDs, zone = PROTOCOL_HAND_ZONE, pos = void 0) {
		tracker.revealTrackerCardsInZone({
			id,
			zone,
			pos
		}, cardIDs);
	}
	function handleResultType({ Type }) {
		switch (Type) {
			case 44: break;
			case 45: break;
			default: break;
		}
	}
	function handleRoleSpellOptRep(msg = {}) {
		const { Datas, SeatID, SpellID, Type } = msg;
		handleResultType(msg);
		tracker.dispatchSkillProtocolEvent({
			type: "choice",
			message: msg
		});
		switch (SpellID) {
			case 2022:
				Game.setGeneral(SeatID, Datas[0], Datas[1], true);
				break;
			case 3659:
				revealCardsInProtocolZone(SeatID, Datas);
				break;
			case 3744:
				if (Type !== 73) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE);
				break;
			case 3868:
				if (Type === 50) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE);
				break;
			case 7009:
				if (Type === 30 && Array.isArray(Datas) && Datas.length > 0) revealCardsInProtocolZone(255, Datas, PROTOCOL_PILE_ZONE);
				break;
			case 3336:
				if (Type === 50 && Array.isArray(Datas)) revealCardsInProtocolZone(255, [...Datas].reverse(), PROTOCOL_PILE_ZONE, 0);
				break;
			case 3571: break;
			case 3911:
				if (Type !== 82 || SeatID !== Game.myID) break;
				if (Array.isArray(Datas) && Datas.length === 0) {
					destroyPingJianWindow();
					Game.deleteSpellState(3911);
				}
				if (Array.isArray(Datas) && Datas.length > 0) {
					const storedParams = Game.getSpellState(3911);
					if (Array.isArray(storedParams) && storedParams.length > 0) {
						const successCount = Number(Datas[0]) || 0;
						const successData = Datas.slice(1, 1 + successCount * 4);
						const helpCount = Number(storedParams[0]) || 0;
						const helpData = storedParams.slice(1, 1 + helpCount * 4);
						const nextDatas = [
							successCount,
							...successData,
							helpCount,
							...helpData,
							0
						];
						Datas.splice(0, Datas.length, ...nextDatas);
						msg.Datas = Datas;
					}
				}
				break;
			default: break;
		}
	}
	var PEIXIU_DIRECTIONS = {
		1: {
			name: "红桃",
			shortDirection: "左",
			mark: "♥",
			dx: -1,
			dy: 0
		},
		2: {
			name: "方块",
			shortDirection: "上",
			mark: "♦",
			dx: 0,
			dy: -1
		},
		3: {
			name: "黑桃",
			shortDirection: "右",
			mark: "♠",
			dx: 1,
			dy: 0
		},
		4: {
			name: "梅花",
			shortDirection: "下",
			mark: "♣",
			dx: 0,
			dy: 1
		}
	};
	var DIR = PEIXIU_DIRECTIONS;
	var DIRECTIONS = [
		1,
		2,
		3,
		4
	];
	function nums(text) {
		if (Array.isArray(text)) return text.map(Number).filter(Number.isFinite);
		return String(text || "").split(",").map((n) => Number(n.trim())).filter(Number.isFinite);
	}
	function firstField(raw, ...keys) {
		for (const key of keys) if (raw && raw[key] !== void 0 && raw[key] !== null) return raw[key];
	}
	function field(raw, lower, upper, fallback = 0) {
		return firstField(raw, lower, upper) ?? fallback;
	}
	function normalizeCell(cell) {
		const n = Number(cell) || 0;
		if (n <= 25) return n;
		const row = Math.floor(n / 10);
		const col = n % 10;
		return row >= 1 && row <= 5 && col >= 1 && col <= 5 ? (row - 1) * 5 + col : n;
	}
	function pos(cell) {
		const n = normalizeCell(cell);
		return {
			row: Math.floor((n - 1) / 5),
			col: (n - 1) % 5
		};
	}
	function cellAt(row, col) {
		if (row < 0 || row >= 5 || col < 0 || col >= 5) return 0;
		return row * 5 + col + 1;
	}
	function validCell(cell) {
		return cell >= 1 && cell <= 25;
	}
	function parseCells(value) {
		return nums(value).map(normalizeCell).filter(validCell);
	}
	function parseSpecialCells(value) {
		return (Array.isArray(value) ? value : String(value || "").split("|").filter(Boolean)).map((item) => {
			if (!Array.isArray(item) && typeof item == "object") return {
				cell: field(item, "cell", "CellID"),
				effect: field(item, "effect", "EffectID"),
				param1: field(item, "param1", "Param1"),
				param2: field(item, "param2", "Param2")
			};
			const [cell, effect, param1 = 0, param2 = 0] = nums(item);
			return {
				cell,
				effect,
				param1,
				param2
			};
		});
	}
	function parseRewards(value) {
		return (Array.isArray(value) ? value : String(value || "").split("|").filter(Boolean)).map((item) => {
			if (!Array.isArray(item) && typeof item == "object") {
				const cell = field(item, "cell", "CellID");
				return {
					cell: normalizeCell(cell),
					rawCell: Number(cell),
					rewardId: field(item, "rewardId", "RewardID")
				};
			}
			const [cell, rewardId] = nums(item);
			return {
				cell: normalizeCell(cell),
				rawCell: Number(cell),
				rewardId
			};
		});
	}
	function parsePeiXiuMap(raw) {
		const cells = new Set(parseCells(firstField(raw, "cell", "Cells", "cells")));
		const specials = new Map();
		parseSpecialCells(firstField(raw, "spcell", "SpecialCells", "specialCells")).forEach((item) => {
			const id = normalizeCell(item.cell);
			if (validCell(id)) specials.set(id, {
				cell: id,
				effect: Number(item.effect) || 0,
				param1: Number(item.param1) || 0,
				param2: Number(item.param2) || 0
			});
		});
		const rewards = parseRewards(firstField(raw, "reward", "RewardCells", "rewardCells"));
		const mapReward = rewards.find((reward) => reward.rawCell === 26) || null;
		const rewardCells = rewards.filter((reward) => reward.rawCell !== 26 && validCell(reward.cell) && cells.has(reward.cell)).map((r) => r.cell);
		return {
			id: firstField(raw, "cellID", "CellID", "id", "mapId") || 0,
			name: raw?.name || "",
			cells,
			start: normalizeCell(firstField(raw, "precell", "PreCell", "start") || 0),
			specials,
			rewards,
			mapReward,
			rewardCells: [...new Set(rewardCells)].sort((a, b) => a - b),
			color: Number(firstField(raw, "color", "Color")) || 0,
			bigMapPos: firstField(raw, "bigMapPos", "bigmappos", "BigMapPos") || ""
		};
	}
	function orderedLineCells(from, dir, cells) {
		const p = pos(from);
		const step = DIR[dir];
		const list = [];
		if (!step) return list;
		for (let i = 1; i <= 4; i += 1) {
			const next = cellAt(p.row + step.dy * i, p.col + step.dx * i);
			if (!next || !cells.has(next)) break;
			list.push(next);
		}
		return list;
	}
	function forcedMove(from, special, map) {
		const dir = DIR[special.param1];
		const steps = Number(special.param2) || 0;
		if (!dir || steps <= 0) return null;
		const start = pos(from);
		const path = [];
		let end = from;
		for (let i = 1; i <= steps; i += 1) {
			const next = cellAt(start.row + dir.dy * i, start.col + dir.dx * i);
			if (!next) break;
			if (!map.cells.has(next)) break;
			path.push(next);
			end = next;
		}
		return {
			dir: special.param1,
			steps,
			path,
			end
		};
	}
	function rewardIndexMap(map) {
		const index = new Map();
		map.rewardCells.forEach((cell, i) => index.set(cell, i));
		return index;
	}
	function collectMask(cells, index) {
		let mask = 0;
		for (const cell of cells) {
			const i = index.get(cell);
			if (i !== void 0) mask |= 1 << i;
		}
		return mask;
	}
	function applySpecials(startPos, index, startMask, map) {
		let current = startPos;
		let mask = startMask;
		const specialMoves = [];
		const seen = new Set();
		while (map.specials.get(current)?.effect === 3 && !seen.has(current)) {
			seen.add(current);
			const special = map.specials.get(current);
			const forced = forcedMove(current, special, map);
			if (!forced || forced.end === current) break;
			mask |= collectMask(forced.path, index);
			specialMoves.push({
				from: current,
				to: forced.end,
				dir: forced.dir,
				steps: forced.steps,
				path: forced.path
			});
			current = forced.end;
		}
		return {
			pos: current,
			mask,
			specialMoves
		};
	}
	function buildTransition(from, dir, map, index) {
		const line = orderedLineCells(from, dir, map.cells);
		if (!line.length) return null;
		const specialResult = applySpecials(line[line.length - 1], index, collectMask(line, index), map);
		return {
			pos: specialResult.pos,
			mask: specialResult.mask,
			step: {
				dir,
				from,
				to: specialResult.pos,
				line,
				specialMoves: specialResult.specialMoves
			}
		};
	}
	function buildTransitionTable(map, index) {
		const table = new Map();
		const positions = new Set(map.cells);
		positions.add(map.start);
		for (const from of positions) {
			const transitions = [];
			for (const dir of DIRECTIONS) {
				const next = buildTransition(from, dir, map, index);
				if (next) transitions.push(next);
			}
			if (transitions.length) table.set(from, transitions);
		}
		return table;
	}
	function betterRoute(state, best) {
		return state.count > best.count || state.count === best.count && state.depth < best.depth;
	}
	function buildSolution(state) {
		const path = [];
		for (let current = state; current?.parent; current = current.parent) path.push(current.step);
		path.reverse();
		return {
			pos: state.pos,
			mask: state.mask,
			path
		};
	}
	function solvePeiXiuMap(raw, options = {}) {
		const map = parsePeiXiuMap(raw);
		const startCell = normalizeCell(options.startCell ?? map.start);
		if (!validCell(startCell) || !map.cells.has(startCell)) throw new RangeError(`裴秀地图起始格无效: ${startCell}`);
		map.start = startCell;
		const index = rewardIndexMap(map);
		const target = map.rewardCells.length ? (1 << map.rewardCells.length) - 1 : 0;
		const collectedCells = Array.isArray(options.collectedCells) ? options.collectedCells.map(normalizeCell) : [];
		const startMask = options.collectStart === false ? collectMask(collectedCells, index) : collectMask([map.start].concat(collectedCells), index);
		const start = {
			pos: map.start,
			mask: startMask,
			count: bitCount(startMask),
			depth: 0,
			parent: null,
			step: null
		};
		const queue = [start];
		const seen = new Set([`${start.pos}:${start.mask}`]);
		const transitions = buildTransitionTable(map, index);
		let best = start;
		for (let head = 0; head < queue.length; head += 1) {
			const state = queue[head];
			if (state.mask === target) return {
				map,
				solution: buildSolution(state),
				complete: true
			};
			if (betterRoute(state, best)) best = state;
			for (const next of transitions.get(state.pos) || []) {
				const mask = state.mask | next.mask;
				const key = `${next.pos}:${mask}`;
				if (seen.has(key)) continue;
				seen.add(key);
				queue.push({
					pos: next.pos,
					mask,
					count: bitCount(mask),
					depth: state.depth + 1,
					parent: state,
					step: {
						...next.step,
						gainedMask: mask & ~state.mask
					}
				});
			}
		}
		return {
			map,
			solution: buildSolution(best),
			complete: false
		};
	}
	function parsePeiXiuRoleData(datas) {
		if (!Array.isArray(datas) || datas.length < 4) return null;
		const mapId = Number(datas[0]);
		const currentCell = normalizeCell(datas[1]);
		const historyCount = Number(datas[2]);
		if (!Number.isInteger(mapId) || !validCell(currentCell) || !Number.isInteger(historyCount) || historyCount < 0) return null;
		const historyCells = datas.slice(3, 3 + historyCount).map(normalizeCell);
		if (historyCells.length !== historyCount || historyCells.some((cell) => !validCell(cell))) return null;
		if (datas[3 + historyCount] !== 0) return null;
		return {
			mapId,
			currentCell,
			historyCount,
			historyCells
		};
	}
	function solvePeiXiuRoleData(raw, datas) {
		const roleData = parsePeiXiuRoleData(datas);
		if (!roleData) return null;
		const map = parsePeiXiuMap(raw);
		if (Number(map.id) !== roleData.mapId || !map.cells.has(roleData.currentCell)) return null;
		return {
			...roleData,
			result: solvePeiXiuMap(raw, {
				startCell: roleData.currentCell,
				collectedCells: roleData.historyCells
			})
		};
	}
	function bitCount(n) {
		let count = 0;
		while (n) {
			n &= n - 1;
			count += 1;
		}
		return count;
	}
	var WINDOW_ID = "peixiu-map-window";
	var STYLE_ID$1 = "peixiu-map-style";
	var CELL_SIZE = 50;
	var SUIT_ORDER = [
		3,
		4,
		1,
		2
	];
	function getRewardInfo(reward, bonuses) {
		if (!reward) return null;
		const config = bonuses?.get(Number(reward.rewardId));
		return {
			id: Number(reward.rewardId),
			name: config?.name || `奖励 ${reward.rewardId}`,
			desc: config?.desc || ""
		};
	}
	function getRouteCells(solution) {
		const cells = new Set();
		for (const step of solution?.path || []) {
			for (const cell of step.line || []) cells.add(cell);
			for (const move of step.specialMoves || []) for (const cell of move.path || []) cells.add(cell);
		}
		return cells;
	}
	function formatRoute(solution, emptyText = "已完成") {
		const path = Array.isArray(solution) ? solution : solution?.path || [];
		if (!path.length) return emptyText;
		return path.map((step) => {
			const direction = typeof step === "number" ? step : step.dir;
			const mark = PEIXIU_DIRECTIONS[direction]?.mark || direction;
			return typeof step === "number" ? mark : `${mark}${step.to}`;
		}).join(" → ");
	}
	function setSuitText(element, text, prefix = "") {
		element.replaceChildren();
		const parts = `${prefix}${text}`.split(/([♥♦])/);
		for (const part of parts) {
			if (!part) continue;
			if (part === "♥" || part === "♦") {
				const suit = document.createElement("span");
				suit.className = "peixiu-red-suit";
				suit.textContent = part;
				element.appendChild(suit);
			} else element.appendChild(document.createTextNode(part));
		}
	}
	function formatSuitCounts(suits) {
		const counts = new Map(SUIT_ORDER.map((direction) => [direction, 0]));
		for (const suit of suits || []) if (counts.has(suit)) counts.set(suit, counts.get(suit) + 1);
		return SUIT_ORDER.map((direction) => `${PEIXIU_DIRECTIONS[direction].mark}${counts.get(direction)}`).join("");
	}
	function formatRequiredSuits(solution) {
		return formatSuitCounts((solution?.path || []).map((step) => step.dir));
	}
	function buildPeiXiuMapViewModel(state, bonuses) {
		const map = state?.result?.map;
		if (!map) return null;
		const rewardsByCell = new Map(map.rewards.filter((reward) => reward.rawCell !== 26).map((reward) => [reward.cell, getRewardInfo(reward, bonuses)]));
		const historyCells = new Set(state.historyCells || []);
		const collectedCells = new Set(historyCells).add(state.currentCell);
		const routeCells = getRouteCells(state.result.solution);
		return {
			width: 264,
			mapName: map.name || `地图 ${map.id}`,
			mapReward: getRewardInfo(map.mapReward, bonuses),
			currentCell: state.currentCell,
			presetRoutes: (state.presetRoutes || []).slice(0, 2).map(formatRoute),
			requiredSuits: formatRequiredSuits(state.result.solution),
			handSuits: Array.isArray(state.handSuitColors) ? formatSuitCounts(state.handSuitColors) : "",
			dynamicRoute: state.result.complete ? formatRoute(state.result.solution) : `无法拿全奖励，当前最优：${formatRoute(state.result.solution, "无可行路线")}`,
			historyCells,
			routeCells,
			cells: [...map.cells].map((id) => ({
				id,
				row: Math.floor((id - 1) / 5) + 1,
				column: (id - 1) % 5 + 1,
				current: id === state.currentCell,
				visited: historyCells.has(id),
				onRoute: routeCells.has(id),
				reward: rewardsByCell.get(id) || null,
				rewardCollected: collectedCells.has(id),
				special: map.specials.get(id) || null
			}))
		};
	}
	function createWindow() {
		return createDraggableWindow({
			id: WINDOW_ID,
			styleId: STYLE_ID$1,
			styleText: `
    #${WINDOW_ID} {
      top: 50px;
      width: 264px;
    }
    #${WINDOW_ID} .peixiu-title {
      font-size: 12px;
    }
    #${WINDOW_ID} .peixiu-fixed-skill {
      min-height: 38px;
      padding: 4px 0;
      overflow: hidden;
      border-bottom: 1px solid #706457;
    }
    #${WINDOW_ID} .peixiu-fixed-skill span {
      overflow: hidden;
      font-size: 12px;
      line-height: 14px;
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    #${WINDOW_ID} .peixiu-presets {
      padding: 2px 0;
      display: grid;
      gap: 1px;
      color: #dce9ef;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-presets .peixiu-route {
      min-height: 16px;
    }
    #${WINDOW_ID} .peixiu-presets .peixiu-route.is-empty {
      visibility: hidden;
    }
    #${WINDOW_ID} .peixiu-presets .peixiu-route + .peixiu-route {
      margin-top: 2px;
      padding-top: 2px;
      border-top: 1px solid #706457;
    }
    #${WINDOW_ID} .peixiu-dynamic-route {
      min-height: 36px;
      padding: 2px 0;
      color: #9ed4b4;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-required-suits {
      min-height: 22px;
      padding: 3px 0;
      color: #f2d06b;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-hand-suits {
      min-height: 22px;
      padding: 3px 0;
      color: #dce9ef;
      font-size: 16px;
      line-height: 16px;
    }
    #${WINDOW_ID} .peixiu-hand-suits.is-empty {
      visibility: hidden;
    }
    #${WINDOW_ID} .peixiu-route {
      overflow: hidden;
      display: -webkit-box;
      white-space: normal;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    #${WINDOW_ID} .peixiu-red-suit {
      color: #ff5f5f;
    }
    #${WINDOW_ID} .peixiu-board {
      width: 250px;
      height: 250px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(5, ${CELL_SIZE}px);
      grid-template-rows: repeat(5, ${CELL_SIZE}px);
      background: rgba(219, 189, 134, 0.95);
      box-shadow: inset 0 0 0 1px #51463b;
    }
    #${WINDOW_ID} .peixiu-cell {
      position: relative;
      width: ${CELL_SIZE}px;
      height: ${CELL_SIZE}px;
      padding: 3px;
      color: #33261d;
      background: rgb(213, 175, 123);
      border: 1px solid rgba(70, 50, 36, 0.46);
      font-size: 12px;
      font-weight: 700;
    }
    #${WINDOW_ID} .peixiu-cell.is-visited { background: #66aa77; }
    #${WINDOW_ID} .peixiu-cell.is-route { box-shadow: inset 0 0 0 2px #3f6f86; }
    #${WINDOW_ID} .peixiu-cell.is-current {
      color: #fff;
      background: #8f3438;
      box-shadow: inset 0 0 0 2px #f2d06b;
    }
    #${WINDOW_ID} .peixiu-cell-number { position: absolute; top: 3px; left: 3px; }
    #${WINDOW_ID} .peixiu-reward-badge {
      position: absolute;
      right: 3px;
      bottom: 3px;
      max-width: 40px;
      padding: 2px;
      overflow: hidden;
      color: #fff8dd;
      background: #2f6652;
      border: 1px solid #d9c477;
      font-size: 12px;
      line-height: 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${WINDOW_ID} .peixiu-reward-badge.is-collected {
      color: #2c2925;
      background: #fff;
      border-color: #8a8177;
    }
    #${WINDOW_ID} .peixiu-special {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #6f2025;
      font-size: 13px;
    }
  `,
			markup: `
    <header class="draggable-window-header peixiu-header">
      <div class="draggable-window-title peixiu-title"></div>
    </header>
    <div class="peixiu-fixed-skill"></div>
    <div class="peixiu-presets">
      <div class="peixiu-route" data-route="preset-1"></div>
      <div class="peixiu-route" data-route="preset-2"></div>
    </div>
    <div class="peixiu-board"></div>
    <div class="peixiu-required-suits"></div>
    <div class="peixiu-route peixiu-dynamic-route" data-route="dynamic"></div>
    <div class="peixiu-hand-suits"></div>
  `,
			handleSelector: ".peixiu-header"
		});
	}
	function setSkillLine(element, desc) {
		element.replaceChildren();
		const text = document.createElement("span");
		text.textContent = desc || "";
		element.appendChild(text);
	}
	function renderPeiXiuMapWindow(state, bonuses) {
		const model = buildPeiXiuMapViewModel(state, bonuses);
		if (!model) return false;
		const element = document.getElementById(WINDOW_ID) || createWindow();
		element.querySelector(".peixiu-title").textContent = model.mapName;
		[element.querySelector("[data-route=\"preset-1\"]"), element.querySelector("[data-route=\"preset-2\"]")].forEach((routeElement, index) => {
			const route = model.presetRoutes[index] || "";
			setSuitText(routeElement, route);
			routeElement.classList.toggle("is-empty", !route);
		});
		setSuitText(element.querySelector(".peixiu-required-suits"), model.requiredSuits, "需求：");
		setSuitText(element.querySelector("[data-route=\"dynamic\"]"), model.dynamicRoute, "动态：");
		const handSuits = element.querySelector(".peixiu-hand-suits");
		setSuitText(handSuits, model.handSuits, model.handSuits ? "手牌：" : "");
		handSuits.classList.toggle("is-empty", !model.handSuits);
		const fixedSkill = element.querySelector(".peixiu-fixed-skill");
		const fixedSkillDesc = model.mapReward?.desc || "";
		setSkillLine(fixedSkill, fixedSkillDesc);
		const board = element.querySelector(".peixiu-board");
		board.replaceChildren();
		for (const cell of model.cells) {
			const cellElement = document.createElement("div");
			cellElement.className = "peixiu-cell";
			cellElement.style.gridRow = cell.row;
			cellElement.style.gridColumn = cell.column;
			cellElement.classList.toggle("is-visited", cell.visited);
			cellElement.classList.toggle("is-route", cell.onRoute);
			cellElement.classList.toggle("is-current", cell.current);
			const number = document.createElement("span");
			number.className = "peixiu-cell-number";
			number.textContent = cell.id;
			cellElement.appendChild(number);
			if (cell.reward) {
				const badge = document.createElement("span");
				badge.className = "peixiu-reward-badge";
				badge.classList.toggle("is-collected", cell.rewardCollected);
				badge.textContent = cell.reward.name;
				cellElement.appendChild(badge);
				cellElement.addEventListener("mouseenter", () => setSkillLine(fixedSkill, cell.reward.desc));
				cellElement.addEventListener("mouseleave", () => setSkillLine(fixedSkill, fixedSkillDesc));
			}
			if (cell.special?.effect === 3) {
				const special = document.createElement("span");
				special.className = "peixiu-special";
				special.textContent = `${PEIXIU_DIRECTIONS[cell.special.param1]?.shortDirection || cell.special.param1}${cell.special.param2}`;
				cellElement.appendChild(special);
			}
			board.appendChild(cellElement);
		}
		return true;
	}
	function destroyPeiXiuMapWindow() {
		destroyDraggableWindow(WINDOW_ID);
	}
	function setPeiXiuMapWindowVisible(visible) {
		setDraggableWindowVisible(WINDOW_ID, visible);
	}
	function clearElement(element) {
		while (element?.firstChild) element.removeChild(element.firstChild);
	}
	function buttonRes(text, title = "点击复制", encode = true, disable = false) {
		const button = document.createElement("button");
		button.className = "calRes";
		button.title = title;
		button.disabled = disable;
		button.innerText = text;
		button.onclick = () => {
			toClipboard(text, encode);
			button.innerText = "复制成功";
			setTimeout(() => {
				button.textContent = text;
			}, 500);
		};
		return button;
	}
	function getResultContainer() {
		const resDiv = document.getElementById("result");
		if (resDiv) clearElement(resDiv);
		return resDiv;
	}
	function showTextResult(container, text) {
		container.innerHTML = `<span class="textRes">${text}</span>`;
	}
	function normalizeCardNumbers(array) {
		return (array || []).filter((number) => Number.isInteger(number) && number >= 1 && number <= 13).sort((a, b) => a - b);
	}
	function formatCardNumbers(numbers, useAce = true) {
		return numbers.map((number) => n2N(number, useAce)).join("+");
	}
	function countCardNumbers(numbers) {
		const counts = Array(14).fill(0);
		numbers.forEach((number) => {
			counts[0] += 1;
			counts[number] += 1;
		});
		return counts;
	}
	function getCountedNumbersTotal(counts) {
		return counts.reduce((sum, count, number) => sum + count * number, 0);
	}
	function formatNumberCounts(counts) {
		return counts.flatMap((count, number) => number > 0 ? Array(count).fill(n2N(number, false)) : []);
	}
	var ROUND_ZHAN_FA_IDS = new Set([
		2100,
		2101,
		2108,
		2109,
		2110,
		2312,
		2313,
		2317,
		2319,
		2320,
		2321,
		2322
	]);
	var SELF_TURN_ZHAN_FA_IDS = new Set([
		2079,
		2080,
		2081,
		2082,
		2083,
		2084
	]);
	function redefine(obj, prop, value) {
		if (typeof obj?.[prop] != "function") return false;
		if (Object.prototype.hasOwnProperty.call(obj, `__${prop}`)) return false;
		Object.defineProperty(obj, `__${prop}`, Object.getOwnPropertyDescriptor(obj, prop));
		Object.defineProperty(obj, prop, {
			...value,
			configurable: true
		});
		return true;
	}
	function getPageWindow() {
		if (typeof unsafeWindow == "object") return unsafeWindow;
		return window;
	}
	function getCallerFromEvent(emitter, eventName, propKey = null) {
		const handlers = emitter?._events?.[eventName];
		if (!handlers) return void 0;
		return (Array.isArray(handlers) ? handlers : [handlers]).map((e) => e?.caller).filter(Boolean).find((caller) => !propKey || Object.prototype.hasOwnProperty.call(caller, propKey) || caller.constructor && Object.prototype.hasOwnProperty.call(caller.constructor, propKey) || propKey in caller);
	}
	function findInStage(stage, key) {
		if (!stage) return [];
		if (key in stage) return stage[key];
		let result = stage?._children?.filter(Boolean) || [];
		if (key === "*" && stage?.viewStack?._childUIList?.length) result = stage.viewStack._childUIList;
		else if (key?.endsWith?.("Layer")) {
			const order = [
				"BottomLayer",
				"BackgroundLayer",
				"SceneLayer",
				"AnimationLayer",
				"WindowLayer",
				"TopUILayer",
				"PromptLayer"
			].indexOf(key);
			result = result.filter((layer) => layer.layerOrder == order);
		} else if ((key?.endsWith?.("View") || key?.endsWith?.("Window")) && stage?.viewStack?._childList?.includes(key)) {
			const indexes = stage.viewStack._childList.map((value, index) => value == key ? index : -1).filter((value) => value > -1);
			result = stage.viewStack._childUIList?.filter((value, index) => value && indexes.includes(index));
		} else if (key) result = result.filter((item) => item.name == key || item.sceneName == key || item.constructor?.name == key);
		if (!result?.length) return [];
		return Array.isArray(result) && result.length == 1 ? result[0] : result;
	}
	var classResolvers = {
		GameContext(_runtime) {
			const ctx = getPageWindow()?.GameContext || window.Laya?.Browser?.window?.GameContext || window.GameContext;
			if (ctx && typeof ctx.GetModeType == "function" && typeof ctx.GetGroupID == "function") return ctx;
		},
		GetGoodsByID(runtime) {
			return runtime.get("SgxFPreviewWindow", null, 0)?.getGoodConfig;
		},
		SgsText(runtime) {
			return runtime.scene?.topMenu?.timeLabel?.constructor;
		},
		SgsSpriteFilterBtn(runtime) {
			return runtime.scene?.topMenu?.backBtn?.constructor;
		},
		GameEventDispatcher(runtime) {
			return runtime.get("PopUpWindow", null, 0)?.ged;
		},
		WindowManager(runtime) {
			const ged = runtime.class("GameEventDispatcher");
			if (!ged) return void 0;
			return getCallerFromEvent(ged, "HIDE_WINDOW", "WindowInstanceDict");
		},
		ServerProxy(runtime) {
			return runtime.class("WindowManager")?.proxy;
		},
		SceneManager(runtime) {
			const ged = runtime.class("GameEventDispatcher");
			if (!ged) return void 0;
			return getCallerFromEvent(ged, "SWITCH_SCENE", "CurrentScene");
		},
		RogueLikePveManager(runtime) {
			const proxy = runtime.class("ServerProxy");
			if (!proxy) return void 0;
			return getCallerFromEvent(proxy, "decodeRogueLikeDataSync");
		}
	};
	var GameRuntime = class {
		instance = {};
		classes = {};
		__RUNTIME__ = null;
		flag = null;
		limit = 300;
		order = [];
		mark = () => null;
		trace = () => null;
		yanJiao = () => null;
		_powerSloganBlocked = false;
		reset() {
			this.flag = null;
			this.order = [];
		}
		init() {
			return true;
		}
		class(name, anew = false, value = void 0) {
			if (!anew && this.classes[name]) return this.classes[name];
			const resolver = Object.prototype.hasOwnProperty.call(classResolvers, name) ? classResolvers[name] : void 0;
			const resolved = typeof value == "function" ? value() : value || resolver?.(this);
			if (resolved) this.classes[name] = resolved;
			return this.classes[name];
		}
		get(name, args, dt = false, callback) {
			if (name in this.classes) return this.class(name) ? new this.classes[name](args) : void 0;
			if (!window.Laya?.ClassUtils?.getInstance) return void 0;
			if (!this.instance[name]) {
				this.del(name);
				const instance = window.Laya.ClassUtils.getInstance(name, args);
				if (instance?.protoName != "Protocol" && typeof instance?.Init == "function" && args !== null) try {
					instance.Init();
				} catch (error) {
					console.error(`Laya instance ${name} Init() error!\n` + error.stack);
				}
				this.instance[name] = instance;
			}
			if (this.instance[name]?.timeoutId) clearTimeout(this.instance[name].timeoutId);
			if (typeof callback === "function") callback(this.instance[name]);
			if (dt !== false) this.del(name, dt);
			return this.instance[name];
		}
		del(name, time = true) {
			const item = this.instance[name];
			if (!item || time === false || time === null) return;
			if (item.timeoutId) {
				clearTimeout(item.timeoutId);
				delete item.timeoutId;
			}
			const delNow = () => {
				if (!this.instance[name]) return;
				try {
					if (!this.instance[name].parent) if (typeof this.instance[name].Close == "function") this.instance[name].Close();
					else this.instance[name].destroy?.();
				} catch (error) {
					console.error("Laya instance " + name + " delete error!" + error);
				}
				delete this.instance[name];
			};
			if (time === true) delNow();
			else item.timeoutId = setTimeout(delNow, time);
		}
		find(...keys) {
			const isPlainObject = (obj) => Object.prototype.toString.call(obj) === "[object Object]";
			const start = isPlainObject(keys[0]) ? keys.shift() : window.Laya?.stage;
			const result = keys.reduce((acc, key) => {
				if (!(acc instanceof Object)) return [];
				if (Array.isArray(acc)) {
					if (!acc.length) return [];
					if (Array.isArray(key)) return acc.flatMap((item) => key.flatMap((itemKey) => findInStage(item, itemKey)));
					return acc.flatMap((item) => findInStage(item, key));
				}
				if (Array.isArray(key)) return key.flatMap((itemKey) => findInStage(acc, itemKey));
				return findInStage(acc, key);
			}, start);
			return result?.length == 0 ? null : result;
		}
		get ged() {
			return this.class("GameEventDispatcher");
		}
		get scene() {
			return this.class("SceneManager")?.CurrentScene || this.find("SceneLayer", null);
		}
		get gamescene() {
			return this.class("SceneManager")?.IsGameScene ? this.scene : null;
		}
		chat(chatmsg = "", channel = false) {
			if (!channel) {
				const UI = this.gamescene?.chatViewUI || this.scene?.chatViewUI || this.find(this.gamescene || this.scene, null, "chatViewUI");
				return UI?.chatInput && (UI.chatInput.text = chatmsg);
			}
			if (typeof channel === "string") {
				chatmsg = channel + ":" + btoa(chatmsg);
				channel = true;
			}
			if (channel === true) channel = this.gamescene?.chatViewUI?.chatInput ? 2 : 7;
			if (typeof channel !== "number") return;
			const manager = this.class("ChatManager");
			if (!manager) return;
			if (channel == 2 && typeof manager.SendChatMsg == "function") return manager.SendChatMsg(chatmsg);
			if (channel == 13 && typeof manager.SendCampChatMsg == "function") return manager.SendCampChatMsg(chatmsg);
			if (typeof manager.SendBaseChatMsg == "function") return manager.SendBaseChatMsg(chatmsg, channel, "", 0);
		}
		seatUIs() {
			this.init(true);
			if (!this._gamescene) return null;
			const verbose = this.limit == 290;
			const seats = (this.gamescene.seatContainer?.seatUIs)?.map((ui) => ui.seat)?.filter((s) => !s.isHide);
			if (!Game.isGuoZhan && !seats?.filter((s) => s.fixedViewId)?.length) return [];
			let SeatUIs = seats.map((seat, i, seats) => ({
				seat,
				seatID: seat.index,
				order: seat.fixedViewId - 1,
				figure: !Game.isGuoZhan ? seat.figure == seats[0].figure : seat.Country == seats[0].Country || -!!seat.Country,
				ai: seat?.playerInfo?.ClientId < 4e9 ? 0 : seat.playerInfo?.IsNormalRobot ? 2 : 1
			}));
			if (verbose === true && SeatUIs.some(({ ai }) => ai) && !Game.isShanHeTu) addTooltip("对战AI小杀！");
			SeatUIs = SeatUIs.map((ui) => ({
				...ui,
				index: this.order.indexOf(ui.seatID)
			})).sort((a, b) => a.figure - b.figure || b.ai - a.ai || a.index - b.index || a.order - b.order);
			this.order = SeatUIs.map((e) => e.seatID);
			const self = this.gamescene.SelfSeatUi;
			const cardContainer = self.cardContainer;
			const cardUis = cardContainer?.cardUis;
			const btnUIs = self.buttonBar?.btns;
			const skillItems = self.skillItems;
			const spellSelector = self.spellSelector;
			if (!verbose) return true;
			if (!cardUis || !btnUIs || !skillItems || !spellSelector) return false;
			this.limit--;
			this.mark = (ids, label, _, uis = cardUis) => ids != false && setTimeout(() => {
				if (Array.isArray(ids)) uis = ids.map((id) => cardContainer.getCardUiBy(id, false, uis)).filter(Boolean);
				uis.forEach((ui) => ui?.AddCardTag?.(label));
			});
		}
		ShowWindow(name) {
			const GameEventDispatcher = this.ged;
			if (!GameEventDispatcher) return;
			GameEventDispatcher.i?.(name);
		}
		GetWindow(name) {
			const manager = this.class("WindowManager");
			if (!manager) return null;
			const cachedWindow = (manager?.WindowInstanceDict)?.get(name);
			if (cachedWindow) return cachedWindow;
			const foundWindow = this.find("WindowLayer", name);
			if (Array.isArray(foundWindow)) return foundWindow.find(Boolean) ?? null;
			return foundWindow ?? null;
		}
		HideStartLoadingListener() {
			const GameEventDispatcher = this.ged;
			if (!GameEventDispatcher) return;
			GameEventDispatcher.on("HIDE_CHALLENGE_GAME_START", this, this.showName);
		}
		async showName() {
			const seatUIs = await wait(() => this.gamescene?.seatContainer?.seatUIs);
			if (!seatUIs) return;
			seatUIs.forEach(({ seat, otherTopManager }) => {
				if (seat?.playerInfo?.ClientId >= 4e9) return;
				otherTopManager?.createPlayerNameBg();
				otherTopManager?.createPlayerName();
				otherTopManager?.UpdatePlayerName(seat.playerInfo);
				otherTopManager?.SetPlayNameVisible(true);
				otherTopManager?.layout();
			});
		}
		blockPowerSlogan() {
			if (this._powerSloganBlocked) return true;
			const seatList = this.scene?.seatListView?.seatList;
			if (!Array.isArray(seatList) || !seatList.length) return false;
			const proto = seatList.find((seat) => seat?.__proto__ && typeof seat.__proto__.showPowerSlogan == "function")?.__proto__;
			if (!proto) return false;
			redefine(proto, "showPowerSlogan", { value() {} });
			if (!proto.__showPowerSlogan) return false;
			this._powerSloganBlocked = true;
			return true;
		}
		zhanfaMap = new Map();
		ZHANFA = new Set([
			13027,
			13028,
			13029,
			13039,
			13040,
			13041,
			13087,
			13088,
			13089,
			13184,
			13185,
			13293,
			13294,
			13033,
			13034,
			13035,
			13070,
			13071,
			13072,
			13073,
			13074,
			13075,
			13091,
			13098
		]);
		shaCounter() {
			if (!Game.isShanHeTu && !Game.isRoguelike1v1) return;
			const value = Number(Game.getSpellState("三板斧")) % 3;
			for (const id of [
				13033,
				13034,
				13035
			]) {
				const zhanfa = this.zhanfaMap.get(id);
				if (zhanfa) zhanfa.Value = value;
			}
		}
		useCounter() {
			if (!Game.isShanHeTu && !Game.isRoguelike1v1) return;
			const value = Game.getSpellState("手到擒来");
			for (const id of [
				13070,
				13071,
				13072
			]) {
				const zhanfa = this.zhanfaMap.get(id);
				if (zhanfa) zhanfa.Value = value;
			}
		}
		drawCounter() {
			if (!Game.isShanHeTu && !Game.isRoguelike1v1) return;
			const count = Number(Game.getSpellState("神龙摆尾"));
			const times = Game.getSpellState("多多益善");
			const shenlong1 = this.zhanfaMap.get(13091);
			if (shenlong1) shenlong1.Value = count % 9;
			const shenlong2 = this.zhanfaMap.get(13098);
			if (shenlong2) shenlong2.Value = count % 6;
			for (const id of [
				13073,
				13074,
				13075
			]) {
				const zhanfa = this.zhanfaMap.get(id);
				if (zhanfa) zhanfa.Value = times;
			}
		}
		zhanfaCounter(SkillId) {
			const zhanfa = this.zhanfaMap.get(SkillId);
			if (!zhanfa) return;
			if (zhanfa.n === void 0) zhanfa.n = 0;
			zhanfa.Value = ++zhanfa.n;
		}
		zhanfaRegister() {
			this.gamescene?.SelfSeatUi?.zhanFaItems?.forEach((ui) => {
				if (this.ZHANFA.has(ui.SkillId)) this.zhanfaMap.set(ui.SkillId, ui);
			});
		}
		zhanfaReset() {
			for (const [_, ui] of this.zhanfaMap) if (ui?.n !== void 0) ui.Value = ui.n = 0;
		}
		resetRoundZhanFa(previousSeatID) {
			for (const [_, ui] of this.zhanfaMap) {
				if (ui?.n !== void 0 && ROUND_ZHAN_FA_IDS.has(ui.PlotID)) ui.Value = ui.n = 0;
				if (previousSeatID === Game.myID && SELF_TURN_ZHAN_FA_IDS.has(ui.PlotID)) ui.Value = 0;
			}
		}
	};
	var laya = new GameRuntime();
	function isStrictMultisetSubset(subset, superSet) {
		if (subset.length >= superSet.length) return false;
		const counts = new Map();
		superSet.forEach((number) => counts.set(number, (counts.get(number) || 0) + 1));
		return subset.every((number) => {
			const count = counts.get(number) || 0;
			if (count <= 0) return false;
			counts.set(number, count - 1);
			return true;
		});
	}
	function drawChengXiang(array, K) {
		const arr = normalizeCardNumbers(array);
		if (!arr.length) return;
		const results = [];
		function backtrack(temp, start, sum) {
			if (sum > 13) return;
			if (temp.length > 0) {
				const numbers = temp.slice();
				const exact = K && sum === 13 ? temp.length : 0;
				results.push({
					numbers,
					exact
				});
			}
			for (let i = start; i < arr.length; i++) {
				if (i > start && arr[i] === arr[i - 1]) continue;
				if (sum + arr[i] > 13) break;
				temp.push(arr[i]);
				backtrack(temp, i + 1, sum + arr[i]);
				temp.pop();
			}
		}
		backtrack([], 0, 0);
		const resDiv = getResultContainer();
		if (!resDiv) return;
		const fragment = document.createDocumentFragment();
		const visibleResults = results.filter((subset, _, self) => !self.some((superSet) => isStrictMultisetSubset(subset.numbers, superSet.numbers))).sort((a, b) => (b.exact || 0) - (a.exact || 0) || b.numbers.length - a.numbers.length);
		for (const result of visibleResults) {
			const button = buttonRes(formatCardNumbers(result.numbers, false));
			if (K && result.exact) button.classList.add("textRes");
			fragment.appendChild(button);
		}
		resDiv.appendChild(fragment);
	}
	function drawMiZhu(array) {
		const arr = normalizeCardNumbers(array);
		const results = [];
		function backtrack(temp, start, sum) {
			if (sum === 13) {
				results.push(temp.slice());
				return;
			}
			for (let i = start; i < arr.length; i++) {
				if (i > start && arr[i] === arr[i - 1]) continue;
				if (sum + arr[i] > 13) break;
				temp.push(arr[i]);
				backtrack(temp, i + 1, sum + arr[i]);
				temp.pop();
			}
		}
		backtrack([], 0, 0);
		const resDiv = getResultContainer();
		if (!resDiv) return;
		const fragment = document.createDocumentFragment();
		const sortedResults = results.sort((a, b) => b.length - a.length);
		for (let i = 0; i < sortedResults.length && i < 15; i += 1) fragment.appendChild(buttonRes(formatCardNumbers(sortedResults[i], false)));
		if (!fragment.childNodes.length) {
			showTextResult(resDiv, "【资援】无解！");
			return;
		}
		resDiv.appendChild(fragment);
	}
	function getYanJiaoRemain(counts, ...subsets) {
		const remain = counts.slice();
		for (let i = 0; i < remain.length; i += 1) {
			for (const subset of subsets) {
				remain[i] -= subset[i];
				if (remain[i] < 0) return null;
			}
			if (i > 0 && remain[i] >= 2) return null;
		}
		return remain;
	}
	function createYanJiaoButton(left, right) {
		const button = document.createElement("button");
		const spanA = document.createElement("span");
		const spanB = document.createElement("span");
		button.className = "calRes";
		button.title = "点击复制";
		spanA.innerText = formatNumberCounts(left).join("+");
		spanB.innerText = formatNumberCounts(right).join("+");
		button.appendChild(spanA);
		button.insertAdjacentHTML("beforeend", "<span>=</span>");
		button.appendChild(spanB);
		button.onclick = function() {
			toClipboard(button.innerText, true);
		};
		return button;
	}
	function drawYanJiao(array) {
		const counts = countCardNumbers(normalizeCardNumbers(array));
		const half = Math.floor(getCountedNumbersTotal(counts) / 2);
		const subsetsBySum = new Map([[0, [Array(14).fill(0)]]]);
		for (let number = 1; number <= 13; number += 1) {
			const count = counts[number];
			if (count === 0) continue;
			for (const sum of Array.from(subsetsBySum.keys()).sort((a, b) => b - a)) {
				const subsets = subsetsBySum.get(sum);
				for (let n = 1; n <= count; n += 1) {
					const newSum = sum + number * n;
					if (newSum > half) break;
					if (!subsetsBySum.has(newSum)) subsetsBySum.set(newSum, []);
					const targetSubsets = subsetsBySum.get(newSum);
					for (const subset of subsets) {
						const nextSubset = subset.slice();
						nextSubset[0] += n;
						nextSubset[number] += n;
						targetSubsets.push(nextSubset);
					}
				}
			}
		}
		subsetsBySum.delete(0);
		const pairs = new Map();
		for (const sum of Array.from(subsetsBySum.keys()).sort((a, b) => b - a)) {
			const subsets = subsetsBySum.get(sum);
			for (let i = 0; i < subsets.length; i += 1) for (let j = i; j < subsets.length; j += 1) {
				const remain = getYanJiaoRemain(counts, subsets[i], subsets[j]);
				if (!remain) continue;
				const [left, right] = subsets[i][0] <= subsets[j][0] ? [subsets[i], subsets[j]] : [subsets[j], subsets[i]];
				if (!pairs.has(remain[0])) pairs.set(remain[0], []);
				pairs.get(remain[0]).push([
					left,
					right,
					remain
				]);
			}
		}
		const resDiv = getResultContainer();
		if (!resDiv) return;
		const fragment = document.createDocumentFragment();
		let rendered = 0;
		for (const remainCount of Array.from(pairs.keys()).sort((a, b) => a - b)) {
			const pairsByRemain = pairs.get(remainCount).sort((a, b) => a[0][0] - b[0][0]);
			for (const [left, right] of pairsByRemain) {
				fragment.appendChild(createYanJiaoButton(left, right));
				rendered += 1;
				if (rendered >= 5) break;
			}
			if (rendered >= 5) break;
		}
		if (!rendered) {
			showTextResult(resDiv, "【严教】无解！");
			return;
		}
		resDiv.appendChild(fragment);
	}
	var MAX_RENDERED_RESULTS = 15;
	function getYiChengGroups(numbers, length) {
		const groups = [];
		function backtrack(start, selected, sum) {
			if (selected.length === length) {
				groups.push({
					selected: selected.slice(),
					sum
				});
				return;
			}
			for (let i = start; i < numbers.length; i += 1) {
				if (i > start && numbers[i] === numbers[i - 1]) continue;
				selected.push(numbers[i]);
				backtrack(i + 1, selected, sum + numbers[i]);
				selected.pop();
			}
		}
		backtrack(0, [], 0);
		return groups;
	}
	function hasNumberOverlap(left, right) {
		const rightSet = new Set(right);
		return left.some((number) => rightSet.has(number));
	}
	function drawYiCheng(paiduiNumbers, shoupaiNumbers) {
		if (!paiduiNumbers?.length || !shoupaiNumbers?.length) return;
		const resDiv = getResultContainer();
		if (!resDiv) return;
		const paidui = normalizeCardNumbers(paiduiNumbers);
		const shoupai = normalizeCardNumbers(shoupaiNumbers);
		const max = Math.min(paidui.length, shoupai.length);
		const fragment = document.createDocumentFragment();
		let rendered = 0;
		for (let n = 2; n <= max && rendered < MAX_RENDERED_RESULTS; n++) {
			const paiduiGroups = getYiChengGroups(paidui, n);
			const handGroups = getYiChengGroups(shoupai, n);
			for (const handGroup of handGroups) {
				if (rendered >= MAX_RENDERED_RESULTS) break;
				for (const paiduiGroup of paiduiGroups) {
					if (rendered >= MAX_RENDERED_RESULTS) break;
					if (handGroup.sum <= paiduiGroup.sum) continue;
					if (hasNumberOverlap(handGroup.selected, paiduiGroup.selected)) continue;
					if (max >= 3 && !handGroup.selected.some((number, index) => number < paiduiGroup.selected[index])) continue;
					fragment.appendChild(buttonRes(`${formatCardNumbers(handGroup.selected)}→${formatCardNumbers(paiduiGroup.selected)}`, "点击复制", false));
					rendered += 1;
				}
			}
		}
		const shoupaiSet = Array.from(new Set(shoupai));
		const paiduiSet = Array.from(new Set(paidui));
		for (const sp of shoupaiSet) {
			if (rendered >= MAX_RENDERED_RESULTS) break;
			const pd = paiduiSet.filter((n) => n < sp);
			if (!pd.length) continue;
			fragment.appendChild(buttonRes(n2N(sp) + "→" + pd.map((n) => n2N(n)).join("/"), "点击复制", false));
			rendered += 1;
		}
		if (!rendered) {
			showTextResult(resDiv, "【易城】无法交换！");
			return;
		}
		resDiv.appendChild(fragment);
	}
	function drawLastUseCard(cardIDs = [], { spellId, color } = {}) {
		const toBeAdd = document.getElementById("lastUseCard");
		if (!toBeAdd) return;
		const ids = (cardIDs || []).filter((id) => id);
		let card;
		let isRed;
		if (ids.length === 1) {
			card = CardConfig.GetInstance().getCard(ids[0]);
			isRed = card?.color === 1 || card?.color === 2;
		} else {
			card = spellId ? SkillsConfig.GetInstance().getSpell(spellId) : null;
			isRed = color === 1;
		}
		if (!card) return;
		const button = document.createElement("button");
		button.classList.add("shoupai");
		button.classList.toggle("red-card", isRed);
		button.innerHTML = getCardFaceHtml(card);
		clearDirectCards(toBeAdd);
		toBeAdd.appendChild(button);
	}
	function clearDirectCards(element) {
		if (!(element instanceof HTMLElement)) return;
		invalidateEllipsisOverflow(element);
		element.querySelectorAll(":scope > .shoupai, :scope > .markedCard").forEach((e) => e.remove());
	}
	function clearZoneMirrors() {
		document.querySelectorAll("#seatUI .sorder-body").forEach(clearDirectCards);
		document.querySelectorAll("#seatUI .markedCard").forEach((element) => element.remove());
	}
	function debounce(func, wait) {
		let timeout;
		function debounced(...args) {
			clearTimeout(timeout);
			timeout = setTimeout(() => func.apply(this, args), wait);
		}
		debounced.cancel = function() {
			clearTimeout(timeout);
			timeout = null;
		};
		return debounced;
	}
	var optimizedResizeHandler = debounce(() => {
		requestAnimationFrame(() => {
			document.querySelectorAll(".sorder-body").forEach((orderBody) => {
				checkEllipsisOverflow(orderBody, 40);
			});
		});
	}, 500);
	window.addEventListener("resize", optimizedResizeHandler);
	function drawSeatUIs() {
		const seatUI = document.getElementById("seatUI");
		if (!seatUI) return false;
		const seats = UI.seatUIs.slice(1);
		if (seats.length === 0 || seats.some((seat) => !hasSeatPosition(seat))) return false;
		const defaultWidth = UI.unscaledWidth + UI.paddingRight;
		const layouts = seats.map((seat) => {
			const displayID = seat.fixedViewId;
			return {
				displayID,
				orderContainer: seatUI.querySelector("#or" + displayID),
				seat
			};
		});
		if (layouts.some(({ orderContainer }) => !orderContainer)) return false;
		const visibleContainers = new Set(layouts.map(({ orderContainer }) => orderContainer));
		for (const container of seatUI.querySelectorAll(".sorderContainer:not(.deckEdgeUI)")) {
			const isShown = visibleContainers.has(container);
			container.style.display = isShown ? "flex" : "none";
			container.style.visibility = isShown && Game.turn > 0 ? "visible" : "hidden";
		}
		for (const { displayID, orderContainer, seat } of layouts) {
			applySeatContainerLayout(orderContainer, seat, defaultWidth);
			ensureSeatOrderBody(orderContainer, displayID).className = `sorder-body sNo${displayID}`;
		}
		UI.firstUpdateSeatUI = true;
		window.dispatchEvent(new CustomEvent("dxc-seat-overlay-layout"));
		return true;
	}
	function hasSeatPosition(seat) {
		return Number.isFinite(seat?.posX) && Number.isFinite(seat?.posY) && Number.isFinite(seat?.fixedViewId);
	}
	function applySeatContainerLayout(orderContainer, seat, defaultWidth) {
		orderContainer.style.top = seat.posY + "px";
		orderContainer.style.left = seat.posX + "px";
		orderContainer.style.width = (seat.width || defaultWidth) + "px";
	}
	function ensureSeatOrderBody(orderContainer, displayID) {
		let orderBody = orderContainer.querySelector("#s" + displayID);
		if (!orderBody) {
			orderBody = document.createElement("div");
			orderBody.id = "s" + displayID;
			orderContainer.appendChild(orderBody);
		}
		return orderBody;
	}
	function revealPlayerHandCards(seatID, cardIDs, options = {}) {
		tracker.revealTrackerCards({
			type: "player",
			seatID,
			...options
		}, cardIDs);
	}
	function revealPileCards(cardIDs) {
		tracker.revealTrackerCards({
			type: "public",
			zoneName: "pile",
			reposition: true,
			cardIDsTopFirst: true
		}, cardIDs);
	}
	function getCardNumbers(ids) {
		const config = CardConfig.GetInstance();
		return ids.map((id) => config.getCardNumber(id));
	}
	function handleRoleOptTargetNtf(msg) {
		const { SpellID, Param, Params, SeatID, SrcSeatID, targetSeatID, Type } = msg;
		tracker.dispatchSkillProtocolEvent({
			type: "targetNotice",
			message: msg
		});
		if (FULL_HAND_ROLE_OPT_SPELL_IDS.has(SpellID)) {
			if (targetSeatID === void 0 || targetSeatID === 255) return;
			if (Params?.length > 0) revealPlayerHandCards(targetSeatID, Params, { fullHand: true });
			return;
		}
		if (PARTIAL_HAND_ROLE_OPT_SPELL_IDS.has(SpellID)) {
			if (targetSeatID === void 0 || targetSeatID === 255) return;
			if (Param == 0 && Params?.length > 0) revealPlayerHandCards(targetSeatID, Params);
			return;
		}
		switch (SpellID) {
			case 945:
				if (Param == 0 && Params?.length > 0) drawYanJiao(getCardNumbers(Params));
				break;
			case 3440:
				if (Param == 0 && Params?.length > 0 && Game.myID !== void 0 && Game.myID === SeatID) {
					if (Type == 28) drawYiCheng(getCardNumbers(Params), getCardNumbers(tracker.getTrackedPlayerHandCardIDs(SeatID)));
				}
				break;
			case 11003: break;
			case 943:
				if (Param == 0 && Params?.length == 1) revealPileCards(Params);
				break;
			case 898:
				if (SrcSeatID === void 0) break;
				if (Param == 0 && Params?.length > 2 && SrcSeatID !== 255) revealPlayerHandCards(SrcSeatID, Params.slice(1, Params[0] + 1));
				break;
			case 987:
			case 988:
				if (targetSeatID === void 0) break;
				if (Param == 1 && Params?.length > 2) {
					const pileCount = Number(Params[0]) || 0;
					const handCount = Number(Params[1]) || 0;
					if (pileCount > 0) revealPileCards(Params.slice(2, 2 + pileCount));
					if (handCount > 0 && targetSeatID !== 255) revealPlayerHandCards(targetSeatID, Params.slice(2 + pileCount, 2 + pileCount + handCount));
				}
				break;
			case 3903:
				if (targetSeatID != 255 || Param != 0) break;
				if (Type == 28 && Params?.length > 2) {
					const pileCount = Number(Params[0]) || 0;
					const pileCardIDs = Params.slice(2, 2 + pileCount);
					if (pileCount > 0 && pileCardIDs.length == pileCount) revealPileCards(pileCardIDs);
					break;
				}
				if (Type == 29 && Params?.length == 4) revealPileCards(Params.slice(1));
				break;
			case 3266: break;
			case 3483:
				if (targetSeatID === void 0) break;
				if (Param == 1 && Params?.length > 0) {
					const notice = parseJieLiNotice(msg);
					if (!notice?.pileCardIDs) break;
					revealPileCards(notice.pileCardIDs);
					if (notice.handCardIDs.length > 0 && notice.targetSeat !== 255) revealPlayerHandCards(notice.targetSeat, notice.handCardIDs, { inferFullHand: true });
				}
				break;
			case 3571: break;
			case 7010:
			case 7011: break;
			case 2900:
				if (Type == 28) Game.setGeneral(targetSeatID, Params[2], Params[1], true);
				break;
			case 4021:
				if (Type == 78) {
					destroyPeiXiuMapWindow();
					Game.deleteSpellState(4022);
				}
				break;
			case 3641:
				if (Type == 67 && SeatID !== Game.myID) wait(() => laya.GetWindow("TianShuWindow")).then((win) => win.Close?.()).catch((err) => {
					console.error(err);
				});
				break;
			case 441:
			case 3492: {
				if (SrcSeatID === void 0 || targetSeatID !== 255) break;
				const cardIDs = Game.getSpellState(SpellID);
				Game.deleteSpellState(SpellID);
				if (SrcSeatID !== Game.myID) break;
				if (!Array.isArray(cardIDs) || !cardIDs.length) break;
				drawChengXiang(getCardNumbers(cardIDs), SpellID == 3492);
				break;
			}
			case 3911: {
				if (Type !== 28 || SeatID === void 0 || SeatID !== Game.myID) break;
				if (!Array.isArray(Params) || Params.length < 5) break;
				const count = Number(Params[0]) || 0;
				if (count <= 0) break;
				const validParams = Params.slice(1, 1 + count * 4);
				const pingJianDic = SpellExtendConfig.GetInstance().PingJianDic;
				const entries = [];
				for (let i = 0; i < validParams.length; i += 4) {
					const group = validParams.slice(i, i + 4);
					if (group.length < 4) break;
					const zhangongId = group[2];
					if (!zhangongId) continue;
					const pj = pingJianDic.get(Number(zhangongId));
					if (pj?.name) {
						const startPos = Number(group[0]);
						if (Number.isInteger(startPos) && startPos >= 0 && startPos < 36) {
							const row = Math.floor(startPos / 6) + 1;
							const col = startPos % 6 + 1;
							entries.push({
								startPos,
								text: `${pj.name} (${row}行${col}列)`
							});
						} else entries.push({
							startPos: Infinity,
							text: pj.name
						});
					}
				}
				if (entries.length > 0) {
					entries.sort((a, b) => a.startPos - b.startPos);
					renderPingJianWindow(entries.map((entry) => entry.text));
				}
				Game.setSpellState(3911, [count, ...validParams]);
				break;
			}
			case 3854:
				if (Type !== 29 || SeatID === void 0 || SeatID !== Game.myID) break;
				if (Params?.length > 0) revealPlayerHandCards(targetSeatID, Params);
				break;
			default: break;
		}
	}
	var excludeNames = new Set([
		"乐",
		"兵",
		"闪电"
	]);
	var shaNames = new Set([
		"杀",
		"火杀",
		"雷杀",
		"冰杀"
	]);
	function updateResult(html) {
		if (typeof document === "undefined") return;
		const result = document.getElementById("result");
		if (!result) return;
		result.innerHTML = html;
	}
	function updateQuanDaoDisplay(context) {
		const { game, patched } = context;
		if (!((patched.FromZone == 5 || patched.ToZone == 5) && (patched.ToID == game.myID || patched.FromID == game.myID))) return;
		let cards = tracker.getTrackedPlayerHandCardIDs(game.myID).slice();
		if (patched.ToZone == 5) cards.push(...patched.CardIDs);
		else if (patched.FromZone == 5) cards = cards.filter((card) => !patched.CardIDs.includes(card));
		cards = cards.filter((id) => id > 0).map((id) => CardConfig.GetInstance().getCard(id)).filter(Boolean);
		const { countType2, countSha } = cards.reduce((acc, card) => {
			if (card.type === 2 && !excludeNames.has(card.name)) acc.countType2++;
			if (shaNames.has(card.name)) acc.countSha++;
			return acc;
		}, {
			countType2: 0,
			countSha: 0
		});
		updateResult("<span class=\"textRes\">【权道】杀：普通锦囊</span><br><span class=\"textRes\">" + countSha + "：" + countType2 + "</span>");
	}
	function handleGameFlowState(context) {
		const { game, patched } = context;
		if (patched.FromZone == 1 && patched.MoveType == 19 && patched.SpellID == 0 && !game.isGameStart && !game.isPassed) {
			if (game.isPassed === false) game.isPassed = null;
			if (game.isGameStart !== null && patched.FromZone == 1) patched.FromPosition = POSITION_RANDOM;
		}
		if (patched.FromZone == 1 && patched.ToZone == 5 && patched.MoveType == 1) {
			const isFaceUpDraw = patched.CardIDs.filter((id) => id > 0).length == patched.CardCount;
			if (game.isRecord && game.myID === void 0 && isFaceUpDraw) tracker.setTrackerMySeatID(patched.ToID);
			if (!game.isGameStart && !game.isPassed) {
				if (game.isGameStart === null) game.isGameStart = false;
				if (isFaceUpDraw) patched.FromPosition = POSITION_RANDOM;
			}
			if (game.myID !== void 0 && patched.ToID === game.myID && game.turn > 0) {
				game.drawCounter(patched.CardCount);
				laya.drawCounter();
			}
		}
		updateQuanDaoDisplay(context);
	}
	function handleSpecialZones(context) {
		const { game, patched } = context;
		if (patched.ToZone == 12 || patched.FromZone == 12) return { handled: true };
		if (patched.FromZone == 0 && patched.ToZone == 1 && patched.ToPosition == 65280 && patched.MoveType == 19) {
			if (!game.isGameStart) game.isGameStart = null;
			return { handled: true };
		}
		if (patched.FromZone == 2 && patched.ToZone == 9 && patched.MoveType == 255) {
			game.isPassed = false;
			return { handled: true };
		}
		return { handled: false };
	}
	function handleChengXiang(context) {
		const { patched } = context;
		if (patched.ToZone != 8 || patched.MoveType != 6) return;
		context.game.setSpellState(patched.SpellID, [...patched.CardIDs || []]);
	}
	var spellEffectHandlers = new Map([[441, handleChengXiang], [3492, handleChengXiang]]);
	function applySpellEffect(context) {
		const handler = spellEffectHandlers.get(context.patched.SpellID);
		if (!handler) return false;
		handler(context);
		return true;
	}
	function handleMoveCard(msg) {
		const raw = Object.freeze({
			CardCount: msg.CardCount,
			CardIDs: Object.freeze([...msg.CardIDs]),
			FromID: msg.FromID,
			FromZone: msg.FromZone,
			FromZoneParam: msg.FromZoneParam,
			FromPosition: msg.FromPosition,
			ToID: msg.ToID,
			ToZone: msg.ToZone,
			ToZoneParam: msg.ToZoneParam,
			ToPosition: msg.ToPosition,
			MoveType: msg.MoveType,
			SpellID: msg.SpellID,
			SrcSeatID: msg.SrcSeatID,
			Label: msg.Label,
			isSend: msg.isSend
		});
		const patched = {
			...raw,
			CardIDs: raw.CardIDs.slice()
		};
		if (shouldIgnoreTrackerMove(raw)) return;
		const context = {
			raw,
			patched,
			game: Game
		};
		if (!handleSpecialZones(context).handled) {
			handleGameFlowState(context);
			applySpellEffect(context);
		}
		tracker.syncTrackerMove(patched, raw);
	}
	var cityRenderVersion = 0;
	function drawCitiesUI(cities) {
		const renderVersion = ++cityRenderVersion;
		wait(() => {
			if (renderVersion !== cityRenderVersion) return true;
			const rogueScene = laya.find("SceneLayer", "RogueSmallMapScene");
			return rogueScene?.cityView ? rogueScene : void 0;
		}, 10, 500, { immediate: true }).then((rogueScene) => {
			if (renderVersion !== cityRenderVersion) return;
			const cityView = rogueScene?.cityView;
			if (!cityView || cityView.destroyed) return;
			renderCities(cities, cityView);
		}).catch((err) => {
			console.error(err);
		});
	}
	function renderCities(cities, cityView) {
		for (let i = cityView.numChildren - 1; i >= 0; i--) {
			const child = cityView.getChildAt(i);
			if (child.name === "city") child.destroy(true);
		}
		rogueMap.res = [];
		const roguelikeConfig = RoguelikeConfig.GetInstance();
		for (const city of cities) {
			const cityData = roguelikeConfig.getCity(city.id);
			if (!cityData) continue;
			const { x, y } = cityData;
			const cityContainer = new Laya.Sprite();
			cityContainer.pos(x, y - 10);
			cityContainer.zOrder = 999;
			cityContainer.name = "city";
			const rows = [];
			const fight = roguelikeConfig.getFight(city.event);
			if (fight) processFightEvent({
				...fight,
				event: city.event
			}, rows);
			else processChooseEvent(city.event, rows);
			layoutCityContainer(cityContainer, rows);
			rogueMap.res.push({
				id: city.id,
				city: cityContainer
			});
			cityView.addChild(cityContainer);
		}
	}
	var STYLES = {
		TITLE: {
			color: "#f2de9c",
			fontSize: 18,
			bold: false
		},
		GENERAL: {
			normal: "#f2de9c",
			warning: "rgb(240, 65, 85)",
			fontSize: 18
		},
		GET_INFO: {
			color: "#f2de9c",
			fontSize: 16,
			bold: false
		}
	};
	var CITY_LAYOUT = {
		paddingX: 5,
		space: 4,
		minContentWidth: 120,
		dividerHeight: 1,
		backgroundColor: "rgba(59, 58, 39, 0.75)",
		dividerColor: "rgba(255, 255, 255, 0.2)"
	};
	function layoutCityContainer(container, rows) {
		if (rows.length === 0) return;
		const { paddingX, space, minContentWidth, backgroundColor, dividerColor } = CITY_LAYOUT;
		const contentWidth = Math.max(minContentWidth, ...rows.map((row) => row.width));
		const width = contentWidth + paddingX * 2;
		const height = rows.reduce((sum, row) => sum + row.height + (row.text ? 0 : space * 2), 0) + 4;
		container.size(width, height);
		container.graphics.drawRect(0, 0, width, height, backgroundColor);
		let y = 2;
		for (const row of rows) {
			if (row.text) {
				row.text.pos(paddingX + (contentWidth - row.width) / 2, y);
				container.addChild(row.text);
			} else {
				y += space;
				container.graphics.drawRect(paddingX, y, contentWidth, row.height, dividerColor);
				y += space;
			}
			y += row.height;
		}
	}
	function createTextRow(config) {
		const text = new Laya.Text();
		text.text = config.text || "";
		text.color = config.color || "#ffffff";
		text.fontSize = config.fontSize || 16;
		text.bold = config.bold || false;
		text.font = "fzltchjw";
		text.stroke = config.stroke || 2;
		text.strokeColor = config.strokeColor || "#18140f";
		text.typeset();
		return {
			text,
			width: text.textWidth,
			height: text.textHeight
		};
	}
	function createDividerRow() {
		return {
			text: null,
			width: CITY_LAYOUT.minContentWidth,
			height: CITY_LAYOUT.dividerHeight
		};
	}
	function processFightEvent(eventData, rows) {
		eventData.generals.forEach((general) => {
			rows.push(createGeneralRow(general, rogueMap.difficulty, eventData));
		});
		rows.push(createDividerRow());
		rows.push(createTextRow({
			text: eventData.get,
			...STYLES.GET_INFO
		}));
	}
	function processChooseEvent(baseEvent, rows) {
		const roguelikeConfig = RoguelikeConfig.GetInstance();
		const adventure = roguelikeConfig.getAdventure(baseEvent);
		const title = roguelikeConfig.getText(adventure?.chapname);
		rows.push(createTextRow({
			text: title,
			...STYLES.TITLE
		}));
		for (const option of adventure?.options || []) {
			const eventData = roguelikeConfig.getChoice(option.effect);
			if (!eventData) continue;
			rows.push(createDividerRow());
			if (eventData.generals) eventData.generals.forEach((general) => {
				rows.push(createGeneralRow(general, rogueMap.difficulty, eventData));
			});
			const textParts = [];
			if (!eventData.generals && eventData.lost) textParts.push(`${eventData.lost} ${findLostItemByName(eventData.lost)}`);
			if (eventData.get) textParts.push(`${eventData.get}`);
			if (textParts.length > 0) rows.push(createTextRow({
				text: textParts.join("\n"),
				...STYLES.GET_INFO
			}));
		}
	}
	function findLostItemByName(descText) {
		const parts = descText.split(" ");
		if (parts.length !== 2) return null;
		const [_, typeLevel] = parts;
		const typeMap = {
			战法: 2,
			技能: 3
		};
		const levelMap = {
			普通: 1,
			稀有: 2,
			史诗: 3
		};
		const matchedType = Object.keys(typeMap).find((t) => typeLevel.includes(t));
		const matchedLevel = Object.keys(levelMap).find((l) => typeLevel.includes(l));
		if (!matchedType || !matchedLevel) return "";
		const targetType = typeMap[matchedType];
		const targetLevel = levelMap[matchedLevel];
		const roguelikeConfig = RoguelikeConfig.GetInstance();
		for (const itemId of rogueMap.itemId) {
			const item = roguelikeConfig.getPlot(itemId);
			if (item && item.type === targetType && item.level === targetLevel) return item.name;
		}
		return "";
	}
	function createGeneralRow(general, difficulty, eventData) {
		const [skills, red] = highlightedSkill(general, difficulty);
		const canStart = String(eventData.CanStart || "").split(";").includes(String(difficulty));
		const start = general.start && canStart ? "[先行]" : "";
		return createTextRow({
			text: `${general.generalname}${start}${red ? " " + skills.join(" ") : ""}`,
			color: red ? STYLES.GENERAL.warning : STYLES.GENERAL.normal,
			fontSize: STYLES.GENERAL.fontSize
		});
	}
	var spellList = [
		"巳蛇",
		"灵动",
		"八门",
		"智迟",
		"持盈",
		"卫主",
		"不死",
		"刚烈",
		"觉醒",
		"悲鸣",
		"断肠",
		"节命",
		"先机",
		"悲鸣",
		"忘魂",
		"雅士",
		"挥泪",
		"不屈",
		"封冻",
		"灵躯",
		"武魂",
		"已蛇",
		"邪徒",
		"魅步",
		"雷击",
		"恢拓",
		"夺炁",
		"恩怨",
		"鸡肋",
		"反击"
	];
	function highlightedSkill(generalInfo, difficulty) {
		const difficultySpells = [
			generalInfo.getspell,
			generalInfo.getspell_ZD,
			generalInfo.getspell_KN,
			generalInfo.getspell_EM,
			generalInfo.getspell_LY
		];
		const difficultyInfo = RoguelikeConfig.GetInstance().difficultDict.get(String(difficulty));
		const difficultyLevel = Number(difficultyInfo?.bdif) || 1;
		const currentLevelIndex = Math.min(Math.max(difficultyLevel - 1, 0), difficultySpells.length - 1);
		const skills = difficultySpells.slice(0, currentLevelIndex + 1).flatMap((spell) => String(spell || "").split(";")).filter(Boolean).map((spell) => SkillsConfig.GetInstance().getSpellName(spell)).filter((spell) => spellList.includes(spell));
		return [skills, skills.length > 0];
	}
	function drawStore(filteredPairs) {
		var StoreHTML = document.getElementById("storeDetail");
		StoreHTML.innerText = "";
		if (filteredPairs.length == 0) filteredPairs = ["暂无集市数据"];
		for (const sebs of filteredPairs) {
			const span = document.createElement("button");
			span.className = "storeDetail";
			span.innerText = sebs;
			StoreHTML.append(span);
		}
	}
	async function showShanHeTuSponsorPrompt(ProtoObj) {
		if (!ProtoObj?.allData) return;
		const allData = ProtoObj.allData;
		rogueMap.general = allData.gameData?.myGeneral?.uGeneralId ?? 0;
		rogueMap.itemId = allData.gameData?.itemId ?? [];
	}
	async function handleRogueLike(ProtoObj) {
		if (!ProtoObj?.allData) return;
		const allData = ProtoObj.allData;
		const dataMark = ProtoObj.dataMark;
		const shopData = allData.shopData;
		const chapterData = allData.chapterData;
		const generalpool = allData.generalpool;
		if ((dataMark & 16) !== 0) if (!shopData) return req();
		else {
			shopData.bShow = true;
			req(0);
		}
		renderRogueAttrInfo(allData.gameData?.attrInfo);
		if (shopData) {
			const storeItem = [];
			const roguelikeConfig = RoguelikeConfig.GetInstance();
			if (shopData.itemId && roguelikeConfig.shopDict.size) for (const i of shopData.itemId) {
				const plot = roguelikeConfig.getPlot(i);
				if (plot) storeItem.push(plot["name"]);
			}
			drawStore(storeItem);
		}
		if (generalpool?.general_change?.length > 0) addTooltip(`小抄提示：可换将为${generalpool.general_change.map((element) => CharacterConfig.GetInstance().generalDict[element] || `Unknown (${element})`).reverse().join(", ")}`, "acTooltip", 1e4, "green", null, true);
		const seasonData = allData.seasonData;
		const difficulty = seasonData && seasonData.difficulty;
		difficulty && (rogueMap.difficulty = difficulty);
		rogueMap.general = allData.gameData?.myGeneral?.uGeneralId ?? 0;
		rogueMap.itemId = allData.gameData?.itemId ?? [];
		if (chapterData?.locations) {
			UI.cities = chapterData.locations.map((l) => ({
				id: l.location,
				event: l.event
			}));
			RoguelikeConfig.GetInstance().levelDict.size && globalConfig.rogueCitySwitch && drawCitiesUI(UI.cities, "");
		}
	}
	var ROGUE_ATTR_LABELS = {
		rep: "声望",
		tro: "战功",
		wis: "智谋",
		mar: "商才",
		loy: "忠诚",
		ass: "权谋",
		cha: "魅力"
	};
	function renderRogueAttrInfo(attrInfo) {
		const container = document.getElementById("rogueAttrInfo");
		if (!container) return;
		for (const badge of container.querySelectorAll("[data-rogue-attr]")) {
			const valueContainer = badge.querySelector(".rogue-attr-value");
			if (!valueContainer) continue;
			const value = Number(attrInfo?.[badge.dataset.rogueAttr]);
			const nextValue = Number.isFinite(value) ? value : 0;
			const currentValue = Number(valueContainer.textContent);
			if (Number.isFinite(currentValue) && currentValue !== nextValue) addTooltip(`${ROGUE_ATTR_LABELS[badge.dataset.rogueAttr] ?? badge.dataset.rogueAttr}值变成了${nextValue}`, "acTooltip", 3e3);
			valueContainer.textContent = nextValue;
		}
	}
	var req = (() => {
		let ok = false;
		return function(dm = 63) {
			if (!dm) return ok = false;
			if (ok) {
				console.warn("req: 已请求过，跳过重复请求, dm=", dm);
				return true;
			}
			ok = true;
			return laya.class("RogueLikePveManager")?.RogueLikeDataReq(dm);
		};
	})();
	var ConfigManager = class ConfigManager {
		configUrl = "https://web.sanguosha.com/220/h5_2/res/config/Config_w.sgs";
		fileNames = [
			"sys_playcard",
			"cha_spell",
			"character",
			"hd_roguelike",
			"cha_spellextend"
		];
		static GetInstance() {
			if (null == this.instance) this.instance = new ConfigManager();
			return this.instance;
		}
		constructor() {
			this.preloadConfigerList = [
				CardConfig.GetInstance(),
				SkillsConfig.GetInstance(),
				CharacterConfig.GetInstance(),
				RoguelikeConfig.GetInstance(),
				SpellExtendConfig.GetInstance()
			];
		}
		async loadAndParseConfigs() {
			const response = await fetch(this.configUrl);
			if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
			const zipData = await response.arrayBuffer();
			const zip = await JSZip.loadAsync(zipData);
			const promises = this.preloadConfigerList.map(async (configer) => {
				if (!configer) return;
				const data = await this.loadConfigFile(zip, configer.FileName);
				configer.parse(data);
			});
			await Promise.all(promises);
			console.info("[ConfigManager] Config_w 解析完成");
		}
		async loadConfigFile(zip, fileName) {
			const file = zip.file(fileName + ".sgs");
			if (!file) throw new Error(`File not found in zip: ${fileName}.sgs`);
			const arrayBuffer = await file.async("arraybuffer");
			const decryptedData = CtrUtil.Ctr.Ofb_Dec(arrayBuffer);
			const uint8Array = decryptedData instanceof Uint8Array ? decryptedData : new Uint8Array(decryptedData);
			const decompressedData = new Zlib.Gunzip(uint8Array).decompress();
			const fileData = new TextDecoder().decode(decompressedData);
			return JSON.parse(fileData);
		}
	};
	var ALWAYS_RECORDED_CLASSES = new Set([
		"MsgReconnectGame",
		"decodeGameRecordInitInfo",
		"decodeGsClientUserSeatFlagNtf",
		"GsCFirstPhaseRole",
		"MsgGamePlayCardNtf",
		"SmsgGameSetCharacter",
		"GsCGuoZhanSetCharacter",
		"MsgGameTurnNtf",
		"GsCGamephaseNtf",
		"MsgGameRoundNtf",
		"MsgGameOver",
		"ClientLeavetableRep"
	]);
	var EMPTY_PAYLOAD_CLASSES = new Set([
		"ClientLeavetableRep",
		"MsgGameOver",
		"MsgReconnectGame"
	]);
	var ROLE_OPT_TARGET_SPELL_IDS = new Set([
		4,
		5,
		357,
		361,
		372,
		501,
		774,
		811,
		851,
		898,
		921,
		943,
		987,
		988,
		2900,
		3119,
		3310,
		3437,
		3483,
		3876,
		3903,
		4025
	]);
	var TRACKER_ROLE_DATA_EX_IDS = new Set([
		8,
		3544,
		3571,
		GUI_FU_ROLE_DATA_ID
	]);
	var TRACKER_USE_SPELL_IDS = new Set([
		3090,
		3138,
		3157,
		3161,
		3185,
		3193,
		3511,
		3731,
		3750
	]);
	var CONDITIONAL_RECORDING_RULES = {
		MsgNtfUseCardType: shouldRecordCounterUseCard,
		PubGsCUseCard: shouldRecordCounterUseCard,
		PubGsCUseSpell: shouldRecordUseSpell,
		PubGsCMoveCard: shouldRecordMoveCard,
		GsCUpdateRoleDataNtf: (message) => readNumberField(message, "StateID") === 58,
		MsgGameShowFigure: (message) => readNumberField(message, "Figure") === 1,
		GsCUpdateRoleDataExNtf: (message) => TRACKER_ROLE_DATA_EX_IDS.has(readNumberField(message, "DataID") ?? -1),
		GsCRoleOptTargetNtf: shouldRecordRoleOptTarget,
		CGsRoleSpellOptRep: shouldRecordRoleSpellOpt
	};
	var ROOT_IGNORED_FIELDS = new Set([
		"ByteData",
		"CardSpell",
		"ClassName",
		"Data",
		"DataCount",
		"FItem",
		"ProtoObj",
		"Spell",
		"_className_",
		"className",
		"data",
		"data_count",
		"errCode",
		"errMsg",
		"fromSocket2",
		"id",
		"isResume",
		"isSend",
		"msgQueuePriority",
		"pbMsgType",
		"printIgnorList",
		"printJsonIgnorList",
		"protoName",
		"receviedStatus",
		"sendStatus",
		"timestamp",
		"userID"
	]);
	var ROOT_FIELD_EXCEPTIONS = new Map([
		["MsgNtfUseCardType", new Set(["isSend"])],
		["PubGsCUseCard", new Set(["isSend"])],
		["PubGsCMoveCard", new Set(["isSend"])]
	]);
	var ROOT_FIELD_ALLOWLISTS = {
		decodeGameRecordInitInfo: new Set(),
		decodeGsClientUserSeatFlagNtf: new Set(),
		GsCFirstPhaseRole: new Set(["SeatID"]),
		GsCGamephaseNtf: new Set(["Round", "SeatID"]),
		GsCGuoZhanSetCharacter: new Set(["GeneralData", "SeatID"]),
		GsCUpdateRoleDataExNtf: new Set([
			"DataID",
			"Datas",
			"SeatID"
		]),
		GsCUpdateRoleDataNtf: new Set(["SeatID", "StateID"]),
		MsgGamePlayCardNtf: new Set(["CardList"]),
		MsgGameRoundNtf: new Set(["isPassed"]),
		MsgGameShowFigure: new Set(["Figure", "SeatID"]),
		MsgGameTurnNtf: new Set(["TurnCnt"]),
		MsgNtfUseCardType: new Set([
			"castSeatId",
			"isSend",
			"spellID",
			"spellId",
			"useType"
		]),
		PubGsCMoveCard: new Set([
			"CardCount",
			"CardIDs",
			"FromID",
			"FromPosition",
			"FromZone",
			"FromZoneParam",
			"MoveType",
			"SpellID",
			"SrcSeatID",
			"ToID",
			"ToPosition",
			"ToZone",
			"ToZoneParam",
			"isSend"
		]),
		PubGsCUseCard: new Set([
			"SeatID",
			"isSend",
			"spellID",
			"useType"
		]),
		PubGsCUseSpell: new Set([
			"CardIDs",
			"DestSeatIDs",
			"EffectIndex",
			"SeatID",
			"SkillOwerSeatID",
			"SpellID",
			"SrcSeatID"
		]),
		SmsgGameSetCharacter: new Set(["Infos"]),
		CGsRoleSpellOptRep: new Set([
			"Datas",
			"SeatID",
			"SpellID",
			"Type"
		]),
		GsCRoleOptTargetNtf: new Set([
			"Param",
			"Params",
			"SeatID",
			"SpellID",
			"SrcSeatID",
			"Type",
			"targetSeatID"
		])
	};
	var NESTED_FIELD_ALLOWLISTS = {
		"GsCGuoZhanSetCharacter.GeneralData": new Set(["cardID", "index"]),
		"SmsgGameSetCharacter.Infos": new Set(["CharacterID", "SeatID"])
	};
	var NESTED_IGNORED_FIELDS = new Set(["timestamp"]);
	var TRACKER_SEAT_INFO_FIELDS = [
		"SeatID",
		"seat_id",
		"user_temp_id",
		"ClientID"
	];
	var OMITTED = Symbol("omitted");
	var MAX_PROTOCOL_DEPTH = 20;
	function shouldRecordTrackerProtocol(message, context = {}) {
		if (!isProtocolObject(message)) return false;
		const className = getProtocolClassName(message);
		if (!className) return false;
		const conditionalRule = CONDITIONAL_RECORDING_RULES[className];
		if (conditionalRule) return conditionalRule(message, context);
		return ALWAYS_RECORDED_CLASSES.has(className);
	}
	function shouldRecordCounterUseCard(message, context) {
		const useType = readNumberField(message, "useType");
		const spellID = readNumberField(message, "spellID") ?? readNumberField(message, "spellId") ?? 0;
		if (useType !== 1 || Boolean(readProtocolField(message, "isSend")) || spellID <= 0) return false;
		if (context.mySeatID === void 0) return true;
		return (readNumberField(message, "SeatID") ?? readNumberField(message, "castSeatId") ?? void 0) === context.mySeatID;
	}
	function shouldRecordUseSpell(message, context) {
		const spellID = readNumberField(message, "SpellID") ?? -1;
		if (!TRACKER_USE_SPELL_IDS.has(spellID)) return false;
		switch (spellID) {
			case 3090:
				if (readNumberField(message, "EffectIndex") !== 1) return false;
				return context.currentSeatID === void 0 || readNumberField(message, "SeatID") === context.currentSeatID;
			case 3157:
			case 3511: return readArrayField(message, "CardIDs").some((cardID) => Number(cardID) > 0);
			case 3750: return readNumberField(message, "EffectIndex") === 2 && readArrayField(message, "DestSeatIDs").length === 0;
			case 3731: return readNumberField(message, "EffectIndex") === 2 && readArrayField(message, "DestSeatIDs").length > 0;
			default: return true;
		}
	}
	function shouldRecordMoveCard(message) {
		return !(readNumberField(message, "CardCount") === 0 || readNumberField(message, "MoveType") === 0 || readNumberField(message, "ToZone") === 11 || Boolean(readProtocolField(message, "isSend")));
	}
	function shouldRecordRoleSpellOpt(message, context = {}) {
		const datas = readArrayField(message, "Datas");
		if (datas.length === 0) return false;
		const type = readNumberField(message, "Type");
		if (type === 72) return true;
		switch (readNumberField(message, "SpellID")) {
			case 2022:
			case 3659: return true;
			case 3744: return type !== 73;
			case 3336:
			case 3868: return type === 50;
			case 7009: return type === 30;
			case 3483: return type === 53 && (context.mySeatID === void 0 || Number(datas[1]) === Number(context.mySeatID));
			default: return false;
		}
	}
	function shouldRecordRoleOptTarget(message) {
		const spellID = readNumberField(message, "SpellID") ?? -1;
		if (!ROLE_OPT_TARGET_SPELL_IDS.has(spellID)) return false;
		const params = readArrayField(message, "Params");
		const param = readNumberField(message, "Param");
		const type = readNumberField(message, "Type");
		const targetSeatID = readNumberField(message, "targetSeatID");
		const srcSeatID = readNumberField(message, "SrcSeatID");
		switch (spellID) {
			case 4:
			case 5:
			case 357:
			case 372:
			case 501:
			case 811:
			case 921:
			case 3119:
			case 3437:
			case 3876:
			case 4025: return targetSeatID !== void 0 && targetSeatID !== 255 && params.length > 0;
			case 361:
			case 774:
			case 851:
			case 3310: return targetSeatID !== void 0 && targetSeatID !== 255 && param === 0 && params.length > 0;
			case 943: return param === 0 && params.length === 1;
			case 898: return srcSeatID !== void 0 && srcSeatID !== 255 && param === 0 && params.length > 2;
			case 987:
			case 988: return targetSeatID !== void 0 && param === 1 && params.length > 2;
			case 2900: return targetSeatID !== void 0 && type === 28 && params.length >= 3;
			case 3483: return targetSeatID !== void 0 && param === 1 && params.length > 0;
			case 3903: return targetSeatID === 255 && param === 0 && (type === 28 && params.length > 2 || type === 29 && params.length === 4);
			default: return false;
		}
	}
	function readArrayField(message, key) {
		const value = readProtocolField(message, key);
		return Array.isArray(value) ? value : [];
	}
	function projectTrackerProtocol(message) {
		if (!isProtocolObject(message)) return null;
		const className = getProtocolClassName(message);
		if (!className) return null;
		if (EMPTY_PAYLOAD_CLASSES.has(className)) return {
			className,
			payload: {}
		};
		const payload = collectRootPayload(message, className);
		appendRequiredNestedPayload(message, className, payload);
		return {
			className,
			payload
		};
	}
	function getProtocolClassName(message) {
		const className = readProtocolField(message, "className");
		if (typeof className === "string" && className) return className;
		const fallbackClassName = readProtocolField(message, "ClassName");
		return typeof fallbackClassName === "string" && fallbackClassName ? fallbackClassName : null;
	}
	function collectRootPayload(message, className) {
		const payload = {};
		const exceptions = ROOT_FIELD_EXCEPTIONS.get(className);
		const allowedFields = ROOT_FIELD_ALLOWLISTS[className];
		for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(message))) {
			if (!descriptor.enumerable || !("value" in descriptor)) continue;
			if (allowedFields && !allowedFields.has(key)) continue;
			if (ROOT_IGNORED_FIELDS.has(key) && !exceptions?.has(key)) continue;
			const value = cloneProtocolValue(descriptor.value);
			if (value !== OMITTED) payload[key] = value;
		}
		applyNestedFieldProjections(className, payload);
		return payload;
	}
	function applyNestedFieldProjections(className, payload) {
		for (const [fieldPath, allowedFields] of Object.entries(NESTED_FIELD_ALLOWLISTS)) {
			const [targetClassName, fieldName] = fieldPath.split(".");
			if (targetClassName !== className) continue;
			const values = payload[fieldName];
			if (!Array.isArray(values)) continue;
			payload[fieldName] = values.map((value) => projectNestedRecord(value, allowedFields));
		}
	}
	function projectNestedRecord(value, allowedFields) {
		if (!isProtocolObject(value)) return value;
		const projected = {};
		for (const field of allowedFields) if (Object.prototype.hasOwnProperty.call(value, field)) projected[field] = value[field];
		return projected;
	}
	function appendRequiredNestedPayload(message, className, payload) {
		if (className === "decodeGameRecordInitInfo") appendRecordInitPayload(message, payload);
		if (className === "decodeGsClientUserSeatFlagNtf") appendSeatInfoPayload(message, payload);
	}
	function appendRecordInitPayload(message, payload) {
		const protoObj = readProtocolField(message, "ProtoObj");
		if (!isProtocolObject(protoObj)) return;
		const recordInfo = {};
		for (const key of ["gameId", "matchName"]) {
			const value = cloneProtocolValue(readProtocolField(protoObj, key));
			if (value !== OMITTED) recordInfo[key] = value;
		}
		if (Object.keys(recordInfo).length > 0) payload.ProtoObj = recordInfo;
	}
	function appendSeatInfoPayload(message, payload) {
		const data = readProtocolField(message, "data");
		if (!isProtocolObject(data)) return;
		const protoObj = readProtocolField(data, "protoObj");
		if (!isProtocolObject(protoObj)) return;
		const seatinfo = readProtocolField(protoObj, "seatinfo");
		if (!Array.isArray(seatinfo)) return;
		payload.data = { protoObj: { seatinfo: seatinfo.map(projectSeatInfo) } };
	}
	function projectSeatInfo(value) {
		if (!isProtocolObject(value)) return {};
		const result = {};
		TRACKER_SEAT_INFO_FIELDS.forEach((key) => {
			const fieldValue = cloneProtocolValue(readProtocolField(value, key));
			if (fieldValue !== OMITTED) result[key] = fieldValue;
		});
		return result;
	}
	function readNumberField(message, key) {
		const value = Number(readProtocolField(message, key));
		return Number.isFinite(value) ? value : void 0;
	}
	function readProtocolField(message, key) {
		const descriptor = Object.getOwnPropertyDescriptor(message, key);
		if (descriptor && "value" in descriptor) return descriptor.value;
		try {
			return message[key];
		} catch {
			return;
		}
	}
	function cloneProtocolValue(value, seen = new WeakSet(), depth = 0) {
		if (value === null || typeof value === "string" || typeof value === "boolean") return value;
		if (typeof value === "number") return Number.isFinite(value) ? value : OMITTED;
		if (typeof value === "bigint") return value.toString();
		if (typeof value !== "object") return OMITTED;
		if (depth >= MAX_PROTOCOL_DEPTH || value instanceof Date) return OMITTED;
		if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return OMITTED;
		if (seen.has(value)) return OMITTED;
		seen.add(value);
		if (Array.isArray(value)) {
			const result = value.map((item) => {
				const clonedItem = cloneProtocolValue(item, seen, depth + 1);
				return clonedItem === OMITTED ? null : clonedItem;
			});
			seen.delete(value);
			return result;
		}
		const result = {};
		for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
			if (!descriptor.enumerable || !("value" in descriptor)) continue;
			if (NESTED_IGNORED_FIELDS.has(key)) continue;
			const clonedValue = cloneProtocolValue(descriptor.value, seen, depth + 1);
			if (clonedValue !== OMITTED) result[key] = clonedValue;
		}
		seen.delete(value);
		return result;
	}
	function isProtocolObject(value) {
		return value !== null && typeof value === "object";
	}
	var DATABASE_NAME = "dxc-tracker-protocol-recording";
	var DATABASE_VERSION = 2;
	var RECORD_STORE_NAME = "records";
	var DOWNLOAD_FILE_NAME = "tracker-protocols.jsonl";
	var MAX_PROTOCOL_RECORDS = 1e4;
	var active = false;
	var sequence = 0;
	var limitReached = false;
	var currentSession;
	var lastSessionStartedAt = 0;
	var records = [];
	var pendingRecords = [];
	var flushScheduled = false;
	var loadGeneration = 0;
	var databasePromise = null;
	var storageQueue = Promise.resolve();
	var statusNotificationScheduled = false;
	var statusListeners = new Set();
	function startProtocolRecording() {
		loadGeneration++;
		active = true;
		sequence = 0;
		limitReached = false;
		currentSession = createRecordingSession();
		records = [];
		pendingRecords = [];
		flushScheduled = false;
		enqueueStorage(clearStoredRecords);
		notifyStatusListeners();
		return getProtocolRecordingStatus();
	}
	async function stopProtocolRecording() {
		active = false;
		flushPendingRecords();
		notifyStatusListeners();
		await storageQueue;
		return getProtocolRecordingStatus();
	}
	async function clearProtocolRecording() {
		loadGeneration++;
		active = false;
		sequence = 0;
		limitReached = false;
		currentSession = null;
		records = [];
		pendingRecords = [];
		flushScheduled = false;
		const clearOperation = enqueueStorage(clearStoredRecords);
		notifyStatusListeners();
		await clearOperation;
		return getProtocolRecordingStatus();
	}
	async function initializeProtocolRecording() {
		if (currentSession === null) return getProtocolRecordingStatus();
		const expectedGeneration = loadGeneration;
		await storageQueue;
		const storedRecording = await readStoredRecordingSafely(currentSession?.id);
		if (expectedGeneration !== loadGeneration || active || records.length > 0) return getProtocolRecordingStatus();
		if (storedRecording === void 0) return getProtocolRecordingStatus();
		if (storedRecording === null) {
			if (currentSession === void 0) currentSession = null;
			return getProtocolRecordingStatus();
		}
		currentSession = storedRecording.session;
		lastSessionStartedAt = Math.max(lastSessionStartedAt, currentSession.startedAt);
		records = storedRecording.records.slice(0, MAX_PROTOCOL_RECORDS);
		sequence = records[records.length - 1]?.seq ?? 0;
		limitReached = storedRecording.records.length >= MAX_PROTOCOL_RECORDS;
		notifyStatusListeners();
		return getProtocolRecordingStatus();
	}
	function recordTrackerProtocol(message, context = {}) {
		if (!active || !shouldRecordTrackerProtocol(message, context)) return;
		try {
			const projected = projectTrackerProtocol(message);
			if (!projected) return;
			const record = {
				seq: ++sequence,
				...projected
			};
			records.push(record);
			pendingRecords.push(record);
			if (records.length >= 1e4) {
				active = false;
				limitReached = true;
				flushPendingRecords();
			} else schedulePendingRecordFlush();
			notifyStatusListeners();
		} catch (error) {
			console.warn("[protocol-recorder] 协议录制失败，已跳过当前消息", error);
		}
	}
	async function exportProtocolRecording() {
		flushPendingRecords();
		await storageQueue;
		let exportRecords = records;
		if (exportRecords.length === 0 && currentSession !== null) {
			const storedRecording = await readStoredRecordingSafely(currentSession?.id);
			if (storedRecording && currentSession === void 0) {
				currentSession = storedRecording.session;
				lastSessionStartedAt = Math.max(lastSessionStartedAt, currentSession.startedAt);
			}
			exportRecords = storedRecording?.records ?? [];
		}
		if (exportRecords.length === 0) return false;
		downloadRecording(serializeProtocolRecording(exportRecords));
		return true;
	}
	function serializeProtocolRecording(recording) {
		if (recording.length === 0) return "";
		return recording.map((record) => JSON.stringify(record)).join("\n") + "\n";
	}
	function getProtocolRecordingStatus() {
		return {
			active,
			count: records.length,
			limitReached
		};
	}
	function subscribeProtocolRecordingStatus(listener) {
		statusListeners.add(listener);
		listener(getProtocolRecordingStatus());
		return () => statusListeners.delete(listener);
	}
	function schedulePendingRecordFlush() {
		if (flushScheduled) return;
		flushScheduled = true;
		queueMicrotask(flushPendingRecords);
	}
	function flushPendingRecords() {
		flushScheduled = false;
		if (pendingRecords.length === 0) return;
		const batch = pendingRecords;
		pendingRecords = [];
		const session = currentSession;
		if (!session) return;
		enqueueStorage(() => putStoredRecords(session, batch));
	}
	function notifyStatusListeners() {
		if (statusNotificationScheduled) return;
		statusNotificationScheduled = true;
		queueMicrotask(() => {
			statusNotificationScheduled = false;
			const status = getProtocolRecordingStatus();
			statusListeners.forEach((listener) => listener(status));
		});
	}
	function enqueueStorage(operation) {
		storageQueue = storageQueue.then(operation).catch((error) => {
			console.warn("[protocol-recorder] IndexedDB 写入失败，当前录制仍保留在内存中", error);
		});
		return storageQueue;
	}
	async function putStoredRecords(session, batch) {
		const database = await openDatabase();
		if (!database || batch.length === 0) return;
		const transaction = database.transaction(RECORD_STORE_NAME, "readwrite");
		const store = transaction.objectStore(RECORD_STORE_NAME);
		batch.forEach((record) => {
			const storedRecord = {
				...record,
				sessionId: session.id,
				sessionStartedAt: session.startedAt
			};
			store.put(storedRecord);
		});
		await waitForTransaction(transaction);
	}
	async function clearStoredRecords() {
		const database = await openDatabase();
		if (!database) return;
		const transaction = database.transaction(RECORD_STORE_NAME, "readwrite");
		transaction.objectStore(RECORD_STORE_NAME).clear();
		await waitForTransaction(transaction);
	}
	async function readStoredRecording(sessionId) {
		const database = await openDatabase();
		if (!database) return null;
		return new Promise((resolve, reject) => {
			const request = database.transaction(RECORD_STORE_NAME, "readonly").objectStore(RECORD_STORE_NAME).getAll();
			request.onsuccess = () => {
				const storedRecords = request.result.filter(isStoredTrackerProtocol);
				const selectedSessionId = sessionId ?? findLatestSessionId(storedRecords);
				if (!selectedSessionId) {
					resolve(null);
					return;
				}
				const sessionRecords = storedRecords.filter((record) => record.sessionId === selectedSessionId).sort((left, right) => left.seq - right.seq);
				const firstRecord = sessionRecords[0];
				if (!firstRecord) {
					resolve(null);
					return;
				}
				resolve({
					session: {
						id: firstRecord.sessionId,
						startedAt: firstRecord.sessionStartedAt
					},
					records: sessionRecords.slice(0, MAX_PROTOCOL_RECORDS).map(toRecordedTrackerProtocol)
				});
			};
			request.onerror = () => reject(request.error);
		});
	}
	async function readStoredRecordingSafely(sessionId) {
		try {
			return await readStoredRecording(sessionId);
		} catch (error) {
			console.warn("[protocol-recorder] IndexedDB 读取失败", error);
			return;
		}
	}
	function createRecordingSession() {
		const startedAt = Math.max(Date.now(), lastSessionStartedAt + 1);
		lastSessionStartedAt = startedAt;
		return {
			id: `${startedAt}-${createSessionIdSuffix()}`,
			startedAt
		};
	}
	function createSessionIdSuffix() {
		const cryptoApi = globalThis.crypto;
		if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
		if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("当前环境不支持安全随机数");
		const randomBytes = new Uint8Array(16);
		cryptoApi.getRandomValues(randomBytes);
		return Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
	}
	function findLatestSessionId(records) {
		return records.reduce((current, record) => {
			if (!current || record.sessionStartedAt > current.sessionStartedAt) return record;
			if (record.sessionStartedAt === current.sessionStartedAt && record.sessionId > current.sessionId) return record;
			return current;
		}, null)?.sessionId ?? null;
	}
	function isStoredTrackerProtocol(value) {
		if (!value || typeof value !== "object") return false;
		const record = value;
		return typeof record.sessionId === "string" && Number.isFinite(record.sessionStartedAt) && Number.isInteger(record.seq) && typeof record.className === "string" && Boolean(record.payload) && typeof record.payload === "object" && !Array.isArray(record.payload);
	}
	function toRecordedTrackerProtocol(record) {
		return {
			seq: record.seq,
			className: record.className,
			payload: record.payload
		};
	}
	function openDatabase() {
		if (databasePromise) return databasePromise;
		if (typeof indexedDB === "undefined") return Promise.resolve(null);
		let resolveDatabase = () => void 0;
		const openPromise = new Promise((resolve) => {
			resolveDatabase = resolve;
		});
		databasePromise = openPromise;
		let request;
		try {
			request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		} catch {
			databasePromise = null;
			resolveDatabase(null);
			return openPromise;
		}
		let settled = false;
		const resolveFailure = () => {
			if (settled) return;
			settled = true;
			if (databasePromise === openPromise) databasePromise = null;
			resolveDatabase(null);
		};
		request.onupgradeneeded = () => {
			const database = request.result;
			if (database.objectStoreNames.contains(RECORD_STORE_NAME)) database.deleteObjectStore(RECORD_STORE_NAME);
			database.createObjectStore(RECORD_STORE_NAME, { keyPath: ["sessionId", "seq"] });
		};
		request.onsuccess = () => {
			if (settled) {
				request.result.close();
				return;
			}
			settled = true;
			resolveDatabase(request.result);
		};
		request.onerror = resolveFailure;
		request.onblocked = resolveFailure;
		return openPromise;
	}
	function waitForTransaction(transaction) {
		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	function downloadRecording(content) {
		if (typeof document === "undefined" || typeof URL === "undefined") return;
		const blob = new Blob([content], { type: "application/x-ndjson;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = DOWNLOAD_FILE_NAME;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
	var tooltipDelegationBound = false;
	var activeTooltipTarget = null;
	var activeTooltipElement = null;
	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}
	function getReusableTooltip(owner = document.body) {
		if (!activeTooltipElement) {
			activeTooltipElement = document.createElement("div");
			activeTooltipElement.classList.add("tooltip", "top");
			owner.appendChild(activeTooltipElement);
		} else if (!activeTooltipElement.isConnected || activeTooltipElement.parentElement !== owner) owner.appendChild(activeTooltipElement);
		return activeTooltipElement;
	}
	function hideReusableTooltip() {
		if (!activeTooltipElement) return;
		activeTooltipElement.classList.remove("visible", "dialog-tooltip");
		activeTooltipElement.style.visibility = "hidden";
		activeTooltipElement.style.left = "-9999px";
		activeTooltipElement.style.top = "-9999px";
		activeTooltipTarget = null;
	}
	function prepareTooltip(mark, dialog) {
		const tooltip = getReusableTooltip(dialog || document.body);
		tooltip.className = dialog ? "tooltip top dialog-tooltip" : "tooltip top";
		tooltip.textContent = mark.getAttribute("data-tooltip");
		tooltip.style.maxWidth = "";
		tooltip.style.visibility = "hidden";
		tooltip.style.left = "-9999px";
		tooltip.style.top = "-9999px";
		tooltip.removeAttribute("popover");
		return tooltip;
	}
	function positionTooltip({ tooltip, anchor, dialog }) {
		const rect = anchor.getBoundingClientRect();
		const boundsRect = dialog?.getBoundingClientRect();
		const offset = 8;
		const padding = 4;
		if (dialog && boundsRect) {
			tooltip.style.maxWidth = `${Math.min(200, Math.max(120, boundsRect.width - padding * 2))}px`;
			const left = clamp(rect.left - boundsRect.left + rect.width / 2 - tooltip.offsetWidth / 2, padding, Math.max(padding, boundsRect.width - tooltip.offsetWidth - padding));
			let top = rect.top - boundsRect.top - tooltip.offsetHeight - offset;
			if (top < padding) top = rect.bottom - boundsRect.top + offset;
			top = clamp(top, padding, Math.max(padding, boundsRect.height - tooltip.offsetHeight - padding));
			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			return;
		}
		const left = clamp(rect.left + rect.width / 2 - tooltip.offsetWidth / 2, offset, Math.max(offset, window.innerWidth - tooltip.offsetWidth - offset));
		let top = rect.top - tooltip.offsetHeight - offset;
		if (top < offset) top = rect.bottom + offset;
		top = clamp(top, offset, Math.max(offset, window.innerHeight - tooltip.offsetHeight - offset));
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	}
	function showReusableTooltip(mark) {
		if (!mark?.getAttribute?.("data-tooltip")) return;
		const dialog = mark.closest("dialog[open]");
		const tooltip = prepareTooltip(mark, dialog);
		positionTooltip({
			tooltip,
			anchor: mark.querySelector(".switch") || mark,
			dialog
		});
		tooltip.style.visibility = "";
		tooltip.classList.add("visible");
		activeTooltipTarget = mark;
	}
	function bindDelegatedTooltips() {
		if (tooltipDelegationBound) return;
		tooltipDelegationBound = true;
		document.addEventListener("mouseover", (event) => {
			const mark = event.target?.closest?.(".switch-container, .calRes");
			if (!mark || !mark.getAttribute("data-tooltip") || mark.contains(event.relatedTarget)) return;
			showReusableTooltip(mark);
		});
		document.addEventListener("mouseout", (event) => {
			const mark = event.target?.closest?.(".switch-container, .calRes");
			if (!mark || mark !== activeTooltipTarget || mark.contains(event.relatedTarget)) return;
			hideReusableTooltip();
		});
	}
	var unsubscribeRenderedMainHandCardIDs = null;
	function getRenderedPeiXiuHandSuitColors() {
		const cardIDs = getRenderedMainHandCardIDs();
		if (cardIDs === null) return null;
		const cardConfig = CardConfig.GetInstance();
		return cardIDs.map((id) => Number(cardConfig.getCardColor(id))).filter((color) => color >= 1 && color <= 4);
	}
	function refreshPeiXiuHandSuitColors() {
		const state = Game.getSpellState(4022);
		if (!state?.usesMainHandMirror || !state.result) return;
		const handSuitColors = getRenderedPeiXiuHandSuitColors();
		if (handSuitColors === null) return;
		if (Array.isArray(state.handSuitColors) && state.handSuitColors.length === handSuitColors.length && state.handSuitColors.every((color, index) => color === handSuitColors[index])) return;
		const nextState = {
			...state,
			handSuitColors
		};
		Game.setSpellState(4022, nextState);
		renderPeiXiuMapWindow(nextState, SpellExtendConfig.GetInstance().PeiXiuBonus);
	}
	function bindPeiXiuHandSuitColorRefresh() {
		if (unsubscribeRenderedMainHandCardIDs) return;
		unsubscribeRenderedMainHandCardIDs = subscribeRenderedMainHandCardIDs(refreshPeiXiuHandSuitColors);
	}
	function unbindPeiXiuHandSuitColorRefresh() {
		unsubscribeRenderedMainHandCardIDs?.();
		unsubscribeRenderedMainHandCardIDs = null;
	}
	function bindInitialResize(globalConfig, resize) {
		window.WDVerSion = "1.0.0";
		window.padding = globalConfig.padding || 0;
		window.addEventListener("resize", resize, true);
	}
	function removeInjectedDom(globalState) {
		unbindPeiXiuHandSuitColorRefresh();
		unbindTrackerVisibilityShortcut();
		document.getElementById("seatUI")?.remove();
		document.getElementById("cusBGDiv")?.remove();
		document.getElementById("tracker-shell")?.remove();
		destroyPeiXiuMapWindow();
		document.getElementById("peixiu-map-style")?.remove();
		globalState.isFrameAdd = false;
	}
	function cleanupLifecycle({ resize, scheduleSetGameSize, SGSresize, globalState }) {
		window.removeEventListener("resize", resize, true);
		window.removeEventListener("resize", scheduleSetGameSize);
		window.removeEventListener("SGSresize", SGSresize);
		removeInjectedDom(globalState);
		return true;
	}
	function waitForLegacyFrameReady(initFrame) {
		return new Promise((resolve, reject) => {
			function checkLibraries() {
				return new Promise((libResolve) => {
					function checkLibs() {
						if (typeof JSZipUtils !== "undefined" && typeof CtrUtil !== "undefined" && typeof CtrUtil?.Ctr?.Ofb_Dec !== "undefined" && typeof SystemContext !== "undefined" && document.getElementById("bgDiv")) initFrame(true).then(libResolve);
						else if (typeof PUERTS_JS_RESOURCES !== "undefined") libResolve(true);
						else setTimeout(checkLibs, 1e3);
					}
					checkLibs();
				});
			}
			Promise.all([checkLibraries()]).then(resolve).catch(reject);
		});
	}
	function installSystemContextResizeDispatchers() {
		SystemContext._gameScreenType = SystemContext.gameScreenType;
		SystemContext._gameScale = SystemContext.gameScale;
		Object.defineProperty(SystemContext, "gameScreenType", {
			get: function() {
				return this._gameScreenType;
			},
			set: function(value) {
				if (this._gameScreenType !== value) {
					this._gameScreenType = value;
					window.dispatchEvent(new Event("SGSresize"));
				}
			}
		});
		Object.defineProperty(SystemContext, "gameScale", {
			get: function() {
				return this._gameScale;
			},
			set: function(value) {
				if (this._gameScale !== value) {
					this._gameScale = value;
					window.dispatchEvent(new Event("SGSresize"));
				}
			}
		});
	}
	function addSeatUI(globalConfig) {
		var seatUI = document.createElement("div");
		seatUI.id = "seatUI";
		seatUI.style.position = "absolute";
		seatUI.style.top = "50%";
		seatUI.style.left = "50%";
		seatUI.style.transform = "translate(-50%, -50%)";
		seatUI.style.pointerEvents = "none";
		seatUI.style.display = "";
		var deckEdgeUI = document.createElement("div");
		deckEdgeUI.id = "deckEdgeUI";
		deckEdgeUI.className = "sorderContainer deckEdgeUI";
		deckEdgeUI.style.display = "none";
		seatUI.appendChild(deckEdgeUI);
		const seatSlotFragment = document.createDocumentFragment();
		for (let i = 1; i <= 8; i++) {
			const orderContainer = document.createElement("div");
			orderContainer.className = "sorderContainer";
			orderContainer.id = "or" + i;
			orderContainer.style.display = "none";
			const orderBody = document.createElement("div");
			orderBody.className = "sorder-body";
			orderBody.classList.add("sNo" + i);
			orderBody.id = "s" + i;
			orderContainer.appendChild(orderBody);
			seatSlotFragment.appendChild(orderContainer);
		}
		seatUI.appendChild(seatSlotFragment);
		globalConfig.seatUISwitch ? seatUI.style.display = "block" : (seatUI.style.display = "none", seatUI.querySelectorAll(":scope > *").forEach((el) => el.style.display = "none"));
		document.body.appendChild(seatUI);
	}
	function resetOrderContainer() {
		for (let i = 0; i <= 7; i++) {
			const o = "or" + (i + 1);
			const orderContainer = document.querySelector("#seatUI #" + o);
			if (!orderContainer) continue;
			orderContainer.style.display = "flex";
			orderContainer.style.visibility = "hidden";
			orderContainer.style.removeProperty("top");
			orderContainer.style.removeProperty("left");
			orderContainer.style.removeProperty("width");
		}
	}
	function hideOrderContainer(size) {
		for (let i = 7; i >= size; i--) {
			const o = "or" + (i + 1);
			const orderContainer = document.querySelector("#seatUI #" + o);
			if (!orderContainer) continue;
			orderContainer.style.display = "none";
			orderContainer.style.visibility = "hidden";
		}
	}
	function hideSelfOrderContainer(displayID) {
		if (!displayID) return false;
		const orderContainer = document.querySelector("#seatUI #or" + displayID);
		if (!orderContainer) return false;
		orderContainer.style.display = "none";
		orderContainer.style.visibility = "hidden";
		return true;
	}
	function showOrderContainers() {
		for (let i = 1; i <= 8; i++) {
			const orderContainer = document.querySelector("#seatUI #or" + i);
			if (!orderContainer || orderContainer.style.display === "none") continue;
			orderContainer.style.visibility = "visible";
		}
	}
	var STYLE_ID = "dxc-shell-style";
	function ensureStyle() {
		let style = document.getElementById(STYLE_ID);
		if (style) return;
		style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = `
    #tracker-shell {
      position: fixed;
      overflow: hidden;
      resize: vertical;
      top: 31px;
      right: 155px;
      width: 230px;
      height: 500px;
      z-index: 10000000000;
      display: flex;
      flex-direction: column;
      color: #f2de9c;
      background: rgb(35, 32, 29);
      user-select: none;
      text-align: left;
      transition: width 200ms, opacity 200ms;
      border-radius: 8px;
      transform-origin: top right;
      transform: translate(0px, 0px);
    }
    #tracker-shell.collapsed {
      height: 30px !important;
      width: 75px !important;
      opacity: 0.6 !important;
      resize: none !important;
    }
    #tracker-shell .header {
      margin: 1px;
      user-select: none;
      cursor: grab;
      display: flex;
      align-items: center;
      font-size: 20px;
      border-radius: 5px;
    }
    #tracker-shell #title {
      margin-right: auto;
    }
    #tracker-shell #toggle-me {
      text-align: center;
      color: #f2de9c;
      background: rgb(107, 30, 30);
      border-radius: 6px;
      width: 26px;
      height: 26px;
      border: 1px solid rgb(212, 212, 162);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 1px;
      font-size: 20px;
    }
    #tracker-shell #toggle-me:hover {
      background-color: rgb(130, 30, 30);
    }
    #tracker-shell .tracker-content {
      border: none;
      width: 230px;
      height: 100%;
      margin: 0px;
      overflow: hidden;
    }
    #tracker-shell.collapsed .tracker-content {
      display: none !important;
    }
  `;
		document.head.appendChild(style);
	}
	function createMainShell(version) {
		ensureStyle();
		const div = document.createElement("div");
		div.id = "tracker-shell";
		const header = document.createElement("p");
		header.id = "header";
		header.className = "header";
		const title = document.createElement("span");
		title.id = "title";
		title.style = "margin-right: auto;";
		title.innerText = "三国杀小抄" + version;
		div.appendChild(header);
		const btn = document.createElement("button");
		btn.innerText = "-";
		btn.id = "toggle-me";
		btn.type = "button";
		header.appendChild(title);
		header.appendChild(btn);
		document.body.appendChild(div);
		bindTrackerVisibilityShortcut();
		const iframe = document.createElement("div");
		iframe.className = "tracker-content";
		div.append(iframe);
		return {
			div,
			iframe
		};
	}
	var recordingSwitch = null;
	var exportButton = null;
	var clearButton = null;
	var statusElement = null;
	var unsubscribeStatus = null;
	function bindProtocolRecorderControls() {
		unbindProtocolRecorderControls();
		recordingSwitch = document.getElementById("protocolRecordSwitch");
		exportButton = document.getElementById("protocolRecordExport");
		clearButton = document.getElementById("protocolRecordClear");
		statusElement = document.getElementById("protocolRecordStatus");
		if (!recordingSwitch || !exportButton || !clearButton || !statusElement) return;
		recordingSwitch.onchange = handleRecordingSwitchChange;
		exportButton.onclick = handleExportClick;
		clearButton.onclick = handleClearClick;
		unsubscribeStatus = subscribeProtocolRecordingStatus(renderProtocolRecordingStatus);
		initializeProtocolRecording();
	}
	function unbindProtocolRecorderControls() {
		if (recordingSwitch) recordingSwitch.onchange = null;
		if (exportButton) exportButton.onclick = null;
		if (clearButton) clearButton.onclick = null;
		unsubscribeStatus?.();
		recordingSwitch = null;
		exportButton = null;
		clearButton = null;
		statusElement = null;
		unsubscribeStatus = null;
	}
	function handleRecordingSwitchChange() {
		if (!recordingSwitch) return;
		if (recordingSwitch.checked) {
			startProtocolRecording();
			addTooltip("已开始录制记牌协议，新的录制会覆盖上一次记录", "acTooltip", 4e3);
			return;
		}
		stopProtocolRecording().then(({ count }) => {
			addTooltip(`已停止协议录制，共保存 ${count} 条`, "acTooltip", 4e3);
		}).catch((error) => {
			console.warn("[protocol-recorder] 停止协议录制失败", error);
			try {
				addTooltip("停止协议录制失败，请查看控制台", "acTooltip", 4e3);
			} catch (tooltipError) {
				console.warn("[protocol-recorder] 停止录制失败提示未能显示", tooltipError);
			}
		});
	}
	async function handleExportClick() {
		try {
			addTooltip(await exportProtocolRecording() ? "记牌协议已导出" : "没有可导出的协议记录", "acTooltip", 4e3);
		} catch (error) {
			console.warn("[protocol-recorder] 协议导出失败", error);
			addTooltip("协议导出失败，请查看控制台", "acTooltip", 4e3);
		}
	}
	async function handleClearClick() {
		await clearProtocolRecording();
		addTooltip("已清空协议记录", "acTooltip", 4e3);
	}
	function renderProtocolRecordingStatus(status) {
		if (!recordingSwitch || !exportButton || !clearButton || !statusElement) return;
		recordingSwitch.checked = status.active;
		exportButton.disabled = status.active || status.count === 0;
		clearButton.disabled = status.active || status.count === 0;
		statusElement.dataset.recording = String(status.active);
		if (status.active) {
			statusElement.textContent = `录制中：${status.count} 条`;
			return;
		}
		if (status.limitReached) {
			statusElement.textContent = `已达上限：${status.count} 条`;
			return;
		}
		statusElement.textContent = status.count > 0 ? `已保存：${status.count} 条` : "未录制";
	}
	var INTERFACE_HTML_URL = "https://www.desuwa.link/tracker/iframe.html";
	async function loadInterfaceHtml(force = false) {
		const response = await fetch(INTERFACE_HTML_URL, { cache: force ? "reload" : "default" });
		if (!response.ok) throw new Error(`加载小抄界面失败：${response.status} ${response.statusText}`);
		return response.text();
	}
	var iframe = null;
	var version = "0.19.1";
	function getTrackedHandNumbers(seatID) {
		const config = CardConfig.GetInstance();
		return tracker.getTrackedPlayerHandCardIDs(seatID).map((id) => config.getCardNumber(id)).filter((number) => number > 0);
	}
	function Init() {
		bindInitialResize(globalConfig, resize);
		console.info("🚀 初始化...");
		return waitForLegacyFrameReady(initFrame);
	}
	function Exit() {
		unbindProtocolRecorderControls();
		stopProtocolRecording();
		Reflect.deleteProperty(window, "innerWidth");
		return cleanupLifecycle({
			resize,
			scheduleSetGameSize,
			SGSresize,
			globalState
		});
	}
	function resize() {
		const padding = Number(window.padding) || 0;
		if (padding > 0) window.innerWidth = document.documentElement.clientWidth - padding;
		else Reflect.deleteProperty(window, "innerWidth");
		document.documentElement.style.setProperty("--sgs-center-x", `${window.innerWidth / 2}px`);
	}
	function refreshSidebarViewport() {
		resize();
		window.dispatchEvent(new Event("resize"));
	}
	function SGSresize() {
		window.dispatchEvent(new Event("resize"));
	}
	var updateTimeout;
	function scheduleSetGameSize() {
		if (updateTimeout) clearTimeout(updateTimeout);
		updateTimeout = setTimeout(() => {
			setGameSize();
			updateTimeout = null;
		}, 500);
	}
	async function initFrame(force = false) {
		if (typeof SystemContext == "undefined") return;
		if (force) removeInjectedDom(globalState);
		if (!globalState.isFrameAdd) {
			window.addEventListener("resize", scheduleSetGameSize);
			installSystemContextResizeDispatchers();
			window.addEventListener("SGSresize", SGSresize);
			try {
				document.getElementById("bgDiv").firstElementChild.draggable = false;
				document.querySelector("link[rel=stylesheet]")?.remove();
			} catch {
				console.error("移除4399服的CSS失败");
			}
			addSeatUI(globalConfig);
			await addFrame();
			bindPeiXiuHandSuitColorRefresh();
			globalState.isFrameAdd = true;
			return ConfigManager.GetInstance().loadAndParseConfigs();
		}
	}
	function setGameSize() {
		if (!SystemContext) return;
		UI.width = SystemContext.gameWidth * SystemContext.gameScale >> 0;
		UI.height = SystemContext.gameHeight * SystemContext.gameScale >> 0;
		UI.scale = SystemContext.gameScale;
		if (UI.seatUIs?.length > 0) {
			getSeatUiPos();
			if (UI.firstUpdateSeatUI) drawSeatUIs();
		}
		const app = {
			width: (SystemContext.gameWidth * SystemContext.gameScale >> 0) / window.devicePixelRatio,
			height: (SystemContext.gameHeight * SystemContext.gameScale >> 0) / window.devicePixelRatio
		};
		if (globalConfig.padding && document.getElementById("tracker-shell")) {
			document.getElementById("bgDiv").style.width = document.documentElement.clientWidth + "px";
			document.getElementById("tracker-shell").style.height = "100%";
			document.getElementById("tracker-shell").style.right = "0px";
			document.getElementById("tracker-shell").style.top = "0px";
		} else document.getElementById("bgDiv").style.width = document.documentElement.clientWidth + "px";
		const seatUI = document.getElementById("seatUI");
		const top = ((window.innerHeight * window.devicePixelRatio - SystemContext.gameScale * SystemContext.gameHeight) / (2 * window.devicePixelRatio) + SystemContext.gameScale * SystemContext.gameHeight / 2) / window.devicePixelRatio;
		seatUI.style.width = `${app.width}px`;
		seatUI.style.height = `${app.height}px`;
		seatUI.style.left = window.innerWidth / 2 + "px";
		seatUI.style.top = top + "px";
		UI.centerX = window.innerWidth > app.width ? app.width / 2 : window.innerWidth / 2;
		UI.centerY = app.height / 2;
		document.documentElement.style.setProperty("--sgs-center-x", `${UI.centerX}px`);
	}
	function getSeatUiPos() {
		const list = UI.seatUIs || [];
		const metrics = getSeatLayoutMetrics();
		UI.ScaleWidth = metrics.seatWidth;
		UI.ScaleHeight = metrics.seatHeight;
		if (list.length <= 1) return;
		const seatCount = getSeatLayoutCount(list);
		let nextIndex = 1;
		nextIndex = layoutRightSeats(list, nextIndex, seatCount.right, metrics);
		nextIndex = layoutTopSeats(list, nextIndex, seatCount.top, metrics);
		layoutLeftSeats(list, nextIndex, seatCount.left, metrics);
	}
	function getSeatLayoutMetrics() {
		const scale = UI.scale;
		return {
			scale,
			dpr: window.devicePixelRatio,
			width: UI.width,
			height: UI.height,
			seatWidth: UI.unscaledWidth * scale,
			seatHeight: UI.unscaledHeight * scale,
			selfSeatHeight: UI.selfSeatUiUnscaledHeight * scale,
			rightBarWidth: UI.rightBarWidth * scale,
			topPadding: (UI.paddingTop + 10) * scale
		};
	}
	function getSeatLayoutCount(list) {
		const otherSeatCount = list.length - 1;
		let top = getDefaultTopSeatCount(otherSeatCount);
		let right = otherSeatCount - top >> 1;
		let left = otherSeatCount - right - top;
		if (Game.isDouDiZhu && list.length === 3) {
			const myFixedViewId = list[0]?.fixedViewId;
			if (myFixedViewId === 2) {
				top = 1;
				right = 1;
				left = 0;
			} else if (myFixedViewId === 3) {
				top = 1;
				left = 1;
				right = 0;
			}
		}
		if (Game.isShanHeTu && list.length === 3 && UI.friendGeneral === 1) {
			top = 1;
			left = 1;
			right = 0;
		}
		return {
			top,
			right,
			left
		};
	}
	function getDefaultTopSeatCount(otherSeatCount) {
		if (otherSeatCount < 3) return otherSeatCount;
		if (otherSeatCount === 3) return 1;
		if (otherSeatCount === 4 || otherSeatCount === 6) return 2;
		if (otherSeatCount === 5 || otherSeatCount === 7) return 3;
		return 0;
	}
	function layoutRightSeats(list, startIndex, count, metrics) {
		if (count <= 0) return startIndex;
		const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics);
		const endIndex = startIndex + count;
		const x = metrics.width - metrics.seatWidth - UI.paddingRight * metrics.scale - metrics.rightBarWidth;
		let y = getSideSeatsStartY(measuredHeight, metrics) + measuredHeight;
		UI.verticalGap = gap;
		for (let index = startIndex; index < endIndex; index += 1) {
			y -= metrics.seatHeight;
			setSeatPosition(list[index], "Right", x - 5, y + metrics.seatHeight, metrics.dpr);
			y -= gap;
		}
		return endIndex;
	}
	function layoutTopSeats(list, startIndex, count, metrics) {
		if (count <= 0) return startIndex;
		let measuredWidth = metrics.seatWidth * count;
		const gap = (metrics.width - metrics.rightBarWidth - measuredWidth) * .07 >> 0;
		const endIndex = startIndex + count;
		const y = metrics.topPadding + metrics.seatHeight;
		measuredWidth += (count - 1) * gap;
		let x = (metrics.width - measuredWidth - metrics.rightBarWidth) / 2 + measuredWidth + (metrics.width <= 1600 ? UI.paddingLeftTopExtra : 0);
		UI.horizontalGap = gap;
		for (let index = startIndex; index < endIndex; index += 1) {
			x -= metrics.seatWidth;
			setSeatPosition(list[index], "Top", x, y, metrics.dpr);
			x -= gap;
		}
		return endIndex;
	}
	function layoutLeftSeats(list, startIndex, count, metrics) {
		if (count <= 0) return startIndex;
		const { measuredHeight, gap } = getVerticalSeatLayout(count, metrics);
		const endIndex = startIndex + count;
		const x = UI.paddingLeft * metrics.scale;
		let y = getSideSeatsStartY(measuredHeight, metrics);
		for (let index = startIndex; index < endIndex; index += 1) {
			setSeatPosition(list[index], "Left", x, y + metrics.seatHeight, metrics.dpr);
			y += metrics.seatHeight + gap;
		}
		return endIndex;
	}
	function getVerticalSeatLayout(count, metrics) {
		let measuredHeight = metrics.seatHeight * count;
		const gap = (metrics.height - metrics.selfSeatHeight - measuredHeight) * .25 >> 0;
		measuredHeight += (count - 1) * gap;
		return {
			measuredHeight,
			gap
		};
	}
	function getSideSeatsStartY(measuredHeight, metrics) {
		return (metrics.height - metrics.selfSeatHeight - measuredHeight - UI.paddingTop * metrics.scale - UI.paddingBottom >> 1) + metrics.topPadding + UI.leftRightTop;
	}
	function setSeatPosition(seatUI, displayLocation, x, y, dpr) {
		if (!seatUI) return;
		seatUI.DisplayLocation = displayLocation;
		seatUI.posX = (x >> 0) / dpr;
		seatUI.posY = (y >> 0) / dpr;
	}
	function resetSeatUIs() {
		UI.seatUIs = [];
		UI.firstUpdateSeatUI = false;
		UI.friendGeneral = 0;
		clearZoneMirrors();
	}
	function getSeatUIs() {
		const trackerRoom = tracker.getTrackerRoom();
		if (!trackerRoom?.seatIDs?.length || trackerRoom.mySeatID === void 0) return;
		const { seatIDs, players, mySeatID } = trackerRoom;
		const startIndex = seatIDs.indexOf(Number(mySeatID));
		if (startIndex < 0) return;
		UI.seatUIs = seatIDs.map((_, index) => {
			const seatID = seatIDs[(startIndex + index) % seatIDs.length];
			return {
				seatID,
				fixedViewId: players.get(Number(seatID))?.fixedViewId
			};
		}).filter((seat, index) => index === 0 || players.get(seat.seatID)?.isShown);
		getSeatUiPos();
		if (trackerRoom.firstID !== void 0) drawSeatUIs();
	}
	setTrackerSeatUIReader(getSeatUIs);
	async function addFrame() {
		if (!document.getElementById("tracker-shell")) {
			iframe = createMainShell(version).iframe;
			if (localStorage.getItem("DXCVersion") != version) {
				addTooltip(`小抄已经更新到${version}`, "acTooltip", 15e3);
				localStorage.setItem("DXCVersion", version);
			}
			try {
				iframe.innerHTML = await loadInterfaceHtml();
			} catch (error) {
				console.error("Failed to load iframe content:", error);
			}
			initInjectedInterface({
				container: iframe,
				expandJiePanel,
				bindDelegatedTooltips
			});
		}
		addDragHint();
		buttonClick();
		initDragElement(globalConfig, globalState, refreshSidebarViewport);
	}
	function buttonClick() {
		const detailBlockSwitchIds = [
			"blockKillEffectSwitch",
			"blockSkinStateSwitch",
			"skipAdWindowSwitch",
			"skipPackageWindowSwitch",
			"blockMvpSettlementSwitch"
		];
		const getSwitchElement = (configKey) => document.getElementById(configKey);
		const setSwitchChecked = (configKey, value) => {
			const element = getSwitchElement(configKey);
			if (element) element.checked = value;
		};
		const setConfigSwitch = (configKey, value) => {
			globalConfig[configKey] = value;
			setSwitchChecked(configKey, value);
		};
		const syncEffectBlockSwitchFromDetails = () => {
			setConfigSwitch("effectBlockSwitch", detailBlockSwitchIds.some((configKey) => Boolean(globalConfig[configKey])));
		};
		const syncDetailBlockSwitches = (switchValue) => {
			detailBlockSwitchIds.forEach((configKey) => setConfigSwitch(configKey, switchValue));
		};
		const switchHandlers = {
			seatUISwitch(switchValue) {
				document.getElementById("seatUI").style.display = switchValue ? "block" : "none";
			},
			cardLabelSwitch() {},
			showNameSwitch() {},
			rogueCitySwitch(switchValue) {
				switchValue && UI.cities ? drawCitiesUI(UI.cities) : drawCitiesUI("");
			},
			debugLogSwitch() {},
			peiXiuMapSwitch(switchValue) {
				setPeiXiuMapWindowVisible(switchValue);
			},
			effectBlockSwitch(switchValue) {
				syncDetailBlockSwitches(switchValue);
			},
			blockKillEffectSwitch() {
				syncEffectBlockSwitchFromDetails();
			},
			blockSkinStateSwitch() {
				syncEffectBlockSwitchFromDetails();
			},
			skipAdWindowSwitch() {
				syncEffectBlockSwitchFromDetails();
			},
			skipPackageWindowSwitch() {
				syncEffectBlockSwitchFromDetails();
			},
			blockMvpSettlementSwitch() {
				syncEffectBlockSwitchFromDetails();
			}
		};
		const switchConfigKeys = Object.keys(switchHandlers);
		const toggle = document.getElementById("toggle-me");
		if (toggle) toggle.onclick = function() {
			globalState.closeIframe = !globalState.closeIframe;
			const container = document.getElementById("tracker-shell");
			if (globalState.closeIframe) {
				container.classList.add("collapsed");
				toggle.innerText = "+";
				document.getElementById("title").innerText = "小抄";
				container.style.top = "31px";
				container.style.right = "155px";
				if (globalConfig.padding) {
					globalConfig.padding = 0;
					refreshSidebarViewport();
					container.style.transform = "translate(0px, 0px)";
				}
			} else {
				container.classList.remove("collapsed");
				toggle.innerText = "-";
				document.getElementById("title").innerText = "三国杀小抄0.19.1";
				expandJiePanel({ defer: true });
			}
		};
		function handleSwitchChange(event) {
			const switchElement = event.target;
			if (!switchElement?.matches?.("input[type=\"checkbox\"]")) return;
			const configKey = switchElement.dataset.configKey || switchElement.id;
			const handler = switchHandlers[configKey];
			if (!handler) return;
			const switchValue = switchElement.checked;
			globalConfig[configKey] = switchValue;
			handler(switchValue);
		}
		if (window.padding == 0) toggle?.click();
		refreshSidebarViewport();
		switchConfigKeys.forEach((configKey) => setSwitchChecked(configKey, Boolean(globalConfig[configKey])));
		const switchRoot = document.getElementById("tracker-shell");
		if (switchRoot && !switchRoot.dataset.switchDelegationBound) {
			switchRoot.dataset.switchDelegationBound = "true";
			switchRoot.addEventListener("change", handleSwitchChange);
		}
		syncEffectBlockSwitchFromDetails();
		const mizhuBtn = document.getElementById("mizhu");
		if (mizhuBtn) mizhuBtn.onclick = function() {
			drawMiZhu(getTrackedHandNumbers(Game.myID));
		};
		const openWelfareBtn = document.getElementById("openWelfareBtn");
		if (openWelfareBtn) openWelfareBtn.onclick = function() {
			laya.ShowWindow("WelfareWindow");
		};
		const blockEffectContainer = document.getElementById("blockEffectContainer");
		const blockEffectDialog = document.getElementById("blockEffectDialog");
		if (blockEffectContainer && blockEffectDialog) {
			const explanation = blockEffectContainer.querySelector(".explanation");
			if (explanation) explanation.onclick = function() {
				blockEffectDialog.showModal();
			};
			const closeBtn = blockEffectDialog.querySelector(".dialog-close-btn");
			if (closeBtn) closeBtn.onclick = function() {
				blockEffectDialog.close();
			};
			blockEffectDialog.onclick = function(event) {
				if (event.target === blockEffectDialog) blockEffectDialog.close();
			};
		}
		bindProtocolRecorderControls();
	}
	function expandJiePanel(options = {}) {
		const { defer = false } = options;
		const apply = () => {
			const layaHeader = document.querySelector(".jie-header");
			if (!layaHeader) return;
			const panelContent = layaHeader.nextElementSibling;
			if (!panelContent) return;
			getPanelContentInner(panelContent);
			panelContent.style.removeProperty("max-height");
			layaHeader.classList.add("active");
		};
		if (defer) requestAnimationFrame(apply);
		else apply();
	}
	var closeGameOverWindowsTimer = null;
	var gameOverTask = null;
	function cancelGameOverTask() {
		if (closeGameOverWindowsTimer !== null) {
			clearTimeout(closeGameOverWindowsTimer);
			closeGameOverWindowsTimer = null;
		}
		gameOverTask = null;
	}
	function isCurrentGameOverTask(task) {
		if (gameOverTask !== task) return false;
		return tracker.getTrackerRoom() === task.room;
	}
	function scheduleCloseGameOverWindows(task) {
		if (!globalConfig.blockMvpSettlementSwitch) {
			cleanupGame(task.room);
			return;
		}
		closeGameOverWindowsTimer = setTimeout(async () => {
			closeGameOverWindowsTimer = null;
			if (!isCurrentGameOverTask(task)) return;
			const getWindow = (name) => {
				const win = laya.GetWindow(name);
				return win && win.visible ? win : null;
			};
			for (const windowName of task.windowNames) {
				const win = await wait(() => !isCurrentGameOverTask(task) || getWindow(windowName));
				if (!isCurrentGameOverTask(task)) return;
				if (!win) break;
				win.laterClose?.();
			}
			if (isCurrentGameOverTask(task)) cleanupGame(task.room);
		}, 500);
	}
	function handleGameOver() {
		cancelGameOverTask();
		gameOverTask = {
			room: tracker.getTrackerRoom(),
			windowNames: Game.isShanHeTu ? ["GameResultWindow"] : ["GameResultWindow", "GameMvpWindow"]
		};
		scheduleCloseGameOverWindows(gameOverTask);
	}
	function handleLeaveTable() {
		cleanupGame();
	}
	function cleanupGame(room = tracker.getTrackerRoom()) {
		if (tracker.getTrackerRoom() !== room) return;
		Game.isPassed = null;
		laya.zhanfaMap.clear();
		Game.end();
		destroyPeiXiuMapWindow();
		destroyPingJianWindow();
		resetSeatUIs();
		tracker.destroyTrackerRoom();
	}
	function handleGameTurn(msg) {
		const { TurnCnt } = msg;
		if (typeof TurnCnt !== "number" || !Number.isFinite(TurnCnt)) return;
		if (TurnCnt === 1) {
			laya.zhanfaRegister();
			hideSelfOrderContainer(Game.myDisplayID);
			if (UI.firstUpdateSeatUI) showOrderContainers();
		}
		if (TurnCnt > 0) {
			Game.setTurn(TurnCnt);
			laya.zhanfaReset();
		}
		tracker.scheduleTrackerRender();
	}
	var SeatRoundState = class SeatRoundState {
		static INIT = 0;
		static START = 1;
		static JUDGE = 2;
		static DESKTOP_DEAL = 3;
		static DEAL = 4;
		static DISCARD = 5;
		static OVER = 6;
		static CLEARUP = 7;
		static TURN_OVER = 8;
		static GetRoundStateName(val) {
			switch (val) {
				case SeatRoundState.START: return "开始阶段";
				case SeatRoundState.JUDGE: return "判定阶段";
				case SeatRoundState.DESKTOP_DEAL: return "摸牌阶段";
				case SeatRoundState.DEAL: return "出牌阶段";
				case SeatRoundState.DISCARD: return "弃牌阶段";
				default: return "";
			}
		}
	};
	var ROUND_STATE_FALLBACK_NAMES = {
		[SeatRoundState.INIT]: "回合开始时",
		[SeatRoundState.OVER]: "结束阶段",
		[SeatRoundState.CLEARUP]: "回合结束时",
		[SeatRoundState.TURN_OVER]: "回合结束后"
	};
	function handleGamePhase(msg) {
		const { Round, SeatID } = msg;
		const previousSeatID = Game.currentID;
		Game.enter(Round, SeatID);
		if (Round === SeatRoundState.INIT) {
			laya.resetRoundZhanFa(previousSeatID);
			clearRoundResult();
		}
		updateRoundStateLabel(Round);
		tracker.scheduleTrackerRender();
	}
	function clearRoundResult() {
		const suitEl = document.getElementById("suit");
		if (suitEl) suitEl.innerText = "";
		const resultEl = document.getElementById("result");
		if (resultEl) resultEl.innerHTML = "";
	}
	function updateRoundStateLabel(round) {
		const roundStateName = SeatRoundState.GetRoundStateName(round) || ROUND_STATE_FALLBACK_NAMES[round];
		if (!roundStateName) return;
		const nav = document.getElementById("phrase");
		if (!nav) return;
		const last = getLastDisplayedPhase(nav.innerText);
		if (Game.phase === last) {
			nav.innerText = appendRoundState(nav.innerText, roundStateName, Game.phase);
			return;
		}
		nav.innerText = `${roundStateName} (${Game.phase})`;
	}
	function getLastDisplayedPhase(text) {
		if (!text.endsWith(")")) return void 0;
		const start = text.lastIndexOf("(");
		if (start < 0) return void 0;
		const phaseText = text.slice(start + 1, -1);
		if (!phaseText) return void 0;
		const phase = Number(phaseText);
		return Number.isInteger(phase) ? phase : void 0;
	}
	function appendRoundState(text, roundStateName, phase) {
		const separator = text.lastIndexOf(">");
		const prefix = separator < 0 ? "" : text.slice(0, separator + 1);
		const lastState = separator < 0 ? text : text.slice(separator + 1);
		const phaseStart = lastState.lastIndexOf("(");
		const previousShortName = getShortRoundStateName((phaseStart < 0 ? lastState : lastState.slice(0, phaseStart)).trim());
		const currentShortName = getShortRoundStateName(roundStateName);
		if (!previousShortName) return `${roundStateName} (${phase})`;
		return `${prefix}${previousShortName}>${currentShortName}(${phase})`;
	}
	function getShortRoundStateName(name) {
		let shortName = name;
		if (shortName.startsWith("回合")) shortName = shortName.slice(2);
		if (shortName.endsWith("阶段")) shortName = shortName.slice(0, -2);
		return shortName;
	}
	function getShuangXiongCards(seatID) {
		const player = tracker.getReadyTrackerRoom()?.getPlayer(Number(seatID));
		return (player?.knownHandCards ?? []).concat(player?.equipCards ?? []).filter((card) => card.isKnown === true && card.id > 0);
	}
	function drawShuangXiongTip(msg) {
		if (msg.TriggerSpellData?.[0]?.SpellId != 3269 || msg.TriggerSeatId != Game.myID) return;
		let r = 0;
		let b = 0;
		getShuangXiongCards(msg.TriggerSeatId).forEach((node) => {
			const color = CardConfig.GetInstance().getCardColor(node.id);
			color === 1 || color === 2 ? r++ : (color === 3 || color === 4) && b++;
		});
		document.getElementById("result").innerHTML = "<span class=\"textRes\">【双雄】" + (r > b ? "弃 黑" : r < b ? "弃 红" : "平") + "</span><br><span class=\"textRes\">" + r + "红		" + b + "黑</span>";
	}
	function handleTriggerSpellNew(msg) {
		if (!(msg.TriggerSpellData?.length ? msg.TriggerSpellData : [{}]).length) return;
		drawShuangXiongTip(msg);
	}
	function handleUseSpell(msg) {
		const { SeatID, SpellID, CardIDs = [] } = msg;
		tracker.dispatchSkillProtocolEvent({
			type: "useSpell",
			message: msg
		});
		switch (SpellID) {
			case 3090:
				if (SeatID === Game.currentID && msg.EffectIndex === 1) {
					const prev = Game.getSpellState(3090) ?? 0;
					Game.setSpellState(3090, prev + 1);
				}
				break;
			case 2143: {
				const suits = Game.ensureSpellState(2143, () => new Set());
				const instance = CardConfig.GetInstance();
				for (const id of CardIDs) {
					if (id <= 0) continue;
					suits.add(instance.getCard(id).c);
				}
				setSuitRecord(Array.from(suits).join(""));
				break;
			}
			case 3193:
			case 3185:
			case 3138:
			case 3161:
				Game.phase--;
				break;
			case 13027:
			case 13028:
			case 13029:
			case 13039:
			case 13040:
			case 13041:
			case 13087:
			case 13088:
			case 13089:
			case 13184:
			case 13185:
			case 13293:
			case 13294:
				if (SeatID === Game.myID) laya.zhanfaCounter(SpellID);
				break;
			default: break;
		}
	}
	function handleUpdateRoleDataExNtf(msg) {
		const { Datas, SeatID, DataID } = msg;
		tracker.dispatchSkillProtocolEvent({
			type: "roleData",
			message: msg
		});
		switch (DataID) {
			case 8:
				if (Array.isArray(Datas)) {
					if (msg.Datas[0] === 7017) Game.deleteState("tracker", 7017);
				}
				break;
			case 1:
				if (Game.currentID == SeatID && Array.isArray(Datas)) {
					const shaElement = document.getElementById("sha");
					if (shaElement) shaElement.innerText = "剩余：" + Math.max(0, Datas[2] - Datas[1]);
				}
				break;
			case 15:
				if (!Array.isArray(Datas)) break;
				if (SeatID !== void 0 && SeatID == Game.myID) {
					const isSpecial = Datas[3] > 0;
					const generalId = Datas[0];
					const skillCnt = Datas[1];
					const skillIds = (isSpecial ? [...Datas.slice(2, 3), ...Datas.slice(4)] : Datas.slice(2)).slice(0, skillCnt);
					if (generalId === 0 && Game.isShanHeTu) for (const skillId of skillIds) Game.zhanfaSet.add(skillId);
					if (Game.turn >= 1 && (Game.isShanHeTu || Game.isRoguelike1v1)) setTimeout(() => {
						laya.zhanfaRegister();
						laya.drawCounter();
					}, 0);
				}
				break;
			case 16:
				if (!Array.isArray(Datas)) break;
				if (SeatID === void 0 || SeatID !== Game.myID) break;
				if (Game.turn >= 1 && (Game.isShanHeTu || Game.isRoguelike1v1)) setTimeout(() => {
					laya.zhanfaRegister();
				}, 0);
				break;
			case 17:
				if (!Array.isArray(Datas)) break;
				if (SeatID !== void 0 && SeatID == Game.myID && false);
				break;
			case 4022:
				if (Array.isArray(Datas)) {
					const roleData = parsePeiXiuRoleData(Datas);
					if (!roleData) break;
					const spellExtendConfig = SpellExtendConfig.GetInstance();
					const mapConfig = spellExtendConfig.PeiXiuCellDic.get(roleData.mapId);
					const solvedState = mapConfig ? solvePeiXiuRoleData(mapConfig, Datas) : null;
					const presetRoutes = spellExtendConfig.PeiXiuPresetRoutes.get(roleData.mapId) || [];
					const usesMainHandMirror = Game.myID != null && SeatID != null && Number(Game.myID) === Number(SeatID);
					const handSuitColors = usesMainHandMirror ? getRenderedPeiXiuHandSuitColors() : null;
					const state = solvedState ? {
						...solvedState,
						presetRoutes,
						handSuitColors,
						usesMainHandMirror
					} : {
						...roleData,
						result: null,
						presetRoutes,
						handSuitColors,
						usesMainHandMirror
					};
					Game.setSpellState(4022, state);
					if (state.result) {
						renderPeiXiuMapWindow(state, spellExtendConfig.PeiXiuBonus);
						setPeiXiuMapWindowVisible(Boolean(globalConfig.peiXiuMapSwitch));
					}
				}
				break;
			case 7128:
				if (!Array.isArray(Datas)) break;
				if (SeatID === void 0 || SeatID !== Game.myID) break;
				if (Game.isShanHeTu || Game.isRoguelike1v1) setTimeout(() => {
					laya.zhanfaRegister();
				}, 0);
				break;
			default: break;
		}
	}
	function handleUseCard(msg) {
		const { CardID, spellID, useType } = msg;
		const spell = spellID || msg.spellId;
		const cardIDs = CardID ? [CardID] : msg.cardIds || [];
		if ((msg.SeatID || msg.castSeatId) !== Game.myID) return;
		if (useType == 1) drawLastUseCard(cardIDs, {
			spellId: spell,
			color: msg.color
		});
		if (useType == 1 && spell) {
			if (spell === 1) {
				Game.shaCounter();
				laya.shaCounter();
			}
			Game.useCounter();
			laya.useCounter();
		}
	}
	function registerGamePlayers(infos) {
		cancelGameOverTask();
		resetSeatUIs();
		tracker.initTrackerRoom();
		tracker.registerTrackerPlayers(infos, user.userID);
		resetOrderContainer();
		hideOrderContainer(infos.length);
	}
	function handleRecordStartGame(msg) {
		if (!user.userID) addTooltip("没有识别到uuid, 主视角数据可能会出错", "acTooltip", 4e3);
		const { seatinfo } = msg.data.protoObj;
		registerGamePlayers(seatinfo);
	}
	var CONTAINER_ID = "xcStatusTips";
	var DEFAULT_DURATION = 4e3;
	var FADE_MS = 200;
	var CONTAINER_STYLE = {
		position: "fixed",
		top: "78px",
		left: "50%",
		transform: "translateX(-50%)",
		zIndex: "2147483646",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: "6px",
		pointerEvents: "none"
	};
	var TIP_STYLE = {
		display: "none",
		alignItems: "center",
		justifyContent: "center",
		padding: "10px 24px",
		backgroundColor: "transparent",
		backgroundImage: TOOLTIP_BG,
		backgroundSize: "100% 100%",
		color: "#f2de9c",
		fontSize: "15px",
		fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Tahoma, Arial, sans-serif",
		whiteSpace: "nowrap",
		textShadow: "0 0 4px rgba(0,0,0,0.6)",
		pointerEvents: "auto",
		cursor: "pointer",
		opacity: "0",
		transition: `opacity ${FADE_MS}ms ease`
	};
	var entries = new Map();
	var dirtyKeys = new Set();
	var rafScheduled = false;
	function showStatusTip(key, text, duration = DEFAULT_DURATION) {
		if (!key) return;
		const nextText = text == null ? "" : String(text);
		if (!nextText) {
			hideStatusTip(key);
			return;
		}
		const entry = ensureEntry(key);
		if (!entry) return;
		entry.text = nextText;
		clearTimer(entry, "hideTimer");
		if (duration > 0) entry.hideTimer = setTimeout(() => hideStatusTip(key), duration);
		if (entry.visible && entry.renderedText === nextText) return;
		dirtyKeys.add(key);
		scheduleFlush();
	}
	function hideStatusTip(key) {
		const entry = entries.get(key);
		if (!entry) return;
		clearTimer(entry, "hideTimer");
		dirtyKeys.delete(key);
		if (!entry.visible) return;
		entry.visible = false;
		entry.element.style.opacity = "0";
		clearTimer(entry, "fadeTimer");
		entry.fadeTimer = setTimeout(() => {
			entry.fadeTimer = null;
			if (!entry.visible) entry.element.style.display = "none";
		}, FADE_MS);
	}
	function scheduleFlush() {
		if (rafScheduled) return;
		rafScheduled = true;
		requestAnimationFrame(flush);
	}
	function flush() {
		rafScheduled = false;
		dirtyKeys.forEach((key) => {
			const entry = entries.get(key);
			if (!entry) return;
			if (entry.renderedText !== entry.text) {
				entry.element.textContent = entry.text;
				entry.renderedText = entry.text;
			}
			if (!entry.visible) showEntry(entry);
		});
		dirtyKeys.clear();
	}
	function showEntry(entry) {
		clearTimer(entry, "fadeTimer");
		entry.visible = true;
		entry.element.style.display = "flex";
		requestAnimationFrame(() => {
			if (entry.visible) entry.element.style.opacity = "1";
		});
	}
	function ensureEntry(key) {
		const existing = entries.get(key);
		if (existing) {
			if (!existing.element.isConnected) ensureContainer()?.appendChild(existing.element);
			return existing;
		}
		const container = ensureContainer();
		if (!container) return null;
		const element = document.createElement("div");
		element.className = "ac-status-tip";
		element.dataset.statusTipKey = key;
		Object.assign(element.style, TIP_STYLE);
		element.addEventListener("click", () => hideStatusTip(key));
		container.appendChild(element);
		const entry = {
			element,
			text: "",
			renderedText: "",
			visible: false,
			hideTimer: null,
			fadeTimer: null
		};
		entries.set(key, entry);
		return entry;
	}
	function ensureContainer() {
		if (!document?.body) return null;
		let container = document.getElementById(CONTAINER_ID);
		if (!container) {
			container = document.createElement("div");
			container.id = CONTAINER_ID;
			Object.assign(container.style, CONTAINER_STYLE);
			document.body.appendChild(container);
		}
		return container;
	}
	function clearTimer(entry, field) {
		const timer = entry[field];
		if (timer === null) return;
		clearTimeout(timer);
		entry[field] = null;
	}
	function handleAdWindow() {
		if (!globalConfig.skipAdWindowSwitch) return;
		wait(() => laya.GetWindow("AdPushWindow")).then((win) => win?.Close()).catch((error) => console.error(error));
	}
	function handleKillEffect(msg) {
		if (globalConfig.blockKillEffectSwitch) msg.Type = 0;
	}
	function handleGeneralSkin(msg) {
		if (!Game.isGameStart || !globalConfig.blockSkinStateSwitch) return;
		(msg.GeneralSkinList || []).forEach((GeneralSkin) => {
			if (!GeneralSkin) return;
			if (Game.myGenerals.includes(GeneralSkin.GeneralID)) return;
			GeneralSkin.state = 0;
		});
	}
	function handleUserProfileSkin(msg) {
		if (!globalConfig.blockSkinStateSwitch) return;
		if (msg.ProtoObj?.nickname_usertempid === user.userID) return;
		if (msg.Info) msg.Info.IsUseDySkinShow = false;
	}
	function handleTableInfo() {
		wait(() => laya.blockPowerSlogan()).catch((error) => console.error(error));
	}
	function handlePackageOpened() {
		if (!globalConfig.skipPackageWindowSwitch) return;
		wait(() => laya.GetWindow("GeneralOpenResultWindow")).then((win) => win?.Close()).catch((error) => console.error(error));
	}
	function handleGeneralWishPool(data) {
		const progress = Array.isArray(data?.list) ? data.list[0] : null;
		if (!progress?.ratio) return;
		showStatusTip("wishPool", `心愿武将当前进度: ${progress.ratio / 100}%`);
	}
	function handleSkinWishPool(data) {
		const list = Array.isArray(data?.list) ? data.list : [];
		const progress = list.find((item) => item?.round === list.length);
		if (!progress?.ratio) return;
		showStatusTip("wishPool", `心愿皮肤当前进度: ${progress.ratio / 100}%`);
	}
	var USER_IDENTITY_MESSAGES = new Set([
		"ClientLoginRep",
		"ClientUserDataCounterNtf",
		"SmsgUpdateTaskListToClient",
		"ClientGuildMemberChangeNtf"
	]);
	function handleUserSession(msg, className) {
		if (user.userID !== 0 || !USER_IDENTITY_MESSAGES.has(className)) return;
		const frameReady = initFrame();
		user.userID = msg.userID;
		user.nickname = msg.Nickname || user.nickname || "";
		console.info("[logic] userID: %s", msg.userID);
		frameReady.then(() => {
			const uuidElement = document.getElementById("uuid");
			if (uuidElement) uuidElement.textContent = "id：" + user.userID;
			const nicknameElement = document.getElementById("nickName");
			if (nicknameElement) nicknameElement.textContent = "昵称：" + user.nickname;
		}).catch((error) => {
			console.error("[logic] initFrame failed:", error);
		});
	}
	var lastClassName = null;
	function logic(msg) {
		try {
			if (!msg) return;
			if (msg.startsWith?.("socket连接关闭")) return;
			if (msg.className === void 0 && msg.ClassName === void 0) return;
			const className = msg.ClassName || msg.className || msg.toString();
			if (className === lastClassName && className === "MsgGameOver") return;
			lastClassName = className;
			const { ProtoObj, SeatID } = msg;
			recordTrackerProtocol(msg, {
				mySeatID: Game.myID,
				currentSeatID: Game.currentID
			});
			if (!isRetainedLogicMessage(className)) return;
			handleUserSession(msg, className);
			switch (className) {
				case "ClientBindKeyRep": break;
				case "decodeSyncGameDataEvent":
					handleAdWindow();
					break;
				case "MsgReconnectGame":
					Game.isDuanXian = true;
					addTooltip("断线重连，本局游戏中小抄记录可能不准");
					break;
				case "decodeSSCChatmsgNtf":
					handleChatMessage(msg, ProtoObj);
					break;
				case "decodeClientActSysBroadMsgListResp":
					handleBroadMsg(ProtoObj);
					break;
				case "MsgHeartAliveRep": break;
				case "decodeRogueLikeDataSync":
					handleRogueLike(ProtoObj);
					showShanHeTuSponsorPrompt(ProtoObj);
					break;
				case "ClientActivitysetDataRep": break;
				case "decodeGameRecordInitInfo":
					if (ProtoObj) Game.updateRecordInfo(ProtoObj);
					break;
				case "GsCModifyUserseatNtf": break;
				case "decodeGsClientUserSeatFlagNtf":
					handleRecordStartGame(msg);
					if (globalConfig.showNameSwitch && Game.needShowName) laya.showName();
					break;
				case "MsgGamePlayerShowStatusNtf":
					tracker.setTrackerPlayerShowStatuses(msg.SeatData);
					break;
				case "GsCUpdateRoleDataNtf":
					if (msg.StateID === 58 && Game.isRecord && Game.myID === void 0 && SeatID !== void 0) tracker.setTrackerMySeatID(SeatID);
					break;
				case "MsgGameShowFigure":
					if (msg.Figure === 1) tracker.setTrackerFirstHand(SeatID);
					break;
				case "GsCFirstPhaseRole":
					if (SeatID !== void 0) tracker.setTrackerFirstHand(SeatID);
					break;
				case "MsgGameRoundNtf":
					if (msg.isPassed) Game.isPassed = msg.isPassed;
					break;
				case "MsgGameOver":
					handleGameOver();
					break;
				case "ClientLeavetableRep":
					handleLeaveTable();
					break;
				case "ClientRecommendShopItemRep":
					if (Game.isGameStart && msg?.userID === user.userID) handleLeaveTable();
					break;
				case "decodeRougeBaseInfoRep":
					UI.friendGeneral = ProtoObj?.friendGeneral?.length ?? UI.friendGeneral;
					break;
				case "MsgGamePlayCardNtf":
					{
						const cardList = msg.CardList;
						if (!Array.isArray(cardList) || cardList.length === 0) {
							console.warn("[logic] MsgGamePlayCardNtf 缺少 CardList，跳过牌堆初始化");
							break;
						}
						const dictCard = CardConfig.GetInstance().cardIDsOrder.filter((id) => cardList.includes(id));
						const paidui = dictCard.concat(cardList.filter((id) => !dictCard.includes(id))).filter(Boolean);
						Game.isGuoZhan = cardList.includes(1150);
						Game.isDouDiZhu = cardList.includes(13005);
						Game.isShanHeTu = cardList.includes(20100);
						Game.resetConfigHandCards();
						tracker.initTrackerDeck(paidui);
					}
					break;
				case "SmsgGameSetCharacter":
					if (Game.isRecord && Game.myID === void 0 && msg.Infos.length == 1 && (Game.isDouDiZhu || Game.isShanHeTu)) tracker.setTrackerMySeatID(msg.Infos[0].SeatID);
					msg.Infos.forEach(({ SeatID, CharacterID }) => {
						Game.setGeneral(SeatID, CharacterID);
					});
					break;
				case "GsCGuoZhanSetCharacter":
					msg.GeneralData?.forEach(({ index, cardID }) => {
						Game.setGeneral(SeatID, cardID, index);
					});
					break;
				case "MsgGameTurnNtf":
					handleGameTurn(msg);
					break;
				case "GsCGamephaseNtf":
					handleGamePhase(msg);
					break;
				case "GsCUpdateRoleDataExNtf":
					handleUpdateRoleDataExNtf(msg);
					break;
				case "GsCUpdateHpNtf": break;
				case "GsCTriggerSpellNew":
					handleTriggerSpellNew(msg);
					break;
				case "ClientHappyGetFriendHandcardRep": break;
				case "MsgNtfUseCardType":
					handleUseCard(msg);
					break;
				case "PubGsCUseCard":
					if (msg.isSend === 1) break;
					handleUseCard(msg);
					break;
				case "PubGsCUseSpell":
					handleUseSpell(msg);
					break;
				case "GsCRoleOptTargetNtf":
					handleRoleOptTargetNtf(msg);
					break;
				case "CGsRoleSpellOptRep":
					handleRoleSpellOptRep(msg);
					break;
				case "PubGsCMoveCard":
					handleMoveCard(msg);
					break;
				case "decodeGameDealPileTopCardList": break;
				case "CClientGameRewardPointNTF":
					handleKillEffect(msg);
					break;
				case "ClientGeneralSkinRep":
					handleGeneralSkin(msg);
					break;
				case "ClientUserbaseinfoRep":
				case "ClientUserdetailRep":
					handleUserProfileSkin(msg);
					break;
				case "ClientTableinfoRep":
					handleTableInfo();
					break;
				case "ClientModifyTblsetingNtf": break;
				case "ClientChestOpenReplaceInfoNtf":
					handlePackageOpened();
					break;
				case "decodeServerGeneralWishPoolDataResp":
					handleGeneralWishPool(ProtoObj);
					break;
				case "decodeServerSkinWishPoolDataResp":
					handleSkinWishPool(ProtoObj);
					break;
				default: break;
			}
		} catch (e) {
			console.error(e);
		}
	}
	var ERROR_KEY = "XC_LAST_ERROR";
	function formatErrorTime() {
		return new Date().toLocaleString();
	}
	function parseStack(stack = "") {
		const match = String(stack || "").match(/(\d+):(\d+)/);
		if (!match) return {
			line: "",
			column: ""
		};
		return {
			line: match[1],
			column: match[2]
		};
	}
	function buildRecord(error, source = "unknown", extra = {}) {
		const msg = error?.message || error?.reason?.message || error?.reason || error || "未知错误";
		const stack = error?.stack || error?.reason?.stack || "";
		const { line, column } = parseStack(stack);
		return {
			time: formatErrorTime(),
			source,
			message: String(msg),
			stack: String(stack || ""),
			line,
			column,
			href: location.href,
			...extra
		};
	}
	function saveRecord(record) {
		try {
			localStorage.setItem(ERROR_KEY, JSON.stringify(record));
		} catch (e) {
			console.info("[error-notifier] save failed", e);
		}
	}
	function notifyScriptError(error, source = "unknown", extra = {}) {
		const record = buildRecord(error, source, extra);
		saveRecord(record);
		window.__XC_LAST_ERROR__ = record;
		return record;
	}
	console.info("%c三国杀小抄", "font-weight: bold; color: white; background-color: #525288; padding: 1px 4px; border-radius: 4px;");
	window._SGSMODULE = [];
	var sgsConsoleLog = function(...args) {
		const msg = args[0];
		if (window._debug && msg != null && typeof msg === "object" && msg.className !== "decodeSSCChatmsgNtf") console.info(...args);
		window._SGSMODULE.forEach((fn) => fn?.(...args));
	};
	var originalConsole = window.console;
	window.console = new Proxy(originalConsole, { set(target, prop, value, receiver) {
		if (prop === "log") return true;
		return Reflect.set(target, prop, value, receiver);
	} });
	Object.defineProperty(originalConsole, "log", {
		value: sgsConsoleLog,
		writable: true,
		configurable: true,
		enumerable: true
	});
	function main() {
		const args = Array.prototype.slice.call(arguments);
		try {
			if (args[0] === "INIT") return Init();
			else if (args[0] === "EXIT") return Exit();
			else return logic(args[args.length - 1]);
		} catch (e) {
			console.error(e.message);
			console.error(e.stack);
			notifyScriptError(e, `main.${args[0] || "logic"}`);
		}
	}
	main("INIT").then((r) => {
		if (r) window._SGSMODULE.push(main);
	});
})();
