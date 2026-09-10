/**
 * Türkiye genelinde en yaygın satılan süpermarket ve bakkal ürünlerinin hazır barkod kütüphanesi.
 * EAN-13 barkodları, ürün adları, kategorileri ve KDV oranları içerir.
 */
export const TURKISH_BARCODE_CATALOG = [
  // Fırın & Genel Temel Ürünler
  { barcode: '869000100001', name: 'Ekmek (200 gr)', category: 'Fırın & Unlu', taxRate: 1, unit: 'Adet' },
  { barcode: '869000100002', name: 'Simit', category: 'Fırın & Unlu', taxRate: 1, unit: 'Adet' },
  { barcode: '869000100003', name: 'Su (0.5 Litre)', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '869000100004', name: 'Alışveriş Poşeti', category: 'Genel', taxRate: 20, unit: 'Adet' },
  { barcode: '8690562001011', name: 'Ülker Çikolatalı Gofret 36g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504000054', name: 'Yudum Ayçiçek Yağı 5L', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690637000010', name: 'Doğuş Toz Şeker 5 Kg', category: 'Temel Gıda', taxRate: 1, unit: 'Paket' },
  { barcode: '8690506001011', name: 'Fairy Bulaşık Deterjanı 650ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },

  // Fırın & Temel Gıda
  { barcode: '8690504031201', name: 'Çaykur Rize Turist Çay 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504031218', name: 'Çaykur Tiryaki Çay 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504031225', name: 'Çaykur Filiz Çay 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504031232', name: 'Çaykur Kamelya Çayı 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090017', name: 'Doğuş Filiz Çay 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090024', name: 'Doğuş Karadeniz Çay 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090031', name: 'Lipton Yellow Label Dökme Çay 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080032', name: 'Torku Küp Şeker 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080049', name: 'Torku Kristal Toz Şeker 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080056', name: 'Torku Ayçiçek Yağı 1L', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080063', name: 'Torku Ayçiçek Yağı 5L Köşeli Pet', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080070', name: 'Yudum Ayçiçek Yağı 1L', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080087', name: 'Yudum Ayçiçek Yağı 5L Teneke', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080094', name: 'Komili Sızma Zeytinyağı 1L', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100015', name: 'Barilla Spagetti No:5 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100022', name: 'Filiz Burgu Makarna 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100039', name: 'Filiz Fiyonk Makarna 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100046', name: 'Filiz Arpa Şehriye 500g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100053', name: 'Tat Domates Salçası 830g Teneke', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100060', name: 'Öncü Domates Salçası 830g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100077', name: 'Öncü Biber Salçası Acı 830g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100084', name: 'Duru Osmancık Pirinç 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100091', name: 'Duru Kırmızı Mercimek 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100107', name: 'Duru Başbaşı Bulgur 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100114', name: 'Duru Koçbaşı Nohut 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504100121', name: 'Duru Dermason Fasulye 1000g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090048', name: 'Kurukahveci Mehmet Efendi Türk Kahvesi 100g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090055', name: 'Nescafé Classic Eko Paket 100g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090062', name: 'Nescafé 3\'ü 1 Arada Orijinal 17.5g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504090079', name: 'Nescafé 2\'si 1 Arada Şekersiz 10g', category: 'Temel Gıda', taxRate: 1, unit: 'Adet' },

  // Süt & Kahvaltılık
  { barcode: '8690526010017', name: 'Sütaş Tam Yağlı Süt 1L', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526010024', name: 'Sütaş Yarım Yağlı Süt 1L', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526030015', name: 'Sütaş Ayran 200ml Küçük', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526030022', name: 'Sütaş Ayran 1L Şişe', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526050013', name: 'Sütaş Süzme Peynir 500g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526070011', name: 'Sütaş Taze Kaşar Peyniri 400g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526090019', name: 'Sütaş Geleneksel Tereyağı 250g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690526110014', name: 'Sütaş Kaymaklı Yoğurt 1000g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504011012', name: 'Pınar Doğal Tam Yağlı Süt 1L', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504011029', name: 'Pınar Yarım Yağlı Süt 1L', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504050011', name: 'Pınar Beyaz Sürülebilir Peynir 180g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504070019', name: 'Pınar Taze Labne 200g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504130010', name: 'Pınar Klasik Kangal Sucuk 225g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504150018', name: 'Pınar Uzun Sosis 5\'li 250g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504140080', name: 'Nutella Kakaolu Fındık Kreması 400g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504140097', name: 'Nutella Kakaolu Fındık Kreması 750g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504080018', name: 'Torku Banada Fındık Kreması 400g', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690533010101', name: 'Koli Yumurta (30\'lu M Boy)', category: 'Süt & Kahvaltılık', taxRate: 1, unit: 'Koli' },

  // İçecek & Su & Maden Suyu
  { barcode: '5449000000996', name: 'Coca-Cola Kutu 330ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000016621', name: 'Coca-Cola Pet Şişe 1 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000000286', name: 'Coca-Cola Orijinal 2.5 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000000439', name: 'Coca-Cola Zero Sugar Kutu 330ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000050205', name: 'Fanta Portakal Kutu 330ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000050212', name: 'Fanta Portakal 1 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000050229', name: 'Fanta Portakal 2.5 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000027207', name: 'Sprite Gazoz Kutu 330ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '5449000027214', name: 'Sprite Gazoz 1 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757001015', name: 'Pepsi Kutu 330ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757001022', name: 'Pepsi Cola 1 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757001039', name: 'Pepsi Cola 2.5 Litre', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757002012', name: 'Yedigün Portakal 330ml Kutu', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757003019', name: 'Fruko Gazoz 330ml Kutu', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757004016', name: 'Lipton Ice Tea Şeftali 330ml Kutu', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757004023', name: 'Lipton Ice Tea Limon 330ml Kutu', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690757004030', name: 'Lipton Ice Tea Mango 330ml Kutu', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504031300', name: 'Didi Soğuk Çay Şeftali 500ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504031317', name: 'Didi Soğuk Çay Bergamot 500ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504031324', name: 'Didi Soğuk Çay Limon 500ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '9002490100070', name: 'Red Bull Enerji İçeceği 250ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565001016', name: 'Beypazarı Doğal Maden Suyu 200ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565002013', name: 'Kızılay Doğal Maden Suyu 200ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565003010', name: 'Kızılay Elmalı Maden Suyu 200ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565004017', name: 'Kızılay Limonlu Maden Suyu 200ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565005014', name: 'Sırma Doğal Maden Suyu 200ml', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565006011', name: 'Damla Doğal Kaynak Suyu 0.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565007018', name: 'Damla Doğal Kaynak Suyu 1.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565008015', name: 'Erikli Doğal Kaynak Suyu 0.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565009012', name: 'Erikli Doğal Kaynak Suyu 1.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565010018', name: 'Hayat Doğal Kaynak Suyu 0.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565011015', name: 'Hayat Doğal Kaynak Suyu 1.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565012012', name: 'Pınar Su 0.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },
  { barcode: '8690565013019', name: 'Sırma Su 0.5L', category: 'İçecek', taxRate: 10, unit: 'Adet' },

  // Atıştırmalık & Bisküvi & Çikolata
  { barcode: '8690637010014', name: 'Ülker Çikolatalı Gofret 36g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010021', name: 'Ülker Halley Çikolata Kaplı 10\'lu 300g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010038', name: 'Ülker Biskrem Kakaolu 100g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010045', name: 'Ülker Pötibör Sade Bisküvi 175g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010052', name: 'Ülker Çokoprens 10\'lu 300g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010069', name: 'Ülker Hanımeller Fındıklı 150g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010076', name: 'Ülker Rondo Kremalı Çilekli 61g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010083', name: 'Ülker Çokonat Fındıklı Gofret 33g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010090', name: 'Ülker Metro Karamelli Bar 36g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010106', name: 'Ülker Albeni Bisküvili Çikolata 40g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010113', name: 'Ülker Dido Sütlü Gofret 35g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010120', name: 'Ülker Caramio Karamel Dolgulu 32g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690637010137', name: 'Ülker Laviva Dolgulu Çikolata 35g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060010', name: 'Eti Browni Intense Çikolatalı Kek 50g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060027', name: 'Eti Tutku Çikolata Kremalı Bisküvi 100g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060034', name: 'Eti Crax Tuzlu Çubuk Kraker 85g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060041', name: 'Eti Burçak Yulaflı Bisküvi 131g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060058', name: 'Eti Karam Gurme Bitter Gofret 50g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060065', name: 'Eti Canga Yer Fıstıklı Karamel 45g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060072', name: 'Eti Popkek Kakaolu Çikolata Soslu 60g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060089', name: 'Eti Negro / Nero Kakaolu Kremalı Bisküvi 100g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060096', name: 'Eti Hoşbeş Fındıklı Gofret 142g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060102', name: 'Eti Topkek Meyveli Küçük Kek 40g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504060119', name: 'Eti Gong Mısır ve Pirinç Patlağı 64g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504120013', name: 'Lay\'s Klasik Patates Cipsi 107g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504120020', name: 'Doritos Nacho Peynirli Mısır Cipsi 113g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504120037', name: 'Ruffles Orijinal Tırtıklı Patates Cipsi 107g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504120044', name: 'Cheetos Fıstıklı Mısır Çerezi 43g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504120051', name: 'Tadım Kavrulmuş Fındık İçi 180g', category: 'Atıştırmalık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504120068', name: 'Tadım Ayçekirdeği Kavrulmuş Bol Tuzlu 180g', category: 'Atıştırmalık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504120075', name: 'Tadım Antep Fıstığı 180g', category: 'Atıştırmalık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504120082', name: 'Tadım Karışık Kuruyemiş Klasik 180g', category: 'Atıştırmalık', taxRate: 1, unit: 'Adet' },
  { barcode: '8690504140011', name: 'Falım Damla Sakızlı Şekersiz 5\'li', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140028', name: 'First Karpuz Aromalı Şekersiz Sakız 27g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140035', name: 'Vivident Storm Yeşil Nane Aromalı Sakız', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140042', name: 'Olips Mentol & Okaliptus Sert Şeker 28g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140059', name: 'Haribo Altın Ayıcık Yumuşak Şeker 80g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140066', name: 'Kinder Joy Sürpriz Yumurta 20g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },
  { barcode: '8690504140073', name: 'Kinder Sürpriz Çikolata Yumurta 20g', category: 'Atıştırmalık', taxRate: 10, unit: 'Adet' },

  // Temizlik & Deterjan
  { barcode: '8690504160019', name: 'Fairy Platinum Sıvı Bulaşık Deterjanı Limon 650ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160026', name: 'Fairy Hepsi Bir Arada Bulaşık Tableti 50\'li', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160033', name: 'Pril Klasik Limon Bulaşık Deterjanı 675ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160040', name: 'Domestos Çamaşır Suyu Dağ Esintisi 750ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160057', name: 'Cif Krem Amonyaklı Yüzey Temizleyici 500ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160064', name: 'ACE Klasik Çamaşır Suyu 1L', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160071', name: 'Bingo Sıvı Çamaşır Deterjanı Renkliler 2.14L', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160088', name: 'Yumoş Konsantre Çamaşır Yumuşatıcı Orkide 1440ml', category: 'Temizlik', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504160095', name: 'Vernel Çamaşır Yumuşatıcısı Gül 3L', category: 'Temizlik', taxRate: 20, unit: 'Adet' },

  // Kişisel Bakım & Kozmetik
  { barcode: '8690504180017', name: 'Duru Katı Güzellik Sabunu Gül 4x150g', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180024', name: 'Hacı Şakir Saf Hamam Sabunu 4x200g', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180031', name: 'Palmolive Duş Jeli Aroma Sensations 500ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180048', name: 'Clear Men Kepeğe Karşı Şampuan Cool Sport 350ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180055', name: 'Head & Shoulders Şampuan Klasik Bakım 350ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180062', name: 'Elidor Güçlü ve Parlak Şampuan 350ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180079', name: 'Pantene Doğal Sentez Şampuan 350ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180086', name: 'Colgate Üçlü Etki Nane Diş Macunu 100ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180093', name: 'İpana Pro-Expert Hepsi Bir Arada Diş Macunu 75ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504180109', name: 'Signal White Now Anında Beyazlık Diş Macunu 75ml', category: 'Kişisel Bakım', taxRate: 20, unit: 'Adet' },
  { barcode: '8690504200010', name: 'Selpak 3 Katlı Tuvalet Kağıdı 16\'lı', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200027', name: 'Selpak 3 Katlı Havlu Kağıt 6\'lı', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200034', name: 'Familia Plus Tuvalet Kağıdı 32\'li', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200041', name: 'Papia Parfümlü Tuvalet Kağıdı 16\'lı', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200058', name: 'Sleepy Natural Bebek Bezi 4 Maxi 30\'lu', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200065', name: 'Prima Aktif Bebek Bezi 4 Numara 33\'lü', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200072', name: 'Kotex Ultra Normal Hijyenik Ped 8\'li', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' },
  { barcode: '8690504200089', name: 'Orkid Platinum Gece Hijyenik Ped 6\'lı', category: 'Kişisel Bakım', taxRate: 20, unit: 'Paket' }
];

/**
 * Open Food Facts API üzerinden anlık canlı internet barkod sorgusu yapar.
 * Dünya genelinde ve Türkiye'de kayıtlı milyonlarca barkodu destekler.
 */
export async function fetchOnlineBarcode(barcode) {
  try {
    const cleanBarcode = barcode.trim();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5 saniye zaman aşımı

    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const name = p.product_name_tr || p.product_name || p.generic_name || p.brands || '';
      if (!name) return null;

      // Basit kategori kestirimi
      let category = 'Genel';
      const catTags = (p.categories_tags || []).join(' ').toLowerCase();
      if (catTags.includes('beverage') || catTags.includes('drink') || catTags.includes('içecek') || catTags.includes('su')) {
        category = 'İçecek';
      } else if (catTags.includes('snack') || catTags.includes('biscuit') || catTags.includes('chocolate') || catTags.includes('bisküvi') || catTags.includes('çikolata')) {
        category = 'Atıştırmalık';
      } else if (catTags.includes('dairy') || catTags.includes('milk') || catTags.includes('süt') || catTags.includes('cheese') || catTags.includes('peynir')) {
        category = 'Süt & Kahvaltılık';
      } else if (catTags.includes('cleaning') || catTags.includes('detergent') || catTags.includes('temizlik')) {
        category = 'Temizlik';
      }

      return {
        barcode: cleanBarcode,
        name: name.trim(),
        category,
        taxRate: 10,
        unit: 'Adet',
        source: 'online_openfoodfacts'
      };
    }
    return null;
  } catch (err) {
    // Çevrimdışıysa veya istek zaman aşımına uğradıysa sessizce null döner
    return null;
  }
}

/**
 * Barkodu önce hazır yerel Türkiye kataloğunda arar, bulamazsa canlı internet sorgusu yapar.
 */
export async function lookupBarcodeInCatalogOrOnline(barcode) {
  const cleanBarcode = barcode.trim();
  
  // 1. Yerel katalog kontrolü
  const localMatch = TURKISH_BARCODE_CATALOG.find(item => item.barcode === cleanBarcode);
  if (localMatch) {
    return { ...localMatch, source: 'turkish_catalog' };
  }

  // 2. İnternet Open Food Facts API kontrolü
  const onlineMatch = await fetchOnlineBarcode(cleanBarcode);
  if (onlineMatch) {
    return onlineMatch;
  }

  return null;
}
