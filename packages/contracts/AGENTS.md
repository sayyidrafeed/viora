# @viora/contracts

Sumber kebenaran envelope event, nama topic, header, dan skema `data` per tipe event (§10). Consumer memvalidasi `data` dengan skema ini, dan data yang tidak cocok langsung masuk DLQ.

Perubahan harus kompatibel BACKWARD: field baru opsional, tidak menghapus atau mengganti tipe field. Perubahan yang tidak kompatibel memakai topic `*.v2`.
