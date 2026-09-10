import { Card, CardBody, Button } from "@heroui/react"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import * as echarts from 'echarts'
import { useMediaQuery } from "usehooks-ts"
import { useNavigate } from "react-router-dom"
import { Icon } from '@/components/Common/Iconify/icons'

interface TagDistributionChartProps {
  tagStats: {
    tagName: string
    count: number
    // CUSTOM-JOURNAL: null for the synthetic "Others" bucket -- not a real
    // tag, so its slice isn't clickable-to-filter.
    tagId?: number | null
  }[]
}

export const TagDistributionChart = observer(({ tagStats }: TagDistributionChartProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const chartRef = useRef<HTMLDivElement>(null)
  let chart: echarts.ECharts | null = null
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [selected, setSelected] = useState<{ tagName: string; count: number; tagId: number } | null>(null)

  useEffect(() => {
    if (!chartRef.current) return

    if (!chart) {
      chart = echarts.init(chartRef.current)
    }

    const isDark = theme === 'dark'

    const option = {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)'
      },
      legend: {
        type: 'scroll',
        orient: isMobile ? 'horizontal' : 'vertical',
        right: isMobile ? 'center' : 10,
        top: isMobile ? 'bottom' : 'center',
        bottom: isMobile ? 0 : undefined,
        textStyle: {
          color: isDark ? '#fff' : '#000',
          fontSize: isMobile ? 12 : 14
        },
        pageTextStyle: {
          color: isDark ? '#fff' : '#000'
        },
        pageIconColor: isDark ? '#fff' : '#000',
        pageIconInactiveColor: isDark ? '#666' : '#aaa'
      },
      series: [
        {
          name: t('tag-distribution'),
          type: 'pie',
          radius: isMobile ? ['30%', '60%'] : ['40%', '70%'],
          center: isMobile ? ['50%', '40%'] : ['40%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 10,
            borderColor: isDark ? '#1f1f1f' : '#ffffff',
            borderWidth: 2
          },
          label: {
            show: !isMobile,
            position: 'outer',
            formatter: '{b}\n{d}%',
            color: isDark ? '#fff' : '#000'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: isMobile ? 12 : 14,
              fontWeight: 'bold'
            },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          },
          labelLine: {
            show: !isMobile,
            length: 15,
            length2: 10,
            smooth: true
          },
          data: tagStats.map(item => ({
            value: item.count,
            name: item.tagName === 'Others' ? t('other-tags') : item.tagName
          }))
        }
      ],
      color: [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#08AEEA', 
        '#2AF598', '#4FACFE', '#FF9A8B', '#FF6A88',
        '#A9C9FF', '#FEE140'
      ]
    }

    chart.setOption(option)

    chart.off('click')
    chart.on('click', (params: any) => {
      const stat = tagStats[params.dataIndex]
      if (stat?.tagId != null) {
        setSelected({ tagName: stat.tagName, count: stat.count, tagId: stat.tagId })
      }
    })

    const handleResize = () => {
      if (chart) {
        chart.resize()
        const newIsMobile = window.innerWidth < 768
        chart.setOption({
          legend: {
            orient: newIsMobile ? 'horizontal' : 'vertical',
            right: newIsMobile ? 'center' : 10,
            top: newIsMobile ? 'bottom' : 'center',
            bottom: newIsMobile ? 0 : undefined,
            textStyle: {
              fontSize: newIsMobile ? 12 : 14
            }
          },
          series: [{
            radius: newIsMobile ? ['30%', '60%'] : ['40%', '70%'],
            center: newIsMobile ? ['50%', '40%'] : ['40%', '50%'],
            label: {
              show: !newIsMobile
            },
            labelLine: {
              show: !newIsMobile
            }
          }]
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart?.dispose()
      chart = null
    }
  }, [tagStats, theme, t])

  return (
    <Card className="bg-background col-span-full" shadow="none">
      <CardBody>
        <p className="text-tiny uppercase font-bold mb-4">{t('tag-distribution')}</p>
        <div ref={chartRef} className="w-full h-[500px] md:h-[400px]" />
        {selected && (
          <div className="flex items-center justify-between gap-2 mt-2 p-3 rounded-xl bg-default-100">
            <div className="flex items-center gap-2 min-w-0">
              <Icon icon="solar:tags-bold" width="18" height="18" className="text-primary shrink-0" />
              <span className="font-bold truncate">#{selected.tagName}</span>
              <span className="text-default-400 text-tiny whitespace-nowrap">{selected.count} {t('entries')}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                color="primary"
                onPress={() => navigate(`/?path=all&tagId=${selected.tagId}`)}
              >
                {t('view-entries')}
              </Button>
              <Button size="sm" isIconOnly variant="light" onPress={() => setSelected(null)}>
                <Icon icon="mdi:close" width="16" height="16" />
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
})