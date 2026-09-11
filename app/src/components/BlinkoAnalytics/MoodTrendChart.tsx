import { Card, CardBody } from "@heroui/react"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { useEffect, useRef } from "react"
import * as echarts from 'echarts'
import dayjs from "dayjs"
import { getMoodColor } from "@/components/Common/SentimentView"

interface MoodTrendChartProps {
  moodStats: {
    axes: { id: number; positiveLabel: string; negativeLabel: string | null }[]
    days: string[]
    series: Record<string, (number | null)[]>
  }
}

// CUSTOM-JOURNAL: line chart of each moodAxis's daily average score (0-100)
// across the selected month -- "sentiment data on the analysis page,
// trends over time". Mirrors TagDistributionChart's init/resize/dispose
// pattern. Every axis renders as its own line, colored to match the
// per-note "View Sentiments" view (SentimentView's getMoodColor); the
// legend is clickable (built-in echarts behavior) so a crowded default set
// of 9 axes stays readable.
export const MoodTrendChart = observer(({ moodStats }: MoodTrendChartProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const chartRef = useRef<HTMLDivElement>(null)
  let chart: echarts.ECharts | null = null

  useEffect(() => {
    if (!chartRef.current) return
    if (!chart) {
      chart = echarts.init(chartRef.current)
    }

    const isDark = theme === 'dark'
    const axisTextColor = isDark ? '#aaa' : '#666'

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
        data: moodStats.days.map(d => dayjs(d).format('MM-DD')),
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

    chart.setOption(option)

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
        <p className="text-tiny uppercase font-bold mb-4">{t('mood-trend')}</p>
        <div ref={chartRef} className="w-full h-[400px]" />
      </CardBody>
    </Card>
  )
})
