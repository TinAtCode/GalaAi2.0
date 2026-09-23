import { ConsoleLogger, LogLevel } from '@nestjs/common';

// Logger für den Betrieb: eine JSON-Zeile pro Ereignis (time, level,
// context, msg und ggf. weitere Felder), damit Log-Sammler (Loki,
// CloudWatch, Datadog …) filtern und suchen können. Mit LOG_FORMAT=json
// aktiv, sonst bleibt die lesbare Nest-Ausgabe für die Entwicklung.
export class JsonLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
  ) {
    for (const message of messages) {
      const fields =
        message && typeof message === 'object' && !(message instanceof Error)
          ? (message as Record<string, unknown>)
          : { msg: message instanceof Error ? message.message : String(message) };
      const line = JSON.stringify({
        time: new Date().toISOString(),
        level: logLevel,
        ...(context ? { context } : {}),
        ...fields,
      });
      process[writeStreamType ?? (logLevel === 'error' || logLevel === 'fatal' ? 'stderr' : 'stdout')].write(
        `${line}\n`,
      );
    }
  }

  protected printStackTrace(stack: string) {
    if (stack)
      process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', stack })}\n`);
  }
}

export function createLogger() {
  return process.env.LOG_FORMAT === 'json' ? new JsonLogger() : new ConsoleLogger();
}
