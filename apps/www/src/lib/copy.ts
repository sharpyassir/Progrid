import type { Site } from './site-shared';

/**
 * Every sentence on the marketing site, in the three launch languages, for both storefronts.
 * English is the source; Turkish and Arabic keep the same keys so a missing string is a type error.
 *
 * Progrid is one global brand. progrid.co is the global site (Progrid Technologies LLC, US dollars).
 * progrid.sa is the local storefront for customers in Saudi Arabia (Progrid Arabia, riyals with VAT,
 * mada and Apple Pay, local e-invoices). The storefront overrides change only what is local:
 * currency, tax, payment methods, invoicing and the contracting company. Never claim that servers
 * or data are in a particular country.
 */
export type Lang = 'en' | 'tr' | 'ar';
export const LANGS: { code: Lang; label: string; path: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'EN', path: '/', dir: 'ltr' },
  { code: 'tr', label: 'TR', path: '/tr', dir: 'ltr' },
  { code: 'ar', label: 'AR', path: '/ar', dir: 'rtl' },
];

/** Formatted prices for the pricing note, in the storefront's currency. */
export interface PriceNote { snapshot: string; support: string; app: string }

export interface Copy {
  meta: { title: string; description: string };
  nav: { products: string; connect: string; agents: string; pricing: string; marketplace: string; docs: string; signIn: string; startFree: string; menu: string };
  hero: { badge: string; h1a: string; h1b: string; lead: string; ctaPrimary: string; ctaSecondary: string; stats: [string, string][] };
  terminal: { ready: string; orAgent: string; capNote: string };
  trust: [string, string, string][];
  products: { eyebrow: string; h2: string; lead: string; available: string; roadmap: string; learnMore: string; groups: { name: string; desc: string; items: string[]; live: boolean; highlight?: boolean; href?: string }[] };
  agents: { eyebrow: string; h2: string; lead: string; points: [string, string][]; codeCreate: string; codeCap: string; codeOver: string };
  pricing: { eyebrow: string; h2: string; lead: string; leadCode: string; cols: string[]; vatCol: string; popular: string; unmanagedH3: string; managedH3: string; managedLead: string; note: string; noteTail: (p: PriceNote) => string };
  marketplace: { eyebrow: string; h2: string; lead: string };
  compare: { eyebrow: string; h2: string; cols: [string, string, string]; rows: [string, string, string, string][] };
  cta: { h2: string; lead: string; create: string; docs: string };
  footer: { tagline: string; cols: [string, [string, string][]][]; copyright: string; builtOn: string; providedBy: string; geoCredit: string };
}

/** The storefront switch, always in English and Arabic so a visitor finds it in either language. */
export const SITE_SWITCH: Record<Site, { en: string; ar: string; title: string }> = {
  global: { en: 'Saudi Arabia site', ar: 'الموقع السعودي', title: 'Prices in riyals, local invoices from Progrid Arabia' },
  sa: { en: 'Global site', ar: 'الموقع العالمي', title: 'Prices in US dollars, services by Progrid Technologies LLC' },
};

const en: Copy = {
  meta: { title: 'Progrid: the developer cloud for people and AI agents', description: 'Get a server in 60 seconds. Hourly billing with a monthly cap, one click apps, and API tokens your AI agents can use safely.' },
  nav: { products: 'Products', connect: 'Connect', agents: 'For AI agents', pricing: 'Pricing', marketplace: 'Marketplace', docs: 'Docs', signIn: 'Sign in', startFree: 'Start free', menu: 'Menu' },
  hero: {
    badge: 'Launching 2027',
    h1a: 'The developer cloud for people ', h1b: 'and AI agents',
    lead: 'Get a server in 60 seconds. Pay by the hour and never more than the monthly price. Your AI agents get API tokens with a spending cap and a human in the loop.',
    ctaPrimary: 'Start with $100 in credit', ctaSecondary: 'See how agents deploy',
    stats: [['60 s', 'to a running server'], ['$7.73 / mo', 'Starter server, billed hourly'], ['0 contracts', 'no commitment, cancel any hour']],
  },
  terminal: { ready: 'WordPress is ready at https://185.0.113.42 and billing at $0.01 per hour', orAgent: '# or let your agent do it, with a cap', capNote: '# $15 per month cap, delete needs approval' },
  trust: [
    ['◎', 'One cloud, one API', 'Console, CLI, Terraform, SDKs and MCP all use the same API'],
    ['$', 'Simple pricing in US dollars', 'Pay by card. Clear monthly invoices'],
    ['🔒', 'Secure from day one', 'Firewalls, SSH keys, two step sign in and an audit log for every call'],
    ['⏱', 'Hourly billing, monthly cap', 'Pay for 3 hours, not 30 days'],
  ],
  products: {
    eyebrow: 'Products', h2: 'Everything a developer cloud needs. Nothing that gets in the way.',
    lead: 'One API behind the console, the CLI, Terraform and your agents. Every product is a workflow you can watch, not a spinner.',
    available: 'Available', roadmap: 'Roadmap', learnMore: 'Learn more',
    groups: [
      { name: 'Progrid Connect', desc: 'Build and deploy AI agents that connect to your infrastructure, APIs and applications. Test every step, then call them by API or webhook.', items: ['Agents', 'Workflows', 'Connections', 'Webhooks', 'Build with AI', 'Templates'], live: true, highlight: true, href: '/connect' },
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
    lead: 'Most clouds give agents the same all or nothing tokens people use. Progrid tokens carry a monthly spending cap and a list of actions that must wait for a human. The API enforces it, not a prompt.',
    points: [
      ['Spending cap per token', 'A $15 monthly cap means the agent cannot create a $17 server. Ever.'],
      ['Approval for destructive actions', 'Delete, resize down and rebuild wait in a queue until you tap approve.'],
      ['Scoped like a person, capped like a budget', 'servers:write without billing:read. Scoped to one project. Expires when you say.'],
      ['Native MCP server', 'Add Progrid to Claude Code or Cursor in one line. Every API endpoint becomes a tool.'],
    ],
    codeCreate: '# create a token for your coding agent', codeCap: '// $15 per month', codeOver: '# what the agent sees when it goes over the cap',
  },
  pricing: {
    eyebrow: 'Pricing', h2: 'Simple and predictable. Priced in US dollars.',
    lead: 'Billed by the hour and never more than the monthly price. Bandwidth included. No surprise line items. The whole price list is one API call: ', leadCode: 'GET /v1/pricing',
    cols: ['Plan', 'vCPU', 'Memory', 'NVMe storage', 'Monthly'], vatCol: 'With 15% VAT',
    popular: 'Most popular', unmanagedH3: 'Servers', managedH3: 'Managed servers', managedLead: 'The same hardware plus setup, OS updates, security hardening, daily backups and support.',
    note: 'Prices are in US dollars. Any tax that applies is shown at checkout. ',
    noteTail: (p) => `A public IP is included with every server. Snapshots cost ${p.snapshot} per GB per month. Backups cost 20% of the plan and are included with managed servers. Support plans start at ${p.support} a month. App Platform instances start at ${p.app} a month.`,
  },
  marketplace: { eyebrow: 'Marketplace', h2: 'One click from idea to running app.', lead: 'Every app is a hardened image plus a setup script. Built from Git, scanned for CVEs and test deployed before it ships. Bring your own through the vendor program and keep 70% of the revenue.' },
  compare: {
    eyebrow: 'Why Progrid', h2: 'The tools of a big cloud. The clarity of a small bill.',
    cols: ['Progrid', 'Large clouds', 'Classic hosting'],
    rows: [
      ['Billing', 'Hourly, capped at the monthly price', 'Hourly, many line items', 'Monthly'],
      ['Public API and Terraform', 'Yes', 'Yes', 'Rarely'],
      ['Agent tokens with spending caps', 'Yes', 'No', 'No'],
      ['Approval queue for risky actions', 'Yes', 'No', 'No'],
      ['Console in English, Arabic and Turkish', 'Yes', 'Partly', 'Rarely'],
      ['Support from the engineers who run it', 'Yes', 'Paid plans', 'Varies'],
    ],
  },
  cta: { h2: 'Start building today.', lead: '$100 in free credit for new teams. No card needed until you spend it. Cancel any hour.', create: 'Create account', docs: 'Read the API docs' },
  footer: {
    tagline: 'The developer cloud for people and AI agents.',
    cols: [
      ['Products', [['Progrid Connect', '/connect'], ['Servers', '/#products'], ['Marketplace', '/#marketplace'], ['AI tools', '/#agents'], ['Pricing', '/#pricing'], ['Security', '/docs/security']]],
      ['Developers', [['API reference', '/docs/api-reference'], ['CLI', '/docs/cli'], ['Terraform', '/docs/api'], ['SDKs', '/docs/api'], ['Status', '#']]],
      ['Company', [['About us', '/about'], ['Contact', '/contact'], ['Careers', '/careers'], ['Affiliate Program', '/affiliates'], ['Vendor program', '/contact']]],
      ['Legal', [['Terms of service', '/legal/terms'], ['Acceptable use', '/legal/acceptable-use'], ['Privacy', '/legal/privacy'], ['Refunds', '/legal/refunds'], ['SLA', '/legal/sla'], ['Cookies', '/legal/cookies'], ['All legal documents', '/legal']]],
    ],
    copyright: 'Progrid. All rights reserved.', builtOn: 'Built on open source: Proxmox VE, Ceph, Temporal, NATS',
    providedBy: 'Services on this site are provided by Progrid Technologies LLC.',
    geoCredit: 'IP geolocation by DB-IP',
  },
};

const tr: Copy = {
  meta: { title: 'Progrid: insanlar ve yapay zeka ajanları için geliştirici bulutu', description: '60 saniyede sunucu. Aylık tavanlı saatlik faturalama, tek tıkla uygulamalar ve yapay zeka ajanlarının güvenle kullanabileceği API tokenları.' },
  nav: { products: 'Ürünler', connect: 'Connect', agents: 'Yapay zeka ajanları', pricing: 'Fiyatlar', marketplace: 'Uygulama Mağazası', docs: 'Belgeler', signIn: 'Giriş yap', startFree: 'Ücretsiz başla', menu: 'Menü' },
  hero: {
    badge: '2027’de açılıyor',
    h1a: 'İnsanlar ', h1b: 've yapay zeka ajanları için geliştirici bulutu',
    lead: '60 saniyede sunucunuz hazır. Saatlik ödeyin, aylık fiyatı asla aşmayın. Yapay zeka ajanlarınız harcama limitli ve insan onaylı API tokenları kullanır.',
    ctaPrimary: '100 $ kredi ile başla', ctaSecondary: 'Ajanlar nasıl kurulum yapıyor',
    stats: [['60 sn', 'çalışan bir sunucuya'], ['7,73 $ / ay', 'Starter sunucu, saatlik faturalanır'], ['0 sözleşme', 'taahhüt yok, istediğiniz saat iptal']],
  },
  terminal: { ready: 'WordPress https://185.0.113.42 adresinde hazır, saatlik ücret 0,01 $', orAgent: '# ya da limitli bir tokenla ajanınıza bırakın', capNote: '# aylık 15 $ limit, silme onay ister' },
  trust: [
    ['◎', 'Tek bulut, tek API', 'Konsol, CLI, Terraform, SDK’lar ve MCP aynı API’yi kullanır'],
    ['$', 'ABD doları ile basit fiyat', 'Kartla ödeyin. Anlaşılır aylık faturalar'],
    ['🔒', 'İlk günden güvenli', 'Güvenlik duvarı, SSH anahtarları, iki adımlı giriş ve her çağrı için denetim kaydı'],
    ['⏱', 'Saatlik faturalama, aylık tavan', '30 gün değil, 3 saat için ödeyin'],
  ],
  products: {
    eyebrow: 'Ürünler', h2: 'Bir geliştirici bulutunun ihtiyaç duyduğu her şey. Ayak bağı olan hiçbir şey.',
    lead: 'Konsolun, komut satırının, Terraform’un ve ajanlarınızın arkasında tek bir API. Her ürün izleyebileceğiniz bir iş akışıdır, dönen bir simge değil.',
    available: 'Kullanılabilir', roadmap: 'Yol haritası', learnMore: 'Daha fazla bilgi',
    groups: [
      { name: 'Progrid Connect', desc: 'Altyapına, API’lerine ve uygulamalarına bağlanan yapay zekâ ajanları oluştur ve yayınla. Her adımı test et, sonra API veya webhook ile çağır.', items: ['Ajanlar', 'İş akışları', 'Bağlantılar', 'Webhooklar', 'Yapay zekâ ile oluştur', 'Şablonlar'], live: true, highlight: true, href: '/connect' },
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
    lead: 'Çoğu bulut, ajanlara insanların kullandığı ya hep ya hiç tokenlarını verir. Progrid tokenları aylık harcama limiti ve insan onayı bekleyen işlem listesi taşır. Bunu bir istem değil, API uygular.',
    points: [
      ['Token başına harcama limiti', 'Aylık 15 $ limit, ajanın 17 $’lık sunucu oluşturamayacağı anlamına gelir. Asla.'],
      ['Yıkıcı işlemler için onay', 'Silme, küçültme ve yeniden kurma siz onaylayana kadar kuyrukta bekler.'],
      ['Bir insan gibi yetkili, bir bütçe gibi sınırlı', 'billing:read olmadan servers:write. Tek projeye kapsamlı. Siz dediğinizde süresi dolar.'],
      ['Yerleşik MCP sunucusu', 'Progrid’i Claude Code veya Cursor’a tek satırda ekleyin. Her API ucu bir araca dönüşür.'],
    ],
    codeCreate: '# kodlama ajanınız için token oluşturun', codeCap: '// aylık 15 $', codeOver: '# ajan limiti aştığında gördüğü yanıt',
  },
  pricing: {
    eyebrow: 'Fiyatlar', h2: 'Basit ve öngörülebilir. ABD doları ile fiyatlandırılır.',
    lead: 'Saatlik faturalanır ve aylık fiyatı asla aşmaz. Bant genişliği dahil. Sürpriz kalem yok. Tüm fiyat listesi tek API çağrısı: ', leadCode: 'GET /v1/pricing',
    cols: ['Plan', 'vCPU', 'Bellek', 'NVMe depolama', 'Aylık'], vatCol: '%15 KDV dahil',
    popular: 'En popüler', unmanagedH3: 'Sunucular', managedH3: 'Yönetilen sunucular', managedLead: 'Aynı donanım artı kurulum, işletim sistemi güncellemeleri, güvenlik sıkılaştırma, günlük yedekler ve destek.',
    note: 'Fiyatlar ABD doları cinsindendir. Uygulanan vergiler ödeme sırasında gösterilir. ',
    noteTail: (p) => `Her sunucuya bir genel IP dahildir. Anlık görüntüler GB başına aylık ${p.snapshot}. Yedekler plan fiyatının %20’sidir ve yönetilen sunucularda dahildir. Destek planları aylık ${p.support} ile başlar. Uygulama Platformu örnekleri aylık ${p.app} ile başlar.`,
  },
  marketplace: { eyebrow: 'Uygulama Mağazası', h2: 'Fikirden çalışan uygulamaya tek tık.', lead: 'Her uygulama sertleştirilmiş bir imaj ve bir kurulum betiğidir. Git’ten derlenir, CVE taramasından geçer ve yayınlanmadan önce deneme kurulumu yapılır. Kendi uygulamanızı satıcı programıyla getirin, gelirin %70’i sizde kalsın.' },
  compare: {
    eyebrow: 'Neden Progrid', h2: 'Büyük bir bulutun araçları. Küçük bir faturanın netliği.',
    cols: ['Progrid', 'Büyük bulutlar', 'Klasik barındırma'],
    rows: [
      ['Faturalama', 'Saatlik, aylık fiyatla sınırlı', 'Saatlik, çok kalemli', 'Aylık'],
      ['Açık API ve Terraform', 'Evet', 'Evet', 'Nadiren'],
      ['Harcama limitli ajan tokenları', 'Evet', 'Hayır', 'Hayır'],
      ['Riskli işlemler için onay kuyruğu', 'Evet', 'Hayır', 'Hayır'],
      ['İngilizce, Arapça ve Türkçe konsol', 'Evet', 'Kısmen', 'Nadiren'],
      ['Platformu işleten mühendislerden destek', 'Evet', 'Ücretli planlarda', 'Değişir'],
    ],
  },
  cta: { h2: 'Bugün geliştirmeye başlayın.', lead: 'Yeni takımlara 100 $ ücretsiz kredi. Harcayana kadar kart gerekmez. İstediğiniz saat iptal edin.', create: 'Hesap oluştur', docs: 'API belgelerini oku' },
  footer: {
    tagline: 'İnsanlar ve yapay zeka ajanları için geliştirici bulutu.',
    cols: [
      ['Ürünler', [['Progrid Connect', '/connect'], ['Sunucular', '/#products'], ['Uygulama Mağazası', '/#marketplace'], ['Yapay zeka araçları', '/#agents'], ['Fiyatlar', '/#pricing'], ['Güvenlik', '/docs/security']]],
      ['Geliştiriciler', [['API referansı', '/docs/api-reference'], ['CLI', '/docs/cli'], ['Terraform', '/docs/api'], ['SDK’lar', '/docs/api'], ['Durum', '#']]],
      ['Şirket', [['Hakkımızda', '/about'], ['İletişim', '/contact'], ['Kariyer', '/careers'], ['Ortaklık programı', '/affiliates'], ['Satıcı programı', '/contact']]],
      ['Hukuki', [['Hizmet koşulları', '/legal/terms'], ['Kabul edilebilir kullanım', '/legal/acceptable-use'], ['Gizlilik', '/legal/privacy'], ['İadeler', '/legal/refunds'], ['SLA', '/legal/sla'], ['Çerezler', '/legal/cookies'], ['Tüm hukuki belgeler', '/legal']]],
    ],
    copyright: 'Progrid. Tüm hakları saklıdır.', builtOn: 'Açık kaynak üzerine: Proxmox VE, Ceph, Temporal, NATS',
    providedBy: 'Bu sitedeki hizmetler Progrid Technologies LLC tarafından sunulur.',
    geoCredit: 'IP konum verisi: DB-IP',
  },
};

const ar: Copy = {
  meta: { title: 'Progrid: سحابة المطورين للأفراد ووكلاء الذكاء الاصطناعي', description: 'خادم جاهز خلال 60 ثانية. فوترة بالساعة بسقف شهري، وتطبيقات بنقرة واحدة، ورموز API يستخدمها وكلاء الذكاء الاصطناعي بأمان.' },
  nav: { products: 'المنتجات', connect: 'Connect', agents: 'للذكاء الاصطناعي', pricing: 'الأسعار', marketplace: 'المتجر', docs: 'الوثائق', signIn: 'تسجيل الدخول', startFree: 'ابدأ مجانًا', menu: 'القائمة' },
  hero: {
    badge: 'الإطلاق في 2027',
    h1a: 'سحابة المطورين للأفراد ', h1b: 'ولوكلاء الذكاء الاصطناعي',
    lead: 'خادمك جاهز خلال 60 ثانية. تدفع بالساعة ولا تتجاوز السعر الشهري أبدًا. ويعمل وكلاء الذكاء الاصطناعي لديك برموز API لها حد إنفاق، ولا تُنفَّذ الإجراءات الحساسة إلا بموافقتك.',
    ctaPrimary: 'ابدأ برصيد 100 دولار', ctaSecondary: 'كيف ينشر الوكلاء',
    stats: [['60 ثانية', 'حتى يعمل الخادم'], ['7.73 دولار شهريًا', 'خادم Starter بفوترة بالساعة'], ['بلا عقود', 'لا التزام، ويمكنك الإلغاء في أي ساعة']],
  },
  terminal: { ready: 'WordPress جاهز على https://185.0.113.42 بتكلفة 0.01 دولار في الساعة', orAgent: '# أو دع وكيلك ينفذ ذلك بحد إنفاق', capNote: '# حد 15 دولارًا شهريًا، والحذف يتطلب موافقة' },
  trust: [
    ['◎', 'سحابة واحدة وواجهة API واحدة', 'لوحة التحكم وسطر الأوامر وTerraform وحزم SDK وMCP تعمل جميعها على الواجهة نفسها'],
    ['$', 'أسعار واضحة بالدولار الأمريكي', 'الدفع بالبطاقة، وفواتير شهرية واضحة'],
    ['🔒', 'أمان من اليوم الأول', 'جدار حماية ومفاتيح SSH وتسجيل دخول بخطوتين وسجل تدقيق لكل طلب'],
    ['⏱', 'فوترة بالساعة بسقف شهري', 'تدفع مقابل 3 ساعات، لا 30 يومًا'],
  ],
  products: {
    eyebrow: 'المنتجات', h2: 'كل ما تحتاجه سحابة المطورين، دون تعقيد.',
    lead: 'واجهة API واحدة تقف خلف لوحة التحكم وسطر الأوامر وTerraform ووكلائك. وكل عملية يمكنك متابعتها خطوة بخطوة.',
    available: 'متاح', roadmap: 'قريبًا', learnMore: 'اعرف المزيد',
    groups: [
      { name: 'Progrid Connect', desc: 'ابنِ وانشر وكلاء ذكاء اصطناعي يتصلون ببنيتك التحتية وواجهات API وتطبيقاتك. اختبر كل خطوة، ثم استدعهم عبر API أو Webhook.', items: ['الوكلاء', 'سير العمل', 'الاتصالات', 'Webhooks', 'البناء بالذكاء الاصطناعي', 'القوالب'], live: true, highlight: true, href: '/connect' },
      { name: 'الخدمات الأساسية', desc: 'خوادم وKubernetes وأقراص وموزعات أحمال وDNS وتخزين كائنات وعناوين IP عامة ولقطات وجدران حماية ومراقبة، وكلها متاحة اليوم. والشبكات الخاصة هي الخطوة التالية.', items: ['الخوادم', 'الخوادم المُدارة', 'منصة التطبيقات', 'Kubernetes', 'الأقراص', 'موزعات الأحمال', 'DNS', 'تخزين الكائنات', 'اللقطات', 'عناوين IP العامة', 'جدران الحماية', 'المراقبة'], live: true },
      { name: 'الوكلاء المُدارون', desc: 'امنح Claude أو Cursor أو n8n رمزًا بحد إنفاق شهري وقواعد موافقة، بدلًا من مفاتيح حسابك كاملة.', items: ['رموز الوكلاء', 'خادم MCP', 'قائمة الموافقات'], live: true, highlight: true },
      { name: 'المتجر', desc: '15 تطبيقًا بنقرة واحدة عند الإطلاق، من WordPress إلى Odoo إلى حزمة بداية للذكاء الاصطناعي. وتطبيقات Progrid ضمن القوائم المميزة.', items: ['WordPress', 'n8n', 'Odoo', 'Coolify', 'Ollama + Open WebUI'], live: true },
      { name: 'محرك الاستدلال', desc: 'نقطة اتصال واحدة متوافقة مع OpenAI، بفوترة لكل رمز. نماذج الشركاء أولًا، ثم وحدات GPU الخاصة بنا.', items: ['بوابة الاستدلال', 'خوادم GPU'], live: false },
      { name: 'البيانات والتعلّم', desc: 'PostgreSQL مُدار مع pgvector، وValkey وMySQL، مع تبديل تلقائي عند الأعطال ونسخ احتياطي كل ليلة.', items: ['PostgreSQL مُدار', 'Valkey مُدار', 'MySQL مُدار'], live: true },
      { name: 'الأمان', desc: 'جدران حماية تُطبَّق على مستوى المضيف، ومفاتيح SSH، وتسجيل دخول بخطوتين للمالكين، وسجل تدقيق كامل لكل طلب API.', items: ['جدران الحماية', 'سجل التدقيق', 'التحقق بخطوتين'], live: true },
    ],
  },
  agents: {
    eyebrow: 'للذكاء الاصطناعي', h2: 'دع وكيلك ينشر، وتبقى الميزانية بيدك.',
    lead: 'تمنح معظم السحابات الوكلاء الرموز نفسها التي يستخدمها الأفراد، بصلاحيات كاملة أو بلا صلاحيات. أما رموز Progrid فلها حد إنفاق شهري وقائمة إجراءات تنتظر موافقة شخص. وتفرض الواجهة ذلك، لا التعليمات النصية.',
    points: [
      ['حد إنفاق لكل رمز', 'حد شهري قدره 15 دولارًا يعني أن الوكيل لا يستطيع إنشاء خادم بسعر 17 دولارًا. أبدًا.'],
      ['موافقة على الإجراءات الحساسة', 'الحذف والتصغير وإعادة البناء تنتظر في قائمة الموافقات حتى توافق.'],
      ['صلاحيات محددة وميزانية محدودة', 'servers:write دون billing:read. محصور في مشروع واحد. وتنتهي صلاحيته متى شئت.'],
      ['خادم MCP مدمج', 'أضف Progrid إلى Claude Code أو Cursor بسطر واحد. وتصبح كل نقطة API أداة.'],
    ],
    codeCreate: '# أنشئ رمزًا لوكيل البرمجة', codeCap: '// 15 دولارًا شهريًا', codeOver: '# ما يراه الوكيل عند تجاوز الحد',
  },
  pricing: {
    eyebrow: 'الأسعار', h2: 'أسعار واضحة وثابتة بالدولار الأمريكي.',
    lead: 'فوترة بالساعة لا تتجاوز السعر الشهري أبدًا. نقل البيانات مشمول. لا بنود مفاجئة. وقائمة الأسعار كاملة في طلب واحد: ', leadCode: 'GET /v1/pricing',
    cols: ['الباقة', 'vCPU', 'الذاكرة', 'تخزين NVMe', 'شهريًا'], vatCol: 'شاملًا ضريبة 15%',
    popular: 'الأكثر طلبًا', unmanagedH3: 'الخوادم', managedH3: 'الخوادم المُدارة', managedLead: 'العتاد نفسه، ومعه الإعداد وتحديثات النظام والتحصين الأمني والنسخ الاحتياطي اليومي والدعم.',
    note: 'الأسعار بالدولار الأمريكي. وتظهر أي ضريبة مستحقة عند الدفع. ',
    noteTail: (p) => `يشمل كل خادم عنوان IP عامًا. تكلفة اللقطات ${p.snapshot} لكل GB شهريًا. النسخ الاحتياطي 20% من سعر الباقة، ومشمول في الخوادم المُدارة. تبدأ باقات الدعم من ${p.support} شهريًا، وتبدأ نسخ منصة التطبيقات من ${p.app} شهريًا.`,
  },
  marketplace: { eyebrow: 'المتجر', h2: 'من الفكرة إلى تطبيق يعمل بنقرة واحدة.', lead: 'كل تطبيق صورة محصّنة مع نص إعداد. يُبنى من Git ويُفحص بحثًا عن الثغرات ويُجرَّب قبل نشره. وأضف تطبيقك عبر برنامج الموردين واحتفظ بـ 70% من الإيرادات.' },
  compare: {
    eyebrow: 'لماذا Progrid', h2: 'أدوات السحابات الكبرى، ووضوح الفاتورة البسيطة.',
    cols: ['Progrid', 'السحابات الكبرى', 'الاستضافة التقليدية'],
    rows: [
      ['الفوترة', 'بالساعة وبسقف السعر الشهري', 'بالساعة وبنود كثيرة', 'شهرية'],
      ['واجهة API عامة وTerraform', 'نعم', 'نعم', 'نادرًا'],
      ['رموز وكلاء بحد إنفاق', 'نعم', 'لا', 'لا'],
      ['قائمة موافقات للإجراءات الحساسة', 'نعم', 'لا', 'لا'],
      ['لوحة تحكم بالإنجليزية والعربية والتركية', 'نعم', 'جزئيًا', 'نادرًا'],
      ['دعم من المهندسين الذين يشغّلون المنصة', 'نعم', 'في الباقات المدفوعة', 'يختلف'],
    ],
  },
  cta: { h2: 'ابدأ البناء اليوم.', lead: 'رصيد مجاني بقيمة 100 دولار للفرق الجديدة. لا تحتاج إلى بطاقة حتى تستهلكه. ويمكنك الإلغاء في أي ساعة.', create: 'أنشئ حسابك', docs: 'اقرأ وثائق API' },
  footer: {
    tagline: 'سحابة المطورين للأفراد ولوكلاء الذكاء الاصطناعي.',
    cols: [
      ['المنتجات', [['Progrid Connect', '/connect'], ['الخوادم', '/#products'], ['المتجر', '/#marketplace'], ['أدوات الذكاء الاصطناعي', '/#agents'], ['الأسعار', '/#pricing'], ['الأمان', '/docs/security']]],
      ['المطورون', [['مرجع API', '/docs/api-reference'], ['سطر الأوامر', '/docs/cli'], ['Terraform', '/docs/api'], ['حزم SDK', '/docs/api'], ['حالة الخدمة', '#']]],
      ['الشركة', [['من نحن', '/about'], ['تواصل معنا', '/contact'], ['الوظائف', '/careers'], ['برنامج الشركاء', '/affiliates'], ['برنامج الموردين', '/contact']]],
      ['قانوني', [['شروط الخدمة', '/legal/terms'], ['سياسة الاستخدام المقبول', '/legal/acceptable-use'], ['الخصوصية', '/legal/privacy'], ['الاسترداد والإلغاء', '/legal/refunds'], ['اتفاقية مستوى الخدمة', '/legal/sla'], ['ملفات تعريف الارتباط', '/legal/cookies'], ['جميع المستندات القانونية', '/legal']]],
    ],
    copyright: 'Progrid. جميع الحقوق محفوظة.', builtOn: 'مبني على مصادر مفتوحة: Proxmox VE وCeph وTemporal وNATS',
    providedBy: 'تقدّم Progrid Technologies LLC الخدمات على هذا الموقع.',
    geoCredit: 'تحديد الموقع الجغرافي عبر DB-IP',
  },
};

/**
 * The progrid.sa storefront: the same brand and product, with what is local to customers in
 * Saudi Arabia. Riyal prices with VAT, mada and Apple Pay, e-invoices, and Progrid Arabia as the
 * contracting company. Nothing here says where Progrid is from or where servers are.
 */
function saStorefront(lang: Lang, base: Copy): Copy {
  const c = cloneCopy(base);
  if (lang === 'en') {
    c.meta = { title: 'Progrid: the developer cloud for people and AI agents. Prices in riyals.', description: 'Get a server in 60 seconds. Hourly billing in Saudi riyals with VAT shown before you pay, e-invoices, mada and Apple Pay, and API tokens your AI agents can use safely.' };
    c.hero.ctaPrimary = 'Start with free credit';
    c.hero.stats[1] = ['29 SAR / mo', 'Starter server, billed hourly'];
    c.terminal.ready = 'WordPress is ready at https://185.0.113.42 and billing at 0.04 SAR per hour';
    c.terminal.capNote = '# 50 SAR per month cap, delete needs approval';
    c.trust[0] = ['﷼', 'Prices in Saudi riyals', 'VAT shown before you pay. Local invoices from Progrid Arabia'];
    c.trust[1] = ['💳', 'Pay with mada, cards or Apple Pay', 'An e-invoice for every invoice, as ZATCA requires'];
    c.agents.points[0] = ['Spending cap per token', 'A 50 SAR monthly cap means the agent cannot create a 65 SAR server. Ever.'];
    c.agents.codeCap = '// 50 SAR per month';
    c.pricing.h2 = 'Simple and predictable. Priced in riyals, with VAT shown before you pay.';
    c.pricing.note = 'Prices are in Saudi riyals and exclude VAT. The total with 15% VAT is shown at checkout. ';
    c.compare.rows.splice(1, 0, ['E-invoices that meet ZATCA rules', 'Built in', 'Rarely', 'Varies'], ['Prices in riyals, VAT shown up front', 'Yes', 'Rarely', 'Yes']);
    c.cta.lead = 'Free credit for new teams. No card needed until you spend it. Cancel any hour.';
    c.footer.cols[3][1][2] = ['Privacy (PDPL)', '/legal/privacy'];
    c.footer.providedBy = 'In Saudi Arabia, Progrid services are provided and invoiced by Progrid Arabia.';
  } else if (lang === 'ar') {
    c.meta = { title: 'Progrid: سحابة المطورين للأفراد ووكلاء الذكاء الاصطناعي، بالريال السعودي', description: 'خادم جاهز خلال 60 ثانية. فوترة بالساعة بالريال السعودي مع إظهار ضريبة القيمة المضافة قبل الدفع، وفواتير إلكترونية، والدفع بمدى وApple Pay، ورموز API يستخدمها وكلاء الذكاء الاصطناعي بأمان.' };
    c.hero.ctaPrimary = 'ابدأ برصيد مجاني';
    c.hero.stats[1] = ['29 ريالًا شهريًا', 'خادم Starter بفوترة بالساعة'];
    c.terminal.ready = 'WordPress جاهز على https://185.0.113.42 بتكلفة 0.04 ريال في الساعة';
    c.terminal.capNote = '# حد 50 ريالًا شهريًا، والحذف يتطلب موافقة';
    c.trust[0] = ['﷼', 'الأسعار بالريال السعودي', 'تظهر ضريبة القيمة المضافة قبل الدفع، والفواتير محلية من Progrid Arabia'];
    c.trust[1] = ['💳', 'ادفع بمدى أو البطاقة أو Apple Pay', 'فاتورة إلكترونية لكل فاتورة وفق متطلبات هيئة الزكاة والضريبة والجمارك'];
    c.agents.points[0] = ['حد إنفاق لكل رمز', 'حد شهري قدره 50 ريالًا يعني أن الوكيل لا يستطيع إنشاء خادم بسعر 65 ريالًا. أبدًا.'];
    c.agents.codeCap = '// 50 ريالًا شهريًا';
    c.pricing.h2 = 'أسعار واضحة بالريال، وتظهر الضريبة قبل الدفع.';
    c.pricing.note = 'الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة. ويظهر الإجمالي شاملًا الضريبة 15% عند الدفع. ';
    c.compare.rows.splice(1, 0, ['فواتير إلكترونية وفق متطلبات الهيئة', 'مدمجة', 'نادرًا', 'يختلف'], ['الأسعار بالريال والضريبة واضحة مسبقًا', 'نعم', 'نادرًا', 'نعم']);
    c.cta.lead = 'رصيد مجاني للفرق الجديدة. لا تحتاج إلى بطاقة حتى تستهلكه. ويمكنك الإلغاء في أي ساعة.';
    c.footer.cols[3][1][2] = ['الخصوصية (نظام حماية البيانات الشخصية)', '/legal/privacy'];
    c.footer.providedBy = 'تقدّم Progrid Arabia خدمات Progrid وتصدر فواتيرها للعملاء في المملكة العربية السعودية.';
  } else {
    c.meta = { title: 'Progrid: insanlar ve yapay zeka ajanları için geliştirici bulutu. Riyal fiyatlar.', description: '60 saniyede sunucu. Suudi riyali ile saatlik faturalama, ödemeden önce gösterilen KDV, e-fatura, mada ve Apple Pay.' };
    c.hero.ctaPrimary = 'Ücretsiz kredi ile başla';
    c.hero.stats[1] = ['29 SAR / ay', 'Starter sunucu, saatlik faturalanır'];
    c.terminal.ready = 'WordPress https://185.0.113.42 adresinde hazır, saatlik ücret 0,04 SAR';
    c.terminal.capNote = '# aylık 50 SAR limit, silme onay ister';
    c.trust[0] = ['﷼', 'Suudi riyali ile fiyatlar', 'KDV ödemeden önce gösterilir. Faturalar Progrid Arabia’dan'];
    c.trust[1] = ['💳', 'mada, kart veya Apple Pay ile ödeyin', 'Her fatura için ZATCA kurallarına uygun e-fatura'];
    c.agents.points[0] = ['Token başına harcama limiti', 'Aylık 50 SAR limit, ajanın 65 SAR’lık sunucu oluşturamayacağı anlamına gelir. Asla.'];
    c.agents.codeCap = '// aylık 50 SAR';
    c.pricing.h2 = 'Basit ve öngörülebilir. Riyal fiyatlar, KDV ödemeden önce gösterilir.';
    c.pricing.note = 'Fiyatlar Suudi riyali cinsindendir ve KDV hariçtir. %15 KDV dahil toplam ödeme sırasında gösterilir. ';
    c.compare.rows.splice(1, 0, ['ZATCA kurallarına uygun e-fatura', 'Yerleşik', 'Nadiren', 'Değişir'], ['Riyal fiyat, KDV baştan görünür', 'Evet', 'Nadiren', 'Evet']);
    c.cta.lead = 'Yeni takımlara ücretsiz kredi. Harcayana kadar kart gerekmez. İstediğiniz saat iptal edin.';
    c.footer.cols[3][1][2] = ['Gizlilik (PDPL)', '/legal/privacy'];
    c.footer.providedBy = 'Suudi Arabistan’da Progrid hizmetleri Progrid Arabia tarafından sunulur ve faturalanır.';
  }
  return c;
}

/** Deep copy that keeps the noteTail function. */
function cloneCopy(c: Copy): Copy {
  const out = JSON.parse(JSON.stringify(c)) as Copy;
  out.pricing.noteTail = c.pricing.noteTail;
  return out;
}

const BASE: Record<Lang, Copy> = { en, tr, ar };
const SA: Record<Lang, Copy> = { en: saStorefront('en', en), tr: saStorefront('tr', tr), ar: saStorefront('ar', ar) };

export function getCopy(lang: Lang, site: Site): Copy {
  return site === 'sa' ? SA[lang] : BASE[lang];
}

/** The global copy, for callers without a storefront. */
export const COPY: Record<Lang, Copy> = BASE;
