import { useEffect, useRef, useState, useCallback } from 'react';

interface UseLazyVideoOptions {
  rootMargin?: string;
  threshold?: number;
  triggerOnce?: boolean;
  enabled?: boolean;
}

interface UseLazyVideoReturn {
  ref: React.RefObject<HTMLDivElement>;
  isVisible: boolean;
  hasLoaded: boolean;
  load: () => void;
}

export const useLazyVideo = ({
  rootMargin = '200px',
  threshold = 0.1,
  triggerOnce = true,
  enabled = true
}: UseLazyVideoOptions = {}): UseLazyVideoReturn => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(() => {
    setHasLoaded(true);
    setIsVisible(true);
  }, []);

  useEffect(() => {
    if (!enabled || !ref.current) return;

    const element = ref.current;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      {
        rootMargin,
        threshold
      }
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [rootMargin, threshold, triggerOnce, enabled]);

  useEffect(() => {
    if (isVisible && !hasLoaded) {
      setHasLoaded(true);
    }
  }, [isVisible, hasLoaded]);

  return {
    ref,
    isVisible,
    hasLoaded,
    load
  };
};

export type { UseLazyVideoOptions, UseLazyVideoReturn };
