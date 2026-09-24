import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { openSecret, sealSecret } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { generateVapidKeys, PUSH_SENDER, PushSender, VapidKeys } from './push-sender';
import { SubscribeDto } from './push.dto';

export interface PushMessage {
  title: string;
  body: string;
  // Seite in der App, die beim Antippen aufgeht (z.B. /baustelle)
  url: string;
  // gleiche Kennung ersetzt eine ältere Nachricht auf dem Gerät
  tag?: string;
}

const VAPID_SECRET = 'vapid';
const MAX_DEVICES_PER_USER = 10;

// Push-Nachrichten an die Geräte der Nutzer. Senden läuft im Hintergrund:
// ein Fehler beim Push-Dienst bricht nie die eigentliche Aktion ab.
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private keys?: Promise<VapidKeys>;

  constructor(
    private prisma: PrismaService,
    @Inject(PUSH_SENDER) private sender: PushSender,
  ) {}

  // Schlüssel des Servers: beim ersten Bedarf erzeugt, verschlüsselt gespeichert
  vapidKeys(): Promise<VapidKeys> {
    this.keys ??= (async () => {
      const stored = await this.prisma.appSecret.findUnique({ where: { name: VAPID_SECRET } });
      if (stored) {
        try {
          return JSON.parse(openSecret(stored.value)) as VapidKeys;
        } catch {
          // SECRET_KEY bzw. JWT_SECRET geändert: neue Schlüssel; die alten
          // Geräteanmeldungen gelten damit nicht mehr (Geräte melden sich neu an)
          this.logger.warn('Push-Schlüssel nicht lesbar (SECRET_KEY geändert?) – erzeuge neue.');
          await this.prisma.$transaction([
            this.prisma.$executeRaw`DELETE FROM "PushSubscription"`,
            this.prisma.appSecret.delete({ where: { name: VAPID_SECRET } }),
          ]);
        }
      }
      const fresh = generateVapidKeys();
      try {
        await this.prisma.appSecret.create({
          data: { name: VAPID_SECRET, value: sealSecret(JSON.stringify(fresh)) },
        });
        return fresh;
      } catch (error) {
        // ein zweiter Server war schneller: dessen Schlüssel gelten
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const winner = await this.prisma.appSecret.findUniqueOrThrow({ where: { name: VAPID_SECRET } });
          return JSON.parse(openSecret(winner.value)) as VapidKeys;
        }
        throw error;
      }
    })().catch((error) => {
      this.keys = undefined;
      throw error;
    });
    return this.keys;
  }

  async publicKey() {
    return { publicKey: (await this.vapidKeys()).publicKey };
  }

  // Gerät anmelden. Dasselbe Gerät (endpoint) gehört danach diesem Nutzer –
  // meldet sich auf einem Handy jemand anderes an, bekommt der Vorige nichts mehr.
  async subscribe(user: { companyId: string; userId: string }, dto: SubscribeDto, userAgent?: string) {
    await this.prisma.$transaction(async (tx) => {
      // dasselbe Gerät war schon angemeldet (auch für jemand anderen): alten Eintrag ersetzen
      const previous = await tx.pushSubscription.findUnique({ where: { endpoint: dto.endpoint } });
      if (previous) await tx.pushSubscription.delete({ where: { id: previous.id } });
      await tx.pushSubscription.create({
        data: {
          companyId: user.companyId,
          userId: user.userId,
          endpoint: dto.endpoint,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: userAgent?.slice(0, 300),
        },
      });
      // nicht endlos sammeln: die ältesten Geräte fallen raus
      const devices = await tx.pushSubscription.findMany({
        where: { companyId: user.companyId, userId: user.userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const surplus = devices.slice(MAX_DEVICES_PER_USER).map((d) => d.id);
      if (surplus.length) {
        await tx.pushSubscription.deleteMany({ where: { companyId: user.companyId, id: { in: surplus } } });
      }
    });
    return { subscribed: true };
  }

  async unsubscribe(user: { companyId: string; userId: string }, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { companyId: user.companyId, userId: user.userId, endpoint },
    });
    return { subscribed: false };
  }

  async status(user: { companyId: string; userId: string }) {
    const devices = await this.prisma.pushSubscription.count({
      where: { companyId: user.companyId, userId: user.userId },
    });
    return { devices };
  }

  // An alle Geräte der Nutzer senden; wartet auf den Versand (für Tests und
  // den Testknopf) – Aufrufer aus Aktionen nutzen notifyLater.
  async notify(companyId: string, userIds: string[], message: PushMessage) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return { sent: 0 };
    const targets = await this.prisma.pushSubscription.findMany({
      where: { companyId, userId: { in: ids } },
    });
    if (!targets.length) return { sent: 0 };
    const keys = await this.vapidKeys();
    const vapid = { ...keys, subject: process.env.PUSH_CONTACT || 'mailto:push@gartenai.app' };
    const payload = JSON.stringify({ ...message, body: message.body.slice(0, 180) });
    let sent = 0;
    await Promise.all(
      targets.map(async (target) => {
        try {
          const { gone } = await this.sender.send(target, payload, vapid);
          if (gone) {
            await this.prisma.pushSubscription.deleteMany({ where: { companyId, id: target.id } });
            return;
          }
          sent++;
          await this.prisma.pushSubscription.updateMany({
            where: { companyId, id: target.id },
            data: { lastSentAt: new Date() },
          });
        } catch (error) {
          this.logger.warn(`Push an ein Gerät fehlgeschlagen: ${(error as Error).message}`);
        }
      }),
    );
    return { sent };
  }

  notifyLater(companyId: string, userIds: string[], message: PushMessage) {
    void this.notify(companyId, userIds, message).catch((error: Error) =>
      this.logger.warn(`Push fehlgeschlagen: ${error.message}`),
    );
  }
}
