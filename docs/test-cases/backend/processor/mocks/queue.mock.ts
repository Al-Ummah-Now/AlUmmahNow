/**
 * Cloudflare Queue Mock
 * Simulates Cloudflare Queue behavior for testing
 */

export interface QueueMessage {
  id: string;
  body: string;
  timestamp: number;
  attemptNumber: number;
}

export interface QueueBatch {
  messages: QueueMessage[];
  ack(): Promise<void>;
  retry(messages: QueueMessage[]): Promise<void>;
}

export class QueueMock {
  private messages: QueueMessage[] = [];
  private dlqMessages: QueueMessage[] = [];
  private processingBatches: QueueBatch[] = [];

  /**
   * Send a single message to the queue
   */
  async send(message: any): Promise<void> {
    const queueMessage: QueueMessage = {
      id: message.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      body: JSON.stringify(message),
      timestamp: Date.now(),
      attemptNumber: 1
    };

    this.messages.push(queueMessage);
  }

  /**
   * Send multiple messages to the queue
   */
  async sendBatch(messages: any[]): Promise<void> {
    const queueMessages: QueueMessage[] = messages.map(msg => ({
      id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      body: JSON.stringify(msg),
      timestamp: Date.now(),
      attemptNumber: 1
    }));

    this.messages.push(...queueMessages);
  }

  /**
   * Receive a batch of messages from the queue
   */
  async receive(batchSize: number = 10): Promise<QueueBatch | null> {
    if (this.messages.length === 0) {
      return null;
    }

    const batchMessages = this.messages.splice(0, Math.min(batchSize, this.messages.length));
    
    const batch: QueueBatch = {
      messages: batchMessages,
      ack: async () => {
        // Remove from processing batches
        const index = this.processingBatches.indexOf(batch);
        if (index > -1) {
          this.processingBatches.splice(index, 1);
        }
      },
      retry: async (messagesToRetry: QueueMessage[]) => {
        // Increment attempt number and requeue
        const retriedMessages = messagesToRetry.map(msg => ({
          ...msg,
          attemptNumber: msg.attemptNumber + 1,
          timestamp: Date.now()
        }));

        this.messages.unshift(...retriedMessages);
      }
    };

    this.processingBatches.push(batch);
    return batch;
  }

  /**
   * Send messages to dead letter queue
   */
  async sendToDLQ(message: QueueMessage): Promise<void> {
    this.dlqMessages.push(message);
  }

  /**
   * Get messages in dead letter queue
   */
  getDLQMessages(): QueueMessage[] {
    return [...this.dlqMessages];
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.messages.length;
  }

  /**
   * Get number of processing batches
   */
  getProcessingBatchCount(): number {
    return this.processingBatches.length;
  }

  /**
   * Clear all messages and batches
   */
  clear(): void {
    this.messages = [];
    this.dlqMessages = [];
    this.processingBatches = [];
  }

  /**
   * Get message by ID
   */
  getMessageById(id: string): QueueMessage | undefined {
    return this.messages.find(msg => msg.id === id);
  }

  /**
   * Simulate queue processing delay
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueSize: this.messages.length,
      dlqSize: this.dlqMessages.length,
      processingBatches: this.processingBatches.length,
      totalProcessed: this.dlqMessages.length + (this.processingBatches.reduce((sum, batch) => sum + batch.messages.length, 0))
    };
  }

  /**
   * Simulate queue failure for testing
   */
  simulateFailure(shouldFail: boolean): void {
    if (shouldFail) {
      // Override send method to throw error
      this.send = async () => {
        throw new Error('Queue connection failed');
      };
    }
  }

  /**
   * Create a message with specific attempt number for retry testing
   */
  createMessageWithAttempts(message: any, attempts: number): QueueMessage {
    return {
      id: message.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      body: JSON.stringify(message),
      timestamp: Date.now(),
      attemptNumber: attempts
    };
  }

  /**
   * Peek at messages without removing them
   */
  peek(count: number = 10): QueueMessage[] {
    return this.messages.slice(0, count);
  }

  /**
   * Get messages by attempt number
   */
  getMessagesByAttemptNumber(attemptNumber: number): QueueMessage[] {
    return this.messages.filter(msg => msg.attemptNumber === attemptNumber);
  }

  /**
   * Simulate message expiration
   */
  expireMessages(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    this.messages = this.messages.filter(msg => msg.timestamp > cutoff);
  }
}