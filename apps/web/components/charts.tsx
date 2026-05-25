"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function CountBarChart({ data }: { data: { key: string; count: number }[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="key" tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" />
          <Tooltip
            contentStyle={{
              background: "var(--panel-strong)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              color: "var(--ink)"
            }}
            cursor={{ fill: "rgba(95, 191, 133, 0.08)" }}
            labelStyle={{ color: "var(--ink)" }}
          />
          <Bar dataKey="count" fill="var(--green)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CumulativeFindsChart({ data }: { data: { key: string; count: number }[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="key" tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" />
          <Tooltip
            contentStyle={{
              background: "var(--panel-strong)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              color: "var(--ink)"
            }}
            labelStyle={{ color: "var(--ink)" }}
          />
          <Area
            type="monotone"
            dataKey="count"
            name="Cumulative total"
            stroke="var(--green)"
            fill="rgba(95, 191, 133, 0.22)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
