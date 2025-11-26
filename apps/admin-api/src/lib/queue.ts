import { MessageType, QueueMessage } from '@al-ummah/shared-types';
import { logger } from './logger';

// Re-export for use
export { MessageType, QueueMessage };

export type Message<T> = QueueMessage<T>;

export default class Queue {
  private queue: any;

  constructor(queue?: any) {
    this.queue = queue;
  }

  async send<T>(type: MessageType, payload: T) {
    try {
      if (!this.queue) {
        logger.warn("Queue binding not provided, skipping send");
        return;
      }
      await this.queue.send({
        id: crypto.randomUUID(),
        type: type,
        payload: payload,
        timestamp: Date.now()
      });
    }
    catch (error) {
      logger.error("Error sending message to queue:", error);
    }
  }

  async sendMessage<T>(message: Message<T>) {
    try {
      if (!this.queue) {
        logger.warn("Queue binding not provided, skipping send");
        return;
      }
      await this.queue.send(message);
    }
    catch (error) {
      logger.error("Error sending message to queue:", error);
    }
  }
}
