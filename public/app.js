const socket = io();

const nameInput = document.querySelector("#name");
const emailInput = document.querySelector("#email");
const roomCodeInput = document.querySelector("#room-code");
const createRoomButton = document.querySelector("#create-room");
const joinRoomButton = document.querySelector("#join-room");
const startGameButton = document.querySelector("#start-game");
const leaveRoomButton = document.querySelector("#leave-room");
const status = document.querySelector("#status");
const role = document.querySelector("#role");
const turn = document.querySelector("#turn");
const playersList = document.querySelector("#players");
const messagesList = document.querySelector("#messages");
const answererSelect = document.querySelector("#answerer");
const chatMessageInput = document.querySelector("#chat-message");
const sendChatMessageButton = document.querySelector("#send-chat-message");

socket.on("connect", () => {
  status.textContent = `Connected as ${socket.id}`;
});

createRoomButton.addEventListener("click", () => {
  socket.emit("create_room", {
    name: nameInput.value,
    email: emailInput.value
  });
});

joinRoomButton.addEventListener("click", () => {
  socket.emit("join_room", {
    code: roomCodeInput.value,
    name: nameInput.value,
    email: emailInput.value
  });
});

startGameButton.addEventListener("click", () => {
  socket.emit("start_game");
});

leaveRoomButton.addEventListener("click", () => {
  socket.emit("leave_room");
});

sendChatMessageButton.addEventListener("click", () => {
  sendMessage();
});

chatMessageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

function sendMessage() {
  socket.emit("send_chat_message", {
    text: chatMessageInput.value,
    answererName: answererSelect.value
  });

  chatMessageInput.value = "";
}

socket.on("room_created", ({ code }) => {
  roomCodeInput.value = code;
  role.textContent = "";
  turn.textContent = "";
  status.textContent = `Created room ${code}`;
});

socket.on("room_joined", ({ code }) => {
  roomCodeInput.value = code;
  role.textContent = "";
  turn.textContent = "";
  status.textContent = `Joined room ${code}`;
});

socket.on("room_left", () => {
  roomCodeInput.value = "";
  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  answererSelect.innerHTML = "";
  role.textContent = "";
  turn.textContent = "";
  status.textContent = "Left room";
});

socket.on("room_destroyed", ({ message }) => {
  roomCodeInput.value = "";
  playersList.innerHTML = "";
  messagesList.innerHTML = "";
  answererSelect.innerHTML = "";
  role.textContent = "";
  turn.textContent = "";
  status.textContent = "Room destroyed";
  alert(message);
});

socket.on("room_updated", ({ status: roomStatus, turn: currentTurn, players, messages }) => {
  status.textContent = `Room status: ${roomStatus}`;

  if (!currentTurn) {
    turn.textContent = "Free chat before the game starts.";
  } else if (currentTurn.phase === "asking") {
    turn.textContent = `${currentTurn.currentQuestionerName} asks next.`;
  } else {
    turn.textContent = `${currentTurn.currentAnswererName} is answering ${currentTurn.currentQuestionerName}.`;
  }

  playersList.innerHTML = "";

  for (const player of players) {
    const li = document.createElement("li");
    li.textContent = player.isHost ? `${player.name} (host)` : player.name;
    playersList.appendChild(li);
  }

  answererSelect.innerHTML = "";

  for (const player of players) {
    const option = document.createElement("option");
    option.value = player.name;
    option.textContent = player.name;
    answererSelect.appendChild(option);
  }

  messagesList.innerHTML = "";

  for (const message of messages) {
    const li = document.createElement("li");

    if (message.type === "question") {
      li.textContent = `${message.senderName} → ${message.recipientName}: ${message.text}`;
    } else if (message.type === "system") {
      li.textContent = message.text;
    } else {
      li.textContent = `${message.senderName}: ${message.text}`;
    }

    messagesList.appendChild(li);
  }
});

socket.on("role_assigned", ({ role: assignedRole, location }) => {
  if (assignedRole === "spy") {
    role.textContent = "You are the spy";
  } else {
    role.textContent = `Location: ${location}`;
  }
});

socket.on("app_error", message => {
  alert(message);
});