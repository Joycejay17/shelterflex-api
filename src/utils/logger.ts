type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
     debug: 0,
     info: 1,
     warn: 2,
     error: 3
}

function getConfigLevel(): LogLevel {
     const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
     if (raw in LEVELS) return raw as LogLevel;
     process.stderr.write(
          JSON.stringify({ level: 'warn', message: `Invalid LOG_LEVEL "${raw}", defaulting to "info"` }) + '\n',
     );
     return 'info';
}

const configLevel = getConfigLevel();

function shouldLog(level: LogLevel): boolean {
     return LEVELS[level] >= LEVELS[configLevel];
}

type LogFields = Record<string, unknown>;

function write(level: LogLevel, message: string, fields?: LogFields): void {
     if (!shouldLog(level)) return;

     const entry: Record<string, unknown> = {
          timestamp: new Date().toISOString(),
          level,
          message,
          ...fields,
     };

     // Never leak secrets
     const REDACTED_KEYS = new Set([
          'password', 'secret', 'token', 'authorization', 'apiKey', 'api_key',
          'privateKey', 'private_key', 'accessToken', 'access_token',
     ]);
     for (const key of REDACTED_KEYS) {
          if (key in entry) entry[key] = '[REDACTED]';
     }

     process.stdout.write(JSON.stringify(entry) + '\n');
}

export const logger = {
     debug: (message: string, fields?: LogFields) => write('debug', message, fields),
     info: (message: string, fields?: LogFields) => write('info', message, fields),
     warn: (message: string, fields?: LogFields) => write('warn', message, fields),
     error: (message: string, fields?: LogFields, err?: unknown) => {
          const errorFields: LogFields = {};
          if (err instanceof Error) {
               errorFields.errorMessage = err.message;

               if (process.env.LOG_STACK_TRACES === 'true') {
                    errorFields.stack = err.stack;
               }
          }
          write('error', message, { ...fields, ...errorFields });
     },
};
