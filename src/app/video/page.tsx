"use client";
import React, { useState, useEffect } from 'react';
import { ThemeProvider } from "@material-tailwind/react"; // External library imports
import { useQueryState } from 'nuqs'

// Local imports
import { darkModeStore } from "@/components/darkMode";
import { CommentProps } from '@/components/comment';
import RelatedVideosSection from '@/components/related';
import CommentsSection from '@/components/commentsSection';
import Header from '@/components/Header';
import LeftNavigationWithOverlay from '@/components/LeftNavigationWithOverlay';
import VideoPlayer, { PlayerOptions } from '@/components/videoPlayer';
import { PaginationResponse, VideoInfo, VideoObject } from '../../interfaces';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [darkmode, setDarkmode] = React.useState(darkModeStore.get());
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [videoDetails, setVideoDetails] = useState<PlayerOptions | null>(null); // Add this state
  const [vid, setVid] = useQueryState('vid', { shallow: false });

  useEffect(() => {
    setIsMounted(true); // Ensure the component is mounted on the client
  }, []);


  useEffect(() => {
    return darkModeStore.subscribe(setDarkmode);
  }, []);

  useEffect(() => {
    if (darkmode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkmode]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Fetch video by ID from query string
  useEffect(() => {
    if (!isMounted) return;

    const fetchVideoById = async () => {
      if (!vid) return;

      try {
        const response = await fetch(`https://videos.api.alummahnow.net/api/videos/${vid}`);
        if (!response.ok) {
          throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const video: VideoObject = await response.json();
        setVideoDetails({
          id: video.id,
          title: video.title,
          description: video.description,
          channel: video.channel,
          url: video.videoUrl,
          views: `${video.views || 0}`,
          dateCreated: new Date(video.dateCreated),
          autoplay: false,
          type: "video/mp4",
        });
      } catch (error) {
        console.error(error);
      }
    };

    fetchVideoById();
  }, [vid, isMounted]); // Add this useEffect

  // Fetch related videos from the API
  useEffect(() => {
    const fetchRelatedVideos = async () => {
      try {
        const response = await fetch('https://videos.api.alummahnow.net/api/videos?limit=15'); // Fetch first 5 related videos
        if (!response.ok) {
          throw new Error(`Error fetching related videos: ${response.statusText}`);
        }
        const result: PaginationResponse<VideoObject> = await response.json();
        setRelatedVideos(result.data.map(video => ({
          id: video.id,
          title: video.title,
          description: video.description,
          channel: video.channel,
          channelId: video.channelId,
          thumbnail: video.thumbnailUrl,
          video: video.videoUrl,
          views: `${video.views || 0}`,
          dateCreated: new Date(video.dateCreated),
          dateModified: new Date(video.dateModified)
        })));
      } catch (error) {
        console.error(error);
      }
    };

    fetchRelatedVideos();
  }, []);

  const comments: CommentProps[] = [
    {
      author: "User1",
      text: "This is a great video!",
      time: "2 hours ago",
      avatar: "/avatar.png"
    },
    {
      author: "User2",
      text: "Very informative, thanks for sharing.",
      time: "1 day ago",
      avatar: "/avatar.png"
    },
    // Add more comments here
  ];

  return (
    <ThemeProvider value={{}}>
      <div className="flex flex-col min-h-screen bg-ummah-bg">
        {/* Header */}
        <Header toggleCollapse={toggleCollapse} />
          {/* Left Navigation */}
          <LeftNavigationWithOverlay 
            isCollapsed={isCollapsed} 
            onCollapse={() => setIsCollapsed(true)} 
          />

        <div className="flex flex-1 flex-col md:flex-row">

          <main className="flex flex-col items-center justify-between p-4 w-full mt-0 lg:mt-0">
            {/* Video Player Section */}
            {videoDetails && (
              <div className="w-full mt-0">
                <VideoPlayer options={videoDetails} />
              </div>
            )}
            <div className="flex flex-col lg:flex-row w-full mt-4 gap-6">
              {/* Comments Section */}
              <div className="w-full lg:w-3/5 p-4">
              {/*   <CommentsSection comments={comments} />*/}
              </div> 

              {/* Related Videos Section */}
              <div className="w-full lg:w-2/5 pt-4">
                <RelatedVideosSection relatedVideos={relatedVideos} />
              </div>
            </div>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}