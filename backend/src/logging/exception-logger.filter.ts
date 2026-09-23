import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

// Unerwartete Fehler (500) mit Stacktrace ins Log; die Antwort an den
// Client bleibt wie bisher ohne Details. Erwartete Fehler (400, 404 …)
// stehen nur in der Anfragezeile.
@Catch()
export class ExceptionLoggerFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      const res = host.switchToHttp().getResponse<Response>();
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        { msg: error.message, name: error.name, requestId: res.getHeader?.('X-Request-Id') },
        error.stack,
      );
    }
    super.catch(exception, host);
  }
}
