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
            const dist = this.getDist(target, node.point.descriptor);
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
    
    getDist(a, b) {
        let sum = 0;
        for (let i = 0; i < 3; i++) { sum += Math.pow((a[i] - b[i]), 2); }
        return Math.sqrt(sum);
    }
}
