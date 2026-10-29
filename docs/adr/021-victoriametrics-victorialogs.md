# ADR 021: VictoriaMetrics dan VictoriaLogs, bukan Prometheus dan Loki

Status: Diterima (2026-10-28)

## Konteks

SLO di §3 diukur dari metrik Kong per route, histogram OTel TTFF, lag consumer, dan umur antrean transcode. Semua observability berjalan di node prod yang sama dengan anggaran 3 GB RAM dan 2 thread (§15). OpenTelemetry dipakai di semua service sejak M0 (§6, Tracing). Exit criteria M0 meminta trace satu request terlihat di Tempo, dari Kong sampai identity-svc.

## Keputusan

| Kebutuhan | Alat |
|---|---|
| Metrics | VictoriaMetrics single-node + vmagent |
| Log | VictoriaLogs |
| Trace | Tempo |
| Dashboard | Grafana |
| Error | Sentry free tier |
| Pengumpul | OpenTelemetry Collector |

- Latensi API per route diambil dari plugin `prometheus` Kong, karena metrik OTel Kong baru ada di Enterprise 3.13+.
- Dashboard wajib: RED per service, lag consumer Redpanda per group, kedalaman dan umur antrean transcode, rasio cache hit CDN, burn rate SLO. Jumlah pesan di topic retry dan DLQ per group juga masuk dashboard dan alert (ADR 024).
- Alert DLQ (lebih dari 0 selama 5 menit) dikirim dari Grafana ke email owner proyek.
- NetworkPolicy mengizinkan vmagent dan OTel Collector dari namespace observability menjangkau port metrik setiap service.
- Di lokal, observability ada di Compose profile `obs` (VictoriaMetrics, VictoriaLogs, Tempo, Grafana).

## Konsekuensi

- VictoriaTraces belum dipakai. Kematangannya dievaluasi di M7, dan Tempo tetap dipakai sampai terbukti (§19).
- Kalau RAM node tidak cukup, observability berat bisa ditunda ke `preview` (§19).
- Status per grand plan revisi 17 (2026-10-29): profile `obs` berisi Tempo, VictoriaMetrics (scrape metrik Kong), dan Grafana. VictoriaLogs dan vmagent belum ada. OTel terpasang di service lewat `service-kit`.

## Alternatif yang ditolak

- Prometheus dan Loki. Disebut di judul ADR di §17, tapi grand plan tidak mencatat alasan penolakannya. Alasan ini terbuka dan perlu diisi pemilik keputusan.
- Metrik OTel bawaan Kong. Hanya ada di Kong Enterprise 3.13+ (ADR 007).

## Rujukan

- grand-plan §3, §6 (Tracing, Retry bertahap), §15 (Observability, anggaran RAM), §18 (M0, M7), §19, §20 revisi 7, 16
