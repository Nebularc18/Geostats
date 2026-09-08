"use client";

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type CalendarGridData = {
  days: Record<string, number>;
  perDay: number;
  allowLeapDaySkip: boolean;
};

function cellKey(month: number, day: number) {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function CalendarGrid({ calendar }: { calendar: CalendarGridData }) {
  const dayHeaders = Array.from({ length: 31 }, (_, index) => index + 1);
  return (
    <div className="calendar-grid">
      <table>
        <caption>
          Numbers in red are finds still needed that day.
          {calendar.allowLeapDaySkip ? " Leap day may be skipped." : ""}
        </caption>
        <thead>
          <tr>
            <th aria-label="Month" />
            {dayHeaders.map((day) => (
              <th key={day}>{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS_IN_MONTH.map((monthLength, monthIndex) => {
            const month = monthIndex + 1;
            return (
              <tr key={month}>
                <th>{month}</th>
                {dayHeaders.map((day) => {
                  if (day > monthLength) {
                    return (
                      <td key={day} className="invalid">
                        X
                      </td>
                    );
                  }
                  const key = cellKey(month, day);
                  const count = calendar.days[key] ?? 0;
                  if (count >= calendar.perDay) {
                    return (
                      <td key={day} className="done" title={`${count} find${count === 1 ? "" : "s"}`}>
                        ✓
                      </td>
                    );
                  }
                  const needed = calendar.perDay - count;
                  const skippable = calendar.allowLeapDaySkip && key === "02-29";
                  return (
                    <td key={day} className="missing">
                      {skippable ? `(${needed})` : needed}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
