import * as webPush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// Versand an den Push-Dienst des Browsers (Google, Mozilla, Apple). In Tests
// ersetzt eine Attrappe diese Klasse (Token PUSH_SENDER).
export interface PushSender {
  // gone: das Gerät hat die Nachrichten abbestellt (404/410) – Eintrag löschen
  send(
    target: PushTarget,
    payload: string,
    vapid: VapidKeys & { subject: string },
  ): Promise<{ gone: boolean }>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export class WebPushSender implements PushSender {
  async send(target: PushTarget, payload: string, vapid: VapidKeys & { subject: string }) {
    try {
      await webPush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { vapidDetails: vapid, TTL: 60 * 60 * 24, timeout: 10_000 },
      );
      return { gone: false };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return { gone: true };
      throw error;
    }
  }
}

export function generateVapidKeys(): VapidKeys {
  return webPush.generateVAPIDKeys();
}
