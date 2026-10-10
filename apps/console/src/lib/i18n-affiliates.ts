/** Affiliate portal strings in the three launch languages. English is the source of truth. */
import type { Locale } from './i18n';

const en = {
  title: 'Affiliate program', subtitle: 'Earn commission on every customer who signs up with your code.',
  learnMore: 'How the program works', termsLink: 'Program terms', loading: 'Loading…',
  // application
  applyTitle: 'Apply to the affiliate program', applyLead: 'Tell us about your channels. We review every application, usually within a few business days.',
  accountH: 'Your account', accountNote: 'You will use this account to sign in to the portal. Already a Progrid customer?', signInFirst: 'Sign in first',
  name: 'Full name', email: 'Email', password: 'Password', passwordHint: 'At least 10 characters.', country: 'Country',
  channelsH: 'Your channels', channels: 'Channel links', channelsHint: 'YouTube, X, a blog, a newsletter, a course. One link per line, up to 10.',
  audience: 'Audience size', aud_under_1k: 'Under 1,000', aud_1k_10k: '1,000 to 10,000', aud_10k_50k: '10,000 to 50,000', aud_50k_250k: '50,000 to 250,000', aud_over_250k: 'Over 250,000',
  language: 'Content language', lang_ar: 'Arabic', lang_en: 'English', lang_ar_en: 'Arabic and English', lang_other: 'Other',
  plan: 'How will you promote Progrid?', planHint: 'Videos, posts, a course, a community. At least 20 characters.',
  preferredCode: 'Preferred code (optional)', preferredCodeHint: '4 to 20 letters and digits. We pick one if it is taken.',
  acceptTerms: 'I accept the affiliate program terms and will disclose that I earn a commission.',
  submit: 'Send application', sending: 'Sending…', choose: 'Choose…',
  applicationsClosed: 'Applications are paused right now. Check back soon.',
  // status
  pendingH: 'Your application is being reviewed', pendingBody: 'We usually answer within a few business days and will email you at',
  rejectedH: 'Your application was not accepted', reapplyOn: 'You can apply again on', reapplyNow: 'You can apply again now.',
  suspendedH: 'Your affiliate account is suspended', suspendedBody: 'Your code no longer gives new referrals or commission. Contact support if you think this is a mistake.',
  reason: 'Reason', appliedOn: 'Applied on',
  // tabs
  tabDashboard: 'Dashboard', tabReferrals: 'Referrals', tabPayouts: 'Payouts', tabAssets: 'Assets',
  // dashboard
  yourCode: 'Your partner code', yourLinks: 'Your referral links', linkHint: 'A click fills in your code on the signup form. Customers must sign up with the code for you to earn.',
  promoLink: 'Signup link with your code',
  range: 'Period', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', from: 'From', to: 'To', apply: 'Apply',
  clicks: 'Clicks', signups: 'Signups with your code', paying: 'Paying customers',
  earned: 'Commission in this period', pending: 'Pending', approved: 'Approved', paid: 'Paid out', reversed: 'Reversed',
  balances: 'Balances', available: 'Ready to pay out', requested: 'Payout requested', minimum: 'Minimum payout',
  pendingHint: (days: number) => `Commission stays pending for ${days} days after the customer pays, then becomes ready to pay out.`,
  // referrals
  noReferrals: 'No referred customers yet. Share your code to get started.', customer: 'Customer', signedUp: 'Signed up', status: 'Status', services: 'Services', commission: 'Commission', earnsUntil: 'Earns until',
  st_signed_up: 'Signed up', st_paying: 'Paying', st_not_eligible: 'Not eligible', loadMore: 'Load more',
  cat_web_hosting: 'Web hosting', cat_connect: 'Connect', cat_servers: 'Servers', cat_managed_cloud: 'Managed cloud', cat_ai_usage: 'AI usage', cat_support: 'Support',
  // payouts
  requestPayout: 'Request payout', requesting: 'Requesting…', belowMin: (min: string) => `Available once you reach ${min}.`, needDetails: 'Add your payout details first.',
  payoutRequested: 'Payout requested. We will email you when it is sent.',
  detailsH: 'Payout details', detailsLead: 'We pay by bank transfer. Progrid Arabia pays commission in US dollars and in Saudi riyals.',
  holderName: 'Account holder name', bankName: 'Bank name', bankCountry: 'Bank country', iban: 'IBAN or account number', swift: 'SWIFT / BIC (optional)', note: 'Note for our finance team (optional)',
  saveDetails: 'Save payout details', saved: 'Saved.', onFile: 'On file', ending: 'ending in', change: 'Change',
  historyH: 'Payout history', noPayouts: 'No payouts yet.', amount: 'Amount', requestedOn: 'Requested', paidOn: 'Paid', reference: 'Reference',
  ps_requested: 'Requested', ps_paid: 'Paid', ps_cancelled: 'Cancelled',
  // assets
  logosH: 'Logos', banners: 'Banners', download: 'Download', copyH: 'Ready to use copy', copy: 'Copy', copied: 'Copied',
  disclosureH: 'Disclosure', disclosure: 'Always tell your audience that you earn a commission, close to your link or code. For example: “I earn a commission if you sign up with my code.”',
  snippets: (code: string, pct: number, months: number) => [
    `I host my projects on Progrid: servers, databases and apps with simple hourly pricing. Sign up with my code ${code} for ${pct}% off your first ${months} months.`,
    `Looking for a developer cloud? Try Progrid with code ${code} and get ${pct}% off for ${months} months. (I earn a commission if you sign up with my code.)`,
    `Deploy servers, databases and AI agents on Progrid. Use code ${code} at signup for ${pct}% off.`,
  ],
  // errors
  withheld: 'Withheld', net: 'Net paid',
  errGeneric: 'Something went wrong. Try again.',
};

type Dict = { [K in keyof typeof en]: (typeof en)[K] };

const tr: Dict = {
  title: 'Ortaklık programı', subtitle: 'Kodunuzla kaydolan her müşteriden komisyon kazanın.',
  learnMore: 'Program nasıl çalışır', termsLink: 'Program koşulları', loading: 'Yükleniyor…',
  applyTitle: 'Ortaklık programına başvurun', applyLead: 'Kanallarınızı anlatın. Her başvuruyu genellikle birkaç iş günü içinde inceleriz.',
  accountH: 'Hesabınız', accountNote: 'Portala bu hesapla giriş yapacaksınız. Zaten Progrid müşterisi misiniz?', signInFirst: 'Önce giriş yapın',
  name: 'Ad soyad', email: 'E-posta', password: 'Şifre', passwordHint: 'En az 10 karakter.', country: 'Ülke',
  channelsH: 'Kanallarınız', channels: 'Kanal bağlantıları', channelsHint: 'YouTube, X, blog, bülten, kurs. Her satıra bir bağlantı, en fazla 10.',
  audience: 'Kitle büyüklüğü', aud_under_1k: '1.000’den az', aud_1k_10k: '1.000 ile 10.000 arası', aud_10k_50k: '10.000 ile 50.000 arası', aud_50k_250k: '50.000 ile 250.000 arası', aud_over_250k: '250.000’den fazla',
  language: 'İçerik dili', lang_ar: 'Arapça', lang_en: 'İngilizce', lang_ar_en: 'Arapça ve İngilizce', lang_other: 'Diğer',
  plan: 'Progrid’i nasıl tanıtacaksınız?', planHint: 'Videolar, gönderiler, bir kurs, bir topluluk. En az 20 karakter.',
  preferredCode: 'Tercih ettiğiniz kod (isteğe bağlı)', preferredCodeHint: '4 ile 20 harf ve rakam. Alınmışsa biz seçeriz.',
  acceptTerms: 'Ortaklık programı koşullarını kabul ediyorum ve komisyon kazandığımı açıkça belirteceğim.',
  submit: 'Başvuruyu gönder', sending: 'Gönderiliyor…', choose: 'Seçin…',
  applicationsClosed: 'Başvurular şu anda duraklatıldı. Yakında tekrar bakın.',
  pendingH: 'Başvurunuz inceleniyor', pendingBody: 'Genellikle birkaç iş günü içinde yanıt verir ve şu adrese e-posta göndeririz:',
  rejectedH: 'Başvurunuz kabul edilmedi', reapplyOn: 'Tekrar başvurabileceğiniz tarih:', reapplyNow: 'Şimdi tekrar başvurabilirsiniz.',
  suspendedH: 'Ortaklık hesabınız askıya alındı', suspendedBody: 'Kodunuz artık yeni yönlendirme veya komisyon sağlamıyor. Bir hata olduğunu düşünüyorsanız destekle iletişime geçin.',
  reason: 'Neden', appliedOn: 'Başvuru tarihi',
  tabDashboard: 'Pano', tabReferrals: 'Yönlendirmeler', tabPayouts: 'Ödemeler', tabAssets: 'Materyaller',
  yourCode: 'Ortak kodunuz', yourLinks: 'Yönlendirme bağlantılarınız', linkHint: 'Bir tıklama, kayıt formuna kodunuzu yazar. Kazanmanız için müşterilerin kodla kaydolması gerekir.',
  promoLink: 'Kodunuzla kayıt bağlantısı',
  range: 'Dönem', last7: 'Son 7 gün', last30: 'Son 30 gün', last90: 'Son 90 gün', from: 'Başlangıç', to: 'Bitiş', apply: 'Uygula',
  clicks: 'Tıklamalar', signups: 'Kodunuzla kayıtlar', paying: 'Ödeme yapan müşteriler',
  earned: 'Bu dönemdeki komisyon', pending: 'Beklemede', approved: 'Onaylandı', paid: 'Ödendi', reversed: 'Geri alındı',
  balances: 'Bakiyeler', available: 'Ödemeye hazır', requested: 'Ödeme talep edildi', minimum: 'Asgari ödeme',
  pendingHint: (days: number) => `Komisyon, müşteri ödedikten sonra ${days} gün beklemede kalır, sonra ödemeye hazır olur.`,
  noReferrals: 'Henüz yönlendirilen müşteri yok. Başlamak için kodunuzu paylaşın.', customer: 'Müşteri', signedUp: 'Kayıt', status: 'Durum', services: 'Hizmetler', commission: 'Komisyon', earnsUntil: 'Kazanç bitişi',
  st_signed_up: 'Kaydoldu', st_paying: 'Ödüyor', st_not_eligible: 'Uygun değil', loadMore: 'Daha fazla',
  cat_web_hosting: 'Web barındırma', cat_connect: 'Connect', cat_servers: 'Sunucular', cat_managed_cloud: 'Yönetilen bulut', cat_ai_usage: 'Yapay zeka kullanımı', cat_support: 'Destek',
  requestPayout: 'Ödeme talep et', requesting: 'Talep ediliyor…', belowMin: (min: string) => `${min} tutarına ulaştığınızda kullanılabilir.`, needDetails: 'Önce ödeme bilgilerinizi ekleyin.',
  payoutRequested: 'Ödeme talep edildi. Gönderildiğinde size e-posta göndereceğiz.',
  detailsH: 'Ödeme bilgileri', detailsLead: 'Banka havalesiyle öderiz. ABD doları ve Suudi riyali komisyonlarını Progrid Arabia öder.',
  holderName: 'Hesap sahibi', bankName: 'Banka adı', bankCountry: 'Banka ülkesi', iban: 'IBAN veya hesap numarası', swift: 'SWIFT / BIC (isteğe bağlı)', note: 'Finans ekibimize not (isteğe bağlı)',
  saveDetails: 'Ödeme bilgilerini kaydet', saved: 'Kaydedildi.', onFile: 'Kayıtlı', ending: 'son dört hane', change: 'Değiştir',
  historyH: 'Ödeme geçmişi', noPayouts: 'Henüz ödeme yok.', amount: 'Tutar', requestedOn: 'Talep', paidOn: 'Ödeme', reference: 'Referans',
  ps_requested: 'Talep edildi', ps_paid: 'Ödendi', ps_cancelled: 'İptal edildi',
  logosH: 'Logolar', banners: 'Bannerlar', download: 'İndir', copyH: 'Kullanıma hazır metinler', copy: 'Kopyala', copied: 'Kopyalandı',
  disclosureH: 'Açıklama', disclosure: 'Bağlantınızın veya kodunuzun yakınında komisyon kazandığınızı kitlenize her zaman söyleyin. Örneğin: “Kodumla kaydolursanız komisyon kazanırım.”',
  snippets: (code: string, pct: number, months: number) => [
    `Projelerimi Progrid’de barındırıyorum: basit saatlik fiyatlı sunucular, veritabanları ve uygulamalar. ${code} koduyla kaydolun, ilk ${months} ayda %${pct} indirim alın.`,
    `Bir geliştirici bulutu mu arıyorsunuz? Progrid’i ${code} koduyla deneyin, ${months} ay boyunca %${pct} indirim alın. (Kodumla kaydolursanız komisyon kazanırım.)`,
    `Progrid’de sunucular, veritabanları ve yapay zeka ajanları çalıştırın. Kayıtta ${code} kodunu kullanın, %${pct} indirim alın.`,
  ],
  withheld: 'Kesinti', net: 'Net ödenen',
  errGeneric: 'Bir sorun oluştu. Tekrar deneyin.',
};

const ar: Dict = {
  title: 'برنامج الشركاء', subtitle: 'اربح عمولة على كل عميل يسجّل برمزك.',
  learnMore: 'كيف يعمل البرنامج', termsLink: 'شروط البرنامج', loading: 'جارٍ التحميل…',
  applyTitle: 'قدّم على برنامج الشركاء', applyLead: 'أخبرنا عن قنواتك. نراجع كل طلب، وغالبًا خلال أيام عمل قليلة.',
  accountH: 'حسابك', accountNote: 'ستستخدم هذا الحساب لتسجيل الدخول إلى البوابة. هل أنت عميل لدى Progrid؟', signInFirst: 'سجّل الدخول أولًا',
  name: 'الاسم الكامل', email: 'البريد الإلكتروني', password: 'كلمة المرور', passwordHint: '10 أحرف على الأقل.', country: 'الدولة',
  channelsH: 'قنواتك', channels: 'روابط القنوات', channelsHint: 'يوتيوب أو X أو مدونة أو نشرة بريدية أو دورة. رابط في كل سطر، وحتى 10 روابط.',
  audience: 'حجم الجمهور', aud_under_1k: 'أقل من 1,000', aud_1k_10k: 'من 1,000 إلى 10,000', aud_10k_50k: 'من 10,000 إلى 50,000', aud_50k_250k: 'من 50,000 إلى 250,000', aud_over_250k: 'أكثر من 250,000',
  language: 'لغة المحتوى', lang_ar: 'العربية', lang_en: 'الإنجليزية', lang_ar_en: 'العربية والإنجليزية', lang_other: 'أخرى',
  plan: 'كيف ستروّج لـ Progrid؟', planHint: 'فيديوهات أو منشورات أو دورة أو مجتمع. 20 حرفًا على الأقل.',
  preferredCode: 'الرمز المفضل (اختياري)', preferredCodeHint: 'من 4 إلى 20 حرفًا ورقمًا بالإنجليزية. نختار رمزًا آخر إن كان مستخدمًا.',
  acceptTerms: 'أوافق على شروط برنامج الشركاء وسأفصح لجمهوري أنني أحصل على عمولة.',
  submit: 'أرسل الطلب', sending: 'جارٍ الإرسال…', choose: 'اختر…',
  applicationsClosed: 'التقديم متوقف مؤقتًا. عد لاحقًا.',
  pendingH: 'طلبك قيد المراجعة', pendingBody: 'نرد عادة خلال أيام عمل قليلة، وسنراسلك على',
  rejectedH: 'لم يُقبل طلبك', reapplyOn: 'يمكنك التقديم مرة أخرى في', reapplyNow: 'يمكنك التقديم مرة أخرى الآن.',
  suspendedH: 'حساب الشريك موقوف', suspendedBody: 'لم يعد رمزك يحقق إحالات أو عمولات جديدة. تواصل مع الدعم إن كنت ترى أن ذلك خطأ.',
  reason: 'السبب', appliedOn: 'تاريخ التقديم',
  tabDashboard: 'لوحة المتابعة', tabReferrals: 'الإحالات', tabPayouts: 'الدفعات', tabAssets: 'المواد التسويقية',
  yourCode: 'رمز الشريك', yourLinks: 'روابط الإحالة', linkHint: 'النقر على الرابط يكتب رمزك في نموذج التسجيل. ولا تُحتسب لك العمولة إلا إذا سجّل العميل بالرمز.',
  promoLink: 'رابط التسجيل برمزك',
  range: 'الفترة', last7: 'آخر 7 أيام', last30: 'آخر 30 يومًا', last90: 'آخر 90 يومًا', from: 'من', to: 'إلى', apply: 'تطبيق',
  clicks: 'النقرات', signups: 'التسجيلات برمزك', paying: 'العملاء الدافعون',
  earned: 'العمولة في هذه الفترة', pending: 'معلّقة', approved: 'معتمدة', paid: 'مصروفة', reversed: 'ملغاة',
  balances: 'الأرصدة', available: 'جاهزة للصرف', requested: 'طُلب صرفها', minimum: 'الحد الأدنى للصرف',
  pendingHint: (days: number) => `تبقى العمولة معلّقة ${days} يومًا بعد دفع العميل، ثم تصبح جاهزة للصرف.`,
  noReferrals: 'لا يوجد عملاء محالون بعد. شارك رمزك لتبدأ.', customer: 'العميل', signedUp: 'تاريخ التسجيل', status: 'الحالة', services: 'الخدمات', commission: 'العمولة', earnsUntil: 'العمولة حتى',
  st_signed_up: 'مسجّل', st_paying: 'يدفع', st_not_eligible: 'غير مؤهل', loadMore: 'عرض المزيد',
  cat_web_hosting: 'استضافة المواقع', cat_connect: 'Connect', cat_servers: 'الخوادم', cat_managed_cloud: 'السحابة المُدارة', cat_ai_usage: 'استخدام الذكاء الاصطناعي', cat_support: 'الدعم',
  requestPayout: 'اطلب الصرف', requesting: 'جارٍ الطلب…', belowMin: (min: string) => `متاح عند بلوغ ${min}.`, needDetails: 'أضف بيانات الصرف أولًا.',
  payoutRequested: 'تم طلب الصرف. سنراسلك عند التحويل.',
  detailsH: 'بيانات الصرف', detailsLead: 'نصرف بتحويل بنكي. وتصرف Progrid Arabia العمولة بالدولار الأمريكي وبالريال السعودي.',
  holderName: 'اسم صاحب الحساب', bankName: 'اسم البنك', bankCountry: 'دولة البنك', iban: 'رقم الآيبان أو رقم الحساب', swift: 'رمز SWIFT / BIC (اختياري)', note: 'ملاحظة لفريق المالية (اختياري)',
  saveDetails: 'احفظ بيانات الصرف', saved: 'تم الحفظ.', onFile: 'مسجّلة', ending: 'ينتهي بـ', change: 'تغيير',
  historyH: 'سجل الدفعات', noPayouts: 'لا توجد دفعات بعد.', amount: 'المبلغ', requestedOn: 'تاريخ الطلب', paidOn: 'تاريخ الصرف', reference: 'المرجع',
  ps_requested: 'مطلوبة', ps_paid: 'مصروفة', ps_cancelled: 'ملغاة',
  logosH: 'الشعارات', banners: 'اللافتات', download: 'تنزيل', copyH: 'نصوص جاهزة', copy: 'نسخ', copied: 'تم النسخ',
  disclosureH: 'الإفصاح', disclosure: 'أخبر جمهورك دائمًا، بالقرب من رابطك أو رمزك، أنك تحصل على عمولة. مثلًا: «أحصل على عمولة إذا سجّلت برمزي».',
  snippets: (code: string, pct: number, months: number) => [
    `أستضيف مشاريعي على Progrid: خوادم وقواعد بيانات وتطبيقات بأسعار واضحة بالساعة. سجّل برمزي ${code} واحصل على خصم ${pct}% لأول ${months} أشهر.`,
    `تبحث عن سحابة للمطورين؟ جرّب Progrid بالرمز ${code} واحصل على خصم ${pct}% لمدة ${months} أشهر. (أحصل على عمولة إذا سجّلت برمزي).`,
    `انشر الخوادم وقواعد البيانات ووكلاء الذكاء الاصطناعي على Progrid. استخدم الرمز ${code} عند التسجيل لخصم ${pct}%.`,
  ],
  withheld: 'المبلغ المستقطع', net: 'الصافي المدفوع',
  errGeneric: 'حدث خطأ. حاول مرة أخرى.',
};

const DICT: Record<Locale, Dict> = { en, tr, ar };

export type AKey = keyof Dict;
export type AStringKey = { [K in AKey]: Dict[K] extends string ? K : never }[AKey];

export function at(locale: Locale, key: AStringKey): string {
  return (DICT[locale] ?? en)[key] as string;
}
export function atf<K extends AKey>(locale: Locale, key: K): Dict[K] {
  return (DICT[locale] ?? en)[key];
}
/** A string chosen by a value from the API, such as a status or a category. */
export function adyn(locale: Locale, prefix: string, value: string): string {
  const d = (DICT[locale] ?? en) as unknown as Record<string, unknown>;
  const v = d[`${prefix}${value}`];
  return typeof v === 'string' ? v : value;
}
