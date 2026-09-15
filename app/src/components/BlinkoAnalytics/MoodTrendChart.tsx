import { Button, Card, CardBody } from "@heroui/react"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import * as echarts from 'echarts'
import dayjs from "dayjs"
import { getMoodColor } from "@/components/Common/SentimentView"
import { api } from "@/lib/trpc"

type MoodTrendRange = 'week' | 'month' | '3months' | 'ytd' | '1year' | '3years' | 'all'

interface MoodStats {
  axes: { id: number; positiveLabel: string; negativeLabel: string | null }[]
  bucket: 'day' | 'week' | 'month'
  days: string[]
  series: Record<string, (number | null)[]>
}

// CUSTOM-JOURNAL: the 7 range options for the mood trend chart's own time
// scope, independent of the analytics page's month picker (see
// server/routerTrpc/analytics.ts's moodTrend procedure for why this is a
// separate query rather than reusing monthlyStats).
const RANGE_OPTIONS: { value: MoodTrendRange; labelKey: string }[] = [
  { value: 'week', labelKey: 'mood-trend-range-week' },
  { value: 'month', labelKey: 'mood-trend-range-month' },
  { value: '3months', labelKey: 'mood-trend-range-3months' },
  { value: 'ytd', labelKey: 'mood-trend-range-ytd' },
  { value: '1year', labelKey: 'mood-trend-range-1year' },
  { value: '3years', labelKey: 'mood-trend-range-3years' },
  { value: 'all', labelKey: 'all' },
]

// CUSTOM-JOURNAL: line chart of each moodAxis's average score (0-100) over
// the selected time range -- "sentiment data on the analysis page, trends
// over time". Mirrors TagDistributionChart's init/resize/dispose pattern.
// Every axis renders as its own line, colored to match the per-note "View
// Sentiments" view (SentimentView's getMoodColor); the legend is clickable
// (built-in echarts behavior) so a crowded default set of 9 axes stays
// readable. Self-contained (fetches its own data via api.analytics.moodTrend
// rather than taking it as a prop) so its range control is independent of
// the page-level month picker driving the rest of the Analytics page.
export const MoodTrendChart = observer(() => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const chartRef = useRef<HTMLDivElement>(null)
  let chart: echarts.ECharts | null = null

  const [range, setRange] = useState<MoodTrendRange>('month')
  const [moodStats, setMoodStats] = useState<MoodStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    api.analytics.moodTrend.mutate({ range })
      .then(setMoodStats)
      .catch(() => setMoodStats(null))
      .finally(() => setIsLoading(false))
  }, [range])

  useEffect(() => {
    if (!chartRef.current || !moodStats || moodStats.days.length === 0) return
    if (!chart) {
      chart = echarts.init(chartRef.current)
    }

    const isDark = theme === 'dark'
    const axisTextColor = isDark ? '#aaa' : '#666'
    // CUSTOM-JOURNAL: month-bucketed days are 'YYYY-MM-01' (see the backend's
    // bucketKey) -- showing just 'MM-DD' there would always read "01",
    // misleadingly implying daily granularity, so month buckets get a
    // year+month label instead. Week buckets are real dates (that week's
    // start), so 'MM-DD' is accurate for those same as day buckets.
    const formatLabel = (d: string) => moodStats.bucket === 'month' ? dayjs(d).format('YYYY-MM') : dayjs(d).format('MM-DD')

    const option = {
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: isDark ? '#fff' : '#000', fontSize: 12 }
      },
      grid: {
        left: 40,
        right: 20,
        top: 40,
        bottom: 30
      },
      xAxis: {
        type: 'category',
        data: moodStats.days.map(formatLabel),
        axisLabel: { color: axisTextColor, fontSize: 11 },
        axisLine: { lineStyle: { color: axisTextColor } }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: axisTextColor, fontSize: 11 },
        splitLine: { lineStyle: { color: isDark ? '#333' : '#eee' } }
      },
      series: moodStats.axes.map((axis, index) => {
        const color = getMoodColor(axis.negativeLabel ? 'positive' : axis.positiveLabel, index)
        return {
          name: axis.positiveLabel,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          connectNulls: true,
          data: moodStats.series[String(axis.id)] ?? [],
          color,
          lineStyle: { width: 2 }
        }
      }),
      color: moodStats.axes.map((axis, index) => getMoodColor(axis.negativeLabel ? 'positive' : axis.positiveLabel, index))
    }

    chart.setOption(option, true)

    const handleResize = () => chart?.resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart?.dispose()
      chart = null
    }
  }, [moodStats, theme])

  return (
    <Card className="bg-background col-span-full" shadow="none">
      <CardBody>
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-tiny uppercase font-bold">{t('mood-trend')}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGE_OPTIONS.map(option => (
              <Button
                key={option.value}
                size="sm"
                variant={range === option.value ? 'solid' : 'flat'}
                color={range === option.value ? 'primary' : 'default'}
                onPress={() => setRange(option.value)}
              >
                {t(option.labelKey)}
              </Button>
            ))}
          </div>
        </div>
        {!isLoading && (!moodStats || moodStats.days.length === 0) ? (
          <div className="text-desc text-sm text-center py-12">{t('no-sentiment-data')}</div>
        ) : (
          <div ref={chartRef} className="w-full h-[400px]" />
        )}
      </CardBody>
    </Card>
  )
})
