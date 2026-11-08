
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./database");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in the hosting environment.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "VEXCHAT online" });
});

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !/^[a-zA-Z0-9_]{3,20}$/.test(username) ||
      password.length < 10 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Use a 3-20 character username and a password of 10-72 characters."
      });
    }

    const existing = db.prepare(
      "SELECT id FROM users WHERE username = ?"
    ).get(username.toLowerCase());

    if (existing) {
      return res.status(409).json({ error: "Username already taken." });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = db.prepare(
      "INSERT INTO users (username, password) VALUES (?, ?)"
    ).run(username.toLowerCase(), hash);

    const token = jwt.sign(
      { id: result.lastInsertRowid, username: username.toLowerCase() },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Account created!",
      token,
      username: username.toLowerCase()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create account." });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Enter your username and password." });
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE username = ?"
    ).get(username.toLowerCase());

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Welcome back!",
      token,
      username: user.username
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
});

// Verify authentication
function authenticate(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Login required"));

    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid login token"));
  }
}

// Real-time chat
io.use(authenticate);

io.on("connection", socket => {
  console.log(socket.user.username + " connected");

  socket.join("user:" + socket.user.id);

  socket.on("private-message", data => {
    if (
      !data ||
      !Number.isInteger(data.to) ||
      typeof data.text !== "string"
    ) return;

    const text = data.text.trim();

    if (!text || text.length > 2000) return;

    const recipient = db.prepare(
      "SELECT id FROM users WHERE id = ?"
    ).get(data.to);

    if (!recipient) return;

    const result = db.prepare(`
      INSERT INTO messages (sender_id, recipient_id, content)
      VALUES (?, ?, ?)
    `).run(socket.user.id, recipient.id, text);

    const message = {
      id: result.lastInsertRowid,
      from: socket.user.id,
      username: socket.user.username,
      text,
      createdAt: new Date().toISOString()
    };

    io.to("user:" + recipient.id)
      .to("user:" + socket.user.id)
      .emit("private-message", message);
  });

  socket.on("disconnect", () => {
    console.log(socket.user.username + " disconnected");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("VEXCHAT running on port " + PORT);
});
