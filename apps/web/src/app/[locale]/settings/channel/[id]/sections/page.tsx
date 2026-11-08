'use client';

import { useState, useEffect } from 'react';
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
import { ChannelSection, ChannelSectionCreateInput } from '@al-ummah/shared-types';
import { SortableSectionItem } from '@/components/ChannelSections/management/SortableSectionItem';
import { AddSectionDialog } from '@/components/ChannelSections/management/AddSectionDialog';
import { SectionForm } from '@/components/ChannelSections/management/SectionForm';
import { Button } from '@/components/ui/button';
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
  listChannelSections,
  createChannelSection,
  updateChannelSection,
  deleteChannelSection,
  reorderChannelSections,
} from '@/lib/api/channel-sections';
import { logger } from '@/lib/logger-client';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { getChannelById } from '@/lib/api/channels';
import { useLanguage } from '@/hooks/useLanguage';

const MAX_SECTIONS = 10;

export default function ChannelSectionsManagement() {
  const params = useParams();
  const channelId = params.id as string;
  const locale = (params.locale as string) || 'en';
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;

  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [channelName, setChannelName] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);
  const [sectionToEdit, setSectionToEdit] = useState<ChannelSection | null>(null);
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
        logger.info('ChannelSectionsManagement: Fetching sections and channel', { channelId });

        const [sectionList, channel] = await Promise.all([
          listChannelSections(channelId),
          getChannelById(channelId),
        ]);

        logger.info('ChannelSectionsManagement: API response received', {
          channelId,
          hasSections: !!sectionList,
          sectionsCount: sectionList?.length || 0,
          hasChannel: !!channel,
        });

        if (channel) {
          setChannelName(channel.nameLocalized?.[locale] || channel.name || '');
        }

        if (sectionList) {
          setSections([...sectionList].sort((a, b) => a.position - b.position));
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSections((current) => {
        const oldIndex = current.findIndex((sec) => sec.id === active.id);
        const newIndex = current.findIndex((sec) => sec.id === over.id);
        return arrayMove(current, oldIndex, newIndex).map((section, index) => ({
          ...section,
          position: index,
        }));
      });
      setHasChanges(true);
      logger.info('ChannelSectionsManagement: Sections reordered', { channelId, activeId: active.id, overId: over.id });
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
        logger.info('ChannelSectionsManagement: Section deleted', { channelId, sectionId: sectionToDelete });
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

  async function handleAdd(data: ChannelSectionCreateInput) {
    setError(null);
    setSuccess(null);

    try {
      const section = await createChannelSection(channelId, data);

      if (section) {
        setSections((prev) => [...prev, section]);
        flash(s.created);
        logger.info('ChannelSectionsManagement: Section created', { channelId, sectionId: section.id, type: data.type });
      } else {
        setError(s.createFailed);
      }
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error creating section', { error: err, data, channelId });
      setError(s.createFailed);
    }
  }

  async function handleUpdate(data: ChannelSectionCreateInput) {
    if (!sectionToEdit) return;
    setUpdating(true);
    setError(null);
    setSuccess(null);

    try {
      const { type: _type, ...changes } = data;
      const result = await updateChannelSection(channelId, sectionToEdit.id, changes);

      if (result?.section) {
        setSections((prev) => prev.map((sec) => (sec.id === sectionToEdit.id ? { ...sec, ...result.section } : sec)));
        setSectionToEdit(null);
        flash(s.updated);
        logger.info('ChannelSectionsManagement: Section updated', { channelId, sectionId: sectionToEdit.id });
      } else {
        setError(s.updateFailed);
      }
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error updating section', { error: err, sectionId: sectionToEdit.id, channelId });
      setError(s.updateFailed);
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
      logger.info('ChannelSectionsManagement: Section order published', { channelId, count: sections.length });
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error publishing sections', { error: err, channelId });
      setError(s.publishFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-64"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
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
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {s.title}
          </h1>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mt-1">
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
        <div role="status" className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
          {success}
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="text-sm text-gray-600 dark:text-gray-400" data-testid="sections-count">
        {s.sectionsUsed.replace('{count}', String(sections.length)).replace('{max}', String(MAX_SECTIONS))}
        {hasChanges && (
          <span className="ms-2 text-orange-600 dark:text-orange-400" data-testid="sections-unpublished">
            {s.unpublishedChanges}
          </span>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map((sec) => sec.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 md:space-y-3" data-testid="sections-list">
            {sections.length === 0 ? (
              <div className="p-8 md:p-12 text-center border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">{s.empty}</p>
              </div>
            ) : (
              sections.map((section) => (
                <SortableSectionItem
                  key={section.id}
                  section={section}
                  onEdit={() => setSectionToEdit(section)}
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
            onAdd={handleAdd}
            disabled={sections.length >= MAX_SECTIONS}
          />
        </div>
      )}

      {sections.length >= MAX_SECTIONS && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
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
                initialData={{
                  title: sectionToEdit.title,
                  videoIds: sectionToEdit.videoIds,
                  playlistIds: sectionToEdit.playlistIds,
                  playlistId: sectionToEdit.playlistId,
                }}
                onSubmit={handleUpdate}
                onCancel={() => setSectionToEdit(null)}
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
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {s.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
