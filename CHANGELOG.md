# Changelog

Semua perubahan penting pada proyek **Keranjang Analog** (sebelumnya "BelanjaCatat") didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/),
dan proyek ini menganut [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-06-28
### Fixed
- Versi tidak sinkron antara app.js (`v1.2.0`) dan index.html (`v.A18`)
- Cache version `slice(1)` menghasilkan `'.2.0'` alih-alih versi bersih
- Shadow `rgba(5,150,105,0.1)` tidak valid pada emoji bar
- Tombol `-` qty tidak disabled saat quantity sudah 1

## [1.2.0] - 2026-06-27
### Added
- UI Claymorphism "Pasar Pagi" — palet hijau segar, font Rubik + Nunito Sans
- Inisialisasi Tesseract dengan timeout 30 detik
- Error handler untuk worker Tesseract
### Changed
- Bahasa Tesseract dari `eng+ind` menjadi `eng` saja (download lebih ringan)
### Fixed
- Bug aplikasi stuck di loading "download engine OCR"

## [1.0.0] - 2026-06-25 — Rename ke Keranjang Analog

### Changed
- Ganti nama dari "BelanjaCatat" menjadi "Keranjang Analog"

## [B.03] - Sebelumnya — Tanpa Template, Input Langsung

### Added
- Fitur "Belanja Kilat": fokus scan harga saja, input manual langsung keypad
- Keypad numerik internal (0-9, hapus, enter)
- Timer 1 detik: jika OCR lambat, keypad muncul otomatis
- Auto-name "Item 1", "Item 2", dst.
- Emoji bar (🍜🥤🧹🍗🍞🍪) untuk nama item cepat

### Changed
- Hapus total sistem multi-template (kembali ke 1 template Umum fixed)
- Hapus perspective correction, Auto-Lurus, Mode Cepat, multi-PSM fallback
- Hapus OCR nama (fokus hanya scan harga)
- Turunkan upscale ke 1.5x
- UI minimalis modern: palet gelap + aksen hijau

### Fixed
- Tombol "Selesai Belanja" hanya muncul saat sesi aktif dan ada item

## [B.02] - Sebelumnya — Harga Terbesar

### Added
- Prioritas font terbesar: `extractPrice()` memilih kandidat harga dengan bounding box tertinggi
- Tambah opsi `blocks: true` di `recognize()` agar data words tersedia

## [B.01] - Sebelumnya — Mode Cepat

### Added
- Toggle "Mode Cepat" untuk lewati perspective correction (warpPerspective)

## [v.A22] - Sebelumnya — 5 Template Bawaan

### Added
- Template Alfamart & Alfamidi dipisah menjadi dua template terpisah
- Total 5 template bawaan: Umum, Alfamart, Alfamidi, Indomaret, Naga Swalayan

### Changed
- Koordinat zona template disesuaikan berdasarkan analisis gambar label oleh AI

## [v.A21] - Sebelumnya — 4 Template Bawaan

### Added
- 4 template bawaan (builtin:true), tidak bisa diedit/dihapus user
- Template kustom tetap bisa dibuat, diedit, dihapus
- Dedup otomatis template bawaan saat load

### Fixed
- Bug tampilan versi yang stuck di v.A14

## [v.A20] - Sebelumnya — Multi-Template + Koma Parser

### Added
- 3 template bawaan baru: Alfamart/Alfamidi, Indomaret, Naga Swalayan
- Parser koma: normalisasi pemisah ribuan koma (12,250 → 12250)
- Filter harga 4-6 digit (Rp 1.000 - Rp 999.999)

### Changed
- Parser harga kini mendukung titik dan koma

## [v.A19] - Sebelumnya — Perspective Correction

### Added
- Koreksi perspektif (perspective correction) seperti Cam Scanner
- Deteksi kontur label via Sobel edge heuristik (tanpa dependensi OpenCV.js 8MB)
- Manual shutter: tombol rana manual menggantikan auto-scan
- Filter harga: hanya terima 4-6 digit

## [v.A18] - Sebelumnya — Galeri + Demo

### Added
- Fitur "Uji Galeri": scan dari gambar di galeri HP
- Fitur "Demo": scan gambar label tiruan (MIE INSTAN Rp 12.500) untuk testing
- Service worker network-first: deploy selalu tampil versi terbaru
- Variabel APP_VERSION tunggal sebagai sumber kebenaran

## [v.A14] - Sebelumnya — Stabilisasi Kamera

### Added
- Fitur auto-lock: kamera mendeteksi label lalu auto-scan (kemudian diganti manual shutter di A19)
- Fungsi measureSharpness, getSharpCtx untuk deteksi ketajaman gambar
- Multi-PSM fallback untuk OCR harga (PSM 7 → 13 → 6)
- Fungsi extractPriceCandidates, mergePriceCands, pickPriceCand untuk kandidat harga

## [v.A06] - Sebelumnya — Awal Tesseract.js

### Added
- OCR lokal via Tesseract.js v5 (tanpa API dependency)
- Template system: overlay zona harga (merah) dan nama (hijau) draggable/resizable
- Preprocessing gambar: 3x upscale, grayscale, contrast enhancement
- Koreksi karakter OCR: O→0, S→5
- Deployment ke GitHub Pages

> Versi sebelum A06 tidak terdokumentasi.
