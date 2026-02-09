const http = require("http");
const next = require("next");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

function loadGames() {
  const gamesDir = path.join(__dirname, "data", "games");
  if (!fs.existsSync(gamesDir)) {
    return [];
  }
  const files = fs.readdirSync(gamesDir).filter((file) => file.endsWith(".json"));
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(gamesDir, file), "utf8");
    return JSON.parse(raw);
  });
}

const games = loadGames();
const gameMap = new Map(games.map((game) => [game.id, game]));
const rooms = new Map();
const socketIndex = new Map();
const sessionIndex = new Map();
const disconnectGraceMs = 60000;

function generateRoomCode() {
  let code = "";
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function createPlayer(name, socketId, sessionId) {
  return {
    id: crypto.randomUUID(),
    name,
    socketId,
    sessionId,
    roleId: null,
    hasSubmittedRole: false,
    connected: true,
    disconnectTimer: null
  };
}

function bindSession(sessionId, code, player, socket) {
  player.socketId = socket.id;
  player.sessionId = sessionId;
  player.connected = true;
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  socketIndex.set(socket.id, { code, playerId: player.id, sessionId });
  sessionIndex.set(sessionId, { code, playerId: player.id });
}

function resetRoles(room) {
  room.players.forEach((player) => {
    player.roleId = null;
    player.hasSubmittedRole = false;
  });
}

function serializeRoom(room) {
  return {
    code: room.code,
    ownerId: room.ownerId,
    gameId: room.gameId,
    phase: room.phase,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      hasSubmittedRole: player.hasSubmittedRole
    }))
  };
}

function emitRoomState(io, room) {
  io.to(room.code).emit("room:state", serializeRoom(room));
}

function getRevealForPlayer(room, player) {
  const game = gameMap.get(room.gameId);
  if (!game) {
    return { gameId: room.gameId, visiblePlayers: [] };
  }
  const rule = game.revealRules.find((entry) => entry.roleId === player.roleId) || {
    scope: "self"
  };
  const scope = rule.scope ?? null;
  const players = Array.from(room.players.values());
  const roleById = new Map(game.roles.map((role) => [role.id, role]));

  if (scope === "all") {
    return {
      gameId: room.gameId,
      visiblePlayers: players.map((item) => ({
        playerId: item.id,
        name: item.name,
        roleId: item.roleId
      }))
    };
  }

  if (scope === "self") {
    return {
      gameId: room.gameId,
      visiblePlayers: [
        {
          playerId: player.id,
          name: player.name,
          roleId: player.roleId
        }
      ]
    };
  }

  const visibleRoleIds = new Set(rule.visibleRoleIds || []);
  const visiblePartyIds = new Set(rule.visiblePartyIds || []);
  const includeSelf = rule.includeSelf === true;

  const visiblePlayers = players.filter((item) => {
    if (includeSelf && item.id === player.id) {
      return true;
    }
    const role = roleById.get(item.roleId);
    if (visibleRoleIds.has(item.roleId)) {
      return true;
    }
    if (role && role.partyId && visiblePartyIds.has(role.partyId)) {
      return true;
    }
    return false;
  });

  return {
    gameId: room.gameId,
    visiblePlayers: visiblePlayers.map((item) => ({
      playerId: item.id,
      name: item.name,
      roleId: item.roleId
    }))
  };
}

function emitError(socket, message) {
  socket.emit("room:error", { message });
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function removePlayerFromRoom(io, room, playerId, sessionId, socketId) {
  const player = room.players.get(playerId);
  if (!player) {
    return;
  }
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  room.players.delete(playerId);
  if (sessionId) {
    sessionIndex.delete(sessionId);
  }
  if (socketId) {
    socketIndex.delete(socketId);
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.ownerId === playerId) {
    const nextOwner = room.players.values().next().value;
    room.ownerId = nextOwner.id;
  }

  emitRoomState(io, room);
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));
  const io = new Server(server, {
    path: "/socket.io"
  });

  io.on("connection", (socket) => {
    socket.on("session:restore", ({ sessionId }) => {
      if (!sessionId) {
        return;
      }
      const session = sessionIndex.get(sessionId);
      if (!session) {
        return;
      }
      const room = rooms.get(session.code);
      if (!room) {
        sessionIndex.delete(sessionId);
        return;
      }
      const player = room.players.get(session.playerId);
      if (!player) {
        sessionIndex.delete(sessionId);
        return;
      }
      bindSession(sessionId, room.code, player, socket);
      socket.join(room.code);
      socket.emit("room:joined", {
        playerId: player.id,
        isOwner: player.id === room.ownerId,
        code: room.code,
        sessionId
      });
      emitRoomState(io, room);
      if (room.phase === "reveal" && player.roleId) {
        const reveal = getRevealForPlayer(room, player);
        io.to(player.socketId).emit("room:reveal", reveal);
      }
    });

    socket.on("room:create", (payload) => {
      const { name, sessionId: rawSessionId } = payload || {};
      const sessionId = rawSessionId || crypto.randomUUID();
      if (!name) {
        emitError(socket, "Name is required");
        return;
      }
      const code = generateRoomCode();
      const player = createPlayer(name, socket.id, sessionId);
      const room = {
        code,
        ownerId: player.id,
        gameId: null,
        phase: "lobby",
        players: new Map([[player.id, player]])
      };

      rooms.set(code, room);
      bindSession(sessionId, code, player, socket);
      socket.join(code);
      socket.emit("room:joined", { playerId: player.id, isOwner: true, code, sessionId });
      emitRoomState(io, room);
    });

    socket.on("room:join", (payload) => {
      const { code, name, sessionId: rawSessionId } = payload || {};
      const sessionId = rawSessionId || crypto.randomUUID();
      if (!code || !name) {
        emitError(socket, "Code and name are required");
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        emitError(socket, "Room not found");
        return;
      }
      const normalizedName = normalizeName(name);
      const nameTaken = Array.from(room.players.values()).some(
        (player) => normalizeName(player.name) === normalizedName
      );
      if (nameTaken) {
        emitError(socket, "That name is already taken in this room");
        return;
      }
      if (room.phase !== "lobby") {
        emitError(socket, "Game already started");
        return;
      }
      const player = createPlayer(name, socket.id, sessionId);
      room.players.set(player.id, player);
      bindSession(sessionId, code, player, socket);
      socket.join(code);
      socket.emit("room:joined", { playerId: player.id, isOwner: false, code, sessionId });
      emitRoomState(io, room);
    });

    socket.on("room:selectGame", ({ code, gameId }) => {
      const room = rooms.get(code);
      if (!room) {
        emitError(socket, "Room not found");
        return;
      }
      const index = socketIndex.get(socket.id);
      if (!index || index.playerId !== room.ownerId) {
        emitError(socket, "Only the host can select the game");
        return;
      }
      if (!gameMap.has(gameId)) {
        emitError(socket, "Unknown game");
        return;
      }
      room.gameId = gameId;
      room.phase = "lobby";
      resetRoles(room);
      emitRoomState(io, room);
    });

    socket.on("room:start", ({ code }) => {
      const room = rooms.get(code);
      if (!room) {
        emitError(socket, "Room not found");
        return;
      }
      const index = socketIndex.get(socket.id);
      if (!index || index.playerId !== room.ownerId) {
        emitError(socket, "Only the host can start the game");
        return;
      }
      if (!room.gameId) {
        emitError(socket, "Select a game first");
        return;
      }
      room.phase = "roles";
      resetRoles(room);
      emitRoomState(io, room);
    });

    socket.on("room:reset", ({ code }) => {
      const room = rooms.get(code);
      if (!room) {
        emitError(socket, "Room not found");
        return;
      }
      const index = socketIndex.get(socket.id);
      if (!index || index.playerId !== room.ownerId) {
        emitError(socket, "Only the host can reset the game");
        return;
      }
      room.gameId = null;
      room.phase = "lobby";
      resetRoles(room);
      emitRoomState(io, room);
      io.to(room.code).emit("room:reset");
    });

    socket.on("room:leave", () => {
      const index = socketIndex.get(socket.id);
      if (!index) {
        return;
      }
      const room = rooms.get(index.code);
      if (!room) {
        socketIndex.delete(socket.id);
        if (index.sessionId) {
          sessionIndex.delete(index.sessionId);
        }
        return;
      }
      socket.leave(room.code);
      removePlayerFromRoom(io, room, index.playerId, index.sessionId, socket.id);
      socket.emit("room:left");
    });

    socket.on("role:submit", ({ code, roleId }) => {
      const room = rooms.get(code);
      const index = socketIndex.get(socket.id);
      if (!room || !index) {
        emitError(socket, "Room not found");
        return;
      }
      if (room.phase !== "roles") {
        emitError(socket, "Roles are not open yet");
        return;
      }
      const player = room.players.get(index.playerId);
      if (!player) {
        emitError(socket, "Player not found");
        return;
      }
      const game = gameMap.get(room.gameId);
      if (!game || !game.roles.find((role) => role.id === roleId)) {
        emitError(socket, "Unknown role");
        return;
      }

      player.roleId = roleId;
      player.hasSubmittedRole = true;
      emitRoomState(io, room);

      const allSubmitted = Array.from(room.players.values()).every(
        (item) => item.hasSubmittedRole
      );
      if (allSubmitted) {
        room.phase = "ready";
        emitRoomState(io, room);
      }
    });

    socket.on("room:revealConfirm", ({ code }) => {
      const room = rooms.get(code);
      if (!room) {
        emitError(socket, "Room not found");
        return;
      }
      const index = socketIndex.get(socket.id);
      if (!index || index.playerId !== room.ownerId) {
        emitError(socket, "Only the host can reveal roles");
        return;
      }
      if (room.phase !== "ready") {
        emitError(socket, "Roles are not ready to reveal");
        return;
      }
      const allSubmitted = Array.from(room.players.values()).every(
        (item) => item.hasSubmittedRole
      );
      if (!allSubmitted) {
        emitError(socket, "Not everyone has confirmed a role");
        return;
      }
      room.phase = "reveal";
      emitRoomState(io, room);
      room.players.forEach((member) => {
        const reveal = getRevealForPlayer(room, member);
        io.to(member.socketId).emit("room:reveal", reveal);
      });
    });

    socket.on("disconnect", () => {
      const index = socketIndex.get(socket.id);
      if (!index) {
        return;
      }
      const room = rooms.get(index.code);
      if (!room) {
        socketIndex.delete(socket.id);
        return;
      }
      socketIndex.delete(socket.id);

      const player = room.players.get(index.playerId);
      if (!player) {
        return;
      }
      player.connected = false;
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
      }
      player.disconnectTimer = setTimeout(() => {
        if (player.connected) {
          return;
        }
        room.players.delete(player.id);
        sessionIndex.delete(player.sessionId);

        if (room.players.size === 0) {
          rooms.delete(room.code);
          return;
        }

        if (room.ownerId === player.id) {
          const nextOwner = room.players.values().next().value;
          room.ownerId = nextOwner.id;
        }

        emitRoomState(io, room);
      }, disconnectGraceMs);

      emitRoomState(io, room);
    });
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});
