// ============================================
// VEXCHAT - COMPLETE FRONTEND
// ============================================

const $ = id => document.getElementById(id);

let token = localStorage.getItem("vexchat_token");
let currentUser = null;
let socket = null;
let friends = [];
let friendRequests = [];
let groups = [];
let onlineIds = [];
let currentChat = null;
let selectedColor = "#5865f2";
let registerMode = false;

const pages = [
  "homePage",
  "friendsPage",
  "groupsPage",
  "profilePage",
  "notificationsPage"
];

// ---------------- API ----------------

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function makeAvatar(name, color, extraClass = "") {
  const avatar = document.createElement("div");
  avatar.className = `avatar ${extraClass}`.trim();
  avatar.textContent = initials(name);
  avatar.style.background = color || "#5865f2";
  return avatar;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function emptyMessage(container, message) {
  container.innerHTML = "";
  const p = document.createElement("p");
  p.className = "empty-small";
  p.textContent = message;
  container.appendChild(p);
}

// ---------------- AUTH ----------------

$("switchAuth").addEventListener("click", () => {
  registerMode = !registerMode;

  $("authTitle").textContent = registerMode
    ? "Create an account"
    : "Welcome back!";

  $("authSubtitle").textContent = registerMode
    ? "Join your friends on VEXCHAT."
    : "We're so excited to see you again.";

  $("authSubmit").textContent = registerMode ? "Create Account" : "Log In";
  $("switchText").textContent = registerMode
    ? "Already have an account?"
    : "Need an account?";

  $("switchAuth").textContent = registerMode ? "Log In" : "Register";
  $("passwordInput").autocomplete = registerMode
    ? "new-password"
    : "current-password";

  $("authError").textContent = "";
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();

  const username = $("usernameInput").value.trim();
  const password = $("passwordInput").value;

  $("authError").textContent = "";

  try {
    const endpoint = registerMode ? "/api/register" : "/api/login";

    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    token = result.token;
    localStorage.setItem("vexchat_token", token);

    await startApp(result.user);
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

async function checkExistingLogin() {
  if (!token) {
    showAuth();
    return;
  }

  try {
    const result = await api("/api/me");
    await startApp(result.user);
  } catch {
    token = null;
    localStorage.removeItem("vexchat_token");
    showAuth();
  }
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
}

async function startApp(user) {
  currentUser = user;

  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");

  updateMyProfile();
  connectSocket();

  await Promise.all([
    loadFriends(),
    loadGroups(),
    loadNotifications()
  ]);

  showPage("home");
}

function updateMyProfile() {
  const name = currentUser.displayName || currentUser.username;
  const avatar = initials(name);

  $("myUsername").textContent = name;
  $("accountName").textContent = name;
  $("myStatus").textContent = currentUser.statusText || "Online";

  $("myAvatar").textContent = avatar;
  $("myAvatar").style.background = currentUser.avatarColor;

  $("profilePreview").textContent = avatar;
  $("profilePreview").style.background = currentUser.avatarColor;

  $("displayNameInput").value = currentUser.displayName || "";
  $("statusInput").value = currentUser.statusText || "";

  selectedColor = currentUser.avatarColor || "#5865f2";

  document.querySelectorAll(".color-choice").forEach(button => {
    button.classList.toggle(
      "selected",
      button.dataset.color === selectedColor
    );
  });
}

// ---------------- SOCKET.IO ----------------

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: { token }
  });

  socket.on("connect", () => {
    console.log("VEXCHAT connected.");
  });

  socket.on("connect_error", error => {
    console.error("Connection error:", error.message);
  });

  socket.on("onlineUsers", ids => {
    onlineIds = ids.map(Number);
    renderOnlineUsers();
    renderFriends();
  });

  socket.on("newMessage", message => {
    if (
      currentChat &&
      currentChat.type === "dm" &&
      Number(message.sender_id) === currentChat.id
    ) {
      addMessage(message);
    }

    loadFriends();
  });

  socket.on("groupMessage", message => {
    if (
      currentChat &&
      currentChat.type === "group" &&
      Number(message.group_id) === currentChat.id
    ) {
      addMessage(message);
    }
  });

  socket.on("notification", notification => {
    showToast(notification.message);
    loadNotifications();
  });

  socket.on("groupCreated", () => {
    loadGroups();
  });
}

// ---------------- PAGE NAVIGATION ----------------

function showPage(pageName) {
  pages.forEach(id => $(id).classList.add("hidden"));
  $(pageName).classList.remove("hidden");

  const titles = {
    homePage: "Direct Messages",
    friendsPage: "Friends",
    groupsPage: "Group Chats",
    profilePage: "Your Profile",
    notificationsPage: "Notifications"
  };

  $("topbarTitle").textContent = titles[pageName] || "VEXCHAT";

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName.replace("Page", "")
    );
  });
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    showPage(`${button.dataset.page}Page`);
  });
});

$("profileButton").addEventListener("click", () => showPage("profilePage"));
$("topProfileButton").addEventListener("click", () => showPage("profilePage"));
$("findFriendsButton").addEventListener("click", () => showPage("friendsPage"));
$("newDMButton").addEventListener("click", () => showPage("friendsPage"));
$("newGroupButton").addEventListener("click", openGroupModal);
$("createGroupPageButton").addEventListener("click", openGroupModal);
$("notificationsButton").addEventListener("click", () => {
  showPage("notificationsPage");
  loadNotifications();
});

// ---------------- FRIENDS ----------------

async function loadFriends() {
  try {
    const result = await api("/api/friends");

    friends = result.friends;
    friendRequests = result.requests;

    renderFriends();
    renderFriendRequests();
    renderDMList();

    $("requestCount").textContent = friendRequests.length;
    $("requestCount").classList.toggle(
      "hidden",
      friendRequests.length === 0
    );
  } catch (error) {
    showToast(error.message);
  }
}

function renderFriends() {
  const container = $("friendsList");
  container.innerHTML = "";

  if (!friends.length) {
    emptyMessage(container, "You haven't added any friends yet.");
    return;
  }

  friends.forEach(friend => {
    const row = document.createElement("div");
    row.className = "person-row";

    row.appendChild(
      makeAvatar(friend.displayName, friend.avatarColor)
    );

    const info = document.createElement("div");
    info.className = "person-info";

    const name = document.createElement("strong");
    name.textContent = friend.displayName;

    const status = document.createElement("span");
    status.textContent = friend.statusText ||
      (onlineIds.includes(friend.id) ? "Online" : "Offline");

    info.append(name, status);

    const actions = document.createElement("div");
    actions.className = "person-actions";

    const messageButton = document.createElement("button");
    messageButton.className = "primary-button";
    messageButton.textContent = "Message";
    messageButton.addEventListener("click", () => openDM(friend));

    actions.appendChild(messageButton);
    row.append(info, actions);
    container.appendChild(row);
  });
}

function renderFriendRequests() {
  const container = $("friendRequests");
  container.innerHTML = "";

  if (!friendRequests.length) {
    emptyMessage(container, "No pending friend requests.");
    return;
  }

  friendRequests.forEach(friend => {
    const row = document.createElement("div");
    row.className = "person-row";

    row.appendChild(makeAvatar(friend.displayName, friend.avatarColor));

    const info = document.createElement("div");
    info.className = "person-info";

    const name = document.createElement("strong");
    name.textContent = friend.displayName;

    const username = document.createElement("span");
    username.textContent = `@${friend.username}`;

    info.append(name, username);

    const accept = document.createElement("button");
    accept.className = "primary-button";
    accept.textContent = "Accept";

    accept.addEventListener("click", async () => {
      try {
        await api("/api/friends/accept", {
          method: "POST",
          body: JSON.stringify({ requestId: friend.requestId })
        });

        showToast("Friend request accepted!");
        await loadFriends();
      } catch (error) {
        showToast(error.message);
      }
    });

    row.append(info, accept);
    container.appendChild(row);
  });
}

$("addFriendForm").addEventListener("submit", async event => {
  event.preventDefault();

  const username = $("friendUsername").value.trim();

  try {
    const result = await api("/api/friends/request", {
      method: "POST",
      body: JSON.stringify({ username })
    });

    $("friendUsername").value = "";
    $("friendSearchResults").innerHTML = "";
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
  }
});

function renderDMList() {
  const container = $("dmList");
  container.innerHTML = "";

  if (!friends.length) {
    emptyMessage(container, "Your conversations will appear here.");
    return;
  }

  friends.forEach(friend => {
    const button = document.createElement("button");
    button.className = "conversation-item";

    button.appendChild(
      makeAvatar(friend.displayName, friend.avatarColor)
    );

    const name = document.createElement("span");
    name.textContent = friend.displayName;
    button.appendChild(name);

    if (
      currentChat &&
      currentChat.type === "dm" &&
      currentChat.id === friend.id
    ) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => openDM(friend));
    container.appendChild(button);
  });
}

// ---------------- DIRECT MESSAGES ----------------

async function openDM(friend) {
  currentChat = {
    type: "dm",
    id: friend.id,
    name: friend.displayName,
    color: friend.avatarColor
  };

  $("welcomePanel").classList.add("hidden");
  $("chatPanel").classList.remove("hidden");

  $("chatName").textContent = friend.displayName;
  $("chatAvatar").textContent = initials(friend.displayName);
  $("chatAvatar").style.background = friend.avatarColor;

  $("chatStatus").textContent = onlineIds.includes(friend.id)
    ? "Online"
    : "Direct message";

  showPage("homePage");
  renderDMList();
  await loadDMMessages(friend.id);
}

async function loadDMMessages(friendId) {
  try {
    const result = await api(`/api/dms/${friendId}/messages`);

    if (
      !currentChat ||
      currentChat.type !== "dm" ||
      currentChat.id !== friendId
    ) return;

    $("messageList").innerHTML = "";
    result.messages.forEach(addMessage);
    scrollMessages();
  } catch (error) {
    showToast(error.message);
  }
}

// ---------------- GROUPS ----------------

async function loadGroups() {
  try {
    const result = await api("/api/groups");
    groups = result.groups;
    renderGroups();
  } catch (error) {
    showToast(error.message);
  }
}

function renderGroups() {
  const sidebar = $("groupList");
  const grid = $("groupsGrid");

  sidebar.innerHTML = "";
  grid.innerHTML = "";

  if (!groups.length) {
    emptyMessage(sidebar, "No groups yet.");
    emptyMessage(grid, "You haven't joined any groups yet.");
    return;
  }

  groups.forEach(group => {
    const button = document.createElement("button");
    button.className = "conversation-item";
    button.innerHTML = "<span>✉</span>";

    const name = document.createElement("span");
    name.textContent = group.name;
    button.appendChild(name);
    button.addEventListener("click", () => openGroup(group));

    sidebar.appendChild(button);

    const card = document.createElement("div");
    card.className = "group-card";

    const symbol = document.createElement("div");
    symbol.className = "group-symbol";
    symbol.textContent = "✉";

    const title = document.createElement("strong");
    title.textContent = group.name;

    const count = document.createElement("span");
    count.textContent = `${group.member_count} members`;

    card.append(symbol, title, count);
    card.addEventListener("click", () => openGroup(group));

    grid.appendChild(card);
  });
}

async function openGroup(group) {
  currentChat = {
    type: "group",
    id: group.id,
    name: group.name,
    color: "#5865f2"
  };

  $("welcomePanel").classList.add("hidden");
  $("chatPanel").classList.remove("hidden");

  $("chatName").textContent = group.name;
  $("chatAvatar").textContent = "✉";
  $("chatAvatar").style.background = "#5865f2";
  $("chatStatus").textContent = `${group.member_count} members`;

  showPage("homePage");

  $("messageList").innerHTML = "";

  try {
    const result = await api(`/api/groups/${group.id}/messages`);

    if (
      !currentChat ||
      currentChat.type !== "group" ||
      currentChat.id !== group.id
    ) return;

    result.messages.forEach(addMessage);
    scrollMessages();
  } catch (error) {
    showToast(error.message);
  }
}

// ---------------- CREATE GROUP ----------------

function openGroupModal() {
  $("groupModal").classList.remove("hidden");
  $("groupError").textContent = "";

  const choices = $("groupFriendChoices");
  choices.innerHTML = "";

  if (!friends.length) {
    emptyMessage(choices, "Add friends before creating a group.");
    return;
  }

  friends.forEach(friend => {
    const label = document.createElement("label");
    label.className = "group-friend-choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = friend.id;

    const name = document.createElement("span");
    name.textContent = friend.displayName;

    label.append(checkbox, name);
    choices.appendChild(label);
  });
}

$("closeGroupModal").addEventListener("click", () => {
  $("groupModal").classList.add("hidden");
});

$("groupModal").addEventListener("click", event => {
  if (event.target === $("groupModal")) {
    $("groupModal").classList.add("hidden");
  }
});

$("groupForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("groupNameInput").value.trim();

  const memberIds = [
    ...$("groupFriendChoices").querySelectorAll(
      'input[type="checkbox"]:checked'
    )
  ].map(input => Number(input.value));

  try {
    const result = await api("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name, memberIds })
    });

    $("groupModal").classList.add("hidden");
    $("groupNameInput").value = "";

    await loadGroups();

    const group = groups.find(item => item.id === result.groupId);
    if (group) openGroup(group);

    showToast("Group created!");
  } catch (error) {
    $("groupError").textContent = error.message;
  }
});

// ---------------- MESSAGE DISPLAY ----------------

function addMessage(message) {
  const container = $("messageList");

  const row = document.createElement("div");
  row.className = "message";

  const name = message.display_name || message.username;
  const color = message.avatar_color || "#5865f2";

  row.appendChild(makeAvatar(name, color));

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const username = document.createElement("strong");
  username.textContent = name;

  const time = document.createElement("time");
  time.textContent = formatTime(message.created_at);

  meta.append(username, time);

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.content;

  body.append(meta, text);
  row.appendChild(body);
  container.appendChild(row);

  scrollMessages();
}

function scrollMessages() {
  const container = $("messageList");
  container.scrollTop = container.scrollHeight;
}

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const content = $("messageInput").value.trim();

  if (!content || !currentChat) return;

  $("messageInput").value = "";

  try {
    let result;

    if (currentChat.type === "dm") {
      result = await api(`/api/dms/${currentChat.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content })
      });
    } else {
      result = await api(`/api/groups/${currentChat.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content })
      });
    }

    // The socket event also arrives for the sender.
    // Only display the returned message if the socket did not already add it.
    const alreadyDisplayed = [
      ...$("messageList").querySelectorAll(".message-text")
    ].some(element => element.textContent === content);

    if (!alreadyDisplayed) {
      addMessage(result.message);
    }
  } catch (error) {
    $("messageInput").value = content;
    showToast(error.message);
  }
});

// ---------------- ONLINE USERS ----------------

function renderOnlineUsers() {
  const container = $("onlineList");
  container.innerHTML = "";

  const onlineFriends = friends.filter(friend =>
    onlineIds.includes(friend.id)
  );

  if (!onlineFriends.length) {
    emptyMessage(container, "None of your friends are online.");
    return;
  }

  onlineFriends.forEach(friend => {
    const row = document.createElement("div");
    row.className = "online-person";

    row.appendChild(makeAvatar(friend.displayName, friend.avatarColor));

    const name = document.createElement("strong");
    name.textContent = friend.displayName;

    const dot = document.createElement("div");
    dot.className = "online-dot";

    row.append(name, dot);
    container.appendChild(row);
  });
}

// ---------------- PROFILE ----------------

document.querySelectorAll(".color-choice").forEach(button => {
  button.addEventListener("click", () => {
    selectedColor = button.dataset.color;

    document.querySelectorAll(".color-choice").forEach(item => {
      item.classList.toggle("selected", item === button);
    });

    $("profilePreview").style.background = selectedColor;
  });
});

$("profileForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: $("displayNameInput").value,
        statusText: $("statusInput").value,
        avatarColor: selectedColor
      })
    });

    currentUser = result.user;
    updateMyProfile();

    $("profileMessage").textContent = "Profile saved successfully!";
    showToast("Profile updated!");
  } catch (error) {
    $("profileMessage").textContent = error.message;
  }
});

// ---------------- NOTIFICATIONS ----------------

async function loadNotifications() {
  try {
    const result = await api("/api/notifications");
    const container = $("notificationsList");

    container.innerHTML = "";

    if (!result.notifications.length) {
      emptyMessage(container, "You're all caught up!");
      return;
    }

    result.notifications.forEach(notification => {
      const row = document.createElement("div");
      row.className = "notification-row";

      if (!notification.read) {
        row.classList.add("unread");
      }

      const message = document.createElement("span");
      message.textContent = notification.message;

      const time = document.createElement("time");
      time.textContent = formatTime(notification.created_at);

      row.append(message, time);
      container.appendChild(row);
    });
  } catch (error) {
    console.error(error);
  }
}

$("markReadButton").addEventListener("click", async () => {
  try {
    await api("/api/notifications/read", { method: "POST" });
    await loadNotifications();
    showToast("Notifications marked as read.");
  } catch (error) {
    showToast(error.message);
  }
});

// ---------------- LOGOUT ----------------

$("logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    console.error(error);
  }

  if (socket) socket.disconnect();

  localStorage.removeItem("vexchat_token");
  token = null;
  currentUser = null;
  currentChat = null;

  $("usernameInput").value = "";
  $("passwordInput").value = "";

  showAuth();
});

// ---------------- START ----------------

checkExistingLogin();
