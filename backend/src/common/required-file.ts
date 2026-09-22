import { BadRequestException, ParseFilePipe } from '@nestjs/common';

// Für @UploadedFile(): ohne Datei im Feld "file" eine klare 400-Antwort statt
// eines Serverfehlers beim ersten Zugriff auf file.buffer.
export const requiredFile = () =>
  new ParseFilePipe({
    exceptionFactory: () => new BadRequestException('Keine Datei hochgeladen (Formularfeld "file").'),
  });
