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
        count: z.number(),
        // CUSTOM-JOURNAL: null for the synthetic "Others" bucket, which isn't
        // a real tag and shouldn't be clickable-to-filter.
        tagId: z.number().nullable()
      })).optional(),
      // CUSTOM-JOURNAL: location distribution for requirement 9 ("locations, moods, trends").
      // Sourced from notes.metadata.location.name (see docs/workstreams/08-analytics-view.md
      // for the expected shape) — an admin-facing capture flow doesn't exist yet, so this is
      // forward-compatible plumbing: it stays empty (and the chart stays hidden) until
      // location capture writes that field.
      locationStats: z.array(z.object({
        locationName: z.string(),
        count: z.number()
      })).optional(),
      // CUSTOM-JOURNAL: per-day average score (0-100) for every active
      // moodAxis, over days in the selected month that have at least one
      // AI-scored note. `series` is keyed by moodAxis.id (as a string,
      // matching notes.moodScores) to an array aligned 1:1 with `days`; a
      // null entry means no scored note that day (kept, rather than
      // dropped, so the frontend line chart shows a real gap).
      moodStats: z.object({
        axes: z.array(z.object({
          id: z.number(),
          positiveLabel: z.string(),
          negativeLabel: z.string().nullable()
        })),
        days: z.array(z.string()),
        series: z.record(z.string(), z.array(z.number().nullable()))
      }).optional()
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
          id: true,
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
          count: tag._count.tagsToNote,
          tagId: tag.id
        }))
      ]

      if (otherTagsCount > 0) {
        finalTagStats.push({
          tagName: 'Others',
          count: otherTagsCount,
          tagId: null
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

      // CUSTOM-JOURNAL: mood trend -- average each moodAxis's score per day,
      // over days in the month that have at least one scored note. Done in
      // JS rather than SQL since moodScores is a JSONB blob keyed dynamically
      // by axis name (a per-axis raw-SQL aggregate would need one expression
      // per axis, rebuilt whenever axes are added/removed in AI Settings).
      const axes = await prisma.moodAxis.findMany({ orderBy: { sortOrder: 'asc' } })
      let moodStats: { axes: { id: number; positiveLabel: string; negativeLabel: string | null }[]; days: string[]; series: Record<string, (number | null)[]> } | undefined

      if (axes.length > 0) {
        const notesWithMood = await prisma.notes.findMany({
          where: {
            accountId: parseInt(ctx.id),
            createdAt: { gte: startDate, lte: endDate }
          },
          select: { createdAt: true, moodScores: true }
        })

        const byDay = new Map<string, { sums: Record<number, number>; counts: Record<number, number> }>()
        for (const note of notesWithMood) {
          if (!note.moodScores || typeof note.moodScores !== 'object') continue
          const day = dayjs(note.createdAt).format('YYYY-MM-DD')
          if (!byDay.has(day)) byDay.set(day, { sums: {}, counts: {} })
          const entry = byDay.get(day)!
          for (const axis of axes) {
            const val = (note.moodScores as Record<string, unknown>)[axis.positiveLabel]
            if (typeof val === 'number') {
              entry.sums[axis.id] = (entry.sums[axis.id] ?? 0) + val
              entry.counts[axis.id] = (entry.counts[axis.id] ?? 0) + 1
            }
          }
        }

        const days = Array.from(byDay.keys()).sort()
        if (days.length > 0) {
          const series: Record<string, (number | null)[]> = {}
          for (const axis of axes) {
            series[String(axis.id)] = days.map(day => {
              const entry = byDay.get(day)!
              const count = entry.counts[axis.id]
              return count ? Math.round((entry.sums[axis.id] / count) * 10) / 10 : null
            })
          }
          moodStats = {
            axes: axes.map(a => ({ id: a.id, positiveLabel: a.positiveLabel, negativeLabel: a.negativeLabel ?? null })),
            days,
            series
          }
        }
      }

      return {
        noteCount,
        totalWords,
        maxDailyWords,
        activeDays,
        tagStats: finalTagStats,
        locationStats: finalLocationStats,
        moodStats
      }
    }),

  // CUSTOM-JOURNAL: separate from monthlyStats on purpose -- the mood trend
  // chart has its own Week/Month/3 Months/YTD/1 Year/3 Years/All range
  // control, independent of the page's single month-picker (which also
  // drives noteCount/tagStats/locationStats, all of which make sense scoped
  // to one calendar month; mood trend doesn't). Reuses monthlyStats'
  // per-day mood-averaging approach (JS-side, since moodScores is a JSONB
  // blob keyed dynamically by axis name), but buckets by day/week/month
  // depending on range so a multi-year chart doesn't render thousands of
  // unreadable daily points.
  moodTrend: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/mood-trend', summary: 'Query mood trend over a time range', protect: true, tags: ['Analytics'] } })
    .input(z.object({
      range: z.enum(['week', 'month', '3months', 'ytd', '1year', '3years', 'all'])
    }))
    .output(z.object({
      axes: z.array(z.object({
        id: z.number(),
        positiveLabel: z.string(),
        negativeLabel: z.string().nullable()
      })),
      // CUSTOM-JOURNAL: tells the frontend how to format x-axis labels --
      // 'day'/'week' buckets are real YYYY-MM-DD dates (week = that week's
      // start), 'month' buckets are YYYY-MM-01 (first of month).
      bucket: z.enum(['day', 'week', 'month']),
      days: z.array(z.string()),
      series: z.record(z.string(), z.array(z.number().nullable()))
    }))
    .mutation(async function ({ ctx, input }) {
      const now = dayjs()
      let startDate: Date | undefined
      let bucket: 'day' | 'week' | 'month'
      switch (input.range) {
        case 'week':
          startDate = now.subtract(7, 'day').startOf('day').toDate()
          bucket = 'day'
          break
        case 'month':
          startDate = now.subtract(1, 'month').startOf('day').toDate()
          bucket = 'day'
          break
        case '3months':
          startDate = now.subtract(3, 'month').startOf('day').toDate()
          bucket = 'day'
          break
        case 'ytd':
          startDate = now.startOf('year').toDate()
          bucket = 'week'
          break
        case '1year':
          startDate = now.subtract(1, 'year').startOf('day').toDate()
          bucket = 'week'
          break
        case '3years':
          startDate = now.subtract(3, 'year').startOf('day').toDate()
          bucket = 'month'
          break
        case 'all':
          startDate = undefined
          bucket = 'month'
          break
      }

      const axes = await prisma.moodAxis.findMany({ orderBy: { sortOrder: 'asc' } })
      if (axes.length === 0) {
        return { axes: [], bucket, days: [], series: {} }
      }

      const notesWithMood = await prisma.notes.findMany({
        where: {
          accountId: parseInt(ctx.id),
          ...(startDate && { createdAt: { gte: startDate } })
        },
        select: { createdAt: true, moodScores: true }
      })

      const bucketKey = (d: Date): string => {
        const m = dayjs(d)
        if (bucket === 'day') return m.format('YYYY-MM-DD')
        if (bucket === 'week') return m.startOf('week').format('YYYY-MM-DD')
        return m.startOf('month').format('YYYY-MM-DD')
      }

      const byBucket = new Map<string, { sums: Record<number, number>; counts: Record<number, number> }>()
      for (const note of notesWithMood) {
        if (!note.moodScores || typeof note.moodScores !== 'object') continue
        const key = bucketKey(note.createdAt)
        if (!byBucket.has(key)) byBucket.set(key, { sums: {}, counts: {} })
        const entry = byBucket.get(key)!
        for (const axis of axes) {
          const val = (note.moodScores as Record<string, unknown>)[axis.positiveLabel]
          if (typeof val === 'number') {
            entry.sums[axis.id] = (entry.sums[axis.id] ?? 0) + val
            entry.counts[axis.id] = (entry.counts[axis.id] ?? 0) + 1
          }
        }
      }

      const days = Array.from(byBucket.keys()).sort()
      const series: Record<string, (number | null)[]> = {}
      for (const axis of axes) {
        series[String(axis.id)] = days.map(day => {
          const entry = byBucket.get(day)!
          const count = entry.counts[axis.id]
          return count ? Math.round((entry.sums[axis.id] / count) * 10) / 10 : null
        })
      }

      return {
        axes: axes.map(a => ({ id: a.id, positiveLabel: a.positiveLabel, negativeLabel: a.negativeLabel ?? null })),
        bucket,
        days,
        series
      }
    })
})