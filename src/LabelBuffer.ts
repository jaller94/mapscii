/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  and to find labels underneath a mouse cursor's position
*/
import RBush from 'rbush';
import stringWidth from 'string-width';
import { Feature } from './Renderer.ts';

export default class LabelBuffer {
  private tree: RBush<{
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    feature: Feature,
  }>;
  private margin: number;

  constructor() {
    this.tree = new RBush();
    this.margin = 5;
  }

  clear(): void {
    this.tree.clear();
  }

  project(x: number, y: number): [number, number] {
    return [Math.floor(x/2), Math.floor(y/4)];
  }

  writeIfPossible(text: string, x: number, y: number, feature: Feature, margin: number): boolean {
    margin = margin || this.margin;

    const point = this.project(x, y);

    if (this._hasSpace(text, point[0], point[1])) {
      this.tree.insert({
        ...this._calculateArea(text, point[0], point[1], margin),
        feature,
      });
      return true;
    } else {
      return false;
    }
  }

  // featuresAt(x: number, y: number) {
  //   return this.tree.search({minX: x, maxX: x, minY: y, maxY: y});
  // }

  private _hasSpace(text: string, x: number, y: number): boolean {
    return !this.tree.collides(this._calculateArea(text, x, y));
  }

  private _calculateArea(text: string, x: number, y: number, margin = 0) {
    return {
      minX: x - margin,
      minY: y - margin / 2,
      maxX: x + margin + stringWidth(text),
      maxY: y + margin / 2,
    };
  }
};
