import { describe, expect, test } from 'bun:test';
import TileSource from './TileSource.ts';

describe('TileSource', () => {
  describe('with a HTTP source', () => {
    test('sets the mode to HTTP', async () => {
      const tileSource = new TileSource();
      await tileSource.init('http://mapscii.me/');
      expect(tileSource.mode).toBe("HTTP");
    });
  });
});
