/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Simple pixel to braille character mapper

  Implementation inspired by node-drawille (https://github.com/madbence/node-drawille)
  * added color support
  * added text label support
  * general optimizations

  Will either be merged into node-drawille or become an own module at some point
*/
import stringWidth from 'string-width';
import config from './config.ts';
import { population } from './utils.ts';

const asciiMap = {
  // '▬': [2+32, 4+64],
  // '¯': [1+16],
  '▀': [1+2+16+32],
  '▄': [4+8+64+128],
  '■': [2+4+32+64],
  '▌': [1+2+4+8],
  '▐': [16+32+64+128],
  // '▓': [1+4+32+128, 2+8+16+64],
  '█': [255],
} as const;
const termReset = '\x1B[39;49m';

class BrailleBuffer {
  private brailleMap: number[][];
  private pixelBuffer: Uint8Array;
  private charBuffer: string[];
  private foregroundBuffer: Uint8Array;
  private backgroundBuffer: Uint8Array;
  private height: number;
  private width: number;
  private globalBackground: number | null;
  private asciiToBraille: string[];

  constructor(width: number, height: number) {
    this.brailleMap = [[0x1, 0x8],[0x2, 0x10],[0x4, 0x20],[0x40, 0x80]];

    this.charBuffer = [];

    this.asciiToBraille = [];

    this.globalBackground = null;

    this.width = width;
    this.height = height;

    const size = width*height/8;
    this.pixelBuffer = new Uint8Array(size);
    this.foregroundBuffer = new Uint8Array(size);
    this.backgroundBuffer = new Uint8Array(size);

    this._mapBraille();
    this.clear();
  }

  clear(): void {
    this.pixelBuffer.fill(0);
    this.charBuffer = [];
    this.foregroundBuffer.fill(0);
    this.backgroundBuffer.fill(0);
  }

  setGlobalBackground(background: number): void {
    this.globalBackground = background;
  }

  setBackground(x: number, y: number, color: number): void {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.backgroundBuffer[idx] = color;
    }
  }

  setPixel(x: number, y: number, color: number): void {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] |= mask;
      this.foregroundBuffer[idx] = color;
    });
  }

  unsetPixel(x: number, y: number): void {
    this._locate(x, y, (idx, mask) => {
      this.pixelBuffer[idx] &= ~mask;
    });
  }

  private _project(x: number, y: number): number {
    return (x>>1) + (this.width>>1)*(y>>2);
  }

  private _locate(x: number, y: number, cb: (idx: number, mask: number) => unknown) {
    if (!((0 <= x && x < this.width) && (0 <= y && y < this.height))) {
      return;
    }
    const idx = this._project(x, y);
    const mask = this.brailleMap[y & 3][x & 1];
    return cb(idx, mask);
  }

  private _mapBraille(): string[] {
    this.asciiToBraille = [' '];

    const masks: {
      char: string,
      covered: number,
      mask: number,
    }[] = [];
    for (const char in asciiMap) {
      const bits = asciiMap[char];
      if (!(bits instanceof Array)) continue;
      for (const mask of bits) {
        masks.push({
          char,
          covered: 0,
          mask,
        });
      }
    }

    //TODO Optimize this part
    let i: number, k: number;
    const results: string[] = [];
    for (i = k = 1; k <= 255; i = ++k) {
      const braille = (i & 7) + ((i & 56) << 1) + ((i & 64) >> 3) + (i & 128);
      const char = masks.reduce((best, mask) => {
        const covered = population(mask.mask & braille);
        if (!best || best.covered < covered) {
          return {
            ...mask,
            covered,
          };
        } else {
          return best;
        }
      }).char;
      this.asciiToBraille[i] = char;
      results.push(char);
    }
    return results;
  }

  private _termColor(foreground: number, background: number): string {
    const actualBackground = background ?? this.globalBackground;
    if (foreground && actualBackground) {
      return `\x1B[38;5;${foreground};48;5;${actualBackground}m`;
    } else if (foreground) {
      return `\x1B[49;38;5;${foreground}m`;
    } else if (actualBackground) {
      return `\x1B[39;48;5;${actualBackground}m`;
    } else {
      return termReset;
    }
  }

  frame(): string {
    const output: string[] = [];
    let currentColor: string | null = null;
    let skip = 0;

    for (let y = 0; y < this.height/4; y++) {
      skip = 0;

      for (let x = 0; x < this.width/2; x++) {
        const idx = y*this.width/2 + x;

        if (idx && !x) {
          output.push(config.delimeter);
        }

        const colorCode = this._termColor(this.foregroundBuffer[idx], this.backgroundBuffer[idx]);
        if (currentColor !== colorCode) {
          output.push(currentColor = colorCode);
        }

        const char = this.charBuffer[idx];
        if (char) {
          skip += stringWidth(char)-1;
          if (skip+x < this.width/2) {
            output.push(char);
          }
        } else {
          if (!skip) {
            if (config.useBraille) {
              output.push(String.fromCharCode(0x2800 + this.pixelBuffer[idx]));
            } else {
              output.push(this.asciiToBraille[this.pixelBuffer[idx]]);
            }
          } else {
            skip--;
          }
        }
      }
    }

    output.push(termReset + config.delimeter);
    return output.join('');
  }

  setChar(char: string, x: number, y: number, color: number): void {
    if (0 <= x && x < this.width && 0 <= y && y < this.height) {
      const idx = this._project(x, y);
      this.charBuffer[idx] = char;
      this.foregroundBuffer[idx] = color;
    }
  }

  writeText(text, x, y, color, center = true): void {
    if (center) {
      x -= text.length/2+1;
    }
    for (let i = 0; i < text.length; i++) {
      this.setChar(text.charAt(i), x+i*2, y, color);
    }
  }
}

export default BrailleBuffer;
