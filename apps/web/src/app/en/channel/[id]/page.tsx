"use client";
import React, { useState, useEffect } from 'react';

function ChannelPage({params}: {  params: Promise<{ id: string }> }) {
  const [channelId, setChannelId] = useState<string | null>(null);

  useEffect(() => {
    // Resolve the params Promise
    params.then((resolvedParams) => {
      setChannelId(resolvedParams.id);
    });
  }, [params]);

  if (!channelId) {
    return <div>Loading...</div>;
  }
  return (
    <div className="font-sans text-gray-800 max-w-6xl mx-auto">
      {/* Channel Banner */}
      <div className="relative h-52 bg-gray-200">
        <div className="absolute bottom-[-50px] left-5 w-24 h-24 rounded-full bg-gray-400 border-4 border-white"></div>
      </div>

      {/* Channel Info */}
      <div className="pt-16 pb-5 px-5 border-b border-gray-300">
        <h1 className="text-2xl font-bold">Channel {channelId}</h1>
        <p className="text-gray-600 mt-1">1.2M subscribers</p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-300 px-5 py-2">
        <button className="mr-5 text-blue-600">Home</button>
        <button className="mr-5 text-blue-600">Videos</button>
        <button className="mr-5 text-blue-600">Playlists</button>
        <button className="mr-5 text-blue-600">About</button>
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 p-5">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
            <div className="w-full h-36 bg-gray-300"></div>
            <h3 className="m-3 text-lg font-bold">Video Title {index + 1}</h3>
            <p className="mx-3 mb-3 text-gray-600 text-sm">1M views • 2 days ago</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChannelPage;
