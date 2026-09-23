import { BadRequestException, Injectable } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

// E-Mail-Versand über SMTP. Eingerichtet über SMTP_URL (z.B.
// "smtps://nutzer:passwort@mail.example.de:465") und MAIL_FROM (Absender,
// z.B. "Musterbetrieb <rechnung@musterbetrieb.de>"). Ohne SMTP_URL ist der
// Versand abgeschaltet. SMTP_URL=test legt die Mails nur im Speicher ab
// (für automatisierte Tests, siehe sentForTests).
export const sentForTests: Mail.Options[] = [];

@Injectable()
export class MailService {
  private transporter?: Transporter;

  // Vor aufwendiger Vorbereitung (PDF, XML) aufrufen, damit die Meldung das
  // eigentliche Problem nennt.
  assertConfigured() {
    if (!process.env.SMTP_URL || !process.env.MAIL_FROM) {
      throw new BadRequestException(
        'Der E-Mail-Versand ist nicht eingerichtet (SMTP_URL und MAIL_FROM in der Server-Konfiguration).',
      );
    }
  }

  private transport(): Transporter {
    this.assertConfigured();
    this.transporter ??=
      process.env.SMTP_URL === 'test'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport(process.env.SMTP_URL);
    return this.transporter;
  }

  async send(message: Mail.Options) {
    const transport = this.transport();
    const full = { ...message, from: process.env.MAIL_FROM };
    // Kopie vor dem Versand: der Test-Transport wandelt Anhänge in Base64 um.
    if (process.env.SMTP_URL === 'test') {
      sentForTests.push({ ...full, attachments: full.attachments?.map((a) => ({ ...a })) });
    }
    await transport.sendMail(full);
  }
}
