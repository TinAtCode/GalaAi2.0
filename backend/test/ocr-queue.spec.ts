import { OcrQueue } from '../src/ocr/ocr-queue';

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
});
