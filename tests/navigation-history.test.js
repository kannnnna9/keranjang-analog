'use strict';

let app;

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  jest.clearAllMocks();
  app = require('../app.js');
});

// ═══════════════════════════════════════════════
// goTo — page navigation
// ═══════════════════════════════════════════════
describe('goTo', () => {
  test('shows target page and hides others', () => {
    app.goTo('pg-cam');
    expect(document.getElementById('pg-cam').classList.contains('off')).toBe(false);
    expect(document.getElementById('pg-cart').classList.contains('off')).toBe(true);
    expect(document.getElementById('pg-prev').classList.contains('off')).toBe(true);
    expect(document.getElementById('pg-history').classList.contains('off')).toBe(true);
  });

  test('navigates to cart page', () => {
    app.goTo('pg-cart');
    expect(document.getElementById('pg-cart').classList.contains('off')).toBe(false);
    expect(document.getElementById('pg-cam').classList.contains('off')).toBe(true);
  });

  test('navigates to history page', () => {
    app.goTo('pg-history');
    expect(document.getElementById('pg-history').classList.contains('off')).toBe(false);
    expect(document.getElementById('pg-cart').classList.contains('off')).toBe(true);
  });

  test('navigates to preview page', () => {
    app.goTo('pg-prev');
    expect(document.getElementById('pg-prev').classList.contains('off')).toBe(false);
    expect(document.getElementById('pg-cart').classList.contains('off')).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// closeModal
// ═══════════════════════════════════════════════
describe('closeModal', () => {
  test('adds off class to modal element', () => {
    const modal = document.getElementById('modal-budget');
    modal.classList.remove('off');
    app.closeModal('modal-budget');
    expect(modal.classList.contains('off')).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// toast
// ═══════════════════════════════════════════════
describe('toast', () => {
  test('sets text content', () => {
    app.toast('Hello!');
    const el = document.getElementById('toast');
    expect(el.textContent).toBe('Hello!');
  });

  test('adds show class', () => {
    app.toast('Test');
    const el = document.getElementById('toast');
    expect(el.classList.contains('show')).toBe(true);
  });

  test('removes show class after timeout', () => {
    jest.useFakeTimers();
    app.toast('Disappear', 1000);
    const el = document.getElementById('toast');
    expect(el.classList.contains('show')).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(el.classList.contains('show')).toBe(false);
    jest.useRealTimers();
  });

  test('clears previous toast timer', () => {
    jest.useFakeTimers();
    app.toast('First', 5000);
    app.toast('Second', 1000);
    const el = document.getElementById('toast');
    expect(el.textContent).toBe('Second');
    jest.advanceTimersByTime(1000);
    expect(el.classList.contains('show')).toBe(false);
    jest.useRealTimers();
  });
});

// ═══════════════════════════════════════════════
// renderHistory
// ═══════════════════════════════════════════════
describe('renderHistory', () => {
  test('shows empty state when no history', () => {
    app.sessionHistory = [];
    app.renderHistory();
    const list = document.getElementById('history-list');
    expect(list.innerHTML).toContain('Belum Ada Riwayat');
  });

  test('renders sessions grouped by date', () => {
    const now = new Date();
    app.sessionHistory = [
      {
        id: 'session_1',
        startTime: now.toISOString(),
        endTime: now.toISOString(),
        templateName: 'Umum',
        budget: 50000,
        total: 25000,
        itemCount: 3,
        items: [{ name: 'A', price: 5000, qty: 3, subtotal: 15000 }],
      },
    ];
    app.renderHistory();
    const list = document.getElementById('history-list');
    expect(list.innerHTML).toContain('Hari Ini');
    expect(list.innerHTML).toContain('session_1');
  });

  test('labels yesterday correctly', () => {
    const yesterday = new Date(Date.now() - 86400000);
    app.sessionHistory = [
      {
        id: 'session_y',
        startTime: yesterday.toISOString(),
        endTime: yesterday.toISOString(),
        templateName: 'Umum',
        budget: 0,
        total: 10000,
        itemCount: 1,
        items: [{ name: 'B', price: 10000, qty: 1, subtotal: 10000 }],
      },
    ];
    app.renderHistory();
    const list = document.getElementById('history-list');
    expect(list.innerHTML).toContain('Kemarin');
  });
});

// ═══════════════════════════════════════════════
// renderHistoryItem
// ═══════════════════════════════════════════════
describe('renderHistoryItem', () => {
  test('renders item with budget savings', () => {
    const html = app.renderHistoryItem({
      id: 's1',
      endTime: new Date().toISOString(),
      templateName: 'Umum',
      budget: 50000,
      total: 30000,
      itemCount: 3,
      items: [{ name: 'X', price: 10000, qty: 3, subtotal: 30000 }],
    });
    expect(html).toContain('Hemat');
    expect(html).toContain('Umum');
  });

  test('renders over-budget badge', () => {
    const html = app.renderHistoryItem({
      id: 's2',
      endTime: new Date().toISOString(),
      templateName: 'Umum',
      budget: 20000,
      total: 30000,
      itemCount: 2,
      items: [{ name: 'Y', price: 15000, qty: 2, subtotal: 30000 }],
    });
    expect(html).toContain('Lebih');
  });

  test('renders without budget badge', () => {
    const html = app.renderHistoryItem({
      id: 's3',
      endTime: new Date().toISOString(),
      templateName: 'Umum',
      budget: 0,
      total: 10000,
      itemCount: 1,
      items: [{ name: 'Z', price: 10000, qty: 1, subtotal: 10000 }],
    });
    expect(html).toContain('Tanpa Budget');
  });
});

// ═══════════════════════════════════════════════
// renderSessionStart
// ═══════════════════════════════════════════════
describe('renderSessionStart', () => {
  test('returns session start HTML', () => {
    const html = app.renderSessionStart();
    expect(html).toContain('Siap Belanja');
    expect(html).toContain('Mulai Sesi Belanja');
  });
});

// ═══════════════════════════════════════════════
// fillKeypadPrice
// ═══════════════════════════════════════════════
describe('fillKeypadPrice', () => {
  test('fills empty price input', () => {
    const inp = document.getElementById('edit-price');
    inp.value = '';
    app.fillKeypadPrice(12500);
    expect(String(inp.value)).toBe('12500');
  });

  test('does not overwrite existing value', () => {
    const inp = document.getElementById('edit-price');
    inp.value = '8000';
    app.fillKeypadPrice(12500);
    expect(inp.value).toBe('8000');
  });

  test('does nothing when price is null', () => {
    const inp = document.getElementById('edit-price');
    inp.value = '';
    app.fillKeypadPrice(null);
    expect(inp.value).toBe('');
  });
});

// ═══════════════════════════════════════════════
// openSessionEnd
// ═══════════════════════════════════════════════
describe('openSessionEnd', () => {
  test('does nothing when session not active', () => {
    app.sessionActive = false;
    app.cart = [{ id: 1, name: 'A', price: 5000, qty: 1 }];
    const modal = document.getElementById('modal-session-end');
    modal.classList.add('off');
    app.openSessionEnd();
    // Modal should remain hidden (off)
    expect(modal.classList.contains('off')).toBe(true);
  });

  test('does nothing when cart is empty', () => {
    app.sessionActive = true;
    app.cart = [];
    app.openSessionEnd();
    // No error thrown
  });

  test('populates summary when active with items', () => {
    app.sessionActive = true;
    app.budget = 50000;
    app.cart = [
      { id: 1, name: 'Mie', price: 5000, qty: 2 },
      { id: 2, name: 'Air', price: 3000, qty: 1 },
    ];
    app.openSessionEnd();
    const total = document.getElementById('stat-total');
    expect(total.textContent).toContain('13.000');
  });
});
