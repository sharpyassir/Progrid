/** One JSON line per log entry on stdout (errors on stderr). Never log tokens, keys or secret values. */
type Fields = Record<string, unknown>;

let silent = process.env.PRGD_GATEWAY_LOG === 'silent';

const write = (level: string, msg: string, fields?: Fields) => {
  if (silent) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
  setSilent: (v: boolean) => {
    silent = v;
  },
};
