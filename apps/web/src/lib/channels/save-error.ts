import { apiErrorMessage, type ApiErrorLang } from '@al-ummah/shared-types';

/** What the owner reads when saving their channel is refused: a handle that is taken, a move under way, or that it failed. */
export function channelSaveError(result: { status: number; code?: string; reason?: string }, texts: { handleTaken: string; saveFailed: string }, lang: ApiErrorLang): string {
  if (result.code === 'move_in_progress') return apiErrorMessage(result.code, result.status, lang);
  return result.reason === 'taken' ? texts.handleTaken : texts.saveFailed;
}
