/** Avatar with presence dot and initials fallback. */
import { colorForId, initials, statusColor } from '../lib/format';
import type { PublicUser } from '../lib/types';

interface AvatarProps {
  user: Pick<PublicUser, 'id' | 'display_name' | 'avatar_url' | 'status'> | null;
  size?: number;
  showStatus?: boolean;
  onClick?: () => void;
  title?: string;
}

export function Avatar({ user, size = 36, showStatus = true, onClick, title }: AvatarProps) {
  const name = user?.display_name ?? '?';
  const url = user?.avatar_url ?? null;
  const status = user?.status ?? 'offline';
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: colorForId(user?.id ?? 'unknown') }}
      onClick={onClick}
      title={title ?? name}
      data-clickable={onClick ? 'true' : undefined}
    >
      {url ? (
        <img src={url} alt={name} draggable={false} />
      ) : (
        <span className="avatar-initials" style={{ fontSize: size * 0.4 }}>
          {initials(name)}
        </span>
      )}
      {showStatus && (
        <span className="avatar-status" style={{ background: statusColor(status), width: size * 0.3, height: size * 0.3 }} />
      )}
    </div>
  );
}
