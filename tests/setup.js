'use strict';

// Minimal DOM elements that app.js expects on load
const elementIds = [
  'toast', 'pg-cart', 'pg-cam', 'pg-prev', 'pg-history',
  'init-label', 'init-fill', 'init-overlay',
  'video', 'scan-box', 'cap-btn', 'quality-dot', 'quality-txt',
  'canvas', 'prev-img', 'sheet', 'cart-list', 'badge',
  'total-amt', 'total-bar', 'budget-bar', 'budget-label', 'budget-amount',
  'btn-selesai', 'fab', 'fab-manual', 'fab-gallery', 'fab-demo',
  'cam-cancel', 'gallery-input', 'sum-btn', 'sum-list', 'sum-total-val',
  'sum-close', 'modal-sum', 'modal-budget', 'budget-inp', 'budget-cancel',
  'budget-save', 'modal-budget-warn', 'budget-warn-sub',
  'btn-warn-add', 'btn-warn-cancel',
  'modal-session-end', 'session-end-date', 'stat-total', 'stat-items',
  'stat-budget', 'session-end-list',
  'history-list', 'modal-settings', 'settings-btn', 'history-btn',
  'app-version', 'app-version-footer', 'install-banner', 'ib-install-btn', 'ib-x',
  'edit-name', 'edit-price', 'qty-disp', 'sub-disp',
];

for (const id of elementIds) {
  if (!document.getElementById(id)) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
}

// Stub Tesseract global (not testing OCR engine)
global.Tesseract = {
  createWorker: jest.fn().mockResolvedValue({
    setParameters: jest.fn().mockResolvedValue(undefined),
    recognize: jest.fn().mockResolvedValue({ data: { text: '', words: [] } }),
    terminate: jest.fn().mockResolvedValue(undefined),
  }),
};

// Stub navigator.mediaDevices
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    }),
  },
  writable: true,
});

// Stub Intl.NumberFormat if not available
if (!global.Intl) {
  global.Intl = {};
}

// Stub canvas getContext for jsdom
HTMLCanvasElement.prototype.getContext = function (type) {
  return {
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({
      data: new Uint8ClampedArray(4),
    })),
    putImageData: jest.fn(),
    fillRect: jest.fn(),
    fillText: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    rect: jest.fn(),
    set fillStyle(_) {},
    set font(_) {},
    set textAlign(_) {},
    set textBaseline(_) {},
    set imageSmoothingEnabled(_) {},
    set imageSmoothingQuality(_) {},
  };
};

HTMLCanvasElement.prototype.toDataURL = function () {
  return 'data:image/png;base64,mock';
};

// Stub URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock');

// Stub localStorage
const store = {};
const localStorageMock = {
  getItem: jest.fn(key => store[key] ?? null),
  setItem: jest.fn((key, val) => { store[key] = String(val); }),
  removeItem: jest.fn(key => { delete store[key]; }),
  clear: jest.fn(() => { for (const k in store) delete store[k]; }),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// Stub caches API
global.caches = {
  keys: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue(true),
  open: jest.fn().mockResolvedValue({ put: jest.fn() }),
  match: jest.fn().mockResolvedValue(undefined),
};

// Stub serviceWorker
Object.defineProperty(navigator, 'serviceWorker', {
  value: { register: jest.fn().mockResolvedValue(undefined) },
  writable: true,
});
