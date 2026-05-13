import { MosaicEngine, ColorUtils } from './engine.js';

const engine = new MosaicEngine();
let targetImage = null;

// UI Elements
const targetDrop = document.getElementById('targetDrop');
const tileDrop = document.getElementById('tileDrop');
const targetInput = document.getElementById('targetInput');
const tileInput = document.getElementById('tileInput');
const generateBtn = document.getElementById('generateBtn');
const tileStats = document.getElementById('tileStats');
const outputCanvas = document.getElementById('outputCanvas');
const gridRes = document.getElementById('gridRes');
const gridResVal = document.getElementById('gridResVal');
const loader = document.getElementById('loader');
const engineStatus = document.getElementById('engineStatus');

// Interaction
targetDrop.onclick = () => targetInput.click();
tileDrop.onclick = () => tileInput.click();

gridRes.oninput = () => {
    gridResVal.innerText = `${gridRes.value}x${Math.round(gridRes.value * (targetImage ? targetImage.height/targetImage.width : 1))}px`;
};

targetInput.onchange = (e) => handleTarget(e.target.files[0]);
tileInput.onchange = (e) => handleTiles(e.target.files);

async function handleTarget(file) {
    if (!file) return;
    targetImage = await loadImage(URL.createObjectURL(file));
    targetDrop.innerHTML = `<img src="${targetImage.src}" style="max-height: 100px; border-radius: 4px;">`;
    updateStatus();
}

async function handleTiles(files) {
    loader.classList.remove('hidden');
    document.getElementById('loaderText').innerText = `Indexing ${files.length} tiles...`;
    
    let loaded = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        try {
            const img = await loadImage(URL.createObjectURL(file));
            engine.addTile(img, file.name);
            loaded++;
            if (loaded % 50 === 0) {
                document.getElementById('loaderText').innerText = `Indexing: ${loaded}/${files.length}`;
            }
        } catch (err) {
            console.error("Failed to load tile", file.name);
        }
    }
    
    engine.indexTiles();
    tileStats.innerText = `${loaded} tiles indexed and ready.`;
    loader.classList.add('hidden');
    updateStatus();
}

function updateStatus() {
    if (targetImage && engine.tiles.length > 0) {
        generateBtn.disabled = false;
        engineStatus.innerText = "Engine: Ready";
    }
}

generateBtn.onclick = async () => {
    if (!targetImage || engine.tiles.length === 0) return;
    
    loader.classList.remove('hidden');
    document.getElementById('loaderText').innerText = "Generating Mosaic...";
    
    const cols = parseInt(gridRes.value);
    const cellW = targetImage.width / cols;
    const rows = Math.round(targetImage.height / cellW);
    const cellH = targetImage.height / rows;

    outputCanvas.width = targetImage.width;
    outputCanvas.height = targetImage.height;
    const ctx = outputCanvas.getContext('2d');
    
    // Draw target to hidden canvas to sample
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = targetImage.width;
    sampleCanvas.height = targetImage.height;
    const sCtx = sampleCanvas.getContext('2d');
    sCtx.drawImage(targetImage, 0, 0);

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const sx = x * cellW;
            const sy = y * cellH;
            
            // 1. Get Target Descriptor for this cell
            const descriptor = extractCellDescriptor(sCtx, sx, sy, cellW, cellH);
            
            // 2. Find Match
            const match = engine.match(descriptor);
            
            // 3. Draw Match to main canvas
            ctx.drawImage(match.img, sx, sy, cellW, cellH);
        }
        // Yield to UI occasionally
        if (y % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    
    loader.classList.add('hidden');
    engineStatus.innerText = "Engine: Complete";
};

function extractCellDescriptor(ctx, x, y, w, h) {
    const data = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i+1]; b += data[i+2];
    }
    const count = data.length / 4;
    const lab = ColorUtils.rgbToLab(r/count, g/count, b/count);

    // Quad descriptors for the target cell
    const qW = Math.floor(w/2);
    const qH = Math.floor(h/2);
    
    const quads = [
        avgLuminance(data, 0, 0, qW, qH, w),
        avgLuminance(data, qW, 0, qW, qH, w),
        avgLuminance(data, 0, qH, qW, qH, w),
        avgLuminance(data, qW, qH, qW, qH, w)
    ];

    return [...lab, ...quads];
}

function avgLuminance(data, x, y, w, h, stride) {
    let sum = 0;
    let count = 0;
    for (let i = y; i < y + h; i++) {
        for (let j = x; j < x + w; j++) {
            const idx = (i * stride + j) * 4;
            if (idx + 2 < data.length) {
                sum += (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
                count++;
            }
        }
    }
    return count > 0 ? sum / count : 0;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
