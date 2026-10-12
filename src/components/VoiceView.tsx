/** The active call: local preview, remote video tiles, screen share and controls. */
import { useEffect, useRef, useState , useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { formatDuration } from '../lib/format';
import type { VoicePeerSnapshot } from '../lib/voice';

function StreamVideo({ stream, muted, label, mirror }: { stream: MediaStream | null; muted?: boolean; label: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream ?? null;
    if (stream) void element.play().catch(() => undefined);
  }, [stream]);
  return (
    <div className="video-tile">
      <video ref={ref} autoPlay playsInline muted={muted} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
      <span className="video-label">{label}</span>
    </div>
  );
}

function PeerTile({ peer }: { peer: VoicePeerSnapshot }) {
  const presence = useStore((state) => state.presence);
  const guilds = useStore((state) => state.guilds);
  const members = useMemo(() => Object.values(guilds).flatMap((entry) => entry.members ?? []), [guilds]);
  const member = members.find((candidate) => candidate.user.id === peer.userId);
  const label = member?.nickname ?? member?.user.display_name ?? 'Participant';
  const status = presence[peer.userId]?.status ?? member?.user.status ?? 'online';
  const hasVideo = (peer.stream?.getVideoTracks().length ?? 0) > 0 || peer.video || peer.screen;

  if (hasVideo) {
    return (
      <div data-speaking={peer.speaking}>
        <StreamVideo stream={peer.stream} label={label} />
      </div>
    );
  }

  return (
    <div className="voice-tile" data-speaking={peer.speaking}>
      <div className="voice-tile-avatar">
        <Avatar user={{ id: peer.userId, display_name: label, avatar_url: member?.user.avatar_url ?? null, status }} size={64} />
        {peer.speaking && <span className="speaking-ring large" />}
      </div>
      <span className="video-label">{label}</span>
    </div>
  );
}

export function VoiceView() {
  const {
    activeCallChannelId,
    channels,
    callPeers,
    localStream,
    screenStream,
    micMuted,
    deafened,
    videoEnabled,
    screenEnabled,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreen,
    leaveVoice,
    selfSpeaking,
    user,
    guilds,
    connection,
  } = useStore(useShallow((state) => ({
    activeCallChannelId: state.activeCallChannelId,
    channels: state.channels,
    callPeers: state.callPeers,
    localStream: state.localStream,
    screenStream: state.screenStream,
    micMuted: state.micMuted,
    deafened: state.deafened,
    videoEnabled: state.videoEnabled,
    screenEnabled: state.screenEnabled,
    toggleMute: state.toggleMute,
    toggleDeafen: state.toggleDeafen,
    toggleVideo: state.toggleVideo,
    toggleScreen: state.toggleScreen,
    leaveVoice: state.leaveVoice,
    selfSpeaking: state.selfSpeaking,
    user: state.user,
    guilds: state.guilds,
    connection: state.connection,
  })));

  const [elapsed, setElapsed] = useState(0);
  const [started] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!activeCallChannelId) return;
    const timer = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [activeCallChannelId, started]);

  if (!activeCallChannelId) return null;
  const channel = channels[activeCallChannelId];
  const guild = channel?.guild_id ? guilds[channel.guild_id] : null;
  const isGuildCall = Boolean(channel?.guild_id);
  const maxMesh = 6;

  return (
    <section className="voice-view" data-expanded={expanded}>
      <header className="voice-header">
        <div>
          <h2>
            {channel?.type === 'voice' ? '🔊' : '📞'} {channel?.name ?? 'Call'}
            {guild ? ` · ${guild.name}` : ''}
          </h2>
          <small>
            {formatDuration(elapsed)} · {callPeers.length + 1} participant{callPeers.length === 0 ? '' : 's'} ·{' '}
            {connection === 'connected' ? 'gateway connected' : connection}
          </small>
        </div>
        <button className="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Minimise' : 'Expand'}
        </button>
      </header>

      {isGuildCall && callPeers.length + 1 > maxMesh && (
        <div className="info-banner">
          Mesh calls are peer-to-peer: {callPeers.length + 1} participants means every client uploads its stream to{' '}
          {callPeers.length} peers. For larger calls, self-host an SFU (docs/NETWORKING.md).
        </div>
      )}

      <div className="video-grid">
        <div data-speaking={selfSpeaking}>
          {videoEnabled && localStream ? (
            <StreamVideo stream={localStream} muted label={`${user?.display_name ?? 'You'} (you)`} mirror />
          ) : (
            <div className="voice-tile" data-speaking={selfSpeaking}>
              <div className="voice-tile-avatar">
                <Avatar user={user} size={64} />
                {selfSpeaking && <span className="speaking-ring large" />}
              </div>
              <span className="video-label">
                {user?.display_name ?? 'You'} (you) {micMuted ? '🔇' : '🎙️'}
              </span>
            </div>
          )}
        </div>
        {callPeers.map((peer) => (
          <div key={peer.userId}>
            <PeerTile peer={peer} />
          </div>
        ))}
      </div>

      {screenStream && (
        <div className="screen-share">
          <h3>You are sharing your screen</h3>
          <StreamVideo stream={screenStream} muted label="Your screen" />
        </div>
      )}

      <footer className="voice-controls">
        <button className="control" data-active={!micMuted} onClick={toggleMute} title="Toggle microphone">
          {micMuted ? '🔇 Muted' : '🎙️ Mic on'}
        </button>
        <button className="control" data-active={!deafened} onClick={toggleDeafen} title="Toggle deafen">
          {deafened ? '🔕 Deafened' : '🎧 Sound on'}
        </button>
        <button className="control" data-active={videoEnabled} onClick={() => void toggleVideo()} title="Toggle camera">
          {videoEnabled ? '🎥 Camera on' : '📷 Camera off'}
        </button>
        <button className="control" data-active={screenEnabled} onClick={() => void toggleScreen()} title="Share screen">
          {screenEnabled ? '🖥️ Sharing' : '🖥️ Share screen'}
        </button>
        <button className="control danger" onClick={() => void leaveVoice()} title="Leave call">
          ✖ Leave
        </button>
      </footer>
    </section>
  );
}
