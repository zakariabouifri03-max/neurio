/**
 * File download endpoint.
 *
 * Attachments are served straight from the local uploads directory — no cloud
 * storage, no expiring URLs, no credentials. Range requests are supported so
 * audio/video attachments can be scrubbed in the built-in players.
 */
import { createReadStream, statSync } from 'node:fs';
import { HttpError } from '../ids';
import { getUpload, bumpDownloadCount } from '../store/messages';
import { requireChannelAccess, requireUser } from './helpers';
import type { Router } from './router';
import type { RestDeps } from './types';

/** Remove an attachment from disk + database. */
export function destroyUpload(deps: RestDeps, uploadId: string): void {
  deps.uploads.remove(deps.db, uploadId);
}

function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const encoded = encodeURIComponent(filename);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function registerFileRoutes(router: Router, deps: RestDeps): void {
  const serve = (ctx: Parameters<Parameters<Router['get']>[1]>[0], download: boolean): unknown => {
    const user = requireUser(ctx);
    const uploadId = ctx.params.uploadId;
    const upload = getUpload(deps.db, uploadId);
    if (!upload) throw new HttpError(404, 'File not found', 'unknown_file');

    // Authorisation: avatars and server icons are visible to signed-in users;
    // attachments must belong to a message in a channel the user can see.
    const attachment = deps.db.get<{ message_id: string | null; channel_id: string | null }>(
      'SELECT message_id, channel_id FROM attachments WHERE upload_id = ?',
      [uploadId],
    );
    const isAvatarOf = deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE avatar_id = ?', [uploadId]);
    const isIconOf = deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM guilds WHERE icon_id = ?', [uploadId]);
    const isPublic = Number(isAvatarOf?.c ?? 0) > 0 || Number(isIconOf?.c ?? 0) > 0;

    if (!isPublic) {
      if (!attachment?.channel_id) throw new HttpError(403, 'You do not have access to that file', 'forbidden');
      requireChannelAccess(ctx, attachment.channel_id);
    }

    const path = deps.uploads.pathFor(uploadId);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      throw new HttpError(404, 'File is missing from disk', 'file_missing');
    }

    const isImage = upload.content_type.startsWith('image/');
    const headers: Record<string, string> = {
      'content-type': upload.content_type,
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': contentDisposition(upload.filename, !download && isImage),
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
    };

    const range = ctx.req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
      const start = startRaw === '' ? Math.max(0, stat.size - Number(endRaw)) : Number(startRaw);
      const end = startRaw === '' || endRaw === '' ? stat.size - 1 : Math.min(Number(endRaw), stat.size - 1);
      if (start >= stat.size || end < start) {
        ctx.res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        ctx.res.end();
        return undefined;
      }
      ctx.res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': String(end - start + 1),
      });
      createReadStream(path, { start, end }).pipe(ctx.res);
      bumpDownloadCount(deps.db, uploadId);
      return undefined;
    }

    ctx.res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
    createReadStream(path).pipe(ctx.res);
    bumpDownloadCount(deps.db, uploadId);
    void user;
    return undefined;
  };

  router.get('/api/files/:uploadId', (ctx) => serve(ctx, false));
  router.get('/api/files/:uploadId/download', (ctx) => serve(ctx, true));
}
