const express = require("express");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const db = require("./database");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const onlineUsers = new Map();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    statusText: user.status_text || "",
    avatarColor: user.avatar_color || "#5865f2"
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(hashToken(token), userId, expiresAt);

  return token;
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Please log in." });
  }

  const session = db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString());

  if (!session) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }

  req.user = session;
  req.token = token;
  next();
}

function addNotification(userId, message, type = "general") {
  const result = db.prepare(`
    INSERT INTO notifications (user_id, message, type)
    VALUES (?, ?, ?)
  `).run(userId, message, type);

  const notification = db.prepare(
    "SELECT * FROM notifications WHERE id = ?"
  ).get(result.lastInsertRowid);

  io.to(`user:${userId}`).emit("notification", notification);
}

function isFriend(userId, otherId) {
  return !!db.prepare(`
    SELECT id FROM friendships
    WHERE status = 'accepted'
      AND (
        (user_id = ? AND friend_id = ?)
        OR
        (user_id = ? AND friend_id = ?)
      )
  `).get(userId, otherId, otherId, userId);
}

function isGroupMember(groupId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM group_members
    WHERE group_id = ? AND user_id = ?
  `).get(groupId, userId);
}

// -------------------- AUTH --------------------

app.post("/api/register", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: "Username must be 3–20 characters and use letters, numbers, or underscores."
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be at least 8 characters."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
    const storedPassword = `${salt}:${passwordHash}`;

    const result = db.prepare(`
      INSERT INTO users (username, password, display_name)
      VALUES (?, ?, ?)
    `).run(username, storedPassword, username);

    const token = createSession(result.lastInsertRowid);
    const user = db.prepare("SELECT * FROM users WHERE id = ?")
      .get(result.lastInsertRowid);

    res.json({ token, user: safeUser(user) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    console.error(error);
    res.status(500).json({ error: "Could not create your account." });
  }
});

app.post("/api/login", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const user = db.prepare(
      "SELECT * FROM users WHERE username = ?"
    ).get(username);

    if (!user) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const [salt, savedHash] = user.password.split(":");
    const attemptedHash = crypto.scryptSync(password, salt, 64).toString("hex");

    const saved = Buffer.from(savedHash, "hex");
    const attempted = Buffer.from(attemptedHash, "hex");

    if (
      saved.length !== attempted.length ||
      !crypto.timingSafeEqual(saved, attempted)
    ) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const token = createSession(user.id);
    res.json({ token, user: safeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.post("/api/logout", authenticate, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .run(hashToken(req.token));

  res.json({ success: true });
});

// -------------------- PROFILE --------------------

app.patch("/api/profile", authenticate, (req, res) => {
  const displayName = String(req.body.displayName || "").trim().slice(0, 24);
  const statusText = String(req.body.statusText || "").trim().slice(0, 80);
  const avatarColor = String(req.body.avatarColor || "#5865f2");

  const allowedColors = [
    "#5865f2", "#5865f2", "#8b5cf6",
    "#ec4899", "#06b6d4", "#22c55e",
    "#f59e0b", "#ef4444"
  ];

  if (!/^#[0-9a-fA-F]{6}$/.test(avatarColor) ||
      !allowedColors.includes(avatarColor.toLowerCase())) {
    return res.status(400).json({ error: "Choose one of the available profile colors." });
  }

  db.prepare(`
    UPDATE users
    SET display_name = ?, status_text = ?, avatar_color = ?
    WHERE id = ?
  `).run(displayName || req.user.username, statusText, avatarColor, req.user.id);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?")
    .get(req.user.id);

  res.json({ user: safeUser(updated) });
});

// -------------------- USER SEARCH --------------------

app.get("/api/users/search", authenticate, (req, res) => {
  const query = String(req.query.q || "").trim();

  if (query.length < 2) {
    return res.json({ users: [] });
  }

  const users = db.prepare(`
    SELECT id, username, display_name, status_text, avatar_color
    FROM users
    WHERE id != ?
      AND username LIKE ?
    ORDER BY username
    LIMIT 20
  `).all(req.user.id, `%${query}%`);

  res.json({ users: users.map(safeUser) });
});

// -------------------- FRIENDS --------------------

app.get("/api/friends", authenticate, (req, res) => {
  const id = req.user.id;

  const friends = db.prepare(`
    SELECT users.*
    FROM friendships
    JOIN users ON users.id =
      CASE
        WHEN friendships.user_id = ? THEN friendships.friend_id
        ELSE friendships.user_id
      END
    WHERE friendships.status = 'accepted'
      AND (friendships.user_id = ? OR friendships.friend_id = ?)
    ORDER BY users.username
  `).all(id, id, id);

  const requests = db.prepare(`
    SELECT friendships.id AS request_id, users.*
    FROM friendships
    JOIN users ON users.id = friendships.user_id
    WHERE friendships.friend_id = ?
      AND friendships.status = 'pending'
    ORDER BY friendships.created_at DESC
  `).all(id);

  res.json({
    friends: friends.map(user => ({
      ...safeUser(user),
      online: onlineUsers.has(user.id)
    })),
    requests: requests.map(user => ({
      requestId: user.request_id,
      ...safeUser(user)
    }))
  });
});

app.post("/api/friends/request", authenticate, (req, res) => {
  const username = String(req.body.username || "").trim();

  const target = db.prepare(
    "SELECT * FROM users WHERE username = ?"
  ).get(username);

  if (!target) {
    return res.status(404).json({ error: "User not found." });
  }

  if (target.id === req.user.id) {
    return res.status(400).json({ error: "You cannot add yourself." });
  }

  if (isFriend(req.user.id, target.id)) {
    return res.status(409).json({ error: "You are already friends." });
  }

  const reverseRequest = db.prepare(`
    SELECT id FROM friendships
    WHERE user_id = ? AND friend_id = ? AND status = 'pending'
  `).get(target.id, req.user.id);

  if (reverseRequest) {
    return res.status(409).json({
      error: "That person has already sent you a request. Check your requests."
    });
  }

  try {
    db.prepare(`
      INSERT INTO friendships (user_id, friend_id, status)
      VALUES (?, ?, 'pending')
    `).run(req.user.id, target.id);

    addNotification(
      target.id,
      `${req.user.username} sent you a friend request.`,
      "friend"
    );

    res.json({ success: true, message: "Friend request sent!" });
  } catch (error) {
    res.status(409).json({ error: "A request already exists." });
  }
});

app.post("/api/friends/accept", authenticate, (req, res) => {
  const requestId = Number(req.body.requestId);

  const request = db.prepare(`
    SELECT * FROM friendships
    WHERE id = ? AND friend_id = ? AND status = 'pending'
  `).get(requestId, req.user.id);

  if (!request) {
    return res.status(404).json({ error: "Friend request not found." });
  }

  db.prepare(`
    UPDATE friendships SET status = 'accepted' WHERE id = ?
  `).run(requestId);

  addNotification(
    request.user_id,
    `${req.user.username} accepted your friend request.`,
    "friend"
  );

  res.json({ success: true });
});

// -------------------- DIRECT MESSAGES --------------------

app.get("/api/dms/:userId/messages", authenticate, (req, res) => {
  const otherId = Number(req.params.userId);

  if (!isFriend(req.user.id, otherId)) {
    return res.status(403).json({ error: "You must be friends to message." });
  }

  const messages = db.prepare(`
    SELECT messages.*, users.username, users.display_name, users.avatar_color
    FROM messages
    JOIN users ON users.id = messages.sender_id
    WHERE
      (sender_id = ? AND recipient_id = ?)
      OR
      (sender_id = ? AND recipient_id = ?)
    ORDER BY messages.id ASC
    LIMIT 200
  `).all(req.user.id, otherId, otherId, req.user.id);

  res.json({ messages });
});

app.post("/api/dms/:userId/messages", authenticate, (req, res) => {
  const otherId = Number(req.params.userId);
  const content = String(req.body.content || "").trim();

  if (!content || content.length > 2000) {
    return res.status(400).json({ error: "Messages must be 1–2000 characters." });
  }

  if (!isFriend(req.user.id, otherId)) {
    return res.status(403).json({ error: "You must be friends to message." });
  }

  const result = db.prepare(`
    INSERT INTO messages (sender_id, recipient_id, content)
    VALUES (?, ?, ?)
  `).run(req.user.id, otherId, content);

  const message = db.prepare(`
    SELECT messages.*, users.username, users.display_name, users.avatar_color
    FROM messages
    JOIN users ON users.id = messages.sender_id
    WHERE messages.id = ?
  `).get(result.lastInsertRowid);

  io.to(`user:${req.user.id}`).to(`user:${otherId}`).emit("newMessage", message);

  res.json({ message });
});

// -------------------- GROUP CHATS --------------------

app.get("/api/groups", authenticate, (req, res) => {
  const groups = db.prepare(`
    SELECT groups.*,
      (SELECT COUNT(*) FROM group_members
       WHERE group_members.group_id = groups.id) AS member_count
    FROM groups
    JOIN group_members ON group_members.group_id = groups.id
    WHERE group_members.user_id = ?
    ORDER BY groups.created_at DESC
  `).all(req.user.id);

  res.json({ groups });
});

app.post("/api/groups", authenticate, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  const memberIds = Array.isArray(req.body.memberIds)
    ? req.body.memberIds.map(Number)
    : [];

  if (!name) {
    return res.status(400).json({ error: "Enter a group name." });
  }

  const uniqueIds = [...new Set([req.user.id, ...memberIds])];

  if (uniqueIds.length < 2) {
    return res.status(400).json({
      error: "Add at least one other member to create a group."
    });
  }

  for (const id of uniqueIds) {
    if (id !== req.user.id && !isFriend(req.user.id, id)) {
      return res.status(403).json({
        error: "You can only add your friends to a group."
      });
    }
  }

  const createGroup = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO groups (name, owner_id) VALUES (?, ?)
    `).run(name, req.user.id);

    const insertMember = db.prepare(`
      INSERT INTO group_members (group_id, user_id) VALUES (?, ?)
    `);

    for (const id of uniqueIds) {
      insertMember.run(result.lastInsertRowid, id);
    }

    return result.lastInsertRowid;
  });

  const groupId = createGroup();

  for (const id of uniqueIds) {
    io.to(`user:${id}`).emit("groupCreated", { groupId, name });
  }

  res.json({ success: true, groupId });
});

app.get("/api/groups/:groupId/messages", authenticate, (req, res) => {
  const groupId = Number(req.params.groupId);

  if (!isGroupMember(groupId, req.user.id)) {
    return res.status(403).json({ error: "You are not in this group." });
  }

  const messages = db.prepare(`
    SELECT group_messages.*, users.username,
      users.display_name, users.avatar_color
    FROM group_messages
    JOIN users ON users.id = group_messages.sender_id
    WHERE group_messages.group_id = ?
    ORDER BY group_messages.id ASC
    LIMIT 200
  `).all(groupId);

  res.json({ messages });
});

app.post("/api/groups/:groupId/messages", authenticate, (req, res) => {
  const groupId = Number(req.params.groupId);
  const content = String(req.body.content || "").trim();

  if (!content || content.length > 2000) {
    return res.status(400).json({ error: "Messages must be 1–2000 characters." });
  }

  if (!isGroupMember(groupId, req.user.id)) {
    return res.status(403).json({ error: "You are not in this group." });
  }

  const result = db.prepare(`
    INSERT INTO group_messages (group_id, sender_id, content)
    VALUES (?, ?, ?)
  `).run(groupId, req.user.id, content);

  const message = db.prepare(`
    SELECT group_messages.*, users.username,
      users.display_name, users.avatar_color
    FROM group_messages
    JOIN users ON users.id = group_messages.sender_id
    WHERE group_messages.id = ?
  `).get(result.lastInsertRowid);

  io.to(`group:${groupId}`).emit("groupMessage", message);

  res.json({ message });
});

// -------------------- NOTIFICATIONS --------------------

app.get("/api/notifications", authenticate, (req, res) => {
  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 50
  `).all(req.user.id);

  res.json({ notifications });
});

app.post("/api/notifications/read", authenticate, (req, res) => {
  db.prepare(`
    UPDATE notifications SET read = 1 WHERE user_id = ?
  `).run(req.user.id);

  res.json({ success: true });
});

// -------------------- REAL-TIME CONNECTIONS --------------------

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error("Not authenticated"));

    const session = db.prepare(`
      SELECT user_id FROM sessions
      WHERE token_hash = ? AND expires_at > ?
    `).get(hashToken(token), new Date().toISOString());

    if (!session) return next(new Error("Invalid session"));

    socket.data.userId = session.user_id;
    next();
  } catch (error) {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", socket => {
  const userId = socket.data.userId;

  socket.join(`user:${userId}`);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  const groups = db.prepare(`
    SELECT group_id FROM group_members WHERE user_id = ?
  `).all(userId);

  for (const group of groups) {
    socket.join(`group:${group.group_id}`);
  }

  io.emit("onlineUsers", [...onlineUsers.keys()]);

  socket.on("disconnect", () => {
    const sockets = onlineUsers.get(userId);

    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        onlineUsers.delete(userId);
      }
    }

    io.emit("onlineUsers", [...onlineUsers.keys()]);
  });
});

server.listen(PORT, () => {
  console.log("=========================================");
  console.log(" VEXCHAT SERVER IS RUNNING");
  console.log(` Port: ${3000}`);
  console.log("=========================================");
});
