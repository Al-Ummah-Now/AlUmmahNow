'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
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
import { ChannelSection } from '@al-ummah/shared-types';
import { SortableSectionItem } from '@/components/ChannelSections/management/SortableSectionItem';
import { AddSectionDialog } from '@/components/ChannelSections/management/AddSectionDialog';
import { Button } from '@/components/ui/button';
import {
  listChannelSections,
  createChannelSection,
  deleteChannelSection,
  reorderChannelSections,
} from '@/lib/api/channel-sections';

const MAX_SECTIONS = 10;

export default function ChannelSectionsManagement() {
  const params = useParams();
  const channelId = params.id as string;

  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const result = await listChannelSections(channelId);

        if (result.success && result.data) {
          // Sort by position
          const sorted = result.data.sort((a, b) => a.position - b.position);
          setSections(sorted);
        } else {
          setError(result.error || 'Failed to load sections');
        }
      } catch (err) {
        console.error('Error fetching sections:', err);
        setError('Network error loading sections');
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

  // Handle delete section
  async function handleDelete(sectionId: string) {
    if (!confirm('Are you sure you want to delete this section?')) {
      return;
    }

    try {
      const result = await deleteChannelSection(channelId, sectionId, 'AUTH_TOKEN');

      if (result.success) {
        setSections((prev) => {
          const filtered = prev.filter((s) => s.id !== sectionId);
          // Re-adjust positions
          return filtered.map((section, index) => ({
            ...section,
            position: index,
          }));
        });
        setHasChanges(true);
      } else {
        alert(`Error deleting section: ${result.error}`);
      }
    } catch (err) {
      console.error('Error deleting section:', err);
      alert('Network error deleting section');
    }
  }

  // Handle add section
  async function handleAdd(data: any) {
    try {
      const result = await createChannelSection(channelId, data, 'AUTH_TOKEN');

      if (result.success && result.data) {
        setSections((prev) => [...prev, result.data!]);
        setHasChanges(true);
      } else {
        alert(`Error creating section: ${result.error}`);
      }
    } catch (err) {
      console.error('Error creating section:', err);
      alert('Network error creating section');
    }
  }

  // Publish changes
  async function handlePublish() {
    setSaving(true);
    setError(null);

    try {
      // Send reorder requests for all sections
      for (const section of sections) {
        const result = await reorderChannelSections(
          channelId,
          {
            sectionId: section.id,
            newPosition: section.position,
          } as any, // Type will be fixed once API is implemented
          'AUTH_TOKEN'
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to reorder sections');
        }
      }

      setHasChanges(false);
      alert('Sections published successfully!');
    } catch (err) {
      console.error('Error publishing sections:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish sections');
      alert('Error publishing sections. Please try again.');
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
                  onDelete={() => handleDelete(section.id)}
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
    </div>
  );
}
