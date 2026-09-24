import { MemorySlotStore, OcrQueue } from '../src/ocr/ocr-queue';
import { registry } from '../src/metrics/metrics';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

describe('OcrQueue', () => {
  afterEach(() => delete process.env.OCR_CONCURRENCY);

  it('lässt höchstens OCR_CONCURRENCY Aufträge gleichzeitig laufen, der Rest wartet der Reihe nach', async () => {
    process.env.OCR_CONCURRENCY = '2';
    const queue = new OcrQueue();
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      queue.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    expect(queue.stats).toEqual({ running: 2, waiting: 1 });
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/^ocr_queue_running 2$/m);
    expect(metrics).toMatch(/^ocr_queue_waiting 1$/m);

    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(queue.stats).toEqual({ running: 0, waiting: 0 });
  });

  it('ein fehlgeschlagener Auftrag gibt seinen Platz frei', async () => {
    process.env.OCR_CONCURRENCY = '1';
    const queue = new OcrQueue();
    await expect(queue.run(() => Promise.reject(new Error('kaputt')))).rejects.toThrow('kaputt');
    await expect(queue.run(async () => 'weiter')).resolves.toBe('weiter');
  });

  it('das Limit gilt über mehrere Server zusammen (gemeinsame Plätze)', async () => {
    process.env.OCR_CONCURRENCY = '2';
    process.env.OCR_SLOT_POLL_MS = '10';
    const shared = new MemorySlotStore();
    const a = new OcrQueue(shared);
    const b = new OcrQueue(shared);
    const gates = [deferred(), deferred(), deferred()];
    const started: string[] = [];
    const runs = [
      a.run(async () => {
        started.push('a1');
        await gates[0].promise;
      }),
      b.run(async () => {
        started.push('b1');
        await gates[1].promise;
      }),
      b.run(async () => {
        started.push('b2');
        await gates[2].promise;
      }),
    ];
    await new Promise((r) => setTimeout(r, 50));
    // zwei Plätze insgesamt: der dritte Auftrag wartet, obwohl Server b nur einen hat
    expect(started).toEqual(['a1', 'b1']);
    expect(b.stats).toEqual({ running: 1, waiting: 1 });
    gates[0].resolve();
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toEqual(['a1', 'b1', 'b2']);
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    delete process.env.OCR_SLOT_POLL_MS;
  });
});
