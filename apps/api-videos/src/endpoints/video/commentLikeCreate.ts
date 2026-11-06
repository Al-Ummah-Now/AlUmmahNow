import { AuthenticatedRoute, AppContext } from '../../base';
import { commentReactionSchema, handleCommentReaction } from './commentReaction';

export class CommentLikeCreate extends AuthenticatedRoute {
	schema = commentReactionSchema('like', 'add');

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id, cid } = request.params;
		const { channelId } = request.headers;
		return handleCommentReaction(c, { id, cid, channelId, userId: this.getUserId(c) }, 'like', 'add');
	}
}
