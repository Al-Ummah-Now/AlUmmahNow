import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ChannelContentList, ChannelContentSummary } from '../endpoints/channel/channelContent';
import { ChannelDeletedVideos } from '../endpoints/video/videoTrash';
import { ChannelTopContent } from '../endpoints/channel/channelTopContent';

// Channel CRUD endpoints
import { ChannelsList } from '../endpoints/channel/channelList';
import { ChannelCreate } from '../endpoints/channel/channelCreate';
import { ChannelFetch } from '../endpoints/channel/channelFetch';
import { ChannelOwnerFetch } from '../endpoints/channel/channelOwnerFetch';
import { ChannelUpdate } from '../endpoints/channel/channelUpdate';
import { ChannelDelete } from '../endpoints/channel/channelDelete';
import { ChannelAbout, ChannelByHandleFetch, ChannelHandleAvailability } from '../endpoints/channel/channelHandle';
import { ChannelAccessList, ChannelMemberAdd, ChannelMemberRemove, ChannelMemberUpdate, ChannelMembersList } from '../endpoints/channel/channelMembers';

// Channel content endpoints
import { ChannelVideosList } from '../endpoints/channel/channelVideosList';
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
export const channelRouter = fromHono(app, { base: '/api/channels' });

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

// Studio: the Videos tab
channelRouter.get('/:id/content/summary', ChannelContentSummary);
channelRouter.get('/:id/content/deleted', ChannelDeletedVideos);
channelRouter.get('/:id/content', ChannelContentList);
channelRouter.get('/:id/analytics/top-content', ChannelTopContent);

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
channelRouter.post('/:id/members', ChannelMemberAdd);
channelRouter.put('/:id/members/:userId', ChannelMemberUpdate);
channelRouter.delete('/:id/members/:userId', ChannelMemberRemove);

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
