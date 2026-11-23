/**
 * Platform brand handles (wiki AUN-CHANNEL-CLAIM §4). Reserved for everyone except super admins,
 * who may give them to the official Al Ummah Now channels, and take them back from a channel that
 * claimed one before it was reserved. api-videos enforces this list; the admin handle tools offer it.
 */
export const OFFICIAL_CHANNEL_HANDLES = ['alummah', 'alummahnow', 'al-ummah', 'al-ummah-now', 'ummah', 'ummahnow', 'official', 'lamahat'] as const;
