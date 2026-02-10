"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";

type RoleDefinition = {
  id: string;
  name: string;
  partyId?: string;
  visibility?: {
    roleId: string;
    scope: "party" | "mask" | "role";
    mask?: string;
  }[];
};

type GameDefinition = {
  id: string;
  name: string;
  roles: RoleDefinition[];
  parties: { id: string; name: string }[];
};

type RoomPlayer = {
  id: string;
  name: string;
  hasSubmittedRole: boolean;
};

type RoomState = {
  code: string;
  ownerId: string;
  gameId: string | null;
  phase: "lobby" | "roles" | "ready" | "reveal";
  players: RoomPlayer[];
};

type RevealPayload = {
  gameId: string;
  visiblePlayers: {
    playerId: string;
    name: string;
    roleId: string;
    roleLabel?: string;
  }[];
};

export default function HomeClient() {
  const searchParams = useSearchParams();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [games, setGames] = useState<GameDefinition[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedGameId, setSelectedGameId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [myRoleId, setMyRoleId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const joinNameRef = useRef<HTMLInputElement | null>(null);
  const previousGameIdRef = useRef<string | null>(null);

  const resetLocalRoomState = () => {
    setRoom(null);
    setPlayerId(null);
    setIsOwner(false);
    setSelectedGameId("");
    setSelectedRoleId("");
    setMyRoleId(null);
    setReveal(null);
  };

  const getOrCreateSessionId = () => {
    if (typeof window === "undefined") {
      return "";
    }
    const existing = window.sessionStorage.getItem("wimf:sessionId");
    if (existing) {
      return existing;
    }
    const generated = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `sess_${Math.random().toString(36).slice(2, 10)}${Date.now()}`;
    window.sessionStorage.setItem("wimf:sessionId", generated);
    return generated;
  };

  useEffect(() => {
    let isMounted = true;
    fetch("/api/games")
      .then((response) => response.json())
      .then((data) => {
        if (isMounted) {
          setGames(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setGames([]);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) {
      setJoinCode(code);
      if (!room) {
        joinNameRef.current?.focus();
      }
    }
  }, [searchParams, room]);

  useEffect(() => {
    const storedSessionId = getOrCreateSessionId();
    setSessionId(storedSessionId);
    const socketInstance = io({ path: "/socket.io" });
    setSocket(socketInstance);

    socketInstance.on("connect", () => setConnected(true));
    socketInstance.on("disconnect", () => setConnected(false));

    socketInstance.on("room:joined", (payload) => {
      setPlayerId(payload.playerId);
      setIsOwner(payload.isOwner);
      if (payload.sessionId && typeof window !== "undefined") {
        window.sessionStorage.setItem("wimf:sessionId", payload.sessionId);
        setSessionId(payload.sessionId);
      }
      setReveal(null);
      setError(null);
    });

    socketInstance.on("room:state", (state: RoomState) => {
      const previousGameId = previousGameIdRef.current;
      setRoom(state);
      setSelectedGameId(state.gameId ?? "");
      if (state.phase !== "reveal") {
        setReveal(null);
      }
      if (state.phase === "lobby" || previousGameId !== state.gameId) {
        setSelectedRoleId("");
        setMyRoleId(null);
      }
      previousGameIdRef.current = state.gameId ?? null;
    });

    socketInstance.on("room:reveal", (payload: RevealPayload) => {
      setReveal(payload);
    });

    socketInstance.on("room:error", (payload) => {
      setError(payload.message || "Something went wrong");
    });

    socketInstance.on("room:reset", () => {
      setReveal(null);
      setSelectedRoleId("");
      setMyRoleId(null);
    });

    socketInstance.on("room:left", () => {
      resetLocalRoomState();
    });

    socketInstance.on("connect", () => {
      const existingSessionId = getOrCreateSessionId();
      socketInstance.emit("session:restore", { sessionId: existingSessionId });
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  useEffect(() => {
    if (room && playerId) {
      setIsOwner(room.ownerId === playerId);
    }
  }, [room, playerId]);

  const currentGame = useMemo(
    () => games.find((game) => game.id === selectedGameId),
    [games, selectedGameId]
  );

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (currentGame) {
      currentGame.roles.forEach((role) => map.set(role.id, role.name));
    }
    return map;
  }, [currentGame]);

  const partyNameByRoleId = useMemo(() => {
    const map = new Map<string, string>();
    if (currentGame) {
      const partyMap = new Map(currentGame.parties.map((party) => [party.id, party.name]));
      currentGame.roles.forEach((role) => {
        if (role.partyId && partyMap.has(role.partyId)) {
          map.set(role.id, partyMap.get(role.partyId) ?? "");
        }
      });
    }
    return map;
  }, [currentGame]);

  const getRevealLabel = (roleId: string, roleLabel?: string) => {
    return roleLabel ?? partyNameByRoleId.get(roleId) ?? roleNameById.get(roleId) ?? roleId;
  };

  const currentPlayerName = useMemo(() => {
    if (!room || !playerId) {
      return "";
    }
    return room.players.find((player) => player.id === playerId)?.name ?? "";
  }, [room, playerId]);

  const allRolesSubmitted = room
    ? room.players.every((player) => player.hasSubmittedRole)
    : false;

  const createRoom = () => {
    if (!socket || !createName.trim()) {
      return;
    }
    socket.emit("room:create", { name: createName.trim(), sessionId: sessionId ?? "" });
  };

  const joinRoom = () => {
    if (!socket || !joinName.trim() || !joinCode.trim()) {
      return;
    }
    socket.emit("room:join", {
      name: joinName.trim(),
      code: joinCode.trim(),
      sessionId: sessionId ?? ""
    });
  };

  const selectGame = () => {
    if (!socket || !room || !selectedGameId) {
      return;
    }
    socket.emit("room:selectGame", { code: room.code, gameId: selectedGameId });
  };

  const startGame = () => {
    if (!socket || !room) {
      return;
    }
    socket.emit("room:start", { code: room.code });
  };

  const submitRole = () => {
    if (!socket || !room || !selectedRoleId) {
      return;
    }
    socket.emit("role:submit", { code: room.code, roleId: selectedRoleId });
    setMyRoleId(selectedRoleId);
  };

  const confirmReveal = () => {
    if (!socket || !room) {
      return;
    }
    socket.emit("room:revealConfirm", { code: room.code });
  };

  const resetGame = () => {
    if (!socket || !room) {
      return;
    }
    socket.emit("room:reset", { code: room.code });
    setReveal(null);
  };

  const leaveRoom = () => {
    if (!socket) {
      return;
    }
    socket.emit("room:leave");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("wimf:sessionId");
    }
    resetLocalRoomState();
  };

  const shareRoom = async () => {
    if (!room || typeof window === "undefined") {
      return;
    }
    const url = `${window.location.origin}?code=${room.code}`;
    const text = `Join my room in Who Is My Friend with code ${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Who Is My Friend", text, url });
        setShareStatus("Shared");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareStatus("Link copied");
        return;
      }
      setShareStatus("Copy failed");
    } catch {
      setShareStatus("Share cancelled");
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-moss">Who Is My Friend</p>
            <h1 className="mt-3 text-4xl md:text-5xl">Hidden identity setup, done together</h1>
            <p className="mt-3 max-w-2xl text-base text-ink/70">
              Create a room, pick a game, and let everyone privately enter their role. When all roles
              are in, the game reveals who each role should know.
            </p>
          </div>
          <div className="rounded-full border border-clay px-4 py-2 text-sm text-ink/70">
            {connected ? "Live connection" : "Connecting..."}
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-ember/40 bg-white/70 p-4 text-ember">
            {error}
          </div>
        ) : null}

        {!room ? (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <section className="rounded-3xl border border-clay bg-white/80 p-6 shadow-sm">
              <h2 className="text-2xl">Create a room</h2>
              <p className="mt-2 text-sm text-ink/70">You will be the host and choose the game.</p>
              <div className="mt-6 flex flex-col gap-3">
                <label className="text-xs uppercase tracking-widest text-ink/50">Your name</label>
                <input
                  className="rounded-xl border border-clay bg-white px-4 py-3 text-base"
                  placeholder="Name"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
                <button
                  onClick={createRoom}
                  className="mt-2 rounded-xl bg-moss px-4 py-3 text-sm font-semibold uppercase tracking-widest text-white"
                >
                  Create room
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-clay bg-white/80 p-6 shadow-sm">
              <h2 className="text-2xl">Join with a code</h2>
              <p className="mt-2 text-sm text-ink/70">Enter the 4-digit code from the host.</p>
              <div className="mt-6 flex flex-col gap-3">
                <label className="text-xs uppercase tracking-widest text-ink/50">Room code</label>
                <input
                  className="rounded-xl border border-clay bg-white px-4 py-3 text-base"
                  placeholder="1234"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                />
                <label className="text-xs uppercase tracking-widest text-ink/50">Your name</label>
                <input
                  className="rounded-xl border border-clay bg-white px-4 py-3 text-base"
                  placeholder="Name"
                  value={joinName}
                  onChange={(event) => setJoinName(event.target.value)}
                  ref={joinNameRef}
                />
                <button
                  onClick={joinRoom}
                  className="mt-2 rounded-xl border border-ink/10 bg-ink px-4 py-3 text-sm font-semibold uppercase tracking-widest text-white"
                >
                  Join room
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-3xl border border-clay bg-white/90 p-6 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-ink/50">Room code</p>
                  <p className="mt-1 text-3xl font-semibold tracking-widest text-ink">{room.code}</p>
                </div>
                <div className="flex flex-col items-start gap-3 text-sm text-ink/70 md:items-end">
                  <div>
                    Phase: <span className="font-semibold text-ink">{room.phase}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={shareRoom}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink"
                    >
                      Share link
                    </button>
                    <button
                      onClick={leaveRoom}
                      className="rounded-full border border-ember/40 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ember"
                    >
                      Leave room
                    </button>
                    {shareStatus ? (
                      <span className="text-xs uppercase tracking-widest text-ink/50">
                        {shareStatus}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg">Players</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {room.players.map((player) => (
                    <div
                      key={player.id}
                      className="rounded-2xl border border-clay/70 bg-sand px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-ink">{player.name}</p>
                      <p className="text-xs text-ink/60">
                        {player.hasSubmittedRole ? "Role ready" : "Waiting for role"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {room.phase === "lobby" && isOwner ? (
                <div className="mt-8 rounded-2xl border border-clay/70 bg-sand p-4">
                  <h3 className="text-lg">Host controls</h3>
                  <div className="mt-4 flex flex-col gap-3">
                    <label className="text-xs uppercase tracking-widest text-ink/50">Game</label>
                    <select
                      className="rounded-xl border border-clay bg-white px-3 py-3 text-base"
                      value={selectedGameId}
                      onChange={(event) => setSelectedGameId(event.target.value)}
                    >
                      <option value="">Select a game</option>
                      {games.map((game) => (
                        <option key={game.id} value={game.id}>
                          {game.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={selectGame}
                        className="rounded-xl border border-moss/40 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-widest text-moss"
                      >
                        Lock game
                      </button>
                      <button
                        onClick={startGame}
                        disabled={!room.gameId}
                        className="rounded-xl bg-moss px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white"
                      >
                        Start setup
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {room.phase === "roles" || room.phase === "ready" ? (
                <div className="mt-8 rounded-2xl border border-clay/70 bg-sand p-4">
                  <h3 className="text-lg">Enter your role</h3>
                  <p className="mt-2 text-sm text-ink/70">
                    Choose the role you drew from the game deck. Only you can see this input.
                  </p>
                  <div className="mt-4 flex flex-col gap-3">
                    <select
                      className="rounded-xl border border-clay bg-white px-3 py-3 text-base"
                      value={selectedRoleId}
                      onChange={(event) => setSelectedRoleId(event.target.value)}
                    >
                      <option value="">Select role</option>
                      {currentGame?.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={submitRole}
                      className="rounded-xl bg-ink px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white"
                    >
                      Confirm role
                    </button>
                    {myRoleId ? (
                      <p className="text-xs uppercase tracking-widest text-ink/50">
                        Your role: {roleNameById.get(myRoleId) ?? myRoleId}
                      </p>
                    ) : null}
                    {room.phase === "ready" && !isOwner ? (
                      <p className="text-xs uppercase tracking-widest text-ink/50">
                        Waiting for host to reveal roles
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {room.phase === "ready" && isOwner ? (
                <div className="mt-4 rounded-2xl border border-clay/70 bg-sand p-4">
                  <h3 className="text-lg">Host controls</h3>
                  <p className="mt-2 text-sm text-ink/70">
                    Everyone has confirmed. Reveal roles when you are ready.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={confirmReveal}
                      className="rounded-xl bg-moss px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white"
                      disabled={!allRolesSubmitted}
                    >
                      Reveal roles
                    </button>
                  </div>
                </div>
              ) : null}

              {room.phase === "reveal" && isOwner ? (
                <div className="mt-8 rounded-2xl border border-clay/70 bg-sand p-4">
                  <h3 className="text-lg">Host controls</h3>
                  <p className="mt-2 text-sm text-ink/70">
                    Start a new round and select a different game if you want.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={resetGame}
                      className="rounded-xl border border-moss/40 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-widest text-moss"
                    >
                      Start another game
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-clay bg-white/90 p-6 shadow-sm">
              <h3 className="text-lg">You</h3>
              <div className="mt-4 rounded-2xl border border-clay/70 bg-sand px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {currentPlayerName || "Player"}
                </p>
                <p className="text-xs text-ink/60">
                  {myRoleId ? `Role: ${roleNameById.get(myRoleId) ?? myRoleId}` : "Role not set"}
                </p>
              </div>
              <h3 className="mt-8 text-lg">Role visibility</h3>
              {reveal ? (
                <div className="mt-4 space-y-3">
                  {reveal.visiblePlayers
                    .filter((player) => player.playerId !== playerId)
                    .map((player) => (
                    <div
                      key={player.playerId}
                      className="rounded-2xl border border-clay/70 bg-sand px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-ink">{player.name}</p>
                      <p className="text-xs text-ink/60">
                        {getRevealLabel(player.roleId, player.roleLabel)}
                      </p>
                    </div>
                    ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-ink/70">
                  Once everyone submits their role, the game reveals who your role should know.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
