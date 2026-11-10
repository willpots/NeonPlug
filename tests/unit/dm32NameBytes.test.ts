import { describe, expect, it } from 'vitest';
import {
  decodeRadioName,
  encodeChannel,
  encodeRadioName,
  encodeRadioSettings,
  parseChannel,
  parseRadioSettings,
} from '../../src/radios/dm3x/structures';
import { createDefaultChannel } from '../../src/utils/channelHelpers';

/**
 * Two values the DM-32 settings write changed on a real radio (2026-11-10),
 * found by diffing a read taken after a write against the codeplug written.
 *
 * VFO names: both VFOs were unnamed — sixteen 0xFF bytes. The reader decoded
 * them as "ÿ" and the writer sent UTF-8, so the radio came back holding
 * C3 BF pairs ("Ã¿Ã¿…"). The same UTF-8 could push any channel name with a
 * character past 0x7F beyond its 16 bytes into the frequency fields.
 *
 * Analog Call: the radio held type 3 in its third entry; the writer clamped
 * every type to 0-2, so it came back as 2.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');

function channelWithName(name: string) {
  return createDefaultChannel({ number: 4001, name, rxFrequency: 447.7, txFrequency: 447.7 });
}

describe('DM-32 name bytes', () => {
  it('reads sixteen 0xFF bytes as no name, and writes no 0xFF-derived bytes back', () => {
    const raw = encodeChannel(channelWithName('X'));
    raw.fill(0xff, 0, 16);
    const parsed = parseChannel(raw, 4001);
    expect(parsed.name).toBe('');

    const written = encodeChannel(parsed);
    expect(written[0]).toBe(0x00);
    expect(Array.from(written.subarray(0, 16))).not.toContain(0xc3);
  });

  it('treats a name read as "ÿ" characters as empty instead of sending C3 BF pairs', () => {
    expect(hex(encodeChannel(channelWithName('ÿ'.repeat(16))).subarray(0, 16))).toBe(
      hex(encodeChannel(channelWithName('')).subarray(0, 16))
    );
  });

  it('never lets a name spill past its 16 bytes into the frequencies', () => {
    const plain = encodeChannel(channelWithName(''));
    for (const name of ['ÿ'.repeat(16), 'Café Café Café Café', '€€€€€€€€€€€€€€€€', 'A very long channel name']) {
      expect(hex(encodeChannel(channelWithName(name)).subarray(16)), name).toBe(hex(plain.subarray(16)));
    }
  });

  it('round-trips a Latin-1 character as one byte', () => {
    expect(hex(encodeRadioName('Café', 16))).toBe('43 61 66 e9');
    expect(decodeRadioName(bytes(0x43, 0x61, 0x66, 0xe9, 0x00, 0xff))).toBe('Café');
  });

  it('writes back a name already mangled to C3 BF pairs unchanged, so it stops growing', () => {
    const mangled = new Uint8Array(16);
    for (let i = 0; i < 16; i += 2) mangled.set([0xc3, 0xbf], i);
    expect(hex(encodeRadioName(decodeRadioName(mangled), 16))).toBe(hex(mangled));
  });
});

describe('DM-32 Analog Call types', () => {
  it('writes a type NeonPlug has no name for as read, instead of clamping it to 2', () => {
    const settings = parseRadioSettings(new Uint8Array(0x1000));
    settings.analogCall = [
      { callType: 1, callId: 1 },
      { callType: 2, callId: 1 },
      { callType: 3, callId: 1 },
      { callType: 0, callId: 0 },
    ];
    const data = encodeRadioSettings(settings, new Uint8Array(0x1000), ['analogCall']);
    expect(Array.from(data.subarray(0x120, 0x128))).toEqual([1, 1, 2, 1, 3, 1, 0, 0]);
    expect(parseRadioSettings(data).analogCall[2]).toEqual({ callType: 3, callId: 1 });
  });
});
