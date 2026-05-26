const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbByPath = new Map();

function getDb(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  if (dbByPath.has(resolvedPath)) {
    return dbByPath.get(resolvedPath);
  }
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  dbByPath.set(resolvedPath, db);
  return db;
}

function runMigrations(dbPath, migrationsDir) {
  const db = getDb(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = new Set(
    db.prepare("SELECT filename FROM schema_migrations").all().map((row) => row.filename)
  );
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()
    : [];
  const insertMigration = db.prepare("INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)");
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
    insertMigration.run(file);
    console.log(`[roundtable-db] migration: ${file}`);
  }
  return db;
}

module.exports = {
  getDb,
  runMigrations,
};
