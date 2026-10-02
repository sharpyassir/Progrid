import type { Metadata } from 'next';
import { Footer, Header, LangProvider } from '@/components/marketing';
import type { Lang } from '@/lib/copy';
import type { Site } from '@/lib/site-shared';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';

interface AboutCopy {
  metaTitle: string; metaDescription: string;
  eyebrow: string; h1: string; lead: string;
  storyH2: string; story: string[];
  valuesH2: string; values: [string, string][];
  numbers: [string, string][];
  howH2: string; how: [string, string][];
  companyH2: string;
  ctaH2: string; ctaLead: string; ctaPrimary: string; ctaSecondary: string;
}

const COPY: Record<Lang, AboutCopy> = {
  en: {
    metaTitle: 'About Progrid', metaDescription: 'Progrid builds a developer cloud for people and AI agents: servers, managed databases, Kubernetes, an app platform and Connect, with clear hourly pricing.',
    eyebrow: 'About us', h1: 'A cloud platform for the people who build.',
    lead: 'Progrid gives developers, startups and IT teams the cloud they expect from the largest providers. Simple hourly pricing, one API for everything, and support from the engineers who run it.',
    storyH2: 'Why we started',
    story: [
      'Every developer knows the trade off. Large clouds have the best tooling, but the bills are hard to read and support is far away. Simple hosts are easy to start with, but they stop at a control panel and a monthly invoice.',
      'We built Progrid to remove that trade off. One API drives everything: the console, the command line, Terraform and the AI coding tools your team already uses. Billing is by the hour and never more than the monthly price.',
      'We are a small team of engineers who have run infrastructure for banks, telecoms and startups. We would rather ship one product that works than ten that look good in a deck.',
    ],
    valuesH2: 'What we stand for',
    values: [
      ['Honest pricing', 'A server costs what the page says. Billing is by the hour, capped at the monthly price, and any tax is shown before you pay.'],
      ['Nothing hidden behind a ticket', 'Anything the console can do, the API can do. Resize, rebuild, snapshot, scale: all yours, no request forms.'],
      ['Built for automation', 'Terraform, SDKs, an MCP server and API tokens with spending caps, so a script or an AI tool can work safely on your account.'],
      ['Support that knows the stack', 'The people who answer tickets are the people who run the platform. Arabic and English, with response targets we publish.'],
    ],
    numbers: [['60 s', 'from request to a running server'], ['4', 'server plans, one price list'], ['3', 'managed database engines'], ['1', 'API for the console, CLI, Terraform and agents']],
    howH2: 'How we work',
    how: [
      ['Open source underneath', 'Proxmox VE, Ceph, PostgreSQL, Temporal and NATS. Proven components, no lock in, and you can read how it fits together in our docs.'],
      ['Local where it matters', 'You pay in your own storefront. US dollars on progrid.co. Saudi riyals with VAT, mada and Apple Pay on progrid.sa. Invoices always come from the local contracting company.'],
      ['Ship, then promise', 'We publish what is live and what is on the roadmap. A feature is not marketed until you can create it from the console.'],
    ],
    companyH2: 'The company',
    ctaH2: 'Talk to us', ctaLead: 'Whether you are moving a workload, starting a company or evaluating us for a team, we answer within a business day.', ctaPrimary: 'Create an account', ctaSecondary: 'Contact us',
  },
  tr: {
    metaTitle: 'Progrid hakkında', metaDescription: 'Progrid, insanlar ve yapay zeka ajanları için bir geliştirici bulutu kurar: sunucular, yönetilen veritabanları, Kubernetes, uygulama platformu ve Connect, anlaşılır saatlik fiyatlarla.',
    eyebrow: 'Hakkımızda', h1: 'Üretenler için bir bulut platformu.',
    lead: 'Progrid, geliştiricilere, girişimlere ve BT ekiplerine en büyük sağlayıcılardan bekledikleri bulutu sunar. Basit saatlik fiyat, her şey için tek API ve platformu işleten mühendislerden destek.',
    storyH2: 'Neden başladık',
    story: [
      'Her geliştirici bu ikilemi bilir. Büyük bulutların araçları en iyisidir ama faturaları zor okunur ve destek uzaktadır. Basit sağlayıcılarla başlamak kolaydır ama bir kontrol paneli ve aylık faturada dururlar.',
      'Progrid’i bu ikilemi kaldırmak için kurduk. Tek bir API her şeyi yönetir: konsol, komut satırı, Terraform ve ekibinizin zaten kullandığı yapay zeka araçları. Faturalama saatliktir ve aylık fiyatı asla aşmaz.',
      'Bankalar, telekomlar ve girişimler için altyapı işletmiş küçük bir mühendis ekibiyiz. Sunumda iyi görünen on üründense çalışan tek bir ürünü tercih ederiz.',
    ],
    valuesH2: 'Neyi savunuyoruz',
    values: [
      ['Dürüst fiyat', 'Bir sunucu sayfada yazan kadar tutar. Saatlik faturalanır, aylık fiyatla sınırlıdır ve vergiler ödemeden önce gösterilir.'],
      ['Talep formunun arkasında hiçbir şey yok', 'Konsolun yapabildiği her şeyi API de yapar. Boyutlandırma, yeniden kurma, anlık görüntü, ölçekleme: hepsi sizin.'],
      ['Otomasyon için kurulu', 'Terraform, SDK’lar, MCP sunucusu ve harcama limitli API tokenları; bir betik veya yapay zeka aracı hesabınızda güvenle çalışır.'],
      ['Altyapıyı bilen destek', 'Talepleri yanıtlayanlar platformu işletenlerdir. Arapça ve İngilizce, yayınladığımız yanıt hedefleriyle.'],
    ],
    numbers: [['60 sn', 'istekten çalışan sunucuya'], ['4', 'sunucu planı, tek fiyat listesi'], ['3', 'yönetilen veritabanı motoru'], ['1', 'konsol, CLI, Terraform ve ajanlar için tek API']],
    howH2: 'Nasıl çalışıyoruz',
    how: [
      ['Altta açık kaynak', 'Proxmox VE, Ceph, PostgreSQL, Temporal ve NATS. Kanıtlanmış bileşenler, bağımlılık yok; nasıl birleştiğini dokümanlarda okuyabilirsiniz.'],
      ['Gereken yerde yerel', 'Kendi mağazanızda ödersiniz. progrid.co’da ABD doları. progrid.sa’da KDV ile Suudi riyali, mada ve Apple Pay. Faturalar her zaman yerel sözleşme şirketinden gelir.'],
      ['Önce çıkar, sonra söz ver', 'Neyin canlı, neyin yol haritasında olduğunu yayınlarız. Konsoldan oluşturamadığınız bir özelliğin pazarlaması yapılmaz.'],
    ],
    companyH2: 'Şirket',
    ctaH2: 'Bizimle konuşun', ctaLead: 'İş yükü taşıyor, şirket kuruyor ya da ekibiniz için bizi değerlendiriyor olun, bir iş günü içinde yanıtlarız.', ctaPrimary: 'Hesap oluştur', ctaSecondary: 'İletişim',
  },
  ar: {
    metaTitle: 'عن Progrid', metaDescription: 'تبني Progrid سحابة للمطورين وللوكلاء الأذكياء: خوادم وقواعد بيانات مُدارة وKubernetes ومنصة تطبيقات وConnect، بأسعار واضحة بالساعة.',
    eyebrow: 'من نحن', h1: 'منصة سحابية لمن يبنون.',
    lead: 'تقدّم Progrid للمطورين والشركات الناشئة وفرق تقنية المعلومات السحابة التي يتوقعونها من كبار المزودين: أسعار بسيطة بالساعة، وواجهة API واحدة لكل شيء، ودعم من المهندسين الذين يشغّلون المنصة.',
    storyH2: 'لماذا بدأنا',
    story: [
      'يعرف كل مطور هذه المفاضلة. تملك السحابات الكبرى أفضل الأدوات، لكن فواتيرها صعبة القراءة ودعمها بعيد. أما الاستضافة البسيطة فسهلة البداية، لكنها تتوقف عند لوحة تحكم وفاتورة شهرية.',
      'بنينا Progrid لننهي هذه المفاضلة. واجهة API واحدة تدير كل شيء: لوحة التحكم وسطر الأوامر وTerraform وأدوات البرمجة بالذكاء الاصطناعي التي يستخدمها فريقك. والفوترة بالساعة ولا تتجاوز السعر الشهري أبدًا.',
      'نحن فريق صغير من المهندسين شغّلنا بنى تحتية لبنوك وشركات اتصالات وشركات ناشئة. ونفضّل إطلاق منتج واحد يعمل على عشرة منتجات تبدو جيدة في عرض تقديمي.',
    ],
    valuesH2: 'ما نؤمن به',
    values: [
      ['أسعار صادقة', 'تكلفة الخادم هي ما تعرضه الصفحة. الفوترة بالساعة وبسقف السعر الشهري، وتظهر أي ضريبة قبل الدفع.'],
      ['لا شيء خلف تذكرة دعم', 'كل ما تفعله لوحة التحكم تفعله واجهة API. تغيير الحجم وإعادة البناء واللقطات والتوسع كلها بيدك، دون نماذج طلب.'],
      ['مصمم للأتمتة', 'Terraform وحزم SDK وخادم MCP ورموز API بحد إنفاق، ليعمل النص البرمجي أو أداة الذكاء الاصطناعي على حسابك بأمان.'],
      ['دعم يعرف التقنية', 'من يجيب عن التذاكر هم من يشغّلون المنصة، بالعربية والإنجليزية، وبأهداف استجابة ننشرها.'],
    ],
    numbers: [['60 ثانية', 'من الطلب إلى خادم يعمل'], ['4', 'باقات خوادم وقائمة أسعار واحدة'], ['3', 'محركات قواعد بيانات مُدارة'], ['1', 'واجهة API للوحة التحكم وسطر الأوامر وTerraform والوكلاء']],
    howH2: 'كيف نعمل',
    how: [
      ['مصادر مفتوحة في الأساس', 'Proxmox VE وCeph وPostgreSQL وTemporal وNATS. مكونات مجرّبة دون احتكار، ويمكنك قراءة كيف تترابط في الوثائق.'],
      ['محليون حيث يهم ذلك', 'تدفع عبر متجرك المحلي: بالدولار الأمريكي على progrid.co، وبالريال السعودي مع ضريبة القيمة المضافة ومدى وApple Pay على progrid.sa. وتصدر الفواتير دائمًا من الشركة المتعاقدة المحلية.'],
      ['نطلق أولًا ثم نعد', 'ننشر ما هو متاح وما هو على خارطة الطريق. ولا نسوّق ميزة قبل أن تتمكن من إنشائها من لوحة التحكم.'],
    ],
    companyH2: 'الشركة',
    ctaH2: 'تحدث إلينا', ctaLead: 'سواء كنت تنقل عملًا قائمًا أو تؤسس شركة أو تقيّمنا لفريقك، نرد عليك خلال يوم عمل.', ctaPrimary: 'أنشئ حسابك', ctaSecondary: 'تواصل معنا',
  },
};

/**
 * The contracting company of each storefront. Addresses appear only here, in the company facts,
 * never as a marketing claim. Registration numbers are published once they exist.
 */
const COMPANY: Record<Site, Record<Lang, [string, string][]>> = {
  global: {
    en: [['Contracting company', 'Progrid Technologies LLC'], ['Jurisdiction', 'United States'], ['Registered address', 'Published once registration is complete'], ['Contact', 'support@progrid.co'], ['Customers in Saudi Arabia', 'Contract with Progrid Arabia through progrid.sa']],
    tr: [['Sözleşme şirketi', 'Progrid Technologies LLC'], ['Yargı yetkisi', 'Amerika Birleşik Devletleri'], ['Kayıtlı adres', 'Kayıt tamamlandığında yayınlanacak'], ['İletişim', 'support@progrid.co'], ['Suudi Arabistan’daki müşteriler', 'progrid.sa üzerinden Progrid Arabia ile sözleşme yapar']],
    ar: [['الشركة المتعاقدة', 'Progrid Technologies LLC'], ['الولاية القضائية', 'الولايات المتحدة'], ['العنوان المسجل', 'يُنشر بعد اكتمال التسجيل'], ['التواصل', 'support@progrid.co'], ['العملاء في المملكة العربية السعودية', 'يتعاقدون مع Progrid Arabia عبر progrid.sa']],
  },
  sa: {
    en: [['Contracting company in Saudi Arabia', 'Progrid Arabia (بروجريد العربية)'], ['Registered address', 'Riyadh, Kingdom of Saudi Arabia'], ['Commercial registration', 'Published once registration is complete'], ['VAT registration', 'Published once registration is complete'], ['Contact', 'support@progrid.sa']],
    tr: [['Suudi Arabistan’daki sözleşme şirketi', 'Progrid Arabia (بروجريد العربية)'], ['Kayıtlı adres', 'Riyad, Suudi Arabistan Krallığı'], ['Ticaret sicili', 'Kayıt tamamlandığında yayınlanacak'], ['KDV kaydı', 'Kayıt tamamlandığında yayınlanacak'], ['İletişim', 'support@progrid.sa']],
    ar: [['الشركة المتعاقدة في المملكة العربية السعودية', 'بروجريد العربية (Progrid Arabia)'], ['العنوان المسجل', 'الرياض، المملكة العربية السعودية'], ['السجل التجاري', 'يُنشر بعد اكتمال التسجيل'], ['الرقم الضريبي', 'يُنشر بعد اكتمال التسجيل'], ['التواصل', 'support@progrid.sa']],
  },
};

export async function aboutMetadata(lang: Lang): Promise<Metadata> {
  const c = COPY[lang];
  return { title: c.metaTitle, description: c.metaDescription, alternates: alternatesFor(await getSite(), lang, '/about') };
}

export async function About({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const site = await getSite();
  const company = COMPANY[site.site][lang];
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
              {company.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="hero-bg py-20 text-white">
          <div className="container-x text-center">
            <h2 className="text-3xl font-bold tracking-tight">{c.ctaH2}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">{c.ctaLead}</p>
            <div className="mt-8 flex justify-center gap-3">
              <a href={`${site.urls.console}/login`} className="btn-primary">{c.ctaPrimary}</a>
              <a href={`${prefix}/contact`} className="btn-light">{c.ctaSecondary}</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </LangProvider>
  );
}
