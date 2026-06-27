'use strict';

// ═══════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════
const CART_KEY     = 'bc_cart_v3';
const FIRST_KEY    = 'bc_first_open_v2';
const HISTORY_KEY  = 'bc_history_v1';
const MAX_HISTORY  = 100;
const APP_VERSION  = '1.2.0';   // satu-satunya sumber versi → ubah di sini saja

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let cart        = [];
let camStream   = null;
let tessWorker  = null;
let tessReady   = false;
let currentResult = null;
let currentQty  = 1;
let capturedImg = '';
let cropPriceUrl = '';
let toastTimer  = null;
let qualityTimer = null;
let deferredInstall = null;
let isFirstOpen = false;

// scan state
let sharpHistory   = [];      // riwayat skor ketajaman beberapa frame terakhir
let isLocking      = false;    // cegah double-capture saat OCR berjalan
let ocrJobId       = 0;       // token job OCR aktif — dinaikkan saat batal/mulai untuk buang hasil basi

// Session & budget state
let sessionActive    = false;
let budget           = 0;       // 0 = tidak set
let sessionStartTime = null;
let sessionHistory   = [];      // riwayat sesi
let itemCounter      = 0;       // auto-name "Item N" per sesi

// load
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch {}
try {
  sessionHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
} catch {}
isFirstOpen = !localStorage.getItem(FIRST_KEY);

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
const $   = id => document.getElementById(id);
const fmt = n  => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
const esc = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function persist() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} }

function toast(msg, dur = 2800) {
  clearTimeout(toastTimer);
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════
function goTo(id) {
  ['pg-cart','pg-cam','pg-prev','pg-history'].forEach(p => {
    $(p).classList.toggle('off', p !== id);
  });
}

// ═══════════════════════════════════════════════
// TESSERACT INIT
// ═══════════════════════════════════════════════
const INIT_TIMEOUT = 30000; // 30 detik maksimal unduh OCR

async function initTesseract() {
  $('init-label').textContent = 'Memuat Tesseract.js…';
  $('init-fill').style.width = '10%';

  const timer = setTimeout(() => {
    $('init-label').textContent = 'Unduh OCR lambat — lanjut tanpa OCR';
    $('init-fill').style.width = '100%';
    finishInit(false);
  }, INIT_TIMEOUT);

  try {
    tessWorker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        const map = {
          'loading tesseract core':       ['20%','Memuat core OCR…'],
          'initializing tesseract':       ['45%','Inisialisasi OCR…'],
          'loading language traineddata': ['70%','Memuat data bahasa…'],
          'initializing api':             ['88%','Menyiapkan…'],
        };
        if (map[m.status]) {
          $('init-fill').style.width  = map[m.status][0];
          $('init-label').textContent = map[m.status][1];
        }
      },
      errorHandler: err => {
        console.error('Worker error:', err);
      }
    });
    clearTimeout(timer);
    $('init-fill').style.width  = '100%';
    $('init-label').textContent = 'Siap!';
    finishInit(true);
  } catch(e) {
    clearTimeout(timer);
    console.error(e);
    finishInit(false);
  }
}

function finishInit(ocrReady) {
  tessReady = ocrReady;
  setTimeout(() => {
    $('init-overlay').classList.add('off');
    renderCart();
    goTo('pg-cart');
  }, 300);
}

// ═══════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════
async function startCam() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    $('video').srcObject = camStream;
    await $('video').play();
    $('cap-btn').disabled = false;
    startQualityCheck();
  } catch(e) {
    stopCam(); goTo('pg-cart');
    toast(e.name === 'NotAllowedError' ? '⚠ Izin kamera ditolak' : '⚠ Kamera tidak bisa diakses');
  }
}

function stopCam() {
  stopQualityCheck();
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  $('video').srcObject = null;
}

// quality check + auto-lock (semi-auto capture)
// Mengukur pencahayaan & ketajaman area kotak scan. Saat tajam + stabil
// beberapa frame berturut, otomatis menjepret (jika autoScan aktif).
const SHARP_SIZE = 120;                 // resolusi sampel analisa (lebar)
let _sharpCanvas = null, _sharpCtx = null;

function getSharpCtx() {
  if (!_sharpCanvas) {
    _sharpCanvas = document.createElement('canvas');
    _sharpCanvas.width = SHARP_SIZE; _sharpCanvas.height = Math.round(SHARP_SIZE*0.65);
    _sharpCtx = _sharpCanvas.getContext('2d', { willReadFrequently: true });
  }
  return _sharpCtx;
}

// Variance of Laplacian → makin tinggi = makin tajam/fokus
function measureSharpness(gray, w, h) {
  let mean = 0; const lap = new Float32Array(w*h);
  for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
    const i = y*w+x;
    const v = 4*gray[i] - gray[i-1] - gray[i+1] - gray[i-w] - gray[i+w];
    lap[i] = v; mean += v;
  }
  const n = (w-2)*(h-2); mean /= n;
  let varr = 0;
  for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
    const d = lap[y*w+x]-mean; varr += d*d;
  }
  return varr/n;
}

function startQualityCheck() {
  const video = $('video');
  const ctx = getSharpCtx();
  const w = _sharpCanvas.width, h = _sharpCanvas.height;
  sharpHistory = []; isLocking = false;
  setLockProgress(false);

  qualityTimer = setInterval(() => {
    if (!camStream || isLocking) return;
    try {
      // Petakan kotak scan ke frame video (object-fit:cover) lalu sampel area itu saja
      const r = mapScanBoxToVideo();
      if (!r) return;
      ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
      const d = ctx.getImageData(0,0,w,h).data;
      const gray = new Float32Array(w*h);
      let sum = 0;
      for (let i=0,p=0; i<d.length; i+=4,p++) {
        const g = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        gray[p] = g; sum += g;
      }
      const avg   = sum/(w*h);
      const sharp = measureSharpness(gray, w, h);

      const dot = $('quality-dot'), txt = $('quality-txt');
      // Pencahayaan dulu — kalau gelap/silau, OCR pasti gagal
      if (avg < 40)       { dot.style.background='#f87171'; txt.textContent='Terlalu gelap';  sharpHistory=[]; return; }
      if (avg > 225)      { dot.style.background='#fbbf24'; txt.textContent='Terlalu terang'; sharpHistory=[]; return; }

      // Lacak ketajaman beberapa frame terakhir
      sharpHistory.push(sharp);
      if (sharpHistory.length > 4) sharpHistory.shift();
      const recent = sharpHistory.slice(-3);
      const minRecent = Math.min(...recent);

      const SHARP_OK = 18;   // ambang fokus (variance Laplacian)
      if (sharp < SHARP_OK) {
        dot.style.background='#fbbf24'; txt.textContent='Dekatkan / fokuskan…';
      } else {
        dot.style.background='#4ade80'; txt.textContent='Teks jelas';
        // Auto-lock dihapus — penjepretan kini manual (tombol shutter) + koreksi perspektif.
        // measureSharpness tetap dipakai hanya untuk indikator kualitas di atas.
      }
    } catch {}
  }, 450);
}

function stopQualityCheck() {
  clearInterval(qualityTimer); qualityTimer=null;
  sharpHistory = []; isLocking = false;
  setLockProgress(false);
}

function setLockProgress(on) {
  const btn = $('cap-btn');
  if (btn) btn.classList.toggle('locking', on);
}

// Hitung area kotak scan dalam koordinat piksel video (object-fit:cover)
function mapScanBoxToVideo() {
  const video = $('video');
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const boxRect = $('scan-box').getBoundingClientRect();
  const vidRect = video.getBoundingClientRect();
  const coverScale = Math.max(vidRect.width/vw, vidRect.height/vh);
  const dispW = vw*coverScale, dispH = vh*coverScale;
  const offX = (vidRect.width - dispW)/2, offY = (vidRect.height - dispH)/2;
  let sx = ((boxRect.left - vidRect.left) - offX)/coverScale;
  let sy = ((boxRect.top  - vidRect.top)  - offY)/coverScale;
  let sw = boxRect.width/coverScale, sh = boxRect.height/coverScale;
  // clamp ke dalam frame
  sx = Math.max(0, Math.min(sx, vw-1)); sy = Math.max(0, Math.min(sy, vh-1));
  sw = Math.min(sw, vw-sx); sh = Math.min(sh, vh-sy);
  if (sw<=0 || sh<=0) return null;
  return { sx, sy, sw, sh };
}

// scan button → langsung buka kamera (tidak tanya template lagi)
$('fab').addEventListener('click', () => {
  if (!sessionActive) { openBudgetModal(); return; }
  if (!tessReady) { toast('⚠ OCR belum siap'); return; }
  currentResult=null; currentQty=1; capturedImg=''; cropPriceUrl='';
  goTo('pg-cam');
  startCam();
});

$('fab-manual').addEventListener('click', () => {
  if (!sessionActive) { openBudgetModal(); return; }
  openManualDirect();
});

$('cam-cancel').addEventListener('click', () => { stopCam(); goTo('pg-cart'); });

// ═══════════════════════════════════════════════
// UJI GALERI + DEMO (umpan gambar ke pipeline crop+OCR yang sama)
// ═══════════════════════════════════════════════
$('fab-gallery').addEventListener('click', () => {
  if (!tessReady) { toast('⚠ OCR belum siap'); return; }
  $('gallery-input').value = '';
  $('gallery-input').click();
});
$('gallery-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (file) handleGalleryTest(file);
});
$('fab-demo').addEventListener('click', () => {
  if (!tessReady) { toast('⚠ OCR belum siap'); return; }
  handleDemoTest();
});

async function handleGalleryTest(file) {
  const img = new Image();
  img.onload = () => runGalleryImage(img, img.naturalWidth, img.naturalHeight);
  img.onerror = () => toast('⚠ Gagal memuat gambar');
  img.src = URL.createObjectURL(file);
}

async function handleDemoTest() {
  // Label contoh: harga di zona atas (sesuai template Umum), nama di bawah
  const c = document.createElement('canvas');
  c.width = 600; c.height = 380;
  const g = c.getContext('2d');
  g.fillStyle = '#ffe14d'; g.fillRect(0,0,600,380);
  g.textAlign = 'center';
  g.fillStyle = '#e11d2a'; g.font = 'bold 96px sans-serif';
  g.fillText('Rp 12.500', 300, 130);
  g.fillStyle = '#000'; g.font = 'bold 56px sans-serif';
  g.fillText('MIE INSTAN', 300, 270);
  const img = new Image();
  img.onload = () => runGalleryImage(img, c.width, c.height);
  img.src = c.toDataURL('image/png');
}

// Runner galeri/demo: crop zona harga template → OCR sekali (PSM 6)
async function runGalleryImage(img, vw, vh) {
  if (!vw || !vh) { toast('⚠ Gambar tidak valid'); return; }
  currentResult = null; currentQty = 1; cropPriceUrl = '';
  const myJob = ++ocrJobId;
  const canvas = $('canvas');
  canvas.width = vw; canvas.height = vh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, vw, vh);
  capturedImg = canvas.toDataURL('image/jpeg', 0.92);
  $('prev-img').src = capturedImg;
  goTo('pg-prev');
  renderSheet('loading');

  const pTop = 0.05*vh, pH = 0.38*vh;   // zona harga fixed 5%–43%
  cropPriceUrl = cropCanvas(ctx, vw, vh, 0, pTop, vw, pH, true);

  try {
    await tessWorker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789.,Rp' });
    const ocr = (await tessWorker.recognize(cropPriceUrl, { blocks: true })).data;
    currentResult = { price: extractPrice((ocr.text||'').trim(), ocr.words) };
    if (myJob !== ocrJobId) return;
    renderSheet(currentResult.price != null ? 'result' : 'keypad');   // harga null → keypad manual
  } catch(e) {
    console.error(e);
    if (myJob !== ocrJobId) return;
    renderSheet('keypad');                                            // OCR gagal → keypad manual
  }
}

function openManualDirect() {
  currentResult=null; currentQty=1;
  $('prev-img').src='data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
  goTo('pg-prev');
  renderSheet('keypad');
}

// ═══════════════════════════════════════════════
// CAPTURE + CROP + OCR
// ═══════════════════════════════════════════════
$('cap-btn').addEventListener('click', doCapture);

async function doCapture() {
  if (!camStream) return;              // sudah ditangkap / kamera mati
  if (!tessReady) { toast('⚠ OCR belum siap'); return; }
  const video = $('video'), canvas = $('canvas');
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw||!vh) { toast('⚠ Kamera belum siap'); return; }
  isLocking = true;                    // kunci agar quality-check tak memicu lagi
  $('cap-btn').disabled = true;
  const myJob = ++ocrJobId;            // token job ini — batal akan menaikkan ocrJobId
  currentResult = null;                // bersihkan hasil lama sebelum render keypad/result

  // Tangkap frame + tentukan zona harga (kotak scan) SELAGI kamera masih hidup
  canvas.width=vw; canvas.height=vh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video,0,0,vw,vh);
  const r = mapScanBoxToVideo();
  const bx = r?r.sx:0, by = r?r.sy:0, bw = r?r.sw:vw, bh = r?r.sh:vh;

  capturedImg = canvas.toDataURL('image/jpeg',0.92);
  $('prev-img').src = capturedImg;
  stopCam();
  goTo('pg-prev');
  renderSheet('loading');

  // Crop zona harga fixed (5%–43%) lalu OCR sekali (PSM 6, whitelist angka)
  const pTop = by + 0.05*bh;
  const pH   = 0.38*bh;
  cropPriceUrl = cropCanvas(ctx, vw,vh, bx, pTop, bw, pH, true);

  // Timer 1 dtk: kalau OCR telat, buka keypad manual (OCR tetap lanjut di background)
  let keypadShown = false;
  const kpTimer = setTimeout(() => { if (myJob===ocrJobId){ keypadShown=true; renderSheet('keypad'); } }, 1000);

  try {
    await tessWorker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789.,Rp' });
    const ocr = (await tessWorker.recognize(cropPriceUrl, { blocks: true })).data;
    currentResult = { price: extractPrice((ocr.text||'').trim(), ocr.words) };
    if (myJob !== ocrJobId) return;
    clearTimeout(kpTimer);
    if (keypadShown) fillKeypadPrice(currentResult.price);          // OCR telat → isi field keypad
    else if (currentResult.price != null) renderSheet('result');    // harga kebaca → hasil
    else renderSheet('keypad');                                     // harga null → keypad manual
  } catch(e) {
    clearTimeout(kpTimer);
    console.error(e);
    if (myJob !== ocrJobId) return;
    if (!keypadShown) renderSheet('keypad');                        // OCR gagal → keypad manual
  }
}

// Batalkan OCR yang sedang berjalan → matikan worker, balik ke kamera, siapkan ulang worker
window.cancelOCR = async () => {
  ocrJobId++;                                  // invalidasi job berjalan agar hasilnya tak dirender
  try { await tessWorker?.terminate(); } catch {}
  tessWorker = null; tessReady = false;
  toast('Pemindaian dibatalkan');
  goTo('pg-cam'); startCam();                  // kembali ke kamera
  reinitTesseract();                           // siapkan worker lagi di latar
};

// Re-inisialisasi worker tanpa overlay (dipakai setelah cancelOCR mematikan worker)
async function reinitTesseract() {
  if (tessReady || tessWorker || typeof Tesseract === 'undefined') return;
  try { tessWorker = await Tesseract.createWorker('eng', 1, { errorHandler: err => console.error('Worker error:', err) }); tessReady = true; }
  catch(e) { console.error(e); toast('⚠ Gagal menyiapkan OCR'); }
}

function cropCanvas(srcCtx, vw, vh, x, y, w, h, enhance) {
  x=Math.max(0,Math.round(x)); y=Math.max(0,Math.round(y));
  w=Math.min(Math.round(w),vw-x); h=Math.min(Math.round(h),vh-y);
  if(w<=0||h<=0) return '';

  // Step 1: ambil crop asli
  const raw = document.createElement('canvas');
  raw.width=w; raw.height=h;
  raw.getContext('2d').putImageData(srcCtx.getImageData(x,y,w,h),0,0);

  // Step 2: upscale ringan (1.5×) — cukup untuk OCR harga, jauh lebih cepat
  const SCALE = enhance ? 1.5 : 1;
  const up = document.createElement('canvas');
  up.width = w * SCALE; up.height = h * SCALE;
  const upCtx = up.getContext('2d');
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = 'high';
  upCtx.drawImage(raw, 0, 0, up.width, up.height);

  if (!enhance) return up.toDataURL('image/png');

  // Step 3: grayscale + kontras — NO binarisasi (merusak teks berwarna)
  const pd = upCtx.getImageData(0, 0, up.width, up.height);
  const d  = pd.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    const adj  = Math.max(0, Math.min(255, Math.round(1.5 * (gray - 128) + 128)));
    d[i] = d[i+1] = d[i+2] = adj;
    d[i+3] = 255;
  }
  upCtx.putImageData(pd, 0, 0);
  return up.toDataURL('image/png');
}

// Ambil harga 4-6 digit (Rp 1.000–999.999). Prioritas: font TERBESAR (tinggi bbox word),
// lalu frekuensi. words = array Tesseract {text, bbox{x0,y0,x1,y1}}; kosong/null → frekuensi saja.
function extractPrice(text, words) {
  const norm  = s => (s||'').replace(/\s+/g,'').replace(/(\d)[.,](\d{3})(?=\D|$)/g, '$1$2');
  const valid = r => r.length>=4 && r.length<=6 && +r>=1000 && +r<=999999;
  const pick  = s => { for (const r of (norm(s).match(/\d+/g)||[])) if (valid(r)) return +r; return null; };

  // Kandidat + frekuensi dari token teks
  const freq = new Map();
  for (const tok of (text ? text.match(/\S+/g) || [] : [])) {
    const n = pick(tok);
    if (n!=null) freq.set(n, (freq.get(n)||0)+1);
  }
  if (!freq.size) return null;

  // Tinggi font tiap kandidat dari bounding box words yang cocok
  const hgt = new Map();
  if (Array.isArray(words)) for (const w of words) {
    const n = pick(w.text);
    if (n==null || !freq.has(n) || !w.bbox) continue;
    const h = w.bbox.y1 - w.bbox.y0;
    if (h > (hgt.get(n)||0)) hgt.set(n, h);
  }

  // Pilih: tinggi terbesar → lalu frekuensi (words kosong → tinggi 0 → murni frekuensi)
  let best=null, bestH=-1, bestF=-1;
  for (const [n,f] of freq) {
    const h = hgt.get(n) || 0;
    if (h>bestH || (h===bestH && f>bestF)) { best=n; bestH=h; bestF=f; }
  }
  return best;
}

// ═══════════════════════════════════════════════
// SHEET RENDERER
// ═══════════════════════════════════════════════
function renderSheet(state, errMsg) {
  const sheet = $('sheet');
  if (state==='loading') {
    sheet.innerHTML=`<div class="scan-state"><div class="spinner"></div><p class="scan-txt">Membaca harga…<br><span style="font-size:11px;opacity:.6">Diproses lokal di HP</span></p><button class="btn-r" style="margin-top:16px" onclick="cancelOCR()">✕ Batal</button></div>`;
    return;
  }
  if (state==='error') {
    sheet.innerHTML=`<p class="err-txt">⚠ ${esc(errMsg||'Gagal membaca label')}</p><div class="row"><button class="btn-r" onclick="retryCapture()">↺ Foto Ulang</button><button class="btn-a" onclick="renderSheet('keypad')">✏ Input Manual</button></div>`;
    return;
  }
  if (state==='keypad') {
    const r = currentResult; const hasPrice = r?.price!=null;
    sheet.innerHTML=`<p class="sheet-lbl">KETIK HARGA <span style="float:right;color:var(--sub);cursor:pointer" onclick="retryCapture()">↺ Ulang</span></p>
      <input class="inp" type="text" id="edit-name" value="" placeholder="Nama (auto: Item ${itemCounter+1})"/>
      <div class="emoji-bar">${['🍜','🥤','🧹','🍗','🍞','🍪'].map(e=>`<button onclick="setItemName('${e}')">${e}</button>`).join('')}</div>
      <input class="inp kp-price" type="text" id="edit-price" readonly inputmode="none" value="${hasPrice?r.price:''}" placeholder="Rp 0"/>
      <p class="subtotal" id="sub-disp">Subtotal: <strong>${hasPrice?fmt(r.price*currentQty):'—'}</strong></p>
      <div class="keypad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button onclick="kp('${n}')">${n}</button>`).join('')}
        <button class="kp-del" onclick="kp('del')">⌫</button>
        <button onclick="kp('0')">0</button>
        <button class="kp-ok" onclick="kp('ok')">↵</button>
      </div>`;
    return;
  }
  if (state==='result') {
    const r = currentResult;
    const hasPrice = r?.price!=null;
    sheet.innerHTML=`<p class="sheet-lbl">HASIL SCAN</p>
      <div class="inp-lbl">Nama produk:</div>
      <input class="inp" type="text" id="edit-name" value="" placeholder="Nama produk"/>
      <div class="inp-lbl">Harga — edit jika perlu:</div>
      <input class="inp" type="number" id="edit-price" value="${hasPrice?r.price:''}" placeholder="Harga (Rp)" inputmode="numeric"/>
      <div class="qty-row">
        <button class="qty-big" onclick="adjQty(-1)">−</button>
        <span class="qty-num" id="qty-disp">${currentQty}</span>
        <button class="qty-big" onclick="adjQty(1)">+</button>
      </div>
      <p class="subtotal" id="sub-disp">Subtotal: <strong>${hasPrice?fmt(r.price*currentQty):'—'}</strong></p>
      <div class="row">
        <button class="btn-r" onclick="retryCapture()">↺ Ulang</button>
        <button class="btn-a" onclick="addToCart()">+ Tambah ke Keranjang</button>
      </div>`;
  }
}

// ═══════════════════════════════════════════════
// SHEET ACTIONS
// ═══════════════════════════════════════════════
window.goCart = () => { renderCart(); goTo('pg-cart'); };
window.retryCapture = () => {
  if (!sessionActive) { goTo('pg-cart'); return; }
  currentResult=null; currentQty=1; cropPriceUrl='';
  goTo('pg-cam'); startCam();
};
window.adjQty = d => {
  currentQty = Math.max(1,currentQty+d);
  const dn=$('qty-disp'), ds=$('sub-disp');
  if(dn) dn.textContent=currentQty;
  if(ds){ const p=parseInt(document.getElementById('edit-price')?.value)||currentResult?.price||0; ds.innerHTML=`Subtotal: <strong>${fmt(p*currentQty)}</strong>`; }
};
window.addToCart = () => {
  let name    = document.getElementById('edit-name')?.value.trim();
  const price = parseInt(document.getElementById('edit-price')?.value)||0;
  if(!price) { toast('⚠ Harga tidak valid'); return; }
  if(!name) name = 'Item ' + (++itemCounter);   // auto-name; bisa diedit di dashboard
  // Cek budget sebelum tambah (akan intercept jika over budget)
  checkBudgetAndAdd({ id:Date.now(), name, price, unit:'pcs', qty:currentQty });
};
// Keypad numerik internal (bukan keyboard Android)
window.kp = k => {
  const inp = $('edit-price'); if (!inp) return;
  if (k==='ok')  { addToCart(); return; }
  if (k==='del') inp.value = inp.value.slice(0,-1);
  else if (inp.value.length < 7) inp.value += k;
  const p = parseInt(inp.value)||0, ds=$('sub-disp');
  if (ds) ds.innerHTML = `Subtotal: <strong>${p?fmt(p*currentQty):'—'}</strong>`;
};
// Tap emoji → jadi nama item (ganti auto "Item N")
window.setItemName = n => { const el=$('edit-name'); if(el) el.value = n; };
// OCR telat selesai → isi field harga keypad bila user belum ketik
function fillKeypadPrice(price) {
  const inp = $('edit-price');
  if (inp && !inp.value && price!=null) {
    inp.value = price;
    const ds=$('sub-disp'); if(ds) ds.innerHTML=`Subtotal: <strong>${fmt(price*currentQty)}</strong>`;
    toast('✓ Harga kebaca: ' + fmt(price));
  }
}

// ═══════════════════════════════════════════════
// CART RENDER
// ═══════════════════════════════════════════════
function renderCart() {
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const count=cart.reduce((s,i)=>s+i.qty,0);
  $('badge').textContent=count+' item';
  $('total-amt').textContent=fmt(total);
  $('total-bar').classList.toggle('off',cart.length===0);

  // Update budget bar
  updateBudgetBar(total);

  // Tampilkan tombol selesai hanya saat session aktif & ada item
  const selesaiBtn = $('btn-selesai');
  if (selesaiBtn) selesaiBtn.classList.toggle('off', !(sessionActive && cart.length > 0));
  $('cart-list').innerHTML = !sessionActive
    ? renderSessionStart()
    : cart.length===0
    ?`<div class="empty"><div class="empty-icon">🏪</div><div class="empty-t">Keranjang Masih Kosong</div><div class="empty-d">Tap Scan Produk untuk menambah, atau input manual.</div></div>`
    :cart.map((item,i)=>`
      <div class="ci" style="animation-delay:${i*30}ms">
        <div class="ci-l">
          <div class="ci-name">${esc(item.name)}</div>
          <div class="ci-unit">${fmt(item.price)} / ${esc(item.unit)}</div>
        </div>
        <div class="ci-r">
          <div class="qc">
            <button class="ci-qty-btn" onclick="cqty(${item.id},-1)">−</button>
            <span class="qc-n">${item.qty}</span>
            <button class="ci-qty-btn" onclick="cqty(${item.id},1)">+</button>
          </div>
          <span class="ci-price">${fmt(item.price*item.qty)}</span>
          <button class="del" onclick="delItem(${item.id})">✕</button>
        </div>
      </div>`).join('');
  // Tambah tombol Hapus Semua di bawah item terakhir
  if (cart.length > 0) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'clear-cart-btn';
    clearBtn.textContent = '🗑 Hapus Semua Item';
    clearBtn.onclick = () => {
      if (confirm('Hapus semua item dari keranjang?')) {
        cart = []; renderCart(); persist();
        toast('Keranjang dikosongkan');
      }
    };
    $('cart-list').appendChild(clearBtn);
  }
  persist();
}
window.cqty=(id,d)=>{ const it=cart.find(i=>i.id===id); if(it){it.qty=Math.max(1,it.qty+d);renderCart();} };
window.delItem=id=>{ cart=cart.filter(i=>i.id!==id);renderCart(); };

// ═══════════════════════════════════════════════
// SESSION & BUDGET
// ═══════════════════════════════════════════════
function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(sessionHistory.slice(0, MAX_HISTORY))); } catch {}
}

function closeModal(id) { $(id).classList.add('off'); }

// ── Budget modal ──
function openBudgetModal() {
  $('budget-inp').value = budget > 0 ? budget : '';
  $('modal-budget').classList.remove('off');
  setTimeout(() => $('budget-inp').focus(), 150);
}

$('budget-cancel').addEventListener('click', () => {
  // Lewati budget → mulai session tanpa budget
  $('modal-budget').classList.add('off');
  startSession(0);
});

$('budget-save').addEventListener('click', () => {
  const val = parseInt($('budget-inp').value) || 0;
  $('modal-budget').classList.add('off');
  startSession(val);
});

$('modal-budget').addEventListener('click', e => {
  if (e.target === $('modal-budget')) closeModal('modal-budget');
});

// ── Start session ──
function startSession(budgetVal) {
  sessionActive    = true;
  budget           = budgetVal;
  itemCounter      = 0;
  sessionStartTime = new Date().toISOString();
  toast('✅ Sesi belanja dimulai' + (budgetVal > 0 ? ' · Budget ' + fmt(budgetVal) : ''));
  renderCart();
}

// ── Budget bar update ──
function updateBudgetBar(total) {
  const bar    = $('budget-bar');
  const label  = $('budget-label');
  const amount = $('budget-amount');
  if (!bar) return;

  if (!sessionActive) { bar.classList.add('off'); return; }
  if (budget <= 0)    { bar.classList.add('off'); return; }

  bar.classList.remove('off');
  const sisa = budget - total;
  const pct  = sisa / budget;

  let cls = 'green';
  if (sisa < 0)       cls = 'over';
  else if (pct < 0.2) cls = 'red';
  else if (pct < 0.5) cls = 'yellow';

  bar.className = 'budget-bar ' + cls;
  label.className = 'budget-label ' + cls;
  amount.className = 'budget-amount ' + cls;
  label.textContent = sisa < 0 ? 'MELEBIHI BUDGET' : 'SISA BUDGET';
  amount.textContent = (sisa < 0 ? '-' : '') + fmt(Math.abs(sisa));
}

// ── Budget warning state (untuk intercept addToCart) ──
let pendingCartItem = null;

function checkBudgetAndAdd(item) {
  if (!sessionActive || budget <= 0) { directAddToCart(item); return; }
  const currentTotal = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const newTotal     = currentTotal + item.price * item.qty;
  if (newTotal > budget) {
    const sisa = budget - currentTotal;
    pendingCartItem = item;
    $('budget-warn-sub').innerHTML =
      `Kamu akan melebihi budget sebesar <strong style="color:var(--red)">${fmt(newTotal - budget)}</strong>.<br>
       Sisa budget sekarang: <strong>${fmt(Math.max(0,sisa))}</strong>`;
    $('modal-budget-warn').classList.remove('off');
  } else {
    directAddToCart(item);
  }
}

function directAddToCart(item) {
  cart.push(item);
  renderCart(); persist();
  toast('✓ ' + item.name + ' ditambahkan');
  currentResult = null; currentQty = 1;
  goTo('pg-cart');
}

$('btn-warn-add').addEventListener('click', () => {
  closeModal('modal-budget-warn');
  if (pendingCartItem) { directAddToCart(pendingCartItem); pendingCartItem = null; }
});
$('btn-warn-cancel').addEventListener('click', () => {
  closeModal('modal-budget-warn');
  pendingCartItem = null;
  goTo('pg-prev');
});

// ── Session end ──
function openSessionEnd() {
  if (!sessionActive || cart.length === 0) return;
  const total  = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const count  = cart.reduce((s,i) => s + i.qty, 0);
  const sisa   = budget > 0 ? budget - total : null;
  const now    = new Date();

  $('session-end-date').textContent =
    now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) +
    ' · ' + now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  $('stat-total').textContent  = fmt(total);
  $('stat-items').textContent  = count + ' item';

  if (sisa !== null) {
    const statBudget = $('stat-budget');
    statBudget.textContent  = fmt(Math.abs(sisa));
    statBudget.className    = 'session-stat-val ' + (sisa >= 0 ? 'green' : 'red');
    if (sisa < 0) statBudget.textContent = '-' + fmt(Math.abs(sisa));
  } else {
    $('stat-budget').textContent = 'Tanpa Budget';
    $('stat-budget').className   = 'session-stat-val';
  }

  $('session-end-list').innerHTML = cart.map(it =>
    `<div class="hi-detail-item">
      <span class="hi-detail-name">${esc(it.name)} ×${it.qty}</span>
      <span class="hi-detail-price">${fmt(it.price * it.qty)}</span>
    </div>`).join('');

  $('modal-session-end').classList.remove('off');
}

function confirmEndSession() {
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s,i) => s + i.qty, 0);
  const now   = new Date();

  const entry = {
    id:           'session_' + Date.now(),
    startTime:    sessionStartTime || now.toISOString(),
    endTime:      now.toISOString(),
    templateName: 'Umum',
    budget:       budget,
    total:        total,
    itemCount:    count,
    items:        cart.map(i => ({ name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty }))
  };

  sessionHistory.unshift(entry);
  saveHistory();

  // Reset session
  sessionActive    = false;
  budget           = 0;
  sessionStartTime = null;
  cart             = [];
  persist();
  closeModal('modal-session-end');
  renderCart();
  toast('✅ Sesi disimpan ke riwayat!');
}

// ── History page ──
function openHistory() {
  renderHistory();
  goTo('pg-history');
}

function renderHistory() {
  const list = $('history-list');
  if (sessionHistory.length === 0) {
    list.innerHTML = `<div class="history-empty">
      <div class="history-empty-icon">📭</div>
      <div style="font-weight:700;color:#fff;margin-bottom:8px">Belum Ada Riwayat</div>
      <div style="font-size:13px">Riwayat akan muncul setelah kamu menyelesaikan sesi belanja.</div>
    </div>`;
    return;
  }

  // Group by date
  const groups = {};
  sessionHistory.forEach(s => {
    const d    = new Date(s.endTime);
    const now  = new Date();
    const today    = now.toDateString();
    const yesterday= new Date(now-86400000).toDateString();
    let label;
    if (d.toDateString() === today) label = 'Hari Ini';
    else if (d.toDateString() === yesterday) label = 'Kemarin';
    else label = d.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  });

  list.innerHTML = Object.entries(groups).map(([date, sessions]) => `
    <div class="history-date-group">
      <div class="history-date-label">${date}</div>
      ${sessions.map(s => renderHistoryItem(s)).join('')}
    </div>`).join('');
}

function renderHistoryItem(s) {
  const sisa   = s.budget > 0 ? s.budget - s.total : null;
  const time   = new Date(s.endTime).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  let budgetBadge = '';
  if (sisa === null) budgetBadge = `<span class="hi-budget-badge none">Tanpa Budget</span>`;
  else if (sisa >= 0) budgetBadge = `<span class="hi-budget-badge ok">Hemat ${fmt(sisa)}</span>`;
  else budgetBadge = `<span class="hi-budget-badge over">Lebih ${fmt(Math.abs(sisa))}</span>`;

  return `<div class="history-item" id="hi-${s.id}" onclick="toggleHistoryItem('${s.id}')">
    <div class="hi-top">
      <span class="hi-time">${time}</span>
      <span class="hi-template">${esc(s.templateName)}</span>
    </div>
    <div class="hi-total">${fmt(s.total)}</div>
    <div class="hi-meta">${s.itemCount} item · ${s.budget > 0 ? 'Budget ' + fmt(s.budget) : 'Tanpa Budget'}</div>
    <div class="hi-budget-row">${budgetBadge}</div>
    <div class="hi-detail off" id="hi-detail-${s.id}">
      ${s.items.map(it => `<div class="hi-detail-item">
        <span class="hi-detail-name">${esc(it.name)} ×${it.qty}</span>
        <span class="hi-detail-price">${fmt(it.subtotal)}</span>
      </div>`).join('')}
      <button class="hi-del-btn" onclick="deleteSession('${s.id}',event)">🗑 Hapus Sesi Ini</button>
    </div>
  </div>`;
}

window.toggleHistoryItem = id => {
  const item   = $('hi-' + id);
  const detail = $('hi-detail-' + id);
  if (!item || !detail) return;
  const isExp = !detail.classList.contains('off');
  detail.classList.toggle('off', isExp);
  item.classList.toggle('expanded', !isExp);
};

window.deleteSession = (id, e) => {
  e.stopPropagation();
  if (!confirm('Hapus sesi ini dari riwayat?')) return;
  sessionHistory = sessionHistory.filter(s => s.id !== id);
  saveHistory();
  renderHistory();
  toast('Sesi dihapus');
};

// ── Mulai sesi dari dashboard (tombol di cart kosong saat no session) ──
function renderSessionStart() {
  return `<div class="session-start-wrap">
    <div class="session-start-icon">🛒</div>
    <div class="session-start-title">Siap Belanja?</div>
    <div class="session-start-desc">Mulai sesi untuk mencatat pengeluaran dan memantau budget kamu.</div>
    <button class="btn-start-session" onclick="openBudgetModal()">Mulai Sesi Belanja</button>
  </div>`;
}

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
function openSettings() {
  $('modal-settings').classList.remove('off');
}

window.clearAllHistory = () => {
  if (!confirm('Hapus semua riwayat belanja? Tindakan ini tidak bisa dibatalkan.')) return;
  sessionHistory = [];
  saveHistory();
  toast('Semua riwayat dihapus');
};

window.exportCart = () => {
  if (cart.length === 0) { toast('⚠ Keranjang masih kosong'); return; }
  const now  = new Date();
  const date = now.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
  const time = now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  const total = cart.reduce((s,i) => s + i.price * i.qty, 0);
  const fmt   = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);

  const lines = [
    '=== Keranjang Analog ===',
    `${date}, ${time}`,
    '---',
    ...cart.map(i => `${i.name} x${i.qty} = ${fmt(i.price * i.qty)}`),
    '---',
    `Total: ${fmt(total)}`
  ];
  const text = lines.join('\n');

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => toast('✓ Ringkasan disalin ke clipboard!'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
};

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); toast('✓ Ringkasan disalin!'); }
  catch { toast('⚠ Gagal salin, coba manual'); }
  document.body.removeChild(ta);
}

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
$('sum-btn').addEventListener('click',()=>{
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  $('sum-list').innerHTML=cart.map(it=>`<div class="sum-row"><span class="sum-n">${esc(it.name)} ×${it.qty}</span><span class="sum-p">${fmt(it.price*it.qty)}</span></div>`).join('');
  $('sum-total-val').textContent=fmt(total);
  $('modal-sum').classList.remove('off');
});
$('sum-close').addEventListener('click',()=>$('modal-sum').classList.add('off'));
$('modal-sum').addEventListener('click',e=>{ if(e.target===$('modal-sum'))$('modal-sum').classList.add('off'); });

// ═══════════════════════════════════════════════
// PWA
// ═══════════════════════════════════════════════
function setupPWA() {
  const c=document.createElement('canvas'); c.width=512; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#0d0f14'; if(ctx.roundRect)ctx.roundRect(0,0,512,512,90);else ctx.rect(0,0,512,512); ctx.fill();
  ctx.fillStyle='#00e5a0'; ctx.beginPath(); ctx.arc(256,200,130,0,Math.PI*2); ctx.fill();
  ctx.font='140px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#0d0f14'; ctx.fillText('🛒',256,202);
  ctx.fillStyle='#edf0f7'; ctx.font='bold 44px sans-serif'; ctx.fillText('Keranjang Analog',256,405);
  const iconUrl=c.toDataURL('image/png');
  const al=document.createElement('link'); al.rel='apple-touch-icon'; al.href=iconUrl; document.head.appendChild(al);
  const ml=document.createElement('link'); ml.rel='manifest';
  ml.href=URL.createObjectURL(new Blob([JSON.stringify({name:'Keranjang Analog',short_name:'Keranjang Analog',start_url:'./',display:'standalone',background_color:'#0d0f14',theme_color:'#0d0f14',orientation:'portrait-primary',icons:[{src:iconUrl,sizes:'192x192',type:'image/png'},{src:iconUrl,sizes:'512x512',type:'image/png',purpose:'any maskable'}]})],{type:'application/json'}));
  document.head.appendChild(ml);
  if('serviceWorker' in navigator){
    const CACHE_VER = 'bc-v' + APP_VERSION.slice(1);   // sumber tunggal: APP_VERSION
    (async () => {
      // Version check saat app load: jika versi cache tersimpan ≠ APP_VERSION,
      // hapus SEMUA cache lama sebelum daftarkan SW baru
      try {
        const prev = localStorage.getItem('bc_sw_ver');
        if (prev !== CACHE_VER) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
          localStorage.setItem('bc_sw_ver', CACHE_VER);
        }
      } catch {}
      const swCode = `const V='bc-v${APP_VERSION.slice(1)}';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.url.includes('cdn.jsdelivr.net'))return;
  // NETWORK-FIRST: coba jaringan dulu → update cache; jika offline → fallback ke cache
  e.respondWith(
    fetch(e.request).then(r=>{
      const copy=r.clone();
      caches.open(V).then(cache=>cache.put(e.request,copy));
      return r;
    }).catch(()=>caches.match(e.request))
  );
});`;
      navigator.serviceWorker.register(URL.createObjectURL(new Blob([swCode],{type:'application/javascript'}))).catch(()=>{});
    })();
  }
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('install-banner').classList.add('show');});
  $('ib-install-btn').addEventListener('click',async()=>{ if(!deferredInstall)return; deferredInstall.prompt(); const{outcome}=await deferredInstall.userChoice; if(outcome==='accepted')toast('✓ Berhasil diinstall!'); deferredInstall=null; $('install-banner').classList.remove('show'); });
  $('ib-x').addEventListener('click',()=>$('install-banner').classList.remove('show'));
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
function init() {
  setupPWA();

  // Versi dinamis dari satu sumber (APP_VERSION)
  $('app-version').textContent = 'v.' + APP_VERSION;
  $('app-version-footer').textContent = 'v.' + APP_VERSION + ' · Tanpa template, input langsung';

  $('settings-btn').addEventListener('click', openSettings);
  $('history-btn').addEventListener('click', openHistory);
  $('modal-settings').addEventListener('click', e => {
    if (e.target === $('modal-settings')) $('modal-settings').classList.add('off');
  });

  initTesseract();
}
if (document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded',init);
} else {
  init();
}
