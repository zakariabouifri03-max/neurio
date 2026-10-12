import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  useRoomContext,
  useLocalParticipant,
  MediaDeviceMenu,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { api, type Channel } from "./api";
function ExtraControls() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [ptt, setPtt] = useState(false);
  const [sources, setSources] = useState<
    { id: string; name: string; thumbnail: string }[]
  >([]);
  useEffect(() => {
    if (!ptt) return;
    void localParticipant.setMicrophoneEnabled(false);
    const down = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
      ) {
        e.preventDefault();
        void localParticipant.setMicrophoneEnabled(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") void localParticipant.setMicrophoneEnabled(false);
    };
    const blur = () => void localParticipant.setMicrophoneEnabled(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      void localParticipant.setMicrophoneEnabled(false);
    };
  }, [ptt, localParticipant]);
  return (
    <div className="call-extras">
      <label>
        <input
          type="checkbox"
          checked={ptt}
          onChange={(e) => setPtt(e.target.checked)}
        />{" "}
        Push to talk (hold Space outside text fields)
      </label>
      <MediaDeviceMenu kind="audiooutput" />
      {window.voxora && (
        <button
          onClick={async () =>
            setSources(await window.voxora!.captureSources())
          }
        >
          Choose screen / window
        </button>
      )}
      {sources.length > 0 && (
        <div className="source-picker">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                await window.voxora!.selectCapture(s.id);
                await localParticipant.setScreenShareEnabled(true);
                setSources([]);
              }}
            >
              <img src={s.thumbnail} alt="" />
              {s.name}
            </button>
          ))}
          <button onClick={() => setSources([])}>Cancel</button>
        </div>
      )}
      <label>
        Playback volume{" "}
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          defaultValue="1"
          onChange={(e) =>
            room.remoteParticipants.forEach((p) =>
              p.setVolume(Number(e.target.value)),
            )
          }
        />
      </label>
    </div>
  );
}
export default function Call({
  channel,
  onLeave,
}: {
  channel: Channel;
  onLeave: () => void;
}) {
  const [connection, setConnection] = useState<{
    token: string;
    url: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/conversations/${channel.id}/media`, "POST", {})
      .then((v) => {
        if (active) setConnection(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [channel.id]);
  return (
    <section className="call-overlay">
      <header>
        <div>
          <span className="eyebrow">VOICE & VIDEO</span>
          <h2>{channel.name}</h2>
        </div>
        <button className="danger" onClick={onLeave}>
          Leave call
        </button>
      </header>
      {error ? (
        <div className="notice error">
          {error}
          <p>
            Check that LiveKit is reachable and your microphone is permitted. No
            media connection has been established.
          </p>
        </div>
      ) : connection ? (
        <LiveKitRoom
          token={connection.token}
          serverUrl={connection.url}
          connect
          audio={false}
          video={false}
          options={{
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            publishDefaults: { simulcast: true },
          }}
          onDisconnected={onLeave}
          onError={(e) => setError(e.message)}
          data-lk-theme="default"
        >
          <ExtraControls />
          <VideoConference />
        </LiveKitRoom>
      ) : (
        <div className="empty">
          <div className="spinner" />
          Requesting a secure room connection…
        </div>
      )}
    </section>
  );
}
