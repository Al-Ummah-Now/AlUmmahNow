-- Creator support (wiki AUN-MEMBERS, MEM-D5 "tier capability"): a creator tier may let its owners receive
-- support. Off for every tier until an admin ticks it; read only while the support policy's receiversRule is
-- 'tierCapability' (cross-provider review of #1772: without this column no channel could ever receive).
ALTER TABLE creator_tiers ADD COLUMN support_receive INTEGER NOT NULL DEFAULT 0;
