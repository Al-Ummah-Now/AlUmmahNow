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
  'import.attach': 'adminJobs.kinds.importAttach',
  'import.source-sync': 'adminJobs.kinds.importSourceSync',
  'import.takeout-match': 'adminJobs.kinds.importTakeoutMatch',
  'csam.contain': 'adminJobs.kinds.csamContain',
  'images.index-owners': 'adminJobs.kinds.imagesIndexOwners',
  'media.transcode-retry': 'adminJobs.kinds.mediaTranscodeRetry',
  'media.transcode-cancel': 'adminJobs.kinds.mediaTranscodeCancel',
  'billing.webhook': 'adminJobs.kinds.billingWebhook',
  'billing.sync-prices': 'adminJobs.kinds.billingSyncPrices',
  'billing.cancel': 'adminJobs.kinds.billingCancel',
  'billing.refund': 'adminJobs.kinds.billingRefund',
  'billing.reconcile': 'adminJobs.kinds.billingReconcile',
  'discovery.rank': 'adminJobs.kinds.discoveryRank',
  'search.repair-objects': 'adminJobs.kinds.searchRepairObjects',
  'search.reconcile': 'adminJobs.kinds.searchReconcile',
  'support.webhook': 'adminJobs.kinds.supportWebhook',
  'support.release': 'adminJobs.kinds.supportRelease',
  'support.reconcile': 'adminJobs.kinds.supportReconcile',
  'support.payee-sync': 'adminJobs.kinds.supportPayeeSync',
  'support.dispute-deadline': 'adminJobs.kinds.supportDisputeDeadline',
  'support.dormant': 'adminJobs.kinds.supportDormant',
  'support.payout-plan': 'adminJobs.kinds.supportPayoutPlan',
  'support.payout-fund': 'adminJobs.kinds.supportPayoutFund',
  'support.payout-send': 'adminJobs.kinds.supportPayoutSend',
  'support.payout-status': 'adminJobs.kinds.supportPayoutStatus',
};

export const JOB_STATUS_LABEL: Record<AdminJobStatus, MessageKey> = {
  queued: 'adminJobs.statuses.queued',
  running: 'adminJobs.statuses.running',
  retrying: 'adminJobs.statuses.retrying',
  succeeded: 'adminJobs.statuses.succeeded',
  failed: 'adminJobs.statuses.failed',
  cancelled: 'adminJobs.statuses.cancelled',
};

/** Statuses of a job that is still going (the page refreshes while one is). */
export const isJobActive = (status: AdminJobStatus) => status === 'queued' || status === 'running' || status === 'retrying';
