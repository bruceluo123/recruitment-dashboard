"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFavorite } from "@/app/m/account/actions";

export function FavoriteButton({
  propertyId,
  initialFavorited,
}: {
  propertyId: string;
  initialFavorited: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    startTransition(async () => {
      const res = await toggleFavorite(propertyId);
      if (res.needLogin) {
        router.push(`/m/login?redirect=${encodeURIComponent(`/m/p/${propertyId}`)}`);
        return;
      }
      setFavorited(res.favorited);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={favorited}
      className={`m-fav ${favorited ? "on" : ""}`}
    >
      <svg viewBox="0 0 24 24" fill={favorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
      <span>{favorited ? "已收藏" : "收藏"}</span>
    </button>
  );
}
