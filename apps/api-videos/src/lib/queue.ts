import { env } from 'cloudflare:workers';
import { MessageType, QueueMessage } from '@al-ummah/shared-types';

// Re-export for backward compatibility
export { MessageType, QueueMessage };

// Legacy Message type alias (deprecated - use QueueMessage instead)
export type Message<T> = QueueMessage<T>;

// Helper function for channel section events
export async function queueChannelSectionEvent(queue: any, type: MessageType, payload: any) {
    try {
        await queue.send({
            id: crypto.randomUUID(),
            type: type,
            payload: payload,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Error sending channel section event to queue:", error);
    }
}

export default class Queue {
    async send<T>(type: MessageType, payload: T) {
        try {
            await env.queue.send({
                id: crypto.randomUUID(),
                type: type,
                payload: payload,
                timestamp: Date.now()
            });
        }
        catch (error) {
            console.error("Error sending message to queue:", error);
        }
    }

    async sendMessage<T>(message: Message<T>) {
        try {
            await env.queue.send(message);
        }
        catch (error) {
            console.error("Error sending message to queue:", error);
        }
    }

    async sendBatch<T>(messages: Message<T>[]) {
        try {
            const chunkSize = 100;
            for (let i = 0; i < messages.length; i += chunkSize) {
                const chunk = messages.slice(i, i + chunkSize).map((value) => ({
                    body: JSON.stringify(value),
                }));
                await env.queue.sendBatch(chunk);
            }
        }
        catch (error) {
            console.error("Error sending message to queue:", error);
        }
    }
};