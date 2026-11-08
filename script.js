
// =====================================
// VEXCHAT - FRONTEND JAVASCRIPT
// =====================================

const $ = (id) => document.getElementById(id);

// Page navigation
const pages = ["home", "friends", "messages", "groups"];

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    pages.forEach(name => {
      $(name + "Page").classList.toggle("active", name === page);
    });

    document.querySelectorAll(".nav-item").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    $("pageTitle").textContent =
      page.charAt(0).toUpperCase() + page.slice(1);
  });
});

// Demo username
let username = "Guest";
$("usernameDisplay").textContent = username;

// Local demo friends
let friends = [];

function updateFriends() {
  $("friendsList").innerHTML = "";

  if (friends.length === 0) {
    $("friendsList").textContent = "No friends added yet.";
  }

  friends.forEach(friend => {
    const item = document.createElement("div");
    item.className = "friend-item";

    const name = document.createElement("strong");
    name.textContent = friend;

    const status = document.createElement("span");
    status.textContent = "Friend";

    item.append(name, status);
    $("friendsList").appendChild(item);
  });

  $("friendCount").textContent = friends.length;
}

// Add friend demo
$("addFriendBtn").addEventListener("click", () => {
  const input = $("friendUsername");
  const friend = input.value.trim();

  if (!friend) {
    alert("Please enter a username.");
    return;
  }

  if (friend.toLowerCase() === username.toLowerCase()) {
    alert("You cannot add yourself!");
    return;
  }

  if (friends.some(f => f.toLowerCase() === friend.toLowerCase())) {
    alert("This friend is already added.");
    return;
  }

  friends.push(friend);
  input.value = "";

  updateFriends();
  alert(friend + " was added to your demo friends list!");
});

// Group chat demo
$("createGroupBtn").addEventListener("click", () => {
  const name = prompt("What would you like to name your group?");

  if (name && name.trim()) {
    alert("Group '" + name.trim() + "' is ready for the backend setup!");
  }
});

// Search demo
$("searchInput").addEventListener("input", event => {
  console.log("Searching:", event.target.value);
});

// Notifications demo
$("notificationBtn").addEventListener("click", () => {
  alert("You have no new notifications.");
});

// Settings demo
$("settingsBtn").addEventListener("click", () => {
  const newName = prompt("Enter your display name:", username);

  if (newName && newName.trim()) {
    username = newName.trim();
    $("usernameDisplay").textContent = username;
    document.querySelector(".avatar").textContent =
      username.charAt(0).toUpperCase();
  }
});

// Initial dashboard
$("messageCount").textContent = "0";
$("onlineCount").textContent = "0";

updateFriends();

console.log("VEXCHAT frontend loaded successfully!");
