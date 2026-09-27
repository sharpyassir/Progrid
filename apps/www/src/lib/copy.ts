/**
 * Every sentence on the marketing site, in the three launch languages.
 * English is the source; Turkish and Arabic keep the same keys so a missing string is a type error.
 */
export type Lang = 'en' | 'tr' | 'ar';
export const LANGS: { code: Lang; label: string; path: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'EN', path: '/', dir: 'ltr' },
  { code: 'tr', label: 'TR', path: '/tr', dir: 'ltr' },
  { code: 'ar', label: 'AR', path: '/ar', dir: 'rtl' },
];

export interface Copy {
  meta: { title: string; description: string };
  nav: { products: string; agents: string; pricing: string; marketplace: string; docs: string; signIn: string; startFree: string; menu: string };
  hero: { badge: string; h1a: string; h1b: string; lead: string; ctaPrimary: string; ctaSecondary: string; stats: [string, string][] };
  terminal: { ready: string; orAgent: string; capNote: string };
  trust: [string, string, string][];
  products: { eyebrow: string; h2: string; lead: string; available: string; roadmap: string; groups: { name: string; desc: string; items: string[]; live: boolean; highlight?: boolean }[] };
  agents: { eyebrow: string; h2: string; lead: string; points: [string, string][]; codeCreate: string; codeCap: string; codeOver: string };
  pricing: { eyebrow: string; h2: string; lead: string; leadCode: string; cols: [string, string, string, string, string, string]; popular: string; unmanagedH3: string; managedH3: string; managedLead: string; noteTry: (rate: string) => string; noteUsd: string; noteTail: (snapshot: string) => string };
  marketplace: { eyebrow: string; h2: string; lead: string };
  compare: { eyebrow: string; h2: string; cols: [string, string, string]; rows: [string, string, string, string][] };
  cta: { h2: string; lead: string; create: string; docs: string };
  footer: { tagline: string; cols: [string, string[]][]; copyright: string; builtOn: string };
}

const en: Copy = {
  meta: { title: 'Progrid: the developer cloud for Saudi Arabia, built for people and AI agents', description: 'Get a server in 60 seconds. Hourly billing in dollars or riyals with ZATCA e-invoices, data that stays in Suudi Arabistan, one click apps, and API tokens your AI agents can use safely.' },
  nav: { products: 'Products', agents: 'For AI agents', pricing: 'Pricing', marketplace: 'Marketplace', docs: 'Docs', signIn: 'Sign in', startFree: 'Start free', menu: 'Menu' },
  hero: {
    badge: 'Launching 2027',
    h1a: 'The developer cloud for Saudi Arabia. Built for people ', h1b: 'and AI agents',
    lead: 'Get a server in 60 seconds. Pay by the hour in dollars or riyals with a ZATCA compliant e-invoice. Your AI agents get API tokens with a spending cap and a human in the loop.',
    ctaPrimary: 'Start with $100 in credit', ctaSecondary: 'See how agents deploy',
    stats: [['60 s', 'to a running server'], ['29 SAR / mo', 'Starter server, billed hourly'], ['0 contracts', 'no commitment, cancel any hour']],
  },
  terminal: { ready: 'WordPress is ready at https://185.0.113.42 and billing at 0.04 SAR per hour', orAgent: '# or let your agent do it, with a cap', capNote: '# 50 SAR per month cap, delete needs approval' },
  trust: [
    ['🇸🇦', 'Region in Saudi Arabia', 'Low latency across Saudi Arabia and the Gulf'],
    ['$', 'Priced in dollars, paid in riyals or dollars', 'ZATCA e-invoices; mada, cards and Apple Pay through Moyasar'],
    ['🔒', 'Secure from day one', 'Firewalls, SSH keys, two step sign in and an audit log for every call'],
    ['⏱', 'Hourly billing, monthly cap', 'Pay for 3 hours, not 30 days'],
  ],
  products: {
    eyebrow: 'Products', h2: 'Everything a developer cloud needs. Nothing that gets in the way.',
    lead: 'One API behind the console, the CLI, Terraform and your agents. Every product is a workflow you can watch, not a spinner.',
    available: 'Available', roadmap: 'Roadmap',
    groups: [
      { name: 'Core Cloud', desc: 'Servers, Kubernetes, volumes, load balancers, DNS, object storage, public IPs, snapshots, firewalls and monitoring today. VPC is next.', items: ['Servers', 'Managed servers', 'App Platform', 'Kubernetes', 'Volumes', 'Load balancers', 'DNS', 'Object storage', 'Snapshots', 'Public IPs', 'Firewalls', 'Monitoring'], live: true },
      { name: 'Managed Agents', desc: 'Give Claude, Cursor or n8n a token with a monthly spending cap and approval rules instead of the keys to your account.', items: ['Agent tokens', 'MCP server', 'Approval queue'], live: true, highlight: true },
      { name: 'Marketplace', desc: '15 one click apps at launch, from WordPress to Odoo to an AI starter. Progrid apps as premium listings.', items: ['WordPress', 'n8n', 'Odoo', 'Coolify', 'Ollama + Open WebUI'], live: true },
      { name: 'Inference Engine', desc: 'One OpenAI compatible endpoint, billed per token. Partner models first, our own GPUs next.', items: ['Inference gateway', 'GPU servers'], live: false },
      { name: 'Data & Learning', desc: 'Managed PostgreSQL with pgvector, Valkey and MySQL, with automatic failover and nightly backups.', items: ['Managed PostgreSQL', 'Managed Valkey', 'Managed MySQL'], live: true },
      { name: 'Security', desc: 'Firewalls enforced on the host, SSH keys, two factor sign in for owners, and a full audit log of every API call.', items: ['Firewalls', 'Audit log', 'Two factor auth'], live: true },
    ],
  },
  agents: {
    eyebrow: 'For AI agents', h2: 'Let your agent deploy. Keep your hand on the budget.',
    lead: 'Global clouds give agents the same all or nothing tokens people use. Progrid tokens carry a monthly spending cap and a list of actions that must wait for a human. The API enforces it, not a prompt.',
    points: [
      ['Spending cap per token', 'A 50 SAR per month cap means the agent cannot create a 65 SAR server. Ever.'],
      ['Approval for destructive actions', 'Delete, resize down and rebuild wait in a queue until you tap approve.'],
      ['Scoped like a person, capped like a budget', 'servers:write without billing:read. Scoped to one project. Expires when you say.'],
      ['Native MCP server', 'Add Progrid to Claude Code or Cursor in one line. Every API endpoint becomes a tool.'],
    ],
    codeCreate: '# create a token for your coding agent', codeCap: '// 50 SAR per month', codeOver: '# what the agent sees when it goes over the cap',
  },
  pricing: {
    eyebrow: 'Pricing', h2: 'Simple and predictable. Priced in riyals, with VAT shown before you pay.',
    lead: 'Billed by the hour and never more than the monthly price. Bandwidth included. No surprise line items. The whole price list is one API call: ', leadCode: 'GET /v1/pricing',
    cols: ['Plan', 'vCPU', 'Memory', 'NVMe storage', 'Monthly', 'With 15% VAT'],
    popular: 'Most popular', unmanagedH3: 'Servers', managedH3: 'Managed servers', managedLead: 'The same hardware plus setup, OS updates, security hardening, daily backups and support.',
    noteTry: (rate) => `Prices are in Saudi riyals and exclude VAT; the total with 15% VAT is shown at checkout. Dollar prices use the pegged rate of ${rate} SAR per USD. `,
    noteUsd: 'Dollar prices are our riyal prices at the pegged rate; Saudi customers are billed in riyals with 15% VAT. ',
    noteTail: (snapshot) => `A public IP is included with every server. Snapshots cost ${snapshot} per GB per month. Backups cost 20% of the plan and are included with managed servers. Support plans start at 90 SAR a month. App Platform instances start at 19 SAR a month.`,
  },
  marketplace: { eyebrow: 'Marketplace', h2: 'One click from idea to running app.', lead: 'Every app is a hardened image plus a setup script. Built from Git, scanned for CVEs and test deployed before it ships. Bring your own through the vendor program and keep 70% of the revenue.' },
  compare: {
    eyebrow: 'Why Progrid', h2: 'The developer experience of a global cloud. The invoices of a local one.',
    cols: ['Progrid', 'Global clouds', 'Local hosts'],
    rows: [
      ['Latency from Saudi Arabia', 'Low', 'Higher', 'Low'],
      ['Billing', 'Hourly, in dollars or riyals', 'Monthly or hourly, in dollars', 'Monthly, in riyals'],
      ['ZATCA e-invoicing', 'Built in', 'No', 'Varies'],
      ['Public API and Terraform', 'Yes', 'Yes', 'Rarely'],
      ['Agent tokens with spending caps', 'Yes', 'No', 'No'],
      ['Console in Arabic and English', 'Yes', 'No', 'English only'],
    ],
  },
  cta: { h2: 'Start building today.', lead: '$100 in free credit for new teams. No card needed until you spend it. Cancel any hour.', create: 'Create account', docs: 'Read the API docs' },
  footer: {
    tagline: 'The developer cloud for Saudi Arabia.',
    cols: [
      ['Products', ['Servers', 'Marketplace', 'Managed Agents', 'Inference Engine', 'Security']],
      ['Developers', ['API reference', 'CLI', 'Terraform', 'SDKs', 'Status']],
      ['Company', ['About', 'Pricing', 'Vendor program', 'Careers', 'Contact']],
      ['Legal', ['Terms', 'Privacy (PDPL)', 'SLA', 'Acceptable use']],
    ],
    copyright: 'Progrid. All rights reserved.', builtOn: 'Built on open source: Proxmox VE, Ceph, Temporal, NATS',
  },
};

const tr: Copy = {
  meta: { title: 'Progrid: Suudi Arabistan için geliştirici bulutu, insanlar ve yapay zeka ajanları için', description: '60 saniyede sunucu. Dolar veya riyal ile saatlik faturalama ve ZATCA e-fatura, Suudi Arabistan’da kalan veri, tek tıkla uygulamalar ve yapay zeka ajanlarının güvenle kullanabileceği API tokenları.' },
  nav: { products: 'Ürünler', agents: 'Yapay zeka ajanları', pricing: 'Fiyatlar', marketplace: 'Uygulama Mağazası', docs: 'Belgeler', signIn: 'Giriş yap', startFree: 'Ücretsiz başla', menu: 'Menü' },
  hero: {
    badge: '2027’de açılıyor',
    h1a: 'Suudi Arabistan için geliştirici bulutu. İnsanlar ', h1b: 've yapay zeka ajanları için',
    lead: '60 saniyede sunucunuz hazır. Dolar veya riyal ile saatlik ödeyin, ZATCA uyumlu e-fatura alın. Yapay zeka ajanlarınız harcama limitli ve insan onaylı API tokenları kullanır.',
    ctaPrimary: '100 $ kredi ile başla', ctaSecondary: 'Ajanlar nasıl kurulum yapıyor',
    stats: [['60 sn', 'çalışan bir sunucuya'], ['29 SAR / ay', 'Starter sunucu, saatlik faturalanır'], ['0 sözleşme', 'taahhüt yok, istediğiniz saat iptal']],
  },
  terminal: { ready: 'WordPress https://185.0.113.42 adresinde hazır, saatlik ücret 0,04 SAR', orAgent: '# ya da limitli bir tokenla ajanınıza bırakın', capNote: '# aylık 15 $ limit, silme onay ister' },
  trust: [
    ['🇸🇦', 'Suudi Arabistan’da bölge', 'Suudi Arabistan ve Körfez’de düşük gecikme'],
    ['$', 'Dolar bazlı fiyat, riyal veya dolar ile ödeme', 'ZATCA e-faturası; Moyasar ile mada, kart ve Apple Pay'],
    ['🔒', 'İlk günden güvenli', 'Güvenlik duvarı, SSH anahtarları, iki adımlı giriş ve her çağrı için denetim kaydı'],
    ['⏱', 'Saatlik faturalama, aylık tavan', '30 gün değil, 3 saat için ödeyin'],
  ],
  products: {
    eyebrow: 'Ürünler', h2: 'Bir geliştirici bulutunun ihtiyaç duyduğu her şey. Ayak bağı olan hiçbir şey.',
    lead: 'Konsolun, komut satırının, Terraform’un ve ajanlarınızın arkasında tek bir API. Her ürün izleyebileceğiniz bir iş akışıdır, dönen bir simge değil.',
    available: 'Kullanılabilir', roadmap: 'Yol haritası',
    groups: [
      { name: 'Çekirdek Bulut', desc: 'Bugün sunucular, diskler, yük dengeleyiciler, DNS, nesne depolama, genel IP’ler, anlık görüntüler, güvenlik duvarları ve izleme. Sırada VPC var.', items: ['Sunucular', 'Yönetilen sunucular', 'Uygulama Platformu', 'Kubernetes', 'Diskler', 'Yük dengeleyiciler', 'DNS', 'Nesne depolama', 'Anlık görüntüler', 'Genel IP’ler', 'Güvenlik duvarları', 'İzleme'], live: true },
      { name: 'Yönetilen Ajanlar', desc: 'Claude, Cursor veya n8n’e hesabınızın anahtarları yerine aylık harcama limiti ve onay kuralları olan bir token verin.', items: ['Ajan tokenları', 'MCP sunucusu', 'Onay kuyruğu'], live: true, highlight: true },
      { name: 'Uygulama Mağazası', desc: 'Açılışta WordPress’ten Odoo’ya ve bir yapay zeka başlangıç paketine kadar 15 tek tık uygulama. Progrid uygulamaları premium listeler olarak.', items: ['WordPress', 'n8n', 'Odoo', 'Coolify', 'Ollama + Open WebUI'], live: true },
      { name: 'Çıkarım Motoru', desc: 'OpenAI uyumlu tek uç nokta, token başına faturalama. Önce iş ortağı modeller, sonra kendi GPU’larımız.', items: ['Çıkarım geçidi', 'GPU sunucuları'], live: false },
      { name: 'Veri ve Öğrenme', desc: 'pgvector ile yönetilen PostgreSQL, Valkey ve MySQL; otomatik yük devretme ve gece yedekleriyle.', items: ['Yönetilen PostgreSQL', 'Yönetilen Valkey', 'Yönetilen MySQL'], live: true },
      { name: 'Güvenlik', desc: 'Sunucu üzerinde uygulanan güvenlik duvarları, SSH anahtarları, sahipler için iki adımlı giriş ve her API çağrısının denetim kaydı.', items: ['Güvenlik duvarları', 'Denetim kaydı', 'İki adımlı doğrulama'], live: true },
    ],
  },
  agents: {
    eyebrow: 'Yapay zeka ajanları için', h2: 'Kurulumu ajanınız yapsın. Bütçe sizin elinizde kalsın.',
    lead: 'Küresel bulutlar ajanlara insanların kullandığı ya hep ya hiç tokenlarını verir. Progrid tokenları aylık harcama limiti ve insan onayı bekleyen işlem listesi taşır. Bunu bir istem değil, API uygular.',
    points: [
      ['Token başına harcama limiti', 'Aylık 50 SAR limit, ajanın 65 SAR’lık sunucu oluşturamayacağı anlamına gelir. Asla.'],
      ['Yıkıcı işlemler için onay', 'Silme, küçültme ve yeniden kurma siz onaylayana kadar kuyrukta bekler.'],
      ['Bir insan gibi yetkili, bir bütçe gibi sınırlı', 'billing:read olmadan servers:write. Tek projeye kapsamlı. Siz dediğinizde süresi dolar.'],
      ['Yerleşik MCP sunucusu', 'Progrid’i Claude Code veya Cursor’a tek satırda ekleyin. Her API ucu bir araca dönüşür.'],
    ],
    codeCreate: '# kodlama ajanınız için token oluşturun', codeCap: '// aylık 15 $', codeOver: '# ajan limiti aştığında gördüğü yanıt',
  },
  pricing: {
    eyebrow: 'Fiyatlar', h2: 'Basit ve öngörülebilir. Riyal bazlı fiyat, KDV ödemeden önce gösterilir.',
    lead: 'Saatlik faturalanır ve aylık fiyatı asla aşmaz. Bant genişliği dahil. Sürpriz kalem yok. Tüm fiyat listesi tek API çağrısı: ', leadCode: 'GET /v1/pricing',
    cols: ['Plan', 'vCPU', 'Bellek', 'NVMe depolama', 'Aylık', '%15 KDV dahil'],
    popular: 'En popüler', unmanagedH3: 'Sunucular', managedH3: 'Yönetilen sunucular', managedLead: 'Aynı donanım artı kurulum, işletim sistemi güncellemeleri, güvenlik sıkılaştırma, günlük yedekler ve destek.',
    noteTry: (rate) => `Fiyatlar Suudi riyali cinsindendir ve KDV hariçtir; %15 KDV dahil toplam ödeme sırasında gösterilir. Dolar fiyatları ${rate} SAR/USD sabit kuruyla hesaplanır. `,
    noteUsd: 'Dolar fiyatları riyal fiyatlarımızın sabit kurla çevrilmiş halidir; Suudi Arabistan’daki müşteriler %15 KDV ile riyal olarak faturalanır. ',
    noteTail: (snapshot) => `Her sunucuya bir genel IP dahildir. Anlık görüntüler GB başına aylık ${snapshot}. Yedekler plan fiyatının %20’sidir ve yönetilen sunucularda dahildir. Destek planları aylık 90 SAR’dan başlar. Uygulama Platformu örnekleri aylık 19 SAR’dan başlar.`,
  },
  marketplace: { eyebrow: 'Uygulama Mağazası', h2: 'Fikirden çalışan uygulamaya tek tık.', lead: 'Her uygulama sertleştirilmiş bir imaj ve bir kurulum betiğidir. Git’ten derlenir, CVE taramasından geçer ve yayınlanmadan önce deneme kurulumu yapılır. Kendi uygulamanızı satıcı programıyla getirin, gelirin %70’i sizde kalsın.' },
  compare: {
    eyebrow: 'Neden Progrid', h2: 'Küresel bir bulutun geliştirici deneyimi. Yerel bir bulutun faturaları.',
    cols: ['Progrid', 'Küresel bulutlar', 'Yerel sağlayıcılar'],
    rows: [
      ['Suudi Arabistan’dan gecikme', 'Düşük', 'Daha yüksek', 'Düşük'],
      ['Faturalama', 'Saatlik, dolar veya riyal', 'Aylık veya saatlik, dolar', 'Aylık, riyal'],
      ['ZATCA e-fatura', 'Yerleşik', 'Hayır', 'Değişir'],
      ['Açık API ve Terraform', 'Evet', 'Evet', 'Nadiren'],
      ['Harcama limitli ajan tokenları', 'Evet', 'Hayır', 'Hayır'],
      ['Türkçe ve Arapça konsol', 'Evet', 'Hayır', 'Yalnızca Türkçe'],
    ],
  },
  cta: { h2: 'Bugün geliştirmeye başlayın.', lead: 'Yeni takımlara 100 $ ücretsiz kredi. Harcayana kadar kart gerekmez. İstediğiniz saat iptal edin.', create: 'Hesap oluştur', docs: 'API belgelerini oku' },
  footer: {
    tagline: 'Suudi Arabistan için geliştirici bulutu.',
    cols: [
      ['Ürünler', ['Sunucular', 'Uygulama Mağazası', 'Yönetilen Ajanlar', 'Çıkarım Motoru', 'Güvenlik']],
      ['Geliştiriciler', ['API referansı', 'Komut satırı', 'Terraform', 'SDK’lar', 'Durum']],
      ['Şirket', ['Hakkında', 'Fiyatlar', 'Satıcı programı', 'Kariyer', 'İletişim']],
      ['Hukuki', ['Koşullar', 'Gizlilik (PDPL)', 'SLA', 'Kabul edilebilir kullanım']],
    ],
    copyright: 'Progrid. Tüm hakları saklıdır.', builtOn: 'Açık kaynak üzerine: Proxmox VE, Ceph, Temporal, NATS',
  },
};

const ar: Copy = {
  meta: { title: 'Progrid: الخدمات السحابية للمطورين في السعودية', description: 'سيرفرك جاهز خلال 60 ثانية. ادفع بالساعة بالريال مع فاتورة إلكترونية، تطبيقات بضغطة وحدة، ورموز API تستخدمها أدوات الذكاء الاصطناعي بأمان.' },
  nav: { products: 'المنتجات', agents: 'الذكاء الاصطناعي', pricing: 'الأسعار', marketplace: 'المتجر', docs: 'الدليل', signIn: 'دخول', startFree: 'ابدأ مجانًا', menu: 'القائمة' },
  hero: {
    badge: 'الإطلاق في 2027',
    h1a: 'الخدمات السحابية', h1b: '',
    lead: 'خدمة سحابية للبنية التحتية للمطورين (IaaS). سيرفرك يشتغل خلال 60 ثانية، وتدفع بالساعة بالريال مع فاتورة إلكترونية. وأدوات الذكاء الاصطناعي عندك تشتغل برموز API بحد إنفاق وبموافقتك.',
    ctaPrimary: 'ابدأ برصيد مجاني', ctaSecondary: 'شوف كيف ينشر الذكاء الاصطناعي',
    stats: [['60 ثانية', 'وسيرفرك شغّال'], ['29 ريال / شهر', 'باقة Starter، تُحسب بالساعة'], ['0 عقود', 'بدون التزام، تلغي وقت ما تبي']],
  },
  terminal: { ready: 'WordPress جاهز على https://185.0.113.42 والحساب 0.04 ريال بالساعة', orAgent: '# أو خلّ مساعدك الذكي يسويها، بحد إنفاق', capNote: '# حد 50 ريال بالشهر، والحذف يبي موافقة' },
  trust: [
    ['🇸🇦', 'مبني للسعودية', 'استجابة سريعة من السعودية والخليج، ودعم بالعربي'],
    ['﷼', 'الأسعار بالريال', 'فاتورة زاتكا الإلكترونية، وتدفع بمدى أو البطاقة أو Apple Pay عبر Moyasar'],
    ['🔒', 'أمان من أول يوم', 'جدار حماية ومفاتيح SSH ودخول بخطوتين وسجل تدقيق لكل طلب'],
    ['⏱', 'تحاسب بالساعة وبسقف شهري', 'استخدمت 3 ساعات؟ تدفع 3 ساعات، مو 30 يوم'],
  ],
  products: {
    eyebrow: 'المنتجات', h2: 'كل اللي تحتاجه للبنية التحتية. وما في شي يوقّفك.',
    lead: 'واجهة API وحدة تشغّل لوحة التحكم وسطر الأوامر وTerraform ووكلائك. كل شي تسويه تقدر تتابعه خطوة بخطوة.',
    available: 'متوفر', roadmap: 'قريبًا',
    groups: [
      { name: 'الخدمات الأساسية', desc: 'سيرفرات وأقراص وموزّع أحمال وDNS وتخزين متوافق مع S3 وعناوين IP ونسخ لحظية وجدار حماية ومراقبة، كلها متوفرة الحين. الشبكات الخاصة جاية قريب.', items: ['السيرفرات', 'السيرفرات المُدارة', 'منصة التطبيقات', 'Kubernetes', 'الأقراص', 'موزّع الأحمال', 'DNS', 'التخزين S3', 'النسخ اللحظية', 'عناوين IP', 'جدار الحماية', 'المراقبة'], live: true },
      { name: 'أدوات الذكاء الاصطناعي', desc: 'أعطِ Claude أو Cursor أو n8n رمز بحد إنفاق شهري وقواعد موافقة، بدل ما تعطيهم مفاتيح حسابك كلها.', items: ['رموز الذكاء الاصطناعي', 'خادم MCP', 'قائمة الموافقات'], live: true, highlight: true },
      { name: 'المتجر', desc: '15 تطبيق بضغطة وحدة من يوم الإطلاق، من WordPress إلى Odoo إلى باقة بداية للذكاء الاصطناعي. وتطبيقات Progrid لها مكانها المميز.', items: ['WordPress', 'n8n', 'Odoo', 'Coolify', 'Ollama + Open WebUI'], live: true },
      { name: 'الذكاء الاصطناعي', desc: 'نقطة وحدة متوافقة مع OpenAI، تحاسب على كل رمز. نماذج الشركاء أول، وبعدها كروت GPU الخاصة فينا.', items: ['بوابة النماذج', 'سيرفرات GPU'], live: false },
      { name: 'قواعد البيانات', desc: 'PostgreSQL مُدار مع pgvector، وValkey وMySQL، مع تبديل تلقائي لو صار عطل ونسخ احتياطي كل ليلة.', items: ['PostgreSQL مُدار', 'Valkey مُدار', 'MySQL مُدار'], live: true },
      { name: 'الأمان', desc: 'جدران حماية على مستوى المضيف، مفاتيح SSH، دخول بخطوتين للمالكين، وسجل تدقيق كامل لكل طلب API.', items: ['جدران الحماية', 'سجل التدقيق', 'التحقق بخطوتين'], live: true },
    ],
  },
  agents: {
    eyebrow: 'الذكاء الاصطناعي', h2: 'خلّ الذكاء الاصطناعي يشتغل. والميزانية بيدك.',
    lead: 'أدوات مثل Claude Code وCursor وn8n تقدر تنشئ سيرفرات وتنشر لك مباشرة. في Progrid تعطيها رمز خاص فيه حد إنفاق شهري، والإجراءات الحساسة ما تصير إلا بعد موافقتك.',
    points: [
      ['حد إنفاق لكل رمز', 'حد 50 ريال بالشهر يعني الأداة ما تقدر تنشئ سيرفر بـ 65 ريال. أبدًا.'],
      ['موافقة على الإجراءات الحساسة', 'الحذف والتصغير وإعادة البناء تنتظر في القائمة لين تضغط موافقة.'],
      ['خادم MCP جاهز', 'أضف Progrid إلى Claude Code أو Cursor بسطر واحد. كل نقطة API تصير أداة.'],
    ],
    codeCreate: '# أنشئ رمز لأداة البرمجة حقتك', codeCap: '// 50 ريال بالشهر', codeOver: '# وش تشوف الأداة لما تتجاوز الحد',
  },
  pricing: {
    eyebrow: 'الأسعار', h2: 'واضحة وبدون مفاجآت. بالريال، والضريبة تشوفها قبل ما تدفع.',
    lead: 'تحاسب بالساعة وما تتجاوز السعر الشهري أبدًا. الباندويث مشمول. ما في بنود مخفية. قائمة الأسعار كاملة بطلب واحد: ', leadCode: 'GET /v1/pricing',
    cols: ['الباقة', 'vCPU', 'الذاكرة', 'تخزين NVMe', 'بالشهر', 'شامل الضريبة 15%'],
    popular: 'الأكثر طلبًا', unmanagedH3: 'السيرفرات', managedH3: 'السيرفرات المُدارة', managedLead: 'نفس العتاد، وزيادة عليه الإعداد وتحديثات النظام والتحصين الأمني والنسخ الاحتياطي اليومي والدعم. لا تشيل هم.',
    noteTry: (rate) => `الأسعار بالريال السعودي غير شاملة ضريبة القيمة المضافة، والإجمالي شامل الضريبة 15% يظهر لك عند الدفع. أسعار الدولار بسعر الصرف الثابت ${rate} ريال للدولار. `,
    noteUsd: 'أسعار الدولار هي أسعارنا بالريال بسعر الصرف الثابت، والعملاء في السعودية تجيهم الفاتورة بالريال مع ضريبة 15%. ',
    noteTail: (snapshot) => `عنوان IP عام مشمول مع كل سيرفر. اللقطات ${snapshot} لكل GB بالشهر. النسخ الاحتياطي 20% من سعر الباقة، ومشمول في السيرفرات المُدارة. باقات الدعم تبدأ من 90 ريال بالشهر. نسخ منصة التطبيقات تبدأ من 19 ريال بالشهر.`,
  },
  marketplace: { eyebrow: 'المتجر', h2: 'من الفكرة إلى تطبيق شغّال بضغطة وحدة.', lead: 'كل تطبيق جاهز ومحصّن ومجرّب قبل ما ينزل لك. وإذا عندك تطبيق، أضفه عبر برنامج الموردين وخذ 70% من الإيراد.' },
  compare: {
    eyebrow: 'ليش Progrid', h2: 'تجربة زي السحابة العالمية. وفاتورة محلية بالريال.',
    cols: ['Progrid', 'السحابات العالمية', 'الاستضافة المحلية'],
    rows: [
      ['الاستجابة من السعودية', 'سريعة', 'أبطأ', 'سريعة'],
      ['المحاسبة', 'بالساعة، بالريال', 'بالشهر أو بالساعة، بالدولار', 'بالشهر، بالريال'],
      ['فاتورة زاتكا الإلكترونية', 'مدمجة', 'لا', 'نعم'],
      ['API عام وTerraform', 'نعم', 'نعم', 'نادرًا'],
      ['رموز ذكاء اصطناعي بحد إنفاق', 'نعم', 'لا', 'لا'],
      ['لوحة تحكم بالعربي', 'نعم', 'لا', 'أحيانًا'],
    ],
  },
  cta: { h2: 'ابدأ اليوم.', lead: 'رصيد مجاني للفرق الجديدة. ما تحتاج بطاقة لين تصرفه. ألغِ في أي ساعة تبيها.', create: 'أنشئ حسابك', docs: 'اقرأ دليل الـ API' },
  footer: {
    tagline: 'الخدمات السحابية للمطورين في السعودية.',
    cols: [
      ['المنتجات', ['السيرفرات', 'المتجر', 'أدوات الذكاء الاصطناعي', 'الأمان']],
      ['المطورون', ['مرجع API', 'سطر الأوامر', 'Terraform', 'حزم SDK', 'حالة الخدمة']],
      ['الشركة', ['عن Progrid', 'الأسعار', 'برنامج الموردين', 'الوظائف', 'تواصل معنا']],
      ['قانوني', ['الشروط', 'الخصوصية (PDPL)', 'اتفاقية مستوى الخدمة', 'سياسة الاستخدام']],
    ],
    copyright: 'Progrid. جميع الحقوق محفوظة.', builtOn: 'مبني على مصادر مفتوحة: Proxmox VE وCeph وTemporal وNATS',
  },
};

export const COPY: Record<Lang, Copy> = { en, tr, ar };
