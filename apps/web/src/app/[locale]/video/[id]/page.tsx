'use client';

import React from "react";
import { useParams } from "next/navigation";
import WatchPageContent from "@/components/video/WatchPageContent";

export default function VideoViewPage() {
  const params = useParams();
  const videoId = params.id as string;

  return <WatchPageContent videoId={videoId} />;
}
