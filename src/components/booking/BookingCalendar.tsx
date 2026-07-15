import { useEffect, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isAfter, isBefore, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface BookingCalendarProps {
  checkInDate: string;
  checkOutDate: string;
  disabled?: boolean;
  onChange: (next: { checkInDate: string; checkOutDate: string }) => void;
}

function parseLocalDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateValue(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default function BookingCalendar({ checkInDate, checkOutDate, disabled = false, onChange }: BookingCalendarProps) {
  const today = new Date();
  const [activeMonth, setActiveMonth] = useState(() => startOfMonth(parseLocalDate(checkInDate)));

  useEffect(() => {
    setActiveMonth(startOfMonth(parseLocalDate(checkInDate)));
  }, [checkInDate]);

  const selectedCheckIn = parseLocalDate(checkInDate);
  const selectedCheckOut = checkOutDate ? parseLocalDate(checkOutDate) : null;
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(activeMonth), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(activeMonth), { weekStartsOn: 0 }),
  });

  const handleSelectDate = (selectedDate: Date) => {
    if (disabled || isBefore(selectedDate, startOfDay(today))) {
      return;
    }

    const selectedValue = toDateValue(selectedDate);

    if (!checkInDate || (checkInDate && checkOutDate)) {
      onChange({ checkInDate: selectedValue, checkOutDate: '' });
      return;
    }

    if (isSameDay(selectedDate, selectedCheckIn) || isBefore(selectedDate, selectedCheckIn)) {
      onChange({ checkInDate: selectedValue, checkOutDate: '' });
      return;
    }

    onChange({ checkInDate, checkOutDate: selectedValue });
  };

  const clearSelection = () => {
    if (disabled) {
      return;
    }

    const fallbackCheckIn = toDateValue(addMonths(startOfDay(today), 1));
    onChange({ checkInDate: fallbackCheckIn, checkOutDate: '' });
  };

  return (
    <section className="rounded-3xl border border-brand-primary/10 bg-brand-cream p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-primary mb-2">Stay schedule</p>
          <h3 className="text-2xl font-serif font-bold text-brand-dark">Choose your dates</h3>
          <p className="text-sm font-bold text-brand-dark/60 mt-2">Pick the stay window that works best for your plans.</p>
        </div>

        <button
          type="button"
          onClick={clearSelection}
          disabled={disabled}
          className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/60 hover:text-brand-primary disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 mb-5">
        <button
          type="button"
          onClick={() => setActiveMonth(current => addMonths(current, -1))}
          disabled={disabled}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-primary/10 bg-brand-background/80 text-brand-dark hover:bg-brand-primary hover:text-brand-cream disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-center">
          <CalendarDays className="w-4 h-4 text-brand-primary" />
          <p className="text-sm font-bold uppercase tracking-widest text-brand-dark">{format(activeMonth, 'MMMM yyyy')}</p>
        </div>

        <button
          type="button"
          onClick={() => setActiveMonth(current => addMonths(current, 1))}
          disabled={disabled}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-primary/10 bg-brand-background/80 text-brand-dark hover:bg-brand-primary hover:text-brand-cream disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest text-brand-dark/40">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="text-center">{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {monthDays.map(day => {
          const isCurrentMonth = isSameMonth(day, activeMonth);
          const isBeforeToday = isBefore(day, startOfDay(today));
          const isStart = isSameDay(day, selectedCheckIn);
          const isEnd = selectedCheckOut ? isSameDay(day, selectedCheckOut) : false;
          const isInRange = selectedCheckOut ? isAfter(day, selectedCheckIn) && isBefore(day, selectedCheckOut) : false;
          const isToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => handleSelectDate(day)}
              disabled={disabled || isBeforeToday}
              className={`relative h-12 rounded-2xl border text-sm font-bold transition-all ${
                isStart || isEnd
                  ? 'border-brand-primary bg-brand-primary text-brand-cream shadow-md'
                  : isInRange
                    ? 'border-brand-primary/20 bg-brand-primary/10 text-brand-dark'
                    : isToday
                      ? 'border-brand-primary/40 bg-brand-background text-brand-primary'
                      : isCurrentMonth
                        ? 'border-brand-primary/10 bg-brand-cream text-brand-dark hover:border-brand-primary/40 hover:bg-brand-background'
                        : 'border-transparent bg-transparent text-brand-dark/25'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span className="relative z-10">{format(day, 'd')}</span>
              {isStart || isEnd ? <span className="absolute inset-0 rounded-2xl ring-2 ring-brand-primary/30" /> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-[10px] font-bold uppercase tracking-widest text-brand-dark/60">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-brand-primary" /> Check-in / check-out
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border border-brand-primary/30 bg-brand-background" /> Available date
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-brand-primary/10" /> In range
        </span>
      </div>
    </section>
  );
}