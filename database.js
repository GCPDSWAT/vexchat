
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
  process.env.DATABASE_PATH ||
  path.join(__dirname, "vexchat.db")
);

// Enable database protections
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Users
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Friends
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(friend_id) REFERENCES users(id)
  );
`);

// Private messages
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(recipient_id) REFERENCES users(id)
  );
`);

module.exports = db;

console.log("VEXCHAT database initialized!");
