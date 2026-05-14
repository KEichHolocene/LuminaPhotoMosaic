export const ColorUtils = {
    rgbToLab(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
        let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
        let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
        let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;
        x /= 95.047; y /= 100.000; z /= 108.883;
        x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
        y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
        z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);
        return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
    },

    avgColor(d) {
        let r=0, g=0, b=0;
        for (let j=0; j<400; j+=4) { r+=d[j]; g+=d[j+1]; b+=d[j+2]; }
        return [r/100, g/100, b/100];
    }
};

export class KDTree {
    constructor(points, dimensions) {
        this.dimensions = dimensions;
        this.root = this.buildTree(points, 0);
    }

    buildTree(points, depth) {
        if (points.length === 0) return null;
        const axis = depth % this.dimensions;
        points.sort((a, b) => a.descriptor[axis] - b.descriptor[axis]);
        const median = Math.floor(points.length / 2);
        return {
            point: points[median],
            left: this.buildTree(points.slice(0, median), depth + 1),
            right: this.buildTree(points.slice(median + 1), depth + 1)
        };
    }

    findNearest(target, k = 40) {
        let candidates = [];
        const search = (node, depth) => {
            if (!node) return;
            const dist = getDist(target, node.point.descriptor);
            candidates.push({ point: node.point, dist });
            candidates.sort((a, b) => a.dist - b.dist);
            if (candidates.length > k) candidates.pop();
            const axis = depth % this.dimensions;
            const diff = target[axis] - node.point.descriptor[axis];
            const near = diff < 0 ? node.left : node.right;
            const far = diff < 0 ? node.right : node.left;
            search(near, depth + 1);
            if (Math.abs(diff) < (candidates[candidates.length-1]?.dist || Infinity)) search(far, depth + 1);
        };
        search(this.root, 0);
        return candidates.map(c => c.point.index);
    }
}

// --- Shared mosaic functions ---

export function getDist(a, b) {
    let sum = 0;
    for (let i = 0; i < 3; i++) { sum += Math.pow((a[i] - b[i]), 2); }
    return Math.sqrt(sum);
}

export function getTonePenalty(targetLab, tileLab, contrast) {
    const targetL = targetLab[0];
    const tileL = tileLab[0];
    const flatness = Math.max(0, 1 - contrast / 22);
    let penalty = 0;

    if (targetL > 58 && targetL < 93 && tileL > targetL + 7) {
        penalty += Math.pow(tileL - targetL - 7, 1.35) * 1.9;
    }
    if (targetL > 66 && targetL < 96 && tileL > 94) {
        penalty += (tileL - 93) * 5;
    }
    if (flatness > 0.55 && tileL > targetL + 12) {
        penalty += flatness * Math.pow(tileL - targetL - 12, 1.2) * 1.2;
    }

    return penalty;
}

export function getLocalContrast(data, x, y, cols, rows) {
    const center = getRgbAt(data, x, y, cols, rows);
    const neighbors = [
        getRgbAt(data, x - 1, y, cols, rows),
        getRgbAt(data, x + 1, y, cols, rows),
        getRgbAt(data, x, y - 1, cols, rows),
        getRgbAt(data, x, y + 1, cols, rows)
    ];
    let total = 0;
    for (const n of neighbors) {
        total += Math.abs(center[0] - n[0]) + Math.abs(center[1] - n[1]) + Math.abs(center[2] - n[2]);
    }
    return total / neighbors.length / 3;
}

export function getRgbAt(data, x, y, cols, rows) {
    const cx = Math.min(cols - 1, Math.max(0, x));
    const cy = Math.min(rows - 1, Math.max(0, y));
    const idx = (cy * cols + cx) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
}

export function applyCellGlaze(renderCtx, x, y, width, height, rgb, contrast) {
    const flatness = Math.max(0, 1 - contrast / 24);
    const luminance = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
    let alpha = 0.1 + flatness * 0.12;

    if (luminance > 170 && luminance < 245) alpha += 0.04;
    if (luminance > 245) alpha -= 0.04;
    alpha = Math.min(0.26, Math.max(0.08, alpha));

    renderCtx.globalAlpha = alpha;
    renderCtx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    renderCtx.fillRect(x, y, width, height);
    renderCtx.globalAlpha = 1.0;
}

export function seededNoise(x, y, salt) {
    const n = Math.sin((x * 127.1) + (y * 311.7) + (salt * 74.7)) * 43758.5453;
    return n - Math.floor(n);
}

/**
 * Re-rank KD-tree candidates using color distance, tone penalty, adjacency,
 * repeat suppression, and organic jitter.
 * @param {number[]} candidates - tile indices (from KDTree.findNearest)
 * @param {number[]} targetLab - target cell Lab color
 * @param {number} contrast - local contrast value
 * @param {number} x - column index
 * @param {number} y - row index
 * @param {number[]} rowIndices - indices already placed in this row
 * @param {number[]|null} previousRow - indices from the row above
 * @param {number[]} usageCounts - per-tile usage counts for this session
 * @param {object[]} tiles - tile objects with .descriptor arrays
 */
export function chooseTile(candidates, targetLab, contrast, x, y, rowIndices, previousRow, usageCounts, tiles) {
    const flatness = Math.max(0, 1 - contrast / 22);
    const poolSize = Math.max(4, Math.round(6 + flatness * 18));
    let best = candidates[0];
    let bestScore = Infinity;

    for (let i = 0; i < Math.min(poolSize, candidates.length); i++) {
        const index = candidates[i];
        const descriptor = tiles[index].descriptor;
        const left = rowIndices[rowIndices.length - 1] === index;
        const above = previousRow && previousRow[x] === index;
        const diagonal = previousRow && (previousRow[x - 1] === index || previousRow[x + 1] === index);
        const usage = usageCounts[index] || 0;
        const maxUsage = Math.max(1, Math.ceil((x + y + 1) / Math.max(1, tiles.length)));
        const repeatPenalty = Math.max(0, usage - maxUsage) * (10 + flatness * 18);
        const adjacencyPenalty = (left ? 28 : 0) + (above ? 22 : 0) + (diagonal ? 8 : 0);
        const organicJitter = seededNoise(x, y, index) * flatness * 16;
        const detailPenalty = i * (1 - flatness) * 3;
        const colorDist = getDist(targetLab, descriptor) + getTonePenalty(targetLab, descriptor, contrast);
        const score = colorDist + repeatPenalty + adjacencyPenalty + organicJitter + detailPenalty;

        if (score < bestScore) {
            bestScore = score;
            best = index;
        }
    }

    return best;
}

export function isImageFile(file) {
    return file.type.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|gif|webp|bmp|avif|tif|tiff)$/i.test(file.name);
}
