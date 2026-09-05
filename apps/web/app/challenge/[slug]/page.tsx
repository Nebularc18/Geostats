"use client";

import { useParams } from "next/navigation";
import { PublicChallengeResult } from "../../../components/public-challenge-result";

export default function PublicChallengePage() {
  const { slug } = useParams<{ slug: string }>();
  return <PublicChallengeResult path={encodeURIComponent(slug)} />;
}
