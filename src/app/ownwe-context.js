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
  getDb(dbPath).prepare(`
    INSERT INTO ownwe_characters (id, name, codename, persona_prompt, provider, model, api_key_override, mode_bias, avatar_emoji, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    now,
    now,
  );
  return getCharacter(dbPath, id);
}

function deleteCharacter(dbPath, characterId) {
  getDb(dbPath).prepare("DELETE FROM ownwe_characters WHERE id = ?").run(characterId);
}

// ── Relationship state ─────────────────────────────────────────────────────────

function getRelationshipState(dbPath, charId) {
  try {
    return getDb(dbPath).prepare(
      "SELECT * FROM char_relationship_state WHERE char_id = ?"
    ).get(charId) || { char_id: charId, attachment: 0.5, security: 0.7, tension: 0.0, attention_balance: 0.5 };
  } catch {
    return { char_id: charId, attachment: 0.5, security: 0.7, tension: 0.0, attention_balance: 0.5 };
  }
}

// ── Context builder ────────────────────────────────────────────────────────────

function buildOwnWeContext({ character, memories = [], transcript = "", mode = "B", relationshipState = null }) {
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

  // Format relationship state
  let relationshipBlock = "";
  if (relationshipState) {
    const { tension = 0, attachment = 0.5 } = relationshipState;
    if (tension > 0.3) {
      relationshipBlock = `（内心有些不对劲，比平时话少一些）`;
    } else if (attachment > 0.7) {
      relationshipBlock = `（对这个人很熟悉，自然一些）`;
    }
  }

  // Mode register note
  const modeNote = mode === "A"
    ? "【当前模式：工具档 — 帮忙做事，清晰准确，但语气还是你自己】"
    : "【当前模式：陪伴档 — 正常相处，不用刻意帮忙】";

  const currentTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  return frame
    .replace("{{PERSONA_PROMPT}}", `${character.persona_prompt || ""}\n\n${modeNote}`)
    .replace("{{CURRENT_TIME}}", currentTime)
    .replace(/{{#if MEMORY_BLOCK}}[\s\S]*?{{\/if}}/g, memoryBlock
      ? frame.match(/{{#if MEMORY_BLOCK}}([\s\S]*?){{\/if}}/)?.[1]
          ?.replace("{{MEMORY_BLOCK}}", memoryBlock) || memoryBlock
      : "")
    .replace(/{{#if RELATIONSHIP_BLOCK}}[\s\S]*?{{\/if}}/g, relationshipBlock
      ? frame.match(/{{#if RELATIONSHIP_BLOCK}}([\s\S]*?){{\/if}}/)?.[1]
          ?.replace("{{RELATIONSHIP_BLOCK}}", relationshipBlock) || ""
      : "")
    .replace("{{TRANSCRIPT}}", transcript || "（暂无对话记录）")
    .trim();
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
  listCharacters,
  getCharacter,
  upsertCharacter,
  deleteCharacter,
  readMemories,
  writeMemory,
  extractMemoriesFromTurn,
  getRelationshipState,
};
