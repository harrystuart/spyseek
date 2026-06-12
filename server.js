import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createGame } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_CHAT_MESSAGE_LENGTH = 500;

const rooms = new Map();

app.use(express.static("public"));

io.on("connection", socket => {
  console.log("connected", socket.id);

  socket.on("create_room", ({ name, email }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const playerError = validatePlayerInput(name, email);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    const player = createPlayer(socket.id, name, email);

    rooms.set(code, {
      hostId: socket.id,
      status: "lobby",
      players: [player],
      messages: [],
      game: null
    });

    socket.data.roomCode = code;
    socket.join(code);

    socket.emit("room_created", { code });
    io.to(code).emit("room_updated", publicRoom(rooms.get(code)));

    console.log(rooms);
  });

  socket.on("join_room", ({ code, name, email }) => {
    if (socket.data.roomCode) {
      socket.emit("app_error", "You are already in a room");
      return;
    }

    const roomCodeError = validateRoomCodeInput(code);

    if (roomCodeError) {
      socket.emit("app_error", roomCodeError);
      return;
    }

    const playerError = validatePlayerInput(name, email);

    if (playerError) {
      socket.emit("app_error", playerError);
      return;
    }

    const roomCode = code.trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("app_error", `Room ${roomCode} does not exist`);
      return;
    }

    if (room.status !== "lobby") {
      socket.emit("app_error", "Game is already playing");
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("app_error", `Room ${roomCode} is full`);
      return;
    }

    const duplicatePlayerError = validateUniquePlayerInRoom(room, name, email);

    if (duplicatePlayerError) {
      socket.emit("app_error", duplicatePlayerError);
      return;
    }

    const player = createPlayer(socket.id, name, email);

    room.players.push(player);
    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    socket.emit("room_joined", { code: roomCode });
    io.to(roomCode).emit("room_updated", publicRoom(room));

    console.log(rooms);
  });

  socket.on("start_game", () => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.hostId !== socket.id) {
      socket.emit("app_error", "Only the host can start the game");
      return;
    }

    if (room.status === "playing") {
      socket.emit("app_error", "Game is already playing");
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      socket.emit("app_error", `Need at least ${MIN_PLAYERS} players to start`);
      return;
    }

    room.status = "playing";
    room.game = createGame(room.players);

    room.messages.push({
      type: "system",
      senderId: null,
      senderName: "System",
      recipientName: null,
      text: "Game started.",
      sentAt: new Date().toISOString()
    });

    io.to(roomCode).emit("room_updated", publicRoom(room));
    sendPlayerRoles(room);

    console.log(rooms);
  });

  socket.on("send_chat_message", ({ text, answererName }) => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const messageError = validateChatMessageInput(text);

    if (messageError) {
      socket.emit("app_error", messageError);
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    const player = room.players.find(player => player.id === socket.id);

    if (!player) {
      throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
    }

    if (room.status === "lobby") {
      room.messages.push({
        type: "chat",
        senderId: socket.id,
        senderName: player.name,
        recipientName: null,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    if (room.status !== "playing") {
      throw new Error(`Unknown room status ${room.status}`);
    }

    if (!room.game) {
      throw new Error(`Room ${roomCode} is playing without a game`);
    }

    if (room.game.phase === "asking") {
      if (room.game.currentQuestionerId !== socket.id) {
        socket.emit("app_error", "It is not your turn to ask");
        return;
      }

      const answererError = validateAnswererInput(answererName);

      if (answererError) {
        socket.emit("app_error", answererError);
        return;
      }

      const answerer = room.players.find(player => {
        return player.name.toLowerCase() === answererName.trim().toLowerCase();
      });

      if (!answerer) {
        socket.emit("app_error", "Answerer is not in this room");
        return;
      }

      if (answerer.id === socket.id) {
        socket.emit("app_error", "You cannot ask yourself");
        return;
      }

      if (answerer.id === room.game.previousQuestionerId) {
        socket.emit("app_error", "You cannot ask the previous questioner");
        return;
      }

      room.messages.push({
        type: "question",
        senderId: socket.id,
        senderName: player.name,
        recipientName: answerer.name,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      room.game.phase = "answering";
      room.game.currentAnswererId = answerer.id;

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    if (room.game.phase === "answering") {
      if (room.game.currentAnswererId !== socket.id) {
        socket.emit("app_error", "It is not your turn to answer");
        return;
      }

      room.messages.push({
        type: "answer",
        senderId: socket.id,
        senderName: player.name,
        recipientName: null,
        text: text.trim(),
        sentAt: new Date().toISOString()
      });

      room.game.previousQuestionerId = room.game.currentQuestionerId;
      room.game.currentQuestionerId = socket.id;
      room.game.currentAnswererId = null;
      room.game.phase = "asking";

      io.to(roomCode).emit("room_updated", publicRoom(room));

      console.log(rooms);
      return;
    }

    throw new Error(`Unknown game phase ${room.game.phase}`);
  });

  socket.on("leave_room", () => {
    if (!socket.data.roomCode) {
      socket.emit("app_error", "You are not in a room");
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
    }

    if (room.status === "playing") {
      destroyRoom(roomCode, "A player left during the game. The room was destroyed.");
      console.log(rooms);
      return;
    }

    leaveRoom(socket);
    socket.emit("room_left");

    console.log(rooms);
  });

  socket.on("disconnect", () => {
    if (!socket.data.roomCode) {
      return;
    }

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) {
      throw new Error(`Socket ${socket.id} disconnected from missing room ${roomCode}`);
    }

    if (room.status === "playing") {
      destroyRoom(roomCode, "A player disconnected during the game. The room was destroyed.");
      console.log(rooms);
      return;
    }

    leaveRoom(socket);

    console.log(rooms);
  });
});

function validatePlayerInput(name, email) {
  if (typeof name !== "string") {
    return "Username is required";
  }

  if (typeof email !== "string") {
    return "Email is required";
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName) {
    return "Username is required";
  }

  if (cleanName.length > 32) {
    return "Username must be 32 characters or fewer";
  }

  if (!cleanEmail) {
    return "Email is required";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return "Email is invalid";
  }
}

function validateRoomCodeInput(code) {
  if (typeof code !== "string") {
    return "Room code is required";
  }

  const roomCode = code.trim().toUpperCase();

  if (!roomCode) {
    return "Room code is required";
  }

  if (!/^[A-Z0-9]{4}$/.test(roomCode)) {
    return "Room code must be 4 letters or numbers";
  }
}

function validateChatMessageInput(text) {
  if (typeof text !== "string") {
    return "Message is required";
  }

  const cleanText = text.trim();

  if (!cleanText) {
    return "Message is required";
  }

  if (cleanText.length > MAX_CHAT_MESSAGE_LENGTH) {
    return `Message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer`;
  }
}

function validateAnswererInput(answererName) {
  if (typeof answererName !== "string") {
    return "Choose someone to answer";
  }

  if (!answererName.trim()) {
    return "Choose someone to answer";
  }
}

function validateUniquePlayerInRoom(room, name, email) {
  const cleanName = name.trim().toLowerCase();
  const cleanEmail = email.trim().toLowerCase();

  const duplicateName = room.players.find(player => {
    return player.name.toLowerCase() === cleanName;
  });

  if (duplicateName) {
    return "Username is already taken in this room";
  }

  const duplicateEmail = room.players.find(player => {
    return player.email === cleanEmail;
  });

  if (duplicateEmail) {
    return "Email is already in this room";
  }
}

function createPlayer(id, name, email) {
  return {
    id,
    name: name.trim(),
    email: email.trim().toLowerCase()
  };
}

function sendPlayerRoles(room) {
  if (!room.game) {
    throw new Error("Cannot send player roles before game exists");
  }

  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);

    if (!playerSocket) {
      throw new Error(`Player ${player.id} has no active socket`);
    }

    if (player.id === room.game.spyId) {
      playerSocket.emit("role_assigned", {
        role: "spy"
      });
    } else {
      playerSocket.emit("role_assigned", {
        role: "player",
        location: room.game.location
      });
    }
  }
}

function leaveRoom(socket) {
  const roomCode = socket.data.roomCode;
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error(`Socket ${socket.id} thinks it is in missing room ${roomCode}`);
  }

  const player = room.players.find(player => player.id === socket.id);

  if (!player) {
    throw new Error(`Socket ${socket.id} is missing from room ${roomCode}`);
  }

  room.players = room.players.filter(player => player.id !== socket.id);
  socket.leave(roomCode);
  delete socket.data.roomCode;

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
  }

  io.to(roomCode).emit("room_updated", publicRoom(room));
}

function destroyRoom(roomCode, message) {
  const room = rooms.get(roomCode);

  if (!room) {
    throw new Error(`Tried to destroy missing room ${roomCode}`);
  }

  io.to(roomCode).emit("room_destroyed", { message });

  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);

    if (playerSocket) {
      delete playerSocket.data.roomCode;
      playerSocket.leave(roomCode);
    }
  }

  rooms.delete(roomCode);
}

function publicRoom(room) {
  const host = room.players.find(player => player.id === room.hostId);

  if (!host) {
    throw new Error(`Room host ${room.hostId} is missing from players`);
  }

  let turn = null;

  if (room.status === "playing") {
    if (!room.game) {
      throw new Error("Playing room has no game");
    }

    const currentQuestioner = room.players.find(player => {
      return player.id === room.game.currentQuestionerId;
    });

    if (!currentQuestioner) {
      throw new Error(`Current questioner ${room.game.currentQuestionerId} is missing from players`);
    }

    const currentAnswerer = room.game.currentAnswererId
      ? room.players.find(player => player.id === room.game.currentAnswererId)
      : null;

    if (room.game.currentAnswererId && !currentAnswerer) {
      throw new Error(`Current answerer ${room.game.currentAnswererId} is missing from players`);
    }

    turn = {
      phase: room.game.phase,
      currentQuestionerName: currentQuestioner.name,
      currentAnswererName: currentAnswerer ? currentAnswerer.name : null
    };
  }

  return {
    status: room.status,
    turn,
    players: room.players.map(player => ({
      name: player.name,
      isHost: player.id === room.hostId
    })),
    messages: room.messages.map(message => ({
      type: message.type,
      senderName: message.senderName,
      recipientName: message.recipientName,
      text: message.text,
      sentAt: message.sentAt
    }))
  };
}

server.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});