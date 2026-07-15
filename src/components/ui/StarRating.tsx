import { Star } from 'lucide-react';

interface StarRatingProps {
  rating: number;
  maxStars?: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onRate?: (rating: number) => void;
  showValue?: boolean;
}

export default function StarRating({
  rating,
  maxStars = 5,
  size = 'md',
  interactive = false,
  onRate,
  showValue = false,
}: StarRatingProps) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-6 h-6' : 'w-4.5 h-4.5';

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: maxStars }).map((_, i) => {
        const filled = i < Math.floor(rating);
        const partial = !filled && i < rating;
        return (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onRate?.(i + 1)}
            className={`focus:outline-none ${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}`}
            aria-label={interactive ? `Rate ${i + 1} star${i !== 0 ? 's' : ''}` : undefined}
          >
            <Star
              className={`${sizeClass} transition-colors ${
                filled
                  ? 'fill-brand-star text-brand-star'
                  : partial
                    ? 'fill-brand-star/50 text-brand-star'
                    : 'fill-transparent text-brand-secondary/40'
              }`}
            />
          </button>
        );
      })}
      {showValue && (
        <span className="ml-1 text-sm font-bold text-brand-dark">
          {rating > 0 ? rating.toFixed(1) : 'No rating'}
        </span>
      )}
    </div>
  );
}
