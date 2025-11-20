'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChannelSection, ChannelSectionCreateInput } from '@al-ummah/shared-types';
import { SortableSectionItem } from '@/components/ChannelSections/management/SortableSectionItem';
import { AddSectionDialog } from '@/components/ChannelSections/management/AddSectionDialog';
import { Button } from '@/components/ui/button';
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
  deleteChannelSection,
  reorderChannelSections,
} from '@/lib/api/channel-sections';
import { logger } from '@/lib/logger-client';
import { ArrowLeft, Eye } from 'lucide-react';

const MAX_SECTIONS = 10;

export default function ChannelSectionsManagement() {
  const params = useParams();
  const router = useRouter();
  const channelId = params.id as string;
  const locale = (params.locale as string) || 'en';

  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);

  // Configure sensors for better mobile experience
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts (prevents accidental drags)
      },
    })
  );

  // Fetch sections on mount
  useEffect(() => {
    async function fetchSections() {
      setLoading(true);
      setError(null);

      try {
        logger.info('ChannelSectionsManagement: Fetching sections', { channelId });
        const sections = await listChannelSections(channelId);

        logger.info('ChannelSectionsManagement: API response received', {
          channelId,
          hasSections: !!sections,
          sectionsCount: sections?.length || 0
        });

        if (sections) {
          // Sort by position
          const sorted = sections.sort((a, b) => a.position - b.position);
          logger.info('ChannelSectionsManagement: Sections loaded successfully', {
            channelId,
            count: sorted.length
          });
          setSections(sorted);
        } else {
          logger.warn('ChannelSectionsManagement: No sections returned', { channelId });
          setError('Failed to load sections');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        logger.error('ChannelSectionsManagement: Error fetching sections', {
          error: err,
          errorMessage,
          errorStack,
          channelId,
          errorType: err?.constructor?.name
        });
        setError(`Network error: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    }

    fetchSections();
  }, [channelId]);

  // Handle drag and drop
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSections((sections) => {
        const oldIndex = sections.findIndex((s) => s.id === active.id);
        const newIndex = sections.findIndex((s) => s.id === over.id);

        const reordered = arrayMove(sections, oldIndex, newIndex);

        // Update positions
        return reordered.map((section, index) => ({
          ...section,
          position: index,
        }));
      });

      setHasChanges(true);
    }
  }

  // Open delete confirmation dialog
  function openDeleteDialog(sectionId: string) {
    setSectionToDelete(sectionId);
    setDeleteDialogOpen(true);
  }

  // Handle delete section
  async function confirmDelete() {
    if (!sectionToDelete) return;

    setDeleteDialogOpen(false);
    setError(null);
    setSuccess(null);

    try {
      const result = await deleteChannelSection(channelId, sectionToDelete);

      if (result && result.success) {
        setSections((prev) => {
          const filtered = prev.filter((s) => s.id !== sectionToDelete);
          // Re-adjust positions
          return filtered.map((section, index) => ({
            ...section,
            position: index,
          }));
        });
        setHasChanges(true);
        setSuccess('Section deleted successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Error deleting section');
      }
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error deleting section', { error: err, sectionId: sectionToDelete, channelId });
      setError('Network error deleting section');
    } finally {
      setSectionToDelete(null);
    }
  }

  // Handle add section
  async function handleAdd(data: ChannelSectionCreateInput) {
    setError(null);
    setSuccess(null);

    try {
      const section = await createChannelSection(channelId, data);

      if (section) {
        setSections((prev) => [...prev, section]);
        setHasChanges(true);
        setSuccess('Section created successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Error creating section');
      }
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error creating section', { error: err, data, channelId });
      setError('Network error creating section');
    }
  }

  // Publish changes
  async function handlePublish() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Send single reorder request with all section IDs in order
      const sectionIds = sections.map(s => s.id);

      const result = await reorderChannelSections(
        channelId,
        { sectionIds }
      );

      if (!result) {
        throw new Error('Failed to reorder sections');
      }

      setHasChanges(false);
      setSuccess('Sections published successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      logger.error('ChannelSectionsManagement: Error publishing sections', { error: err, channelId, sections });
      setError(err instanceof Error ? err.message : 'Failed to publish sections');
    } finally {
      setSaving(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="
        max-w-4xl
        mx-auto
        p-4              /* Mobile: compact padding */
        md:p-6           /* Desktop: more padding */
      ">
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
    <div className="
      max-w-4xl
      mx-auto
      p-4                /* Mobile: compact padding */
      md:p-6             /* Desktop: more padding */
      space-y-4
      md:space-y-6
    ">
      {/* Navigation Bar */}
      <div className="
        flex
        items-center
        justify-between
        pb-4
        border-b
        border-gray-200
        dark:border-gray-700
      ">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="
            flex
            items-center
            gap-2
            text-gray-600
            dark:text-gray-400
            hover:text-gray-900
            dark:hover:text-gray-100
          "
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <Link
          href={`/${locale}/channels/${channelId}`}
          className="
            flex
            items-center
            gap-2
            px-3
            py-2
            text-sm
            font-medium
            text-blue-600
            dark:text-blue-400
            hover:text-blue-700
            dark:hover:text-blue-300
            hover:bg-blue-50
            dark:hover:bg-blue-900/20
            rounded-lg
            transition-colors
          "
        >
          <Eye className="w-4 h-4" />
          <span>View Channel</span>
        </Link>
      </div>

      {/* Header */}
      <div className="
        flex
        flex-col           /* Mobile: stack */
        sm:flex-row        /* Tablet+: row */
        sm:items-center
        sm:justify-between
        gap-3
        sm:gap-4
      ">
        <div>
          <h1 className="
            text-xl          /* Mobile: smaller heading */
            md:text-2xl      /* Desktop: larger heading */
            font-bold
            text-gray-900
            dark:text-gray-100
          ">
            Channel sections
          </h1>
          <p className="
            text-sm          /* Mobile: small text */
            md:text-base     /* Desktop: normal text */
            text-gray-600
            dark:text-gray-400
            mt-1
          ">
            Customize your channel layout (max {MAX_SECTIONS} sections)
          </p>
        </div>

        <Button
          onClick={handlePublish}
          disabled={!hasChanges || saving}
          variant={hasChanges ? 'default' : 'outline'}
          className="
            w-full           /* Mobile: full width */
            sm:w-auto        /* Tablet+: auto width */
            h-10
            md:h-9
          "
        >
          {saving ? 'Publishing...' : 'Publish'}
        </Button>
      </div>

      {/* Success message */}
      {success && (
        <div className="
          p-3
          bg-green-50
          dark:bg-green-900/20
          border
          border-green-200
          dark:border-green-800
          rounded-lg
          text-sm
          text-green-800
          dark:text-green-300
        ">
          {success}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="
          p-3
          bg-red-50
          dark:bg-red-900/20
          border
          border-red-200
          dark:border-red-800
          rounded-lg
          text-sm
          text-red-800
          dark:text-red-300
        ">
          {error}
        </div>
      )}

      {/* Sections count */}
      <div className="
        text-sm
        text-gray-600
        dark:text-gray-400
      ">
        {sections.length} of {MAX_SECTIONS} sections used
        {hasChanges && (
          <span className="ml-2 text-orange-600 dark:text-orange-400">
            (Unpublished changes)
          </span>
        )}
      </div>

      {/* Drag-and-drop list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="
            space-y-2        /* Mobile: compact spacing */
            md:space-y-3     /* Desktop: more spacing */
          ">
            {sections.length === 0 ? (
              <div className="
                p-8
                md:p-12
                text-center
                border-2
                border-dashed
                border-gray-300
                dark:border-gray-700
                rounded-lg
              ">
                <p className="
                  text-sm
                  md:text-base
                  text-gray-600
                  dark:text-gray-400
                ">
                  No sections yet. Add your first section to customize your channel.
                </p>
              </div>
            ) : (
              sections.map((section) => (
                <SortableSectionItem
                  key={section.id}
                  section={section}
                  onDelete={() => openDeleteDialog(section.id)}
                />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add section button */}
      {sections.length < MAX_SECTIONS && (
        <div className="pt-2">
          <AddSectionDialog
            channelId={channelId}
            onAdd={handleAdd}
            disabled={sections.length >= MAX_SECTIONS}
          />
        </div>
      )}

      {/* Max sections warning */}
      {sections.length >= MAX_SECTIONS && (
        <div className="
          p-3
          bg-yellow-50
          dark:bg-yellow-900/20
          border
          border-yellow-200
          dark:border-yellow-800
          rounded-lg
          text-sm
          text-yellow-800
          dark:text-yellow-300
        ">
          Maximum number of sections reached. Delete a section to add a new one.
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Section</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this section? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
