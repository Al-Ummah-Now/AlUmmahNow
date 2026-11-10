'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CHANNEL_SECTION_CONSTRAINTS, type ChannelSectionCreateInput } from '@al-ummah/shared-types';
import type { PopulatedChannelSection } from '@/components/ChannelSections/sectionData';
import { useAuth } from '@/components/AuthProvider/authContext';
import { SortableSectionItem } from '@/components/ChannelSections/management/SortableSectionItem';
import { AddSectionDialog } from '@/components/ChannelSections/management/AddSectionDialog';
import { SectionForm } from '@/components/ChannelSections/management/SectionForm';
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  listChannelSectionsPopulated,
  createChannelSection,
  updateChannelSection,
  deleteChannelSection,
  reorderChannelSections,
} from '@/lib/api/channel-sections';
import { logger } from '@/lib/logger-client';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { getChannelById } from '@/lib/api/channels';
import { useLanguage } from '@/hooks/useLanguage';

const MAX_SECTIONS = CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL;

const isSpotlight = (section: { type: string }) => section.type === 'channel_spotlight';

export default function ChannelSectionsManagement() {
  const params = useParams();
  const channelId = params.id as string;
  const locale = (params.locale as string) || 'en';
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;
  const cs = t.channelSections;
  const { user } = useAuth();

  const [sections, setSections] = useState<PopulatedChannelSection[]>([]);
  const [channelOwnerId, setChannelOwnerId] = useState<string | null>(null);
  const [channelName, setChannelName] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);
  const [sectionToEdit, setSectionToEdit] = useState<PopulatedChannelSection | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts (prevents accidental drags)
      },
    }),
    // Keyboard reordering: focus a handle, Space to pick up, arrows to move, Space to drop
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        logger.debug('ChannelSectionsManagement: Fetching sections and channel', { channelId });

        const [sectionList, channel] = await Promise.all([
          listChannelSectionsPopulated(channelId),
          getChannelById(channelId),
        ]);

        logger.debug('ChannelSectionsManagement: API response received', {
          channelId,
          hasSections: !!sectionList,
          sectionsCount: sectionList?.length || 0,
          hasChannel: !!channel,
        });

        if (channel) {
          setChannelName(channel.nameLocalized?.[locale] || channel.name || '');
          setChannelOwnerId(channel.userId ?? null);
        }

        if (sectionList) {
          // The populated list is already in the published order, spotlight first
          setSections(sectionList as PopulatedChannelSection[]);
        } else {
          logger.warn('ChannelSectionsManagement: No sections returned', { channelId });
          setError(s.loadFailed);
        }
      } catch (err) {
        logger.error('ChannelSectionsManagement: Error fetching data', {
          error: err,
          errorMessage: err instanceof Error ? err.message : String(err),
          channelId,
        });
        setError(s.loadFailed);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    // Strings are read at fetch time only; refetching on a locale switch is not needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, locale]);

  function flash(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  }

  /** A rejected write's code, in the viewer's language */
  const errorMessage = useCallback(
    (code: string) => (cs.errors as Record<string, string>)[code] ?? cs.errors.generic,
    [cs.errors]
  );

  /** Re-read the populated list so content, hints and badges match the server */
  async function refreshSections() {
    try {
      const list = await listChannelSectionsPopulated(channelId);
      if (list) setSections(list as PopulatedChannelSection[]);
    } catch (err) {
      logger.warn('ChannelSectionsManagement: refresh failed', { channelId, error: err });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSections((current) => {
        const pinned = current.filter(isSpotlight);
        const movable = current.filter((sec) => !isSpotlight(sec));
        const oldIndex = movable.findIndex((sec) => sec.id === active.id);
        const newIndex = movable.findIndex((sec) => sec.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return current;
        return [...pinned, ...arrayMove(movable, oldIndex, newIndex)].map((section, index) => ({
          ...section,
          position: index,
        }));
      });
      setHasChanges(true);
      logger.debug('ChannelSectionsManagement: Sections reordered', { channelId, activeId: active.id, overId: over.id });
    }
  }

  function openDeleteDialog(sectionId: string) {
    setSectionToDelete(sectionId);
    setDeleteDialogOpen(true);
  }

  async function confirmDelete() {
    if (!sectionToDelete) return;

    setDeleteDialogOpen(false);
    setError(null);
    setSuccess(null);

    try {
      const result = await deleteChannelSection(channelId, sectionToDelete);

      if (result && result.success) {
        setSections((prev) =>
          prev
            .filter((sec) => sec.id !== sectionToDelete)
            .map((section, index) => ({ ...section, position: index }))
        );
        flash(s.deleted);
        logger.debug('ChannelSectionsManagement: Section deleted', { channelId, sectionId: sectionToDelete });
      } else {
        setError(s.deleteFailed);
      }
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error deleting section', { error: err, sectionId: sectionToDelete, channelId });
      setError(s.deleteFailed);
    } finally {
      setSectionToDelete(null);
    }
  }

  /** Resolves to a localized error for the dialog, or null when added */
  async function handleAdd(data: ChannelSectionCreateInput): Promise<string | null> {
    setError(null);
    setSuccess(null);
    try {
      const result = await createChannelSection(channelId, data);
      if (!result.ok) return errorMessage(result.code);
      logger.debug('ChannelSectionsManagement: Section created', { channelId, sectionId: result.section.id, type: data.type });
      await refreshSections();
      flash(s.created);
      return null;
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error creating section', { error: err, type: data.type, channelId });
      return cs.errors.generic;
    }
  }

  async function handleUpdate(data: ChannelSectionCreateInput) {
    if (!sectionToEdit) return;
    setUpdating(true);
    setEditError(null);
    setSuccess(null);
    try {
      const { type: _type, ...changes } = data;
      const result = await updateChannelSection(channelId, sectionToEdit.id, changes);
      if (!result.ok) {
        setEditError(errorMessage(result.code));
        return;
      }
      logger.debug('ChannelSectionsManagement: Section updated', { channelId, sectionId: sectionToEdit.id });
      await refreshSections();
      setSectionToEdit(null);
      flash(s.updated);
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error updating section', { error: err, sectionId: sectionToEdit.id, channelId });
      setEditError(cs.errors.generic);
    } finally {
      setUpdating(false);
    }
  }

  async function handlePublish() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await reorderChannelSections(channelId, { sectionIds: sections.map((sec) => sec.id) });

      if (!result) {
        throw new Error('Failed to reorder sections');
      }

      setHasChanges(false);
      flash(s.published);
      logger.debug('ChannelSectionsManagement: Section order published', { channelId, count: sections.length });
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error publishing sections', { error: err, channelId });
      setError(s.publishFailed);
    } finally {
      setSaving(false);
    }
  }

  const canGrantConsent = !!user?.id && !!channelOwnerId && user.id === channelOwnerId;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="h-4 bg-muted rounded w-64"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <ChannelSettingsBreadcrumb
        channelId={channelId}
        channelName={channelName}
        locale={locale}
        currentPage="sections"
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            {s.title}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            {s.description.replace('{max}', String(MAX_SECTIONS))}
          </p>
        </div>

        <Button
          onClick={handlePublish}
          disabled={!hasChanges || saving}
          variant={hasChanges ? 'default' : 'outline'}
          className="w-full sm:w-auto h-10 md:h-9"
          data-testid="publish-sections"
        >
          {saving ? s.publishing : s.publish}
        </Button>
      </div>

      {success && (
        <div role="status" className="p-3 bg-brand-soft border border-brand-edge rounded-lg text-sm text-brand-ink">
          {success}
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 border border-destructive rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="text-sm text-muted-foreground" data-testid="sections-count">
        {s.sectionsUsed.replace('{count}', String(sections.length)).replace('{max}', String(MAX_SECTIONS))}
        {hasChanges && (
          <span className="ms-2 font-medium text-foreground" data-testid="sections-unpublished">
            {s.unpublishedChanges}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.filter((sec) => !isSpotlight(sec)).map((sec) => sec.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 md:space-y-3" data-testid="sections-list">
            {sections.length === 0 ? (
              <div className="p-8 md:p-12 text-center border border-border bg-muted rounded-lg">
                <p className="text-sm md:text-base text-muted-foreground">{s.empty}</p>
              </div>
            ) : (
              sections.map((section) => (
                <SortableSectionItem
                  key={section.id}
                  section={section}
                  pinned={isSpotlight(section)}
                  onEdit={() => {
                    setEditError(null);
                    setSectionToEdit(section);
                  }}
                  onDelete={() => openDeleteDialog(section.id)}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      {sections.length < MAX_SECTIONS && (
        <div className="pt-2">
          <AddSectionDialog
            channelId={channelId}
            existing={sections}
            canGrantConsent={canGrantConsent}
            onAdd={handleAdd}
            disabled={sections.length >= MAX_SECTIONS}
          />
        </div>
      )}

      {sections.length >= MAX_SECTIONS && (
        <div className="p-3 bg-brand-soft border border-brand-edge rounded-lg text-sm text-brand-ink">
          {s.maxReached}
        </div>
      )}

      {sectionToEdit && (
      <Dialog open onOpenChange={(open) => { if (!open) setSectionToEdit(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-4 md:p-6" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-lg md:text-xl">{s.editSection}</DialogTitle>
          </DialogHeader>
          {(
            <div className="mt-4">
              <SectionForm
                key={sectionToEdit.id}
                channelId={channelId}
                sectionType={sectionToEdit.type}
                mode="edit"
                initial={sectionToEdit}
                canGrantConsent={canGrantConsent}
                serverError={editError}
                onSubmit={handleUpdate}
                onCancel={() => setSectionToEdit(null)}
                cancelLabel={s.cancel}
                isLoading={updating}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{s.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{s.deleteConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{s.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className={buttonVariants({ variant: "destructive" })}
            >
              {s.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
