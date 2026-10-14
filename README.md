# Tribün parçaları (AMFI İmalat 3)

Telefonda açılan statik site. Her poz için:
- Kesim: 3B parça (Tekla IFC modelinden), uç açıları, kenar farkları, boy.
- Delim: delikler (çapa göre renkli) ve her delikli yüz için 2B ölçülü görünüş.

## GitHub Pages'e yükleme
1. GitHub'da bir repo aç (örn. `tribun`).
2. Bu klasördeki her şeyi (index.html, app.js, style.css, data.js, lib/, img/, .nojekyll) reponun köküne yükle.
3. Settings > Pages > Source: "Deploy from a branch", Branch: `main`, klasör `/ (root)` > Save.
4. Adres: `https://KULLANICIADI.github.io/tribun/`

## Notlar
- Boyuna delik ölçüleri çizimdeki 0 tarafından (3B'de kırmızı "0").
- Önden / Üstten / Arkadan / Alttan: parça kendi boyuna ekseni etrafında döndürülür; sol uç hep solda kalır.
- Ekli UNP'lerin (p/1, p/2 ...) her ek parçası kendi sayfasında, kendi 0 noktasıyla.
- Klasör bütün kaldığı sürece index.html dosyadan da açılır.
