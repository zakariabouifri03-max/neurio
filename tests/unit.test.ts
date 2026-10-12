/** Unit tests for the pure building blocks (no network, no database). */
import { describe, expect, it } from 'vitest';
import { newId, idTimestamp, isValidId, assertId, HttpError, SnowflakeGenerator } from '../server/ids';
import { hashPassword, verifyPassword, hashToken, generateToken, randomCode, sha256Hex } from '../server/crypto';
import { sniffImageSize, sanitizeFilename, isAllowedUpload, isImageType } from '../server/media';
import {
  Permissions,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  permissionsToKeys,
  keysToPermissions,
} from '../shared/permissions';
import { buildSnippet, serializeMessages } from '../server/store/messages';
import { DEFAULT_PORT, parseArgs, buildConfig } from '../server/config';

describe('snowflake ids', () => {
  it('generates unique, increasing, sortable ids', () => {
    const ids = Array.from({ length: 500 }, () => newId());
    expect(new Set(ids).size).toBe(500);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(ids.every((id) => isValidId(id))).toBe(true);
  });

  it('encodes the creation time', () => {
    const now = Date.now();
    const id = newId(now);
    expect(Math.abs(idTimestamp(id) - now)).toBeLessThan(5);
  });

  it('stays monotonic even if the clock jumps backwards', () => {
    const generator = new SnowflakeGenerator(7);
    const first = generator.next(1_700_000_000_000);
    const second = generator.next(1_699_999_000_000);
    expect(BigInt(second) > BigInt(first)).toBe(true);
  });

  it('validates ids defensively', () => {
    expect(isValidId('123')).toBe(true);
    expect(isValidId('../../etc/passwd')).toBe(false);
    expect(() => assertId('nope')).toThrow(HttpError);
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const { hash, salt, algo } = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', { hash, salt, algo })).toBe(true);
    expect(verifyPassword('wrong', { hash, salt, algo })).toBe(false);
  });

  it('produces different hashes (unique salts)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('never stores the password in the token or hash', () => {
    const { hash } = hashPassword('hunter2xyz');
    expect(hash).not.toContain('hunter2xyz');
  });
});

describe('tokens and hashes', () => {
  it('creates high-entropy session tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    expect(generateToken().length).toBeGreaterThanOrEqual(40);
  });

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('creates readable invite codes without ambiguous characters', () => {
    const codes = Array.from({ length: 50 }, () => randomCode(8));
    expect(codes.every((code) => /^[a-z2-9]{8}$/.test(code))).toBe(true);
    expect(codes.join('')).not.toMatch(/[ol01]/);
  });

  it('hashes file contents', () => {
    expect(sha256Hex(Buffer.from('neurio'))).toHaveLength(64);
  });
});

describe('media helpers', () => {
  it('reads PNG, GIF and JPEG dimensions', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(sniffImageSize(png)).toEqual({ width: 1, height: 1 });

    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'ascii'),
      Buffer.from([0x40, 0x01, 0xf0, 0x00]), // 320 x 240 little endian
      Buffer.alloc(20),
    ]);
    expect(sniffImageSize(gif)).toEqual({ width: 320, height: 240 });
  });

  it('strips paths and control characters from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\secret.txt')).toBe('secret.txt');
    expect(sanitizeFilename('  weird\u0000name\u001b.txt  ')).toBe('weirdname.txt');
    expect(sanitizeFilename('')).toBe('file');
  });

  it('allows images and rejects executables', () => {
    expect(isAllowedUpload('image/png')).toBe(true);
    expect(isAllowedUpload('application/x-msdownload')).toBe(false);
    expect(isAllowedUpload('IMAGE/PNG; charset=binary')).toBe(true);
    expect(isImageType('image/webp')).toBe(true);
    expect(isImageType('video/mp4')).toBe(false);
  });
});

describe('permission bitfield', () => {
  it('grants everything to administrators', () => {
    const admin = Permissions.ADMINISTRATOR;
    expect(hasPermission(admin, Permissions.BAN_MEMBERS)).toBe(true);
    expect(hasPermission(admin, Permissions.MANAGE_GUILD)).toBe(true);
  });

  it('requires every bit for a compound permission', () => {
    const bits = Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES;
    expect(hasPermission(bits, Permissions.VIEW_CHANNEL)).toBe(true);
    expect(hasPermission(bits, Permissions.BAN_MEMBERS)).toBe(false);
    expect(hasPermission(bits, 0)).toBe(false);
  });

  it('round-trips between keys and bits', () => {
    const keys = permissionsToKeys(DEFAULT_EVERYONE_PERMISSIONS);
    expect(keys).toContain('SEND_MESSAGES');
    expect(keys).toContain('VIEW_CHANNEL');
    expect(keysToPermissions(keys)).toBe(DEFAULT_EVERYONE_PERMISSIONS >>> 0);
  });

  it('keeps masks positive (no sign-bit overflow)', () => {
    for (const value of Object.values(Permissions)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe('search snippets', () => {
  it('centres the snippet around the match', () => {
    const content = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`;
    const snippet = buildSnippet(content, 'needle', 10);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('returns the content unchanged when there is no match', () => {
    expect(buildSnippet('short text', 'zzz')).toBe('short text');
  });
});

describe('message serialisation', () => {
  it('drops deleted messages from list payloads', () => {
    const db = {
      all: () => [],
      get: () => undefined,
    } as never;
    const rows = [
      {
        id: '1',
        channel_id: 'c',
        author_id: 'u',
        content: 'gone',
        type: 'default',
        created_at: 1,
        edited_at: null,
        pinned: 0,
        reference_id: null,
        mention_everyone: 0,
        deleted_at: 123,
      },
    ];
    expect(serializeMessages(db, rows, { viewerId: 'u' })).toEqual([]);
  });
});

describe('configuration', () => {
  it('parses CLI flags in both --key value and --key=value form', () => {
    const { flags } = parseArgs(['--port', '9000', '--host=0.0.0.0', '--no-registration', 'extra']);
    expect(flags.get('port')).toBe('9000');
    expect(flags.get('host')).toBe('0.0.0.0');
    expect(flags.get('no-registration')).toBe(true);
  });

  it('applies sensible defaults', () => {
    const config = buildConfig({ dataDir: '/tmp/neurio-test-config' });
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.dbFile.endsWith('neurio.sqlite')).toBe(true);
    expect(config.offlineMode).toBe(true);
    expect(config.iceServers).toEqual([]);
  });
});
