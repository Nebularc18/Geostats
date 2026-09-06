import { LockKeyhole, type LucideIcon } from "lucide-react";

const families: Record<string, string> = {
  "long-distance": "ocean", traveling: "ocean", "all-around": "ocean", earth: "ocean",
  attribute: "forest", large: "forest", traditional: "forest", environmental: "forest",
  small: "forest", regular: "forest", owner: "forest",
  brainiac: "violet", mystery: "violet", matrix: "violet", diverse: "violet",
  "odd-sized": "violet", wherigo: "violet", "gps-maze": "violet",
  adventurous: "clay", rugged: "clay", busy: "clay", daily: "clay",
  social: "rose", "mega-social": "rose", "giga-social": "rose", "event-host": "rose",
  "favorited-owner": "rose", virtual: "rose"
};

export function BadgeEmblem({
  badgeId, icon: Icon, tierClass, level
}: { badgeId: string; icon: LucideIcon; tierClass: string; level: number }) {
  return (
    <span className={`badge-picture enamel ${tierClass} enamel-${families[badgeId] ?? "honey"}`} aria-hidden="true">
      <span className="enamel-rim">
        <span className="enamel-face">
          <svg className="enamel-contours" viewBox="0 0 100 100" fill="none">
            <path d="M-10 70C5 35 35 85 64 59S108 41 115 22M-10 81C6 46 35 96 64 70S108 52 115 33M-10 92C6 57 35 107 64 81S108 63 115 44" />
            <circle cx="73" cy="23" r="6" />
          </svg>
          <Icon className="enamel-icon" size={38} strokeWidth={2.4} />
        </span>
      </span>
      <span className="enamel-level">
        {level < 0 ? <LockKeyhole size={10} strokeWidth={2.4} /> : (
          <><svg viewBox="0 0 10 10" width="8" height="8" fill="currentColor"><path d="m5 0 1.5 3.4L10 4l-2.5 2.5.6 3.5L5 8.3 1.9 10l.6-3.5L0 4l3.5-.6Z" /></svg><span>{level + 1}</span></>
        )}
      </span>
    </span>
  );
}
