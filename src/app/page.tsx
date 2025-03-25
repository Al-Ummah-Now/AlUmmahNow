"use client";
import React, { useState, useEffect } from 'react';
import { RelatedVideoProps } from '@/lib/relatedVideo';
import RelatedVideosSection from '@/lib/related';
import CommentsSection from '@/lib/commentsSection';
import { CommentProps } from '@/lib/comment';
import Header from '@/lib/Header';
import LeftNavigation from '@/lib/LeftNavigation';
import VideoPlayer, { PlayerOptions } from '@/lib/videoPlayer';
import { ThemeProvider } from "@material-tailwind/react";
import { darkModeStore } from "../lib/darkMode";

export default function Home() {
  const [isCollapsed, setIsCollapsed] = useState(false);    
    const [darkmode, setDarkmode] = React.useState(darkModeStore.get());
   
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

  const videoOptions:PlayerOptions = {
    autoplay: true,
    url: "https://alummahnow-mostafa-elbadry.b-cdn.net/Mostafa%20Elbadry/%D8%A7%D9%84%D8%AA%D8%B9%D9%82%D9%8A%D8%A8%20%D8%B9%D9%84%D9%89%20%D8%A7%D9%84%D9%86%D8%B5%D8%A7%D8%A6%D8%AD%20%D9%88%D8%A7%D9%84%D8%AA%D9%88%D8%AC%D9%8A%D9%87%D8%A7%D8%AA%20%D8%A7%D9%84%D9%85%D8%AA%D9%84%D8%A7%D8%AD%D9%82%D8%A9%20%D9%84%D9%82%D8%A7%D8%AF%D8%A9%20%D8%A7%D9%84%D8%AF%D9%88%D9%84%D8%A9%20%D8%A7%D9%84%D8%B3%D9%88%D8%B1%D9%8A%D8%A9%20%D8%A7%D9%84%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9!!%20%D9%85%D8%B5%D8%B7%D9%81%D9%89%20%D8%A7%D9%84%D8%A8%D8%AF%D8%B1%D9%8A..mp4",
    type: "video/mp4",
    height: 720,
    width: 1280
  };

  const relatedVideos: RelatedVideoProps[] = [
    {
      title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
      channel: "مصطفى البدري",
      views: "123K views",
      thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري..jpg",
      time: "3 days ago"
    },
    {
      title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
      channel: "مصطفى البدري",
      views: "123K views",
      thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري..jpg",
      time: "3 days ago"
    },
    {
      title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
      channel: "مصطفى البدري",
      views: "123K views",
      thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري..jpg",
      time: "3 days ago"
    },
    {
      title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
      channel: "مصطفى البدري",
      views: "123K views",
      thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري..jpg",
      time: "3 days ago"
    },
    {
      title: "تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم.",
      channel: "مصطفى البدري",
      views: "123K views",
      thumbnail: "/img/تاريخ المذاهب الأربعة وأهمية التمذهب لطالب العلم - مصطفى البدري..jpg",
      time: "3 days ago"
    },
    // Add more related videos here
  ];

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
  <div className="flex flex-col min-h-screen  bg-ummah-bg">
    <Header toggleCollapse={toggleCollapse} />
    <div className="flex flex-1">
      <LeftNavigation isCollapsed={isCollapsed} />
      <main className="flex flex-col items-center justify-between p-4 flex-1 ">
        <div className="flex ">
          {/* Video Player Section */}
          <div className="flex-1 m-5">
            <VideoPlayer options={videoOptions} />
            <div className="mt-4">
              <h1 className="text-2xl font-semibold text-ummah-text">آخر مستجدات فتنة محمد بن شمس الدين!! مصطفى البدري.</h1>
              <p className="text-ummah-label">1,234,567 views • Mar 24, 2025</p>
            </div>
            <CommentsSection comments={comments} />
          </div>

          {/* Sidebar Section */}
          <RelatedVideosSection relatedVideos={relatedVideos} />
        </div>
      </main>
    </div>
  </div>
  </ThemeProvider>
  );
}