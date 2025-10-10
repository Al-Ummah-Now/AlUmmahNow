'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HomePage= () => {
  const { push } = useRouter();

  useEffect(() => {
     push('/en/');
  }, []);
  return <p></p>;
};

export default HomePage;