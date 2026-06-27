'use strict';

let app;

beforeEach(() => {
  // Reset module cache so each test gets fresh state
  jest.resetModules();
  // Clear localStorage mock
  localStorage.clear();
  jest.clearAllMocks();
  app = require('../app.js');
});

// ═══════════════════════════════════════════════
// persist — localStorage saving
// ═══════════════════════════════════════════════
describe('persist', () => {
  test('saves cart to localStorage', () => {
    app.cart = [{ id: 1, name: 'Test', price: 5000, qty: 1 }];
    app.persist();
    expect(localStorage.setItem).toHaveBeenCalledWith(
      app.CART_KEY,
      JSON.stringify([{ id: 1, name: 'Test', price: 5000, qty: 1 }])
    );
  });

  test('saves empty cart', () => {
    app.cart = [];
    app.persist();
    expect(localStorage.setItem).toHaveBeenCalledWith(app.CART_KEY, '[]');
  });
});

// ═══════════════════════════════════════════════
// startSession
// ═══════════════════════════════════════════════
describe('startSession', () => {
  test('activates session with budget', () => {
    app.startSession(50000);
    expect(app.sessionActive).toBe(true);
    expect(app.budget).toBe(50000);
    expect(app.itemCounter).toBe(0);
    expect(app.sessionStartTime).toBeTruthy();
  });

  test('activates session without budget', () => {
    app.startSession(0);
    expect(app.sessionActive).toBe(true);
    expect(app.budget).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// directAddToCart
// ═══════════════════════════════════════════════
describe('directAddToCart', () => {
  test('adds item to cart', () => {
    app.sessionActive = true;
    const item = { id: 1, name: 'Mie', price: 5000, unit: 'pcs', qty: 2 };
    app.directAddToCart(item);
    expect(app.cart).toContainEqual(item);
  });

  test('resets currentResult and currentQty after adding', () => {
    app.sessionActive = true;
    app.currentResult = { price: 5000 };
    app.currentQty = 3;
    app.directAddToCart({ id: 1, name: 'Test', price: 5000, unit: 'pcs', qty: 1 });
    expect(app.currentResult).toBeNull();
    expect(app.currentQty).toBe(1);
  });

  test('adds multiple items', () => {
    app.sessionActive = true;
    app.directAddToCart({ id: 1, name: 'A', price: 3000, unit: 'pcs', qty: 1 });
    app.directAddToCart({ id: 2, name: 'B', price: 7000, unit: 'pcs', qty: 2 });
    expect(app.cart).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════
// checkBudgetAndAdd
// ═══════════════════════════════════════════════
describe('checkBudgetAndAdd', () => {
  test('adds directly when no budget set', () => {
    app.sessionActive = true;
    app.budget = 0;
    const item = { id: 1, name: 'X', price: 5000, unit: 'pcs', qty: 1 };
    app.checkBudgetAndAdd(item);
    expect(app.cart).toContainEqual(item);
  });

  test('adds directly when within budget', () => {
    app.sessionActive = true;
    app.budget = 50000;
    app.cart = [];
    const item = { id: 1, name: 'X', price: 5000, unit: 'pcs', qty: 1 };
    app.checkBudgetAndAdd(item);
    expect(app.cart).toContainEqual(item);
  });

  test('shows warning when exceeding budget', () => {
    app.sessionActive = true;
    app.budget = 10000;
    app.cart = [{ id: 1, name: 'A', price: 8000, unit: 'pcs', qty: 1 }];
    const item = { id: 2, name: 'B', price: 5000, unit: 'pcs', qty: 1 };
    app.checkBudgetAndAdd(item);
    // Item should NOT be in cart yet (pending confirmation)
    expect(app.cart).toHaveLength(1);
    expect(app.pendingCartItem).toEqual(item);
  });

  test('adds directly when session not active', () => {
    app.sessionActive = false;
    app.budget = 10000;
    const item = { id: 1, name: 'X', price: 50000, unit: 'pcs', qty: 1 };
    app.checkBudgetAndAdd(item);
    expect(app.cart).toContainEqual(item);
  });

  test('exact budget amount adds without warning', () => {
    app.sessionActive = true;
    app.budget = 10000;
    app.cart = [];
    const item = { id: 1, name: 'X', price: 10000, unit: 'pcs', qty: 1 };
    app.checkBudgetAndAdd(item);
    expect(app.cart).toContainEqual(item);
  });
});

// ═══════════════════════════════════════════════
// confirmEndSession
// ═══════════════════════════════════════════════
describe('confirmEndSession', () => {
  test('saves session to history and resets state', () => {
    app.sessionActive = true;
    app.budget = 50000;
    app.sessionStartTime = new Date().toISOString();
    app.cart = [
      { id: 1, name: 'Mie', price: 5000, qty: 2 },
      { id: 2, name: 'Air', price: 3000, qty: 1 },
    ];
    app.confirmEndSession();

    expect(app.sessionActive).toBe(false);
    expect(app.budget).toBe(0);
    expect(app.cart).toHaveLength(0);
    expect(app.sessionHistory).toHaveLength(1);

    const entry = app.sessionHistory[0];
    expect(entry.total).toBe(13000);
    expect(entry.itemCount).toBe(3);
    expect(entry.budget).toBe(50000);
    expect(entry.items).toHaveLength(2);
  });

  test('calculates correct totals with multiple items', () => {
    app.sessionActive = true;
    app.budget = 0;
    app.sessionStartTime = new Date().toISOString();
    app.cart = [
      { id: 1, name: 'A', price: 10000, qty: 3 },
      { id: 2, name: 'B', price: 5000, qty: 2 },
      { id: 3, name: 'C', price: 2000, qty: 5 },
    ];
    app.confirmEndSession();

    const entry = app.sessionHistory[0];
    expect(entry.total).toBe(50000);
    expect(entry.itemCount).toBe(10);
  });

  test('saves to localStorage', () => {
    app.sessionActive = true;
    app.budget = 0;
    app.sessionStartTime = new Date().toISOString();
    app.cart = [{ id: 1, name: 'X', price: 1000, qty: 1 }];
    app.confirmEndSession();

    expect(localStorage.setItem).toHaveBeenCalledWith(
      app.HISTORY_KEY,
      expect.any(String)
    );
  });
});

// ═══════════════════════════════════════════════
// saveHistory
// ═══════════════════════════════════════════════
describe('saveHistory', () => {
  test('saves to localStorage with HISTORY_KEY', () => {
    app.sessionHistory = [{ id: 'session_1', total: 5000 }];
    app.saveHistory();
    expect(localStorage.setItem).toHaveBeenCalledWith(
      app.HISTORY_KEY,
      expect.stringContaining('session_1')
    );
  });

  test('truncates history to MAX_HISTORY', () => {
    app.sessionHistory = Array.from({ length: 150 }, (_, i) => ({ id: `s_${i}` }));
    app.saveHistory();
    // Find the call that saved to HISTORY_KEY
    const call = localStorage.setItem.mock.calls.find(c => c[0] === app.HISTORY_KEY);
    expect(call).toBeTruthy();
    const saved = JSON.parse(call[1]);
    expect(saved).toHaveLength(app.MAX_HISTORY);
  });
});

// ═══════════════════════════════════════════════
// updateBudgetBar
// ═══════════════════════════════════════════════
describe('updateBudgetBar', () => {
  test('hides bar when session not active', () => {
    app.sessionActive = false;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(0);
    expect(bar.classList.contains('off')).toBe(true);
  });

  test('hides bar when budget is 0', () => {
    app.sessionActive = true;
    app.budget = 0;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(0);
    expect(bar.classList.contains('off')).toBe(true);
  });

  test('shows green for plenty of budget remaining', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(10000); // 90% remaining
    expect(bar.className).toContain('green');
  });

  test('shows yellow when under 50% remaining', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(60000); // 40% remaining
    expect(bar.className).toContain('yellow');
  });

  test('shows red when under 20% remaining', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(85000); // 15% remaining
    expect(bar.className).toContain('red');
  });

  test('shows over when exceeding budget', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const bar = document.getElementById('budget-bar');
    app.updateBudgetBar(120000);
    expect(bar.className).toContain('over');
  });

  test('displays correct remaining amount', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const label = document.getElementById('budget-label');
    app.updateBudgetBar(30000);
    expect(label.textContent).toBe('SISA BUDGET');
  });

  test('displays over-budget label', () => {
    app.sessionActive = true;
    app.budget = 100000;
    const label = document.getElementById('budget-label');
    app.updateBudgetBar(150000);
    expect(label.textContent).toBe('MELEBIHI BUDGET');
  });
});

// ═══════════════════════════════════════════════
// renderCart
// ═══════════════════════════════════════════════
describe('renderCart', () => {
  test('shows badge count', () => {
    app.sessionActive = true;
    app.cart = [
      { id: 1, name: 'A', price: 5000, unit: 'pcs', qty: 2 },
      { id: 2, name: 'B', price: 3000, unit: 'pcs', qty: 3 },
    ];
    app.renderCart();
    const badge = document.getElementById('badge');
    expect(badge.textContent).toBe('5 item');
  });

  test('shows session start when not active', () => {
    app.sessionActive = false;
    app.cart = [];
    app.renderCart();
    const cartList = document.getElementById('cart-list');
    expect(cartList.innerHTML).toContain('Siap Belanja');
  });

  test('shows empty state when active but no items', () => {
    app.sessionActive = true;
    app.cart = [];
    app.renderCart();
    const cartList = document.getElementById('cart-list');
    expect(cartList.innerHTML).toContain('Keranjang Masih Kosong');
  });

  test('renders items in cart', () => {
    app.sessionActive = true;
    app.cart = [
      { id: 1, name: 'Mie Goreng', price: 5000, unit: 'pcs', qty: 1 },
    ];
    app.renderCart();
    const cartList = document.getElementById('cart-list');
    expect(cartList.innerHTML).toContain('Mie Goreng');
  });

  test('hides total bar when cart is empty', () => {
    app.sessionActive = true;
    app.cart = [];
    app.renderCart();
    const totalBar = document.getElementById('total-bar');
    expect(totalBar.classList.contains('off')).toBe(true);
  });

  test('shows total bar when cart has items', () => {
    app.sessionActive = true;
    app.cart = [{ id: 1, name: 'A', price: 5000, unit: 'pcs', qty: 1 }];
    app.renderCart();
    const totalBar = document.getElementById('total-bar');
    expect(totalBar.classList.contains('off')).toBe(false);
  });
});

// ═══════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════
describe('constants', () => {
  test('CART_KEY is defined', () => {
    expect(app.CART_KEY).toBe('bc_cart_v3');
  });

  test('HISTORY_KEY is defined', () => {
    expect(app.HISTORY_KEY).toBe('bc_history_v1');
  });

  test('MAX_HISTORY is 100', () => {
    expect(app.MAX_HISTORY).toBe(100);
  });

  test('APP_VERSION is a semver string', () => {
    expect(app.APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
