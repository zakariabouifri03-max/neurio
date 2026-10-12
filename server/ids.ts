/**
 * Snowflake ids — lexicographically sortable, unique per process.
 * Layout: 41 bits ms since EPOCH | 10 bits worker | 12 bits sequence.
 * Serialised as a decimal string so JavaScript never loses precision.
 */
export const SNOWFLAKE_EPOCH = 1735689600000; // 2025-01-01T00:00:00Z (fixed, never change)
const WORKER_BITS = 10;
const SEQUENCE_BITS = 12;
const MAX_WORKER = (1 << WORKER_BITS) - 1;
const MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1;

export class SnowflakeGenerator {
  #worker: number;
  #lastTimestamp = -1;
  #sequence = 0;
  /** guards against clock rollback producing duplicate ids */
  #drift = 0;

  constructor(workerId = Math.floor(Math.random() * (MAX_WORKER + 1))) {
    this.#worker = workerId & MAX_WORKER;
  }

  next(now = Date.now()): string {
    let timestamp = now - SNOWFLAKE_EPOCH + this.#drift;
    if (timestamp < this.#lastTimestamp) {
      // Clock moved backwards — keep monotonic by borrowing from the previous tick.
      this.#drift += this.#lastTimestamp - timestamp;
      timestamp = this.#lastTimestamp;
    }
    if (timestamp === this.#lastTimestamp) {
      this.#sequence = (this.#sequence + 1) & MAX_SEQUENCE;
      if (this.#sequence === 0) timestamp += 1;
    } else {
      this.#sequence = 0;
    }
    this.#lastTimestamp = timestamp;
    const id = (BigInt(timestamp) << BigInt(WORKER_BITS + SEQUENCE_BITS)) |
      (BigInt(this.#worker) << BigInt(SEQUENCE_BITS)) |
      BigInt(this.#sequence);
    return id.toString();
  }
}

export const snowflakes = new SnowflakeGenerator();

export function newId(now?: number): string {
  return snowflakes.next(now);
}

/** Extract the creation time (ms) encoded in an id. */
export function idTimestamp(id: string): number {
  return Number(BigInt(id) >> BigInt(WORKER_BITS + SEQUENCE_BITS)) + SNOWFLAKE_EPOCH;
}

const ID_RE = /^\d{1,20}$/;
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

/** Anyone could otherwise pass "../../etc/passwd" as an id into a file path. */
export function assertId(value: unknown, name = 'id'): string {
  if (!isValidId(value)) throw new HttpError(400, `Invalid ${name}`);
  return value;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
