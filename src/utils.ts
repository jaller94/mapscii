/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  methods used all around
*/
import config from './config.ts';

const RADIUS = 6378137;

export const clamp = (num: number, min: number, max: number) => {
  if (num <= min) {
    return min;
  } else if (num >= max) {
    return max;
  } else {
    return num;
  }
};

export const baseZoom = (zoom: number) => {
  return Math.min(config.tileRange, Math.max(0, Math.floor(zoom)));
};

export const tilesizeAtZoom = (zoom: number) => {
  return config.projectSize * Math.pow(2, zoom-baseZoom(zoom));
};

export const deg2rad = (angle: number) => {
  // (angle / 180) * Math.PI
  return angle * 0.017453292519943295;
};

export const ll2tile = (lon: number, lat: number, zoom: number): {x: number, y: number, z: number} => {
  return {
    x: (lon+180)/360*Math.pow(2, zoom),
    y: (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2, zoom),
    z: zoom,
  };
};

export const tile2ll = (x: number, y: number, zoom: number): {lat: number, lon: number} => {
  const n = Math.PI - 2*Math.PI*y/Math.pow(2, zoom);

  return {
    lon: x/Math.pow(2, zoom)*360-180,
    lat: 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),
  };
};

export const metersPerPixel = (zoom: number, lat = 0) => {
  return (Math.cos(lat * Math.PI/180) * 2 * Math.PI * RADIUS) / (256 * Math.pow(2, zoom));
};

export const hex2rgb = (color: unknown): [r: number, g: number, b: number] => {
  if (typeof color !== 'string') {
    return [255, 0, 0];
  }

  if (!/^#[a-fA-F0-9]{3,6}$/.test(color)) {
    throw new Error(`${color} isn't a supported hex color`);
  }

  const decimal = parseInt(color.substring(1), 16);

  if (color.length === 4) {
    const rgb = [decimal>>8, (decimal>>4)&15, decimal&15];
    return [
      rgb[0] + (rgb[0]<<4),
      rgb[1] + (rgb[1]<<4),
      rgb[2] + (rgb[2]<<4),
    ];
  } else {
    return [(decimal>>16)&255, (decimal>>8)&255, decimal&255];
  }
};

export const digits = (number: number, digits: number) => {
  return Math.floor(number*Math.pow(10, digits))/Math.pow(10, digits);
};

export const normalize = (ll: {lat: number, lon: number}): {lat: number, lon: number} => {
  return {
    lat: Math.min(85.0511, Math.max(-85.0511, ll.lat)),
    lon: ((ll.lon + 180) % 360 + 360) % 360 - 180,
  };
};

export const population = (val: number) => {
  let bits = 0;
  while (val > 0) {
    bits += val & 1;
    val >>= 1;
  }
  return bits;
};
