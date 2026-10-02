import { Injectable, Logger } from '@nestjs/common';
import type { Affiliate } from '@prisma/client';
import { MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { entityForCountry, urlsFor, publicDomains, entityProfile } from '../../common/entities/entities';

export type AffiliateMail = 'received' | 'approved' | 'rejected' | 'suspended' | 'reinstated' | 'payout_requested' | 'payout_paid';

type Lang = 'en' | 'ar';
interface Vars { name: string; code: string; portal: string; reason?: string; amount?: string; reference?: string }

const T: Record<Lang, Record<AffiliateMail, (v: Vars) => { subject: string; text: string }>> = {
  en: {
    received: (v) => ({ subject: 'We received your affiliate application', text: `Hi ${v.name},\n\nThanks for applying to the Progrid affiliate program. We review every application and usually answer within a few business days. You will get an email when we decide.\n\nYour application: ${v.portal}` }),
    approved: (v) => ({ subject: 'Welcome to the Progrid affiliate program', text: `Hi ${v.name},\n\nYour application is approved. Your partner code is ${v.code}.\n\nCustomers who sign up with your code get a discount, and you earn commission on what they pay. Your referral link, statistics, payouts and marketing assets are in your affiliate portal:\n${v.portal}\n\nRemember to tell your audience that you earn a commission.` }),
    rejected: (v) => ({ subject: 'Your affiliate application', text: `Hi ${v.name},\n\nThank you for your interest in the Progrid affiliate program. We are not able to accept your application at this time.${v.reason ? `\n\nReason: ${v.reason}` : ''}\n\nYou can apply again in 30 days.` }),
    suspended: (v) => ({ subject: 'Your affiliate account is suspended', text: `Hi ${v.name},\n\nYour Progrid affiliate account is suspended and your code no longer gives new referrals or commission.${v.reason ? `\n\nReason: ${v.reason}` : ''}\n\nReply to this email if you think this is a mistake.` }),
    reinstated: (v) => ({ subject: 'Your affiliate account is active again', text: `Hi ${v.name},\n\nYour Progrid affiliate account is active again. Your code ${v.code} works as before.\n\n${v.portal}` }),
    payout_requested: (v) => ({ subject: `Payout request received: ${v.amount}`, text: `Hi ${v.name},\n\nWe received your payout request for ${v.amount}. We pay by bank transfer to the account in your payout details and will email you when it is sent.\n\n${v.portal}` }),
    payout_paid: (v) => ({ subject: `Payout sent: ${v.amount}`, text: `Hi ${v.name},\n\nYour payout of ${v.amount} was sent.${v.reference ? ` Reference: ${v.reference}.` : ''} It can take a few business days to reach your account.\n\n${v.portal}` }),
  },
  ar: {
    received: (v) => ({ subject: 'استلمنا طلب انضمامك إلى برنامج الشركاء', text: `مرحبًا ${v.name}،\n\nشكرًا لتقديمك على برنامج شركاء Progrid. نراجع كل طلب ونرد عادة خلال أيام عمل قليلة، وسيصلك بريد عند اتخاذ القرار.\n\nطلبك: ${v.portal}` }),
    approved: (v) => ({ subject: 'أهلًا بك في برنامج شركاء Progrid', text: `مرحبًا ${v.name}،\n\nتم قبول طلبك. رمز الشريك الخاص بك هو ${v.code}.\n\nيحصل العملاء الذين يسجّلون برمزك على خصم، وتربح أنت عمولة على ما يدفعونه. ستجد رابط الإحالة والإحصاءات والدفعات والمواد التسويقية في بوابة الشركاء:\n${v.portal}\n\nتذكّر أن تخبر جمهورك أنك تحصل على عمولة.` }),
    rejected: (v) => ({ subject: 'بخصوص طلب انضمامك إلى برنامج الشركاء', text: `مرحبًا ${v.name}،\n\nشكرًا لاهتمامك ببرنامج شركاء Progrid. لا يمكننا قبول طلبك في الوقت الحالي.${v.reason ? `\n\nالسبب: ${v.reason}` : ''}\n\nيمكنك التقديم مرة أخرى بعد 30 يومًا.` }),
    suspended: (v) => ({ subject: 'تم إيقاف حساب الشريك الخاص بك', text: `مرحبًا ${v.name}،\n\nتم إيقاف حساب الشريك الخاص بك في Progrid، ولم يعد رمزك يحقق إحالات أو عمولات جديدة.${v.reason ? `\n\nالسبب: ${v.reason}` : ''}\n\nرد على هذا البريد إن كنت ترى أن ذلك خطأ.` }),
    reinstated: (v) => ({ subject: 'أُعيد تفعيل حساب الشريك الخاص بك', text: `مرحبًا ${v.name}،\n\nأُعيد تفعيل حساب الشريك الخاص بك في Progrid، ويعمل رمزك ${v.code} كما كان.\n\n${v.portal}` }),
    payout_requested: (v) => ({ subject: `استلمنا طلب الصرف: ${v.amount}`, text: `مرحبًا ${v.name}،\n\nاستلمنا طلب صرف بمبلغ ${v.amount}. نحوّل المبلغ بتحويل بنكي إلى الحساب المسجل في بيانات الصرف، وسنرسل لك بريدًا عند التحويل.\n\n${v.portal}` }),
    payout_paid: (v) => ({ subject: `تم تحويل الدفعة: ${v.amount}`, text: `مرحبًا ${v.name}،\n\nتم تحويل دفعتك بمبلغ ${v.amount}.${v.reference ? ` المرجع: ${v.reference}.` : ''} قد يستغرق وصولها إلى حسابك بضعة أيام عمل.\n\n${v.portal}` }),
  },
};

/**
 * Emails to affiliates on every status change and payout. Arabic for users whose console language
 * is Arabic, English otherwise. Sent by the company of the affiliate's country (Progrid Arabia for
 * Saudi Arabia, Progrid Technologies LLC elsewhere). Never fails the action that triggered it.
 */
@Injectable()
export class AffiliateMailer {
  private readonly log = new Logger(AffiliateMailer.name);
  constructor(private readonly mail: MailService, private readonly prisma: PrismaService) {}

  async send(a: Pick<Affiliate, 'userId' | 'name' | 'email' | 'code' | 'country' | 'statusReason'>, kind: AffiliateMail, extra: { amount?: string; reference?: string } = {}) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { locale: true } });
      const lang: Lang = user?.locale === 'ar' ? 'ar' : 'en';
      const entity = entityForCountry(a.country);
      const portal = `${entityProfile(entity).consoleUrl}/affiliates/portal`;
      const m = T[lang][kind]({ name: a.name, code: a.code, portal, reason: a.statusReason ?? undefined, ...extra });
      await this.mail.send({ to: a.email, subject: m.subject, text: m.text, entity });
    } catch (err) {
      this.log.warn(`affiliate mail ${kind} to ${a.email} failed: ${(err as Error).message}`);
    }
  }
}

/** Referral links on every public domain (progrid.co and progrid.sa), or the configured website in development. */
export function referralLinks(code: string): string[] {
  const domains = publicDomains();
  return (domains.length ? domains.map((d) => urlsFor(d).wwwUrl) : [urlsFor(undefined).wwwUrl]).map((w) => `${w}/?ref=${code}`);
}
