import { describe, expect, it } from 'vitest';
import { DM3xRadio } from '../../src/radios/dm3x/protocol';
import { METADATA } from '../../src/radios/dm3x/constants';
import type { MemoryBlock } from '../../src/radios/dm3x/memory';
import { createDefaultChannel } from '../../src/utils/channelHelpers';

/**
 * The DM-32 writer fills only the channel blocks the radio already has.
 *
 * Until 2026-11-10 a codeplug with more channels than those blocks hold was cut
 * off at the last block, while the first block's header still carried the full
 * count — the radio was told about channels that were never written. These pin
 * that such a write is refused before any block is produced, and that a
 * codeplug that exactly fills the blocks is still written in full.
 */

type Generated = Array<{ address: number; data: Uint8Array; metadata: number }>;

function radioWithChannelBlocks(count: number): DM3xRadio {
  const radio = new DM3xRadio();
  const blocks: MemoryBlock[] = Array.from({ length: count }, (_, i) => ({
    address: 0x010000 + i * 0x1000,
    metadata: METADATA.CHANNEL_FIRST + i,
    type: 'channel',
  }));
  (radio as unknown as { discoveredBlocks: MemoryBlock[] }).discoveredBlocks = blocks;
  return radio;
}

function generate(radio: DM3xRadio, channelCount: number): Generated {
  const channels = Array.from({ length: channelCount }, (_, i) =>
    createDefaultChannel({ number: i + 1, name: `CH${i + 1}`, rxFrequency: 146.52, txFrequency: 146.52 })
  );
  return (radio as unknown as { generateChannelBlocks(c: typeof channels): Generated }).generateChannelBlocks(channels);
}

// 48-byte channels: 84 after the first block's 16-byte header, 85 in each block after it.
const fiveBlocks = 84 + 4 * 85;

describe('DM-32 channel block capacity', () => {
  it('writes a codeplug that exactly fills the radio\'s channel blocks', () => {
    const blocks = generate(radioWithChannelBlocks(5), fiveBlocks);
    expect(blocks).toHaveLength(5);
    // The first block's header carries the channel count.
    expect(blocks[0].data[0] | (blocks[0].data[1] << 8)).toBe(fiveBlocks);
  });

  it('refuses one channel more than the blocks hold, naming how many to remove', () => {
    expect(() => generate(radioWithChannelBlocks(5), fiveBlocks + 1)).toThrow(
      /425 channels, but the radio's 5 channel blocks hold 424.*nothing was written.*Remove 1 channel/
    );
  });

  it('uses only as many blocks as the channels need', () => {
    expect(generate(radioWithChannelBlocks(5), 261)).toHaveLength(4);
  });
});
