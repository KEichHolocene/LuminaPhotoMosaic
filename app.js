import { ColorUtils } from './engine.js';

let tiles = [];
let targetImg = null;
let currentSessionId = 0;
let debounceTimer = null;
let activeGridData = null;
const seenHashes = new Set();
const candidateLimit = 28;

const gridRes = document.getElementById('gridRes');
const gridLabel = document.getElementById('gridLabel');
const outputCanvas = document.getElementById('outputCanvas');
const ctx = outputCanvas.getContext('2d');
const loader = document.getElementById('novaLoader');
const vaultStatus = document.getElementById('vaultStatus');
const tileCount = document.getElementById('tileCount');
const libraryVault = document.getElementById('libraryVault');
const targetInput = document.getElementById('targetInput');
const tileInput = document.getElementById('tileInput');
const tileInputMobile = document.getElementById('tileInputMobile');
const targetSlot = document.getElementById('targetSlot');
const tileSlot = document.getElementById('tileSlot');
const photoImportBtn = document.getElementById('photoImportBtn');
const folderImportBtn = document.getElementById('folderImportBtn');
const targetName = document.getElementById('targetName');
const previewPane = document.getElementById('previewPane');
const dl4K = document.getElementById('dl4K');
const dl8K = document.getElementById('dl8K');
const downloadLoader = document.getElementById('downloadLoader');
const dlStatus = document.getElementById('dlStatus');

// Setup Interactions
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isMobile) {
    dl8K.style.display = 'none';
}

function setBusy(isBusy) {
    document.body.classList.toggle('is-busy', isBusy);
}

targetSlot.onclick = () => targetInput.click();
tileSlot.onclick = () => tileInputMobile.click();
photoImportBtn.onclick = (e) => {
    e.stopPropagation();
    tileInputMobile.click();
};
folderImportBtn.onclick = (e) => {
    e.stopPropagation();
    openFolderImport();
};
tileInputMobile.multiple = true;
tileInputMobile.setAttribute('multiple', 'multiple');
folderImportBtn.hidden = isIOS || (!('showDirectoryPicker' in window) && !('webkitdirectory' in tileInput));

targetInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    targetImg = await loadImage(URL.createObjectURL(file));
    targetName.innerText = file.name;
    autoTrigger();
};

tileInputMobile.onchange = (e) => handleTileFiles(Array.from(e.target.files));
tileInput.onchange = (e) => handleTileFiles(Array.from(e.target.files));

async function openFolderImport() {
    if ('showDirectoryPicker' in window) {
        try {
            const handle = await window.showDirectoryPicker();
            const files = await collectImageFiles(handle);
            await handleTileFiles(files);
            return;
        } catch (err) {
            if (err?.name === 'AbortError') return;
        }
    }
    tileInput.click();
}

async function collectImageFiles(directoryHandle) {
    const files = [];
    for await (const handle of directoryHandle.values()) {
        if (handle.kind === 'file') {
            const file = await handle.getFile();
            if (isImageFile(file)) files.push(file);
        } else if (handle.kind === 'directory') {
            files.push(...await collectImageFiles(handle));
        }
    }
    return files;
}

async function handleTileFiles(inputFiles) {
    const files = inputFiles.filter(isImageFile);
    if (files.length === 0) return;
    loader.style.display = "flex";
    
    const dCanvas = document.createElement('canvas'); dCanvas.width = 10; dCanvas.height = 10;
    const dCtx = dCanvas.getContext('2d');
    const getDHash = (data) => { let h = ""; for(let i=0;i<64;i++) h+=(data[i*4]>data[(i+1)*4])?"1":"0"; return h; };

    for (let i = 0; i < files.length; i++) {
        try {
            const raw = await createImageBitmap(files[i]);
            const min = Math.min(raw.width, raw.height);
            const bitmap = await createImageBitmap(raw, (raw.width-min)/2, (raw.height-min)/2, min, min, { resizeWidth: 64, resizeHeight: 64 });
            raw.close();
            
            dCtx.drawImage(bitmap, 0, 0, 10, 10);
            const data = dCtx.getImageData(0,0,10,10).data;
            const hash = getDHash(data);
            
            if (!seenHashes.has(hash)) {
                seenHashes.add(hash);
                const tc = document.createElement('canvas'); tc.width = 64; tc.height = 64;
                tc.getContext('2d').drawImage(bitmap, 0, 0);
                tiles.push({ 
                    img: tc, 
                    descriptor: [...ColorUtils.rgbToLab(...ColorUtils.avgColor(data)), 0,0,0,0], 
                    index: tiles.length 
                });
                
                if (tiles.length <= 100) {
                    const vItem = document.createElement('img');
                    vItem.src = tc.toDataURL();
                    vItem.className = "vault-item";
                    libraryVault.appendChild(vItem);
                }
            }
            bitmap.close();
        } catch(err) {}
        
        if (i % 20 === 0) {
            vaultStatus.innerText = `Indexing: ${Math.round((i/files.length)*100)}%`;
            await new Promise(r => setTimeout(r, 0));
        }
    }
    
    vaultStatus.innerText = "+ Expand Archive";
    tileCount.innerText = `${tiles.length} Units Pooled`;
    loader.style.display = "none";
    autoTrigger();
};

function isImageFile(file) {
    return file.type.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(file.name);
}

gridRes.oninput = () => {
    const ratio = targetImg ? (targetImg.height/targetImg.width) : 1;
    gridLabel.innerText = `${gridRes.value}x${Math.round(gridRes.value * ratio)}`;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoTrigger, 200);
};

async function autoTrigger() {
    if (!targetImg || tiles.length === 0) return;
    const sessionId = ++currentSessionId;
    loader.style.display = "flex";
    setBusy(true);
    
    const cols = parseInt(gridRes.value);
    const ratio = targetImg.height / targetImg.width;
    const rows = Math.round(cols * ratio);
    
    outputCanvas.width = 1500;
    outputCanvas.height = Math.round(1500 * ratio);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,outputCanvas.width,outputCanvas.height);
    
    const cellW = outputCanvas.width / cols;
    const cellH = outputCanvas.height / rows;
    
    // Sample Canvas
    const sCanvas = document.createElement('canvas'); 
    sCanvas.width = cols; 
    sCanvas.height = rows;
    const sCtx = sCanvas.getContext('2d'); 
    sCtx.drawImage(targetImg, 0, 0, cols, rows);
    const targetData = sCtx.getImageData(0,0,cols,rows).data;
    
    const sessionGrid = [];
    const sessionColors = [];
    const sessionContrasts = [];
    const usageCounts = new Array(tiles.length).fill(0);
    let previousRow = null;
    
    for (let y = 0; y < rows; y++) {
        if (sessionId !== currentSessionId) return;
        const rowIndices = [];
        const rowColors = [];
        const rowContrasts = [];
        
        for (let x = 0; x < cols; x++) {
            const idx = (y * cols + x) * 4;
            const targetRgb = [targetData[idx], targetData[idx+1], targetData[idx+2]];
            const targetLab = ColorUtils.rgbToLab(targetData[idx], targetData[idx+1], targetData[idx+2]);
            const contrast = getLocalContrast(targetData, x, y, cols, rows);
            const candidates = findCandidates(targetLab, contrast);
            const tileIdx = chooseTile(candidates, targetLab, contrast, x, y, rowIndices, previousRow, usageCounts);

            usageCounts[tileIdx]++;
            rowIndices.push(tileIdx);
            rowColors.push(targetRgb);
            rowContrasts.push(contrast);
            ctx.drawImage(tiles[tileIdx].img, x * cellW, y * cellH, cellW, cellH);
            applyCellGlaze(ctx, x * cellW, y * cellH, cellW, cellH, targetRgb, contrast);
        }
        
        sessionGrid.push(rowIndices);
        sessionColors.push(rowColors);
        sessionContrasts.push(rowContrasts);
        previousRow = rowIndices;
        if (y % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    
    if (sessionId === currentSessionId) {
        loader.style.display = "none";
        setBusy(false);
        activeGridData = { grid: sessionGrid, colors: sessionColors, contrasts: sessionContrasts, cols, rows, ratio };
        dl4K.disabled = false;
        dl8K.disabled = false;
        fitCanvas(); // Auto-fit the new mosaic
    }
}

function getDist(a, b) {
    let sum = 0;
    for (let i = 0; i < 3; i++) { sum += Math.pow((a[i] - b[i]), 2); }
    return Math.sqrt(sum);
}

function findCandidates(targetLab, contrast) {
    const candidates = [];
    for (let i = 0; i < tiles.length; i++) {
        const descriptor = tiles[i].descriptor;
        const score = getDist(targetLab, descriptor) + getTonePenalty(targetLab, descriptor, contrast);
        insertCandidate(candidates, { index: i, score }, candidateLimit);
    }
    return candidates;
}

function insertCandidate(candidates, candidate, limit) {
    let pos = candidates.length;
    while (pos > 0 && candidates[pos - 1].score > candidate.score) pos--;
    if (pos >= limit) return;
    candidates.splice(pos, 0, candidate);
    if (candidates.length > limit) candidates.pop();
}

function chooseTile(candidates, targetLab, contrast, x, y, rowIndices, previousRow, usageCounts) {
    const flatness = Math.max(0, 1 - contrast / 22);
    const poolSize = Math.max(4, Math.round(6 + flatness * 18));
    const maxUsage = Math.max(1, Math.ceil((x + y + 1) / Math.max(1, tiles.length)));
    let best = candidates[0].index;
    let bestScore = Infinity;

    for (let i = 0; i < Math.min(poolSize, candidates.length); i++) {
        const candidate = candidates[i];
        const index = candidate.index;
        const left = rowIndices[rowIndices.length - 1] === index;
        const above = previousRow && previousRow[x] === index;
        const diagonal = previousRow && (previousRow[x - 1] === index || previousRow[x + 1] === index);
        const usage = usageCounts[index] || 0;
        const repeatPenalty = Math.max(0, usage - maxUsage) * (10 + flatness * 18);
        const adjacencyPenalty = (left ? 28 : 0) + (above ? 22 : 0) + (diagonal ? 8 : 0);
        const organicJitter = seededNoise(x, y, index) * flatness * 16;
        const detailPenalty = i * (1 - flatness) * 3;
        const score = candidate.score + repeatPenalty + adjacencyPenalty + organicJitter + detailPenalty;

        if (score < bestScore) {
            bestScore = score;
            best = index;
        }
    }

    return best;
}

function getTonePenalty(targetLab, tileLab, contrast) {
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

function getLocalContrast(data, x, y, cols, rows) {
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

function getRgbAt(data, x, y, cols, rows) {
    const cx = Math.min(cols - 1, Math.max(0, x));
    const cy = Math.min(rows - 1, Math.max(0, y));
    const idx = (cy * cols + cx) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
}

function applyCellGlaze(renderCtx, x, y, width, height, rgb, contrast) {
    const flatness = Math.max(0, 1 - contrast / 24);
    const luminance = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
    let alpha = 0.1 + flatness * 0.12;

    if (luminance > 170 && luminance < 245) alpha += 0.04;
    if (luminance > 245) alpha -= 0.04;
    alpha = Math.min(0.26, Math.max(0.08, alpha));

    renderCtx.save();
    renderCtx.globalAlpha = alpha;
    renderCtx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    renderCtx.fillRect(x, y, width, height);
    renderCtx.restore();
}

function seededNoise(x, y, salt) {
    const n = Math.sin((x * 127.1) + (y * 311.7) + (salt * 74.7)) * 43758.5453;
    return n - Math.floor(n);
}

// Interaction & Zoom State
let zoom = 1;
let lastDist = 0;
let isPanning = false;
let startX, startY, originX = 0, originY = 0;

function updateTransform() {
    outputCanvas.style.transform = `translate(${originX}px, ${originY}px) scale(${zoom})`;
}

// Pinch Zoom Logic
previewPane.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('is-busy')) return;
    if (e.touches.length === 2) {
        lastDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
    } else if (e.touches.length === 1) {
        isPanning = true;
        startX = e.touches[0].pageX - originX;
        startY = e.touches[0].pageY - originY;
    }
});

previewPane.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (document.body.classList.contains('is-busy')) return;
    if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
        const delta = dist / lastDist;
        zoom = Math.min(Math.max(0.1, zoom * delta), 10);
        lastDist = dist;
        updateTransform();
    } else if (e.touches.length === 1 && isPanning) {
        originX = e.touches[0].pageX - startX;
        originY = e.touches[0].pageY - startY;
        updateTransform();
    }
}, { passive: false });

previewPane.addEventListener('touchend', () => { isPanning = false; });

function fitCanvas() {
    if (!activeGridData) return;
    const pane = previewPane.getBoundingClientRect();
    const ratio = activeGridData.ratio;
    
    // Fit to viewport
    if (pane.width / pane.height > 1 / ratio) {
        zoom = (pane.height * 0.9) / (1500 * ratio);
    } else {
        zoom = (pane.width * 0.9) / 1500;
    }
    originX = 0; originY = 0;
    updateTransform();
}

window.addEventListener('resize', fitCanvas);

// Async Export with Feedback
async function exportMaster(targetWidth) {
    if (!activeGridData) return;
    downloadLoader.style.display = "flex";
    setBusy(true);
    
    try {
        const { grid, colors, contrasts, cols, rows, ratio } = activeGridData;
        const mCanvas = document.createElement('canvas');
        mCanvas.width = targetWidth; mCanvas.height = Math.round(targetWidth * ratio);
        const mCtx = mCanvas.getContext('2d');
        mCtx.imageSmoothingEnabled = false;
        
        dlStatus.innerText = "RENDERING PIXELS...";
        const cellW = mCanvas.width / cols; const cellH = mCanvas.height / rows;

        const yieldEvery = targetWidth >= 8000 ? 10 : 16;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const tileIdx = grid[y][x];
                mCtx.drawImage(tiles[tileIdx].img, x * cellW, y * cellH, cellW, cellH);
                applyCellGlaze(mCtx, x * cellW, y * cellH, cellW, cellH, colors[y][x], contrasts[y][x]);
            }
            if (y % yieldEvery === 0) {
                dlStatus.innerText = `ASSEMBLING: ${Math.round((y/rows)*100)}%`;
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        dlStatus.innerText = "ENCODING PNG...";
        const blob = await canvasToBlob(mCanvas, 'image/png');
        if (!blob) {
            alert("Mastering failed. Try a lower resolution.");
            return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `Lumina_${targetWidth >= 8000 ? '8K_Master' : '4K_Master'}.png`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
    } catch (err) {
        alert(targetWidth >= 8000 ? "Memory limit exceeded for 8K Master. Try 4K instead." : "Export failed. Try a lower grid density.");
    } finally {
        downloadLoader.style.display = "none";
        setBusy(false);
    }
}

function canvasToBlob(canvas, type) {
    return new Promise(resolve => canvas.toBlob(resolve, type));
}

dl4K.onclick = () => exportMaster(4000);
dl8K.onclick = () => exportMaster(8000);

function loadImage(src) { 
    return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; }); 
}
