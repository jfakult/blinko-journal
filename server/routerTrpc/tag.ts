import { router, authProcedure, demoAuthMiddleware } from '@server/middleware';
import { z } from 'zod';
import { prisma } from '@server/prisma';
import { userCaller } from './_app';
import { tagSchema } from '@shared/lib/prismaZodType';
import { syncNoteTagsFromContent } from '@server/lib/helper';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const tagRouter = router({
  list: authProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/tags/list', summary: 'Get user tags', protect: true, tags: ['Tag'] } })
    .input(z.void())
    .output(z.array(tagSchema))
    .query(async function ({ ctx }) {
      const tags = await prisma.tag.findMany({
        where: {
          accountId: Number(ctx.id)
        },
        orderBy: {
          sortOrder: 'asc'
        },
        distinct: ['id']
      });
      return tags;
    }),

  // CUSTOM-JOURNAL: tags are otherwise only ever created implicitly via
  // #hashtag syntax in note content (see server/lib/helper.ts's
  // syncNoteTagsFromContent) -- this lets the user create a tag directly,
  // with zero notes attached yet, from the sidebar tag tree.
  create: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/tags/create', summary: 'Create a new tag', protect: true, tags: ['Tag'] } })
    .input(z.object({
      name: z.string().min(1),
      icon: z.string().default('').optional(),
      parent: z.number().default(0).optional(),
    }))
    .output(tagSchema)
    .mutation(async function ({ input, ctx }) {
      const { name, icon, parent } = input
      const accountId = Number(ctx.id)
      const existing = await prisma.tag.findFirst({ where: { name, parent: parent ?? 0, accountId } })
      if (existing) {
        throw new Error('A tag with this name already exists at this level')
      }
      return await prisma.tag.create({
        data: { name, icon: icon ?? '', parent: parent ?? 0, accountId }
      })
    }),

  // CUSTOM-JOURNAL: manually attach/detach a tag on one note (the "+tag" chip
  // on cards, the right-click "Add tag" menu item, and the editor's Tags
  // row all go through these) -- tags are still 100% content-derived (see
  // syncNoteTagsFromContent), so these just append/strip the "#path" token
  // on the note's content directly, the same convention AI tagging already
  // uses, rather than writing tagsToNote rows by hand (which the next content
  // save would just undo, since content is the source of truth).
  attachToNote: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/tags/attach-to-note', summary: 'Attach a tag to a note', protect: true, tags: ['Tag'] } })
    .input(z.object({
      noteId: z.number(),
      tagPath: z.string().min(1),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async function ({ input, ctx }) {
      const accountId = Number(ctx.id)
      const note = await prisma.notes.findUnique({ where: { id: input.noteId, accountId }, select: { content: true } })
      if (!note) throw new Error('Note not found')

      const hashtag = `#${input.tagPath}`
      const alreadyPresent = new RegExp(`(?:^|\\s)${escapeRegExp(hashtag)}(?:\\s|$)`).test(note.content)
      const newContent = alreadyPresent ? note.content : `${note.content}\n${hashtag}`
      if (!alreadyPresent) {
        await prisma.notes.update({ where: { id: input.noteId }, data: { content: newContent } })
      }
      await syncNoteTagsFromContent(input.noteId, accountId, newContent)
      return { success: true }
    }),

  detachFromNote: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/tags/detach-from-note', summary: 'Detach a tag from a note', protect: true, tags: ['Tag'] } })
    .input(z.object({
      noteId: z.number(),
      tagPath: z.string().min(1),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async function ({ input, ctx }) {
      const accountId = Number(ctx.id)
      const note = await prisma.notes.findUnique({ where: { id: input.noteId, accountId }, select: { content: true } })
      if (!note) throw new Error('Note not found')

      const hashtag = `#${input.tagPath}`
      const newContent = note.content
        .replace(new RegExp(`(?:^|\\s)${escapeRegExp(hashtag)}(?=\\s|$)`, 'g'), '')
        .replace(/[ \t]+\n/g, '\n')
        .trim()
      await prisma.notes.update({ where: { id: input.noteId }, data: { content: newContent } })
      await syncNoteTagsFromContent(input.noteId, accountId, newContent)
      return { success: true }
    }),

  fullTagNameById: authProcedure
    .input(z.object({
      id: z.number()
    }))
    .output(z.string())
    .query(async function ({ input }) {
      const { id } = input
      const tag = await prisma.tag.findFirst({ where: { id } })
      if (!tag) {
        throw new Error('Tag not found')
      }

      if (tag.parent === 0) {
        return '#' + tag.name;
      }

      const getParentTags = async (currentTag: typeof tag): Promise<string[]> => {
        if (!currentTag || currentTag.parent === 0) {
          return [currentTag.name];
        }
        
        const parentTag = await prisma.tag.findFirst({
          where: { id: currentTag.parent }
        });
        
        if (!parentTag) {
          return [currentTag.name];
        }

        const parentNames = await getParentTags(parentTag);
        return [...parentNames, currentTag.name];
      };

      const tagNames = await getParentTags(tag);
      return '#' + tagNames.join('/');
    }),
  updateTagMany: authProcedure
    .meta({
      openapi: {
        method: 'POST', path: '/v1/tags/batch-update', summary: 'Batch update tags',
        description: 'Batch update tags and add tag to notes', protect: true, tags: ['Tag']
      }
    })
    .input(z.object({
      ids: z.array(z.number()),
      tag: z.string()
    }))
    .output(z.boolean())
    .mutation(async function ({ input, ctx }) {
      const { ids, tag } = input
      const notes = await prisma.notes.findMany({ where: { id: { in: ids } } })
      for (const note of notes) {
        const newContent = note.content += ' #' + tag
        await userCaller(ctx).notes.upsert({ content: newContent, id: note.id, type: -1 })
      }
      return true
    }),
  updateTagName: authProcedure
    .meta({
      openapi: {
        method: 'POST', path: '/v1/tags/update-name', summary: 'Update tag name',
        description: 'Update tag name and update tag to notes', protect: true, tags: ['Tag']
      }
    })
    .input(z.object({
      oldName: z.string(),
      newName: z.string(),
      id: z.number()
    }))
    .output(z.boolean())
    .mutation(async function ({ input, ctx }) {
      const { id, oldName, newName } = input
      const tagToNote = await prisma.tagsToNote.findMany({ where: { tagId: id } })
      const noteIds = tagToNote.map(i => i.noteId)
      const hasTagNote = await prisma.notes.findMany({ where: { id: { in: noteIds } } })
      hasTagNote.map(i => {
        i.content = i.content.replace(new RegExp(`#${oldName}`, 'g'), "#" + newName)
      })
      for (const note of hasTagNote) {
        await userCaller(ctx).notes.upsert({ content: note.content, id: note.id, type: note.type })
      }
      return true
    }),
  updateTagIcon: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/tags/update-icon', summary: 'Update tag icon', protect: true, tags: ['Tag'] } })
    .input(z.object({
      id: z.number(),
      icon: z.string()
    }))
    .output(tagSchema)
    .mutation(async function ({ input }) {
      const { id, icon } = input
      return await prisma.tag.update({ where: { id }, data: { icon } })
    }),
  deleteOnlyTag: authProcedure.use(demoAuthMiddleware)
    .meta({
      openapi: {
        method: 'POST', path: '/v1/tags/delete-only-tag', summary: 'Only delete tag name',
        description: 'Only delete tag name and remove tag from notes, but not delete notes', protect: true, tags: ['Tag']
      }
    })
    .input(z.object({
      id: z.number()
    }))
    .output(z.boolean())
    .mutation(async function ({ input, ctx }) {
      const { id } = input
      const tag = await prisma.tag.findFirst({
        where: {
          id,
          accountId: Number(ctx.id)
        },
        include: { tagsToNote: true }
      })

      if (!tag) return true

      const allNotesId = tag.tagsToNote.map(i => i.noteId)

      for (const noteId of allNotesId) {
        const note = await prisma.notes.findFirst({ where: { id: noteId } })
        if (!note) continue

        const getAllTagIdsInChain = async (tagId: number): Promise<number[]> => {
          const result: number[] = [tagId];
          
          let currentTag = await prisma.tag.findFirst({ where: { id: tagId } });
          while (currentTag && currentTag.parent !== 0) {
            result.push(currentTag.parent);
            currentTag = await prisma.tag.findFirst({ where: { id: currentTag.parent } });
          }
          
          const childTags = await prisma.tag.findMany({ where: { parent: tagId } });
          for (const childTag of childTags) {
            const childChain = await getAllTagIdsInChain(childTag.id);
            result.push(...childChain);
          }
          
          return [...new Set(result)];
        };

        const tagIdsInChain = await getAllTagIdsInChain(tag.id);
        
        await prisma.notes.update({
          where: { id: note.id },
          data: { 
            content: note.content.replace(
              new RegExp(`#[^\\s]*${tag.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^\\s]*)?(?=\\s|$)`, 'g'),
              ''
            ).trim()
          }
        })

        await prisma.tagsToNote.deleteMany({ 
          where: { 
            noteId: note.id,
            tagId: {
              in: tagIdsInChain
            }
          } 
        })

        for (const tagId of tagIdsInChain) {
          const tagExists = await prisma.tag.findFirst({
            where: { id: tagId }
          });
          
          if (tagExists) {
            const tagUsageCount = await prisma.tagsToNote.count({
              where: { tagId }
            });

            if (tagUsageCount === 0) {
              await prisma.tag.delete({ where: { id: tagId } });
            }
          }
        }
      }
      return true
    }),
  deleteTagWithAllNote: authProcedure.use(demoAuthMiddleware)
    .meta({
      openapi: {
        method: 'POST', path: '/v1/tags/delete-tag-with-notes', summary: 'Delete tag and delete notes',
        description: 'Delete tag and delete notes', protect: true, tags: ['Tag']
      }
    })
    .input(z.object({
      id: z.number()
    }))
    .output(z.boolean())
    .mutation(async function ({ input, ctx }) {
      const { id } = input
      const tag = await prisma.tag.findFirst({ where: { id, accountId: Number(ctx.id) }, include: { tagsToNote: true } })
      const allNotesId = tag?.tagsToNote.map(i => i.noteId) ?? []
      await userCaller(ctx).notes.trashMany({ ids: allNotesId })
      await userCaller(ctx).tags.deleteOnlyTag({ id })
      return true
    }),
  updateTagOrder: authProcedure
    .input(z.object({
      id: z.number(),
      sortOrder: z.number()
    }))
    .mutation(async function ({ input }) {
      const { id, sortOrder } = input
      return await prisma.tag.update({
        where: { id },
        data: { sortOrder }
      })
    }),
})
