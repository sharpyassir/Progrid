/** Progrid Connect strings in the three launch languages. English is the source of truth. */
import type { Locale } from './i18n';

const en = {
  // product
  product: 'Progrid Connect', tagline: 'Connect. Automate. Deploy.',
  positioning: 'Build and deploy AI agents that connect to your infrastructure, APIs and applications.',
  // common
  createAgent: 'Create agent', save: 'Save', saving: 'Saving…', saved: 'Saved.', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', add: 'Add', remove: 'Remove',
  copy: 'Copy', copied: 'Copied', close: 'Close', test: 'Test', name: 'Name', description: 'Description', status: 'Status', created: 'Created', updated: 'Updated',
  lastRun: 'Last run', never: 'Never', optional: 'optional', required: 'Required', enabled: 'Enabled', disabled: 'Disabled', actions: 'Actions', viewAll: 'View all',
  loading: 'Loading…', open: 'Open', none: 'None', all: 'All', yes: 'Yes', no: 'No', back: 'Back', next: 'Next', key: 'Key', value: 'Value', addRow: 'Add row',
  unsaved: 'Unsaved changes', agent: 'Agent', model: 'Model', tools: 'Tools', version: 'Version', versionN: (n: number) => `v${n}`,
  toolsN: (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`, nodesN: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
  // errors
  err401: 'Your session has ended. Sign in again to continue.', signIn: 'Sign in',
  err403: 'You do not have permission for this. Ask a team owner or admin.',
  err402: 'Your spend limit is reached or a payment is due. Runs stay paused until billing is sorted.', goBilling: 'Open billing',
  err429: 'Too many requests. Wait a moment and try again.', errGeneric: 'Something went wrong. Try again.', errBadJson: 'This is not valid JSON.', errNotFound: 'This item was not found.',
  // statuses
  st_draft: 'Draft', st_deployed: 'Deployed', st_paused: 'Paused', st_queued: 'Queued', st_running: 'Running', st_succeeded: 'Succeeded', st_failed: 'Failed',
  st_waiting_approval: 'Waiting for approval', st_cancelled: 'Cancelled', st_ok: 'Working', st_error: 'Error', st_untested: 'Not tested', st_skipped: 'Skipped',
  src_api: 'API', src_webhook: 'Webhook', src_test: 'Test', src_schedule: 'Schedule', src_manual: 'Manual',
  // sub navigation
  nOverview: 'Overview', nAgents: 'Agents', nWorkflows: 'Workflows', nConnections: 'Connections', nWebhooks: 'Webhooks', nLogs: 'Logs', nUsage: 'Usage',
  nKeys: 'API keys', nTemplates: 'Templates', nDocs: 'Documentation', connectSections: 'Connect sections',
  // overview
  myAgents: 'My agents', agentsDeployed: (n: number) => `${n} deployed`, runs24h: 'Runs, last 24 hours', failed24h: (n: number) => `${n} failed`,
  cardTemplatesD: 'Ready agents for support, sales, data and more.', cardConnectionsD: 'APIs and databases your agents can use.',
  cardKeysD: 'Keys that call your deployed agents.', cardWebhooksD: 'URLs that start a run when called.', cardLogsD: 'Every run with its steps, tools and errors.',
  cardUsageD: 'Executions, AI usage and cost this period.', cardDocsD: 'Guides and the full API reference.', templatesCount: (n: number) => `${n} templates`,
  recentActivity: 'Recent activity', noRuns: 'No runs yet.', getStarted: 'Get started', emptyTitle: 'Build your first agent', emptyBody: 'Four steps from an idea to a live API.',
  step1: 'Create an agent', step1d: 'Name it and say what it should do, or describe it and let AI draft it.',
  step2: 'Connect tools', step2d: 'Add the APIs, databases and Progrid services it may use.',
  step3: 'Test', step3d: 'Send a message or a JSON event and watch every step.',
  step4: 'Deploy', step4d: 'Get an API endpoint, keys and webhook URLs.', stepDone: 'Done', stepN: (n: number) => `Step ${n}`,
  // agents
  agentsTitle: 'Agents', noAgents: 'No agents yet.', agentsNote: 'Each agent has its own instructions, tools, workflow, versions and API endpoint.',
  // new agent
  newAgentTitle: 'Create an agent', pathBlank: 'Start blank', pathBlankD: 'Write the instructions yourself.',
  pathAi: 'Build with AI', pathAiD: 'Describe the agent. You get a draft of instructions, tools and a workflow to review.',
  pathTemplate: 'From template', pathTemplateD: 'Start from a ready agent and adjust it.',
  agentName: 'Agent name', agentNamePh: 'Lead qualifier', descriptionPh: 'Scores new leads and alerts sales.',
  instructions: 'Instructions', instructionsHint: 'Say what the agent should do, which tools to use and what to return. Short, plain sentences work best.',
  examples: 'Examples', useExample: 'Use this example',
  ex1Title: 'Qualify leads', ex1: 'You qualify new leads for our sales team.\nLook up the company with lookup_company.\nScore the lead from 0 to 100 based on size, budget and urgency.\nReturn JSON with score and a one line reason.',
  ex2Title: 'Answer order questions', ex2: 'You answer questions about orders.\nFind the order with get_order using the order number.\nIf the order is late, say when it will arrive.\nReply in the language of the customer.',
  ex3Title: 'Watch servers', ex3: 'Check the metrics of every server.\nIf CPU stays above 90 percent, notify the on call team with the server name and the last values.\nOtherwise return "all good".',
  aiPrompt: 'What should the agent do?', aiPromptPh: 'When someone fills the form on our website, look up the company in our CRM, score the lead from 0 to 100 and email sales if the score is 80 or more.',
  aiPromptHint: 'Mention the systems it should use and what should happen at the end.', generate: 'Generate draft', generating: 'Drafting your agent…',
  draftTitle: 'Review the draft', draftNote: 'Nothing is saved yet. Change anything you like, then create the agent.',
  variables: 'Variables', connectionsNeeded: 'Connections needed', connectionsNeededNote: 'Add these under Connections, then pick them on each tool.', usedBy: 'Used by',
  workflow: 'Workflow', startOver: 'Start over', creating: 'Creating…', addConnection: 'Add connection',
  // templates
  templatesTitle: 'Templates', templatesNote: 'Each template creates an agent you can edit before you deploy it.', useTemplate: 'Use template',
  tpl_customer_support: 'Customer Support', tplD_customer_support: 'Answer customer questions from your help center and open tickets when needed.',
  tpl_sales: 'Sales', tplD_sales: 'Qualify inbound leads, score them and notify your sales team.',
  tpl_data_analyst: 'Data Analyst', tplD_data_analyst: 'Answer questions about your data with read only SQL.',
  tpl_monitoring: 'Monitoring', tplD_monitoring: 'Watch your servers and apps and alert you when something looks wrong.',
  tpl_research: 'Research', tplD_research: 'Collect information from APIs you trust and write a short brief.',
  tpl_developer: 'Developer', tplD_developer: 'Read app logs and deployments and explain failures to your team.',
  tpl_invoice: 'Invoice', tplD_invoice: 'Extract fields from invoices and post them to your accounting API.',
  // agent detail
  tOverview: 'Overview', tInstructions: 'Instructions', tTools: 'Tools', tWorkflow: 'Workflow', tTest: 'Test', tDeploy: 'Deploy', tApi: 'API', tLogs: 'Logs', tUsage: 'Usage', tVersions: 'Versions',
  agentTabs: 'Agent sections', agentId: 'Agent ID', endpoint: 'API endpoint', latestVersion: 'Latest version', deployedVersion: 'Deployed version', notDeployed: 'Not deployed',
  last24h: 'Last 24 hours', runs: 'Runs', avgDuration: 'Average duration', successRate: 'Success rate', nextSteps: 'Next steps',
  deleteAgent: 'Delete agent', deleteAgentConfirm: 'Delete this agent? Its endpoint, keys and webhooks stop working.',
  // instructions tab
  effort: 'Effort', effort_low: 'Low', effort_medium: 'Medium', effort_high: 'High', effortHint: 'Higher effort thinks longer and costs more per run.',
  limits: 'Limits', maxSteps: 'Max steps per run', maxTokens: 'Max tokens per run', timeout: 'Timeout in seconds',
  secret: 'Secret', addVariable: 'Add variable', setValue: 'Set value', replaceValue: 'Replace value', valueSet: 'Value set', noValue: 'No value yet',
  secretWriteOnly: 'Secret values are write-only. You can replace them but never read them back.', newValue: 'New value',
  varHint: 'Use variables in instructions and templates as {{vars.KEY}}.', varKeyHint: 'Uppercase letters, digits and underscores.', valueSaved: 'Value saved.',
  // tools
  addTool: 'Add tool', noTools: 'No tools yet. Tools let the agent call your APIs, query data and send messages.', editTool: 'Edit tool', newTool: 'New tool', chooseKind: 'What should this tool do?',
  kind_http_request: 'REST API', kind_database_query: 'Database query', kind_send_email: 'Email', kind_notify: 'Notification', kind_webhook_out: 'Webhook', kind_progrid: 'Progrid services',
  kindD_http_request: 'Call an endpoint of your API.', kindD_database_query: 'Read from PostgreSQL, MySQL or MongoDB.', kindD_send_email: 'Send an email.',
  kindD_notify: 'Alert a person or a channel.', kindD_webhook_out: 'Post JSON to an outbound webhook.', kindD_progrid: 'Read and manage your Progrid resources.',
  toolName: 'Tool name', toolNameHint: 'Lowercase with underscores, like lookup_company. The model sees this name.', toolNameBad: 'Use lowercase letters, digits and underscores, starting with a letter.',
  toolDescHint: 'Tell the model when to use this tool.', connection: 'Connection', orBaseUrl: 'Or call any URL', baseUrl: 'Base URL', baseUrlHint: 'Used when no connection is picked. The host must be in the allowed hosts.',
  auth: 'Authentication', auth_none: 'None', auth_bearer: 'Bearer token', auth_basic: 'Basic', auth_header: 'Header', auth_query: 'Query parameter', authFromConnection: 'Taken from the connection.',
  headers: 'Headers', endpointPath: 'Endpoint path', endpointPathHint: 'Relative to the base URL. Use {name} for values the model fills in.', method: 'Method',
  queryParams: 'Query parameters', bodyTemplate: 'Body', bodyHint: 'JSON. Use {{input.field}} for values from the model.',
  inputSchema: 'Input schema', inputSchemaHint: 'JSON Schema for the arguments the model sends.',
  dbMode: 'Query type', mode_sql: 'SQL', mode_mongo_find: 'Mongo find', mode_mongo_aggregate: 'Mongo aggregate', maxRows: 'Max rows',
  readOnlyNotice: 'Read only. Queries that change data are blocked.', writesAllowed: 'This connection allows writes. Review what the agent may run.', pickDbConnection: 'Pick a database connection.',
  emailTo: 'To', emailToHint: 'Leave empty to let the agent choose the address.', subjectTemplate: 'Subject', sendWith: 'Send with', via_platform: 'Progrid mail (rate limited)', via_smtp: 'Your SMTP connection',
  channel: 'Channel', channel_email: 'Email', channel_webhook: 'Webhook', channel_progrid_console: 'Progrid console', target: 'Target', targetHint: 'An email address or a URL.',
  webhookConnection: 'Outbound webhook connection', progridAction: 'Action',
  act_list_servers: 'List servers', act_server_metrics: 'Server metrics', act_server_power: 'Server power (start, stop, reboot)', act_list_databases: 'List databases',
  act_database_status: 'Database status', act_list_buckets: 'List buckets', act_list_apps: 'List apps', act_app_logs: 'App logs', act_create_ticket: 'Open a support ticket',
  destructiveNote: 'Actions that change resources always wait in the approvals queue.',
  requiresApproval: 'Requires approval', requiresApprovalHint: 'A person approves each call before it runs.',
  testInput: 'Test input (JSON)', runTest: 'Run test', testing: 'Testing…', output: 'Output', duration: 'Duration', error: 'Error', toolSaved: 'Tool saved.', deleteToolConfirm: 'Delete this tool?',
  advanced: 'Advanced',
  // workflow
  addNode: 'Add a step', node_trigger: 'Trigger', node_agent: 'AI Agent', node_tool: 'Tool', node_condition: 'Condition', node_action: 'Action', node_transform: 'Transform', node_end: 'End',
  nodeD_trigger: 'Where a run starts.', nodeD_agent: 'Let the model think and use tools.', nodeD_tool: 'Call one tool with fixed input.', nodeD_condition: 'Branch on true or false.',
  nodeD_action: 'Send an email, notify or call an API.', nodeD_transform: 'Reshape data with a template.', nodeD_end: 'Return the final output.',
  saveWorkflow: 'Save workflow', autoLayout: 'Tidy layout', check: 'Check', valid: 'The workflow is valid.',
  v_oneTrigger: 'Add exactly one Trigger.', v_needEnd: 'Add an End step.', v_cycle: 'Remove the loop. Steps run in one direction.',
  v_unreachable: (n: string) => `${n} is not reachable from the Trigger.`, v_conditionHandles: (n: string) => `${n} needs both a true and a false path.`,
  v_toolMissing: (n: string) => `Pick a tool for ${n}.`, v_noOutgoing: (n: string) => `${n} has no next step.`,
  noWorkflow: 'This agent has no workflow, so each run is a single agent step. Add a workflow to chain steps, branch on conditions and run actions.',
  createWorkflow: 'Create workflow', editNode: 'Edit step', selectNodeHint: 'Select a step to edit it. Drag from a dot to connect two steps.', deleteNode: 'Delete step',
  source: 'Source', trig_api: 'API call', trig_webhook: 'Webhook', trig_schedule: 'Schedule', trig_manual: 'Manual', cron: 'Schedule (cron)', webhook: 'Webhook',
  prompt: 'Prompt', promptHint: 'Use {{trigger.body}}, {{steps.<id>.output}} and {{vars.KEY}}.', outputSchema: 'Output schema (JSON Schema)', restrictTools: 'Tools this step may use',
  allTools: 'All agent tools', toolInput: 'Input (JSON template)', expression: 'Expression', expressionHint: 'Example: {{steps.qualify.output.score}} >= 80',
  actionKind: 'Action', settingsJson: 'Settings (JSON)', templateJson: 'Template (JSON)', outputTemplate: 'Output', stepId: 'Step ID', canvas: 'Workflow canvas',
  workflowSaved: 'Workflow saved.', trueLabel: 'true', falseLabel: 'false', deleteWorkflowEdgeHint: 'Select a line and press Delete to remove it.',
  act_send_email: 'Send email', act_notify: 'Notify', act_http_request: 'HTTP request', act_progrid: 'Progrid action',
  // test
  testMessage: 'Message', testJson: 'JSON event', testMessagePh: 'Hi, we are a team of 200 and we are looking for a new CRM. Can someone call me?',
  runTestBtn: 'Run test', runningTest: 'Running…', testDraftNote: 'Tests run your current draft, not the deployed version.', timeline: 'Timeline',
  response: 'Response', toolsUsed: 'Tools used', apiCalls: 'API calls', steps: 'Steps', executionTime: 'Execution time', tokens: 'Tokens',
  tokensInOut: (i: string, o: string) => `${i} in, ${o} out`, costEstimate: 'Cost estimate', rawJson: 'Raw JSON', showRaw: 'Show raw JSON', hideRaw: 'Hide raw JSON',
  stepType_node: 'Step', stepType_model: 'Model', stepType_tool: 'Tool', stepType_condition: 'Condition', stepType_approval: 'Approval', stepInput: 'Input', stepOutput: 'Output',
  cancelRun: 'Cancel run', noTestYet: 'Send a message or an event to see each step here.', streamLost: 'Live updates stopped. Showing the last known state.',
  waitingApprovalNote: 'A tool call is waiting for approval.', openApprovals: 'Open approvals', live: 'Live',
  // deploy
  saveVersion: 'Save version', versionNote: 'Version note', versionNotePh: 'What changed?', versionSaved: (n: number) => `Version ${n} saved.`,
  deploy: 'Deploy', deployVersion: (n: number) => `Deploy version ${n}`, deployLatest: 'Deploy latest', pause: 'Pause', resume: 'Resume',
  deployedNote: (n: number) => `Live. Calls to the endpoint run version ${n}.`, pausedNote: 'Paused. Calls to the endpoint get a 409 until you deploy again.',
  draftDeployNote: 'Not deployed yet. Save a version and deploy it to get a live endpoint.', deployedOk: 'Agent deployed.', pausedOk: 'Agent paused.',
  apiKeys: 'API keys', createKey: 'Create key', keyName: 'Key name', keyNamePh: 'Website backend', keyShownOnce: 'Copy this key now. You will not see it again.',
  revoke: 'Revoke', revokeConfirm: 'Revoke this key? Apps that use it stop working right away.', noKeys: 'No keys yet.', prefix: 'Prefix', lastUsed: 'Last used',
  webhookUrls: 'Webhook URLs', addWebhook: 'Add webhook', webhookPath: 'Path', rotate: 'Rotate URL', rotateConfirm: 'Rotate this URL? The old URL stops working right away.',
  signing: 'Signature', signingNote: (h: string, a: string) => `Optional. Verify the ${h} header (${a}).`, noWebhooks: 'No webhooks yet.', readDocs: 'Read the docs',
  seeApiTab: 'See the API tab', urlIsSecret: 'Treat this URL like a password.',
  // api
  requestSchema: 'Request schema', responseSchema: 'Response schema', authNote: 'Send an agent key as a bearer token in the Authorization header.',
  exampleRequest: 'Example request', syncNote: 'Runs wait up to 60 seconds. Send "async": true to get a run ID at once and poll the status URL.',
  errorsTitle: 'Errors', e401: 'Bad or missing key', e402: 'Spend limit reached or payment required', e404: 'Unknown agent', e409: 'Agent is not deployed', e429: 'Too many requests',
  // logs
  allStatuses: 'All statuses', allSources: 'All sources', allAgents: 'All agents', from: 'From', to: 'To', loadMore: 'Load more', runDetail: 'Run details', runId: 'Run ID',
  started: 'Started', noRunsMatch: 'No runs match these filters.', logsNote: 'Every run across your agents. Select a run to see its steps.', input: 'Input', filters: 'Filters',
  // usage
  period: 'Period', executions: 'Executions', workflowExecutions: 'Workflow executions', aiInput: 'AI input tokens', aiOutput: 'AI output tokens', aiCache: 'Cached tokens read',
  toolCalls: 'Tool calls', compute: 'Compute', storage: 'Storage', estimatedCost: 'Estimated cost', pricingNotSet: 'Pricing not set yet',
  pricingNotSetNote: 'Usage is recorded from the first run. Costs show here once prices are published.', billingPeriod: 'Billing period', byAgent: 'By agent', perDay: 'Executions per day',
  seconds: (n: string) => `${n} s`, seeBilling: 'See billing', usageNote: 'Usage for this billing period, updated every hour.', aiUsage: 'AI usage',
  // connections
  newConnection: 'New connection', editConnection: 'Edit connection', noConnections: 'No connections yet. Add the APIs and databases your agents may use.',
  connectionsNote: 'Credentials are encrypted and write-only. Agents use them through tools; nobody can read them back.',
  conn_rest_api: 'REST API', conn_postgres: 'PostgreSQL', conn_mysql: 'MySQL', conn_mongodb: 'MongoDB', conn_smtp: 'SMTP', conn_webhook_out: 'Outbound webhook', conn_custom: 'Custom',
  kindLabel: 'Type', host: 'Host', port: 'Port', database: 'Database', user: 'User', useTls: 'Use TLS', password: 'Password', token: 'Token', username: 'Username',
  headerName: 'Header name', queryName: 'Query parameter name', headerValue: 'Header value', queryValue: 'Parameter value', uri: 'Connection URI without the password',
  fromAddress: 'From address', url: 'URL', signingSecret: 'Signing secret', defaultHeaders: 'Default headers', configJson: 'Settings (JSON)', secretValues: 'Secret values',
  secretKept: (hint: string) => `Saved as ${hint}. Leave empty to keep it.`, secretWriteOnlyNote: 'After saving you only see the last characters.',
  access: 'Access', readOnly: 'Read only', readOnlyHint: 'Block queries that write or change data.', allowedTables: 'Allowed tables', allowedCollections: 'Allowed collections',
  allowedHosts: 'Allowed hosts', commaSep: 'Separate with commas. Leave empty to allow all.', testConnection: 'Test connection', testOk: 'Connection works.', testFailed: 'Connection failed.',
  lastTested: 'Last tested', deleteConnConfirm: 'Delete this connection? Tools that use it stop working.', connectionSaved: 'Connection saved.',
  // webhooks, keys, workflows pages
  webhooksTitle: 'Webhooks', webhooksNote: 'Each URL starts a run of its agent. Treat the URLs like passwords.', enable: 'Enable', disable: 'Disable', lastCalled: 'Last called',
  keysTitle: 'API keys', keysNote: 'Agent keys call the run API of one agent. Team API tokens for the whole cloud are under Account.', teamTokens: 'Team API tokens',
  workflowsTitle: 'Workflows', workflowsNote: 'Agents that run a workflow of steps, conditions and actions.', openEditor: 'Open editor', withoutWorkflow: 'Agents without a workflow', addWorkflow: 'Add workflow',
  noWorkflows: 'No workflows yet.', createAgentFirst: 'Create an agent first.',
  // versions
  noVersions: 'No versions yet. Save one from the Deploy tab.', note: 'Note', createdBy: 'By', liveBadge: 'Live', deployThis: 'Deploy this version',
  agentUsageNote: 'This agent in the current billing period.',
};

export type ConnectDict = { [K in keyof typeof en]: (typeof en)[K] };
export type CKey = keyof ConnectDict;
export type CStringKey = { [K in CKey]: ConnectDict[K] extends string ? K : never }[CKey];

const tr: ConnectDict = en;
const ar: ConnectDict = en;

const dict: Record<Locale, ConnectDict> = { en, tr, ar };

export function ct(locale: Locale, key: CStringKey): string {
  return (dict[locale][key] as string) ?? (dict.en[key] as string);
}
export function ctf<K extends CKey>(locale: Locale, key: K): ConnectDict[K] {
  return dict[locale][key] ?? dict.en[key];
}
/** Dynamic keys built from API values (status, kind, source); falls back to the raw value. */
export function cdyn(locale: Locale, prefix: string, value: string): string {
  const k = `${prefix}${value}`.replace(/-/g, '_') as CKey;
  const v = dict[locale][k] ?? dict.en[k];
  return typeof v === 'string' ? v : value;
}
