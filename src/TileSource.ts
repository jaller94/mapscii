/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
*/
import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import envPaths from 'env-paths';
const paths = envPaths('mapscii');

import config from './config.ts';
import Tile from './Tile.ts';
import Styler from './Styler.ts';

// https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
// To maximize MapSCII’s compatibility, MBTiles support must be manually added via
// $> npm install -g @mapbox/mbtiles
// let MBTiles = null;
// try {
//   MBTiles = await import('@mapbox/mbtiles');
// } catch {void 0;}
import MBTiles from '@mapbox/mbtiles';

export enum Mode {
  MBTiles = 1,
  VectorTile = 2,
  HTTP = 3,
};

class TileSource {
  private source: string;
  private cache: Record<string, unknown>;
  private cacheSize: number;
  private cached: unknown[];
  public mode: Mode | null;
  private mbtiles: MBTiles | null;
  private styler: Styler | null;

  async init(source: string): Promise<void> {
    this.source = source;
    
    this.cache = {};
    this.cacheSize = 16;
    this.cached = [];
    
    this.mode = null;
    this.mbtiles = null;
    this.styler = null;
    
    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = Mode.HTTP;

    } else if (this.source.endsWith('.mbtiles')) {
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed with following command: \'npm install -g @mapbox/mbtiles\'');
      }

      this.mode = Mode.MBTiles;
      await this.loadMBTiles(source);
    } else {
      throw new Error('source type isn\'t supported yet');
    }
  }

  loadMBTiles(source: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new MBTiles(`${source}?mode=ro`, (err, mbtiles) => {
        if (err) {
          reject(err);
        }
        this.mbtiles = mbtiles;
        resolve();
      });
    });
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
      case Mode.MBTiles:
        return this._getMBTile(z, x, y);
      case Mode.HTTP:
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
        .then((res) => res.buffer())
        .then((buffer) => {
          if (config.persistDownloadedTiles) {
            this._persistTile(z, x, y, buffer);
            return buffer;
          }
        });
    }
    return promise.then((buffer) => {
      return this._createTile(z, x, y, buffer);
    });
  }

  private _getMBTile(z: number, x: number, y: number) {
    return new Promise((resolve, reject) => {
      this.mbtiles.getTile(z, x, y, (err, buffer) => {
        if (err) {
          reject(err);
        }
        resolve(this._createTile(z, x, y, buffer));
      });
    });
  }

  private _createTile(z: number, x: number, y: number, buffer:) {
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
    return fs.writeFile(filePath, buffer, () => null);
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
      if (error.code === 'EEXIST') return true;
      throw error;
    }
  }
}

export default TileSource;
