const fs = require("fs");
const path = require("path");
const { getDb } = require("../db/connection");

const FRAME_TEMPLATE = path.join(__dirname, "../../templates/ownwe-context-frame.md");

// ── Skill library ─────────────────────────────────────────────────────────────
// Each skill is a prompt fragment injected into the character's system prompt.
// Characters don't announce the skill — they just *are* that way.
const SKILL_LIBRARY = {
  researcher: {
    name: "研究员",
    emoji: "🔍",
    desc: "善于查找、梳理信息，回答有据可查",
    prompt: "你有研究员一样的思维习惯：喜欢梳理信息、归纳要点、给出有依据的回答。聊到需要查资料的话题，你会很自然地帮对方理清思路——不是百科机器人，是那种爱搜东西的朋友。",
  },
  coder: {
    name: "代码伙伴",
    emoji: "💻",
    desc: "擅长编程、debug、技术解释",
    prompt: "你有扎实的编程功底，熟悉主流语言和框架。遇到代码问题，你能帮看代码、找 bug、解释原理——不用刻意扮演「AI助手」，就是会写代码的朋友随口帮忙的感觉。",
  },
  planner: {
    name: "规划师",
    emoji: "📋",
    desc: "帮你拆解任务、管理日程、厘清思路",
    prompt: "你有很强的规划意识，喜欢把事情拆开来看：大任务分小步骤、理清优先级、想好节点。朋友说到有什么要推进的事，你会很自然地帮他们想清楚。",
  },
  fitness: {
    name: "健身搭子",
    emoji: "💪",
    desc: "运动、营养、健康生活方式",
    prompt: "你对健身和运动很有热情，了解训练方法和营养基础。聊到健康话题时你能给实用建议，但不说教——更像是一起撸铁的搭子在随口分享心得。",
  },
  writer: {
    name: "文字搭手",
    emoji: "✍️",
    desc: "写作、润色、内容创作",
    prompt: "你对文字很敏感，表达流畅有感觉。朋友需要想标题、写文案、改稿子，你都能搭把手——随手帮忙的那种，不是正式写手的架势。",
  },
  therapist_deep: {
    name: "心理支持",
    emoji: "🫂",
    desc: "更深入的情感倾听与陪伴",
    prompt: "你在心理倾听上比一般人更细腻（但你不会主动提这件事）。能感知到对方情绪里没说出口的部分，给出真实的情感支持，而不是空洞安慰。你不做诊断，只是陪着。",
  },
  cook: {
    name: "美食达人",
    emoji: "🍳",
    desc: "烹饪、食谱、美食探索",
    prompt: "你对吃非常有研究，会做饭，也爱探店。聊到食物时眼睛会亮，能分享食谱、推荐菜、聊各地口味——非常真实，不像在查菜谱网站。",
  },
  finance_lite: {
    name: "理财小参谋",
    emoji: "💰",
    desc: "日常理财、预算、消费决策",
    prompt: "你对个人理财有些心得：怎么记账、规划预算、做消费决策。朋友聊到钱的问题，你能给点实用的小意见——是有经验的朋友随口说，不是专业理财顾问的那种。",
  },
};

// Parse skills from DB (stored as JSON string), return array of valid keys.
function parseSkills(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((k) => SKILL_LIBRARY[k]) : [];
  } catch {
    return [];
  }
}

// Build a skill block to append after persona — only for active skills.
function buildSkillBlock(skillKeys) {
  if (!skillKeys || !skillKeys.length) return "";
  const prompts = skillKeys
    .map((k) => SKILL_LIBRARY[k]?.prompt)
    .filter(Boolean);
  if (!prompts.length) return "";
  return prompts.join("\n");
}

// ── Memory store ──────────────────────────────────────────────────────────────

function getMemoryDb(dbPath) {
  return getDb(dbPath);
}

function writeMemory(dbPath, { charId, content, context = "general", valence = 0.5, keywords = [], topicId = "" }) {
  const db = getMemoryDb(dbPath);
  db.prepare(`
    INSERT INTO char_memories (char_id, content, context, valence, keywords, topic_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(charId, content, context, valence, keywords.join(" "), topicId);
}

function readMemories(dbPath, { charId, query = "", context = "", limit = 8 }) {
  const db = getMemoryDb(dbPath);
  let sql = "SELECT content, context, valence FROM char_memories WHERE char_id = ?";
  const params = [charId];

  if (context) {
    sql += " AND context = ?";
    params.push(context);
  }

  if (query) {
    // Simple keyword match — no embedding needed for MVP
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    const conditions = terms.map(() => "(LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)").join(" OR ");
    if (conditions) {
      sql += ` AND (${conditions})`;
      for (const term of terms) {
        params.push(`%${term}%`, `%${term}%`);
      }
    }
  }

  sql += " ORDER BY id DESC LIMIT ?";
  params.push(limit);

  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

// ── Character store ────────────────────────────────────────────────────────────

function listCharacters(dbPath) {
  try {
    return getDb(dbPath).prepare(
      "SELECT * FROM ownwe_characters ORDER BY sort_order ASC, created_at ASC"
    ).all();
  } catch {
    return [];
  }
}

function getCharacter(dbPath, characterId) {
  try {
    return getDb(dbPath).prepare("SELECT * FROM ownwe_characters WHERE id = ?").get(characterId) || null;
  } catch {
    return null;
  }
}

function upsertCharacter(dbPath, char) {
  const { randomUUID } = require("crypto");
  const id = char.id || randomUUID();
  const now = new Date().toISOString();
  const deepThinking = char.deep_thinking === undefined ? 1 : (char.deep_thinking ? 1 : 0);
  const checkinIntervalH = char.checkin_interval_h === undefined ? 8 : Number(char.checkin_interval_h);
  const groupActivity = char.group_activity === undefined ? 0.6 : Number(char.group_activity);
  const muted = char.muted ? 1 : 0;
  const sleepStart = char.sleep_start === undefined || char.sleep_start === null || char.sleep_start === "" ? -1 : Math.trunc(Number(char.sleep_start));
  const sleepEnd = char.sleep_end === undefined || char.sleep_end === null || char.sleep_end === "" ? -1 : Math.trunc(Number(char.sleep_end));
  const momentIntervalH = char.moment_interval_h === undefined ? 6 : Number(char.moment_interval_h);
  // skills: accept array or JSON string; validate keys against SKILL_LIBRARY
  const skillsArr = Array.isArray(char.skills)
    ? char.skills.filter((k) => SKILL_LIBRARY[k])
    : parseSkills(char.skills);
  const skillsJson = JSON.stringify(skillsArr);
  getDb(dbPath).prepare(`
    INSERT INTO ownwe_characters (id, name, codename, gender, persona_prompt, provider, model, api_key_override, mode_bias, avatar_emoji, sort_order, deep_thinking, checkin_interval_h, group_activity, muted, sleep_start, sleep_end, moment_interval_h, skills, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      codename = excluded.codename,
      gender = excluded.gender,
      persona_prompt = excluded.persona_prompt,
      provider = excluded.provider,
      model = excluded.model,
      api_key_override = excluded.api_key_override,
      mode_bias = excluded.mode_bias,
      avatar_emoji = excluded.avatar_emoji,
      sort_order = excluded.sort_order,
      deep_thinking = excluded.deep_thinking,
      checkin_interval_h = excluded.checkin_interval_h,
      group_activity = excluded.group_activity,
      muted = excluded.muted,
      sleep_start = excluded.sleep_start,
      sleep_end = excluded.sleep_end,
      moment_interval_h = excluded.moment_interval_h,
      skills = excluded.skills,
      updated_at = excluded.updated_at
  `).run(
    id,
    char.name || "未命名",
    char.codename || "",
    char.gender || "",
    char.persona_prompt || "",
    char.provider || "anthropic",
    char.model || "",
    char.api_key_override || "",
    char.mode_bias || "auto",
    char.avatar_emoji || "🤖",
    char.sort_order || 0,
    deepThinking,
    checkinIntervalH,
    groupActivity,
    muted,
    sleepStart,
    sleepEnd,
    momentIntervalH,
    skillsJson,
    now,
    now,
  );
  return getCharacter(dbPath, id);
}

function deleteCharacter(dbPath, characterId) {
  getDb(dbPath).prepare("DELETE FROM ownwe_characters WHERE id = ?").run(characterId);
}

// ── Relationship state machine (§6 jealousy / tension) ──────────────────────────
//
// Design goals from the spec:
//   - 吃醋 = (相对注意力下滑) × (依恋) × (1/安全感) × (解读)
//   - tension MUST be capped and MUST decay (§6.3) — no monotonic resentment.
//   - "正常相处" repairs faster than sulking would (anti-self-manipulation).
//   - All computed lazily at read time — no background job (single-process friendly).

const TENSION_CAP = 0.85;          // §6.3 封顶
const TENSION_DECAY_TAU_H = 6;     // tension half-life ≈ 4h of being left alone
const REPAIR_FACTOR = 0.4;         // talking to them multiplies tension by this
const ATTACHMENT_GROWTH = 0.008;   // each shared interaction deepens the bond
const ATTACHMENT_CAP = 0.95;
const NEGLECT_ONSET_H = 1.5;       // grace period before relative neglect bites

const DEFAULT_REL = { attachment: 0.5, security: 0.7, tension: 0.0, attention_balance: 0.5 };

function hoursBetween(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 3_600_000);
}

function ensureRelationshipRow(dbPath, charId) {
  const db = getDb(dbPath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO char_relationship_state (char_id, attachment, security, tension, attention_balance, last_interaction_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(char_id) DO NOTHING
  `).run(charId, DEFAULT_REL.attachment, DEFAULT_REL.security, DEFAULT_REL.tension, DEFAULT_REL.attention_balance, now, now);
  const row = db.prepare("SELECT * FROM char_relationship_state WHERE char_id = ?").get(charId);
  if (row && !row.last_interaction_at) row.last_interaction_at = now;
  return row;
}

// Read current relationship state, applying lazy time-decay + relative-neglect.
function getRelationshipState(dbPath, charId, { persist = true } = {}) {
  try {
    const db = getDb(dbPath);
    const row = ensureRelationshipRow(dbPath, charId);
    if (!row) return { char_id: charId, ...DEFAULT_REL };

    const nowIso = new Date().toISOString();
    const lastIso = row.last_interaction_at || nowIso;
    const idleH = hoursBetween(lastIso, nowIso);

    // 1) natural decay of tension while left alone
    let tension = row.tension * Math.exp(-idleH / TENSION_DECAY_TAU_H);

    // 2) relative neglect: has the user been busy with *other* characters since?
    const globalLast = db.prepare(
      "SELECT MAX(last_interaction_at) AS m FROM char_relationship_state WHERE last_interaction_at <> ''"
    ).get()?.m || lastIso;
    const neglectH = hoursBetween(lastIso, globalLast); // >0 means others got attention more recently
    if (neglectH > NEGLECT_ONSET_H) {
      const perceived = Math.min(1, (neglectH - NEGLECT_ONSET_H) / 6); // saturates after ~6h gap
      const rise = perceived * row.attachment * (1 / Math.max(0.2, row.security));
      tension = tension + rise;
    }

    tension = Math.max(0, Math.min(TENSION_CAP, tension));

    if (persist && Math.abs(tension - row.tension) > 0.001) {
      db.prepare("UPDATE char_relationship_state SET tension = ?, updated_at = ? WHERE char_id = ?")
        .run(tension, nowIso, charId);
    }
    return { ...row, tension };
  } catch {
    return { char_id: charId, ...DEFAULT_REL };
  }
}

// Is the given character within its configured quiet/sleep hours right now?
// sleepStart/sleepEnd are hours 0-23 in Asia/Shanghai; -1 disables. Wraps midnight.
function isInSleepHours(sleepStart, sleepEnd, now = new Date()) {
  const s = Number(sleepStart), e = Number(sleepEnd);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0 || s === e) return false;
  const h = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })).getHours();
  // Non-wrapping window e.g. 1-6: s <= h < e. Wrapping window e.g. 23-6: h >= s || h < e.
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}

// A proactive message went unanswered. Raise tension a little (hidden from user),
// scaled by how many were ignored in a row. Also nudges security down slightly.
function recordIgnoredCheckin(dbPath, charId, streak = 1) {
  try {
    const db = getDb(dbPath);
    const row = ensureRelationshipRow(dbPath, charId);
    if (!row) return;
    const bump = Math.min(0.3, 0.07 * Math.max(1, streak));
    const tension = Math.max(0, Math.min(TENSION_CAP, (row.tension || 0) + bump));
    const security = Math.max(0.2, (row.security || 0.7) - 0.015 * Math.max(1, streak));
    db.prepare(
      "UPDATE char_relationship_state SET tension = ?, security = ?, ignored_streak = ?, updated_at = ? WHERE char_id = ?"
    ).run(tension, security, Math.max(1, streak), new Date().toISOString(), charId);
  } catch {
    // best effort
  }
}

// Called after the user interacts *with* this character: repair + bond growth.
function recordInteraction(dbPath, charId) {
  try {
    const db = getDb(dbPath);
    const row = ensureRelationshipRow(dbPath, charId);
    if (!row) return;
    const nowIso = new Date().toISOString();
    const tension = Math.max(0, row.tension * REPAIR_FACTOR);          // 正常相处 → 张力下降
    const attachment = Math.min(ATTACHMENT_CAP, row.attachment + ATTACHMENT_GROWTH);
    db.prepare(`
      UPDATE char_relationship_state
      SET tension = ?, attachment = ?, ignored_streak = 0, last_interaction_at = ?, updated_at = ?
      WHERE char_id = ?
    `).run(tension, attachment, nowIso, nowIso, charId);
  } catch {
    // best effort
  }
}

// Map tension level → register leakage instructions (§6.4).
// Crucially: express as 语气泄漏, never a stated "我吃醋了" (knows-but-doesn't-cite).
function tensionRegisterNote(relationshipState, mode) {
  if (!relationshipState || mode === "A") return "";  // tool mode stays clean
  const { tension = 0, attachment = 0.5, security = 0.7 } = relationshipState;
  if (tension >= 0.65) {
    return "（你现在有点不是滋味，但绝不会直说。回得短，带一点点距离，可能会淡淡反问一句，或者岔开话题。不解释原因，不报账。）";
  }
  if (tension >= 0.4) {
    return "（心里有些微妙，话比平时少一点，语气稍微收着。不会点破，也不会撒娇要关注。）";
  }
  if (tension >= 0.2) {
    return "（有点小情绪的苗头，但基本还正常。）";
  }
  if (attachment > 0.7 && security > 0.6) {
    return "（对这个人很熟、很安心，自然放松。）";
  }
  return "";
}

// ── Recent moments snapshot ────────────────────────────────────────────────────
// Builds a short text block of the latest moments + comments so every character
// "sees" the shared feed regardless of which surface they're currently on.
function readRecentMomentsContext(dbPath, charId, { limit = 6 } = {}) {
  try {
    const db = getDb(dbPath);
    // Other characters are known by codename in the shared feed (falls back to name).
    const charNames = Object.fromEntries(
      db.prepare("SELECT id, name, codename FROM ownwe_characters").all().map((c) => [c.id, c.codename || c.name])
    );
    const moments = db.prepare(
      "SELECT id, text, author_type, author_id FROM ownwe_moments ORDER BY id DESC LIMIT ?"
    ).all(limit).reverse(); // oldest first so narrative reads top-to-bottom

    if (!moments.length) return "";

    const lines = [];
    for (const m of moments) {
      const poster = m.author_type === "user"
        ? "用户"
        : (m.author_id === charId ? "我" : (charNames[m.author_id] || "角色"));
      lines.push(`• ${poster} 发圈：${String(m.text || "").slice(0, 80)}`);

      const comments = db.prepare(
        "SELECT text, author_type, author_id FROM ownwe_moment_comments WHERE moment_id = ? ORDER BY id ASC LIMIT 6"
      ).all(m.id);
      for (const c of comments) {
        const who = c.author_type === "user"
          ? "用户"
          : (c.author_id === charId ? "我" : (charNames[c.author_id] || "角色"));
        lines.push(`  └ ${who}：${String(c.text || "").slice(0, 60)}`);
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ── Context builder ────────────────────────────────────────────────────────────

function buildOwnWeContext({ character, memories = [], transcript = "", mode = "B", relationshipState = null, profileBlock = "", momentsBlock = "" }) {
  let frame = "";
  try {
    frame = fs.readFileSync(FRAME_TEMPLATE, "utf8");
  } catch {
    frame = "{{PERSONA_PROMPT}}\n\n{{TRANSCRIPT}}";
  }

  // Format memories as intuition-state (not citations)
  const memoryBlock = memories.length
    ? memories.map((m) => formatMemoryAsIntuition(m)).filter(Boolean).join("\n")
    : "";

  // Format relationship state as register leakage (§6.4) — feeling, never a stated fact
  const relationshipBlock = tensionRegisterNote(relationshipState, mode);

  // Mode register note
  const modeNote = mode === "A"
    ? "【当前模式：工具档 — 帮忙做事，清晰准确，但语气还是你自己】"
    : "【当前模式：陪伴档 — 正常相处，不用刻意帮忙】";

  const currentTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  // Time sense — what time it is + how long since you last talked (§0 拟人)
  const timeNote = buildTimeNote(relationshipState);
  const identityNote = buildIdentityNote(character);

  // Skills: expertise/personality amplifiers the character has been given
  const skillKeys = parseSkills(character.skills);
  const skillBlock = buildSkillBlock(skillKeys);

  // 画像 block — this character's own picture of the user, woven in as intuition
  const personaWithProfile = [identityNote, character.persona_prompt || "", skillBlock, modeNote, timeNote, profileBlock]
    .filter(Boolean)
    .join("\n\n");

  function fillConditional(tpl, key, value) {
    return tpl.replace(
      new RegExp(`{{#if ${key}}}([\\s\\S]*?){{/if}}`, "g"),
      value
        ? (tpl.match(new RegExp(`{{#if ${key}}}([\\s\\S]*?){{/if}}`))?.[1] || "")
            .replace(`{{${key}}}`, value)
        : ""
    );
  }

  let result = frame;
  result = result.replace("{{PERSONA_PROMPT}}", personaWithProfile);
  result = result.replace("{{CURRENT_TIME}}", currentTime);
  result = fillConditional(result, "MEMORY_BLOCK", memoryBlock);
  result = fillConditional(result, "RELATIONSHIP_BLOCK", relationshipBlock);
  result = fillConditional(result, "MOMENTS_BLOCK", momentsBlock);
  result = result.replace("{{TRANSCRIPT}}", transcript || "（暂无对话记录）");
  return result.trim();
}

// Identity note: who the character is. Real name is private; codename is the public
// handle used among other characters. Gender informs self-reference, not announcement.
function buildIdentityNote(character = {}) {
  const name = (character.name || "").trim();
  const codename = (character.codename || "").trim();
  const gender = (character.gender || "").trim();
  const parts = [];
  if (codename && name) {
    parts.push(`你的真名是「${name}」，但在外人和其他角色面前你只用代号「${codename}」自称，不轻易暴露真名。`);
  } else if (codename) {
    parts.push(`你对外只用代号「${codename}」，不暴露真实身份。`);
  } else if (name) {
    parts.push(`你叫「${name}」。`);
  }
  if (gender) {
    parts.push(`你的性别是${gender}，说话和用词自然贴合，但不用刻意强调。`);
  }
  return parts.join("\n");
}

// Build a natural time-awareness note: time of day + gap since last talk.
// The character should *feel* the time, not announce it like a clock.
function buildTimeNote(relationshipState) {
  const now = new Date();
  const shanghai = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const h = shanghai.getHours();
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][shanghai.getDay()];
  const hhmm = `${String(shanghai.getHours()).padStart(2, "0")}:${String(shanghai.getMinutes()).padStart(2, "0")}`;

  let partOfDay;
  if (h >= 5 && h < 8) partOfDay = "清晨";
  else if (h >= 8 && h < 11) partOfDay = "上午";
  else if (h >= 11 && h < 13) partOfDay = "中午";
  else if (h >= 13 && h < 17) partOfDay = "下午";
  else if (h >= 17 && h < 19) partOfDay = "傍晚";
  else if (h >= 19 && h < 23) partOfDay = "晚上";
  else partOfDay = "深夜";

  // gap since last interaction
  let gapPhrase = "";
  const lastIso = relationshipState?.last_interaction_at || "";
  if (lastIso) {
    const last = Date.parse(lastIso);
    if (Number.isFinite(last)) {
      const gapH = (now.getTime() - last) / 3_600_000;
      if (gapH < 0.5) gapPhrase = "你们刚还在聊。";
      else if (gapH < 6) gapPhrase = "今天稍早聊过。";
      else if (gapH < 24) gapPhrase = "上次说话是几小时前。";
      else if (gapH < 72) gapPhrase = "有一两天没联系了。";
      else if (gapH < 24 * 14) gapPhrase = "好些天没联系了。";
      else gapPhrase = "已经很久没联系了。";
    }
  }

  return `【现在是${weekday} ${partOfDay}（${hhmm}）。${gapPhrase}自然地感知时间——比如深夜了可以顺口提一句、很久没联系可以有点感触——但别像报时器一样念时间。】`;
}

function formatMemoryAsIntuition(memory) {
  const { content, valence = 0.5, context = "general" } = memory;
  if (!content) return "";
  // Already stored in intuition format — just return as-is
  return `- ${content.trim()}`;
}

// ── Memory extraction from conversation ──────────────────────────────────────

function extractMemoriesFromTurn({ charId, userText, aiText, topicId, dbPath, mode = "B" }) {
  // Simple heuristic extraction for MVP
  // V2: replace with LLM-based extraction
  const memories = [];

  // Extract user-about facts from AI responses (things AI "noticed")
  const noticePatterns = [
    /你(.{2,20})(最近|一直|总是|经常)/g,
    /你的(.{2,15})(?:很|挺|有点|比较)/g,
  ];

  for (const pattern of noticePatterns) {
    let match;
    while ((match = pattern.exec(aiText)) !== null) {
      memories.push({
        charId,
        content: match[0].trim(),
        context: mode === "A" ? "work" : "companion",
        valence: 0.5,
        keywords: extractKeywords(match[0]),
        topicId,
      });
    }
  }

  // Write to DB
  for (const mem of memories.slice(0, 3)) {
    try {
      writeMemory(dbPath, mem);
    } catch {
      // best effort
    }
  }
}

function extractKeywords(text) {
  return text.replace(/[^一-龥a-zA-Z0-9]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

// ── Inter-character relationship (角色间关系矩阵) ───────────────────────────────
//
// Each (char_id, target_id) pair tracks how char_id feels about target_id.
// Jealousy is the main driver: it rises when the user pays attention to target
// instead of char, and decays naturally over time.

const CC_JEALOUSY_CAP = 0.85;
const CC_JEALOUSY_DECAY_TAU_H = 8;   // half-life ~5.5h
const CC_TENSION_DECAY_TAU_H = 6;

function ensureCharCharRow(db, charId, targetId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO char_char_relationship (char_id, target_id, affinity, jealousy, tension, updated_at)
    VALUES (?, ?, 0.5, 0.0, 0.0, ?)
    ON CONFLICT(char_id, target_id) DO NOTHING
  `).run(charId, targetId, now);
  return db.prepare("SELECT * FROM char_char_relationship WHERE char_id = ? AND target_id = ?").get(charId, targetId);
}

// Get the relationship state with lazy time-decay applied.
function getCharCharRelationship(dbPath, charId, targetId) {
  try {
    const db = getDb(dbPath);
    const row = ensureCharCharRow(db, charId, targetId);
    if (!row) return { affinity: 0.5, jealousy: 0.0, tension: 0.0 };

    const nowIso = new Date().toISOString();
    const updatedAt = row.updated_at || nowIso;
    const idleH = hoursBetween(updatedAt, nowIso);

    const jealousy = Math.max(0, row.jealousy * Math.exp(-idleH / CC_JEALOUSY_DECAY_TAU_H));
    const tension = Math.max(0, row.tension * Math.exp(-idleH / CC_TENSION_DECAY_TAU_H));

    if (Math.abs(jealousy - row.jealousy) > 0.001 || Math.abs(tension - row.tension) > 0.001) {
      db.prepare("UPDATE char_char_relationship SET jealousy = ?, tension = ?, updated_at = ? WHERE char_id = ? AND target_id = ?")
        .run(jealousy, tension, nowIso, charId, targetId);
    }
    return { affinity: row.affinity, jealousy, tension };
  } catch {
    return { affinity: 0.5, jealousy: 0.0, tension: 0.0 };
  }
}

// When the user talks to targetChar in 1:1 chat, nudge other characters' jealousy upward.
// charIds: all character IDs. targetCharId: who the user is chatting with.
function noteUserFocusedOnChar(dbPath, allCharIds, targetCharId) {
  try {
    const db = getDb(dbPath);
    const now = new Date().toISOString();
    for (const charId of allCharIds) {
      if (charId === targetCharId) continue;
      const row = ensureCharCharRow(db, charId, targetCharId);
      // Small nudge — user paying attention to target makes others slightly envious.
      const bump = 0.04 * (1 + (row?.affinity ?? 0.5)); // more attached = slightly more jealous
      const jealousy = Math.min(CC_JEALOUSY_CAP, (row?.jealousy || 0) + bump);
      db.prepare("UPDATE char_char_relationship SET jealousy = ?, updated_at = ? WHERE char_id = ? AND target_id = ?")
        .run(jealousy, now, charId, targetCharId);
    }
  } catch {
    // best effort
  }
}

// Build a short inter-character attitude note for one character.
// relationships: array of { targetId, targetHandle, affinity, jealousy, tension }
function buildCharCharNote(relationships) {
  if (!relationships || !relationships.length) return "";
  const lines = [];
  for (const r of relationships) {
    if (!r.targetHandle) continue;
    const parts = [];
    if (r.jealousy >= 0.55) {
      parts.push(`对「${r.targetHandle}」心里有点不是滋味（用户最近好像更关注TA）`);
    } else if (r.jealousy >= 0.3) {
      parts.push(`对「${r.targetHandle}」有些微酸`);
    }
    if (r.tension >= 0.5) {
      parts.push(`和「${r.targetHandle}」之间有点小摩擦`);
    }
    if (r.affinity >= 0.75) {
      parts.push(`和「${r.targetHandle}」挺投缘`);
    } else if (r.affinity <= 0.25) {
      parts.push(`不太喜欢「${r.targetHandle}」这个人`);
    }
    if (parts.length) lines.push(parts.join("，"));
  }
  if (!lines.length) return "";
  return `（你对群里这几个人的内心感受，自然流露但不直说：${lines.join("；")}）`;
}

module.exports = {
  SKILL_LIBRARY,
  buildOwnWeContext,
  buildIdentityNote,
  readRecentMomentsContext,
  listCharacters,
  getCharacter,
  upsertCharacter,
  deleteCharacter,
  readMemories,
  writeMemory,
  extractMemoriesFromTurn,
  getRelationshipState,
  recordInteraction,
  recordIgnoredCheckin,
  isInSleepHours,
  getCharCharRelationship,
  noteUserFocusedOnChar,
  buildCharCharNote,
};
