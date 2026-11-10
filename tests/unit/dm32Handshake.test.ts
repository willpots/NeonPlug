import { afterEach, describe, expect, it, vi } from 'vitest';
import { DM3xConnection } from '../../src/radios/dm3x/connection';
import type { WebSerialPort } from '../../src/radios/dm3x/types';

/**
 * The DM-32 handshake (PSEARCH → PASSSTA → SYSINFO) over a fake serial port.
 *
 * On a port that was closed and opened again — a Write straight after a Read —
 * the radio has been seen to send one extra byte, 0x90, after its 8-byte PSEARCH
 * reply, in the same USB chunk. Web Serial hands over the whole chunk, so the
 * 0x90 stayed in the read buffer and became the first byte of the PASSSTA reply:
 * "PASSSTA failed: Expected 0x50, got 0x90". These pin that the leftover is
 * dropped before PASSSTA is sent, and that a clean reply still connects.
 */

const PSEARCH_REPLY = [0x06, ...new TextEncoder().encode('DP570UV')];
const PASSSTA_REPLY = [0x50, 0x00, 0x00];
const SYSINFO_REPLY = [0x06];

/** A radio on a fake port: each command written gets its reply as one chunk. */
function fakeRadio(replies: Record<string, number[]>) {
  const chunks: Uint8Array[] = [];
  let waiting: ((result: ReadableStreamReadResult<Uint8Array>) => void) | null = null;
  let readerLocked = false;
  const sent: string[] = [];

  const deliver = (bytes: number[]) => {
    const chunk = new Uint8Array(bytes);
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ value: chunk, done: false });
    } else {
      chunks.push(chunk);
    }
  };

  const reader = {
    read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      const next = chunks.shift();
      if (next) return Promise.resolve({ value: next, done: false });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    async cancel() {
      readerLocked = false;
      chunks.length = 0;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    },
    releaseLock() {
      readerLocked = false;
    },
  };

  const writer = {
    async write(data: Uint8Array) {
      const command = new TextDecoder().decode(data);
      sent.push(command);
      const reply = replies[command];
      if (reply) queueMicrotask(() => deliver(reply));
    },
    releaseLock() {},
  };

  const port = {
    readable: {
      get locked() {
        return readerLocked;
      },
      getReader() {
        readerLocked = true;
        return reader;
      },
    },
    writable: {
      locked: false,
      getWriter: () => writer,
    },
    async open() {},
    async close() {},
  } as unknown as WebSerialPort;

  return { port, sent };
}

function connectionWithoutDelays(): DM3xConnection {
  const connection = new DM3xConnection();
  vi.spyOn(connection as unknown as { delay(ms: number): Promise<void> }, 'delay').mockResolvedValue(undefined);
  return connection;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DM3xConnection handshake', () => {
  it('connects when the PSEARCH reply arrives alone', async () => {
    const { port, sent } = fakeRadio({
      PSEARCH: PSEARCH_REPLY,
      PASSSTA: PASSSTA_REPLY,
      SYSINFO: SYSINFO_REPLY,
    });

    await expect(connectionWithoutDelays().connect(port)).resolves.toBeUndefined();
    expect(sent).toEqual(['PSEARCH', 'PASSSTA', 'SYSINFO']);
  });

  it('drops a trailing byte sent with the PSEARCH reply instead of reading it as the PASSSTA reply', async () => {
    const { port, sent } = fakeRadio({
      PSEARCH: [...PSEARCH_REPLY, 0x90],
      PASSSTA: PASSSTA_REPLY,
      SYSINFO: SYSINFO_REPLY,
    });

    await expect(connectionWithoutDelays().connect(port)).resolves.toBeUndefined();
    expect(sent).toEqual(['PSEARCH', 'PASSSTA', 'SYSINFO']);
  });
});
