import type { Metadata } from 'next';
import { Footer, Header, LangProvider } from '@/components/marketing';
import type { Lang } from '@/lib/copy';

const CONSOLE = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000';

interface AboutCopy {
  metaTitle: string; metaDescription: string;
  eyebrow: string; h1: string; lead: string;
  storyH2: string; story: string[];
  valuesH2: string; values: [string, string][];
  numbers: [string, string][];
  howH2: string; how: [string, string][];
  companyH2: string; company: [string, string][];
  ctaH2: string; ctaLead: string; ctaPrimary: string; ctaSecondary: string;
}

const COPY: Record<Lang, AboutCopy> = {
  en: {
    metaTitle: 'About Progrid Arabia', metaDescription: 'Progrid Arabia builds the developer cloud for Saudi Arabia: servers, managed databases, Kubernetes and an app platform, priced in riyals and built for people and AI tools alike.',
    eyebrow: 'About us', h1: 'Cloud infrastructure, built in Saudi Arabia for the people who build.',
    lead: 'Progrid Arabia is a Saudi company. We give developers, startups and IT teams the cloud they expect from the global providers, with riyal pricing, local invoicing and support that answers in Arabic.',
    storyH2: 'Why we started',
    story: [
      'Every developer in the Kingdom knows the trade off. Global clouds have the best tooling but bill in dollars, keep support far away and treat the region as an afterthought. Local hosts speak the language but stop at a control panel and a monthly invoice.',
      'We built Progrid to remove that trade off. One API drives everything: the console, the command line, Terraform and the AI coding tools your team already uses. Prices are in riyals, excluding VAT, and every invoice is a ZATCA e-invoice.',
      'We are a small team of engineers who have run infrastructure for banks, telecoms and startups. We would rather ship one product that works than ten that look good in a deck.',
    ],
    valuesH2: 'What we stand for',
    values: [
      ['Honest pricing', 'A server costs what the page says. Billing is by the hour, capped at the monthly price, and VAT is shown before you pay.'],
      ['Nothing hidden behind a ticket', 'Anything the console can do, the API can do. Resize, rebuild, snapshot, scale: all yours, no request forms.'],
      ['Built for automation', 'Terraform, SDKs, an MCP server and API tokens with spending caps, so a script or an AI tool can work safely on your account.'],
      ['Support that knows the stack', 'The people who answer tickets are the people who run the platform. Arabic and English, with response targets we publish.'],
    ],
    numbers: [['60 s', 'from request to a running server'], ['4', 'server plans, one price list'], ['3', 'managed database engines'], ['15%', 'VAT, shown before you pay']],
    howH2: 'How we work',
    how: [
      ['Open source underneath', 'Proxmox VE, Ceph, PostgreSQL, Temporal and NATS. Proven components, no lock in, and you can read how it fits together in our docs.'],
      ['Saudi first', 'Riyal price book, ZATCA e-invoicing, mada and Apple Pay through Moyasar, Arabic console and support. Global customers are welcome and pay in dollars at the pegged rate.'],
      ['Ship, then promise', 'We publish what is live and what is on the roadmap. A feature is not marketed until you can create it from the console.'],
    ],
    companyH2: 'The company',
    company: [['Legal name', 'Progrid Arabia (بروجريد العربية)'], ['Headquarters', 'Riyadh, Kingdom of Saudi Arabia'], ['Commercial registration', 'Pending publication'], ['VAT registration', 'Pending publication'], ['Contact', 'hello@progrid.sa']],
    ctaH2: 'Talk to us', ctaLead: 'Whether you are moving a workload, starting a company or evaluating us for a team, we answer within a business day.', ctaPrimary: 'Create an account', ctaSecondary: 'Contact us',
  },
  tr: {
    metaTitle: 'Progrid Arabia hakkında', metaDescription: 'Progrid Arabia, Suudi Arabistan için geliştirici bulutunu kurar: sunucular, yönetilen veritabanları, Kubernetes ve uygulama platformu, riyal fiyatlı, insanlar ve yapay zeka araçları için.',
    eyebrow: 'Hakkımızda', h1: 'Suudi Arabistan’da, üretenler için kurulan bulut altyapısı.',
    lead: 'Progrid Arabia bir Suudi şirketidir. Geliştiricilere, girişimlere ve BT ekiplerine küresel sağlayıcılardan bekledikleri bulutu, riyal fiyat, yerel fatura ve Arapça yanıt veren destekle sunar.',
    storyH2: 'Neden başladık',
    story: [
      'Krallıktaki her geliştirici bu ikilemi bilir. Küresel bulutların araçları en iyisidir ama dolarla faturalar, desteği uzaktadır ve bölgeyi sonradan düşünür. Yerel sağlayıcılar dili konuşur ama bir kontrol paneli ve aylık faturada durur.',
      'Progrid’i bu ikilemi kaldırmak için kurduk. Tek bir API her şeyi yönetir: konsol, komut satırı, Terraform ve ekibinizin zaten kullandığı yapay zeka araçları. Fiyatlar KDV hariç riyal cinsindendir ve her fatura bir ZATCA e-faturasıdır.',
      'Bankalar, telekomlar ve girişimler için altyapı işletmiş küçük bir mühendis ekibiyiz. Sunumda iyi görünen on üründense çalışan tek bir ürünü tercih ederiz.',
    ],
    valuesH2: 'Neyi savunuyoruz',
    values: [
      ['Dürüst fiyat', 'Bir sunucu sayfada yazan kadar tutar. Saatlik faturalanır, aylık fiyatla sınırlıdır ve KDV ödemeden önce gösterilir.'],
      ['Talep formunun arkasında hiçbir şey yok', 'Konsolun yapabildiği her şeyi API de yapar. Boyutlandırma, yeniden kurma, anlık görüntü, ölçekleme: hepsi sizin.'],
      ['Otomasyon için kurulu', 'Terraform, SDK’lar, MCP sunucusu ve harcama limitli API tokenları; bir betik veya yapay zeka aracı hesabınızda güvenle çalışır.'],
      ['Altyapıyı bilen destek', 'Talepleri yanıtlayanlar platformu işletenlerdir. Arapça ve İngilizce, yayınladığımız yanıt hedefleriyle.'],
    ],
    numbers: [['60 sn', 'istekten çalışan sunucuya'], ['4', 'sunucu planı, tek fiyat listesi'], ['3', 'yönetilen veritabanı motoru'], ['%15', 'KDV, ödemeden önce gösterilir']],
    howH2: 'Nasıl çalışıyoruz',
    how: [
      ['Altta açık kaynak', 'Proxmox VE, Ceph, PostgreSQL, Temporal ve NATS. Kanıtlanmış bileşenler, bağımlılık yok; nasıl birleştiğini dokümanlarda okuyabilirsiniz.'],
      ['Önce Suudi Arabistan', 'Riyal fiyat listesi, ZATCA e-fatura, Moyasar ile mada ve Apple Pay, Arapça konsol ve destek. Küresel müşteriler sabit kurla dolar öder.'],
      ['Önce çıkar, sonra söz ver', 'Neyin canlı, neyin yol haritasında olduğunu yayınlarız. Konsoldan oluşturamadığınız bir özelliğin pazarlaması yapılmaz.'],
    ],
    companyH2: 'Şirket',
    company: [['Yasal ad', 'Progrid Arabia (بروجريد العربية)'], ['Merkez', 'Riyad, Suudi Arabistan Krallığı'], ['Ticaret sicili', 'Yayınlanacak'], ['KDV kaydı', 'Yayınlanacak'], ['İletişim', 'hello@progrid.sa']],
    ctaH2: 'Bizimle konuşun', ctaLead: 'İş yükü taşıyor, şirket kuruyor ya da ekibiniz için bizi değerlendiriyor olun, bir iş günü içinde yanıtlarız.', ctaPrimary: 'Hesap oluştur', ctaSecondary: 'İletişim',
  },
  ar: {
    metaTitle: 'عن بروجريد العربية', metaDescription: 'بروجريد العربية شركة سعودية تبني الخدمات السحابية للمطورين: سيرفرات وقواعد بيانات مُدارة وKubernetes ومنصة تطبيقات، بأسعار بالريال، للناس ولأدوات الذكاء الاصطناعي.',
    eyebrow: 'من نحن', h1: 'بنية تحتية سحابية، مبنية في السعودية لأهل البناء.',
    lead: 'بروجريد العربية شركة سعودية. نعطي المطورين والشركات الناشئة وفرق تقنية المعلومات السحابة اللي يتوقعونها من المزودين العالميين، بأسعار بالريال وفاتورة محلية ودعم يرد عليك بالعربي.',
    storyH2: 'ليش بدأنا',
    story: [
      'كل مطور في المملكة يعرف المعادلة. السحابات العالمية عندها أفضل الأدوات، لكنها تفوتر بالدولار ودعمها بعيد وتتعامل مع المنطقة كأنها على الهامش. المزودون المحليون يتكلمون لغتك، لكن ينتهون عند لوحة تحكم وفاتورة شهرية.',
      'بنينا Progrid عشان نلغي هذي المعادلة. واجهة API وحدة تشغّل كل شي: لوحة التحكم وسطر الأوامر وTerraform وأدوات الذكاء الاصطناعي اللي فريقك يستخدمها أصلًا. الأسعار بالريال بدون ضريبة، وكل فاتورة هي فاتورة زاتكا إلكترونية.',
      'إحنا فريق صغير من المهندسين، شغّلنا بنى تحتية لبنوك وشركات اتصالات وشركات ناشئة. نفضّل نطلّع منتج واحد يشتغل على عشرة تبيّن حلوة في العرض.',
    ],
    valuesH2: 'وش نؤمن فيه',
    values: [
      ['سعر صريح', 'السيرفر يكلّف اللي مكتوب في الصفحة. تحاسب بالساعة، بسقف السعر الشهري، والضريبة تشوفها قبل ما تدفع.'],
      ['ما في شي وراء تذكرة', 'كل اللي تسويه لوحة التحكم تسويه الـ API. تغيير الحجم وإعادة البناء واللقطات والتوسّع: كلها بيدك، بدون نماذج طلب.'],
      ['مبني للأتمتة', 'Terraform وحزم SDK وخادم MCP ورموز API بحد إنفاق، عشان السكربت أو أداة الذكاء الاصطناعي تشتغل على حسابك بأمان.'],
      ['دعم يفهم التقنية', 'اللي يرد على تذكرتك هو نفسه اللي يشغّل المنصة. بالعربي والإنجليزي، وبأهداف رد ننشرها.'],
    ],
    numbers: [['60 ثانية', 'من الطلب إلى سيرفر شغّال'], ['4', 'باقات سيرفرات، وقائمة أسعار وحدة'], ['3', 'محركات قواعد بيانات مُدارة'], ['15%', 'ضريبة، تشوفها قبل الدفع']],
    howH2: 'كيف نشتغل',
    how: [
      ['مصادر مفتوحة من تحت', 'Proxmox VE وCeph وPostgreSQL وTemporal وNATS. مكوّنات مجرّبة، بدون احتكار، وتقدر تقرأ كيف مترابطة في الدليل.'],
      ['السعودية أول', 'قائمة أسعار بالريال، فاتورة زاتكا، مدى وApple Pay عبر Moyasar، لوحة تحكم ودعم بالعربي. والعملاء من خارج المملكة يدفعون بالدولار بسعر الصرف الثابت.'],
      ['نطلّع، وبعدين نوعد', 'ننشر وش المتوفر ووش على الطريق. ما نسوّق لأي ميزة قبل ما تقدر تنشئها من لوحة التحكم.'],
    ],
    companyH2: 'الشركة',
    company: [['الاسم القانوني', 'بروجريد العربية (Progrid Arabia)'], ['المقر', 'الرياض، المملكة العربية السعودية'], ['السجل التجاري', 'يُنشر قريبًا'], ['الرقم الضريبي', 'يُنشر قريبًا'], ['التواصل', 'hello@progrid.sa']],
    ctaH2: 'كلّمنا', ctaLead: 'سواء تنقل عمل قائم، أو تبدأ شركة، أو تقيّمنا لفريقك، نرد عليك خلال يوم عمل.', ctaPrimary: 'أنشئ حسابك', ctaSecondary: 'تواصل معنا',
  },
};

export function aboutMetadata(lang: Lang): Metadata {
  const c = COPY[lang];
  return { title: c.metaTitle, description: c.metaDescription };
}

export function About({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const prefix = lang === 'en' ? '' : `/${lang}`;
  return (
    <LangProvider lang={lang}>
      <Header />
      <main>
        <section className="hero-bg py-20 text-white">
          <div className="container-x max-w-4xl">
            <span className="eyebrow text-sky-300">{c.eyebrow}</span>
            <h1 className="hero-title mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">{c.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-300">{c.lead}</p>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="container-x grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
            {c.numbers.map(([v, l]) => <div key={l}><div className="text-3xl font-bold text-slate-900">{v}</div><div className="mt-1 text-sm text-slate-500">{l}</div></div>)}
          </div>
        </section>

        <section className="py-20">
          <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.4fr]">
            <div><span className="eyebrow">{c.storyH2}</span><h2 className="h2">{c.storyH2}</h2></div>
            <div className="space-y-5 text-lg leading-relaxed text-slate-700">{c.story.map((p) => <p key={p.slice(0, 20)}>{p}</p>)}</div>
          </div>
        </section>

        <section className="bg-slate-50 py-20">
          <div className="container-x">
            <span className="eyebrow">{c.valuesH2}</span>
            <h2 className="h2">{c.valuesH2}</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {c.values.map(([t, d]) => <div key={t} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold">{t}</h3><p className="mt-2 text-slate-600">{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container-x">
            <span className="eyebrow">{c.howH2}</span>
            <h2 className="h2">{c.howH2}</h2>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {c.how.map(([t, d], i) => <div key={t} className="rounded-2xl border border-slate-200 p-6"><div className="text-sm font-semibold text-blue-600">0{i + 1}</div><h3 className="mt-2 text-lg font-semibold">{t}</h3><p className="mt-2 text-slate-600">{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-50 py-16">
          <div className="container-x max-w-3xl">
            <h2 className="text-2xl font-bold">{c.companyH2}</h2>
            <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[200px_1fr]">
              {c.company.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="hero-bg py-20 text-white">
          <div className="container-x text-center">
            <h2 className="text-3xl font-bold tracking-tight">{c.ctaH2}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">{c.ctaLead}</p>
            <div className="mt-8 flex justify-center gap-3">
              <a href={`${CONSOLE}/login`} className="btn-primary">{c.ctaPrimary}</a>
              <a href={`${prefix}/contact`} className="btn-light">{c.ctaSecondary}</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </LangProvider>
  );
}
