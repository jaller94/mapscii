/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
*/
import fs from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
const paths = envPaths('mapscii');

import config from './config.ts';
import Tile from './Tile.ts';
import Styler from './Styler.ts';

export type Mode = "VectorTile" | "HTTP";

class TileSource {
  private source: string | null = null;
  private cache: Record<string, unknown> = {};
  private cacheSize: number = 16;
  private cached: unknown[] = [];
  public mode: Mode | null = null;
  private styler: Styler | null = null;

  async init(source: string): Promise<void> {
    this.source = source;

    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = 'HTTP';
    } else {
      throw new Error('source type isn\'t supported yet');
    }
  }

  useStyler(styler: Styler) {
    this.styler = styler;
  }

  getTile(z: number, x: number, y: number) {
    if (!this.mode) {
      throw new Error('no TileSource defined');
    }
    
    const cached = this.cache[[z, x, y].join('-')];
    if (cached) {
      return Promise.resolve(cached);
    }
    
    if (this.cached.length > this.cacheSize) {
      const overflow = Math.abs(this.cacheSize - this.cached.length);
      for (const tile in this.cached.splice(0, overflow)) {
        delete this.cache[tile];
      }
    }
  
    switch (this.mode) {
      case "HTTP":
        return this._getHTTP(z, x, y);
    }
  }

  private _getHTTP(z: number, x: number, y: number) {
    let promise;
    const persistedTile = this._getPersited(z, x, y);
    if (config.persistDownloadedTiles && persistedTile) {
      promise = Promise.resolve(persistedTile);
    } else {
      promise = fetch(this.source + [z,x,y].join('/') + '.pbf')
        .then((res) => res.bytes())
        .then((bytes) => {
          if (config.persistDownloadedTiles) {
            this._persistTile(z, x, y, bytes);
            return bytes;
          }
        });
    }
    return promise.then((bytes) => {
      return this._createTile(z, x, y, bytes);
    });
  }

  private _createTile(z: number, x: number, y: number, buffer: Uint8Array) {
    const name = [z, x, y].join('-');
    this.cached.push(name);
    
    const tile = this.cache[name] = new Tile(this.styler);
    return tile.load(buffer);
  }

  private _initPersistence() {
    try {
      this._createFolder(paths.cache);
    } catch {
      config.persistDownloadedTiles = false;
    }
  }

  private _persistTile(z: number, x: number, y: number, buffer: Uint8Array) {
    const zoom = z.toString();
    this._createFolder(path.join(paths.cache, zoom));
    const filePath = path.join(paths.cache, zoom, `${x}-${y}.pbf`);
    fs.writeFile(filePath, buffer, () => null);
  }

  private _getPersited(z: number, x: number, y: number) {
    try {
      return fs.readFileSync(path.join(paths.cache, z.toString(), `${x}-${y}.pbf`));
    } catch {
      return false;
    }
  }

  private _createFolder(path: string): true {
    try {
      fs.mkdirSync(path);
      return true;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') return true;
      throw error;
    }
  }
}

export default TileSource;
