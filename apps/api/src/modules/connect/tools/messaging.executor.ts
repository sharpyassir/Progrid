import * as nodemailer from 'nodemailer';
import { resolveSafeHost, NetBlockedError } from '../net/guard';
import { render } from '../runtime/template';
import { postWebhook } from './http.executor';
import { ToolError, type OpenConnection, type ToolContext, type ToolExecutor } from './types';

/**
 * send_email and notify. Platform mail goes through the platform mailer (MailService) and is
 * limited per team per hour (CONNECT_PLATFORM_EMAILS_PER_HOUR); every message names the
 * agent that sent it. SMTP mail goes through the team's own server (smtp connection), whose
 * host passes the private range guard and is connected to by the checked IP.
 */

export interface MessagingDeps {
  sendPlatformMail(mail: { to: string; subject: string; text: string }): Promise<void>;
  /** True when the team may send one more platform email this hour. */
  allowPlatformMail(teamId: string): Promise<boolean>;
  /** Adds an entry to the team's activity feed. */
  consoleNotify(teamId: string, payload: Record<string, unknown>): Promise<void>;
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function footer(ctx: ToolContext) {
  return `\n\n--\nSent by the agent "${ctx.agentName}" on Progrid Connect.`;
}

async function sendSmtp(c: OpenConnection, ctx: ToolContext, mail: { to: string; subject: string; text: string }) {
  const host = String(c.config.host ?? '');
  let ip: string;
  try {
    ip = (await resolveSafeHost(host, ctx.policy)).address;
  } catch (err) {
    if (err instanceof NetBlockedError) throw new ToolError(`Blocked: ${err.message}`, 'network_blocked');
    throw err;
  }
  const transport = nodemailer.createTransport({
    host: ip,
    port: Number(c.config.port ?? 587),
    secure: !!c.config.secure,
    auth: c.config.user ? { user: String(c.config.user), pass: c.secrets.password ?? '' } : undefined,
    tls: { servername: host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    const info = await transport.sendMail({ from: String(c.config.from ?? c.config.user ?? ''), to: mail.to, subject: mail.subject, text: mail.text });
    return { sent: true, via: 'smtp', messageId: info.messageId };
  } finally {
    transport.close();
  }
}

/** Verifies an SMTP connection (POST /connections/:id/test). */
export async function testSmtp(c: OpenConnection, policy: ToolContext['policy']) {
  const host = String(c.config.host ?? '');
  const ip = (await resolveSafeHost(host, policy)).address;
  const transport = nodemailer.createTransport({ host: ip, port: Number(c.config.port ?? 587), secure: !!c.config.secure, auth: c.config.user ? { user: String(c.config.user), pass: c.secrets.password ?? '' } : undefined, tls: { servername: host }, connectionTimeout: 10_000, greetingTimeout: 10_000 });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export function sendEmailExecutor(deps: MessagingDeps): ToolExecutor {
  return {
    kind: 'send_email',
    connectionKinds: ['smtp'],
    connectionRequired: false,
    configSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', maxLength: 320 },
        subjectTemplate: { type: 'string', maxLength: 300 },
        bodyTemplate: { type: 'string', maxLength: 20_000 },
        via: { enum: ['platform', 'smtp'] },
      },
    },
    defaultInputSchema(config) {
      const props: Record<string, unknown> = {
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain text body' },
      };
      const required = ['subject', 'body'];
      if (!config.to) {
        props.to = { type: 'string', description: 'Recipient email address' };
        required.unshift('to');
      }
      return { type: 'object', properties: props, required };
    },
    summarize(config, input) {
      const i = isObj(input) ? input : {};
      return `Send an email to ${String(config.to ?? i.to ?? '?')}: ${String(i.subject ?? config.subjectTemplate ?? '').slice(0, 120)}`;
    },
    async execute(input, config, ctx) {
      const i = isObj(input) ? input : {};
      const t = { input: i, vars: ctx.vars, secrets: ctx.secrets };
      // A fixed recipient in the config always wins: the model cannot redirect the mail.
      const to = String(config.to ? render(String(config.to), t, 'tool') : i.to ?? '').trim();
      if (!EMAIL.test(to)) throw new ToolError('a valid recipient address is required');
      const subject = String(config.subjectTemplate ? render(String(config.subjectTemplate), t, 'tool') : i.subject ?? '').slice(0, 300) || '(no subject)';
      const body = String(config.bodyTemplate ? render(String(config.bodyTemplate), t, 'tool') : i.body ?? '').slice(0, 50_000);
      if (config.via === 'smtp' || ctx.connection?.kind === 'smtp') {
        if (!ctx.connection) throw new ToolError('sending through SMTP needs an smtp connection');
        ctx.countApiCall();
        return sendSmtp(ctx.connection, ctx, { to, subject, text: body });
      }
      if (!(await deps.allowPlatformMail(ctx.teamId))) throw new ToolError('The hourly email limit for this team is reached. Try again later or use an SMTP connection.', 'rate_limited');
      await deps.sendPlatformMail({ to, subject, text: body + footer(ctx) });
      return { sent: true, via: 'platform', to };
    },
  };
}

export function notifyExecutor(deps: MessagingDeps): ToolExecutor {
  return {
    kind: 'notify',
    connectionKinds: ['webhook_out'],
    connectionRequired: false,
    configSchema: {
      type: 'object',
      properties: {
        channel: { enum: ['email', 'webhook', 'progrid_console'] },
        target: { type: 'string', maxLength: 2000 },
      },
      required: ['channel'],
    },
    defaultInputSchema() {
      return { type: 'object', properties: { title: { type: 'string', description: 'Short title' }, message: { type: 'string', description: 'What happened' } }, required: ['message'] };
    },
    summarize(config, input) {
      return `Notify via ${String(config.channel)}: ${String((isObj(input) ? input.message : '') ?? '').slice(0, 120)}`;
    },
    async execute(input, config, ctx) {
      const i = isObj(input) ? input : {};
      const title = String(i.title ?? `Agent ${ctx.agentName}`).slice(0, 200);
      const message = String(i.message ?? '').slice(0, 10_000);
      const target = String(render(String(config.target ?? ''), { input: i, vars: ctx.vars, secrets: ctx.secrets }, 'tool') ?? '');
      switch (config.channel) {
        case 'email': {
          if (!EMAIL.test(target)) throw new ToolError('notify by email needs a valid target address');
          if (!(await deps.allowPlatformMail(ctx.teamId))) throw new ToolError('The hourly email limit for this team is reached.', 'rate_limited');
          await deps.sendPlatformMail({ to: target, subject: title, text: message + footer(ctx) });
          return { notified: true, channel: 'email' };
        }
        case 'webhook': {
          const url = ctx.connection?.kind === 'webhook_out' ? String(ctx.connection.config.url ?? '') : target;
          if (!url) throw new ToolError('notify by webhook needs a target URL or a webhook_out connection');
          await postWebhook(url, { event: 'agent.notification', data: { title, message } }, ctx, ctx.connection?.secrets.signingSecret);
          return { notified: true, channel: 'webhook' };
        }
        case 'progrid_console':
          await deps.consoleNotify(ctx.teamId, { agentId: ctx.agentId, runId: ctx.runId, title, message });
          return { notified: true, channel: 'progrid_console' };
        default:
          throw new ToolError('channel must be email, webhook or progrid_console');
      }
    },
  };
}
