import type { NotificationPort } from '@tobirink/application';

export interface WebExtensionNotificationsApi {
  create(id: string, options: { iconUrl: string; message: string; title: string; type: 'basic' }): Promise<string> | void;
}

export class WebExtensionNotificationAdapter implements NotificationPort {
  constructor(
    private readonly notifications: WebExtensionNotificationsApi,
    private readonly iconUrl: string,
  ) {}

  async publish(input: { body: string; deduplicationKey: string; title: string }): Promise<void> {
    await this.notifications.create(input.deduplicationKey, {
      iconUrl: this.iconUrl,
      message: input.body,
      title: input.title,
      type: 'basic',
    });
  }
}
