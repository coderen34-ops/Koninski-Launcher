# Koninski Launcher

Koninski SMP için özel Minecraft launcher'ı (Windows). Kurulum dosyasını sunucu yetkililerinden al.

- `update/` — launcher'ın kendini güncellemek için okuduğu dosyalar (`latest.json` + `app-<sürüm>.asar`).
  Her paket Ed25519 ile imzalıdır; launcher imzası geçerli olmayan paketi uygulamaz.
- `src/` — launcher kaynak kodu.

## Yeni sürüm yayınlamak (yetkili)

1. `src/package.json` içindeki sürümü artır.
2. `cd src && npm ci && node tools/build-update.js <imza-anahtari.pem> ../update-out`
3. `update-out/latest.json` ve `app-<sürüm>.asar` dosyalarını `update/` klasörüne kopyala, push et.
   Oyuncular launcher'ı bir sonraki açışlarında otomatik güncellenir.

İmza anahtarının gizli kısmı (`.pem`) bu repoda **bulunmaz**.
