# Koninski Launcher

Koninski SMP için özel launcher (Electron, Windows). Oyuncu nick'ini yazar, **OYNA**'ya basar; launcher sırayla:

1. Sunucudaki `manifest.json`'u okur
2. Eksik/değişmiş modları indirir (SHA1 doğrular), listeden çıkarılanları siler (oyuncunun kendi modlarına dokunmaz)
3. Java 25'i (Adoptium) kendisi indirir
4. Fabric'i kurar
5. Oyunu açar ve sunucuya otomatik bağlanır

Giriş offline nick ile; UUID, sunucudaki offline-mode ile aynı yöntemle (`OfflinePlayer:<nick>`) üretilir.

## Hazır gelenler (26.2, Java 25, Fabric)

- Çoklu oyuncu listesinde **Koninski SMP** (koninski.com.tr) hazır gelir; oyuncunun kendi sunucuları silinmez. Otomatik bağlanma için manifest'te `"quickPlay": true`.
- Modlar `config.json > mods` listesindeki Modrinth slug'larından her açılışta kontrol edilir; daha yeni sürüm varsa indirilir, eskisi silinir: `fabric-api`, `simple-voice-chat`, `sound-physics-remastered` ve performans modları `sodium`, `iris`, `ferrite-core`, `entityculling`, `immediatelyfast`.
- Launcher oyun açılınca kendini kapatır (arayüzdeki kutuyla kapatılabilir); `config.json > jvmArgs` ile JVM bayrakları ayarlanır.
- Modrinth'e ulaşılamazsa `bundled-mods/` içindeki jar'lar kullanılır.
- Yeni mod eklemek: `config.json > mods`'a `{ "slug": "..." }` ekle (slug = Modrinth sayfasının adresindeki ad).
- `manifestUrl` boş bırakılabilir; o zaman sadece `config.json` kullanılır. Kendi sunucundan dosya (config, resourcepack, Modrinth'te olmayan mod) dağıtmak istersen `manifestUrl` ver.

## Manifest ile ek dosya dağıtımı (isteğe bağlı)

1. `config.json` içinde `manifestUrl` ve `serverAddress` değerlerini kontrol et.
2. Mod `.jar` dosyalarını bir klasöre koy ve web'e yükle (ör. `koninski.com.tr/launcher/mods/`).
3. Manifest üret:
   ```
   node server/build-manifest.js ./mods https://koninski.com.tr/launcher/mods 1.21.4 manifest.json
   ```
   `manifest.json`'u `manifestUrl`'deki adrese yükle. **Minecraft sürümünü sunucununkiyle aynı yaz.**
4. Mod eklemek/güncellemek = jar'ı yükle + manifest'i yeniden üret. Launcher'ı yeniden dağıtmana gerek yok.

## Çalıştırma / paketleme

```
npm install
npm start          # geliştirme
npm test           # çekirdek testleri
npm run pack:win   # dist/KoninskiLauncher-win32-x64/KoninskiLauncher.exe
```

Oyuncular `dist/KoninskiLauncher-win32-x64` klasörünü (zip) açıp `KoninskiLauncher.exe`'yi çalıştırır.

## Manifest alanları

| Alan | Açıklama |
|---|---|
| `minecraft` | Minecraft sürümü (zorunlu) |
| `fabricLoader` | `"latest"` veya sabit sürüm |
| `javaMajor` | Java sürümü (25) |
| `serverAddress` | Otomatik bağlanılacak adres |
| `quickPlay` | `false` yaparsan otomatik bağlanmaz |
| `jvmArgs` | Ek JVM argümanları |
| `files[]` | `{path, url, sha1}`; `mods/`, `resourcepacks/`, `config/` vb. |

## Guard (launcher doğrulaması)

`bundled-mods/koninski-guard-*.jar` her açılışta `mods/` ile eşitlenir. Launcher ilk çalıştırmada kendiliğinden bir Ed25519 kimliği üretir (ayar dosyasında saklanır) ve oyuna `-Dkoninski.pub/-Dkoninski.priv` olarak verir; mod yalnızca `.koninski` klasöründeyken challenge'ı bu kimlikle imzalar. Sunucu plugin'i (Koninski-Guard reposu) bir nick'i ilk gördüğü kimliğe bağlar. Elle anahtar dağıtılmaz; kimlik kaybolursa `/guard sifirla <nick>`.
