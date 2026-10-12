import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Markdown from "react-markdown";
import {
  Hash,
  Headphones,
  Plus,
  Search,
  Settings,
  Users,
  Volume2,
  ChevronDown,
  ArrowRight,
  MessageCircle,
  Compass,
  Mic,
  Phone,
  Video,
  Pin,
  Bell,
  X,
  Send,
  Paperclip,
  Smile,
  LogOut,
  Shield,
  Copy,
  Check,
  Reply,
  Trash2,
  Pencil,
  Radio,
  WifiOff,
  Menu,
} from "lucide-react";
import {
  api,
  restore,
  saveToken,
  socket,
  upload,
  attachment,
  type User,
  type Community,
  type Channel,
  type Message,
} from "./api";
import type { Socket } from "socket.io-client";
const Call = lazy(() => import("./Call"));
const Logo = () => (
  <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M7 10h8l6 17 5-13h8L24 35h-8L7 10Z" fill="currentColor" />
    <path d="m24 5 7 2-3 6-7-2 3-6Z" fill="currentColor" />
  </svg>
);
function Avatar({
  user,
  small = false,
}: {
  user: Pick<User, "displayName" | "status">;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{
        background: `hsl(${[...user.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 25% 31%)`,
      }}
    >
      {user.displayName.slice(0, 2).toUpperCase()}
      <i className={`status ${user.status}`} />
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const d = ref.current;
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Submit({
  children,
  busy = false,
}: {
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <button disabled={busy} className="primary" type="submit">
      {busy ? "Working…" : children}
      <ArrowRight size={17} />
    </button>
  );
}
function Auth({ onLogin }: { onLogin: () => void }) {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState(
    params.has("reset") ? "reset" : params.has("verify") ? "verify" : "login",
  );
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const data = await api(
        `/auth/${mode}`,
        "POST",
        mode === "reset"
          ? { password: v.password, token: params.get("reset") }
          : mode === "verify"
            ? { token: params.get("verify") }
            : v,
      );
      if (mode === "login") {
        await saveToken(data.token || null);
        onLogin();
      } else {
        setInfo(data.message);
        if (mode === "verify" || mode === "reset") {
          history.replaceState({}, "", location.pathname);
          setMode("login");
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="wordmark">
          <Logo />
          voxora<span>BETA</span>
        </a>
        <div className="orbit">
          <div className="orbit-inner">
            <Logo />
          </div>
          <span className="orbit-tag tag-one">
            <Headphones size={16} /> A place to tune in.
          </span>
          <span className="orbit-tag tag-two">
            <MessageCircle size={16} /> A little closer.
          </span>
        </div>
        <h1>
          Good company.
          <br />
          <em>Great conversations.</em>
        </h1>
        <p>
          Your people, your spaces, your voice.
          <br />
          Make room for the moments in between.
        </p>
        <footer>BUILT FOR CONNECTION. MADE TO BE YOURS.</footer>
      </section>
      <section className="auth-form">
        <div className="eyebrow">YOUR NEXT CONVERSATION STARTS HERE</div>
        <h2>
          {
            (
              {
                login: "Welcome back.",
                register: "Find your people.",
                forgot: "Forgot your password?",
                reset: "A fresh start.",
                verify: "One last step.",
                resend: "Let’s verify your email.",
              } as any
            )[mode]
          }
        </h2>
        <p>
          {mode === "login"
            ? "Sign in to your own little corner of the internet."
            : "Secure, personal, and always your space."}
        </p>
        <form onSubmit={submit}>
          {["login", "register", "forgot", "resend"].includes(mode) && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode === "register" && (
            <>
              <label>
                Username
                <input
                  name="username"
                  pattern="[a-z0-9_]{3,24}"
                  required
                  placeholder="your_unique_name"
                />
              </label>
              <label>
                Display name
                <input
                  name="displayName"
                  maxLength={40}
                  required
                  placeholder="What should we call you?"
                />
              </label>
            </>
          )}
          {["login", "register", "reset"].includes(mode) && (
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 12}
                maxLength={72}
                required
                placeholder={
                  mode === "login"
                    ? "Enter your password"
                    : "At least 12 characters"
                }
              />
            </label>
          )}
          {mode === "login" && (
            <button
              type="button"
              className="link right"
              onClick={() => setMode("forgot")}
            >
              Forgot password?
            </button>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {info && (
            <div role="status" className="notice">
              {info}
            </div>
          )}
          <Submit busy={busy}>
            {mode === "login"
              ? "Sign in"
              : mode === "register"
                ? "Create account"
                : mode === "verify"
                  ? "Verify email"
                  : mode === "reset"
                    ? "Change password"
                    : "Send email"}
          </Submit>
        </form>
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              New around here?{" "}
              <button
                className="link"
                onClick={() => {
                  setMode("register");
                  setInfo("");
                }}
              >
                Create an account
              </button>
              <button className="link subtle" onClick={() => setMode("resend")}>
                Resend verification email
              </button>
            </>
          ) : (
            <button className="link" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          )}
        </div>
        <div className="security-note">
          <Shield size={16} /> Your password is hashed. Your space stays yours.
        </div>
      </section>
    </div>
  );
}
export function App() {
  const [me, setMe] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [initialError, setInitialError] = useState("");
  const loadMe = useCallback(async () => {
    try {
      setMe(await api("/auth/me"));
      setInitialError("");
    } catch (e) {
      if ((e as Error).message !== "Please sign in")
        setInitialError((e as Error).message);
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    restore()
      .then(loadMe)
      .catch((e) => {
        setInitialError(e.message);
        setReady(true);
      });
  }, [loadMe]);
  if (!ready)
    return (
      <div className="boot">
        <Logo />
        <div className="spinner" />
        <p>Opening your space…</p>
      </div>
    );
  return me ? (
    <Workspace me={me} setMe={setMe} />
  ) : (
    <>
      {initialError && (
        <div className="service-banner">
          Cannot reach the account service: {initialError}. Start the API and
          PostgreSQL, then retry sign-in.
        </div>
      )}
      <Auth onLogin={loadMe} />
    </>
  );
}
function Workspace({
  me,
  setMe,
}: {
  me: User;
  setMe: (u: User | null) => void;
}) {
  const [servers, setServers] = useState<Community[]>([]);
  const [dms, setDms] = useState<Channel[]>([]);
  const [serverId, setServerId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<{ user: User; role: string }[]>([]);
  const [showMembers, setShowMembers] = useState(true);
  const [call, setCall] = useState<Channel | null>(null);
  const [incoming, setIncoming] = useState<{
    conversationId: string;
    callerId: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [mobileNav, setMobileNav] = useState(false);
  const sock = useRef<Socket | null>(null);
  const activeId = useRef(channelId);
  activeId.current = channelId;
  const meRef = useRef(me);
  meRef.current = me;
  const channelsRef = useRef<Channel[]>([]);
  const server = servers.find((s) => s.id === serverId);
  const channels = server?.channels || dms;
  const channel = channels.find((c) => c.id === channelId);
  const allChannels = [...dms, ...servers.flatMap((s) => s.channels)];
  channelsRef.current = allChannels;
  const fail = (e: unknown) => setError((e as Error).message);
  const refresh = useCallback(async () => {
    try {
      const w = await api("/workspace");
      setServers(w.servers);
      setDms(w.dms);
      const rows = await api("/unread");
      setUnread(Object.fromEntries(rows.map((r: any) => [r.id, r.count])));
      setFriends(await api("/friends"));
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = me.preferences?.theme || "dark";
  }, [me.preferences?.theme]);
  useEffect(() => {
    const s = socket();
    sock.current = s;
    const notify = (title: string, body: string) => {
      const u = meRef.current;
      if (u.status === "dnd" || u.preferences?.notifications === false) return;
      if (document.hidden) {
        if (window.voxora) window.voxora.notify(title, body);
        else if (Notification.permission === "granted")
          new Notification(title, { body });
      }
    };
    s.on("connect", () => {
      setConnected(true);
      void refresh();
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));
    s.on("workspace:changed", () => void refresh());
    s.on("friend:request", () => {
      notify("New friend request", "Someone wants to connect.");
      void refresh();
    });
    s.on("message:new", (m: Message) => {
      if (m.authorId !== meRef.current.id) {
        if (m.conversationId !== activeId.current)
          setUnread((old) => ({
            ...old,
            [m.conversationId]: (old[m.conversationId] || 0) + 1,
          }));
        notify(
          m.author.displayName,
          m.body.slice(0, 120) || "Sent an attachment",
        );
      }
    });
    s.on("call:incoming", (v) => {
      setIncoming(v);
      notify("Incoming call", "Open Voxora to answer.");
    });
    s.on("call:ended", () => {
      setIncoming(null);
      setNotice("Ringing ended.");
    });
    s.on("call:response", (v) =>
      setNotice(v.accept ? "Call accepted." : "Call declined."),
    );
    s.connect();
    return () => {
      s.disconnect();
      sock.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    if (connected)
      allChannels.forEach((c) => sock.current?.emit("conversation:join", c.id));
  }, [connected, servers, dms]);
  useEffect(() => {
    if (channelId) {
      setUnread((u) => ({ ...u, [channelId]: 0 }));
      void api(`/conversations/${channelId}/read`, "POST", {}).catch(fail);
    }
    setSearch("");
    setPinned(false);
  }, [channelId]);
  useEffect(() => {
    if (serverId)
      api(`/servers/${serverId}/members`).then(setMembers).catch(fail);
    else setMembers([]);
  }, [serverId, servers]);
  useEffect(() => {
    window.voxora?.badge(Object.values(unread).reduce((a, b) => a + b, 0));
  }, [unread]);
  useEffect(() => {
    if (error || notice) {
      const t = setTimeout(() => {
        setError("");
        setNotice("");
      }, 6500);
      return () => clearTimeout(t);
    }
  }, [error, notice]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("search")?.focus();
      }
      if (e.key === "Escape") {
        setModal(null);
        setSearch("");
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  function select(c: Channel) {
    setChannelId(c.id);
    setMobileNav(false);
    if (c.kind === "voice") setCall(c);
  }
  async function action(route: string, method = "POST", body: unknown = {}) {
    try {
      const v = await api(route, method, body);
      await refresh();
      return v;
    } catch (e) {
      fail(e);
      throw e;
    }
  }
  async function submit(
    e: FormEvent<HTMLFormElement>,
    fn: (v: any) => Promise<void>,
  ) {
    e.preventDefault();
    try {
      await fn(Object.fromEntries(new FormData(e.currentTarget)));
    } catch (e) {
      fail(e);
    }
  }
  const canManage =
    server && ["owner", "admin"].includes(server.members[0]?.role);
  return (
    <div className={`app-shell ${mobileNav ? "nav-open" : ""}`}>
      <aside className="server-rail" aria-label="Servers">
        <button
          className={`home-logo ${!serverId ? "selected" : ""}`}
          title="Home"
          onClick={() => {
            setServerId(null);
            setChannelId(null);
          }}
        >
          <Logo />
        </button>
        <div className="rail-divider" />
        {servers.map((s) => (
          <button
            key={s.id}
            className={`server-icon ${serverId === s.id ? "selected" : ""}`}
            title={s.name}
            onClick={() => {
              setServerId(s.id);
              setChannelId(
                s.channels.find((c) => c.kind === "text")?.id || null,
              );
            }}
          >
            {s.name.slice(0, 2).toUpperCase()}
            {s.channels.some((c) => unread[c.id] > 0) && (
              <i className="unread-dot" />
            )}
          </button>
        ))}
        <button
          className="rail-add"
          title="Create or join a server"
          onClick={() => setModal("server")}
        >
          <Plus />
        </button>
        <button
          className="rail-explore"
          title="Join with an invite"
          onClick={() => setModal("join")}
        >
          <Compass />
        </button>
        <div className="rail-bottom">
          <span className="rail-label">VOXORA</span>
          <button
            className="icon"
            title="Settings"
            onClick={() => setModal("settings")}
          >
            <Settings size={21} />
          </button>
        </div>
      </aside>
      <aside className="channel-panel">
        <button
          className="workspace-title"
          onClick={() =>
            server ? setModal("server-settings") : setModal("friend")
          }
        >
          <span>
            {server?.name || "Your space"}
            <small>{server ? "A PLACE TO BELONG" : "A LITTLE CLOSER"}</small>
          </span>
          <ChevronDown size={18} />
        </button>
        <div className="channel-scroll">
          {!server && (
            <>
              <button
                className={`nav-item ${!channelId ? "active" : ""}`}
                onClick={() => setChannelId(null)}
              >
                <Users size={18} />
                Friends
                <span className="count">
                  {friends.filter((f) => f.state === "accepted").length}
                </span>
              </button>
              <button className="nav-item" onClick={() => setModal("join")}>
                <Compass size={18} />
                Explore your invitations
              </button>
              <div className="sidebar-line" />
            </>
          )}
          <div className="section-label">
            <span>{server ? "YOUR CHANNELS" : "DIRECT MESSAGES"}</span>
            <button
              className="icon"
              title={server ? "Create channel" : "New conversation"}
              onClick={() => setModal(server ? "channel" : "dm")}
            >
              <Plus size={15} />
            </button>
          </div>
          {loading ? (
            <div className="skeleton-list">
              <i />
              <i />
              <i />
            </div>
          ) : channels.length === 0 ? (
            <p className="sidebar-empty">
              {server
                ? "No channels available."
                : "The best conversations start with a hello. Add a friend to get going."}
            </p>
          ) : (
            [
              ...new Set(channels.map((c) => c.category || "Conversations")),
            ].map((category) => (
              <div key={category}>
                {server && (
                  <div className="category">
                    <ChevronDown size={12} />
                    {category}
                  </div>
                )}
                {channels
                  .filter((c) => (c.category || "Conversations") === category)
                  .sort((a, b) => a.position - b.position)
                  .map((c) => (
                    <button
                      key={c.id}
                      className={`channel-item ${channelId === c.id ? "active" : ""}`}
                      onClick={() => select(c)}
                    >
                      {c.kind === "voice" ? (
                        <Volume2 size={19} />
                      ) : c.serverId ? (
                        <Hash size={20} />
                      ) : (
                        <MessageCircle size={18} />
                      )}
                      <span>{c.name}</span>
                      {c.private && <Shield size={12} />}{" "}
                      {!!unread[c.id] && (
                        <b className="badge">{unread[c.id]}</b>
                      )}
                    </button>
                  ))}
              </div>
            ))
          )}
          {server && (
            <div className="invite-card">
              <span className="invite-symbol">✦</span>
              <h4>Better with your people.</h4>
              <p>Make a little room for someone new.</p>
              <button onClick={() => setModal("invite")}>
                Invite friends <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
        {call && (
          <div className="voice-status">
            <Radio size={19} />
            <div>
              <b>Voice room open</b>
              <small>{call.name}</small>
            </div>
            <button
              title="Leave call"
              className="icon"
              onClick={() => setCall(null)}
            >
              <Phone size={17} />
            </button>
          </div>
        )}
        <div className="account-panel">
          <button
            className="profile-button"
            onClick={() => setModal("settings")}
          >
            <Avatar user={me} small />
            <span>
              <b>{me.displayName}</b>
              <small>
                {me.status === "dnd" ? "Do not disturb" : me.status}
              </small>
            </span>
          </button>
          <button
            className="icon"
            title="Account settings"
            onClick={() => setModal("settings")}
          >
            <Settings size={19} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="chat-header">
          <button
            className="icon mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu />
          </button>
          <div className="channel-heading">
            {channel ? <Hash size={23} /> : <Users size={23} />}
            <h1>{channel?.name || "Friends"}</h1>
            <span className="header-divider" />
            <p>
              {channel
                ? "A space for your conversations"
                : "Your people. One place."}
            </p>
          </div>
          <div className="header-actions">
            {channel && (
              <>
                <button
                  className={`icon ${pinned ? "highlight" : ""}`}
                  title="Pinned messages"
                  onClick={() => setPinned(!pinned)}
                >
                  <Pin size={19} />
                </button>
                {channel.kind !== "text" && (
                  <button
                    className="icon"
                    title="Start voice or video call"
                    onClick={() => {
                      setCall(channel);
                      sock.current?.emit("call:ring", channel.id);
                    }}
                  >
                    <Phone size={19} />
                  </button>
                )}
              </>
            )}
            <button
              className="icon"
              title="Toggle member list"
              onClick={() => setShowMembers(!showMembers)}
            >
              <Users size={20} />
            </button>
            <label className="search">
              <input
                id="search"
                aria-label="Search messages"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>⌘ K</span>
              <Search size={15} />
            </label>
          </div>
        </header>
        {!connected && (
          <div className="connection-banner">
            <WifiOff size={14} /> Reconnecting to real-time service. Message
            history is fetched again on reconnect.
          </div>
        )}
        <div className="chat-layout">
          {channel ? (
            <Chat
              key={channel.id}
              channel={channel}
              me={me}
              sock={sock.current}
              connected={connected}
              search={search}
              pinned={pinned}
              fail={fail}
              onCall={() => setCall(channel)}
            />
          ) : (
            <section className="friends-view">
              <div className="friends-toolbar">
                <button className="tab active">
                  All friends{" "}
                  <span>
                    {friends.filter((f) => f.state === "accepted").length}
                  </span>
                </button>
                <button
                  className="primary compact"
                  onClick={() => setModal("friend")}
                >
                  <Plus size={16} />
                  Add a friend
                </button>
              </div>
              <div className="welcome-card">
                <div>
                  <div className="eyebrow">MORE THAN JUST A CHAT</div>
                  <h2>Make yourself at home.</h2>
                  <p>
                    Catch up, hang out, or start something together.
                    <br />
                    Your next great conversation is one hello away.
                  </p>
                  <button onClick={() => setModal("server")}>
                    Create your community <ArrowRight size={16} />
                  </button>
                </div>
                <div className="welcome-art">
                  <Logo />
                  <i />
                  <b>✦</b>
                </div>
              </div>
              <div className="section-label">
                YOUR PEOPLE — {friends.length}
              </div>
              {friends.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">
                    <Users size={34} />
                  </div>
                  <h3>A little quiet in here.</h3>
                  <p>
                    Add a friend by username. No suggested strangers,
                    <br />
                    just the people you want to be around.
                  </p>
                  <button className="link" onClick={() => setModal("friend")}>
                    Send your first hello <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                friends.map((f) => (
                  <div className="friend-row" key={f.id}>
                    <Avatar user={f.user} />
                    <div>
                      <b>{f.user.displayName}</b>
                      <small>
                        @{f.user.username} ·{" "}
                        {f.state === "accepted"
                          ? f.user.status
                          : f.toId === me.id
                            ? "Incoming request"
                            : "Request sent"}
                      </small>
                    </div>
                    {f.state === "pending" && f.toId === me.id ? (
                      <button
                        className="primary compact"
                        onClick={() =>
                          void action(`/friends/${f.id}`, "PATCH").catch(
                            () => {},
                          )
                        }
                      >
                        Accept
                      </button>
                    ) : f.state === "accepted" ? (
                      <button
                        className="icon"
                        title="Message friend"
                        onClick={async () => {
                          try {
                            const c = await action("/dms", "POST", {
                              userIds: [f.user.id],
                              name: f.user.displayName,
                            });
                            setServerId(null);
                            setChannelId(c.id);
                          } catch {}
                        }}
                      >
                        <MessageCircle size={20} />
                      </button>
                    ) : null}
                    <button
                      className="icon"
                      title="Remove friend or decline request"
                      onClick={() =>
                        void action(`/friends/${f.id}`, "DELETE").catch(
                          () => {},
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  </div>
                ))
              )}
            </section>
          )}
          {showMembers && (
            <aside className="member-panel">
              <div className="section-label">
                {server ? `MEMBERS — ${server._count.members}` : "YOUR SPACE"}
              </div>
              {server ? (
                members.map((m) => (
                  <button
                    className="member"
                    key={m.user.id}
                    onClick={() => setModal(`profile:${m.user.id}`)}
                  >
                    <Avatar user={m.user} small />
                    <span>
                      <b>{m.user.displayName}</b>
                      <small>{m.role}</small>
                    </span>
                    {m.role === "owner" && <span className="crown">♛</span>}
                  </button>
                ))
              ) : (
                <div className="activity-empty">
                  <div className="activity-icon">
                    <Headphones size={28} />
                  </div>
                  <h3>Room for a good time.</h3>
                  <p>
                    Start a conversation with a friend, then jump into voice or
                    video whenever you like.
                  </p>
                  <span>Less scrolling. More connecting.</span>
                </div>
              )}
              <div className="member-footer">
                <span className="live-dot" />{" "}
                {connected ? "Connected to Voxora" : "Connecting…"}
                <small>YOUR CONVERSATIONS, IN SYNC.</small>
              </div>
            </aside>
          )}
        </div>
      </main>
      {(error || notice) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
          <button
            className="icon"
            aria-label="Dismiss"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {incoming && (
        <Modal title="Incoming call" onClose={() => setIncoming(null)}>
          <p>A friend is calling. Join with your microphone and camera off.</p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                const c = allChannels.find(
                  (c) => c.id === incoming.conversationId,
                );
                sock.current?.emit("call:respond", {
                  id: incoming.conversationId,
                  accept: true,
                });
                if (c) setCall(c);
                setIncoming(null);
              }}
            >
              Accept call
            </button>
            <button
              onClick={() => {
                sock.current?.emit("call:respond", {
                  id: incoming.conversationId,
                  accept: false,
                });
                setIncoming(null);
              }}
            >
              Decline
            </button>
          </div>
        </Modal>
      )}
      {call && (
        <Suspense
          fallback={<div className="call-overlay">Loading media controls…</div>}
        >
          <Call
            channel={call}
            onLeave={() => {
              sock.current?.emit("call:end", call.id);
              setCall(null);
            }}
          />
        </Suspense>
      )}
      {modal && (
        <Modal
          title={
            modal.startsWith("profile:")
              ? "Member profile"
              : (
                  {
                    server: "Create a community",
                    join: "Join your people",
                    friend: "Add a friend",
                    dm: "New conversation",
                    channel: "Create a channel",
                    invite: "Invite your friends",
                    settings: "Your settings",
                    "server-settings": "Community settings",
                  } as any
                )[modal] || modal
          }
          onClose={() => setModal(null)}
        >
          {modal === "server" && (
            <form
              onSubmit={(e) =>
                void submit(e, async (v) => {
                  const s = await action("/servers", "POST", v);
                  setServerId(s.id);
                  setChannelId(null);
                  setModal(null);
                })
              }
            >
              <p>A home for your group, big ideas, and everyday moments.</p>
              <label>
                Community name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="The weekend crew"
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  maxLength={300}
                  placeholder="What brings you together?"
                />
              </label>
              <Submit>Create community</Submit>
              <button
                type="button"
                className="link"
                onClick={() => setModal("join")}
              >
                Already have an invite? Join a server
              </button>
            </form>
          )}
          {modal === "join" && (
            <form
              onSubmit={(e) =>
                void submit(e, async (v) => {
                  const s = await action(
                    `/invites/${encodeURIComponent(v.code.trim())}/join`,
                  );
                  setServerId(s.serverId);
                  setChannelId(null);
                  setModal(null);
                })
              }
            >
              <p>Enter the invite code shared by a community administrator.</p>
              <label>
                Invite code
                <input
                  name="code"
                  required
                  placeholder="Paste your invite code"
                />
              </label>
              <Submit>Join community</Submit>
            </form>
          )}
          {modal === "friend" && (
            <form
              onSubmit={(e) =>
                void submit(e, async (v) => {
                  await action("/friends", "POST", v);
                  setNotice("Friend request sent.");
                  setModal(null);
                })
              }
            >
              <p>Good company is just a username away.</p>
              <label>
                Exact username
                <input name="username" required placeholder="their_username" />
              </label>
              <Submit>Send friend request</Submit>
            </form>
          )}
          {modal === "dm" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void action("/dms", "POST", {
                  userIds: form.getAll("userIds"),
                  name: form.get("name"),
                })
                  .then((c) => {
                    setServerId(null);
                    setChannelId(c.id);
                    setModal(null);
                  })
                  .catch(() => {});
              }}
            >
              <label>
                Conversation name
                <input name="name" required maxLength={80} />
              </label>
              <p>Select up to 9 friends.</p>
              {friends
                .filter((f) => f.state === "accepted")
                .map((f) => (
                  <label className="check-row" key={f.id}>
                    <input name="userIds" type="checkbox" value={f.user.id} />
                    {f.user.displayName}
                  </label>
                ))}
              <Submit>Create conversation</Submit>
            </form>
          )}
          {modal === "channel" && (
            <form
              onSubmit={(e) =>
                void submit(e, async (v) => {
                  await action(`/servers/${serverId}/channels`, "POST", {
                    ...v,
                    private: v.private === "on",
                  });
                  setModal(null);
                })
              }
            >
              <label>
                Name
                <input name="name" required maxLength={60} />
              </label>
              <label>
                Channel type
                <select name="kind">
                  <option value="text">Text</option>
                  <option value="voice">Voice & video</option>
                </select>
              </label>
              <label>
                Category
                <input name="category" defaultValue="General" maxLength={40} />
              </label>
              <label className="check-row">
                <input type="checkbox" name="private" />
                Private (administrators only until members are added via API)
              </label>
              <Submit>Create channel</Submit>
            </form>
          )}
          {modal === "invite" && (
            <form
              onSubmit={(e) =>
                void submit(e, async (v) => {
                  const i = await action(
                    `/servers/${serverId}/invites`,
                    "POST",
                    { hours: Number(v.hours), maxUses: Number(v.maxUses) },
                  );
                  setNotice(`Invite code: ${i.code}`);
                  await navigator.clipboard?.writeText(i.code).catch(() => {});
                  setNotice(`Copied invite code: ${i.code}`);
                })
              }
            >
              <p>
                Invites are created by administrators. Share the code only with
                people you trust.
              </p>
              <label>
                Expires in (hours)
                <input
                  name="hours"
                  type="number"
                  min="1"
                  max="168"
                  defaultValue="24"
                />
              </label>
              <label>
                Maximum uses
                <input
                  name="maxUses"
                  type="number"
                  min="1"
                  max="1000"
                  defaultValue="10"
                />
              </label>
              <Submit>Generate & copy invite</Submit>
            </form>
          )}
          {modal === "settings" && (
            <SettingsPanel
              me={me}
              onSave={(u) => {
                setMe(u);
                setNotice("Settings saved.");
              }}
              onLogout={async () => {
                try {
                  await api("/auth/logout", "POST", {});
                  await saveToken(null);
                  setMe(null);
                } catch (e) {
                  fail(e);
                }
              }}
              fail={fail}
            />
          )}
          {modal === "server-settings" && server && (
            <>
              <p>{server.description || "Your community, your rules."}</p>
              {canManage && (
                <form
                  onSubmit={(e) =>
                    void submit(e, async (v) => {
                      await action(`/servers/${serverId}`, "PATCH", v);
                      setNotice("Community updated.");
                    })
                  }
                >
                  <label>
                    Name
                    <input name="name" defaultValue={server.name} required />
                  </label>
                  <label>
                    Description
                    <textarea
                      name="description"
                      defaultValue={server.description}
                    />
                  </label>
                  <Submit>Save community</Submit>
                </form>
              )}
              <div className="button-row">
                <button onClick={() => setModal("invite")}>
                  Create invite
                </button>
                <button onClick={() => setModal("channel")}>Add channel</button>
                <button
                  className="danger"
                  onClick={async () => {
                    try {
                      await action(`/servers/${serverId}/leave`);
                      setServerId(null);
                      setChannelId(null);
                      setModal(null);
                    } catch {}
                  }}
                >
                  Leave community
                </button>
              </div>
            </>
          )}
          {modal.startsWith("profile:") &&
            (() => {
              const m = members.find((m) => m.user.id === modal.split(":")[1]);
              return m ? (
                <>
                  <div className="profile-hero">
                    <Avatar user={m.user} />
                    <h3>{m.user.displayName}</h3>
                    <p>
                      @{m.user.username} · {m.role}
                    </p>
                    <p>{m.user.bio || "No status message."}</p>
                  </div>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        void action("/friends", "POST", {
                          username: m.user.username,
                        })
                          .then(() => setNotice("Friend request sent."))
                          .catch(() => {})
                      }
                    >
                      Add friend
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        void action("/blocks", "POST", { targetId: m.user.id })
                          .then(() => setNotice("User blocked."))
                          .catch(() => {})
                      }
                    >
                      Block
                    </button>
                  </div>
                  {server &&
                    ["owner", "admin", "moderator"].includes(
                      server.members[0]?.role,
                    ) && (
                      <form
                        onSubmit={(e) =>
                          void submit(e, async (v) => {
                            await action(
                              `/servers/${serverId}/moderate`,
                              "POST",
                              { targetId: m.user.id, ...v },
                            );
                            setModal(null);
                          })
                        }
                      >
                        <label>
                          Moderation action
                          <select name="action">
                            <option value="timeout">
                              Timeout for one hour
                            </option>
                            <option value="kick">Kick member</option>
                            <option value="ban">Ban member</option>
                            <option value="unban">Unban member</option>
                            <option value="role">Change role</option>
                            <option value="transfer">Transfer ownership</option>
                          </select>
                        </label>
                        <label>
                          Role (for role change)
                          <select name="role">
                            <option>member</option>
                            <option>moderator</option>
                            <option>admin</option>
                          </select>
                        </label>
                        <Submit>Apply action</Submit>
                      </form>
                    )}
                </>
              ) : null;
            })()}
        </Modal>
      )}
    </div>
  );
}
function Chat({
  channel,
  me,
  sock,
  connected,
  search,
  pinned,
  fail,
  onCall,
}: {
  channel: Channel;
  me: User;
  sock: Socket | null;
  connected: boolean;
  search: string;
  pinned: boolean;
  fail: (e: unknown) => void;
  onCall: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Message | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{
    url: string;
    name: string;
    mime: string;
  } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyped = useRef(0);
  const requestId = useRef(0);
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 98,
    overscan: 8,
    getItemKey: (i) => messages[i]?.id || i,
  });
  const query = search
    ? `&q=${encodeURIComponent(search)}`
    : pinned
      ? "&pinned=true"
      : "";
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const r = await api(`/conversations/${channel.id}/messages?${query}`);
      if (id === requestId.current) {
        setMessages(r.messages);
        setCursor(r.nextCursor);
        setTimeout(() => {
          if (scroll.current)
            scroll.current.scrollTop = scroll.current.scrollHeight;
        }, 80);
      }
    } catch (e) {
      fail(e);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [channel.id, query]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), search ? 300 : 0);
    return () => {
      clearTimeout(t);
      requestId.current++;
    };
  }, [reload, connected]);
  useEffect(() => {
    if (!sock) return;
    const update = (m: Message) => {
      if (m.conversationId === channel.id)
        setMessages((old) => old.map((v) => (v.id === m.id ? m : v)));
    };
    const incoming = (m: Message) => {
      if (m.conversationId !== channel.id || search || pinned) return;
      const nearBottom =
        !scroll.current ||
        scroll.current.scrollHeight -
          scroll.current.scrollTop -
          scroll.current.clientHeight <
          200;
      setMessages((old) =>
        old.some((v) => v.id === m.id) ? old : [...old, m],
      );
      setTyping((old) => {
        const n = { ...old };
        delete n[m.authorId];
        return n;
      });
      if (nearBottom)
        setTimeout(() => {
          if (scroll.current)
            scroll.current.scrollTop = scroll.current.scrollHeight;
        }, 80);
      if (!document.hidden)
        void api(`/conversations/${channel.id}/read`, "POST", {}).catch(
          () => {},
        );
    };
    const type = (v: any) => {
      if (v.conversationId === channel.id)
        setTyping((old) => ({ ...old, [v.userId]: Date.now() }));
    };
    sock.on("message:new", incoming);
    sock.on("message:update", update);
    sock.on("typing", type);
    const t = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(
            Object.entries(old).filter(([, t]) => Date.now() - t < 3500),
          ),
        ),
      2000,
    );
    return () => {
      sock.off("message:new", incoming);
      sock.off("message:update", update);
      sock.off("typing", type);
      clearInterval(t);
    };
  }, [sock, channel.id, search, pinned]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function send() {
    if (busy || (!body.trim() && !files.length)) return;
    setBusy(true);
    try {
      const m = await api(`/conversations/${channel.id}/messages`, "POST", {
        body,
        replyToId: reply?.id,
        uploadIds: files.map((f) => f.id),
      });
      setMessages((old) =>
        old.some((v) => v.id === m.id) ? old : [...old, m],
      );
      setBody("");
      setFiles([]);
      setReply(null);
      setTimeout(() => {
        if (scroll.current)
          scroll.current.scrollTop = scroll.current.scrollHeight;
      }, 80);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(m: Message, method: string, data?: unknown) {
    try {
      const v = await api(`/messages/${m.id}`, method, data);
      setMessages((old) => old.map((o) => (o.id === v.id ? v : o)));
    } catch (e) {
      fail(e);
    }
  }
  async function openFile(f: Message["uploads"][number]) {
    try {
      const url = await attachment(f.id);
      setPreview({ url, name: f.name, mime: f.mime });
    } catch (e) {
      fail(e);
    }
  }
  return (
    <section className="chat-main">
      {channel.kind === "voice" ? (
        <div className="voice-welcome">
          <div className="empty-icon">
            <Headphones size={40} />
          </div>
          <span className="eyebrow">MAKE SOME ROOM FOR CONVERSATION</span>
          <h2>Meet in {channel.name}.</h2>
          <p>
            Jump in with your people. Camera optional, good company encouraged.
          </p>
          <button className="primary" onClick={onCall}>
            <Phone size={18} /> Join voice channel
          </button>
        </div>
      ) : null}
      <div className="message-scroll" ref={scroll}>
        {loading ? (
          <div className="skeleton-list messages">
            <i />
            <i />
            <i />
          </div>
        ) : (
          <>
            {cursor && (
              <button
                className="load-more"
                onClick={async () => {
                  try {
                    const r = await api(
                      `/conversations/${channel.id}/messages?before=${cursor}${query}`,
                    );
                    setMessages((old) => [...r.messages, ...old]);
                    setCursor(r.nextCursor);
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                Load earlier messages
              </button>
            )}
            <div className="channel-intro">
              <div className="intro-hash">
                <Hash size={34} />
              </div>
              <div className="eyebrow">THE START OF SOMETHING GOOD</div>
              <h2>
                {search
                  ? "Search results"
                  : pinned
                    ? "Pinned messages"
                    : `Welcome to ${channel.name}`}
              </h2>
              <p>
                {search
                  ? `Messages matching “${search}”`
                  : pinned
                    ? "Keep the important things close."
                    : "This is your space to share ideas, make plans, and stay a little closer."}
              </p>
              {!messages.length && (
                <div className="start-line">
                  <span />
                  {search || pinned
                    ? "No matching messages"
                    : "Be the first to say hello"}
                  <span />
                </div>
              )}
            </div>
            <div
              style={{
                height: virtual.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtual.getVirtualItems().map((v) => {
                const m = messages[v.index];
                return (
                  <article
                    data-index={v.index}
                    ref={virtual.measureElement}
                    key={m.id}
                    className={`message ${m.deletedAt ? "deleted" : ""}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <Avatar user={m.author} />
                    <div className="message-content">
                      <header>
                        <b>{m.author.displayName}</b>
                        <time
                          dateTime={m.createdAt}
                          title={new Date(m.createdAt).toLocaleString()}
                        >
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        {m.editedAt && <small>(edited)</small>}
                        {m.pinned && <Pin size={12} />}
                      </header>
                      {m.replyToId && (
                        <div className="reply-reference">
                          <Reply size={13} /> Reply to{" "}
                          {messages.find((v) => v.id === m.replyToId)?.author
                            .displayName || "an earlier message"}
                        </div>
                      )}
                      {m.deletedAt ? (
                        <p className="muted">Message deleted</p>
                      ) : (
                        <>
                          <div className="markdown">
                            <Markdown
                              allowedElements={[
                                "p",
                                "strong",
                                "em",
                                "del",
                                "code",
                                "pre",
                                "blockquote",
                                "ul",
                                "ol",
                                "li",
                                "a",
                                "br",
                              ]}
                              components={{
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {children}
                                  </a>
                                ),
                              }}
                            >
                              {m.body}
                            </Markdown>
                          </div>
                          {m.uploads.map((f) => (
                            <button
                              className="attachment"
                              key={f.id}
                              onClick={() => void openFile(f)}
                            >
                              <Paperclip size={18} />
                              <span>
                                {f.name}
                                <small>
                                  {(f.size / 1024).toFixed(1)} KB · Click to
                                  preview or download
                                </small>
                              </span>
                            </button>
                          ))}
                          <div className="reactions">
                            {[...new Set(m.reactions.map((r) => r.emoji))].map(
                              (emoji) => (
                                <button
                                  className={
                                    m.reactions.some(
                                      (r) =>
                                        r.userId === me.id && r.emoji === emoji,
                                    )
                                      ? "mine"
                                      : ""
                                  }
                                  key={emoji}
                                  onClick={() =>
                                    void api(
                                      `/messages/${m.id}/reactions`,
                                      "POST",
                                      { emoji },
                                    )
                                      .then((v) =>
                                        setMessages((old) =>
                                          old.map((o) =>
                                            o.id === v.id ? v : o,
                                          ),
                                        ),
                                      )
                                      .catch(fail)
                                  }
                                >
                                  {emoji}{" "}
                                  {
                                    m.reactions.filter((r) => r.emoji === emoji)
                                      .length
                                  }
                                </button>
                              ),
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {!m.deletedAt && (
                      <div className="message-tools">
                        <button
                          title="React with thumbs up"
                          onClick={() =>
                            void api(`/messages/${m.id}/reactions`, "POST", {
                              emoji: "👍",
                            })
                              .then((v) =>
                                setMessages((old) =>
                                  old.map((o) => (o.id === v.id ? v : o)),
                                ),
                              )
                              .catch(fail)
                          }
                        >
                          <Smile size={15} />
                        </button>
                        <button
                          title="Reply"
                          onClick={() => {
                            setReply(m);
                            input.current?.focus();
                          }}
                        >
                          <Reply size={15} />
                        </button>
                        {channel.serverId && (
                          <button
                            title={m.pinned ? "Unpin" : "Pin message"}
                            onClick={() =>
                              void mutate(m, "PATCH", { pinned: !m.pinned })
                            }
                          >
                            <Pin size={15} />
                          </button>
                        )}
                        {m.authorId === me.id && (
                          <button
                            title="Edit message"
                            onClick={() => {
                              const value = window.prompt(
                                "Edit your message",
                                m.body,
                              );
                              if (value?.trim())
                                void mutate(m, "PATCH", { body: value });
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                        )}
                        <button
                          title="Delete message"
                          onClick={() => {
                            if (confirm("Delete this message?"))
                              void mutate(m, "DELETE");
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="composer-wrap">
        {reply && (
          <div className="reply-bar">
            <Reply size={14} />
            Replying to {reply.author.displayName}
            <button
              className="icon"
              title="Cancel reply"
              onClick={() => setReply(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="draft-files">
            {files.map((f) => (
              <button
                key={f.id}
                onClick={() =>
                  setFiles((old) => old.filter((v) => v.id !== f.id))
                }
              >
                {f.name} <X size={13} />
              </button>
            ))}
          </div>
        )}
        {progress !== null && (
          <div className="upload-progress">
            Uploading… {progress}%<progress max="100" value={progress} />
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="attach-control" title="Attach a file">
            <Plus size={20} />
            <input
              aria-label="Attach a file"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.mp4,.mp3,.ogg"
              disabled={progress !== null || files.length >= 5}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setProgress(0);
                try {
                  const u = await upload(channel.id, f, setProgress);
                  setFiles((old) => [...old, u]);
                } catch (err) {
                  fail(err);
                } finally {
                  setProgress(null);
                  e.target.value = "";
                }
              }}
            />
          </label>
          <textarea
            ref={input}
            rows={1}
            maxLength={4000}
            placeholder={`Message ${channel.serverId ? "# " : ""}${channel.name}`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (Date.now() - lastTyped.current > 2000) {
                sock?.emit("typing", channel.id);
                lastTyped.current = Date.now();
              }
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="icon emoji"
            type="button"
            title="Add a smile"
            onClick={() => {
              setBody((b) => b + " 🙂");
              input.current?.focus();
            }}
          >
            <Smile size={21} />
          </button>
          <button
            type="submit"
            className="send-button"
            aria-label="Send message"
            disabled={
              busy || progress !== null || (!body.trim() && !files.length)
            }
          >
            <Send size={18} />
          </button>
        </form>
        <div className="composer-footer">
          {Object.keys(typing).length ? (
            <span className="typing">
              Someone is typing<span>•••</span>
            </span>
          ) : (
            <span>
              <b>Shift + Enter</b> for a new line
            </span>
          )}
          <span>
            Say something good. <span className="sparkle">✦</span>
          </span>
        </div>
      </div>
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          {preview.mime.startsWith("image/") ? (
            <img
              className="file-preview"
              src={preview.url}
              alt={preview.name}
            />
          ) : preview.mime.startsWith("video/") ? (
            <video className="file-preview" src={preview.url} controls />
          ) : preview.mime.startsWith("audio/") ? (
            <audio src={preview.url} controls />
          ) : (
            <p>
              Download this document to view it. Only open files from people you
              trust.
            </p>
          )}
          <a
            className="primary download"
            href={preview.url}
            download={preview.name}
          >
            Download attachment
          </a>
        </Modal>
      )}
    </section>
  );
}
function SettingsPanel({
  me,
  onSave,
  onLogout,
  fail,
}: {
  me: User;
  onSave: (u: User) => void;
  onLogout: () => void;
  fail: (e: unknown) => void;
}) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  useEffect(() => {
    api("/auth/sessions").then(setSessions).catch(fail);
    api("/blocks").then(setBlocks).catch(fail);
  }, []);
  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api("/auth/me", "PATCH", {
              displayName: v.displayName,
              bio: v.bio,
              status: v.status,
              preferences: {
                theme: v.theme,
                notifications: v.notifications === "on",
                allowFriendRequests: v.allowFriendRequests === "on",
              },
            });
            onSave(await api("/auth/me"));
          } catch (e) {
            fail(e);
          }
        }}
      >
        <div className="settings-profile">
          <Avatar user={me} />
          <span>
            <b>{me.displayName}</b>
            <small>@{me.username}</small>
          </span>
        </div>
        <label>
          Display name
          <input
            name="displayName"
            defaultValue={me.displayName}
            maxLength={40}
            required
          />
        </label>
        <label>
          Custom status
          <input
            name="bio"
            defaultValue={me.bio}
            maxLength={160}
            placeholder="What's on your mind?"
          />
        </label>
        <div className="form-grid">
          <label>
            Presence
            <select name="status" defaultValue={me.status}>
              <option value="online">Online</option>
              <option value="idle">Idle</option>
              <option value="dnd">Do not disturb</option>
              <option value="invisible">Invisible</option>
            </select>
          </label>
          <label>
            Appearance
            <select name="theme" defaultValue={me.preferences?.theme || "dark"}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
        <label className="check-row">
          <input
            name="notifications"
            type="checkbox"
            defaultChecked={me.preferences?.notifications !== false}
            onChange={(e) => {
              if (e.target.checked && !window.voxora)
                void Notification.requestPermission();
            }}
          />
          Desktop notifications
        </label>
        <label className="check-row">
          <input
            name="allowFriendRequests"
            type="checkbox"
            defaultChecked={me.preferences?.allowFriendRequests !== false}
          />
          Allow friend requests
        </label>
        <Submit>Save changes</Submit>
      </form>
      <div className="settings-section">
        <h3>Active sessions</h3>
        {sessions.map((s) => (
          <div className="session-row" key={s.id}>
            <span>
              Signed in {new Date(s.createdAt).toLocaleDateString()}
              <small>
                Expires {new Date(s.expiresAt).toLocaleDateString()}
              </small>
            </span>
            <button
              onClick={() =>
                void api(`/auth/sessions/${s.id}`, "DELETE")
                  .then(() =>
                    setSessions((old) => old.filter((v) => v.id !== s.id)),
                  )
                  .catch(fail)
              }
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
      {blocks.length > 0 && (
        <div className="settings-section">
          <h3>Blocked users</h3>
          {blocks.map((b) => (
            <div className="session-row" key={b.id}>
              <code>{b.targetId}</code>
              <button
                onClick={() =>
                  void api(`/blocks/${b.targetId}`, "DELETE")
                    .then(() =>
                      setBlocks((old) => old.filter((v) => v.id !== b.id)),
                    )
                    .catch(fail)
                }
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="danger logout" onClick={onLogout}>
        <LogOut size={17} />
        Sign out of Voxora
      </button>
    </>
  );
}
