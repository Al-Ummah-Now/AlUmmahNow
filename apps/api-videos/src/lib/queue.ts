import { env } from 'cloudflare:workers';

export enum MessageType {
    ProfileCreate,
    ProfileUpdate,
    ProfileDelete,
    ProfileView,
    ChannelCreate,
    ChannelUpdate,
    ChannelDelete,
    ChannelView,
    Subscribe,
    Unsubscribe,
    VideoCreate,
    VideoEdit,
    VideoDelete,
    VideoView,
    VideoLike,
    VideoUnlike,
    VideoDislike,
    VideoUndislike,
    CommentCreate,
    CommentEdit,
    CommentDelete,
    CommentLike,
    CommentDislike,
    CommentUnlike,
    CommentUndislike,
    PlaylistEdit,
    PlaylistDelete,
    PlaylistAdd,
    PlaylistRemove,
    PlaylistCreate,
    PlaylistClone,
    // Live streaming events
    LiveStreamCreate,
    LiveStreamUpdate,
    LiveStreamStart,
    LiveStreamEnd,
    LiveStreamView,
    // Video upload events
    VideoUploadStarted,
    VideoUploadCompleted,
    VideoProcessingCompleted,
    VideoUploadFailed,
    // Community post comment events
    PostCommentCreated,
    PostCommentLiked,
    PostCommentDeleted,
    PostCommentPinned,
    PostCommentHearted,
}

export type Message<T> = {
    id: string;
    type: MessageType;
    payload: T;
    timestamp: number;
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