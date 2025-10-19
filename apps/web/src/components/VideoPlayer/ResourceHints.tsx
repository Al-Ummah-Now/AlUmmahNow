import Head from 'next/head';

interface ResourceHintsProps {
  cdnDomain: string;
}

export const ResourceHints: React.FC<ResourceHintsProps> = ({ cdnDomain }) => {
  return (
    <Head>
      {/* DNS prefetch for initial domain resolution */}
      <link rel="dns-prefetch" href={`https://${cdnDomain}`} />

      {/* Preconnect for establishing TCP/TLS connections */}
      <link
        rel="preconnect"
        href={`https://${cdnDomain}`}
        crossOrigin="anonymous"
      />

      {/* Preload critical Video.js CSS */}
      <link
        rel="preload"
        href="https://vjs.zencdn.net/8.6.1/video-js.css"
        as="style"
        crossOrigin="anonymous"
      />

      {/* Preload Video.js core script */}
      <link
        rel="preload"
        href="https://vjs.zencdn.net/8.6.1/video.min.js"
        as="script"
        crossOrigin="anonymous"
      />
    </Head>
  );
};
