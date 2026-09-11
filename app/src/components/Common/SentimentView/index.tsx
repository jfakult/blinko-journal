import { useTranslation } from 'react-i18next';
import { moodAxis } from '@shared/lib/prismaZodType';

// CUSTOM-JOURNAL: per-axis colors for the sentiment view (right-click menu
// -> "View Sentiments") and the Analytics mood trend chart, so both stay
// visually consistent. Keyed by the seeded default axis labels
// (prisma/seed.ts's seedDefaultMoodAxes); anything else (a user-added axis)
// falls back to cycling through FALLBACK_PALETTE by sort position.
const MOOD_COLORS: Record<string, string> = {
  positive: '#22C55E',
  anger: '#EF4444',
  anxiety: '#F59E0B',
  joy: '#FACC15',
  sadness: '#3B82F6',
  surprise: '#A855F7',
  fear: '#6366F1',
  excitement: '#FB923C',
  gratitude: '#14B8A6',
};
const FALLBACK_PALETTE = ['#F472B6', '#38BDF8', '#A3E635', '#FB7185', '#2DD4BF', '#C084FC'];

export function getMoodColor(label: string, index: number): string {
  return MOOD_COLORS[label.toLowerCase()] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

const BipolarRow = ({ axis, score, color }: { axis: moodAxis; score: number; color: string }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-desc">
        <span className="capitalize">{axis.negativeLabel}</span>
        <span className="capitalize">{axis.positiveLabel}</span>
      </div>
      <div className="relative h-2 rounded-full bg-default-200 overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-default-400/60" />
        <div
          className="absolute inset-y-0 rounded-full transition-all"
          style={
            score >= 50
              ? { left: '50%', width: `${score - 50}%`, background: color }
              : { right: '50%', width: `${50 - score}%`, background: color }
          }
        />
      </div>
      <div className="text-tiny text-desc text-center">{t('sentiment-score-of-100', { score: Math.round(score) })}</div>
    </div>
  );
};

const UnipolarRow = ({ axis, score, color }: { axis: moodAxis; score: number; color: string }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize font-medium">{axis.positiveLabel}</span>
        <span className="text-desc">{Math.round(score)}</span>
      </div>
      <div className="h-2 rounded-full bg-default-200 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }}
        />
      </div>
    </div>
  );
};

interface SentimentViewProps {
  axes: moodAxis[];
  moodScores: Record<string, number> | null | undefined;
}

// CUSTOM-JOURNAL: renders one note's mood-axis scores (notes.moodScores,
// keyed by moodAxis.id as a string, each 0-100) as colored bars -- a bipolar
// axis (negativeLabel set, e.g. the seeded "positive/negative" valence axis)
// renders as a two-sided bar around a center line; a unipolar intensity axis
// (e.g. "joy", 0 = absent) renders as a simple fill. Used by both the
// right-click "View Sentiments" dialog (BlinkoRightClickMenu) and could be
// reused anywhere else a note's mood needs to be shown.
export const SentimentView = ({ axes, moodScores }: SentimentViewProps) => {
  const { t } = useTranslation();
  const scored = axes.filter((axis) => moodScores != null && moodScores[String(axis.id)] != null);

  if (scored.length === 0) {
    return <div className="text-desc text-sm text-center py-6">{t('no-sentiment-data')}</div>;
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {scored.map((axis, index) => {
        const score = Number(moodScores![String(axis.id)]);
        const color = getMoodColor(axis.negativeLabel ? 'positive' : axis.positiveLabel, index);
        return axis.negativeLabel
          ? <BipolarRow key={axis.id} axis={axis} score={score} color={color} />
          : <UnipolarRow key={axis.id} axis={axis} score={score} color={color} />;
      })}
    </div>
  );
};
