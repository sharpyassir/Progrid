/**
 * Ops console strings in English and Arabic (right to left). English is the source of truth;
 * Arabic uses the same Saudi voice as the customer console. `{name}` placeholders are filled by
 * `translate`. Every English key must exist in Arabic (the type enforces it).
 */
export type Locale = 'en' | 'ar';

export const RTL: Record<Locale, boolean> = { en: false, ar: true };

const en = {
  // shell
  language: 'Language', menu: 'Menu', signOut: 'Sign out', loading: 'Loading…', working: 'Working…', close: 'Close', back: 'Back', cancel: 'Cancel', save: 'Save', edit: 'Edit', delete: 'Delete', remove: 'Remove', search: 'Search', or: 'or', none: 'None', continue: 'Continue', verify: 'Verify', listSep: ', ',
  navShift: 'My shift', navAlerts: 'Alert board', navTickets: 'Tickets', navAccess: 'Access', navMaintenance: 'Maintenance', navTimesheet: 'Timesheet', navRunbooks: 'Runbooks', navPostmortems: 'Postmortems', navHandover: 'Handover', navPayouts: 'Payouts', navSecurity: 'Sign in methods',
  onCallNow: 'On call', offCall: 'Not on call', timerRunning: 'Timer running',
  unitD: 'd', unitH: 'h', unitM: 'm', unitS: 's', minutesN: '{n} min', hour: 'hour', shiftsN: '{n} shifts',
  lateBy: '{d} late', contractLocal: 'Contract local time',
  errNetwork: 'Cannot reach the API. Check your VPN and connection, then try again.',
  idlePrompt: 'Your timer has had no activity for a while. Keep it running if you are still working, or stop it now. It stops on its own if nothing happens.',
  idleKeep: 'Keep going', idleKept: 'The timer keeps running.',

  // sign in
  signInTitle: 'Sign in to Progrid Ops', signInLead: 'For on call engineers of Progrid managed cloud. Every action here is recorded.',
  email: 'Email', password: 'Password', forgotPassword: 'Forgot your password?', sessionEnded: 'Your session ended. Sign in again to continue.',
  secondFactorLead: 'Confirm it is you with your passkey or your authenticator app.', usePasskey: 'Use my passkey', passkeyCancelled: 'The passkey prompt was cancelled or timed out. Try again.',
  authCode: 'Authenticator code', authCodeHint: 'The six digit code from your app, or one of your recovery codes.', startOver: 'Start over',
  enrollTitle: 'Set up your second factor', enrollLead: 'The ops console always needs a second factor. Pick one to set up now; you can add the other later.',
  enrollPasskey: 'Passkey or security key', enrollPasskeyNote: 'Touch ID, Windows Hello, a phone or a hardware key. Recommended.',
  enrollTotp: 'Authenticator app', enrollTotpNote: 'Google Authenticator, 1Password, Authy or any TOTP app.',
  passkeyDefaultName: 'Passkey',
  scanStep: 'Scan this code with your authenticator app.', typeKey: 'Or type the key by hand:', confirmStep: 'Enter the six digit code the app shows', qrAlt: 'QR code for your authenticator app',
  turnOnAndSignIn: 'Turn on and sign in', recoveryTitle: 'Save these recovery codes somewhere safe. They are shown only once, and each one signs you in a single time if you lose your device.', savedCodes: 'I saved them, continue',
  setPasswordTitle: 'Choose your password', setPasswordLead: 'Set the password for your Progrid Ops account. You set up your second factor the first time you sign in.',
  newPassword: 'New password', passwordRule: 'At least 10 characters.', repeatPassword: 'Repeat the password', passwordsDiffer: 'The two passwords do not match.', savePassword: 'Save password',
  passwordSet: 'Your password is set. Sign in to continue.', goToSignIn: 'Go to sign in', missingToken: 'This link is missing its token.', requestNewLink: 'Request a new link',
  resetTitle: 'Reset your password', resetLead: 'Enter your email and we will send you a link to choose a new password.', sendResetLink: 'Send the link', resetSent: 'If that address belongs to an engineer account, the email is on its way.', backToSignIn: 'Back to sign in',

  // my shift
  myShiftTitle: 'Hello {name}', myShiftLead: 'Your pages, tickets, timer and access in one place.',
  pagesWaiting: '{n} page(s) waiting for you', urgentPage: 'High urgency', ack: 'Acknowledge', pageAcked: 'Page acknowledged.', ackTarget: 'Acknowledge within 10 minutes, or the support lead is paged.', openTicket: 'Open ticket',
  onCallStatus: 'On call status', shiftNotStarted: 'Your shift has not started', nextShift: 'Next shift', noUpcomingShift: 'No shift scheduled.', since: 'since', until: 'until', shiftEndsIn: 'ends in',
  role_PRIMARY: 'Primary', role_SECONDARY: 'Secondary',
  startChecklist: 'Start checklist', chk_pagingAppOnline: 'The paging app is online (a test page arrived)', chk_vpnWorking: 'VPN connected and working', chk_twoFactorWorking: 'Two factor sign in works on this device', chk_lastHandoverRead: 'I read the last handover',
  readLastHandover: 'Read the last handover', checklistHint: 'Confirm every item to start.', startShift: 'Start shift', shiftStarted: 'Your shift started. You now receive pages.',
  endShift: 'End shift', endShiftNote: 'Ending the shift needs the handover. Access grants that are not for emergencies are revoked.',
  myTickets: 'My tickets, most urgent first', allTickets: 'All tickets', runningTimer: 'Running timer', noTimer: 'No timer running. Start one from a ticket.',
  activeGrants: 'Active access', allGrants: 'All grants', noActiveGrants: 'No active access.', lastHandover: 'Last handover', noHandoverYet: 'No handover yet.',
  handoverBy: 'By {name}', openTickets: 'Open tickets', risks: 'Risks', pendingMaintenance: 'Pending maintenance', notes: 'Notes',

  // tickets
  ticketsLead: 'Tickets on your contracts, the closest SLA target first.', mine: 'Mine', allAssigned: 'All my contracts', anyPriority: 'Any priority', allContracts: 'All contracts', contract: 'Contract',
  ticketFilter_open: 'Open', ticketFilter_answered: 'Waiting on customer', ticketFilter_resolved_pending_pm: 'Waiting for postmortem', ticketFilter_closed: 'Closed', ticketFilter_all: 'All',
  ticket: 'Ticket', priority: 'Priority', subject: 'Subject', status: 'Status', assignee: 'Assignee', unassigned: 'Unassigned', slaLeft: 'SLA left', slaResponse: 'First response', slaResolve: 'Resolution', noTickets: 'No tickets here.',
  openedAt: 'Opened', assignToMe: 'Assign to me', assignedToYou: 'The ticket is yours.', conversation: 'Conversation', noMessages: 'No messages yet.', customer: 'Customer', engineer: 'Engineer',
  internalNote: 'Internal note', publicReply: 'Public reply', rootCause: 'Root cause', messageKind: 'Message type',
  internalHint: 'Only engineers and staff see internal notes.', publicHint: 'The customer gets this by email. It counts as our response.',
  notePlaceholder: 'What you found, what you tried, what is next', replyPlaceholder: 'Write to the customer', saveNote: 'Save note', sendReply: 'Send to customer', noteSaved: 'Note saved.', replySent: 'Reply sent to the customer.',
  ticketAlerts: 'Alerts on this ticket', timeOnTicket: 'Time on this ticket',
  sla: 'SLA', breached: 'Breached', metAt: 'Met', dueAt: 'Due',
  timer: 'Timer', startTimer: 'Start timer', stopTimer: 'Stop timer', timerStarted: 'Timer started.', timerStopped: 'Timer stopped. The time is in your timesheet as a draft.', timerElsewhere: 'Your timer runs on', stopThatTimer: 'Stop that timer', ticketNotOpen: 'The ticket is not open.', timerNote: 'Only the timer creates time. One timer at a time.',
  serverAccess: 'Server access', noGrantsOnTicket: 'No access for this ticket yet.', noAssetOnTicket: 'This ticket has no asset, so there is nothing to open.', siteNoShell: 'A site has no shell to open.',
  reason: 'Reason', accessReasonPlaceholder: 'What you need to do on the server', duration: 'Duration', requestAccess: 'Request access',
  autoApprovalEligible: 'P1 or P2 while you are on call: approved automatically for {h} hours.', leadApprovalNote: 'A support lead approves this request. Up to {h} hours.',
  accessRecordedNote: 'Access is for this ticket and asset only, ends on its own, and every terminal session is recorded.',
  statusChanged: 'Status changed.', markAnswered: 'Waiting on customer', markOpen: 'Back to open', closeTicket: 'Close ticket',
  rootCauseRequired: 'Root cause (required to close)', rootCauseOptional: 'Root cause (a note exists; add more if you like)', rootCauseHint: 'Saved as an internal note. At least 10 characters.',
  p1PostmortemNote: 'This is a P1: closing moves it to waiting for postmortem. The postmortem is due within 48 hours and closes the ticket when submitted.',
  closeRevokesNote: 'Closing revokes every access grant on this ticket.', waitingPostmortem: 'Resolved. The ticket closes when its postmortem is submitted.', openPostmortem: 'Open postmortem', writePostmortem: 'Write the postmortem',
  escalate: 'Escalate', escalateSuggested: 'This P1 has been open for {n} minutes or more. If it is not contained, escalate to the support lead now.', escalateToLead: 'Escalate to support lead', escalateReason: 'What is happening and what you need',
  asset: 'Asset', assetView: 'Asset view', lastHeartbeat: 'Last heartbeat', uptime: 'Uptime', lastPatch: 'Last patch', lastBackupTest: 'Last backup test', grafanaMetrics: 'Grafana metrics', lokiLogs: 'Loki logs', recentAlerts: 'Recent alerts', noAlerts: 'No alerts.',
  suggestedRunbooks: 'Suggested runbooks', allRunbooks: 'All runbooks', noSuggestions: 'No runbook matches this ticket yet.',
  kind_PLATFORM_SERVER: 'Progrid server', kind_EXTERNAL_SERVER: 'External server', kind_SITE: 'Site',

  // alerts
  alertsLead: 'Live alerts on your contracts, refreshed every 15 seconds.', alertFilter_open: 'Open', alertFilter_FIRING: 'Firing', alertFilter_all: 'All', live: 'Live',
  firingFor: 'firing for', ackAndTake: 'Acknowledge and take', alertAcked: 'Alert acknowledged; its ticket is yours.', viewAsset: 'Asset', ackedAt: 'Acknowledged',

  // asset
  health: 'Health', monitoringOff: 'Monitoring is off', agentStatus: 'Agent status', hostname: 'Hostname', managementAddress: 'Management address', noGrafana: 'Metric and log links appear here when Grafana is set up.',
  maintenanceHistory: 'Maintenance history', backups: 'Backups', backupsOn: 'Backups are on.', backupsOff: 'Backups are off.', backupTests: 'Backup tests', responsibilityMatrix: 'Responsibility matrix', area: 'Area', owner: 'Owner', noRuns: 'No runs yet.',
  trigger_schedule: 'Scheduled', trigger_manual: 'Run now', trigger_retry: 'Retry',

  // access
  accessLead: 'Your access grants and terminal sessions. Access is per ticket, time limited and recorded.', myGrants: 'My grants', noGrants: 'No grants.', mySessions: 'My terminal sessions', noSessions: 'No sessions yet.', sessionsRecordedNote: 'Every session is recorded and kept for 12 months.',
  grantFilter_live: 'Requested and active', grantFilter_REQUESTED: 'Requested', grantFilter_ACTIVE: 'Active', grantFilter_EXPIRED: 'Expired', grantFilter_REVOKED: 'Revoked', grantFilter_DENIED: 'Denied', grantFilter_all: 'All',
  autoApproved: 'Auto approved', emergency: 'Emergency', maintenanceRun: 'Maintenance run', expiresIn: 'ends in', waitingForLead: 'Waiting for a support lead', requested: 'Requested', extendedOnce: 'Extended once', denied: 'Denied', revoked: 'Revoked',
  openTerminal: 'Open terminal', extendOnce: 'Extend (once)', extend: 'Extend', extensionReason: 'Why you need more time', extensionNote: 'A grant can be extended once, counted from its current end.', grantExtended: 'Access extended.',
  started: 'Started', endReason: 'End reason',

  // terminal
  accessEndsIn: 'Access ends in', sessionRecorded: 'This session is recorded', term_opening: 'Opening', term_connecting: 'Connecting', term_ready: 'Connected', term_closed: 'Closed', term_error: 'Failed',
  pasteBlocked: 'Paste is turned off for this session.',
  termReason_auth_timeout: 'The gateway did not get the sign in in time. Open a new session.',
  termReason_auth_required: 'The gateway needs a session token. Open a new session from the grant.',
  termReason_bad_frame: 'The gateway could not read a message from this page. Open a new session.',
  termReason_token_invalid: 'The session token was not accepted. Open a new session from the grant.',
  termReason_token_used: 'This session token was already used. Open a new session from the grant.',
  termReason_token_expired: 'The session token expired before it connected. Open a new session.',
  termReason_grant_expired: 'Your access expired, so the session ended. Extend or request access to continue.',
  termReason_grant_inactive: 'The access grant is no longer active: it was revoked or has ended.',
  termReason_session_killed: 'A support lead ended this session.',
  termReason_residency_blocked: 'This contract does not allow access from your country.',
  termReason_engineer_inactive: 'Your engineer account is not active.',
  termReason_forbidden: 'You are no longer assigned to this contract.',
  termReason_asset_unavailable: 'The server cannot be reached right now.',
  termReason_killed: 'The session was ended: the access was revoked or a support lead stopped it.',
  termReason_ssh_closed: 'The server closed the connection (you logged out, or it rebooted).',
  termReason_client_closed: 'You closed the session.',
  termReason_error: 'The gateway hit an error and closed the session.',
  termReason_api_unavailable: 'The gateway could not reach the Progrid API. Try again in a minute.',
  termReason_connection_lost: 'The connection to the gateway dropped. Open a new session from the grant if you still need it.',
  termReason_connect_failed: 'Could not connect to the terminal gateway. Check your VPN, then open a new session.',
  sessionClosed: 'The session is closed.', sessionClosedReason: 'The session is closed: {reason}', backToTicket: 'Back to the ticket', backToAccess: 'Back to access', noGrantChosen: 'Open the terminal from an active grant.',
  terminalFooter: 'Keystrokes and output are recorded. Paste is allowed; file download is not available.',

  // maintenance
  maintenanceLead: 'Tasks on your assets. Runs happen on the platform, never from your machine.', tasks: 'Tasks', task: 'Task', kind: 'Kind', schedule: 'Schedule', nextRun: 'Next run', lastRun: 'Last run', allAssets: 'All assets', paused: 'Paused', runNow: 'Run now', noTasks: 'No tasks.',
  runsOnPlatform: 'A failed run opens a P3 ticket assigned to whoever started it.', runStarted: 'Run started.', runHistory: 'History', trigger: 'Trigger', finished: 'Finished', output: 'Output', retry: 'Retry',
  liveOutput: 'Output', waitingForOutput: 'Waiting for output…', streamFailed: 'The live output stopped. Reload the page to follow it again.',
  mkind_PATCHING: 'Patching', mkind_BACKUP_TEST: 'Backup test', mkind_CUSTOM: 'Custom',

  // timesheet
  timesheetLead: 'Your time by day. Submit the month when it is complete.', month: 'Month', manualEntry: 'Manual entry', submitMonth: 'Submit month ({n} drafts)', totalTime: 'Total',
  noEntries: 'No time this month.', manual: 'Manual', flagged: 'Flagged for review', notBillable: 'Not billable', terminalMinutes: 'Terminal minutes', reviewComment: 'Review comment',
  deleteEntryConfirm: 'Delete this entry?', entryDeleted: 'Entry deleted.', entryAdded: 'Entry added and flagged for review.',
  manualNote: 'Use the timer whenever you can. Manual entries need a reason and a support lead reviews every one.', chooseTicket: 'Choose a ticket', startedAtYourTime: 'Started (your time)', minutes: 'Minutes', billable: 'Billable',
  reasonRequired: 'Reason (required)', manualReasonPlaceholder: 'Why the timer was not used', noteOptional: 'Note (optional)', addEntry: 'Add entry',

  // runbooks and postmortems
  runbooksLead: 'Shared runbooks. Improve them whenever you learn something.', newRunbook: 'New runbook', searchRunbooks: 'Search runbooks', noRunbooks: 'No runbooks found.', updated: 'Updated',
  editRunbook: 'Edit runbook', runbookSaved: 'Runbook saved.', runbookDeleted: 'Runbook deleted.', deleteRunbookConfirm: 'Delete this runbook for everyone?',
  title: 'Title', tags: 'Tags', tagsHint: 'Comma separated, e.g. os:ubuntu, nginx, asset:<id>', body: 'Body', write: 'Write', preview: 'Preview', markdownHint: 'Markdown: # headings, lists, `code` and fenced code blocks',
  postmortemsLead: 'Every P1 needs a postmortem within 48 hours of its resolution.', allStatuses: 'All statuses', noPostmortems: 'No postmortems.', due: 'Due', overdue: 'Overdue',
  postmortemFor: 'Postmortem for ticket #{n}', resolved: 'Resolved', submitted: 'Submitted', leadComment: 'Support lead comment',
  pm_timeline: 'Timeline', pm_impact: 'Impact', pm_rootCause: 'Root cause', pm_fix: 'Fix', pm_prevention: 'Prevention',
  pmHint_timeline: 'What happened when, in the contract time: alert, acknowledgement, first response, actions, resolution.', pmHint_impact: 'Who and what was affected, for how long.', pmHint_rootCause: 'Why it happened, not only what broke.', pmHint_fix: 'What restored the service.', pmHint_prevention: 'Actions that stop it from happening again, with owners.',
  saveDraft: 'Save draft', submitPostmortem: 'Submit postmortem', draftSaved: 'Draft saved.', postmortemSubmitted: 'Postmortem submitted; the ticket is closed.', pmMissing: 'Fill in: {list}', pmSubmitNote: 'Submitting closes the ticket. A support lead then closes the postmortem.',

  // handover
  handoverLead: 'Hand over to the next engineer. Ending your shift needs this form.', noRunningShift: 'You have no running shift, so there is nothing to end.', shiftWindow: 'Shift',
  handoverTicketsNote: 'Your open tickets are always included.', included: 'Included', noOpenTicketsOfYours: 'You have no open tickets.', addOtherTickets: 'Add other open tickets ({n})',
  risksHint: 'Anything that could page the next engineer.', pendingHint: 'Prefilled with what runs in the next 24 hours.', endShiftWithHandover: 'Submit handover and end shift', shiftEnded: 'Shift ended. Thanks for the handover.',

  // payouts
  payoutsLead: 'Your monthly statements. Payment is by bank transfer.', noPayouts: 'No statements yet.', downloadPdf: 'Download PDF', total: 'Total', workedTime: 'Worked', nightTime: 'Night', workAmount: 'Work', rate: 'Rate', standby: 'Standby',
  issued: 'Issued', paid: 'Paid', reference: 'Reference', lines: 'Lines ({n})', customerCol: 'Customer', amount: 'Amount',

  // security
  securityLead: 'Your second factors for the ops console.', passkeys: 'Passkeys and security keys', addPasskey: 'Add passkey', noPasskeys: 'No passkeys yet.', added: 'Added', lastUsed: 'last used',
  removeKeyConfirm: 'Remove this key? You can not remove your only second factor.', keyRemoved: 'Key removed.', passkeyAdded: 'Passkey added.',
  authenticatorApp: 'Authenticator app', totpOn: 'On.', totpOff: 'Not set up.', setUp: 'Set up', turnOn: 'Turn on', totpEnabled: 'Authenticator app turned on.',
  sessionPolicy: 'Sessions last 12 hours and end when you close the browser.',

  // statuses
  st_ACTIVE: 'Active', st_APPROVED: 'Approved', st_SUCCEEDED: 'Succeeded', st_HEALTHY: 'Healthy', st_PAID: 'Paid', st_CLOSED: 'Closed', st_closed: 'Closed', st_ISSUED: 'Issued',
  st_REQUESTED: 'Requested', st_SUBMITTED: 'Submitted', st_QUEUED: 'Queued', st_RUNNING: 'Running', st_DRAFT: 'Draft', st_open: 'Open', st_answered: 'Waiting on customer', st_resolved_pending_pm: 'Waiting for postmortem',
  st_DENIED: 'Denied', st_REVOKED: 'Revoked', st_FAILED: 'Failed', st_REJECTED: 'Rejected', st_UNHEALTHY: 'Unhealthy', st_EXPIRED: 'Expired', st_DEGRADED: 'Degraded', st_UNKNOWN: 'Unknown',
  st_FIRING: 'Firing', st_ACKNOWLEDGED: 'Acknowledged', st_RESOLVED: 'Resolved', st_CRITICAL: 'Critical', st_WARNING: 'Warning', st_INFO: 'Info',
  st_PROGRID: 'Progrid', st_CUSTOMER: 'Customer', st_SHARED: 'Shared', st_PENDING: 'Pending', st_ENDED: 'Ended', st_KILLED: 'Ended by staff',

  // API error codes
  err_unauthorized: 'The email or password is not right, or the sign in step expired.',
  err_totp_invalid: 'That code is not valid. Check the time on your device and try again.',
  err_challenge_invalid: 'The sign in step expired. Start over.',
  err_webauthn_invalid: 'The passkey was not accepted. Try again or use your authenticator app.',
  err_engineer_inactive: 'Your engineer account is not active. Contact your support lead.',
  err_ip_not_allowed: 'The ops console is not allowed from this network. Connect to the VPN and try again.',
  err_not_engineer: 'The ops console is for engineers only.',
  err_root_cause_required: 'Record the root cause before closing the ticket.',
  err_timer_running: 'You already have a timer running. Stop it first.',
  err_extension_used: 'This grant was already extended once.',
  err_grant_exists: 'You already have access requested or active for this asset and ticket.',
  err_residency_blocked: 'This contract does not allow access from your country.',
  err_checklist_incomplete: 'Confirm every item of the start checklist.',
  err_handover_not_read: 'Read the last handover first.',
  err_postmortem_incomplete: 'Fill in every section before submitting.',
  err_not_found: 'Not found, or not on your contracts.',
  err_forbidden: 'You are not allowed to do this.',
} as const;

export type Key = keyof typeof en;

const ar: Record<Key, string> = {
  language: 'اللغة', menu: 'القائمة', signOut: 'تسجيل الخروج', loading: 'جاري التحميل…', working: 'لحظة…', close: 'إغلاق', back: 'رجوع', cancel: 'إلغاء', save: 'حفظ', edit: 'تعديل', delete: 'حذف', remove: 'إزالة', search: 'بحث', or: 'أو', none: 'لا شيء', continue: 'متابعة', verify: 'تحقق', listSep: '، ',
  navShift: 'مناوبتي', navAlerts: 'لوحة التنبيهات', navTickets: 'التذاكر', navAccess: 'الصلاحيات', navMaintenance: 'الصيانة', navTimesheet: 'سجل الساعات', navRunbooks: 'أدلة التشغيل', navPostmortems: 'تقارير ما بعد الحادث', navHandover: 'التسليم', navPayouts: 'المستحقات', navSecurity: 'طرق الدخول',
  onCallNow: 'مناوب الحين', offCall: 'مو مناوب', timerRunning: 'المؤقت شغّال',
  unitD: 'ي', unitH: 'س', unitM: 'د', unitS: 'ث', minutesN: '{n} دقيقة', hour: 'ساعة', shiftsN: '{n} مناوبات',
  lateBy: 'متأخر {d}', contractLocal: 'بتوقيت العقد',
  errNetwork: 'ما قدرنا نوصل للـ API. تأكد من الـ VPN والاتصال وجرّب مرة ثانية.',
  idlePrompt: 'المؤقت صار له فترة بدون أي نشاط. خلّه شغّال إذا لسا تشتغل، أو وقّفه الحين. إذا ما صار شي يوقف لحاله.',
  idleKeep: 'كمّل', idleKept: 'المؤقت مكمّل.',

  signInTitle: 'الدخول إلى Progrid Ops', signInLead: 'للمهندسين المناوبين على السحابة المُدارة من Progrid. كل شي تسويه هنا ينسجل.',
  email: 'البريد الإلكتروني', password: 'كلمة المرور', forgotPassword: 'نسيت كلمة المرور؟', sessionEnded: 'انتهت جلستك. سجّل دخولك مرة ثانية عشان تكمل.',
  secondFactorLead: 'أكّد إنه أنت بمفتاح المرور أو تطبيق المصادقة.', usePasskey: 'استخدم مفتاح المرور', passkeyCancelled: 'انلغى طلب مفتاح المرور أو خلص وقته. جرّب مرة ثانية.',
  authCode: 'رمز المصادقة', authCodeHint: 'الرمز المكوّن من ست أرقام من التطبيق، أو واحد من رموز الاسترداد.', startOver: 'ابدأ من جديد',
  enrollTitle: 'جهّز العامل الثاني', enrollLead: 'لوحة العمليات تطلب عامل ثاني دايمًا. اختر واحد تجهّزه الحين، وتقدر تضيف الثاني بعدين.',
  enrollPasskey: 'مفتاح مرور أو مفتاح أمان', enrollPasskeyNote: 'Touch ID أو Windows Hello أو جوالك أو مفتاح أمان. هذا اللي ننصح فيه.',
  enrollTotp: 'تطبيق المصادقة', enrollTotpNote: 'Google Authenticator أو 1Password أو Authy أو أي تطبيق TOTP.',
  passkeyDefaultName: 'مفتاح مرور',
  scanStep: 'امسح هالرمز بتطبيق المصادقة.', typeKey: 'أو اكتب المفتاح يدويًا:', confirmStep: 'اكتب الرمز المكوّن من ست أرقام اللي يطلع لك في التطبيق', qrAlt: 'رمز QR لتطبيق المصادقة',
  turnOnAndSignIn: 'فعّل وادخل', recoveryTitle: 'احفظ رموز الاسترداد هذي في مكان آمن. تطلع لك مرة وحدة بس، وكل رمز يدخلك مرة وحدة لو ضاع جهازك.', savedCodes: 'حفظتها، كمّل',
  setPasswordTitle: 'اختر كلمة المرور', setPasswordLead: 'حط كلمة المرور لحسابك في Progrid Ops. تجهّز العامل الثاني أول مرة تدخل.',
  newPassword: 'كلمة المرور الجديدة', passwordRule: '10 أحرف على الأقل.', repeatPassword: 'أعد كتابة كلمة المرور', passwordsDiffer: 'كلمتين المرور مو متطابقة.', savePassword: 'احفظ كلمة المرور',
  passwordSet: 'تم حفظ كلمة المرور. سجّل دخولك عشان تكمل.', goToSignIn: 'روح لتسجيل الدخول', missingToken: 'هالرابط ناقصه الرمز.', requestNewLink: 'اطلب رابط جديد',
  resetTitle: 'إعادة تعيين كلمة المرور', resetLead: 'اكتب بريدك ونرسل لك رابط تختار فيه كلمة مرور جديدة.', sendResetLink: 'أرسل الرابط', resetSent: 'إذا كان العنوان لحساب مهندس، الرسالة في الطريق.', backToSignIn: 'ارجع لتسجيل الدخول',

  myShiftTitle: 'هلا {name}', myShiftLead: 'التنبيهات والتذاكر والمؤقت والصلاحيات كلها في مكان واحد.',
  pagesWaiting: '{n} نداء بانتظارك', urgentPage: 'عاجل', ack: 'استلمت', pageAcked: 'تم استلام النداء.', ackTarget: 'استلم خلال 10 دقايق، وإلا ينادون قائد الدعم.', openTicket: 'افتح التذكرة',
  onCallStatus: 'حالة المناوبة', shiftNotStarted: 'مناوبتك ما بدأت', nextShift: 'المناوبة الجاية', noUpcomingShift: 'ما فيه مناوبة مجدولة.', since: 'من', until: 'إلى', shiftEndsIn: 'تنتهي بعد',
  role_PRIMARY: 'أساسي', role_SECONDARY: 'احتياطي',
  startChecklist: 'قائمة بداية المناوبة', chk_pagingAppOnline: 'تطبيق النداء شغّال (وصلني نداء تجريبي)', chk_vpnWorking: 'الـ VPN متصل وشغّال', chk_twoFactorWorking: 'التحقق بخطوتين شغّال على هالجهاز', chk_lastHandoverRead: 'قريت آخر تسليم',
  readLastHandover: 'اقرأ آخر تسليم', checklistHint: 'أكّد كل البنود عشان تبدأ.', startShift: 'ابدأ المناوبة', shiftStarted: 'بدأت مناوبتك. الحين توصلك النداءات.',
  endShift: 'أنهِ المناوبة', endShiftNote: 'إنهاء المناوبة يحتاج تسليم. الصلاحيات اللي مو طوارئ تنسحب.',
  myTickets: 'تذاكري، الأعجل أول', allTickets: 'كل التذاكر', runningTimer: 'المؤقت الشغّال', noTimer: 'ما فيه مؤقت شغّال. شغّله من التذكرة.',
  activeGrants: 'الصلاحيات الفعّالة', allGrants: 'كل الصلاحيات', noActiveGrants: 'ما عندك صلاحيات فعّالة.', lastHandover: 'آخر تسليم', noHandoverYet: 'ما فيه تسليم للحين.',
  handoverBy: 'من {name}', openTickets: 'التذاكر المفتوحة', risks: 'المخاطر', pendingMaintenance: 'صيانة معلّقة', notes: 'ملاحظات',

  ticketsLead: 'تذاكر عقودك، الأقرب لموعد الـ SLA أول.', mine: 'تذاكري', allAssigned: 'كل عقودي', anyPriority: 'أي أولوية', allContracts: 'كل العقود', contract: 'العقد',
  ticketFilter_open: 'مفتوحة', ticketFilter_answered: 'بانتظار العميل', ticketFilter_resolved_pending_pm: 'بانتظار تقرير الحادث', ticketFilter_closed: 'مقفلة', ticketFilter_all: 'الكل',
  ticket: 'التذكرة', priority: 'الأولوية', subject: 'الموضوع', status: 'الحالة', assignee: 'المسؤول', unassigned: 'بدون مسؤول', slaLeft: 'باقي على الـ SLA', slaResponse: 'أول رد', slaResolve: 'الحل', noTickets: 'ما فيه تذاكر هنا.',
  openedAt: 'انفتحت', assignToMe: 'خذها أنا', assignedToYou: 'التذكرة صارت لك.', conversation: 'المحادثة', noMessages: 'ما فيه رسائل للحين.', customer: 'العميل', engineer: 'مهندس',
  internalNote: 'ملاحظة داخلية', publicReply: 'رد للعميل', rootCause: 'السبب الجذري', messageKind: 'نوع الرسالة',
  internalHint: 'الملاحظات الداخلية يشوفها المهندسين والفريق بس.', publicHint: 'توصل العميل على الإيميل، وتنحسب ردّنا.',
  notePlaceholder: 'وش لقيت، وش جربت، وش الخطوة الجاية', replyPlaceholder: 'اكتب للعميل', saveNote: 'احفظ الملاحظة', sendReply: 'أرسل للعميل', noteSaved: 'انحفظت الملاحظة.', replySent: 'انرسل الرد للعميل.',
  ticketAlerts: 'تنبيهات هالتذكرة', timeOnTicket: 'الوقت على هالتذكرة',
  sla: 'الـ SLA', breached: 'تجاوز', metAt: 'تحقق', dueAt: 'الموعد',
  timer: 'المؤقت', startTimer: 'شغّل المؤقت', stopTimer: 'وقّف المؤقت', timerStarted: 'اشتغل المؤقت.', timerStopped: 'وقف المؤقت. الوقت في سجل ساعاتك كمسودة.', timerElsewhere: 'مؤقتك شغّال على', stopThatTimer: 'وقّف ذاك المؤقت', ticketNotOpen: 'التذكرة مو مفتوحة.', timerNote: 'الوقت ينحسب من المؤقت بس. مؤقت واحد بكل مرة.',
  serverAccess: 'صلاحية الخادم', noGrantsOnTicket: 'ما فيه صلاحية لهالتذكرة للحين.', noAssetOnTicket: 'هالتذكرة ما عليها أصل، فما فيه شي ينفتح.', siteNoShell: 'الموقع ما له طرفية تنفتح.',
  reason: 'السبب', accessReasonPlaceholder: 'وش تحتاج تسوي على الخادم', duration: 'المدة', requestAccess: 'اطلب صلاحية',
  autoApprovalEligible: 'P1 أو P2 وأنت مناوب: تنقبل تلقائيًا لمدة {h} ساعات.', leadApprovalNote: 'قائد الدعم يوافق على هالطلب. لحد {h} ساعات.',
  accessRecordedNote: 'الصلاحية لهالتذكرة وهالأصل بس، تنتهي لحالها، وكل جلسة طرفية تنسجل.',
  statusChanged: 'تغيّرت الحالة.', markAnswered: 'بانتظار العميل', markOpen: 'رجّعها مفتوحة', closeTicket: 'اقفل التذكرة',
  rootCauseRequired: 'السبب الجذري (لازم عشان تقفل)', rootCauseOptional: 'السبب الجذري (فيه ملاحظة، زِد عليها إذا تبي)', rootCauseHint: 'ينحفظ كملاحظة داخلية. 10 أحرف على الأقل.',
  p1PostmortemNote: 'هذي P1: إذا قفلتها تصير بانتظار تقرير الحادث. التقرير مطلوب خلال 48 ساعة، ولما ينرسل تنقفل التذكرة.',
  closeRevokesNote: 'قفل التذكرة يسحب كل الصلاحيات اللي عليها.', waitingPostmortem: 'انحلّت. التذكرة تنقفل لما ينرسل تقرير الحادث.', openPostmortem: 'افتح تقرير الحادث', writePostmortem: 'اكتب تقرير الحادث',
  escalate: 'تصعيد', escalateSuggested: 'هالـ P1 مفتوحة من {n} دقيقة أو أكثر. إذا ما انحصرت، صعّدها لقائد الدعم الحين.', escalateToLead: 'صعّد لقائد الدعم', escalateReason: 'وش صاير ووش تحتاج',
  asset: 'الأصل', assetView: 'صفحة الأصل', lastHeartbeat: 'آخر نبضة', uptime: 'مدة التشغيل', lastPatch: 'آخر تحديث', lastBackupTest: 'آخر اختبار نسخ احتياطي', grafanaMetrics: 'مقاييس Grafana', lokiLogs: 'سجلات Loki', recentAlerts: 'آخر التنبيهات', noAlerts: 'ما فيه تنبيهات.',
  suggestedRunbooks: 'أدلة تشغيل مقترحة', allRunbooks: 'كل الأدلة', noSuggestions: 'ما فيه دليل يناسب هالتذكرة للحين.',
  kind_PLATFORM_SERVER: 'خادم Progrid', kind_EXTERNAL_SERVER: 'خادم خارجي', kind_SITE: 'موقع',

  alertsLead: 'التنبيهات الحيّة على عقودك، تتحدث كل 15 ثانية.', alertFilter_open: 'مفتوحة', alertFilter_FIRING: 'نشطة', alertFilter_all: 'الكل', live: 'مباشر',
  firingFor: 'نشط من', ackAndTake: 'استلم وخذها', alertAcked: 'استلمت التنبيه، وتذكرته صارت لك.', viewAsset: 'الأصل', ackedAt: 'انستلم',

  health: 'الحالة الصحية', monitoringOff: 'المراقبة طافية', agentStatus: 'حالة برنامج المراقبة', hostname: 'اسم الجهاز', managementAddress: 'عنوان الإدارة', noGrafana: 'روابط المقاييس والسجلات تطلع هنا لما يتجهز Grafana.',
  maintenanceHistory: 'سجل الصيانة', backups: 'النسخ الاحتياطي', backupsOn: 'النسخ الاحتياطي شغّال.', backupsOff: 'النسخ الاحتياطي طافي.', backupTests: 'اختبارات النسخ الاحتياطي', responsibilityMatrix: 'مصفوفة المسؤوليات', area: 'المجال', owner: 'المسؤول', noRuns: 'ما فيه تشغيلات للحين.',
  trigger_schedule: 'مجدول', trigger_manual: 'تشغيل الحين', trigger_retry: 'إعادة',

  accessLead: 'صلاحياتك وجلسات الطرفية. الصلاحية لكل تذكرة، بوقت محدد، وتنسجل.', myGrants: 'صلاحياتي', noGrants: 'ما فيه صلاحيات.', mySessions: 'جلسات الطرفية', noSessions: 'ما فيه جلسات للحين.', sessionsRecordedNote: 'كل جلسة تنسجل وتنحفظ 12 شهر.',
  grantFilter_live: 'المطلوبة والفعّالة', grantFilter_REQUESTED: 'مطلوبة', grantFilter_ACTIVE: 'فعّالة', grantFilter_EXPIRED: 'منتهية', grantFilter_REVOKED: 'مسحوبة', grantFilter_DENIED: 'مرفوضة', grantFilter_all: 'الكل',
  autoApproved: 'موافقة تلقائية', emergency: 'طوارئ', maintenanceRun: 'تشغيل صيانة', expiresIn: 'تنتهي بعد', waitingForLead: 'بانتظار قائد الدعم', requested: 'انطلبت', extendedOnce: 'انمددت مرة', denied: 'انرفضت', revoked: 'انسحبت',
  openTerminal: 'افتح الطرفية', extendOnce: 'مدّد (مرة وحدة)', extend: 'مدّد', extensionReason: 'ليش تحتاج وقت زيادة', extensionNote: 'الصلاحية تتمدد مرة وحدة بس، من وقت نهايتها الحالي.', grantExtended: 'انمددت الصلاحية.',
  started: 'بدأ', endReason: 'سبب النهاية',

  accessEndsIn: 'الصلاحية تنتهي بعد', sessionRecorded: 'هالجلسة تنسجل', term_opening: 'جاري الفتح', term_connecting: 'جاري الاتصال', term_ready: 'متصل', term_closed: 'مقفلة', term_error: 'فشلت',
  pasteBlocked: 'اللصق مقفل في هالجلسة.',
  termReason_auth_timeout: 'البوابة ما وصلها الدخول في وقته. افتح جلسة جديدة.',
  termReason_auth_required: 'البوابة تحتاج رمز الجلسة. افتح جلسة جديدة من الصلاحية.',
  termReason_bad_frame: 'البوابة ما قدرت تقرأ رسالة من هالصفحة. افتح جلسة جديدة.',
  termReason_token_invalid: 'رمز الجلسة ما انقبل. افتح جلسة جديدة من الصلاحية.',
  termReason_token_used: 'رمز الجلسة هذا انستخدم قبل. افتح جلسة جديدة من الصلاحية.',
  termReason_token_expired: 'رمز الجلسة انتهى قبل ما يتصل. افتح جلسة جديدة.',
  termReason_grant_expired: 'انتهت صلاحيتك فانتهت الجلسة. مدّد الصلاحية أو اطلب وحدة جديدة عشان تكمل.',
  termReason_grant_inactive: 'الصلاحية ما عادت فعّالة: انسحبت أو انتهت.',
  termReason_session_killed: 'قائد الدعم أنهى هالجلسة.',
  termReason_residency_blocked: 'هالعقد ما يسمح بالوصول من دولتك.',
  termReason_engineer_inactive: 'حساب المهندس حقك مو فعّال.',
  termReason_forbidden: 'ما عدت مكلّف على هالعقد.',
  termReason_asset_unavailable: 'ما نقدر نوصل للخادم الحين.',
  termReason_killed: 'انتهت الجلسة: الصلاحية انسحبت أو قائد الدعم وقّفها.',
  termReason_ssh_closed: 'الخادم قفل الاتصال (طلعت منه، أو أعاد التشغيل).',
  termReason_client_closed: 'أنت قفلت الجلسة.',
  termReason_error: 'صار خطأ في البوابة وقفلت الجلسة.',
  termReason_api_unavailable: 'البوابة ما قدرت توصل لـ API حق Progrid. جرّب بعد دقيقة.',
  termReason_connection_lost: 'انقطع الاتصال بالبوابة. افتح جلسة جديدة من الصلاحية إذا لسا تحتاجها.',
  termReason_connect_failed: 'ما قدرنا نتصل ببوابة الطرفية. تأكد من الـ VPN وافتح جلسة جديدة.',
  sessionClosed: 'الجلسة مقفلة.', sessionClosedReason: 'الجلسة مقفلة: {reason}', backToTicket: 'ارجع للتذكرة', backToAccess: 'ارجع للصلاحيات', noGrantChosen: 'افتح الطرفية من صلاحية فعّالة.',
  terminalFooter: 'الكتابة والمخرجات تنسجل. اللصق مسموح، وتنزيل الملفات مو متاح.',

  maintenanceLead: 'مهام أصولك. التشغيل يصير على المنصة، مو من جهازك أبد.', tasks: 'المهام', task: 'المهمة', kind: 'النوع', schedule: 'الجدول', nextRun: 'التشغيل الجاي', lastRun: 'آخر تشغيل', allAssets: 'كل الأصول', paused: 'موقوفة', runNow: 'شغّل الحين', noTasks: 'ما فيه مهام.',
  runsOnPlatform: 'التشغيل الفاشل يفتح تذكرة P3 باسم اللي شغّله.', runStarted: 'بدأ التشغيل.', runHistory: 'السجل', trigger: 'المشغّل', finished: 'انتهى', output: 'المخرجات', retry: 'أعد المحاولة',
  liveOutput: 'المخرجات', waitingForOutput: 'بانتظار المخرجات…', streamFailed: 'وقفت المخرجات المباشرة. حدّث الصفحة عشان تتابعها.',
  mkind_PATCHING: 'تحديثات', mkind_BACKUP_TEST: 'اختبار نسخ احتياطي', mkind_CUSTOM: 'مخصص',

  timesheetLead: 'وقتك باليوم. أرسل الشهر لما يكتمل.', month: 'الشهر', manualEntry: 'إدخال يدوي', submitMonth: 'أرسل الشهر ({n} مسودات)', totalTime: 'المجموع',
  noEntries: 'ما فيه وقت هالشهر.', manual: 'يدوي', flagged: 'للمراجعة', notBillable: 'غير مفوتر', terminalMinutes: 'دقايق الطرفية', reviewComment: 'تعليق المراجعة',
  deleteEntryConfirm: 'تحذف هالإدخال؟', entryDeleted: 'انحذف الإدخال.', entryAdded: 'انضاف الإدخال وانعلّم للمراجعة.',
  manualNote: 'استخدم المؤقت قد ما تقدر. الإدخال اليدوي يحتاج سبب، وقائد الدعم يراجع كل واحد.', chooseTicket: 'اختر تذكرة', startedAtYourTime: 'البداية (بتوقيتك)', minutes: 'الدقايق', billable: 'مفوتر',
  reasonRequired: 'السبب (مطلوب)', manualReasonPlaceholder: 'ليش ما استخدمت المؤقت', noteOptional: 'ملاحظة (اختياري)', addEntry: 'أضف الإدخال',

  runbooksLead: 'أدلة التشغيل المشتركة. حسّنها كل ما تعلمت شي جديد.', newRunbook: 'دليل جديد', searchRunbooks: 'دوّر في الأدلة', noRunbooks: 'ما لقينا أدلة.', updated: 'آخر تحديث',
  editRunbook: 'تعديل الدليل', runbookSaved: 'انحفظ الدليل.', runbookDeleted: 'انحذف الدليل.', deleteRunbookConfirm: 'تحذف هالدليل للكل؟',
  title: 'العنوان', tags: 'الوسوم', tagsHint: 'مفصولة بفواصل، مثل os:ubuntu, nginx, asset:<id>', body: 'المحتوى', write: 'كتابة', preview: 'معاينة', markdownHint: 'Markdown: عناوين #، قوائم، `code` وكتل كود',
  postmortemsLead: 'كل P1 تحتاج تقرير حادث خلال 48 ساعة من حلّها.', allStatuses: 'كل الحالات', noPostmortems: 'ما فيه تقارير.', due: 'الموعد', overdue: 'متأخر',
  postmortemFor: 'تقرير الحادث للتذكرة #{n}', resolved: 'انحلّت', submitted: 'انرسل', leadComment: 'تعليق قائد الدعم',
  pm_timeline: 'التسلسل الزمني', pm_impact: 'الأثر', pm_rootCause: 'السبب الجذري', pm_fix: 'الحل', pm_prevention: 'المنع',
  pmHint_timeline: 'وش صار ومتى، بتوقيت العقد: التنبيه، الاستلام، أول رد، الإجراءات، الحل.', pmHint_impact: 'مين ووش تأثر، وكم استمر.', pmHint_rootCause: 'ليش صار، مو بس وش اللي خرب.', pmHint_fix: 'وش اللي رجّع الخدمة.', pmHint_prevention: 'إجراءات تمنع تكراره، مع المسؤول عن كل وحدة.',
  saveDraft: 'احفظ المسودة', submitPostmortem: 'أرسل التقرير', draftSaved: 'انحفظت المسودة.', postmortemSubmitted: 'انرسل التقرير وانقفلت التذكرة.', pmMissing: 'عبّ: {list}', pmSubmitNote: 'الإرسال يقفل التذكرة، وبعدها قائد الدعم يقفل التقرير.',

  handoverLead: 'سلّم للمهندس الجاي. إنهاء المناوبة يحتاج هالنموذج.', noRunningShift: 'ما عندك مناوبة شغّالة، فما فيه شي تنهيه.', shiftWindow: 'المناوبة',
  handoverTicketsNote: 'تذاكرك المفتوحة تنضاف دايمًا.', included: 'مضافة', noOpenTicketsOfYours: 'ما عندك تذاكر مفتوحة.', addOtherTickets: 'أضف تذاكر مفتوحة ثانية ({n})',
  risksHint: 'أي شي ممكن يسبب نداء للمهندس الجاي.', pendingHint: 'معبّأ باللي بيشتغل خلال 24 ساعة الجاية.', endShiftWithHandover: 'أرسل التسليم وأنهِ المناوبة', shiftEnded: 'انتهت المناوبة. يعطيك العافية على التسليم.',

  payoutsLead: 'كشوفاتك الشهرية. الدفع بتحويل بنكي.', noPayouts: 'ما فيه كشوفات للحين.', downloadPdf: 'نزّل PDF', total: 'المجموع', workedTime: 'وقت العمل', nightTime: 'ليلي', workAmount: 'العمل', rate: 'السعر', standby: 'الجاهزية',
  issued: 'انصدر', paid: 'انصرف', reference: 'المرجع', lines: 'البنود ({n})', customerCol: 'العميل', amount: 'المبلغ',

  securityLead: 'طرق التحقق الثانية للوحة العمليات.', passkeys: 'مفاتيح المرور والأمان', addPasskey: 'أضف مفتاح مرور', noPasskeys: 'ما فيه مفاتيح مرور للحين.', added: 'انضاف', lastUsed: 'آخر استخدام',
  removeKeyConfirm: 'تشيل هالمفتاح؟ ما تقدر تشيل عامل التحقق الوحيد عندك.', keyRemoved: 'انشال المفتاح.', passkeyAdded: 'انضاف مفتاح المرور.',
  authenticatorApp: 'تطبيق المصادقة', totpOn: 'مفعّل.', totpOff: 'مو مجهّز.', setUp: 'جهّز', turnOn: 'فعّل', totpEnabled: 'تفعّل تطبيق المصادقة.',
  sessionPolicy: 'الجلسة تستمر 12 ساعة وتنتهي لما تسكّر المتصفح.',

  st_ACTIVE: 'فعّالة', st_APPROVED: 'مقبولة', st_SUCCEEDED: 'نجح', st_HEALTHY: 'سليم', st_PAID: 'مدفوع', st_CLOSED: 'مقفل', st_closed: 'مقفلة', st_ISSUED: 'صادر',
  st_REQUESTED: 'مطلوبة', st_SUBMITTED: 'مرسل', st_QUEUED: 'بالانتظار', st_RUNNING: 'شغّال', st_DRAFT: 'مسودة', st_open: 'مفتوحة', st_answered: 'بانتظار العميل', st_resolved_pending_pm: 'بانتظار تقرير الحادث',
  st_DENIED: 'مرفوضة', st_REVOKED: 'مسحوبة', st_FAILED: 'فشل', st_REJECTED: 'مرفوض', st_UNHEALTHY: 'متعطل', st_EXPIRED: 'منتهية', st_DEGRADED: 'متراجع', st_UNKNOWN: 'غير معروف',
  st_FIRING: 'نشط', st_ACKNOWLEDGED: 'مستلم', st_RESOLVED: 'انحل', st_CRITICAL: 'حرج', st_WARNING: 'تحذير', st_INFO: 'معلومة',
  st_PROGRID: 'Progrid', st_CUSTOMER: 'العميل', st_SHARED: 'مشترك', st_PENDING: 'بالانتظار', st_ENDED: 'انتهت', st_KILLED: 'أنهاها الفريق',

  err_unauthorized: 'البريد أو كلمة المرور غلط، أو خطوة الدخول انتهى وقتها.',
  err_totp_invalid: 'الرمز غلط. تأكد من وقت جهازك وجرّب مرة ثانية.',
  err_challenge_invalid: 'خطوة الدخول انتهى وقتها. ابدأ من جديد.',
  err_webauthn_invalid: 'مفتاح المرور ما انقبل. جرّب مرة ثانية أو استخدم تطبيق المصادقة.',
  err_engineer_inactive: 'حساب المهندس حقك مو فعّال. كلّم قائد الدعم.',
  err_ip_not_allowed: 'لوحة العمليات مو مسموحة من هالشبكة. اتصل بالـ VPN وجرّب مرة ثانية.',
  err_not_engineer: 'لوحة العمليات للمهندسين بس.',
  err_root_cause_required: 'سجّل السبب الجذري قبل ما تقفل التذكرة.',
  err_timer_running: 'عندك مؤقت شغّال. وقّفه أول.',
  err_extension_used: 'هالصلاحية انمددت مرة قبل.',
  err_grant_exists: 'عندك صلاحية مطلوبة أو فعّالة لهالأصل وهالتذكرة.',
  err_residency_blocked: 'هالعقد ما يسمح بالوصول من دولتك.',
  err_checklist_incomplete: 'أكّد كل بنود قائمة البداية.',
  err_handover_not_read: 'اقرأ آخر تسليم أول.',
  err_postmortem_incomplete: 'عبّ كل الأقسام قبل الإرسال.',
  err_not_found: 'مو موجود، أو مو على عقودك.',
  err_forbidden: 'ما تقدر تسوي هالشي.',
};

const dict: Record<Locale, Record<Key, string>> = { en, ar };

/** Looks up a string (English when missing; the key itself when unknown) and fills `{placeholders}`. */
export function translate(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  let s: string = dict[locale][key] ?? dict.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

const LOCALE_KEY = 'prgd.ops.locale';

export function getLocale(): Locale {
  try {
    const l = localStorage.getItem(LOCALE_KEY);
    if (l === 'ar' || l === 'en') return l;
    return navigator.language.slice(0, 2) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function saveLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* private mode */
  }
}
