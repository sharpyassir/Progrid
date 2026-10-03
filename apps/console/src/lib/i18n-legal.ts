import type { Locale } from './i18n';

/** Strings for the legal agreement (signup checkbox and the acceptance screen). */
const en = {
  agreeLead: 'I have read and agree to the',
  terms: 'Terms of service',
  aup: 'Acceptable use policy',
  privacy: 'Privacy policy',
  and: 'and the',
  agreeTail: '. I am at least 18 years old and may accept them for my team or company.',
  agreeRequired: 'Tick the box to accept the terms before you continue.',
  socialNeedsAgree: 'Tick the box above first to sign up with Google or Microsoft.',
  gateTitle: 'Review and accept our terms',
  gateNew: 'Before you continue, read and accept the current version of our legal documents. You can use Progrid again as soon as you accept.',
  gateUpdated: 'We updated our legal documents. Read the changes and accept the current version to keep using Progrid. API tokens on your account work again once you accept.',
  gateAlso: 'They also incorporate:',
  version: 'Version',
  accept: 'I agree, continue',
  signOut: 'Sign out',
  dpa: 'Data processing addendum',
  refunds: 'Refunds',
  sla: 'SLA',
  cookies: 'Cookies',
  subprocessors: 'Subprocessors',
  exportSanctions: 'Export controls and sanctions',
};
type Strings = typeof en;

const ar: Strings = {
  agreeLead: 'قرأت وأوافق على',
  terms: 'شروط الخدمة',
  aup: 'سياسة الاستخدام المقبول',
  privacy: 'سياسة الخصوصية',
  and: 'و',
  agreeTail: '. وعمري 18 عامًا على الأقل ولدي صلاحية قبولها عن فريقي أو شركتي.',
  agreeRequired: 'ضع علامة في المربع لقبول الشروط قبل المتابعة.',
  socialNeedsAgree: 'ضع علامة في المربع أعلاه أولًا للتسجيل عبر Google أو Microsoft.',
  gateTitle: 'راجع شروطنا ووافق عليها',
  gateNew: 'قبل المتابعة، اقرأ الإصدار الحالي من مستنداتنا القانونية ووافق عليه. يمكنك استخدام Progrid مجددًا فور الموافقة.',
  gateUpdated: 'حدّثنا مستنداتنا القانونية. اقرأ التغييرات ووافق على الإصدار الحالي لمواصلة استخدام Progrid. تعود مفاتيح API في حسابك للعمل فور موافقتك.',
  gateAlso: 'وتتضمن أيضًا:',
  version: 'الإصدار',
  accept: 'أوافق، متابعة',
  signOut: 'تسجيل الخروج',
  dpa: 'ملحق معالجة البيانات',
  refunds: 'الاسترداد',
  sla: 'اتفاقية مستوى الخدمة',
  cookies: 'ملفات تعريف الارتباط',
  subprocessors: 'المعالجون الفرعيون',
  exportSanctions: 'ضوابط التصدير والعقوبات',
};

const tr: Strings = {
  agreeLead: 'Şunları okudum ve kabul ediyorum:',
  terms: 'Hizmet koşulları',
  aup: 'Kabul edilebilir kullanım politikası',
  privacy: 'Gizlilik politikası',
  and: 've',
  agreeTail: '. En az 18 yaşındayım ve bunları ekibim veya şirketim adına kabul etmeye yetkiliyim.',
  agreeRequired: 'Devam etmeden önce koşulları kabul etmek için kutuyu işaretleyin.',
  socialNeedsAgree: 'Google veya Microsoft ile kaydolmak için önce yukarıdaki kutuyu işaretleyin.',
  gateTitle: 'Koşullarımızı inceleyin ve kabul edin',
  gateNew: 'Devam etmeden önce hukuki belgelerimizin güncel sürümünü okuyup kabul edin. Kabul ettiğiniz anda Progrid’i kullanmaya devam edebilirsiniz.',
  gateUpdated: 'Hukuki belgelerimizi güncelledik. Progrid’i kullanmaya devam etmek için değişiklikleri okuyun ve güncel sürümü kabul edin. Hesabınızdaki API anahtarları kabul ettiğinizde yeniden çalışır.',
  gateAlso: 'Ayrıca şunları içerir:',
  version: 'Sürüm',
  accept: 'Kabul ediyorum, devam et',
  signOut: 'Çıkış yap',
  dpa: 'Veri işleme eki',
  refunds: 'İadeler',
  sla: 'SLA',
  cookies: 'Çerezler',
  subprocessors: 'Alt işleyiciler',
  exportSanctions: 'İhracat kontrolleri ve yaptırımlar',
};

const dict: Record<Locale, Strings> = { en, ar, tr };
export const lt = (locale: Locale, k: keyof Strings) => dict[locale]?.[k] ?? en[k];
