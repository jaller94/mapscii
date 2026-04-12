import COLORS from './colors.ts';

// Adapted from the abandoned NPM package x256.

type Color = [number, number, number];

const colors: Color[] = COLORS.map((hex) => {
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    return [ r, g, b ];
});

export default function (color: [r: number, g: number, b: number]) {
    let bestDistance = 1000;
    let bestIndex = 0;
    
    for (let i = 0; i < colors.length; i++) {
        const d = distance(colors[i], color);
        if (d <= bestDistance) {
            bestDistance = d;
            bestIndex = i;
        }
    }
    
    return bestIndex;
};

function distance(a: Color, b: Color) {
    return Math.sqrt(
        Math.pow(a[0]-b[0], 2)
        + Math.pow(a[1]-b[1], 2)
        + Math.pow(a[2]-b[2], 2)
    )
}
