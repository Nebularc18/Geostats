"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { API_URL } from "../lib/api";
import { formatCacherDateTime } from "../lib/format-time";

type Evidence = { date: string; gcCode: string; name: string };
type PublicResult = {
  checker: { name: string; gcCode: string | null; description: string | null };
  username: string;
  timeZone: string;
  passed: boolean;
  checkedAt: string;
  dataUpdatedAt: string | null;
  rules: Array<{
    label: string;
    current: number;
    required: number;
    passed: boolean;
    detail: string;
    evidence: Evidence[];
    evidenceLimited: boolean;
  }>;
};

export function PublicChallengeResult({ path }: { path: string }) {
  const [result, setResult] = useState<PublicResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    void fetch(`${API_URL}/public/challenge-checkers/${path}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("This result is unavailable or no longer published.");
        setResult(await response.json());
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [path]);
  return (
    <main className="public-challenge-page">
      <a className="brand public-challenge-brand" href="/">
        <img className="brand-mark" src="/geostats-icon.svg" alt="" />
        <span>
          <strong>Geostats</strong>
          <small>challenge result</small>
        </span>
      </a>
      {error ? (
        <section className="panel">
          <h1>Result unavailable</h1>
          <p className="error">{error}</p>
        </section>
      ) : !result ? (
        <section className="panel">Checking imported find data…</section>
      ) : (
        <section
          className={`panel public-challenge-result ${result.passed ? "pass" : "fail"}`}
        >
          <p className="eyebrow">
            {result.checker.gcCode || "Challenge checker"}
          </p>
          <div className="public-challenge-verdict">
            {result.passed ? <Check size={38} /> : <X size={38} />}
            <div>
              <h1>{result.passed ? "Qualified" : "Not yet qualified"}</h1>
              <p>
                {result.username} · {result.checker.name}
              </p>
            </div>
          </div>
          {result.checker.description && (
            <p className="public-challenge-description">
              {result.checker.description}
            </p>
          )}
          <div className="challenge-result-rules">
            {result.rules.map((rule, index) => (
              <div key={index}>
                <span>
                  {rule.passed ? <Check size={17} /> : <X size={17} />}
                  {rule.label}
                </span>
                <strong>
                  {rule.current.toLocaleString()} /{" "}
                  {rule.required.toLocaleString()}
                </strong>
                <small>{rule.detail}</small>
                <EvidenceList
                  evidence={rule.evidence}
                  limited={rule.evidenceLimited}
                />
              </div>
            ))}
          </div>
          <div className="public-challenge-meta">
            <span>
              Checked {formatCacherDateTime(result.checkedAt, result.timeZone)}
            </span>
            <span>
              Find data updated{" "}
              {result.dataUpdatedAt
                ? formatCacherDateTime(result.dataUpdatedAt, result.timeZone)
                : "unknown"}
            </span>
          </div>
          <p className="muted public-challenge-disclaimer">
            This independent result uses data imported by the geocacher. Verify
            it against the cache requirements; it is not an official Project-GC
            checker result.
          </p>
        </section>
      )}
    </main>
  );
}

function EvidenceList({
  evidence,
  limited,
}: {
  evidence: Evidence[];
  limited: boolean;
}) {
  if (!evidence.length) return null;
  return (
    <details className="challenge-evidence">
      <summary>
        View supporting finds ({evidence.length}
        {limited ? "+" : ""})
      </summary>
      <div>
        {evidence.map((row, index) => (
          <p key={`${row.gcCode}-${row.date}-${index}`}>
            <time>{row.date}</time>
            <a
              href={`https://coord.info/${row.gcCode}`}
              target="_blank"
              rel="noreferrer"
            >
              {row.gcCode}
            </a>
            <span>{row.name}</span>
          </p>
        ))}
      </div>
      {limited && <small>Showing the first 500 supporting finds.</small>}
    </details>
  );
}
