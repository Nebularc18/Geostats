"use client";

import { useParams } from "next/navigation";
import { PublicChallengeResult } from "../../../../components/public-challenge-result";

export default function PublicChallengeForCachePage() {
  const { slug: username, gcCode } = useParams<{ slug: string; gcCode: string }>();
  return <PublicChallengeResult path={`${encodeURIComponent(username)}/${encodeURIComponent(gcCode)}`} />;
}
