import { Hono } from 'hono';
import { ChannelTranslationSettingsGet, ChannelTranslationSettingsSet } from '../endpoints/translate/translate';
import { ChannelQuranTranslationReset, ChannelQuranTranslationSet, ChannelQuranTranslationsGet } from '../endpoints/quran/quranTranslations';
import { fromHono } from 'chanfana';
import { ChannelContentList, ChannelContentSummary } from '../endpoints/channel/channelContent';
import { ChannelDeletedVideos } from '../endpoints/video/videoTrash';
import { ChannelTopContent } from '../endpoints/channel/channelTopContent';
import { ChannelCommentsBulk, ChannelCommentsList, ChannelCommentsSummary } from '../endpoints/channel/channelComments';
import { ChannelBlockAdd, ChannelBlockRemove, ChannelBlocksList } from '../endpoints/channel/channelBlocks';

// Channel CRUD endpoints
import { ChannelsList } from '../endpoints/channel/channelList';
import { ChannelCreate } from '../endpoints/channel/channelCreate';
import { ChannelFetch } from '../endpoints/channel/channelFetch';
import { ChannelOwnerFetch } from '../endpoints/channel/channelOwnerFetch';
import { ChannelUpdate } from '../endpoints/channel/channelUpdate';
import { ChannelDelete } from '../endpoints/channel/channelDelete';
import { ChannelAbout, ChannelByHandleFetch, ChannelHandleAvailability } from '../endpoints/channel/channelHandle';
import { ChannelAuditList, ChannelInviteCancel, ChannelInviteCreate } from '../endpoints/channel/channelInvites';
import { ChannelMoveOfferCreate, ChannelMoveReceivers, ChannelMoveStateFetch } from '../endpoints/channel/channelMoveOffers';
import { ChannelAccessList, ChannelMemberRemove, ChannelMemberUpdate, ChannelMembersList } from '../endpoints/channel/channelMembers';

// Channel content endpoints
import { ChannelVideosList } from '../endpoints/channel/channelVideosList';
import { ChannelDeletedVideosList } from '../endpoints/channel/channelDeletedVideosList';
import { ChannelShortsList } from '../endpoints/channel/channelShortsList';
import { ChannelLiveList } from '../endpoints/channel/channelLiveList';
import { ChannelPlaylistsList } from '../endpoints/channel/channelPlaylistsList';

// Channel subscriptions
import { SubscriptionCreate } from '../endpoints/channel/SubscriptionCreate';
import { SubscriptionDelete } from '../endpoints/channel/SubscriptionDelete';
import { SubscriptionStatus } from '../endpoints/channel/SubscriptionStatus';

// Channel tabs
import { ChannelTabsFetch } from '../endpoints/channel/channelTabsFetch';
import { ChannelTabsUpdate } from '../endpoints/channel/channelTabsUpdate';

// Channel sections
import { ChannelSectionsList } from '../endpoints/channel-section/channelSectionList';
import { ChannelSectionsListPopulated } from '../endpoints/channel-section/channelSectionListPopulated';
import { ChannelSectionFetch } from '../endpoints/channel-section/channelSectionFetch';
import { ChannelSectionCreate } from '../endpoints/channel-section/channelSectionCreate';
import { ChannelSectionUpdate } from '../endpoints/channel-section/channelSectionUpdate';
import { ChannelSectionDelete } from '../endpoints/channel-section/channelSectionDelete';
import { ChannelSectionReorder } from '../endpoints/channel-section/channelSectionReorder';

// Image upload handlers
import handleChannelAvatarUpdate from '../endpoints/channel/channelAvatarUpdate';
import handleChannelCoverUpdate from '../endpoints/channel/channelCoverUpdate';

// Create Hono app
const app = new Hono();

// Create OpenAPI router with base path
export const channelRouter = fromHono(app);

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

// List all channels (public)
channelRouter.get('/', ChannelsList);

// Create new channel (auth required)
channelRouter.post('/', ChannelCreate);

// @handle lookups (registered before /:id so the static segments win)
channelRouter.get('/handles/:handle/availability', ChannelHandleAvailability);
// My channels with my role on each (owned + channel roles); before '/:id'
channelRouter.get('/access', ChannelAccessList);
channelRouter.get('/by-handle/:handle', ChannelByHandleFetch);

// Quran translation editions and translation settings (AUN-CAPTIONS O7, §5.9; channel.edit)
channelRouter.get('/:channelId/quran-translations', ChannelQuranTranslationsGet);
channelRouter.put('/:channelId/quran-translations/:language', ChannelQuranTranslationSet);
channelRouter.delete('/:channelId/quran-translations/:language', ChannelQuranTranslationReset);
channelRouter.get('/:channelId/translation-settings', ChannelTranslationSettingsGet);
channelRouter.put('/:channelId/translation-settings', ChannelTranslationSettingsSet);

// Get channel by ID (public)
channelRouter.get('/:id', ChannelFetch);

// Channel with private fields (owner or admin)
channelRouter.get('/:id/owner', ChannelOwnerFetch);

// About tab data with totals (public)
channelRouter.get('/:id/about', ChannelAbout);

// Update channel (auth required)
channelRouter.put('/:id', ChannelUpdate);

// Delete channel (auth required)
channelRouter.delete('/:id', ChannelDelete);

// ============================================================================
// CHANNEL CONTENT
// ============================================================================

// Get channel videos (public)
channelRouter.get('/:id/videos', ChannelVideosList);

// The channel's deleted videos as full video views, restorable for 30 days (owner or video.delete role)
channelRouter.get('/:id/deleted-videos', ChannelDeletedVideosList);

// Studio: the Videos tab
channelRouter.get('/:id/content/summary', ChannelContentSummary);
channelRouter.get('/:id/content/deleted', ChannelDeletedVideos);
channelRouter.get('/:id/content', ChannelContentList);
channelRouter.get('/:id/analytics/top-content', ChannelTopContent);
// Studio: Comments (comment.moderate; #771)
channelRouter.get('/:id/comments/summary', ChannelCommentsSummary);
channelRouter.get('/:id/comments', ChannelCommentsList);
channelRouter.post('/:id/comments/bulk', ChannelCommentsBulk);
channelRouter.get('/:id/blocks', ChannelBlocksList);
channelRouter.post('/:id/blocks', ChannelBlockAdd);
channelRouter.delete('/:id/blocks/:userId', ChannelBlockRemove);

// Get channel shorts (public)
channelRouter.get('/:id/shorts', ChannelShortsList);

// Get channel live streams (public)
channelRouter.get('/:id/live', ChannelLiveList);

// Get channel playlists (public)
channelRouter.get('/:id/playlists', ChannelPlaylistsList);

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

// Subscribe to channel (auth required)
channelRouter.post('/:id/subscriptions', SubscriptionCreate);

// Unsubscribe from channel (auth required)
channelRouter.delete('/:id/subscriptions', SubscriptionDelete);

// Subscription status for the current viewer (public; isSubscribed=false when unauthenticated)
channelRouter.get('/:id/subscriptions/status', SubscriptionStatus);

// Channel members (per-channel roles, never site roles)
channelRouter.get('/:id/members', ChannelMembersList);
channelRouter.put('/:id/members/:userId', ChannelMemberUpdate);
channelRouter.delete('/:id/members/:userId', ChannelMemberRemove);
channelRouter.post('/:id/invites', ChannelInviteCreate);
channelRouter.delete('/:id/invites/:inviteId', ChannelInviteCancel);
channelRouter.get('/:id/move-receivers', ChannelMoveReceivers);
channelRouter.get('/:id/move-offers', ChannelMoveStateFetch);
channelRouter.post('/:id/move-offers', ChannelMoveOfferCreate);
channelRouter.get('/:id/audit', ChannelAuditList);

// ============================================================================
// TABS
// ============================================================================

// Get channel tabs configuration (public)
channelRouter.get('/:id/tabs', ChannelTabsFetch);

// Update channel tabs (auth required)
channelRouter.put('/:id/tabs', ChannelTabsUpdate);

// ============================================================================
// SECTIONS
// ============================================================================

// List channel sections (public)
channelRouter.get('/:channelId/sections', ChannelSectionsList);

// List channel sections with populated content (public)
channelRouter.get('/:channelId/sections/populated', ChannelSectionsListPopulated);

// Get specific channel section (public)
channelRouter.get('/:channelId/sections/:sectionId', ChannelSectionFetch);

// Create channel section (auth required)
channelRouter.post('/:channelId/sections', ChannelSectionCreate);

// Update channel section (auth required)
channelRouter.put('/:channelId/sections/:sectionId', ChannelSectionUpdate);

// Delete channel section (auth required)
channelRouter.delete('/:channelId/sections/:sectionId', ChannelSectionDelete);

// Reorder channel sections (auth required)
channelRouter.patch('/:channelId/sections/reorder', ChannelSectionReorder);

// ============================================================================
// IMAGE UPLOADS (Raw Hono routes - not OpenAPI endpoints)
// ============================================================================

// Update channel avatar (auth required)
app.put('/:id/avatar', handleChannelAvatarUpdate);

// Update channel cover (auth required)
app.put('/:id/cover', handleChannelCoverUpdate);

// Export as default and named export
export default channelRouter;
