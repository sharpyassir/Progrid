/**
 * Managed cloud catalog: the default plans (spec section 5) and the public holidays business
 * hours SLAs skip. Seeded by prisma/seed.ts in every environment, idempotently: plans are
 * created once and then left to the back office, holidays are upserted by country and date.
 *
 * Plan prices are in halalas (SAR minor units) and exclude 15 percent VAT.
 *
 * Targets are minutes. On BUSINESS_HOURS plans they are working minutes (09:00 to 17:00 local
 * time on working days), so "2d" is two working days of 8 hours = 960 minutes; on 24/7 plans
 * a day is 1,440 minutes. Resolve targets are twice the response target for P1 and P2; for P3
 * and P4 they give a working week (ESSENTIAL), three or seven days (BUSINESS) and one or five
 * days (ENTERPRISE) so a routine request is finished within the next maintenance cycle.
 */
export const MANAGED_PLANS = [
  {
    code: 'ESSENTIAL',
    name: 'Essential',
    description: 'Business hours care for up to 3 servers or sites: monitoring, patching, backups and 2 hours of engineer time a month.',
    priceMinor: 110_000,
    maxAssets: 3,
    coverage: 'BUSINESS_HOURS' as const,
    includedEngineerMinutes: 120,
    responseTargets: { P1: 240, P2: 480, P3: 960, P4: 2400 },
    resolveTargets: { P1: 480, P2: 960, P3: 2400, P4: 4800 },
    sortOrder: 1,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'Around the clock care for up to 10 assets with on call engineers and 6 hours of engineer time a month.',
    priceMinor: 300_000,
    maxAssets: 10,
    coverage: 'TWENTY_FOUR_SEVEN' as const,
    includedEngineerMinutes: 360,
    responseTargets: { P1: 60, P2: 240, P3: 1440, P4: 4320 },
    resolveTargets: { P1: 120, P2: 480, P3: 4320, P4: 10080 },
    sortOrder: 2,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom scope and price with the fastest targets, a named engineer and included time agreed per contract.',
    priceMinor: null,
    maxAssets: null,
    coverage: 'TWENTY_FOUR_SEVEN' as const,
    includedEngineerMinutes: 0,
    responseTargets: { P1: 30, P2: 120, P3: 480, P4: 2880 },
    resolveTargets: { P1: 60, P2: 240, P3: 1440, P4: 7200 },
    sortOrder: 3,
  },
];

/** Overage for billable engineer time beyond the included minutes: 250 SAR an hour (planning estimate). */
export const MANAGED_HOURLY_RATE_MINOR = 25_000;

/**
 * Public holidays for 2026 and 2027.
 *
 * Saudi Arabia: Founding Day (22 February), National Day (23 September) and the Eid holidays of
 * the private sector (Eid al Fitr from 1 Shawwal and Eid al Adha from the Day of Arafah, four
 * days each). The Eid dates follow the Hijri calendar: the 2026 dates are the Umm al Qura dates,
 * the 2027 dates are the best published estimates. STAFF SHOULD CONFIRM THEM EVERY YEAR once the
 * Ministry of Human Resources announces the official holiday, and edit the Holiday table.
 *
 * Türkiye: the national holidays of Law 2429, with Ramazan Bayramı (three days) and Kurban
 * Bayramı (four days) from the Diyanet calendar. The half day eves (arife and 28 October
 * afternoon) are not listed because the calendar only models whole days.
 */
export const HOLIDAYS: { country: 'SA' | 'TR'; date: string; name: string }[] = [
  // Saudi Arabia 2026
  { country: 'SA', date: '2026-02-22', name: 'Founding Day' },
  { country: 'SA', date: '2026-03-20', name: 'Eid al Fitr' },
  { country: 'SA', date: '2026-03-21', name: 'Eid al Fitr holiday' },
  { country: 'SA', date: '2026-03-22', name: 'Eid al Fitr holiday' },
  { country: 'SA', date: '2026-03-23', name: 'Eid al Fitr holiday' },
  { country: 'SA', date: '2026-05-26', name: 'Day of Arafah' },
  { country: 'SA', date: '2026-05-27', name: 'Eid al Adha' },
  { country: 'SA', date: '2026-05-28', name: 'Eid al Adha holiday' },
  { country: 'SA', date: '2026-05-29', name: 'Eid al Adha holiday' },
  { country: 'SA', date: '2026-09-23', name: 'Saudi National Day' },
  // Saudi Arabia 2027 (Eid dates estimated, confirm when announced)
  { country: 'SA', date: '2027-02-22', name: 'Founding Day' },
  { country: 'SA', date: '2027-03-09', name: 'Eid al Fitr (estimated)' },
  { country: 'SA', date: '2027-03-10', name: 'Eid al Fitr holiday (estimated)' },
  { country: 'SA', date: '2027-03-11', name: 'Eid al Fitr holiday (estimated)' },
  { country: 'SA', date: '2027-03-12', name: 'Eid al Fitr holiday (estimated)' },
  { country: 'SA', date: '2027-05-15', name: 'Day of Arafah (estimated)' },
  { country: 'SA', date: '2027-05-16', name: 'Eid al Adha (estimated)' },
  { country: 'SA', date: '2027-05-17', name: 'Eid al Adha holiday (estimated)' },
  { country: 'SA', date: '2027-05-18', name: 'Eid al Adha holiday (estimated)' },
  { country: 'SA', date: '2027-09-23', name: 'Saudi National Day' },
  // Türkiye 2026
  { country: 'TR', date: '2026-01-01', name: "New Year's Day" },
  { country: 'TR', date: '2026-03-20', name: 'Ramazan Bayramı day 1' },
  { country: 'TR', date: '2026-03-21', name: 'Ramazan Bayramı day 2' },
  { country: 'TR', date: '2026-03-22', name: 'Ramazan Bayramı day 3' },
  { country: 'TR', date: '2026-04-23', name: 'National Sovereignty and Children’s Day' },
  { country: 'TR', date: '2026-05-01', name: 'Labour and Solidarity Day' },
  { country: 'TR', date: '2026-05-19', name: 'Commemoration of Atatürk, Youth and Sports Day' },
  { country: 'TR', date: '2026-05-27', name: 'Kurban Bayramı day 1' },
  { country: 'TR', date: '2026-05-28', name: 'Kurban Bayramı day 2' },
  { country: 'TR', date: '2026-05-29', name: 'Kurban Bayramı day 3' },
  { country: 'TR', date: '2026-05-30', name: 'Kurban Bayramı day 4' },
  { country: 'TR', date: '2026-07-15', name: 'Democracy and National Unity Day' },
  { country: 'TR', date: '2026-08-30', name: 'Victory Day' },
  { country: 'TR', date: '2026-10-29', name: 'Republic Day' },
  // Türkiye 2027
  { country: 'TR', date: '2027-01-01', name: "New Year's Day" },
  { country: 'TR', date: '2027-03-09', name: 'Ramazan Bayramı day 1' },
  { country: 'TR', date: '2027-03-10', name: 'Ramazan Bayramı day 2' },
  { country: 'TR', date: '2027-03-11', name: 'Ramazan Bayramı day 3' },
  { country: 'TR', date: '2027-04-23', name: 'National Sovereignty and Children’s Day' },
  { country: 'TR', date: '2027-05-01', name: 'Labour and Solidarity Day' },
  { country: 'TR', date: '2027-05-16', name: 'Kurban Bayramı day 1' },
  { country: 'TR', date: '2027-05-17', name: 'Kurban Bayramı day 2' },
  { country: 'TR', date: '2027-05-18', name: 'Kurban Bayramı day 3' },
  { country: 'TR', date: '2027-05-19', name: 'Kurban Bayramı day 4 and Commemoration of Atatürk, Youth and Sports Day' },
  { country: 'TR', date: '2027-07-15', name: 'Democracy and National Unity Day' },
  { country: 'TR', date: '2027-08-30', name: 'Victory Day' },
  { country: 'TR', date: '2027-10-29', name: 'Republic Day' },
];
