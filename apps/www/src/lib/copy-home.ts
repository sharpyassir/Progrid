import type { Lang } from './copy';

/**
 * Text for the site navigation (mega menus), the homepage sections and the pricing page.
 * Links are site relative; components add the language prefix for pages that have one.
 */
export interface MenuItem { name: string; desc: string; href: string; soon?: boolean }
export interface MenuGroup { name: string; items: MenuItem[] }
export interface ShowcaseTab { key: string; label: string; title: string; body: string; bullets: string[]; cta: string; href: string; cards: { name: string; desc: string; href: string }[] }

export interface HomeCopy {
  announce: { text: string; link: string; href: string };
  menu: { products: string; solutions: string; developers: string; company: string; pricing: string; docs: string; allProducts: string; soon: string };
  productGroups: MenuGroup[];
  featured: { title: string; desc: string; href: string; cta: string };
  solutions: MenuItem[];
  developers: MenuItem[];
  company: MenuItem[];
  hero: { eyebrow: string; h1: string; lead: string; email: string; signUp: string; or: string; google: string; fine: string };
  builtOn: string;
  showcase: { eyebrow: string; h2: string; lead: string; tabs: ShowcaseTab[] };
  why: { eyebrow: string; h2: string; items: { title: string; body: string }[]; stats: [string, string][] };
  priceTeaser: { eyebrow: string; h2: string; lead: string; from: string; month: string; perGb: string; items: { name: string; desc: string; sarMinor: number; unit?: 'month' | 'gb' }[]; all: string; vat: string };
  useCases: { eyebrow: string; h2: string; lead: string; items: { title: string; body: string; href: string; link: string }[] };
  devs: { eyebrow: string; h2: string; lead: string; items: { title: string; body: string; href: string }[]; codeTitle: string };
  pricingPage: { title: string; description: string; h1: string; lead: string; calcNote: string };
}

const en: HomeCopy = {
  announce: { text: 'New: Progrid Connect. Build AI agents that work with your servers, databases and APIs.', link: 'See how it works', href: '/connect' },
  menu: { products: 'Products', solutions: 'Solutions', developers: 'Developers', company: 'Company', pricing: 'Pricing', docs: 'Docs', allProducts: 'See all products', soon: 'Soon' },
  productGroups: [
    { name: 'Compute', items: [
      { name: 'Servers', desc: 'NVMe virtual servers billed by the hour', href: '/docs/getting-started' },
      { name: 'Managed servers', desc: 'Updates, hardening and backups handled for you', href: '/docs/managed-servers' },
      { name: 'Kubernetes', desc: 'Managed control plane, your node pools', href: '/docs/kubernetes' },
      { name: 'App Platform', desc: 'Push code from Git and get a URL', href: '/docs/app-platform' },
    ] },
    { name: 'Storage', items: [
      { name: 'Volumes', desc: 'Block storage you attach and resize live', href: '/docs/volumes' },
      { name: 'Object storage', desc: 'S3 compatible buckets', href: '/docs/object-storage' },
      { name: 'Snapshots and backups', desc: 'On demand snapshots and daily backups', href: '/docs/snapshots' },
    ] },
    { name: 'Databases', items: [
      { name: 'PostgreSQL', desc: 'With pgvector and automatic failover', href: '/docs/databases' },
      { name: 'MySQL', desc: 'Managed, with nightly backups', href: '/docs/databases' },
      { name: 'Valkey', desc: 'Redis compatible cache and queues', href: '/docs/databases' },
    ] },
    { name: 'Networking', items: [
      { name: 'Load balancers', desc: 'Layer 4 and 7 with free TLS', href: '/docs/load-balancers' },
      { name: 'DNS', desc: 'Zones and records through the API', href: '/docs/dns' },
      { name: 'Firewalls and IPs', desc: 'Rules enforced on the host, public IPs', href: '/docs/networking' },
    ] },
    { name: 'AI and agents', items: [
      { name: 'Progrid Connect', desc: 'Build and deploy AI agents', href: '/connect' },
      { name: 'Agent tokens and MCP', desc: 'Spending caps and approvals for AI tools', href: '/docs/agents' },
      { name: 'Inference gateway', desc: 'One endpoint for many models', href: '/docs/agents', soon: true },
    ] },
    { name: 'Operations', items: [
      { name: 'Monitoring and alerts', desc: 'Graphs and alerts by email and webhook', href: '/docs/monitoring' },
      { name: 'Managed Cloud', desc: 'Our engineers run your infrastructure', href: '/docs/managed-cloud' },
      { name: 'Support plans', desc: 'From free to premium response targets', href: '/docs/support' },
    ] },
  ],
  featured: { title: 'Marketplace', desc: 'One click apps: WordPress, n8n, Odoo, Coolify, Ollama and more.', href: '/#marketplace', cta: 'Browse apps' },
  solutions: [
    { name: 'Websites and WordPress', desc: 'Sites and stores on fast NVMe servers', href: '/docs/getting-started' },
    { name: 'SaaS and APIs', desc: 'Apps, databases and load balancers on one API', href: '/docs/app-platform' },
    { name: 'AI agents', desc: 'Agents with tools, budgets and approvals', href: '/connect' },
    { name: 'Business apps', desc: 'Odoo, n8n and Nextcloud in one click', href: '/#marketplace' },
    { name: 'Agencies', desc: 'Projects per client, one invoice', href: '/docs/billing' },
    { name: 'Managed infrastructure', desc: 'Let our engineers run it for you', href: '/docs/managed-cloud' },
  ],
  developers: [
    { name: 'Documentation', desc: 'Quickstarts and guides for every product', href: '/docs' },
    { name: 'API reference', desc: 'Every endpoint, with examples', href: '/docs/api-reference' },
    { name: 'CLI', desc: 'The prgd command line tool', href: '/docs/cli' },
    { name: 'Terraform and SDKs', desc: 'Infrastructure as code, TypeScript and Python', href: '/docs/api' },
    { name: 'MCP server', desc: 'Progrid tools for Claude Code and Cursor', href: '/docs/agents' },
    { name: 'Git deploy', desc: 'Deploy on every push', href: '/docs/git-deploy' },
  ],
  company: [
    { name: 'About us', desc: 'Who we are and how we work', href: '/about' },
    { name: 'Careers', desc: 'Build the cloud with us', href: '/careers' },
    { name: 'Contact', desc: 'Sales, support and partnerships', href: '/contact' },
    { name: 'Affiliate program', desc: 'Earn commission for every customer you refer', href: '/affiliates' },
    { name: 'Legal', desc: 'Terms, privacy and policies', href: '/legal' },
  ],
  hero: {
    eyebrow: 'The developer cloud for people and AI agents',
    h1: 'Build, deploy and scale on a simpler cloud',
    lead: 'Servers in 60 seconds, managed databases, Kubernetes and an app platform on one API. Hourly billing that never passes the monthly price, and support from the engineers who run it.',
    email: 'Work email', signUp: 'Sign up', or: 'or', google: 'Sign up with Google',
    fine: 'Free credit for new teams. No commitment, cancel any hour.',
  },
  builtOn: 'Built on proven open source',
  showcase: {
    eyebrow: 'Products', h2: 'Everything you need to run your apps', lead: 'Pick a category to see what it includes. Every product works the same way from the console, the CLI, Terraform and your AI tools.',
    tabs: [
      { key: 'compute', label: 'Compute', title: 'Servers that are ready in a minute', body: 'NVMe virtual servers with a public IP and generous transfer. Add our managed tier for updates, hardening and backups, or run containers on Kubernetes and the App Platform.', bullets: ['Hourly billing, capped at the monthly price', 'Snapshots, rebuilds and resizes from the API', 'One click apps from the marketplace'], cta: 'Start with Servers', href: '/docs/getting-started',
        cards: [{ name: 'Servers', desc: 'From 1 to 8 vCPU', href: '/docs/getting-started' }, { name: 'Managed servers', desc: 'We patch and back up', href: '/docs/managed-servers' }, { name: 'Kubernetes', desc: 'Managed control plane', href: '/docs/kubernetes' }, { name: 'App Platform', desc: 'Push code, get a URL', href: '/docs/app-platform' }] },
      { key: 'storage', label: 'Storage', title: 'Storage that grows with you', body: 'Attach block volumes to any server, keep files in S3 compatible buckets, and protect everything with snapshots and daily backups.', bullets: ['Resize volumes without downtime', 'Works with every S3 client and SDK', 'Backups for 20% of the plan price'], cta: 'Explore storage', href: '/docs/volumes',
        cards: [{ name: 'Volumes', desc: 'Block storage', href: '/docs/volumes' }, { name: 'Object storage', desc: 'S3 compatible', href: '/docs/object-storage' }, { name: 'Snapshots', desc: 'On demand', href: '/docs/snapshots' }, { name: 'Backups', desc: 'Every day', href: '/docs/snapshots' }] },
      { key: 'databases', label: 'Databases', title: 'Managed databases with failover', body: 'PostgreSQL with pgvector, MySQL and Valkey on one or three nodes. We handle failover, backups and upgrades; you get a connection string.', bullets: ['Automatic failover on three nodes', 'Nightly backups to object storage', 'Only trusted sources can connect'], cta: 'Explore databases', href: '/docs/databases',
        cards: [{ name: 'PostgreSQL', desc: 'With pgvector', href: '/docs/databases' }, { name: 'MySQL', desc: 'For WordPress and Odoo', href: '/docs/databases' }, { name: 'Valkey', desc: 'Cache and queues', href: '/docs/databases' }] },
      { key: 'networking', label: 'Networking', title: 'Networking without the plumbing', body: 'Load balancers with free certificates, DNS zones through the API, firewalls enforced on the host and a public IP with every server.', bullets: ['Layer 4 and layer 7 load balancing', 'Reverse DNS for every public IP', 'Firewall rules no server can bypass'], cta: 'Explore networking', href: '/docs/networking',
        cards: [{ name: 'Load balancers', desc: 'With TLS', href: '/docs/load-balancers' }, { name: 'DNS', desc: 'Zones and records', href: '/docs/dns' }, { name: 'Firewalls', desc: 'Host enforced', href: '/docs/networking' }, { name: 'Public IPs', desc: 'Included', href: '/docs/networking' }] },
      { key: 'ai', label: 'AI and agents', title: 'A cloud your AI tools can use safely', body: 'Build agents with Progrid Connect, or give Claude, Cursor and n8n a token with a monthly spending cap. Destructive actions wait for a person to approve.', bullets: ['Spending caps enforced by the API', 'Approval queue for risky actions', 'Native MCP server'], cta: 'Explore Progrid Connect', href: '/connect',
        cards: [{ name: 'Progrid Connect', desc: 'Agents and workflows', href: '/connect' }, { name: 'Agent tokens', desc: 'Caps and scopes', href: '/docs/agents' }, { name: 'MCP server', desc: 'One line setup', href: '/docs/agents' }] },
      { key: 'managed', label: 'Managed', title: 'Hand the operations to our engineers', body: 'From a managed tier on a single server to full Managed Cloud contracts with monitoring, patching, on call cover and monthly reports.', bullets: ['Published response targets', 'Recorded, time limited engineer access', 'Support plans from free to premium'], cta: 'Explore Managed Cloud', href: '/docs/managed-cloud',
        cards: [{ name: 'Managed servers', desc: 'Per server', href: '/docs/managed-servers' }, { name: 'Managed Cloud', desc: 'Contracts', href: '/docs/managed-cloud' }, { name: 'Support plans', desc: 'Free to premium', href: '/docs/support' }] },
    ],
  },
  why: {
    eyebrow: 'Why Progrid', h2: 'The tools of a big cloud. The clarity of a small bill.',
    items: [
      { title: 'Simple by design', body: 'A clean console and one API for everything. Every product is a workflow you can watch step by step.' },
      { title: 'Predictable pricing', body: 'Billed by the hour and never more than the monthly price. The whole price list is one API call.' },
      { title: 'Safe for automation', body: 'Scoped tokens with spending caps and approvals, so scripts and AI tools can work on your account.' },
      { title: 'Support that knows the stack', body: 'The engineers who run the platform answer your tickets, in Arabic and English.' },
    ],
    stats: [['60 s', 'from request to a running server'], ['4', 'server plans, one price list'], ['3', 'managed database engines'], ['1', 'API for the console, CLI, Terraform and agents']],
  },
  priceTeaser: {
    eyebrow: 'Pricing', h2: 'Predictable pricing, billed by the hour', lead: 'Start small and pay only for what you run. Every price is capped at the monthly amount.',
    from: 'From', month: '/mo', perGb: '/GB per month',
    items: [
      { name: 'Servers', desc: '1 vCPU, 2 GB memory, 40 GB NVMe', sarMinor: 2900 },
      { name: 'Managed servers', desc: 'Updates, hardening, backups and support', sarMinor: 19900 },
      { name: 'App Platform', desc: 'Per container instance', sarMinor: 1900 },
      { name: 'Object storage', desc: 'S3 compatible buckets', sarMinor: 8, unit: 'gb' },
    ],
    all: 'See all pricing', vat: 'Prices exclude VAT.',
  },
  useCases: {
    eyebrow: 'Solutions', h2: 'Built for what you are building', lead: 'Start from a use case and grow into the rest of the platform.',
    items: [
      { title: 'Websites and stores', body: 'WordPress, WooCommerce and Ghost on NVMe servers with daily backups.', href: '/#marketplace', link: 'One click apps' },
      { title: 'SaaS and APIs', body: 'Containers on the App Platform or Kubernetes, with managed PostgreSQL and load balancers.', href: '/docs/app-platform', link: 'App Platform' },
      { title: 'AI agents', body: 'Agents that use your servers, databases and APIs, with logs, versions and budgets.', href: '/connect', link: 'Progrid Connect' },
      { title: 'Business apps', body: 'Odoo, n8n, Nextcloud and Mattermost for your team, installed in a minute.', href: '/#marketplace', link: 'Marketplace' },
      { title: 'Agencies', body: 'A project per client, roles for your team and one clear invoice.', href: '/docs/billing', link: 'Projects and billing' },
      { title: 'Managed infrastructure', body: 'Our engineers monitor, patch and back up your servers under a contract.', href: '/docs/managed-cloud', link: 'Managed Cloud' },
    ],
  },
  devs: {
    eyebrow: 'Developers', h2: 'Made for developers, from the first command', lead: 'Everything in the console is in the API. Use the tool you prefer.',
    items: [
      { title: 'Documentation', body: 'Quickstarts and guides for every product.', href: '/docs' },
      { title: 'API reference', body: 'OpenAPI described, with scoped tokens.', href: '/docs/api-reference' },
      { title: 'CLI', body: 'Create and manage everything with prgd.', href: '/docs/cli' },
      { title: 'Terraform and SDKs', body: 'Infrastructure as code, TypeScript and Python clients.', href: '/docs/api' },
    ],
    codeTitle: 'Your first server from the command line',
  },
  pricingPage: { title: 'Pricing', description: 'Progrid prices for servers, managed servers, storage, databases and support. Billed by the hour, capped at the monthly price.', h1: 'Simple, predictable pricing', lead: 'Pay by the hour for what you run, never more than the monthly price. Bandwidth included, no surprise line items.', calcNote: 'The complete price list, including volumes, load balancers, Kubernetes and Connect, is one API call: GET /v1/pricing.' },
};

const ar: HomeCopy = {
  announce: { text: 'جديد: Progrid Connect. ابنِ وكلاء ذكاء اصطناعي يعملون مع خوادمك وقواعد بياناتك وواجهاتك البرمجية.', link: 'تعرّف عليه', href: '/connect' },
  menu: { products: 'المنتجات', solutions: 'الحلول', developers: 'المطورون', company: 'الشركة', pricing: 'الأسعار', docs: 'الوثائق', allProducts: 'كل المنتجات', soon: 'قريبًا' },
  productGroups: [
    { name: 'الحوسبة', items: [
      { name: 'الخوادم', desc: 'خوادم افتراضية NVMe تُفوتر بالساعة', href: '/docs/getting-started' },
      { name: 'الخوادم المُدارة', desc: 'نتولى التحديثات والتحصين والنسخ الاحتياطي', href: '/docs/managed-servers' },
      { name: 'Kubernetes', desc: 'لوحة تحكم مُدارة ومجموعات عُقد لك', href: '/docs/kubernetes' },
      { name: 'منصة التطبيقات', desc: 'ادفع الكود من Git واحصل على رابط', href: '/docs/app-platform' },
    ] },
    { name: 'التخزين', items: [
      { name: 'الأقراص', desc: 'تخزين كتلي تربطه وتوسعه دون توقف', href: '/docs/volumes' },
      { name: 'تخزين الكائنات', desc: 'حاويات متوافقة مع S3', href: '/docs/object-storage' },
      { name: 'اللقطات والنسخ الاحتياطي', desc: 'لقطات عند الطلب ونسخ يومية', href: '/docs/snapshots' },
    ] },
    { name: 'قواعد البيانات', items: [
      { name: 'PostgreSQL', desc: 'مع pgvector وتحويل تلقائي عند الأعطال', href: '/docs/databases' },
      { name: 'MySQL', desc: 'مُدارة مع نسخ احتياطي ليلي', href: '/docs/databases' },
      { name: 'Valkey', desc: 'ذاكرة تخزين مؤقت وطوابير متوافقة مع Redis', href: '/docs/databases' },
    ] },
    { name: 'الشبكات', items: [
      { name: 'موازنات الأحمال', desc: 'الطبقة 4 و7 مع شهادات TLS مجانية', href: '/docs/load-balancers' },
      { name: 'DNS', desc: 'مناطق وسجلات عبر الواجهة البرمجية', href: '/docs/dns' },
      { name: 'الجدران النارية والعناوين', desc: 'قواعد تُطبق على المضيف وعناوين عامة', href: '/docs/networking' },
    ] },
    { name: 'الذكاء الاصطناعي والوكلاء', items: [
      { name: 'Progrid Connect', desc: 'ابنِ وكلاء الذكاء الاصطناعي وانشرهم', href: '/connect' },
      { name: 'مفاتيح الوكلاء وMCP', desc: 'حدود إنفاق وموافقات لأدوات الذكاء الاصطناعي', href: '/docs/agents' },
      { name: 'بوابة الاستدلال', desc: 'نقطة واحدة لنماذج متعددة', href: '/docs/agents', soon: true },
    ] },
    { name: 'التشغيل', items: [
      { name: 'المراقبة والتنبيهات', desc: 'رسوم بيانية وتنبيهات بالبريد وwebhook', href: '/docs/monitoring' },
      { name: 'السحابة المُدارة', desc: 'مهندسونا يديرون بنيتك التحتية', href: '/docs/managed-cloud' },
      { name: 'خطط الدعم', desc: 'من المجانية إلى أسرع أوقات الاستجابة', href: '/docs/support' },
    ] },
  ],
  featured: { title: 'متجر التطبيقات', desc: 'تطبيقات بنقرة واحدة: WordPress وn8n وOdoo وCoolify وOllama وغيرها.', href: '/#marketplace', cta: 'تصفح التطبيقات' },
  solutions: [
    { name: 'المواقع وWordPress', desc: 'مواقع ومتاجر على خوادم NVMe سريعة', href: '/docs/getting-started' },
    { name: 'تطبيقات SaaS والواجهات البرمجية', desc: 'تطبيقات وقواعد بيانات وموازنات أحمال بواجهة واحدة', href: '/docs/app-platform' },
    { name: 'وكلاء الذكاء الاصطناعي', desc: 'وكلاء بأدوات وميزانيات وموافقات', href: '/connect' },
    { name: 'تطبيقات الأعمال', desc: 'Odoo وn8n وNextcloud بنقرة واحدة', href: '/#marketplace' },
    { name: 'الوكالات', desc: 'مشروع لكل عميل وفاتورة واحدة', href: '/docs/billing' },
    { name: 'البنية التحتية المُدارة', desc: 'دع مهندسينا يديرونها لك', href: '/docs/managed-cloud' },
  ],
  developers: [
    { name: 'الوثائق', desc: 'أدلة البدء والشرح لكل منتج', href: '/docs' },
    { name: 'مرجع الواجهة البرمجية', desc: 'كل نقطة نهاية مع أمثلة', href: '/docs/api-reference' },
    { name: 'سطر الأوامر', desc: 'أداة prgd', href: '/docs/cli' },
    { name: 'Terraform وحزم SDK', desc: 'البنية التحتية ككود وعملاء TypeScript وPython', href: '/docs/api' },
    { name: 'خادم MCP', desc: 'أدوات Progrid لـ Claude Code وCursor', href: '/docs/agents' },
    { name: 'النشر من Git', desc: 'انشر مع كل دفعة كود', href: '/docs/git-deploy' },
  ],
  company: [
    { name: 'من نحن', desc: 'من نحن وكيف نعمل', href: '/about' },
    { name: 'الوظائف', desc: 'ابنِ السحابة معنا', href: '/careers' },
    { name: 'تواصل معنا', desc: 'المبيعات والدعم والشراكات', href: '/contact' },
    { name: 'برنامج الشركاء', desc: 'اربح عمولة عن كل عميل تحيله', href: '/affiliates' },
    { name: 'القانونية', desc: 'الشروط والخصوصية والسياسات', href: '/legal' },
  ],
  hero: {
    eyebrow: 'سحابة المطورين للناس ولوكلاء الذكاء الاصطناعي',
    h1: 'ابنِ وانشر وتوسّع على سحابة أبسط',
    lead: 'خوادم جاهزة خلال 60 ثانية، وقواعد بيانات مُدارة، وKubernetes، ومنصة تطبيقات بواجهة برمجية واحدة. فوترة بالساعة لا تتجاوز السعر الشهري، ودعم من المهندسين الذين يشغّلون المنصة.',
    email: 'بريد العمل', signUp: 'سجّل', or: 'أو', google: 'سجّل بحساب Google',
    fine: 'رصيد مجاني للفرق الجديدة. بلا التزام، ويمكنك الإلغاء في أي ساعة.',
  },
  builtOn: 'مبنية على برمجيات مفتوحة المصدر موثوقة',
  showcase: {
    eyebrow: 'المنتجات', h2: 'كل ما تحتاجه لتشغيل تطبيقاتك', lead: 'اختر فئة لترى ما تتضمنه. كل منتج يعمل بالطريقة نفسها من لوحة التحكم وسطر الأوامر وTerraform وأدوات الذكاء الاصطناعي.',
    tabs: [
      { key: 'compute', label: 'الحوسبة', title: 'خوادم جاهزة خلال دقيقة', body: 'خوادم افتراضية NVMe مع عنوان IP عام ونقل بيانات وافر. أضف المستوى المُدار للتحديثات والتحصين والنسخ الاحتياطي، أو شغّل الحاويات على Kubernetes ومنصة التطبيقات.', bullets: ['فوترة بالساعة لا تتجاوز السعر الشهري', 'لقطات وإعادة بناء وتغيير حجم من الواجهة البرمجية', 'تطبيقات بنقرة واحدة من المتجر'], cta: 'ابدأ بالخوادم', href: '/docs/getting-started',
        cards: [{ name: 'الخوادم', desc: 'من 1 إلى 8 vCPU', href: '/docs/getting-started' }, { name: 'الخوادم المُدارة', desc: 'نحدّث وننسخ احتياطيًا', href: '/docs/managed-servers' }, { name: 'Kubernetes', desc: 'لوحة تحكم مُدارة', href: '/docs/kubernetes' }, { name: 'منصة التطبيقات', desc: 'ادفع الكود واحصل على رابط', href: '/docs/app-platform' }] },
      { key: 'storage', label: 'التخزين', title: 'تخزين ينمو معك', body: 'اربط أقراصًا كتلية بأي خادم، واحفظ ملفاتك في حاويات متوافقة مع S3، واحمِ كل شيء باللقطات والنسخ الاحتياطي اليومي.', bullets: ['توسيع الأقراص دون توقف', 'يعمل مع كل عملاء S3 وحزمها', 'نسخ احتياطي بنسبة 20% من سعر الخطة'], cta: 'استكشف التخزين', href: '/docs/volumes',
        cards: [{ name: 'الأقراص', desc: 'تخزين كتلي', href: '/docs/volumes' }, { name: 'تخزين الكائنات', desc: 'متوافق مع S3', href: '/docs/object-storage' }, { name: 'اللقطات', desc: 'عند الطلب', href: '/docs/snapshots' }, { name: 'النسخ الاحتياطي', desc: 'يوميًا', href: '/docs/snapshots' }] },
      { key: 'databases', label: 'قواعد البيانات', title: 'قواعد بيانات مُدارة مع التحويل التلقائي', body: 'PostgreSQL مع pgvector وMySQL وValkey على عقدة واحدة أو ثلاث. نتولى التحويل عند الأعطال والنسخ الاحتياطي والترقيات، وتحصل أنت على عنوان الاتصال.', bullets: ['تحويل تلقائي على ثلاث عقد', 'نسخ احتياطي ليلي إلى تخزين الكائنات', 'الاتصال من المصادر الموثوقة فقط'], cta: 'استكشف قواعد البيانات', href: '/docs/databases',
        cards: [{ name: 'PostgreSQL', desc: 'مع pgvector', href: '/docs/databases' }, { name: 'MySQL', desc: 'لـ WordPress وOdoo', href: '/docs/databases' }, { name: 'Valkey', desc: 'تخزين مؤقت وطوابير', href: '/docs/databases' }] },
      { key: 'networking', label: 'الشبكات', title: 'شبكات بلا تعقيد', body: 'موازنات أحمال بشهادات مجانية، ومناطق DNS عبر الواجهة البرمجية، وجدران نارية تُطبق على المضيف، وعنوان IP عام مع كل خادم.', bullets: ['موازنة أحمال على الطبقتين 4 و7', 'DNS عكسي لكل عنوان عام', 'قواعد جدار ناري لا يتجاوزها أي خادم'], cta: 'استكشف الشبكات', href: '/docs/networking',
        cards: [{ name: 'موازنات الأحمال', desc: 'مع TLS', href: '/docs/load-balancers' }, { name: 'DNS', desc: 'مناطق وسجلات', href: '/docs/dns' }, { name: 'الجدران النارية', desc: 'على المضيف', href: '/docs/networking' }, { name: 'العناوين العامة', desc: 'مشمولة', href: '/docs/networking' }] },
      { key: 'ai', label: 'الذكاء الاصطناعي', title: 'سحابة تستخدمها أدوات الذكاء الاصطناعي بأمان', body: 'ابنِ وكلاء باستخدام Progrid Connect، أو امنح Claude وCursor وn8n مفتاحًا بحد إنفاق شهري. الإجراءات الخطرة تنتظر موافقة شخص.', bullets: ['حدود إنفاق تطبقها الواجهة البرمجية', 'قائمة موافقات للإجراءات الحساسة', 'خادم MCP مدمج'], cta: 'استكشف Progrid Connect', href: '/connect',
        cards: [{ name: 'Progrid Connect', desc: 'وكلاء ومسارات عمل', href: '/connect' }, { name: 'مفاتيح الوكلاء', desc: 'حدود وصلاحيات', href: '/docs/agents' }, { name: 'خادم MCP', desc: 'إعداد بسطر واحد', href: '/docs/agents' }] },
      { key: 'managed', label: 'الخدمات المُدارة', title: 'سلّم التشغيل لمهندسينا', body: 'من المستوى المُدار لخادم واحد إلى عقود السحابة المُدارة الكاملة مع المراقبة والتحديثات والمناوبة والتقارير الشهرية.', bullets: ['أهداف استجابة معلنة', 'وصول المهندسين مسجل ومحدد بوقت', 'خطط دعم من المجانية إلى المميزة'], cta: 'استكشف السحابة المُدارة', href: '/docs/managed-cloud',
        cards: [{ name: 'الخوادم المُدارة', desc: 'لكل خادم', href: '/docs/managed-servers' }, { name: 'السحابة المُدارة', desc: 'عقود', href: '/docs/managed-cloud' }, { name: 'خطط الدعم', desc: 'من المجانية إلى المميزة', href: '/docs/support' }] },
    ],
  },
  why: {
    eyebrow: 'لماذا Progrid', h2: 'أدوات سحابة كبيرة ووضوح فاتورة صغيرة.',
    items: [
      { title: 'بسيطة في تصميمها', body: 'لوحة تحكم واضحة وواجهة برمجية واحدة لكل شيء. كل منتج مسار عمل تتابعه خطوة بخطوة.' },
      { title: 'أسعار متوقعة', body: 'فوترة بالساعة لا تتجاوز السعر الشهري. قائمة الأسعار كاملة في طلب واحد للواجهة البرمجية.' },
      { title: 'آمنة للأتمتة', body: 'مفاتيح بصلاحيات محددة وحدود إنفاق وموافقات، لتعمل السكربتات وأدوات الذكاء الاصطناعي على حسابك بأمان.' },
      { title: 'دعم يعرف المنصة', body: 'المهندسون الذين يشغّلون المنصة يردون على تذاكرك بالعربية والإنجليزية.' },
    ],
    stats: [['60 ث', 'من الطلب إلى خادم يعمل'], ['4', 'خطط خوادم وقائمة أسعار واحدة'], ['3', 'محركات قواعد بيانات مُدارة'], ['1', 'واجهة برمجية للوحة التحكم وسطر الأوامر وTerraform والوكلاء']],
  },
  priceTeaser: {
    eyebrow: 'الأسعار', h2: 'أسعار متوقعة تُفوتر بالساعة', lead: 'ابدأ صغيرًا وادفع فقط مقابل ما تشغّله. كل سعر لا يتجاوز المبلغ الشهري.',
    from: 'من', month: '/شهريًا', perGb: '/GB شهريًا',
    items: [
      { name: 'الخوادم', desc: '1 vCPU و2 GB ذاكرة و40 GB NVMe', sarMinor: 2900 },
      { name: 'الخوادم المُدارة', desc: 'تحديثات وتحصين ونسخ احتياطي ودعم', sarMinor: 19900 },
      { name: 'منصة التطبيقات', desc: 'لكل نسخة حاوية', sarMinor: 1900 },
      { name: 'تخزين الكائنات', desc: 'حاويات متوافقة مع S3', sarMinor: 8, unit: 'gb' },
    ],
    all: 'كل الأسعار', vat: 'الأسعار لا تشمل ضريبة القيمة المضافة.',
  },
  useCases: {
    eyebrow: 'الحلول', h2: 'مصممة لما تبنيه', lead: 'ابدأ من حالة استخدام وتوسّع في بقية المنصة.',
    items: [
      { title: 'المواقع والمتاجر', body: 'WordPress وWooCommerce وGhost على خوادم NVMe مع نسخ احتياطي يومي.', href: '/#marketplace', link: 'تطبيقات بنقرة واحدة' },
      { title: 'تطبيقات SaaS والواجهات البرمجية', body: 'حاويات على منصة التطبيقات أو Kubernetes مع PostgreSQL مُدارة وموازنات أحمال.', href: '/docs/app-platform', link: 'منصة التطبيقات' },
      { title: 'وكلاء الذكاء الاصطناعي', body: 'وكلاء يستخدمون خوادمك وقواعد بياناتك وواجهاتك البرمجية، مع سجلات وإصدارات وميزانيات.', href: '/connect', link: 'Progrid Connect' },
      { title: 'تطبيقات الأعمال', body: 'Odoo وn8n وNextcloud وMattermost لفريقك، جاهزة خلال دقيقة.', href: '/#marketplace', link: 'المتجر' },
      { title: 'الوكالات', body: 'مشروع لكل عميل، وأدوار لفريقك، وفاتورة واحدة واضحة.', href: '/docs/billing', link: 'المشاريع والفوترة' },
      { title: 'البنية التحتية المُدارة', body: 'مهندسونا يراقبون خوادمك ويحدّثونها وينسخونها احتياطيًا بموجب عقد.', href: '/docs/managed-cloud', link: 'السحابة المُدارة' },
    ],
  },
  devs: {
    eyebrow: 'المطورون', h2: 'مصممة للمطورين من أول أمر', lead: 'كل ما في لوحة التحكم موجود في الواجهة البرمجية. استخدم الأداة التي تفضلها.',
    items: [
      { title: 'الوثائق', body: 'أدلة البدء والشرح لكل منتج.', href: '/docs' },
      { title: 'مرجع الواجهة البرمجية', body: 'موصوفة بـ OpenAPI ومفاتيح بصلاحيات محددة.', href: '/docs/api-reference' },
      { title: 'سطر الأوامر', body: 'أنشئ كل شيء وأدره باستخدام prgd.', href: '/docs/cli' },
      { title: 'Terraform وحزم SDK', body: 'البنية التحتية ككود وعملاء TypeScript وPython.', href: '/docs/api' },
    ],
    codeTitle: 'أول خادم لك من سطر الأوامر',
  },
  pricingPage: { title: 'الأسعار', description: 'أسعار Progrid للخوادم والخوادم المُدارة والتخزين وقواعد البيانات والدعم. فوترة بالساعة لا تتجاوز السعر الشهري.', h1: 'أسعار بسيطة ومتوقعة', lead: 'ادفع بالساعة مقابل ما تشغّله، ولا يتجاوز ذلك السعر الشهري أبدًا. نقل البيانات مشمول ولا بنود مفاجئة.', calcNote: 'قائمة الأسعار الكاملة، بما فيها الأقراص وموازنات الأحمال وKubernetes وConnect، في طلب واحد: GET /v1/pricing.' },
};

const tr: HomeCopy = {
  announce: { text: 'Yeni: Progrid Connect. Sunucularınız, veritabanlarınız ve API’lerinizle çalışan yapay zeka ajanları oluşturun.', link: 'Nasıl çalışır', href: '/connect' },
  menu: { products: 'Ürünler', solutions: 'Çözümler', developers: 'Geliştiriciler', company: 'Şirket', pricing: 'Fiyatlar', docs: 'Belgeler', allProducts: 'Tüm ürünler', soon: 'Yakında' },
  productGroups: [
    { name: 'Hesaplama', items: [
      { name: 'Sunucular', desc: 'Saatlik faturalanan NVMe sanal sunucular', href: '/docs/getting-started' },
      { name: 'Yönetilen sunucular', desc: 'Güncelleme, sıkılaştırma ve yedekleme bizde', href: '/docs/managed-servers' },
      { name: 'Kubernetes', desc: 'Yönetilen kontrol düzlemi, sizin düğüm havuzlarınız', href: '/docs/kubernetes' },
      { name: 'Uygulama Platformu', desc: 'Git’ten kod gönderin, adres alın', href: '/docs/app-platform' },
    ] },
    { name: 'Depolama', items: [
      { name: 'Diskler', desc: 'Canlı bağlayıp büyütebileceğiniz blok depolama', href: '/docs/volumes' },
      { name: 'Nesne depolama', desc: 'S3 uyumlu kovalar', href: '/docs/object-storage' },
      { name: 'Anlık görüntüler ve yedekler', desc: 'İsteğe bağlı görüntüler ve günlük yedekler', href: '/docs/snapshots' },
    ] },
    { name: 'Veritabanları', items: [
      { name: 'PostgreSQL', desc: 'pgvector ve otomatik yük devretme ile', href: '/docs/databases' },
      { name: 'MySQL', desc: 'Yönetilen, gece yedekli', href: '/docs/databases' },
      { name: 'Valkey', desc: 'Redis uyumlu önbellek ve kuyruklar', href: '/docs/databases' },
    ] },
    { name: 'Ağ', items: [
      { name: 'Yük dengeleyiciler', desc: 'Ücretsiz TLS ile katman 4 ve 7', href: '/docs/load-balancers' },
      { name: 'DNS', desc: 'API ile bölgeler ve kayıtlar', href: '/docs/dns' },
      { name: 'Güvenlik duvarları ve IP’ler', desc: 'Sunucu üzerinde uygulanan kurallar', href: '/docs/networking' },
    ] },
    { name: 'Yapay zeka ve ajanlar', items: [
      { name: 'Progrid Connect', desc: 'Yapay zeka ajanları oluşturun ve yayınlayın', href: '/connect' },
      { name: 'Ajan tokenları ve MCP', desc: 'Yapay zeka araçları için limit ve onay', href: '/docs/agents' },
      { name: 'Çıkarım geçidi', desc: 'Birçok model için tek uç nokta', href: '/docs/agents', soon: true },
    ] },
    { name: 'Operasyon', items: [
      { name: 'İzleme ve uyarılar', desc: 'Grafikler, e-posta ve webhook uyarıları', href: '/docs/monitoring' },
      { name: 'Yönetilen Bulut', desc: 'Mühendislerimiz altyapınızı işletir', href: '/docs/managed-cloud' },
      { name: 'Destek planları', desc: 'Ücretsizden premium yanıt hedeflerine', href: '/docs/support' },
    ] },
  ],
  featured: { title: 'Uygulama Mağazası', desc: 'Tek tık uygulamalar: WordPress, n8n, Odoo, Coolify, Ollama ve daha fazlası.', href: '/#marketplace', cta: 'Uygulamalara göz atın' },
  solutions: [
    { name: 'Web siteleri ve WordPress', desc: 'Hızlı NVMe sunucularda siteler ve mağazalar', href: '/docs/getting-started' },
    { name: 'SaaS ve API’ler', desc: 'Uygulamalar, veritabanları ve yük dengeleyiciler tek API’de', href: '/docs/app-platform' },
    { name: 'Yapay zeka ajanları', desc: 'Araçlı, bütçeli ve onaylı ajanlar', href: '/connect' },
    { name: 'İş uygulamaları', desc: 'Odoo, n8n ve Nextcloud tek tıkla', href: '/#marketplace' },
    { name: 'Ajanslar', desc: 'Müşteri başına proje, tek fatura', href: '/docs/billing' },
    { name: 'Yönetilen altyapı', desc: 'Mühendislerimiz sizin için işletsin', href: '/docs/managed-cloud' },
  ],
  developers: [
    { name: 'Belgeler', desc: 'Her ürün için hızlı başlangıç ve rehberler', href: '/docs' },
    { name: 'API referansı', desc: 'Örnekleriyle her uç nokta', href: '/docs/api-reference' },
    { name: 'CLI', desc: 'prgd komut satırı aracı', href: '/docs/cli' },
    { name: 'Terraform ve SDK’lar', desc: 'Kod olarak altyapı, TypeScript ve Python', href: '/docs/api' },
    { name: 'MCP sunucusu', desc: 'Claude Code ve Cursor için Progrid araçları', href: '/docs/agents' },
    { name: 'Git ile dağıtım', desc: 'Her gönderimde dağıtın', href: '/docs/git-deploy' },
  ],
  company: [
    { name: 'Hakkımızda', desc: 'Biz kimiz, nasıl çalışırız', href: '/about' },
    { name: 'Kariyer', desc: 'Bulutu bizimle kurun', href: '/careers' },
    { name: 'İletişim', desc: 'Satış, destek ve iş ortaklıkları', href: '/contact' },
    { name: 'Ortaklık programı', desc: 'Yönlendirdiğiniz her müşteriden komisyon kazanın', href: '/affiliates' },
    { name: 'Hukuki', desc: 'Koşullar, gizlilik ve politikalar', href: '/legal' },
  ],
  hero: {
    eyebrow: 'İnsanlar ve yapay zeka ajanları için geliştirici bulutu',
    h1: 'Daha sade bir bulutta geliştirin, yayınlayın, büyüyün',
    lead: '60 saniyede sunucular, yönetilen veritabanları, Kubernetes ve uygulama platformu tek API’de. Aylık fiyatı asla aşmayan saatlik faturalama ve platformu işleten mühendislerden destek.',
    email: 'İş e-postası', signUp: 'Kaydol', or: 'veya', google: 'Google ile kaydol',
    fine: 'Yeni takımlara ücretsiz kredi. Taahhüt yok, istediğiniz saat iptal edin.',
  },
  builtOn: 'Kanıtlanmış açık kaynak üzerine kurulu',
  showcase: {
    eyebrow: 'Ürünler', h2: 'Uygulamalarınızı çalıştırmak için gereken her şey', lead: 'İçeriğini görmek için bir kategori seçin. Her ürün konsolda, CLI’de, Terraform’da ve yapay zeka araçlarınızda aynı şekilde çalışır.',
    tabs: [
      { key: 'compute', label: 'Hesaplama', title: 'Bir dakikada hazır sunucular', body: 'Genel IP ve bol trafik ile NVMe sanal sunucular. Güncelleme, sıkılaştırma ve yedekleme için yönetilen katmanı ekleyin veya kapsayıcıları Kubernetes ve Uygulama Platformu’nda çalıştırın.', bullets: ['Aylık fiyatla sınırlı saatlik faturalama', 'API’den anlık görüntü, yeniden kurma ve boyutlandırma', 'Mağazadan tek tık uygulamalar'], cta: 'Sunucularla başlayın', href: '/docs/getting-started',
        cards: [{ name: 'Sunucular', desc: '1 ile 8 vCPU arası', href: '/docs/getting-started' }, { name: 'Yönetilen sunucular', desc: 'Güncelleme ve yedek bizde', href: '/docs/managed-servers' }, { name: 'Kubernetes', desc: 'Yönetilen kontrol düzlemi', href: '/docs/kubernetes' }, { name: 'Uygulama Platformu', desc: 'Kodu gönder, adres al', href: '/docs/app-platform' }] },
      { key: 'storage', label: 'Depolama', title: 'Sizinle büyüyen depolama', body: 'Herhangi bir sunucuya blok disk bağlayın, dosyaları S3 uyumlu kovalarda tutun ve her şeyi anlık görüntüler ve günlük yedeklerle koruyun.', bullets: ['Kesintisiz disk büyütme', 'Her S3 istemcisi ve SDK ile çalışır', 'Plan fiyatının %20’sine yedekleme'], cta: 'Depolamayı keşfedin', href: '/docs/volumes',
        cards: [{ name: 'Diskler', desc: 'Blok depolama', href: '/docs/volumes' }, { name: 'Nesne depolama', desc: 'S3 uyumlu', href: '/docs/object-storage' }, { name: 'Anlık görüntüler', desc: 'İsteğe bağlı', href: '/docs/snapshots' }, { name: 'Yedekler', desc: 'Her gün', href: '/docs/snapshots' }] },
      { key: 'databases', label: 'Veritabanları', title: 'Yük devretmeli yönetilen veritabanları', body: 'Bir veya üç düğümde pgvector ile PostgreSQL, MySQL ve Valkey. Yük devretme, yedekleme ve yükseltmeleri biz yaparız; siz bağlantı adresini alırsınız.', bullets: ['Üç düğümde otomatik yük devretme', 'Nesne depolamaya gece yedekleri', 'Yalnızca güvenilen kaynaklar bağlanır'], cta: 'Veritabanlarını keşfedin', href: '/docs/databases',
        cards: [{ name: 'PostgreSQL', desc: 'pgvector ile', href: '/docs/databases' }, { name: 'MySQL', desc: 'WordPress ve Odoo için', href: '/docs/databases' }, { name: 'Valkey', desc: 'Önbellek ve kuyruklar', href: '/docs/databases' }] },
      { key: 'networking', label: 'Ağ', title: 'Tesisat derdi olmadan ağ', body: 'Ücretsiz sertifikalı yük dengeleyiciler, API ile DNS bölgeleri, sunucu üzerinde uygulanan güvenlik duvarları ve her sunucuya bir genel IP.', bullets: ['Katman 4 ve katman 7 yük dengeleme', 'Her genel IP için ters DNS', 'Hiçbir sunucunun aşamayacağı kurallar'], cta: 'Ağı keşfedin', href: '/docs/networking',
        cards: [{ name: 'Yük dengeleyiciler', desc: 'TLS ile', href: '/docs/load-balancers' }, { name: 'DNS', desc: 'Bölgeler ve kayıtlar', href: '/docs/dns' }, { name: 'Güvenlik duvarları', desc: 'Sunucuda uygulanır', href: '/docs/networking' }, { name: 'Genel IP’ler', desc: 'Dahil', href: '/docs/networking' }] },
      { key: 'ai', label: 'Yapay zeka', title: 'Yapay zeka araçlarınızın güvenle kullanabileceği bir bulut', body: 'Progrid Connect ile ajanlar oluşturun veya Claude, Cursor ve n8n’e aylık harcama limitli bir token verin. Yıkıcı işlemler bir kişinin onayını bekler.', bullets: ['API’nin uyguladığı harcama limitleri', 'Riskli işlemler için onay kuyruğu', 'Yerleşik MCP sunucusu'], cta: 'Progrid Connect’i keşfedin', href: '/connect',
        cards: [{ name: 'Progrid Connect', desc: 'Ajanlar ve iş akışları', href: '/connect' }, { name: 'Ajan tokenları', desc: 'Limit ve yetki', href: '/docs/agents' }, { name: 'MCP sunucusu', desc: 'Tek satır kurulum', href: '/docs/agents' }] },
      { key: 'managed', label: 'Yönetilen', title: 'Operasyonu mühendislerimize bırakın', body: 'Tek sunucuda yönetilen katmandan izleme, yama, nöbet ve aylık raporlar içeren tam Yönetilen Bulut sözleşmelerine kadar.', bullets: ['Yayınlanmış yanıt hedefleri', 'Kayıtlı, süreli mühendis erişimi', 'Ücretsizden premiuma destek planları'], cta: 'Yönetilen Bulut’u keşfedin', href: '/docs/managed-cloud',
        cards: [{ name: 'Yönetilen sunucular', desc: 'Sunucu başına', href: '/docs/managed-servers' }, { name: 'Yönetilen Bulut', desc: 'Sözleşmeler', href: '/docs/managed-cloud' }, { name: 'Destek planları', desc: 'Ücretsizden premiuma', href: '/docs/support' }] },
    ],
  },
  why: {
    eyebrow: 'Neden Progrid', h2: 'Büyük bir bulutun araçları. Küçük bir faturanın netliği.',
    items: [
      { title: 'Tasarımı gereği sade', body: 'Temiz bir konsol ve her şey için tek API. Her ürün adım adım izleyebileceğiniz bir iş akışıdır.' },
      { title: 'Öngörülebilir fiyat', body: 'Saatlik faturalanır, aylık fiyatı asla aşmaz. Tüm fiyat listesi tek API çağrısı.' },
      { title: 'Otomasyon için güvenli', body: 'Harcama limitli ve onaylı, kapsamı belirli tokenlar; betikler ve yapay zeka araçları hesabınızda güvenle çalışır.' },
      { title: 'Altyapıyı bilen destek', body: 'Platformu işleten mühendisler taleplerinizi Arapça ve İngilizce yanıtlar.' },
    ],
    stats: [['60 sn', 'istekten çalışan sunucuya'], ['4', 'sunucu planı, tek fiyat listesi'], ['3', 'yönetilen veritabanı motoru'], ['1', 'konsol, CLI, Terraform ve ajanlar için tek API']],
  },
  priceTeaser: {
    eyebrow: 'Fiyatlar', h2: 'Saatlik faturalanan öngörülebilir fiyatlar', lead: 'Küçük başlayın, yalnızca çalıştırdığınız kadar ödeyin. Her fiyat aylık tutarla sınırlıdır.',
    from: 'Başlangıç', month: '/ay', perGb: '/GB aylık',
    items: [
      { name: 'Sunucular', desc: '1 vCPU, 2 GB bellek, 40 GB NVMe', sarMinor: 2900 },
      { name: 'Yönetilen sunucular', desc: 'Güncelleme, sıkılaştırma, yedek ve destek', sarMinor: 19900 },
      { name: 'Uygulama Platformu', desc: 'Kapsayıcı örneği başına', sarMinor: 1900 },
      { name: 'Nesne depolama', desc: 'S3 uyumlu kovalar', sarMinor: 8, unit: 'gb' },
    ],
    all: 'Tüm fiyatlar', vat: 'Fiyatlara KDV dahil değildir.',
  },
  useCases: {
    eyebrow: 'Çözümler', h2: 'Ne geliştiriyorsanız onun için', lead: 'Bir kullanım senaryosundan başlayın, platformun geri kalanına büyüyün.',
    items: [
      { title: 'Web siteleri ve mağazalar', body: 'Günlük yedekli NVMe sunucularda WordPress, WooCommerce ve Ghost.', href: '/#marketplace', link: 'Tek tık uygulamalar' },
      { title: 'SaaS ve API’ler', body: 'Yönetilen PostgreSQL ve yük dengeleyicilerle Uygulama Platformu veya Kubernetes üzerinde kapsayıcılar.', href: '/docs/app-platform', link: 'Uygulama Platformu' },
      { title: 'Yapay zeka ajanları', body: 'Sunucularınızı, veritabanlarınızı ve API’lerinizi kullanan; kayıtlı, sürümlü ve bütçeli ajanlar.', href: '/connect', link: 'Progrid Connect' },
      { title: 'İş uygulamaları', body: 'Ekibiniz için Odoo, n8n, Nextcloud ve Mattermost, bir dakikada kurulu.', href: '/#marketplace', link: 'Mağaza' },
      { title: 'Ajanslar', body: 'Müşteri başına bir proje, ekibiniz için roller ve tek net fatura.', href: '/docs/billing', link: 'Projeler ve faturalama' },
      { title: 'Yönetilen altyapı', body: 'Mühendislerimiz sözleşmeyle sunucularınızı izler, günceller ve yedekler.', href: '/docs/managed-cloud', link: 'Yönetilen Bulut' },
    ],
  },
  devs: {
    eyebrow: 'Geliştiriciler', h2: 'İlk komuttan itibaren geliştiriciler için', lead: 'Konsoldaki her şey API’de de var. Tercih ettiğiniz aracı kullanın.',
    items: [
      { title: 'Belgeler', body: 'Her ürün için hızlı başlangıç ve rehberler.', href: '/docs' },
      { title: 'API referansı', body: 'OpenAPI ile tanımlı, kapsamlı tokenlar.', href: '/docs/api-reference' },
      { title: 'CLI', body: 'prgd ile her şeyi oluşturun ve yönetin.', href: '/docs/cli' },
      { title: 'Terraform ve SDK’lar', body: 'Kod olarak altyapı, TypeScript ve Python istemcileri.', href: '/docs/api' },
    ],
    codeTitle: 'Komut satırından ilk sunucunuz',
  },
  pricingPage: { title: 'Fiyatlar', description: 'Sunucular, yönetilen sunucular, depolama, veritabanları ve destek için Progrid fiyatları. Saatlik faturalanır, aylık fiyatla sınırlıdır.', h1: 'Sade ve öngörülebilir fiyatlar', lead: 'Çalıştırdığınız için saatlik ödeyin, aylık fiyatı asla aşmayın. Trafik dahil, sürpriz kalem yok.', calcNote: 'Diskler, yük dengeleyiciler, Kubernetes ve Connect dahil tam fiyat listesi tek API çağrısıdır: GET /v1/pricing.' },
};

const COPY: Record<Lang, HomeCopy> = { en, ar, tr };
export const getHomeCopy = (lang: Lang) => COPY[lang] ?? en;
