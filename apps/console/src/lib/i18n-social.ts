/** Strings for sign in with Google and Microsoft, in the three launch languages. English is the source of truth. */
import type { Locale } from './i18n';

export type SocialProvider = 'google' | 'microsoft';
export const PROVIDER_NAME: Record<SocialProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

const en = {
  continueGoogle: 'Continue with Google',
  continueMicrosoft: 'Continue with Microsoft',
  or: 'or',
  signingIn: 'Signing you in…',
  twoFactorTitle: 'Two factor sign in',
  continue: 'Continue',
  backToSignIn: 'Back to sign in',
  backToSecurity: 'Back to Security',
  signInMethods: 'Sign in methods',
  signInMethodsNote: 'Ways you can sign in to this account. Keep at least one.',
  passwordLabel: 'Password',
  passwordIsSet: 'Set',
  passwordNotSet: 'Not set. You sign in with a linked account.',
  setPassword: 'Set a password',
  link: 'Link',
  unlink: 'Unlink',
  notLinked: 'Not linked',
  lastUsed: 'Last used',
  lastSignInMethod: 'This is your only way to sign in, so it cannot be unlinked. Set a password or link another account first.',
  linkedNotice: (p: string) => `${p} is linked. You can use it to sign in from now on.`,
  unlinkedNotice: (p: string) => `${p} is unlinked.`,
  err_state_invalid: 'This sign in took too long or was started in another browser. Try again.',
  err_cancelled: 'Sign in was cancelled.',
  err_provider_error: 'The provider could not finish the sign in. Try again in a minute.',
  err_provider_unavailable: 'This sign in option is not available right now.',
  err_token_invalid: 'We could not verify the answer from the provider. Try again.',
  err_link_from_security: 'An account with this email already exists. Sign in with your password, then link this account under Security.',
  err_identity_in_use: 'This account is already linked to another Progrid account.',
  err_email_missing: 'The provider did not share an email address. Use another account or sign up with email.',
  err_account_exists: 'An account with this email already exists. Sign in with your password.',
  err_invite_email_mismatch: 'This invitation is for another email address. Continue with the account of the invited address.',
  err_invite_invalid: 'This invitation link is no longer valid. Ask the team for a new one.',
  err_link_session_invalid: 'Your session ended before the account was linked. Open Security and try again.',
  err_code_invalid: 'This sign in link has expired or was already used. Try again.',
  err_generic: 'Sign in did not work. Try again.',
};

type Dict = typeof en;

const tr: Dict = {
  continueGoogle: 'Google ile devam et',
  continueMicrosoft: 'Microsoft ile devam et',
  or: 'veya',
  signingIn: 'Giriş yapılıyor…',
  twoFactorTitle: 'İki adımlı giriş',
  continue: 'Devam',
  backToSignIn: 'Girişe dön',
  backToSecurity: 'Güvenliğe dön',
  signInMethods: 'Giriş yöntemleri',
  signInMethodsNote: 'Bu hesaba giriş yapabileceğiniz yollar. En az birini koruyun.',
  passwordLabel: 'Şifre',
  passwordIsSet: 'Belirlendi',
  passwordNotSet: 'Belirlenmedi. Bağlı bir hesapla giriş yapıyorsunuz.',
  setPassword: 'Şifre belirle',
  link: 'Bağla',
  unlink: 'Bağlantıyı kaldır',
  notLinked: 'Bağlı değil',
  lastUsed: 'Son kullanım',
  lastSignInMethod: 'Bu, giriş yapmanın tek yolunuz, bu yüzden kaldırılamaz. Önce bir şifre belirleyin ya da başka bir hesap bağlayın.',
  linkedNotice: (p) => `${p} bağlandı. Artık bununla giriş yapabilirsiniz.`,
  unlinkedNotice: (p) => `${p} bağlantısı kaldırıldı.`,
  err_state_invalid: 'Giriş çok uzun sürdü ya da başka bir tarayıcıda başlatıldı. Yeniden deneyin.',
  err_cancelled: 'Giriş iptal edildi.',
  err_provider_error: 'Sağlayıcı girişi tamamlayamadı. Bir dakika sonra yeniden deneyin.',
  err_provider_unavailable: 'Bu giriş seçeneği şu anda kullanılamıyor.',
  err_token_invalid: 'Sağlayıcıdan gelen yanıtı doğrulayamadık. Yeniden deneyin.',
  err_link_from_security: 'Bu e-posta ile bir hesap zaten var. Şifrenizle giriş yapın, sonra bu hesabı Güvenlik sayfasından bağlayın.',
  err_identity_in_use: 'Bu hesap başka bir Progrid hesabına bağlı.',
  err_email_missing: 'Sağlayıcı bir e-posta adresi paylaşmadı. Başka bir hesap kullanın ya da e-posta ile kaydolun.',
  err_account_exists: 'Bu e-posta ile bir hesap zaten var. Şifrenizle giriş yapın.',
  err_invite_email_mismatch: 'Bu davet başka bir e-posta adresi için. Davet edilen adresin hesabıyla devam edin.',
  err_invite_invalid: 'Bu davet bağlantısı artık geçerli değil. Ekipten yeni bir davet isteyin.',
  err_link_session_invalid: 'Hesap bağlanmadan önce oturumunuz sona erdi. Güvenlik sayfasını açıp yeniden deneyin.',
  err_code_invalid: 'Bu giriş bağlantısının süresi doldu ya da zaten kullanıldı. Yeniden deneyin.',
  err_generic: 'Giriş yapılamadı. Yeniden deneyin.',
};

const ar: Dict = {
  continueGoogle: 'المتابعة باستخدام Google',
  continueMicrosoft: 'المتابعة باستخدام Microsoft',
  or: 'أو',
  signingIn: 'جاري تسجيل دخولك…',
  twoFactorTitle: 'تسجيل الدخول بخطوتين',
  continue: 'كمّل',
  backToSignIn: 'ارجع لتسجيل الدخول',
  backToSecurity: 'ارجع للأمان',
  signInMethods: 'طرق تسجيل الدخول',
  signInMethodsNote: 'الطرق اللي تقدر تدخل فيها على هالحساب. خلّ وحدة منها على الأقل.',
  passwordLabel: 'كلمة المرور',
  passwordIsSet: 'محددة',
  passwordNotSet: 'ما فيه كلمة مرور. انت تدخل بحساب مربوط.',
  setPassword: 'حدد كلمة مرور',
  link: 'اربط',
  unlink: 'فك الربط',
  notLinked: 'مو مربوط',
  lastUsed: 'آخر استخدام',
  lastSignInMethod: 'هذي الطريقة الوحيدة اللي تدخل فيها، فما تقدر تفك ربطها. حدد كلمة مرور أو اربط حساب ثاني أول.',
  linkedNotice: (p) => `انربط ${p}. من الحين تقدر تدخل فيه.`,
  unlinkedNotice: (p) => `انفك ربط ${p}.`,
  err_state_invalid: 'تسجيل الدخول طوّل أو بدأ من متصفح ثاني. جرّب مرة ثانية.',
  err_cancelled: 'انلغى تسجيل الدخول.',
  err_provider_error: 'المزوّد ما قدر يكمّل تسجيل الدخول. جرّب بعد دقيقة.',
  err_provider_unavailable: 'خيار تسجيل الدخول هذا مو متاح الحين.',
  err_token_invalid: 'ما قدرنا نتحقق من رد المزوّد. جرّب مرة ثانية.',
  err_link_from_security: 'فيه حساب بهالإيميل من قبل. ادخل بكلمة المرور، وبعدها اربط هالحساب من صفحة الأمان.',
  err_identity_in_use: 'هالحساب مربوط بحساب Progrid ثاني.',
  err_email_missing: 'المزوّد ما شارك إيميل. استخدم حساب ثاني أو سجّل بالإيميل.',
  err_account_exists: 'فيه حساب بهالإيميل من قبل. ادخل بكلمة المرور.',
  err_invite_email_mismatch: 'هالدعوة لإيميل ثاني. كمّل بحساب الإيميل اللي انرسلت له الدعوة.',
  err_invite_invalid: 'رابط الدعوة هذا ما عاد يشتغل. اطلب من الفريق دعوة جديدة.',
  err_link_session_invalid: 'انتهت جلستك قبل ما ينربط الحساب. افتح صفحة الأمان وجرّب مرة ثانية.',
  err_code_invalid: 'رابط تسجيل الدخول هذا انتهى أو استُخدم قبل. جرّب مرة ثانية.',
  err_generic: 'ما زبط تسجيل الدخول. جرّب مرة ثانية.',
};

const dict: Record<Locale, Dict> = { en, tr, ar };
type StringKey = { [K in keyof Dict]: Dict[K] extends string ? K : never }[keyof Dict];

export function ts(locale: Locale, key: StringKey): string {
  return (dict[locale][key] as string) ?? (dict.en[key] as string);
}

export function tsf<K extends keyof Dict>(locale: Locale, key: K): Dict[K] {
  return dict[locale][key] ?? dict.en[key];
}

/** Message for an error code from the sign in callback or the API. */
export function socialError(locale: Locale, code: string | null | undefined): string {
  const key = `err_${code}` as StringKey;
  return key in en ? ts(locale, key) : ts(locale, 'err_generic');
}
