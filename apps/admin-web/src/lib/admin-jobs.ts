import type { AdminJobKind, AdminJobStatus } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

/** Label of each admin job kind (admin-api /api/content/jobs). */
export const JOB_KIND_LABEL: Record<AdminJobKind, MessageKey> = {
  'channel.sync-holds': 'adminJobs.kinds.channelSyncHolds',
  'channel.purge': 'adminJobs.kinds.channelPurge',
  'channel.transfer': 'adminJobs.kinds.channelTransfer',
  'video.move': 'adminJobs.kinds.videoMove',
  'video.purge': 'adminJobs.kinds.videoPurge',
  'user.sync-holds': 'adminJobs.kinds.userSyncHolds',
  'user.delete-data': 'adminJobs.kinds.userDeleteData',
  'user.erase-run': 'adminJobs.kinds.userEraseRun',
  'profiles.restore-legacy': 'adminJobs.kinds.profilesRestoreLegacy',
  'videos.repair-thumbnails': 'adminJobs.kinds.videosRepairThumbnails',
  'search.rebuild-ownership': 'adminJobs.kinds.searchRebuildOwnership',
  'playlist.add-videos': 'adminJobs.kinds.playlistAddVideos',
};

export const JOB_STATUS_LABEL: Record<AdminJobStatus, MessageKey> = {
  queued: 'adminJobs.statuses.queued',
  running: 'adminJobs.statuses.running',
  retrying: 'adminJobs.statuses.retrying',
  succeeded: 'adminJobs.statuses.succeeded',
  failed: 'adminJobs.statuses.failed',
};

/** Statuses of a job that is still going (the page refreshes while one is). */
export const isJobActive = (status: AdminJobStatus) => status === 'queued' || status === 'running' || status === 'retrying';
