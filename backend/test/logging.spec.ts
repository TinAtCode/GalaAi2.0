import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { JsonLogger } from '../src/logging/json-logger';
import { ExceptionLoggerFilter } from '../src/logging/exception-logger.filter';

describe('Logging', () => {
  it('JsonLogger schreibt eine JSON-Zeile mit Zeit, Level, Kontext und Feldern', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let lines: Record<string, unknown>[];
    try {
      new JsonLogger().log({ msg: 'GET /x 200', status: 200 }, 'HTTP');
      new JsonLogger().log('Start', 'Bootstrap');
      lines = write.mock.calls.map((c) => JSON.parse(String(c[0])));
    } finally {
      write.mockRestore();
    }
    const [first, second] = lines;
    expect(first).toMatchObject({ level: 'log', context: 'HTTP', msg: 'GET /x 200', status: 200 });
    expect(new Date(String(first.time)).toString()).not.toBe('Invalid Date');
    expect(second).toMatchObject({ context: 'Bootstrap', msg: 'Start' });
  });

  describe('ExceptionLoggerFilter', () => {
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ getHeader: () => 'req-1' }) }),
    } as unknown as ArgumentsHost;
    let filter: ExceptionLoggerFilter;
    let error: jest.SpyInstance;

    beforeEach(() => {
      filter = new ExceptionLoggerFilter();
      jest
        .spyOn(Object.getPrototypeOf(ExceptionLoggerFilter.prototype), 'catch')
        .mockImplementation(() => undefined);
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('protokolliert unerwartete Fehler mit Stacktrace und Request-ID', () => {
      filter.catch(new Error('DB weg'), host);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'DB weg', requestId: 'req-1' }),
        expect.stringContaining('Error: DB weg'),
      );
    });

    it('erwartete Fehler (4xx) nicht', () => {
      filter.catch(new BadRequestException('falsch'), host);
      expect(error).not.toHaveBeenCalled();
    });
  });
});
