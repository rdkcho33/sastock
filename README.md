# SASTOCK Metadata Microstock Tool

A microstock metadata generator with Gemini free-tier API key round robin rotation.

## Fitur
- Upload drag & drop hingga 100 file
- Dukungan image, video, SVG, EPS
- Rotasi API key Gemini (Round Robin)
- Generator metadata dengan title, description, keywords
- Export CSV untuk Adobe Stock, Shutterstock, Vecteezy, Freepik
- Resume queue jika ada metadata gagal
- Manual edit card untuk title, description, keywords

## Instalasi
1. Pastikan Node.js 20 atau lebih baru terpasang.
2. Jalankan:

```bash
npm install
```

## Menjalankan

```bash
npm start
```

Lalu buka `http://localhost:3000`.

## Penggunaan
1. Masukkan satu atau beberapa API key Gemini free-tier di textarea (satu key per baris).
2. Pilih model Gemini.
3. Unggah file dengan drag & drop.
4. Atur title length, keyword count, prefix/suffix, dan opsi negatif.
5. Klik `Generate All`.
6. Edit manual jika perlu.
7. Klik `Export CSV`.

## Catatan
- SVG dan EPS diunggah sebagai metadata file; konversi ke JPG/PNG belum dilakukan otomatis.
- Untuk performa VPS, gunakan Node.js 20+ dan jalankan `npm start`.
"# sastock" 
