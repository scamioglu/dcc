# 🚀 Nexus — Discord Benzeri Uygulama

Gerçek zamanlı metin sohbeti, sesli kanallar ve Full HD ekran paylaşımı (WebRTC).

## Özellikler

- ✅ Gerçek zamanlı metin mesajlaşma (Socket.io)
- ✅ Birden fazla kanal (genel, oyun, müzik)
- ✅ Sesli kanallar (WebRTC P2P — ses sunucu üzerinden geçmez)
- ✅ Full HD ekran paylaşımı (1080p @ 30fps, P2P)
- ✅ Çevrimiçi kullanıcı listesi
- ✅ Düşük gecikme (medya verisi doğrudan peer-to-peer gider)

---

## Yerel Geliştirme (Test Etmek İçin)

### 1. Server'ı başlat
```bash
cd server
npm install
npm run dev
# → http://localhost:3001 adresinde çalışır
```

### 2. Client'ı başlat (yeni terminal)
```bash
cd client
npm install
npm run dev
# → http://localhost:5173 adresinde çalışır
```

Tarayıcıda `http://localhost:5173` aç. Birden fazla sekme açarak test edebilirsin.

---

## 🌐 Ücretsiz Deploy (Railway.app) — Adım Adım

### Ön koşul
- [GitHub](https://github.com) hesabı
- [Railway.app](https://railway.app) hesabı (GitHub ile ücretsiz giriş)

---

### Adım 1: Kodu GitHub'a yükle

1. GitHub'da yeni bir repo oluştur: `nexus-app`
2. Bu klasörü yükle:
```bash
git init
git add .
git commit -m "ilk commit"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADIN/nexus-app.git
git push -u origin main
```

---

### Adım 2: Server'ı Railway'e deploy et

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. `nexus-app` reposunu seç
3. **Root Directory** → `server` yaz
4. Deploy başlar → bekle (~2 dakika)
5. **Settings → Networking → Generate Domain** tıkla
6. URL'yi kopyala: `https://nexus-server-xxxx.up.railway.app`

---

### Adım 3: Client'ı Railway'e deploy et

1. Aynı projede **+ New Service** → **GitHub Repo** → `nexus-app`
2. **Root Directory** → `client` yaz
3. **Variables** sekmesine gir → **New Variable** ekle:
   - Key: `VITE_SERVER_URL`
   - Value: `https://nexus-server-xxxx.up.railway.app` ← 2. adımdaki URL
4. **Settings → Networking → Generate Domain** tıkla
5. URL'yi arkadaşlarınla paylaş: `https://nexus-client-xxxx.up.railway.app`

---

### Adım 4: Server'a CLIENT_URL ekle (CORS için)

1. Server servisine geri dön → **Variables**
2. **New Variable**:
   - Key: `CLIENT_URL`
   - Value: `https://nexus-client-xxxx.up.railway.app` ← 3. adımdaki URL
3. Redeploy et

---

## Kullanım

1. Arkadaşların client URL'ini tarayıcıda açar
2. Kullanıcı adı girer → Giriş Yap
3. Metin kanallarından birinde sohbet başlar
4. Sol menüden sesli kanala tıklar → mikrofon izni verir
5. **🖥 Paylaş** butonuna basarak 1080p ekran paylaşımı başlatır

---

## Teknik Detaylar

### Neden gecikme düşük?

WebRTC **peer-to-peer** çalışır. Ekran görüntüsün ve sesin sunucuya gidip gelmesi **gerekmez** — doğrudan karşı tarafın bilgisayarına gider. Sunucu sadece "kim kimle konuşacak?" bilgisini iletir (sinyal).

### STUN Sunucuları

Google ve Cloudflare'in ücretsiz STUN sunucuları kullanılıyor. Çoğu ağda çalışır. Eğer arkadaşın çok kısıtlı bir ağdaysa (kurumsal VPN, çift NAT) bağlanamayabilir — bu durumda TURN sunucusu eklenmesi gerekir (Metered.ca ücretsiz TURN sunar).

### Kapasite

- Railway ücretsiz planı: 500 saат/ay, 512MB RAM
- 15 kişi için fazlasıyla yeterli
- Mesajlar sunucu belleğinde tutulur (sunucu yeniden başlayınca silinir)
- Kalıcı mesajlar için PostgreSQL eklenebilir (Railway'de ücretsiz)

---

## Sorun Giderme

**"Mikrofon erişimi reddedildi"** → Tarayıcı adres çubuğundaki kilit ikonundan izin ver.

**Ekran paylaşımı çalışmıyor** → HTTPS gerektirir. Railway deploy sonrası çalışır; localhost'ta çalışmayabilir (Chrome'da çalışır).

**Arkadaşım bağlanamıyor** → Ağ kısıtlaması olabilir. Metered.ca TURN sunucusu ekle.

**Railway ücretsiz planı yetmedi** → Fly.io, Render.com da ücretsiz seçenek.
