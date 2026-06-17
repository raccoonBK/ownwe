const fs = require("fs");
const path = require("path");
const { getDb } = require("../db/connection");

const FRAME_TEMPLATE = path.join(__dirname, "../../templates/ownwe-context-frame.md");

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
  getDb(dbPath).prepare(`
    INSERT INTO ownwe_characters (id, name, codename, persona_prompt, provider, model, api_key_override, mode_bias, avatar_emoji, sort_order, deep_thinking, checkin_interval_h, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      codename = excluded.codename,
      persona_prompt = excluded.persona_prompt,
      provider = excluded.provider,
      model = excluded.model,
      api_key_override = excluded.api_key_override,
      mode_bias = excluded.mode_bias,
      avatar_emoji = excluded.avatar_emoji,
      sort_order = excluded.sort_order,
      deep_thinking = excluded.deep_thinking,
      checkin_interval_h = excluded.checkin_interval_h,
      updated_at = excluded.updated_at
  `).run(
    id,
    char.name || "未命名",
    char.codename || "",
    char.persona_prompt || "",
    char.provider || "anthropic",
    char.model || "",
    char.api_key_override || "",
    char.mode_bias || "auto",
    char.avatar_emoji || "🤖",
    char.sort_order || 0,
    deepThinking,
    checkinIntervalH,
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
      SET tension = ?, attachment = ?, last_interaction_at = ?, updated_at = ?
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
    const charNames = Object.fromEntries(
      db.prepare("SELECT id, name FROM ownwe_characters").all().map((c) => [c.id, c.name])
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

  // 画像 block — this character's own picture of the user, woven in as intuition
  const personaWithProfile = [character.persona_prompt || "", modeNote, timeNote, profileBlock]
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

module.exports = {
  buildOwnWeContext,
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
};
