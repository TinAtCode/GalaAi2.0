import { Injectable } from '@nestjs/common';

// Begrenzt, wie viele Texterkennungen gleichzeitig laufen. OCR ist
// rechen- und speicherintensiv; ohne Grenze würden einige große Scans
// gleichzeitig den ganzen API-Prozess ausbremsen. Weitere Aufträge warten
// in der Reihenfolge ihres Eingangs. OCR_CONCURRENCY (Standard 2).
@Injectable()
export class OcrQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  get limit() {
    return Math.max(1, Number(process.env.OCR_CONCURRENCY) || 2);
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length };
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
