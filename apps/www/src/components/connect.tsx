import type { Metadata } from 'next';
import { Footer, Header, LangProvider } from '@/components/marketing';
import type { Lang } from '@/lib/copy';

const CONSOLE = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000';

interface ConnectCopy {
  metaTitle: string; metaDescription: string;
  eyebrow: string; h1: string; alt: string; lead: string; ctaPrimary: string; ctaSecondary: string; notChatbot: string;
  howEyebrow: string; howH2: string; steps: [string, string][];
  capEyebrow: string; capH2: string; capLead: string; caps: [string, string, string][];
  devEyebrow: string; devH2: string; devLead: string; devPoints: [string, string][];
  priceEyebrow: string; priceH2: string; priceLead: string;
  perExecution: string; executionNote: string; perToolCall: string; toolCallNote: string;
  tokensH3: string; tokenCols: [string, string, string, string, string]; vatNote: string; cacheNote: string;
  ctaH2: string; ctaLead: string;
}

/**
 * Launch prices in halalas, excluding VAT. They mirror the price book the API seeds
 * (apps/api/src/modules/connect/pricing.ts). Tokens: Anthropic list price plus 20%, per 1M.
 */
const PRICES = {
  executionMinor: 4,
  toolCallMinor: 2,
  models: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 1800, output: 9000, cacheRead: 90, cacheWrite: 2250 },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 900, output: 4500, cacheRead: 90, cacheWrite: 1125 },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 450, output: 2250, cacheRead: 45, cacheWrite: 562.5 },
  ],
};

const COPY: Record<Lang, ConnectCopy> = {
  en: {
    metaTitle: 'Progrid Connect: AI agents connected to everything',
    metaDescription: 'Build and deploy AI agents that connect to your infrastructure, APIs and applications. Test every step, then call your agent by API or webhook.',
    eyebrow: 'Progrid Connect', h1: 'Connect. Automate. Deploy.', alt: 'Your AI agents, connected to everything.',
    lead: 'Build and deploy AI agents that connect to your infrastructure, APIs and applications. Each agent gets tools, a workflow, versions, logs and its own API endpoint.',
    ctaPrimary: 'Create your first agent', ctaSecondary: 'Read the docs',
    notChatbot: 'Not a chatbot. Agents that do real work in your systems, with every step on the record.',
    howEyebrow: 'How it works', howH2: 'From an idea to a live API in four steps.',
    steps: [
      ['Create an agent', 'Write its instructions, describe it and let AI draft it, or start from a template.'],
      ['Connect tools', 'Add your APIs, databases, email, notifications and Progrid services. Credentials stay write-only.'],
      ['Test', 'Send a message or a JSON event and watch each model call, tool call and condition as it happens.'],
      ['Deploy', 'Save a version and deploy. You get an endpoint, API keys and webhook URLs.'],
    ],
    capEyebrow: 'Capabilities', capH2: 'Everything an agent needs to work in production.',
    capLead: 'Plain building blocks you already know: HTTP, SQL, webhooks and JSON. Nothing hidden.',
    caps: [
      ['↔', 'APIs', 'Call any REST endpoint with saved auth, headers and an allow list of hosts.'],
      ['⛁', 'Databases', 'Query PostgreSQL, MySQL and MongoDB. Read only by default, with allowed tables.'],
      ['⇄', 'Webhooks', 'Start runs from inbound webhooks with optional signatures, or post to outbound ones.'],
      ['✉', 'Email', 'Send email through Progrid mail or your own SMTP server.'],
      ['◉', 'Notifications', 'Alert people by email, webhook or in the Progrid console.'],
      ['☁', 'Progrid services', 'Read servers, metrics, databases and app logs. Changes wait for human approval.'],
      ['⑂', 'Workflows', 'Chain steps visually: triggers, agents, tools, conditions, actions and transforms.'],
      ['✦', 'Build with AI', 'Describe the agent in a sentence. Review the draft before anything is saved.'],
      ['▶', 'Testing', 'A live timeline with tokens, timing, API calls, errors and a cost estimate per run.'],
      ['{ }', 'API', 'Every agent has an endpoint, keys, structured output and generated docs.'],
      ['▦', 'Templates', 'Customer support, sales, data analysis, monitoring, research, developer and invoice agents.'],
    ],
    devEyebrow: 'For developers', devH2: 'Call your agent like any other API.',
    devLead: 'Agents return JSON you can rely on. Versions are immutable, deploys pin a version, and every run is logged with its steps.',
    devPoints: [
      ['Versioned', 'Snapshot instructions, tools and workflow. Roll back by deploying an older version.'],
      ['Observable', 'Logs for every run with inputs, outputs, tool calls, tokens and errors.'],
      ['Safe by default', 'Secrets are write-only, database access is read only, and risky actions need approval.'],
      ['Sync or async', 'Wait for the answer, or get a run ID at once and poll for the result.'],
    ],
    priceEyebrow: 'Pricing', priceH2: 'Pay only for what your agents use.',
    priceLead: 'Pay as you go. No monthly minimum. Every test and every run shows its estimated cost.',
    perExecution: 'per execution', executionNote: 'One agent run or one workflow execution.',
    perToolCall: 'per tool call', toolCallNote: 'Each API, database, email, notification or Progrid action an agent runs.',
    tokensH3: 'AI tokens, per 1M tokens', tokenCols: ['Model', 'Input', 'Output', 'Cache read', 'Cache write'],
    vatNote: 'Prices are in Saudi riyals and exclude 15% VAT.',
    cacheNote: 'Cache reads and writes come from prompt caching. It makes instructions that repeat on every call much cheaper.',
    ctaH2: 'Build your first agent today.', ctaLead: 'Progrid Connect is part of your Progrid account. Usage is metered per run, and your project spend limit applies.',
  },
  tr: {
    metaTitle: 'Progrid Connect: her şeye bağlı yapay zekâ ajanları',
    metaDescription: 'Altyapına, API’lerine ve uygulamalarına bağlanan yapay zekâ ajanları oluştur ve yayınla. Her adımı test et, sonra ajanını API veya webhook ile çağır.',
    eyebrow: 'Progrid Connect', h1: 'Bağla. Otomatikleştir. Yayınla.', alt: 'Yapay zekâ ajanların, her şeye bağlı.',
    lead: 'Altyapına, API’lerine ve uygulamalarına bağlanan yapay zekâ ajanları oluştur ve yayınla. Her ajanın araçları, iş akışı, sürümleri, kayıtları ve kendi API uç noktası olur.',
    ctaPrimary: 'İlk ajanını oluştur', ctaSecondary: 'Dokümanları oku',
    notChatbot: 'Bir sohbet botu değil. Sistemlerinde gerçek iş yapan, her adımı kayıt altında olan ajanlar.',
    howEyebrow: 'Nasıl çalışır', howH2: 'Bir fikirden canlı bir API’ye dört adım.',
    steps: [
      ['Ajan oluştur', 'Talimatlarını yaz, tarif et ve taslağı yapay zekâ hazırlasın ya da bir şablonla başla.'],
      ['Araçları bağla', 'API’lerini, veritabanlarını, e-postayı, bildirimleri ve Progrid hizmetlerini ekle. Kimlik bilgileri yalnızca yazılabilir kalır.'],
      ['Test et', 'Bir mesaj ya da JSON olayı gönder; her model çağrısını, araç çağrısını ve koşulu anında izle.'],
      ['Yayınla', 'Bir sürüm kaydet ve yayınla. Bir uç nokta, API anahtarları ve webhook URL’leri alırsın.'],
    ],
    capEyebrow: 'Yetenekler', capH2: 'Bir ajanın üretimde çalışması için gereken her şey.',
    capLead: 'Zaten bildiğin sade yapı taşları: HTTP, SQL, webhooklar ve JSON. Gizli hiçbir şey yok.',
    caps: [
      ['↔', 'API’ler', 'Kayıtlı kimlik doğrulama, başlıklar ve izinli sunucu listesiyle herhangi bir REST uç noktasını çağır.'],
      ['⛁', 'Veritabanları', 'PostgreSQL, MySQL ve MongoDB sorgula. Varsayılan olarak salt okunur, izinli tablolarla.'],
      ['⇄', 'Webhooklar', 'Gelen webhooklarla isteğe bağlı imzayla çalışma başlat ya da giden webhooklara gönder.'],
      ['✉', 'E-posta', 'Progrid e-postası ya da kendi SMTP sunucunla e-posta gönder.'],
      ['◉', 'Bildirimler', 'Kişileri e-posta, webhook ya da Progrid konsolu üzerinden uyar.'],
      ['☁', 'Progrid hizmetleri', 'Sunucuları, metrikleri, veritabanlarını ve uygulama kayıtlarını oku. Değişiklikler insan onayı bekler.'],
      ['⑂', 'İş akışları', 'Adımları görsel olarak zincirle: tetikleyiciler, ajanlar, araçlar, koşullar, eylemler ve dönüşümler.'],
      ['✦', 'Yapay zekâ ile oluştur', 'Ajanı bir cümleyle tarif et. Hiçbir şey kaydedilmeden önce taslağı incele.'],
      ['▶', 'Test', 'Her çalışma için token, süre, API çağrıları, hatalar ve maliyet tahmini içeren canlı zaman çizelgesi.'],
      ['{ }', 'API', 'Her ajanın bir uç noktası, anahtarları, yapılandırılmış çıktısı ve otomatik dokümanı vardır.'],
      ['▦', 'Şablonlar', 'Müşteri desteği, satış, veri analizi, izleme, araştırma, geliştirici ve fatura ajanları.'],
    ],
    devEyebrow: 'Geliştiriciler için', devH2: 'Ajanını diğer API’ler gibi çağır.',
    devLead: 'Ajanlar güvenebileceğin JSON döndürür. Sürümler değişmez, yayınlar bir sürüme sabitlenir ve her çalışma adımlarıyla kaydedilir.',
    devPoints: [
      ['Sürümlü', 'Talimatların, araçların ve iş akışının anlık görüntüsünü al. Eski bir sürümü yayınlayarak geri dön.'],
      ['İzlenebilir', 'Girdi, çıktı, araç çağrıları, token ve hatalarla her çalışmanın kaydı.'],
      ['Varsayılan olarak güvenli', 'Gizli değerler yalnızca yazılabilir, veritabanı erişimi salt okunur, riskli işlemler onay ister.'],
      ['Senkron ya da asenkron', 'Yanıtı bekle ya da hemen bir çalışma kimliği al ve sonucu sorgula.'],
    ],
    priceEyebrow: 'Fiyatlandırma', priceH2: 'Yalnızca ajanlarının kullandığı kadar öde.',
    priceLead: 'Kullandıkça öde. Aylık minimum yok. Her test ve her çalışma tahmini maliyetini gösterir.',
    perExecution: 'çalışma başına', executionNote: 'Bir ajan çalışması veya bir iş akışı çalışması.',
    perToolCall: 'araç çağrısı başına', toolCallNote: 'Ajanın çalıştırdığı her API, veritabanı, e-posta, bildirim veya Progrid işlemi.',
    tokensH3: 'Yapay zekâ tokenları, 1 milyon token başına', tokenCols: ['Model', 'Giriş', 'Çıkış', 'Önbellekten okuma', 'Önbelleğe yazma'],
    vatNote: 'Fiyatlar Suudi riyali cinsindendir ve %15 KDV hariçtir.',
    cacheNote: 'Önbellekten okuma ve önbelleğe yazma, istem önbelleklemesinden gelir. Her çağrıda tekrar eden talimatları çok daha ucuz hale getirir.',
    ctaH2: 'İlk ajanını bugün oluştur.', ctaLead: 'Progrid Connect, Progrid hesabının bir parçasıdır. Kullanım çalışma başına ölçülür ve proje harcama sınırın geçerlidir.',
  },
  ar: {
    metaTitle: 'Progrid Connect: وكلاء ذكاء اصطناعي متصلون بكل شيء',
    metaDescription: 'ابنِ وانشر وكلاء ذكاء اصطناعي يتصلون ببنيتك التحتية وواجهات API وتطبيقاتك. اختبر كل خطوة، ثم استدعِ وكيلك عبر API أو Webhook.',
    eyebrow: 'Progrid Connect', h1: 'اربط. أتمت. انشر.', alt: 'وكلاؤك الأذكياء، متصلون بكل شيء.',
    lead: 'ابنِ وانشر وكلاء ذكاء اصطناعي يتصلون ببنيتك التحتية وواجهات API وتطبيقاتك. لكل وكيل أدواته وسير عمله وإصداراته وسجلاته ونقطة API خاصة به.',
    ctaPrimary: 'أنشئ أول وكيل', ctaSecondary: 'اقرأ التوثيق',
    notChatbot: 'ليس روبوت محادثة. وكلاء ينجزون عملًا حقيقيًا في أنظمتك، وكل خطوة مسجّلة.',
    howEyebrow: 'كيف يعمل', howH2: 'من الفكرة إلى API شغّال في أربع خطوات.',
    steps: [
      ['أنشئ وكيلًا', 'اكتب تعليماته، أو صِفه ودع الذكاء الاصطناعي يجهّز المسودة، أو ابدأ من قالب.'],
      ['اربط الأدوات', 'أضف واجهات API وقواعد البيانات والبريد والتنبيهات وخدمات Progrid. بيانات الدخول تبقى للكتابة فقط.'],
      ['اختبر', 'أرسل رسالة أو حدث JSON وتابع كل استدعاء للنموذج والأدوات وكل شرط لحظة بلحظة.'],
      ['انشر', 'احفظ إصدارًا وانشره، وتحصل على نقطة API ومفاتيح وروابط Webhook.'],
    ],
    capEyebrow: 'الإمكانات', capH2: 'كل ما يحتاجه الوكيل ليعمل في بيئة الإنتاج.',
    capLead: 'لبنات بسيطة تعرفها: HTTP و SQL و Webhooks و JSON. لا شيء مخفي.',
    caps: [
      ['↔', 'واجهات API', 'استدعِ أي نقطة REST بمصادقة وترويسات محفوظة وقائمة مضيفين مسموحين.'],
      ['⛁', 'قواعد البيانات', 'استعلم من PostgreSQL و MySQL و MongoDB. للقراءة فقط افتراضيًا، مع تحديد الجداول المسموحة.'],
      ['⇄', 'Webhooks', 'ابدأ التشغيل من Webhooks واردة مع توقيع اختياري، أو أرسل إلى Webhooks صادرة.'],
      ['✉', 'البريد الإلكتروني', 'أرسل البريد عبر بريد Progrid أو خادم SMTP الخاص بك.'],
      ['◉', 'التنبيهات', 'نبّه الأشخاص عبر البريد أو Webhook أو لوحة Progrid.'],
      ['☁', 'خدمات Progrid', 'اقرأ الخوادم والمقاييس وقواعد البيانات وسجلات التطبيقات. التغييرات تنتظر موافقة بشرية.'],
      ['⑂', 'سير العمل', 'اربط الخطوات بصريًا: مشغّلات ووكلاء وأدوات وشروط وإجراءات وتحويلات.'],
      ['✦', 'البناء بالذكاء الاصطناعي', 'صِف الوكيل بجملة واحدة، وراجع المسودة قبل حفظ أي شيء.'],
      ['▶', 'الاختبار', 'خط زمني مباشر فيه الرموز والمدة واستدعاءات API والأخطاء وتقدير التكلفة لكل تشغيل.'],
      ['{ }', 'API', 'لكل وكيل نقطة API ومفاتيح ومخرجات منظّمة وتوثيق جاهز.'],
      ['▦', 'القوالب', 'وكلاء لدعم العملاء والمبيعات وتحليل البيانات والمراقبة والبحث والتطوير والفواتير.'],
    ],
    devEyebrow: 'للمطورين', devH2: 'استدعِ وكيلك مثل أي API آخر.',
    devLead: 'الوكلاء يرجعون JSON تعتمد عليه. الإصدارات ثابتة، والنشر يثبّت إصدارًا محددًا، وكل تشغيل مسجّل بخطواته.',
    devPoints: [
      ['إصدارات', 'التقط نسخة من التعليمات والأدوات وسير العمل، وارجع لإصدار أقدم بنشره.'],
      ['قابل للمراقبة', 'سجل لكل تشغيل فيه المدخلات والمخرجات واستدعاءات الأدوات والرموز والأخطاء.'],
      ['آمن افتراضيًا', 'القيم السرية للكتابة فقط، والوصول لقواعد البيانات للقراءة فقط، والإجراءات الحساسة تحتاج موافقة.'],
      ['متزامن أو غير متزامن', 'انتظر الرد، أو خذ معرّف التشغيل فورًا وتابع النتيجة.'],
    ],
    priceEyebrow: 'الأسعار', priceH2: 'ادفع فقط مقابل ما يستخدمه وكلاؤك.',
    priceLead: 'الدفع حسب الاستخدام. بدون حد أدنى شهري. كل اختبار وكل تشغيل يعرض تكلفته التقديرية.',
    perExecution: 'لكل تشغيل', executionNote: 'تشغيل وكيل واحد أو تنفيذ سير عمل واحد.',
    perToolCall: 'لكل استدعاء أداة', toolCallNote: 'كل عملية API أو قاعدة بيانات أو بريد أو إشعار أو Progrid ينفذها الوكيل.',
    tokensH3: 'رموز الذكاء الاصطناعي، لكل مليون رمز', tokenCols: ['النموذج', 'الإدخال', 'الإخراج', 'القراءة من الذاكرة المؤقتة', 'الكتابة في الذاكرة المؤقتة'],
    vatNote: 'الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة 15%.',
    cacheNote: 'القراءة والكتابة في الذاكرة المؤقتة تأتي من التخزين المؤقت للتعليمات. يجعل التعليمات التي تتكرر في كل استدعاء أرخص بكثير.',
    ctaH2: 'ابنِ أول وكيل لك اليوم.', ctaLead: 'Progrid Connect جزء من حسابك في Progrid. الاستخدام يُحتسب لكل تشغيل، وحد الصرف لمشروعك يسري عليه.',
  },
};

export function connectMetadata(lang: Lang): Metadata {
  const c = COPY[lang];
  return { title: c.metaTitle, description: c.metaDescription, alternates: { languages: { en: '/connect', tr: '/tr/connect', ar: '/ar/connect' } } };
}

const SAMPLE = `curl -X POST https://api.progrid.sa/v1/connect/agents/{id}/run \\
  -H "Authorization: Bearer $PRGD_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"email": "sara@company.com", "company": "Company Ltd"}}'`;

const RESPONSE = `{
  "runId": "cm1x8f0k20001",
  "status": "succeeded",
  "output": { "score": 86, "reason": "Mid size company, budget approved" },
  "usage": { "inputTokens": 2228, "outputTokens": 236, "toolCalls": 2 },
  "durationMs": 4910
}`;

export function ConnectPage({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const sar = (minor: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(minor / 100);
  return (
    <LangProvider lang={lang}>
      <Header />
      <main>
        <section className="hero-bg relative overflow-hidden text-white">
          <div className="grid-bg absolute inset-0" aria-hidden />
          <div className="container-x relative py-20 sm:py-28">
            <span className="eyebrow text-sky-300">{c.eyebrow}</span>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{c.h1}</h1>
            <p className="mt-3 text-xl text-sky-200">{c.alt}</p>
            <p className="mt-6 max-w-2xl text-lg text-slate-300">{c.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`${CONSOLE}/connect/agents/new`} className="btn-primary">{c.ctaPrimary}</a>
              <a href="/docs/connect" className="btn-light">{c.ctaSecondary}</a>
            </div>
            <p className="mt-8 max-w-xl text-sm text-slate-400">{c.notChatbot}</p>
          </div>
        </section>

        <section className="py-20">
          <div className="container-x">
            <span className="eyebrow">{c.howEyebrow}</span>
            <h2 className="h2">{c.howH2}</h2>
            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {c.steps.map(([t, d], i) => (
                <li key={t} className="card">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-semibold">{t}</h3>
                  <p className="mt-2 text-sm text-slate-600">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-slate-50 py-20">
          <div className="container-x">
            <span className="eyebrow">{c.capEyebrow}</span>
            <h2 className="h2">{c.capH2}</h2>
            <p className="lead">{c.capLead}</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {c.caps.map(([icon, t, d]) => (
                <li key={t} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                  <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-50 font-mono text-sm font-semibold text-blue-700">{icon}</span>
                  <div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-slate-600">{d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-slate-950 py-20 text-white">
          <div className="container-x grid items-start gap-12 lg:grid-cols-2">
            <div>
              <span className="eyebrow text-sky-300">{c.devEyebrow}</span>
              <h2 className="h2 text-white">{c.devH2}</h2>
              <p className="lead text-slate-300">{c.devLead}</p>
              <ul className="mt-8 space-y-4 text-slate-200">
                {c.devPoints.map(([t, d]) => (
                  <li key={t} className="flex gap-3"><span className="mt-1 h-5 w-5 flex-none rounded-full bg-sky-500/20 text-center text-xs leading-5 text-sky-300">✓</span><div><div className="font-semibold">{t}</div><div className="text-sm text-slate-400">{d}</div></div></li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 space-y-4" dir="ltr">
              <pre className="code overflow-x-auto text-start"><code>{SAMPLE}</code></pre>
              <pre className="code overflow-x-auto text-start"><code>{RESPONSE}</code></pre>
            </div>
          </div>
        </section>

        <section id="pricing" className="bg-slate-50 py-20">
          <div className="container-x">
            <span className="eyebrow">{c.priceEyebrow}</span>
            <h2 className="h2">{c.priceH2}</h2>
            <p className="lead">{c.priceLead}</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {([[PRICES.executionMinor, c.perExecution, c.executionNote], [PRICES.toolCallMinor, c.perToolCall, c.toolCallNote]] as const).map(([minor, unit, note]) => (
                <div key={unit} className="card">
                  <div className="text-3xl font-bold tabular-nums">{sar(minor)}</div>
                  <div className="mt-1 text-sm font-medium text-slate-700">{unit}</div>
                  <p className="mt-2 text-sm text-slate-600">{note}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-10 text-lg font-semibold">{c.tokensH3}</h3>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>{c.tokenCols.map((h, i) => <th key={h} scope="col" className={`px-4 py-3 font-medium ${i ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {PRICES.models.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <th scope="row" className="px-4 py-3 text-start font-medium" dir="ltr">{m.label}</th>
                      {[m.input, m.output, m.cacheRead, m.cacheWrite].map((v, i) => <td key={i} className="px-4 py-3 text-end tabular-nums">{sar(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-slate-600">{c.vatNote}</p>
            <p className="mt-1 text-sm text-slate-500">{c.cacheNote}</p>
          </div>
        </section>

        <section className="py-20">
          <div className="container-x text-center">
            <h2 className="h2">{c.ctaH2}</h2>
            <p className="lead mx-auto">{c.ctaLead}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href={`${CONSOLE}/connect`} className="btn-primary">{c.ctaPrimary}</a>
              <a href="/docs/connect" className="btn-outline">{c.ctaSecondary}</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </LangProvider>
  );
}
