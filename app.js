import { ColorUtils } from './engine.js';

let tiles = [];
let targetImg = null;
let globallyUsed = new Set();
let currentSessionId = 0;
let debounceTimer = null;
let activeGridData = null;
const seenHashes = new Set();

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
const targetSlot = document.getElementById('targetSlot');
const tileSlot = document.getElementById('tileSlot');
const targetName = document.getElementById('targetName');
const previewPane = document.getElementById('previewPane');

// Setup Interactions
targetSlot.onclick = () => targetInput.click();
tileSlot.onclick = () => tileInput.click();

targetInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    targetImg = await loadImage(URL.createObjectURL(file));
    targetName.innerText = file.name;
    autoTrigger();
};

tileInput.onchange = async (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
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

gridRes.oninput = () => {
    const ratio = targetImg ? (targetImg.height/targetImg.width) : 1;
    gridLabel.innerText = `${gridRes.value}x${Math.round(gridRes.value * ratio)}`;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoTrigger, 200);
};

async function autoTrigger() {
    if (!targetImg || tiles.length === 0) return;
    const sessionId = ++currentSessionId;
    globallyUsed.clear(); 
    loader.style.display = "flex";
    
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
    
    for (let y = 0; y < rows; y++) {
        if (sessionId !== currentSessionId) return;
        const rowIndices = [];
        
        for (let x = 0; x < cols; x++) {
            const idx = (y * cols + x) * 4;
            const targetLab = ColorUtils.rgbToLab(targetData[idx], targetData[idx+1], targetData[idx+2]);
            
            // Simple Linear Search for now (KDTree could be added if needed)
            let bestIdx = 0;
            let bestDist = Infinity;
            
            // Optimization: Only check a subset or use full search
            for (let i = 0; i < tiles.length; i++) {
                const dist = getDist(targetLab, tiles[i].descriptor);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }
            
            rowIndices.push(bestIdx);
            ctx.drawImage(tiles[bestIdx].img, x * cellW, y * cellH, cellW, cellH);
        }
        
        sessionGrid.push(rowIndices);
        if (y % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    
    if (sessionId === currentSessionId) {
        loader.style.display = "none";
        activeGridData = { grid: sessionGrid, cols, rows, ratio };
        document.getElementById('dl4K').disabled = false;
        document.getElementById('dl8K').disabled = false;
        fitCanvas(); // Auto-fit the new mosaic
    }
}

function getDist(a, b) {
    let sum = 0;
    for (let i = 0; i < 3; i++) { sum += Math.pow((a[i] - b[i]), 2); }
    return Math.sqrt(sum);
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

// Orientation & Resize
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
    const dlLoader = document.getElementById('downloadLoader');
    const dlStatus = document.getElementById('dlStatus');
    dlLoader.style.display = "flex";
    
    try {
        const { grid, cols, rows, ratio } = activeGridData;
        const mCanvas = document.createElement('canvas');
        mCanvas.width = targetWidth; mCanvas.height = Math.round(targetWidth * ratio);
        const mCtx = mCanvas.getContext('2d');
        mCtx.imageSmoothingEnabled = false;
        
        dlStatus.innerText = "RENDERING PIXELS...";
        const cellW = mCanvas.width / cols; const cellH = mCanvas.height / rows;
        
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const tileIdx = grid[y][x];
                mCtx.drawImage(tiles[tileIdx].img, x * cellW, y * cellH, cellW, cellH);
            }
            if (y % 10 === 0) {
                dlStatus.innerText = `ASSEMBLING: ${Math.round((y/rows)*100)}%`;
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        dlStatus.innerText = "GENERATING BLOB...";
        mCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `Lumina_${targetWidth >= 8000 ? '8K_Master' : '4K_Master'}.png`;
            link.href = url;
            link.click();
            
            setTimeout(() => {
                URL.revokeObjectURL(url);
                dlLoader.style.display = "none";
            }, 1000);
        }, 'image/png');
        
    } catch (err) {
        alert("Memory limit exceeded for 8K Master. Try 4K instead.");
        dlLoader.style.display = "none";
    }
}

document.getElementById('dl4K').onclick = () => exportMaster(4000);
document.getElementById('dl8K').onclick = () => exportMaster(8000);

function loadImage(src) { 
    return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; }); 
}
