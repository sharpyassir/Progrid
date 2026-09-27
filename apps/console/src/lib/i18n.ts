/** Console strings in the three launch languages. Arabic is RTL. English is the source of truth. */
export type Locale = 'en' | 'tr' | 'ar';

export const RTL: Record<Locale, boolean> = { en: false, tr: false, ar: true };

const en = {
  // shell and nav
  products: 'Products', servers: 'Servers', create: 'Create server', apps: 'Marketplace', billing: 'Billing', agents: 'Agents', signOut: 'Sign out',
  groupProjects: 'Projects', groupAgents: 'Managed Agents', groupInference: 'Inference Engine', groupData: 'Data & Learning', groupCore: 'Core Cloud', groupMarketplace: 'Marketplace', groupSecurity: 'Security',
  menu: 'Menu', close: 'Close', loading: 'Loading…', back: 'Back', cancel: 'Cancel', save: 'Save', confirm: 'Confirm',
  // servers
  name: 'Name', size: 'Size', image: 'Image', region: 'Region', status: 'Status', ip: 'Public IP', created: 'Created',
  noServers: 'No servers yet. Create your first one. It takes about a minute.',
  creating: 'Creating…', deploy: 'Deploy', perMonth: '/mo', perHour: '/hr',
  actions: 'Actions', stop: 'Stop', start: 'Start', reboot: 'Reboot', delete: 'Delete', forceStop: 'Force stop', resize: 'Resize', rebuild: 'Rebuild',
  confirmDelete: 'Delete this server? This cannot be undone.',
  approvalsWaiting: (n: number) => `${n} agent ${n === 1 ? 'request is' : 'requests are'} waiting for your approval →`,
  // server detail
  tabOverview: 'Overview', tabMetrics: 'Metrics', tabPower: 'Power and resize', tabNetworking: 'Networking', tabSnapshots: 'Snapshots', tabVolumes: 'Volumes', tabActivity: 'Activity',
  details: 'Details', cost: 'Cost', price: 'Price', privateIp: 'Private IP', backups: 'Backups', on: 'On', off: 'Off', tags: 'Tags',
  plusPublicIp: 'plus the public IP', costNote: 'Billed by the hour while the server exists, capped at the monthly price. Stopping a server does not stop billing; delete it or take a snapshot first.',
  connect: 'Connect', connectNote: 'Your SSH keys were added when the server was created.', waitingIp: 'Waiting for the public IP…', fromCli: 'From the CLI:',
  power: 'Power', powerNote: 'Stop sends a clean shutdown signal. Force stop cuts power, like pulling the plug.', forceStopConfirm: 'Force stop can corrupt files that are being written. Continue?',
  resizeNote: 'The server restarts on the new size. The disk can grow but never shrink.', comparedToday: 'compared with today.', resizeConfirm: (name: string, size: string) => `Resize ${name} to ${size}? It will restart.`, resizeStarted: 'Resize started. The server restarts on the new size.',
  rebuildNote: 'Reinstalls the operating system on the same disk and IP. Everything on the disk is erased.', rebuildConfirm: (image: string) => `Erase this server and reinstall ${image}?`, rebuildStarted: 'Rebuild started.',
  deleteServer: 'Delete server', deleteNote: 'Removes the server, its disk and its public IP. Billing stops at the end of the hour. Snapshots are kept.',
  addresses: 'Addresses', reservedIp: 'Reserved IP', publicIpv4: 'Public IPv4', privateNetwork: 'Private network', addressesNote: 'Reserved IPs and reverse DNS are managed under', attach: 'Attach', detach: 'Detach',
  noFirewalls: 'No firewalls yet.', createOne: 'Create one', noFirewallsTail: 'to allow only the ports you need.', attached: (n: string) => `Attached ${n}.`, detached: (n: string) => `Detached ${n}.`,
  snapshotName: 'Snapshot name (optional)', takeSnapshot: 'Take snapshot', snapshotStarted: 'Snapshot started.', snapshotNote: (price: string) => `A snapshot copies the whole disk. Charged per GB per month at ${price}. Snapshots taken while the server runs may miss data still in memory.`, noSnapshots: 'No snapshots of this server yet.', deleteSnapshotConfirm: 'Delete this snapshot?',
  volumes: 'Volumes', newVolume: 'New volume', volumeName: 'Volume name', sizeGb: 'Size (GB)', grow: 'Grow', attachedTo: 'Attached to', device: 'Device', noVolumes: 'No volumes yet.', noVolumesOnServer: 'No volumes attached to this server.', attachExisting: 'Attach an available volume', volumeNote: (price: string) => `Block storage on Ceph, from 10 GB to 16 TB, ${price} per GB per month whether attached or not. Attach to one server at a time; the disk shows up under /dev/disk/by-id and needs a file system the first time.`, deleteVolumeConfirm: 'Delete this volume? Its data is gone for good.', detachNote: 'Unmount the file system in the guest before detaching.', growTo: 'New size in GB', volumeCreated: 'Volume is being created.', createVolume: 'Create volume', backupsOn: 'Turn on backups', backupsOff: 'Turn off backups', backupsNote: (pct: string) => `A snapshot every day, the last seven kept, for ${pct} of the plan price.`, backupKind: 'daily backup', notAvailable: 'unavailable', managedTier: 'Managed', managedOn: 'Turn on managed', managedOff: 'Turn off managed', managedNote: (price: string) => `Setup, OS updates, security hardening, daily backups and support included: ${price} in all.`, managedNotOnPlan: 'The managed tier starts with the Standard plan.', inclVat: 'with 15% VAT', managedCare: 'Managed care', managedInstallNote: 'The agent is not reporting yet. It installs on its own on a new or rebuilt server; on a running one, run this once as root:', lastReport: 'Last report', uptime: 'Uptime', memory: 'Memory', disk: 'Disk', updates: 'Updates', pendingOf: 'pending,', securityUpdates: 'security', rebootAt4: 'reboot at 04:00', lastPatched: 'Last patched', sshBans: 'SSH bans (fail2ban)', failedServices: 'Failed services', none: 'none', managedCareNote: 'Security and regular updates install on their own, with a reboot at 04:00 server time only when one is needed. Password logins are off once an SSH key is present.', health_ok: 'healthy', health_warn: 'needs attention', health_stale: 'not reporting', health_pending: 'waiting for the first report', agreePrefix: 'By creating an account you agree to the', termsLink: 'terms of service', agreeAnd: 'and the', privacyLink: 'privacy policy', support: 'Support', newTicket: 'New ticket', subject: 'Subject', priority: 'Priority', aboutResource: 'About (optional)', message: 'Message', ticketNote: 'Name the server, database or invoice when you can; it helps us answer faster. Owners and the person who opened the ticket get every answer by email.', openTicket: 'Open ticket', tickets: 'Tickets', responseTarget: 'First response target', updated: 'Updated', noTickets: 'No tickets yet.', answeredAt: 'answered', by: 'by', supportPlan: 'Support plan', supportPlanNote: 'Targets are for the first answer, counted around the clock, every day. Paid plans are billed by the hour like everything else and can be changed at any time.', currentPlan: 'current', freeWord: 'Free', upgrade: 'Upgrade', switchTo: 'Switch to this plan', supportBillingNote: (open: number, max: number) => `${open} of ${max} open tickets used on this plan.`, closeTicket: 'Close ticket', supportTeam: 'pgcloud support', replyPlaceholder: 'Write a reply', reopenPlaceholder: 'Replying reopens the ticket', reopenTicket: 'Reopen with reply', sendReply: 'Send reply', notOnPlan: 'not on this plan', minutesShort: 'min', hoursShort: 'h', daysShort: 'days', prio_low: 'Low', prio_normal: 'Normal', prio_high: 'High', prio_urgent: 'Urgent', filter_all: 'All', filter_open: 'Open', filter_closed: 'Closed',
  action: 'Action', started: 'Started', took: 'Took', notes: 'Notes', nothingYet: 'Nothing yet.', auditNote: 'Who did what, including agent tokens, is in the', auditLog: 'audit log',
  // auth
  login: 'Sign in', email: 'Email', password: 'Password', signup: 'Create account', teamName: 'Team name', forgotPassword: 'Forgot password?',
  authCode: 'Authenticator code', authCodeHint: 'Enter the six digit code from your app, or one of your recovery codes.',
  resetTitle: 'Reset your password', resetLead: 'Enter your email and we will send you a link. It stays valid for one hour.', resetSent: 'If an account exists for that address, the email is on its way. Check your inbox and spam folder.', sendResetLink: 'Send reset link', backToSignIn: 'Back to sign in',
  newPasswordTitle: 'Choose a new password', newPassword: 'New password (10 characters or more)', repeatPassword: 'Repeat the new password', passwordsDiffer: 'The two passwords do not match.', passwordChanged: 'Your password has been changed.', changePassword: 'Change password', missingToken: 'This link is missing its token.', requestNew: 'request a new one',
  verifyTitle: 'Email confirmation', verifying: 'Confirming your email…', verified: 'Your email is confirmed. You can create servers now.', continue: 'Continue', verifyFailedHint: 'Sign in and open Security to request a new link.',
  // security
  sessions: 'Signed in devices', sessionsNote: 'Every browser where you are signed in. End any you do not recognize, then change your password.', thisDevice: 'This device', lastActive: 'Last active', endSession: 'Sign out', endOtherSessions: 'Sign out everywhere else', otherSessionsEnded: 'All other devices are signed out.', unknownDevice: 'Unknown device',
  security: 'Security', welcomeSecurity: 'Welcome. Confirm your email from the message we just sent, and set up two factor sign in below to protect your account.',
  confirmed: 'confirmed', notConfirmed: 'not confirmed', needConfirmed: 'You need a confirmed email before you can create servers.', sendAgain: 'Send the link again', sentAgain: 'We sent you a new confirmation link.',
  twoFactor: 'Two factor sign in', twoFactorOn: 'On. Sign in asks for a code from your authenticator app.', codeToTurnOff: 'Code to turn off', turnOff: 'Turn off', twoFactorOff: 'Two factor sign in is off.',
  twoFactorOffOwner: 'Off. Team owners are required to turn this on.', twoFactorOffMember: 'Off. We recommend turning this on.', setUp: 'Set up',
  scanStep: '1. Scan this code with Google Authenticator, 1Password, Authy or any TOTP app.', typeKey: 'Or type the key by hand:', confirmStep: '2. Enter the six digit code the app shows to confirm.',
  recoveryTitle: 'Save these recovery codes now. They are shown only once. Each one signs you in a single time if you lose your device.',
  rateLimits: 'API rate limits', rateLimitsNote: 'Each token or session may make 600 requests per minute. Sign in attempts are limited to 10 per minute per address. Responses over the limit return status 429 with a Retry-After header.',
  // approvals
  approvalQueue: 'Approval queue', approvalsLead: 'Agent tokens with approval rules park these actions here. Nothing runs until a team owner or admin approves it. Requests expire after 24 hours. Set the rules per token under', agentAccess: 'Agent Access',
  waitingForYou: 'Waiting for you', nothingWaiting: 'Nothing is waiting. Agents can keep working within their scopes and spending caps.',
  requestedByToken: 'Requested by token', expires: 'Expires', server: 'Server', approveRun: 'Approve and run', deny: 'Deny', history: 'History',
  denyReasonPrompt: 'Tell the agent why (optional):', approveConfirm: (s: string) => `Approve and run now: ${s}?`, deletedToken: 'deleted token',
  // billing
  balance: 'Credit balance', mtd: 'Month to date',
  paymentRequired: 'Add credit once before creating billable resources. Open Billing and top up any amount; after that, usage is billed monthly.',
  accountSuspended: 'This account is suspended, so only Billing works. Pay the overdue invoice on the Billing page and your servers power back on automatically.',
  // marketplace and catalog
  oneClick: 'One-click apps', distributions: 'Distributions', comingSoon: 'Coming soon', interest: 'Notify me when this launches', interested: 'Thanks. We will let you know.',
  // agents
  agentTokens: 'Agent tokens', newAgentToken: 'Create agent token', spendCap: 'Monthly spend cap', requireApproval: 'Require human approval for',
  scopes: 'Scopes', tokenShownOnce: 'Copy this token now. It is shown only once.', revoke: 'Revoke',
  // network and storage
  firewalls: 'Firewalls', rules: 'rules', attachedServers: 'servers', newFirewall: 'Create firewall',
  snapshots: 'Snapshots', publicIps: 'Public IPs', webhooks: 'Webhooks', newWebhook: 'Add webhook', events: 'Events', url: 'URL',
  // back office invoices
  invoices: 'Invoices', invoiceNumber: 'Number', team: 'Team', period: 'Period', total: 'Total', amountDue: 'Due', overdue: 'overdue', allStatuses: 'All statuses', noInvoices: 'No invoices yet.',
  adminInvoicesLead: 'Refund card payments, issue credit notes, void unpaid invoices, record bank transfers and write off invoices. Every action is recorded in the audit log.',
  cardPayments: 'Payments', creditNotes: 'Credit notes', refunded: 'refunded', method: 'Method', amount: 'Amount', reason: 'Reason', reference: 'Reference', done: 'Done.', topUp: 'top up',
  refund: 'Refund', creditNote: 'Credit note', voidInvoice: 'Void', recordPayment: 'Record payment', markUncollectible: 'Mark uncollectible',
  bankTransfer: 'Bank transfer', manualPayment: 'Other, recorded by hand', leaveEmptyForFull: 'Leave empty for the full amount',
  refundConfirm: (amount: string, what: string) => `Refund ${amount} to the card for ${what}? This cannot be undone.`,
  refundTopupNote: 'Refunding a top up takes the same amount out of the team\'s unused credit.',
  creditNoteConfirm: (amount: string, number: string) => `Issue a credit note of ${amount} against invoice ${number}?`,
  creditNoteNote: 'On an unpaid invoice the credit note lowers what is due. On a paid invoice it becomes team credit.',
  voidConfirm: (number: string) => `Void invoice ${number}? Use this only for an invoice issued in error. Any credit it used goes back to the team.`,
  recordPaymentConfirm: (amount: string, number: string) => `Record ${amount} received for invoice ${number} and mark it paid?`,
  uncollectibleConfirm: (number: string) => `Mark invoice ${number} as uncollectible? It stays on record and can still be paid later.`,
  // team
  teamNav: 'Team', members: 'Members', role: 'Role', you: 'you', removeMember: 'Remove', leaveTeam: 'Leave team',
  role_owner: 'Owner', role_admin: 'Admin', role_member: 'Member', role_billing: 'Billing', role_readonly: 'Read only',
  removeConfirm: (name: string) => `Remove ${name} from the team? The API tokens they created for this team are revoked.`,
  leaveConfirm: 'Leave this team? You lose access right away and your API tokens for it are revoked.',
  roleConfirm: (name: string, role: string) => `Change the role of ${name} to ${role}?`, roleChanged: 'Role changed.',
  inviteTitle: 'Invite a member', inviteSend: 'Send invitation', invitationSent: (email: string) => `Invitation sent to ${email}. The link is valid for 7 days.`,
  pendingInvitations: 'Pending invitations', revokeInviteConfirm: (email: string) => `Revoke the invitation for ${email}?`,
  teamProfile: 'Team profile', teamProfileLead: 'Printed on every invoice. Saudi businesses should enter their 15 digit VAT number and full address.',
  billingEmailLabel: 'Billing email (invoices and reminders also go here)', taxIdLabel: 'VAT number', billingAddressLabel: 'Billing address', countryLabel: 'Country', profileSaved: 'Saved.',
  closeAccount: 'Close account', closeLead: 'Closing deletes every server, database, cluster, app, load balancer, volume, bucket, snapshot and DNS zone, revokes every API token and signs everyone out. Pay any unpaid invoice first. Usage up to today is invoiced at the end of the month. This cannot be undone.',
  closeType: (slug: string) => `Type ${slug} to confirm`, closeButton: 'Close the account for good', closeConfirm: 'Last check: close this account and delete everything in it?',
  inviteAcceptTitle: 'Team invitation', inviteLead: (team: string, role: string) => `You are invited to join ${team} as ${role}.`, inviteFor: (email: string) => `This invitation is for ${email}.`,
  acceptInvite: 'Accept invitation', signInToAccept: 'Sign in with this address to accept.', createToAccept: 'Choose your name and a password to create your account and join.',
  inviteInvalid: 'This invitation link is no longer valid. Ask the team for a new one.', inviteWrongUser: (email: string) => `You are signed in with another address. Sign out, open this link again and sign in as ${email}.`,
  // back office: IP blocks and images
  admIpBlocks: 'IP blocks', admIpBlocksNote: 'Each block is split into one public IPv4 address per usable address. The network, broadcast and gateway addresses are skipped. A block with allocated addresses cannot be deleted.',
  admCidr: 'CIDR', admGateway: 'Gateway', admFree: 'Free', admAllocated: 'Allocated', admAddBlock: 'Add block', admDeleteBlockConfirm: (cidr: string) => `Delete ${cidr} and its free addresses?`,
  admImages: 'Images', admImagesNote: 'An image clones from a Proxmox template VMID. The template must exist on every node of the region.',
  admSlug: 'Slug', admDistribution: 'Distribution', admVersion: 'Version', admTemplateId: 'Template VMID', admAvailable: 'Available', admHidden: 'Hidden', admAllRegions: 'All regions', admAddImage: 'Add image', admServersUsing: 'Servers', admMakeAvailable: 'Make available', admHide: 'Hide',
};

type Dict = { [K in keyof typeof en]: (typeof en)[K] };

const tr: Dict = {
  products: 'Ürünler', servers: 'Sunucular', create: 'Sunucu oluştur', apps: 'Uygulama Mağazası', billing: 'Faturalama', agents: 'Ajanlar', signOut: 'Çıkış',
  groupProjects: 'Projeler', groupAgents: 'Yönetilen Ajanlar', groupInference: 'Çıkarım Motoru', groupData: 'Veri ve Öğrenme', groupCore: 'Çekirdek Bulut', groupMarketplace: 'Uygulama Mağazası', groupSecurity: 'Güvenlik',
  menu: 'Menü', close: 'Kapat', loading: 'Yükleniyor…', back: 'Geri', cancel: 'Vazgeç', save: 'Kaydet', confirm: 'Onayla',
  name: 'Ad', size: 'Boyut', image: 'İmaj', region: 'Bölge', status: 'Durum', ip: 'Genel IP', created: 'Oluşturulma',
  noServers: 'Henüz sunucu yok. İlk sunucunu oluştur. Yaklaşık bir dakika sürer.',
  creating: 'Oluşturuluyor…', deploy: 'Kur', perMonth: '/ay', perHour: '/saat',
  actions: 'İşlemler', stop: 'Durdur', start: 'Başlat', reboot: 'Yeniden başlat', delete: 'Sil', forceStop: 'Zorla durdur', resize: 'Boyutlandır', rebuild: 'Yeniden kur',
  confirmDelete: 'Bu sunucu silinsin mi? Geri alınamaz.',
  approvalsWaiting: (n) => `${n} ajan isteği onayınızı bekliyor →`,
  tabOverview: 'Genel bakış', tabMetrics: 'Metrikler', tabPower: 'Güç ve boyut', tabNetworking: 'Ağ', tabSnapshots: 'Anlık görüntüler', tabVolumes: 'Diskler', tabActivity: 'Etkinlik',
  details: 'Ayrıntılar', cost: 'Maliyet', price: 'Fiyat', privateIp: 'Özel IP', backups: 'Yedekler', on: 'Açık', off: 'Kapalı', tags: 'Etiketler',
  plusPublicIp: 'artı genel IP', costNote: 'Sunucu var olduğu sürece saatlik faturalanır, aylık fiyatla sınırlıdır. Sunucuyu durdurmak faturalamayı durdurmaz; silin ya da önce anlık görüntü alın.',
  connect: 'Bağlan', connectNote: 'SSH anahtarlarınız sunucu oluşturulurken eklendi.', waitingIp: 'Genel IP bekleniyor…', fromCli: 'Komut satırından:',
  power: 'Güç', powerNote: 'Durdur temiz bir kapatma sinyali gönderir. Zorla durdur fişi çekmek gibi gücü keser.', forceStopConfirm: 'Zorla durdurmak yazılmakta olan dosyaları bozabilir. Devam edilsin mi?',
  resizeNote: 'Sunucu yeni boyutta yeniden başlar. Disk büyüyebilir ama asla küçülemez.', comparedToday: 'bugüne göre.', resizeConfirm: (name, size) => `${name} ${size} boyutuna getirilsin mi? Yeniden başlayacak.`, resizeStarted: 'Boyutlandırma başladı. Sunucu yeni boyutta yeniden başlıyor.',
  rebuildNote: 'İşletim sistemini aynı disk ve IP üzerine yeniden kurar. Diskteki her şey silinir.', rebuildConfirm: (image) => `Bu sunucu silinip ${image} yeniden kurulsun mu?`, rebuildStarted: 'Yeniden kurulum başladı.',
  deleteServer: 'Sunucuyu sil', deleteNote: 'Sunucuyu, diskini ve genel IP’sini kaldırır. Faturalama saat sonunda durur. Anlık görüntüler saklanır.',
  addresses: 'Adresler', reservedIp: 'Ayrılmış IP', publicIpv4: 'Genel IPv4', privateNetwork: 'Özel ağ', addressesNote: 'Ayrılmış IP’ler ve ters DNS şurada yönetilir:', attach: 'Bağla', detach: 'Ayır',
  noFirewalls: 'Henüz güvenlik duvarı yok.', createOne: 'Bir tane oluşturun', noFirewallsTail: 've yalnızca gereken portlara izin verin.', attached: (n) => `${n} bağlandı.`, detached: (n) => `${n} ayrıldı.`,
  snapshotName: 'Anlık görüntü adı (isteğe bağlı)', takeSnapshot: 'Anlık görüntü al', snapshotStarted: 'Anlık görüntü başladı.', snapshotNote: (price) => `Anlık görüntü tüm diski kopyalar. GB başına aylık ${price} ücretlendirilir. Sunucu çalışırken alınan görüntüler bellekteki verileri kaçırabilir.`, noSnapshots: 'Bu sunucunun anlık görüntüsü yok.', deleteSnapshotConfirm: 'Bu anlık görüntü silinsin mi?',
  volumes: 'Diskler', newVolume: 'Yeni disk', volumeName: 'Disk adı', sizeGb: 'Boyut (GB)', grow: 'Büyüt', attachedTo: 'Bağlı olduğu sunucu', device: 'Aygıt', noVolumes: 'Henüz disk yok.', noVolumesOnServer: 'Bu sunucuya bağlı disk yok.', attachExisting: 'Boşta bir diski bağla', volumeNote: (price) => `Ceph üzerinde blok depolama, 10 GB ile 16 TB arası, bağlı olsun olmasın GB başına aylık ${price}. Aynı anda tek sunucuya bağlanır; disk /dev/disk/by-id altında görünür ve ilk kez bir dosya sistemi ister.`, deleteVolumeConfirm: 'Bu disk silinsin mi? Verisi geri gelmez.', detachNote: 'Ayırmadan önce konuk içinde dosya sistemini çıkarın.', growTo: 'Yeni boyut (GB)', volumeCreated: 'Disk oluşturuluyor.', createVolume: 'Disk oluştur', backupsOn: 'Yedeklemeyi aç', backupsOff: 'Yedeklemeyi kapat', backupsNote: (pct) => `Her gün bir anlık görüntü, son yedisi saklanır, plan fiyatının ${pct}’i.`, backupKind: 'günlük yedek', notAvailable: 'uygun değil', managedTier: 'Yönetilen', managedOn: 'Yönetilen katmanı aç', managedOff: 'Yönetilen katmanı kapat', managedNote: (price) => `Kurulum, işletim sistemi güncellemeleri, güvenlik sıkılaştırma, günlük yedekler ve destek dahil: toplam ${price}.`, managedNotOnPlan: 'Yönetilen katman Standart planla başlar.', inclVat: '%15 KDV dahil', managedCare: 'Yönetilen bakım', managedInstallNote: 'Ajan henüz rapor vermiyor. Yeni veya yeniden kurulan sunucuda kendiliğinden kurulur; çalışan bir sunucuda root olarak bir kez şunu çalıştırın:', lastReport: 'Son rapor', uptime: 'Çalışma süresi', memory: 'Bellek', disk: 'Disk', updates: 'Güncellemeler', pendingOf: 'bekliyor,', securityUpdates: 'güvenlik', rebootAt4: '04:00’de yeniden başlatma', lastPatched: 'Son yama', sshBans: 'SSH yasakları (fail2ban)', failedServices: 'Başarısız servisler', none: 'yok', managedCareNote: 'Güvenlik ve düzenli güncellemeler kendiliğinden kurulur; yalnızca gerektiğinde sunucu saatiyle 04:00’de yeniden başlatılır. SSH anahtarı varsa parola ile giriş kapalıdır.', health_ok: 'sağlıklı', health_warn: 'ilgi gerekiyor', health_stale: 'rapor vermiyor', health_pending: 'ilk rapor bekleniyor', agreePrefix: 'Hesap oluşturarak', termsLink: 'hizmet koşullarını', agreeAnd: 've', privacyLink: 'gizlilik politikasını kabul etmiş olursunuz', support: 'Destek', newTicket: 'Yeni talep', subject: 'Konu', priority: 'Öncelik', aboutResource: 'İlgili kaynak (isteğe bağlı)', message: 'Mesaj', ticketNote: 'Mümkünse sunucuyu, veritabanını veya faturayı belirtin; daha hızlı yanıt veririz. Sahipler ve talebi açan kişi her yanıtı e-posta ile alır.', openTicket: 'Talep aç', tickets: 'Talepler', responseTarget: 'İlk yanıt hedefi', updated: 'Güncellendi', noTickets: 'Henüz talep yok.', answeredAt: 'yanıtlandı', by: 'en geç', supportPlan: 'Destek planı', supportPlanNote: 'Hedefler ilk yanıt içindir ve her gün, günün her saati sayılır. Ücretli planlar diğer her şey gibi saatlik faturalanır ve istediğiniz zaman değiştirilebilir.', currentPlan: 'mevcut', freeWord: 'Ücretsiz', upgrade: 'Yükselt', switchTo: 'Bu plana geç', supportBillingNote: (open, max) => `Bu planda ${max} açık talebin ${open} tanesi kullanılıyor.`, closeTicket: 'Talebi kapat', supportTeam: 'pgcloud destek', replyPlaceholder: 'Bir yanıt yazın', reopenPlaceholder: 'Yanıt vermek talebi yeniden açar', reopenTicket: 'Yanıtla ve yeniden aç', sendReply: 'Yanıtı gönder', notOnPlan: 'bu planda yok', minutesShort: 'dk', hoursShort: 'sa', daysShort: 'gün', prio_low: 'Düşük', prio_normal: 'Normal', prio_high: 'Yüksek', prio_urgent: 'Acil', filter_all: 'Tümü', filter_open: 'Açık', filter_closed: 'Kapalı',
  action: 'İşlem', started: 'Başlangıç', took: 'Süre', notes: 'Notlar', nothingYet: 'Henüz bir şey yok.', auditNote: 'Ajan tokenları dahil kimin ne yaptığı şurada:', auditLog: 'denetim kaydı',
  login: 'Giriş yap', email: 'E-posta', password: 'Şifre', signup: 'Hesap oluştur', teamName: 'Takım adı', forgotPassword: 'Şifremi unuttum',
  authCode: 'Doğrulama kodu', authCodeHint: 'Uygulamanızdaki altı haneli kodu ya da kurtarma kodlarınızdan birini girin.',
  resetTitle: 'Şifrenizi sıfırlayın', resetLead: 'E-postanızı girin, size bir bağlantı gönderelim. Bir saat geçerlidir.', resetSent: 'Bu adrese ait bir hesap varsa e-posta yolda. Gelen kutunuzu ve spam klasörünü kontrol edin.', sendResetLink: 'Sıfırlama bağlantısı gönder', backToSignIn: 'Girişe dön',
  newPasswordTitle: 'Yeni bir şifre seçin', newPassword: 'Yeni şifre (en az 10 karakter)', repeatPassword: 'Yeni şifreyi tekrar girin', passwordsDiffer: 'İki şifre eşleşmiyor.', passwordChanged: 'Şifreniz değiştirildi.', changePassword: 'Şifreyi değiştir', missingToken: 'Bu bağlantıda token eksik.', requestNew: 'yeni bir tane isteyin',
  verifyTitle: 'E-posta doğrulama', verifying: 'E-postanız doğrulanıyor…', verified: 'E-postanız doğrulandı. Artık sunucu oluşturabilirsiniz.', continue: 'Devam', verifyFailedHint: 'Giriş yapıp Güvenlik sayfasından yeni bir bağlantı isteyin.',
  sessions: 'Oturum açık cihazlar', sessionsNote: 'Oturum açtığınız her tarayıcı. Tanımadıklarınızı kapatın, ardından şifrenizi değiştirin.', thisDevice: 'Bu cihaz', lastActive: 'Son etkinlik', endSession: 'Çıkış yap', endOtherSessions: 'Diğer tüm cihazlardan çıkış yap', otherSessionsEnded: 'Diğer tüm cihazlardan çıkış yapıldı.', unknownDevice: 'Bilinmeyen cihaz',
  security: 'Güvenlik', welcomeSecurity: 'Hoş geldiniz. Az önce gönderdiğimiz e-postadan adresinizi doğrulayın ve hesabınızı korumak için aşağıdan iki adımlı girişi kurun.',
  confirmed: 'doğrulandı', notConfirmed: 'doğrulanmadı', needConfirmed: 'Sunucu oluşturabilmek için doğrulanmış bir e-posta gerekir.', sendAgain: 'Bağlantıyı yeniden gönder', sentAgain: 'Size yeni bir doğrulama bağlantısı gönderdik.',
  twoFactor: 'İki adımlı giriş', twoFactorOn: 'Açık. Girişte doğrulama uygulamanızdaki kod istenir.', codeToTurnOff: 'Kapatmak için kod', turnOff: 'Kapat', twoFactorOff: 'İki adımlı giriş kapalı.',
  twoFactorOffOwner: 'Kapalı. Takım sahiplerinin bunu açması zorunludur.', twoFactorOffMember: 'Kapalı. Açmanızı öneririz.', setUp: 'Kur',
  scanStep: '1. Bu kodu Google Authenticator, 1Password, Authy ya da herhangi bir TOTP uygulamasıyla tarayın.', typeKey: 'Ya da anahtarı elle girin:', confirmStep: '2. Uygulamanın gösterdiği altı haneli kodu girerek onaylayın.',
  recoveryTitle: 'Bu kurtarma kodlarını şimdi kaydedin. Yalnızca bir kez gösterilir. Cihazınızı kaybederseniz her biri bir kez giriş sağlar.',
  rateLimits: 'API istek limitleri', rateLimitsNote: 'Her token veya oturum dakikada 600 istek yapabilir. Giriş denemeleri adres başına dakikada 10 ile sınırlıdır. Limit aşımında 429 durumu ve Retry-After başlığı döner.',
  approvalQueue: 'Onay kuyruğu', approvalsLead: 'Onay kuralı olan ajan tokenları bu işlemleri burada bekletir. Takım sahibi ya da yönetici onaylayana kadar hiçbir şey çalışmaz. İstekler 24 saat sonra sona erer. Kuralları token bazında şurada ayarlayın:', agentAccess: 'Ajan Erişimi',
  waitingForYou: 'Sizi bekleyenler', nothingWaiting: 'Bekleyen istek yok. Ajanlar yetkileri ve harcama limitleri içinde çalışmaya devam edebilir.',
  requestedByToken: 'İsteyen token', expires: 'Sona erme', server: 'Sunucu', approveRun: 'Onayla ve çalıştır', deny: 'Reddet', history: 'Geçmiş',
  denyReasonPrompt: 'Ajana nedenini söyleyin (isteğe bağlı):', approveConfirm: (s) => `Şimdi onaylanıp çalıştırılsın mı: ${s}?`, deletedToken: 'silinmiş token',
  balance: 'Kredi bakiyesi', mtd: 'Bu ay',
  paymentRequired: 'Ücretli kaynak oluşturmadan önce bir kez bakiye yükleyin. Faturalama sayfasını açıp istediğiniz tutarı yükleyin; sonrasında kullanım aylık faturalanır.',
  accountSuspended: 'Bu hesap askıya alındı, yalnızca Faturalama çalışır. Gecikmiş faturayı Faturalama sayfasından ödeyin, sunucularınız otomatik olarak yeniden açılır.',
  oneClick: 'Tek tıkla uygulamalar', distributions: 'Dağıtımlar', comingSoon: 'Çok yakında', interest: 'Yayınlanınca haber ver', interested: 'Teşekkürler. Haber vereceğiz.',
  agentTokens: 'Ajan tokenları', newAgentToken: 'Ajan tokenı oluştur', spendCap: 'Aylık harcama limiti', requireApproval: 'İnsan onayı gerektir',
  scopes: 'Yetkiler', tokenShownOnce: 'Bu tokenı şimdi kopyala. Yalnızca bir kez gösterilir.', revoke: 'İptal et',
  firewalls: 'Güvenlik duvarları', rules: 'kural', attachedServers: 'sunucu', newFirewall: 'Güvenlik duvarı oluştur',
  snapshots: 'Anlık görüntüler', publicIps: 'Genel IP’ler', webhooks: 'Webhook’lar', newWebhook: 'Webhook ekle', events: 'Olaylar', url: 'URL',
  invoices: 'Faturalar', invoiceNumber: 'Numara', team: 'Ekip', period: 'Dönem', total: 'Toplam', amountDue: 'Kalan', overdue: 'gecikmiş', allStatuses: 'Tüm durumlar', noInvoices: 'Henüz fatura yok.',
  adminInvoicesLead: 'Kart ödemelerini iade edin, iade faturası kesin, ödenmemiş faturaları iptal edin, havaleleri kaydedin ve tahsil edilemeyen faturaları işaretleyin. Her işlem denetim kaydına yazılır.',
  cardPayments: 'Ödemeler', creditNotes: 'İade faturaları', refunded: 'iade edildi', method: 'Yöntem', amount: 'Tutar', reason: 'Gerekçe', reference: 'Referans', done: 'Tamam.', topUp: 'bakiye yükleme',
  refund: 'İade et', creditNote: 'İade faturası', voidInvoice: 'İptal et', recordPayment: 'Ödeme kaydet', markUncollectible: 'Tahsil edilemez',
  bankTransfer: 'Havale', manualPayment: 'Diğer, elle kaydedilen', leaveEmptyForFull: 'Tam tutar için boş bırakın',
  refundConfirm: (amount, what) => `${what} için ${amount} karta iade edilsin mi? Geri alınamaz.`,
  refundTopupNote: 'Bir bakiye yüklemesini iade etmek, aynı tutarı ekibin kullanılmamış bakiyesinden düşer.',
  creditNoteConfirm: (amount, number) => `${number} numaralı faturaya ${amount} tutarında iade faturası kesilsin mi?`,
  creditNoteNote: 'Ödenmemiş faturada iade faturası kalan tutarı düşürür. Ödenmiş faturada ekip bakiyesine eklenir.',
  voidConfirm: (number) => `${number} numaralı fatura iptal edilsin mi? Yalnızca hatayla kesilen faturalar için kullanın. Kullandığı bakiye ekibe geri döner.`,
  recordPaymentConfirm: (amount, number) => `${number} numaralı fatura için ${amount} tahsil edildi olarak kaydedilip ödendi işaretlensin mi?`,
  uncollectibleConfirm: (number) => `${number} numaralı fatura tahsil edilemez olarak işaretlensin mi? Kayıtta kalır ve daha sonra yine ödenebilir.`,
  teamNav: 'Ekip', members: 'Üyeler', role: 'Rol', you: 'siz', removeMember: 'Çıkar', leaveTeam: 'Ekipten ayrıl',
  role_owner: 'Sahip', role_admin: 'Yönetici', role_member: 'Üye', role_billing: 'Faturalama', role_readonly: 'Salt okunur',
  removeConfirm: (name) => `${name} ekipten çıkarılsın mı? Bu ekip için oluşturduğu API anahtarları iptal edilir.`,
  leaveConfirm: 'Bu ekipten ayrılmak istiyor musunuz? Erişiminiz hemen kalkar ve bu ekipteki API anahtarlarınız iptal edilir.',
  roleConfirm: (name, role) => `${name} kullanıcısının rolü ${role} olarak değiştirilsin mi?`, roleChanged: 'Rol değiştirildi.',
  inviteTitle: 'Üye davet et', inviteSend: 'Davet gönder', invitationSent: (email) => `Davet ${email} adresine gönderildi. Bağlantı 7 gün geçerli.`,
  pendingInvitations: 'Bekleyen davetler', revokeInviteConfirm: (email) => `${email} için davet iptal edilsin mi?`,
  teamProfile: 'Ekip profili', teamProfileLead: 'Her faturada yer alır. Suudi şirketler 15 haneli KDV numarasını ve tam adresini girmelidir.',
  billingEmailLabel: 'Fatura e-postası (faturalar ve hatırlatmalar buraya da gider)', taxIdLabel: 'Vergi numarası', billingAddressLabel: 'Fatura adresi', countryLabel: 'Ülke', profileSaved: 'Kaydedildi.',
  closeAccount: 'Hesabı kapat', closeLead: 'Kapatmak tüm sunucuları, veritabanlarını, kümeleri, uygulamaları, yük dengeleyicileri, diskleri, kovaları, anlık görüntüleri ve DNS bölgelerini siler, tüm API anahtarlarını iptal eder ve herkesin oturumunu kapatır. Önce ödenmemiş faturaları ödeyin. Bugüne kadarki kullanım ay sonunda faturalanır. Geri alınamaz.',
  closeType: (slug) => `Onaylamak için ${slug} yazın`, closeButton: 'Hesabı kalıcı olarak kapat', closeConfirm: 'Son kontrol: bu hesap kapatılsın ve içindeki her şey silinsin mi?',
  inviteAcceptTitle: 'Ekip daveti', inviteLead: (team, role) => `${team} ekibine ${role} olarak katılmaya davet edildiniz.`, inviteFor: (email) => `Bu davet ${email} içindir.`,
  acceptInvite: 'Daveti kabul et', signInToAccept: 'Kabul etmek için bu adresle giriş yapın.', createToAccept: 'Hesabınızı oluşturup katılmak için adınızı ve bir parola seçin.',
  inviteInvalid: 'Bu davet bağlantısı artık geçerli değil. Ekipten yeni bir davet isteyin.', inviteWrongUser: (email) => `Başka bir adresle giriş yaptınız. Çıkış yapın, bu bağlantıyı yeniden açın ve ${email} ile giriş yapın.`,
  admIpBlocks: 'IP blokları', admIpBlocksNote: 'Her blok, kullanılabilir her adres için bir genel IPv4 adresine bölünür. Ağ, yayın ve ağ geçidi adresleri atlanır. Kullanımda adresi olan bir blok silinemez.',
  admCidr: 'CIDR', admGateway: 'Ağ geçidi', admFree: 'Boş', admAllocated: 'Kullanımda', admAddBlock: 'Blok ekle', admDeleteBlockConfirm: (cidr) => `${cidr} ve boş adresleri silinsin mi?`,
  admImages: 'İmajlar', admImagesNote: 'Bir imaj, Proxmox şablon VMID’sinden klonlanır. Şablon bölgedeki her düğümde bulunmalıdır.',
  admSlug: 'Kısa ad', admDistribution: 'Dağıtım', admVersion: 'Sürüm', admTemplateId: 'Şablon VMID', admAvailable: 'Kullanılabilir', admHidden: 'Gizli', admAllRegions: 'Tüm bölgeler', admAddImage: 'İmaj ekle', admServersUsing: 'Sunucular', admMakeAvailable: 'Kullanıma aç', admHide: 'Gizle',
};

const ar: Dict = {
  products: 'المنتجات', servers: 'الخوادم', create: 'إنشاء خادم', apps: 'المتجر', billing: 'الفوترة', agents: 'الوكلاء', signOut: 'تسجيل الخروج',
  groupProjects: 'المشاريع', groupAgents: 'الوكلاء المُدارون', groupInference: 'محرك الاستدلال', groupData: 'البيانات والتعلم', groupCore: 'السحابة الأساسية', groupMarketplace: 'المتجر', groupSecurity: 'الأمان',
  menu: 'القائمة', close: 'إغلاق', loading: 'جارٍ التحميل…', back: 'رجوع', cancel: 'إلغاء', save: 'حفظ', confirm: 'تأكيد',
  name: 'الاسم', size: 'الحجم', image: 'الصورة', region: 'المنطقة', status: 'الحالة', ip: 'IP عام', created: 'تاريخ الإنشاء',
  noServers: 'لا توجد خوادم بعد. أنشئ أول خادم. يستغرق حوالي دقيقة.',
  creating: 'جارٍ الإنشاء…', deploy: 'نشر', perMonth: '/شهر', perHour: '/ساعة',
  actions: 'إجراءات', stop: 'إيقاف', start: 'تشغيل', reboot: 'إعادة تشغيل', delete: 'حذف', forceStop: 'إيقاف قسري', resize: 'تغيير الحجم', rebuild: 'إعادة بناء',
  confirmDelete: 'حذف هذا الخادم؟ لا يمكن التراجع.',
  approvalsWaiting: (n) => `${n} من طلبات الوكلاء بانتظار موافقتك ←`,
  tabOverview: 'نظرة عامة', tabMetrics: 'المقاييس', tabPower: 'الطاقة والحجم', tabNetworking: 'الشبكة', tabSnapshots: 'اللقطات', tabVolumes: 'الأقراص', tabActivity: 'النشاط',
  details: 'التفاصيل', cost: 'التكلفة', price: 'السعر', privateIp: 'IP خاص', backups: 'النسخ الاحتياطي', on: 'مفعّل', off: 'معطّل', tags: 'الوسوم',
  plusPublicIp: 'بالإضافة إلى عنوان IP العام', costNote: 'يُفوتر بالساعة ما دام الخادم موجودًا، بسقف السعر الشهري. إيقاف الخادم لا يوقف الفوترة؛ احذفه أو خذ لقطة أولًا.',
  connect: 'الاتصال', connectNote: 'أُضيفت مفاتيح SSH الخاصة بك عند إنشاء الخادم.', waitingIp: 'بانتظار عنوان IP العام…', fromCli: 'من سطر الأوامر:',
  power: 'الطاقة', powerNote: 'الإيقاف يرسل إشارة إغلاق نظيفة. الإيقاف القسري يقطع الطاقة كنزع القابس.', forceStopConfirm: 'قد يُتلف الإيقاف القسري الملفات قيد الكتابة. المتابعة؟',
  resizeNote: 'يُعاد تشغيل الخادم بالحجم الجديد. يمكن للقرص أن يكبر لكنه لا يصغر أبدًا.', comparedToday: 'مقارنة باليوم.', resizeConfirm: (name, size) => `تغيير حجم ${name} إلى ${size}؟ سيُعاد تشغيله.`, resizeStarted: 'بدأ تغيير الحجم. يُعاد تشغيل الخادم بالحجم الجديد.',
  rebuildNote: 'يعيد تثبيت نظام التشغيل على نفس القرص والعنوان. يُمحى كل ما على القرص.', rebuildConfirm: (image) => `محو هذا الخادم وإعادة تثبيت ${image}؟`, rebuildStarted: 'بدأت إعادة البناء.',
  deleteServer: 'حذف الخادم', deleteNote: 'يزيل الخادم وقرصه وعنوان IP العام. تتوقف الفوترة في نهاية الساعة. تُحفظ اللقطات.',
  addresses: 'العناوين', reservedIp: 'IP محجوز', publicIpv4: 'IPv4 عام', privateNetwork: 'شبكة خاصة', addressesNote: 'تُدار عناوين IP المحجوزة وDNS العكسي في', attach: 'ربط', detach: 'فصل',
  noFirewalls: 'لا توجد جدران حماية بعد.', createOne: 'أنشئ واحدًا', noFirewallsTail: 'للسماح بالمنافذ التي تحتاجها فقط.', attached: (n) => `تم ربط ${n}.`, detached: (n) => `تم فصل ${n}.`,
  snapshotName: 'اسم اللقطة (اختياري)', takeSnapshot: 'أخذ لقطة', snapshotStarted: 'بدأت اللقطة.', snapshotNote: (price) => `اللقطة تنسخ القرص كاملًا. تُحتسب ${price} لكل GB شهريًا. اللقطات المأخوذة أثناء عمل الخادم قد تفوّت بيانات في الذاكرة.`, noSnapshots: 'لا توجد لقطات لهذا الخادم بعد.', deleteSnapshotConfirm: 'حذف هذه اللقطة؟',
  volumes: 'الأقراص', newVolume: 'قرص جديد', volumeName: 'اسم القرص', sizeGb: 'الحجم (GB)', grow: 'توسيع', attachedTo: 'مرتبط بـ', device: 'الجهاز', noVolumes: 'لا توجد أقراص بعد.', noVolumesOnServer: 'لا توجد أقراص مرتبطة بهذا الخادم.', attachExisting: 'ربط قرص متاح', volumeNote: (price) => `تخزين كتلي على Ceph، من 10 GB إلى 16 TB، ${price} لكل GB شهريًا سواء كان مرتبطًا أم لا. يُربط بخادم واحد في كل مرة؛ يظهر القرص تحت /dev/disk/by-id ويحتاج نظام ملفات في المرة الأولى.`, deleteVolumeConfirm: 'حذف هذا القرص؟ ستُفقد بياناته نهائيًا.', detachNote: 'أزل تركيب نظام الملفات داخل الخادم قبل الفصل.', growTo: 'الحجم الجديد بالـ GB', volumeCreated: 'يجري إنشاء القرص.', createVolume: 'إنشاء قرص', backupsOn: 'تفعيل النسخ الاحتياطي', backupsOff: 'إيقاف النسخ الاحتياطي', backupsNote: (pct) => `لقطة كل يوم، تُحفظ آخر سبع لقطات، مقابل ${pct} من سعر الخطة.`, backupKind: 'نسخة يومية', notAvailable: 'غير متاح', managedTier: 'مُدار', managedOn: 'تفعيل الإدارة', managedOff: 'إيقاف الإدارة', managedNote: (price) => `يشمل الإعداد وتحديثات النظام والتحصين الأمني والنسخ الاحتياطي اليومي والدعم: ${price} إجمالًا.`, managedNotOnPlan: 'يبدأ المستوى المُدار من خطة Standard.', inclVat: 'شامل ضريبة القيمة المضافة 15%', managedCare: 'الرعاية المُدارة', managedInstallNote: 'الوكيل لا يرسل تقارير بعد. يُثبَّت تلقائيًا على خادم جديد أو معاد بنائه؛ وعلى خادم يعمل نفّذ هذا الأمر مرة واحدة بصلاحيات root:', lastReport: 'آخر تقرير', uptime: 'مدة التشغيل', memory: 'الذاكرة', disk: 'القرص', updates: 'التحديثات', pendingOf: 'معلّقة، منها', securityUpdates: 'أمنية', rebootAt4: 'إعادة تشغيل عند 04:00', lastPatched: 'آخر ترقيع', sshBans: 'حظر SSH (fail2ban)', failedServices: 'خدمات متعطلة', none: 'لا شيء', managedCareNote: 'تُثبَّت التحديثات الأمنية والدورية تلقائيًا، مع إعادة تشغيل عند 04:00 بتوقيت الخادم عند الحاجة فقط. يُعطَّل تسجيل الدخول بكلمة المرور عند وجود مفتاح SSH.', health_ok: 'سليم', health_warn: 'يحتاج انتباهًا', health_stale: 'لا يرسل تقارير', health_pending: 'بانتظار أول تقرير', agreePrefix: 'بإنشاء الحساب فأنت توافق على', termsLink: 'شروط الخدمة', agreeAnd: 'و', privacyLink: 'سياسة الخصوصية', support: 'الدعم', newTicket: 'تذكرة جديدة', subject: 'الموضوع', priority: 'الأولوية', aboutResource: 'المورد المعني (اختياري)', message: 'الرسالة', ticketNote: 'اذكر الخادم أو قاعدة البيانات أو الفاتورة إن أمكن؛ فذلك يساعدنا على الرد أسرع. يتلقى المالكون ومن فتح التذكرة كل رد عبر البريد.', openTicket: 'فتح تذكرة', tickets: 'التذاكر', responseTarget: 'هدف الرد الأول', updated: 'آخر تحديث', noTickets: 'لا توجد تذاكر بعد.', answeredAt: 'تم الرد', by: 'بحلول', supportPlan: 'خطة الدعم', supportPlanNote: 'الأهداف للرد الأول وتُحسب على مدار الساعة كل يوم. تُفوتر الخطط المدفوعة بالساعة كغيرها ويمكن تغييرها في أي وقت.', currentPlan: 'الحالية', freeWord: 'مجانية', upgrade: 'ترقية', switchTo: 'التحول إلى هذه الخطة', supportBillingNote: (open, max) => `مستخدم ${open} من ${max} تذاكر مفتوحة في هذه الخطة.`, closeTicket: 'إغلاق التذكرة', supportTeam: 'دعم pgcloud', replyPlaceholder: 'اكتب ردًا', reopenPlaceholder: 'الرد يعيد فتح التذكرة', reopenTicket: 'إعادة الفتح مع الرد', sendReply: 'إرسال الرد', notOnPlan: 'غير متاح في هذه الخطة', minutesShort: 'د', hoursShort: 'س', daysShort: 'أيام', prio_low: 'منخفضة', prio_normal: 'عادية', prio_high: 'عالية', prio_urgent: 'عاجلة', filter_all: 'الكل', filter_open: 'مفتوحة', filter_closed: 'مغلقة',
  action: 'الإجراء', started: 'البداية', took: 'المدة', notes: 'ملاحظات', nothingYet: 'لا شيء بعد.', auditNote: 'من فعل ماذا، بما في ذلك رموز الوكلاء، موجود في', auditLog: 'سجل التدقيق',
  login: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', signup: 'إنشاء حساب', teamName: 'اسم الفريق', forgotPassword: 'نسيت كلمة المرور؟',
  authCode: 'رمز المصادقة', authCodeHint: 'أدخل الرمز المكوّن من ستة أرقام من تطبيقك، أو أحد رموز الاسترداد.',
  resetTitle: 'إعادة تعيين كلمة المرور', resetLead: 'أدخل بريدك وسنرسل لك رابطًا. يبقى صالحًا لساعة واحدة.', resetSent: 'إذا كان هناك حساب لهذا العنوان، فالبريد في الطريق. تحقق من صندوق الوارد والبريد المزعج.', sendResetLink: 'إرسال رابط إعادة التعيين', backToSignIn: 'العودة لتسجيل الدخول',
  newPasswordTitle: 'اختر كلمة مرور جديدة', newPassword: 'كلمة مرور جديدة (10 أحرف أو أكثر)', repeatPassword: 'أعد كتابة كلمة المرور الجديدة', passwordsDiffer: 'كلمتا المرور غير متطابقتين.', passwordChanged: 'تم تغيير كلمة المرور.', changePassword: 'تغيير كلمة المرور', missingToken: 'هذا الرابط ينقصه الرمز.', requestNew: 'اطلب رابطًا جديدًا',
  verifyTitle: 'تأكيد البريد الإلكتروني', verifying: 'جارٍ تأكيد بريدك…', verified: 'تم تأكيد بريدك. يمكنك إنشاء الخوادم الآن.', continue: 'متابعة', verifyFailedHint: 'سجّل الدخول وافتح صفحة الأمان لطلب رابط جديد.',
  sessions: 'الأجهزة المسجّل فيها', sessionsNote: 'كل متصفح أنت مسجّل دخولك فيه. أي جهاز ما تعرفه اطلع منه، وبعدها غيّر كلمة المرور.', thisDevice: 'هذا الجهاز', lastActive: 'آخر نشاط', endSession: 'تسجيل خروج', endOtherSessions: 'اطلع من كل الأجهزة الثانية', otherSessionsEnded: 'تم تسجيل الخروج من كل الأجهزة الثانية.', unknownDevice: 'جهاز غير معروف',
  security: 'الأمان', welcomeSecurity: 'مرحبًا. أكّد بريدك من الرسالة التي أرسلناها للتو، وفعّل تسجيل الدخول بخطوتين أدناه لحماية حسابك.',
  confirmed: 'مؤكد', notConfirmed: 'غير مؤكد', needConfirmed: 'تحتاج إلى بريد مؤكد قبل إنشاء الخوادم.', sendAgain: 'إرسال الرابط مجددًا', sentAgain: 'أرسلنا لك رابط تأكيد جديدًا.',
  twoFactor: 'تسجيل الدخول بخطوتين', twoFactorOn: 'مفعّل. يطلب تسجيل الدخول رمزًا من تطبيق المصادقة.', codeToTurnOff: 'رمز للتعطيل', turnOff: 'تعطيل', twoFactorOff: 'تسجيل الدخول بخطوتين معطّل.',
  twoFactorOffOwner: 'معطّل. يجب على مالكي الفريق تفعيله.', twoFactorOffMember: 'معطّل. ننصح بتفعيله.', setUp: 'إعداد',
  scanStep: '1. امسح هذا الرمز بتطبيق Google Authenticator أو 1Password أو Authy أو أي تطبيق TOTP.', typeKey: 'أو اكتب المفتاح يدويًا:', confirmStep: '2. أدخل الرمز المكوّن من ستة أرقام الذي يعرضه التطبيق للتأكيد.',
  recoveryTitle: 'احفظ رموز الاسترداد هذه الآن. تُعرض مرة واحدة فقط. كل رمز يسجّل دخولك مرة واحدة إذا فقدت جهازك.',
  rateLimits: 'حدود طلبات API', rateLimitsNote: 'يمكن لكل رمز أو جلسة إجراء 600 طلب في الدقيقة. محاولات تسجيل الدخول محدودة بـ 10 في الدقيقة لكل عنوان. الردود فوق الحد تعيد الحالة 429 مع ترويسة Retry-After.',
  approvalQueue: 'قائمة الموافقات', approvalsLead: 'رموز الوكلاء ذات قواعد الموافقة تُوقف هذه الإجراءات هنا. لا يعمل شيء حتى يوافق مالك الفريق أو المدير. تنتهي الطلبات بعد 24 ساعة. اضبط القواعد لكل رمز في', agentAccess: 'وصول الوكلاء',
  waitingForYou: 'بانتظارك', nothingWaiting: 'لا شيء بالانتظار. يمكن للوكلاء مواصلة العمل ضمن صلاحياتهم وحدود إنفاقهم.',
  requestedByToken: 'طلبه الرمز', expires: 'ينتهي', server: 'الخادم', approveRun: 'موافقة وتشغيل', deny: 'رفض', history: 'السجل',
  denyReasonPrompt: 'أخبر الوكيل بالسبب (اختياري):', approveConfirm: (s) => `الموافقة والتشغيل الآن: ${s}؟`, deletedToken: 'رمز محذوف',
  balance: 'الرصيد', mtd: 'هذا الشهر',
  paymentRequired: 'لازم تشحن رصيد مرة وحدة قبل ما تنشئ موارد مدفوعة. افتح صفحة الفوترة واشحن أي مبلغ، وبعدها يصير الاستخدام يتفوتر كل شهر.',
  accountSuspended: 'الحساب موقوف، فما يشتغل إلا صفحة الفوترة. سدّد الفاتورة المتأخرة من صفحة الفوترة وترجع خوادمك تشتغل تلقائيًا.',
  oneClick: 'تطبيقات بنقرة واحدة', distributions: 'التوزيعات', comingSoon: 'قريبًا', interest: 'أعلمني عند الإطلاق', interested: 'شكرًا. سنعلمك.',
  agentTokens: 'رموز الوكلاء', newAgentToken: 'إنشاء رمز وكيل', spendCap: 'حد الإنفاق الشهري', requireApproval: 'يتطلب موافقة بشرية لـ',
  scopes: 'الصلاحيات', tokenShownOnce: 'انسخ هذا الرمز الآن. يُعرض مرة واحدة فقط.', revoke: 'إلغاء',
  firewalls: 'جدران الحماية', rules: 'قواعد', attachedServers: 'خوادم', newFirewall: 'إنشاء جدار حماية',
  snapshots: 'اللقطات', publicIps: 'عناوين IP العامة', webhooks: 'Webhooks', newWebhook: 'إضافة webhook', events: 'الأحداث', url: 'الرابط',
  invoices: 'الفواتير', invoiceNumber: 'الرقم', team: 'الفريق', period: 'الفترة', total: 'الإجمالي', amountDue: 'المتبقي', overdue: 'متأخرة', allStatuses: 'كل الحالات', noInvoices: 'ما فيه فواتير للحين.',
  adminInvoicesLead: 'من هنا ترجّع مدفوعات البطاقات، وتصدر إشعارات دائنة، وتلغي الفواتير اللي ما انسدت، وتسجّل التحويلات البنكية، وتشطب الفواتير اللي ما تنحصّل. كل إجراء ينحفظ في سجل التدقيق.',
  cardPayments: 'المدفوعات', creditNotes: 'الإشعارات الدائنة', refunded: 'مسترجع', method: 'الطريقة', amount: 'المبلغ', reason: 'السبب', reference: 'المرجع', done: 'تم.', topUp: 'شحن رصيد',
  refund: 'استرجاع', creditNote: 'إشعار دائن', voidInvoice: 'إلغاء', recordPayment: 'تسجيل دفعة', markUncollectible: 'ما تنحصّل',
  bankTransfer: 'تحويل بنكي', manualPayment: 'غير كذا، تسجيل يدوي', leaveEmptyForFull: 'خلّه فاضي للمبلغ كامل',
  refundConfirm: (amount, what) => `متأكد تبغى ترجّع ${amount} للبطاقة عن ${what}؟ ما تقدر تتراجع بعدها.`,
  refundTopupNote: 'إذا رجّعت شحن رصيد، ينخصم نفس المبلغ من رصيد الفريق اللي ما انصرف.',
  creditNoteConfirm: (amount, number) => `تبغى تصدر إشعار دائن بـ ${amount} على الفاتورة ${number}؟`,
  creditNoteNote: 'على فاتورة ما انسدت، الإشعار الدائن ينقّص المبلغ المتبقي. وعلى فاتورة مسدّدة يصير رصيد للفريق.',
  voidConfirm: (number) => `تبغى تلغي الفاتورة ${number}؟ استخدمها بس للفاتورة اللي طلعت بالغلط. أي رصيد انخصم عليها يرجع للفريق.`,
  recordPaymentConfirm: (amount, number) => `تسجّل إن ${amount} وصلت عن الفاتورة ${number} وتعتبرها مسدّدة؟`,
  uncollectibleConfirm: (number) => `تعتبر الفاتورة ${number} ما تنحصّل؟ تظل محفوظة وممكن تنسدّ بعدين.`,
  teamNav: 'الفريق', members: 'الأعضاء', role: 'الدور', you: 'أنت', removeMember: 'شيل', leaveTeam: 'اطلع من الفريق',
  role_owner: 'مالك', role_admin: 'مشرف', role_member: 'عضو', role_billing: 'الفوترة', role_readonly: 'قراءة بس',
  removeConfirm: (name) => `تبغى تشيل ${name} من الفريق؟ مفاتيح API اللي سواها لهالفريق تنلغي.`,
  leaveConfirm: 'تبغى تطلع من هالفريق؟ بتفقد الوصول على طول ومفاتيح API حقتك فيه تنلغي.',
  roleConfirm: (name, role) => `تغيّر دور ${name} إلى ${role}؟`, roleChanged: 'تغيّر الدور.',
  inviteTitle: 'ادعُ عضو', inviteSend: 'أرسل الدعوة', invitationSent: (email) => `وصلت الدعوة لـ ${email}. الرابط شغّال ٧ أيام.`,
  pendingInvitations: 'دعوات ما انقبلت للحين', revokeInviteConfirm: (email) => `تلغي الدعوة حقت ${email}؟`,
  teamProfile: 'بيانات الفريق', teamProfileLead: 'تنطبع على كل فاتورة. إذا شركتك سعودية حط الرقم الضريبي (١٥ رقم) والعنوان كامل.',
  billingEmailLabel: 'إيميل الفوترة (الفواتير والتذكيرات توصل له بعد)', taxIdLabel: 'الرقم الضريبي', billingAddressLabel: 'عنوان الفوترة', countryLabel: 'الدولة', profileSaved: 'انحفظ.',
  closeAccount: 'قفل الحساب', closeLead: 'قفل الحساب يحذف كل الخوادم وقواعد البيانات والكلسترات والتطبيقات وموزعات الحمل والأقراص والحاويات واللقطات ونطاقات DNS، ويلغي كل مفاتيح API ويطلّع الكل. سدّد أي فاتورة باقية أول. الاستخدام لين اليوم يتفوتر آخر الشهر. ما تقدر تتراجع بعدها.',
  closeType: (slug) => `اكتب ${slug} عشان تأكد`, closeButton: 'اقفل الحساب نهائيًا', closeConfirm: 'آخر تأكيد: تقفل الحساب وتحذف كل اللي فيه؟',
  inviteAcceptTitle: 'دعوة للفريق', inviteLead: (team, role) => `انت مدعو تنضم لفريق ${team} بدور ${role}.`, inviteFor: (email) => `هالدعوة لـ ${email}.`,
  acceptInvite: 'اقبل الدعوة', signInToAccept: 'سجّل دخول بهالإيميل عشان تقبل.', createToAccept: 'اختر اسمك وكلمة مرور عشان نسوي حسابك وتنضم.',
  inviteInvalid: 'رابط الدعوة هذا ما عاد يشتغل. اطلب من الفريق دعوة جديدة.', inviteWrongUser: (email) => `انت داخل بإيميل ثاني. اطلع، وافتح الرابط مرة ثانية، وادخل بـ ${email}.`,
  admIpBlocks: 'نطاقات IP', admIpBlocksNote: 'كل نطاق ينقسم لعناوين IPv4 عامة، عنوان لكل عنوان صالح. نتخطى عنوان الشبكة والبث والبوابة. النطاق اللي فيه عناوين مستخدمة ما ينحذف.',
  admCidr: 'CIDR', admGateway: 'البوابة', admFree: 'فاضية', admAllocated: 'مستخدمة', admAddBlock: 'أضف نطاق', admDeleteBlockConfirm: (cidr) => `تبي تحذف ${cidr} وعناوينه الفاضية؟`,
  admImages: 'الصور', admImagesNote: 'الصورة تنسخ من قالب Proxmox برقم VMID، ولازم يكون القالب موجود على كل عقدة في المنطقة.',
  admSlug: 'المعرّف', admDistribution: 'التوزيعة', admVersion: 'الإصدار', admTemplateId: 'رقم القالب VMID', admAvailable: 'متاحة', admHidden: 'مخفية', admAllRegions: 'كل المناطق', admAddImage: 'أضف صورة', admServersUsing: 'الخوادم', admMakeAvailable: 'خلّها متاحة', admHide: 'اخفها',
};

const dict: Record<Locale, Dict> = { en, tr, ar };

export type Key = keyof Dict;
type StringKey = { [K in Key]: Dict[K] extends string ? K : never }[Key];

/** Plain string lookup. Falls back to English when a translation is missing. */
export function t(locale: Locale, key: StringKey): string {
  return (dict[locale][key] as string) ?? (dict.en[key] as string);
}

/** Lookup for strings that take arguments, e.g. `tf(locale, 'resizeConfirm')(name, size)`. */
export function tf<K extends Key>(locale: Locale, key: K): Dict[K] {
  return dict[locale][key] ?? dict.en[key];
}

/** Product group names live in products.ts as English identifiers; this maps them for display. */
export function groupLabel(locale: Locale, group: string): string {
  const map: Record<string, StringKey> = { Projects: 'groupProjects', 'Managed Agents': 'groupAgents', 'Inference Engine': 'groupInference', 'Data & Learning': 'groupData', 'Core Cloud': 'groupCore', Marketplace: 'groupMarketplace', Security: 'groupSecurity' };
  return map[group] ? t(locale, map[group]) : group;
}

export function getLocale(): Locale {
  try {
    const l = localStorage.getItem('pgcloud.locale');
    if (l === 'tr' || l === 'ar' || l === 'en') return l;
    const nav = navigator.language.slice(0, 2);
    return nav === 'tr' || nav === 'ar' ? nav : 'en';
  } catch {
    return 'en';
  }
}
