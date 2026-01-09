import React, { useState, useRef, useEffect } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { he } from 'date-fns/locale';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from 'lucide-react';

type Props = {
  value: string;
  onChange: (date: string) => void;
  className?: string;
  label?: string;
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
};

export function DatePicker({ value, onChange, className, label, align = 'right', direction = 'down' }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  // Create a Date object from the YYYY-MM-DD string
  // If value is invalid, fallback to today
  const selectedDate = value ? new Date(value) : new Date();

  const [currentMonth, setCurrentMonth] = useState(startOfMonth(selectedDate));

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // If external value changes significantly, maybe update view? 
    // For now, let's keep the user's navigation state unless they reopen.
  }, [value]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const handleDayClick = (day: Date) => {
    // Format as YYYY-MM-DD to match the native date input format and our DB expectation
    const isoDate = format(day, 'yyyy-MM-dd');
    onChange(isoDate);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      {label && <label className="text-xs text-zinc-400 block mb-1.5 font-medium">{label}</label>}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between rounded-xl border border-white/5 bg-zinc-800/50 px-4 py-3 text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-right ${isOpen ? 'ring-2 ring-indigo-500/50 border-indigo-500/30' : ''}`}
      >
        <span className="flex items-center gap-2 text-zinc-300">
          <CalendarIcon className="w-4 h-4 text-zinc-400" />
          {format(selectedDate, 'dd/MM/yyyy')}
        </span>
      </button>

      {isOpen && (
        <div className={`
          absolute z-50 p-4 rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans w-72
          ${align === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right'}
          ${direction === 'up' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'}
        `}>

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={nextMonth} className="p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="font-semibold text-zinc-200">
              {format(currentMonth, 'MMMM yyyy', { locale: he })}
            </span>
            <button type="button" onClick={prevMonth} className="p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs mb-2">
            {['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map(d => (
              <div key={d} className="text-zinc-500 font-medium py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const isSelected = isSameDay(day, selectedDate);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isTodayDate = isToday(day);

              return (
                <button
                  key={day.toString()}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`
                    h-8 w-8 rounded-lg text-sm flex items-center justify-center transition-all
                    ${!isCurrentMonth ? 'text-zinc-700' : ''}
                    ${isCurrentMonth && !isSelected ? 'text-zinc-300 hover:bg-white/5 hover:text-white' : ''}
                    ${isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 font-semibold' : ''}
                    ${isTodayDate && !isSelected ? 'text-indigo-400 ring-1 ring-indigo-500/30 font-medium' : ''}
                  `}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
