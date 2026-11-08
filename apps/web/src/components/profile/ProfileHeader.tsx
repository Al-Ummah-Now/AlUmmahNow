'use client';

/**
 * Profile header: cover photo, profile photo and the name heading, as on the
 * profile page. With `editing` the cover and photo open the picker/crop flow
 * and the first name, last name, display name and bio are edited in place
 * (see components/inlineEdit). Direction-aware.
 */

import React from 'react';
import Image from 'next/image';
import { useLanguage } from '@/hooks/useLanguage';
import { InlineEditField } from '@/components/inlineEdit/InlineEditField';
import { EditableImage } from '@/components/inlineEdit/EditableImage';
import { cn } from '@/lib/utils';

export type ProfileHeaderField = 'firstName' | 'lastName' | 'displayName' | 'bio';

export interface ProfileHeaderEditing {
  active: boolean;
  firstName: string;
  lastName: string;
  displayName: string;
  bio: string;
  textDir?: 'ltr' | 'rtl';
  /** Language label added to field names when editing the other language */
  fieldSuffix?: string;
  onChange: (field: ProfileHeaderField, value: string) => void;
  onImage: (kind: 'avatar' | 'cover', file: File) => Promise<void> | void;
  uploading?: 'avatar' | 'cover' | null;
  dirty?: Partial<Record<ProfileHeaderField, boolean>>;
  toolbar?: React.ReactNode;
}

interface ProfileHeaderProps {
  heading: string;
  coverUrl?: string;
  avatarUrl?: string;
  editing?: ProfileHeaderEditing;
  /** Top corner action in view mode (e.g. "Edit" on the profile page) */
  action?: React.ReactNode;
  className?: string;
}

function Photo({ url, className }: { url?: string; className?: string }) {
  return url ? (
    <Image src={url} alt="" fill sizes="96px" className={cn('object-cover', className)} unoptimized={url.startsWith('blob:')} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/avatar.png" alt="" className="w-full h-full object-cover" />
  );
}

export function ProfileHeader({ heading, coverUrl, avatarUrl, editing, action, className }: ProfileHeaderProps) {
  const { t, dir } = useLanguage();
  const editMode = !!editing?.active;
  const label = (base: string) => (editing?.fieldSuffix ? `${base} (${editing.fieldSuffix})` : base);
  const nameClass = 'text-3xl font-bold text-gray-800 dark:text-white';

  return (
    <section
      id="name"
      className={cn('section', className)}
      dir={dir}
      data-testid="profile-header"
      data-edit-mode={editing ? (editMode ? 'on' : 'off') : undefined}
    >
      <div className="relative">
        <EditableImage
          kind="cover"
          editable={editMode}
          label={coverUrl ? t.inlineEdit.changeCover : t.inlineEdit.addBanner}
          uploadingLabel={t.inlineEdit.uploading}
          uploading={editing?.uploading === 'cover'}
          onUpload={(file) => editing?.onImage('cover', file)}
          className="cover-photo relative h-32 sm:h-48 bg-gray-300 dark:bg-gray-600 rounded-md overflow-hidden"
          testId="profile-cover"
        >
          {coverUrl && <Image src={coverUrl} alt="" fill className="object-cover" priority unoptimized={coverUrl.startsWith('blob:')} />}
          {!editing && action && <div className="absolute top-4 end-4">{action}</div>}
        </EditableImage>

        {/* Fixed square: never squeezed (#300) */}
        <EditableImage
          kind="avatar"
          editable={editMode}
          label={t.inlineEdit.changeProfilePhoto}
          uploading={editing?.uploading === 'avatar'}
          onUpload={(file) => editing?.onImage('avatar', file)}
          className="profile-photo absolute bottom-[-24px] start-4 w-24 h-24 aspect-square flex-shrink-0 rounded-full"
          testId="profile-photo"
        >
          <div className="relative w-full h-full rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 border-4 border-white dark:border-gray-800">
            <Photo url={avatarUrl} />
          </div>
        </EditableImage>
      </div>

      {editing ? (
        <div className="mt-12 space-y-2">
          <div role="heading" aria-level={1} className="flex flex-wrap items-start gap-x-3 gap-y-1" data-testid="profile-heading">
            <InlineEditField
              as="span"
              value={editing.firstName}
              onCommit={(v) => editing.onChange('firstName', v.trim())}
              label={label(t.inlineEdit.firstName)}
              editable={editMode}
              maxLength={50}
              dir={editing.textDir}
              emptyText={label(t.inlineEdit.firstName)}
              className={nameClass}
              dirty={editing.dirty?.firstName}
              testId="profile-first-name"
              inputTestId="profile-first-name-input"
            />
            <InlineEditField
              as="span"
              value={editing.lastName}
              onCommit={(v) => editing.onChange('lastName', v.trim())}
              label={label(t.inlineEdit.lastName)}
              editable={editMode}
              maxLength={50}
              dir={editing.textDir}
              emptyText={label(t.inlineEdit.lastName)}
              className={nameClass}
              dirty={editing.dirty?.lastName}
              testId="profile-last-name"
              inputTestId="profile-last-name-input"
            />
            {!editMode && !editing.firstName && !editing.lastName && <span className={nameClass}>{heading}</span>}
          </div>
          <div className="flex items-baseline gap-2 text-gray-600 dark:text-gray-400">
            {editMode && <span className="text-sm shrink-0">{label(t.inlineEdit.displayName)}:</span>}
            <InlineEditField
              as="span"
              value={editing.displayName}
              onCommit={(v) => editing.onChange('displayName', v.trim())}
              label={label(t.inlineEdit.displayName)}
              editable={editMode}
              maxLength={100}
              dir={editing.textDir}
              emptyText={label(t.inlineEdit.displayName)}
              className="text-base font-medium"
              dirty={editing.dirty?.displayName}
              testId="profile-display-name"
              inputTestId="profile-display-name-input"
            />
          </div>
          <InlineEditField
            as="p"
            value={editing.bio}
            onCommit={(v) => editing.onChange('bio', v)}
            label={label(t.inlineEdit.bio)}
            editable={editMode}
            multiline
            maxLength={500}
            dir={editing.textDir}
            emptyText={t.inlineEdit.addBio}
            className="text-gray-700 dark:text-gray-300 whitespace-pre-line max-w-prose"
            dirty={editing.dirty?.bio}
            testId="profile-bio"
            inputTestId="profile-bio-input"
          />
          {editing.toolbar && <div className="pt-2">{editing.toolbar}</div>}
        </div>
      ) : (
        <h1 data-testid="profile-heading" className={cn(nameClass, 'mt-12')}>
          {heading}
        </h1>
      )}
    </section>
  );
}

export default ProfileHeader;
