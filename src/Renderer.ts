/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
*/
import RBush from 'rbush';
import simplify from 'simplify-js';
import x256 from './x256/index.ts';

import Canvas from './Canvas.ts';
import LabelBuffer from './LabelBuffer.ts';
import Styler from './Styler.ts';
import { baseZoom, hex2rgb, ll2tile, tilesizeAtZoom } from './utils.ts';
import config from './config.ts';
import TileSource from './TileSource.ts';
import Tile from './Tile.ts';

export type Layer = {
  extent?: unknown,
  tree?: RBush<{
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    feature: Feature,
  }>,
  scale?: number,
  features?: Feature[],
};
export type Layers = Record<string, Layer>;
export type Feature = {
  properties: Record<string, unknown>,
  // TODO `style` is likely incomplete and incorrect
  style: {
    type?: string,
  },
  sort: number,
  sorty: number,
};

class Renderer {
  private canvas: Canvas | undefined;
  private height: number;
  private labelBuffer: LabelBuffer;
  private output: unknown;
  private styler: Styler;
  private tileSource: TileSource;
  private width: number;

  private terminal = {
    CLEAR: '\x1B[2J',
    MOVE: '\x1B[?6h',
  };
  
  private isDrawing = false;
  private lastDrawAt = 0;
  private tilePadding = 64;
  

  constructor(output, tileSource: TileSource, style) {
    this.output = output;
    this.tileSource = tileSource;
    this.labelBuffer = new LabelBuffer();
    this.styler = new Styler(style);
    this.tileSource.useStyler(this.styler);
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new Canvas(width, height);
  }

  async draw(center: {lat: number, lon: number}, zoom: number): Promise<string | void> {
    if (this.isDrawing) return Promise.reject();
    this.isDrawing = true;

    this.labelBuffer.clear();
    const seen = new Set<string>();

    let ref;
    const color = ((ref = this.styler.styleById['background']) !== null ?
      ref.paint['background-color']
      :
      void 0
    );
    if (color) {
      this.canvas?.setBackground(x256(hex2rgb(color)));
    }

    this.canvas?.clear();

    try {
      const tiles = this._visibleTiles(center, zoom);
      await Promise.all(tiles.map(async(tile) => {
        await this._getTile(tile);
        this._getTileFeatures(tile, zoom);
      }));
      await this._renderTiles(tiles, seen);
      return this._getFrame();
    } catch (err) {
      console.error(err);
    } finally {
      this.isDrawing = false;
      this.lastDrawAt = Date.now();
    }
  }

  private _visibleTiles(center: {lat: number, lon: number}, zoom: number) {
    const z = baseZoom(zoom);
    const centerXY = ll2tile(center.lon, center.lat, z);
    
    const tiles: Tile[] = [];
    const tileSize = tilesizeAtZoom(zoom);
    
    for (let y = Math.floor(centerXY.y) - 1; y <= Math.floor(centerXY.y) + 1; y++) {
      for (let x = Math.floor(centerXY.x) - 1; x <= Math.floor(centerXY.x) + 1; x++) {
        const tile = {x, y, z};
        const position = {
          x: this.width / 2 - (centerXY.x - tile.x) * tileSize,
          y: this.height / 2 - (centerXY.y - tile.y) * tileSize,
        };
        
        const gridSize = Math.pow(2, z);
        
        tile.x %= gridSize;
        
        if (tile.x < 0) {
          tile.x = z === 0 ? 0 : tile.x + gridSize;
        }
        
        if (tile.y < 0 || tile.y >= gridSize || position.x + tileSize < 0 || position.y + tileSize < 0 || position.x > this.width || position.y > this.height) {
          continue;
        }
        
        tiles.push({
          xyz: tile,
          zoom,
          position,
          size: tileSize,
        });
      }
    }
    return tiles;
  }

  async _getTile(tile: Tile): Promise<Tile> {
    tile.data = await this.tileSource.getTile(tile.xyz.z, tile.xyz.x, tile.xyz.y);
    return tile;
  }

  private _getTileFeatures(tile: Tile, zoom: number): Tile {
    const position = tile.position;
    const layers: Layers = {};
    const drawOrder = this._generateDrawOrder(zoom);
    for (const layerId of drawOrder) {
      const layer = (tile.data.layers || {})[layerId];
      if (!layer) {
        continue;
      }
      
      const scale = layer.extent / tilesizeAtZoom(zoom);
      layers[layerId] = {
        scale,
        features: layer.tree.search({
          minX: -position.x * scale,
          minY: -position.y * scale,
          maxX: (this.width - position.x) * scale,
          maxY: (this.height - position.y) * scale,
        }),
      };
    }
    tile.layers = layers;
    return tile;
  }

  private _renderTiles(tiles, seen: Set<string>) {
    const labels: {
      tile: Tile,
      feature: Feature,
      scale: number,
    }[] = [];
    if (tiles.length === 0) return;
    
    const drawOrder = this._generateDrawOrder(tiles[0].xyz.z);
    for (const layerId of drawOrder) {
      for (const tile of tiles) {
        const layer = tile.layers[layerId];
        if (!layer) continue;
        for (const feature of layer.features) {
          // continue if feature.id and drawn[feature.id]
          // drawn[feature.id] = true;
          if (layerId.match(/label/)) {
            labels.push({
              tile,
              feature,
              scale: layer.scale,
            });
          } else {
            this._drawFeature(tile, feature, layer.scale, seen);
          }
        }
      }
    }

    labels.sort((a, b) => {
      return a.feature.sorty - b.feature.sort;
    });

    for (const label of labels) {
      this._drawFeature(label.tile, label.feature, label.scale, seen);
    }
  }

  private _getFrame(): string {
    if (!this.canvas) {
      return '';
    }
    let frame = '';
    if (!this.lastDrawAt) {
      frame += this.terminal.CLEAR;
    }
    frame += this.terminal.MOVE;
    frame += this.canvas.frame();
    return frame;
  }

  // featuresAt(x: number, y: number) {
  //   return this.labelBuffer.featuresAt(x, y);
  // }

  private _drawFeature(tile: Tile, feature, scale: number, seen: Set<string>): boolean {
    if (!this.canvas) {
      return false;
    }
    let points, placed;
    if (feature.style.minzoom && tile.zoom < feature.style.minzoom) {
      return false;
    } else if (feature.style.maxzoom && tile.zoom > feature.style.maxzoom) {
      return false;
    }
    
    switch (feature.style.type) {
      case 'line': {
        let width = feature.style.paint['line-width'];
        if (width instanceof Object) {
          // TODO: apply the correct zoom based value
          width = width.stops[0][1];
        }
        points = this._scaleAndReduce(tile, feature, feature.points, scale);
        if (points.length) {
          this.canvas.polyline(points, feature.color, width);
        }
        break;
      }
      case 'fill': {
        points = feature.points.map((p) => {
          return this._scaleAndReduce(tile, feature, p, scale, false);
        });
        this.canvas.polygon(points, feature.color);
        break;
      }
      case 'symbol': {
        const genericSymbol = config.poiMarker;
        const text = feature.label || config.poiMarker;
        
        if (seen.has(text) && !genericSymbol) {
          return false;
        }
        
        placed = false;
        const pointsOfInterest = this._scaleAndReduce(tile, feature, feature.points, scale);
        for (const point of pointsOfInterest) {
          const x = point.x - text.length;
          const layerMargin = (config.layers[feature.layer] || {}).margin;
          const margin = layerMargin || config.labelMargin;
          if (this.labelBuffer.writeIfPossible(text, x, point.y, feature, margin)) {
            this.canvas.text(text, x, point.y, feature.color);
            placed = true;
            break;
          } else {
            const cluster = (config.layers[feature.layer] || {}).cluster;
            if (cluster && this.labelBuffer.writeIfPossible(config.poiMarker, point.x, point.y, feature, 3)) {
              this.canvas.text(config.poiMarker, point.x, point.y, feature.color);
              placed = true;
              break;
            }
          }
        }
        if (placed) {
          seen.add(text);
        }
        break;
      }
    }
    return true;
  }

  private _scaleAndReduce(tile: Tile, feature: Feature, points: {x: number, y: number}[], scale: number, filter = true) {
    let lastX;
    let lastY;
    let outside;
    const scaled: {x: number, y: number}[] = [];
    
    const minX = -this.tilePadding;
    const minY = -this.tilePadding;
    const maxX = this.width + this.tilePadding;
    const maxY = this.height + this.tilePadding;
    
    for (const point of points) {
      const x = Math.floor(tile.position.x + (point.x / scale));
      const y = Math.floor(tile.position.y + (point.y / scale));
      if (lastX === x && lastY === y) {
        continue;
      }
      lastY = y;
      lastX = x;
      if (filter) {
        if (x < minX || x > maxX || y < minY || y > maxY) {
          if (outside) {
            continue;
          }
          outside = true;
        } else {
          if (outside) {
            outside = null;
            scaled.push({x: lastX, y: lastY});
          }
        }
      }
      scaled.push({x, y});
    }
    if (feature.style.type !== 'symbol') {
      if (scaled.length < 2) {
        return [];
      }
      if (config.simplifyPolylines) {
        return simplify(scaled, .5, true);
      } else {
        return scaled;
      }
    } else {
      return scaled;
    }
  }

  private _generateDrawOrder(zoom) {
    if (zoom < 2) {
      return [
        'admin',
        'water',
        'country_label',
        'marine_label',
      ];
    } else {
      return [
        'landuse',
        'water',
        'marine_label',
        'building',
        'road',
        'admin',
        'country_label',
        'state_label',
        'water_label',
        'place_label',
        'rail_station_label',
        'poi_label',
        'road_label',
        'housenum_label',
      ];
    }
  }
}

export default Renderer;
