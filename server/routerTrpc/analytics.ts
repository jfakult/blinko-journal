import { z } from "zod"
import { Prisma } from "@prisma/client"
import dayjs from "@shared/lib/dayjs"

import { router, authProcedure } from "../middleware"
import { prisma } from "../prisma"

export const analyticsRouter = router({
  dailyNoteCount: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/daily-note-count', summary: 'Query daily note count', protect: true, tags: ['Analytics'] } })
    .input(z.void())
    .output(z.array(z.object({
      date: z.string(),
      count: z.number()
    })))
    .mutation(async function ({ ctx }) {
      const dailyStats = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT 
          to_char("createdAt"::date, 'YYYY-MM-DD') as date,
          COUNT(*) as count
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= NOW() - INTERVAL '1 year'
        GROUP BY "createdAt"::date
        ORDER BY "createdAt"::date ASC
      `;

      return dailyStats.map(stat => ({
        date: stat.date,
        count: Number(stat.count)
      }));
    }),

  monthlyStats: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/monthly-stats', summary: 'Query monthly statistics', protect: true, tags: ['Analytics'] } })
    .input(z.object({
      month: z.string()
    }))
    .output(z.object({
      noteCount: z.number(),
      totalWords: z.number(),
      maxDailyWords: z.number(),
      activeDays: z.number(),
      tagStats: z.array(z.object({
        tagName: z.string(),
        count: z.number()
      })).optional(),
      // CUSTOM-JOURNAL: location distribution for requirement 9 ("locations, moods, trends").
      // Sourced from notes.metadata.location.name (see docs/workstreams/08-analytics-view.md
      // for the expected shape) — an admin-facing capture flow doesn't exist yet, so this is
      // forward-compatible plumbing: it stays empty (and the chart stays hidden) until
      // location capture writes that field.
      locationStats: z.array(z.object({
        locationName: z.string(),
        count: z.number()
      })).optional()
    }))
    .mutation(async function ({ ctx, input }) {
      const startDate = dayjs(input.month).startOf('month').toDate()
      const endDate = dayjs(input.month).endOf('month').toDate()

      const noteCount = await prisma.notes.count({
        where: {
          accountId: parseInt(ctx.id),
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      })

      const wordStats = await prisma.$queryRaw<Array<{ date: string; words: bigint }>>`
        SELECT 
          to_char("createdAt"::date, 'YYYY-MM-DD') as date,
          SUM(LENGTH(content)) as words
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
        GROUP BY "createdAt"::date
        ORDER BY words DESC
      `

      const totalWords = wordStats.reduce((sum, stat) => sum + Number(stat.words), 0)
      const maxDailyWords = wordStats.length > 0 ? Number(wordStats[0]!.words) : 0
      const activeDays = wordStats.length

      const tagStats = await prisma.tag.findMany({
        where: {
          accountId: parseInt(ctx.id),
          tagsToNote: {
            some: {
              note: {
                accountId: parseInt(ctx.id)
              }
            }
          }
        },
        select: {
          name: true,
          _count: {
            select: {
              tagsToNote: true
            }
          }
        },
        orderBy: {
          tagsToNote: {
            _count: 'desc'
          }
        }
      })

      const validTags = tagStats.filter(tag => tag._count.tagsToNote > 0)
      const TOP_TAG_COUNT = 10
      const topTags = validTags.slice(0, TOP_TAG_COUNT)
      
      const otherTagsCount = validTags.slice(TOP_TAG_COUNT).reduce((sum, tag) => sum + tag._count.tagsToNote, 0)

      const finalTagStats = [
        ...topTags.map(tag => ({
          tagName: tag.name,
          count: tag._count.tagsToNote
        }))
      ]

      if (otherTagsCount > 0) {
        finalTagStats.push({
          tagName: 'Others',
          count: otherTagsCount
        })
      }

      // CUSTOM-JOURNAL: aggregate notes.metadata->location->name (a free-form Json field —
      // see docs/workstreams/08-analytics-view.md for the expected shape and why it's a
      // "name" string rather than raw lat/lng). Rows without a location simply don't match
      // the WHERE clause, so this is a no-op until something actually writes that field.
      const locationRows = await prisma.$queryRaw<Array<{ locationName: string; count: bigint }>>`
        SELECT
          metadata->'location'->>'name' as "locationName",
          COUNT(*) as count
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          AND metadata->'location'->>'name' IS NOT NULL
          AND metadata->'location'->>'name' != ''
        GROUP BY "locationName"
        ORDER BY count DESC
      `

      const TOP_LOCATION_COUNT = 10
      const topLocations = locationRows.slice(0, TOP_LOCATION_COUNT)
      const otherLocationsCount = locationRows.slice(TOP_LOCATION_COUNT).reduce((sum, row) => sum + Number(row.count), 0)

      const finalLocationStats = topLocations.map(row => ({
        locationName: row.locationName,
        count: Number(row.count)
      }))

      if (otherLocationsCount > 0) {
        finalLocationStats.push({
          locationName: 'Others',
          count: otherLocationsCount
        })
      }

      return {
        noteCount,
        totalWords,
        maxDailyWords,
        activeDays,
        tagStats: finalTagStats,
        locationStats: finalLocationStats
      }
    })
})