# Arah desain viora

Sumber arah: pilihan pemilik proyek, "apple-design" (2026-10-29). Prinsipnya dari talk desain Apple (*Designing Fluid Interfaces*, *The Details of UI Typography*, *Principles of Great Design*) yang diterjemahkan ke web. Ini arah, bukan tiruan: viora tidak meniru tampilan Apple, YouTube, atau produk lain (antislop R-30).

Dial: ENERGY 1 / RHYTHM 2 / MOTION 2.

## Identitas

Viora adalah tempat menonton dan mengunggah video. Video adalah isinya, jadi semua chrome (header, panel, kontrol) mundur ke belakang. Karakter yang dituju: tenang, cepat, dan bisa dipercaya. Pengguna harus merasa kontrol merespons tangannya, bukan merasa menunggu komputer.

Motif identitas: **chrome dari material tembus pandang di atas konten**. Header dan panel mengambang di atas isi yang bisa di-scroll di bawahnya, dengan tepi berupa efek scroll (gradasi blur), bukan garis 1px. Motif ini dipakai berulang di header web sekarang, lalu di bar kontrol player (M1) dan sheet di Expo (M6).

## Prinsip yang dipakai

- **Purpose.** Setiap layar punya satu pekerjaan dan satu titik fokus. Fitur yang belum ada tidak muncul sebagai tombol mati.
- **Simplicity, bukan minimalisme.** Jalur umum di depan, opsi lanjutan satu tingkat di dalam. Kadang konteks ditambah supaya lebih jelas, misalnya status email di profil.
- **Craft.** Setiap nilai jarak, waktu, dan radius dipilih, bukan bawaan. Nilainya ada di token di bawah.
- **Agency dan forgiveness.** Jalan keluar selalu terlihat (keluar, ganti email, coba lagi). Konfirmasi hanya untuk aksi yang tidak bisa dibatalkan, misalnya hapus akun.

## Warna

Netral untuk permukaan dan teks, satu aksen biru untuk aksi utama, fokus, dan tautan. Merah hanya untuk error dan aksi destruktif. Warna mengikuti tema sistem (`prefers-color-scheme`), dan tidak ada toggle di M0.

| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `surface` | `#ffffff` | `#0f0f11` | Latar halaman |
| `surface-raised` | `#f5f5f7` | `#1a1a1d` | Kartu, skeleton |
| `ink` | `#1d1d1f` | `#f5f5f7` | Teks utama |
| `ink-muted` | `#5b5b62` | `#a1a1a8` | Teks sekunder, minimal 4,5:1 |
| `line` | `#d2d2d7` | `#38383d` | Pemisah dekoratif |
| `line-strong` | `#86868b` | `#8a8a93` | Batas kontrol (input), minimal 3:1 |
| `accent` | `#1d4ed8` | `#7aa7ff` | Tombol utama, fokus, tautan |
| `on-accent` | `#ffffff` | `#0f0f11` | Teks di atas aksen |
| `danger` | `#c4271b` | `#ff7a6e` | Error |

Kontras setiap pasangan teks dicek dengan alat antislop sebelum dipakai.

## Tipografi

Font sistem (`system-ui`, jadi SF di Apple dan Segoe di Windows). Font sistem sudah membawa optical sizing dan tabel tracking, dan tampil tanpa unduhan font. Tracking dan leading mengikuti ukuran, tidak satu nilai untuk semua.

| Peran | Ukuran | Leading | Tracking | Berat |
|---|---|---|---|---|
| Display (judul halaman) | `1.75rem` (28px) | 1.15 | `-0.022em` | 600 |
| Title | `1.25rem` | 1.25 | `-0.012em` | 600 |
| Body | `1rem` | 1.5 | `0` | 400 |
| Label | `0.875rem` | 1.4 | `0` | 500 |
| Caption | `0.8125rem` | 1.4 | `0.005em` | 400 |

Hierarki dibangun dari berat, ukuran, dan leading bersama-sama. Ukuran memakai `rem` supaya tata letak ikut membesar kalau pengguna memperbesar teks.

## Bentuk dan jarak

- Radius: kontrol `10px`, kartu dan frame video `14px`, chip `999px` hanya untuk penanda status kecil. Tidak semua elemen berbentuk pil.
- Target sentuh minimal 44px.
- Skala jarak 4px: 4, 8, 12, 16, 24, 32, 48.

## Material

- Header dan bar kontrol memakai material: latar semi-transparan dengan `backdrop-filter: blur(20px) saturate(180%)`. Konten di-scroll di bawahnya.
- Tepi bawah header berupa efek scroll, yaitu gradasi pendek yang muncul hanya saat ada konten di bawahnya, bukan garis.
- Material tidak ditumpuk di atas material.
- `prefers-reduced-transparency: reduce` mengganti material dengan permukaan solid.
- `prefers-contrast: more` menambah batas tegas dan membuat latar solid.

## Gerak

- **Respons di pointer-down.** Tombol mengecil ke `scale(0.97)` dalam 100ms saat ditekan, bukan saat dilepas.
- **Elemen yang bisa dipegang memakai spring, bukan durasi tetap.** Default critically damped (damping 1.0, response 0.35). Pantulan (damping sekitar 0.8) hanya setelah gestur yang membawa momentum, misalnya flick sheet atau scrub. Spring masuk bersama komponen pertama yang bisa di-drag (sheet, scrubber di M1). Library-nya dipilih saat itu.
- **Elemen yang tidak dipegang** (pesan error, state sukses) boleh memakai transisi CSS pendek: opacity ditambah geser 4px, 200ms, `cubic-bezier(0.2, 0, 0, 1)`.
- **Jalur simetris.** Panel yang masuk dari kanan keluar ke kanan. Popover tumbuh dari tombol pemicunya.
- **`prefers-reduced-motion: reduce`.** Tidak ada geser, skala, atau spring; diganti cross-fade singkat.
- Hanya `transform` dan `opacity` yang dianimasikan.

## Umpan balik

Empat jenis: status, selesai, peringatan, error.
- Validasi field jalan saat field ditinggalkan (blur), bukan hanya saat submit.
- Setelah submit gagal, fokus pindah ke field pertama yang salah.
- Perubahan state penting dipindah ke judul supaya terbaca pembaca layar.

## Yang tidak dipakai

- Gradasi biru-ungu, glow, dan latar grid.
- Badge kapsul tanpa fungsi.
- Ikon generik (sparkle, magic).
- Font monospace sebagai gaya.
- Teks uppercase dengan tracking lebar.
- Angka dan testimoni karangan.
- Tampilan yang meniru Apple, YouTube, atau produk populer lain.

## Mobile (Expo, M6)

Token warna dan tipografi yang sama dipindah ke `packages/design-tokens` saat mobile menjadi consumer kedua. Gerak memakai spring Reanimated dengan parameter yang sama (damping, response). Material memakai `BlurView` dengan aturan reduced transparency yang sama.
