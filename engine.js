/**
 * Lumina Mosaic Engine - Core Logic
 * Handles color space conversions, descriptor extraction, and k-d tree matching.
 */

export class ColorUtils {
    /**
     * Converts RGB to CIELAB color space.
     * Lab is perceptually uniform, making it superior for mosaic matching.
     */
    static rgbToLab(r, g, b) {
        // Normalize RGB
        r /= 255; g /= 255; b /= 255;
        
        // Linearize (inverse sRGB gamma)
        r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

        // RGB to XYZ
        let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
        let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
        let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

        // XYZ to Lab (D65 illuminant)
        x /= 95.047;
        y /= 100.000;
        z /= 108.883;

        x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
        y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
        z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);

        return [
            (116 * y) - 16,     // L
            500 * (x - y),      // a
            200 * (y - z)       // b
        ];
    }

    /**
     * Euclidean distance in CIELAB space.
     */
    static deltaE(labA, labB) {
        return Math.sqrt(
            Math.pow(labA[0] - labB[0], 2) +
            Math.pow(labA[1] - labB[1], 2) +
            Math.pow(labA[2] - labB[2], 2)
        );
    }
}

/**
 * A simple k-d Tree for fast multidimensional nearest-neighbor search.
 */
export class KDTree {
    constructor(points, dimensions) {
        this.dimensions = dimensions;
        this.root = this.buildTree(points, 0);
    }

    buildTree(points, depth) {
        if (points.length === 0) return null;

        const axis = depth % this.dimensions;
        points.sort((a, b) => a.descriptor[axis] - b.descriptor[axis]);

        const medianIndex = Math.floor(points.length / 2);
        const node = {
            point: points[medianIndex],
            left: this.buildTree(points.slice(0, medianIndex), depth + 1),
            right: this.buildTree(points.slice(medianIndex + 1), depth + 1)
        };

        return node;
    }

    findNearest(targetDescriptor) {
        let best = null;
        let bestDist = Infinity;

        const search = (node, depth) => {
            if (!node) return;

            // Calculate distance with a small penalty for frequently used tiles
            const rawDist = this.getDist(targetDescriptor, node.point.descriptor);
            const usagePenalty = (node.point.usage || 0) * 2.5; 
            const dist = rawDist + usagePenalty;

            if (dist < bestDist) {
                bestDist = dist;
                best = node.point;
            }

            const axis = depth % this.dimensions;
            const diff = targetDescriptor[axis] - node.point.descriptor[axis];

            const near = diff < 0 ? node.left : node.right;
            const far = diff < 0 ? node.right : node.left;

            search(near, depth + 1);
            if (Math.abs(diff) < bestDist) {
                search(far, depth + 1);
            }
        };

        search(this.root, 0);

        // Track usage
        if (best) {
            best.usage = (best.usage || 0) + 1;
        }

        return best;
    }

    getDist(a, b) {
        let sum = 0;
        for (let i = 0; i < this.dimensions; i++) {
            // Give extra weight to L (luminance) for better contrast
            const weight = (i === 0) ? 1.5 : 1.0; 
            sum += Math.pow((a[i] - b[i]) * weight, 2);
        }
        return Math.sqrt(sum);
    }
}

/**
 * Handles tile analysis and matching.
 */
export class MosaicEngine {
    constructor() {
        this.tiles = [];
        this.kdTree = null;
    }

    addTile(img, src) {
        const descriptor = this.extractDescriptor(img);
        this.tiles.push({ img, src, descriptor });
    }

    extractDescriptor(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 10; // Tiny for fast averaging
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);
        
        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i+1]; b += data[i+2];
        }
        const count = data.length / 4;
        const lab = ColorUtils.rgbToLab(r/count, g/count, b/count);

        // "Dominant Shape" descriptor: luminance of 4 quadrants
        const qSize = 5;
        const quadrants = [
            this.avgLuminance(data, 0, 0, qSize, qSize, 10),
            this.avgLuminance(data, qSize, 0, qSize, qSize, 10),
            this.avgLuminance(data, 0, qSize, qSize, qSize, 10),
            this.avgLuminance(data, qSize, qSize, qSize, qSize, 10)
        ];

        return [...lab, ...quadrants];
    }

    avgLuminance(data, x, y, w, h, stride) {
        let sum = 0;
        for (let i = y; i < y + h; i++) {
            for (let j = x; j < x + w; j++) {
                const idx = (i * stride + j) * 4;
                sum += (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
            }
        }
        return sum / (w * h);
    }

    indexTiles() {
        if (this.tiles.length === 0) return;
        this.kdTree = new KDTree(this.tiles, 7); // 3 (Lab) + 4 (Quadrants)
    }

    match(targetDescriptor) {
        return this.kdTree.findNearest(targetDescriptor);
    }
}
