import type { Metadata } from 'next';
import { Footer, Header, LangProvider } from '@/components/marketing';
import { SitePage } from '@/components/site-page';
import type { Lang } from '@/lib/copy';
import { getPage } from '@/lib/pages';
import { getSite } from '@/lib/site';
import { alternatesFor } from '@/lib/alternates';

/**
 * The affiliate program page (/affiliates) and its terms (/affiliates/terms). Rates, windows and
 * the minimum payout come from the API (GET /v1/affiliates/program), which reads the settings
 * staff edit in the back office; the defaults below are only used when the API cannot be reached.
 */

const CATEGORIES = ['web_hosting', 'connect', 'servers', 'managed_cloud', 'ai_usage', 'support'] as const;
type Category = (typeof CATEGORIES)[number];

export interface Program {
  applicationsOpen: boolean;
  rates: Record<Category, number>;
  cookieDays: number;
  holdDays: number;
  commissionMonths: number;
  minPayoutMinor: { SAR: number; USD: number };
  promoDiscountPercent: number;
  promoDiscountMonths: number;
}

const DEFAULT_PROGRAM: Program = {
  applicationsOpen: true,
  rates: { web_hosting: 30, connect: 30, servers: 15, managed_cloud: 15, ai_usage: 0, support: 0 },
  cookieDays: 60,
  holdDays: 60,
  commissionMonths: 12,
  minPayoutMinor: { SAR: 20_000, USD: 5_000 },
  promoDiscountPercent: 10,
  promoDiscountMonths: 3,
};

async function program(api: string): Promise<Program> {
  try {
    const r = await fetch(`${api}/v1/affiliates/program`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return DEFAULT_PROGRAM;
    const p = (await r.json()) as Partial<Program>;
    return { ...DEFAULT_PROGRAM, ...p, rates: { ...DEFAULT_PROGRAM.rates, ...(p.rates ?? {}) }, minPayoutMinor: { ...DEFAULT_PROGRAM.minPayoutMinor, ...(p.minPayoutMinor ?? {}) } };
  } catch {
    return DEFAULT_PROGRAM;
  }
}

/** Program numbers ready for the copy; `days` is already worded ("60 days", "60 يومًا"). */
interface Facts { maxRate: number; months: number; discount: number; discountMonths: number; days: string; hold: number; minPayout: string }

interface AffiliatesCopy {
  metaTitle: string; metaDescription: (f: Facts) => string;
  eyebrow: string; h1: string; lead: (f: Facts) => string; apply: string; applyClosed: string; howLink: string;
  stats: (f: Facts) => [string, string][];
  howH2: string; how: (f: Facts) => [string, string][];
  ratesH2: string; ratesLead: (f: Facts) => string; colProduct: string; colRate: string; colIncludes: string;
  categories: Record<Category, [string, string]>; ratesNote: string;
  whoH2: string; whoLead: string; who: [string, string][];
  faqH2: string; faq: (f: Facts) => [string, string][];
  termsLink: string; ctaH2: string; ctaLead: (f: Facts) => string;
  days: (n: number) => string;
}

const COPY: Record<Lang, AffiliatesCopy> = {
  en: {
    metaTitle: 'Affiliate program: earn recurring commission',
    metaDescription: (f) => `Join the Progrid affiliate program for creators. Earn up to ${f.maxRate}% recurring commission for ${f.months} months on every customer who signs up with your code, and give your audience ${f.discount}% off.`,
    eyebrow: 'Affiliate program',
    h1: 'Earn with every developer you bring to Progrid.',
    lead: (f) => `Share your code with your audience. Every customer who signs up with it gets ${f.discount}% off for ${f.discountMonths} months, and you earn up to ${f.maxRate}% of what they pay for ${f.months} months.`,
    apply: 'Apply now', applyClosed: 'Applications are paused', howLink: 'How it works',
    stats: (f) => [[`${f.maxRate}%`, 'top commission rate'], [`${f.months}`, 'months of recurring commission'], [`${f.discount}%`, 'off for your audience'], [f.minPayout, 'minimum payout']],
    howH2: 'How it works',
    how: (f) => [
      ['Apply', 'Tell us about your channels and how you plan to promote Progrid. We review every application, usually within a few business days.'],
      ['Share your code', `Once approved you get a personal code and a referral link. The link fills in your code on the signup form for ${f.days} after a click.`],
      ['Customers sign up with your code', `They get ${f.discount}% off their invoices for ${f.discountMonths} months. Only customers who sign up with your code, or add it before their first paid invoice, count as yours.`],
      ['Get paid', `Commission is earned when their invoices are paid, becomes payable after a ${f.hold} day hold, and you can request a payout once you reach ${f.minPayout}.`],
    ],
    ratesH2: 'Commission by product',
    ratesLead: (f) => `A share of what each referred customer pays, every month, for their first ${f.months} months.`,
    colProduct: 'Product', colRate: 'Commission', colIncludes: 'Includes',
    categories: {
      web_hosting: ['Web hosting', 'App Platform and one click Marketplace apps'],
      connect: ['Progrid Connect', 'AI agent and automation runs and tool calls'],
      servers: ['Servers and infrastructure', 'Servers, volumes, backups, load balancers, object storage, managed databases and Kubernetes'],
      managed_cloud: ['Managed cloud', 'Managed cloud plans and engineer time'],
      ai_usage: ['AI model usage', 'AI model tokens used by Connect agents'],
      support: ['Support plans', 'Paid support plans'],
    },
    ratesNote: 'Commission is calculated on the amount actually paid, excluding VAT and other taxes, discounts and free credit. Refunded or charged back amounts are deducted.',
    whoH2: 'Who it is for',
    whoLead: 'Creators and communities that teach, build and recommend tools to developers.',
    who: [
      ['YouTubers and streamers', 'Tutorials, deploy walkthroughs, homelab and DevOps channels.'],
      ['Writers and newsletters', 'Blogs, newsletters and documentation sites for developers.'],
      ['Educators', 'Courses, bootcamps and instructors who need a cloud for their students.'],
      ['Communities', 'Developer communities, podcasts and meetup organizers.'],
      ['Agencies and freelancers', 'Teams that build and host projects for their clients.'],
    ],
    faqH2: 'Questions',
    faq: (f) => [
      ['When do I get paid?', `Commission is pending for ${f.hold} days after the customer pays the invoice, so refunds and chargebacks can settle. Then it becomes payable. Request a payout from your affiliate portal once your payable balance reaches the minimum; we pay by bank transfer, usually within 10 business days.`],
      ['How long does my link count?', `A click on your referral link fills in your code on the signup form for ${f.days}. If someone clicks another partner's link later, the latest link wins. What counts in the end is the code the customer signs up with.`],
      ['Which currency am I paid in?', 'Commission is earned in the currency of the customer invoice: US dollars for customers of Progrid Technologies LLC, Saudi riyals for customers of Progrid Arabia. Each currency has its own balance and minimum payout (200 SAR or 50 USD).'],
      ['What is not allowed?', 'Signing up yourself or your own businesses with your code, bidding on Progrid brand terms in search ads, spam, coupon sites that publish codes without your content, and misleading claims about Progrid. Breaking the rules cancels the commission and can end your participation.'],
      ['Do I need to disclose that I am an affiliate?', 'Yes. Tell your audience clearly, close to the link or code, that you earn a commission. This is required by consumer protection rules in most countries and by our terms.'],
      ['Can existing Progrid customers join?', 'Yes. Apply with your existing account. Your own usage never earns commission.'],
    ],
    termsLink: 'Read the affiliate program terms',
    ctaH2: 'Ready to start?',
    ctaLead: (f) => `Apply in a few minutes. Once approved, you earn up to ${f.maxRate}% on every customer who signs up with your code.`,
    days: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
  },
  tr: {
    metaTitle: 'Ortaklık programı: tekrarlayan komisyon kazanın',
    metaDescription: (f) => `İçerik üreticileri için Progrid ortaklık programına katılın. Kodunuzla kaydolan her müşteriden ${f.months} ay boyunca %${f.maxRate}'a varan tekrarlayan komisyon kazanın; kitlenize %${f.discount} indirim verin.`,
    eyebrow: 'Ortaklık programı',
    h1: 'Progrid’e getirdiğiniz her geliştiriciyle kazanın.',
    lead: (f) => `Kodunuzu kitlenizle paylaşın. Kodla kaydolan her müşteri ${f.discountMonths} ay boyunca %${f.discount} indirim alır; siz de ödedikleri tutarın %${f.maxRate}'ına kadarını ${f.months} ay boyunca kazanırsınız.`,
    apply: 'Hemen başvurun', applyClosed: 'Başvurular duraklatıldı', howLink: 'Nasıl çalışır',
    stats: (f) => [[`%${f.maxRate}`, 'en yüksek komisyon oranı'], [`${f.months}`, 'ay tekrarlayan komisyon'], [`%${f.discount}`, 'kitlenize indirim'], [f.minPayout, 'asgari ödeme']],
    howH2: 'Nasıl çalışır',
    how: (f) => [
      ['Başvurun', 'Kanallarınızı ve Progrid’i nasıl tanıtacağınızı anlatın. Her başvuruyu genellikle birkaç iş günü içinde inceleriz.'],
      ['Kodunuzu paylaşın', `Onaylandığınızda kişisel bir kod ve yönlendirme bağlantısı alırsınız. Bağlantı, tıklamadan sonra ${f.days} boyunca kayıt formuna kodunuzu yazar.`],
      ['Müşteriler kodunuzla kaydolur', `${f.discountMonths} ay boyunca faturalarında %${f.discount} indirim alırlar. Yalnızca kodunuzla kaydolan veya ilk ödenen faturadan önce kodu ekleyen müşteriler sizin sayılır.`],
      ['Ödeme alın', `Komisyon, faturaları ödendiğinde kazanılır, ${f.hold} günlük bekleme süresinden sonra ödenebilir hale gelir ve ${f.minPayout} tutarına ulaştığınızda ödeme talep edebilirsiniz.`],
    ],
    ratesH2: 'Ürüne göre komisyon',
    ratesLead: (f) => `Yönlendirdiğiniz her müşterinin ilk ${f.months} ayında her ay ödediği tutardan bir pay.`,
    colProduct: 'Ürün', colRate: 'Komisyon', colIncludes: 'Kapsam',
    categories: {
      web_hosting: ['Web barındırma', 'Uygulama Platformu ve tek tıkla Uygulama Mağazası uygulamaları'],
      connect: ['Progrid Connect', 'Yapay zeka ajanı ve otomasyon çalıştırmaları ve araç çağrıları'],
      servers: ['Sunucular ve altyapı', 'Sunucular, diskler, yedekler, yük dengeleyiciler, nesne depolama, yönetilen veritabanları ve Kubernetes'],
      managed_cloud: ['Yönetilen bulut', 'Yönetilen bulut planları ve mühendis süresi'],
      ai_usage: ['Yapay zeka model kullanımı', 'Connect ajanlarının kullandığı model tokenları'],
      support: ['Destek planları', 'Ücretli destek planları'],
    },
    ratesNote: 'Komisyon, KDV ve diğer vergiler, indirimler ve ücretsiz krediler hariç gerçekte ödenen tutar üzerinden hesaplanır. İade edilen veya ters ibraz edilen tutarlar düşülür.',
    whoH2: 'Kimler için',
    whoLead: 'Geliştiricilere öğreten, üreten ve araç öneren içerik üreticileri ve topluluklar.',
    who: [
      ['YouTube ve yayıncılar', 'Eğitimler, dağıtım anlatımları, homelab ve DevOps kanalları.'],
      ['Yazarlar ve bültenler', 'Geliştiricilere yönelik bloglar, bültenler ve doküman siteleri.'],
      ['Eğitmenler', 'Öğrencileri için bulut gereken kurslar, bootcamp’ler ve eğitmenler.'],
      ['Topluluklar', 'Geliştirici toplulukları, podcast’ler ve buluşma düzenleyicileri.'],
      ['Ajanslar ve serbest çalışanlar', 'Müşterileri için proje geliştiren ve barındıran ekipler.'],
    ],
    faqH2: 'Sorular',
    faq: (f) => [
      ['Ne zaman ödeme alırım?', `Komisyon, müşteri faturayı ödedikten sonra iadeler ve ters ibrazlar netleşsin diye ${f.hold} gün bekler, sonra ödenebilir olur. Ödenebilir bakiyeniz asgari tutara ulaşınca ortaklık portalınızdan ödeme talep edin; genellikle 10 iş günü içinde banka havalesiyle öderiz.`],
      ['Bağlantım ne kadar geçerli?', `Yönlendirme bağlantınıza bir tıklama, kayıt formuna ${f.days} boyunca kodunuzu yazar. Biri daha sonra başka bir ortağın bağlantısına tıklarsa son bağlantı geçerlidir. Sonuçta önemli olan müşterinin kaydolurken kullandığı koddur.`],
      ['Hangi para biriminde ödenirim?', 'Komisyon müşteri faturasının para biriminde kazanılır: Progrid Technologies LLC müşterileri için ABD doları, Progrid Arabia müşterileri için Suudi riyali. Her para biriminin kendi bakiyesi ve asgari ödemesi vardır (200 SAR veya 50 USD).'],
      ['Neler yasak?', 'Kendinizi veya kendi işletmelerinizi kodunuzla kaydetmek, arama reklamlarında Progrid marka terimlerine teklif vermek, spam, içeriğiniz olmadan kod yayınlayan kupon siteleri ve Progrid hakkında yanıltıcı iddialar. Kurallara uymamak komisyonu iptal eder ve katılımınızı sona erdirebilir.'],
      ['Ortak olduğumu belirtmem gerekir mi?', 'Evet. Bağlantı veya kodun yakınında, komisyon kazandığınızı kitlenize açıkça söyleyin. Bu, çoğu ülkenin tüketici koruma kurallarının ve koşullarımızın gereğidir.'],
      ['Mevcut Progrid müşterileri katılabilir mi?', 'Evet. Mevcut hesabınızla başvurun. Kendi kullanımınız asla komisyon kazandırmaz.'],
    ],
    termsLink: 'Ortaklık programı koşullarını okuyun',
    ctaH2: 'Başlamaya hazır mısınız?',
    ctaLead: (f) => `Birkaç dakikada başvurun. Onaylandığınızda kodunuzla kaydolan her müşteriden %${f.maxRate}'a kadar kazanırsınız.`,
    days: (n) => `${n} gün`,
  },
  ar: {
    metaTitle: 'برنامج الشركاء: عمولة متكررة على كل عميل',
    metaDescription: (f) => `انضم إلى برنامج شركاء Progrid لصنّاع المحتوى. اربح عمولة متكررة تصل إلى ${f.maxRate}% لمدة ${f.months} شهرًا على كل عميل يسجّل برمزك، وامنح جمهورك خصمًا بنسبة ${f.discount}%.`,
    eyebrow: 'برنامج الشركاء',
    h1: 'اربح مع كل مطوّر تجلبه إلى Progrid.',
    lead: (f) => `شارك رمزك مع جمهورك. يحصل كل عميل يسجّل به على خصم ${f.discount}% لمدة ${f.discountMonths} أشهر، وتربح أنت حتى ${f.maxRate}% مما يدفعه لمدة ${f.months} شهرًا.`,
    apply: 'قدّم الآن', applyClosed: 'التقديم متوقف مؤقتًا', howLink: 'كيف يعمل',
    stats: (f) => [[`${f.maxRate}%`, 'أعلى نسبة عمولة'], [`${f.months}`, 'شهرًا من العمولة المتكررة'], [`${f.discount}%`, 'خصم لجمهورك'], [f.minPayout, 'الحد الأدنى للصرف']],
    howH2: 'كيف يعمل',
    how: (f) => [
      ['قدّم طلبك', 'أخبرنا عن قنواتك وكيف تخطط للترويج لـ Progrid. نراجع كل طلب، وغالبًا خلال أيام عمل قليلة.'],
      ['شارك رمزك', `بعد القبول تحصل على رمز شخصي ورابط إحالة. يكتب الرابط رمزك تلقائيًا في نموذج التسجيل لمدة ${f.days} بعد النقر.`],
      ['يسجّل العملاء برمزك', `يحصلون على خصم ${f.discount}% على فواتيرهم لمدة ${f.discountMonths} أشهر. ولا يُحتسب لك إلا العملاء الذين يسجّلون برمزك أو يضيفونه قبل أول فاتورة مدفوعة.`],
      ['استلم أرباحك', `تُكتسب العمولة عند دفع فواتيرهم، وتصبح قابلة للصرف بعد فترة انتظار مدتها ${f.hold} يومًا، ويمكنك طلب الصرف عند بلوغ ${f.minPayout}.`],
    ],
    ratesH2: 'العمولة حسب المنتج',
    ratesLead: (f) => `نسبة مما يدفعه كل عميل أحلته، كل شهر، خلال أول ${f.months} شهرًا.`,
    colProduct: 'المنتج', colRate: 'العمولة', colIncludes: 'يشمل',
    categories: {
      web_hosting: ['استضافة المواقع', 'منصة التطبيقات وتطبيقات المتجر بنقرة واحدة'],
      connect: ['Progrid Connect', 'تشغيلات وكلاء الذكاء الاصطناعي والأتمتة واستدعاءات الأدوات'],
      servers: ['الخوادم والبنية التحتية', 'الخوادم والأقراص والنسخ الاحتياطية وموازنات الحمل وتخزين الكائنات وقواعد البيانات المُدارة وKubernetes'],
      managed_cloud: ['السحابة المُدارة', 'باقات السحابة المُدارة ووقت المهندسين'],
      ai_usage: ['استخدام نماذج الذكاء الاصطناعي', 'رموز النماذج التي يستخدمها وكلاء Connect'],
      support: ['باقات الدعم', 'باقات الدعم المدفوعة'],
    },
    ratesNote: 'تُحسب العمولة على المبلغ المدفوع فعليًا، دون ضريبة القيمة المضافة والضرائب الأخرى والخصومات والرصيد المجاني. وتُخصم المبالغ المستردة أو المعترض عليها.',
    whoH2: 'لمن هذا البرنامج',
    whoLead: 'لصنّاع المحتوى والمجتمعات الذين يعلّمون المطورين ويبنون معهم ويوصونهم بالأدوات.',
    who: [
      ['صنّاع يوتيوب والبث المباشر', 'الدروس وشروحات النشر وقنوات المختبرات المنزلية وDevOps.'],
      ['الكتّاب والنشرات البريدية', 'المدونات والنشرات ومواقع التوثيق الموجهة للمطورين.'],
      ['المعلمون', 'الدورات والمعسكرات التدريبية والمدربون الذين يحتاجون سحابة لطلابهم.'],
      ['المجتمعات', 'مجتمعات المطورين والبودكاست ومنظمو اللقاءات.'],
      ['الوكالات والمستقلون', 'الفرق التي تبني المشاريع وتستضيفها لعملائها.'],
    ],
    faqH2: 'أسئلة شائعة',
    faq: (f) => [
      ['متى أستلم أرباحي؟', `تبقى العمولة معلّقة ${f.hold} يومًا بعد دفع العميل للفاتورة، حتى تتضح حالات الاسترداد والاعتراض، ثم تصبح قابلة للصرف. اطلب الصرف من بوابة الشركاء عند بلوغ رصيدك القابل للصرف الحد الأدنى، ونحوّل المبلغ بتحويل بنكي خلال 10 أيام عمل في الغالب.`],
      ['كم يبقى رابطي فعّالًا؟', `النقر على رابط الإحالة يكتب رمزك في نموذج التسجيل لمدة ${f.days}. وإذا نقر الشخص لاحقًا على رابط شريك آخر فالرابط الأحدث هو المعتمد. وفي النهاية يُحتسب الرمز الذي يسجّل به العميل.`],
      ['بأي عملة أستلم أرباحي؟', 'تُكتسب العمولة بعملة فاتورة العميل: بالدولار الأمريكي لعملاء Progrid Technologies LLC، وبالريال السعودي لعملاء Progrid Arabia. ولكل عملة رصيد مستقل وحد أدنى للصرف (200 ريال أو 50 دولارًا).'],
      ['ما الممنوع؟', 'تسجيل نفسك أو أعمالك الخاصة برمزك، والمزايدة على العلامة التجارية Progrid في إعلانات البحث، والرسائل المزعجة، ومواقع القسائم التي تنشر الرموز دون محتوى منك، والادعاءات المضللة عن Progrid. ومخالفة القواعد تلغي العمولة وقد تنهي مشاركتك.'],
      ['هل يجب أن أفصح أنني شريك؟', 'نعم. أخبر جمهورك بوضوح، بالقرب من الرابط أو الرمز، أنك تحصل على عمولة. وهذا مطلوب في أنظمة حماية المستهلك في أغلب الدول وفي شروطنا.'],
      ['هل يمكن لعملاء Progrid الحاليين الانضمام؟', 'نعم. قدّم بحسابك الحالي. ولا يحقق استخدامك الشخصي أي عمولة.'],
    ],
    termsLink: 'اقرأ شروط برنامج الشركاء',
    ctaH2: 'مستعد للبدء؟',
    ctaLead: (f) => `قدّم طلبك في دقائق. وبعد القبول تربح حتى ${f.maxRate}% على كل عميل يسجّل برمزك.`,
    days: (n) => `${n} ${n <= 10 && n > 2 ? 'أيام' : 'يومًا'}`,
  },
};

function facts(p: Program, lang: Lang, currency: 'USD' | 'SAR'): Facts {
  // Western digits in Arabic too, as on the rest of the site's prices.
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : lang === 'tr' ? 'tr-TR' : 'en-US';
  const minPayout = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(p.minPayoutMinor[currency] / 100);
  return { maxRate: Math.max(...Object.values(p.rates)), months: p.commissionMonths, discount: p.promoDiscountPercent, discountMonths: p.promoDiscountMonths, days: COPY[lang].days(p.cookieDays), hold: p.holdDays, minPayout };
}

export async function affiliatesMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  const c = COPY[lang];
  const description = c.metaDescription(facts(await program(site.urls.api), lang, site.currency));
  return { title: c.metaTitle, description, alternates: alternatesFor(site, lang, '/affiliates'), openGraph: { title: c.metaTitle, description, type: 'website' } };
}

export async function Affiliates({ lang }: { lang: Lang }) {
  const site = await getSite();
  const p = await program(site.urls.api);
  const c = COPY[lang];
  const f = facts(p, lang, site.currency);
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const applyHref = `${site.urls.console}/affiliates/portal`;
  const apply = p.applicationsOpen
    ? <a href={applyHref} className="btn-primary">{c.apply}</a>
    : <span className="rounded-lg border border-white/30 px-4 py-2 text-sm text-slate-300">{c.applyClosed}</span>;
  return (
    <LangProvider lang={lang}>
      <Header />
      <main>
        <section className="hero-bg py-20 text-white">
          <div className="container-x max-w-4xl">
            <span className="eyebrow text-sky-300">{c.eyebrow}</span>
            <h1 className="hero-title mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">{c.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-slate-300">{c.lead(f)}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {apply}
              <a href="#how" className="btn-light">{c.howLink}</a>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50">
          <div className="container-x grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
            {c.stats(f).map(([v, l]) => <div key={l}><div className="text-3xl font-bold text-slate-900">{v}</div><div className="mt-1 text-sm text-slate-500">{l}</div></div>)}
          </div>
        </section>

        <section id="how" className="scroll-mt-20 py-20">
          <div className="container-x">
            <span className="eyebrow">{c.howH2}</span>
            <h2 className="h2">{c.howH2}</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {c.how(f).map(([t, d], i) => <div key={t} className="rounded-2xl border border-slate-200 p-6"><div className="text-sm font-semibold text-blue-600">0{i + 1}</div><h3 className="mt-2 text-lg font-semibold">{t}</h3><p className="mt-2 text-slate-600">{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 py-20">
          <div className="container-x">
            <span className="eyebrow">{c.ratesH2}</span>
            <h2 className="h2">{c.ratesH2}</h2>
            <p className="lead">{c.ratesLead(f)}</p>
            <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="px-5 py-3 text-start">{c.colProduct}</th><th className="px-5 py-3 text-start">{c.colIncludes}</th><th className="px-5 py-3 text-end">{c.colRate}</th></tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((k) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-medium">{c.categories[k][0]}</td>
                      <td className="px-5 py-3 text-slate-600">{c.categories[k][1]}</td>
                      <td className={`px-5 py-3 text-end font-semibold ${p.rates[k] ? 'text-slate-900' : 'text-slate-400'}`} dir="ltr">{p.rates[k]}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">{c.ratesNote}</p>
          </div>
        </section>

        <section className="py-20">
          <div className="container-x">
            <span className="eyebrow">{c.whoH2}</span>
            <h2 className="h2">{c.whoH2}</h2>
            <p className="lead">{c.whoLead}</p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
              {c.who.map(([t, d]) => <div key={t} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-slate-600">{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-50 py-20">
          <div className="container-x max-w-3xl">
            <h2 className="h2">{c.faqH2}</h2>
            <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {c.faq(f).map(([q, a]) => (
                <details key={q} className="group px-6 py-4">
                  <summary className="cursor-pointer list-none font-medium text-slate-900">{q}</summary>
                  <p className="mt-2 text-slate-600">{a}</p>
                </details>
              ))}
            </div>
            <p className="mt-6 text-sm"><a href={`${prefix}/affiliates/terms`} className="font-medium text-blue-600 hover:underline">{c.termsLink}</a></p>
          </div>
        </section>

        <section className="hero-bg py-20 text-white">
          <div className="container-x text-center">
            <h2 className="text-3xl font-bold tracking-tight">{c.ctaH2}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">{c.ctaLead(f)}</p>
            <div className="mt-8 flex justify-center gap-3">{apply}</div>
          </div>
        </section>
      </main>
      <Footer />
    </LangProvider>
  );
}

/* ───────────────────────── Terms ───────────────────────── */

const TERMS_EYEBROW: Record<Lang, string> = { en: 'Affiliate program', tr: 'Ortaklık programı', ar: 'برنامج الشركاء' };

export async function affiliateTermsMetadata(lang: Lang): Promise<Metadata> {
  const site = await getSite();
  const page = getPage(site.site, lang, 'affiliate-terms');
  return { title: page?.title, description: page?.description, alternates: alternatesFor(site, lang, '/affiliates/terms') };
}

export async function AffiliateTerms({ lang }: { lang: Lang }) {
  const site = await getSite();
  const page = getPage(site.site, lang, 'affiliate-terms')!;
  return <SitePage lang={lang} eyebrow={TERMS_EYEBROW[lang]} title={page.title} description={page.description} updated={page.updated} html={page.html} fallback={page.fallback} />;
}
