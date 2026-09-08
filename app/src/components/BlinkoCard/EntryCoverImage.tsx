// CUSTOM-JOURNAL: per-entry cover image, rendered above CardHeader. Falls
// back to a deterministic (hashed by note id, not random-per-render) warm
// gradient strip when no cover photo is set, reviving cardBlogBox.tsx's
// previously-unused gradientPairs concept for free visual variety across
// entries with zero new asset work. See
// docs/workstreams/09-entry-personalization.md §3.3/§1i.
import { gradientForNoteId, getAuthenticatedImageUrl } from '@/lib/personalization';
import { Note } from '@shared/lib/types';

interface Props {
  blinkoItem: Note & { id?: number };
}

export const EntryCoverImage = ({ blinkoItem }: Props) => {
  const coverImagePath = blinkoItem.metadata?.personalization?.coverImagePath;

  if (coverImagePath) {
    return (
      <div className="w-full h-28 -mx-4 -mt-4 mb-3 overflow-hidden" style={{ width: 'calc(100% + 2rem)' }}>
        <img
          // CUSTOM-JOURNAL: a standalone-uploaded cover image (not attached to any
          // note) 401s from the file route without a token - see
          // getAuthenticatedImageUrl's comment in personalization.ts.
          src={getAuthenticatedImageUrl(coverImagePath)}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const [from, to] = gradientForNoteId(blinkoItem.id);
  return (
    <div
      className="w-full h-2 -mx-4 -mt-4 mb-3 rounded-t-md"
      style={{ width: 'calc(100% + 2rem)', backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }}
    />
  );
};
