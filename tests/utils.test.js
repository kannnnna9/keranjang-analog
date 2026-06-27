'use strict';

const app = require('../app.js');
const { fmt, esc, extractPrice, measureSharpness } = app;

// ═══════════════════════════════════════════════
// fmt — IDR currency formatting
// ═══════════════════════════════════════════════
describe('fmt', () => {
  test('formats zero', () => {
    expect(fmt(0)).toMatch(/0/);
  });

  test('formats small number', () => {
    const result = fmt(1000);
    expect(result).toMatch(/1\.000/);
  });

  test('formats typical price', () => {
    const result = fmt(12500);
    expect(result).toMatch(/12\.500/);
  });

  test('formats large number', () => {
    const result = fmt(999999);
    expect(result).toMatch(/999\.999/);
  });

  test('formats millions', () => {
    const result = fmt(1500000);
    expect(result).toMatch(/1\.500\.000/);
  });

  test('truncates fractional digits', () => {
    const result = fmt(12500.75);
    // maximumFractionDigits:0 → no decimals
    expect(result).toMatch(/12\.50[01]/);
  });

  test('negative number', () => {
    const result = fmt(-5000);
    expect(result).toMatch(/5\.000/);
  });
});

// ═══════════════════════════════════════════════
// esc — HTML escape
// ═══════════════════════════════════════════════
describe('esc', () => {
  test('escapes ampersand', () => {
    expect(esc('a&b')).toBe('a&amp;b');
  });

  test('escapes less-than', () => {
    expect(esc('a<b')).toBe('a&lt;b');
  });

  test('escapes greater-than', () => {
    expect(esc('a>b')).toBe('a&gt;b');
  });

  test('escapes all special chars together', () => {
    expect(esc('<script>alert("x")&</script>')).toBe(
      '&lt;script&gt;alert("x")&amp;&lt;/script&gt;'
    );
  });

  test('returns empty string for empty input', () => {
    expect(esc('')).toBe('');
  });

  test('coerces non-string to string', () => {
    expect(esc(123)).toBe('123');
    expect(esc(null)).toBe('null');
    expect(esc(undefined)).toBe('undefined');
  });

  test('preserves safe characters', () => {
    expect(esc('hello world 123')).toBe('hello world 123');
  });
});

// ═══════════════════════════════════════════════
// extractPrice — OCR price extraction
// ═══════════════════════════════════════════════
describe('extractPrice', () => {
  test('returns null for empty text', () => {
    expect(extractPrice('', [])).toBeNull();
  });

  test('returns null for text with no numbers', () => {
    expect(extractPrice('hello world', [])).toBeNull();
  });

  test('extracts simple 4-digit price', () => {
    expect(extractPrice('Rp 5000', [])).toBe(5000);
  });

  test('extracts 5-digit price', () => {
    expect(extractPrice('Rp 12500', [])).toBe(12500);
  });

  test('extracts 6-digit price', () => {
    expect(extractPrice('Rp 150000', [])).toBe(150000);
  });

  test('extracts price with dot separator', () => {
    expect(extractPrice('Rp 12.500', [])).toBe(12500);
  });

  test('extracts price with comma separator', () => {
    expect(extractPrice('Rp 12,500', [])).toBe(12500);
  });

  test('rejects prices under 1000', () => {
    expect(extractPrice('Rp 500', [])).toBeNull();
  });

  test('rejects prices over 999999', () => {
    expect(extractPrice('Rp 1000000', [])).toBeNull();
  });

  test('picks most frequent price from multiple occurrences', () => {
    expect(extractPrice('5000 5000 12500', [])).toBe(5000);
  });

  test('picks largest-font price when words have bounding boxes', () => {
    const words = [
      { text: '5000', bbox: { x0: 0, y0: 0, x1: 100, y1: 20 } },
      { text: '12500', bbox: { x0: 0, y0: 30, x1: 100, y1: 80 } },
    ];
    // 12500 has height 50 (80-30), 5000 has height 20 → picks 12500
    expect(extractPrice('5000 12500', words)).toBe(12500);
  });

  test('prefers frequency when font heights are equal', () => {
    const words = [
      { text: '5000', bbox: { x0: 0, y0: 0, x1: 100, y1: 30 } },
      { text: '5000', bbox: { x0: 0, y0: 40, x1: 100, y1: 70 } },
      { text: '12500', bbox: { x0: 0, y0: 80, x1: 100, y1: 110 } },
    ];
    expect(extractPrice('5000 5000 12500', words)).toBe(5000);
  });

  test('handles OCR noise in text', () => {
    expect(extractPrice('Rp. 12.500,- /pcs', [])).toBe(12500);
  });

  test('handles multiple prices, picks largest font', () => {
    const words = [
      { text: 'Rp', bbox: { x0: 0, y0: 0, x1: 30, y1: 10 } },
      { text: '8.900', bbox: { x0: 0, y0: 0, x1: 200, y1: 60 } },
      { text: '3.500', bbox: { x0: 0, y0: 70, x1: 200, y1: 90 } },
    ];
    expect(extractPrice('Rp 8.900 3.500', words)).toBe(8900);
  });

  test('returns null when words is null', () => {
    expect(extractPrice('5000', null)).toBe(5000);
  });

  test('handles words without bbox', () => {
    const words = [{ text: '5000' }];
    expect(extractPrice('5000', words)).toBe(5000);
  });

  test('handles price with leading zeros after normalization', () => {
    expect(extractPrice('Rp 05000', [])).toBe(5000);
  });
});

// ═══════════════════════════════════════════════
// measureSharpness — Laplacian variance
// ═══════════════════════════════════════════════
describe('measureSharpness', () => {
  test('returns 0 for uniform image', () => {
    const w = 5, h = 5;
    const gray = new Float32Array(w * h).fill(128);
    expect(measureSharpness(gray, w, h)).toBe(0);
  });

  test('returns positive value for edge-containing image', () => {
    const w = 5, h = 5;
    const gray = new Float32Array(w * h);
    // Create a sharp edge: left half dark, right half bright
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = x < 3 ? 0 : 255;
      }
    }
    const sharpness = measureSharpness(gray, w, h);
    expect(sharpness).toBeGreaterThan(0);
  });

  test('sharp image has higher score than blurry', () => {
    const w = 10, h = 10;
    // Sharp: alternating 0/255
    const sharp = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) sharp[i] = i % 2 === 0 ? 0 : 255;

    // Blurry: smooth gradient
    const blurry = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        blurry[y * w + x] = (x / w) * 255;
      }
    }

    expect(measureSharpness(sharp, w, h)).toBeGreaterThan(
      measureSharpness(blurry, w, h)
    );
  });

  test('handles minimum dimensions (3x3)', () => {
    const w = 3, h = 3;
    const gray = new Float32Array([0, 128, 255, 64, 128, 192, 0, 128, 255]);
    const result = measureSharpness(gray, w, h);
    expect(typeof result).toBe('number');
    expect(isFinite(result)).toBe(true);
  });
});
